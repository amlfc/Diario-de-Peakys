from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from app.fx_analytics import build_portfolio_snapshot
from app.models import LiquidityRecord, PortfolioSnapshot, TransactionRecord


@dataclass
class FakeQuoteSnapshot:
    price: float | None
    currency: str | None


class FakeMarketClient:
    def __init__(self) -> None:
        index = pd.date_range("2025-01-01", periods=40, freq="B")
        eurusd = pd.Series([1.05 + (0.002 * i) for i in range(len(index))], index=index)
        eurjpy = pd.Series([160 + i * 0.4 for i in range(len(index))], index=index)
        eurgbp = pd.Series([0.84 + i * 0.0005 for i in range(len(index))], index=index)
        eurchf = pd.Series([0.95 - i * 0.0012 for i in range(len(index))], index=index)
        eurnok = pd.Series([11.0 + i * 0.02 for i in range(len(index))], index=index)
        usdmxn = pd.Series([17.0 + i * 0.08 for i in range(len(index))], index=index)
        usdtry = pd.Series([34.0 + i * 0.2 for i in range(len(index))], index=index)
        dxy = pd.Series([98 + i * 0.25 for i in range(len(index))], index=index)

        self.price_series = {
            "EURUSD=X": eurusd,
            "EURJPY=X": eurjpy,
            "EURGBP=X": eurgbp,
            "EURCHF=X": eurchf,
            "EURNOK=X": eurnok,
            "USDMXN=X": usdmxn,
            "USDTRY=X": usdtry,
            "DX-Y.NYB": dxy,
            "SPY": pd.Series([500.0] * len(index), index=index),
            "GC=F": pd.Series([2000.0] * len(index), index=index),
            "BTC-EUR": pd.Series([60_000 + i * 200 for i in range(len(index))], index=index),
            "ETH-EUR": None,
            "EURCAD=X": pd.Series([1.52 + i * 0.003 for i in range(len(index))], index=index),
            "EURAUD=X": pd.Series([1.60 + i * 0.002 for i in range(len(index))], index=index),
            "EURSEK=X": pd.Series([10.5 + i * 0.01 for i in range(len(index))], index=index),
            "USDJPY=X": pd.Series([150 + i * 0.4 for i in range(len(index))], index=index),
            "USDCHF=X": pd.Series([0.82 - i * 0.001 for i in range(len(index))], index=index),
        }
        self.eur_cross_series = {
            "USD": eurusd,
            "JPY": eurjpy,
            "GBP": eurgbp,
            "CHF": eurchf,
            "NOK": eurnok,
            "MXN": eurusd * usdmxn,
            "TRY": eurusd * usdtry,
            "CAD": self.price_series["EURCAD=X"],
            "AUD": self.price_series["EURAUD=X"],
            "SEK": self.price_series["EURSEK=X"],
        }
        self.quotes = {
            "SPY": FakeQuoteSnapshot(price=500.0, currency="USD"),
            "GC=F": FakeQuoteSnapshot(price=2000.0, currency="USD"),
            "BTC-EUR": FakeQuoteSnapshot(price=68_000.0, currency="EUR"),
            "ETH-EUR": FakeQuoteSnapshot(price=None, currency="EUR"),
        }

    def get_close_series_batch(self, tickers, period="1y", interval="1d"):
        result = {}
        missing = []
        for ticker in tickers:
            series = self.get_close_series(ticker, period=period, interval=interval)
            if series is None:
                missing.append(ticker)
            else:
                result[ticker] = series
        return result, missing

    def get_close_series(self, ticker, period="1y", interval="1d"):
        series = self.price_series.get(ticker)
        return series.copy() if isinstance(series, pd.Series) else None

    def get_asset_price_and_currency(self, ticker, fallback_currency=None):
        snapshot = self.quotes.get(ticker, FakeQuoteSnapshot(price=None, currency=fallback_currency))
        return snapshot

    def get_current_currency_to_eur(self, currency):
        series, missing = self.get_currency_to_eur_series(currency, period="1mo")
        if series is None:
            return None, missing
        return float(series.iloc[-1]), []

    def get_currency_to_eur_series(self, currency, period="1y"):
        eur_cross, missing = self.get_eur_cross_series(currency, period=period)
        if eur_cross is None:
            return None, missing
        if currency.upper() == "EUR":
            return eur_cross, []
        return 1.0 / eur_cross, []

    def get_eur_cross_series(self, currency, period="1y"):
        normalized = currency.upper()
        if normalized == "EUR":
            base = self.eur_cross_series["USD"]
            return pd.Series([1.0] * len(base), index=base.index), []
        series = self.eur_cross_series.get(normalized)
        if series is None:
            return None, [f"EUR/{normalized}"]
        return series.copy(), []

    def get_fx_pair_label(self, currency):
        normalized = currency.upper()
        return "EUR" if normalized == "EUR" else f"EUR/{normalized}"


def sample_transactions() -> list[TransactionRecord]:
    return [
        TransactionRecord(
            id=1,
            date="2025-01-02",
            portfolio="Core",
            type="Compra",
            ticker="SPY",
            asset_name="SPDR S&P 500 ETF",
            asset_type="ETF largo",
            quantity=10,
            price=400,
            commission=0,
            currency_platform="USD",
            fx_rate_to_eur=0.9,
        ),
        TransactionRecord(
            id=2,
            date="2025-01-10",
            portfolio="Core",
            type="Compra",
            ticker="BTC-EUR",
            asset_name="Bitcoin",
            asset_type="Criptomonedas",
            quantity=1,
            price=55_000,
            commission=0,
            currency_platform="EUR",
            fx_rate_to_eur=1.0,
        ),
        TransactionRecord(
            id=3,
            date="2025-01-20",
            portfolio="Core",
            type="Venta",
            ticker="SPY",
            asset_name="SPDR S&P 500 ETF",
            asset_type="ETF largo",
            quantity=2,
            price=450,
            commission=0,
            currency_platform="USD",
            fx_rate_to_eur=0.92,
        ),
        TransactionRecord(
            id=4,
            date="2025-01-25",
            portfolio="Core",
            type="Compra",
            ticker="EURUSD",
            asset_name="Cambio de divisa",
            asset_type="FX",
            quantity=1,
            price=1,
            commission=0,
            currency_platform="EUR",
            fx_rate_to_eur=1.0,
            exclude_from_metrics=True,
        ),
        TransactionRecord(
            id=5,
            date="2025-02-01",
            portfolio="Core",
            type="Compra",
            ticker="GC=F",
            asset_name="Gold Futures",
            asset_type="Materia prima",
            quantity=1,
            price=1900,
            commission=0,
            currency_platform="USD",
            fx_rate_to_eur=0.91,
            non_cash=True,
        ),
    ]


def sample_liquidity() -> list[LiquidityRecord]:
    return [
        LiquidityRecord(id=1, date="2025-01-01", portfolio="Core", amount_eur=100_000, type="Ingreso"),
    ]


def snapshot(fake_market_client: FakeMarketClient) -> PortfolioSnapshot:
    return build_portfolio_snapshot(sample_transactions(), sample_liquidity(), ["Core"], fake_market_client)


import pytest


@pytest.fixture
def fake_market_client():
    return FakeMarketClient()


@pytest.fixture
def sample_snapshot(fake_market_client):
    return snapshot(fake_market_client)
