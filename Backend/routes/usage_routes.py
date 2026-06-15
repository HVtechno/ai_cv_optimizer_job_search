"""
usage_routes.py — admin token-o-meter endpoints. Admin-gated (same require_admin
as the rest of the admin panel). Additive: new routes only.

  GET /usage/admin/summary        totals + today + this month + price table
  GET /usage/admin/daily?days=30  per-day breakdown (tokens, cost) for the chart
  GET /usage/admin/by-model       split by model
  GET /usage/admin/by-feature     split by feature (ATS / rewrite / embedding...)
"""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends

from db.mongodb import MongoDB
from core.usage_store import price_table
from routes.ideal_billing import require_admin

router = APIRouter(prefix="/usage", tags=["usage"])


def _col():
    return MongoDB().db["api_usage"]


def _sum(match: dict) -> dict:
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": None,
            "prompt_tokens":     {"$sum": "$prompt_tokens"},
            "completion_tokens": {"$sum": "$completion_tokens"},
            "total_tokens":      {"$sum": "$total_tokens"},
            "cost_usd":          {"$sum": "$cost_usd"},
            "calls":             {"$sum": 1},
        }},
    ]
    docs = list(_col().aggregate(pipeline))
    if not docs:
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
                "cost_usd": 0.0, "calls": 0}
    d = docs[0]
    d.pop("_id", None)
    d["cost_usd"] = round(d.get("cost_usd", 0.0), 4)
    return d


@router.get("/admin/summary")
async def usage_summary(_: str = Depends(require_admin)):
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    month_prefix = now.strftime("%Y-%m")
    return {
        "all_time":   _sum({}),
        "today":      _sum({"day": today}),
        "this_month": _sum({"day": {"$regex": f"^{month_prefix}"}}),
        "price_table": price_table(),   # so the admin sees the rates in effect
        "as_of": now.isoformat(),
    }


@router.get("/admin/daily")
async def usage_daily(days: int = 30, _: str = Depends(require_admin)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    pipeline = [
        {"$match": {"day": {"$gte": since}}},
        {"$group": {
            "_id": "$day",
            "prompt_tokens":     {"$sum": "$prompt_tokens"},
            "completion_tokens": {"$sum": "$completion_tokens"},
            "total_tokens":      {"$sum": "$total_tokens"},
            "cost_usd":          {"$sum": "$cost_usd"},
            "calls":             {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]
    rows = []
    for d in _col().aggregate(pipeline, allowDiskUse=True):
        rows.append({
            "day": d["_id"],
            "prompt_tokens": d["prompt_tokens"],
            "completion_tokens": d["completion_tokens"],
            "total_tokens": d["total_tokens"],
            "cost_usd": round(d["cost_usd"], 4),
            "calls": d["calls"],
        })
    return {"days": days, "daily": rows}


@router.get("/admin/by-model")
async def usage_by_model(_: str = Depends(require_admin)):
    pipeline = [
        {"$group": {
            "_id": "$model",
            "prompt_tokens":     {"$sum": "$prompt_tokens"},
            "completion_tokens": {"$sum": "$completion_tokens"},
            "total_tokens":      {"$sum": "$total_tokens"},
            "cost_usd":          {"$sum": "$cost_usd"},
            "calls":             {"$sum": 1},
        }},
        {"$sort": {"cost_usd": -1}},
    ]
    return {"models": [
        {"model": d["_id"], "prompt_tokens": d["prompt_tokens"],
         "completion_tokens": d["completion_tokens"], "total_tokens": d["total_tokens"],
         "cost_usd": round(d["cost_usd"], 4), "calls": d["calls"]}
        for d in _col().aggregate(pipeline, allowDiskUse=True)
    ]}


@router.get("/admin/by-feature")
async def usage_by_feature(_: str = Depends(require_admin)):
    pipeline = [
        {"$group": {
            "_id": "$feature",
            "total_tokens": {"$sum": "$total_tokens"},
            "cost_usd":     {"$sum": "$cost_usd"},
            "calls":        {"$sum": 1},
        }},
        {"$sort": {"cost_usd": -1}},
    ]
    return {"features": [
        {"feature": d["_id"] or "unknown", "total_tokens": d["total_tokens"],
         "cost_usd": round(d["cost_usd"], 4), "calls": d["calls"]}
        for d in _col().aggregate(pipeline, allowDiskUse=True)
    ]}
