"""
SO LEITURA. Explica a diferenca entre o Power BI (atualizado as 08:19:52 de 27/10/2026) e o
painel novo no periodo de 01/10 a 26/10/2026: pedidos desse periodo que foram cancelados
depois das 08:19 de hoje (saem da conta) e o valor que tinham.

Os numeros do Power BI ficam em referencias-power-bi.json (so na maquina).

Uso: python -X utf8 explicar_diferenca.py
"""
import os
import sys

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)
oracledb.defaults.fetch_decimals = True

SQL = """
SELECT c.numped, TO_CHAR(c.data, 'DD/MM') data, TO_CHAR(c.dtcancel, 'DD/MM HH24:MI:SS') cancelado,
       c.posicao, c.condvenda, c.vlatend - NVL(c.vloutrasdesp,0) - NVL(c.vlfrete,0)
         - NVL((SELECT SUM(NVL(i.st,0)*NVL(i.qt,0)) FROM pcpedi i WHERE i.numped = c.numped AND NVL(i.bonific,'N') = 'N'), 0) venda
  FROM pcpedc c
 WHERE c.data BETWEEN DATE '2026-10-01' AND DATE '2026-10-26'
   AND c.codfilial IN ('1','11','10','7','12')
   AND c.dtcancel >= DATE '2026-10-27'   -- DTCANCEL guarda so o dia (sem hora)
   AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))
 ORDER BY c.dtcancel
"""


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.execute(SQL)
    tot = 0
    for r in cur.fetchall():
        print(f"pedido {r[0]} de {r[1]}, cancelado em {r[2]} (posicao {r[3]}, cond {r[4]}): venda R$ {r[5]:,.2f}")
        tot += r[5] or 0
    print(f"Total cancelado hoje (27/10): R$ {tot:,.2f}")
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
