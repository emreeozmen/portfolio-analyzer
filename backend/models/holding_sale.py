from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, func

from database import Base


class HoldingSale(Base):
    """Records a realized sale, matched FIFO (oldest lot first) against the user's open
    `Holding` rows for that ticker by services/portfolio_service.sell_holding(), which
    also shrinks/deletes the matched Holding rows. `cost_basis` and `realized_pl` are
    computed once at sale time from the lots actually matched, and stored rather than
    recomputed later, so the sale's realized P&L stays fixed even if the holdings it was
    matched against are edited afterwards.
    """

    __tablename__ = "holding_sales"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    quantity = Column(Float, nullable=False)
    sale_price = Column(Float, nullable=False)
    sale_date = Column(DateTime, nullable=False)
    cost_basis = Column(Float, nullable=False)
    realized_pl = Column(Float, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
