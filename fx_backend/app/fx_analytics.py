from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from .models import CashBalance, LiquidityRecord, PortfolioSnapshot, PositionSnapshot, TransactionRecord
from .yfinance_client import FX_OVERVIEW_TICKERS, YFinanceClient


CENTRAL_BANK_RATES = {
    "EUR": 2.65,
    "USD": 4.25,
    "JPY": 0.50,
    "GBP": 4.50,
    "CHF": 0.25,
    "NOK": 4.50,
    "TRY": 42.50,
    "MXN": 9.00,
}

KNOWN_CURRENCIES = {
    "EUR",
    "USD",
    "GBP",
    "CHF",
    "CAD",
    "JPY",
    "AUD",
    "HKD",
    "NZD",
    "SEK",
    "NOK",
    "DKK",
    "PLN",
    "CZK",
    "HUF",
    "RON",
    "TRY",
    "MXN",
    "BRL",
    "ZAR",
    "SGD",
    "CNH",
    "CNY",
}

SCENARIO_SHOCKS = {
    "usd_rally": {"USD": 4.6},
    "eur_crash": {"USD": 3.0},
    "risk_off": {"JPY": 4.0, "CHF": 3.0, "MXN": -5.0, "TRY": -5.0},
    "carry_unwind": {"JPY": 5.0, "CHF": 5.0},
}

