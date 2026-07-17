## Roadmap

Blanc is under active development. This page tracks what's already available, what's in progress, and where the project is heading. It is updated as features land - check the [GitHub repository](https://github.com/PhonePe/blanc) for the source of truth.

## Shipped

Capabilities you can use today, on `main`:

* **Multi-artifact ingestion** - architecture diagrams (PNG / JPG), sequence diagrams, C4 context diagrams, and PDFs (source docs and supporting docs). Includes a `/assessment/extract-pdf-images` helper for cherry-picking embedded images from a source PDF.
* **Blanc Studio** - draw diagrams directly in the browser using a Mermaid-backed editor, and hand them off to the pipeline without leaving the app.
* **Six-stage LLM pipeline** - `INITIALIZING` → `IMAGE_PROCESSING` → `SUMMARIZING` → `COMPONENT_ANALYSIS` → `CLARIFICATION` → `THREAT_MODELING`, with user-gated pause per image at the end of Phase A (mermaid + surface map) via `POST /assessment/{id}/continue`.
* **Surface Map / Threat Model Inventory** - persistent per-image inventory of components, trust boundaries, and environments, with per-field provenance so connector-supplied values never overwrite user edits. Editable live in the studio; served by `/threat_modeling/{id}/surface-map/{image_id}`.
* **STRIDE and Business Logic frameworks** - generate threats scoped to each framework's category set, with full provenance per threat.
* **Auto-answered clarifications** - Blanc uses your onboarding responses and the local RAG store to auto-answer clarification questions where it can, only escalating what it can't resolve. Re-run per image via `POST /assessment/{id}/images/{image_id}/auto-answer`.
* **OCR-backed diagram parsing** - PaddleOCR pre-processing for higher-fidelity component extraction. Ships on x86_64; disabled by default only in the Docker Compose stack on arm64 because PaddlePaddle's PIR loader segfaults there. Flip `BLANC_DISABLE_OCR` to `0` (and uncomment `platform: linux/amd64` in `docker-compose.yml` if you're on Apple Silicon with Rosetta) to enable it.
* **Reviewer workflow** - approve / reject / one review comment per threat, with two approval endpoints: `POST /reviews/{id}/submit-review` (all reviewers must approve) and `POST /reviews/{id}/approve` (any single reviewer suffices). Assessment state machine drives `PROCESSING → REVIEW → APPROVED / CHANGES_REQUESTED`. (`AWAITING_REVIEW` is a per-image state used during the Phase A pause, not an assessment-level one.)
* **Report exports** - CSV export (one row per threat, for import into ticketing / spreadsheets) via `GET /threat_modeling/{assessment_id}/export`, and PDF export (audit- and compliance-ready) via `GET /threat_modeling/{assessment_id}/export/pdf`.
* **Retry & recovery** - `POST /assessment/{id}/retry-analysis`, `POST /assessment/{id}/images/{image_id}/retry`, and `POST /threat_modeling/{id}/reanalyze`. On startup, the app re-publishes any RMQ tasks stuck at `PENDING` / `PROCESSING` within the last 24 h.
* **LLM Usage dashboard** - per-assessment breakdown by call type and model, served by `/llm-usage/*`.
* **RAG knowledge base admin** - ingest PDFs, search, and manage namespaces / collections via `/api/v1/{namespace}/{collection_id}/ingest` and `/search`, with a dedicated `/dashboard/rag` UI. Uploads capped at 25 MB; namespace / collection IDs are constrained to `[A-Za-z0-9_-]{1,64}`.
* **Onboarding-question CRUD** - admins customise the org / app questionnaire under **Dashboard → Admin → Questions**, backed by `/questions*` and `/categories*`.
* **Organization and Application management** - first-class org and app records with dedicated UIs and routers (`/dashboard/org`, `/dashboard/app`).
* **Cost auditing** - every LLM call is logged with token counts and cost so spend per assessment is fully auditable.
* **Local-first deployment** - one-command Docker Compose stack (MariaDB + RabbitMQ + FastAPI + Next.js) with configuration in a single YAML file. Config can be reloaded live via `POST /admin/reload_config` - no restart required.
* **Pluggable storage** - `local` filesystem or `s3` (AWS S3 or any S3-compatible store: MinIO, Cloudflare R2, Wasabi, Backblaze B2) via a single `storage.backend` switch. Third-party backends can be added at runtime via `register_storage_backend()` or via the `blanc.storage_backends` entry-point group.
* **Pluggable RAG** - in-process Chroma with a local Sentence-Transformers embedder by default, or point at a remote vector-DB via `backend: http`. Third-party backends can be added via `register_rag_backend()` or the `blanc.rag_backends` entry-point group.
* **Bring your own LLM** - any OpenAI-compatible endpoint works, so you can run Blanc against hosted OpenAI, a self-hosted vLLM / Ollama gateway, or a private-cloud model.
* **Google SSO** - optional Google OAuth sign-in gated via the `google_auth` block, requires `email_verified` on the ID token, with an `allowed_domain` guard.
* **Pluggable integrations** - connector interface for hydrating the surface map from org-owned systems (see `blanc/modules/Example.py`).

## In progress

No publicly-tracked in-progress work at the moment - features listed above are in `main` and considered shipped.

## Planned

Directions the project is heading. These are on the wishlist and are candidates for near-term work:

* **Additional frameworks** - PASTA and other risk-centric methodologies as first-class generators.
* **Markdown report export** - alongside the existing CSV and PDF exports, output threats in Markdown that can be fed directly into a coding agent's prompt.
* **Threaded review comments** - today each threat carries a single review comment that is overwritten on subsequent calls; a threaded discussion model is on the roadmap.
* **In-app admin promotion** - today the `ADMIN` role is driven exclusively by the `admin_users` YAML list; a UI-driven promote / demote flow is planned.
* **Threat library and custom prompts** - bring your own threat catalogues, custom prompts, and organisation-specific rules.
* **Custom RAG connectors** - first-class connectors for common design-doc sources (Confluence, Notion, internal wikis).
* **Feature versioning and diffing** - compare threat models across feature versions to surface newly-introduced risks.
* **Multi-tenant deployments** - richer org / team / project isolation for shared installations.
* **CI-friendly APIs** - trigger assessments and gate merges from CI pipelines.

## How to influence the roadmap

Blanc is open source and driven by feedback from the teams using it.

* **File an issue** on [GitHub](https://github.com/PhonePe/blanc/issues) describing the workflow you'd like Blanc to support.
* **Send a PR** - the codebase is intentionally small and well-scoped; a good first change is usually a new integration under `blanc/modules/`.
* **Share your assessments** - real-world examples of what Blanc gets right (and wrong) directly shape which pipeline stages we invest in next.
