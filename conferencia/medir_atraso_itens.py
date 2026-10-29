"""
SO LEITURA. Quanto tempo depois da data do pedido os itens ainda mudam: faturamento (quando o
corte acontece) e cancelamento, nos pedidos do Relatorio 146 dos ultimos 62 dias. Decide a janela
do fluxo relatorio146.item do agente.

Uso: python -X utf8 medir_atraso_itens.py
"""
import os
import sys

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)

SQL = """
SELECT CASE WHEN d <= 1 THEN '0 a 1' WHEN d <= 3 THEN '2 a 3' WHEN d <= 7 THEN '4 a 7' WHEN d <= 14 THEN '8 a 14'
            WHEN d <= 32 THEN '15 a 32' ELSE 'mais de 32' END AS faixa,
       COUNT(*) AS pedidos, SUM(cortado) AS com_corte
  FROM (SELECT TRUNC(NVL({campo}, c.data)) - TRUNC(c.data) AS d,
               (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END FROM pcpedi i
                 WHERE i.numped = c.numped AND NVL(i.qtorig, i.qt) > i.qt) AS cortado
          FROM pcpedc c
         WHERE c.data >= TRUNC(SYSDATE) - 62 AND c.codfilial IN ('1','11','10','7','12')
           AND {filtro})
 GROUP BY CASE WHEN d <= 1 THEN '0 a 1' WHEN d <= 3 THEN '2 a 3' WHEN d <= 7 THEN '4 a 7' WHEN d <= 14 THEN '8 a 14'
               WHEN d <= 32 THEN '15 a 32' ELSE 'mais de 32' END
 ORDER BY MIN(d)"""


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 120_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    for nome, campo, filtro in (("Faturamento (DTFAT - DATA)", "c.dtfat", "c.posicao = 'F' AND c.dtcancel IS NULL"),
                                ("Cancelamento (DTCANCEL - DATA)", "c.dtcancel", "c.dtcancel IS NOT NULL")):
        cur.execute(SQL.format(campo=campo, filtro=filtro))
        print(nome)
        for faixa, n, corte in cur.fetchall():
            print(f"   {faixa:>11} dias: {n:>6,} pedidos, {corte or 0:>5,} com item cortado")
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