CORRELATION_TICKERS = {
    "EUR/USD": "EURUSD=X",
    "DXY": "DX-Y.NYB",
    "SPY": "SPY",
    "BTC": "BTC-EUR",
    "GC": "GC=F",
    "VIX": "^VIX",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _safe_std(series: pd.Series) -> float:
    value = float(series.std(ddof=0))
    return value if math.isfinite(value) else 0.0


def _percentile_rank(series: pd.Series) -> float | None:
    cleaned = series.dropna()
    if cleaned.empty:
        return None
    last = cleaned.iloc[-1]
    return float((cleaned <= last).mean() * 100.0)


def _ols_beta(dependent: pd.Series, independent: pd.Series) -> float:
    aligned = pd.concat([dependent, independent], axis=1, join="inner").dropna()
    if len(aligned) < 2:
        return 0.0
    x = aligned.iloc[:, 1]
    y = aligned.iloc[:, 0]
    variance = float(np.var(x))
    if not math.isfinite(variance) or variance == 0:
        return 0.0
    covariance = float(np.cov(x, y, ddof=0)[0, 1])
    beta = covariance / variance
    return beta if math.isfinite(beta) else 0.0


def _correlation(first: pd.Series, second: pd.Series) -> float:
    aligned = pd.concat([first, second], axis=1, join="inner").dropna()
    if len(aligned) < 2:
        return 0.0
    corr = float(aligned.iloc[:, 0].corr(aligned.iloc[:, 1]))
    return corr if math.isfinite(corr) else 0.0


def _returns(series: pd.Series) -> pd.Series:
    return series.pct_change().dropna()


def _make_alert(kind: str, severity: str, title: str, message: str, value: float | None = None, threshold: float | None = None) -> dict[str, Any]:
    alert = {"kind": kind, "severity": severity, "title": title, "message": message}
    if value is not None:
        alert["value"] = float(value)
    if threshold is not None:
        alert["threshold"] = float(threshold)
    return alert


def _is_buy(type_label: str) -> bool:
    lowered = (type_label or "").strip().lower()
    return lowered in {"compra", "buy", "b", "c"} or "compra" in lowered or "buy" in lowered


def _is_currency_exchange_transaction(transaction: TransactionRecord) -> bool:
    ticker = (transaction.ticker or "").upper().strip()
    asset_type = (transaction.asset_type or "").lower()
    asset_name = (transaction.asset_name or "").lower()
    notes = (transaction.notes or "").lower()
    pair_match = ticker.replace("/", "").replace(".", "").replace("_", "").replace("-", "")
    looks_like_pair = len(pair_match) == 6 and pair_match[:3] in KNOWN_CURRENCIES and pair_match[3:] in KNOWN_CURRENCIES and pair_match[:3] != pair_match[3:]
    looks_like_fx_label = any(token in field for field in (asset_type, asset_name, notes) for token in ("divisa", "forex", "fx", "cambio"))
    return looks_like_pair or looks_like_fx_label


def _normalize_currency(currency: str | None) -> str:
    normalized = (currency or "EUR").strip().upper()
    if normalized in {"GBX", "GBPENCE", "GBPX", "GBP"}:
        return "GBP"
    return normalized or "EUR"


def _fx_label_to_ticker(fx_pair: str) -> str:
    cleaned = fx_pair.strip().upper()
    if cleaned in {"DX-Y.NYB", "DXY"}:
        return "DX-Y.NYB"
    if cleaned.endswith("=X"):
        return cleaned
    compact = cleaned.replace("/", "").replace("-", "")
    return f"{compact}=X"


def build_portfolio_snapshot(
    transactions: list[TransactionRecord],
    liquidity_events: list[LiquidityRecord],
    visible_portfolios: list[str],
    market_client: YFinanceClient,
) -> PortfolioSnapshot:
    position_map: dict[str, PositionSnapshot] = {}
    base_cash_eur = sum(item.amount_eur for item in liquidity_events)
    cash_by_currency: dict[str, float] = {"EUR": base_cash_eur}

    for transaction in sorted(transactions, key=lambda item: item.date or ""):
        if transaction.exclude_from_metrics or _is_currency_exchange_transaction(transaction):
            continue

        quantity = abs(float(transaction.quantity or 0.0))
        if quantity <= 0:
            continue

        currency_platform = _normalize_currency(transaction.currency_platform)
        effective_fx_rate = 1.0 if currency_platform == "EUR" else float(transaction.fx_rate_to_eur or 1.0)
        key = f"{transaction.portfolio}-{transaction.ticker}"
        position = position_map.get(key)
        if position is None:
            position = PositionSnapshot(
                ticker=transaction.ticker,
                asset_name=transaction.asset_name or transaction.ticker,
                portfolio=transaction.portfolio,
                asset_type=transaction.asset_type or "Sin Clasificar",
                currency_platform=currency_platform,
                currency_origin=currency_platform,
                quantity=0.0,
                avg_price_platform=0.0,
                avg_fx_rate=0.0,
                avg_price_eur=0.0,
                total_cost_eur=0.0,
                total_cost_origin=0.0,
                current_price_origin=0.0,
                current_fx_rate_to_eur=1.0,
                current_value_eur=0.0,
                current_value_origin=0.0,
                unrealized_pnl_eur=0.0,
                unrealized_pnl_origin=0.0,
                unrealized_pnl_pct=0.0,
                realized_pnl_eur=0.0,
            )

        if _is_buy(transaction.type):
            total_cost_old_eur = position.quantity * position.avg_price_eur
            tx_cost_origin = (quantity * transaction.price) + transaction.commission
            tx_cost_eur = tx_cost_origin * effective_fx_rate
            new_quantity = position.quantity + quantity
            new_total_cost_origin = position.total_cost_origin + tx_cost_origin
            new_total_cost_eur = total_cost_old_eur + tx_cost_eur

            if new_quantity > 0:
                position.quantity = new_quantity
                position.avg_price_eur = new_total_cost_eur / new_quantity
                position.avg_price_platform = new_total_cost_origin / new_quantity
                position.total_cost_origin = new_total_cost_origin
                position.avg_fx_rate = new_total_cost_eur / new_total_cost_origin if new_total_cost_origin > 0 else effective_fx_rate

            if not transaction.non_cash:
                cash_by_currency[currency_platform] = cash_by_currency.get(currency_platform, 0.0) - tx_cost_origin
        else:
            if position.quantity <= 0:
                position_map[key] = position
                continue

            sell_quantity = min(quantity, position.quantity)
            if sell_quantity <= 0:
                position_map[key] = position
                continue

            sell_value_net_eur = ((sell_quantity * transaction.price) - transaction.commission) * effective_fx_rate
            cost_of_sold_eur = sell_quantity * position.avg_price_eur
            proportion = sell_quantity / position.quantity if position.quantity > 0 else 0.0
            position.total_cost_origin -= position.total_cost_origin * proportion
            position.realized_pnl_eur += sell_value_net_eur - cost_of_sold_eur
            position.quantity -= sell_quantity

            if not transaction.non_cash:
                sell_value_origin = (sell_quantity * transaction.price) - transaction.commission
                cash_by_currency[currency_platform] = cash_by_currency.get(currency_platform, 0.0) + sell_value_origin

        position_map[key] = position

    positions: list[PositionSnapshot] = []
    missing_quotes: set[str] = set()
    missing_fx: set[str] = set()
    total_value_eur = 0.0
    total_cost_eur = 0.0
    realized_pnl_eur = 0.0

    for position in position_map.values():
        realized_pnl_eur += position.realized_pnl_eur
        if position.quantity <= 0.0001:
            continue

        quote = market_client.get_asset_price_and_currency(position.ticker, fallback_currency=position.currency_origin)
        current_currency = _normalize_currency(quote.currency or position.currency_origin or position.currency_platform)
        current_price_origin = float(quote.price) if quote.price is not None else 0.0
        fx_rate_to_eur, missing = market_client.get_current_currency_to_eur(current_currency)
        if missing:
            missing_fx.update(missing)
        if quote.price is None:
            missing_quotes.add(position.ticker)

        fallback_fx = position.avg_fx_rate or (1.0 if current_currency == "EUR" else 0.0)
        safe_fx_rate = float(fx_rate_to_eur) if fx_rate_to_eur is not None else fallback_fx or 1.0
        price_to_use_eur = current_price_origin * safe_fx_rate if current_price_origin > 0 else position.avg_price_platform * (position.avg_fx_rate or safe_fx_rate)

        position.currency_origin = current_currency
        position.current_price_origin = current_price_origin
        position.current_fx_rate_to_eur = safe_fx_rate
        position.total_cost_eur = position.quantity * position.avg_price_eur
        position.current_value_eur = position.quantity * price_to_use_eur
        position.current_value_origin = position.current_value_eur / safe_fx_rate if safe_fx_rate else 0.0
        position.unrealized_pnl_eur = position.current_value_eur - position.total_cost_eur
        position.unrealized_pnl_origin = position.current_value_origin - position.total_cost_origin
        position.unrealized_pnl_pct = position.unrealized_pnl_eur / position.total_cost_eur if position.total_cost_eur else 0.0

        total_value_eur += position.current_value_eur
        total_cost_eur += position.total_cost_eur
        positions.append(position)

    cash_balances: list[CashBalance] = []
    total_cash_eur = 0.0
    for currency, amount_origin in cash_by_currency.items():
        if abs(amount_origin) < 0.0001:
            continue
        normalized_currency = _normalize_currency(currency)
        fx_rate_to_eur, missing = market_client.get_current_currency_to_eur(normalized_currency)
        if missing:
            missing_fx.update(missing)
        safe_fx_rate = float(fx_rate_to_eur) if fx_rate_to_eur is not None else (1.0 if normalized_currency == "EUR" else 0.0)
        amount_eur = amount_origin * safe_fx_rate
        total_cash_eur += amount_eur
        cash_balances.append(CashBalance(currency=normalized_currency, amount_origin=amount_origin, amount_eur=amount_eur))

    return PortfolioSnapshot(
        positions=sorted(positions, key=lambda item: item.current_value_eur, reverse=True),
        cash_balances=sorted(cash_balances, key=lambda item: abs(item.amount_eur), reverse=True),
        visible_portfolios=visible_portfolios,
        total_value_eur=total_value_eur,
        total_cash_eur=total_cash_eur,
        total_equity_eur=total_value_eur + total_cash_eur,
        total_cost_eur=total_cost_eur,
        realized_pnl_eur=realized_pnl_eur,
        excluded_tickers=sorted(missing_quotes | missing_fx),
        diagnostics={"missing_quotes": sorted(missing_quotes), "missing_fx": sorted(missing_fx)},
    )


def build_carry(market_client: YFinanceClient) -> dict[str, Any]:
    ranking: list[dict[str, Any]] = []
    excluded_tickers: set[str] = set()

    for currency, rate in CENTRAL_BANK_RATES.items():
        if currency == "EUR":
            continue
        eur_cross, missing = market_client.get_eur_cross_series(currency, period="3mo")
        if eur_cross is None:
            excluded_tickers.update(missing)
            continue

        returns = _returns(eur_cross).tail(30)
        volatility_30d = _safe_std(returns) * math.sqrt(252) * 100.0 if not returns.empty else 0.0
        momentum_1m = float((eur_cross.iloc[-1] / eur_cross.iloc[-21]) - 1.0) if len(eur_cross) > 21 else 0.0
        carry_value = rate - CENTRAL_BANK_RATES["EUR"]
        carry_to_risk = carry_value / volatility_30d if volatility_30d > 0 else 0.0

        signal = "NEUTRAL"
        if carry_to_risk > 0.5 and momentum_1m > 0:
            signal = "LONG EUR"
        elif carry_to_risk < -0.5 and momentum_1m < 0:
            signal = "SHORT EUR"

        ranking.append(
            {
                "currency": currency,
                "pair": f"EUR/{currency}",
                "ticker": f"EUR{currency}=X",
                "reference_rate_pct": rate,
                "eur_rate_pct": CENTRAL_BANK_RATES["EUR"],
                "carry_pct": carry_value,
                "volatility_30d_pct": volatility_30d,
                "momentum_1m_pct": momentum_1m * 100.0,
                "carry_to_risk": carry_to_risk,
                "last_price": float(eur_cross.iloc[-1]),
                "signal": signal,
            }
        )

    ranking.sort(key=lambda item: item["carry_to_risk"], reverse=True)
    alerts = [
        _make_alert(
            kind="carry_opportunity",
            severity="medium",
            title=f"Oportunidad carry {row['pair']}",
            message=f"carry-to-risk {row['carry_to_risk']:.2f} con señal {row['signal']}",
            value=row["carry_to_risk"],
            threshold=1.0,
        )
        for row in ranking
        if abs(row["carry_to_risk"]) > 1.0
    ]

    return {
        "generated_at": _now_iso(),
        "base_currency": "EUR",
        "reference_rates_pct": CENTRAL_BANK_RATES,
        "ranking": ranking,
        "alerts": alerts,
        "excluded_tickers": sorted(excluded_tickers),
    }


def build_overview(market_client: YFinanceClient) -> dict[str, Any]:
    tickers = [entry["ticker"] for entry in FX_OVERVIEW_TICKERS]
    series_map, missing = market_client.get_close_series_batch(tickers, period="1y")
    carry_map = {row["pair"]: row["signal"] for row in build_carry(market_client)["ranking"]}

    pairs: list[dict[str, Any]] = []
    alerts: list[dict[str, Any]] = []
    dxy_percentile = None

    for entry in FX_OVERVIEW_TICKERS:
        series = series_map.get(entry["ticker"])
        if series is None or len(series) < 2:
            continue

        last_price = float(series.iloc[-1])
        previous = float(series.iloc[-2])
        day_change_pct = ((last_price / previous) - 1.0) * 100.0 if previous else 0.0
        std = _safe_std(series)
        z_score = (last_price - float(series.mean())) / std if std else 0.0
        percentile = _percentile_rank(series)
        signal = carry_map.get(entry["pair"], "NEUTRAL")

        if entry["ticker"] == "DX-Y.NYB":
            dxy_percentile = percentile
            if percentile is not None and percentile < 30:
                signal = "USD DÉBIL"
            elif percentile is not None and percentile > 70:
                signal = "USD FUERTE"
            else:
                signal = "NEUTRAL"

        pairs.append(
            {
                **entry,
                "last_price": last_price,
                "day_change_pct": day_change_pct,
                "z_score_52w": z_score,
                "percentile_1y": percentile,
                "signal": signal,
            }
        )

        if entry["ticker"] == "EURUSD=X" and abs(day_change_pct) >= 0.8:
            alerts.append(_make_alert("eurusd_intraday", "high", "EUR/USD se mueve con fuerza", f"EUR/USD varía {day_change_pct:.2f}% en la sesión.", day_change_pct, 0.8))
        if entry["ticker"] == "EURCHF=X" and last_price < 0.92:
            alerts.append(_make_alert("safe_haven", "medium", "EUR/CHF activa señal risk-off", f"EUR/CHF cotiza en {last_price:.4f}, por debajo de 0.92.", last_price, 0.92))

    alerts.extend(build_carry(market_client)["alerts"])

    if dxy_percentile is not None and (dxy_percentile > 80 or dxy_percentile < 20):
        alerts.append(
            _make_alert(
                "dxy_extreme",
                "medium",
                "DXY en zona extrema",
                f"DXY está en percentil {dxy_percentile:.1f} del último año.",
                dxy_percentile,
                80.0 if dxy_percentile > 80 else 20.0,
            )
        )

    return {
        "generated_at": _now_iso(),
        "base_currency": "EUR",
        "pairs": pairs,
        "alerts": alerts,
        "excluded_tickers": sorted(set(missing)),
    }


def _build_currency_bucket_history(snapshot: PortfolioSnapshot, market_client: YFinanceClient, period: str = "3mo") -> tuple[dict[str, pd.Series], set[str]]:
    bucket_series: dict[str, pd.Series] = {}
    missing: set[str] = set()

    for position in snapshot.positions:
        quote = market_client.get_asset_price_and_currency(position.ticker, fallback_currency=position.currency_origin)
        currency = _normalize_currency(quote.currency or position.currency_origin)
        price_series = market_client.get_close_series(position.ticker, period=period)
        if price_series is None:
            missing.add(position.ticker)
            continue

        if currency == "GBP" and quote.currency in {"GBX", "GBp"}:
            price_series = price_series / 100.0

        if currency == "EUR":
            value_series = price_series * position.quantity
        else:
            eur_cross, missing_pairs = market_client.get_eur_cross_series(currency, period=period)
            if eur_cross is None:
                missing.update(missing_pairs)
                continue
            aligned = pd.concat([price_series, eur_cross], axis=1, join="inner").dropna()
            if aligned.empty:
                continue
            value_series = (aligned.iloc[:, 0] / aligned.iloc[:, 1]) * position.quantity

        current_bucket = bucket_series.get(currency)
        bucket_series[currency] = value_series if current_bucket is None else current_bucket.add(value_series, fill_value=0.0)

    for cash in snapshot.cash_balances:
        if cash.currency == "EUR":
            continue
        eur_cross, missing_pairs = market_client.get_eur_cross_series(cash.currency, period=period)
        if eur_cross is None:
            missing.update(missing_pairs)
            continue
        cash_series = cash.amount_origin / eur_cross
        current_bucket = bucket_series.get(cash.currency)
        bucket_series[cash.currency] = cash_series if current_bucket is None else current_bucket.add(cash_series, fill_value=0.0)

    return bucket_series, missing


def build_exposure(snapshot: PortfolioSnapshot, market_client: YFinanceClient) -> dict[str, Any]:
    exposure_by_currency: dict[str, dict[str, float]] = {}
    for position in snapshot.positions:
        bucket = exposure_by_currency.setdefault(position.currency_origin, {"positions_eur": 0.0, "cash_eur": 0.0})
        bucket["positions_eur"] += position.current_value_eur

    for cash in snapshot.cash_balances:
        bucket = exposure_by_currency.setdefault(cash.currency, {"positions_eur": 0.0, "cash_eur": 0.0})
        bucket["cash_eur"] += cash.amount_eur

    bucket_history, missing = _build_currency_bucket_history(snapshot, market_client, period="3mo")
    total_equity = snapshot.total_equity_eur or 0.0
    rows: list[dict[str, Any]] = []

    for currency, values in exposure_by_currency.items():
        exposure_eur = values["positions_eur"] + values["cash_eur"]
        share_pct = (exposure_eur / total_equity) * 100.0 if total_equity else 0.0
        hedge_ratio = 0.0
        beta = 0.0
        correlation = 0.0
        observations = 0

        if currency != "EUR":
            value_history = bucket_history.get(currency)
            eur_cross, missing_pairs = market_client.get_eur_cross_series(currency, period="3mo")
            missing.update(missing_pairs)
            if value_history is not None and eur_cross is not None:
                bucket_returns = _returns(value_history)
                fx_returns = _returns(eur_cross)
                aligned = pd.concat([bucket_returns, fx_returns], axis=1, join="inner").dropna().tail(30)
                observations = len(aligned)
                if observations >= 5:
                    beta = _ols_beta(aligned.iloc[:, 0], aligned.iloc[:, 1])
                    correlation = _correlation(aligned.iloc[:, 0], aligned.iloc[:, 1])
                    hedge_ratio = -beta

        notional_to_hedge = max(exposure_eur * max(hedge_ratio, 0.0), 0.0)
        covered_share = min(notional_to_hedge / exposure_eur, 1.0) if exposure_eur > 0 else 0.0
        rows.append(
            {
                "currency": currency,
                "fx_pair": market_client.get_fx_pair_label(currency),
                "positions_eur": values["positions_eur"],
                "cash_eur": values["cash_eur"],
                "exposure_eur": exposure_eur,
                "share_pct": share_pct,
                "hedge_ratio": hedge_ratio,
                "beta": beta,
                "correlation": correlation,
                "observations": observations,
                "notional_to_hedge_eur": notional_to_hedge,
                "covered_share_pct": covered_share * 100.0,
            }
        )

    rows.sort(key=lambda item: item["exposure_eur"], reverse=True)
    usd_row = next((row for row in rows if row["currency"] == "USD"), None)
    usd_uncovered_share = 1.0
    if usd_row and usd_row["exposure_eur"] > 0:
        usd_uncovered_share = max(1.0 - (usd_row["covered_share_pct"] / 100.0), 0.0)
    usd_traffic = "green" if usd_uncovered_share < 0.4 else "orange" if usd_uncovered_share <= 0.7 else "red"

    return {
        "generated_at": _now_iso(),
        "base_currency": "EUR",
        "visible_portfolios": snapshot.visible_portfolios,
        "total_equity_eur": total_equity,
        "currency_breakdown": rows,
        "donut": [{"name": row["currency"], "value": row["exposure_eur"], "share_pct": row["share_pct"]} for row in rows],
        "usd_traffic_light": {"state": usd_traffic, "uncovered_share_pct": usd_uncovered_share * 100.0},
        "excluded_tickers": sorted(set(snapshot.excluded_tickers) | set(missing)),
    }


def build_hedge_ratio(snapshot: PortfolioSnapshot, market_client: YFinanceClient, asset_ticker: str, fx_pair: str, window: int = 30) -> dict[str, Any]:
    positions = [position for position in snapshot.positions if position.ticker.upper() == asset_ticker.upper()]
    current_value_eur = sum(position.current_value_eur for position in positions)
    fallback_currency = positions[0].currency_origin if positions else "USD"

    quote = market_client.get_asset_price_and_currency(asset_ticker, fallback_currency=fallback_currency)
    currency = _normalize_currency(quote.currency or fallback_currency)
    price_history = market_client.get_close_series(asset_ticker, period="3mo")
    if price_history is None:
        return {
            "generated_at": _now_iso(),
            "asset_ticker": asset_ticker,
            "fx_pair": fx_pair,
            "window": window,
            "beta": 0.0,
            "correlation": 0.0,
            "hedge_ratio": 0.0,
            "current_value_eur": current_value_eur,
            "notional_to_hedge_eur": 0.0,
            "observations": 0,
            "excluded_tickers": [asset_ticker],
        }

    if currency == "EUR":
        asset_eur = price_history
    else:
        fx_to_eur, missing = market_client.get_currency_to_eur_series(currency, period="3mo")
        if fx_to_eur is None:
            return {
                "generated_at": _now_iso(),
                "asset_ticker": asset_ticker,
                "fx_pair": fx_pair,
                "window": window,
                "beta": 0.0,
                "correlation": 0.0,
                "hedge_ratio": 0.0,
                "current_value_eur": current_value_eur,
                "notional_to_hedge_eur": 0.0,
                "observations": 0,
                "excluded_tickers": missing,
            }
        aligned = pd.concat([price_history, fx_to_eur], axis=1, join="inner").dropna()
        asset_eur = aligned.iloc[:, 0] * aligned.iloc[:, 1]

    fx_ticker = _fx_label_to_ticker(fx_pair)
    fx_history = market_client.get_close_series(fx_ticker, period="3mo")
    if fx_history is None:
        return {
            "generated_at": _now_iso(),
            "asset_ticker": asset_ticker,
            "fx_pair": fx_pair,
            "window": window,
            "beta": 0.0,
            "correlation": 0.0,
            "hedge_ratio": 0.0,
            "current_value_eur": current_value_eur,
            "notional_to_hedge_eur": 0.0,
            "observations": 0,
            "excluded_tickers": [fx_ticker],
        }

    asset_returns = _returns(asset_eur)
    fx_returns = _returns(fx_history)
    aligned = pd.concat([asset_returns, fx_returns], axis=1, join="inner").dropna().tail(window)
    observations = len(aligned)
    beta = _ols_beta(aligned.iloc[:, 0], aligned.iloc[:, 1]) if observations >= 5 else 0.0
    correlation = _correlation(aligned.iloc[:, 0], aligned.iloc[:, 1]) if observations >= 5 else 0.0
    hedge_ratio = -beta

    return {
        "generated_at": _now_iso(),
        "asset_ticker": asset_ticker,
        "fx_pair": fx_pair,
        "window": window,
        "beta": beta,
        "correlation": correlation,
        "hedge_ratio": hedge_ratio,
        "current_value_eur": current_value_eur,
        "notional_to_hedge_eur": max(current_value_eur * max(hedge_ratio, 0.0), 0.0),
        "observations": observations,
        "excluded_tickers": [],
    }


def build_correlation_matrix(market_client: YFinanceClient) -> dict[str, Any]:
    tickers = list(CORRELATION_TICKERS.values())
    series_map, missing = market_client.get_close_series_batch(tickers, period="3mo")
    returns_map: dict[str, pd.Series] = {}
    labels: list[str] = []

    for label, ticker in CORRELATION_TICKERS.items():
        series = series_map.get(ticker)
        if series is None:
            continue
        returns_map[label] = _returns(series).tail(30)
        labels.append(label)

    frame = pd.DataFrame(returns_map).dropna()
    matrix = frame.corr().round(4) if not frame.empty else pd.DataFrame(index=labels, columns=labels)

    return {
        "generated_at": _now_iso(),
        "labels": labels,
        "matrix": [
            [float(matrix.loc[row, column]) if pd.notna(matrix.loc[row, column]) else None for column in labels]
            for row in labels
        ] if labels else [],
        "excluded_tickers": sorted(set(missing)),
    }


def build_dxy_impact(snapshot: PortfolioSnapshot, market_client: YFinanceClient) -> dict[str, Any]:
    dxy = market_client.get_close_series("DX-Y.NYB", period="1y")
    eurusd = market_client.get_close_series("EURUSD=X", period="1y")
    excluded: set[str] = set(snapshot.excluded_tickers)
    if dxy is None:
        excluded.add("DX-Y.NYB")
    if eurusd is None:
        excluded.add("EURUSD=X")

    percentile = _percentile_rank(dxy) if dxy is not None else None
    zone = "neutral"
    if percentile is not None:
        if percentile < 30:
            zone = "weak"
        elif percentile > 70:
            zone = "strong"

    correlation = 0.0
    beta = 0.0
    chart: list[dict[str, Any]] = []
    current_eurusd = float(eurusd.iloc[-1]) if eurusd is not None and not eurusd.empty else 0.0
    if dxy is not None and eurusd is not None:
        aligned = pd.concat([_returns(dxy).tail(30), _returns(eurusd).tail(30)], axis=1, join="inner").dropna()
        if len(aligned) >= 5:
            correlation = _correlation(aligned.iloc[:, 0], aligned.iloc[:, 1])
            beta = _ols_beta(aligned.iloc[:, 1], aligned.iloc[:, 0])
        std = _safe_std(eurusd)
        z_series = (eurusd - eurusd.mean()) / std if std else eurusd * 0
        chart = [{"date": idx.strftime("%Y-%m-%d"), "eurusd": float(price), "z_score": float(z_series.loc[idx])} for idx, price in eurusd.dropna().items()]

    usd_exposure_eur = sum(position.current_value_eur for position in snapshot.positions if position.currency_origin == "USD")
    usd_exposure_eur += sum(cash.amount_eur for cash in snapshot.cash_balances if cash.currency == "USD")

    example_usd_notional = 10_000.0
    predicted_eurusd_change = beta * 0.01
    example_current_eur = example_usd_notional / current_eurusd if current_eurusd else 0.0
    example_shocked_rate = current_eurusd * (1.0 + predicted_eurusd_change) if current_eurusd else 0.0
    example_shocked_eur = example_usd_notional / example_shocked_rate if example_shocked_rate else 0.0
    example_impact_eur = example_shocked_eur - example_current_eur
    portfolio_impact_eur = usd_exposure_eur * (-predicted_eurusd_change)

    alerts: list[dict[str, Any]] = []
    if percentile is not None and percentile > 80:
        alerts.append(_make_alert("dxy_extreme", "medium", "DXY muy fuerte", f"DXY está en percentil {percentile:.1f}.", percentile, 80.0))
    if percentile is not None and percentile < 20:
        alerts.append(_make_alert("dxy_extreme", "medium", "DXY muy débil", f"DXY está en percentil {percentile:.1f}.", percentile, 20.0))

    std = _safe_std(eurusd) if eurusd is not None else 0.0
    eurusd_zscore = float((eurusd.iloc[-1] - eurusd.mean()) / std) if eurusd is not None and std else 0.0

    return {
        "generated_at": _now_iso(),
        "percentile_1y": percentile,
        "zone": zone,
        "dxy_last": float(dxy.iloc[-1]) if dxy is not None and not dxy.empty else None,
        "eurusd_last": current_eurusd or None,
        "eurusd_zscore_52w": eurusd_zscore,
        "correlation_30d": correlation,
        "beta_30d": beta,
        "usd_exposure_eur": usd_exposure_eur,
        "estimated_portfolio_impact_eur": portfolio_impact_eur,
        "impact_example": {
            "dxy_shock_pct": 1.0,
            "predicted_eurusd_change_pct": predicted_eurusd_change * 100.0,
            "usd_notional": example_usd_notional,
            "current_value_eur": example_current_eur,
            "shocked_value_eur": example_shocked_eur,
            "impact_eur": example_impact_eur,
        },
        "chart": chart,
        "alerts": alerts,
        "excluded_tickers": sorted(excluded),
    }


def run_stress_test(snapshot: PortfolioSnapshot, scenario: str, custom_shocks: dict[str, float] | None = None) -> dict[str, Any]:
    scenario_key = scenario.strip().lower()
    shocks = {currency.upper(): float(value) for currency, value in (custom_shocks or {}).items()} if scenario_key == "custom" else SCENARIO_SHOCKS.get(scenario_key, {})

    positions_result: list[dict[str, Any]] = []
    cash_result: list[dict[str, Any]] = []
    by_currency: dict[str, dict[str, float]] = {}
    total_current_eur = 0.0
    total_shocked_eur = 0.0

    for position in snapshot.positions:
        shock_pct = shocks.get(position.currency_origin, 0.0)
        shocked_value = position.current_value_eur * (1.0 + (shock_pct / 100.0))
        pnl_eur = shocked_value - position.current_value_eur
        total_current_eur += position.current_value_eur
        total_shocked_eur += shocked_value
        bucket = by_currency.setdefault(position.currency_origin, {"current_eur": 0.0, "shocked_eur": 0.0, "pnl_eur": 0.0})
        bucket["current_eur"] += position.current_value_eur
        bucket["shocked_eur"] += shocked_value
        bucket["pnl_eur"] += pnl_eur
        positions_result.append(
            {
                "kind": "position",
                "ticker": position.ticker,
                "asset_name": position.asset_name,
                "currency": position.currency_origin,
                "portfolio": position.portfolio,
                "value_eur_current": position.current_value_eur,
                "value_eur_shocked": shocked_value,
                "pnl_eur": pnl_eur,
                "pnl_pct": (pnl_eur / position.current_value_eur * 100.0) if position.current_value_eur else 0.0,
                "shock_pct": shock_pct,
            }
        )

    for cash in snapshot.cash_balances:
        shock_pct = shocks.get(cash.currency, 0.0)
        shocked_value = cash.amount_eur * (1.0 + (shock_pct / 100.0))
        pnl_eur = shocked_value - cash.amount_eur
        total_current_eur += cash.amount_eur
        total_shocked_eur += shocked_value
        bucket = by_currency.setdefault(cash.currency, {"current_eur": 0.0, "shocked_eur": 0.0, "pnl_eur": 0.0})
        bucket["current_eur"] += cash.amount_eur
        bucket["shocked_eur"] += shocked_value
        bucket["pnl_eur"] += pnl_eur
        cash_result.append(
            {
                "kind": "cash",
                "currency": cash.currency,
                "amount_origin": cash.amount_origin,
                "value_eur_current": cash.amount_eur,
                "value_eur_shocked": shocked_value,
                "pnl_eur": pnl_eur,
                "pnl_pct": (pnl_eur / cash.amount_eur * 100.0) if cash.amount_eur else 0.0,
                "shock_pct": shock_pct,
            }
        )

    currency_impact = [
        {
            "currency": currency,
            "shock_pct": shocks.get(currency, 0.0),
            "current_eur": values["current_eur"],
            "shocked_eur": values["shocked_eur"],
            "pnl_eur": values["pnl_eur"],
            "pnl_pct": (values["pnl_eur"] / values["current_eur"] * 100.0) if values["current_eur"] else 0.0,
        }
        for currency, values in by_currency.items()
    ]
    currency_impact.sort(key=lambda item: abs(item["pnl_eur"]), reverse=True)

    how_to_hedge = [
        {
            "currency": item["currency"],
            "fx_pair": "EUR" if item["currency"] == "EUR" else f"EUR/{item['currency']}",
            "exposure_eur": item["current_eur"],
            "suggested_hedge_notional_eur": abs(item["current_eur"]),
            "scenario_shock_pct": item["shock_pct"],
        }
        for item in currency_impact
        if item["currency"] != "EUR" and abs(item["current_eur"]) > 0
    ]

    return {
        "generated_at": _now_iso(),
        "scenario": scenario_key,
        "shocks": shocks,
        "positions": positions_result,
        "cash": cash_result,
        "currency_impact": currency_impact,
        "portfolio_totals": {
            "current_value_eur": total_current_eur,
            "shocked_value_eur": total_shocked_eur,
            "pnl_eur": total_shocked_eur - total_current_eur,
            "pnl_pct": ((total_shocked_eur - total_current_eur) / total_current_eur * 100.0) if total_current_eur else 0.0,
        },
        "how_to_hedge": how_to_hedge,
        "excluded_tickers": snapshot.excluded_tickers,
    }
