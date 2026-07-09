from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func

from blanc.db.database import get_db
from blanc.utils import standard_response
from blanc.core.auth.auth import get_current_user, require_assessment_owner, require_roles
from blanc.db_models.models import LLMUsage, Assessment

llm_usage_router = APIRouter(
    prefix="/llm-usage",
    tags=["LLM Usage"],
    dependencies=[Depends(require_roles(["USER", "ADMIN"]))],
)


@llm_usage_router.get("/{assessment_id}", dependencies=[Depends(require_assessment_owner)])
def get_assessment_llm_usage(
    assessment_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Returns total LLM cost and tokens for an assessment,
    including all retries and pipeline re-runs.
    Also returns per-call_type breakdown.
    """
    assessment = db.query(Assessment).filter_by(assessment_id=assessment_id).first()
    if not assessment:
        return standard_response(404, "Assessment not found", {})

    # Totals across all calls (including retries)
    totals = (
        db.query(
            sql_func.count(LLMUsage.id).label("total_calls"),
            sql_func.coalesce(sql_func.sum(LLMUsage.input_tokens), 0).label("total_input_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.output_tokens), 0).label("total_output_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.total_tokens), 0).label("total_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.tokens_billed), 0).label("total_tokens_billed"),
            sql_func.coalesce(sql_func.sum(LLMUsage.estimated_cost), 0).label("total_cost"),
            sql_func.coalesce(sql_func.sum(LLMUsage.duration_ms), 0).label("total_duration_ms"),
        )
        .filter(LLMUsage.assessment_id == assessment_id)
        .first()
    )

    # Breakdown by call_type + model
    breakdown_rows = (
        db.query(
            LLMUsage.call_type,
            LLMUsage.model,
            sql_func.count(LLMUsage.id).label("call_count"),
            sql_func.coalesce(sql_func.sum(LLMUsage.input_tokens), 0).label("input_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.output_tokens), 0).label("output_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.tokens_billed), 0).label("tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.estimated_cost), 0).label("cost"),
            sql_func.coalesce(sql_func.sum(LLMUsage.duration_ms), 0).label("duration_ms"),
        )
        .filter(LLMUsage.assessment_id == assessment_id)
        .group_by(LLMUsage.call_type, LLMUsage.model)
        .all()
    )

    breakdown = [
        {
            "call_type": row.call_type,
            "model": row.model,
            "call_count": row.call_count,
            "input_tokens": int(row.input_tokens),
            "output_tokens": int(row.output_tokens),
            "tokens": int(row.tokens),
            "cost": float(row.cost),
            "duration_ms": int(row.duration_ms),
        }
        for row in breakdown_rows
    ]

    return standard_response(200, "LLM usage fetched successfully", {
        "assessment_id": assessment_id,
        "total_calls": totals.total_calls,
        "total_input_tokens": int(totals.total_input_tokens),
        "total_output_tokens": int(totals.total_output_tokens),
        "total_tokens": int(totals.total_tokens),
        "total_tokens_billed": int(totals.total_tokens_billed),
        "total_estimated_cost": float(totals.total_cost),
        "total_duration_ms": int(totals.total_duration_ms),
        "breakdown": breakdown,
    })


@llm_usage_router.get("/")
def get_all_llm_usage(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Aggregated LLM usage across all assessments for the current user,
    including retries. Grouped per assessment with grand totals.
    """
    rows = (
        db.query(
            LLMUsage.assessment_id,
            sql_func.count(LLMUsage.id).label("total_calls"),
            sql_func.coalesce(sql_func.sum(LLMUsage.input_tokens), 0).label("total_input_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.output_tokens), 0).label("total_output_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.tokens_billed), 0).label("total_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.estimated_cost), 0).label("total_cost"),
            sql_func.coalesce(sql_func.sum(LLMUsage.duration_ms), 0).label("total_duration_ms"),
        )
        .join(Assessment, Assessment.assessment_id == LLMUsage.assessment_id)
        .filter(Assessment.user_id == current_user.userId)
        .group_by(LLMUsage.assessment_id)
        .offset(skip)
        .limit(limit)
        .all()
    )

    grand = (
        db.query(
            sql_func.coalesce(sql_func.sum(LLMUsage.input_tokens), 0).label("total_input_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.output_tokens), 0).label("total_output_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.tokens_billed), 0).label("total_tokens"),
            sql_func.coalesce(sql_func.sum(LLMUsage.estimated_cost), 0).label("total_cost"),
        )
        .join(Assessment, Assessment.assessment_id == LLMUsage.assessment_id)
        .filter(Assessment.user_id == current_user.userId)
        .first()
    )

    assessments = [
        {
            "assessment_id": row.assessment_id,
            "total_calls": row.total_calls,
            "total_input_tokens": int(row.total_input_tokens),
            "total_output_tokens": int(row.total_output_tokens),
            "total_tokens_billed": int(row.total_tokens),
            "total_estimated_cost": float(row.total_cost),
            "total_duration_ms": int(row.total_duration_ms),
        }
        for row in rows
    ]

    return standard_response(200, "LLM usage summary fetched successfully", {
        "grand_total_input_tokens": int(grand.total_input_tokens),
        "grand_total_output_tokens": int(grand.total_output_tokens),
        "grand_total_tokens_billed": int(grand.total_tokens),
        "grand_total_estimated_cost": float(grand.total_cost),
        "assessments": assessments,
    })
