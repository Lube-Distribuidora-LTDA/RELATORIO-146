"""
Carga de um fluxo do Relatorio 146 com uma janela maior que a do agente (o historico das metas e
dos emitentes desde 2025, por exemplo). Le o WinThor com o MESMO SQL do fluxo
(Desktop\\BI\\22. AGENTE LUBE\\2 - AGENTE\\fluxos\\relatorio146.toml), trocando so o :desde, e grava
por COPY + upsert pela chave do fluxo. Nao apaga nada.

Sem --gravar, so mostra o que faria.

Uso:
  python -X utf8 carga_fluxo.py --fluxo relatorio146.meta_rca --desde 2025-01-01
  python -X utf8 carga_fluxo.py --fluxo relatorio146.meta_rca --desde 2025-01-01 --gravar
"""
import argparse
import csv
import io
import os
import sys
import time
import tomllib
from datetime import date, datetime
from decimal import Decimal

import oracledb
import psycopg2
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
TOML = r"C:\Users\gti.julio.alves\Desktop\BI\22. AGENTE LUBE\2 - AGENTE\fluxos\relatorio146.toml"
load_dotenv(ENV)
oracledb.defaults.fetch_decimals = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fluxo", required=True)
    ap.add_argument("--desde", required=True)
    ap.add_argument("--gravar", action="store_true")
    a = ap.parse_args()
    with open(TOML, "rb") as f:
        fl = next(x for x in tomllib.load(f)["fluxo"] if x["nome"] == a.fluxo)
    cols, chave, destino = fl["colunas"], fl["chave"], fl["destino"]
    d = date.fromisoformat(a.desde)

    pg = psycopg2.connect(host=os.environ["SUPABASE_DB_HOST"].strip(), port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
                          dbname=os.environ.get("SUPABASE_DB_NAME", "postgres").strip(), user=os.environ["SUPABASE_DB_USER"].strip(),
                          password=os.environ["SUPABASE_DB_PASSWORD"].strip(), application_name="carga-fluxo-146", connect_timeout=20)
    esquema, tabela = destino.split(".")
    with pg.cursor() as c:
        c.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = %s AND table_name = %s",
                  (esquema, tabela))
        tipos = dict(c.fetchall())
    pg.commit()

    def limpar(v, col):
        t = tipos[col]
        if v is None:
            return None
        if t == "text":
            v = str(v).strip()
            return v or None
        if t == "date":
            return v.date() if hasattr(v, "date") else v
        if t in ("integer", "bigint", "smallint"):
            return int(v)
        return v

    ora = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"],
                           dsn=oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                                                service_name=os.environ["ORACLE_SERVICE_NAME"].strip()))
    ora.module = "CARGA 146"
    ora.call_timeout = 300_000
    cur = ora.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.arraysize = 5000
    t = time.perf_counter()
    cur.execute(fl["sql"], {"desde": datetime(d.year, d.month, d.day)} if ":desde" in fl["sql"] else {})
    nomes = [x[0].lower() for x in cur.description]
    idx = [nomes.index(c) for c in cols]
    linhas = [tuple(limpar(r[i], c) for i, c in zip(idx, cols)) for r in cur]
    ora.rollback()
    ora.close()
    print(f"WinThor: {len(linhas):,} linhas de {a.fluxo} desde {d:%d/%m/%Y} em {time.perf_counter() - t:.1f} s")
    if not a.gravar:
        print("Ensaio: nada gravado (use --gravar).")
        return 0
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for r in linhas:
        w.writerow(["\\N" if v is None else (format(v, "f") if isinstance(v, Decimal) else v) for v in r])
    buf.seek(0)
    t = time.perf_counter()
    with pg.cursor() as c:
        c.execute("SET statement_timeout = '10min'")
        c.execute(f"CREATE TEMP TABLE carga (LIKE {destino} INCLUDING DEFAULTS) ON COMMIT DROP")
        c.copy_expert(f"COPY carga ({', '.join(cols)}) FROM STDIN WITH (FORMAT csv, NULL '\\N')", buf)
        resto = [x for x in cols if x not in chave]
        acao = "DO UPDATE SET " + ", ".join(f"{x} = EXCLUDED.{x}" for x in resto) if resto else "DO NOTHING"
        c.execute(f"INSERT INTO {destino} ({', '.join(cols)}) SELECT {', '.join(cols)} FROM carga ON CONFLICT ({', '.join(chave)}) {acao}")
        n = c.rowcount
    pg.commit()
    pg.close()
    print(f"Gravado: {n:,} linhas em {time.perf_counter() - t:.1f} s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
