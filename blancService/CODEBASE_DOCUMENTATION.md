# Blanc Service — Codebase Documentation

> **Blanc** — the FastAPI backend that powers the Blanc Studio. It ingests architecture / sequence / data-flow diagrams (plus optional supporting PDFs), runs a two-phase LLM analysis pipeline per image, auto-answers clarification questions via RAG, then generates framework-specific threats (STRIDE, Business Logic) with a full reviewer workflow.

**Repository:** <https://github.com/PhonePe/blanc>

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
24. [External Integrations Framework](#24-external-integrations-framework)

---

## 1. Architecture Overview

```
                           HTTP Clients (Studio + curl)
                                       │
                                       ▼
      ┌── FastAPI  (blanc/app.py — create_app() + lifespan) ─────────────┐
      │                                                                 │
      │  Middleware chain (LIFO):                                        │
      │    request_id  →  uploads_hardening  →  CORS                     │
      │                                                                 │
      │  ┌─ routers ─┬─ services ─┬─ crud ─┬── db_models ─┐              │
      │  │ 14 routes │  4 svcs    │  ~7    │ SQLAlchemy   │──▶ MariaDB   │
      │  └───────────┴────────────┴────────┴──────────────┘              │
      │        │                 │                                       │
      │  schemas/  (Pydantic DTOs at the HTTP boundary)                   │
      │  domain/enums.py  (str-Enum single source of truth)               │
      │                                                                 │
      │  Publish RMQMessage ─────────────┐                                │
      │                                  │                                │
      └──────────────────────────────────┼────────────────────────────────┘
                                         │
                                         ▼
                              ┌────────────────────┐
                              │      RabbitMQ      │◀── consumer × N (poll)
                              │  BLANC + BLANC_DLQ │
                              └──────────┬─────────┘
                                         │
                                         ▼
                       dispatch_task (TaskType routing)
                    ┌────────────────┬────────────────┬────────────────┐
                    ▼                ▼                ▼                ▼
             PHASE_A / _FROM_    PHASE_B        THREAT_MODELING    PDF_INGESTION
                MERMAID
                    │                │                │                │
                    ▼                ▼                ▼                ▼
             core/document_analysis (Phase A + B)   core/threat_modeling   RAG chunker
              ├─ image_to_mermaid       ├─ summary   ├─ framework registry  + Chroma
              ├─ component_breakdown    ├─ questions ├─ per-category fan-out    or
              └─ auto_populate_         │            └─ store threats + tie   remote
                 surface_map (writes    │              back to source images   HTTP
                 to surface_map table   │
                 via atomic upsert)     │
                    │                   │
                    └───────┬───────────┘
                            ▼
                    ┌──────────────────┐
                    │    LLM Client    │──▶ Skills (.md prompts) ──▶ OpenAI-compat
                    │  (openai/litellm)│                              endpoint
                    └────────┬─────────┘
                             │
                             ▼
                    usage sink ─▶ llm_usage table

  Startup: create_app() → lifespan → _recover_stuck_tasks()
    scans DocumentAnalysis rows in PENDING/PROCESSING (within 24h)
    and republishes RMQ messages so a mid-flight crash doesn't lose work.

  Cross-cutting: blanc/util/ (logging_context, ids, time, pagination,
    repositories) — dependency-light, imported by every layer.

  Auto-answer of clarification questions is *not* part of Phase B — it's
  a separate user-triggered endpoint:
    POST /assessment/{aid}/images/{iid}/auto-answer
  that queries RAG + LLM per remaining question.
```

### Request Flow Summary

1. **Assessment creation** — User uploads images (+ optional PDFs). Rows created for `Assessment`, one `DocumentAnalysis` per image, one `assessment_documents` row per PDF. `IMAGE_ANALYSIS_PHASE_A` (or `_FROM_MERMAID`) and `PDF_INGESTION` messages published to RabbitMQ.
2. **Image analysis — Phase A** — Consumer runs `image → Mermaid → surface_map (via `surface_discovery` skill, written atomically to `surface_map` table) + components`. Row transitions to `AWAITING_REVIEW`, pausing until the user hits **Next** in the Studio.
3. **Image analysis — Phase B** — On user continue, `IMAGE_ANALYSIS_PHASE_B` runs `summary + clarification questions`. Row ends in `NEEDS_INPUT` (if there are questions) or `COMPLETED` (if not). Assessment state is derived from all image states.
4. **Auto-answer (optional, user-triggered)** — Studio can call `POST /assessment/{aid}/images/{iid}/auto-answer` per image. For each unanswered clarification question, the endpoint pulls RAG hits (from any PDFs ingested in step 1) + the mermaid + the curated `surface_map` and asks the LLM to produce an answer or return `UNANSWERED`. Not part of Phase B — happens only when the user clicks the button.
5. **PDF ingestion (parallel)** — `PDF_INGESTION` messages extract text with PyMuPDF, chunk via LangChain splitters, embed, and upsert into the configured RAG backend (local Chroma by default, remote HTTP if configured). Independent of image Phase A/B — runs whenever a PDF was uploaded.
6. **Threat modeling** — User triggers per-framework generation. Multi-framework registry (STRIDE, BUSINESS_LOGIC) fans out parallel LLM calls per category, folding the `surface_map` inventory into the prompt so the LLM grounds threats in analyst-approved components. Results persisted with per-image traceability.
7. **Review** — Reviewers assigned; per-threat approve/reject/comment; assessment ends in `APPROVED` or `CHANGES_REQUESTED`.
8. **Every LLM call is logged** to `llm_usage` (tokens + estimated cost) via `set_assessment_context()` in `blanc/core/llm_client/client.py`, for per-assessment spend auditing.

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
├── main.py                          # Uvicorn entry — thin runner, imports blanc.app
├── Dockerfile                       # Container image
├── entrypoint.sh                    # Container entrypoint — verifies mounted config
├── requirements.txt                 # Python dependencies
├── CODEBASE_DOCUMENTATION.md        # (this file)
├── uploads/                         # Local file storage (bind-mounted in prod)
│
└── blanc/                           # Main application package
    ├── __init__.py
    ├── app.py                       # FastAPI app factory + lifespan handler
    ├── utils.py                     # standard_response helper
    │
    ├── domain/                      # Bottom-of-graph primitives (no I/O)
    │   ├── __init__.py
    │   └── enums.py                 # AssessmentState/Stage/Type, Framework,
    │                                # DiagramType, ReviewStatus — single source
    │                                # of truth, imported by db_models + schemas
    │
    ├── schemas/                     # Pydantic v2 request/response DTOs
    │   ├── __init__.py              # Re-exports commonly-used DTOs
    │   ├── assessment.py            # AssessmentCreate/Response, AnswerSubmission,
    │   │                            # ClarificationQuestion (enums live in domain/)
    │   ├── auth.py                  # UserCreate, UserOut, Token
    │   ├── org.py                   # OrgCreate
    │   ├── app.py                   # AppOnboardRequest/Response
    │   ├── onboarding.py            # ResponseItem, CategoryProgress + Org/App variants
    │   ├── rag.py                   # SearchRequest, IngestResponse
    │   ├── surface_map.py           # SurfaceMap payload models (was
    │   │                            # threat_modeling_schema.py)
    │   └── llm/                     # Structured LLM output schemas
    │       ├── __init__.py
    │       ├── analysis.py          # MermaidResponse, SummaryResponse,
    │       │                        # ComponentsResponse, QuestionsResponse
    │       └── threats.py           # CoreThreatAnalysis, Stride/BusinessLogic
    │                                # ThreatItem + ThreatModelResponse wrappers
    │
    ├── config/                      # YAML config files
    │   ├── config.yml               # Active native config (gitignored)
    │   ├── config.yml.example       # Native / bare-metal template
    │   ├── docker.yml               # Active docker config (gitignored, mounted)
    │   └── docker.yml.example       # Docker Compose template
    │
    ├── config_parsers/
    │   ├── config_models.py         # Pydantic AppConfig hierarchy
    │   ├── settings.py              # get_settings() + reload_settings() (@lru_cache)
    │   └── log_utils.py             # colorlog + attaches ambient context filter
    │
    ├── core/                        # Domain logic & pipelines
    │   ├── document_analysis.py     # Two-phase per-image LLM pipeline
    │   ├── state_machine.py         # Transition guards (image + assessment)
    │   ├── threat_modeling.py       # Multi-framework threat generation
    │   ├── auth/
    │   │   └── auth.py              # JWT + OAuth2 + role deps
    │   ├── integrations/            # Pluggable external-connector framework (see §24)
    │   │   ├── base.py              # SurfaceMapConnector ABC + ConnectorResult
    │   │   ├── registry.py          # @connector decorator + name registry
    │   │   ├── auth.py              # Header-template + token-source auth
    │   │   ├── http_runner.py       # httpx wrapper: retries, breaker, cache,
    │   │   │                        # semaphore, TLS verify, host allow-list
    │   │   ├── dispatcher.py        # Runtime hydrate() loop (Phase A end)
    │   │   ├── factory.py           # Build Dispatcher from AppConfig
    │   │   └── db_helpers.py        # update_surface_field with user-lock
    │   │                            # + provenance stamping
    │   ├── llm_client/              # Provider-abstracted LLM client
    │   │   ├── base.py              # LLMProvider / LLMMessage / LLMResponse ABCs
    │   │   ├── client.py            # LLMClient + set_assessment_context (binds
    │   │   │                        # log context automatically)
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
    │   │                            # (+ get_app_by_name, get_app_qna)
    │   ├── org_crud.py              # Org lookup + onboarding Q&A fetchers
    │   └── surface_map_crud.py      # Atomic upsert via INSERT ... ON DUPLICATE
    │                                # KEY UPDATE with retry on HA_ERR_RECORD_CHANGED
    │
    ├── db/
    │   └── database.py              # Engine, SessionLocal, Base,
    │                                # ensure_database_exists(), get_db(),
    │                                # get_db_session() ctx-mgr with rollback-on-error
    │
    ├── db_models/
    │   └── models.py                # SQLAlchemy tables + EnumAsString TypeDecorator
    │                                # (imports enums from blanc.domain.enums)
    │
    ├── queue/                       # RabbitMQ integration
    │   ├── cancelable_thread_pool_exectuor.py
    │   ├── consumer.py              # Async consumer with retry + DLQ
    │   ├── message_processing.py    # Task dispatcher; uses get_db_session()
    │   ├── producer.py              # Async producer with in-process fallback;
    │   │                            # QUEUE_NAME = "BLANC"
    │   ├── rmq_message.py           # RMQMessage + TaskType enum
    │   └── threaded_consumer_wrapper.py
    │
    ├── routers/                     # API endpoints
    │   ├── admin_router.py          # POST /admin/reload_config (ADMIN only)
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
    │   ├── assessment_service.py    # auto_answer_image also grounds on
    │   │                            # org + app onboarding Q&A (see §9)
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
    ├── modules/                     # External integrations (see §24)
    │   ├── __init__.py
    │   └── Example.py               # Reference SurfaceMapConnector — copy
    │                                # + rename to add your own
    │
    └── util/                        # Cross-cutting helpers (stateless, no I/O)
        ├── __init__.py              # Re-exports new_id, now_utc, get_or_404
        ├── ids.py                   # new_id() → UUIDv4 string
        ├── time.py                  # now_utc() → tz-aware UTC datetime
        ├── repositories.py          # get_or_404(db, Model, **filters)
        ├── pagination.py            # Page[T], PageParams, paginate(query, params)
        ├── logging_context.py       # bind_log_context / install_context_filter —
        │                            # request_id / assessment_id / image_id
        │                            # propagate to every log line via contextvars
        ├── file_sniff.py            # MIME sniffing / file type detection
        └── managed_entity.py        # Lifecycle interface (start/stop)
```

### Layering intent

The folder layout maps to a strict dependency direction: **routers → services → crud → db_models → domain**, with `schemas/` living at the HTTP boundary and `core/` used by services for I/O-bearing pipelines. Actual code still contains several direct DB queries from `routers/` and `core/` — those are being migrated toward the layered shape but aren't fully enforced yet.

```
routers/     HTTP boundary. Parse request, call service, format response.
services/    Application layer. Owns transactions. Orchestrates CRUD + core + queue.
core/        Domain logic + pipelines. LLM calls OK. Testable without a DB.
schemas/     Wire format (Pydantic). HTTP boundary only.
crud/        Thin data-access primitives — the intended-only home for db.query().
db_models/   SQLAlchemy tables.
domain/      Enums, value objects, framework-agnostic types.
```

---

## 4. Entry Point — `main.py` + `blanc/app.py`

**Files:**
- [blancService/main.py](blancService/main.py) — Uvicorn entry point. Thin runner.
- [blancService/blanc/app.py](blancService/blanc/app.py) — `create_app()` factory + FastAPI `lifespan` handler. All start/stop side effects live here.

### Why the split

`main.py` used to do everything at module import — start RMQ consumers, run DB bootstrap, mount routes. That meant `import main` in a test or CLI script tore up half your infrastructure. The factory pattern keeps `create_app()` idempotent and side-effect-free until uvicorn actually calls the lifespan handler.

```python
# main.py
from blanc.app import create_app
app = create_app()          # safe to import from anywhere
if __name__ == "__main__":
    uvicorn.run(...)         # only when actually serving
```

### `create_app()` responsibilities (blanc/app.py)

- Load config + configure logging via `get_settings()` and `LoggingConfig.configure_logging()`.
- Call `ensure_database_exists()` — runs `CREATE DATABASE IF NOT EXISTS` for the target schema. Used to fire at module import; now an explicit factory step.
- Call `Base.metadata.create_all(bind=engine)` — creates missing tables on first boot. `EnumAsString` (VARCHAR) is used everywhere state/status is stored, so adding new Python enum members requires no schema change.
- Ensure the local uploads directory exists **and** write-probe it (`tempfile.mkstemp` inside the dir) — aborts startup if unwritable so the first upload doesn't fail cryptically later.
- Install two `http` middlewares (registered LIFO, so request-id wraps everything):
  1. **`_request_id_middleware`** — reads inbound `X-Request-ID` or generates one, binds it into the ambient log context, echoes it back on the response.
  2. **`_harden_uploads_response`** — sets `nosniff`, `attachment`, `no-referrer` on anything under `/uploads/`.
- Install CORS middleware with an **explicit** allow-list (`localhost:3000`, `127.0.0.1:3000`, `config.frontend.base_url`).
- Register 14 routers (see below).
- Mount `/uploads` as a hardened static route.

### Lifespan handler responsibilities

- Start `ThreadedConsumerWrapper` (RabbitMQ consumers). Stored on `app.state.consumer_wrapper`.
- Run **startup recovery**: re-publish `IMAGE_ANALYSIS_PHASE_A`, `IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID`, or `THREAT_MODELING` messages for rows stuck in `PENDING` / `PROCESSING` within the last 24 h.

### Registered routers

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
| **Admin** (new) | `admin_router` — `POST /admin/reload_config` for hot-reloading config.yml without restart |

### `/uploads` hardening middleware

Anything served under `/uploads/` gets these headers to neutralise stored-XSS via uploaded `.svg` / `.html`:

- `X-Content-Type-Options: nosniff`
- `Content-Disposition: attachment` (forces download rather than inline render)
- `Referrer-Policy: no-referrer`

### Uvicorn dev-loop config (main.py)

`main.py` passes explicit reload filters to uvicorn:

```python
reload=True,
reload_dirs=["blanc"],
reload_includes=["*.py"],
reload_excludes=[
    "uploads/*", "data/*", "ocr_output/*",
    "env/*", "*.log", "*.write_probe*", ".blanc_write_probe_*",
],
```

Without these, every file uploaded to `uploads/` or every Chroma tick into `data/chroma/` would trip `WatchFiles` and reboot the server mid-consume — messages never got ack'd, tasks stuck in `PENDING`. The exclude list is deliberately narrow to keep genuine source-file reloads fast.

---

## 5. Configuration

### 5.1 Loader — `config_parsers/settings.py`

```python
from blanc.config_parsers.settings import get_settings
settings = get_settings()   # returns AppConfig, cached via @lru_cache
```

Resolution order (highest priority first):

1. `BLANC_CONFIG_PATH=/abs/path.yml` env var — absolute path to any YAML file.
2. `ENV=<name>` env var — reads `blanc/config/<name>.yml` (default `ENV=config` → `config.yml`; Docker Compose sets `ENV=docker` → `docker.yml`).

YAML supports environment-variable expansion: `${VAR}` and `${VAR:-fallback}`. Missing vars without a fallback raise a clear error. YAML is parsed with `yaml.safe_load`. Config errors cause `sys.exit(2)` so process supervisors treat them as failures.

### 5.2 Config models — `config_parsers/config_models.py`

All are Pydantic v2 `BaseModel` subclasses. The root is `AppConfig`:

| Model | Purpose |
|---|---|
| `AppConfig` | Root model containing every sub-config below |
| `FastApiConf` | `appHost`, `appPort`, `num_workers` |
| `Path` | Filesystem path settings |
| `OpenAIConfig` | `openai_url`, `model_name`, `provider`, `api_key`, etc. |
| `ModelConfig` | Per-purpose LLM model spec (name + rates). Overrides `openaiconfig.default` for a specific purpose. |
| `DefaultModelConfig` | The `(model_name, pricing)` pair used as fallback. Nested under `openaiconfig.default`. |
| `OpenApiConfig` | OpenAPI schema tweaks |
| `PricingConfig` | Default `prompt_cost_per_million`, `completion_cost_per_million` — always accessed via `openaiconfig.default.pricing`. |
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
| `IntegrationsConfig` | Pluggable connector registry — `auth` credentials, `connectors` instances, `field_sources` routing chains (see §24) |
| `AuthProfileConfig` | Named header credential (`header`, `value` with `${env:VAR}` / `${token:X}` templating) |
| `ConnectorConfig` | Per-connector transport config: `module`, `auth`, `url`, `timeout_s`, `cache_ttl_s`, `max_concurrent_requests`, `max_retries`, `keepalive_expiry_s`, `circuit_breaker_*`, `allowed_hosts`, `verify_ssl`, `extra` |

### 5.3 Logging — `config_parsers/log_utils.py` + `util/logging_context.py`

- `LoggingConfig.configure_logging()` applies the config from `AppConfig`, then calls `install_context_filter()` to attach an ambient-context filter to **every configured handler** (not just the root — some loggers set `propagate: no` and would otherwise skip the filter).
- Uses `colorlog.ColoredFormatter`. Format string now includes bound request/assessment/image ids:
  ```
  %(levelname)-8s %(filename)s:%(lineno)d [req:%(request_id)s aid:%(assessment_id)s img:%(image_id)s] - %(message)s
  ```
- Noisy loggers (`aio_pika`, `aiormq`, `httpx`, `httpcore`, `openai`) are suppressed to WARNING/ERROR.

### 5.4 Ambient log context — `util/logging_context.py`

Three `contextvars` — `request_id`, `assessment_id`, `image_id` — populated by:

- **Request middleware** (in `blanc/app.py`) — binds `request_id` for every HTTP request, honours inbound `X-Request-ID` header if the caller sent one, otherwise generates a fresh short UUID.
- **`set_assessment_context()`** in `blanc/core/llm_client/client.py` — called at the top of every RMQ handler and pipeline stage. Mirrors the id into both the LLM-usage tracker AND the log context, so every log line inside the handler carries the assessment id automatically.

No more copy-pasted `[{assessment_id}]` f-string prefixes in log calls. See the format string above for how the values appear.

### 5.5 Env-var overrides

All env-var toggles are prefixed with `BLANC_`:

| Var | Effect |
|---|---|
| `BLANC_CONFIG_PATH` | Absolute path to any YAML config (highest priority). |
| `ENV` | Names `blanc/config/<ENV>.yml`. Default `config`. `docker` inside compose. |
| `BLANC_LLM_API_KEY` | Fallback for the LLM key when `openaiconfig.api_key` is blank. |
| `BLANC_RAG_API_KEY` | Fallback for the RAG remote backend auth token. |
| `BLANC_LLM_PROVIDER` | Overrides `openaiconfig.provider` (`openai` / `litellm` / plugin). |
| `BLANC_RAG_BACKEND` | Overrides `rag_config.backend` (`local` / `http` / plugin). |
| `BLANC_STORAGE_BACKEND` | Overrides `storage.backend` (`local` / `s3`). |
| `BLANC_SKILLS_DIRS` | Extra skill-definition dirs (`os.pathsep`-separated). |
| `BLANC_OCR_MODELS_DIR` | Override PaddleOCR weights location. |

### 5.6 Hot reload of config

`POST /admin/reload_config` (ADMIN role required) clears the `@lru_cache` on `get_settings()` and re-reads YAML from disk. Note that some subsystems (LLM client, RAG client, RMQ) cache values off the config at construction time and won't pick up the change until the next call site rebuilds their singleton — for those, a full restart is still safer.

---

## 6. Database Models

**File:** [blancService/blanc/db_models/models.py](blancService/blanc/db_models/models.py)
**Engine / session:** [blancService/blanc/db/database.py](blancService/blanc/db/database.py) exposes `Base`, `engine`, `SessionLocal`, `ensure_database_exists()`, `get_db()` (FastAPI dep), and `get_db_session()` (context manager that rolls back on any exception).

### 6.1 `EnumAsString` TypeDecorator

Custom SQLAlchemy `TypeDecorator` that stores Python `enum.Enum` values as `VARCHAR(32)` — sidestepping MariaDB's `ENUM(...)` freeze-at-CREATE-TABLE problem. Reads round-trip back to the enum member, so `.state == AssessmentState.FAILED` still works. Adding a new enum member requires no schema change.

### 6.2 Enums live in `blanc/domain/enums.py`

Enums were previously duplicated across `db_models/models.py` and `api_schemas/assessment.py` — the copies drifted (`CHANGES_REQUESTED` existed in one, not the other). They're now defined **once** in [blancService/blanc/domain/enums.py](blancService/blanc/domain/enums.py), inheriting from `(str, Enum)` so:

- `json.dumps` gives you the string value, not `AssessmentState.PENDING`
- The `EnumAsString` TypeDecorator round-trips cleanly
- Pydantic v2 accepts them as request/response fields with no `use_enum_values` gymnastics

`db_models/models.py` re-imports them for legacy `from blanc.db_models.models import AssessmentState` call sites, but new code should reach for `blanc.domain.enums` directly.

```python
# blanc/domain/enums.py
class AssessmentType(str, Enum):
    SECURITY
    COMPLIANCE

class Framework(str, Enum):
    STRIDE
    BUSINESS_LOGIC

class DiagramType(str, Enum):
    SEQUENCE = "sequenceDiagram"
    FLOWCHART = "flowchart TD"
    C4CONTEXT = "C4Context"

class AssessmentState(str, Enum):
    PENDING
    PROCESSING
    AWAITING_REVIEW        # Phase A finished (mermaid + components), waiting for user "Next"
    NEEDS_INPUT            # Clarification questions outstanding
    COMPLETED
    FAILED
    REVIEW                 # Threats generated, in reviewer workflow
    APPROVED               # Terminal
    CHANGES_REQUESTED      # Reviewer rejected → back to REVIEW

class AssessmentStage(str, Enum):
    INITIALIZING
    IMAGE_PROCESSING
    SUMMARIZING
    COMPONENT_ANALYSIS
    CLARIFICATION
    THREAT_MODELING

class ReviewStatus(str, Enum):
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

Schemas live under `blanc/schemas/` (renamed from `blanc/api_schemas/api_v1/` — the version indirection wasn't in use). Enums are **not** in this package; they live in `blanc/domain/enums.py` (see §6.2).

### 7.1 Standard response — `blanc/utils.py`

```python
standard_response(status_code=200, message="OK", data={...})
# → JSONResponse({"status": 200, "message": "OK", "data": {...}}, status_code=200)
```

### 7.2 Package layout

```
blanc/schemas/
├── __init__.py       # Re-exports the ~25 most-used DTOs — `from blanc.schemas import AssessmentCreate`
├── assessment.py     # AssessmentCreate (+ as_form), AssessmentResponse,
│                     # AnswerSubmission, ClarificationQuestion
├── auth.py           # UserCreate, UserOut, Token (was auth_schema.py)
├── org.py            # OrgCreate
├── app.py            # AppOnboardRequest, AppOnboardResponse
├── onboarding.py     # ResponseItem, CategoryProgress + Org/App variants
├── rag.py            # SearchRequest, IngestResponse
├── surface_map.py    # SurfaceComponent, SurfaceBoundary, SurfaceEnvironment,
│                     # SurfaceMapPayload, SurfaceMapResponse
│                     # (was threat_modeling_schema.py)
└── llm/              # Structured LLM output schemas
    ├── __init__.py
    ├── analysis.py   # MermaidResponse, SummaryResponse,
    │                 # ComponentsResponse, QuestionsResponse,
    │                 # Component (shared)
    └── threats.py    # CoreThreatAnalysis + Stride/BusinessLogic
                      # ThreatItem + ThreatModelResponse wrappers
```

### 7.3 Assessment — `schemas/assessment.py`

Request / response DTOs (enums come from `blanc.domain.enums`):
- `AssessmentCreate` — multipart-form model with `as_form()` classmethod (kept on the model for import convenience, though it does couple the schema to FastAPI's `Form`).
- `AssessmentResponse` — bare-minimum state / stage transition response.
- `ClarificationQuestion`, `AnswerSubmission` — clarification workflow.

### 7.4 LLM outputs — `schemas/llm/`

Split by concern:

- **`llm/analysis.py`** — Phase A/B outputs from `blanc.core.document_analysis`:
  - `Component` — name, purpose, data assets, trust level (shared)
  - `MermaidResponse`, `SummaryResponse`, `ComponentsResponse`, `QuestionsResponse`
- **`llm/threats.py`** — Framework-specific threat schemas from `blanc.core.threat_modeling`:
  - `CoreThreatAnalysis` — shared base (Threat / Description / Impact / Likelihood / Mitigation)

| Framework | Item | Extra fields |
|---|---|---|
| STRIDE | `StrideThreatItem` | `Component`, `ThreatCategory` ∈ {Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege} |
| Business Logic | `BusinessLogicThreatItem` | `AbusedFeature`, `BusinessImpact`, `LogicFlawCategory`, … |

Wrapper responses: `StrideThreatModelResponse`, `BusinessLogicThreatModelResponse`. Dead helpers (`ThreatModelResponse[T]`, `AnyThreatItem`, `ThreatModelAnalysis`) were removed during the split — none had real callers.

### 7.5 Surface map — `schemas/surface_map.py`

`SurfaceComponent`, `SurfaceBoundary`, `SurfaceEnvironment`, `SurfaceMapPayload`, `SurfaceMapResponse` — surface map inventory payload. Serialised into `surface_map.surface_map` JSON column. Uses Pydantic v2 idiomatic `model_config = ConfigDict(populate_by_name=True)` for the trust_level/threat_level camelCase aliases.

### 7.6 Onboarding — `schemas/onboarding.py`

`ResponseItem` and `CategoryProgress` are shared bases; the org and app variants (`OnboardingRequest` / `AppOnboardingRequest`, `OnboardingProgressResponse` / `AppOnboardingProgressResponse`) add just the id-scope field. `AppResponseItem` and `AppCategoryProgress` are aliases kept for clients that still expect the old names.

### 7.7 Other

- `auth.py` — `UserCreate`, `UserOut`, `Token`.
- `rag.py` — `SearchRequest`, `IngestResponse`.
- `org.py` — `OrgCreate`.
- `app.py` — `AppOnboardRequest`, `AppOnboardResponse`.

Review payloads are still declared inline in [reviews.py](blancService/blanc/routers/reviews.py) — hasn't been extracted into a schema module yet.

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

### `AssessmentService` — [assessment_service.py](blancService/blanc/services/assessment_service.py)

Central orchestrator. Key methods (non-exhaustive):

- `create_new_assessment(...)` — persist assessment + document rows, save uploads via `StorageBackend`, publish `IMAGE_ANALYSIS_PHASE_A` (or `..._FROM_MERMAID`) + `PDF_INGESTION` messages.
- `get_list(...)` / `delete_assessment(...)` / `get_progress(...)` / `get_status(...)`.
- `process_answers(...)` / `save_answers_draft(...)` — clarification workflow.
- `auto_answer_image(...)` — concurrent RAG-based answers per question. **Also grounds on org + app onboarding Q&A**: resolves the `Org` and `App` by name (case-insensitive) via `org_crud` / `application_crud`, fetches every recorded response, formats them as compact `[category] Q → A` bullets (capped at 4 000 chars each via `_format_onboarding_qna`), and passes them to the `auto_answer_clarification` skill as `${org_context}` + `${app_context}`.
- `continue_phase_b(...)` / `continue_image_phase_b(...)` — AWAITING_REVIEW → Phase B gate.
- `run_threat_modeling(...)` — publish `THREAT_MODELING` message.
- `get_threats_grouped_by_image(...)` / `reanalyze_threat_modeling(...)`.
- `retry_analysis_pipeline(...)` / `retry_single_image(...)`.

### `AuthService` — [auth_service.py](blancService/blanc/services/auth_service.py)

- `get_role_by_email(...)` — resolves role from `admin_users` config.
- `get_or_create_google_user(...)` — JIT provisioning + role sync.

### `ApplicationService` — [application_service.py](blancService/blanc/services/application_service.py)

- `save_responses(...)`, `get_app_progress(...)`, `get_category_name(...)`, `update_app_onboarding_status(...)`.

### `OnboardingService` — [onboarding_service.py](blancService/blanc/services/onboarding_service.py)

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

- **`IMAGE_ANALYSIS_PHASE_A`** — reads bytes, calls `image_to_mermaid` + `component_breakdown` skills. When integrations are configured, `auto_populate_surface_map` also runs `Dispatcher.hydrate(...)` at the end of the phase to fill `SurfaceComponent.desc` / `.exposure` / `.environment` (and any other declared targets) from external systems. See §24.
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

**File:** [blancService/blanc/core/state_machine.py](blancService/blanc/core/state_machine.py)

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
- **Queue name is `BLANC`**.
- **Fallback:** if RabbitMQ is unavailable, messages are dispatched to an in-process fallback queue for synchronous execution — the app stays functional without RMQ (dev convenience).

### 12.3 Consumer — `queue/consumer.py`

- Async consumer with prefetch (QoS) control.
- Retry via requeue with exponential backoff, capped at 3 attempts.
- Delivery count tracked via `x-delivery-count` and `x-death` headers.
- Exhausted retries → dead-letter queue `BLANC_DLQ` + ACK.

### 12.4 Dispatcher — `queue/message_processing.py`

Routes `RMQMessage` to handlers based on `task_type`. CPU-bound handlers run via `asyncio.to_thread(...)`. Assessment context is propagated to LLM usage tracking. All handlers use `with get_db_session() as db:` for guaranteed rollback on error (was `SessionLocal() + try/finally: db.close()`).

### 12.5 Consumer orchestration — `queue/threaded_consumer_wrapper.py`

`ThreadedConsumerWrapper` implements the `ManagedEntity` interface. It spins up a thread pool with per-queue concurrency (default **2** — was `10` before, which spawned 40+ consumer connections per boot and risked exhausting the RabbitMQ connection pool). Each thread owns an independent asyncio event loop and `Consumer` instance. Raise if you know you have the LLM budget for higher throughput.

### 12.6 Custom thread pool — `queue/cancelable_thread_pool_exectuor.py`

`CancelableThreadPoolExecutor` extends `ThreadPoolExecutor`, tracks all futures, and exposes `clean_up()` for bulk cancellation on shutdown.

---

## 13. LLM Client

**Package:** [blancService/blanc/core/llm_client/](blancService/blanc/core/llm_client/)

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
from blanc.core.llm_client import get_llm_client, set_assessment_context

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

**Package:** [blancService/blanc/core/rag_client/](blancService/blanc/core/rag_client/)

### 14.1 PDF extraction — `extractor.py`

- `extract_text_from_pdf_bytes(pdf_bytes)` → `List[(page_number, text)]` via PyMuPDF.
- `extract_images_from_pdf_bytes(pdf_bytes)` → images filtered by min width/height.

### 14.2 Chunking — `chunker.py`

- `generate_appsec_chunks(pages, assessment_id, source_file)` uses `RecursiveCharacterTextSplitter`.
- Metadata: `assessment_id`, `source_file`, `page_number`, `chunk_index`, `ingested_at`.
- Chunk id: `APPSEC-{doc_hash}-P{page}-C{chunk}-{content_hash}`.

### 14.3 Backends

Selected via factory:

- **`local`** — [local_vector_db.py](blancService/blanc/core/rag_client/local_vector_db.py) — Chroma-backed on-disk store, uses [embeddings.py](blancService/blanc/core/rag_client/embeddings.py) for local embedding.
- **`http`** — [vector_db.py](blancService/blanc/core/rag_client/vector_db.py) — remote HTTP vector DB client with async operations, semaphore concurrency, 20-min ingest timeout / 1-min search timeout, automatic 100-chunk batching.

### 14.4 Factory — `factory.py`

Resolution order for `get_rag_client()`:

1. `BLANC_RAG_BACKEND` env var.
2. `config.rag_config.backend` (default `"local"`).

Lookup order for the resolved name:

1. In-process registrations via `register_rag_backend(...)` (tests / DI).
2. Entry-point plugins in the `blanc.rag_backends` group.
3. Built-ins: `local`, `http`.

Plugins expose `build(config: AppConfig) -> RAGBackend`.

Backend surface: `ingest_batch`, `search`, `search_by_assessment` — matches `VectorDBClient`.

---

## 15. Storage Backends

**Package:** [blancService/blanc/core/storage/](blancService/blanc/core/storage/)

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

**Package:** [blancService/blanc/core/ocr/](blancService/blanc/core/ocr/)

PaddleOCR wrapper, kept **out of the request path** to avoid the multi-second cold-start.

- **`paddle_cli.py`** — standalone CLI that owns the PaddleOCR imports; defines model / output dir defaults.
- **`paddle_runner.py`** — in-process library wrapper (`extract_ocr_context(...)`) that returns the same JSON the CLI would write.
- Env override: `BLANC_OCR_MODELS_DIR` to point at a prewarmed weights directory (baked image / mounted volume / test fixtures).
- PaddleOCR itself is imported lazily on first use — small-image flows that never touch OCR pay zero import cost.

---

## 17. Skills (Prompt System)

**Package:** [blancService/blanc/skills/](blancService/blanc/skills/)

Prompts are packaged as **skills** — Markdown files with YAML frontmatter (metadata) and a Markdown body (instructions). Loaded once and cached.

### 17.1 API

```python
from blanc.skills import get_skill, list_skills

skill = get_skill("image_to_mermaid")
skill.name              # "image_to_mermaid"
skill.description       # ...
skill.version           # "1.3"
skill.input_vars        # ["diagram_type"]
skill.response_model_ref# "blanc.schemas...:MermaidResponse" or None
prompt = skill.render(diagram_type="flowchart TD")
model_cls = skill.response_model()  # resolved Pydantic class, if declared
```

### 17.2 Plugin discovery

External packages can ship skills without touching this repo:

1. Set `BLANC_SKILLS_DIRS` — `os.pathsep`-separated list of directories.
2. Register an entry point in the `blanc.skills` group pointing at a module that exposes `skills_dir: str | Path` (or a callable returning one).

Resolution order (first hit wins): `BLANC_SKILLS_DIRS` dirs → entry-point dirs → built-in `definitions/` dir.

Template variables use `string.Template` (`$var` / `${var}`) so literal `{`/`}` in JSON/Mermaid examples pass through untouched.

### 17.3 Built-in skills

| Skill | Purpose |
|---|---|
| `image_to_mermaid` | Convert architecture image → Mermaid diagram |
| `image_to_mermaid_auto` | Image → Mermaid without human hints (Studio auto-mode) |
| `high_level_summary` | 4–5 line architectural summary |
| `component_breakdown` | Components + trust level + data assets |
| `clarification_questions` | ≤ 20 security-assessment questions |
| `auto_answer_clarification` | Answer clarification questions. Grounded in five sources (priority order): org onboarding Q&A, app onboarding Q&A, per-assessment RAG hits, curated surface map, mermaid. Returns exact string `UNANSWERED` when nothing supports an answer. |
| `stride_threat_modeling` | STRIDE threat generation |
| `business_logic_threat_modeling` | Business-logic vulnerability generation |
| `threat_analysis` | Generic framework-agnostic threat prompt |
| `surface_discovery` | Threat Modeller Inventory (surface map) generation |

---

## 18. Authentication & Authorization

**File:** [blancService/blanc/core/auth/auth.py](blancService/blanc/core/auth/auth.py)

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

App / question / progress helpers: `get_app`, `get_app_by_name` (case-insensitive, org-scoped when possible), `get_app_qna` (flat onboarding Q&A list for prompt grounding), `get_response`, `create_response`, `update_response`, `get_total_questions_by_category`, `count_answered_questions`, `get_progress`, `create_progress`, `update_progress_status`, `get_all_responses`, `get_question`, `get_category`, etc.

### 19.3 `crud/org_crud.py`

Org lookup + onboarding fetchers. Prior to this module the only `Org` lookups were inline `db.query(Org)` calls in the org router; auto-answer needed to resolve `Assessment.org_name` (a plain string, no FK today) back to an `Org.id` in order to load the org's onboarding Q&A, so the queries were centralised here.

- `get_org_by_id(db, org_id)`
- `get_org_by_name(db, name)` — case-insensitive exact match. Warns on ambiguity (org names are supposed to be unique) and returns the first match.
- `get_org_qna(db, org_id)` — flat `[{category, question, answer}, ...]` for prompt-time grounding. Empty answers dropped.

### 19.4 `crud/surface_map_crud.py`

Threat Modeller Inventory helpers:

- `get_surface_map(db, assessment_id, image_id)`
- `upsert_surface_map(db, assessment_id, image_id, payload: SurfaceMapPayload)` — atomic upsert via `INSERT ... ON DUPLICATE KEY UPDATE` with **retry-on-conflict**.
- `delete_surface_map(db, assessment_id, image_id)`

The `upsert_surface_map` implementation catches MariaDB's `HA_ERR_RECORD_CHANGED` (message: `"Record has changed since last read in table 'surface_map'"`), rolls back, and retries up to 4 times with backoff (50 ms → 150 ms → 400 ms). The error surfaces from InnoDB when a unique-key probe races another transaction's row lock during a concurrent write to the same `(assessment_id, image_id)` pair — retrying with a fresh transaction snapshot resolves it because the racing writer has committed by then. Any other operational error propagates immediately.

### 19.5 Session lifecycle

CRUD functions accept a `Session` — they don't own the transaction. Callers use one of:

- `Depends(get_db)` from a FastAPI route — request-scoped session with rollback-on-exception.
- `with get_db_session() as db:` from a background task / RMQ handler / CLI script — same rollback semantics via a context manager.

All 14 formerly-raw `SessionLocal() … try/finally: db.close()` blocks in `core/` and `queue/` were migrated to `get_db_session()` — no more unbalanced `commit()`s masking the real error behind `PendingRollbackError`.

---

## 20. Utilities

Everything in `blanc/util/` is dependency-light and stateless — no I/O, no DB, no LLM. Helpers that need those live in `services/` or `core/`. The package `__init__.py` re-exports the three most-used ones so callers can `from blanc.util import new_id, now_utc, get_or_404`.

### 20.1 `util/ids.py`

`new_id() -> str` — one call site for UUIDv4 generation. Replaces ~20 scattered `str(uuid.uuid4())` calls; makes future format changes (dashed → hex, UUIDv7, ULID) a one-file edit.

### 20.2 `util/time.py`

`now_utc() -> datetime` — timezone-aware UTC datetime. Wraps `datetime.now(timezone.utc)` to hide the Python 3.13 deprecation of `datetime.utcnow()` and centralize "what time is it" across the codebase.

### 20.3 `util/repositories.py`

`get_or_404(db, Model, **filters) -> Model` — the check-then-raise-HTTP-404 pattern was hand-rolled in 11+ places. Now:

```python
assessment = get_or_404(db, Assessment, assessment_id=aid)
```

Every 404 message uses the same shape (`"Assessment not found"`), and if we ever add a soft-delete guard it lives in one file.

### 20.4 `util/pagination.py`

`Page[T]`, `PageParams`, `paginate(query, params)` — no endpoint currently paginates; this exists so the first one that needs it can adopt in a few lines.

```python
@router.get("/assessment", response_model=Page[AssessmentResponse])
def list_assessments(
    params: PageParams = Depends(PageParams.from_query),
    db: Session = Depends(get_db),
):
    q = db.query(Assessment).order_by(Assessment.created_at.desc())
    return paginate(q, params)
```

Runs one `COUNT()` + one `LIMIT/OFFSET SELECT`. For large tables consider a keyset variant later — not implemented yet because no current list crosses ~1k rows.

### 20.5 `util/logging_context.py`

`bind_log_context(**kwargs)` / `clear_log_context()` / `install_context_filter()` — ambient log context via `contextvars`. See §5.3–5.4 for how it's wired. Because it's `contextvars`-based, values are automatically per-async-task and per-thread — no cross-request bleed.

Adding a new bindable key means adding a new `ContextVar` and adding the key to `_KNOWN_KEYS` (and the log format string in the YAML). Currently: `request_id`, `assessment_id`, `image_id`.

### 20.6 `util/managed_entity.py`

`ManagedEntity` ABC with `start()` / `stop()`; used by `ThreadedConsumerWrapper` and any other lifecycle-managed component.

### 20.7 `util/file_sniff.py`

MIME / file-type detection used by the storage layer to safely categorise uploaded files.

### 20.8 `blanc/utils.py`

`standard_response(status_code, message, data=None)` — the canonical `{status, message, data}` envelope wrapped in a `JSONResponse`. Lives at the package root (not under `util/`) because it's used by every router.

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

See [blancService/Dockerfile](blancService/Dockerfile). Highlights: Python 3.12 slim, MariaDB client + build deps, non-root `blanc` user (uid `10001`), `entrypoint.sh` wraps startup. The image ships with app code + PP-OCRv6 weights (under `blanc/core/ocr/ocr_models/`) but **not** with a `docker.yml` — the entrypoint expects it mounted from the host.

### 22.2 Compose — single-YAML config, no .env

The root [docker-compose.yml](docker-compose.yml) brings up MariaDB, RabbitMQ, the API, and the Next.js studio. Bootstrap:

```bash
cp blancService/blanc/config/docker.yml.example blancService/blanc/config/docker.yml
# edit docker.yml — set openaiconfig.api_key, jwt_config.secret_key, admin_users
docker compose up --build
```

The host `docker.yml` is bind-mounted read-only into the API container at `/app/blanc/config/docker.yml`. The entrypoint refuses to boot if:

- The file is missing (Docker would silently create it as an empty **directory** otherwise — a genuine footgun that killed the api container for a full day before we caught it).
- `openaiconfig.api_key` still equals `sk-REPLACE_ME`.
- `jwt_config.secret_key` still equals the placeholder.

Named volumes persist uploads (`api_uploads` → `/app/uploads`) and the local Chroma store (`api_chroma` → `/app/data/chroma`) across `docker compose down` / `up` cycles.

**Infra credentials** for MariaDB and RabbitMQ are hardcoded in `docker-compose.yml` (default `blanc/blanc/blanc` and `guest/guest`) and match the connection strings in `docker.yml.example`. Change both sides together if you want to rotate.

### 22.3 Infrastructure

| Component | Details |
|---|---|
| **Python** | 3.12 (paddleocr wheels are 3.10-3.12 only; `native-build.sh` fails fast on 3.13+) |
| **Node.js** | 20+ (studio) |
| **MariaDB** | Any 10.6+; pool size / recycle from `db_conf` |
| **RabbitMQ** | Optional in dev — in-process fallback publishes tasks synchronously if RMQ is unavailable |
| **LLM** | Any OpenAI-compatible endpoint (OpenAI, LiteLLM proxy, Azure, self-hosted) |
| **RAG backend** | Local Chroma (default) or remote HTTP vector DB |
| **Storage** | Local filesystem (default) or S3 |
| **OCR** | PaddleOCR PP-OCRv6 weights (shipped in-tree) |

### 22.4 Environment variables

See §5.5 for the full `BLANC_*` env-var override list. In deployment specifically:

| Variable | Purpose |
|---|---|
| `BLANC_CONFIG_PATH` | Absolute path to any YAML config (highest priority). Set by the Docker entrypoint. |
| `ENV` | Selects `blanc/config/<ENV>.yml`. Default `config`; Compose sets `docker`. |
| `OPENAI_API_KEY` / provider-specific keys | LLM credentials (fallback for when `openaiconfig.api_key` is blank in the YAML). |
| `FRONTEND_URL` | Used in CORS + OAuth redirects (also readable via `config.frontend.base_url`). |
| `http_proxy` / `https_proxy` | Proxy for outbound requests. |

### 22.5 Local development (native, no Docker)

Two convenience scripts at the repo root:

- **`./native-build.sh`** — verifies Python 3.12 + Node 20, creates the venv, `pip install`s, checks OCR imports, bootstraps `blanc/config/config.yml` from the example. Idempotent.
- **`./native-run.sh`** — starts the backend (`ENV=config python3 main.py`) and the studio (`npm run dev`) with the correct env vars exported. `Ctrl+C` tears both down.

Or manually:

```bash
cd blancService
python3.12 -m venv env
source env/bin/activate
pip install -r requirements.txt

# Ensure MariaDB is running (localhost:3306) with a database matching your config.
# RabbitMQ optional — the in-process fallback runs tasks inline if it's absent.

cp blanc/config/config.yml.example blanc/config/config.yml
# Edit config.yml — API keys, JWT secret, admin_users, DB / RMQ, etc.

python3 main.py    # http://localhost:8000
```

The database schema is created automatically on first boot by `ensure_database_exists()` + `Base.metadata.create_all()`. Enum columns use `EnumAsString` (VARCHAR), so adding new enum members later needs no schema update.

### 22.6 Startup recovery

`_recover_stuck_tasks()` in `blanc/app.py` runs inside the lifespan handler. It scans `DocumentAnalysis` and `Assessment` rows in `PENDING` / `PROCESSING` state whose `created_at` / `updated_at` is within the last 24 h, then re-publishes the appropriate RMQ task type. Rows older than 24 h are ignored (safety cap so ancient abandoned assessments don't get resurrected). Older rows can be retried explicitly via `POST /assessment/{aid}/retry-analysis`.

Rows with `image_path=""` **and** a stored `flow_diagram.mermaid` are recognised as Blanc-Studio (mermaid-mode) rows and republished as `IMAGE_ANALYSIS_PHASE_A_FROM_MERMAID`. Rows with no image path **and** no stored mermaid are marked `FAILED` (they're unrecoverable — no source data to analyse).

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

## 24. External Integrations Framework

**Package:** [blancService/blanc/core/integrations/](blancService/blanc/core/integrations/)
**Reference connector:** [blancService/blanc/modules/Example.py](blancService/blanc/modules/Example.py)
**Config:** `integrations:` block in `config.yml` — see `config.yml.example` for a fully-commented template

Pluggable connectors that hydrate `SurfaceMap` fields from org-owned upstream systems (docs indexes, service catalogs, AI agents, custom REST APIs) **before** threat modelling runs. Zero connectors configured = zero external calls; the framework is a no-op unless a connector is wired up.

### 24.1 Why this exists

`SurfaceComponent` has a handful of fields (`desc`, `exposure`, `environment`, `authn`, `authz`, …) that an analyst would normally type in by hand. In most orgs that information already lives somewhere — a wiki, a service registry, an internal AI assistant. The integrations framework lets an org plug its own upstream into Blanc so those fields are auto-filled at the end of Phase A, before the user opens the Threat Modeller Inventory UI.

### 24.2 Layers

| Layer | File | Role |
|---|---|---|
| Base contract | `base.py` | `SurfaceMapConnector` ABC (three methods: `get_api_calls`, `parse_response`, `db_operations`). `ConnectorResult` DTO carrying `value` + `source_ref`. |
| Registry | `registry.py` | `@connector` decorator. Class-level `name` attribute is the registry key AND the YAML entry key. |
| Auth | `auth.py` | Header-template auth. Supports `${env:VAR}` (resolved at request time) and `${token:X}` (resolved via a startup-registered callable, cached with 60 s refresh margin). |
| HTTP runner | `http_runner.py` | httpx wrapper: retries on `TransportError` + `RemoteProtocolError` with `wait_exponential_jitter`, TTL response cache, semaphore, host allow-list (SSRF guard), circuit breaker, `verify_ssl: true \| false \| "/path/to/ca.pem"`, short `keepalive_expiry` to avoid stale-socket reuse against fragile upstreams. |
| Dispatcher | `dispatcher.py` | `hydrate(surface_map, assessment_id, image_id)` — for each `field_sources` entry, fans out per-entity concurrent calls to the ordered connector chain. First non-null result wins. Uses `ContextVar` to plumb `(assessment_id, image_id)` into `db_helpers` without threading it through every method. |
| Factory | `factory.py` | `build_dispatcher(cfg)` — imports every declared connector module (triggering the `@connector` decorator), builds one `HttpRunner` + `Auth` per connector, logs dead-reference warnings for `field_sources` entries pointing at unknown / non-supporting connectors. |
| DB helpers | `db_helpers.py` | `update_surface_field(entity_id, kind, field, value, provider, source_ref)` — respects user-lock (`sources[<field>].provider == "user"` → silently drops) and stamps provenance on every write. |

### 24.3 YAML shape

Read this block **top-down like a story**:

```
integrations:
  field_sources:   { ... }   # What targets need filling, and by whom (in order).
  connectors:      { ... }   # The upstreams referenced above — transport concerns only.
  auth:            { ... }   # Named credential profiles referenced by each connector.
```

Start from `field_sources` (routing), work down to `connectors` (what each name means), end at `auth` (how it authenticates). YAML dict order doesn't affect parsing, so this is purely a readability choice.

```yaml
integrations:

  # 1. Routing — which connector(s) fill which target, in fallback order.
  # First non-null result wins. Empty / omitted target = left alone.
  # Reserved key prefixes:
  #   component.<field>  — hydrated per component during Phase A
  #   boundary.<field>   — hydrated per trust boundary during Phase A
  field_sources:
    "component.desc":        [Example]
    # "component.exposure":    [Example]
    # "component.environment": [Example]

  # 2. Connector instances referenced above.
  # Key must match the class `name` attribute (here: `Example` →
  # `blanc.modules.Example`). Only transport concerns live here —
  # prompts / models / retriever names belong in the connector class.
  connectors:
    Example:
      module: blanc.modules.Example
      auth:   example_bearer                     # ← references auth block below
      url:    "https://your-agent-endpoint.example.com/ask"
      verify_ssl: true
      timeout_s: 60
      cache_ttl_s: 3600
      max_concurrent_requests: 4
      max_retries: 3
      keepalive_expiry_s: 5
      circuit_breaker_failures: 5
      circuit_breaker_cooldown_s: 60
      allowed_hosts:
        - "your-agent-endpoint.example.com"
      # Optional per-deployment override of the vendor model alias:
      # model: "your-model-alias"

  # 3. Named credentials referenced by each connector's ``auth`` field.
  # ${env:VAR}   → resolved from os.environ at request time
  # ${token:X}   → resolved via register_token_source("X", fn) at startup
  auth:
    example_bearer:
      header: "Authorization"
      value:  "Bearer ${env:EXAMPLE_API_TOKEN}"
```

### 24.4 Runtime flow

1. **App startup** — `create_app()` builds a single `Dispatcher` via `factory.build_dispatcher(get_settings())` and caches it on `app.state.integrations_dispatcher`. RMQ consumers reuse the same instance via a lazy module-level singleton in `core/document_analysis.py` so HTTP clients, TTL caches, and circuit-breaker state survive across every image and assessment.
2. **Phase A end** — `auto_populate_surface_map(...)` seeds the row if missing, then always runs `dispatcher.hydrate(payload, assessment_id, image_id)`. Re-runs are safe because `update_surface_field` respects user-lock and `HttpRunner` deduplicates via the TTL cache.
3. **Per entity × target** — the dispatcher iterates `field_sources`, resolves `kind` (`component` / `boundary`), and fans out `_run_chain(target, chain, entity)` tasks concurrently via `asyncio.gather(..., return_exceptions=True)`. A raise in one connector does not cancel siblings.
4. **Per chain** — connectors are tried in declared order. A connector that returns `None` (empty / sentinel / unmapped enum) is a fall-through, not a failure. Once one returns a `ConnectorResult`, its `db_operations` writes the field and stamps `sources[<field>] = FieldSource(provider=..., source_ref=...)`, and the chain stops.
5. **User-lock** — if a user has already edited the field in the Threat Modeller Inventory, `sources[<field>].provider == "user"` and the framework write is silently dropped. The user is always the authority.

### 24.5 Guardrails baked into `HttpRunner`

- **TLS verification** — `verify_ssl: true` (default), `false` (curl -k equivalent), or a path to a PEM bundle for private CAs.
- **Host allow-list** — `allowed_hosts` is a hard SSRF guard; anything else raises `HostNotAllowed` before the socket opens.
- **Concurrency cap** — `max_concurrent_requests` semaphore across every request the connector sends during one dispatcher sweep.
- **TTL response cache** — keyed by `(method, url, body[:512])`. Zero disables. Deduplicates repeat lookups within one hydration.
- **Circuit breaker** — trips after N consecutive failures, stays open for a cooldown window. Requests during that window raise `CircuitOpenError` without hitting the wire.
- **Retry** — `AsyncRetrying` with `stop_after_attempt(max_retries)` + `wait_exponential_jitter`, filtered to `httpx.TransportError | RemoteProtocolError` only. 4xx responses are NOT retried (client bug).
- **Short keepalive** — `keepalive_expiry_s` defaults to 5. Prevents httpx from reusing half-closed sockets after an upstream's idle timeout.
- **Response byte cap** — `max_response_bytes` guards against a runaway upstream flooding memory.

### 24.6 Provenance & audit

Every successful write stamps `SurfaceComponent.sources[<field>] = FieldSource(provider=<connector name>, source_ref=<upstream id>, updated_at=<ts>)`. The Threat Modeller Inventory UI renders this as a "🔗 `<connector>` · `<when>`" chip next to the field, and a hypothetical future reconciler can compare precedence across providers.

### 24.7 Adding a new connector

Three files, no framework changes:

1. **Class** — `blanc/modules/<YourConnector>.py`. Copy `Example.py`, rename the class, set `name = "<YourConnector>"`, and rewrite `get_api_calls` / `parse_response` to match your upstream's wire format.
2. **Config** — one entry under `integrations.connectors` in `config.yml` plus the target routing under `field_sources`.
3. **Auth (optional)** — one entry under `integrations.auth` if the connector needs a header that isn't already declared.

The registry auto-discovers the class the first time the module is imported (via the `@connector` decorator), so `factory.build_dispatcher` picks it up at boot without any explicit registration.

### 24.8 Example connector — `blanc/modules/Example.py`

Reference implementation you can copy. Wire format documented in the module docstring:

```
POST  {url}
Authorization: Bearer <token>              (from auth profile)
Content-Type: application/json

Request:
    {"prompt": "What is Kafka?",
     "model":  "example-model",
     "max_tokens": 400}

Response (200 OK):
    {"id":    "resp_a1b2c3d4",             # stamped into source_ref
     "text":  "Kafka is a distributed streaming platform ...",
     "usage": {"input_tokens": 42, "output_tokens": 87}}
```

The connector ships a parser toolkit (`_text`, `_enum`, `_clean_answer`) that handles the common LLM-proxy oddities: markdown emphasis, trailing `**Sources:**` blocks, hard-break whitespace, enum answers buried in prose (`internet-facing` → `Public`, `production` → `prod`, etc.). Reuse them in your own connector if the upstream is another LLM proxy.

---

*Generated from a walkthrough of the current codebase.*
