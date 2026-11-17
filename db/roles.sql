-- Guardrail 1: the web app connects as market_sql_app, which can only SELECT the four data tables.
-- Its password is set out of band (db/set_app_password.py) and never committed.

do $$ begin
  if not exists (select from pg_roles where rolname = 'market_sql_app') then
    create role market_sql_app login noinherit;
  end if;
end $$;
alter role market_sql_app set statement_timeout = '5s';
alter role market_sql_app connection limit 20;

grant usage on schema public to market_sql_app;
grant select on tickers, prices, news, filings to market_sql_app;
-- RLS is on with no other policies, so these are the only rows-visible grants besides the owner.
create policy app_read on tickers for select to market_sql_app using (true);
create policy app_read on prices  for select to market_sql_app using (true);
create policy app_read on news    for select to market_sql_app using (true);
create policy app_read on filings for select to market_sql_app using (true);

-- Guardrail 6: every attempt is logged, but the app role can only append through a
-- SECURITY DEFINER function; it has no privileges on the table itself.
create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.query_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  question   text not null,
  sql        text,
  guardrail  text,          -- which guardrail fired last, null if none
  outcome    text not null, -- ok | blocked | failed | error | rate_limited
  attempts   int not null default 1,
  row_count  int,
  latency_ms int not null,
  model      text,
  detail     jsonb          -- every attempt: {sql, guardrail, error}
);

create or replace function private.log_query(
  p_question text, p_sql text, p_guardrail text, p_outcome text, p_attempts int,
  p_row_count int, p_latency_ms int, p_model text, p_detail jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into private.query_log (question, sql, guardrail, outcome, attempts, row_count, latency_ms, model, detail)
  values (left(p_question, 1000), left(p_sql, 10000), p_guardrail, p_outcome, p_attempts, p_row_count, p_latency_ms, p_model, p_detail);
$$;
revoke all on function private.log_query from public;
grant usage on schema private to market_sql_app;
grant execute on function private.log_query to market_sql_app;
