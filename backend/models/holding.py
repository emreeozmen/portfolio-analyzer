from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, func

from database import Base


class Holding(Base):
    __tablename__ = "holdings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    quantity = Column(Float, nullable=False)
    purchase_price = Column(Float, nullable=False)
    purchase_date = Column(DateTime, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
