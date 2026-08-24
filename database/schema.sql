-- Reference schema for the portfolio_analyzer database.
-- The backend creates/updates this automatically via SQLAlchemy
-- (Base.metadata.create_all in backend/database.py, plus light in-place
-- migrations in backend/database.py's run_light_migrations() for columns
-- added to already-deployed tables); this file is kept as a manual-setup
-- reference and for documentation purposes only — it is NOT run by the
-- application and must be kept in sync by hand with backend/models/*.py.

IF DB_ID('portfolio_analyzer') IS NULL
    CREATE DATABASE portfolio_analyzer;
GO

USE portfolio_analyzer;
GO

IF OBJECT_ID('dbo.users', 'U') IS NULL
CREATE TABLE dbo.users (
    id                    INT IDENTITY(1,1) PRIMARY KEY,
    email                 VARCHAR(255) NOT NULL UNIQUE,
    hashed_password       VARCHAR(255) NOT NULL,
    created_at            DATETIME DEFAULT GETDATE(),
    -- Opt-out: whether a triggered price/RSI alert also gets emailed (see
    -- services/email_service.py — sending itself stays a no-op unless SMTP_* is set).
    email_alerts_enabled  BIT NOT NULL DEFAULT 1,
    -- TOTP-based 2FA (see backend/services/auth_service.py). totp_secret is written
    -- at setup time but totp_enabled stays 0 until a code is actually confirmed.
    totp_secret           VARCHAR(64) NULL,
    totp_enabled          BIT NOT NULL DEFAULT 0,
    -- Currency cross-portfolio holdings totals are aggregated into (Home.tsx net
    -- worth, dividends, ...) — see portfolio_service.AGGREGATE_CURRENCY.
    base_currency         VARCHAR(6) NOT NULL DEFAULT 'TRY'
);
GO

IF OBJECT_ID('dbo.assets', 'U') IS NULL
CREATE TABLE dbo.assets (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    ticker          VARCHAR(20) NOT NULL UNIQUE,
    name            NVARCHAR(150) NOT NULL,
    -- Symbol actually passed to yfinance; may differ from ticker (e.g. THYAO / THYAO.IS).
    yahoo_symbol    VARCHAR(20) NOT NULL,
    exchange        VARCHAR(40) NULL,
    currency        VARCHAR(6) NOT NULL DEFAULT 'USD',
    -- Seeded BIST tickers are visible to every visitor; non-default assets were
    -- tracked by a specific user via the search bar and are scoped via watchlist_items.
    is_default      BIT NOT NULL DEFAULT 0,
    -- Real yfinance sector (e.g. "Technology"); NULL shown as "Bilinmiyor", never fabricated.
    sector          VARCHAR(60) NULL,
    created_at      DATETIME DEFAULT GETDATE()
);
GO

IF OBJECT_ID('dbo.price_history', 'U') IS NULL
CREATE TABLE dbo.price_history (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    asset_id        INT NOT NULL REFERENCES dbo.assets(id),
    date            DATE NOT NULL,
    open_price      FLOAT NOT NULL,
    high_price      FLOAT NOT NULL,
    low_price       FLOAT NOT NULL,
    close_price     FLOAT NOT NULL,
    volume          FLOAT NOT NULL DEFAULT 0,
    CONSTRAINT UQ_price_history_asset_date UNIQUE (asset_id, date)
);
GO

CREATE INDEX IX_price_history_asset_id ON dbo.price_history(asset_id);
GO

IF OBJECT_ID('dbo.portfolios', 'U') IS NULL
CREATE TABLE dbo.portfolios (
    id                INT IDENTITY(1,1) PRIMARY KEY,
    user_id           INT NOT NULL REFERENCES dbo.users(id),
    name              NVARCHAR(100) NOT NULL,
    created_at        DATETIME DEFAULT GETDATE(),
    -- Custom comparison index for this portfolio's analysis chart; NULL falls back
    -- to BIST 100 (see backend/routers/portfolios.py).
    benchmark_symbol  VARCHAR(20) NULL,
    benchmark_label   NVARCHAR(100) NULL,
    -- Enables GET /public/portfolios/{token}/analysis with no auth; NULL = not shared.
    share_token       VARCHAR(64) NULL
);
GO

CREATE INDEX IX_portfolios_user_id ON dbo.portfolios(user_id);
-- Filtered (not plain) unique index: MSSQL's plain unique index treats multiple
-- NULLs as duplicates, which every not-yet-shared portfolio would violate.
CREATE UNIQUE INDEX IX_portfolios_share_token ON dbo.portfolios(share_token) WHERE share_token IS NOT NULL;
GO

IF OBJECT_ID('dbo.portfolio_assets', 'U') IS NULL
CREATE TABLE dbo.portfolio_assets (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    portfolio_id    INT NOT NULL REFERENCES dbo.portfolios(id),
    asset_id        INT NOT NULL REFERENCES dbo.assets(id),
    weight          FLOAT NOT NULL,
    CONSTRAINT UQ_portfolio_assets_portfolio_asset UNIQUE (portfolio_id, asset_id)
);
GO

CREATE INDEX IX_portfolio_assets_portfolio_id ON dbo.portfolio_assets(portfolio_id);
CREATE INDEX IX_portfolio_assets_asset_id ON dbo.portfolio_assets(asset_id);
GO

IF OBJECT_ID('dbo.holdings', 'U') IS NULL
CREATE TABLE dbo.holdings (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES dbo.users(id),
    -- Nullable: a holding can exist without belonging to a specific named portfolio.
    portfolio_id    INT NULL REFERENCES dbo.portfolios(id),
    ticker          VARCHAR(10) NOT NULL,
    quantity        FLOAT NOT NULL,
    purchase_price  FLOAT NOT NULL,
    purchase_date   DATETIME NOT NULL,
    created_at      DATETIME DEFAULT GETDATE()
);
GO

CREATE INDEX IX_holdings_ticker ON dbo.holdings(ticker);
CREATE INDEX IX_holdings_user_id ON dbo.holdings(user_id);
CREATE INDEX IX_holdings_portfolio_id ON dbo.holdings(portfolio_id);
GO

IF OBJECT_ID('dbo.watchlist_items', 'U') IS NULL
CREATE TABLE dbo.watchlist_items (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES dbo.users(id),
    asset_id        INT NOT NULL REFERENCES dbo.assets(id),
    created_at      DATETIME DEFAULT GETDATE(),
    CONSTRAINT UQ_watchlist_user_asset UNIQUE (user_id, asset_id)
);
GO

CREATE INDEX IX_watchlist_items_user_id ON dbo.watchlist_items(user_id);
CREATE INDEX IX_watchlist_items_asset_id ON dbo.watchlist_items(asset_id);
GO

IF OBJECT_ID('dbo.price_alerts', 'U') IS NULL
CREATE TABLE dbo.price_alerts (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES dbo.users(id),
    asset_id        INT NOT NULL REFERENCES dbo.assets(id),
    -- 'price_above' | 'price_below' | 'rsi_above' | 'rsi_below'
    condition       VARCHAR(20) NOT NULL,
    threshold       FLOAT NOT NULL,
    is_active       BIT NOT NULL DEFAULT 1,
    is_triggered    BIT NOT NULL DEFAULT 0,
    is_read         BIT NOT NULL DEFAULT 0,
    created_at      DATETIME DEFAULT GETDATE(),
    triggered_at    DATETIME NULL
);
GO

CREATE INDEX IX_price_alerts_user_id ON dbo.price_alerts(user_id);
CREATE INDEX IX_price_alerts_asset_id ON dbo.price_alerts(asset_id);
GO

IF OBJECT_ID('dbo.holding_sales', 'U') IS NULL
CREATE TABLE dbo.holding_sales (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES dbo.users(id),
    portfolio_id    INT NULL REFERENCES dbo.portfolios(id),
    ticker          VARCHAR(10) NOT NULL,
    quantity        FLOAT NOT NULL,
    sale_price      FLOAT NOT NULL,
    sale_date       DATETIME NOT NULL,
    -- Computed once at sale time from the FIFO-matched lots, stored (not
    -- recomputed later) so realized P&L stays fixed even if source holdings change.
    cost_basis      FLOAT NOT NULL,
    realized_pl     FLOAT NOT NULL,
    created_at      DATETIME DEFAULT GETDATE()
);
GO

CREATE INDEX IX_holding_sales_user_id ON dbo.holding_sales(user_id);
CREATE INDEX IX_holding_sales_portfolio_id ON dbo.holding_sales(portfolio_id);
CREATE INDEX IX_holding_sales_ticker ON dbo.holding_sales(ticker);
GO

-- One row per issued JWT (login/register/2FA-verify) — see
-- backend/services/auth_service.issue_token_for_user(). The token's jti claim maps
-- back to this row; get_current_user 401s if it's missing or revoked_at is set,
-- regardless of whether the JWT itself is still technically unexpired.
IF OBJECT_ID('dbo.user_sessions', 'U') IS NULL
CREATE TABLE dbo.user_sessions (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES dbo.users(id),
    jti             VARCHAR(36) NOT NULL UNIQUE,
    user_agent      VARCHAR(255) NULL,
    ip_address      VARCHAR(64) NULL,
    created_at      DATETIME DEFAULT GETDATE(),
    last_seen_at    DATETIME DEFAULT GETDATE(),
    revoked_at      DATETIME NULL
);
GO

CREATE INDEX IX_user_sessions_user_id ON dbo.user_sessions(user_id);
GO

-- Append-only record of security/data-relevant actions (portfolio/holding CRUD,
-- password/email change, 2FA enable/disable, session revocation) — see
-- backend/services/audit_service.py. Never updated or deleted.
IF OBJECT_ID('dbo.audit_logs', 'U') IS NULL
CREATE TABLE dbo.audit_logs (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES dbo.users(id),
    action          VARCHAR(60) NOT NULL,
    detail          VARCHAR(255) NULL,
    created_at      DATETIME DEFAULT GETDATE()
);
GO

CREATE INDEX IX_audit_logs_user_id ON dbo.audit_logs(user_id);
GO
