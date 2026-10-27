"""
Carga (e reconciliacao) do historico de pedidos do Relatorio 146 em relatorio146.pedido.

O dia a dia e do AGENTE LUBE (ontem e hoje de 30 em 30 s, 60 dias de 10 em 10 min). Este
script cobre o que as janelas do agente nao alcancam: a primeira carga (desde 01/01/2025) e,
quando preciso, conferir de novo um periodo antigo. Le o WinThor com o MESMO SQL do agente
(Desktop\\BI\\22. AGENTE LUBE\\2 - AGENTE\\fluxos\\relatorio146.toml), mes a mes, numa transacao
so de leitura; grava so a diferenca (insere o que falta, troca o que mudou, apaga do periodo o
que nao existe mais no WinThor), numa transacao so.

Sem --gravar, so mostra o que faria.

Uso:
  python -X utf8 carga_historico.py                         (ensaio, 01/01/2025 a hoje)
  python -X utf8 carga_historico.py --gravar
  python -X utf8 carga_historico.py --desde 2025-01-01 --ate 2025-12-31 --gravar
"""
import argparse
import csv
import io
import os
import sys
import time
import tomllib
from datetime import date, timedelta
from decimal import Decimal

import oracledb
import psycopg2
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
TOML = r"C:\Users\gti.julio.alves\Desktop\BI\22. AGENTE LUBE\2 - AGENTE\fluxos\relatorio146.toml"
load_dotenv(ENV)
oracledb.defaults.fetch_decimals = True

TEXTO = {"codfilial", "uf", "supervisor", "rca", "posicao"}


def fluxo():
    with open(TOML, "rb") as f:
        cat = tomllib.load(f)
    return next(x for x in cat["fluxo"] if x["nome"] == "relatorio146.pedido_60d")


def limpar(v, col):
    """Igual ao agente: texto sem espaco nas pontas, vazio = nulo; data sem hora."""
    if v is None:
        return None
    if col in TEXTO:
        v = str(v).strip()
        return v or None
    if col == "data":
        return v.date() if hasattr(v, "date") else v
    if isinstance(v, Decimal) and v == v.to_integral_value() and col not in ("venda", "custo_liq", "qtitens"):
        return int(v)
    return v


def canon(v):
    if v is None:
        return None
    if isinstance(v, Decimal):
        v = v.normalize()
        return format(v, "f")
    return str(v)


def meses(desde, ate):
    d = date(desde.year, desde.month, 1)
    while d <= ate:
        prox = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        yield max(d, desde), min(prox - timedelta(days=1), ate)
        d = prox


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", default="2025-01-01")
    ap.add_argument("--ate", default=None)
    ap.add_argument("--gravar", action="store_true")
    a = ap.parse_args()
    desde = date.fromisoformat(a.desde)
    ate = date.fromisoformat(a.ate) if a.ate else date.today()

    f = fluxo()
    cols = f["colunas"]
    sql = f"SELECT * FROM ({f['sql']}) x WHERE x.data <= :ate"

    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    ora = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    ora.module = "CARGA 146"
    ora.call_timeout = 120_000
    cur = ora.cursor()
    cur.execute("SET TRANSACTION READ ONLY")

    t0 = time.perf_counter()
    win = {}
    for ini, fim in meses(desde, ate):
        t = time.perf_counter()
        cur.execute(sql, desde=ini, ate=fim)
        n = 0
        for r in cur:
            row = tuple(limpar(v, c) for v, c in zip(r, cols))
            win[row[0]] = row
            n += 1
        print(f"  WinThor {ini:%m/%Y}: {n:>6,} pedidos em {time.perf_counter() - t:4.1f} s", flush=True)
    ora.rollback()
    ora.close()
    print(f"WinThor: {len(win):,} pedidos de {desde:%d/%m/%Y} a {ate:%d/%m/%Y} em {time.perf_counter() - t0:.1f} s")

    pg = psycopg2.connect(host=os.environ["SUPABASE_DB_HOST"].strip(), port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
                          dbname=os.environ.get("SUPABASE_DB_NAME", "postgres").strip(), user=os.environ["SUPABASE_DB_USER"].strip(),
                          password=os.environ["SUPABASE_DB_PASSWORD"].strip(), application_name="carga-historico-146",
                          connect_timeout=20, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=3)
    with pg.cursor() as c:
        c.execute("SET statement_timeout = '10min'")
        c.execute(f"SELECT {', '.join(cols)} FROM relatorio146.pedido WHERE data BETWEEN %s AND %s", (desde, ate))
        banco = {r[0]: r for r in c.fetchall()}
    pg.commit()

    def chave_canon(r):
        return tuple(canon(v) for v in r)

    novas = [r for k, r in win.items() if k not in banco]
    trocar = [r for k, r in win.items() if k in banco and chave_canon(r) != chave_canon(banco[k])]
    apagar = [k for k in banco if k not in win]
    print(f"Banco: {len(banco):,} no periodo -> novas {len(novas):,}, alteradas {len(trocar):,}, sairiam {len(apagar):,}")
    for r in trocar[:5]:
        b = banco[r[0]]
        print("   exemplo alterado:", r[0], {c: (canon(x), canon(y)) for c, x, y in zip(cols, b, r) if canon(x) != canon(y)})

    if banco and len(apagar) > len(banco) * 0.5 and len(apagar) >= 20:
        print("Mais da metade sairia do banco de uma vez: nao gravo nada (queda brusca).")
        return 2
    if not a.gravar:
        print("Ensaio: nada gravado (use --gravar).")
        return 0
    if not (novas or trocar or apagar):
        print("Nada a gravar.")
        return 0

    t = time.perf_counter()
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for r in novas + trocar:
        w.writerow(["\\N" if v is None else (format(v, "f") if isinstance(v, Decimal) else v) for v in r])
    buf.seek(0)
    with pg.cursor() as c:
        c.execute("SET statement_timeout = '10min'")
        c.execute("CREATE TEMP TABLE carga (LIKE relatorio146.pedido INCLUDING DEFAULTS) ON COMMIT DROP")
        c.copy_expert(f"COPY carga ({', '.join(cols)}) FROM STDIN WITH (FORMAT csv, NULL '\\N')", buf)
        sets = ", ".join(f"{x} = EXCLUDED.{x}" for x in cols if x != "numped")
        c.execute(f"INSERT INTO relatorio146.pedido ({', '.join(cols)}) SELECT {', '.join(cols)} FROM carga "
                  f"ON CONFLICT (numped) DO UPDATE SET {sets}, atualizado_em = now()")
        gravadas = c.rowcount
        apagadas = 0
        if apagar:
            c.execute("DELETE FROM relatorio146.pedido WHERE numped = ANY(%s) AND data BETWEEN %s AND %s", (apagar, desde, ate))
            apagadas = c.rowcount
    pg.commit()
    pg.close()
    print(f"Gravado: {gravadas:,} inseridos/trocados e {apagadas:,} apagados em {time.perf_counter() - t:.1f} s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
