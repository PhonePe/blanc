import enum
from datetime import datetime
from decimal import Decimal
from typing import Optional, Type

from sqlalchemy import Column, String, Boolean, Enum, TIMESTAMP, ForeignKey, Integer, Numeric, Float, Text, VARCHAR
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.types import TypeDecorator

from atm.db.database import Base


class EnumAsString(TypeDecorator):
    """Store a Python ``enum.Enum`` as a plain VARCHAR under the hood.

    Native ``sqlalchemy.Enum`` maps to MariaDB ``ENUM(...)`` which bakes
    the value set into the column at CREATE TABLE. Every time we grow the
    Python enum (e.g. adding ``AWAITING_REVIEW``), the DB column is
    silently stale and the next UPDATE returns "Data truncated for
    column 'state'". Using a plain VARCHAR sidesteps that entirely —
    the Python enum is the single source of truth and new values just
    work.

    Reads come back as the enum member so existing ``.state.value``,
    ``.state == AssessmentState.FAILED``, and set-membership calls
    keep working with zero call-site changes.
    """

    impl = VARCHAR
    cache_ok = True

    def __init__(self, enum_class: Type[enum.Enum], length: int = 32):
        super().__init__(length=length)
        self._enum = enum_class

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, self._enum):
            return value.value
        # Accept raw strings too (retry / migration paths use them).
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        try:
            return self._enum(value)
        except ValueError:
            # Row was written by an older release that stored an
            # unknown value — return it verbatim rather than blowing up.
            return value

    def copy(self, **kw):
        return EnumAsString(self._enum, length=self.impl.length)

class AssessmentState(enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    AWAITING_REVIEW = "AWAITING_REVIEW"  # Phase A done (mermaid + components), waiting for user Next
    NEEDS_INPUT = "NEEDS_INPUT"   # For Clarification
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    REVIEW = "REVIEW"
    APPROVED = "APPROVED"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"  # Reviewer rejected

class AssessmentStage(enum.Enum):
    INITIALIZING = "INITIALIZING"
    IMAGE_PROCESSING = "IMAGE_PROCESSING"
    SUMMARIZING = "SUMMARIZING"
    COMPONENT_ANALYSIS = "COMPONENT_ANALYSIS"
    CLARIFICATION = "CLARIFICATION" 
    THREAT_MODELING = "THREAT_MODELING"

class ReviewStatus(enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"

class AssessmentReviewer(Base):
    __tablename__ = "assessment_reviewers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    assessment_id = Column(String(255), ForeignKey('assessment.assessment_id'), nullable=False)
    reviewer_id = Column(String(255), ForeignKey('user.userId'), nullable=False)
    
    status = Column(EnumAsString(ReviewStatus), default=ReviewStatus.PENDING, nullable=False)
    comment = Column(Text, nullable=True)
    reviewed_at = Column(TIMESTAMP, nullable=True, onupdate=func.now())

    # Relationships
    assessment = relationship("Assessment", back_populates="reviewers")
    reviewer = relationship("User")

class User(Base):
    __tablename__ = "user"

    userId = Column(String(255), primary_key=True, index=True)
    email = Column(String(255), nullable=False)
    password = Column(String(255), nullable=False)  # <-- hashed password
    name = Column(String(255), nullable=True)
    role = Column(Enum('ADMIN', 'SUPERADMIN', 'USER'), nullable=True)  # assuming 'object' can be stored as JSON
    isActive = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP, nullable=False, default=func.now())
    updated_at = Column(TIMESTAMP, nullable=True, default=func.now(), onupdate=func.now())
    # org_id = Column(String(255), ForeignKey('org.id'), nullable=True)  # Added orgId field
    # org = relationship("Org", backref="users")
    assessments = relationship("Assessment", back_populates="user", foreign_keys="[Assessment.user_id]")


class Assessment(Base):
    __tablename__ = "assessment"

    assessment_id = Column(String(255), primary_key=True, index=True)
    assessment_type = Column(Enum('SECURITY', 'COMPLIANCE'), nullable=True)  # replace with actual types
    framework = Column(String(50), nullable=False, index=True)
    team = Column(String(255), nullable=True)
    app_name = Column(String(255), nullable=True)
    org_name = Column(String(255), nullable=True)
    interface = Column(String(255), nullable=True)
    operating_system = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)
    

    # See EnumAsString for the rationale — VARCHAR under the hood, enum
    # on read/write.
    state = Column(EnumAsString(AssessmentState), default=AssessmentState.PENDING, nullable=False)
    stage = Column(EnumAsString(AssessmentStage), default=AssessmentStage.INITIALIZING, nullable=False)
    feature_name = Column(String(255), nullable=True)
    feature_version = Column(String(255), nullable=True)
    user_id = Column(String(255), ForeignKey('user.userId'))
    approved_by = Column(String(255), ForeignKey('user.userId'), nullable=True)
    approved_comment = Column(Text, nullable=True)
    approved_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, nullable=False, default=func.now())
    updated_at = Column(TIMESTAMP, nullable=True, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="assessments", foreign_keys=[user_id])
    approver = relationship("User", foreign_keys=[approved_by])
    documents = relationship("AssessmentDocument", back_populates="assessment")
    analysis = relationship("DocumentAnalysis", back_populates="assessment")
    results = relationship("AssessmentResults", back_populates="assessment")
    reviewers = relationship("AssessmentReviewer", back_populates="assessment", cascade="all, delete-orphan")


