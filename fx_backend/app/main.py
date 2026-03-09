from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .cache import TTLCache
from .config import get_settings
from .db import get_engine
from .portfolio_repository import PortfolioRepository
from .routers.fx import router as fx_router
from .yfinance_client import YFinanceClient


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Peakys FX API", version="1.0.0", debug=settings.debug)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=settings.allowed_origins != ("*",),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.response_cache = TTLCache(settings.cache_ttl_seconds)
    app.state.market_client = YFinanceClient(cache_ttl_seconds=settings.cache_ttl_seconds)
    app.state.portfolio_repository = PortfolioRepository(
        engine=get_engine(),
        table_prefix=settings.table_prefix,
        admin_portfolio_scoped_users=settings.admin_portfolio_scoped_users,
    )
    app.include_router(fx_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
