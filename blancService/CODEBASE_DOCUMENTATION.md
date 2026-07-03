# ATM Service — Complete Codebase Documentation

> **Automated Threat Modeling (ATM)** — A FastAPI-based service that automates security threat modeling using LLM-powered analysis of architecture diagrams. It supports multiple threat frameworks (STRIDE, LINDDUN, DREAD, PASTA, BUSINESS_LOGIC), RAG-enhanced clarification, multi-image assessments, and a full review/approval workflow.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Entry Point — main.py](#4-entry-point--mainpy)
5. [Configuration](#5-configuration)
6. [Database Models](#6-database-models)
7. [API Schemas (Pydantic)](#7-api-schemas-pydantic)
8. [API Endpoints (Routers)](#8-api-endpoints-routers)
9. [Services (Business Logic)](#9-services-business-logic)
10. [Core Processing Pipeline](#10-core-processing-pipeline)
11. [State Machine](#11-state-machine)
12. [Message Queue (RabbitMQ)](#12-message-queue-rabbitmq)
13. [LLM Integration](#13-llm-integration)
14. [RAG (Retrieval-Augmented Generation)](#14-rag-retrieval-augmented-generation)
15. [Authentication & Authorization](#15-authentication--authorization)
16. [CRUD Operations](#16-crud-operations)
17. [Prompt Templates](#17-prompt-templates)
18. [Utilities](#18-utilities)
19. [End-to-End Flow](#19-end-to-end-flow)
20. [Deployment](#20-deployment)
21. [Dependencies](#21-dependencies)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FastAPI Application                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Routers │→ │ Services │→ │   CRUD   │→ │  MariaDB (ORM)   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘   │
│       │                                                            │
│       ▼                                                            │
│  ┌──────────────┐     ┌────────────────┐    ┌──────────────────┐   │
│  │  RMQ Producer │────→│  RMQ Consumer  │───→│  Core Pipeline   │   │
│  └──────────────┘     └────────────────┘    │  (LLM + RAG)     │   │
│                                             └──────────────────┘   │
│                                                    │               │
│                              ┌─────────────────────┼───────────┐   │
│                              ▼                     ▼           ▼   │
│                        ┌──────────┐      ┌───────────┐  ┌───────┐ │
│                        │ OpenAI   │      │ Vector DB │  │DocGPT │ │
│                        │ (GPT-5)  │      │  (RAG)    │  │       │ │
│                        └──────────┘      └───────────┘  └───────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Request Flow Summary

1. **Assessment Creation** → User uploads architecture diagram images + optional PDFs → Saved to DB → IMAGE_ANALYSIS tasks published to RabbitMQ
2. **Image Analysis** (per-image, parallel) → RMQ consumer picks up → 6-stage LLM pipeline → Mermaid diagram, summary, components, clarification questions → State derived from all images
3. **Clarification** → If questions exist, user answers (or auto-answer via RAG) → State transitions to COMPLETED
4. **Threat Modeling** → User triggers → Assessment-level RMQ task → Multi-framework threat generation using merged image data → Results stored
5. **Review** → Reviewers assigned → Approve/reject workflow → Final state: APPROVED or CHANGES_REQUESTED

---

## 2. Technology Stack

| Category | Technology | Version |
|---|---|---|
| **Web Framework** | FastAPI | 0.121.0 |
| **ASGI Server** | Uvicorn | 0.40.0 |
| **Database** | MariaDB + SQLAlchemy ORM | SQLAlchemy 2.0.43, mariadb 1.1.14 |
| **Message Queue** | RabbitMQ via aio-pika | 9.5.7 |
| **LLM** | OpenAI GPT (GPT-5 STG) | openai 1.108.1 |
| **PDF Processing** | PyMuPDF, python-docx, fpdf2 | PyMuPDF 1.23.8 |
| **Authentication** | Google OAuth2 + JWT | PyJWT 2.11.0, google-auth 2.48.0 |
| **Password Hashing** | Argon2 via passlib | passlib 1.7.4 |
| **Text Chunking** | LangChain Text Splitters | langchain-text-splitters 0.3.11 |
| **Validation** | Pydantic v2 | 2.11.9 |
| **Logging** | colorlog | 6.9.0 |
| **HTTP Client** | httpx, requests | httpx 0.28.1, requests 2.32.5 |

---

## 3. Project Structure

```
blancService/
├── main.py                          # FastAPI entry point
├── Dockerfile                       # Container build config
├── requirements.txt                 # Python dependencies
├── README.md                        # (Empty placeholder)
├── STATE_FLOW.md                    # State machine documentation
├── uploads/                         # Uploaded files (images, PDFs)
│
├── atm/                             # Main application package
│   ├── __init__.py
│   ├── schemas.py                   # Standard API response model
│   ├── utils.py                     # Response helpers
│   │
│   ├── api_schemas/                 # Pydantic request/response models
│   │   └── api_v1/
│   │       ├── ai_response.py       # Threat modeling response schemas (all frameworks)
│   │       ├── app.py               # Application onboarding schemas
│   │       ├── app_onboarding.py    # Re-exports from onboarding
│   │       ├── assessment.py        # Assessment schemas + enums
│   │       ├── auth_schema.py       # Auth schemas (user, token)
│   │       ├── onboarding.py        # Org/app onboarding schemas
│   │       ├── org.py               # Organization schemas
│   │       ├── rag.py               # RAG search/ingest schemas
│   │       ├── reviewer.py          # Review workflow schemas
│   │       └── threat_modeling_schema.py  # (Empty, schemas in ai_response.py)
│   │
│   ├── config/
│   │   └── local.yml                # Local dev configuration
│   │
│   ├── config_parsers/              # Configuration management
│   │   ├── config_client.py         # Singleton config provider
│   │   ├── config_models.py         # Pydantic config models
│   │   └── log_utils.py             # Logging setup
│   │
│   ├── core/                        # Core business logic & pipelines
│   │   ├── document_analysis.py     # Per-image LLM analysis pipeline
│   │   ├── state_machine.py         # State transition validation
│   │   ├── stride_service.py        # Legacy STRIDE-only threat modeling
│   │   ├── threat_modeling.py       # Multi-framework threat modeling (NEW)
│   │   ├── auth/
│   │   │   └── auth.py              # JWT + OAuth2 auth logic
│   │   ├── llm_client/
│   │   │   └── gpt_llm.py           # OpenAI LLM abstraction + usage tracking
│   │   └── rag_client/
│   │       ├── chunker.py           # PDF text chunking for ingestion
│   │       ├── extractor.py         # PDF text + image extraction
│   │       └── vector_db.py         # Vector DB client (ingest + search)
│   │
│   ├── crud/                        # Database CRUD operations
│   │   ├── assessment_crud.py       # Assessment, DocumentAnalysis, threats
│   │   └── application_crud.py      # Apps, onboarding, questions, progress
│   │
│   ├── db/                          # Database connection
│   │   └── database.py              # SQLAlchemy engine + session factory
│   │
│   ├── db_models/                   # ORM models
│   │   └── models.py                # All SQLAlchemy table definitions
│   │
│   ├── prompt/
│   │   └── prompt.py                # LLM prompt templates
│   │
│   ├── queue/                       # RabbitMQ integration
│   │   ├── cancelable_thread_pool_exectuor.py  # Custom thread pool
│   │   ├── consumer.py              # Async RMQ consumer with retry/DLQ
│   │   ├── message_processing.py    # Task dispatcher + handlers
│   │   ├── producer.py              # Async RMQ producer with fallback
│   │   ├── rmq_message.py           # Message format + task types
│   │   └── threaded_consumer_wrapper.py  # Multi-threaded consumer orchestration
│   │
│   ├── routers/                     # API endpoint definitions
│   │   ├── app_router.py            # App CRUD endpoints
│   │   ├── application_router.py    # App onboarding endpoints
│   │   ├── assessment_router.py     # Assessment lifecycle endpoints
│   │   ├── auth_router.py           # Auth endpoints (Google OAuth + JWT)
│   │   ├── enum_router.py           # Enum value endpoints
│   │   ├── health_check_router.py   # Health check
│   │   ├── llm_usage_router.py      # LLM usage tracking
│   │   ├── onboarding_router.py     # Org onboarding endpoints
│   │   ├── org_router.py            # Organization CRUD
│   │   ├── question_router.py       # Question/category management
│   │   ├── rag_router.py            # RAG ingest + search endpoints
│   │   ├── reviews.py               # Review workflow endpoints
│   │   └── threat_modeling_router.py # Threat modeling lifecycle
│   │
│   ├── services/                    # Business logic layer
│   │   ├── application_service.py   # App onboarding logic
│   │   ├── assessment_service.py    # Assessment lifecycle logic
│   │   ├── auth_service.py          # Auth business logic
│   │   ├── onboarding_service.py    # Org onboarding logic
│   │   └── threat_modeling_service.py  # Threat modeling cleanup
│   │
│   └── util/                        # Shared utilities
│       ├── fastapi_event_emitter.py # App lifecycle management
│       └── managed_entity.py        # Abstract lifecycle interface
│
└── env/                             # Python virtual environment
```

---

## 4. Entry Point — main.py

**File:** `main.py`

### Responsibilities
- Initializes the FastAPI application
- Configures CORS middleware (allows all origins)
- Mounts `/uploads` as static file directory for serving uploaded documents
- Starts background RabbitMQ consumer threads via `ThreadedConsumerWrapper`
- Registers all 13 routers
- Runs **startup recovery** — scans for assessments stuck in PENDING/PROCESSING states and re-publishes their RMQ messages (handles server crashes)

### Registered Routers

| Router | Module |
|--------|--------|
| Assessment | `assessment_router` |
| Auth | `auth_router` |
| Organization | `org_router` |
| Questions | `question_router` |
| Onboarding | `onboarding_router` |
| App CRUD | `app_router` |
| App Onboarding | `application_router` |
| Threat Modeling | `threat_modeling_router` |
| Health Check | `health_check_router` |
| RAG | `rag_router` |
| Enums | `enum_router` |
| Reviews | `reviews` |
| LLM Usage | `llm_usage_router` |

### Startup Recovery Logic
```python
async def recover_stuck_tasks():
    # Scans for assessments/images stuck in PENDING or PROCESSING
    # Only recovers tasks updated within the last 24 hours
    # Re-publishes IMAGE_ANALYSIS and THREAT_MODELING RMQ messages
```

### Server Configuration
- Host: `0.0.0.0`, Port: `8000`
- Workers: 1 (configurable)
- Hot reload enabled in dev

---

## 5. Configuration

### 5.1 Config Provider (`config_parsers/config_client.py`)

Singleton pattern — loads config based on `ENV` environment variable:
- `local` → reads `atm/config/local.yml`
- `stage` → reads from stage config path
- unset/unknown → reads `atm/config/local.yml`

### 5.2 Config Models (`config_parsers/config_models.py`)

All models are Pydantic `BaseModel` subclasses:

| Model | Key Fields |
|-------|------------|
| `AppConfig` | Master config containing all sub-configs below |
| `FastApiConf` | `appHost`, `appPort`, `num_workers` |
| `OpenAIConfig` | `openai_url`, `model_name`, `provider`, `api_key` |
| `PricingConfig` | `prompt_cost_per_million`, `completion_cost_per_million` |
| `RAGConfig` | `namespace`, `collection_id`, `api_url`, `auth_token_env` |
| `GoogleAuthConfig` | `client_id`, `client_secret`, `redirect_uri`, `allowed_domain` |
| `JwtConfig` | `secret_key`, `algorithm`, `access_token_expire_minutes` |
| `DBConf` | `mariadbConnectionString`, `poolSize`, `poolRecycle`, `maxOverflow` |
| `RMQConf` | `hosts`, `port`, `username`, `password`, `queues[]` |

### 5.3 Local Configuration Summary (`config/local.yml`)

| Section | Value |
|---------|-------|
| FastAPI | `0.0.0.0:8000`, 1 worker |
| OpenAI | OpenAI-compatible endpoint and model configured in `openaiconfig` |
| Database | MariaDB at `localhost:3306/atm`, pool 100, recycle 300s |
| RabbitMQ | `localhost:5672`, guest/guest, queue "ATM" with concurrency 10 |
| JWT | HS256, 300-min expiry |
| Google Auth | Restricted to a configurable email domain (`google_auth.allowed_domain`) |
| RAG | Namespace `appsec`, collection `DC_APPSEC_ASSESSMENT_LOCAL` |
| Pricing | 30.0 $/M prompt tokens, 60.0 $/M completion tokens |

### 5.4 Logging (`config_parsers/log_utils.py`)

- `LoggingConfig.configure_logging()` — applies logging config from `AppConfig`
- Uses `colorlog.ColoredFormatter` with color-coded log levels
- Suppresses noisy loggers: `aio_pika`, `aiormq`, `httpx`, `httpcore`, `openai`

---

## 6. Database Models

**File:** `db_models/models.py`  
**Engine:** MariaDB via SQLAlchemy ORM  
**Session management:** `db/database.py` — provides `get_db()` (FastAPI dependency) and `get_db_session()` (context manager)

### 6.1 Enums

```python
class AssessmentState(str, Enum):
    PENDING, PROCESSING, NEEDS_INPUT, COMPLETED, FAILED, REVIEW, APPROVED, CHANGES_REQUESTED

class AssessmentStage(str, Enum):
    INITIALIZING, IMAGE_PROCESSING, SUMMARIZING, COMPONENT_ANALYSIS, CLARIFICATION, THREAT_MODELING

class ReviewStatus(str, Enum):
    PENDING, APPROVED, REJECTED
```

### 6.2 Tables

#### **User**
| Column | Type | Notes |
|--------|------|-------|
| userId | String (UUID, PK) | Auto-generated |
| email | String (unique) | |
| password | String (nullable) | Argon2-hashed; null for Google OAuth users |
| name | String | |
| role | Enum(ADMIN, SUPERADMIN, USER) | Default: USER |
| isActive | Boolean | Default: True |
| created_at | DateTime | Auto |
| updated_at | DateTime | Auto-updated |

#### **Assessment**
| Column | Type | Notes |
|--------|------|-------|
| assessment_id | String (UUID, PK) | Auto-generated |
| type | String | Assessment type (SECURITY, COMPLIANCE) |
| framework | String | Threat framework (STRIDE, PASTA, etc.) |
| team | String | |
| app_name | String | |
| org_name | String | |
| state | Enum(AssessmentState) | Default: PENDING |
| stage | Enum(AssessmentStage) | Default: INITIALIZING |
| error_message | Text (nullable) | |
| user_id | FK → User.userId | Creator |
| approved_by | FK → User.userId (nullable) | Approver |
| created_at / updated_at | DateTime | |

#### **DocumentAnalysis**
| Column | Type | Notes |
|--------|------|-------|
| assessment_id | String (PK, FK) | Composite PK with image_id |
| image_id | String (PK) | UUID per image |
| image_path | String | File system path to image |
| state | Enum(AssessmentState) | Per-image state |
| stage | Enum(AssessmentStage) | Per-image processing stage |
| error_message | Text (nullable) | |
| flow_diagram | JSON (nullable) | Mermaid diagram output |
| analysis_summary | JSON (nullable) | High-level summary |
| component_details | JSON (nullable) | Component breakdown |
| clarification | JSON (nullable) | Questions + answers |
| created_at | DateTime | |

#### **AssessmentDocument**
| Column | Type | Notes |
|--------|------|-------|
| assessment_id | String (PK) | Composite PK |
| document_type | String (PK) | e.g., "pdf", "supporting_doc" |
| document_id | String (PK) | UUID |
| client | String | |
| meta | JSON (nullable) | Additional metadata |

#### **AssessmentResults** (Threats)
| Column | Type | Notes |
|--------|------|-------|
| id | Integer (PK) | Auto-increment |
| assessment_id | FK → Assessment | |
| image_id | String (nullable) | Source image traceability |
| category | String | STRIDE category, LINDDUN type, etc. |
| title | String | Threat title |
| description | Text | Threat description |
| component_affected | String | |
| mitigations | Text | Recommended mitigations |
| severity | String | HIGH, MEDIUM, LOW |
| likelihood | String | |
| state | String | |
| review_status | String (nullable) | Per-threat review status |
| review_comment | Text (nullable) | |
| reviewed_by | FK → User (nullable) | |
| reviewed_at | DateTime (nullable) | |

#### **AssessmentReviewer**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer (PK) | Auto-increment |
| assessment_id | FK → Assessment | |
| reviewer_id | FK → User.userId | |
| status | Enum(ReviewStatus) | Default: PENDING |
| comment | Text (nullable) | |
| reviewed_at | DateTime (nullable) | |

#### **LLMUsage**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer (PK) | Auto-increment |
| assessment_id | FK → Assessment | |
| call_type | String | e.g., "mermaid", "summary", "stride_spoofing" |
| model | String | LLM model name |
| input_tokens | Integer | |
| output_tokens | Integer | |
| total_tokens | Integer | |
| tokens_billed | Integer | |
| estimated_cost | Float | Based on pricing config |
| duration_ms | Integer | |
| created_at | DateTime | |

#### **Category**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer (PK) | Auto-increment |
| name | String | Category display name |
| entity_type | String | "APP" or "ORG" |
| order | Integer | Display order |

#### **Question**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer (PK) | Auto-increment |
| question | Text | Question text |
| options | JSON (nullable) | Selectable options |
| entity_type | String | "APP" or "ORG" |
| category_id | FK → Category | |

#### **Org**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer (PK) | Auto-increment |
| name | String | Organization name |
| status | String | PENDING / IN_PROGRESS / COMPLETED |

#### **OrganizationResponse**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer (PK) | |
| org_id | FK → Org | |
| question_id | FK → Question | |
| response | Text | |

#### **OnboardingProgress**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer (PK) | |
| org_id | FK → Org | |
| entity_type | String | "APP" or "ORG" |
| entity_id | String | App or Org ID |
| category_id | FK → Category | |
| status | String | PENDING / IN_PROGRESS / COMPLETED |

#### **App**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer (PK) | |
| name | String | |
| org_id | FK → Org | |
| status | String | PENDING / IN_PROGRESS / COMPLETED |

#### **ApplicationResponse**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer (PK) | |
| app_id | FK → App | |
| question_id | FK → Question | |
| response | Text | |

---

## 7. API Schemas (Pydantic)

### 7.1 Standard Response (`schemas.py` + `utils.py`)

```python
class ResponseModel(BaseModel):
    status: str
    code: int
    message: str
    data: Any = None

def standard_response(status_code, message, data=None) -> JSONResponse
```

### 7.2 Assessment Schemas (`api_schemas/api_v1/assessment.py`)

**Enums:**
- `AssessmentType`: SECURITY, COMPLIANCE
- `Framework`: STRIDE, PASTA, BUSINESS_LOGIC, LINDDUN, DREAD
- `AssessmentState`: 8 states (mirrors DB enum)
- `AssessmentStage`: 6 stages (mirrors DB enum)
- `DiagramType`: ARCHITECTURE, SEQUENCE, DATA_FLOW, etc.

**Request Models:**
- `AssessmentCreate` — multipart form data with `as_form()` class method: `type`, `framework`, `team`, `app_name`, `org_name`, `diagram_type`

**Response Models:**
- `AssessmentResponse` — full assessment data
- `ClarificationQuestion` — question with options for user input
- `AnswerSubmission` — user's answers to clarification questions

### 7.3 Threat Modeling Schemas (`api_schemas/api_v1/ai_response.py`)

**Base Components:**
- `Component` — name, purpose, data_assets, trust_level
- `MermaidResponse`, `SummaryResponse`, `ComponentsResponse`, `QuestionsResponse`

**Framework-Specific Threat Models:**

| Framework | Pydantic Model | Key Fields |
|-----------|---------------|------------|
| STRIDE | `StrideThreatItem` | category (Spoofing/Tampering/Repudiation/Info Disclosure/DoS/Elevation), component_affected, threat, description, severity, likelihood, mitigations |
| PASTA | `PastaThreatItem` | Risk/business focused fields |
| DREAD | `DreadThreatItem` | Scoring dimensions (Damage/Reproducibility/Exploitability/Affected Users/Discoverability, each 0-10) |
| LINDDUN | `LinddunThreatItem` | Privacy threat categories (Linkability/Identifiability/Non-repudiation/Detectability/Disclosure of info/Unawareness/Non-compliance) |
| BUSINESS_LOGIC | `BusinessLogicThreatItem` | Business logic vulnerability fields |
| VAST | `VastThreatItem` | Application vs Operational threats |
| OCTAVE | `OctaveThreatItem` | Organizational/cyber-physical focus |
| TRIKE | `TrikeThreatItem` | CRUD actions with acceptable risk |

**Wrapper Response:**
- `ThreatModelAnalysis` — complete analysis combining all components

### 7.4 Auth Schemas (`api_schemas/api_v1/auth_schema.py`)
- `UserCreate` — email, password, name
- `UserOut` — userId, email, name, role
- `Token` — access_token, token_type

### 7.5 Review Schemas (`api_schemas/api_v1/reviewer.py`)
- `AssessmentReviewerBase`, `AssessmentReviewerRead`, `AssessmentRead`
- `ReviewSubmission` — status (APPROVED/REJECTED), comment

### 7.6 RAG Schemas (`api_schemas/api_v1/rag.py`)
- `SearchRequest` — query, environment filter, document_type filter, num_candidates, k
- `IngestResponse` — status, message, total_chunks, ignored_url

### 7.7 Onboarding Schemas (`api_schemas/api_v1/onboarding.py`)
- `OnboardingRequest` / `AppOnboardingRequest` — orgId/appId, category, responses[]
- `OnboardingProgressResponse` / `AppOnboardingProgressResponse` — progress per category

### 7.8 Organization Schemas (`api_schemas/api_v1/org.py`)
- `OrgCreate` — name

### 7.9 App Schemas (`api_schemas/api_v1/app.py`)
- `AppOnboardRequest` — name, org_id
- `AppOnboardResponse` — id, name, org_id, status

---

## 8. API Endpoints (Routers)

### 8.1 Assessment Router (`/assessment`)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/assessment/new` | Create assessment with images + optional PDFs | USER/ADMIN |
| `POST` | `/assessment/extract-pdf-images` | Extract images from PDF (base64 preview) | USER/ADMIN |
| `GET` | `/assessment/list` | List assessments with search/filters/pagination | USER/ADMIN |
| `DELETE` | `/assessment/{id}` | Delete assessment (cascading) | ADMIN |
| `GET` | `/assessment/{id}/progress` | Detailed progress with per-image data | USER/ADMIN |
| `GET` | `/assessment/{id}/status` | Lightweight state/stage polling | USER/ADMIN |
| `POST` | `/assessment/{id}/images/{img_id}/answer` | Submit clarification answers → COMPLETED | USER/ADMIN |
| `PUT` | `/assessment/{id}/images/{img_id}/save-answers` | Save draft answers (no state change) | USER/ADMIN |
| `POST` | `/assessment/{id}/answer` | Legacy: answer first NEEDS_INPUT image | USER/ADMIN |
| `POST` | `/assessment/{id}/retry-analysis` | Retry all failed images | USER/ADMIN |
| `POST` | `/assessment/{id}/images/{img_id}/retry` | Retry single failed image | USER/ADMIN |
| `POST` | `/assessment/{id}/images/{img_id}/auto-answer` | Auto-answer using RAG context | USER/ADMIN |

### 8.2 Auth Router (`/auth`)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/auth/google/login` | Redirect to Google OAuth consent screen | None |
| `GET` | `/auth/google/callback` | OAuth callback — issues local JWT | Google OAuth |
| `POST` | `/auth/register` | Register new user (email/password) | None |
| `POST` | `/auth/login` | Login with email/password | None |
| `GET` | `/auth/admin` | Admin check endpoint | ADMIN |
| `GET` | `/auth/profile` | Get current user profile | USER/ADMIN |

**Features:**
- Google OAuth2 with configurable email-domain restriction (`google_auth.allowed_domain`)
- JIT (Just-In-Time) provisioning: auto-creates users on first Google login
- Role assignment via `admin_users` config list

### 8.3 Threat Modeling Router (`/threat-model`)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/{id}/status` | Get current threat modeling state | USER/ADMIN |
| `POST` | `/{id}/start` | Initiate threat modeling → PROCESSING | USER/ADMIN |
| `GET` | `/{id}/results/by-image` | Get threats grouped per image | USER/ADMIN |
| `POST` | `/{id}/reanalyze` | Regenerate threats (clear + re-run) | USER/ADMIN |
| `GET` | `/{id}/export` | Export threats as CSV | USER/ADMIN |
| `GET` | `/{id}/usage` | Get LLM cost & token usage | USER/ADMIN |

### 8.4 Review Router (`/reviews`)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/assessments-under-review` | List assessments assigned to current reviewer | USER/ADMIN |
| `POST` | `/{id}/assign-reviewers` | Assign reviewers to assessment | USER/ADMIN |
| `GET` | `/reviewer-search` | Search users for reviewer assignment | USER/ADMIN |
| `GET` | `/{id}/reviewers` | Get assigned reviewers and status | USER/ADMIN |
| `POST` | `/{id}/submit-review` | Submit approval/rejection | USER/ADMIN |
| `POST` | `/{id}/approve` | Final single-reviewer approval | USER/ADMIN |
| `POST` | `/{id}/threats/{threat_id}/review` | Review individual threat | USER/ADMIN |
| `POST` | `/{id}/threats/bulk-review` | Bulk review multiple threats | USER/ADMIN |

### 8.5 RAG Router (`/rag`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/{namespace}/{collection}/ingest` | Ingest PDF into vector DB |
| `POST` | `/{namespace}/{collection}/search` | Search vector DB with filters |

### 8.6 Organization Router (`/org`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/org/new` | Create organization |
| `GET` | `/org/all` | List all organizations with pagination |

### 8.7 App Router (`/app`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/app/onboard` | Create app under organization |
| `GET` | `/app/all` | List all apps with pagination |

### 8.8 Application Onboarding Router (`/app`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/app/onboarding` | Save app onboarding responses |
| `GET` | `/app/onboarding/{app_id}` | Get app progress for all categories |
| `GET` | `/app/category/{cat_id}/name` | Get category name |

### 8.9 Onboarding Router (`/onboarding`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/onboarding` | Save org onboarding responses |
| `GET` | `/onboarding/{org_id}` | Get org progress |
| `GET` | `/category/{cat_id}/name` | Get category name |

### 8.10 Question Router (`/questions`)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/questions` | List questions by entity_type | USER/ADMIN |
| `GET` | `/questions/grouped` | Questions grouped by category | USER/ADMIN |
| `POST` | `/questions` | Create single question | ADMIN |
| `POST` | `/questions/bulk` | Bulk create questions | ADMIN |
| `GET` | `/categories` | List categories | USER/ADMIN |
| `POST` | `/categories` | Create category | ADMIN |
| `PUT` | `/categories/{id}` | Update category | ADMIN |
| `DELETE` | `/categories/{id}` | Delete category | ADMIN |

### 8.11 Enum Router (`/api/v1/enums`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/enums/frameworks` | List available threat frameworks |
| `GET` | `/api/v1/enums/assessment-types` | List assessment types |
| `GET` | `/api/v1/enums/all-enums` | All enums combined |

### 8.12 Health Check Router

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/healthcheck` | Returns 204 if DB is available |

### 8.13 LLM Usage Router (`/llm-usage`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/llm-usage/{assessment_id}` | Get usage for single assessment |
| `GET` | `/llm-usage/` | Get aggregated usage for all assessments |

---

## 9. Services (Business Logic)

### 9.1 Assessment Service (`services/assessment_service.py`)

The central orchestrator for the assessment lifecycle.

| Method | Description |
|--------|-------------|
| `create_new_assessment()` | Creates assessment record, saves uploaded images/PDFs to disk, creates DocumentAnalysis entries per image, queues IMAGE_ANALYSIS and PDF_INGESTION RMQ tasks |
| `get_list()` | Fetches assessments with search term, state filter, pagination |
| `delete_assessment()` | Cascading delete of assessment + related records |
| `get_progress()` | Returns per-image detailed progress (state, stage, flow_diagram, summary, components, clarifications) |
| `get_status()` | Lightweight state/stage polling for UI |
| `process_answers()` | Processes user clarification answers, transitions per-image state NEEDS_INPUT → COMPLETED |
| `save_answers_draft()` | Saves draft answers without state transition |
| `auto_answer_image()` | Concurrent RAG-based auto-answering for a specific image's clarification questions |
| `run_threat_modeling()` | Transitions assessment to PROCESSING/THREAT_MODELING, publishes RMQ task |
| `get_threats_grouped_by_image()` | Returns threats organized by source image with analysis context |
| `reanalyze_threat_modeling()` | Clears existing results and re-queues threat modeling |
| `retry_analysis_pipeline()` | Retries all failed images in an assessment |
| `retry_single_image()` | Retries a single failed image |

### 9.2 Auth Service (`services/auth_service.py`)

| Method | Description |
|--------|-------------|
| `get_role_by_email()` | Maps email to role using `admin_users` config list |
| `get_or_create_google_user()` | JIT provisioning — creates user on first Google OAuth login, syncs role on subsequent logins |

### 9.3 Application Service (`services/application_service.py`)

| Method | Description |
|--------|-------------|
| `save_responses()` | Saves app onboarding responses, creates/updates OnboardingProgress |
| `get_app_progress()` | Returns progress per category for an app |
| `get_category_name()` | Returns category display name |
| `update_app_onboarding_status()` | Marks category as COMPLETED if all questions answered |

### 9.4 Onboarding Service (`services/onboarding_service.py`)

| Method | Description |
|--------|-------------|
| `save_responses()` | Saves organization onboarding responses |
| `get_org_progress()` | Returns org progress per category |
| `get_category_name()` | Returns category display name |
| `update_onboarding_status()` | Marks category as COMPLETED |

### 9.5 Threat Modeling Service (`services/threat_modeling_service.py`)

| Method | Description |
|--------|-------------|
| `delete_assessment_results()` | Cleanup before re-runs — deletes existing AssessmentResults |

---

## 10. Core Processing Pipeline

### 10.1 Document Analysis (`core/document_analysis.py`)

Per-image LLM analysis pipeline with 6 stages:

```
Image → INITIALIZING → IMAGE_PROCESSING → [SUMMARIZING + COMPONENT_ANALYSIS + CLARIFICATION] → Auto-Answer → NEEDS_INPUT/COMPLETED
```

| Stage | Function | Description |
|-------|----------|-------------|
| 1. INITIALIZING | `analyze_single_image()` | Setup, read image bytes |
| 2. IMAGE_PROCESSING | `image_to_mermaid()` | Converts architecture diagram to Mermaid flowchart/sequence/C4 |
| 3. SUMMARIZING | `high_level_summary()` | Generates 4-5 line architectural summary |
| 4. COMPONENT_ANALYSIS | `component_breakdown()` | Lists components with purpose, data assets, trust level |
| 5. CLARIFICATION | `clarification_questions()` | Generates max 20 security assessment questions |
| 6. Auto-Answer | `_auto_answer_questions()` | Concurrent RAG-based answering using vector DB context |

**Key Features:**
- Stages 3, 4, 5 run **in parallel** using `ThreadPoolExecutor`
- Auto-answer uses RAG search per question with concurrency
- Final state: `NEEDS_INPUT` (if unanswered questions remain) or `COMPLETED` (all auto-answered)

### 10.2 Threat Modeling — Multi-Framework (`core/threat_modeling.py`)

Assessment-level threat generation supporting multiple frameworks:

```
All Images' Data → Merge Context → Per-Category LLM Calls (parallel) → Store Results → REVIEW
```

**Framework Registry:**

| Framework | Categories | Pydantic Model |
|-----------|------------|----------------|
| STRIDE | Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege | `StrideThreatItem` |
| LINDDUN | Linkability, Identifiability, Non-repudiation, Detectability, Disclosure of Information, Unawareness, Non-compliance | `LinddunThreatItem` |
| DREAD | Damage Potential, Reproducibility, Exploitability, Affected Users, Discoverability | `DreadThreatItem` |
| PASTA | Attack Simulation, Threat Analysis, Vulnerability Mapping | `PastaThreatItem` |
| BUSINESS_LOGIC | Authentication Bypass, Authorization Flaws, Input Validation, Session Management, Race Conditions, Business Rule Violations | `BusinessLogicThreatItem` |

**Key Functions:**

| Function | Description |
|----------|-------------|
| `fetch_all_image_analyses()` | Collects all DocumentAnalysis records for the assessment |
| `merge_analysis_context()` | Combines multi-image data with source traceability into a single prompt context |
| `generate_framework_prompt()` | Builds dynamic prompts per framework + category |
| `_process_single_category()` | LLM call for one category with JSON parsing and retry |
| `run_generic_analysis_pipeline()` | Framework-agnostic parallel execution across all categories |
| `store_threat_model_results()` | Saves framework-specific threats to AssessmentResults with image traceability |
| `threat_modeling_pipeline()` | Main entry point — orchestrates the full pipeline with state machine transitions |

### 10.3 Legacy STRIDE Service (`core/stride_service.py`)

Single-framework STRIDE-only implementation (predecessor to `threat_modeling.py`):
- `run_stride_analysis_pipeline()` — parallel processing of 6 STRIDE categories
- `threat_modeling_pipeline()` — main orchestrator with state transitions

---

## 11. State Machine

**File:** `core/state_machine.py`

Centralized state transition validation with two layers:

### 11.1 Per-Image Transitions (IMAGE_TRANSITIONS)

```
PENDING → PROCESSING
PROCESSING → NEEDS_INPUT | COMPLETED | FAILED
NEEDS_INPUT → COMPLETED
FAILED → PENDING
```

### 11.2 Assessment-Level Transitions (ASSESSMENT_TRANSITIONS)

```
PENDING → PROCESSING
PROCESSING → NEEDS_INPUT | COMPLETED | FAILED | REVIEW
NEEDS_INPUT → COMPLETED
COMPLETED → PROCESSING
FAILED → PENDING | PROCESSING
REVIEW → APPROVED | CHANGES_REQUESTED
CHANGES_REQUESTED → REVIEW
```

### 11.3 Key Functions

| Function | Description |
|----------|-------------|
| `transition_image(db, assessment_id, image_id, new_state, new_stage, error_message)` | Validates and transitions per-image state, then derives assessment-level state |
| `transition_assessment(db, assessment_id, new_state, new_stage, error_message)` | Validates and transitions assessment-level state |
| `_sync_assessment_state(db, assessment_id)` | Derives overall assessment state from all image states (any FAILED → FAILED, any PROCESSING → PROCESSING, all COMPLETED → COMPLETED, any NEEDS_INPUT → NEEDS_INPUT) |
| `get_image_states(db, assessment_id)` | Returns state info for all images |
| `InvalidTransitionError` | Exception for invalid state transitions |

---

## 12. Message Queue (RabbitMQ)

### 12.1 Task Types (`queue/rmq_message.py`)

```python
class TaskType(str, Enum):
    IMAGE_ANALYSIS = "IMAGE_ANALYSIS"
    PDF_INGESTION = "PDF_INGESTION"
    THREAT_MODELING = "THREAT_MODELING"
```

**`RMQMessage` fields:** `task_type`, `assessment_id`, `image_id`, `image_path`, `pdf_path`, `filename`, `diagram_type`, `retry_count`

### 12.2 Producer (`queue/producer.py`)

- `Producer` class — async message publishing to RabbitMQ
- Connects to multiple RMQ hosts with fallback
- Uses non-robust connections (fails fast)
- Global producer instances pre-initialized per queue
- **Fallback behavior:** If RMQ is unavailable, publishes to an in-process fallback queue for synchronous execution

### 12.3 Consumer (`queue/consumer.py`)

- `Consumer` class — async message consumption with:
  - QoS prefetch control
  - Dead-letter queue (DLQ) for exhausted retries
  - Requeue-based retry with exponential backoff (max 3 attempts)
  - Delivery count tracking via `x-delivery-count` or `x-death` headers

**Retry Flow:**
```
Message received → Process
  ├── Success → ACK
  ├── Retriable error (retries < 3) → NACK + requeue
  └── Max retries exhausted → Send to DLQ + ACK
```

### 12.4 Message Processing (`queue/message_processing.py`)

Task dispatcher routes `RMQMessage` to handlers:

| Task Type | Handler | Description |
|-----------|---------|-------------|
| `IMAGE_ANALYSIS` | `_handle_image_analysis()` | Calls `document_analysis.analyze_single_image()` |
| `PDF_INGESTION` | `_handle_pdf_ingestion()` | Extracts text → chunks → ingests to vector DB |
| `THREAT_MODELING` | `_handle_threat_modeling()` | Calls `threat_modeling_pipeline()` |

- Uses `asyncio.to_thread()` for CPU-bound tasks
- Propagates assessment context for LLM usage tracking

### 12.5 Consumer Orchestration (`queue/threaded_consumer_wrapper.py`)

- `ThreadedConsumerWrapper` — implements `ManagedEntity` interface
- Creates thread pool with per-queue concurrency (configurable, default 10)
- Each thread runs an independent asyncio event loop with a Consumer instance

### 12.6 Custom Thread Pool (`queue/cancelable_thread_pool_exectuor.py`)

- `CancelableThreadPoolExecutor` — extends `ThreadPoolExecutor`
- Tracks all futures for bulk cancellation
- `clean_up()` — shuts down with `cancel_futures=True`

---

## 13. LLM Integration

### 13.1 LLM Client (`core/llm_client/gpt_llm.py`)

**Key Functions:**

| Function | Description |
|----------|-------------|
| `set_assessment_context(assessment_id)` | Sets thread-local context for LLM usage tracking |
| `get_openai_client()` | Returns an OpenAI-compatible client configured with API-key auth |
| `call_llm(system_prompt, user_prompt, response_format, images)` | Structured output parsing with optional image support (base64) |
| `call_llm_text(system_prompt, user_prompt, reasoning_effort)` | Text generation with optional reasoning effort parameter |
| `_build_llm_usage(call_type, response, duration_ms)` | Logs token usage and estimated cost to `LLMUsage` table |

**Features:**
- Image support via base64 encoding
- Token usage tracking per call
- Cost calculation: `(input_tokens * prompt_rate + output_tokens * completion_rate) / 1_000_000`
- Duration tracking in milliseconds
- Thread-local assessment context for multi-threaded environments

---

## 14. RAG (Retrieval-Augmented Generation)

### 14.1 PDF Extraction (`core/rag_client/extractor.py`)

| Function | Description |
|----------|-------------|
| `extract_text_from_pdf_bytes(pdf_bytes)` | Extracts text from PDF using PyMuPDF, returns list of `(page_number, text)` |
| `extract_images_from_pdf_bytes(pdf_bytes)` | Extracts images from PDF with size filtering (min 100px width/height) |

### 14.2 Text Chunking (`core/rag_client/chunker.py`)

| Function | Description |
|----------|-------------|
| `generate_appsec_chunks(pages, assessment_id, source_file)` | Splits text into semantic chunks using LangChain's `RecursiveCharacterTextSplitter` |

**Chunk metadata:** `assessment_id`, `source_file`, `page_number`, `chunk_index`, `ingested_at`  
**Chunk ID format:** `APPSEC-{doc_hash}-P{page}-C{chunk}-{content_hash}`

### 14.3 Vector DB Client (`core/rag_client/vector_db.py`)

| Method | Description |
|--------|-------------|
| `ingest_batch(chunks)` | Uploads chunks in batches of 100 with retry (3 attempts, exponential backoff) |
| `search(query, k, filters)` | KNN search with optional metadata filters |
| `search_by_assessment(query, assessment_id, k)` | Filtered search scoped to a specific assessment |

**Features:**
- Async operations with semaphore-based concurrency control
- 20-minute ingestion timeout, 1-minute search timeout
- Automatic batch splitting (100 chunks per batch)

---

## 15. Authentication & Authorization

**File:** `core/auth/auth.py`

### 15.1 Password Handling
- Argon2 hashing via `passlib` (`CryptContext`)

### 15.2 JWT Token Management
- Algorithm: HS256
- Expiry: 300 minutes (configurable)
- `create_access_token(data: dict)` — generates JWT with `sub` (user email) and `exp`

### 15.3 FastAPI Dependencies
- `get_current_user(token)` — extracts and validates JWT, returns User object
- `require_roles(*roles)` — role-based access control dependency factory

### 15.4 Google OAuth2 Flow
1. `GET /auth/google/login` → redirects to Google consent screen
2. Google redirects back to `GET /auth/google/callback` with authorization code
3. Server exchanges code for Google tokens, validates the configured email domain
4. JIT provisioning: creates user if not exists, assigns role from config
5. Issues local JWT token
6. Redirects to frontend with JWT in URL parameter

---

## 16. CRUD Operations

### 16.1 Assessment CRUD (`crud/assessment_crud.py`)

| Function | Description |
|----------|-------------|
| `create_assessment_entry(db, assessment_data)` | Creates Assessment record with UUID |
| `create_document_entry(db, doc_data)` | Creates AssessmentDocument record |
| `create_image_analysis_entry(db, analysis_data)` | Creates DocumentAnalysis per image |
| `get_assessment_by_id(db, assessment_id)` | Retrieves single assessment |
| `get_assessments_by_user(db, user_id, search, state, page, size)` | List with filters |
| `get_analysis_by_assessment_id(db, assessment_id)` | All DocumentAnalysis for assessment |
| `get_analysis_by_image_id(db, assessment_id, image_id)` | Single image analysis |
| `get_threats_by_assessment_id(db, assessment_id)` | All AssessmentResults |
| `delete_assessment(db, assessment_id)` | Cascading delete |
| `update_analysis_clarifications(db, assessment_id, image_id, clarification)` | Updates clarification JSON |

### 16.2 Application CRUD (`crud/application_crud.py`)

| Function | Description |
|----------|-------------|
| `get_app(db, app_id)` | Get app by ID |
| `get_response(db, app_id, question_id)` | Get specific response |
| `create_response(db, response_data)` | Create new response |
| `update_response(db, response_id, new_value)` | Update existing response |
| `get_total_questions_by_category(db, category_id, entity_type)` | Count questions in category |
| `count_answered_questions(db, entity_id, category_id, entity_type)` | Count answered questions |
| `get_progress(db, entity_id, category_id, entity_type)` | Get onboarding progress |
| `create_progress(db, progress_data)` | Create progress record |
| `update_progress_status(db, progress_id, status)` | Update progress status |
| `get_all_responses(db, entity_id, entity_type)` | Get all responses for entity |
| `get_question(db, question_id)` | Get question by ID |
| `get_category(db, category_id)` | Get category by ID |

---

## 17. Prompt Templates

**File:** `prompt/prompt.py`

| Prompt | Purpose | Output Format |
|--------|---------|---------------|
| `IMAGE_TO_MERMAID_PROMPT` | Converts architecture diagram images to Mermaid syntax | Mermaid flowchart/sequence/C4 |
| `HIGH_LEVEL_SUMMARY_PROMPT` | Generates 4-5 line architectural summary from image | Plain text |
| `COMPONENT_BREAKDOWN_PROMPT` | Lists components with purpose, data assets, trust level | Structured JSON (Component[]) |
| `CLARIFICATION_QUESTIONS_PROMPT` | Generates max 20 security assessment questions | Structured JSON (Question[]) |
| `AUTO_ANSWER_CLARIFICATION_PROMPT` | Auto-answers questions using RAG-retrieved context | Structured JSON (Answer) |
| `STRIDE_PROMPT` | Legacy STRIDE-specific threat generation template | Structured JSON (StrideThreatItem[]) |

Each framework in `threat_modeling.py` also has a **system role prompt** defined in the framework registry that provides domain-specific instructions.

---

## 18. Utilities

### 18.1 FastAPI Event Emitter (`util/fastapi_event_emitter.py`)

- `FastapiEventEmitter` — manages startup/shutdown lifecycle for `ManagedEntity` instances
- `start()` — called on application startup
- `stop()` — called on application shutdown
- `add_managed_entity(entity)` — registers entity for lifecycle management

### 18.2 Managed Entity (`util/managed_entity.py`)

- `ManagedEntity` — abstract base class with `start()` and `stop()` methods
- Implemented by `ThreadedConsumerWrapper` and potentially other lifecycle-managed components

### 18.3 Standard Response (`schemas.py` + `utils.py`)

```python
# Standard API response wrapper
standard_response(status_code=200, message="Success", data={"key": "value"})
# Returns: JSONResponse with {"status": "success", "code": 200, "message": "Success", "data": {...}}
```

---

## 19. End-to-End Flow

### 19.1 Complete Assessment Lifecycle

```
┌─── PHASE 1: Assessment Creation ─────────────────────────────────────────────┐
│                                                                               │
│  User uploads images + PDFs                                                   │
│  POST /assessment/new                                                         │
│    ├── Save images to disk (uploads/{assessment_id}/input/)                   │
│    ├── Save PDFs to disk (uploads/{assessment_id}/supporting_docs/)           │
│    ├── Create Assessment record (state=PENDING)                               │
│    ├── Create DocumentAnalysis per image (state=PENDING)                      │
│    ├── Create AssessmentDocument per PDF                                      │
│    ├── Publish IMAGE_ANALYSIS RMQ message per image                           │
│    └── Publish PDF_INGESTION RMQ message per PDF                              │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 2: Image Analysis (per-image, parallel) ────────────────────────────┐
│                                                                               │
│  RMQ Consumer picks up IMAGE_ANALYSIS task                                    │
│    ├── Stage 1: INITIALIZING — Setup, read image bytes                        │
│    ├── Stage 2: IMAGE_PROCESSING — LLM: image → Mermaid diagram              │
│    ├── Stage 3-5: PARALLEL —                                                  │
│    │   ├── SUMMARIZING — LLM: high-level architecture summary                │
│    │   ├── COMPONENT_ANALYSIS — LLM: component breakdown                     │
│    │   └── CLARIFICATION — LLM: security clarification questions             │
│    ├── Auto-answer — RAG search per question (concurrent)                     │
│    ├── Save all results to DocumentAnalysis                                   │
│    └── Transition state → NEEDS_INPUT or COMPLETED                            │
│                                                                               │
│  State derivation: Assessment state synced from all image states              │
│    ├── Any FAILED → FAILED                                                    │
│    ├── Any PROCESSING → PROCESSING                                            │
│    ├── Any NEEDS_INPUT → NEEDS_INPUT                                          │
│    └── All COMPLETED → COMPLETED                                              │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 2b: PDF Ingestion (parallel with image analysis) ───────────────────┐
│                                                                               │
│  RMQ Consumer picks up PDF_INGESTION task                                     │
│    ├── Extract text from PDF (PyMuPDF)                                        │
│    ├── Chunk text (RecursiveCharacterTextSplitter)                             │
│    └── Ingest chunks to Vector DB (batches of 100)                            │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 3: Clarification (if NEEDS_INPUT) ──────────────────────────────────┐
│                                                                               │
│  User views clarification questions per image                                 │
│  GET /assessment/{id}/progress                                                │
│                                                                               │
│  Options:                                                                     │
│    ├── Manual answer: POST /assessment/{id}/images/{img_id}/answer            │
│    ├── Auto-answer:   POST /assessment/{id}/images/{img_id}/auto-answer       │
│    └── Draft save:    PUT  /assessment/{id}/images/{img_id}/save-answers       │
│                                                                               │
│  On submit → image state transitions NEEDS_INPUT → COMPLETED                  │
│  When all images COMPLETED → assessment state → COMPLETED                     │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 4: Threat Modeling ─────────────────────────────────────────────────┐
│                                                                               │
│  User triggers threat modeling                                                │
│  POST /threat-model/{id}/start                                                │
│    ├── Transition assessment → PROCESSING / THREAT_MODELING                   │
│    └── Publish THREAT_MODELING RMQ message                                    │
│                                                                               │
│  RMQ Consumer picks up THREAT_MODELING task                                   │
│    ├── Fetch all DocumentAnalysis for assessment                              │
│    ├── Merge context from all images (with traceability)                      │
│    ├── For each framework category (parallel):                                │
│    │   ├── Generate framework-specific prompt                                 │
│    │   ├── LLM call with structured output parsing                            │
│    │   └── Parse threats with retry on failure                                │
│    ├── Store threats to AssessmentResults (with image_id traceability)         │
│    └── Transition assessment → REVIEW                                         │
│                                                                               │
│  View results:                                                                │
│  GET /threat-model/{id}/results/by-image                                      │
│  GET /threat-model/{id}/export (CSV)                                          │
│  GET /threat-model/{id}/usage (LLM cost)                                      │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 5: Review & Approval ───────────────────────────────────────────────-┐
│                                                                               │
│  Assign reviewers:                                                            │
│  POST /reviews/{id}/assign-reviewers                                          │
│                                                                               │
│  Reviewer views assigned assessments:                                         │
│  GET /reviews/assessments-under-review                                        │
│                                                                               │
│  Reviewer actions:                                                            │
│    ├── Review individual threat: POST /reviews/{id}/threats/{tid}/review      │
│    ├── Bulk review threats: POST /reviews/{id}/threats/bulk-review            │
│    ├── Approve: POST /reviews/{id}/approve → assessment → APPROVED            │
│    └── Reject:  POST /reviews/{id}/submit-review (REJECTED)                   │
│                     → assessment → CHANGES_REQUESTED                          │
│                     → re-assign reviewers → back to REVIEW                    │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 19.2 Complete State Diagram

```
                          ┌──────────┐
          Assessment ────→│  PENDING  │
          Created         └────┬─────┘
                               │ pipeline starts
                               ▼
                          ┌──────────────┐
                          │  PROCESSING  │
                          │ (per-image)  │
                          └──┬───┬───┬──┘
                    ┌────────┘   │   └────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │NEEDS_INPUT│ │COMPLETED │ │  FAILED  │
              └────┬─────┘ └────┬─────┘ └────┬─────┘
                   │ answer     │             │ retry
                   ▼            │             ▼
              ┌──────────┐     │        ┌──────────┐
              │COMPLETED │     │        │  PENDING  │
              └────┬─────┘     │        └──────────┘
                   │           │
                   └─────┬─────┘
                         │ "Run Threat Modeling"
                         ▼
                   ┌──────────────┐
                   │  PROCESSING  │
                   │ (THREAT_     │
                   │  MODELING)   │
                   └──┬───────┬──┘
                      │       │
                      ▼       ▼
                ┌──────────┐ ┌──────────┐
                │  FAILED  │ │  REVIEW  │
                └──────────┘ └──┬───┬──┘
                                │   │
                   approve ─────┘   └───── reject
                   ▼                       ▼
              ┌──────────┐       ┌───────────────────┐
              │ APPROVED │       │CHANGES_REQUESTED  │
              │ (final)  │       └────────┬──────────┘
              └──────────┘                │ re-assign
                                          ▼
                                     ┌──────────┐
                                     │  REVIEW  │
                                     └──────────┘
```

---

## 20. Deployment

### 20.1 Dockerfile

```dockerfile
FROM python:3.12-slim-bookworm

RUN apt update -y && \
    apt install -y curl libmariadb-dev build-essential && \
    apt clean

COPY requirements.txt .
RUN python3 -m pip install -r requirements.txt

WORKDIR /app
RUN mkdir -p /app/uploads

COPY main.py .
COPY atm/ ./atm/

ENTRYPOINT ["python3", "main.py"]
```

### 20.2 Infrastructure Requirements

| Component | Details |
|-----------|---------|
| **Python** | 3.12 |
| **MariaDB** | Connection pool size 100, recycle 300s |
| **RabbitMQ** | Port 5672, queue "ATM", concurrency 10 |
| **OpenAI API** | OpenAI-compatible endpoint configured via `openaiconfig` |
| **Vector DB** | Optional local or remote instance for RAG |
| **File Storage** | Local `/app/uploads` directory |

### 20.3 Environment Variables

| Variable | Purpose | Values |
|----------|---------|--------|
| `ENV` | Config source selection | `local`, `stage` |
| `OPENAI_API_KEY` / `ATM_LLM_API_KEY` | LLM provider API key | Secret string |
| `ATM_RAG_API_KEY` | Optional vector DB bearer token | Secret string |
| `http_proxy` / `https_proxy` | Proxy for outbound requests | Set in Dockerfile |

### 20.4 Local Development Setup

```bash
# 1. Create virtual environment
python3.12 -m venv env
source env/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start MariaDB (required)
# Ensure MariaDB is running on localhost:3306 with database 'atm'

# 4. Start RabbitMQ (optional — fallback queue used if unavailable)
# docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:management

# 5. Run the application
python3 main.py
# Server starts at http://localhost:8000
```

---

## 21. Dependencies

### Core Framework
| Package | Version | Purpose |
|---------|---------|---------|
| fastapi | 0.121.0 | Web framework |
| uvicorn | 0.40.0 | ASGI server |
| starlette | 0.49.3 | ASGI toolkit (FastAPI dependency) |
| pydantic | 2.11.9 | Data validation |

### Database
| Package | Version | Purpose |
|---------|---------|---------|
| SQLAlchemy | 2.0.43 | ORM |
| mariadb | 1.1.14 | MariaDB connector |

### Message Queue
| Package | Version | Purpose |
|---------|---------|---------|
| aio-pika | 9.5.7 | Async RabbitMQ client |
| aiormq | 6.9.2 | Low-level AMQP |

### AI/LLM
| Package | Version | Purpose |
|---------|---------|---------|
| openai | 1.108.1 | OpenAI API client |
| langchain-text-splitters | 0.3.11 | Text chunking for RAG |
| tiktoken | 0.12.0 | Token counting |

### Authentication
| Package | Version | Purpose |
|---------|---------|---------|
| PyJWT | 2.11.0 | JWT token handling |
| passlib | 1.7.4 | Password hashing (Argon2) |
| google-auth | 2.48.0 | Google OAuth2 |
| argon2-cffi | 25.1.0 | Argon2 hashing backend |
| cryptography | 46.0.4 | Crypto primitives |

### Document Processing
| Package | Version | Purpose |
|---------|---------|---------|
| PyMuPDF | 1.23.8 | PDF text/image extraction |
| python-docx | 1.2.0 | DOCX handling |
| fpdf2 | 2.8.7 | PDF generation |

### HTTP/Networking
| Package | Version | Purpose |
|---------|---------|---------|
| httpx | 0.28.1 | Async HTTP client |
| requests | 2.32.5 | Sync HTTP client |

### Utilities
| Package | Version | Purpose |
|---------|---------|---------|
| PyYAML | 6.0.2 | YAML parsing |
| colorlog | 6.9.0 | Colored logging |
| tenacity | 9.1.2 | Retry logic |
| python-multipart | 0.0.22 | Multipart form parsing |
| orjson | 3.11.7 | Fast JSON serialization |

---

*Generated from codebase analysis — ATM Service v1.0*
