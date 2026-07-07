"""
Application settings loader.

One canonical entry point::

    from atm.config_parsers.settings import get_settings
    settings = get_settings()   # -> AppConfig

Resolution order (highest priority first):

    1. ``ATM_CONFIG_PATH`` env var  → absolute path to any YAML file.
    2. ``ENV`` env var              → picks ``atm/config/<env>.yml``
                                       (default: ``config`` → ``config.yml``).

Environment-variable expansion
------------------------------
Inside the YAML, ``${VAR}`` and ``${VAR:-fallback}`` tokens are expanded
from the current process environment at load time. Missing vars without
a fallback raise a clear error rather than silently rendering as empty
strings.

Design notes
------------
* Pure module-level function with ``@lru_cache`` — no shared mutable
  class state, no framework magic, easy to reset in tests via
  :func:`reload_settings`.
* Uses ``yaml.safe_load`` (never ``yaml.load``) and Pydantic v2's
  ``model_validate``.
* Exits with code ``2`` (misuse) on config errors, not ``0`` — so
  process supervisors treat a bad config as a real failure.
"""
from __future__ import annotations

import logging
import os
import re
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, NoReturn

import yaml

from atm.config_parsers.config_models import AppConfig

log = logging.getLogger(__name__)

_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_CONFIG_DIR = _PACKAGE_ROOT / "config"
_DEFAULT_ENV = "config"

# Matches ${VAR} and ${VAR:-fallback}. The fallback may contain any char
# except a closing brace, which matches shell semantics closely enough
# for config-file use.
_ENV_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


def _die(msg: str) -> NoReturn:
    """Log a config-loading error and exit fast with a non-zero code."""
    log.critical(msg)
    print(f"✗ config: {msg}", file=sys.stderr)
    raise SystemExit(2)  # 2 = misuse / bad config.


def _resolve_config_path() -> Path:
    """Figure out which YAML to load based on env vars, without side-effects."""
    override = os.environ.get("ATM_CONFIG_PATH", "").strip()
    if override:
        path = Path(override).expanduser().resolve()
        if not path.is_file():
            _die(f"ATM_CONFIG_PATH points at a missing file: {path}")
        return path

    env_name = (os.environ.get("ENV", "") or _DEFAULT_ENV).strip() or _DEFAULT_ENV
    path = _CONFIG_DIR / f"{env_name}.yml"
    if not path.is_file():
        _die(
            f"No config file for ENV={env_name!r} at {path}.\n"
            f"  Either set ATM_CONFIG_PATH, ENV, or drop a {env_name}.yml "
            f"under {_CONFIG_DIR}."
        )
    return path


def _expand_env(value: Any) -> Any:
    """Recursively expand ``${VAR}`` and ``${VAR:-default}`` tokens in
    every string in a parsed YAML tree. Non-string leaves pass through.

    After expansion the resulting string is validated to reject content
    that could re-open YAML parsing surprises — no ``${...}``, no
    unescaped newlines. This closes the low-severity N3 finding where a
    hostile env var could sneak YAML into what looks like a leaf value.
    """
    if isinstance(value, str):
        def repl(match: "re.Match[str]") -> str:
            name = match.group(1)
            fallback = match.group(2)
            env_value = os.environ.get(name)
            # Match shell `${VAR:-default}` semantics: "unset OR empty"
            # both trigger the fallback. Without the empty-string clause,
            # a stray `export JWT_SECRET_KEY=` in the caller's shell
            # blanks the JWT secret and takes down startup.
            if env_value:
                # Reject values that could reopen YAML re-parsing or
                # inject a second ${VAR} pass. This does NOT block ':'
                # (URLs and connection strings legitimately contain it).
                if "\n" in env_value or "${" in env_value:
                    _die(
                        f"Environment variable {name!r} contains a "
                        f"newline or a nested ${{...}} reference — "
                        f"refusing to expand it into the config."
                    )
                return env_value
            if fallback is not None:
                return fallback
            raise KeyError(name)

        try:
            return _ENV_REF.sub(repl, value)
        except KeyError as e:
            _die(
                f"Environment variable {e.args[0]!r} is referenced in the "
                f"config but is not set. Either export it, or use the "
                f"${{{e.args[0]}:-<default>}} syntax to give it a fallback."
            )
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    return value


def _load(path: Path) -> AppConfig:
    log.info("Loading application settings from %s", path)
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        _die(f"YAML parse error in {path}: {e}")
    except OSError as e:
        _die(f"Cannot read {path}: {e}")

    if not isinstance(raw, dict):
        _die(
            f"Top-level YAML in {path} must be a mapping, got "
            f"{type(raw).__name__}."
        )

    expanded = _expand_env(raw)
    try:
        # Pydantic v2. Falls back to parse_obj for older installs.
        if hasattr(AppConfig, "model_validate"):
            return AppConfig.model_validate(expanded)
        return AppConfig.parse_obj(expanded)  # type: ignore[attr-defined]
    except Exception as e:
        _die(f"Config validation failed for {path}:\n{e}")


@lru_cache(maxsize=1)
def get_settings() -> AppConfig:
    """Return the parsed :class:`AppConfig`, loading on first call.

    Subsequent calls return the same in-memory instance.
    """
    return _load(_resolve_config_path())


def reload_settings() -> AppConfig:
    """Drop the cache and re-read from disk. Mainly for tests."""
    get_settings.cache_clear()
    return get_settings()


__all__ = ["get_settings", "reload_settings"]
