import json
import logging
import time
import concurrent.futures
from dataclasses import dataclass
from typing import List, Dict, Any, Type, Tuple
from sqlalchemy.orm import Session
from sqlalchemy.exc import InterfaceError, OperationalError
from fastapi import HTTPException
from pydantic import BaseModel

# Database Imports
from blanc.db.database import engine, get_db_session
from blanc.db_models.models import (
    DocumentAnalysis, 
    AssessmentResults, 
    Assessment, 
    AssessmentState, 
    AssessmentStage
)
from blanc.core.state_machine import transition_assessment
from blanc.crud import surface_map_crud

# Logic Imports
from blanc.core.llm_client import get_llm_client, set_assessment_context
from blanc.skills import get_skill

# Assuming these are the generic Pydantic models we built earlier
from blanc.schemas.llm.threats import (
    StrideThreatModelResponse,
    BusinessLogicThreatModelResponse
)

# Configure logging
logger = logging.getLogger(__name__)


# ==========================================
# 1. Framework Registry (Strategy Pattern)
# ==========================================

@dataclass
class ThreatFrameworkConfig:
    name: str
    categories: List[str]
    model: Type[BaseModel]
    system_role: str
    skill_name: str = "threat_analysis"  # skill file to load from blanc/skills/definitions/

FRAMEWORK_REGISTRY: Dict[str, ThreatFrameworkConfig] = {
    "STRIDE": ThreatFrameworkConfig(
        name="STRIDE",
        categories=["Spoofing", "Tampering", "Repudiation", "Information Disclosure", "Denial of Service", "Elevation of Privilege"],
        model=StrideThreatModelResponse,
        system_role="Act as an expert application security architect specializing in STRIDE threat modeling.",
        skill_name="stride_threat_modeling",
    ),

    "BUSINESS_LOGIC": ThreatFrameworkConfig(
        name="Business Logic Architecture",
        categories=[
            "Lifecycle & Orphaned Transitions",  
            "Sequential State Bypass",           
            "Missing Roles and Permission Checks",
            "Replays of Idempotency Operations", 
            "Race Condition and Concurrency",    
            "Resource Quota Violations"          
        ],
        model=BusinessLogicThreatModelResponse,
        system_role=(
            "Act as an expert Application Security Auditor specializing in OWASP Business Logic Vulnerabilities. "
            "Do not focus on standard technical CVEs like SQL injection or cross-site scripting. Instead, carefully "
            "analyze the provided architecture and workflows to find ways a legitimate user could maliciously abuse "
            "the system's intended rules, skip required steps, manipulate transaction states, or exploit race "
            "conditions for unauthorized gain."
        ),
        skill_name="business_logic_threat_modeling",
    )
}

# ==========================================
# 2. DB Context Helpers
# ==========================================

def fetch_all_image_analyses(assessment_id: str, db: Session) -> list:
    """Retrieves all per-image analysis data for an assessment."""
    analyses = db.query(DocumentAnalysis).filter_by(assessment_id=assessment_id).all()
    if not analyses:
        raise HTTPException(status_code=404, detail=f"No analyses found for {assessment_id}")
    return analyses


