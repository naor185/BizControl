"""
Connector SDK. A connector's only job is to read a source and hand the engine its records; the
Universal Import Engine (app/migration/engine.py) does everything else the same way for every
source. Adding a system = a new package app/connectors/<slug>/ exposing a BaseConnector subclass
as `CONNECTOR`; the registry picks it up, nothing in the engine changes.

Not every source has an API: auth_type says how a connector gets its data (file upload, API key,
OAuth…), and supported_entities says what it can actually provide. The engine never asks a
connector for an entity it did not declare.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

AUTH_TYPES = ("file", "api_key", "oauth", "api", "manual")


@dataclass(frozen=True)
class ConnectorManifest:
    slug: str
    name: str
    icon: str                              # lucide icon name, rendered by the frontend
    version: str
    auth_type: str                         # one of AUTH_TYPES
    supported_entities: tuple[str, ...]    # universal entity keys it can read
    description: str = ""
    requires_mapping: bool = False         # the business owner maps columns → fields (files)
    capabilities: tuple[str, ...] = ()     # e.g. "payment_token_migration" — declared only when real
    unsupported: tuple[str, ...] = ()      # shown to the owner so nothing is implied


@dataclass
class SourceTable:
    """What a connector read for one entity: column names and rows of raw values."""
    entity: str
    headers: list[str]
    rows: list[list]
    info: dict = field(default_factory=dict)   # e.g. sheet name, encoding, delimiter


class ConnectorError(Exception):
    """A problem the business owner can act on; the message is shown to them as-is (Hebrew)."""


class BaseConnector(ABC):
    manifest: ConnectorManifest

    @abstractmethod
    def read(self, entity: str) -> SourceTable:
        """All records of one entity. Raise ConnectorError for anything the owner can fix."""

    def test_connection(self) -> None:
        """Raise ConnectorError when the source cannot be reached (API connectors)."""
        return None
