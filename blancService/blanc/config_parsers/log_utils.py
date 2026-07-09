"""Logging bootstrap.

Reads the ``logging`` block out of ``config.yml`` (already a
``dictConfig``-shaped mapping) and hands it to stdlib. After
``dictConfig`` runs, the ambient-context filter is attached to the root
logger so every subsequent log line carries ``request_id`` /
``assessment_id`` / ``image_id`` from the current contextvars.
"""
from __future__ import annotations

import logging
import logging.config

from blanc.config_parsers.settings import get_settings
from blanc.util.logging_context import install_context_filter


class LoggingConfig:
    """Namespaced init hook — kept as a class for legacy call sites."""

    @staticmethod
    def configure_logging() -> None:
        log_config = get_settings().logging
        logging.config.dictConfig(log_config)
        install_context_filter()
        logging.info("Enabled logging config")
