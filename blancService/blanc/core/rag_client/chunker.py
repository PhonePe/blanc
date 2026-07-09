import hashlib
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Iterator

# Use the updated import path for LangChain splitters
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

def generate_appsec_chunks(
    pages_data: List[Dict[str, Any]], 
    source_name: str, 
    source_url: str, 
    chunk_size: int, 
    overlap: int,
    assessment_id: str = None,
) -> Iterator[Dict[str, Any]]:
    """
    Chunks text using LangChain's RecursiveCharacterTextSplitter.
    Generates highly traceable IDs, strict Metadata, and uses a generator for memory efficiency.
    
    Note: chunk_size and overlap now represent CHARACTER counts, not tokens.
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    
    # Use SHA-256 for AppSec best practices
    doc_hash = hashlib.sha256(source_name.encode()).hexdigest()[:8]

    # Initialize standard RecursiveCharacterTextSplitter
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=overlap,
        separators=["\n\n", "\n", " ", ""]
    )

    for section in pages_data:
        text = section.get("text", "")
        page = section.get("page_number", 0)
        
        # Skip empty pages
        if not text.strip():
            continue
            
        # Let LangChain do the heavy lifting of semantic splitting
        chunks = text_splitter.split_text(text)
        
        for chunk_index, chunk_text in enumerate(chunks, start=1):
            chunk_text = chunk_text.strip()
            if not chunk_text:
                continue
                
            # Content Hash for strict vector DB deduplication
            content_hash = hashlib.sha256(chunk_text.encode()).hexdigest()[:8]
            
            # URN-style ID incorporating the new content hash
            chunk_id = f"APPSEC-{doc_hash}-P{page}-C{chunk_index}-{content_hash}"
            
            metadata = {
                "source_file": source_name,
                "source_url": source_url or "not_provided",
                "page_number": page,
                "chunk_index": chunk_index,
                "chunk_length_chars": len(chunk_text),
                "ingested_at": timestamp,
            }
            if assessment_id:
                metadata["assessment_id"] = assessment_id
            
            # Yielding instead of appending saves RAM when processing massive PDFs
            yield {
                "content": {
                    "id": chunk_id,
                    "metadata": metadata,
                    "text": chunk_text
                }
            }