def merge_analysis_context(
    analyses: list,
    surface_maps_by_image: Dict[str, Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """
    Merges per-image analysis data into a single context dict for prompt generation.
    Each image's data is preserved with its image_id for traceability.

    ``surface_maps_by_image`` maps ``image_id -> surface_map JSON blob`` (as
    persisted by ``surface_map_crud``). When provided, the curated inventory
    (components, trust boundaries, environments, exposures, authn/authz) is
    folded into the prompt context as ``surface_map`` so the LLM grounds its
    threats in the authoritative user-edited model — not just the raw mermaid.
    """
    surface_maps_by_image = surface_maps_by_image or {}
    all_flow_diagrams = []
    all_summaries = []
    all_components = []
    all_clarifications = []
    all_surface_maps = []

    for img in analyses:
        label = img.image_id[:8]  # Short label for readability
        if img.flow_diagram:
            all_flow_diagrams.append(f"[Image {label}]: {json.dumps(img.flow_diagram)}")
        if img.analysis_summary:
            all_summaries.append(f"[Image {label}]: {json.dumps(img.analysis_summary)}")
        if img.component_details:
            comp = img.component_details
            if isinstance(comp, str):
                comp = json.loads(comp)
            for c in comp.get("components", []):
                if isinstance(c, dict):
                    c["_source_image"] = img.image_id
            all_components.extend(comp.get("components", []))
        if img.clarification:
            all_clarifications.append(img.clarification)

        sm_blob = surface_maps_by_image.get(img.image_id)
        if sm_blob:
            # Drop the raw mermaid copy stored on the surface_map — it's
            # already provided via flow_diagram above. Keep the curated
            # components / trust_boundaries / environments which is the
            # whole point of feeding the surface map into the prompt.
            trimmed = {k: v for k, v in sm_blob.items() if k != "mermaid"}
            all_surface_maps.append(f"[Image {label}]: {json.dumps(trimmed)}")

    return {
        "flow_diagram": "\n".join(all_flow_diagrams),
        "analysis_summary": "\n".join(all_summaries),
        "component_details": {"components": all_components},
        "clarification": all_clarifications,
        "surface_map": "\n".join(all_surface_maps),
    }

# ==========================================
# 3. Dynamic Prompting & AI Execution
# ==========================================

def generate_framework_prompt(framework: ThreatFrameworkConfig, category: str, context: Dict[str, str]) -> str:
    """Loads the framework-specific skill and renders it with architecture context."""
    skill = get_skill(framework.skill_name)
    return skill.render(
        system_role=framework.system_role,
        flow_diagram=context['flow_diagram'],
        summary=context['summary'],
        components_str=context['components_str'],
        json_documentation=context['json_documentation'],
        clarifications_str=context['clarifications_str'],
        surface_map_str=context.get('surface_map_str', ''),
        category=category,
        framework_name=framework.name,
    )

def _process_single_category(
    framework: ThreatFrameworkConfig, 
    category: str, 
    context_data: Dict[str, str], 
    max_retries: int = 2
) -> Tuple[str, List[Dict[str, Any]], str]:
    """Generic processor for any framework category."""
    prompt = generate_framework_prompt(framework, category, context_data)
    assessment_id = context_data.get("assessment_id")
    
    # Use the model exactly as defined in the registry
    expected_response_model = framework.model 

    for attempt in range(max_retries):
        try:
            response_obj = get_llm_client().call(prompt=prompt, response_model=expected_response_model, assessment_id=assessment_id, purpose="threat_modeling")
            threats = [t.model_dump() for t in response_obj.ThreatModel]
            return (category, threats, None)
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                logger.exception(f"Failed category {category} for {framework.name}")
                return (category, [], str(e))

def run_generic_analysis_pipeline(
    framework: ThreatFrameworkConfig, 
    analysis_data: Dict[str, Any], 
    json_documentation: str
) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, str]]:
    """Executes the AI analysis concurrently based on the framework's categories."""
    context_data = {
        "assessment_id": analysis_data.get("assessment_id", "unknown"),
        "flow_diagram": analysis_data.get("flow_diagram", ""),
        "summary": str(analysis_data.get("analysis_summary", "")),
        "components_str": json.dumps(analysis_data.get("component_details", {}), indent=2),
        "clarifications_str": json.dumps(analysis_data.get("clarification", []), indent=2),
        "surface_map_str": analysis_data.get("surface_map", "") or "(no curated surface map available)",
        "json_documentation": json_documentation
    }

    all_threats = []
    failed_categories = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(framework.categories)) as executor:
        future_to_cat = {
            executor.submit(_process_single_category, framework, cat, context_data): cat 
            for cat in framework.categories
        }
        for future in concurrent.futures.as_completed(future_to_cat):
            category, threats, error_msg = future.result()
            if error_msg:
                failed_categories[category] = error_msg
            else:
                all_threats.extend(threats)

    return {"ThreatModel": all_threats}, failed_categories

# ==========================================
# 4. Storage Logic
# ==========================================

def store_threat_model_results(assessment_id: str, framework_name: str, threat_model: dict) -> None:
    """Stores the generated threats, mapping core fields and dumping framework-specific fields to JSON."""
    threats = threat_model.get("ThreatModel", [])
    with get_db_session() as db:
        threats_data = []
        for t in threats:
            base_data = {
                "assessment_id": assessment_id,
                "image_id": t.get("_source_image"),  # Trace back to source image
                "framework": framework_name,
                "title": t.get("Threat"),
                "description": t.get("Description"),
                "mitigations": t.get("Mitigation"),
                "severity": t.get("Impact"),
                "likelihood": t.get("Likelihood"),
                "state": "OPEN",
                "framework_details": {
                    k: v for k, v in t.items()
                    if k not in ["Threat", "Description", "Mitigation", "Impact", "Likelihood", "_source_image"]
                }
            }
            threats_data.append(base_data)

        db.query(AssessmentResults).filter_by(assessment_id=assessment_id).delete()
        db.bulk_insert_mappings(AssessmentResults, threats_data)
        db.commit()

# ==========================================
# 5. Main Orchestrator
# ==========================================

