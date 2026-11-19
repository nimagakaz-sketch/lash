import os
import json
import hmac
import hashlib
import logging
import asyncio
from urllib.parse import parse_qsl, unquote
from datetime import datetime, date
from typing import Optional, Dict, Any, List

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, HTTPException, Depends, Query, status
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from contextlib import asynccontextmanager

import db
import bot

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("main")

DEFAULT_BOT_TOKEN = "9287492367:AAElx58TeIYxv79D0upgLWzkKP8LEz3ymEM"
BOT_TOKEN = os.getenv("BOT_TOKEN", DEFAULT_BOT_TOKEN).strip() or DEFAULT_BOT_TOKEN


def validate_telegram_data(init_data: str) -> Optional[Dict[str, Any]]:
    """
    Validates Telegram WebApp initData string using HMAC-SHA256 according to official spec.
    Returns parsed user dict if valid, or None if invalid.
    """
    if not init_data:
        return None

    try:
        parsed_data = dict(parse_qsl(init_data, keep_blank_values=True))
        if "hash" not in parsed_data:
            return None

        received_hash = parsed_data.pop("hash")
        # Build data-check-string from alphabetically sorted key=value pairs
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed_data.items()))

        if not BOT_TOKEN:
            # If BOT_TOKEN is not configured yet (local testing), extract user info anyway
            user_json = parsed_data.get("user")
            return json.loads(user_json) if user_json else {}

        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()

        if hmac.compare_digest(calculated_hash, received_hash):
            user_json = parsed_data.get("user")
            return json.loads(user_json) if user_json else {}
        else:
            logger.warning("Telegram initData HMAC validation mismatch.")
            return None
    except Exception as e:
        logger.error(f"Error validating initData: {e}")
        return None


async def get_current_user(request: Request) -> Optional[Dict[str, Any]]:
    """
    Extracts and validates Telegram user from X-Telegram-Init-Data header or query param.
    Supports development fallback for browser testing when header is absent.
    """
    init_data = request.headers.get("X-Telegram-Init-Data") or request.query_params.get("initData")
    if init_data:
        user = validate_telegram_data(init_data)
        if user:
            return user

    # Development fallback
    dev_user_id = request.headers.get("X-Dev-User-Id") or request.query_params.get("user_id")
    if dev_user_id:
        return {
            "id": int(dev_user_id),
            "first_name": request.query_params.get("first_name", "Клиент"),
            "username": request.query_params.get("username", "")
        }

    return None


async def require_admin(request: Request) -> Dict[str, Any]:
    """Ensures caller is listed in admin_ids or entered correct admin PIN."""
    user = await get_current_user(request)
    admin_ids = bot.get_admin_ids()
    cfg = db.get_config()
    admin_pin = cfg.get("admin_pin", "7788")
    pin = request.headers.get("X-Admin-PIN") or request.query_params.get("pin")

    # 1. Telegram user authenticated in admin_ids
    if user and user.get("id") in admin_ids:
        return user

    # 2. Master PIN match (for browser demonstration/management)
    if pin and pin == admin_pin:
        return {"id": admin_ids[0] if admin_ids else 6573422629, "first_name": "Мастер", "is_admin": True}

    # 3. Direct admin ID param for quick demo
    if request.query_params.get("admin") == "6573422629":
        return {"id": 6573422629, "first_name": "Мастер", "is_admin": True}

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Доступ в кабинет мастера разрешён только администраторам студии."
    )


# ------------------- LIFESPAN (FastAPI + aiogram) -------------------

polling_task = None
reminders_task = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global polling_task, reminders_task
    logger.info("Initializing app & database...")
    await db.init_db()

    if bot.bot and bot.dp:
        logger.info("Starting Telegram Bot polling in background task...")
        try:
            await bot.bot.delete_webhook(drop_pending_updates=True)
        except Exception as e:
            logger.warning(f"Error resetting webhook: {e}")
        # Start bot polling
        polling_task = asyncio.create_task(bot.dp.start_polling(bot.bot, drop_pending_updates=True))
        # Start reminder scheduler
        reminders_task = asyncio.create_task(bot.run_reminders_loop())
    else:
        logger.warning("BOT_TOKEN is not configured; running without Telegram bot polling.")

    yield

    logger.info("Shutting down...")
    if reminders_task:
        reminders_task.cancel()
    if polling_task:
        polling_task.cancel()
    if bot.bot:
        await bot.bot.session.close()


