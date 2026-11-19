import os
import json
import asyncio
import logging
from typing import Optional, List
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    WebAppInfo,
    CallbackQuery,
    Message
)

from dotenv import load_dotenv
load_dotenv()

import db

logger = logging.getLogger(__name__)

DEFAULT_BOT_TOKEN = "9287492367:AAElx58TeIYxv79D0upgLWzkKP8LEz3ymEM"
BOT_TOKEN = os.getenv("BOT_TOKEN", DEFAULT_BOT_TOKEN).strip() or DEFAULT_BOT_TOKEN
WEBAPP_URL = os.getenv("WEBAPP_URL", "http://localhost:8000").strip()

bot: Optional[Bot] = None
dp: Optional[Dispatcher] = None

if BOT_TOKEN:
    try:
        bot = Bot(token=BOT_TOKEN)
        dp = Dispatcher()
    except Exception as e:
        logger.error(f"Failed to initialize Telegram Bot: {e}")
        bot = None
        dp = None
else:
    logger.warning("BOT_TOKEN not provided in environment. Running in mock/offline mode.")


def get_admin_ids() -> List[int]:
    """Returns admin IDs from .env or beauty_config.json."""
    env_admins = os.getenv("ADMIN_IDS", "").strip()
    if env_admins:
        try:
            return [int(x.strip()) for x in env_admins.split(",") if x.strip()]
        except Exception:
            pass

    config = db.get_config()
    return config.get("admin_ids", [])


def get_main_keyboard() -> InlineKeyboardMarkup:
    config = db.get_config()
    studio_name = config.get("studio_name", "Студия красоты")
    webapp_url = os.getenv("WEBAPP_URL", "http://localhost:8000").strip()

    buttons = [
        [
            InlineKeyboardButton(
                text="✨ Записаться онлайн",
                web_app=WebAppInfo(url=webapp_url)
            )
        ],
        [
            InlineKeyboardButton(
                text="📋 Прайс и контакты",
                callback_data="info_services"
            ),
            InlineKeyboardButton(
                text="🗓 Мои визиты",
                web_app=WebAppInfo(url=f"{webapp_url}?tab=2")
            )
        ]
    ]

    channel = config.get("instagram_or_channel")
    if channel:
        buttons.append([
            InlineKeyboardButton(text="📷 Портфолио / Канал", url=channel)
        ])

    return InlineKeyboardMarkup(inline_keyboard=buttons)


# ------------------- BOT HANDLERS -------------------

