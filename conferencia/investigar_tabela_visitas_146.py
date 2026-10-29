"""
SO LEITURA. Ultimas colunas da 146: Vl.tabela (pelo cabecalho da PCPEDC?), visitas (cliente x dia com
pedido?) e clientes cadastrados sem os excluidos. 01 a 29/10/2026.

Uso: python -X utf8 investigar_tabela_visitas_146.py
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
WITH ped AS (
  SELECT c.numped, c.data, c.codusur, c.codsupervisor, c.codcli, c.condvenda, c.vltabela,
         NVL(c.vloutrasdesp,0) AS desp, NVL(c.vlfrete,0) AS frete
    FROM pcpedc c
    JOIN pcplpag pl ON pl.codplpag = c.codplpag
    JOIN pcusuari u ON u.codusur = c.codusur
    JOIN pcclient cl ON cl.codcli = c.codcli
    JOIN pccidade cid ON cid.codcidade = cl.codcidade
   WHERE c.data BETWEEN :de AND :ate
     AND c.codfilial IN ('1','11','10','7','12') AND c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL
     AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))
), p AS (
  SELECT ped.*, it.tab_item, it.st_total, it.st_vendido, it.tab_bruta
    FROM ped OUTER APPLY (
      SELECT SUM(CASE WHEN NVL(i.bonific,'N') = 'N' THEN (NVL(i.ptabela,0) - NVL(i.st,0)) * i.qt END) AS tab_item,
             SUM(NVL(i.ptabela,0) * i.qt) AS tab_bruta,
             SUM(NVL(i.st,0) * i.qt) AS st_total,
             SUM(CASE WHEN NVL(i.bonific,'N') = 'N' THEN NVL(i.st,0) * i.qt END) AS st_vendido
        FROM pcpedi i WHERE i.numped = ped.numped) it
)
SELECT {chave} AS k,
       SUM(CASE WHEN condvenda IN (5,6,11,12) THEN 0 ELSE tab_item END) AS tab_item,
       SUM(CASE WHEN condvenda IN (5,6,11,12) THEN 0 ELSE vltabela - desp - frete - NVL(st_vendido,0) END) AS tab_cab,
       SUM(CASE WHEN condvenda IN (5,6,11,12) THEN 0 ELSE vltabela - desp - NVL(st_vendido,0) END) AS tab_cab_frete,
       SUM(CASE WHEN condvenda IN (5,6,11,12) THEN 0 ELSE vltabela - NVL(st_vendido,0) END) AS tab_cab_sem_desc,
       COUNT(DISTINCT codcli || '-' || TO_CHAR(data, 'YYYYMMDD')) AS cli_dia,
       COUNT(DISTINCT CASE WHEN condvenda NOT IN (5,6,11,12) THEN codcli || '-' || TO_CHAR(data, 'YYYYMMDD') END) AS cli_dia_venda
  FROM p GROUP BY {chave}"""


def main():
    ref = json.load(open(os.path.join(AQUI, "referencias-winthor-146.json"), encoding="utf-8"))
    de, ate = (date.fromisoformat(x) for x in ref["periodo"])
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 300_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")

    cur.execute(SQL.format(chave="codsupervisor"), de=de, ate=ate)
    got = {r[0]: r for r in cur.fetchall()}
    cols = ref["colunas_sup"]
    print("Vl.tabela por supervisor: WinThor | itens | cab - desp - frete - ST | cab - desp - ST | cab - ST")
    for linha in ref["supervisores"]:
        w = dict(zip(cols, linha))
        g = got.get(w["cod"])
        print(f"  {w['cod']:>3} {w['tabela']:>14,.2f} | " + " | ".join(f"{float(x or 0):>14,.2f}" for x in g[1:5]))

    cur.execute(SQL.format(chave="codusur") .replace("FROM p GROUP", "FROM p WHERE codsupervisor = 7 GROUP"), de=de, ate=ate)
    got = {r[0]: r for r in cur.fetchall()}
    cols = ref["colunas_rca"]
    print("\nVisitas por RCA (sup 7): WinThor | cliente x dia | cliente x dia sem bonificacao ; tabela WinThor | itens | cab")
    for linha in ref["rcas_sup7"]:
        w = dict(zip(cols, linha))
        g = got.get(w["cod"])
        print(f"  {w['cod']:>5} {w['visitas']:>4} | {g[5]:>4} | {g[6]:>4}    {w['tabela']:>12,.2f} | {float(g[1] or 0):>12,.2f} | {float(g[2] or 0):>12,.2f}")

    cur.execute("""SELECT u.codusur,
                          (SELECT COUNT(*) FROM pcclient c WHERE (c.codusur1 = u.codusur OR c.codusur2 = u.codusur) AND c.dtexclusao IS NULL),
                          (SELECT COUNT(*) FROM pcclient c WHERE (c.codusur1 = u.codusur OR c.codusur2 = u.codusur)
                                                             AND (c.dtcadastro IS NULL OR c.dtcadastro <= :ate))
                     FROM pcusuari u WHERE u.codusur IN (795, 946, 11, 664, 935, 1267, 1255, 1270, 1209, 584) ORDER BY 1""", ate=ate)
    print("\nClientes cad. (RCA 1 ou 2): sem excluidos | cadastrados ate o fim do periodo — WinThor 1255=87, 1267=114, 664=143, 584=1444")
    for r in cur.fetchall():
        print("  ", r)
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
