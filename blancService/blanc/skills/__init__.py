"""
Blanc Skills — Modular agent capabilities for threat modeling.

Each Skill is a self-contained ``.md`` file with YAML frontmatter (metadata)
and a markdown body (instructions). Skills are loaded once, cached, and
accessed by name.

Template variables in the body use :class:`string.Template` syntax
(``$var`` or ``${var}``) so that literal ``{`` and ``}`` characters
(JSON examples, Mermaid blocks, etc.) pass through untouched.

Usage::

    from blanc.skills import get_skill, list_skills

    skill = get_skill("image_to_mermaid")
    skill.name          # "image_to_mermaid"
    skill.description   # "Converts architecture diagrams to Mermaid.js"
    skill.version       # "1.3"
    skill.input_vars    # ["diagram_type"]
    skill.response_model_ref  # "blanc.schemas...:MermaidResponse" or None

    formatted = skill.render(diagram_type="flowchart TD")
    model_cls = skill.response_model()  # resolved Pydantic class, if declared


Plugin discovery
----------------
External packages can ship their own skills without modifying this repo:

1. Set ``BLANC_SKILLS_DIRS`` to a ``os.pathsep``-separated list of directories.
2. Or register an entry point in the ``blanc.skills`` group that points to a
   module exposing a ``skills_dir: str`` (or ``Path``) attribute, or a
   callable returning a directory path.

Resolution order (first match wins): ``BLANC_SKILLS_DIRS`` directories,
entry-point directories, built-in ``definitions/`` directory.
"""

from __future__ import annotations

import importlib
import logging
import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from string import Template
from typing import Any, Callable, Dict, List, Optional, Tuple, Type

logger = logging.getLogger(__name__)

_BUILTIN_SKILLS_DIR = Path(__file__).resolve().parent / "definitions"
_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_ENTRY_POINT_GROUP = "blanc.skills"


@dataclass
class Skill:
    """A modular agent capability with metadata and instructions."""

    name: str
    description: str = ""
    version: str = "1.0"
    role: str = ""
    input_vars: List[str] = field(default_factory=list)
    output_format: str = ""
    tags: List[str] = field(default_factory=list)
    instructions: str = ""
    response_model_ref: Optional[str] = None
    source_path: Optional[Path] = None
    _metadata: Dict[str, Any] = field(default_factory=dict, repr=False)

    def render(self, **kwargs: Any) -> str:
        """Render the skill instructions with provided variables.

        Uses :meth:`string.Template.safe_substitute` so that missing
        placeholders are left as-is and literal ``{``/``}`` characters
        in the body are never interpreted as format spec.
        """
        return Template(self.instructions).safe_substitute(**kwargs)

    def response_model(self) -> Optional[Type[Any]]:
        """Resolve ``response_model_ref`` (``module.path:ClassName``) lazily.

        Returns ``None`` when no model is declared. Raises ``ImportError`` /
        ``AttributeError`` if the declared reference cannot be loaded.
        """
        if not self.response_model_ref:
            return None
        return _resolve_dotted_ref(self.response_model_ref)

    def __str__(self) -> str:
        return self.instructions


# ---------------------------------------------------------------------------
# Frontmatter parsing
# ---------------------------------------------------------------------------


def _parse_frontmatter(content: str) -> Tuple[Dict[str, Any], str]:
    """Split a skill file into ``(metadata_dict, body_text)``."""
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return {}, content

    frontmatter_text = match.group(1)
    body = content[match.end():]

    metadata: Dict[str, Any] = {}
    current_key: Optional[str] = None
    current_list: Optional[List[str]] = None

    for line in frontmatter_text.split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if stripped.startswith("- ") and current_key:
            if current_list is None:
                current_list = []
                metadata[current_key] = current_list
            current_list.append(stripped[2:].strip().strip('"').strip("'"))
            continue

        if ":" in stripped:
            key, _, value = stripped.partition(":")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            current_key = key
            current_list = None

            if value:
                metadata[key] = value

    return metadata, body


def _resolve_dotted_ref(ref: str) -> Type[Any]:
    """Resolve ``module.path:ClassName`` (or ``module.path.ClassName``) to an object."""
    if ":" in ref:
        module_path, _, attr = ref.partition(":")
    else:
        module_path, _, attr = ref.rpartition(".")
    if not module_path or not attr:
        raise ImportError(f"Invalid response_model reference: {ref!r}")
    module = importlib.import_module(module_path)
    return getattr(module, attr)