if dp:
    @dp.message(CommandStart())
    async def handle_start(message: Message):
        config = db.get_config()
        studio = config.get("studio_name", "Бьюти-студия")
        tagline = config.get("tagline", "Онлайн-запись 24/7")
        address = config.get("address", "")
        hint = config.get("address_hint", "")
        schedule = config.get("work_schedule", {})
        hours = f"{schedule.get('start', '09:00')} – {schedule.get('end', '21:00')}"

        text = (
            f"✨ <b>Добро пожаловать в {studio}!</b>\n\n"
            f"<i>{tagline}</i>\n\n"
            f"📍 <b>Адрес:</b> {address}\n"
            f"{f'({hint})' if hint else ''}\n"
            f"🕒 <b>График работы:</b> ежедневно {hours}\n\n"
            f"Нажмите кнопку ниже, чтобы выбрать услугу, удобную дату и время онлайн 👇"
        )

        await message.answer(
            text=text,
            parse_mode="HTML",
            reply_markup=get_main_keyboard()
        )


    @dp.callback_query(F.data == "info_services")
    async def handle_info_services(callback: CallbackQuery):
        config = db.get_config()
        services = await db.get_services(active_only=True)
        address = config.get("address", "")
        phone = config.get("phone", "")

        lines = [f"<b>Популярные услуги и цены:</b>\n"]
        for s in services[:6]:
            badge = f" [{s['badge']}]" if s.get("badge") else ""
            lines.append(f"• <b>{s['title']}</b> — {s['price']} ₽ ({s['duration_minutes']} мин){badge}")

        lines.append(f"\n📍 <b>Адрес:</b> {address}")
        if phone:
            lines.append(f"📞 <b>Телефон:</b> {phone}")

        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="✨ Выбрать время в приложении", web_app=WebAppInfo(url=os.getenv("WEBAPP_URL", "http://localhost:8000")))],
            [InlineKeyboardButton(text="« Назад", callback_data="back_main")]
        ])

        await callback.message.edit_text(
            text="\n".join(lines),
            parse_mode="HTML",
            reply_markup=kb
        )
        await callback.answer()


    @dp.callback_query(F.data == "back_main")
    async def handle_back_main(callback: CallbackQuery):
        config = db.get_config()
        studio = config.get("studio_name", "Бьюти-студия")
        tagline = config.get("tagline", "Онлайн-запись 24/7")
        address = config.get("address", "")

        text = (
            f"✨ <b>{studio}</b>\n\n"
            f"<i>{tagline}</i>\n\n"
            f"📍 <b>Адрес:</b> {address}\n\n"
            f"Выберите действие ниже:"
        )
        await callback.message.edit_text(
            text=text,
            parse_mode="HTML",
            reply_markup=get_main_keyboard()
        )
        await callback.answer()


    # Admin confirmation / cancellation buttons under new appointment notification
    @dp.callback_query(F.data.startswith("adm_confirm:"))
    async def handle_admin_confirm(callback: CallbackQuery):
        app_id = int(callback.data.split(":")[1])
        app = await db.update_appointment_status(app_id, "confirmed")
        if not app:
            await callback.answer("Запись не найдена", show_alert=True)
            return

        config = db.get_config()
        address = config.get("address", "")
        hint = config.get("address_hint", "")

        # Update admin message
        updated_text = (
            f"{callback.message.text}\n\n"
            f"<b>✅ ПОДТВЕРЖДЕНО МАСТЕРОМ</b> ({callback.from_user.first_name})"
        )
        await callback.message.edit_text(updated_text, parse_mode="HTML")
        await callback.answer("Запись подтверждена!")

        # Notify client
        if bot and app.get("client_id"):
            try:
                client_text = (
                    f"✨ <b>Ваша запись подтверждена!</b>\n\n"
                    f"💖 Ждём вас в нашей студии!\n"
                    f"🗓 <b>Дата и время:</b> {app['date']} в {app['time']}\n"
                    f"💅 <b>Услуга:</b> {app['service_title']} ({app['service_price']} ₽)\n"
                    f"📍 <b>Адрес:</b> {address}\n"
                    f"{f'<i>Подсказка: {hint}</i>\n' if hint else ''}"
                    f"Если ваши планы изменятся, пожалуйста, предупредите нас заранее."
                )
                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="🗓 Посмотреть мои записи", web_app=WebAppInfo(url=f"{os.getenv('WEBAPP_URL', 'http://localhost:8000')}?tab=2"))]
                ])
                await bot.send_message(
                    chat_id=app["client_id"],
                    text=client_text,
                    parse_mode="HTML",
                    reply_markup=kb
                )
            except Exception as e:
                logger.error(f"Failed to notify client {app['client_id']}: {e}")


    @dp.callback_query(F.data.startswith("adm_cancel:"))
    async def handle_admin_cancel(callback: CallbackQuery):
        app_id = int(callback.data.split(":")[1])
        app = await db.update_appointment_status(app_id, "cancelled")
        if not app:
            await callback.answer("Запись не найдена", show_alert=True)
            return

        updated_text = (
            f"{callback.message.text}\n\n"
            f"<b>❌ ОТКЛОНЕНО МАСТЕРОМ</b> ({callback.from_user.first_name})"
        )
        await callback.message.edit_text(updated_text, parse_mode="HTML")
        await callback.answer("Запись отклонена")

        # Notify client
        if bot and app.get("client_id"):
            try:
                client_text = (
                    f"⚠️ <b>Запись не подтверждена</b>\n\n"
                    f"К сожалению, мастер не может принять вас на услугу <b>{app['service_title']}</b> {app['date']} в {app['time']}.\n"
                    f"Пожалуйста, выберите другое удобное время в мини-приложении."
                )
                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="✨ Выбрать другое время", web_app=WebAppInfo(url=os.getenv("WEBAPP_URL", "http://localhost:8000")))]
                ])
                await bot.send_message(
                    chat_id=app["client_id"],
                    text=client_text,
                    parse_mode="HTML",
                    reply_markup=kb
                )
            except Exception as e:
                logger.error(f"Failed to notify client {app['client_id']}: {e}")


    # Client reminder confirmation
    @dp.callback_query(F.data.startswith("cli_confirm:"))
    async def handle_client_confirm(callback: CallbackQuery):
        app_id = int(callback.data.split(":")[1])
        await callback.message.edit_text(
            f"{callback.message.text}\n\n<b>✅ Вы подтвердили свой визит. С нетерпением ждём вас!</b>",
            parse_mode="HTML"
        )
        await callback.answer("Спасибо! Ждем вас!")


    @dp.callback_query(F.data.startswith("cli_cancel:"))
    async def handle_client_cancel(callback: CallbackQuery):
        app_id = int(callback.data.split(":")[1])
        success, msg = await db.cancel_appointment_by_client(app_id, callback.from_user.id)
        if success:
            app = await db.get_appointment_by_id(app_id)
            await callback.message.edit_text(
                f"{callback.message.text}\n\n<b>❌ Вы отменили визит. Слот освобождён.</b>",
                parse_mode="HTML"
            )
            await callback.answer("Запись отменена")
            if app:
                await notify_admins_client_cancelled(app)
        else:
            await callback.answer(msg, show_alert=True)


