import asyncio
import logging
import traceback as tb_module
from typing import Any

_log_queue: asyncio.Queue | None = None


def _get_queue() -> asyncio.Queue:
    global _log_queue
    if _log_queue is None:
        _log_queue = asyncio.Queue(maxsize=2000)
    return _log_queue


class DBLogHandler(logging.Handler):
    """Puts WARNING+ log records into an async queue for background DB writing."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry: dict[str, Any] = {
                "level": record.levelname,
                "logger_name": record.name,
                "message": self.format(record),
                "module": record.module,
                "traceback": None,
                "extra": {},
            }
            if record.exc_info and record.exc_info[0] is not None:
                entry["traceback"] = "".join(tb_module.format_exception(*record.exc_info))
            # Attach any extra fields set via logger.warning("msg", extra={...})
            for key in vars(record):
                if key not in logging.LogRecord.__dict__ and not key.startswith("_"):
                    entry["extra"][key] = getattr(record, key)
            try:
                _get_queue().put_nowait(entry)
            except asyncio.QueueFull:
                pass
        except Exception:
            self.handleError(record)


async def log_queue_consumer() -> None:
    """Background coroutine started at app startup that drains the log queue into DB."""
    from app.core.database import AsyncSessionLocal
    from app.models.app_log import AppLog

    queue = _get_queue()
    while True:
        entry = await queue.get()
        try:
            async with AsyncSessionLocal() as db:
                db.add(AppLog(
                    level=entry["level"],
                    logger_name=entry.get("logger_name"),
                    message=entry["message"],
                    module=entry.get("module"),
                    request_path=entry.get("request_path"),
                    request_method=entry.get("request_method"),
                    status_code=entry.get("status_code"),
                    user_id=entry.get("user_id"),
                    tenant_id=entry.get("tenant_id"),
                    traceback=entry.get("traceback"),
                    extra=entry.get("extra") or None,
                ))
                await db.commit()
        except Exception:
            pass
        finally:
            queue.task_done()


def setup_logging() -> None:
    """Configure root logger: JSON stdout + DB handler for WARNING+."""
    try:
        from pythonjsonlogger import jsonlogger
        json_fmt: logging.Formatter = jsonlogger.JsonFormatter(
            "%(asctime)s %(name)s %(levelname)s %(message)s"
        )
    except ImportError:
        json_fmt = logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s")

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    # Avoid duplicate handlers on hot-reload
    if not any(isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler)
               for h in root.handlers):
        stdout_handler = logging.StreamHandler()
        stdout_handler.setFormatter(json_fmt)
        root.addHandler(stdout_handler)

    if not any(isinstance(h, DBLogHandler) for h in root.handlers):
        db_handler = DBLogHandler()
        db_handler.setLevel(logging.WARNING)
        db_handler.setFormatter(logging.Formatter("%(message)s"))
        root.addHandler(db_handler)

    # Silence noisy libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)


async def log_http_error(
    *,
    request_path: str,
    request_method: str,
    status_code: int,
    message: str,
    user_id: int | None = None,
    tenant_id: int | None = None,
    traceback: str | None = None,
) -> None:
    """Directly enqueue an HTTP error log (called from middleware or exception handler)."""
    try:
        level = "ERROR" if status_code >= 500 else "WARNING"
        _get_queue().put_nowait({
            "level": level,
            "logger_name": "http",
            "message": message,
            "module": "middleware",
            "request_path": request_path,
            "request_method": request_method,
            "status_code": status_code,
            "user_id": user_id,
            "tenant_id": tenant_id,
            "traceback": traceback,
            "extra": {},
        })
    except asyncio.QueueFull:
        pass
