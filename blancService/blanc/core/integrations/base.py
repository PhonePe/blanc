"""Base contract for every external-org integration.

Plugin-style — subclasses implement three methods and declare which
``target`` fields on the surface map they can populate.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar, List, Optional

import httpx
from pydantic import BaseModel


class ConnectorResult(BaseModel):
    """Return value of every connector's ``parse_response``.

    ``value`` is whatever the target field expects (str for ``desc``, a
    Literal value for ``exposure`` / ``authn`` / ..., a bool, etc.).
    ``source_ref`` is stamped onto ``SurfaceComponent.sources[<field>]``
    for auditability — typically a message id or a doc URL.
    """
    value: Any
    source_ref: Optional[str] = None


class SurfaceMapConnector(ABC):
    """Base class for every external-org integration.

    Class attributes:
        name              — unique key; must match the YAML entry key
                            under ``integrations.connectors``.
        supported_targets — list of ``"component.<field>"`` /
                            ``"boundary.<field>"`` targets this
                            connector knows how to answer for. The
                            framework only routes matching targets to
                            this instance.
    """
    name: ClassVar[str]
    supported_targets: ClassVar[List[str]] = []

    def __init__(self, cfg, http, auth):
        # ``cfg`` is the per-instance YAML block (ConnectorConfig dumped
        # to dict). ``http`` and ``auth`` are framework services.
        self.cfg = cfg
        self.http = http
        self.auth = auth

    # 1️⃣ Build the outbound request(s) for one entity + target.
    @abstractmethod
    def get_api_calls(self, entity, target: str) -> List[httpx.Request]:
        raise NotImplementedError

    # 2️⃣ Turn a single response into a typed value (or ``None`` to skip
    #     / fall through to the next connector in the chain).
    @abstractmethod
    def parse_response(
        self,
        response: httpx.Response,
        entity,
        target: str,
    ) -> Optional[ConnectorResult]:
        raise NotImplementedError

    # 3️⃣ Persist via framework helper. Overriding this is rarely needed
    #     — the default respects user-lock and stamps provenance.
    async def db_operations(
        self,
        result: ConnectorResult,
        entity,
        target: str,
    ) -> None:
        # Import inside the method to avoid a circular import at module
        # load — db_helpers pulls in SurfaceMap crud which in turn
        # imports schemas which imports base indirectly during startup.
        from blanc.core.integrations.db_helpers import update_surface_field

        kind, field = target.split(".", 1)
        await update_surface_field(
            entity_id=entity.id,
            kind=kind,
            field=field,
            value=result.value,
            provider=self.name,
            source_ref=result.source_ref,
        )


__all__ = ["ConnectorResult", "SurfaceMapConnector"]
