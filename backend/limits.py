"""Atomic quotas shared by workers using one persistent SQLite database."""
from contextlib import contextmanager
from decimal import Decimal
import hashlib
import hmac
import sqlite3
import time
import uuid
from fastapi import HTTPException
from .config import Settings


class Limits:
    def __init__(self, settings: Settings):
        self.settings = settings
        settings.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL, expires INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, owner TEXT NOT NULL, turns INTEGER NOT NULL, expires INTEGER NOT NULL, busy_until INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.settings.database_path, timeout=5, isolation_level=None)
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                yield db
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise

    def ip_key(self, address: str) -> str:
        day = int(time.time()) // 86400
        return hmac.new(self.settings.session_secret.encode(), f"{day}:{address}".encode(), hashlib.sha256).hexdigest()[:32]

    @staticmethod
    def increment(db, key: str, limit: int, expires: int, amount=1):
        row = db.execute("SELECT value FROM counters WHERE key=?", (key,)).fetchone()
        if (row[0] if row else 0) + amount > limit:
            raise HTTPException(429, "This visitor or the site has reached its limit. Please try again after the limit resets.", headers={"Retry-After": str(max(1, expires - int(time.time())))})
        db.execute("INSERT INTO counters VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=value+excluded.value", (key, amount, expires))

    def rate(self, ip: str):
        now = int(time.time())
        with self.transaction() as db:
            for table in ("counters", "activities", "requests"):
                db.execute(f"DELETE FROM {table} WHERE expires < ?", (now,))
            self.increment(db, f"minute:{ip}:{now//60}", self.settings.requests_per_minute, (now//60+1)*60)

    def mint_session(self, ip: str):
        now = int(time.time())
        with self.transaction() as db:
            self.increment(db, f"sessions:{ip}:{now//86400}", self.settings.sessions_per_ip_per_day, (now//86400+1)*86400)

    def remaining(self, owner: str, ip: str):
        day = int(time.time()) // 86400
        with self.connection() as db:
            counts = [db.execute("SELECT value FROM counters WHERE key=?", (f"activities:{key}:{day}",)).fetchone() for key in (owner, ip)]
        return max(0, self.settings.activities_per_day - max((r[0] if r else 0) for r in counts))

    def reserve(self, owner: str, ip: str, request_id: str, activity_id: str | None, kind="analysis", paid=False):
        now = int(time.time())
        day = now // 86400
        expiry = (day+1)*86400
        with self.transaction() as db:
            if db.execute("SELECT 1 FROM requests WHERE id=?", (request_id,)).fetchone():
                raise HTTPException(409, "This request was already received. Please wait for the result.")
            if kind == "analysis":
                if activity_id:
                    row = db.execute("SELECT owner, turns, busy_until FROM activities WHERE id=? AND expires>?", (activity_id, now)).fetchone()
                    if not row or row[0] != owner:
                        raise HTTPException(404, "This activity has expired. Start a new map.")
                    if row[2] > now:
                        raise HTTPException(409, "This activity is still being mapped.")
                    if row[1] >= self.settings.turns_per_activity:
                        raise HTTPException(429, "This activity has reached its follow-up limit. You can save your map.")
                    db.execute("UPDATE activities SET turns=turns+1, busy_until=? WHERE id=?", (now+180, activity_id))
                else:
                    for key in (owner, ip):
                        self.increment(db, f"activities:{key}:{day}", self.settings.activities_per_day, expiry)
                    activity_id = str(uuid.uuid4())
                    db.execute("INSERT INTO activities VALUES (?, ?, 1, ?, ?)", (activity_id, owner, expiry, now+180))
            else:
                for key in (owner, ip):
                    self.increment(db, f"audio:{key}:{day}", self.settings.activities_per_day, expiry)
            if paid:
                reservation = self.settings.analysis_reservation_usd if kind == "analysis" else self.settings.transcription_reservation_usd
                self.increment(db, f"budget:{day}", int(self.settings.daily_budget_usd * Decimal(1_000_000)), expiry, int(reservation * Decimal(1_000_000)))
            db.execute("INSERT INTO requests VALUES (?, ?)", (request_id, expiry))
        return activity_id

    def release(self, activity_id: str):
        with self.connection() as db:
            db.execute("UPDATE activities SET busy_until=0 WHERE id=?", (activity_id,))

    def turns(self, activity_id: str):
        with self.connection() as db:
            row = db.execute("SELECT turns FROM activities WHERE id=?", (activity_id,)).fetchone()
        return row[0] if row else self.settings.turns_per_activity
