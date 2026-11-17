"""Headlines from general business RSS feeds (CNBC, MarketWatch, PR Newswire) via Scrapling's XMLFeedSpider,
kept only when the headline names one of our companies. Per-symbol feeds were ruled out: Yahoo and Google News
disallow crawling in robots.txt, and Nasdaq rejects non-browser User-Agents."""
import os
import re
from email.utils import parsedate_to_datetime

from scrapling.fetchers import FetcherSession
from scrapling.spiders import Request, XMLFeedSpider

from common import connect, finish, known_symbols, log, upsert, valid_date, valid_symbol, valid_url

CNBC = "https://www.cnbc.com/id/{}/device/rss/rss.html"
MW = "https://feeds.content.dowjones.io/public/rss/{}"
FEEDS = {
    **{CNBC.format(i): "CNBC" for i in (
        100003114,  # top news
        10001147,   # business
        15839135,   # earnings
        19854910,   # technology
        10000664,   # finance
        19836768,   # energy
        10000108,   # health care
        15839069,   # investing
        20910258,   # economy
    )},
    **{MW.format(f): "MarketWatch" for f in ("mw_topstories", "mw_marketpulse", "mw_bulletins", "mw_realtimeheadlines")},
    "https://www.prnewswire.com/rss/news-releases-list.rss": "PR Newswire",
}

# Case-sensitive on purpose: "Apple"/"Meta"/"Visa" the company vs "apple"/"meta"/"visa" the word.
# shortcut: name matching misses headlines that only use a CEO or product name; upgrade to an NER pass if recall matters.
ALIASES = {
    "AAPL": ["Apple", "iPhone"], "MSFT": ["Microsoft"], "NVDA": ["Nvidia", "NVIDIA"], "AMD": ["AMD"],
    "INTC": ["Intel"], "ORCL": ["Oracle"], "CRM": ["Salesforce"], "GOOGL": ["Alphabet", "Google"],
    "META": ["Meta", "Facebook", "Instagram"], "NFLX": ["Netflix"], "DIS": ["Disney"], "VZ": ["Verizon"],
    "AMZN": ["Amazon"], "TSLA": ["Tesla"], "HD": ["Home Depot"], "MCD": ["McDonald's", "McDonald’s"],
    "NKE": ["Nike"], "SBUX": ["Starbucks"], "WMT": ["Walmart"], "COST": ["Costco"],
    "PG": ["Procter & Gamble", "P&G"], "KO": ["Coca-Cola", "Coke"], "PEP": ["PepsiCo", "Pepsi"],
    "JPM": ["JPMorgan", "JP Morgan", "Chase"], "BAC": ["Bank of America", "BofA"], "GS": ["Goldman Sachs", "Goldman"],
    "V": ["Visa"], "MA": ["Mastercard"], "BRK.B": ["Berkshire Hathaway", "Berkshire"],
    "JNJ": ["Johnson & Johnson", "J&J"], "PFE": ["Pfizer"], "LLY": ["Eli Lilly", "Lilly"],
    "UNH": ["UnitedHealth"], "ABT": ["Abbott"], "XOM": ["Exxon", "ExxonMobil"], "CVX": ["Chevron"],
    "COP": ["ConocoPhillips"], "SLB": ["SLB", "Schlumberger"], "BA": ["Boeing"], "CAT": ["Caterpillar"],
    "GE": ["GE Aerospace", "General Electric"], "UPS": ["UPS"], "HON": ["Honeywell"], "LIN": ["Linde"],
    "FCX": ["Freeport-McMoRan", "Freeport"], "NEE": ["NextEra"], "DUK": ["Duke Energy"], "SO": ["Southern Company", "Southern Co"],
    "PLD": ["Prologis"], "AMT": ["American Tower"],
}
PATTERNS = [(s, re.compile(r"(?<![\w&])(" + "|".join(map(re.escape, names)) + r")(?![\w&])")) for s, names in ALIASES.items()]
COLS = ["symbol", "published_at", "headline", "source", "url"]


def match_symbol(headline: str):
    """First company named in the headline, or None. Also accepts '(NYSE: XOM)'-style ticker tags."""
    best = None
    for sym, pat in PATTERNS:
        m = pat.search(headline)
        if m and (best is None or m.start() < best[1]):
            best = (sym, m.start())
    if best:
        return best[0]
    tag = re.search(r"\((?:NYSE|NASDAQ|Nasdaq):\s*([A-Z.]{1,6})\)", headline)
    return tag.group(1) if tag and tag.group(1) in ALIASES else None


class NewsSpider(XMLFeedSpider):
    name = "news"
    itertag = "item"
    start_urls = list(FEEDS)
    robots_txt_obey = True
    autothrottle_enabled = True
    concurrent_requests = 2
    concurrent_requests_per_domain = 1

    def configure_sessions(self, manager):
        # Identify honestly instead of impersonating a browser.
        ua = os.environ.get("SCRAPER_USER_AGENT", "market-sql/0.1 (+https://github.com/vtalla-hq/market-sql)")
        manager.add("default", FetcherSession(impersonate=None, stealthy_headers=False, headers={"User-Agent": ua}))

    async def parse_node(self, response, node):
        yield {
            "feed": str(response.url),
            "title": " ".join((node.findtext("title") or "").split()),
            "link": (node.findtext("link") or "").strip(),
            "pub": node.findtext("pubDate"),
        }


def to_rows(items, known):
    """Returns (rows, invalid). Items that name none of our companies are skipped, not invalid."""
    rows, invalid, seen_urls = [], 0, set()
    for it in items:
        try:
            ts = parsedate_to_datetime(it["pub"])
        except (TypeError, ValueError):
            ts = None
        if not (it["title"] and valid_url(it["link"]) and ts and ts.tzinfo and valid_date(ts)):
            invalid += 1
            continue
        sym = match_symbol(it["title"])
        if not valid_symbol(sym, known) or it["link"] in seen_urls:
            continue
        seen_urls.add(it["link"])
        rows.append((sym, ts, it["title"][:1000], FEEDS.get(it["feed"]), it["link"]))
    return rows, invalid


if __name__ == "__main__":
    # Self-check for the matcher (cheap, runs every time).
    assert match_symbol("Apple beats estimates as iPhone sales jump") == "AAPL"
    assert match_symbol("Investors eye apple harvest") is None
    assert match_symbol("Visa and Mastercard settle fee case") == "V"
    assert match_symbol("Acme Corp (NYSE: XOM) partners") == "XOM"
    assert match_symbol("AT&T and T-Mobile slash prices") is None
    with connect() as conn:
        known = known_symbols(conn)
        result = NewsSpider().start()
        log.info("news: crawl stats %s", result.stats)
        rows, invalid = to_rows(list(result.items), known)
        log.info("news: %d of %d feed items name a tracked company", len(rows), len(result.items) - invalid)
        ins, _ = upsert(conn, "news", COLS, rows, "url", update=False)
    finish("news", len(result.items), invalid, ins)
