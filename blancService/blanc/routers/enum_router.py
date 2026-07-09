from fastapi import APIRouter
from blanc.domain.enums import (
    AssessmentStage,
    AssessmentState,
    AssessmentType,
    Framework,
)

router = APIRouter(prefix="/api/v1/enums", tags=["Enums"])

@router.get("/frameworks")
async def get_frameworks():
    """Returns all available frameworks"""
    return {
        "types": [
            {
                # "key": item.name,
                "value": item.value,
                # "label": item.name.replace("_", " ").title()
            }
            for item in Framework
        ]
    }

@router.get("/assessment-types")
async def get_assessment_types():
    """Returns all available assessment types"""
    return {
        "types": [
            {
                "key": item.name,
                "value": item.value,
                "label": item.name.replace("_", " ").title()
            }
            for item in AssessmentType
        ]
    }

@router.get("/all-enums")
async def get_all_enums():
    """Returns all enums at once"""
    return {
        "assessmentTypes": [item.value for item in AssessmentType],
        "frameworks": [item.value for item in Framework],
        "assessmentStates": [item.value for item in AssessmentState],
        "assessmentStages": [item.value for item in AssessmentStage],
    }