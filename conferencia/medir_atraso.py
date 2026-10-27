"""
SO LEITURA. Quanto tempo depois da data do pedido ele ainda muda (faturado ou cancelado)?
Define a janela larga do agente: pedido mais velho que ela, se mudar, so entra na
reconciliacao. Olha os pedidos faturados ou cancelados nos ultimos 60 dias, das filiais do 146.

Uso: python -X utf8 medir_atraso.py
"""
import os
import sys
import time

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)

SQL = """
SELECT CASE WHEN dias <= 2 THEN '0-2' WHEN dias <= 7 THEN '3-7' WHEN dias <= 30 THEN '8-30'
            WHEN dias <= 60 THEN '31-60' WHEN dias <= 90 THEN '61-90' WHEN dias <= 180 THEN '91-180' ELSE '181+' END faixa,
       evento, COUNT(*) n, MAX(dias) maior
  FROM (
    SELECT 'faturado' evento, TRUNC(c.dtfat) - c.data dias FROM pcpedc c
     WHERE c.dtfat >= TRUNC(SYSDATE) - 60 AND c.codfilial IN ('1','11','10','7','12') AND c.data >= DATE '2025-01-01'
    UNION ALL
    SELECT 'cancelado', TRUNC(c.dtcancel) - c.data FROM pcpedc c
     WHERE c.dtcancel >= TRUNC(SYSDATE) - 60 AND c.codfilial IN ('1','11','10','7','12') AND c.data >= DATE '2025-01-01'
  )
 GROUP BY CASE WHEN dias <= 2 THEN '0-2' WHEN dias <= 7 THEN '3-7' WHEN dias <= 30 THEN '8-30'
            WHEN dias <= 60 THEN '31-60' WHEN dias <= 90 THEN '61-90' WHEN dias <= 180 THEN '91-180' ELSE '181+' END, evento
 ORDER BY evento, MIN(dias)
"""


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 120_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    t = time.perf_counter()
    cur.execute(SQL)
    for r in cur.fetchall():
        print(f"{r[1]:<10} {r[0]:>7} dias: {r[2]:>6} pedidos (maior atraso {r[3]})")
    print(f"({time.perf_counter() - t:.1f} s)")
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
