## Connectors

Blanc's threat modelling is only as good as the design context it starts with. If your organization already has that context - service catalogues, internal wikis, RFCs, an existing security-Q&A LLM - you can plug it in as a **connector** so Blanc uses your data instead of guessing.

Connectors are plugin-style modules that live under `blancService/blanc/modules/`. They are:

* **Optional.** A missing or empty `integrations` block is a no-op - nothing external is called.
* **Read-only, upstream-side.** Blanc calls out to your systems; your systems never call into Blanc.
* **Pluggable.** Each connector is a single Python class with three methods. Adding a new one does not require touching the core codebase.

## What connectors do

During an assessment, Blanc builds a **surface map** - the set of components, trust boundaries, and design questions the pipeline reasons over. Connectors hydrate this surface map from external sources at two points:

1. **Phase A - Component & boundary hydration.** For each component in the diagram, connectors can fill in `desc`, `exposure`, `environment`, and other fields on the surface map. This runs *before* threat modelling.
2. **Clarification auto-answer.** When Blanc has clarification questions it can't answer from the local RAG store, connectors targeted at `question.answer` are consulted before the question is surfaced to the user.

Any target Blanc can't satisfy externally simply falls back to its built-in behaviour (RAG + LLM, or the user).

## Anatomy of the `integrations` block

Everything lives under a single `integrations:` block in `docker.yml` (or `config.yml`). The block has three parts, read top-down like a decision tree: **what** do you want to fill → **who** fills it → **how** do they authenticate.

```yaml
integrations:
  field_sources:   { ... }   # 1. Which connector(s) fill which target, in order
  connectors:      { ... }   # 2. Connector instances (transport concerns only)
  auth:            { ... }   # 3. Named credential profiles referenced by (2)
```

You can define them in any order in the YAML file itself — the numbering above is just how to reason about them.

### 1. `field_sources` - routing

Start here. `field_sources` maps a **surface-map target** (a field on a component, a field on a trust boundary, or the special `question.answer`) to an ordered list of connector names. The first non-null result wins; if every connector in the chain returns `None`, the target is left alone and Blanc falls back to its default behaviour.

```yaml
integrations:
  field_sources:
    "component.desc":        [Example]
    "component.exposure":    [Example]
    "component.environment": [Example]
    # "question.answer":     [Example]
```

Reserved key prefixes:

| Target prefix        | Hydrated during                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `component.<field>`  | Phase A, per component in the diagram. Dispatched by the surface-map dispatcher.                             |
| `boundary.<field>`   | Phase A, per trust boundary. Dispatched by the surface-map dispatcher.                                       |
| `question.answer`    | Clarification stage. Consulted separately by the clarification pipeline; falls back to built-in RAG + LLM.   |

> Only `component.<field>` and `boundary.<field>` targets are routed through the surface-map dispatcher. `question.answer` is a reserved convention that the clarification stage handles on its own - anything else is treated as an unknown target and skipped with a warning.

Writable surface-map fields (from `blanc/schemas/surface_map.py`):

* `component.<field>` - `type`, `desc`, `exposure`, `environment`, `trust_level`, `authn`, `authz`
* `boundary.<field>` - `protocol`, `authentication`, `threat_level`

Enum-valued fields (`exposure`, `trust_level`, `authn`, `authz`, `protocol`, `environment`) accept only the literal values defined in that schema - anything else is dropped by the surface-map validator.

Omitted or empty targets are left entirely to the built-in pipeline.

### 2. `connectors` - connector instances

Every name you referenced in `field_sources` (`Example`, above) needs a matching entry here. The **key** must match the connector class's `name` attribute; the **module** is the Python import path.

```yaml
integrations:
  connectors:
    Example:
      module: blanc.modules.Example
      auth:   example_bearer                # -> resolves against integrations.auth (§3)
      url:    "https://your-agent-endpoint.example.com/ask"

      # Optional per-deployment override of the vendor model alias.
      # model: "your-model-alias"

      # TLS verification.
      #   true               → verify against certifi bundle (default)
      #   false              → skip verification (curl -k equivalent)
      #   "/path/to/ca.pem"  → verify against a specific PEM bundle
      #                        (e.g. your org's private CA, mounted into the api container)
      verify_ssl: true

      # Transport tuning.
      timeout_s:                   60      # per-request timeout in seconds
      cache_ttl_s:                 3600    # response cache lifetime in seconds
      max_concurrent_requests:     4       # per-connector concurrency cap
      max_response_bytes:          5000000 # hard cap on response body size (5 MB)
      circuit_breaker_failures:    5       # trip after N consecutive failures
      circuit_breaker_cooldown_s:  60      # keep breaker open for N seconds

      # SSRF guard - hard allow-list of hosts this connector may hit.
      allowed_hosts:
        - "your-agent-endpoint.example.com"

      # Escape hatch for the rare non-standard transport knob a
      # connector genuinely needs (e.g. custom TLS cert path).
      # Prompt / model / retriever choices do NOT belong here.
      # extra:
      #   custom_cert_path: "/etc/ssl/private/upstream.pem"
```

