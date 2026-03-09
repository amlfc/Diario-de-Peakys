from __future__ import annotations

from sqlalchemy import text

from app.db import create_db_engine
from app.models import UserScope
from app.portfolio_repository import PortfolioRepository


def test_repository_scopes_portfolios_by_owner_and_admin_rules():
    engine = create_db_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE pky_portfolios (id INTEGER PRIMARY KEY, name TEXT, owner_id INTEGER, user_id INTEGER)"))
        connection.execute(text("CREATE TABLE pky_transactions (id INTEGER PRIMARY KEY, date TEXT, portfolio TEXT, type TEXT, ticker TEXT, assetName TEXT, assetType TEXT, quantity REAL, price REAL, commission REAL, currencyPlatform TEXT, fxRateToEur REAL, excludeFromMetrics INTEGER, nonCash INTEGER, notes TEXT)"))
        connection.execute(text("CREATE TABLE pky_liquidity (id INTEGER PRIMARY KEY, date TEXT, portfolio TEXT, amountEur REAL, type TEXT, notes TEXT)"))
        connection.execute(text("INSERT INTO pky_portfolios (id, name, owner_id, user_id) VALUES (1, 'Alpha', 1, 1), (2, 'Beta', 2, 2), (3, 'Gamma', NULL, 2)"))
        connection.execute(text("INSERT INTO pky_transactions (id, date, portfolio, type, ticker, assetName, assetType, quantity, price, commission, currencyPlatform, fxRateToEur, excludeFromMetrics, nonCash, notes) VALUES (1, '2025-01-01', 'Beta', 'Compra', 'SPY', 'SPY', 'ETF', 1, 100, 0, 'USD', 0.9, 0, 0, '')"))
        connection.execute(text("INSERT INTO pky_liquidity (id, date, portfolio, amountEur, type, notes) VALUES (1, '2025-01-01', 'Gamma', 1000, 'Ingreso', '')"))

    repo = PortfolioRepository(engine=engine, table_prefix="pky_", admin_portfolio_scoped_users=frozenset({"sevi"}))

    user_scope = UserScope(user_id=2, role="user", username="marta", portfolio="ALL")
    admin_scope = UserScope(user_id=2, role="admin", username="sevi", portfolio="ALL")
    super_admin_scope = UserScope(user_id=1, role="admin", username="root", portfolio="ALL")

    assert repo.get_visible_portfolios(user_scope) == ["Beta", "Gamma"]
    assert repo.get_visible_portfolios(admin_scope) == ["Beta", "Gamma"]
    assert repo.get_visible_portfolios(super_admin_scope) == ["Alpha", "Beta", "Gamma"]

    transactions, visible = repo.get_transactions(user_scope)
    liquidity = repo.get_liquidity(user_scope)

    assert visible == ["Beta", "Gamma"]
    assert len(transactions) == 1
    assert len(liquidity) == 1
