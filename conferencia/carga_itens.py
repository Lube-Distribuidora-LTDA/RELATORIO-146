"""
Primeira carga (e reconciliacao) dos itens dos pedidos do Relatorio 146 em relatorio146.item.

O dia a dia e do AGENTE LUBE (fluxo relatorio146.item, 15 dias de 30 em 30 s). Este script faz
a carga dos 62 dias de uma vez, por COPY (o agente grava a diferenca em JSON, bom para poucas
linhas, pesado para 190 mil): a primeira carga e, quando preciso, reconciliar os dias que o
agente nao rele (16 a 62). Le o WinThor com o MESMO SQL do agente, numa janela de 62 dias
(fluxos\\relatorio146.toml, o fluxo item_62d desligado), e grava so a diferenca, numa transacao so.

Sem --gravar, so mostra o que faria.

Uso:
  python -X utf8 carga_itens.py
  python -X utf8 carga_itens.py --gravar
"""
import argparse
import csv
import io
import os
import sys
import time
import tomllib
from datetime import date, datetime, timedelta
from decimal import Decimal

import oracledb
import psycopg2
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
TOML = r"C:\Users\gti.julio.alves\Desktop\BI\22. AGENTE LUBE\2 - AGENTE\fluxos\relatorio146.toml"
load_dotenv(ENV)
oracledb.defaults.fetch_decimals = True

TEXTO = {"bonific", "posicao"}
INTEIRO = {"numped", "numseq", "codprod"}


def fluxo():
    with open(TOML, "rb") as f:
        cat = tomllib.load(f)
    return next(x for x in cat["fluxo"] if x["nome"] == "relatorio146.item_62d")


def limpar(v, col):
    """Igual ao agente: texto sem espaco nas pontas, vazio = nulo; data sem hora."""
    if v is None:
        return None
    if col in TEXTO:
        v = str(v).strip()
        return v or None
    if col == "data":
        return v.date() if hasattr(v, "date") else v
    if col in INTEIRO:
        return int(v)
    return v


def canon(v):
    if v is None:
        return None
    if isinstance(v, Decimal):
        return format(v.normalize(), "f")
    return str(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gravar", action="store_true")
    a = ap.parse_args()

    f = fluxo()
    cols = f["colunas"]
    dia = date.today() - timedelta(days=f["janela_dias"])
    desde = datetime(dia.year, dia.month, dia.day)

    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    ora = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    ora.module = "CARGA 146"
    ora.call_timeout = 120_000
    cur = ora.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.arraysize = 5000
    t = time.perf_counter()
    cur.execute(f["sql"], desde=desde)
    nomes = [d[0].lower() for d in cur.description]
    idx = [nomes.index(c) for c in cols]
    win = {}
    for r in cur:
        row = tuple(limpar(r[i], c) for i, c in zip(idx, cols))
        win[(row[0], row[1])] = row
    ora.rollback()
    ora.close()
    print(f"WinThor: {len(win):,} itens desde {desde:%d/%m/%Y} em {time.perf_counter() - t:.1f} s")

    pg = psycopg2.connect(host=os.environ["SUPABASE_DB_HOST"].strip(), port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
                          dbname=os.environ.get("SUPABASE_DB_NAME", "postgres").strip(), user=os.environ["SUPABASE_DB_USER"].strip(),
                          password=os.environ["SUPABASE_DB_PASSWORD"].strip(), application_name="carga-itens-146",
                          connect_timeout=20, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=3)
    with pg.cursor() as c:
        c.execute("SET statement_timeout = '10min'")
        c.execute(f"SELECT {', '.join(cols)} FROM relatorio146.item WHERE data >= %s", (desde.date(),))
        banco = {(r[0], r[1]): r for r in c.fetchall()}
    pg.commit()

    def linha(r):
        return tuple(canon(v) for v in r)

    novas = [r for k, r in win.items() if k not in banco]
    trocar = [r for k, r in win.items() if k in banco and linha(r) != linha(banco[k])]
    apagar = [k for k in banco if k not in win]
    print(f"Banco: {len(banco):,} na janela -> novas {len(novas):,}, alteradas {len(trocar):,}, sairiam {len(apagar):,}")
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
        c.execute("CREATE TEMP TABLE carga (LIKE relatorio146.item INCLUDING DEFAULTS) ON COMMIT DROP")
        c.copy_expert(f"COPY carga ({', '.join(cols)}) FROM STDIN WITH (FORMAT csv, NULL '\\N')", buf)
        sets = ", ".join(f"{x} = EXCLUDED.{x}" for x in cols if x not in ("numped", "numseq"))
        c.execute(f"INSERT INTO relatorio146.item ({', '.join(cols)}) SELECT {', '.join(cols)} FROM carga "
                  f"ON CONFLICT (numped, numseq) DO UPDATE SET {sets}, atualizado_em = now()")
        gravadas = c.rowcount
        apagadas = 0
        if apagar:
            c.execute("""DELETE FROM relatorio146.item d USING unnest(%s::bigint[], %s::int[]) k(numped, numseq)
                          WHERE d.numped = k.numped AND d.numseq = k.numseq""",
                      ([k[0] for k in apagar], [k[1] for k in apagar]))
            apagadas = c.rowcount
    pg.commit()
    pg.close()
    print(f"Gravado: {gravadas:,} inseridos/trocados e {apagadas:,} apagados em {time.perf_counter() - t:.1f} s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
