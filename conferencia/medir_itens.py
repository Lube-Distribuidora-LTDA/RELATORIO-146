"""
SO LEITURA. Quantos itens (PCPEDI) têm os pedidos do Relatório 146, por janela, e quanto o
WinThor leva para devolvê-los — para decidir o que guardar no DATA WAREHOUSE.

Uso: python -X utf8 medir_itens.py
"""
import os
import sys
import time

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)

FILTRO = """c.data >= :desde AND c.codfilial IN ('1','11','10','7','12') AND c.posicao IN ('L','M','B','P','F','C')
   AND c.dtcancel IS NULL AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))"""


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 120_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.execute("SELECT DISTINCT column_name FROM all_tab_columns WHERE table_name = 'PCPEDI' ORDER BY 1")
    cols = [r[0] for r in cur.fetchall()]
    print("PCPEDI tem", len(cols), "colunas; algumas:", [c for c in cols if c in (
        "NUMSEQ", "CODPROD", "QT", "QTORIG", "PVENDA", "PTABELA", "PERDESC", "ST", "VLCUSTOFIN", "BONIFIC", "POSICAO", "DATA", "CODAUXILIAR")])
    for dias in (1, 7, 35, 60):
        cur.execute("SELECT TRUNC(SYSDATE) - :d FROM dual", d=dias)
        desde = cur.fetchone()[0]
        t = time.perf_counter()
        cur.execute(f"""SELECT COUNT(DISTINCT c.numped), COUNT(*) FROM pcpedc c, pcpedi i
                         WHERE i.numped = c.numped AND {FILTRO}""", desde=desde)
        p, n = cur.fetchone()
        print(f"janela {dias:>3} dias: {p:>7,} pedidos, {n:>9,} itens ({n / max(p, 1):.1f} por pedido) em {time.perf_counter() - t:.2f} s")
    t = time.perf_counter()
    cur.execute(f"""SELECT COUNT(DISTINCT c.numped), COUNT(*) FROM pcpedc c, pcpedi i
                     WHERE i.numped = c.numped AND {FILTRO}""", desde=__import__("datetime").date(2025, 1, 1))
    p, n = cur.fetchone()
    print(f"desde 01/01/2025: {p:,} pedidos, {n:,} itens ({n / max(p, 1):.1f} por pedido) em {time.perf_counter() - t:.2f} s")
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
