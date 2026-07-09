FROM python:3.12-slim-bookworm

# System deps:
#   libmariadb-dev  → C connector for the `mariadb` pip package
#   build-essential → wheels that fall back to source builds
#   libgomp1        → OpenMP runtime required by paddlepaddle
#   libgl1          → OpenGL loader — some OpenCV code paths import it even
#                     under opencv-python-headless
#   libglib2.0-0    → glib runtime, dragged in by a few OCR wheels
#   curl            → healthchecks & debugging
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
        curl \
        libmariadb-dev \
        build-essential \
        libgomp1 \
        libgl1 \
        libglib2.0-0 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for maximum layer-cache hits. This is the
# slow bit — paddlepaddle alone is ~1 GB.
COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir --upgrade pip wheel setuptools && \
    python3 -m pip install --no-cache-dir -r requirements.txt

# sentence-transformers is optional in requirements.txt (pulls torch ~2 GB).
# The local RAG backend needs it. Install by default here so
# `docker compose up` just works. Comment out and switch
# rag_config.embedder.provider to "openai" if image size matters.
RUN python3 -m pip install --no-cache-dir "sentence-transformers>=2.7.0"

# Sanity-check the OCR stack at build time — catches missing system libs
# before an image goes to prod. If this fails, the apt install list above
# is the place to look.
RUN python3 -c "import cv2, paddle; from paddleocr import PaddleOCR; print('OCR stack OK')"

# App code + PP-OCRv6 weights (shipped in-tree under blanc/core/ocr/ocr_models/)
COPY main.py .
COPY blanc/ ./blanc/
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh && \
    mkdir -p /app/uploads /app/data/chroma

# Run as a non-root user — paddle likes to write to $HOME/.paddleocr, so
# ensure the home dir exists and is writable.
RUN useradd -r -u 10001 -m -d /home/blanc blanc && \
    chown -R blanc:blanc /app /home/blanc
USER blanc

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["python3", "main.py"]
