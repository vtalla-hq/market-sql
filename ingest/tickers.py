"""Seed the tickers table. Hardcoded on purpose: the universe is fixed and GICS labels rarely change."""
from common import connect, finish, upsert, valid_symbol

TICKERS = [
    # symbol, name, sector, industry
    ("AAPL", "Apple Inc.", "Information Technology", "Technology Hardware, Storage & Peripherals"),
    ("MSFT", "Microsoft Corporation", "Information Technology", "Systems Software"),
    ("NVDA", "NVIDIA Corporation", "Information Technology", "Semiconductors"),
    ("AMD", "Advanced Micro Devices, Inc.", "Information Technology", "Semiconductors"),
    ("INTC", "Intel Corporation", "Information Technology", "Semiconductors"),
    ("ORCL", "Oracle Corporation", "Information Technology", "Application Software"),
    ("CRM", "Salesforce, Inc.", "Information Technology", "Application Software"),
    ("GOOGL", "Alphabet Inc.", "Communication Services", "Interactive Media & Services"),
    ("META", "Meta Platforms, Inc.", "Communication Services", "Interactive Media & Services"),
    ("NFLX", "Netflix, Inc.", "Communication Services", "Movies & Entertainment"),
    ("DIS", "The Walt Disney Company", "Communication Services", "Movies & Entertainment"),
    ("VZ", "Verizon Communications Inc.", "Communication Services", "Integrated Telecommunication Services"),
    ("AMZN", "Amazon.com, Inc.", "Consumer Discretionary", "Broadline Retail"),
    ("TSLA", "Tesla, Inc.", "Consumer Discretionary", "Automobile Manufacturers"),
    ("HD", "The Home Depot, Inc.", "Consumer Discretionary", "Home Improvement Retail"),
    ("MCD", "McDonald's Corporation", "Consumer Discretionary", "Restaurants"),
    ("NKE", "NIKE, Inc.", "Consumer Discretionary", "Apparel, Accessories & Luxury Goods"),
    ("SBUX", "Starbucks Corporation", "Consumer Discretionary", "Restaurants"),
    ("WMT", "Walmart Inc.", "Consumer Staples", "Consumer Staples Merchandise Retail"),
    ("COST", "Costco Wholesale Corporation", "Consumer Staples", "Consumer Staples Merchandise Retail"),
    ("PG", "The Procter & Gamble Company", "Consumer Staples", "Household Products"),
    ("KO", "The Coca-Cola Company", "Consumer Staples", "Soft Drinks & Non-alcoholic Beverages"),
    ("PEP", "PepsiCo, Inc.", "Consumer Staples", "Soft Drinks & Non-alcoholic Beverages"),
    ("JPM", "JPMorgan Chase & Co.", "Financials", "Diversified Banks"),
    ("BAC", "Bank of America Corporation", "Financials", "Diversified Banks"),
    ("GS", "The Goldman Sachs Group, Inc.", "Financials", "Investment Banking & Brokerage"),
    ("V", "Visa Inc.", "Financials", "Transaction & Payment Processing Services"),
    ("MA", "Mastercard Incorporated", "Financials", "Transaction & Payment Processing Services"),
    ("BRK.B", "Berkshire Hathaway Inc.", "Financials", "Multi-Sector Holdings"),
    ("JNJ", "Johnson & Johnson", "Health Care", "Pharmaceuticals"),
    ("PFE", "Pfizer Inc.", "Health Care", "Pharmaceuticals"),
    ("LLY", "Eli Lilly and Company", "Health Care", "Pharmaceuticals"),
    ("UNH", "UnitedHealth Group Incorporated", "Health Care", "Managed Health Care"),
    ("ABT", "Abbott Laboratories", "Health Care", "Health Care Equipment"),
    ("XOM", "Exxon Mobil Corporation", "Energy", "Integrated Oil & Gas"),
    ("CVX", "Chevron Corporation", "Energy", "Integrated Oil & Gas"),
    ("COP", "ConocoPhillips", "Energy", "Oil & Gas Exploration & Production"),
    ("SLB", "SLB N.V.", "Energy", "Oil & Gas Equipment & Services"),
    ("BA", "The Boeing Company", "Industrials", "Aerospace & Defense"),
    ("CAT", "Caterpillar Inc.", "Industrials", "Construction Machinery & Heavy Transportation Equipment"),
    ("GE", "GE Aerospace", "Industrials", "Aerospace & Defense"),
    ("UPS", "United Parcel Service, Inc.", "Industrials", "Air Freight & Logistics"),
    ("HON", "Honeywell International Inc.", "Industrials", "Industrial Conglomerates"),
    ("LIN", "Linde plc", "Materials", "Industrial Gases"),
    ("FCX", "Freeport-McMoRan Inc.", "Materials", "Copper"),
    ("NEE", "NextEra Energy, Inc.", "Utilities", "Multi-Utilities"),
    ("DUK", "Duke Energy Corporation", "Utilities", "Electric Utilities"),
    ("SO", "The Southern Company", "Utilities", "Electric Utilities"),
    ("PLD", "Prologis, Inc.", "Real Estate", "Industrial REITs"),
    ("AMT", "American Tower Corporation", "Real Estate", "Telecom Tower REITs"),
]

if __name__ == "__main__":
    rows = [t for t in TICKERS if valid_symbol(t[0]) and all(t[1:])]
    with connect() as conn:
        ins, upd = upsert(conn, "tickers", ["symbol", "name", "sector", "industry"], rows, "symbol", update=True)
    finish("tickers", len(TICKERS), len(TICKERS) - len(rows), ins, upd)