def threat_modeling_pipeline(assessment_id: str, framework_name: str = "STRIDE") -> dict:
    """
    Main entry point. Collects analysis from all images, runs threat modeling.
    Uses state machine for assessment-level transitions.
    """
    framework = FRAMEWORK_REGISTRY.get(framework_name.upper())
    if not framework:
        raise ValueError(f"Unsupported framework: {framework_name}. Available options: {list(FRAMEWORK_REGISTRY.keys())}")

    logger.info(f"[{assessment_id}] {framework.name} PIPELINE START")

    set_assessment_context(assessment_id)
    
    # --- PHASE 1: Data Acquisition (all images) ---
    with get_db_session() as db:
        try:
            transition_assessment(db, assessment_id, AssessmentState.PROCESSING, AssessmentStage.THREAT_MODELING)
        except Exception:
            logger.exception(f"[{assessment_id}] Failed to transition to PROCESSING")
            raise

        try:
            analyses = fetch_all_image_analyses(assessment_id, db)

            # Pull the curated Surface Map for every image (when present). This
            # is the source of truth for the user-edited inventory — components,
            # trust boundaries, environments, exposures, authn/authz. We feed it
            # into the threat-modeling prompt below so the LLM grounds threats
            # in what the user actually approved, not just the raw mermaid.
            surface_maps_by_image: Dict[str, Dict[str, Any]] = {}
            for img in analyses:
                try:
                    sm_row = surface_map_crud.get_surface_map(db, assessment_id, img.image_id)
                    if sm_row and sm_row.surface_map:
                        surface_maps_by_image[img.image_id] = sm_row.surface_map
                except Exception as sm_err:
                    logger.warning(
                        f"[{assessment_id}][img:{img.image_id}] surface_map fetch failed: {sm_err}"
                    )

            merged = merge_analysis_context(analyses, surface_maps_by_image)

            comp_details = merged.get("component_details", {})
            if isinstance(comp_details, str):
                comp_details = json.loads(comp_details)

            component_names = [
                c.get("Component") for c in comp_details.get("components", [])
                if isinstance(c, dict) and "Component" in c
            ]
        except Exception as e:
            transition_assessment(db, assessment_id, AssessmentState.FAILED, AssessmentStage.THREAT_MODELING, error_message=str(e))
            raise

    # --- PHASE 2: Parallel AI Analysis ---
    try:
        # Documentation context is embedded in each component's purpose field when available.
        # No separate extraction needed; it flows through component_details automatically
        docs_json = "[]"

        analysis_data = {
            "assessment_id": assessment_id,
            "flow_diagram": merged["flow_diagram"],
            "analysis_summary": merged["analysis_summary"],
            "component_details": merged["component_details"],
            "clarification": merged["clarification"],
            "surface_map": merged["surface_map"],
        }

        threat_result, failed_categories = run_generic_analysis_pipeline(framework, analysis_data, docs_json)
        
        if not threat_result.get("ThreatModel"):
            raise Exception(f"No threats generated by AI for {framework.name}.")
        
        if failed_categories:
            logger.warning(f"[{assessment_id}] Some {framework.name} categories failed: {failed_categories}")

        # Map each threat back to its source image via component name matching
        component_to_image: Dict[str, str] = {}
        for c in comp_details.get("components", []):
            if isinstance(c, dict) and c.get("_source_image"):
                comp_name = c.get("component") or c.get("Component") or ""
                if comp_name:
                    component_to_image[comp_name.lower().strip()] = c["_source_image"]

        for t in threat_result.get("ThreatModel", []):
            if not t.get("_source_image"):
                threat_comp = (t.get("Component") or t.get("component") or "").lower().strip()
                # Try exact match first, then substring match
                matched_image = component_to_image.get(threat_comp)
                if not matched_image and threat_comp:
                    for comp_key, img_id in component_to_image.items():
                        if comp_key in threat_comp or threat_comp in comp_key:
                            matched_image = img_id
                            break
                if matched_image:
                    t["_source_image"] = matched_image

    except Exception as e:
        with get_db_session() as db_fail:
            transition_assessment(db_fail, assessment_id, AssessmentState.FAILED, AssessmentStage.THREAT_MODELING, error_message=str(e))
        raise

    # --- PHASE 3: Finalize ---
    with get_db_session() as db_final:
        try:
            store_threat_model_results(assessment_id, framework.name, threat_result)
            transition_assessment(db_final, assessment_id, AssessmentState.REVIEW, AssessmentStage.THREAT_MODELING)
            logger.info(f"[{assessment_id}] {framework.name} PIPELINE SUCCESS")

            # Delete uploads folder now that threat modeling is in REVIEW
            try:
                from blanc.core.storage import get_storage_backend
                get_storage_backend().cleanup_assessment_cache(assessment_id)
            except Exception as cleanup_err:
                logger.warning(f"[{assessment_id}] Upload folder cleanup on REVIEW skipped: {cleanup_err}")

            return threat_result
        except Exception as e:
            transition_assessment(db_final, assessment_id, AssessmentState.FAILED, AssessmentStage.THREAT_MODELING, error_message=str(e))
            raise
