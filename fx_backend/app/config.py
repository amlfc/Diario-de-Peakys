from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _parse_origins(raw_value: str) -> tuple[str, ...]:
    parts = [item.strip() for item in raw_value.split(",")]
    return tuple(item for item in parts if item) or ("*",)


def _parse_admin_users(raw_value: str) -> frozenset[str]:
    parts = [item.strip().lower() for item in raw_value.split(",")]
    return frozenset(item for item in parts if item)


@dataclass(frozen=True)
class Settings:
    database_url: str
    table_prefix: str
    cache_ttl_seconds: int
    allowed_origins: tuple[str, ...]
    admin_portfolio_scoped_users: frozenset[str]
    debug: bool


@lru_cache
def get_settings() -> Settings:
    database_url = os.getenv("FX_MYSQL_URL") or os.getenv("DATABASE_URL") or "sqlite:///./peakys_fx.db"
    table_prefix = os.getenv("FX_TABLE_PREFIX", "pky_")
    cache_ttl_seconds = int(os.getenv("FX_CACHE_TTL_SECONDS", "900"))
    allowed_origins = _parse_origins(os.getenv("FX_ALLOWED_ORIGINS", "*"))
    admin_users = _parse_admin_users(os.getenv("FX_ADMIN_PORTFOLIO_SCOPED_USERS", "sevi"))
    debug = os.getenv("FX_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}

    return Settings(
        database_url=database_url,
        table_prefix=table_prefix,
        cache_ttl_seconds=cache_ttl_seconds,
        allowed_origins=allowed_origins,
        admin_portfolio_scoped_users=admin_users,
        debug=debug,
    )