Only transport concerns live here. Vendor-specific request-body knobs (prompts, model names, retriever names) belong inside the connector *class*, not the YAML.

> Retries and HTTP keep-alive are **not** YAML-configurable today. The runner is hard-wired to 4 attempts with jittered exponential backoff (1s → 8s) on transport / 5xx errors, and a 5-second keep-alive expiry. See `blanc/core/integrations/http_runner.py` if you need to tune them.

> **SSRF safety.** `allowed_hosts` is a hard allow-list - a connector cannot make a request to any host outside this list, even if `url` is changed at runtime. Keep it tight.

### 3. `auth` - named credential profiles

Finally, every `auth:` reference on a connector (`example_bearer`, above) needs a matching profile here. Each entry defines a single HTTP header and a value template. Secrets never appear inline - only their *env-var name* or *token-source name* does.

```yaml
integrations:
  auth:
    example_bearer:
      header: "Authorization"
      value:  "Bearer ${env:EXAMPLE_API_TOKEN}"
```

Two placeholder patterns are supported inside `value`:

| Placeholder      | Resolved from                                                                 | When to use                                              |
| ---------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `${env:VAR}`     | `os.environ["VAR"]` on every request. In Docker, pass via `environment:` / `env_file:`. | Static tokens or tokens rotated out-of-band.             |
| `${token:NAME}`  | A callable registered at app startup via `register_token_source("NAME", fn)`. | Tokens fetched from a vault, refreshed on a TTL, etc.    |

Token sources return either a bare `str` (5-minute default TTL) or a `(token, expires_at_epoch)` tuple. Tokens are cached with a 60 s refresh margin, thread-safely.

## Writing your own connector

The bundled `blanc/modules/Example.py` is a working reference - a generic "ask-a-question" HTTP client that hydrates `component.desc`, `component.exposure`, and `component.environment`. Adding your own connector is three files:

1. **Create the module** at `blancService/blanc/modules/<YourConnector>.py`.
2. **Subclass `SurfaceMapConnector`**, decorate with `@connector`, set `name` and `supported_targets`, and implement two methods.
3. **Wire it up** in `docker.yml` under `integrations.connectors` and `integrations.field_sources`.

Minimal skeleton:

```python
# blancService/blanc/modules/MyConnector.py
from typing import ClassVar, List, Optional

import httpx

from blanc.core.integrations.base import ConnectorResult, SurfaceMapConnector
from blanc.core.integrations.registry import connector


@connector
class MyConnector(SurfaceMapConnector):
    name: ClassVar[str] = "MyConnector"
    supported_targets: ClassVar[List[str]] = ["component.desc"]

    # 1. Build the outbound request for one (entity, target) pair.
    def get_api_calls(self, entity, target: str) -> List[httpx.Request]:
        return [httpx.Request(
            "GET",
            f"{self.cfg['url']}/services/{entity.name}",
            headers={"Accept": "application/json"},
        )]

    # 2. Extract a typed value from the response - or return None to skip.
    def parse_response(
        self, response: httpx.Response, entity, target: str,
    ) -> Optional[ConnectorResult]:
        if response.status_code != 200:
            return None
        data = response.json()
        desc = (data.get("description") or "").strip()
        if not desc:
            return None
        return ConnectorResult(value=desc, source_ref=data.get("id"))

    # 3. Persistence is inherited - the base class stamps the value onto
    #    the surface map together with provenance (`provider`, `source_ref`).
```

Corresponding YAML:

```yaml
integrations:
  auth:
    my_bearer:
      header: "Authorization"
      value:  "Bearer ${env:MY_API_TOKEN}"

  connectors:
    MyConnector:
      module: blanc.modules.MyConnector
      auth:   my_bearer
      url:    "https://catalog.internal.example.com"
      allowed_hosts:
        - "catalog.internal.example.com"

  field_sources:
    "component.desc": [MyConnector]
```

Restart the api container - the `@connector` decorator auto-registers the class on import, and `field_sources` routes matching targets to your instance.

### Notes on writing good connectors

* **Return `None` for "I don't know".** The dispatcher treats `None` as "fall through to the next connector in the chain" - that's how you compose fallbacks cleanly.
* **Prompts and model names live in the class, not the YAML.** YAML holds transport concerns only. See how `Example.py` organises this via a `FIELDS` dictionary at module scope.
* **Clean responses before you write them.** `Example.py` shows how to strip Markdown, drop a trailing "Sources:" section, and canonicalise enum-shaped answers so the surface map stays clean.
* **Provenance matters.** Populate `source_ref` on `ConnectorResult` with a message id, doc URL, or ticket id - it gets stamped onto `SurfaceComponent.sources[<field>]` and shows up in threat rationales for auditability.

## Health check

Registered connectors show up in the app's startup logs. If a connector's `module` fails to import, the app logs the error and starts without that connector rather than crashing - check the logs when a hydration target you configured stops firing.
