from __future__ import annotations

from app.fx_analytics import build_carry, build_dxy_impact, build_exposure, build_overview, run_stress_test


def test_exposure_builds_positive_usd_hedge_ratio(sample_snapshot, fake_market_client):
    exposure = build_exposure(sample_snapshot, fake_market_client)

    usd_row = next(row for row in exposure["currency_breakdown"] if row["currency"] == "USD")
    assert usd_row["hedge_ratio"] > 0.9
    assert usd_row["notional_to_hedge_eur"] > 0
    assert exposure["usd_traffic_light"]["state"] in {"green", "orange", "red"}


def test_carry_and_overview_keep_working_with_missing_pairs(fake_market_client):
    carry = build_carry(fake_market_client)
    overview = build_overview(fake_market_client)

    assert any(row["currency"] == "MXN" for row in carry["ranking"])
    assert "ETH-EUR" in overview["excluded_tickers"]
    assert any(alert["kind"] == "safe_haven" for alert in overview["alerts"])


def test_dxy_impact_and_stress_test_return_portfolio_pnl(sample_snapshot, fake_market_client):
    dxy = build_dxy_impact(sample_snapshot, fake_market_client)
    stress = run_stress_test(sample_snapshot, "usd_rally")

    assert dxy["percentile_1y"] is not None
    assert dxy["impact_example"]["usd_notional"] == 10_000.0
    assert stress["portfolio_totals"]["pnl_eur"] > 0
    assert any(item["currency"] == "USD" for item in stress["how_to_hedge"])
