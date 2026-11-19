import os
import json
import logging
import aiosqlite
import httpx
from datetime import datetime, date, timedelta
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

DB_PATH = os.getenv("SQLITE_DB_PATH", "beauty.db")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()

USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_KEY)


def get_config() -> dict:
    config_path = os.getenv("CONFIG_PATH", "beauty_config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error reading config: {e}")
    return {}


async def init_db():
    """Initializes tables and seeds initial data from beauty_config.json if empty."""
    logger.info(f"Initializing database. Mode: {'Supabase' if USE_SUPABASE else 'SQLite'}")

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS services (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                price INTEGER NOT NULL,
                duration_minutes INTEGER NOT NULL,
                description TEXT,
                is_popular INTEGER DEFAULT 0,
                badge TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS portfolio (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                service TEXT NOT NULL,
                url TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                client_name TEXT NOT NULL,
                client_username TEXT,
                client_phone TEXT NOT NULL,
                service_id TEXT NOT NULL,
                service_title TEXT NOT NULL,
                service_price INTEGER NOT NULL,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL,
                comment TEXT,
                needs_removal INTEGER DEFAULT 0,
                has_allergy INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                reminder_24h_sent INTEGER DEFAULT 0,
                reminder_2h_sent INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS blocked_slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                time TEXT,
                is_full_day INTEGER DEFAULT 0,
                reason TEXT,
                created_at TEXT NOT NULL
            )
        """)
        await db.commit()

        # Seed services if empty
        cursor = await db.execute("SELECT COUNT(*) FROM services")
        services_count = (await cursor.fetchone())[0]
        config = get_config()

        if services_count == 0 and "services" in config:
            for idx, s in enumerate(config["services"]):
                await db.execute("""
                    INSERT INTO services (id, category, title, price, duration_minutes, description, is_popular, badge, is_active, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """, (
                    s.get("id"),
                    s.get("category", "Другое"),
                    s.get("title", "Услуга"),
                    s.get("price", 0),
                    s.get("duration_minutes", 60),
                    s.get("description", ""),
                    1 if s.get("is_popular") else 0,
                    s.get("badge", ""),
                    idx
                ))
            await db.commit()
            logger.info("Services seeded from beauty_config.json")

        # Seed portfolio if empty
        cursor = await db.execute("SELECT COUNT(*) FROM portfolio")
        portfolio_count = (await cursor.fetchone())[0]
        if portfolio_count == 0 and "portfolio_photos" in config:
            for p in config["portfolio_photos"]:
                await db.execute("""
                    INSERT INTO portfolio (id, title, service, url, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    p.get("id", f"p_{int(datetime.now().timestamp())}"),
                    p.get("title", "Работа мастера"),
                    p.get("service", "Ресницы"),
                    p.get("url", ""),
                    datetime.now().isoformat()
                ))
            await db.commit()
            logger.info("Portfolio seeded from beauty_config.json")


# ------------------- SERVICES -------------------

async def get_services(active_only: bool = True) -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        query = "SELECT * FROM services"
        if active_only:
            query += " WHERE is_active = 1"
        query += " ORDER BY sort_order ASC, price ASC"
        cursor = await db.execute(query)
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_service_by_id(service_id: str) -> Optional[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM services WHERE id = ?", (service_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def add_service(service_data: dict) -> Dict[str, Any]:
    s_id = service_data.get("id") or f"srv_{int(datetime.now().timestamp())}"
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO services (id, category, title, price, duration_minutes, description, is_popular, badge, is_active, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 99)
        """, (
            s_id,
            service_data.get("category", "Ресницы"),
            service_data.get("title", ""),
            int(service_data.get("price", 0)),
            int(service_data.get("duration_minutes", 60)),
            service_data.get("description", ""),
            1 if service_data.get("is_popular") else 0,
            service_data.get("badge", "")
        ))
        await db.commit()
    return await get_service_by_id(s_id)


async def update_service(service_id: str, service_data: dict) -> Optional[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            UPDATE services
            SET category = ?, title = ?, price = ?, duration_minutes = ?, description = ?, is_popular = ?, badge = ?, is_active = ?
            WHERE id = ?
        """, (
            service_data.get("category"),
            service_data.get("title"),
            int(service_data.get("price", 0)),
            int(service_data.get("duration_minutes", 60)),
            service_data.get("description", ""),
            1 if service_data.get("is_popular") else 0,
            service_data.get("badge", ""),
            1 if service_data.get("is_active", True) else 0,
            service_id
        ))
        await db.commit()
    return await get_service_by_id(service_id)


async def delete_service(service_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM services WHERE id = ?", (service_id,))
        await db.commit()
    return True


# ------------------- PORTFOLIO -------------------

async def get_portfolio() -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM portfolio ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def add_portfolio_item(data: dict) -> Dict[str, Any]:
    p_id = data.get("id") or f"p_{int(datetime.now().timestamp())}"
    now_iso = datetime.now().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO portfolio (id, title, service, url, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            p_id,
            data.get("title", "Работа мастера"),
            data.get("service", "Ресницы"),
            data.get("url", ""),
            now_iso
        ))
        await db.commit()
    return {"id": p_id, "title": data.get("title"), "service": data.get("service"), "url": data.get("url"), "created_at": now_iso}


async def delete_portfolio_item(photo_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM portfolio WHERE id = ?", (photo_id,))
        await db.commit()
    return True


# ------------------- APPOINTMENTS -------------------

# Supabase PostgREST sync helper (if SUPABASE_URL and SUPABASE_KEY are provided)
async def sync_to_supabase(table: str, data: dict):
    if not USE_SUPABASE:
        return
    try:
        url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{table}"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(url, json=data, headers=headers)
            if res.status_code in (200, 201):
                logger.info(f"Synced record to Supabase table {table}")
            else:
                logger.warning(f"Supabase sync ({table}) returned status {res.status_code}: {res.text}")
    except Exception as e:
        logger.warning(f"Supabase sync error (fallback to local SQLite intact): {e}")


async def create_appointment(data: dict) -> Dict[str, Any]:
    now_iso = datetime.now().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("""
            INSERT INTO appointments (
                client_id, client_name, client_username, client_phone,
                service_id, service_title, service_price,
                date, time, duration_minutes,
                comment, needs_removal, has_allergy, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        """, (
            int(data.get("client_id", 0)),
            data.get("client_name", ""),
            data.get("client_username", ""),
            data.get("client_phone", ""),
            data.get("service_id", ""),
            data.get("service_title", ""),
            int(data.get("service_price", 0)),
            data.get("date", ""),
            data.get("time", ""),
            int(data.get("duration_minutes", 60)),
            data.get("comment", ""),
            1 if data.get("needs_removal") else 0,
            1 if data.get("has_allergy") else 0,
            now_iso
        ))
        await db.commit()
        app_id = cursor.lastrowid

    created_app = await get_appointment_by_id(app_id)
    if USE_SUPABASE and created_app:
        await sync_to_supabase("appointments", created_app)
    return created_app


async def get_appointment_by_id(app_id: int) -> Optional[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM appointments WHERE id = ?", (app_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_appointments_by_date(date_str: str) -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT * FROM appointments
            WHERE date = ?
            ORDER BY time ASC
        """, (date_str,))
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_client_appointments(client_id: int) -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT * FROM appointments
            WHERE client_id = ?
            ORDER BY date DESC, time DESC
        """, (client_id,))
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def update_appointment_status(app_id: int, status: str) -> Optional[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE appointments SET status = ? WHERE id = ?", (status, app_id))
        await db.commit()
    return await get_appointment_by_id(app_id)


async def cancel_appointment_by_client(app_id: int, client_id: int) -> tuple[bool, str]:
    app = await get_appointment_by_id(app_id)
    if not app:
        return False, "Запись не найдена"
    if app["client_id"] != client_id:
        return False, "Доступ запрещен"
    if app["status"] == "cancelled":
        return False, "Запись уже отменена"

    # Check 3 hours rule
    try:
        app_dt = datetime.strptime(f"{app['date']} {app['time']}", "%Y-%m-%d %H:%M")
        if datetime.now() + timedelta(hours=3) > app_dt:
            return False, "Отмена онлайн возможна не позднее чем за 3 часа до визита. Свяжитесь с мастером."
    except Exception as e:
        logger.error(f"Error parsing appointment date: {e}")

    await update_appointment_status(app_id, "cancelled")
    return True, "Запись успешно отменена"


# ------------------- BLOCKED SLOTS -------------------

async def get_blocked_slots(date_str: str) -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM blocked_slots WHERE date = ?", (date_str,))
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def block_slot(date_str: str, time_str: Optional[str], is_full_day: bool, reason: str = "") -> Dict[str, Any]:
    now_iso = datetime.now().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("""
            INSERT INTO blocked_slots (date, time, is_full_day, reason, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (date_str, time_str or "", 1 if is_full_day else 0, reason, now_iso))
        await db.commit()
        b_id = cursor.lastrowid
    return {"id": b_id, "date": date_str, "time": time_str, "is_full_day": is_full_day, "reason": reason}


async def unblock_slot(slot_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM blocked_slots WHERE id = ?", (slot_id,))
        await db.commit()
    return True


# ------------------- TIME SLOTS CALCULATION -------------------

def time_to_minutes(t_str: str) -> int:
    h, m = map(int, t_str.split(":"))
    return h * 60 + m


def minutes_to_time(minutes: int) -> str:
    h = minutes // 60
    m = minutes % 60
    return f"{h:02d}:{m:02d}"


async def get_available_slots(date_str: str, duration_minutes: int, schedule_config: dict) -> List[Dict[str, Any]]:
    """Calculates all available start times for a given date and service duration."""
    start_str = schedule_config.get("start", "09:00")
    end_str = schedule_config.get("end", "21:00")
    step = int(schedule_config.get("step_minutes", 30))

    start_min = time_to_minutes(start_str)
    end_min = time_to_minutes(end_str)

    # Check blocked slots
    blocked = await get_blocked_slots(date_str)
    for b in blocked:
        if b["is_full_day"]:
            return []  # Entire day is blocked

    # Check lunch break if configured
    break_intervals = []
    if schedule_config.get("break_start") and schedule_config.get("break_end"):
        break_intervals.append((
            time_to_minutes(schedule_config["break_start"]),
            time_to_minutes(schedule_config["break_end"])
        ))

    # Add specific blocked times to occupied intervals
    occupied_intervals = list(break_intervals)
    for b in blocked:
        if b["time"]:
            b_start = time_to_minutes(b["time"])
            occupied_intervals.append((b_start, b_start + step))

    # Add existing active appointments
    appointments = await get_appointments_by_date(date_str)
    for a in appointments:
        if a["status"] not in ("cancelled", "rejected"):
            a_start = time_to_minutes(a["time"])
            a_duration = int(a.get("duration_minutes", 60))
            occupied_intervals.append((a_start, a_start + a_duration))

    # Calculate free slots
    slots = []
    curr = start_min
    today_str = date.today().isoformat()
    now = datetime.now()

    while curr + duration_minutes <= end_min:
        slot_time = minutes_to_time(curr)
        slot_end = curr + duration_minutes

        # Check if slot is in the past for today (+30 min buffer)
        is_past = False
        if date_str == today_str:
            slot_dt = datetime.strptime(f"{date_str} {slot_time}", "%Y-%m-%d %H:%M")
            if slot_dt < now + timedelta(minutes=30):
                is_past = True

        # Check overlap
        overlaps = False
        if not is_past:
            for (occ_start, occ_end) in occupied_intervals:
                # Overlap if max(start1, start2) < min(end1, end2)
                if max(curr, occ_start) < min(slot_end, occ_end):
                    overlaps = True
                    break

        slots.append({
            "time": slot_time,
            "available": (not is_past) and (not overlaps),
            "reason": "Занято" if overlaps else ("Прошло" if is_past else "Свободно")
        })

        curr += step

    return slots


# ------------------- REMINDERS -------------------

async def get_due_reminders(hours_ahead: int) -> List[Dict[str, Any]]:
    """Finds appointments needing reminder (24h or 2h)."""
    target_date = (datetime.now() + timedelta(hours=hours_ahead)).strftime("%Y-%m-%d")
    target_hour = (datetime.now() + timedelta(hours=hours_ahead)).strftime("%H:%M")

    col_flag = "reminder_24h_sent" if hours_ahead >= 12 else "reminder_2h_sent"

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        # Find active appointments within the window
        cursor = await db.execute(f"""
            SELECT * FROM appointments
            WHERE date = ? AND {col_flag} = 0 AND status IN ('pending', 'confirmed')
        """, (target_date,))
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def mark_reminder_sent(app_id: int, hours_ahead: int):
    col_flag = "reminder_24h_sent" if hours_ahead >= 12 else "reminder_2h_sent"
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE appointments SET {col_flag} = 1 WHERE id = ?", (app_id,))
        await db.commit()


# ------------------- STATS -------------------

async def get_monthly_stats(year: int, month: int) -> Dict[str, Any]:
    prefix = f"{year:04d}-{month:02d}"
    async with aiosqlite.connect(DB_PATH) as db:
        # Total revenue of confirmed or completed appointments
        cursor = await db.execute("""
            SELECT COALESCE(SUM(service_price), 0), COUNT(*)
            FROM appointments
            WHERE date LIKE ? AND status IN ('confirmed', 'completed')
        """, (f"{prefix}%",))
        row = await cursor.fetchone()
        revenue = row[0]
        confirmed_count = row[1]

        # Total unique clients
        cursor = await db.execute("""
            SELECT COUNT(DISTINCT client_id)
            FROM appointments
            WHERE date LIKE ? AND status IN ('confirmed', 'completed')
        """, (f"{prefix}%",))
        unique_clients = (await cursor.fetchone())[0]

        # All appointments this month (including pending, cancelled)
        cursor = await db.execute("""
            SELECT COUNT(*) FROM appointments WHERE date LIKE ?
        """, (f"{prefix}%",))
        total_bookings = (await cursor.fetchone())[0]

    return {
        "year": year,
        "month": month,
        "revenue": revenue,
        "confirmed_count": confirmed_count,
        "unique_clients": unique_clients,
        "total_bookings": total_bookings
    }