class AssessmentDocument(Base):
    __tablename__ = "assessment_documents"

    assessment_id = Column(String(255), ForeignKey('assessment.assessment_id'), primary_key=True)
    document_type = Column(String(255), primary_key=True)
    document_id = Column(String(255), primary_key=True)
    client = Column(String(255), nullable=True)
    meta = Column(JSON, nullable=True)

    assessment = relationship("Assessment", back_populates="documents")


class DocumentAnalysis(Base):
    __tablename__ = "document_analysis"

    assessment_id = Column(String(255), ForeignKey('assessment.assessment_id'), primary_key=True)
    image_id = Column(String(255), primary_key=True)  # UUID per image
    image_path = Column(String(512), nullable=True)
    diagram_type = Column(String(50), nullable=True, default="flowchart TD")
    state = Column(EnumAsString(AssessmentState), default=AssessmentState.PENDING, nullable=False)
    stage = Column(EnumAsString(AssessmentStage), default=AssessmentStage.INITIALIZING, nullable=False)
    error_message = Column(Text, nullable=True)
    flow_diagram = Column(JSON, nullable=True)
    analysis_summary = Column(JSON, nullable=True)
    component_details = Column(JSON, nullable=True)
    clarification = Column(JSON, nullable=True)
    created_at = Column(TIMESTAMP, nullable=False, default=func.now())

    assessment = relationship("Assessment", back_populates="analysis")


class AssessmentResults(Base):
    __tablename__ = "assessment_results"

    id = Column(Integer, primary_key=True, autoincrement=True)  # NEW primary key
    assessment_id = Column(String(255), ForeignKey('assessment.assessment_id'))
    image_id = Column(String(255), nullable=True)  # Traces threat back to source image
    category = Column(String(255), nullable=True)
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    component_affected = Column(String(255), nullable=True)
    attack_vector = Column(String(255), nullable=True)
    mitigations = Column(Text, nullable=True)
    severity = Column(String(255), nullable=True)
    likelihood = Column(String(255), nullable=True)
    risk = Column(String(255), nullable=True)
    detection = Column(String(255), nullable=True)
    state = Column(String(255), nullable=True)
    review_status = Column(String(50), nullable=True)  # APPROVED / REJECTED / None
    review_comment = Column(Text, nullable=True)
    reviewed_by = Column(String(255), ForeignKey('user.userId'), nullable=True)
    reviewed_at = Column(TIMESTAMP, nullable=True)

    assessment = relationship("Assessment", back_populates="results")


