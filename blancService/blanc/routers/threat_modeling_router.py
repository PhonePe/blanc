import csv
import io
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func
from fpdf import FPDF
from blanc.utils import standard_response
from blanc.db.database import get_db, engine
from blanc.core.auth.auth import require_assessment_owner, require_roles
from blanc.db_models.models import (
    AssessmentState, AssessmentStage, Assessment, DocumentAnalysis,
    AssessmentDocument, LLMUsage, SurfaceMap,
)
from blanc.services.assessment_service import AssessmentService
from blanc.schemas.surface_map import (
    SurfaceMapPayload, SurfaceMapResponse,
)
from blanc.crud import surface_map_crud

logger = logging.getLogger(__name__)

# Self-create the surface_map table on first import. Safe (idempotent) and
# avoids needing a migration step for this single additive table.
try:
    SurfaceMap.__table__.create(bind=engine, checkfirst=True)
except Exception as e:  # pragma: no cover - log + continue, table may already exist
    logger.warning("Could not auto-create surface_map table: %s", e)

# define router
threat_model_router = APIRouter(
    prefix="/threat_modeling", 
    tags=["Threat Modeling"], 
    dependencies=[Depends(require_roles(["USER", "ADMIN"]))]
)

@threat_model_router.get("/{assessment_id}/status", dependencies=[Depends(require_assessment_owner)])
def get_threat_modeling_status(assessment_id: str, db: Session = Depends(get_db)):
    """
    Checks the current State and Stage of the assessment.
    """
    data = AssessmentService.get_status(db, assessment_id)
    if not data:
        return standard_response(404, "Assessment not found", {})
    
    # data contains {"state": ..., "stage": ...}
    return standard_response(200, "Threat modeling status fetched successfully", data)


@threat_model_router.post("/{assessment_id}/start", dependencies=[Depends(require_assessment_owner)])
async def start_threat_modeling(
    assessment_id: str, 
    db: Session = Depends(get_db)
):
    status_info = AssessmentService.get_status(db, assessment_id)

    # Guardrail 1: Already running
    if status_info["state"] == AssessmentState.PROCESSING or status_info["stage"] == AssessmentStage.THREAT_MODELING:
        return standard_response(409, "Threat modeling is already in progress.", {})

    # Guardrail 2: Already finished
    if status_info["state"] == AssessmentState.COMPLETED and status_info["stage"] == AssessmentStage.THREAT_MODELING:
        return standard_response(
            400, 
            "Assessment is already completed. Use 'retry' if you need to regenerate results.", 
            {"assessment_id": assessment_id}
        )

    await AssessmentService.run_threat_modeling(db, assessment_id)
    return standard_response(200, "Threat modeling initiated.", {})


@threat_model_router.get("/{assessment_id}/results/by-image", dependencies=[Depends(require_assessment_owner)])
def get_threat_results_by_image(assessment_id: str, db: Session = Depends(get_db)):
    """
    Returns threat results grouped per image. Each image entry includes its
    analysis data (flow_diagram, summary, components, clarification) and
    the threats traced back to it via image_id.
    Threats not linked to any image are returned under 'unmapped_threats'.
    """
    data = AssessmentService.get_threats_grouped_by_image(db, assessment_id)
    if data is None:
        return standard_response(404, "Assessment not found", {})
    return standard_response(200, "Threat results grouped by image fetched successfully", data)

@threat_model_router.post("/{assessment_id}/reanalyze", dependencies=[Depends(require_assessment_owner)])
async def reanalyze_threat_modeling(
    assessment_id: str,
    db: Session = Depends(get_db)
):
    """
    Clears existing threat results and re-runs the threat modeling pipeline.
    Useful when the user wants to regenerate threats (e.g., after updating clarifications or changing framework).
    """
    status_info = AssessmentService.get_status(db, assessment_id)
    if not status_info:
        return standard_response(404, "Assessment not found", {})

    # Guardrail: Don't re-trigger if already running
    if status_info["state"] == AssessmentState.PROCESSING and status_info["stage"] == AssessmentStage.THREAT_MODELING:
        return standard_response(409, "Threat modeling is already in progress.", {})

    await AssessmentService.reanalyze_threat_modeling(db, assessment_id)
    return standard_response(200, "Threat modeling re-analysis initiated.", {"assessment_id": assessment_id})


@threat_model_router.get("/{assessment_id}/export", dependencies=[Depends(require_assessment_owner)])
def export_threat_model_results(assessment_id: str, db: Session = Depends(get_db)):
    """
    Exports the generated threats as a CSV.
    """
    threats_data = AssessmentService.get_threats_data(db, assessment_id)
    
    if not threats_data:
         return standard_response(404, "No threat data found to export", {})

    output = io.StringIO()
    writer = csv.writer(output)
    
    # Headers
    writer.writerow([
        "Category", "Title", "Description", "Component Affected", 
        "Mitigations", "Severity", "Likelihood", "State"
    ])

    # Row mapping
    for threat in threats_data:
        writer.writerow([
            threat.get("ThreatCategory", ""),
            threat.get("Threat", ""),
            threat.get("Description", ""),
            threat.get("Component", ""),
            threat.get("Mitigation", ""),
            threat.get("Impact", ""),
            threat.get("Likelihood", ""),
            threat.get("state", "OPEN")
        ])

    output.seek(0)
    
    filename = f"threat_model_{assessment_id}.csv"
    response = StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv"
    )
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    
    return response


