from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    mssql_server: str = "localhost\\SQLEXPRESS"
    mssql_database: str = "portfolio_analyzer"
    mssql_driver: str = "ODBC Driver 17 for SQL Server"
    mssql_trusted_connection: str = "yes"
    mssql_username: str = ""
    mssql_password: str = ""

    # Optional full SQLAlchemy URL override (e.g. a managed Postgres instance on a host
    # like Render, which can't reach a local SQL Server at all). Local dev leaves this
    # unset and keeps using the MSSQL_* fields above via sqlalchemy_database_url below;
    # a deployment sets DATABASE_URL instead of the individual MSSQL_* fields. Both
    # database.py's create_all()/run_light_migrations() already dialect-branch on
    # engine.dialect.name (mssql vs. everything else), so a Postgres target needs no
    # further code changes to provision its schema on first boot.
    database_url: str = ""

    jwt_secret_key: str = "dev-only-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24

    # Comma-separated list of allowed frontend origins for CORS. Defaults to the
    # local Vite dev server; set this in backend/.env for any other deployment
    # (e.g. a production frontend origin) rather than editing main.py.
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    # Empty by default — Sentry's own SDK treats an empty/missing DSN as "disabled", so
    # this app runs identically with or without one configured. Get a free DSN at
    # https://sentry.io (new project → Python/FastAPI) and set it in backend/.env.
    sentry_dsn: str = ""
    sentry_environment: str = "development"

    # Empty by default — see services/redis_client.py. This app runs correctly as a
    # single process with no Redis at all (every WebSocket broadcast just stays
    # local-only, which is exactly what a single process needs); Redis only becomes
    # necessary once this is ever run behind more than one worker process, so it's
    # a strict opt-in, not a hard dependency. Example: redis://localhost:6379/0
    redis_url: str = ""

    # Empty by default — see services/email_service.py. Like Sentry/Redis above, this
    # is a strict opt-in: with smtp_host unset, send_email() is a documented no-op, so
    # triggered alerts stay in-app/WebSocket-only exactly as before this feature
    # existed. Any real SMTP provider works (Gmail app password, SendGrid, Mailgun,
    # AWS SES's SMTP interface, ...) — set all of these in backend/.env to enable it.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    smtp_from_address: str = "alerts@portfolio-analyzer.local"

    # Empty by default — see services/push_service.py. Same strict-opt-in pattern as
    # SMTP above: with vapid_public_key/vapid_private_key unset, push notifications
    # are a documented no-op and triggered alerts stay in-app/email-only exactly as
    # before this feature existed. Generate a keypair with
    # `python -m scripts.generate_vapid_keys` (from backend/) and copy its output into
    # backend/.env (both keys) and frontend/.env.local (the public key only).
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:alerts@portfolio-analyzer.local"

    # The one account allowed to view /auth/admin/users (registered-user count/list).
    # There's no general role/permission system in this app — a single hardcoded owner
    # email is the simplest thing that's actually secure for a solo-maintained project;
    # every other endpoint stays scoped to the caller's own data exactly as before.
    admin_email: str = "emreozmenn2@gmail.com"

    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        driver = self.mssql_driver.replace(" ", "+")
        if self.mssql_trusted_connection.lower() == "yes":
            return (
                f"mssql+pyodbc://@{self.mssql_server}/{self.mssql_database}"
                f"?driver={driver}&trusted_connection=yes&TrustServerCertificate=yes"
            )
        return (
            f"mssql+pyodbc://{self.mssql_username}:{self.mssql_password}"
            f"@{self.mssql_server}/{self.mssql_database}"
            f"?driver={driver}&TrustServerCertificate=yes"
        )


settings = Settings()
