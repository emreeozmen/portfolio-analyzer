from sqlalchemy import Column, Float, ForeignKey, Integer, UniqueConstraint

from database import Base


class PortfolioAsset(Base):
    __tablename__ = "portfolio_assets"
    __table_args__ = (
        UniqueConstraint("portfolio_id", "asset_id", name="uq_portfolio_assets_portfolio_asset"),
    )

    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False, index=True)
    weight = Column(Float, nullable=False)
