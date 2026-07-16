"""Build a :class:`Dispatcher` from :class:`AppConfig`.

Called once at app startup (:mod:`blanc.app`). The dispatcher is
cached on ``app.state`` and reused across every threat-modeling run.
"""
from __future__ import annotations

import importlib
import logging
from typing import Dict

from blanc.core.integrations.auth import build_auth
from blanc.core.integrations.base import SurfaceMapConnector
from blanc.core.integrations.dispatcher import Dispatcher
from blanc.core.integrations.http_runner import HttpRunner
from blanc.core.integrations.registry import get_connector_class

logger = logging.getLogger(__name__)


def build_dispatcher(cfg) -> Dispatcher:
    """Materialise every connector declared under ``integrations``."""
    ints = getattr(cfg, "integrations", None)
    if ints is None or not ints.connectors:
        logger.info("integrations: no connectors configured — dispatcher is a no-op")
        return Dispatcher(connectors_by_name={}, field_sources={})

    connectors: Dict[str, SurfaceMapConnector] = {}

    for name, entry in ints.connectors.items():
        # Importing the module triggers the @connector decorator, which
        # registers the class under its `name` attribute.
        try:
            importlib.import_module(entry.module)
        except ImportError as e:
            logger.error(
                "integrations: could not import module %s for connector %s: %s "
                "— skipping",
                entry.module, name, e,
            )
            continue

        try:
            cls = get_connector_class(name)
        except ValueError as e:
            logger.error(
                "integrations: %s — skipping (check that the class inside "
                "%s has `name = %r`)",
                e, entry.module, name,
            )
            continue

        auth_key = entry.auth
        auth_profile = ints.auth.get(auth_key)
        if auth_profile is None:
            logger.error(
                "integrations: connector %s references unknown auth profile "
                "%r — skipping",
                name, auth_key,
            )
            continue

        try:
            auth = build_auth(auth_profile)
        except Exception as e:
            logger.error(
                "integrations: could not build auth %r for %s: %s — skipping",
                auth_key, name, e,
            )
            continue

        entry_dict = entry.model_dump()
        http = HttpRunner(entry_dict, auth)
        connectors[name] = cls(entry_dict, http, auth)
        logger.info(
            "integrations: loaded connector %s (%s → %s), supports %s",
            name, entry.module, entry.url or "<no url>",
            list(cls.supported_targets),
        )

    # Sanity: every connector referenced in field_sources must exist +
    # support the target. Log dead references at boot instead of at
    # first sync — makes misconfiguration obvious.
    for target, chain in ints.field_sources.items():
        for cname in chain:
            if cname not in connectors:
                logger.warning(
                    "integrations: field_sources[%s] references connector %r "
                    "which is not loaded",
                    target, cname,
                )
                continue
            if target not in connectors[cname].supported_targets:
                logger.warning(
                    "integrations: connector %s does not declare support "
                    "for target %s (declared: %s)",
                    cname, target, connectors[cname].supported_targets,
                )

    return Dispatcher(connectors_by_name=connectors,
                      field_sources=dict(ints.field_sources))


__all__ = ["build_dispatcher"]