# ---------------------------------------------------------------------------
# Skill directory discovery
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _skill_dirs() -> Tuple[Path, ...]:
    """Return the ordered tuple of directories to search for skills.

    Order: ``BLANC_SKILLS_DIRS`` paths, entry-point paths, built-in dir.
    Missing directories are dropped with a debug log.
    """
    dirs: List[Path] = []
    seen: set = set()

    env_value = os.environ.get("BLANC_SKILLS_DIRS", "").strip()
    if env_value:
        for raw in env_value.split(os.pathsep):
            raw = raw.strip()
            if raw:
                dirs.append(Path(raw).expanduser())

    for ep_path in _entry_point_dirs():
        dirs.append(ep_path)

    dirs.append(_BUILTIN_SKILLS_DIR)

    resolved: List[Path] = []
    for path in dirs:
        try:
            resolved_path = path.resolve()
        except OSError:
            logger.debug("Skipping unreachable skills dir: %s", path)
            continue
        if resolved_path in seen:
            continue
        if not resolved_path.is_dir():
            logger.debug("Skills dir does not exist, skipping: %s", resolved_path)
            continue
        seen.add(resolved_path)
        resolved.append(resolved_path)

    return tuple(resolved)


def _entry_point_dirs() -> List[Path]:
    """Discover skill directories contributed via the ``blanc.skills`` entry point group."""
    try:
        from importlib.metadata import entry_points
    except ImportError:  # pragma: no cover - Python <3.10 fallback
        return []

    try:
        eps = entry_points()
        group = (
            eps.select(group=_ENTRY_POINT_GROUP)
            if hasattr(eps, "select")
            else eps.get(_ENTRY_POINT_GROUP, [])
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to enumerate %s entry points: %s", _ENTRY_POINT_GROUP, exc)
        return []

    discovered: List[Path] = []
    for ep in group:
        try:
            target: Any = ep.load()
        except Exception as exc:
            logger.warning("Failed to load skills entry point %r: %s", ep.name, exc)
            continue

        if callable(target):
            try:
                target = target()
            except Exception as exc:
                logger.warning("Skills entry point %r callable raised: %s", ep.name, exc)
                continue

        if isinstance(target, (str, os.PathLike)):
            discovered.append(Path(target))
        elif hasattr(target, "skills_dir"):
            discovered.append(Path(getattr(target, "skills_dir")))
        else:
            logger.warning(
                "Skills entry point %r resolved to unsupported value: %r", ep.name, target
            )
    return discovered


def _find_skill_file(name: str) -> Optional[Path]:
    """Locate the first ``<name>.md`` across configured skill directories."""
    safe_name = name.strip()
    if not safe_name or "/" in safe_name or "\\" in safe_name or safe_name.startswith("."):
        raise ValueError(f"Invalid skill name: {name!r}")

    for directory in _skill_dirs():
        candidate = directory / f"{safe_name}.md"
        if candidate.is_file():
            return candidate
    return None


# ---------------------------------------------------------------------------
# Loading + public API
# ---------------------------------------------------------------------------


@lru_cache(maxsize=None)
def _load_skill(name: str) -> Skill:
    """Load and parse a skill definition file (cached)."""
    filepath = _find_skill_file(name)
    if filepath is None:
        searched = [str(d) for d in _skill_dirs()]
        raise FileNotFoundError(
            f"Skill {name!r} not found. Searched: {searched}"
        )

    content = filepath.read_text(encoding="utf-8")
    metadata, body = _parse_frontmatter(content)

    input_vars = metadata.get("input_vars", [])
    tags = metadata.get("tags", [])

    return Skill(
        name=metadata.get("name", name),
        description=metadata.get("description", ""),
        version=metadata.get("version", "1.0"),
        role=metadata.get("role", ""),
        input_vars=input_vars if isinstance(input_vars, list) else [],
        output_format=metadata.get("output_format", ""),
        tags=tags if isinstance(tags, list) else [],
        instructions=body.strip(),
        response_model_ref=metadata.get("response_model") or None,
        source_path=filepath,
        _metadata=metadata,
    )


def get_skill(name: str) -> Skill:
    """Return a skill by name. Cached after first load."""
    return _load_skill(name)


def list_skills() -> List[str]:
    """List all available skill names across every configured directory.

    Names from earlier directories shadow same-named skills in later ones.
    """
    seen: Dict[str, Path] = {}
    for directory in _skill_dirs():
        try:
            entries = sorted(directory.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.suffix != ".md" or entry.name.startswith("_"):
                continue
            name = entry.stem
            if name not in seen:
                seen[name] = entry
            elif seen[name].parent != entry.parent:
                logger.debug(
                    "Skill %r already provided by %s; ignoring %s", name, seen[name], entry
                )
    return list(seen.keys())


def get_skill_registry() -> Dict[str, Skill]:
    """Load and return all skills as a ``{name: Skill}`` dict."""
    return {name: get_skill(name) for name in list_skills()}


def reload_skills() -> None:
    """Clear all caches so subsequent calls re-read disk / env / entry points."""
    _load_skill.cache_clear()
    _skill_dirs.cache_clear()


__all__ = [
    "Skill",
    "get_skill",
    "list_skills",
    "get_skill_registry",
    "reload_skills",
]