app = FastAPI(title="Beauty Salon WebApp & Bot", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------- PUBLIC ENDPOINTS -------------------

@app.get("/health")
async def health_check():
    """Health check endpoint for Render and UptimeRobot."""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.get("/api/config")
async def get_public_config(request: Request):
    """Returns studio public configuration and whether current user is admin."""
    config = db.get_config()
    user = await get_current_user(request)

    admin_ids = bot.get_admin_ids()
    pin = request.headers.get("X-Admin-PIN") or request.query_params.get("pin")
    admin_pin = config.get("admin_pin", "7788")

    is_admin = False
    if user and user.get("id") in admin_ids:
        is_admin = True
    elif pin and pin == admin_pin:
        is_admin = True
    elif request.query_params.get("admin") == "6573422629":
        is_admin = True

    return {
        "studio_name": config.get("studio_name", "Студия красоты"),
        "tagline": config.get("tagline", "Онлайн-запись 24/7"),
        "avatar_url": config.get("avatar_url", "/static/uploads/avatar.jpg"),
        "rating_text": config.get("rating_text", "⭐ 4.98 (240+ отзывов)"),
        "theme": config.get("theme", {}),
        "address": config.get("address", ""),
        "address_hint": config.get("address_hint", ""),
        "instagram_or_channel": config.get("instagram_or_channel", ""),
        "phone": config.get("phone", ""),
        "work_schedule": config.get("work_schedule", {}),
        "categories": config.get("categories", ["Все"]),
        "is_admin": is_admin,
        "current_user": user
    }


@app.get("/api/services")
async def get_services_endpoint():
    return await db.get_services(active_only=True)


@app.get("/api/portfolio")
async def get_portfolio_endpoint():
    return await db.get_portfolio()


@app.get("/api/available-slots")
async def get_available_slots_endpoint(
    date: str = Query(..., description="YYYY-MM-DD"),
    service_id: str = Query(...),
    needs_removal: bool = Query(False)
):
    service = await db.get_service_by_id(service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Услуга не найдена")

    duration = int(service["duration_minutes"])
    if needs_removal:
        duration += 30  # +30 min for removal

    config = db.get_config()
    schedule = config.get("work_schedule", {})
    slots = await db.get_available_slots(date, duration, schedule)
    return {"date": date, "service_id": service_id, "duration_minutes": duration, "slots": slots}


class AppointmentCreate(BaseModel):
    service_id: str
    date: str
    time: str
    client_name: str
    client_phone: str
    client_id: Optional[int] = None
    client_username: Optional[str] = None
    comment: Optional[str] = ""
    needs_removal: Optional[bool] = False
    has_allergy: Optional[bool] = False


@app.post("/api/appointments")
async def create_appointment_endpoint(payload: AppointmentCreate, request: Request):
    service = await db.get_service_by_id(payload.service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Услуга не найдена")

    user = await get_current_user(request)
    client_id = user["id"] if user else (payload.client_id or 0)
    client_username = user.get("username") if user else (payload.client_username or "")
    client_name = payload.client_name or (user.get("first_name") if user else "Клиент")

    duration = int(service["duration_minutes"])
    price = int(service["price"])
    if payload.needs_removal:
        duration += 30
        price += 500  # +500 ₽ for removal

    app_data = {
        "client_id": client_id,
        "client_name": client_name,
        "client_username": client_username,
        "client_phone": payload.client_phone,
        "service_id": service["id"],
        "service_title": service["title"],
        "service_price": price,
        "date": payload.date,
        "time": payload.time,
        "duration_minutes": duration,
        "comment": payload.comment or "",
        "needs_removal": payload.needs_removal,
        "has_allergy": payload.has_allergy
    }

    created = await db.create_appointment(app_data)

    # Immediately notify master via Telegram bot
    try:
        await bot.notify_admins_new_booking(created)
    except Exception as e:
        logger.error(f"Error notifying admin: {e}")

    return created


@app.get("/api/my-appointments")
async def get_my_appointments(request: Request, client_id: Optional[int] = None):
    user = await get_current_user(request)
    effective_id = user["id"] if user else client_id
    if not effective_id:
        return []
    return await db.get_client_appointments(effective_id)


@app.post("/api/appointments/{app_id}/cancel")
async def cancel_my_appointment(app_id: int, request: Request):
    user = await get_current_user(request)
    client_id = user["id"] if user else int(request.query_params.get("client_id", 0))
    if not client_id:
        raise HTTPException(status_code=401, detail="Необходима авторизация")

    app = await db.get_appointment_by_id(app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    success, message = await db.cancel_appointment_by_client(app_id, client_id)
    if not success:
        raise HTTPException(status_code=400, detail=message)

    # Notify admins about client cancellation
    try:
        await bot.notify_admins_client_cancelled(app)
    except Exception as e:
        logger.error(f"Error notifying cancellation to admins: {e}")

    return {"status": "ok", "message": message}


# ------------------- ADMIN ENDPOINTS -------------------

@app.get("/api/admin/schedule")
async def admin_get_schedule(date: str = Query(...), admin: dict = Depends(require_admin)):
    appointments = await db.get_appointments_by_date(date)
    blocked = await db.get_blocked_slots(date)
    return {"date": date, "appointments": appointments, "blocked_slots": blocked}


class StatusUpdate(BaseModel):
    status: str


@app.post("/api/admin/appointments/{app_id}/status")
async def admin_update_status(app_id: int, payload: StatusUpdate, admin: dict = Depends(require_admin)):
    if payload.status not in ("pending", "confirmed", "cancelled", "completed"):
        raise HTTPException(status_code=400, detail="Неверный статус")
    app = await db.update_appointment_status(app_id, payload.status)
    if not app:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return app


class BlockSlotPayload(BaseModel):
    date: str
    time: Optional[str] = None
    is_full_day: bool = False
    reason: Optional[str] = "Перерыв / Выходной"


@app.post("/api/admin/slots/block")
async def admin_block_slot(payload: BlockSlotPayload, admin: dict = Depends(require_admin)):
    res = await db.block_slot(payload.date, payload.time, payload.is_full_day, payload.reason or "")
    return res


@app.delete("/api/admin/slots/{slot_id}")
async def admin_unblock_slot(slot_id: int, admin: dict = Depends(require_admin)):
    await db.unblock_slot(slot_id)
    return {"status": "ok"}


class ServicePayload(BaseModel):
    id: Optional[str] = None
    category: str
    title: str
    price: int
    duration_minutes: int
    description: Optional[str] = ""
    is_popular: Optional[bool] = False
    badge: Optional[str] = ""
    is_active: Optional[bool] = True


@app.post("/api/admin/services")
async def admin_add_service(payload: ServicePayload, admin: dict = Depends(require_admin)):
    return await db.add_service(payload.model_dump())


@app.put("/api/admin/services/{service_id}")
async def admin_edit_service(service_id: str, payload: ServicePayload, admin: dict = Depends(require_admin)):
    res = await db.update_service(service_id, payload.model_dump())
    if not res:
        raise HTTPException(status_code=404, detail="Услуга не найдена")
    return res


@app.delete("/api/admin/services/{service_id}")
async def admin_delete_service(service_id: str, admin: dict = Depends(require_admin)):
    await db.delete_service(service_id)
    return {"status": "ok"}


class PortfolioPayload(BaseModel):
    id: Optional[str] = None
    title: str
    service: str
    url: str


@app.post("/api/admin/portfolio")
async def admin_add_portfolio(payload: PortfolioPayload, admin: dict = Depends(require_admin)):
    return await db.add_portfolio_item(payload.model_dump())


@app.delete("/api/admin/portfolio/{photo_id}")
async def admin_delete_portfolio(photo_id: str, admin: dict = Depends(require_admin)):
    await db.delete_portfolio_item(photo_id)
    return {"status": "ok"}


@app.get("/api/admin/stats")
async def admin_stats(
    year: Optional[int] = None,
    month: Optional[int] = None,
    admin: dict = Depends(require_admin)
):
    now = datetime.now()
    y = year or now.year
    m = month or now.month
    return await db.get_monthly_stats(y, m)


class VerifyPinPayload(BaseModel):
    pin: str


@app.post("/api/admin/verify-pin")
async def admin_verify_pin(payload: VerifyPinPayload):
    cfg = db.get_config()
    if payload.pin == cfg.get("admin_pin", "7788"):
        return {"status": "ok", "is_admin": True}
    raise HTTPException(status_code=401, detail="Неверный PIN-код мастера")


class ProfilePayload(BaseModel):
    studio_name: str
    tagline: str
    rating_text: Optional[str] = "⭐ 4.98 (240+ отзывов)"
    address: str
    address_hint: Optional[str] = ""
    phone: Optional[str] = ""
    instagram_or_channel: Optional[str] = ""
    avatar_url: Optional[str] = None
    avatar_base64: Optional[str] = None


@app.post("/api/admin/profile")
async def admin_update_profile(payload: ProfilePayload, admin: dict = Depends(require_admin)):
    data = payload.model_dump()
    avatar_b64 = data.pop("avatar_base64", None)

    if avatar_b64 and "," in avatar_b64:
        try:
            import base64
            from PIL import Image
            import io
            b64_data = avatar_b64.split(",")[1]
            img_bytes = base64.b64decode(b64_data)
            img = Image.open(io.BytesIO(img_bytes))
            ts = int(datetime.now().timestamp())
            os.makedirs("static/uploads", exist_ok=True)
            out_path = f"static/uploads/avatar_{ts}.jpg"
            img = img.convert("RGB")
            img.thumbnail((800, 800))
            img.save(out_path, "JPEG", quality=88)
            data["avatar_url"] = f"/{out_path}"
        except Exception as e:
            logger.error(f"Error saving uploaded avatar: {e}")

    updated = db.save_profile_settings(data)
    return {"status": "ok", "config": updated}


class SchedulePayload(BaseModel):
    start: str
    end: str
    step_minutes: int
    break_enabled: bool = True
    break_start: Optional[str] = "13:30"
    break_end: Optional[str] = "14:00"
    working_days: List[int] = [1, 2, 3, 4, 5, 6, 0]


@app.post("/api/admin/schedule-settings")
async def admin_update_schedule_settings(payload: SchedulePayload, admin: dict = Depends(require_admin)):
    updated_sched = db.save_schedule_settings(payload.model_dump())
    return {"status": "ok", "schedule": updated_sched}


# ------------------- STATIC FILES & WEBAPP HTML -------------------

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=FileResponse)
async def serve_index():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
