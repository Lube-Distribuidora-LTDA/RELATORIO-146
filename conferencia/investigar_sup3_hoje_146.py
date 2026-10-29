"""
SO LEITURA. Supervisor 3: os pedidos de hoje (29/10/2026) com hora, para separar o que entrou depois do
print da 146; e os pedidos de outras filiais (fora de 1, 7, 10, 11, 12) de todos os supervisores em
outubro, para saber se a filial 4 (ou outra) so aparece na operacao interna.

Uso: python -X utf8 investigar_sup3_hoje_146.py
"""
import os
import sys
from datetime import date

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)
VENDA = """CASE WHEN c.condvenda IN (5,6,11,12) THEN 0 ELSE c.vlatend - NVL(c.vloutrasdesp,0) - NVL(c.vlfrete,0)
             - NVL((SELECT SUM(NVL(i.st,0) * i.qt) FROM pcpedi i WHERE i.numped = c.numped AND NVL(i.bonific,'N') = 'N'),0) END"""
CMV = """(SELECT SUM(NVL(i.vlcustofin,0) * i.qt) - SUM(NVL(i.st,0) * i.qt) FROM pcpedi i WHERE i.numped = c.numped)"""
FILTRO = """c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL
            AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))"""


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 300_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.execute(f"""SELECT c.numped, c.codfilial, c.hora, c.minuto, c.posicao, c.codusur, ROUND({VENDA}, 2), ROUND({CMV}, 2), NVL(c.totpeso,0),
                           (SELECT COUNT(*) FROM pcpedi i WHERE i.numped = c.numped)
                      FROM pcpedc c WHERE c.codsupervisor = 3 AND c.data = DATE '2026-10-29' AND {FILTRO}
                     ORDER BY c.hora, c.minuto""")
    print("Supervisor 3, pedidos de 29/10 (numped, filial, hora, min, pos, rca, venda, cmv, peso, linhas):")
    for r in cur.fetchall():
        print("  ", r)
    cur.execute(f"""SELECT c.codfilial, c.codsupervisor, COUNT(*), ROUND(SUM({VENDA}), 2), ROUND(SUM(NVL({CMV},0)), 2)
                      FROM pcpedc c WHERE c.data BETWEEN DATE '2026-10-01' AND DATE '2026-10-29'
                       AND c.codfilial NOT IN ('1','7','10','11','12') AND {FILTRO}
                     GROUP BY c.codfilial, c.codsupervisor ORDER BY 1, 2""")
    print("\nOutubro, filiais fora de 1, 7, 10, 11, 12 (filial, supervisor, pedidos, venda, cmv):")
    for r in cur.fetchall():
        print("  ", r)
    cur.execute(f"""SELECT c.codfilial, COUNT(*), ROUND(SUM({VENDA}), 2)
                      FROM pcpedc c WHERE c.data >= DATE '2025-01-01'
                       AND c.codfilial NOT IN ('1','7','10','11','12') AND {FILTRO}
                     GROUP BY c.codfilial ORDER BY 1""")
    print("\nDesde 2025, filiais fora de 1, 7, 10, 11, 12 (filial, pedidos, venda):")
    for r in cur.fetchall():
        print("  ", r)
    cur.execute("""SELECT c.numped, c.data, c.codcli, c.condvenda, c.vlatend, c.vlcustofin, c.vltabela,
                          (SELECT COUNT(*) FROM pcpedi i WHERE i.numped = c.numped),
                          (SELECT SUM(i.qt * NVL(i.vlcustofin,0)) FROM pcpedi i WHERE i.numped = c.numped)
                     FROM pcpedc c WHERE c.codfilial = '4' AND c.data BETWEEN DATE '2026-10-01' AND DATE '2026-10-29' AND c.dtcancel IS NULL""")
    print("\nFilial 4 em outubro (numped, data, cliente, cond, vlatend, vlcustofin cab, vltabela, linhas, custo itens):")
    for r in cur.fetchall():
        print("  ", r)
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
