import httpx
import logging
import asyncio
import os
from fastapi import HTTPException

logger = logging.getLogger(__name__)

class VectorDBClient:
    def __init__(self, config):
        # Get RAG config from the application config
        rag_config = config.rag_config
        self.vector_db_host = rag_config.api_url
        self.auth_token_env = getattr(rag_config, "auth_token_env", "ATM_RAG_API_KEY")
        
        # Timeouts (in seconds) - increased for remote APIs
        self.ingest_timeout = 1200.0  # 20 minutes for large documents
        self.search_timeout = 60.0    # 1 minute for search
        
        # Batch processing settings
        self.batch_size = 100  # Process chunks in batches of 100
        self.max_retries = 3
        self.retry_delay = 2.0  # Start with 2s delay
        
        logger.info(f"VectorDBClient initialized with host: {self.vector_db_host}")
        logger.info(f"Batch size: {self.batch_size}, Max retries: {self.max_retries}")

    def _get_headers(self):
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        token = os.environ.get(self.auth_token_env, "") if self.auth_token_env else ""
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def _ingest_single_batch(self, client: httpx.AsyncClient, url: str,
                                     batch_num: int, batch_documents: list,
                                     semaphore: asyncio.Semaphore) -> dict:
        """Ingest a single batch of documents with retry logic and concurrency control."""
        async with semaphore:
            retry_count = 0
            last_error = None

            while retry_count < self.max_retries:
                try:
                    logger.debug(f"Batch {batch_num}: Attempt {retry_count + 1}/{self.max_retries} - Sending {len(batch_documents)} documents")

                    response = await client.post(
                        url,
                        json={"documents": batch_documents},
                        headers=self._get_headers(),
                    )

                    if response.status_code == 200:
                        logger.info(f"Batch {batch_num}: ✓ Successfully ingested {len(batch_documents)} documents")
                        return response.json()

                    elif response.status_code >= 500:
                        last_error = f"HTTP {response.status_code}: {response.text[:100]}"
                        retry_count += 1

                        if retry_count < self.max_retries:
                            wait_time = self.retry_delay * (2 ** (retry_count - 1))
                            logger.warning(f"Batch {batch_num}: Server error ({response.status_code}). Retrying in {wait_time}s...")
                            await asyncio.sleep(wait_time)
                        else:
                            logger.error(f"Batch {batch_num}: Failed after {self.max_retries} retries: {last_error}")
                            raise HTTPException(
                                status_code=response.status_code,
                                detail=f"Remote API error (Status {response.status_code}). Large documents may require splitting.",
                            )
                    else:
                        logger.error(f"Batch {batch_num}: Client error ({response.status_code}): {response.text[:200]}")
                        raise HTTPException(
                            status_code=response.status_code,
                            detail=f"Ingest failed: {response.text[:100]}",
                        )

                except httpx.TimeoutException:
                    last_error = f"Timeout after {self.ingest_timeout}s"
                    retry_count += 1

                    if retry_count < self.max_retries:
                        wait_time = self.retry_delay * (2 ** (retry_count - 1))
                        logger.warning(f"Batch {batch_num}: {last_error}. Retrying in {wait_time}s...")
                        await asyncio.sleep(wait_time)
                    else:
                        logger.error(f"Batch {batch_num}: {last_error} after {self.max_retries} retries")
                        raise HTTPException(
                            status_code=504,
                            detail="Vector DB API timeout. The document may be too large. Try splitting the PDF into smaller parts.",
                        )
                except HTTPException:
                    raise
                except Exception as e:
                    logger.exception(f"Batch {batch_num}: Unexpected error: {str(e)}")
                    raise HTTPException(status_code=500, detail=f"Ingest error: {str(e)}")

            raise HTTPException(status_code=500, detail="Ingest failed after all retries")

    async def ingest_batch(self, namespace: str, collection_id: str, chunks: list,
                           max_concurrency: int = 3):
        """Ingest documents in concurrent batches with a shared HTTP client."""
        url = f"{self.vector_db_host}v1/collection/{namespace}/ingest/{collection_id}"
        total_chunks = len(chunks)
        total_batches = (total_chunks + self.batch_size - 1) // self.batch_size

        logger.info(f"Starting ingestion of {total_chunks} chunks in {total_batches} batches (concurrency={max_concurrency})")

        if total_chunks == 0:
            raise HTTPException(status_code=400, detail="No documents to ingest")

        semaphore = asyncio.Semaphore(max_concurrency)

        async with httpx.AsyncClient(timeout=httpx.Timeout(self.ingest_timeout)) as client:
            tasks = []
            for batch_num in range(0, total_chunks, self.batch_size):
                batch_end = min(batch_num + self.batch_size, total_chunks)
                batch_documents = chunks[batch_num:batch_end]
                batch_number = (batch_num // self.batch_size) + 1

                tasks.append(
                    self._ingest_single_batch(client, url, batch_number, batch_documents, semaphore)
                )

            results = await asyncio.gather(*tasks, return_exceptions=True)

        # Check for failures
        errors = [r for r in results if isinstance(r, Exception)]
        if errors:
            succeeded = len(results) - len(errors)
            logger.warning(f"Ingestion partially failed: {succeeded}/{total_batches} batches succeeded, {len(errors)} failed")
            raise errors[0]  # Re-raise the first error

        logger.info(f"✓ Successfully ingested all {total_chunks} chunks across {total_batches} batches")
        return {"status": "success", "total_chunks": total_chunks, "batches": total_batches}

    async def search(self, namespace: str, collection_id: str, payload: dict):
        url = f"{self.vector_db_host}v1/collection/{namespace}/search/{collection_id}"
        query_text = payload.get('query', {}).get('value', 'N/A')
        
        logger.info(f"Searching in {namespace}/{collection_id} for query: {query_text[:50]}...")
        
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.search_timeout)) as client:
                response = await client.post(url, json=payload, headers=self._get_headers())
                
                if response.status_code >= 400:
                    error_msg = f"Search DB Error: Status {response.status_code} - {response.text[:200]}"
                    logger.error(error_msg)
                    raise HTTPException(status_code=response.status_code, detail=error_msg)
                
                logger.info(f"Search completed successfully")
                return response.json()
                
        except httpx.TimeoutException as e:
            error_msg = f"Search timeout after {self.search_timeout}s"
            logger.error(error_msg)
            raise HTTPException(status_code=504, detail=error_msg)
        except Exception as e:
            logger.exception(f"Search error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to search: {str(e)}")

    async def search_by_assessment(self, namespace: str, collection_id: str, query: str,
                                    assessment_id: str, k: int = 5) -> list:
        """Search with metadata filter for a specific assessment_id."""
        payload = {
            "query": {
                "type": "KNN",
                "field": "text",
                "value": query,
                "numCandidates": 10000,
                "k": k,
                "similarity": 0.3,
            },
            "filter": {
                "must": [
                    {"match": {"metadata.assessment_id": assessment_id}}
                ]
            },
            "limit": k,
            "trackTotalHits": 0,
        }
        result = await self.search(namespace, collection_id, payload)
        # Extract text from search results
        documents = []
        if isinstance(result, dict):
            for hit in result.get("hits", result.get("documents", [])):
                text = hit.get("text") or hit.get("content", {}).get("text", "")
                if text:
                    documents.append(text)
        elif isinstance(result, list):
            for hit in result:
                text = hit.get("text") or hit.get("content", {}).get("text", "")
                if text:
                    documents.append(text)
        return documents
