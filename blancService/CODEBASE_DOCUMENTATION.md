# Blanc / ATM Service — Codebase Documentation

> **Automated Threat Modeling (ATM)** — the FastAPI backend that powers Blanc Studio. It ingests architecture / sequence / data-flow diagrams (plus optional supporting PDFs), runs a two-phase LLM analysis pipeline per image, auto-answers clarification questions via RAG, then generates framework-specific threats (STRIDE, Business Logic) with a full reviewer workflow.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Entry Point — `main.py`](#4-entry-point--mainpy)
5. [Configuration](#5-configuration)
6. [Database Models](#6-database-models)
7. [API Schemas (Pydantic)](#7-api-schemas-pydantic)
8. [API Endpoints (Routers)](#8-api-endpoints-routers)
9. [Services (Business Logic)](#9-services-business-logic)
10. [Core Processing Pipeline](#10-core-processing-pipeline)
11. [State Machine](#11-state-machine)
12. [Message Queue (RabbitMQ)](#12-message-queue-rabbitmq)
13. [LLM Client](#13-llm-client)
14. [RAG (Retrieval-Augmented Generation)](#14-rag-retrieval-augmented-generation)
15. [Storage Backends](#15-storage-backends)
16. [OCR](#16-ocr)
17. [Skills (Prompt System)](#17-skills-prompt-system)
18. [Authentication & Authorization](#18-authentication--authorization)
19. [CRUD Layer](#19-crud-layer)
20. [Utilities](#20-utilities)
21. [End-to-End Flow](#21-end-to-end-flow)
22. [Deployment](#22-deployment)
23. [Dependencies](#23-dependencies)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          FastAPI Application                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐    │
│  │ Routers  │→ │ Services │→ │   CRUD   │→ │  MariaDB (SQLAlchemy)  │    │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────────────┘    │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────┐     ┌──────────────┐    ┌────────────────────────┐      │
│  │ RMQ Producer│────→│ RMQ Consumer │───→│   Core Pipelines       │      │
│  └─────────────┘     └──────────────┘    │  (analysis + threats)  │      │
│       │ fallback                          └────────────────────────┘      │
│       ▼ (in-process)                             │                       │
│   ┌────────────┐                     ┌───────────┼───────────┐           │
│   │  Skills    │─── prompts ────────▶│           ▼           ▼           │
│   │ (.md files)│                     │      ┌────────┐  ┌────────┐       │
│   └────────────┘                     │      │  LLM   │  │  RAG   │       │
│                                      │      │ Client │  │ Backend│       │
│                                      │      └────┬───┘  └────┬───┘       │
│                                      │           │           │           │
│                                      │       providers    ┌──┴──┐        │
│                                      │       (openai,     │local│─Chroma │
│                                      │        litellm)    │http │─Remote │
│                                      │                    └─────┘        │
│                                      │                                   │
│                                      │  Storage (local │ s3)   OCR (paddle)│
│                                      └─────────────────────────────────  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Request Flow Summary

1. **Assessment creation** — User uploads images (+ optional PDFs). Rows created for `Assessment`, one `DocumentAnalysis` per image, one `AssessmentDocument` per PDF. `IMAGE_ANALYSIS_PHASE_A` and `PDF_INGESTION` messages published to RabbitMQ.
2. **Image analysis — Phase A** — Consumer runs `image → Mermaid → components`. Row transitions to `AWAITING_REVIEW`, pausing until the user hits **Next** in the Studio.
3. **Image analysis — Phase B** — On user continue, `IMAGE_ANALYSIS_PHASE_B` runs `summary + clarification questions`, then RAG-based auto-answering. Row ends in `NEEDS_INPUT` or `COMPLETED`.
4. **Clarification** — User answers remaining questions (or auto-answers). Assessment state is derived from all image states.
5. **Threat modeling** — User triggers per-framework generation. Multi-framework registry (STRIDE, BUSINESS_LOGIC) fans out parallel LLM calls per category. Results persisted with per-image traceability.
6. **Review** — Reviewers assigned; per-threat approve/reject/comment; assessment ends in `APPROVED` or `CHANGES_REQUESTED`.
7. **Every LLM call is logged** to `llm_usage` (tokens + estimated cost) for full audit.

---

## 2. Technology Stack

| Category | Technology |
|---|---|
| Web framework | FastAPI + Uvicorn |
| Database | MariaDB via SQLAlchemy 2.x ORM |
| Message queue | RabbitMQ via `aio-pika` (with in-process fallback) |
| LLM | OpenAI-compatible providers (`openai` SDK, `litellm`) |
| RAG | Pluggable backends — local Chroma or remote HTTP vector DB |
| Storage | Pluggable — local filesystem or S3 |
| OCR | PaddleOCR (lazy-loaded, out-of-process CLI) |
| PDF | PyMuPDF (extraction), fpdf2 (export) |
| Auth | Google OAuth2 + local JWT (HS256), Argon2 password hashing |
| Validation | Pydantic v2 |
| Text chunking | LangChain text splitters |
| Logging | `colorlog` |

Exact pinned versions live in [blancService/requirements.txt](blancService/requirements.txt).

---

## 3. Project Structure

```
blancService/
├── main.py                          # FastAPI entry point
├── Dockerfile                       # Container image
├── entrypoint.sh                    # Container entrypoint
├── requirements.txt                 # Python dependencies
├── CODEBASE_DOCUMENTATION.md        # (this file)
├── uploads/                         # Local file storage (bind-mounted in prod)
│
└── atm/                             # Main application package
    ├── __init__.py
    ├── utils.py                     # standard_response helper
    │
    ├── api_schemas/api_v1/          # Pydantic request/response models
    │   ├── ai_response.py           # Threat-modeling response schemas
    │   ├── app.py                   # App onboarding
    │   ├── assessment.py            # Assessment DTOs + enums
    │   ├── auth_schema.py           # Auth DTOs
    │   ├── onboarding.py            # Org onboarding
    │   ├── org.py                   # Organization DTOs
    │   ├── rag.py                   # RAG search / ingest DTOs
    │   └── threat_modeling_schema.py# SurfaceMap payloads (Threat Modeller Inventory)
    │
    ├── config/                      # YAML config files
    │   ├── config.yml               # Active config (gitignored)
    │   ├── config.yml.example       # Bare-metal template
    │   └── docker.yml.example       # Docker Compose template
    │
    ├── config_parsers/
    │   ├── config_models.py         # Pydantic AppConfig hierarchy
    │   ├── settings.py              # get_settings() loader (env-aware)
    │   └── log_utils.py             # colorlog configuration
    │
    ├── core/                        # Domain logic & pipelines
    │   ├── document_analysis.py     # Two-phase per-image LLM pipeline
    │   ├── state_machine.py         # Transition guards (image + assessment)
    │   ├── threat_modeling.py       # Multi-framework threat generation
    │   ├── auth/
    │   │   └── auth.py              # JWT + OAuth2 + role deps
    │   ├── component_info/          # (reserved, currently empty)
    │   ├── llm_client/              # Provider-abstracted LLM client
    │   │   ├── base.py              # LLMProvider / LLMMessage / LLMResponse ABCs
    │   │   ├── client.py            # LLMClient facade + ModelResolver
    │   │   ├── attachments.py       # Local + remote attachment loading
    │   │   ├── auth.py              # Provider auth strategies
    │   │   ├── usage.py             # UsageSink / UsageRecord
    │   │   └── providers/
    │   │       ├── openai_provider.py
    │   │       └── litellm_provider.py
    │   ├── ocr/
    │   │   ├── paddle_cli.py        # Standalone PaddleOCR CLI
    │   │   └── paddle_runner.py     # In-process wrapper
    │   ├── rag_client/
    │   │   ├── chunker.py           # RecursiveCharacterTextSplitter chunking
    │   │   ├── embeddings.py        # Local embedding models
    │   │   ├── extractor.py         # PDF text + image extraction (PyMuPDF)
    │   │   ├── factory.py           # Backend selection (local / http / plugin)
    │   │   ├── local_vector_db.py   # Chroma-backed LocalVectorDB
    │   │   └── vector_db.py         # Remote HTTP VectorDBClient
    │   └── storage/
    │       ├── base.py              # StorageBackend ABC + StorageResult
    │       ├── factory.py           # Backend selection (local / s3)
    │       ├── local_storage.py
    │       └── s3_storage.py
    │
    ├── crud/
    │   ├── assessment_crud.py       # Assessment, DocumentAnalysis, results
    │   ├── application_crud.py      # Apps, questions, onboarding progress
    │   └── surface_map_crud.py      # Surface-map inventory upsert/read/delete
    │
    ├── db/
    │   └── database.py              # Engine, SessionLocal, Base, get_db()
    │
    ├── db_models/
    │   └── models.py                # SQLAlchemy tables + EnumAsString TypeDecorator
    │
    ├── queue/                       # RabbitMQ integration
    │   ├── cancelable_thread_pool_exectuor.py
    │   ├── consumer.py              # Async consumer with retry + DLQ
    │   ├── message_processing.py    # Task dispatcher
    │   ├── producer.py              # Async producer with in-process fallback
    │   ├── rmq_message.py           # RMQMessage + TaskType enum
    │   └── threaded_consumer_wrapper.py
    │
    ├── routers/                     # API endpoints
    │   ├── app_router.py
    │   ├── application_router.py
    │   ├── assessment_router.py
    │   ├── auth_router.py
    │   ├── enum_router.py
    │   ├── health_check_router.py
    │   ├── llm_usage_router.py
    │   ├── onboarding_router.py
    │   ├── org_router.py
    │   ├── question_router.py
    │   ├── rag_router.py
    │   ├── reviews.py
    │   └── threat_modeling_router.py
    │
    ├── services/                    # Class-based business logic
    │   ├── application_service.py
    │   ├── assessment_service.py
    │   ├── auth_service.py
    │   └── onboarding_service.py
    │
    ├── skills/                      # Prompt-as-a-skill system
    │   ├── __init__.py              # get_skill / list_skills / plugin discovery
    │   └── definitions/             # Markdown skill files (frontmatter + body)
    │       ├── auto_answer_clarification.md
    │       ├── business_logic_threat_modeling.md
    │       ├── clarification_questions.md
    │       ├── component_breakdown.md
    │       ├── high_level_summary.md
    │       ├── image_to_mermaid.md
    │       ├── image_to_mermaid_auto.md
    │       ├── stride_threat_modeling.md
    │       ├── surface_discovery.md
    │       └── threat_analysis.md
    │
    └── util/
        ├── file_sniff.py            # MIME sniffing / file type detection
        └── managed_entity.py        # Lifecycle interface (start/stop)
```

---

## 4. Entry Point — `main.py`

**File:** [blancService/main.py](blancService/main.py)

### Responsibilities
- Load config + configure logging via `get_settings()` and `LoggingConfig.configure_logging()`.
- Call `Base.metadata.create_all(bind=engine)` — creates missing tables on first boot. `EnumAsString` (VARCHAR) is used everywhere state/status is stored, so adding new Python enum members requires no schema change.
- Ensure the local uploads directory exists and is writable (fail-fast probe).
- Mount `/uploads` as a hardened static route (see below).
- Install CORS middleware with an **explicit** allow-list (localhost:3000, 127.0.0.1:3000, `config.frontend.base_url`) — no wildcards.
- Register 13 routers.
- Start `ThreadedConsumerWrapper` (RabbitMQ consumers).
- Run **startup recovery**: re-publish `IMAGE_ANALYSIS_PHASE_A`, `IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID`, or `THREAT_MODELING` messages for rows stuck in `PENDING`/`PROCESSING` within the last 24 h.

### Registered Routers

| Router | Module |
|---|---|
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

### `/uploads` hardening middleware

Anything served under `/uploads/` gets these headers to neutralise stored-XSS via uploaded `.svg` / `.html`:

- `X-Content-Type-Options: nosniff`
- `Content-Disposition: attachment` (forces download rather than inline render)
- `Referrer-Policy: no-referrer`

### Server run configuration

- Host / port / worker count come from `config.fastApiConfig`.
- `reload=True` in `main.py` is a dev convenience; production runs Uvicorn/Gunicorn without it via `entrypoint.sh`.

---

## 5. Configuration

### 5.1 Loader — `config_parsers/settings.py`

```python
from atm.config_parsers.settings import get_settings
settings = get_settings()   # returns AppConfig, cached via @lru_cache
```

Resolution order (highest priority first):

1. `ATM_CONFIG_PATH=/abs/path.yml` env var — absolute path to any YAML file.
2. `ENV=<name>` env var — reads `atm/config/<name>.yml` (default `ENV=config` → `config.yml`; Docker Compose sets `ENV=docker` → `docker.yml`).

YAML supports environment-variable expansion: `${VAR}` and `${VAR:-fallback}`. Missing vars without a fallback raise a clear error. YAML is parsed with `yaml.safe_load`. Config errors cause `sys.exit(2)` so process supervisors treat them as failures.

### 5.2 Config models — `config_parsers/config_models.py`

All are Pydantic v2 `BaseModel` subclasses. The root is `AppConfig`:

| Model | Purpose |
|---|---|
| `AppConfig` | Root model containing every sub-config below |
| `FastApiConf` | `appHost`, `appPort`, `num_workers` |
| `Path` | Filesystem path settings |
| `OpenAIConfig` | `openai_url`, `model_name`, `provider`, `api_key`, etc. |
| `ModelConfig` | Per-purpose LLM model spec (name + pricing) |
| `OpenApiConfig` | OpenAPI schema tweaks |
| `PricingConfig` | Default `prompt_cost_per_million`, `completion_cost_per_million` |
| `RAGConfig` | Namespace, collection, backend selection |
| `RAGLocalConfig` | Local Chroma settings |
| `RAGEmbedderConfig` | Local embedding model settings |
| `GoogleAuthConfig` | `client_id`, `client_secret`, `redirect_uri`, `allowed_domain` |
| `FrontendConfig` | `base_url` used for CORS + OAuth redirects |
| `JwtConfig` | `secret_key`, `algorithm`, `access_token_expire_minutes` |
| `DBConf` | Connection string, pool sizing |
| `QueueDetails` / `RMQConf` | RabbitMQ hosts, credentials, queue definitions |
| `StorageConfig` | Backend selector + local/S3 sub-configs |
| `S3Config` | Bucket, region, credentials |

### 5.3 Logging — `config_parsers/log_utils.py`

- `LoggingConfig.configure_logging()` applies the config from `AppConfig`.
- Uses `colorlog.ColoredFormatter`.
- Noisy loggers (`aio_pika`, `aiormq`, `httpx`, `httpcore`, `openai`) are suppressed to WARNING/ERROR.

---

## 6. Database Models

**File:** [blancService/atm/db_models/models.py](blancService/atm/db_models/models.py)
**Engine / session:** [blancService/atm/db/database.py](blancService/atm/db/database.py) exposes `Base`, `engine`, `SessionLocal`, `get_db()` (FastAPI dep), and `get_db_session()` (context manager).

### 6.1 `EnumAsString` TypeDecorator

Custom SQLAlchemy `TypeDecorator` that stores Python `enum.Enum` values as `VARCHAR(32)` — sidestepping MariaDB's `ENUM(...)` freeze-at-CREATE-TABLE problem. Reads round-trip back to the enum member, so `.state == AssessmentState.FAILED` still works. Adding a new enum member requires no schema change.

### 6.2 Enums

```python
class AssessmentState(enum.Enum):
    PENDING
    PROCESSING
    AWAITING_REVIEW        # Phase A finished (mermaid + components), waiting for user "Next"
    NEEDS_INPUT            # Clarification questions outstanding
    COMPLETED
    FAILED
    REVIEW                 # Threats generated, in reviewer workflow
    APPROVED               # Terminal
    CHANGES_REQUESTED      # Reviewer rejected → back to REVIEW

class AssessmentStage(enum.Enum):
    INITIALIZING
    IMAGE_PROCESSING
    SUMMARIZING
    COMPONENT_ANALYSIS
    CLARIFICATION
    THREAT_MODELING

class ReviewStatus(enum.Enum):
    PENDING
    APPROVED
    REJECTED
```

### 6.3 Tables

Below is the shape of each table. See the source for the full column list.

- **`user`** — `userId` (PK, UUID), `email`, `password` (Argon2 hash; null for OAuth-only users), `name`, `role` (`ADMIN`/`SUPERADMIN`/`USER`), `isActive`, timestamps.
- **`assessment`** — `assessment_id` (PK), `assessment_type`, `framework`, `team`, `app_name`, `org_name`, `interface`, `operating_system`, `error_message`, `state`, `stage`, `feature_name`, `feature_version`, `user_id` (FK), `approved_by` (FK), `approved_comment`, `approved_at`, timestamps.
- **`document_analysis`** — Composite PK `(assessment_id, image_id)`. Columns: `image_path`, `diagram_type` (default `"flowchart TD"`), `state`, `stage`, `error_message`, and four JSON blobs: `flow_diagram`, `analysis_summary`, `component_details`, `clarification`.
- **`assessment_documents`** — Composite PK `(assessment_id, document_type, document_id)`. `client`, `meta` (JSON).
- **`assessment_results`** — Auto-increment `id`, `assessment_id` (FK), `image_id` (nullable, source traceability), `category`, `title`, `description`, `component_affected`, `attack_vector`, `mitigations`, `severity`, `likelihood`, `risk`, `detection`, `state`, `review_status`, `review_comment`, `reviewed_by` (FK), `reviewed_at`.
- **`assessment_reviewers`** — `id`, `assessment_id` (FK), `reviewer_id` (FK), `status` (`EnumAsString(ReviewStatus)`), `comment`, `reviewed_at`.
- **`llm_usage`** — `id`, `assessment_id` (FK, indexed), `call_type`, `model`, `input_tokens`, `output_tokens`, `total_tokens`, `tokens_billed`, `estimated_cost`, `duration_ms`, `created_at`.
- **`category`** — `id`, `name`, `entity_type` (`APP`/`ORG`), `order`.
- **`question`** — `id`, `question`, `options`, `entity_type`, `category_id` (FK).
- **`org`** — `id`, `name`, `status`.
- **`organization_response`** — `id`, `org_id`, `question_id`, `response`.
- **`onboarding_progress`** — `id`, `org_id`, `entity_type`, `entity_id`, `category_id`, `status`.
- **`app`** — `id`, `name`, `org_id`, `status`.
- **`application_response`** — `id`, `app_id`, `question_id`, `response`.
- **`surface_map`** — Composite PK `(assessment_id, image_id)`. `surface_map` (JSON — Threat Modeller Inventory payload). `created_at`, `updated_at`. Survives Mermaid re-syncs because edits live in JSON, not in `flow_diagram`.

`Base.metadata.create_all()` on startup creates any missing tables. There are no separate migration scripts — schema evolution happens through the `EnumAsString` pattern (VARCHAR columns) and additive column changes.

---

## 7. API Schemas (Pydantic)

### 7.1 Standard response — `atm/utils.py`

```python
standard_response(status_code=200, message="OK", data={...})
# → JSONResponse({"status": 200, "message": "OK", "data": {...}}, status_code=200)
```

### 7.2 Assessment — `api_schemas/api_v1/assessment.py`

Enums (string-valued Pydantic enums mirroring the DB enums):
- `AssessmentType` — SECURITY, COMPLIANCE
- `Framework` — STRIDE, BUSINESS_LOGIC (extensible)
- `AssessmentState`, `AssessmentStage`
- `DiagramType` — ARCHITECTURE, SEQUENCE, DATA_FLOW, …

Request / response DTOs:
- `AssessmentCreate` — multipart-form model with `as_form()` classmethod.
- `AssessmentResponse` — full assessment record.
- `ClarificationQuestion`, `AnswerSubmission` — clarification workflow.

### 7.3 Threat-modeling responses — `api_schemas/api_v1/ai_response.py`

Base building blocks:
- `Component` — name, purpose, data assets, trust level
- `MermaidResponse`, `SummaryResponse`, `ComponentsResponse`, `QuestionsResponse`
- `CoreThreatAnalysis` — Threat / Description / Impact / Likelihood / Mitigation (shared base)

Framework-specific threat items (currently the two implemented frameworks):

| Framework | Item | Extra fields |
|---|---|---|
| STRIDE | `StrideThreatItem` | `Component`, `ThreatCategory` ∈ {Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege} |
| Business Logic | `BusinessLogicThreatItem` | `AbusedFeature`, `BusinessImpact`, `LogicFlawCategory`, … |

Wrapper responses: `StrideThreatModelResponse`, `BusinessLogicThreatModelResponse`.

### 7.4 Surface map — `api_schemas/api_v1/threat_modeling_schema.py`

- `SurfaceComponent`, `SurfaceBoundary`, `SurfaceMapPayload` — Threat Modeller Inventory payload, serialised into `surface_map.surface_map` JSON column.

### 7.5 Other schema modules

- `auth_schema.py` — `UserCreate`, `UserOut`, `Token`.
- `rag.py` — `SearchRequest`, `IngestResponse`.
- `onboarding.py` — `OnboardingRequest`, `CategoryProgress`, etc. (used for both org and app onboarding).
- `org.py` — `OrgCreate`.
- `app.py` — `AppOnboardRequest`, `AppOnboardResponse`.

There is no dedicated `reviewer.py` schema module — review payloads are declared inline in [reviews.py](blancService/atm/routers/reviews.py).

---

## 8. API Endpoints (Routers)

### 8.1 Assessment router — `/assessment`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/assessment/new` | Create assessment with images (+ optional PDFs). Enqueues Phase-A per image + PDF ingestion. |
| POST | `/assessment/extract-pdf-images` | Extract images from a PDF (base64 previews). |
| GET  | `/assessment/list` | List assessments (search / state filter / pagination). |
| DELETE | `/assessment/{id}` | Cascading delete (admin). |
| GET  | `/assessment/{id}/progress` | Detailed per-image progress (state, stage, JSON blobs). |
| GET  | `/assessment/{id}/status` | Lightweight polling. |
| POST | `/assessment/{id}/images/{img_id}/answer` | Submit clarification answers → COMPLETED. |
| PUT  | `/assessment/{id}/images/{img_id}/save-answers` | Save draft answers without state change. |
| POST | `/assessment/{id}/answer` | Legacy: answer first NEEDS_INPUT image. |
| POST | `/assessment/{id}/retry-analysis` | Retry all failed images. |
| POST | `/assessment/{id}/continue` | Gate: promote all AWAITING_REVIEW images → Phase B. |
| POST | `/assessment/{id}/images/{img_id}/continue` | Per-image Phase A → Phase B promotion. |
| POST | `/assessment/{id}/images/{img_id}/retry` | Retry a single failed image. |
| POST | `/assessment/{id}/images/{img_id}/auto-answer` | RAG-driven auto-answer for one image. |

All mutating endpoints are gated by `require_assessment_owner`.

### 8.2 Auth router — `/auth`

| Method | Endpoint | Description |
|---|---|---|
| GET  | `/auth/google/login` | Redirect to Google consent screen. |
| GET  | `/auth/google/callback` | OAuth callback → issues local JWT, redirects to frontend. |
| POST | `/auth/register` | Email + password registration. |
| POST | `/auth/login` | Email + password login. |
| GET  | `/auth/admin` | Admin gate. |
| GET  | `/auth/profile` | Current user profile. |

Features: Google OAuth2 with optional email-domain restriction (`google_auth.allowed_domain`), JIT provisioning on first Google login, role assignment via `admin_users` config list.

### 8.3 Threat-modeling router — `/threat-model`

| Method | Endpoint | Description |
|---|---|---|
| GET  | `/threat-model/{id}/status` | Threat-modeling state. |
| POST | `/threat-model/{id}/start` | Kick off generation → PROCESSING. |
| GET  | `/threat-model/{id}/results/by-image` | Threats grouped per source image. |
| POST | `/threat-model/{id}/reanalyze` | Clear existing threats and re-run. |
| GET  | `/threat-model/{id}/export` | Export as CSV. |
| GET  | `/threat-model/{id}/export/pdf` | Export as PDF (fpdf2). |
| GET  | `/threat-model/{id}/usage` | LLM token + cost summary. |
| GET  | `/threat-model/{id}/surface-map/{image_id}` | Fetch Threat Modeller Inventory JSON. |
| PUT  | `/threat-model/{id}/surface-map/{image_id}` | Save / upsert inventory JSON. |
| DELETE | `/threat-model/{id}/surface-map/{image_id}` | Delete inventory row. |
| POST | `/threat-model/{id}/surface-map/{image_id}/generate` | LLM-generate a fresh inventory from the image + mermaid. |

### 8.4 Review router — `/reviews`

| Method | Endpoint | Description |
|---|---|---|
| GET  | `/reviews/assessments-under-review` | Assessments assigned to the current reviewer. |
| POST | `/reviews/{id}/assign-reviewers` | Assign reviewers. |
| GET  | `/reviews/reviewer-search` | Search users for reviewer picker. |
| GET  | `/reviews/{id}/reviewers` | Assigned reviewers + statuses. |
| POST | `/reviews/{id}/submit-review` | Submit approve / reject. |
| POST | `/reviews/{id}/approve` | Single-reviewer final approve. |
| POST | `/reviews/{id}/threats/{threat_id}/review` | Per-threat review. |
| POST | `/reviews/{id}/threats/bulk-review` | Bulk review. |

### 8.5 RAG router — `/rag`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/rag/{namespace}/{collection_id}/ingest` | Ingest a PDF into the vector DB. |
| POST | `/rag/{namespace}/{collection_id}/search` | KNN search with filters. |

### 8.6 Organization router — `/org`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/org/new` | Create organization. |
| GET  | `/org/all` | Paginated list. |

### 8.7 App router — `/app`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/app/onboard` | Create app under org. |
| GET  | `/app/all` | Paginated list. |

### 8.8 Application-onboarding router — `/app`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/app/onboarding` | Save responses. |
| GET  | `/app/onboarding/{app_id}` | Progress per category. |
| GET  | `/app/category/{cat_id}/name` | Category display name. |

### 8.9 Onboarding router — `/onboarding`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/onboarding` | Save org onboarding responses. |
| GET  | `/onboarding/{org_id}` | Org progress. |
| GET  | `/category/{cat_id}/name` | Category display name. |

### 8.10 Question router — `/questions`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET  | `/questions` | List by entity_type. | USER/ADMIN |
| GET  | `/questions/grouped` | Grouped by category. | USER/ADMIN |
| POST | `/questions` | Create question. | ADMIN |
| POST | `/questions/bulk` | Bulk create. | ADMIN |
| GET  | `/categories` | List categories. | USER/ADMIN |
| POST | `/categories` | Create. | ADMIN |
| PUT  | `/categories/{id}` | Update. | ADMIN |
| DELETE | `/categories/{id}` | Delete. | ADMIN |

### 8.11 Enum router

| Method | Endpoint | Description |
|---|---|---|
| GET | `/frameworks` | Threat frameworks. |
| GET | `/assessment-types` | Assessment types. |
| GET | `/all-enums` | Everything at once. |

### 8.12 Health-check router

| Method | Endpoint | Description |
|---|---|---|
| GET | `/healthcheck` | Returns 204 if DB is reachable. |

### 8.13 LLM-usage router — `/llm-usage`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/llm-usage/{assessment_id}` | Per-assessment usage. |
| GET | `/llm-usage/` | Aggregated across all assessments. |

---

## 9. Services (Business Logic)

All services are **class-based**, instantiated with a DB session per request.

### `AssessmentService` — [assessment_service.py](blancService/atm/services/assessment_service.py)

Central orchestrator. Key methods (non-exhaustive):

- `create_new_assessment(...)` — persist assessment + document rows, save uploads via `StorageBackend`, publish `IMAGE_ANALYSIS_PHASE_A` (or `..._FROM_MERMAID`) + `PDF_INGESTION` messages.
- `get_list(...)` / `delete_assessment(...)` / `get_progress(...)` / `get_status(...)`.
- `process_answers(...)` / `save_answers_draft(...)` — clarification workflow.
- `auto_answer_image(...)` — concurrent RAG-based answers per question.
- `continue_phase_b(...)` / `continue_image_phase_b(...)` — AWAITING_REVIEW → Phase B gate.
- `run_threat_modeling(...)` — publish `THREAT_MODELING` message.
- `get_threats_grouped_by_image(...)` / `reanalyze_threat_modeling(...)`.
- `retry_analysis_pipeline(...)` / `retry_single_image(...)`.

### `AuthService` — [auth_service.py](blancService/atm/services/auth_service.py)

- `get_role_by_email(...)` — resolves role from `admin_users` config.
- `get_or_create_google_user(...)` — JIT provisioning + role sync.

### `ApplicationService` — [application_service.py](blancService/atm/services/application_service.py)

- `save_responses(...)`, `get_app_progress(...)`, `get_category_name(...)`, `update_app_onboarding_status(...)`.

### `OnboardingService` — [onboarding_service.py](blancService/atm/services/onboarding_service.py)

- `save_responses(...)`, `get_org_progress(...)`, `get_category_name(...)`, `update_onboarding_status(...)`.

---

## 10. Core Processing Pipeline

### 10.1 Document analysis — `core/document_analysis.py`

Per-image LLM pipeline split into **two phases** with a user gate between them:

```
Phase A:  PENDING → PROCESSING (image → Mermaid → components) → AWAITING_REVIEW
                                                                    ↓  user "Next"
Phase B:  AWAITING_REVIEW → PROCESSING (summary + clarification) → RAG auto-answer →
                                        (NEEDS_INPUT | COMPLETED)
```

- **`IMAGE_ANALYSIS_PHASE_A`** — reads bytes, calls `image_to_mermaid` + `component_breakdown` skills.
- **`IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID`** — Studio flow: caller already supplied Mermaid text, so `image → mermaid` is skipped and only components are extracted from the diagram.
- **`IMAGE_ANALYSIS_PHASE_B`** — `high_level_summary` + `clarification_questions` skills run in parallel via `ThreadPoolExecutor`. Then per-question RAG search calls `auto_answer_clarification` concurrently.
- Terminal state per image is `NEEDS_INPUT` if any question is left unanswered, otherwise `COMPLETED`.

### 10.2 Threat modeling — `core/threat_modeling.py`

Assessment-level, multi-framework generator. The strategy pattern is expressed as a `FRAMEWORK_REGISTRY` of `ThreatFrameworkConfig` records:

| Framework | Categories | Response model | Skill |
|---|---|---|---|
| **STRIDE** | Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege | `StrideThreatModelResponse` | `stride_threat_modeling` |
| **BUSINESS_LOGIC** | Lifecycle & Orphaned Transitions, Sequential State Bypass, Missing Roles and Permission Checks, Replays of Idempotency Operations, Race Condition and Concurrency, Resource Quota Violations | `BusinessLogicThreatModelResponse` | `business_logic_threat_modeling` |

Adding a framework = one new entry in the registry (plus a Pydantic response model + skill file).

Pipeline entry points:

- `fetch_all_image_analyses(...)` — collect every `DocumentAnalysis` row.
- `merge_analysis_context(...)` — flatten multi-image data into a single prompt context, preserving per-image traceability.
- `_process_single_category(...)` — one LLM call per category (structured output + JSON-parse retry).
- `run_generic_analysis_pipeline(...)` — parallel execution across all categories in the registry.
- `store_threat_model_results(...)` — write to `assessment_results` with `image_id` traceability.
- `threat_modeling_pipeline(...)` — top-level orchestrator with state-machine transitions.

---

## 11. State Machine

**File:** [blancService/atm/core/state_machine.py](blancService/atm/core/state_machine.py)

Two independent transition maps enforced via `InvalidTransitionError`.

### 11.1 Per-image (`IMAGE_TRANSITIONS`)

```
PENDING           → {PROCESSING}
PROCESSING        → {AWAITING_REVIEW, NEEDS_INPUT, COMPLETED, FAILED}
AWAITING_REVIEW   → {PROCESSING, FAILED}       # user hits "Next" → Phase B
NEEDS_INPUT       → {COMPLETED}
COMPLETED         → {}                          # terminal for image
FAILED            → {PENDING}                   # retry resets
```

### 11.2 Assessment-level (`ASSESSMENT_TRANSITIONS`)

```
PENDING            → {PROCESSING}
PROCESSING         → {NEEDS_INPUT, COMPLETED, FAILED, REVIEW}
NEEDS_INPUT        → {COMPLETED}
COMPLETED          → {PROCESSING}               # "Run Threat Modeling"
FAILED             → {PENDING, PROCESSING}
REVIEW             → {APPROVED, CHANGES_REQUESTED, PROCESSING}
APPROVED           → {}                          # terminal
CHANGES_REQUESTED  → {REVIEW}
```

### 11.3 Key helpers

- `transition_image(db, assessment_id, image_id, new_state, new_stage, error_message)` — validates the image transition, then derives the assessment-level state.
- `transition_assessment(db, assessment_id, new_state, new_stage, error_message)` — direct assessment transition.
- `_sync_assessment_state(db, assessment_id)` — assessment state is derived from the aggregate of image states: any FAILED → FAILED; else any PROCESSING → PROCESSING; else any NEEDS_INPUT → NEEDS_INPUT; else any AWAITING_REVIEW → AWAITING_REVIEW; else all COMPLETED → COMPLETED.
- `get_image_states(db, assessment_id)` — snapshot for UI/debug.

---

## 12. Message Queue (RabbitMQ)

### 12.1 Task types — `queue/rmq_message.py`

```python
class TaskType(str, Enum):
    IMAGE_ANALYSIS_PHASE_A               # image → mermaid → components
    IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID  # skip image→mermaid, caller supplied mermaid text
    IMAGE_ANALYSIS_PHASE_B               # summary + clarification
    PDF_INGESTION                        # extract → chunk → ingest to vector DB
    THREAT_MODELING                      # multi-framework threat generation
```

`RMQMessage` fields: `task_type`, `assessment_id`, `image_id`, `image_path`, `pdf_path`, `filename`, `diagram_type`, `mermaid_text`, `retry_count`.

### 12.2 Producer — `queue/producer.py`

- Async publisher with connection fall-through across multiple hosts.
- Uses **non-robust** connections (fails fast; recovery is the caller's problem).
- Global pre-initialised producers per queue.
- **Fallback:** if RabbitMQ is unavailable, messages are dispatched to an in-process fallback queue for synchronous execution — the app stays functional without RMQ (dev convenience).

### 12.3 Consumer — `queue/consumer.py`

- Async consumer with prefetch (QoS) control.
- Retry via requeue with exponential backoff, capped at 3 attempts.
- Delivery count tracked via `x-delivery-count` and `x-death` headers.
- Exhausted retries → dead-letter queue + ACK.

### 12.4 Dispatcher — `queue/message_processing.py`

Routes `RMQMessage` to handlers based on `task_type`. CPU-bound handlers run via `asyncio.to_thread(...)`. Assessment context is propagated to LLM usage tracking.

### 12.5 Consumer orchestration — `queue/threaded_consumer_wrapper.py`

`ThreadedConsumerWrapper` implements the `ManagedEntity` interface. It spins up a thread pool with per-queue concurrency (configurable, default 10). Each thread owns an independent asyncio event loop and `Consumer` instance.

### 12.6 Custom thread pool — `queue/cancelable_thread_pool_exectuor.py`

`CancelableThreadPoolExecutor` extends `ThreadPoolExecutor`, tracks all futures, and exposes `clean_up()` for bulk cancellation on shutdown.

---

## 13. LLM Client

**Package:** [blancService/atm/core/llm_client/](blancService/atm/core/llm_client/)

Provider-abstracted client stack, replacing the old single-file `gpt_llm.py`.

### 13.1 Layers

| Layer | File | Role |
|---|---|---|
| Provider ABC | `base.py` | `LLMProvider`, `LLMMessage`, `LLMResponse`, `ContentBlock` |
| Facade | `client.py` | `LLMClient` bundling provider + attachments + usage + model resolution |
| Model resolution | `client.py` | `ModelResolver` maps a logical **purpose** (`"vision"`, `"threat_modeling"`, …) to a `ModelSpec` (name + pricing) |
| Assessment context | `client.py` | `set_assessment_context` / `get_assessment_context` backed by `contextvars.ContextVar` (works for sync + async) |
| Attachments | `attachments.py` | Local + remote attachment loaders, MIME sniffing |
| Auth | `auth.py` | Provider auth strategies (bearer / API key / OAuth) |
| Usage sink | `usage.py` | `UsageSink` + `UsageRecord`; `NullUsageSink` for testing |
| Providers | `providers/openai_provider.py`, `providers/litellm_provider.py` | Transport implementations |

### 13.2 Usage

```python
from atm.core.llm_client import get_llm_client, set_assessment_context

set_assessment_context(assessment_id)
client = get_llm_client()
response = client.parse_structured(
    system_prompt=...,
    user_prompt=...,
    response_model=StrideThreatModelResponse,
    images=[...],
    purpose="threat_modeling",
)
```

### 13.3 Usage tracking

Every call is logged to `llm_usage` with input / output / total tokens, computed cost via `ModelSpec` pricing, and `duration_ms`. Cost formula: `(input_tokens * prompt_rate + output_tokens * completion_rate) / 1_000_000`.

---

## 14. RAG (Retrieval-Augmented Generation)

**Package:** [blancService/atm/core/rag_client/](blancService/atm/core/rag_client/)

### 14.1 PDF extraction — `extractor.py`

- `extract_text_from_pdf_bytes(pdf_bytes)` → `List[(page_number, text)]` via PyMuPDF.
- `extract_images_from_pdf_bytes(pdf_bytes)` → images filtered by min width/height.

### 14.2 Chunking — `chunker.py`

- `generate_appsec_chunks(pages, assessment_id, source_file)` uses `RecursiveCharacterTextSplitter`.
- Metadata: `assessment_id`, `source_file`, `page_number`, `chunk_index`, `ingested_at`.
- Chunk id: `APPSEC-{doc_hash}-P{page}-C{chunk}-{content_hash}`.

### 14.3 Backends

Selected via factory:

- **`local`** — [local_vector_db.py](blancService/atm/core/rag_client/local_vector_db.py) — Chroma-backed on-disk store, uses [embeddings.py](blancService/atm/core/rag_client/embeddings.py) for local embedding.
- **`http`** — [vector_db.py](blancService/atm/core/rag_client/vector_db.py) — remote HTTP vector DB client with async operations, semaphore concurrency, 20-min ingest timeout / 1-min search timeout, automatic 100-chunk batching.

### 14.4 Factory — `factory.py`

Resolution order for `get_rag_client()`:

1. `ATM_RAG_BACKEND` env var.
2. `config.rag_config.backend` (default `"local"`).

Lookup order for the resolved name:

1. In-process registrations via `register_rag_backend(...)` (tests / DI).
2. Entry-point plugins in the `atm.rag_backends` group.
3. Built-ins: `local`, `http`.

Plugins expose `build(config: AppConfig) -> RAGBackend`.

Backend surface: `ingest_batch`, `search`, `search_by_assessment` — matches `VectorDBClient`.

---

## 15. Storage Backends

**Package:** [blancService/atm/core/storage/](blancService/atm/core/storage/)

Pluggable file storage abstraction. Every upload (images, PDFs) goes through this layer.

### 15.1 Interface — `base.py`

```python
class StorageBackend(ABC):
    def save(content, assessment_id, filename, original_filename="") -> StorageResult
    def read(stored_path) -> bytes
    def exists(stored_path) -> bool
    def delete(stored_path) -> bool
    def build_public_url(stored_path) -> str | None
```

`StorageResult` carries `stored_path`, `absolute_path`, `backend`, and (for remote backends) `public_url` / `document_id`.

### 15.2 Backends

- **`local_storage.py`** — writes under `config.storage.local_upload_dir` (default `uploads/`); served via the hardened `/uploads` static mount.
- **`s3_storage.py`** — writes to an S3 bucket configured in `S3Config`.

### 15.3 Factory — `factory.py`

Backend name comes from `config.storage.backend` (`"local"` or `"s3"`).

---

## 16. OCR

**Package:** [blancService/atm/core/ocr/](blancService/atm/core/ocr/)

PaddleOCR wrapper, kept **out of the request path** to avoid the multi-second cold-start.

- **`paddle_cli.py`** — standalone CLI that owns the PaddleOCR imports; defines model / output dir defaults.
- **`paddle_runner.py`** — in-process library wrapper (`extract_ocr_context(...)`) that returns the same JSON the CLI would write.
- Env override: `ATM_OCR_MODELS_DIR` to point at a prewarmed weights directory (baked image / mounted volume / test fixtures).
- PaddleOCR itself is imported lazily on first use — small-image flows that never touch OCR pay zero import cost.

---

## 17. Skills (Prompt System)

**Package:** [blancService/atm/skills/](blancService/atm/skills/)

Prompts are packaged as **skills** — Markdown files with YAML frontmatter (metadata) and a Markdown body (instructions). Loaded once and cached.

### 17.1 API

```python
from atm.skills import get_skill, list_skills

skill = get_skill("image_to_mermaid")
skill.name              # "image_to_mermaid"
skill.description       # ...
skill.version           # "1.3"
skill.input_vars        # ["diagram_type"]
skill.response_model_ref# "atm.api_schemas...:MermaidResponse" or None
prompt = skill.render(diagram_type="flowchart TD")
model_cls = skill.response_model()  # resolved Pydantic class, if declared
```

### 17.2 Plugin discovery

External packages can ship skills without touching this repo:

1. Set `ATM_SKILLS_DIRS` — `os.pathsep`-separated list of directories.
2. Register an entry point in the `atm.skills` group pointing at a module that exposes `skills_dir: str | Path` (or a callable returning one).

Resolution order (first hit wins): `ATM_SKILLS_DIRS` dirs → entry-point dirs → built-in `definitions/` dir.

Template variables use `string.Template` (`$var` / `${var}`) so literal `{`/`}` in JSON/Mermaid examples pass through untouched.

### 17.3 Built-in skills

| Skill | Purpose |
|---|---|
| `image_to_mermaid` | Convert architecture image → Mermaid diagram |
| `image_to_mermaid_auto` | Image → Mermaid without human hints (Studio auto-mode) |
| `high_level_summary` | 4–5 line architectural summary |
| `component_breakdown` | Components + trust level + data assets |
| `clarification_questions` | ≤ 20 security-assessment questions |
| `auto_answer_clarification` | Answer questions using RAG context |
| `stride_threat_modeling` | STRIDE threat generation |
| `business_logic_threat_modeling` | Business-logic vulnerability generation |
| `threat_analysis` | Generic framework-agnostic threat prompt |
| `surface_discovery` | Threat Modeller Inventory (surface map) generation |

---

## 18. Authentication & Authorization

**File:** [blancService/atm/core/auth/auth.py](blancService/atm/core/auth/auth.py)

- **Passwords** — Argon2 via `passlib` (`CryptContext`).
- **JWT** — HS256, expiry configurable (`jwt_config.access_token_expire_minutes`).
- **Deps** —
  - `get_current_user(token)` — extract + validate JWT → `User`.
  - `require_roles(*roles)` — role-based dependency factory (used by `question_router`, admin endpoints).
  - `require_assessment_owner` — used across `assessment_router`, `threat_modeling_router`, `llm_usage_router` to bind an assessment to the calling user.
- **Google OAuth2 flow** —
  1. `GET /auth/google/login` → redirect to consent screen.
  2. `GET /auth/google/callback` → exchange code, validate `hd` claim against `google_auth.allowed_domain`.
  3. JIT provisioning (`AuthService.get_or_create_google_user`) → assign role from `admin_users` config.
  4. Issue local JWT.
  5. Redirect to frontend with the JWT in a URL parameter.

---

## 19. CRUD Layer

### 19.1 `crud/assessment_crud.py`

`create_assessment_entry`, `create_document_entry`, `create_image_analysis_entry`, `get_assessment_by_id`, `get_assessments_by_user`, `get_analysis_by_assessment_id`, `get_analysis_by_image_id`, `get_threats_by_assessment_id`, `delete_assessment`, `update_analysis_clarifications`, etc.

### 19.2 `crud/application_crud.py`

App / question / progress helpers: `get_app`, `get_response`, `create_response`, `update_response`, `get_total_questions_by_category`, `count_answered_questions`, `get_progress`, `create_progress`, `update_progress_status`, `get_all_responses`, `get_question`, `get_category`, etc.

### 19.3 `crud/surface_map_crud.py`

Threat Modeller Inventory helpers:

- `get_surface_map(db, assessment_id, image_id)`
- `upsert_surface_map(db, assessment_id, image_id, payload: SurfaceMapPayload)` — creates or replaces the JSON blob.
- `delete_surface_map(db, assessment_id, image_id)`

---

## 20. Utilities

### 20.1 `util/managed_entity.py`

`ManagedEntity` ABC with `start()` / `stop()`; used by `ThreadedConsumerWrapper` and any other lifecycle-managed component wired into `FastapiEventEmitter`.

### 20.2 `util/file_sniff.py`

MIME / file-type detection used by the storage layer to safely categorise uploaded files.

### 20.3 `atm/utils.py`

`standard_response(status_code, message, data=None)` — the canonical `{status, message, data}` envelope wrapped in a `JSONResponse`.

---

## 21. End-to-End Flow

```
┌─── PHASE 1: Assessment creation ─────────────────────────────────────────────┐
│                                                                              │
│  POST /assessment/new                                                        │
│    ├─ Save images  via StorageBackend (uploads/{assessment_id}/input/…)      │
│    ├─ Save PDFs    via StorageBackend (uploads/{assessment_id}/docs/…)       │
│    ├─ Create Assessment row (state=PENDING, stage=INITIALIZING)              │
│    ├─ Create DocumentAnalysis row per image (state=PENDING)                  │
│    ├─ Create AssessmentDocument row per PDF                                  │
│    ├─ Publish IMAGE_ANALYSIS_PHASE_A (or ..._FROM_MERMAID) per image         │
│    └─ Publish PDF_INGESTION per PDF                                          │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 2a: Image analysis — Phase A (per image) ───────────────────────────┐
│  Consumer picks up IMAGE_ANALYSIS_PHASE_A                                    │
│    ├─ Stage IMAGE_PROCESSING     — image → Mermaid                           │
│    ├─ Stage COMPONENT_ANALYSIS  — component breakdown                        │
│    └─ transition_image → AWAITING_REVIEW    (pauses for user "Next")         │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 2b: PDF ingestion (parallel) ───────────────────────────────────────┐
│  Consumer picks up PDF_INGESTION                                             │
│    ├─ PyMuPDF extract text pages                                             │
│    ├─ Chunk (RecursiveCharacterTextSplitter)                                 │
│    └─ Ingest 100-chunk batches into RAG backend                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 3: User reviews Phase-A output, hits "Next" ────────────────────────┐
│  POST /assessment/{id}/continue           (all images)                       │
│  or   /assessment/{id}/images/{img_id}/continue                              │
│    └─ Publishes IMAGE_ANALYSIS_PHASE_B per promoted image                    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 4: Image analysis — Phase B ────────────────────────────────────────┐
│  Consumer picks up IMAGE_ANALYSIS_PHASE_B                                    │
│    ├─ Parallel (ThreadPoolExecutor):                                         │
│    │     ├─ SUMMARIZING     — high_level_summary skill                       │
│    │     └─ CLARIFICATION  — clarification_questions skill                   │
│    ├─ Concurrent RAG search + auto_answer_clarification per question         │
│    └─ transition_image →  NEEDS_INPUT (unanswered) or COMPLETED              │
│                                                                              │
│  Assessment-level state derived from all image states.                       │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 5: Clarification (if NEEDS_INPUT) ──────────────────────────────────┐
│  GET  /assessment/{id}/progress                                              │
│  POST /assessment/{id}/images/{img_id}/answer                                │
│  POST /assessment/{id}/images/{img_id}/auto-answer                           │
│  PUT  /assessment/{id}/images/{img_id}/save-answers        (draft only)      │
│                                                                              │
│  Once every image is COMPLETED, assessment → COMPLETED.                      │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 6: Threat modeling ─────────────────────────────────────────────────┐
│  POST /threat-model/{id}/start                                               │
│    ├─ transition_assessment → PROCESSING / THREAT_MODELING                   │
│    └─ Publish THREAT_MODELING                                                │
│                                                                              │
│  Consumer picks up THREAT_MODELING                                           │
│    ├─ Fetch all DocumentAnalysis rows                                        │
│    ├─ Merge context per image (with traceability)                            │
│    ├─ For each framework category (parallel):                                │
│    │     ├─ Render skill                                                     │
│    │     ├─ LLM call w/ structured-output parsing (retry on failure)         │
│    │     └─ Persist to assessment_results with image_id                      │
│    └─ transition_assessment → REVIEW                                         │
│                                                                              │
│  Read results:                                                               │
│  GET /threat-model/{id}/results/by-image                                     │
│  GET /threat-model/{id}/export        (CSV)                                  │
│  GET /threat-model/{id}/export/pdf    (PDF)                                  │
│  GET /threat-model/{id}/usage         (cost)                                 │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─── PHASE 7: Review & approval ───────────────────────────────────────────────┐
│  POST /reviews/{id}/assign-reviewers                                         │
│  GET  /reviews/assessments-under-review                                      │
│                                                                              │
│  Reviewer actions:                                                           │
│    ├─ Per-threat:   POST /reviews/{id}/threats/{tid}/review                  │
│    ├─ Bulk:         POST /reviews/{id}/threats/bulk-review                   │
│    ├─ Approve:      POST /reviews/{id}/approve       → APPROVED (terminal)   │
│    └─ Reject:       POST /reviews/{id}/submit-review → CHANGES_REQUESTED     │
│                                                       → re-assign → REVIEW   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 21.1 Composite state diagram

```
                       ┌──────────┐
     Assessment ──────▶│  PENDING │
     Created           └────┬─────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  PROCESSING  │  (per-image)
                     └──┬─────┬───┬──┬─────────┐
                        │     │   │  │         │
                        ▼     ▼   ▼  ▼         ▼
                  ┌──────────────┐ ┌──────────┐ ┌──────────┐
                  │AWAITING_     │ │COMPLETED │ │NEEDS_    │  … FAILED
                  │  REVIEW      │ └────┬─────┘ │  INPUT   │
                  └──────┬───────┘      │       └────┬─────┘
                         │ user Next    │            │ answer
                         ▼              │            ▼
                    (Phase B)           │       ┌──────────┐
                                        │       │COMPLETED │
                                        │       └────┬─────┘
                                        └────────────┤
                                                     │ "Run Threat Modeling"
                                                     ▼
                                             ┌──────────────┐
                                             │  PROCESSING  │
                                             │(THREAT_MODEL)│
                                             └───┬──────┬───┘
                                                 ▼      ▼
                                          ┌──────┐  ┌────────┐
                                          │FAILED│  │ REVIEW │
                                          └──────┘  └─┬────┬─┘
                                                      │    │
                                              approve │    │ reject
                                                      ▼    ▼
                                                ┌────────┐ ┌────────────────┐
                                                │APPROVED│ │CHANGES_        │
                                                │(final) │ │  REQUESTED     │
                                                └────────┘ └───────┬────────┘
                                                                    │ re-assign
                                                                    ▼
                                                               ┌────────┐
                                                               │ REVIEW │
                                                               └────────┘
```

---

## 22. Deployment

### 22.1 Dockerfile

See [blancService/Dockerfile](blancService/Dockerfile). Highlights: Python 3.12 slim, MariaDB client + build deps, non-root `atm` user (uid `10001`), `entrypoint.sh` wraps startup.

### 22.2 Compose

The root [docker-compose.yml](docker-compose.yml) brings up MariaDB, RabbitMQ, the API, and the Next.js studio. Config lives in [blancService/atm/config/docker.yml](blancService/atm/config/docker.yml) (copied from [docker.yml.example](blancService/atm/config/docker.yml.example)) and is mounted read-only into the API container.

### 22.3 Infrastructure

| Component | Details |
|---|---|
| **Python** | 3.12 |
| **MariaDB** | Any 10.6+; pool size / recycle from `db_conf` |
| **RabbitMQ** | Optional in dev — in-process fallback publishes tasks synchronously if RMQ is unavailable |
| **LLM** | Any OpenAI-compatible endpoint (OpenAI, LiteLLM proxy, Azure, self-hosted) |
| **RAG backend** | Local Chroma (default) or remote HTTP vector DB |
| **Storage** | Local filesystem (default) or S3 |
| **OCR** | PaddleOCR weights (optional) |

### 22.4 Environment variables

| Variable | Purpose |
|---|---|
| `ATM_CONFIG_PATH` | Absolute path to any YAML config (highest priority). |
| `ENV` | Selects `atm/config/<ENV>.yml` (default `config`; Compose uses `docker`). |
| `OPENAI_API_KEY` / provider-specific keys | LLM credentials (referenced by config). |
| `ATM_RAG_BACKEND` | Override `config.rag_config.backend` (`local` / `http` / plugin name). |
| `ATM_SKILLS_DIRS` | Extra skill-definition directories (path-separated). |
| `ATM_OCR_MODELS_DIR` | Override PaddleOCR weights location. |
| `FRONTEND_URL` | Used in CORS + OAuth redirects (also readable via `config.frontend.base_url`). |
| `http_proxy` / `https_proxy` | Proxy for outbound requests. |

### 22.5 Local development

```bash
cd blancService
python3.12 -m venv env
source env/bin/activate
pip install -r requirements.txt

# Ensure MariaDB is running (localhost:3306) with a database matching your config.
# RabbitMQ optional — the in-process fallback runs tasks inline if it's absent.

cp atm/config/config.yml.example atm/config/config.yml   # first-time setup
# Edit config.yml — API keys, JWT secret, admin_users, DB / RMQ, etc.

python3 main.py    # http://localhost:8000
```

The database schema is created automatically on first boot by `Base.metadata.create_all()`. Enum columns use `EnumAsString` (VARCHAR), so adding new enum members later needs no schema update.

---

## 23. Dependencies

See [blancService/requirements.txt](blancService/requirements.txt) for the fully-pinned list. Groups at a glance:

- **Web** — fastapi, uvicorn, starlette, pydantic v2, python-multipart, orjson
- **DB** — SQLAlchemy 2.x, mariadb
- **Queue** — aio-pika, aiormq
- **LLM** — openai, litellm, tiktoken, langchain-text-splitters
- **RAG** — chromadb (local backend), httpx (remote backend)
- **Auth** — PyJWT, passlib[argon2], argon2-cffi, google-auth, cryptography
- **Docs** — PyMuPDF (extraction), python-docx, fpdf2 (export)
- **OCR** — paddleocr, paddlepaddle (optional, lazy-loaded)
- **Storage** — boto3 (S3 backend)
- **Utilities** — PyYAML, colorlog, tenacity, requests, Pillow

---

*Generated from a walkthrough of the current codebase.*
