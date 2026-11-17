"""Shared DB + validation helpers for the ingest jobs."""
import logging
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

import psycopg

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ingest")

SYMBOL_RE = re.compile(r"^[A-Z]{1,5}(\.[A-Z])?$")
MIN_DATE = date(2000, 1, 1)


def connect():
    return psycopg.connect(os.environ["DATABASE_URL"])


def known_symbols(conn) -> set[str]:
    return {r[0] for r in conn.execute("select symbol from tickers")}


def valid_symbol(s, known=None) -> bool:
    return isinstance(s, str) and bool(SYMBOL_RE.match(s)) and (known is None or s in known)


def valid_date(d) -> bool:
    if isinstance(d, datetime):
        d = d.astimezone(timezone.utc).date() if d.tzinfo else d.date()
    # +1 day slack: a UTC timestamp can be "tomorrow" relative to the runner's date
    return isinstance(d, date) and MIN_DATE <= d <= date.today() + timedelta(days=1)


def valid_url(u) -> bool:
    return isinstance(u, str) and u.startswith("https://") and len(u) < 2000


def upsert(conn, table: str, cols: list[str], rows: list[tuple], conflict: str, update: bool) -> tuple[int, int]:
    """Insert rows; on conflict update (update=True) or skip. Returns (inserted, updated)."""
    if not rows:
        return 0, 0
    collist = ", ".join(cols)
    ph = ", ".join(["%s"] * len(cols))
    if update:
        sets = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in conflict)
        action = f"do update set {sets}"
    else:
        action = "do nothing"
    # xmax = 0 means the row version was freshly inserted rather than updated
    sql = f"insert into {table} ({collist}) values ({ph}) on conflict ({conflict}) {action} returning (xmax = 0)"
    inserted = updated = 0
    with conn.cursor() as cur:
        cur.executemany(sql, rows, returning=True)
        while True:
            row = cur.fetchone()
            if row is not None:
                if row[0]:
                    inserted += 1
                else:
                    updated += 1
            if not cur.nextset():
                break
    conn.commit()
    return inserted, updated


def finish(job: str, seen: int, invalid: int, inserted: int, updated: int = 0):
    log.info("%s: seen=%d invalid=%d inserted=%d updated=%d", job, seen, invalid, inserted, updated)
    # Zero valid rows from the source means the source or our parser broke; zero *new* rows can be legit
    # (weekend, no new filings), so that alone doesn't fail the run.
    if seen - invalid <= 0:
        log.error("%s: source returned no valid rows, failing run", job)
        sys.exit(1)