class LLMUsage(Base):
    __tablename__ = "llm_usage"

    id = Column(Integer, primary_key=True, autoincrement=True)
    assessment_id = Column(String(255), ForeignKey('assessment.assessment_id'), nullable=True, index=True)
    call_type = Column(String(50), nullable=False)
    model = Column(String(100), nullable=False)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    tokens_billed = Column(Integer, default=0)
    estimated_cost = Column(Float, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP, nullable=False, default=func.now())

    assessment = relationship("Assessment")


class Category(Base):
    __tablename__ = "category"

    id = Column(String(255), primary_key=True)
    name = Column(String(255), nullable=False)
    entity_type = Column(Enum('APP', 'ORG'), nullable=False)
    order = Column(Numeric, nullable=True)  # Optional decimal for ordering


class Question(Base):
    __tablename__ = "question"

    id = Column(String(255), primary_key=True)
    question = Column(String(255), nullable=False)
    options = Column(String(255), nullable=True)
    entity_type = Column(Enum('APP', 'ORG'), nullable=False)
    category_id = Column(String(255), ForeignKey('category.id'))

    # category = relationship("Category", backref="questions")

class Org(Base):
    entity_type = None
    __tablename__ = "org"

    id = Column(String(255), primary_key=True)
    name = Column(String(255), nullable=False)
    status = Column(Enum('PENDING', 'IN_PROGRESS', 'COMPLETED'), nullable=False)


class OrganizationResponse(Base):
    __tablename__ = "organization_response"

    id = Column(String(255), primary_key=True)
    org_id = Column(String(255), ForeignKey('org.id'))
    question_id = Column(String(255), ForeignKey('question.id'))
    response = Column(Text, nullable=True)

    # org = relationship("Org", backref="responses")
    # question = relationship("Question", backref="responses")


class OnboardingProgress(Base):
    __tablename__ = "onboarding_progress"

    id = Column(String(255), primary_key=True)
    org_id = Column(String(255), ForeignKey('org.id'))
    entity_type = Column(Enum('APP', 'ORG'), nullable=False)
    entity_id = Column(String(255), nullable=False)
    category_id = Column(String(255), ForeignKey('category.id'))
    status = Column(Enum('PENDING', 'IN_PROGRESS', 'COMPLETED'), nullable=False)

    org = relationship("Org", backref="onboarding_progress")
    category = relationship("Category", backref="onboarding_progress")


class App(Base):
    __tablename__ = "app"

    id = Column(String(255), primary_key=True)
    name = Column(String(255), nullable=False)
    org_id = Column(String(255), ForeignKey('org.id'))
    status = Column(Enum('PENDING', 'IN_PROGRESS', 'COMPLETED'), nullable=False)

    org = relationship("Org", backref="apps")


class ApplicationResponse(Base):
    __tablename__ = "application_response"

    id = Column(String(255), primary_key=True)
    app_id = Column(String(255), ForeignKey('app.id'))
    question_id = Column(String(255), ForeignKey('question.id'))
    response = Column(Text, nullable=True)

    app = relationship("App", backref="responses")
    question = relationship("Question", backref="responses")


class SurfaceMap(Base):
    """
    Per-image Surface Discovery inventory (components / trust boundaries /
    environments) edited inside the ThreatModeller Inventory UI.
    One row per (assessment_id, image_id). Stored as a single JSON blob to
    keep schema evolution painless as the frontend taxonomy grows.
    """
    __tablename__ = "surface_map"

    assessment_id = Column(String(255), ForeignKey('assessment.assessment_id'), primary_key=True)
    image_id = Column(String(255), primary_key=True)
    surface_map = Column(JSON, nullable=False)
    # Python-side defaults on purpose. Server-side `now()` combined with
    # SQLAlchemy 2.x's `INSERT ... RETURNING` blew up on MariaDB with
    # "Record has changed since last read" — MariaDB truncates TIMESTAMP
    # to seconds while SQLAlchemy expected microsecond parity on read-back.
    created_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow)
    updated_at = Column(TIMESTAMP, nullable=True, default=datetime.utcnow, onupdate=datetime.utcnow)

