"""SEC filings from the data.sec.gov submissions API (the EDGAR Atom feeds live under /cgi-bin, which sec.gov's
robots.txt disallows). SEC fair-access rules: real name/email in User-Agent, max 10 requests/second."""
import json
import os
from datetime import date, timedelta

from scrapling.fetchers import FetcherSession
from scrapling.spiders import Request, Spider

from common import connect, finish, known_symbols, log, upsert, valid_date, valid_symbol, valid_url

FORMS = {"8-K", "10-Q", "10-K", "4"}
CUTOFF = date.today() - timedelta(days=5 * 365 + 2)
COLS = ["symbol", "filed_at", "form_type", "url"]
# SEC's ticker map points at the current registrant only; history from before a holding-company reorg
# stays under the old CIK. Exxon reorganized into ExxonMobil Holdings (CIK 2115436) in mid-2026.
PREDECESSOR_CIKS = {"XOM": [34088]}


class FilingsSpider(Spider):
    name = "filings"
    robots_txt_obey = True
    autothrottle_enabled = True
    concurrent_requests = 4
    # Each request sleeps >= download_delay while holding one of 2 per-domain slots: ceiling 2 / 0.25s = 8 req/s.
    download_delay = 0.25
    concurrent_requests_per_domain = 2

    def __init__(self, symbols, **kw):
        self.symbols = symbols
        super().__init__(**kw)

    def configure_sessions(self, manager):
        ua = os.environ["EDGAR_USER_AGENT"]  # "Name email@domain", required by SEC
        manager.add("default", FetcherSession(impersonate=None, stealthy_headers=False, headers={"User-Agent": ua}))

    async def start_requests(self):
        yield Request("https://www.sec.gov/files/company_tickers.json", sid="default", callback=self.parse_ciks)

    async def parse_ciks(self, response):
        by_ticker = {v["ticker"]: v["cik_str"] for v in json.loads(response.body).values()}
        for s in self.symbols:
            cik = by_ticker.get(s.replace(".", "-"))
            if cik is None:
                log.warning("filings: no CIK for %s", s)
                continue
            for c in [cik, *PREDECESSOR_CIKS.get(s, [])]:
                yield Request(f"https://data.sec.gov/submissions/CIK{c:010d}.json", sid="default",
                              meta={"symbol": s, "cik": c})

    async def parse(self, response):
        data = json.loads(response.body)
        # The top-level doc nests the newest ~1000 filings under filings.recent; older pages are flat.
        recent = data["filings"]["recent"] if "filings" in data else data
        sym, cik = response.meta["symbol"], response.meta["cik"]
        for form, filed, acc, doc in zip(recent["form"], recent["filingDate"], recent["accessionNumber"], recent["primaryDocument"]):
            if form in FORMS and filed >= CUTOFF.isoformat():
                yield {"symbol": sym, "filed": filed, "form": form,
                       "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{doc}"}
        # Busy filers (e.g. banks issuing notes) push 5y of history past the "recent" window into extra pages.
        for f in data.get("filings", {}).get("files", []):
            if f["filingTo"] >= CUTOFF.isoformat():
                yield Request(f"https://data.sec.gov/submissions/{f['name']}", sid="default", meta=response.meta)


def to_rows(items, known):
    rows, invalid = [], 0
    for it in items:
        try:
            d = date.fromisoformat(it["filed"])
        except (TypeError, ValueError):
            d = None
        if not (valid_symbol(it["symbol"], known) and d and valid_date(d) and it["form"] in FORMS and valid_url(it["url"])):
            invalid += 1
            continue
        rows.append((it["symbol"], d, it["form"], it["url"]))
    return rows, invalid


if __name__ == "__main__":
    with connect() as conn:
        known = known_symbols(conn)
        result = FilingsSpider(sorted(known)).start()
        log.info("filings: crawl stats %s", result.stats)
        rows, invalid = to_rows(list(result.items), known)
        ins, _ = upsert(conn, "filings", COLS, rows, "url", update=False)
    finish("filings", len(result.items), invalid, ins)
