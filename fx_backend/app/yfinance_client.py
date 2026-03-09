from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import pandas as pd
import yfinance as yf

from .cache import TTLCache


BANNED_TICKERS = {"BUXX.EUR", "XAU=EUR", "EUR=F", "FESX=F"}

FX_OVERVIEW_TICKERS = [
    {"ticker": "EURUSD=X", "pair": "EUR/USD", "type": "Major", "currency": "USD"},
    {"ticker": "EURJPY=X", "pair": "EUR/JPY", "type": "Major", "currency": "JPY"},
    {"ticker": "EURGBP=X", "pair": "EUR/GBP", "type": "Major", "currency": "GBP"},
    {"ticker": "EURCHF=X", "pair": "EUR/CHF", "type": "Safe haven", "currency": "CHF"},
    {"ticker": "EURCAD=X", "pair": "EUR/CAD", "type": "Commodity", "currency": "CAD"},
    {"ticker": "EURAUD=X", "pair": "EUR/AUD", "type": "Commodity", "currency": "AUD"},
    {"ticker": "EURNOK=X", "pair": "EUR/NOK", "type": "Oil proxy", "currency": "NOK"},
    {"ticker": "EURSEK=X", "pair": "EUR/SEK", "type": "Minor", "currency": "SEK"},
    {"ticker": "USDJPY=X", "pair": "USD/JPY", "type": "Carry", "currency": None},
    {"ticker": "USDCHF=X", "pair": "USD/CHF", "type": "Safe haven", "currency": None},
    {"ticker": "USDMXN=X", "pair": "USD/MXN", "type": "EM", "currency": None},
    {"ticker": "USDTRY=X", "pair": "USD/TRY", "type": "EM alto yield", "currency": None},
    {"ticker": "DX-Y.NYB", "pair": "DXY", "type": "USD Index", "currency": None},
    {"ticker": "BTC-EUR", "pair": "BTC/EUR", "type": "Crypto", "currency": None},
    {"ticker": "ETH-EUR", "pair": "ETH/EUR", "type": "Crypto", "currency": None},
]

ASSET_CURRENCY_OVERRIDES = {
    "SPY": "USD",
    "QQQ": "USD",
    "GC=F": "USD",
    "CL=F": "USD",
    "BTC-USD": "USD",
    "ETH-USD": "USD",
    "^IBEX": "EUR",
}

EUR_DIRECT_TICKERS = {
    "USD": "EURUSD=X",
    "JPY": "EURJPY=X",
    "GBP": "EURGBP=X",
    "CHF": "EURCHF=X",
    "CAD": "EURCAD=X",
    "AUD": "EURAUD=X",
    "NOK": "EURNOK=X",
    "SEK": "EURSEK=X",
}

USD_CROSS_TICKERS = {
    "JPY": "USDJPY=X",
    "CHF": "USDCHF=X",
    "MXN": "USDMXN=X",
    "TRY": "USDTRY=X",
}


@dataclass(frozen=True)
class QuoteSnapshot:
    price: float | None
    currency: str | None


def _clean_series(series: pd.Series | None) -> pd.Series | None:
    if series is None:
        return None
    cleaned = series.dropna()
    if cleaned.empty:
        return None
    cleaned.index = pd.to_datetime(cleaned.index).tz_localize(None)
    cleaned.name = None
    return cleaned.sort_index()


