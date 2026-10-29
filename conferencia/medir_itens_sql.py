"""
SO LEITURA. Roda o SQL dos itens (fluxos relatorio146.item e item_62d do agente) como o agente
roda, para medir o tempo de leitura e conferir a chave (NUMPED, NUMSEQ) antes de publicar.

Uso: python -X utf8 medir_itens_sql.py
"""
import os
import sys
import time
import tomllib
from collections import Counter
from datetime import date, datetime, timedelta

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
TOML = r"C:\Users\gti.julio.alves\Desktop\BI\22. AGENTE LUBE\2 - AGENTE\fluxos\relatorio146.toml"
load_dotenv(ENV)


def main():
    with open(TOML, "rb") as f:
        fluxos = {x["nome"]: x for x in tomllib.load(f)["fluxo"]}
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 120_000
    for nome in ("relatorio146.item", "relatorio146.item_62d"):
        fl = fluxos[nome]
        dia = date.today() - timedelta(days=fl["janela_dias"])
        desde = datetime(dia.year, dia.month, dia.day)
        cur = conn.cursor()
        cur.execute("SET TRANSACTION READ ONLY")
        cur.arraysize = 5000
        t = time.perf_counter()
        cur.execute(fl["sql"], desde=desde)
        nomes = [d[0].lower() for d in cur.description]
        linhas = cur.fetchall()
        seg = time.perf_counter() - t
        conn.rollback()
        faltam = [c for c in fl["colunas"] if c not in nomes]
        ik = [nomes.index("numped"), nomes.index("numseq")]
        chaves = Counter(tuple(r[i] for i in ik) for r in linhas)
        repetidas = [k for k, q in chaves.items() if q > 1]
        nulas = sum(1 for k in chaves if None in k)
        pedidos = len({r[ik[0]] for r in linhas})
        print(f"{nome}: desde {desde:%d/%m/%Y}, {len(linhas):,} itens de {pedidos:,} pedidos em {seg:.2f} s; "
              f"colunas faltando {faltam or 'nenhuma'}; chave repetida {len(repetidas)}; chave nula {nulas}")
        if repetidas:
            print("   exemplos:", repetidas[:5])
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
