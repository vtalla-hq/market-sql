"""Give market_sql_app a fresh random password and write APP_DATABASE_URL to .env.
Run from the repo root after db/roles.sql: python db/set_app_password.py
The password only ever lives in .env (and in Vercel's env settings once deployed)."""
import os
import re
import secrets
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg
from psycopg import sql

ROLE = "market_sql_app"
env_text = open(".env", encoding="utf-8").read()
owner_url = re.search(r"^DATABASE_URL=(.+)$", env_text, re.M).group(1).strip().strip('"')

password = secrets.token_urlsafe(32)
with psycopg.connect(owner_url, autocommit=True) as conn:
    conn.execute(sql.SQL("alter role {} password {}").format(sql.Identifier(ROLE), sql.Literal(password)))

# Supabase's pooler wants "<role>.<project-ref>" as the user name.
u = urlsplit(owner_url)
project_ref = u.username.split(".", 1)[1] if "." in u.username else ""
user = f"{ROLE}.{project_ref}" if project_ref else ROLE
app_url = urlunsplit(u._replace(netloc=f"{user}:{quote(password, safe='')}@{u.hostname}:{u.port}"))

line = f"APP_DATABASE_URL={app_url}"
env_text = re.sub(r"^APP_DATABASE_URL=.*$", line, env_text, flags=re.M) if "APP_DATABASE_URL=" in env_text else env_text.rstrip("\n") + "\n" + line + "\n"
open(".env", "w", encoding="utf-8").write(env_text)
print(f"password set for {ROLE}; APP_DATABASE_URL written to .env")
