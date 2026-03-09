from __future__ import annotations

from typing import Any

from sqlalchemy import Engine, text

from .models import LiquidityRecord, TransactionRecord, UserScope


def normalize_user_id(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        parsed = int(value)
        return parsed if parsed == value else None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(stripped)
        except ValueError:
            return None
    return None


def normalize_role(value: Any) -> str:
    if not isinstance(value, str):
        return "user"
    lowered = value.strip().lower()
    return lowered if lowered in {"admin", "user"} else "user"


def normalize_portfolio_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    lowered = value.strip().lower()
    return lowered or None


def to_number(value: Any) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if value is None:
        return 0.0
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return 0.0
        if "," in stripped and "." not in stripped:
            stripped = stripped.replace(",", ".")
        try:
            return float(stripped)
        except ValueError:
            return 0.0
    return 0.0


def to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


class PortfolioRepository:
    def __init__(
        self,
        engine: Engine,
        table_prefix: str = "pky_",
        admin_portfolio_scoped_users: frozenset[str] | None = None,
    ) -> None:
        self.engine = engine
        self.table_prefix = table_prefix
        self.admin_portfolio_scoped_users = admin_portfolio_scoped_users or frozenset()

    def _table(self, suffix: str) -> str:
        return f"{self.table_prefix}{suffix}"

    def _fetch_table(self, suffix: str) -> list[dict[str, Any]]:
        table_name = self._table(suffix)
        query = text(f"SELECT * FROM {table_name}")
        with self.engine.connect() as connection:
            rows = connection.execute(query)
            return [dict(row._mapping) for row in rows]

    def get_visible_portfolios(self, scope: UserScope) -> list[str]:
        portfolios = self._fetch_table("portfolios")
        role = normalize_role(scope.role)
        username = scope.username.strip().lower()
        requested = (scope.portfolio or "ALL").strip()

        restrict_admin = role == "admin" and username in self.admin_portfolio_scoped_users
        if role == "admin" and not restrict_admin:
            all_names = [str(item.get("name", "")).strip() for item in portfolios if str(item.get("name", "")).strip()]
            if requested and requested != "ALL":
                return [requested] if requested in all_names else []
            return all_names

        current_user_id = normalize_user_id(scope.user_id)
        if current_user_id is None:
            return []

        owned_names: list[str] = []
        for portfolio in portfolios:
            owner_id = normalize_user_id(portfolio.get("owner_id"))
            user_id = normalize_user_id(portfolio.get("user_id"))
            if owner_id is not None and owner_id == current_user_id:
                owned_names.append(str(portfolio.get("name", "")).strip())
                continue
            if owner_id is None and user_id == current_user_id:
                owned_names.append(str(portfolio.get("name", "")).strip())

        owned_names = [name for name in owned_names if name]
        if requested and requested != "ALL":
            return [requested] if requested in owned_names else []
        return owned_names

    def get_transactions(self, scope: UserScope) -> tuple[list[TransactionRecord], list[str]]:
        visible_portfolios = set(self.get_visible_portfolios(scope))
        if not visible_portfolios and normalize_role(scope.role) != "admin":
            return [], []

        rows = self._fetch_table("transactions")
        records: list[TransactionRecord] = []
        for row in rows:
            portfolio = str(row.get("portfolio", "")).strip()
            if visible_portfolios and portfolio not in visible_portfolios:
                continue
            if scope.portfolio and scope.portfolio != "ALL" and portfolio != scope.portfolio:
                continue
            records.append(
                TransactionRecord(
                    id=normalize_user_id(row.get("id")),
                    date=str(row.get("date", "")).strip(),
                    portfolio=portfolio,
                    type=str(row.get("type", "")).strip(),
                    ticker=str(row.get("ticker", "")).strip().upper(),
                    asset_name=str(row.get("assetName") or row.get("asset_name") or row.get("nombre") or row.get("ticker") or "").strip(),
                    asset_type=str(row.get("assetType") or row.get("asset_type") or row.get("tipo_activo") or "Sin Clasificar").strip(),
                    quantity=to_number(row.get("quantity") or row.get("qty") or row.get("cantidad")),
                    price=to_number(row.get("price") or row.get("precio") or row.get("coste")),
                    commission=abs(to_number(row.get("commission") or row.get("comision") or row.get("fees"))),
                    currency_platform=str(row.get("currencyPlatform") or row.get("currency_platform") or row.get("divisa") or "EUR").strip().upper(),
                    fx_rate_to_eur=to_number(row.get("fxRateToEur") or row.get("fx_rate_to_eur") or row.get("tipo_cambio") or row.get("fxRate")) or 1.0,
                    exclude_from_metrics=to_bool(row.get("excludeFromMetrics") or row.get("exclude_from_metrics")),
                    non_cash=to_bool(row.get("nonCash") or row.get("non_cash")),
                    notes=str(row.get("notes") or row.get("nota") or "").strip(),
                )
            )
        return records, sorted(visible_portfolios)

    def get_liquidity(self, scope: UserScope) -> list[LiquidityRecord]:
        visible_portfolios = set(self.get_visible_portfolios(scope))
        if not visible_portfolios and normalize_role(scope.role) != "admin":
            return []

        rows = self._fetch_table("liquidity")
        records: list[LiquidityRecord] = []
        for row in rows:
            portfolio = str(row.get("portfolio", "")).strip()
            if visible_portfolios and portfolio not in visible_portfolios:
                continue
            if scope.portfolio and scope.portfolio != "ALL" and portfolio != scope.portfolio:
                continue
            records.append(
                LiquidityRecord(
                    id=normalize_user_id(row.get("id")),
                    date=str(row.get("date", "")).strip(),
                    portfolio=portfolio,
                    amount_eur=to_number(row.get("amountEur") or row.get("amount_eur") or row.get("amount") or row.get("importe")),
                    type=str(row.get("type", "")).strip(),
                    notes=str(row.get("notes") or row.get("nota") or "").strip(),
                )
            )
        return records