@threat_model_router.get("/{assessment_id}/usage", dependencies=[Depends(require_assessment_owner)])
def get_threat_modeling_usage(
    assessment_id: str,
    db: Session = Depends(get_db),
):
    """
    Returns total LLM cost and tokens for an assessment,
    including all retries and pipeline re-runs.
    """
    assessment = db.query(Assessment).filter_by(assessment_id=assessment_id).first()
    if not assessment:
        return standard_response(404, "Assessment not found", {})

    totals = (
        db.query(
            sql_func.count(LLMUsage.id).label("total_calls"),
            sql_func.coalesce(sql_func.sum(LLMUsage.input_tokens), 0).label("total_input_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.output_tokens), 0).label("total_output_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.total_tokens), 0).label("total_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.tokens_billed), 0).label("total_tokens_billed"),
            sql_func.coalesce(sql_func.sum(LLMUsage.estimated_cost), 0).label("total_estimated_cost"),
            sql_func.coalesce(sql_func.sum(LLMUsage.duration_ms), 0).label("total_duration_ms"),
        )
        .filter(LLMUsage.assessment_id == assessment_id)
        .first()
    )

    calls = (
        db.query(LLMUsage)
        .filter(LLMUsage.assessment_id == assessment_id)
        .order_by(LLMUsage.created_at.desc())
        .all()
    )

    calls_list = [
        {
            "id": c.id,
            "call_type": c.call_type,
            "model": c.model,
            "input_tokens": c.input_tokens or 0,
            "output_tokens": c.output_tokens or 0,
            "total_tokens": c.total_tokens or 0,
            "tokens_billed": c.tokens_billed or 0,
            "estimated_cost": float(c.estimated_cost) if c.estimated_cost else 0,
            "duration_ms": c.duration_ms,
            "created_at": str(c.created_at) if c.created_at else None,
        }
        for c in calls
    ]

    return standard_response(200, "LLM usage fetched successfully", {
        "assessment_id": assessment_id,
        "total_calls": totals.total_calls,
        "total_input_tokens": int(totals.total_input_tokens),
        "total_output_tokens": int(totals.total_output_tokens),
        "total_tokens": int(totals.total_tokens),
        "total_tokens_billed": int(totals.total_tokens_billed),
        "total_estimated_cost": float(totals.total_estimated_cost),
        "total_duration_ms": int(totals.total_duration_ms),
        "calls": calls_list,
    })


# ─── PDF helpers ───

# Severity colour palettes (fill_r, fill_g, fill_b, text_r, text_g, text_b)
_SEV_COLORS = {
    "CRITICAL": (255, 241, 242, 190, 18, 60),    # rose
    "HIGH":     (255, 247, 237, 194, 65,  12),    # orange
    "MEDIUM":   (255, 251, 235, 180, 83,   9),    # amber
    "LOW":      (236, 253, 245,   5, 150, 105),   # emerald
}
_SEV_DEFAULT = (241, 245, 249, 71, 85, 105)        # slate

# STRIDE category descriptions
_CATEGORY_INFO = {
    "Spoofing":                  "Identity and authentication bypassing",
    "Tampering":                 "Unauthorized modification of data or code",
    "Repudiation":               "Lack of auditing and traceability",
    "Information Disclosure":    "Unauthorized data exposure",
    "Denial of Service":         "Resource exhaustion and availability impacts",
    "Elevation of Privilege":    "Unauthorized access and role escalation",
}


def _safe(val: str | None, fallback: str = "N/A") -> str:
    """Sanitise a value for PDF output — strip nulls and encode to latin-1."""
    if val is None:
        return fallback
    return str(val).encode("latin-1", "replace").decode("latin-1")


def _sev_key(severity: str | None) -> int:
    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    return order.get(str(severity).upper(), 4)