class YFinanceClient:
    def __init__(self, cache_ttl_seconds: int = 900, cache: TTLCache | None = None) -> None:
        self.cache = cache or TTLCache(cache_ttl_seconds)
        self.cache_ttl_seconds = cache_ttl_seconds

    def _extract_close_series(self, data: pd.DataFrame, ticker: str, multiple: bool) -> pd.Series | None:
        if data.empty:
            return None
        if multiple:
            if ticker not in data.columns.get_level_values(0):
                return None
            ticker_frame = data[ticker]
            if "Close" not in ticker_frame.columns:
                return None
            return _clean_series(ticker_frame["Close"])
        if "Close" not in data.columns:
            return None
        return _clean_series(data["Close"])

    def get_close_series_batch(self, tickers: Iterable[str], period: str = "1y", interval: str = "1d") -> tuple[dict[str, pd.Series], list[str]]:
        unique_tickers = [ticker for ticker in dict.fromkeys(tickers) if ticker and ticker not in BANNED_TICKERS]
        if not unique_tickers:
            return {}, []

        result: dict[str, pd.Series] = {}
        missing: list[str] = []
        to_fetch: list[str] = []
        for ticker in unique_tickers:
            cache_key = ("close", ticker, period, interval)
            cached = self.cache.get(cache_key)
            if isinstance(cached, pd.Series):
                result[ticker] = cached.copy()
            else:
                to_fetch.append(ticker)

        if to_fetch:
            download = yf.download(
                tickers=to_fetch,
                period=period,
                interval=interval,
                auto_adjust=False,
                progress=False,
                threads=False,
                group_by="ticker",
            )
            multiple = len(to_fetch) > 1
            for ticker in to_fetch:
                series = self._extract_close_series(download, ticker, multiple)
                if series is None:
                    missing.append(ticker)
                    continue
                self.cache.set(("close", ticker, period, interval), series.copy())
                result[ticker] = series.copy()

        return result, missing

    def get_close_series(self, ticker: str, period: str = "1y", interval: str = "1d") -> pd.Series | None:
        series_map, missing = self.get_close_series_batch([ticker], period=period, interval=interval)
        if missing:
            return None
        series = series_map.get(ticker)
        return series.copy() if series is not None else None

    def get_quote_snapshot(self, ticker: str, fallback_currency: str | None = None) -> QuoteSnapshot:
        cache_key = ("quote", ticker, fallback_currency or "")
        cached = self.cache.get(cache_key)
        if isinstance(cached, QuoteSnapshot):
            return cached

        price = None
        currency = ASSET_CURRENCY_OVERRIDES.get(ticker)
        series = self.get_close_series(ticker, period="1mo")
        if series is not None and not series.empty:
            price = float(series.iloc[-1])

        if currency is None:
            try:
                ticker_client = yf.Ticker(ticker)
                fast_info: dict[str, Any] = dict(getattr(ticker_client, "fast_info", {}) or {})
                currency = fast_info.get("currency")
                if not currency:
                    info: dict[str, Any] = ticker_client.info or {}
                    currency = info.get("currency")
            except Exception:
                currency = None

        normalized_currency = str(currency or fallback_currency or "").strip().upper() or None
        snapshot = QuoteSnapshot(price=price, currency=normalized_currency)
        self.cache.set(cache_key, snapshot)
        return snapshot

    def get_asset_price_and_currency(self, ticker: str, fallback_currency: str | None = None) -> QuoteSnapshot:
        snapshot = self.get_quote_snapshot(ticker, fallback_currency=fallback_currency)
        price = snapshot.price
        currency = snapshot.currency or (fallback_currency.upper() if fallback_currency else None)

        if currency in {"GBP", "GBX", "GBPX", "GBPENCE", "GBp", "GBX"}:
            if price is not None and currency in {"GBX", "GBp"}:
                price = price / 100.0
            currency = "GBP"

        return QuoteSnapshot(price=price, currency=currency)

    def get_eur_cross_series(self, currency: str, period: str = "1y") -> tuple[pd.Series | None, list[str]]:
        normalized = currency.strip().upper()
        if normalized == "EUR":
            eurusd = self.get_close_series("EURUSD=X", period=period)
            if eurusd is None:
                return None, ["EURUSD=X"]
            constant = pd.Series(1.0, index=eurusd.index)
            return _clean_series(constant), []

        direct_ticker = EUR_DIRECT_TICKERS.get(normalized) or f"EUR{normalized}=X"
        if direct_ticker not in BANNED_TICKERS:
            direct_series = self.get_close_series(direct_ticker, period=period)
            if direct_series is not None:
                return direct_series, []

        if normalized in USD_CROSS_TICKERS:
            eurusd = self.get_close_series("EURUSD=X", period=period)
            usd_cross = self.get_close_series(USD_CROSS_TICKERS[normalized], period=period)
            if eurusd is None or usd_cross is None:
                missing = []
                if eurusd is None:
                    missing.append("EURUSD=X")
                if usd_cross is None:
                    missing.append(USD_CROSS_TICKERS[normalized])
                return None, missing
            aligned = pd.concat([eurusd, usd_cross], axis=1, join="inner").dropna()
            if aligned.empty:
                return None, [f"EUR/{normalized} synthetic"]
            synthetic = aligned.iloc[:, 0] * aligned.iloc[:, 1]
            synthetic.name = None
            return _clean_series(synthetic), []

        return None, [direct_ticker]

    def get_currency_to_eur_series(self, currency: str, period: str = "1y") -> tuple[pd.Series | None, list[str]]:
        normalized = currency.strip().upper()
        cross_series, missing = self.get_eur_cross_series(normalized, period=period)
        if cross_series is None:
            return None, missing
        if normalized == "EUR":
            return cross_series, []
        to_eur = 1.0 / cross_series
        to_eur.name = None
        return _clean_series(to_eur), []

    def get_current_currency_to_eur(self, currency: str) -> tuple[float | None, list[str]]:
        series, missing = self.get_currency_to_eur_series(currency, period="1mo")
        if series is None or series.empty:
            return None, missing
        return float(series.iloc[-1]), []

    def get_fx_pair_label(self, currency: str) -> str:
        normalized = currency.strip().upper()
        return "EUR" if normalized == "EUR" else f"EUR/{normalized}"
