Blanc has two components - a FastAPI backend (`blancService/`) and a Next.js studio (`blancUi/`). This page covers two ways to install it:

* **[Quick start - browse Blanc](#quick-start-browse-blanc)** - spin up the full stack on your laptop with one command. You only need Docker and an OpenAI-compatible API key. Perfect for evaluating Blanc.
* **[Deploy for your organization](#deploy-for-your-organization)** - production install where you bring your own database, queue, storage, LLM, and (optionally) RAG store.

---

## Quick start - browse Blanc

The fastest way to see Blanc in action. Pick either Docker Compose (recommended - one command, no Python/Node install) or the native path (if you already have Python 3.12 and Node.js 20+ locally). Both spin up the full stack - MariaDB, RabbitMQ, backend, and studio - on `127.0.0.1`.

### Option 1 - Docker Compose (recommended)

Everything runs in containers. You don't need Python or Node.js on your machine.

**Prerequisites**

* Docker Desktop (macOS / Windows) or Docker Engine + Compose (Linux)
* An **OpenAI-compatible API key** - hosted OpenAI, or any self-hosted gateway (vLLM, Ollama, LiteLLM, …) that speaks the OpenAI API

**Steps**

1. Clone:

	```bash
	git clone https://github.com/PhonePe/blanc.git
	cd blanc
	```

2. Copy the config template into place:

	```bash
	cp blancService/blanc/config/docker.yml.example \
	   blancService/blanc/config/docker.yml
	```

3. Open `blancService/blanc/config/docker.yml` in your editor and fill in three fields:

	* `openaiconfig.api_key` - your API key.
	* `jwt_config.secret_key` - a 48-char random string. Generate one with:
		```bash
		python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
		```
	* `admin_users` - the email you'll log in with.

	> **How does Blanc read this file?** `docker-compose.yml` bind-mounts `./blancService/blanc/config/docker.yml` into the api container at `/app/blanc/config/docker.yml` (read-only). The entrypoint points `BLANC_CONFIG_PATH` at it, so any change you make on the host is picked up next time the container starts. No copying into the image, no rebuild - just edit the file and re-run `docker compose up`.

4. Bring the stack up:

	```bash
	docker compose up --build
	```

Once healthy:

* Studio: [http://localhost:3000](http://localhost:3000)
* API: [http://localhost:8000](http://localhost:8000)
* RabbitMQ management UI: [http://localhost:15672](http://localhost:15672)

Everything (MariaDB, RabbitMQ, local Chroma RAG, filesystem uploads) is bundled and persists across restarts in named Docker volumes.

> Docker Compose out of the box is **not** intended for production. Bundled DB / queue credentials are hardcoded to defaults, every port is bound to loopback, and there is no TLS. For a shared deployment see [Deploy for your organization](#deploy-for-your-organization).

### Option 2 - Native

Two helper scripts at the repo root do the whole thing: `./native-build.sh` sets up the Python venv, installs backend and frontend dependencies, and scaffolds `config.yml`; `./native-run.sh` starts both processes.

**Prerequisites**

* **Python 3.12** (PaddlePaddle wheels don't ship for 3.13+) and **Node.js 20+**
* Docker (only for the bundled MariaDB + RabbitMQ) or your own instances of each
* An **OpenAI-compatible API key**

**Steps**

1. Clone:

	```bash
	git clone https://github.com/PhonePe/blanc.git
	cd blanc
	```

2. Build (venv + deps + `config.yml` scaffold - allow 5-10 min, PaddlePaddle is ~1 GB):

	```bash
	./native-build.sh
	```

	The script hard-fails on Python != 3.12 and Node < 20. On Linux, install the OpenCV runtime deps first if the script warns: `sudo apt install -y libgomp1 libgl1 libglib2.0-0`.

3. Start MariaDB + RabbitMQ (borrow them from Docker Compose if you don't already run them):

	```bash
	docker compose up -d mariadb rabbitmq
	```

4. Open `blancService/blanc/config/config.yml` and fill in the same three fields as above (`openaiconfig.api_key`, `jwt_config.secret_key`, `admin_users`).

5. Run:

	```bash
	./native-run.sh
	```

	Ctrl+C stops both the backend and the studio.

Once running, hit the same three URLs as the Docker path.

**About the RAG embedder.** Blanc's default RAG store runs an in-process `sentence-transformers` model to turn documents into vectors. That model pulls in PyTorch (~2 GB), so `native-build.sh` skips it by default to keep the first install snappy. You have two choices when you're actually ready to use RAG:

* If you want the fully local embedder, re-run the build with the flag: `INSTALL_SBERT=1 ./native-build.sh`. This installs `sentence-transformers` + `torch`.
* If you'd rather use the OpenAI embeddings API (no local torch, but you pay per embedding), open `config.yml` and set `rag_config.embedder.provider: "openai"`. Blanc will use your existing `openaiconfig.api_key` for embeddings.

Either way, the docs and the assessment pipeline work fine without RAG installed - RAG only kicks in when you seed documents into the knowledge base.

---

## Deploy for your organization

Let's set Blanc up for your organization! There are **six components** you'll need to point at your own infrastructure - a database, a message queue, object storage, an LLM endpoint, a RAG store, and authentication.

Don't worry, we'll walk through each one, and after every component you'll get a quick way to verify it's talking to Blanc correctly. Take your time - once these are wired up you never have to touch them again.

**Where to make changes.** All settings live in one YAML file:

* **Docker Compose:** `blancService/blanc/config/docker.yml` (bind-mounted read-only into the api container - edit on the host, restart the api container to pick up changes).
* **Native / manual:** `blancService/blanc/config/config.yml` (loaded by `main.py` on startup).

Both files share the same schema. The examples in each section below use YAML that goes into this file. The [Configuration reference](#configuration-reference) at the end lists every top-level block if you want the big-picture map.

Ready? Let's go.

### 1. Relational database - MariaDB

**Tech stack:** SQLAlchemy over **MariaDB 10.6+**. MariaDB is a MySQL-compatible database, so the SQL surface is standard MySQL / MariaDB SQL - but Blanc ships the MariaDB-specific `mariadbconnector` driver, and the connection-string field is literally named `mariadbConnectionString`. If you want to run against upstream MySQL you'll need to swap the driver and revalidate the schema (not officially tested).

**Schema:** created automatically on first boot from `blanc/db_models` - you don't need to run any migration script.

**Integrate:**

1. Provision a MariaDB 10.6+ instance reachable from wherever the api process runs.
2. Create a database and a user with full DDL rights on that database (needed for the initial schema creation).
3. Open your config file (`blancService/blanc/config/docker.yml` or `config.yml`) and find the `dbConfig:` block. Update these fields:

	```yaml
	dbConfig:
	  mariadbConnectionString: "mariadb+mariadbconnector://<user>:<password>@<host>:3306/<database>"
	  poolSize: 20         # SQLAlchemy pool size - bump for high concurrency
	  poolRecycle: 300     # seconds; keeps the pool below MariaDB's wait_timeout
	  maxOverflow: 20      # temporary connections above poolSize under load
	```

4. Save the file and restart the api (`docker compose restart api` or Ctrl+C then `./native-run.sh` again).

> The bundled `docker-compose.yml` ships `mariadb:11` with `user=blanc / password=blanc / database=blanc`. Fine for local, replace for production.

**Verify it worked:**

* Watch the api startup logs. Successful DB connection prints tables being created / verified (no `OperationalError`, no `Access denied`).
* Or hit the health check: `curl -sf http://localhost:8000/healthcheck` should return `200 OK`.
* Or connect directly with any MariaDB / MySQL client: `mysql -h <host> -u <user> -p <database> -e "SHOW TABLES"` - you should see the Blanc tables (`assessments`, `users`, `organizations`, `questions`, …).

**1 of 6 done - 5 to go!**

### 2. Message queue - RabbitMQ

**Tech stack:** `aio_pika` (asyncio AMQP 0.9.1) over **RabbitMQ 3.11+**.

**Why a queue:** each pipeline stage is dispatched as an async task so the API can accept new work while a previous assessment is still running the vision LLM. On startup, Blanc also republishes any tasks stuck in `PENDING` / `PROCESSING` from the last 24 h - see `app.py`.

**Do I need to create the queue manually?** **No.** Blanc auto-declares the main queue (`BLANC`), its exchange, and a dead-letter queue on startup, with `durable=True`. You do **not** need to log into the RabbitMQ management dashboard and click "Add Queue" - just point Blanc at a running broker with a user that has `configure / write / read` permissions on the vhost.

**Integrate:**

1. Provision a RabbitMQ 3.11+ cluster with the classic-queues plugin.
2. Create a virtual host and a user with `configure / write / read` on it.
3. Open your config file and find the `rmqConfig:` block. Update:

	```yaml
	rmqConfig:
	  hosts: ["rabbit1.internal", "rabbit2.internal"]   # list of nodes
	  port: 5672
	  username: "blanc"
	  password: "..."
	  prefetchCount: 1
	  routingKey: scan
	  sslEnabled: False                                 # true for AMQPS
	  queues:
	    - name: BLANC                                   # main worker queue
	      concurrency: 2                                # concurrent messages per api process
	```

	Bump `queues[0].concurrency` for higher throughput per api process; scale horizontally by running additional api containers.

4. Save and restart the api.

**Verify it worked:**

* Open the RabbitMQ management UI (`http://<host>:15672`) and confirm the `BLANC` queue and `BLANC.dlq` dead-letter queue show up under the vhost.
* Or CLI: `rabbitmqctl list_queues -p <vhost> name messages consumers` - `BLANC` should appear with at least one consumer.
* Or run any assessment from the studio and watch the queue depth briefly spike then drain in the management UI.

**2 of 6 done - 4 to go!**

### 3. Object storage - local FS or S3

Uploaded diagrams and supporting PDFs land in one of two backends.

**Tech stack:** built-in `local` (native filesystem) and `s3` (`boto3`) backends. The `s3` backend takes an `endpoint_url` field, so in principle it works against any S3-compatible service - the `S3Config` model explicitly lists AWS S3, MinIO, Cloudflare R2, Wasabi, and Backblaze B2 as targets. Only AWS S3 and MinIO have been tested end-to-end; other S3-compatible providers should work through the same `endpoint_url` knob but haven't been validated by us. If a specific provider gives you trouble, open an issue.

**Option A - Local filesystem** (easiest for single-node deployments):

Open your config file, find the `storage:` block, and set:

```yaml
storage:
  backend: "local"
  local_upload_dir: "/app/uploads"        # persist this on a mounted volume
```

Mount `/app/uploads` on a persistent volume (the Docker Compose stack does this via the `api_uploads` named volume). For multi-node deployments, use S3 instead - every api replica needs to see the same uploads.

**Option B - S3-compatible object storage** (recommended for shared deployments):

Same `storage:` block, `backend: "s3"`:

```yaml
storage:
  backend: "s3"
  s3:
    bucket: "blanc-uploads-prod"
    region: "us-east-1"
    endpoint_url: ""                       # MinIO / R2 / Wasabi / B2 URL; blank for AWS
    access_key: ""                         # blank = boto3 default chain (env / ~/.aws / IAM)
    secret_key: ""
    prefix: "prod/"                        # optional key prefix
    presign_expiry: 3600                   # seconds for generated URLs
    addressing_style: "auto"               # "auto" | "virtual" | "path"
    ssl_verify: true
```

**Integrate (S3 path):**

1. Create the bucket (or namespace, for R2 / MinIO).
2. Provision an IAM identity (or bucket policy) with `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on that bucket.
3. Either put the credentials into `access_key` / `secret_key`, or leave them blank and let boto3 pick them up from env vars, `~/.aws/credentials`, or the instance IAM role.
4. Save the config and restart the api. Existing local files are **not** migrated - upload something after the switch to test.

**Verify it worked:**

* From the studio, create a new assessment and upload a diagram (any PNG).
* **Local backend:** `ls -la <local_upload_dir>` on the api host - your file is there.
* **S3 backend:** `aws s3 ls s3://<bucket>/<prefix>/ --recursive` (swap `--endpoint-url=<url>` in for non-AWS providers). Your uploaded file appears within a second or two.
* If the api startup logs contain `S3StorageBackend: bucket=<bucket> region=<region>` (or `LocalStorageBackend: dir=<path>`), the backend loaded correctly.

**3 of 6 done - 3 to go!**

### 4. LLM endpoint

**Tech stack:** the `openai` Python client over `httpx`. Any **OpenAI-compatible** endpoint works - hosted OpenAI, Azure OpenAI, a self-hosted vLLM / Ollama / LiteLLM proxy, or an internal LLM gateway.

The 6-stage pipeline runs different models for different jobs (a cheap model for summarisation and clarification, a strong model for vision and threat modelling). Each stage can override the base model.

**Integrate:**

1. Confirm your endpoint speaks the OpenAI chat-completions API (i.e. `POST /v1/chat/completions` returns the standard response shape).
2. Open your config file and find the `openaiconfig:` block. Update:

	```yaml
	openaiconfig:
	  openai_url: "https://api.openai.com/v1"     # your endpoint
	  provider: "openai"
	  api_key: "sk-REPLACE_ME"

	  # Fallback model + pricing. Used whenever a call doesn't match a
	  # per-purpose entry under `models` below.
	  default:
	    model_name: "gpt-4o"
	    pricing:
	      prompt_cost_per_million: 2.50
	      completion_cost_per_million: 10.00

	  # Optional per-purpose overrides. Any purpose not listed here
	  # inherits `default.model_name` + `default.pricing`.
	  models:
	    vision:
	      model_name: "gpt-4o"                    # MUST be vision-capable
	      prompt_cost_per_million: 2.50
	      completion_cost_per_million: 10.00
	    summarization:
	      model_name: "gpt-4o-mini"
	      prompt_cost_per_million: 0.15
	      completion_cost_per_million: 0.60
	    component_analysis:
	      model_name: "gpt-4o"
	      prompt_cost_per_million: 2.50
	      completion_cost_per_million: 10.00
	    clarification:
	      model_name: "gpt-4o-mini"
	      prompt_cost_per_million: 0.15
	      completion_cost_per_million: 0.60
	    threat_modeling:
	      model_name: "gpt-4o"
	      prompt_cost_per_million: 2.50
	      completion_cost_per_million: 10.00
	```

	> **Schema note.** `openaiconfig.default` is a single Pydantic object bundling the fallback `model_name` with its `pricing` - the two travel together, so you can't set one without the other. Each entry under `models.<purpose>` is one atomic `ModelConfig` carrying its own name **and** rates. There is no top-level `pricing:` block any more; anything not overridden falls through to `openaiconfig.default`.

3. Pick per-stage models. Only `vision` **must** be vision-capable; the others just need to be chat models.
4. Fill in prices per model - Blanc logs token counts on every call and rolls them up into per-assessment spend in the LLM Usage view.
5. If the key comes from an env var, either put `${env:OPENAI_KEY}` inline (see [Environment variable expansion](#environment-variable-expansion)) or leave `api_key` blank and export `OPENAI_API_KEY`.
6. Save and restart the api.

**Verify it worked:**

* Hit your endpoint directly to confirm reachability + auth:
	```bash
	curl -sf -H "Authorization: Bearer $API_KEY" "$OPENAI_URL/models" | head
	```
	You should see the model list. If this fails, Blanc won't be able to use the endpoint either.
* From the studio, create a small assessment. Watch the api logs for a successful call to the `vision` model (the first LLM call happens during `IMAGE_PROCESSING`).
* Check the **LLM Usage** view in the studio afterwards - you should see the call logged with token counts and cost.

**4 of 6 done - 2 to go!**

### 5. RAG - embedder + vector store

The clarification stage retrieves supporting context from a RAG store (design docs, previous assessments, org knowledge). You control both **where the vectors live** and **how they're embedded**.

**Tech stack:** built-in `local` (Chroma, in-process) and `http` (any HTTP-backed vector-DB) backends. Register third-party backends via `register_rag_backend()` / the `blanc.rag_backends` entry-point.

**Option A - Local Chroma + Sentence-Transformers** (zero external deps, ~2 GB of `torch` at build time):

```yaml
rag_config:
  backend: "local"
  namespace: "appsec"
  collection_id: "blanc_default"
  local:
    persist_dir: "/app/data/chroma"          # persist on a mounted volume
    collection_prefix: ""
  embedder:
    provider: "sentence_transformers"        # runs locally, no API key
    model_name: "all-MiniLM-L6-v2"
```

**Option B - Local Chroma + OpenAI embeddings** (fewer local deps, pay per embedding):

```yaml
rag_config:
  backend: "local"
  namespace: "appsec"
  collection_id: "blanc_default"
  embedder:
    provider: "openai"
    model_name: "text-embedding-3-small"     # or "text-embedding-3-large"
    api_key_env: "OPENAI_API_KEY"            # env var name (preferred over inline)
```

**Option C - Remote HTTP-backed vector store** (your own service):

```yaml
rag_config:
  backend: "http"
  namespace: "appsec"
  collection_id: "blanc_default"
  api_url: "https://rag.internal.example.com"
  auth_token_env: "BLANC_RAG_API_KEY"
```

**Integrate:**

* Open your config file, find `rag_config:`, and paste in the option above that matches your setup.
* For **local** backend: mount `persist_dir` on a volume that survives container restarts.
* For the **OpenAI embedder**: same key as `openaiconfig.api_key` if you export `OPENAI_API_KEY`.
* For the **HTTP backend**: implement the client contract in `blanc/core/rag_client/http_client.py` on your service.
* Save and restart the api.

**Verify it worked:**

* Open **Dashboard → RAG Knowledge Base** in the studio and upload a small PDF (a spec doc, an RFC, anything). Wait a few seconds.
* The document should appear in the collection list. Try the search box - your query should return relevant snippets from the doc.
* Or use the API directly:
	```bash
	# Ingest
	curl -X POST -F "file=@spec.pdf" \
	  "http://localhost:8000/api/v1/appsec/blanc_default/ingest"

	# Search
	curl "http://localhost:8000/api/v1/appsec/blanc_default/search?q=authentication"
	```

**5 of 6 done - 1 to go!**

### 6. Authentication - user login

This is what your users use to **sign into the Blanc studio at [http://<your-blanc-host>:3000](http://localhost:3000)**. Two modes, both configured through YAML.

**Password auth** is always on. Users register with email + password against the local `users` table; passwords are bcrypt-hashed; sessions are JWTs signed with `jwt_config.secret_key`.

**Google SSO** is optional. Provide a Google OAuth 2.0 client and (optionally) restrict sign-in to a single email domain. In your config file, find `google_auth:`:

```yaml
google_auth:
  client_id: "<client-id>.apps.googleusercontent.com"
  client_secret: "..."
  redirect_uri: "https://blanc.yourcompany.com/auth/google/callback"
  allowed_domain: "yourcompany.com"        # empty = accept any verified google email
```

Google logins additionally require `email_verified: true` on the ID token.

**Admin role.** `admin_users` is the authoritative source of the `ADMIN` role - every login recomputes the user's role from this list, so promotions / demotions take effect on next sign-in. There is no in-app promote-to-admin flow today.

```yaml
admin_users:
  - "admin@yourcompany.com"
```

To change admins live, edit the YAML and call `POST /admin/reload_config` as an existing admin - no restart required.

**JWT secret.** Generate once, rotate on a schedule:

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

```yaml
jwt_config:
  secret_key: "<paste result here>"
  algorithm: HS256
  access_token_expire_minutes: 60          # clamped to [5, 60] at import time
```

The value is validated at import - non-empty, does not start with `CHANGE_ME`, at least 32 characters. Failure raises `RuntimeError` before FastAPI serves any request.

**Verify it worked:**

* Open the studio at [http://localhost:3000](http://localhost:3000) and click **Register**. Create an account with any email + password.
* If you used the email you listed under `admin_users`, you should land in the studio and see the **Admin** section in the left nav. If you don't, double-check the email is spelled exactly the same in `admin_users` (case-sensitive) and re-login.
* If you configured Google SSO, the **Sign in with Google** button on the login page should be present. Click it - you should land on your Google account picker, then be redirected back into the studio. If `allowed_domain` is set, only emails from that domain are accepted.

**6 of 6 done - you're all set!** 🎉

### Deployment options

Once every component above is provisioned, deploy Blanc itself as containers or natively.

#### Docker Compose (production overrides)

Start from the bundled `docker-compose.yml`, then:

1. Drop the `mariadb` and `rabbitmq` services (or leave them if you want them managed by compose too).
2. Repoint the api at your real infrastructure through `docker.yml` (`dbConfig`, `rmqConfig`, `storage`, `openaiconfig`, `rag_config`).
3. Remove the corresponding `depends_on` entries on the `api` service.
4. Front the whole thing with a reverse proxy that terminates TLS (nginx, Traefik, Envoy). Do **not** expose `:8000` directly.

#### Native install (with helper scripts)

For teams that already run Python / Node services natively:

```bash
git clone https://github.com/PhonePe/blanc.git
cd blanc
./native-build.sh          # prereq check + venv + node_modules + config.yml scaffold
./native-run.sh            # starts backend on :8000 and studio on :3000
```

`native-build.sh` pins Python **3.12** (PaddlePaddle wheels only cover 3.10–3.12), installs the backend requirements (~1 GB with PaddlePaddle), verifies the OCR stack imports, and installs `blancUi` `node_modules`. Sentence-Transformers is **opt-in** - pass `INSTALL_SBERT=1 ./native-build.sh` if you're using the local embedder. On Linux, PaddleOCR needs `libgomp1`, `libgl1`, `libglib2.0-0`.

Env vars recognised by `native-run.sh`:

| Env var                    | Effect                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `ENV=<name>`               | Selects `blancService/blanc/config/<name>.yml`. Defaults to `config`.               |
| `NEXT_PUBLIC_API_BASE_URL` | Passed to the studio dev server. Defaults to `http://127.0.0.1:8000`.               |
| `OPENAI_API_KEY`           | Fallback when `openaiconfig.api_key` isn't set in YAML.                             |
| `JWT_SECRET_KEY`           | Fallback when `jwt_config.secret_key` isn't set in YAML.                            |

#### Manual (development / debugging)

For backend changes and step-by-step control:

```bash
cd blancService
python3.12 -m venv env
source env/bin/activate
pip install -r requirements.txt
cp blanc/config/config.yml.example blanc/config/config.yml     # first time only
python3 main.py
```

In a second terminal:

```bash
cd blancUi
npm install
npm run dev
```

### Now that the stack is up

Nicely done - the full stack is running and every component talks to your infrastructure. Next steps to actually put Blanc to work:

1. **Add [Connectors](integrations.md)** - plug in your organisation's own systems (service catalogues, wikis, internal LLM proxies) so Blanc hydrates the surface map from real data instead of guessing. Optional but strongly recommended for org-wide use.
2. **[Onboard your organization](onboard-your-organization.md)** - sign in as the admin you configured, run through the org questionnaire, and (optionally) tailor the questions to your tech stack.
3. **[Create your Threat Model](create-your-first-threat-model.md)** - run your first assessment.

---

## Configuration reference

Blanc's full backend configuration lives in a single YAML file:

* **Docker Compose:** `blancService/blanc/config/docker.yml` (mounted read-only into the api container).
* **Native / manual:** `blancService/blanc/config/config.yml` (loaded by `main.py`).

Both files share the same schema. Copy the annotated `*.yml.example` template that ships with the repo and edit in place.

### Top-level blocks

| Block             | Purpose                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `fastApiConfig`   | HTTP bind address, port, and worker count for the FastAPI backend.                                                   |
| `openaiconfig`    | Base LLM endpoint + API key, the `default` fallback model & pricing, and per-purpose overrides (vision, summarization, component analysis, clarification, threat modeling). Fallback pricing lives at `openaiconfig.default.pricing` - there is no separate top-level `pricing:` block. |
| `rag_config`      | RAG backend (`local` Chroma or `http` remote), embedder choice, and endpoint / key env var.                          |
| `storage`         | Where uploaded artifacts live (`local` filesystem or `s3`-compatible object store).                                  |
| `google_auth`     | Optional Google SSO. Leave `client_id` / `client_secret` blank to disable.                                          |
| `frontend`        | `base_url` of the studio - used for links generated by the backend.                                                 |
| `admin_users`     | Authoritative list of admin emails. Users are (re)assigned the `ADMIN` role on every login.                          |
| `logging`         | Standard `logging.config.dictConfig` payload, with a color formatter preconfigured.                                 |
| `paths.base_dir`  | Root directory for runtime data (defaults to `/app` inside the container).                                          |
| `jwt_config`      | JWT signing secret, algorithm, and access-token lifetime.                                                           |
| `dbConfig`        | MariaDB connection string and pool sizing.                                                                          |
| `rmqConfig`       | RabbitMQ hosts, credentials, and worker queue definitions.                                                          |
| `integrations`    | Optional external connectors that hydrate the surface map before threat modelling. See [Connectors](integrations.md). |

### OCR toggle (Docker on arm64)

The Docker Compose stack sets `BLANC_DISABLE_OCR=1` by default because PaddlePaddle's PIR loader segfaults on Linux/arm64 for the PP-OCRv6 weights Blanc ships with. The vision LLM covers diagrams fine on its own. Flip to `0` on x86_64 or after enabling Rosetta-for-amd64 in Docker Desktop and uncommenting `platform: linux/amd64` in `docker-compose.yml`.

### Environment variable expansion

The config loader expands `${VAR}` and `${VAR:-fallback}` tokens inside any string in the YAML at read time. Missing variables without a fallback raise a startup error, and values that contain a newline or nested `${...}` are rejected so a hostile env var cannot inject YAML. See `blanc/config_parsers/settings.py`.

### Config file resolution

`get_settings()` picks the config file in this order:

1. `BLANC_CONFIG_PATH` - absolute path override.
2. `ENV=<name>` - selects `blancService/blanc/config/<name>.yml`.
3. Falls back to `blancService/blanc/config/config.yml`.

The result is cached with `@lru_cache`. Call `POST /admin/reload_config` (admin only) to bust the cache and re-read the YAML in-process without a restart.

### Runtime environment variables

| Env var                 | Purpose                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `BLANC_CONFIG_PATH`     | Absolute path to the YAML.                                                           |
| `ENV`                   | Selects `<ENV>.yml` under `blanc/config/`.                                           |
| `BLANC_STORAGE_BACKEND` | Overrides `storage.backend` (`local` → `s3` or a plugin name).                       |
| `BLANC_RAG_BACKEND`     | Overrides `rag_config.backend` (`local` → `http` or a plugin name).                  |
| `BLANC_DISABLE_OCR`     | `1` / `true` disables PaddleOCR pre-processing.                                      |
| `OPENAI_API_KEY`        | Resolved via `rag_config.embedder.api_key_env` when its provider is `openai`.        |
| `BLANC_RAG_API_KEY`     | Resolved via `rag_config.auth_token_env` when `backend: http`.                       |