class _ReportPDF(FPDF):
    """Custom FPDF subclass with automatic header/footer on every page."""

    _report_title = "Threat Model Report"
    _assessment_id = ""
    _framework = ""

    def header(self):
        if self.page_no() == 1:
            return  # title page has its own header
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(100, 116, 139)  # slate-500
        self.cell(0, 6, _safe(f"{self._framework} Report  |  ID: {self._assessment_id[:8]}..."),
                  new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(226, 232, 240)  # slate-200
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(3)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(148, 163, 184)  # slate-400
        self.cell(0, 8, _safe(f"Blanc Threat Model Report  -  Page {self.page_no()}/{{nb}}"), align="C")

    # ── Drawing helpers ──

    def _rounded_rect(self, x, y, w, h, r, fill_rgb=None, border_rgb=None):
        """Draw a rounded rectangle (fill and/or outline)."""
        if fill_rgb:
            self.set_fill_color(*fill_rgb)
        if border_rgb:
            self.set_draw_color(*border_rgb)
        style = ""
        if fill_rgb and border_rgb:
            style = "DF"
        elif fill_rgb:
            style = "F"
        elif border_rgb:
            style = "D"
        if style:
            self.round_clip(x, y, w, h, r, style)

    def round_clip(self, x, y, w, h, r, style="DF"):
        """PDF rounded-rect via arc quarters."""
        self.rect(x, y, w, h, style)

    def _badge(self, text, fill_rgb, text_rgb, border_rgb=None):
        """Draw an inline severity/status badge."""
        self.set_font("Helvetica", "B", 7)
        tw = self.get_string_width(text) + 5
        bh = 5.5
        x, y = self.get_x(), self.get_y()
        # fill
        self.set_fill_color(*fill_rgb)
        if border_rgb:
            self.set_draw_color(*border_rgb)
            self.rect(x, y, tw, bh, "DF")
        else:
            self.rect(x, y, tw, bh, "F")
        self.set_text_color(*text_rgb)
        self.set_xy(x, y)
        self.cell(tw, bh, _safe(text), align="C")
        self.set_xy(x + tw + 2, y)  # advance cursor past badge

    def _severity_badge(self, severity: str):
        sev = str(severity).upper()
        fill_r, fill_g, fill_b, t_r, t_g, t_b = _SEV_COLORS.get(sev, _SEV_DEFAULT)
        self._badge(sev.capitalize(), (fill_r, fill_g, fill_b), (t_r, t_g, t_b))

    def _section_heading(self, title: str, subtitle: str = ""):
        """Render a styled section heading (like UI card headers)."""
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(15, 23, 42)  # slate-900
        self.cell(0, 9, _safe(title), new_x="LMARGIN", new_y="NEXT")
        if subtitle:
            self.set_font("Helvetica", "", 8)
            self.set_text_color(100, 116, 139)  # slate-500
            self.cell(0, 5, _safe(subtitle), new_x="LMARGIN", new_y="NEXT")
        self.ln(3)

    def _metric_card(self, x, y, w, label, value, accent_rgb):
        """Draw a single metric card (like the 4-card stats row)."""
        h = 22
        # Card bg
        self.set_fill_color(255, 255, 255)
        self.set_draw_color(226, 232, 240)  # slate-200
        self.rect(x, y, w, h, "DF")
        # Accent dot
        self.set_fill_color(*accent_rgb)
        self.rect(x + 4, y + 4, 3, 3, "F")
        # Label
        self.set_xy(x + 10, y + 3)
        self.set_font("Helvetica", "", 6.5)
        self.set_text_color(100, 116, 139)  # slate-500
        self.cell(w - 14, 4, _safe(label.upper()))
        # Value
        self.set_xy(x + 10, y + 10)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(15, 23, 42)  # slate-900
        self.cell(w - 14, 8, _safe(str(value)))

    def _card_start(self, border_rgb=(226, 232, 240), bg_rgb=(255, 255, 255)):
        """Mark beginning of a card-like section with left border accent."""
        self.set_draw_color(*border_rgb)
        self.set_line_width(0.3)

    def _divider(self):
        self.set_draw_color(241, 245, 249)  # slate-100
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(2)


def _build_threat_report_pdf(
    assessment: Assessment,
    threats_data: list,
    images_data: list | None = None,
) -> bytes:
    """
    Generates a professional PDF report matching the threat page UI design.
    Returns PDF bytes.
    """
    pdf = _ReportPDF(orientation="P", unit="mm", format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf._assessment_id = assessment.assessment_id or ""
    pdf._framework = assessment.framework or "STRIDE"

    # ════════════════════════════════════════════════════
    # PAGE 1 — Title / Cover
    # ════════════════════════════════════════════════════
    pdf.add_page()

    # Indigo header bar
    pdf.set_fill_color(79, 70, 229)  # indigo-600
    pdf.rect(0, 0, 210, 44, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 24)
    pdf.set_xy(15, 10)
    pdf.cell(0, 10, _safe(f"{assessment.framework or 'STRIDE'} Report"))
    pdf.set_font("Helvetica", "", 10)
    pdf.set_xy(15, 22)
    pdf.cell(0, 8, _safe("Automated Threat Modeling — Threat Model Report"))
    pdf.set_xy(15, 30)
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(0, 8, _safe(f"Generated {datetime.utcnow().strftime('%d %B %Y, %H:%M UTC')}"))

    # Status badge top-right
    state_str = str(assessment.state.value if hasattr(assessment.state, 'value') else assessment.state).upper()
    state_colors = {
        "COMPLETED": ((236, 253, 245), (5, 150, 105)),
        "APPROVED":  ((236, 253, 245), (5, 150, 105)),
        "PROCESSING":((238, 242, 255), (79, 70, 229)),
        "PENDING":   ((238, 242, 255), (79, 70, 229)),
        "FAILED":    ((255, 241, 242), (190, 18, 60)),
    }
    s_fill, s_text = state_colors.get(state_str, ((241, 245, 249), (71, 85, 105)))
    pdf.set_xy(150, 12)
    pdf._badge(state_str, s_fill, s_text)

    # Assessment metadata card
    pdf.set_xy(10, 52)
    pdf.set_fill_color(255, 255, 255)
    pdf.set_draw_color(226, 232, 240)
    pdf.rect(10, 52, 190, 56, "DF")

    meta_pairs = [
        ("Assessment ID",  assessment.assessment_id),
        ("Application",    assessment.app_name),
        ("Organization",   assessment.org_name),
        ("Framework",      assessment.framework),
        ("Team",           assessment.team),
        ("Feature",        f"{assessment.feature_name or 'N/A'} v{assessment.feature_version or '1.0'}"),
        ("Status",         state_str),
    ]
    col_x = [15, 110]
    row_y = 56
    for i, (label, value) in enumerate(meta_pairs):
        cx = col_x[i % 2]
        cy = row_y + (i // 2) * 8
        pdf.set_xy(cx, cy)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(100, 116, 139)  # slate-500
        pdf.cell(30, 6, _safe(label.upper()))
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(15, 23, 42)  # slate-900
        pdf.cell(60, 6, _safe(str(value) if value else "N/A"))

    # ── Metrics cards row ──
    total = len(threats_data)
    severity_counts: dict[str, int] = {}
    for t in threats_data:
        sev = str(t.get("Impact", "Unknown")).upper()
        severity_counts[sev] = severity_counts.get(sev, 0) + 1

    cards_y = 116
    card_w = 44
    gap = 2.7
    metrics = [
        ("Total Threats",  total,                              (71, 85, 105)),    # slate
        ("Critical Risks", severity_counts.get("CRITICAL", 0), (225, 29, 72)),    # rose
        ("High Risks",     severity_counts.get("HIGH", 0),     (234, 88, 12)),    # orange
        ("Medium Risks",   severity_counts.get("MEDIUM", 0),   (217, 119, 6)),    # amber
    ]
    for i, (label, val, color) in enumerate(metrics):
        pdf._metric_card(10 + i * (card_w + gap), cards_y, card_w, label, val, color)

    # ── Executive Summary ──
    pdf.set_xy(10, 146)
    pdf.set_fill_color(248, 250, 252)  # slate-50
    pdf.set_draw_color(226, 232, 240)
    pdf.rect(10, 146, 190, 30, "DF")
    pdf.set_xy(15, 149)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(15, 23, 42)
    pdf.cell(0, 6, _safe("Executive Summary"))
    pdf.set_xy(15, 157)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(71, 85, 105)  # slate-600
    breakdown = ", ".join(f"{k}: {v}" for k, v in sorted(severity_counts.items(), key=lambda x: _sev_key(x[0])))
    pdf.multi_cell(180, 5, _safe(
        f"This assessment identified {total} threat(s) across the architecture. "
        f"Severity breakdown: {breakdown}."
        if total else "No threats were identified during this assessment."
    ))

    # ════════════════════════════════════════════════════
    # SECTION — Per-Image Architecture Analysis
    # ════════════════════════════════════════════════════
    if images_data:
        pdf.add_page()
        pdf._section_heading(
            "Architecture Analysis",
            f"{len(images_data)} image(s) analyzed"
        )

        for img_idx, img in enumerate(images_data):
            if pdf.get_y() > 230:
                pdf.add_page()

            image_id = img.get("image_id", "Unknown")
            image_path = img.get("image_path", "")
            filename = image_path.split("/")[-1] if image_path else f"Image {img_idx + 1}"

            # Image card header
            pdf.set_fill_color(248, 250, 252)  # slate-50
            pdf.set_draw_color(226, 232, 240)
            y0 = pdf.get_y()
            pdf.rect(10, y0, 190, 8, "DF")
            pdf.set_xy(14, y0 + 1)
            pdf.set_font("Helvetica", "B", 10)
            pdf.set_text_color(15, 23, 42)
            pdf.cell(100, 6, _safe(f"Image {img_idx + 1}: {filename}"))
            # Threat count badge
            img_threats = img.get("threats", [])
            pdf.set_xy(160, y0 + 1.5)
            pdf._badge(f"{len(img_threats)} threat(s)", (238, 242, 255), (79, 70, 229))
            pdf.set_xy(10, y0 + 10)

            # Analysis summary
            summary = img.get("analysis_summary")
            if summary and isinstance(summary, dict):
                summary_text = summary.get("summary", summary.get("text", ""))
                if isinstance(summary_text, str) and summary_text:
                    pdf.set_fill_color(255, 255, 255)
                    pdf.set_draw_color(226, 232, 240)
                    sy = pdf.get_y()
                    pdf.set_xy(14, sy + 2)
                    pdf.set_font("Helvetica", "B", 8)
                    pdf.set_text_color(79, 70, 229)  # indigo-600
                    pdf.cell(0, 5, _safe("ANALYSIS SUMMARY"), new_x="LMARGIN", new_y="NEXT")
                    pdf.set_x(14)
                    pdf.set_font("Helvetica", "", 8)
                    pdf.set_text_color(71, 85, 105)
                    pdf.multi_cell(182, 4.5, _safe(summary_text[:2000]))
                    pdf.ln(2)

            # Components table
            components = img.get("component_details")
            if components and isinstance(components, list) and len(components) > 0:
                if pdf.get_y() > 240:
                    pdf.add_page()
                pdf.set_font("Helvetica", "B", 8)
                pdf.set_text_color(15, 23, 42)
                pdf.set_x(14)
                pdf.cell(80, 5, _safe(f"Components ({len(components)} identified)"), new_x="LMARGIN", new_y="NEXT")
                pdf.ln(1)

                # Table header
                c_widths = [40, 24, 60, 30, 30]
                c_headers = ["Component", "Type", "Purpose", "Trust Level", "Protocol"]
                pdf.set_x(14)
                pdf.set_font("Helvetica", "B", 7)
                pdf.set_fill_color(248, 250, 252)
                pdf.set_text_color(71, 85, 105)
                for ci, ch in enumerate(c_headers):
                    pdf.cell(c_widths[ci], 6, _safe(ch), border=1, fill=True)
                pdf.ln()

                # Table rows
                pdf.set_font("Helvetica", "", 7)
                pdf.set_text_color(51, 65, 85)  # slate-700
                for comp in components[:25]:
                    if pdf.get_y() > 265:
                        pdf.add_page()
                        pdf.set_font("Helvetica", "", 7)
                        pdf.set_text_color(51, 65, 85)
                    name = comp.get("component", comp.get("name", "Unknown"))
                    ctype = comp.get("type", "")
                    purpose = comp.get("purpose", comp.get("description", ""))
                    trust = comp.get("trust_level", "")
                    protocol = comp.get("protocol", comp.get("protocols", ""))
                    if isinstance(protocol, list):
                        protocol = ", ".join(protocol)
                    row_vals = [
                        str(name)[:40], str(ctype)[:22], str(purpose)[:60],
                        str(trust)[:28], str(protocol)[:28],
                    ]
                    pdf.set_x(14)
                    for ci, cv in enumerate(row_vals):
                        pdf.cell(c_widths[ci], 5.5, _safe(cv), border=1)
                    pdf.ln()

                pdf.ln(3)

            pdf._divider()
            pdf.ln(3)

    # ════════════════════════════════════════════════════
    # SECTION — Threats grouped by STRIDE category
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf._section_heading(
        "Identified Threats",
        f"{total} threat(s) found  |  Grouped by category"
    )

    if not threats_data:
        pdf.set_font("Helvetica", "I", 10)
        pdf.set_text_color(100, 116, 139)
        pdf.cell(0, 10, _safe("No threats identified."), new_x="LMARGIN", new_y="NEXT")
    else:
        # Group by category
        by_category: dict[str, list] = {}
        for t in threats_data:
            cat = t.get("ThreatCategory", "Identified Risks")
            by_category.setdefault(cat, []).append(t)

        # Sort categories by highest severity threat in each
        sorted_cats = sorted(by_category.items(),
                             key=lambda kv: min(_sev_key(t.get("Impact")) for t in kv[1]))

        for cat_name, cat_threats in sorted_cats:
            if pdf.get_y() > 240:
                pdf.add_page()

            # ── Category header bar ──
            cat_desc = _CATEGORY_INFO.get(cat_name, f"Identified threats in {cat_name}")
            ch_y = pdf.get_y()
            pdf.set_fill_color(248, 250, 252)  # slate-50
            pdf.set_draw_color(226, 232, 240)
            pdf.rect(10, ch_y, 190, 12, "DF")
            # Left accent bar
            cat_accent = {
                "Spoofing": (37, 99, 235), "Tampering": (234, 88, 12),
                "Repudiation": (100, 116, 139), "Information Disclosure": (79, 70, 229),
                "Denial of Service": (225, 29, 72), "Elevation of Privilege": (147, 51, 234),
            }
            accent = cat_accent.get(cat_name, (71, 85, 105))
            pdf.set_fill_color(*accent)
            pdf.rect(10, ch_y, 2.5, 12, "F")

            pdf.set_xy(16, ch_y + 1)
            pdf.set_font("Helvetica", "B", 10)
            pdf.set_text_color(15, 23, 42)
            pdf.cell(90, 5, _safe(cat_name))
            pdf.set_xy(16, ch_y + 6.5)
            pdf.set_font("Helvetica", "", 7)
            pdf.set_text_color(100, 116, 139)
            pdf.cell(100, 4, _safe(cat_desc))

            # Finding count badge
            pdf.set_xy(170, ch_y + 3)
            pdf._badge(f"{len(cat_threats)} Finding(s)", (238, 242, 255), (79, 70, 229))

            pdf.set_xy(10, ch_y + 14)

            # Sort threats within category by severity
            cat_threats.sort(key=lambda t: _sev_key(t.get("Impact")))

            # ── Individual threat cards ──
            for t_idx, t in enumerate(cat_threats):
                if pdf.get_y() > 235:
                    pdf.add_page()

                card_y = pdf.get_y()

                # Card border (left accent = severity color)
                sev = str(t.get("Impact", "Unknown")).upper()
                sev_fill, sev_text = _SEV_COLORS.get(sev, _SEV_DEFAULT)[:3], _SEV_COLORS.get(sev, _SEV_DEFAULT)[3:]
                pdf.set_draw_color(226, 232, 240)
                pdf.set_fill_color(255, 255, 255)

                # We'll draw the card outline after content, first position content
                content_x = 14
                pdf.set_xy(content_x, card_y + 2)

                # Row 1: Severity badge + Component badge
                pdf._severity_badge(t.get("Impact", "Unknown"))
                comp = t.get("Component", "")
                if comp:
                    pdf._badge(f"Component: {str(comp)[:35]}", (241, 245, 249), (71, 85, 105))
                # Review status
                review = t.get("review_status", "")
                if review and str(review).upper() == "APPROVED":
                    pdf._badge("Approved", (236, 253, 245), (5, 150, 105))
                elif review and str(review).upper() == "REJECTED":
                    pdf._badge("Rejected", (255, 241, 242), (190, 18, 60))
                pdf.ln()

                # Title
                pdf.set_x(content_x)
                pdf.set_font("Helvetica", "B", 9)
                pdf.set_text_color(15, 23, 42)
                pdf.multi_cell(180, 5, _safe(str(t.get("Threat", "Untitled"))[:200]))
                pdf.ln(1)

                # Description
                desc = t.get("Description", "")
                if desc:
                    pdf.set_x(content_x)
                    pdf.set_font("Helvetica", "", 8)
                    pdf.set_text_color(71, 85, 105)  # slate-600
                    pdf.multi_cell(180, 4.5, _safe(str(desc)[:800]))
                    pdf.ln(1)

                # Likelihood row
                likelihood = t.get("Likelihood", "")
                if likelihood:
                    pdf.set_x(content_x)
                    pdf.set_font("Helvetica", "B", 7)
                    pdf.set_text_color(100, 116, 139)
                    pdf.cell(18, 4.5, _safe("LIKELIHOOD"))
                    pdf.set_font("Helvetica", "", 8)
                    pdf.set_text_color(51, 65, 85)
                    pdf.cell(60, 4.5, _safe(str(likelihood)), new_x="LMARGIN", new_y="NEXT")

                # Mitigation box (styled like the green card in UI)
                mitigation = t.get("Mitigation", "")
                if mitigation:
                    pdf.ln(1)
                    mit_y = pdf.get_y()
                    pdf.set_fill_color(248, 250, 252)  # slate-50
                    pdf.set_draw_color(241, 245, 249)  # slate-100

                    # Draw box background first, estimate height
                    pdf.set_xy(content_x, mit_y)
                    pdf.set_font("Helvetica", "B", 7)
                    pdf.set_text_color(5, 150, 105)  # emerald-600
                    pdf.cell(30, 4.5, _safe("MITIGATION"))
                    pdf.ln()
                    pdf.set_x(content_x)
                    pdf.set_font("Helvetica", "", 8)
                    pdf.set_text_color(71, 85, 105)
                    # Render mitigation text into the box
                    mit_text_y = pdf.get_y()
                    pdf.multi_cell(180, 4.5, _safe(str(mitigation)[:1000]))
                    mit_end_y = pdf.get_y()
                    # Draw the background rect behind the mitigation
                    pdf.set_fill_color(248, 250, 252)
                    pdf.set_draw_color(226, 232, 240)
                    pdf.rect(content_x - 1, mit_y - 1, 183, mit_end_y - mit_y + 3, "D")

                # Draw card outline
                card_end_y = pdf.get_y() + 2
                pdf.set_draw_color(*sev_fill)
                pdf.set_line_width(0.6)
                pdf.line(11, card_y, 11, card_end_y)  # left accent bar
                pdf.set_draw_color(226, 232, 240)
                pdf.set_line_width(0.2)
                pdf.rect(10.5, card_y, 189.5, card_end_y - card_y, "D")

                pdf.set_xy(10, card_end_y + 3)

            pdf.ln(4)

    # ════════════════════════════════════════════════════
    # SECTION — Threats Summary Table
    # ════════════════════════════════════════════════════
    if threats_data:
        pdf.add_page()
        pdf._section_heading("Threats Summary Table", f"{total} threat(s)")

        col_widths = [10, 30, 50, 42, 22, 22, 14]
        headers = ["#", "Category", "Threat", "Component", "Severity", "Likelihood", "Status"]

        # Header row
        pdf.set_font("Helvetica", "B", 7)
        pdf.set_fill_color(248, 250, 252)
        pdf.set_draw_color(226, 232, 240)
        pdf.set_text_color(71, 85, 105)
        for i, h in enumerate(headers):
            pdf.cell(col_widths[i], 7, _safe(h), border=1, fill=True)
        pdf.ln()

        # Data rows
        for idx, t in enumerate(threats_data, 1):
            if pdf.get_y() > 270:
                pdf.add_page()
                # Re-draw header
                pdf.set_font("Helvetica", "B", 7)
                pdf.set_fill_color(248, 250, 252)
                pdf.set_text_color(71, 85, 105)
                for i, h in enumerate(headers):
                    pdf.cell(col_widths[i], 7, _safe(h), border=1, fill=True)
                pdf.ln()

            sev = str(t.get("Impact", "")).upper()
            sev_colors = _SEV_COLORS.get(sev, _SEV_DEFAULT)

            # Alternate row background
            if idx % 2 == 0:
                pdf.set_fill_color(248, 250, 252)
            else:
                pdf.set_fill_color(255, 255, 255)

            pdf.set_font("Helvetica", "", 7)
            pdf.set_text_color(51, 65, 85)

            row = [
                str(idx),
                str(t.get("ThreatCategory", ""))[:30],
                str(t.get("Threat", ""))[:55],
                str(t.get("Component", ""))[:42],
                str(t.get("Impact", ""))[:20],
                str(t.get("Likelihood", ""))[:20],
                str(t.get("review_status", "OPEN"))[:12],
            ]
            for i, val in enumerate(row):
                fill = idx % 2 == 0
                # Color severity cell
                if i == 4:
                    pdf.set_fill_color(*sev_colors[:3])
                    pdf.set_text_color(*sev_colors[3:])
                    pdf.set_font("Helvetica", "B", 7)
                    pdf.cell(col_widths[i], 6, _safe(val), border=1, fill=True)
                    pdf.set_text_color(51, 65, 85)
                    pdf.set_font("Helvetica", "", 7)
                    if idx % 2 == 0:
                        pdf.set_fill_color(248, 250, 252)
                    else:
                        pdf.set_fill_color(255, 255, 255)
                else:
                    pdf.cell(col_widths[i], 6, _safe(val), border=1, fill=fill)
            pdf.ln()

    return pdf.output()


@threat_model_router.get("/{assessment_id}/export/pdf", dependencies=[Depends(require_assessment_owner)])
def export_threat_model_pdf(
    assessment_id: str,
    db: Session = Depends(get_db),
):
    """
    Generates and returns a PDF report of the threat model results.
    Includes: assessment metadata, executive summary, per-image analysis,
    threats table, and detailed threat cards.
    """
    assessment = db.query(Assessment).filter_by(assessment_id=assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    threats_data = AssessmentService.get_threats_data(db, assessment_id)
    if threats_data is None:
        threats_data = []

    # Get per-image analysis for richer report
    grouped = AssessmentService.get_threats_grouped_by_image(db, assessment_id)
    images_data = grouped.get("images", []) if grouped else []

    pdf_bytes = _build_threat_report_pdf(assessment, threats_data, images_data)

    filename = f"threat_report_{assessment_id[:8]}.pdf"
    return Response(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ─── Surface Discovery / ThreatModeller Inventory ────────────────────────────
#
# One row per (assessment_id, image_id) holding the full surface_map JSON.
# Replaces (and persists) what the frontend ThreatModelInventory used to keep
# only in browser localStorage. Schema is documented in
# blanc/api_schemas/api_v1/threat_modeling_schema.py.

def _serialize_surface_map(row: SurfaceMap) -> dict:
    return {
        "assessment_id": row.assessment_id,
        "image_id": row.image_id,
        "surface_map": row.surface_map or {
            "components": [], "trust_boundaries": [], "environments": [], "mermaid": None,
        },
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _assessment_exists(db: Session, assessment_id: str) -> bool:
    return db.query(Assessment.assessment_id).filter(
        Assessment.assessment_id == assessment_id
    ).first() is not None


@threat_model_router.get("/{assessment_id}/surface-map/{image_id}", dependencies=[Depends(require_assessment_owner)])
def get_surface_map_endpoint(
    assessment_id: str,
    image_id: str,
    db: Session = Depends(get_db),
):
    """Fetch the persisted Surface Discovery inventory for one image."""
    if not _assessment_exists(db, assessment_id):
        return standard_response(404, "Assessment not found", {})

    row = surface_map_crud.get_surface_map(db, assessment_id, image_id)
    if row is None:
        # Empty-but-valid envelope — frontend hydrates an empty inventory.
        return standard_response(
            200,
            "Surface map not yet saved",
            {
                "assessment_id": assessment_id,
                "image_id": image_id,
                "surface_map": {
                    "components": [],
                    "trust_boundaries": [],
                    "environments": [],
                    "mermaid": None,
                },
                "created_at": None,
                "updated_at": None,
            },
        )
    return standard_response(200, "Surface map fetched", _serialize_surface_map(row))


@threat_model_router.put("/{assessment_id}/surface-map/{image_id}", dependencies=[Depends(require_assessment_owner)])
def upsert_surface_map_endpoint(
    assessment_id: str,
    image_id: str,
    payload: SurfaceMapPayload,
    db: Session = Depends(get_db),
):
    """Replace the persisted Surface Discovery inventory for one image."""
    if not _assessment_exists(db, assessment_id):
        return standard_response(404, "Assessment not found", {})

    try:
        row = surface_map_crud.upsert_surface_map(db, assessment_id, image_id, payload)
    except Exception as e:
        logger.exception("Failed to upsert surface map for %s/%s", assessment_id, image_id)
        return standard_response(500, f"Failed to save surface map: {e}", {})

    return standard_response(200, "Surface map saved", _serialize_surface_map(row))


@threat_model_router.delete("/{assessment_id}/surface-map/{image_id}")
def delete_surface_map_endpoint(
    assessment_id: str,
    image_id: str,
    db: Session = Depends(get_db),
):
    """Remove any persisted Surface Discovery inventory for one image."""
    if not _assessment_exists(db, assessment_id):
        return standard_response(404, "Assessment not found", {})

    deleted = surface_map_crud.delete_surface_map(db, assessment_id, image_id)
    if not deleted:
        return standard_response(404, "Surface map not found", {})
    return standard_response(200, "Surface map deleted", {
        "assessment_id": assessment_id, "image_id": image_id,
    })


@threat_model_router.post("/{assessment_id}/surface-map/{image_id}/generate", dependencies=[Depends(require_assessment_owner)])
def generate_surface_map_endpoint(
    assessment_id: str,
    image_id: str,
    save: bool = True,
    overwrite: bool = False,
    use_image: bool = False,
    db: Session = Depends(get_db),
):
    """AI-generate the Surface Discovery inventory for one diagram.

    The skill is **Mermaid-first**: structural extraction (components,
    environments, cross-zone boundaries) is driven by parsing the Mermaid
    source stored alongside this image. The rendered image is only sent
    when ``use_image=true`` (supplementary visual cues).

    Query params:
        save:      persist the generated payload via upsert (default True).
        overwrite: when False (default), the call is a no-op if a saved
                   surface map already exists for this image — the saved
                   one is returned. Set True to regenerate.
        use_image: when True, also attach the rendered image to the LLM
                   call. Default False (Mermaid-only, faster + cheaper +
                   no vision drift).
    """
    if not _assessment_exists(db, assessment_id):
        return standard_response(404, "Assessment not found", {})

    analysis = (
        db.query(DocumentAnalysis)
        .filter_by(assessment_id=assessment_id, image_id=image_id)
        .first()
    )
    if not analysis:
        return standard_response(404, "No analysis record for this assessment / image_id", {})

    mermaid_context = ""
    if isinstance(analysis.flow_diagram, dict):
        mermaid_context = analysis.flow_diagram.get("mermaid", "") or ""

    if not (mermaid_context or "").strip() and not (use_image and analysis.image_path):
        return standard_response(
            422,
            "Cannot run surface discovery: no Mermaid source on file for this image. "
            "Run the Diagram Scan stage first, or call again with use_image=true.",
            {},
        )

    if not overwrite:
        existing = surface_map_crud.get_surface_map(db, assessment_id, image_id)
        if existing is not None and existing.surface_map:
            current = existing.surface_map or {}
            if current.get("components") or current.get("environments"):
                return standard_response(
                    200,
                    "Surface map already exists — pass overwrite=true to regenerate",
                    _serialize_surface_map(existing),
                )

    # Local import to avoid pulling LLM stack into module import time.
    from blanc.core.document_analysis import surface_discovery

    diagram_type = analysis.diagram_type or "flowchart TD"
    # If the stored diagram_type disagrees with what the actual mermaid
    # source declares (e.g. assessment was created with the default
    # ``flowchart TD`` but the user pasted a sequenceDiagram), trust the
    # mermaid header — the surface_discovery skill keys all its
    # extraction rules off this value.
    if mermaid_context:
        first_line = next(
            (ln.strip() for ln in mermaid_context.splitlines() if ln.strip()),
            "",
        )
        for known in ("sequenceDiagram", "C4Context", "C4Container", "C4Component", "classDiagram", "stateDiagram", "erDiagram"):
            if first_line.startswith(known):
                diagram_type = known
                break
        else:
            if first_line.startswith(("flowchart", "graph")):
                diagram_type = first_line.split()[0] + (" " + first_line.split()[1] if len(first_line.split()) > 1 else "")

    try:
        generated = surface_discovery(
            image_path=(analysis.image_path if use_image else None),
            diagram_type=diagram_type,
            mermaid_context=mermaid_context,
            assessment_id=assessment_id,
        )
    except Exception as e:
        logger.exception("surface_discovery failed for %s/%s", assessment_id, image_id)
        return standard_response(500, f"Surface discovery failed: {e}", {})

    # Preserve any mermaid already on file when persisting.
    if mermaid_context and not generated.get("mermaid"):
        generated["mermaid"] = mermaid_context

    if not save:
        return standard_response(200, "Surface map generated", {
            "assessment_id": assessment_id,
            "image_id": image_id,
            "surface_map": generated,
        })

    try:
        payload = SurfaceMapPayload.model_validate(generated)
        row = surface_map_crud.upsert_surface_map(db, assessment_id, image_id, payload)
    except Exception as e:
        logger.exception("Failed to persist generated surface map for %s/%s", assessment_id, image_id)
        return standard_response(500, f"Failed to save generated surface map: {e}", {})

    return standard_response(200, "Surface map generated and saved", _serialize_surface_map(row))
