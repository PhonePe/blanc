"""Class registry — the ``@connector`` decorator auto-registers a
connector class under its ``name`` attribute.

The YAML entry key equals the Python class ``name``. The factory
:func:`build_dispatcher` imports each connector's module (from the
``module`` field in YAML), which triggers the decorator and populates
``_registry``.
"""
from __future__ import annotations

from typing import Dict, Type

from blanc.core.integrations.base import SurfaceMapConnector

_registry: Dict[str, Type[SurfaceMapConnector]] = {}


def connector(cls):
    """Register a connector class by its ``name`` attribute.

    Usage::

        @connector
        class Example(SurfaceMapConnector):
            name = "Example"
            supported_targets = ["component.desc", ...]
    """
    if not getattr(cls, "name", None):
        raise ValueError(
            f"{cls.__name__} is missing the required `name` class attribute"
        )
    key = cls.name
    if key in _registry and _registry[key] is not cls:
        raise ValueError(
            f"duplicate connector name {key!r} — already registered as "
            f"{_registry[key].__module__}.{_registry[key].__name__}"
        )
    _registry[key] = cls
    return cls


def get_connector_class(name: str) -> Type[SurfaceMapConnector]:
    if name not in _registry:
        raise ValueError(
            f"unknown connector {name!r}. Registered: {sorted(_registry)}"
        )
    return _registry[name]


def registered_connectors() -> Dict[str, Type[SurfaceMapConnector]]:
    """Return a copy of the current registry — used by health checks."""
    return dict(_registry)


__all__ = ["connector", "get_connector_class", "registered_connectors"]
