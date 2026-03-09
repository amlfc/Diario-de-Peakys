from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request

from ..fx_analytics import (
    build_carry,
    build_correlation_matrix,
    build_dxy_impact,
    build_exposure,
    build_hedge_ratio,
    build_overview,
    build_portfolio_snapshot,
    run_stress_test,
)
from ..models import StressTestRequest, UserScope


router = APIRouter(prefix="/api/fx", tags=["fx"])


def _get_scope(user_id: int | None, role: str, username: str, portfolio: str) -> UserScope:
    return UserScope(user_id=user_id, role=role, username=username or "", portfolio=portfolio or "ALL")


def _get_snapshot(request: Request, scope: UserScope):
    repo = request.app.state.portfolio_repository
    market_client = request.app.state.market_client
    transactions, visible_portfolios = repo.get_transactions(scope)
    liquidity = repo.get_liquidity(scope)
    return build_portfolio_snapshot(transactions, liquidity, visible_portfolios, market_client)


def _cache_request(request: Request, key: tuple[Any, ...], factory):
    cache = request.app.state.response_cache
    return cache.get_or_set(key, factory)


@router.get("/overview")
def get_overview(request: Request):
    return _cache_request(request, ("overview",), lambda: build_overview(request.app.state.market_client))


@router.get("/carry")
def get_carry(request: Request):
    return _cache_request(request, ("carry",), lambda: build_carry(request.app.state.market_client))


@router.get("/correlation_matrix")
def get_correlation_matrix(request: Request):
    return _cache_request(request, ("correlation_matrix",), lambda: build_correlation_matrix(request.app.state.market_client))


@router.get("/exposure")
def get_exposure(
    request: Request,
    user_id: int | None = Query(default=None),
    role: str = Query(default="user"),
    username: str = Query(default=""),
    portfolio: str = Query(default="ALL"),
):
    scope = _get_scope(user_id, role, username, portfolio)
    cache_key = ("exposure", scope.user_id, scope.role, scope.username, scope.portfolio)
    return _cache_request(request, cache_key, lambda: build_exposure(_get_snapshot(request, scope), request.app.state.market_client))


@router.get("/hedge_ratio")
def get_hedge_ratio(
    request: Request,
    user_id: int | None = Query(default=None),
    role: str = Query(default="user"),
    username: str = Query(default=""),
    portfolio: str = Query(default="ALL"),
    asset_ticker: str = Query(...),
    fx_pair: str = Query(...),
    window: int = Query(default=30, ge=10, le=90),
):
    scope = _get_scope(user_id, role, username, portfolio)
    cache_key = ("hedge_ratio", scope.user_id, scope.role, scope.username, scope.portfolio, asset_ticker.upper(), fx_pair.upper(), window)
    return _cache_request(
        request,
        cache_key,
        lambda: build_hedge_ratio(_get_snapshot(request, scope), request.app.state.market_client, asset_ticker, fx_pair, window),
    )


@router.get("/dxy_impact")
def get_dxy_impact(
    request: Request,
    user_id: int | None = Query(default=None),
    role: str = Query(default="user"),
    username: str = Query(default=""),
    portfolio: str = Query(default="ALL"),
):
    scope = _get_scope(user_id, role, username, portfolio)
    cache_key = ("dxy_impact", scope.user_id, scope.role, scope.username, scope.portfolio)
    return _cache_request(request, cache_key, lambda: build_dxy_impact(_get_snapshot(request, scope), request.app.state.market_client))


@router.post("/stress_test")
def post_stress_test(request: Request, payload: StressTestRequest):
    scope = _get_scope(payload.user_id, payload.role, payload.username, payload.portfolio)
    custom_key = tuple(sorted((payload.custom_shocks or {}).items()))
    cache_key = ("stress_test", scope.user_id, scope.role, scope.username, scope.portfolio, payload.scenario, custom_key)
    return _cache_request(
        request,
        cache_key,
        lambda: run_stress_test(_get_snapshot(request, scope), payload.scenario, payload.custom_shocks),
    )
