from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from config import settings

engine = create_engine(settings.sqlalchemy_database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _add_column_if_missing(inspector, table: str, column: str, ddl_type: str, default_sql: str) -> None:
    if table not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns(table)}
    if column in columns:
        return

    if engine.dialect.name == "mssql":
        ddl = f"ALTER TABLE {table} ADD {column} {ddl_type} NULL"
    else:
        ddl = f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"
    with engine.begin() as conn:
        conn.execute(text(ddl))
        if default_sql:
            conn.execute(text(f"UPDATE {table} SET {column} = {default_sql} WHERE {column} IS NULL"))


def run_light_migrations() -> None:
    """Adds columns that `Base.metadata.create_all()` can't add to an already-existing
    table (SQLAlchemy only creates missing tables, it never alters existing ones).
    Kept minimal and idempotent since this project has no formal migration tool.

    The "use Alembic instead" guidance elsewhere in this repo assumes `alembic upgrade
    head` can actually be *run* against the deployed database — it can't, on the
    production Render deployment: both Shell access and the Pre-Deploy Command field
    are paid-plan-only on the free instance this app runs on (confirmed directly in
    the Render dashboard), and there's no other way to execute an arbitrary command
    against prod. So this light-migration path — which runs automatically on every
    boot via main.py, no manual step required — is deliberately still the one that
    actually reaches production for a new column, even after Alembic was set up.
    Alembic migrations are still written for local MSSQL dev parity and as a record
    of intent, but don't assume a merged migration file is what patched prod; check
    here.
    """
    inspector = inspect(engine)
    _add_column_if_missing(inspector, "holdings", "portfolio_id", "INT", "")
    _add_column_if_missing(inspector, "assets", "is_default", "BIT" if engine.dialect.name == "mssql" else "BOOLEAN", "0")
    _add_column_if_missing(inspector, "assets", "sector", "VARCHAR(60)", "")
    _add_column_if_missing(
        inspector, "users", "email_alerts_enabled", "BIT" if engine.dialect.name == "mssql" else "BOOLEAN", "1"
    )
    _add_column_if_missing(
        inspector, "users", "email_verified", "BIT" if engine.dialect.name == "mssql" else "BOOLEAN", "0"
    )
