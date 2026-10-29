"""
SO LEITURA. O que existe no WinThor para as abas da 146 que dependem de cadastro: classe do cliente,
area de atuacao, origem da venda, check out, regiao, cobranca, emitente e plano de pagamento.
Pedidos do 146 de 01 a 29/10/2026.

Uso: python -X utf8 investigar_abas_146.py
"""
import os
import sys
from datetime import date

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)
DE, ATE = date(2026, 10, 1), date(2026, 10, 29)
PED = """FROM pcpedc c JOIN pcclient cl ON cl.codcli = c.codcli JOIN pcusuari u ON u.codusur = c.codusur
         WHERE c.data BETWEEN :de AND :ate AND c.codfilial IN ('1','11','10','7','12')
           AND c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL
           AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))"""


def mostrar(cur, titulo, sql, **b):
    try:
        cur.execute(sql, b)
        linhas = cur.fetchall()
        print(f"\n{titulo} ({len(linhas)}):")
        for r in linhas[:15]:
            print("  ", r)
    except oracledb.Error as e:
        print(f"\n{titulo}: ERRO {str(e).strip()[:160]}")


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 300_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    for t in ("PCAREAATUACAO", "PCREGIAO", "PCCOB", "PCEMPR", "PCATIVI", "PCPRACA"):
        cur.execute("SELECT column_name FROM all_tab_columns WHERE table_name = :t ORDER BY column_id", t=t)
        print(f"{t}:", [r[0] for r in cur.fetchall()][:14])
    cur.execute("SELECT column_name FROM all_tab_columns WHERE table_name = 'PCPEDC' AND (column_name LIKE '%CHECK%' OR column_name LIKE '%CAIXA%' OR column_name LIKE '%ORIGEM%')")
    print("PCPEDC check out/caixa/origem:", [r[0] for r in cur.fetchall()])
    for col in ("CLASSEVENDA", "CLASSECOMERCIAL", "CLASSEMC"):
        mostrar(cur, f"cliente {col}", f"SELECT cl.{col}, COUNT(*), ROUND(SUM(c.vlatend)) {PED} GROUP BY cl.{col} ORDER BY 2 DESC", de=DE, ate=ATE)
    mostrar(cur, "RCA AREAATUACAO", f"SELECT u.areaatuacao, COUNT(*) {PED} GROUP BY u.areaatuacao ORDER BY 2 DESC", de=DE, ate=ATE)
    mostrar(cur, "PCAREAATUACAO", "SELECT * FROM pcareaatuacao WHERE ROWNUM <= 10")
    mostrar(cur, "ORIGEMPED", f"SELECT c.origemped, COUNT(*), ROUND(SUM(c.vlatend)) {PED} GROUP BY c.origemped ORDER BY 2 DESC", de=DE, ate=ATE)
    mostrar(cur, "NUMREGIAO", f"SELECT c.numregiao, COUNT(*) {PED} GROUP BY c.numregiao ORDER BY 2 DESC", de=DE, ate=ATE)
    mostrar(cur, "CODCOB", f"SELECT c.codcob, COUNT(*) {PED} GROUP BY c.codcob ORDER BY 2 DESC", de=DE, ate=ATE)
    mostrar(cur, "CODEMITENTE", f"SELECT c.codemitente, COUNT(*) {PED} GROUP BY c.codemitente ORDER BY 2 DESC", de=DE, ate=ATE)
    mostrar(cur, "CODPLPAG", f"SELECT c.codplpag, COUNT(*) {PED} GROUP BY c.codplpag ORDER BY 2 DESC", de=DE, ate=ATE)
    mostrar(cur, "Clientes cadastrados (total WinThor 62016)",
            "SELECT COUNT(*), COUNT(CASE WHEN dtcadastro <= :ate THEN 1 END), COUNT(CASE WHEN dtexclusao IS NULL THEN 1 END),"
            " COUNT(CASE WHEN dtexclusao IS NULL AND (dtcadastro IS NULL OR dtcadastro <= :ate) THEN 1 END),"
            " COUNT(CASE WHEN dtcadastro IS NULL THEN 1 END) FROM pcclient", ate=ATE)
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
