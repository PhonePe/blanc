"""
S3 / S3-compatible storage backend.

Works against AWS S3, MinIO, Cloudflare R2, Wasabi, Backblaze B2, and any other
service that speaks the S3 API. ``boto3`` is imported lazily so the package
remains usable without the optional dependency installed.

Install with::

    pip install atm[s3]      # or simply: pip install boto3

Files are uploaded to ``{prefix}{assessment_id}/{filename}`` and cached
locally so the LLM / RAG pipeline can read them by path without re-downloading.
"""
from __future__ import annotations

import io
import logging
import os
import shutil
from typing import Any, Optional

from blanc.core.storage.base import StorageBackend, StorageResult

logger = logging.getLogger(__name__)


class S3StorageBackend(StorageBackend):
    """Object storage backed by any S3-compatible service."""

    _CONTENT_TYPE_MAP = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".webp": "image/webp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".json": "application/json",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
    }

    def __init__(
        self,
        *,
        bucket: str,
        region: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        prefix: str = "",
        presign_expiry: int = 3600,
        addressing_style: str = "auto",
        ssl_verify: bool = True,
        local_cache_dir: str = "uploads",
    ):
        if not bucket:
            raise ValueError("S3StorageBackend requires a non-empty bucket name")
        self.bucket = bucket
        self.region = region or None
        self.endpoint_url = endpoint_url or None
        self._access_key = access_key or None
        self._secret_key = secret_key or None
        self.prefix = prefix.strip("/") + "/" if prefix and not prefix.endswith("/") else prefix
        self.presign_expiry = int(presign_expiry)
        self.addressing_style = addressing_style
        self.ssl_verify = ssl_verify
        self.local_cache_dir = local_cache_dir
        self._client: Any = None

    # ------------------------------------------------------------------
    # boto3 client (lazy)
    # ------------------------------------------------------------------

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            import boto3
            from botocore.config import Config
        except ImportError as e:  # pragma: no cover - optional dep
            raise RuntimeError(
                "boto3 is required for S3StorageBackend. Install with: "
                "pip install boto3"
            ) from e

        config = Config(
            signature_version="s3v4",
            s3={"addressing_style": self.addressing_style},
        )
        kwargs: dict = {"config": config, "verify": self.ssl_verify}
        if self.region:
            kwargs["region_name"] = self.region
        if self.endpoint_url:
            kwargs["endpoint_url"] = self.endpoint_url
        if self._access_key and self._secret_key:
            kwargs["aws_access_key_id"] = self._access_key
            kwargs["aws_secret_access_key"] = self._secret_key
        # Otherwise rely on the standard boto3 credential chain.

        self._client = boto3.client("s3", **kwargs)
        return self._client

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _key(self, assessment_id: str, filename: str) -> str:
        return f"{self.prefix}{assessment_id}/{filename}"

    def _content_type(self, filename: str) -> str:
        ext = os.path.splitext(filename)[1].lower()
        return self._CONTENT_TYPE_MAP.get(ext, "application/octet-stream")

    def _public_url(self, key: str) -> str:
        """Return a presigned URL (private buckets) or virtual-hosted URL
        (public buckets) for the given key. Presigned URLs are safer by
        default; flip the bucket to public + use a plain URL only if you
        know what you're doing."""
        try:
            return self._get_client().generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=self.presign_expiry,
            )
        except Exception as e:  # pragma: no cover
            logger.warning("Failed to presign S3 URL for %s: %s", key, e)
            if self.endpoint_url:
                return f"{self.endpoint_url.rstrip('/')}/{self.bucket}/{key}"
            return f"https://{self.bucket}.s3.amazonaws.com/{key}"

    # ------------------------------------------------------------------
    # StorageBackend API
    # ------------------------------------------------------------------

    def ensure_dirs(self, assessment_id: str) -> None:
        # S3 has no folder concept; only the local cache needs creating.
        os.makedirs(os.path.join(self.local_cache_dir, assessment_id), exist_ok=True)

    def save(
        self,
        content: bytes,
        assessment_id: str,
        filename: str,
        original_filename: str = "",
    ) -> StorageResult:
        client = self._get_client()
        key = self._key(assessment_id, filename)
        content_type = self._content_type(filename)

        client.upload_fileobj(
            Fileobj=io.BytesIO(content),
            Bucket=self.bucket,
            Key=key,
            ExtraArgs={"ContentType": content_type},
        )

        # Local cache mirrors the local backend's behaviour so downstream
        # pipelines can read files by absolute path.
        local_folder = os.path.join(self.local_cache_dir, assessment_id)
        os.makedirs(local_folder, exist_ok=True)
        local_path = os.path.join(local_folder, filename)
        with open(local_path, "wb") as f:
            f.write(content)
        absolute_path = os.path.join(os.getcwd(), local_path)

        public_url = self._public_url(key)
        logger.info(
            "[S3] Uploaded %s -> s3://%s/%s",
            original_filename or filename,
            self.bucket,
            key,
        )

        return StorageResult(
            stored_path=local_path,
            absolute_path=absolute_path,
            backend="s3",
            public_url=public_url,
            document_id=key,
        )

    def read(self, stored_path: str) -> bytes:
        """Read from local cache; fall back to S3 by interpreting the path
        as either a local file or an S3 key (``document_id`` from
        :class:`StorageResult`)."""
        if os.path.exists(stored_path):
            with open(stored_path, "rb") as f:
                return f.read()

        client = self._get_client()
        buf = io.BytesIO()
        try:
            client.download_fileobj(self.bucket, stored_path, buf)
        except Exception as e:
            raise FileNotFoundError(f"S3 object not found: {stored_path}") from e
        return buf.getvalue()

    def exists(self, stored_path: str) -> bool:
        if os.path.exists(stored_path):
            return True
        try:
            self._get_client().head_object(Bucket=self.bucket, Key=stored_path)
            return True
        except Exception:
            return False

    def cleanup_local_cache(self, file_path: str) -> None:
        try:
            if os.path.isfile(file_path):
                os.remove(file_path)
                logger.info("[S3] Cleaned up local cache: %s", file_path)
                parent = os.path.dirname(file_path)
                if parent and os.path.isdir(parent) and not os.listdir(parent):
                    os.rmdir(parent)
        except OSError as e:
            logger.warning("[S3] Cache cleanup failed for %s: %s", file_path, e)

    def cleanup_assessment_cache(self, assessment_id: str) -> None:
        cache_dir = os.path.join(self.local_cache_dir, assessment_id)
        try:
            if os.path.isdir(cache_dir):
                shutil.rmtree(cache_dir)
                logger.info("[S3] Removed assessment cache directory: %s", cache_dir)
        except OSError as e:
            logger.warning("[S3] Assessment cache cleanup failed for %s: %s", cache_dir, e)


__all__ = ["S3StorageBackend"]
