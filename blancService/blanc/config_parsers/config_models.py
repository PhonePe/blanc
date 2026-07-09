from pydantic import BaseModel, Field
from typing import Literal, List, Dict, Union


class ModelConfig(BaseModel):
    """Configuration for a single LLM model with its own pricing."""
    model_name: str
    prompt_cost_per_million: float = 30.0
    completion_cost_per_million: float = 60.0


class OpenApiConfig(BaseModel):
    api_key: str
    model: str
    temperature: int

class OpenAIConfig(BaseModel):
    openai_url: str
    model_name: str  # default fallback model
    provider: str = "openai"
    api_key: str = ""
    models: Dict[str, ModelConfig] = Field(default_factory=dict)  # purpose -> model config

    def get_model(self, purpose: str) -> ModelConfig:
        """Get model config by purpose, falling back to default."""
        if purpose in self.models:
            return self.models[purpose]
        return ModelConfig(model_name=self.model_name)


class PricingConfig(BaseModel):
    """Default pricing — used when a model doesn't specify its own."""
    prompt_cost_per_million: float = 30.0
    completion_cost_per_million: float = 60.0

class Path(BaseModel):
    base_dir: str

class FastApiConf(BaseModel):
    appHost: str
    appPort: int
    num_workers: int

class GoogleAuthConfig(BaseModel):
    client_id: str
    client_secret: str
    redirect_uri: str
    allowed_domain: str = ""

class FrontendConfig(BaseModel):
    base_url: str

class DBConf(BaseModel):
    mariadbConnectionString: str
    poolSize: int
    poolRecycle: int
    maxOverflow: int

class JwtConfig(BaseModel):
    secret_key: str
    algorithm: str
    access_token_expire_minutes: int

class QueueDetails(BaseModel):
    name: str
    concurrency: int

class RMQConf(BaseModel):
    hosts: List[str]
    port: int
    username: str
    password: str
    prefetchCount: int
    routingKey: str
    sslEnabled: bool
    queues: List[QueueDetails]

class RAGLocalConfig(BaseModel):
    """Settings for the local (in-process, Chroma-backed) RAG backend."""
    persist_dir: str = "./data/chroma"
    collection_prefix: str = ""


class RAGEmbedderConfig(BaseModel):
    """Which embedder the local backend uses.

    * ``sentence_transformers`` (default): runs locally, no API key needed.
    * ``openai``: uses the OpenAI embeddings API. Provide the key
      either directly via ``api_key``, OR by naming an env var in
      ``api_key_env``. If both are set, ``api_key`` wins.

    Precedence at runtime:

        api_key (YAML)        →  used verbatim if non-empty
        api_key_env (YAML)    →  os.environ.get(<that name>) is looked up
        neither               →  the OpenAI embedder refuses to load

    Direct ``api_key`` in the YAML is convenient for local dev — the
    example ``config.yml`` is gitignored — but for anything shared or
    deployed, prefer the env var approach so keys don't sit in a
    config file that might be committed by accident.
    """
    provider: str = "sentence_transformers"
    model_name: str = "all-MiniLM-L6-v2"
    api_key: str = ""                    # inline key (dev convenience)
    api_key_env: str = "OPENAI_API_KEY"  # name of the env var (preferred)


class RAGConfig(BaseModel):
    """Retrieval-augmented generation config.

    ``backend`` picks which store implementation runs:

    * ``local`` (default): in-process Chroma + configurable embedder. No
      external service needed. Uses ``local`` + ``embedder`` fields.
    * ``http``: talk to a remote vector-DB API. Uses ``api_url`` +
      ``auth_token_env``.
    """
    backend: str = "local"
    namespace: str
    collection_id: str
    api_url: str = ""
    auth_token_env: str = "BLANC_RAG_API_KEY"
    local: RAGLocalConfig = RAGLocalConfig()
    embedder: RAGEmbedderConfig = RAGEmbedderConfig()


class S3Config(BaseModel):
    """S3 / S3-compatible object storage configuration.

    ``endpoint_url`` is optional; set it to point at non-AWS S3-compatible
    stores (MinIO, Cloudflare R2, Wasabi, Backblaze B2, ...). Leave it empty
    for AWS S3 proper.

    Credentials follow the standard boto3 resolution chain when both
    ``access_key`` and ``secret_key`` are blank (env vars, ~/.aws/credentials,
    IAM role, etc.). Provide them explicitly only when you must.
    """
    bucket: str = ""
    region: str = ""
    endpoint_url: str = ""
    access_key: str = ""
    secret_key: str = ""
    prefix: str = ""               # optional key prefix, e.g. "blanc/"
    presign_expiry: int = 3600     # seconds for generated public URLs
    addressing_style: str = "auto" # "auto" | "virtual" | "path"
    ssl_verify: bool = True


class StorageConfig(BaseModel):
    """Controls where uploaded files are stored."""
    backend: str = "local"  # "local" | "s3" | <plugin name>
    local_upload_dir: str = "uploads"
    s3: S3Config = S3Config()


class AppConfig(BaseModel):
    logging: dict
    openaiconfig: OpenAIConfig
    fastApiConfig: FastApiConf
    paths: Path
    dbConfig: DBConf
    admin_users: List[str]  
    jwt_config: JwtConfig
    rmqConfig: RMQConf
    google_auth: GoogleAuthConfig
    frontend: FrontendConfig
    rag_config: RAGConfig
    pricing: PricingConfig = PricingConfig()
    storage: StorageConfig = StorageConfig()
