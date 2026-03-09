from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class UserScope:
    user_id: int | None
    role: str = "user"
    username: str = ""
    portfolio: str = "ALL"


@dataclass
class TransactionRecord:
    id: int | None
    date: str
    portfolio: str
    type: str
    ticker: str
    asset_name: str
    asset_type: str
    quantity: float
    price: float
    commission: float
    currency_platform: str
    fx_rate_to_eur: float
    exclude_from_metrics: bool = False
    non_cash: bool = False
    notes: str = ""


@dataclass
class LiquidityRecord:
    id: int | None
    date: str
    portfolio: str
    amount_eur: float
    type: str
    notes: str = ""


@dataclass
class PositionSnapshot:
    ticker: str
    asset_name: str
    portfolio: str
    asset_type: str
    currency_platform: str
    currency_origin: str
    quantity: float
    avg_price_platform: float
    avg_fx_rate: float
    avg_price_eur: float
    total_cost_eur: float
    total_cost_origin: float
    current_price_origin: float
    current_fx_rate_to_eur: float
    current_value_eur: float
    current_value_origin: float
    unrealized_pnl_eur: float
    unrealized_pnl_origin: float
    unrealized_pnl_pct: float
    realized_pnl_eur: float


@dataclass
class CashBalance:
    currency: str
    amount_origin: float
    amount_eur: float


@dataclass
class PortfolioSnapshot:
    positions: list[PositionSnapshot] = field(default_factory=list)
    cash_balances: list[CashBalance] = field(default_factory=list)
    visible_portfolios: list[str] = field(default_factory=list)
    total_value_eur: float = 0.0
    total_cash_eur: float = 0.0
    total_equity_eur: float = 0.0
    total_cost_eur: float = 0.0
    realized_pnl_eur: float = 0.0
    excluded_tickers: list[str] = field(default_factory=list)
    diagnostics: dict[str, Any] = field(default_factory=dict)


class StressTestRequest(BaseModel):
    user_id: int | None = None
    role: str = "user"
    username: str = ""
    portfolio: str = "ALL"
    scenario: str = Field(default="usd_rally")
    custom_shocks: dict[str, float] | None = None
