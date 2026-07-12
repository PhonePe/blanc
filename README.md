![Blanc](assets/blanc.svg)

<div align="center">

### AI powered Threat Modeling Studio that identifies threats in your design artifacts, the output of which can be directly passed to your coding agent's prompt during development.

<em>Blanc takes architecture diagrams, sequence diagrams and design documents as inputs and identifies threats. </em>

<br/>

[![License](https://img.shields.io/badge/License-Apache%202.0-FFFFFF?style=for-the-badge&labelColor=555555)](LICENSE)
[![Stars](https://img.shields.io/github/stars/blanc-project/blanc?style=for-the-badge&logo=github&logoColor=FFFFFF&color=FFFFFF&labelColor=555555&cacheSeconds=300)](https://github.com/blanc-project/blanc/stargazers)
![Open issues](https://img.shields.io/github/issues/blanc-project/blanc?style=for-the-badge&color=FFFFFF&labelColor=555555)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-FFFFFF?style=for-the-badge&labelColor=555555)
<!-- 
[![Join Discord](https://img.shields.io/badge/Join-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=FFFFFF&labelColor=555555)](https://discord.gg/)
&nbsp;
[![Read the Docs](https://img.shields.io/badge/Read-the%20Docs-FFFFFF?style=for-the-badge&logo=readthedocs&logoColor=FFFFFF&labelColor=555555)](blancService/CODEBASE_DOCUMENTATION.md) -->

<br/>

**[Quick Start](#quick-start)** · **[Why Blanc](#why-blanc)** · **[Framework Coverage](#framework-coverage)** · **[How It Works](#how-blanc-works)** · **[Docs](blancService/CODEBASE_DOCUMENTATION.md)**

</div>

**Blanc.** is an open-source threat modeling studio that helps security and engineering teams identify threats directly from design-level engineering artifacts.

*By parsing architecture diagrams, sequence diagrams, data flow diagrams, and supporting design documents, Blanc. analyzes system interactions, trust boundaries, and data movement to surface potential security threats early in the development lifecycle.*

Blanc. aims to shift threat modeling from a manual workshop-driven activity into a scalable, repeatable, and developer-friendly workflow.

### Key Capabilities

- Identify threats, given a design artifact (architecture diagram, sequence diagram or business document)
- Generate reports in md-format that can be consumed directly by coding agents
- Add custom prompts for threat detection
- Create a new architecture diagram or sequence diagram via Blanc. Studio
- Comments and interactions on identified threats
- Generate reports in pdf format for audit and compliance needs
- Add custom rags and connectors based on what your organization uses
- Works with free models with open-ai support

![Blanc](assets/blanc-website.gif)

## Why Blanc.?

While threat modeling sounds straightforward in theory, applying it in practice is often difficult.

Teams frequently struggle to determine the right level of depth - where to stop, which risks matter, and what should be ignored.

As a result, threat modeling sessions often become one of two extremes:

* Identifying too many hypothetical threats and creating unnecessary complexity
* Repeating the same generic threats across every feature without meaningful context

Effective threat modeling is not about finding every possible threat - it is about identifying the most relevant risks for the design being reviewed.

It is designed to help teams apply security expertise earlier, consistently, and collaboratively—so that threat modeling becomes a continuous design practice rather than a one-time compliance activity.


## How Blanc Works

At a high level, Blanc follows this analysis flow:


1. Ingest one or more architecture diagrams (and optional supporting PDFs) into an assessment record and queue them for analysis.
2. For each image, run a 6-stage LLM pipeline that produces a Mermaid data-flow diagram, an analysis summary, a component inventory, and framework-agnostic clarification questions.
3. Auto-answer clarification questions from the RAG knowledge base where possible; surface the remainder to the user (assessment sits in `NEEDS_INPUT`).
4. Feed merged image data + answers into per-framework threat generators (STRIDE / BUSINESS_LOGIC) and persist each threat with full provenance.
5. Assign reviewers, capture per-threat approve / reject / comment decisions, and drive the assessment to `APPROVED` or `CHANGES_REQUESTED`.
6. Log every LLM call with token counts and cost, so spend per assessment is fully auditable.

## Quick Start

Blanc has two components — a FastAPI backend (`blancService/`) and a Next.js studio (`blancUi/`). You'll need Python 3.12, Node.js 20+, MariaDB 10.6+, RabbitMQ 3.11+, and an OpenAI-compatible LLM endpoint.

### Run via Docker Compose (recommended)

The bundled `docker-compose.yml` brings up MariaDB, RabbitMQ, the FastAPI backend, and the Next.js studio in one shot. All configuration lives in a single YAML file — no `.env` needed.

```bash
git clone https://github.com/blanc-project/blanc.git
cd blanc

# 1. Create your config from the example.
cp blancService/atm/config/docker.yml.example \
   blancService/atm/config/docker.yml

# 2. Edit blancService/atm/config/docker.yml
#    — set openaiconfig.api_key, jwt_config.secret_key, admin_users, etc.

# 3. Bring the stack up.
docker compose up --build
```

`docker.yml` is mounted read-only into the api container and is the single source of truth for OpenAI keys, JWT secrets, Google OAuth, admin emails, and the DB / RabbitMQ connection strings. It's gitignored — don't commit it.

> The studio talks to the backend at `http://localhost:8000` by default. Update `NEXT_PUBLIC_API_BASE_URL` in [docker-compose.yml](docker-compose.yml) (under the `ui` service's `build.args`) if you're serving the api on a different host.

### Run locally

```bash
git clone https://github.com/blanc-project/blanc.git
cd blanc

# Backend
cd blancService
python3.12 -m venv env
source env/bin/activate
pip install -r requirements.txt
python3 main.py   # loads blancService/atm/config/config.yml by default

# Studio (in a second terminal)
cd ../blancUi
npm install
npm run dev
```

The API comes up on `http://localhost:8000` (with `/uploads` serving uploaded artifacts) and the studio on `http://localhost:3000`.
