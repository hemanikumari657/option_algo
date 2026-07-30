import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from backend.services.auth_service import get_current_user
from backend.db.database import AsyncSessionLocal
from backend.db.models import User, BotConfig
from backend.services.redis_client import get_redis as get_async_redis
from backend.shared.redis_infra import (
    shared_candles_1m,
    shared_candles_5m,
    shared_indicators,
    shared_vwap,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/terminal", tags=["terminal"])

TIMEFRAMES = {
    "1m":  shared_candles_1m,
    "3m":  shared_candles_1m,
    "5m":  shared_candles_5m,
    "15m": shared_candles_5m,
    "30m": shared_candles_5m,
    "1h":  shared_candles_5m,
}

VALID_TIMEFRAMES = set(TIMEFRAMES.keys())
MAX_LIMIT = 500


@router.get("/candles")
async def get_candles(
    symbol: str = Query("NIFTY"),
    timeframe: str = Query("1m"),
    limit: int = Query(200),
    user: User = Depends(get_current_user),
):
    if timeframe not in VALID_TIMEFRAMES:
        raise HTTPException(400, f"Invalid timeframe '{timeframe}'. Valid: {', '.join(sorted(VALID_TIMEFRAMES))}")
    if limit < 1 or limit > MAX_LIMIT:
        limit = min(max(limit, 1), MAX_LIMIT)

    r = get_async_redis()
    candle_key_fn = TIMEFRAMES[timeframe]
    candle_key = candle_key_fn(symbol)
    indicator_key = shared_indicators(symbol)
    vwap_key = shared_vwap(symbol)

    try:
        candles_raw, indicators_raw, vwap_raw = await asyncio.gather(
            r.get(candle_key),
            r.get(indicator_key),
            r.get(vwap_key),
        )
    except Exception as e:
        logger.error("Redis read failed for symbol=%s timeframe=%s: %s", symbol, timeframe, e)
        return {"symbol": symbol, "timeframe": timeframe, "candles": [], "indicators": {}, "vwap": None, "count": 0}

    candles = []
    if candles_raw:
        try:
            all_candles = json.loads(candles_raw)
            if isinstance(all_candles, list):
                candles = all_candles[-limit:]
            elif isinstance(all_candles, dict):
                df_data = all_candles.get("data") or all_candles.get("values") or []
                if isinstance(df_data, list):
                    candles = df_data[-limit:]
        except json.JSONDecodeError as e:
            logger.warning("Failed to parse candles for %s: %s", symbol, e)

    indicators = {}
    if indicators_raw:
        try:
            indicators = json.loads(indicators_raw)
        except json.JSONDecodeError as e:
            logger.warning("Failed to parse indicators for %s: %s", symbol, e)

    vwap = None
    if vwap_raw:
        try:
            vwap = float(vwap_raw)
        except (ValueError, TypeError):
            pass

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "candles": candles,
        "indicators": indicators,
        "vwap": vwap,
        "count": len(candles),
    }


@router.get("/config")
async def get_terminal_config(user: User = Depends(get_current_user)):
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(BotConfig).where(BotConfig.user_id == user.id)
            )
            cfg = res.scalar_one_or_none()
    except Exception as e:
        logger.error("DB read failed for user %d: %s", user.id, e)
        return {"symbol": "NIFTY", "strategy": None, "execution_mode": "PAPER", "order_qty": 1}

    if not cfg:
        return {"symbol": "NIFTY", "strategy": None, "execution_mode": "PAPER", "order_qty": 1}

    exec_mode = None
    if getattr(cfg, "execution_mode", None) is not None:
        exec_mode = cfg.execution_mode.value if hasattr(cfg.execution_mode, "value") else str(cfg.execution_mode)
    elif cfg.paper_mode:
        exec_mode = "PAPER"
    else:
        exec_mode = "AUTO"

    return {
        "symbol": cfg.underlying_symbol or "NIFTY",
        "strategy": cfg.strategy,
        "execution_mode": exec_mode,
        "order_qty": cfg.order_qty or 1,
        "itm_depth": cfg.itm_depth or 1,
        "sl_pct": cfg.sl_pct,
        "target_rr": cfg.target_rr,
    }