# ------------------- NOTIFICATIONS SENDER -------------------

async def notify_admins_new_booking(app: dict):
    """Sends immediate notification to all studio admins with inline confirm/cancel buttons."""
    if not bot:
        logger.warning("Bot is not running; skipping admin notification.")
        return

    admin_ids = get_admin_ids()
    if not admin_ids:
        logger.warning("No admin_ids specified in beauty_config.json or .env.")
        return

    client_uname = f"@{app['client_username']}" if app.get("client_username") else "без @username"
    removal_str = "Да (+30 мин)" if app.get("needs_removal") else "Нет"
    allergy_str = "Да (особое внимание!)" if app.get("has_allergy") else "Нет"
    comment_str = app.get("comment") or "—"

    text = (
        f"✨ <b>НОВАЯ ЗАПИСЬ НА ПРОЦЕДУРУ!</b>\n\n"
        f"👤 <b>Клиент:</b> {app['client_name']} ({client_uname})\n"
        f"📞 <b>Телефон:</b> <code>{app['client_phone']}</code>\n"
        f"💅 <b>Услуга:</b> {app['service_title']}\n"
        f"💰 <b>Стоимость:</b> {app['service_price']} ₽ ({app['duration_minutes']} мин)\n"
        f"🗓 <b>Дата и время:</b> <b>{app['date']} в {app['time']}</b>\n"
        f"✂️ <b>Снятие:</b> {removal_str}\n"
        f"⚠️ <b>Аллергия / нюансы:</b> {allergy_str}\n"
        f"💬 <b>Комментарий:</b> {comment_str}"
    )

    kb_buttons = [
        [
            InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"adm_confirm:{app['id']}"),
            InlineKeyboardButton(text="❌ Отклонить", callback_data=f"adm_cancel:{app['id']}")
        ]
    ]

    # Add direct chat button
    if app.get("client_username"):
        kb_buttons.append([
            InlineKeyboardButton(text="💬 Написать клиенту в TG", url=f"https://t.me/{app['client_username']}")
        ])
    elif app.get("client_id"):
        kb_buttons.append([
            InlineKeyboardButton(text="💬 Открыть профиль клиента", url=f"tg://user?id={app['client_id']}")
        ])

    kb = InlineKeyboardMarkup(inline_keyboard=kb_buttons)

    for admin_id in admin_ids:
        try:
            await bot.send_message(
                chat_id=admin_id,
                text=text,
                parse_mode="HTML",
                reply_markup=kb
            )
        except Exception as e:
            logger.error(f"Failed to send admin notification to {admin_id}: {e}")


