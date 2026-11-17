"""Daily OHLCV from yfinance. First run backfills 5y; later runs refetch the last month (catches revisions)."""
import math

import yfinance as yf

from common import connect, finish, known_symbols, upsert, valid_date

COLS = ["symbol", "date", "open", "high", "low", "close", "volume"]


def fetch(symbols: list[str], period: str) -> tuple[list[tuple], int]:
    yahoo = {s.replace(".", "-"): s for s in symbols}  # Yahoo spells BRK.B as BRK-B
    df = yf.download(list(yahoo), period=period, interval="1d", group_by="ticker",
                     auto_adjust=True, progress=False, threads=True)
    rows, invalid = [], 0
    for ysym, sym in yahoo.items():
        if ysym not in df.columns.get_level_values(0):
            continue
        for ts, r in df[ysym].iterrows():
            vals = (r["Open"], r["High"], r["Low"], r["Close"], r["Volume"])
            if any(v is None or math.isnan(v) for v in vals):
                continue  # non-trading padding rows from the multi-ticker frame, not bad data
            d = ts.date()
            o, h, l, c, v = vals
            if not valid_date(d) or min(o, h, l, c) <= 0 or v < 0 or h < l:
                invalid += 1
                continue
            rows.append((sym, d, round(float(o), 4), round(float(h), 4), round(float(l), 4),
                         round(float(c), 4), int(v)))
    return rows, invalid


if __name__ == "__main__":
    with connect() as conn:
        symbols = sorted(known_symbols(conn))
        empty = conn.execute("select not exists (select 1 from prices)").fetchone()[0]
        rows, invalid = fetch(symbols, "5y" if empty else "1mo")
        ins, upd = upsert(conn, "prices", COLS, rows, "symbol, date", update=True)
    finish("prices", len(rows) + invalid, invalid, ins, upd)
