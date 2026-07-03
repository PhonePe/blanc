"""
In-process vector store backed by Chroma.

Exposes the same async surface as :class:`~atm.core.rag_client.vector_db.VectorDBClient`
so callers can be swapped through the factory without changes:

* ``async ingest_batch(namespace, collection_id, chunks, max_concurrency=3)``
* ``async search(namespace, collection_id, payload)`` — returns
  ``{"hits": [{"id", "text", "metadata", "score"}], "total": N}``
* ``async search_by_assessment(namespace, collection_id, query, assessment_id, k)``
  — returns ``List[str]``

Chunks arrive from ``atm.core.rag_client.chunker.generate_appsec_chunks``
in the shape ``{"content": {"id", "metadata", "text"}}``. Chroma stores
one collection per ``{namespace}__{collection_id}`` combination inside the
configured ``persist_dir``.

Sync Chroma / embedding calls run under :func:`asyncio.to_thread` so the
event loop is never blocked.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from atm.core.rag_client.embeddings import Embedder, build_embedder

logger = logging.getLogger(__name__)


def _collection_name(prefix: str, namespace: str, collection_id: str) -> str:
    """Compose a Chroma collection name from prefix/namespace/collection_id."""
    parts = [p for p in (prefix, namespace, collection_id) if p]
    return "__".join(parts)


# Allow-list of metadata fields the caller may filter on. Anything else
# is silently dropped. Without this, `search()` would let the caller
# supply ``metadata.assessment_id`` and pull chunks from a different
# user's assessment (cross-tenant IDOR). ``assessment_id`` is
# intentionally NOT in this list — server-side code passes it directly
# via ``search_by_assessment`` instead.
_ALLOWED_FILTER_FIELDS = frozenset({"environment", "document_type", "source_file"})


def _translate_filter(payload_filter: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Translate the HTTP-shape ``filter.must[].match`` clause into Chroma's
    ``where`` dialect. Only equality filters on allow-listed metadata
    fields are honoured — everything else is silently dropped."""
    if not payload_filter:
        return None
    must = payload_filter.get("must") or []
    conditions: Dict[str, Any] = {}
    for clause in must:
        match = clause.get("match") if isinstance(clause, dict) else None
        if not isinstance(match, dict):
            continue
        for key, value in match.items():
            # HTTP-shape uses "metadata.foo" — Chroma stores flat metadata.
            field = key.split(".", 1)[1] if key.startswith("metadata.") else key
            if field not in _ALLOWED_FILTER_FIELDS:
                # Drop anything outside the allow-list. Do NOT let the
                # client filter by assessment_id / user_id / etc.
                continue
            conditions[field] = value
    if not conditions:
        return None
    if len(conditions) == 1:
        return conditions
    return {"$and": [{k: v} for k, v in conditions.items()]}


