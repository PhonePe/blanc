"""Uvicorn entry point.

Kept intentionally thin — the app graph is built by
:func:`blanc.app.create_app`, which is safe to import from tests,
scripts, and tooling because it has no import-time side effects.
"""
import uvicorn

from blanc.app import create_app
from blanc.config_parsers.settings import get_settings

app = create_app()


if __name__ == "__main__":
    config = get_settings()
    uvicorn.run(
        "main:app",
        host=config.fastApiConfig.appHost,
        port=config.fastApiConfig.appPort,
        workers=config.fastApiConfig.num_workers,
        reload=True,
        # Only watch Python source. Without these filters, every user
        # upload (writes into `uploads/`) or Chroma index tick (writes
        # into `data/chroma/`) would trip WatchFiles → uvicorn tears
        # down the server mid-consume and the RMQ message never gets
        # ack'd. `.write_probe`-style tempfiles too.
        reload_dirs=["blanc"],
        reload_includes=["*.py"],
        reload_excludes=[
            "uploads/*",
            "data/*",
            "ocr_output/*",
            "env/*",
            "*.log",
            "*.write_probe*",
            ".blanc_write_probe_*",
        ],
        use_colors=False,
    )
