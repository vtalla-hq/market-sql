-- market-sql schema. Column comments are fed to the LLM, so keep them precise.

create table if not exists tickers (
  symbol   text primary key,
  name     text not null,
  sector   text not null,
  industry text not null
);
comment on table tickers is 'One row per tracked company: ~50 S&P 500 stocks across all 11 GICS sectors.';
comment on column tickers.symbol is 'Stock ticker symbol, uppercase, e.g. AAPL. Join key for prices, news and filings.';
comment on column tickers.name is 'Company name, e.g. Apple Inc.';
comment on column tickers.sector is 'GICS sector, e.g. Information Technology, Health Care, Financials, Energy.';
comment on column tickers.industry is 'GICS sub-industry, e.g. Semiconductors, Diversified Banks.';

create table if not exists prices (
  symbol text not null references tickers(symbol),
  date   date not null,
  open   numeric(14,4) not null,
  high   numeric(14,4) not null,
  low    numeric(14,4) not null,
  close  numeric(14,4) not null,
  volume bigint not null,
  primary key (symbol, date)
);
comment on table prices is 'Daily OHLCV bars for each ticker, last ~5 years, trading days only (no weekends/holidays). Source: Yahoo Finance via yfinance.';
comment on column prices.symbol is 'Ticker symbol; references tickers.symbol.';
comment on column prices.date is 'Trading date (US/Eastern market day).';
comment on column prices.open is 'Opening price in USD, adjusted for splits and dividends.';
comment on column prices.high is 'Intraday high in USD, adjusted for splits and dividends.';
comment on column prices.low is 'Intraday low in USD, adjusted for splits and dividends.';
comment on column prices.close is 'Closing price in USD, adjusted for splits and dividends. Use this for returns: close / lag(close) - 1.';
comment on column prices.volume is 'Shares traded that day.';

create table if not exists news (
  id           bigint generated always as identity primary key,
  symbol       text not null references tickers(symbol),
  published_at timestamptz not null,
  headline     text not null,
  source       text,
  url          text not null unique
);
comment on table news is 'Business news headlines from CNBC, MarketWatch and PR Newswire RSS feeds, kept only when the headline names a tracked company. Sparse: history starts when ingestion began (Nov 2026), so it covers far less time than prices, and many tickers have few or no rows.';
comment on column news.id is 'Surrogate key.';
comment on column news.symbol is 'Company the headline names, matched by company name; references tickers.symbol. A headline naming several companies is stored once, under the first one named.';
comment on column news.published_at is 'Publication timestamp with time zone. Use published_at::date to compare with prices.date.';
comment on column news.headline is 'Article headline text.';
comment on column news.source is 'Feed publisher: ''CNBC'', ''MarketWatch'' or ''PR Newswire''.';
comment on column news.url is 'Link to the article; unique.';

create table if not exists filings (
  id        bigint generated always as identity primary key,
  symbol    text not null references tickers(symbol),
  filed_at  date not null,
  form_type text not null,
  url       text not null unique
);
comment on table filings is 'SEC EDGAR filings per ticker, last ~5 years, limited to forms 8-K, 10-Q, 10-K and 4. Source: data.sec.gov submissions API.';
comment on column filings.id is 'Surrogate key.';
comment on column filings.symbol is 'Ticker of the issuing company; references tickers.symbol.';
comment on column filings.filed_at is 'Date the filing was filed with the SEC. Compare directly with prices.date.';
comment on column filings.form_type is 'SEC form type, exactly one of: ''8-K'' (material event), ''10-Q'' (quarterly report), ''10-K'' (annual report), ''4'' (insider trade).';
comment on column filings.url is 'Link to the primary filing document on sec.gov; unique.';

create index if not exists news_symbol_published_idx on news (symbol, published_at);
create index if not exists filings_symbol_filed_idx on filings (symbol, filed_at);

-- Supabase exposes public tables over its REST API; RLS with no policies keeps anon/authenticated keys out.
-- Ingest connects as the table owner, which bypasses RLS.
alter table tickers enable row level security;
alter table prices  enable row level security;
alter table news    enable row level security;
alter table filings enable row level security;