class LocalVectorDB:
    """Local, persistent RAG backend built on Chroma.

    Constructed via :func:`atm.core.rag_client.factory.get_rag_client`;
    do not instantiate directly outside tests.
    """

    def __init__(self, config, embedder: Optional[Embedder] = None):
        rag_config = config.rag_config
        local_cfg = rag_config.local
        self.persist_dir = local_cfg.persist_dir
        self.collection_prefix = local_cfg.collection_prefix or ""
        self.embedder = embedder or build_embedder(rag_config)

        # Lazy client / collection caches — first touch initialises Chroma.
        self._client = None
        self._collections: Dict[str, Any] = {}
        self._lock = asyncio.Lock()

        logger.info(
            "LocalVectorDB configured (persist_dir=%s, embedder=%s)",
            self.persist_dir,
            type(self.embedder).__name__,
        )

    # ------------------------------------------------------------------
    # Chroma bootstrap
    # ------------------------------------------------------------------

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            import chromadb
            from chromadb.config import Settings
        except ImportError as e:
            raise RuntimeError(
                "chromadb is not installed. Install it with `pip install chromadb`, "
                "or switch rag_config.backend to 'http' if you have a remote "
                "vector-DB service."
            ) from e
        self._client = chromadb.PersistentClient(
            path=self.persist_dir,
            settings=Settings(anonymized_telemetry=False),
        )
        return self._client

    def _get_collection(self, namespace: str, collection_id: str):
        name = _collection_name(self.collection_prefix, namespace, collection_id)
        cached = self._collections.get(name)
        if cached is not None:
            return cached
        client = self._get_client()
        # We bring our own embeddings — pass ``embedding_function=None`` and
        # supply ``embeddings=`` at every add/query call.
        collection = client.get_or_create_collection(
            name=name, embedding_function=None
        )
        self._collections[name] = collection
        return collection

    # ------------------------------------------------------------------
    # Ingest
    # ------------------------------------------------------------------

    async def ingest_batch(
        self,
        namespace: str,
        collection_id: str,
        chunks: List[Dict[str, Any]],
        max_concurrency: int = 3,  # accepted for API parity; unused locally
    ) -> Dict[str, Any]:
        """Embed and persist chunks. Signature matches ``VectorDBClient``."""
        if not chunks:
            raise HTTPException(status_code=400, detail="No documents to ingest")

        # Unpack the chunker's ``{"content": {...}}`` envelope.
        ids: List[str] = []
        texts: List[str] = []
        metadatas: List[Dict[str, Any]] = []
        for chunk in chunks:
            content = chunk.get("content") or {}
            chunk_id = content.get("id")
            text = content.get("text")
            metadata = content.get("metadata") or {}
            if not chunk_id or not text:
                logger.warning("Skipping malformed chunk (missing id/text)")
                continue
            ids.append(chunk_id)
            texts.append(text)
            metadatas.append(metadata)

        if not texts:
            raise HTTPException(status_code=400, detail="No valid chunks to ingest")

        total = len(texts)
        logger.info(
            "LocalVectorDB: ingesting %d chunks into %s/%s", total, namespace, collection_id
        )

        # Serialise Chroma writes to a single collection — Chroma's Python
        # client is not thread-safe for concurrent writes on the same handle.
        async with self._lock:
            try:
                embeddings = await asyncio.to_thread(self.embedder.embed, texts)
            except RuntimeError as e:
                # Embedder misconfigured — mirror the search() path and
                # skip cleanly. The document is still saved to disk;
                # only the vector-DB indexing is dropped. A future
                # config fix + retry can re-ingest.
                if not getattr(self, "_embed_warned", False):
                    logger.warning(
                        "RAG ingest skipped — embedder failed to load: %s. "
                        "Documents are stored but not indexed until the "
                        "config is fixed.", e,
                    )
                    self._embed_warned = True
                return {"status": "skipped", "reason": "embedder_unavailable"}
            except Exception as e:
                logger.exception("Embedding failed: %s", e)
                raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")

            try:
                collection = self._get_collection(namespace, collection_id)
            except RuntimeError as e:
                # chromadb not installed → skip cleanly. Docs are still
                # on disk; a config fix + retry can re-ingest.
                if not getattr(self, "_infra_warned", False):
                    logger.warning(
                        "RAG ingest skipped — vector store unavailable: %s. "
                        "Documents are stored but not indexed until the "
                        "config is fixed.", e,
                    )
                    self._infra_warned = True
                return {"status": "skipped", "reason": "vector_store_unavailable"}

            # Chroma upserts by id, so re-ingesting the same content is idempotent.
            try:
                await asyncio.to_thread(
                    collection.upsert,
                    ids=ids,
                    embeddings=embeddings,
                    documents=texts,
                    metadatas=metadatas,
                )
            except Exception as e:
                logger.exception("Chroma upsert failed: %s", e)
                raise HTTPException(status_code=500, detail=f"Ingest failed: {e}")

        logger.info(
            "LocalVectorDB: ✓ ingested %d chunks into %s/%s", total, namespace, collection_id
        )
        return {"status": "success", "total_chunks": total, "batches": 1}

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    async def search(
        self,
        namespace: str,
        collection_id: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Run a KNN query. Returns a dict compatible with the HTTP shape:
        ``{"hits": [{"id", "text", "metadata", "score"}], "total": N}``."""
        query = payload.get("query") or {}
        query_text = query.get("value") or ""
        k = int(query.get("k") or payload.get("limit") or 10)
        where = _translate_filter(payload.get("filter"))

        if not query_text:
            raise HTTPException(status_code=400, detail="Missing query.value")

        try:
            [embedding] = await asyncio.to_thread(self.embedder.embed, [query_text])
        except RuntimeError as e:
            # Embedder is misconfigured (no API key, wrong provider, etc.).
            # This is a persistent, per-deployment state — every
            # subsequent call would raise the same way. Log once at
            # WARNING and return an empty result so callers that treat
            # RAG as optional (auto-answer, threat-modeling context)
            # keep working without RAG rather than 500'ing on every
            # question.
            if not getattr(self, "_embed_warned", False):
                logger.warning(
                    "RAG search disabled — embedder failed to load: %s. "
                    "Fix the config or set the API key; requests will "
                    "return empty results until then.", e,
                )
                self._embed_warned = True
            return {"hits": [], "total": 0}
        except Exception as e:
            logger.exception("Query embedding failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Query embedding failed: {e}")

        try:
            collection = self._get_collection(namespace, collection_id)
        except RuntimeError as e:
            # chromadb not installed → same treatment as a broken embedder.
            # Log once at WARNING, return empty results so callers that
            # treat RAG as optional keep working.
            if not getattr(self, "_infra_warned", False):
                logger.warning(
                    "RAG search disabled — vector store unavailable: %s. "
                    "Fix the config or install the missing dep; requests "
                    "will return empty results until then.", e,
                )
                self._infra_warned = True
            return {"hits": [], "total": 0}

        try:
            result = await asyncio.to_thread(
                collection.query,
                query_embeddings=[embedding],
                n_results=k,
                where=where,
                include=["documents", "metadatas", "distances"],
            )
        except Exception as e:
            logger.exception("Chroma query failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Search failed: {e}")

        # Chroma returns list-of-lists (one per query embedding); we always
        # send a single embedding, so pull index [0] from each.
        ids = (result.get("ids") or [[]])[0]
        documents = (result.get("documents") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]

        hits: List[Dict[str, Any]] = []
        for i, hit_id in enumerate(ids):
            distance = distances[i] if i < len(distances) else None
            # Chroma cosine "distance" ≈ 1 - similarity; expose the similarity
            # as "score" to match the wire meaning of the HTTP backend.
            score = 1.0 - float(distance) if distance is not None else None
            hits.append(
                {
                    "id": hit_id,
                    "text": documents[i] if i < len(documents) else "",
                    "metadata": metadatas[i] if i < len(metadatas) else {},
                    "score": score,
                }
            )

        logger.info(
            "LocalVectorDB: query in %s/%s returned %d hits",
            namespace, collection_id, len(hits),
        )
        return {"hits": hits, "total": len(hits)}

    async def search_by_assessment(
        self,
        namespace: str,
        collection_id: str,
        query: str,
        assessment_id: str,
        k: int = 5,
    ) -> List[str]:
        """Same contract as ``VectorDBClient.search_by_assessment``."""
        payload = {
            "query": {"type": "KNN", "field": "text", "value": query, "k": k},
            "filter": {"must": [{"match": {"metadata.assessment_id": assessment_id}}]},
            "limit": k,
        }
        result = await self.search(namespace, collection_id, payload)
        return [hit["text"] for hit in result.get("hits", []) if hit.get("text")]


__all__ = ["LocalVectorDB"]
