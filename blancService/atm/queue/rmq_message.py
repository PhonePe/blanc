import json
from enum import Enum
from typing import Optional


class TaskType(str, Enum):
    """All background task types routed through RMQ."""
    IMAGE_ANALYSIS_PHASE_A = "IMAGE_ANALYSIS_PHASE_A"  # image → mermaid → components
    IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID = "IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID"  # skip image→mermaid; caller supplied mermaid text (ATM Studio flow)
    IMAGE_ANALYSIS_PHASE_B = "IMAGE_ANALYSIS_PHASE_B"  # summary + clarification
    PDF_INGESTION = "PDF_INGESTION"
    THREAT_MODELING = "THREAT_MODELING"


class RMQMessage:
    """
    Structured RMQ message using JSON.
    Every message has a task_type + assessment_id, plus task-specific fields.
    """

    def __init__(
        self,
        task_type: str,
        assessment_id: str,
        image_id: Optional[str] = None,
        image_path: Optional[str] = None,
        pdf_path: Optional[str] = None,
        filename: Optional[str] = None,
        diagram_type: Optional[str] = None,
        mermaid_text: Optional[str] = None,
        retry_count: int = 0,
    ):
        self.task_type = task_type
        self.assessment_id = assessment_id
        self.image_id = image_id
        self.image_path = image_path
        self.pdf_path = pdf_path
        self.filename = filename
        self.diagram_type = diagram_type
        self.mermaid_text = mermaid_text
        self.retry_count = retry_count

    def to_bytes(self) -> bytes:
        payload = {
            "task_type": self.task_type,
            "assessment_id": self.assessment_id,
        }
        if self.image_id:
            payload["image_id"] = self.image_id
        if self.image_path:
            payload["image_path"] = self.image_path
        if self.diagram_type:
            payload["diagram_type"] = self.diagram_type
        if self.pdf_path:
            payload["pdf_path"] = self.pdf_path
        if self.filename:
            payload["filename"] = self.filename
        if self.mermaid_text:
            payload["mermaid_text"] = self.mermaid_text
        if self.retry_count:
            payload["retry_count"] = self.retry_count
        return json.dumps(payload).encode("utf-8")

    @staticmethod
    def from_bytes(body: bytes) -> "RMQMessage":
        data = json.loads(body.decode("utf-8"))
        return RMQMessage(
            task_type=data["task_type"],
            assessment_id=data["assessment_id"],
            image_id=data.get("image_id"),
            image_path=data.get("image_path"),
            pdf_path=data.get("pdf_path"),
            filename=data.get("filename"),
            diagram_type=data.get("diagram_type"),
            mermaid_text=data.get("mermaid_text"),
            retry_count=data.get("retry_count", 0),
        )
