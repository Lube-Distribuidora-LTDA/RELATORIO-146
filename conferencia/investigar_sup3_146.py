"""
SO LEITURA. Supervisor 3 (LUBE DISTRIBUIDORA, a operacao interna): no print da 146 de 2026-10-29 o lucro
era bem maior que o nosso (referencias-winthor-146.json). Abre os pedidos do supervisor 3 de 01 a
29/10/2026 por filial, posicao, condicao, cliente-que-e-filial e origem, para achar o recorte que
reproduz o WinThor.

Uso: python -X utf8 investigar_sup3_146.py
"""
import json
import os
import sys
from datetime import date

import oracledb
from dotenv import load_dotenv

AQUI = os.path.dirname(os.path.abspath(__file__))
ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)

SQL = """
WITH p AS (
  SELECT c.numped, c.codfilial, c.posicao, c.condvenda, c.codcli, c.codusur, c.origemped, c.dtcancel,
         CASE WHEN EXISTS (SELECT 1 FROM pcfilial f WHERE f.codcli = c.codcli) THEN 'S' ELSE 'N' END AS cli_filial,
         CASE WHEN c.condvenda IN (5,6,11,12) THEN 0
              ELSE c.vlatend - NVL(c.vloutrasdesp,0) - NVL(c.vlfrete,0) - NVL(it.st_vendido,0) END AS venda,
         it.custo - NVL(it.st_total,0) AS cmv,
         CASE WHEN c.condvenda IN (5,6,11,12) THEN 0 ELSE NVL(c.vltabela,0) - NVL(c.vloutrasdesp,0) - NVL(c.vlfrete,0) - NVL(it.st_vendido,0) END AS tabela,
         NVL(c.totpeso,0) AS peso, it.linhas
    FROM pcpedc c
    OUTER APPLY (SELECT SUM(CASE WHEN NVL(i.bonific,'N') = 'N' THEN NVL(i.st,0) * i.qt END) AS st_vendido,
                        SUM(NVL(i.st,0) * i.qt) AS st_total, SUM(NVL(i.vlcustofin,0) * i.qt) AS custo, COUNT(*) AS linhas
                   FROM pcpedi i WHERE i.numped = c.numped) it
   WHERE c.data BETWEEN :de AND :ate AND c.codsupervisor = 3
     AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))
)
SELECT codfilial, posicao, CASE WHEN dtcancel IS NULL THEN 'ativo' ELSE 'cancelado' END AS canc, condvenda, cli_filial, origemped,
       COUNT(*) AS pedidos, COUNT(DISTINCT codcli) AS cli, ROUND(SUM(venda), 2) AS venda, ROUND(SUM(cmv), 2) AS cmv,
       ROUND(SUM(tabela), 2) AS tabela, ROUND(SUM(peso), 3) AS peso, SUM(linhas) AS linhas
  FROM p GROUP BY codfilial, posicao, CASE WHEN dtcancel IS NULL THEN 'ativo' ELSE 'cancelado' END, condvenda, cli_filial, origemped
 ORDER BY 1, 2, 3, 4, 5, 6"""


def main():
    ref = json.load(open(os.path.join(AQUI, "referencias-winthor-146.json"), encoding="utf-8"))
    cols = ref["colunas_sup"]
    w = dict(zip(cols, next(l for l in ref["supervisores"] if l[0] == 3)))
    print(f"WinThor (print): pedidos {w['pedidos']} cli {w['cli_pos']} venda {w['venda']:,.2f} cmv {w['cmv']:,.2f} "
          f"tabela {w['tabela']:,.2f} peso {w['peso']:,.3f} itens {w['qt_itens']}")
    de, ate = (date.fromisoformat(x) for x in ref["periodo"])
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 300_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.execute(SQL, de=de, ate=ate)
    print("filial pos canc cond cli_filial origem | pedidos cli venda cmv tabela peso linhas")
    for r in cur.fetchall():
        print("  ", r)
    cur.execute("SELECT codigo, codcli, razaosocial FROM pcfilial ORDER BY codigo")
    print("\nPCFILIAL (codigo, codcli):", [(r[0], r[1]) for r in cur.fetchall()])
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