async def notify_admins_client_cancelled(app: dict):
    """Notifies admins when a client cancels an appointment."""
    if not bot:
        return
    admin_ids = get_admin_ids()
    uname = f"@{app['client_username']}" if app.get("client_username") else "без @username"

    text = (
        f"⚠️ <b>КЛИЕНТ ОТМЕНИЛ ЗАПИСЬ</b>\n\n"
        f"👤 <b>Клиент:</b> {app['client_name']} ({uname})\n"
        f"📞 <b>Телефон:</b> {app['client_phone']}\n"
        f"💅 <b>Услуга:</b> {app['service_title']}\n"
        f"🗓 <b>Дата и время:</b> {app['date']} в {app['time']}\n\n"
        f"<i>Слот снова свободен для онлайн-записи.</i>"
    )

    for admin_id in admin_ids:
        try:
            await bot.send_message(chat_id=admin_id, text=text, parse_mode="HTML")
        except Exception as e:
            logger.error(f"Failed to notify admin {admin_id} of cancellation: {e}")


# ------------------- BACKGROUND REMINDERS TASK -------------------

async def run_reminders_loop():
    """Background loop that checks and sends 24-hour and 2-hour reminders."""
    logger.info("Started background reminders scheduler.")
    while True:
        try:
            if bot:
                config = db.get_config()
                address = config.get("address", "")
                studio = config.get("studio_name", "Студия")

                # 1. 24h reminders
                due_24h = await db.get_due_reminders(24)
                for app in due_24h:
                    if app.get("client_id"):
                        try:
                            msg = (
                                f"✨ <b>Напоминание о записи на завтра!</b>\n\n"
                                f"Ждём вас завтра <b>{app['date']} в {app['time']}</b>\n"
                                f"💅 Процедура: <b>{app['service_title']}</b>\n"
                                f"📍 Адрес: {address}\n\n"
                                f"Пожалуйста, подтвердите ваш визит кнопкой ниже:"
                            )
                            kb = InlineKeyboardMarkup(inline_keyboard=[
                                [InlineKeyboardButton(text="✅ Подтверждаю визит", callback_data=f"cli_confirm:{app['id']}")],
                                [InlineKeyboardButton(text="❌ Не смогу прийти", callback_data=f"cli_cancel:{app['id']}")]
                            ])
                            await bot.send_message(chat_id=app["client_id"], text=msg, parse_mode="HTML", reply_markup=kb)
                            await db.mark_reminder_sent(app["id"], 24)
                        except Exception as e:
                            logger.error(f"Failed 24h reminder to {app['client_id']}: {e}")

                # 2. 2h reminders
                due_2h = await db.get_due_reminders(2)
                for app in due_2h:
                    if app.get("client_id"):
                        try:
                            msg = (
                                f"⏰ <b>До вашего визита осталось 2 часа!</b>\n\n"
                                f"Ждём вас сегодня в <b>{app['time']}</b> в {studio}!\n"
                                f"💅 Процедура: {app['service_title']}\n"
                                f"📍 Адрес: {address}\n\n"
                                f"До скорой встречи! 💖"
                            )
                            await bot.send_message(chat_id=app["client_id"], text=msg, parse_mode="HTML")
                            await db.mark_reminder_sent(app["id"], 2)
                        except Exception as e:
                            logger.error(f"Failed 2h reminder to {app['client_id']}: {e}")

        except Exception as e:
            logger.error(f"Error in reminders loop: {e}")

        await asyncio.sleep(60)  # Check every 60 seconds
