from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import Asset, User, WatchlistItem


def list_assets(db: Session) -> list[Asset]:
    """Every known asset, regardless of who tracks it — for infra-level operations
    (refresh-all, the background auto-refresh loop). Not for user-facing listings;
    use list_visible_assets() for those.
    """
    return db.query(Asset).order_by(Asset.ticker).all()


def list_visible_assets(db: Session, user: User | None) -> list[Asset]:
    """Default (seeded) assets are visible to everyone. Anything a user tracked via
    the search bar is visible only to that user — this is what keeps one user's
    tracked symbols from leaking into every other visitor's Piyasa Görünümü/Varlık
    Listesi/watchlist.
    """
    # `.is_(True)` renders as `IS 1` on MSSQL, which isn't valid T-SQL for a BIT column
    # (IS is for NULL checks there) — plain `== True` renders as the portable `= 1`.
    if user is None:
        return db.query(Asset).filter(Asset.is_default == True).order_by(Asset.ticker).all()  # noqa: E712

    watchlisted_ids = db.query(WatchlistItem.asset_id).filter(WatchlistItem.user_id == user.id)
    return (
        db.query(Asset)
        .filter(or_(Asset.is_default == True, Asset.id.in_(watchlisted_ids)))  # noqa: E712
        .order_by(Asset.ticker)
        .all()
    )


def add_to_watchlist(db: Session, user_id: int, asset_id: int) -> None:
    exists = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == user_id, WatchlistItem.asset_id == asset_id)
        .first()
    )
    if exists:
        return
    db.add(WatchlistItem(user_id=user_id, asset_id=asset_id))
    db.commit()


def remove_from_watchlist(db: Session, user_id: int, asset_id: int) -> bool:
    item = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == user_id, WatchlistItem.asset_id == asset_id)
        .first()
    )
    if item is None:
        return False
    db.delete(item)
    db.commit()
    return True


def get_asset_by_ticker(db: Session, ticker: str) -> Asset | None:
    return db.query(Asset).filter(Asset.ticker == ticker.upper()).first()


def get_or_create_asset(db: Session, ticker: str, name: str, yahoo_symbol: str, exchange: str | None) -> Asset:
    existing = db.query(Asset).filter(Asset.yahoo_symbol == yahoo_symbol).first()
    if existing:
        return existing

    candidate_ticker = ticker.upper()
    if db.query(Asset).filter(Asset.ticker == candidate_ticker).first():
        candidate_ticker = yahoo_symbol.upper()  # disambiguate ticker collisions across exchanges

    asset = Asset(ticker=candidate_ticker, name=name, yahoo_symbol=yahoo_symbol, exchange=exchange)
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset
