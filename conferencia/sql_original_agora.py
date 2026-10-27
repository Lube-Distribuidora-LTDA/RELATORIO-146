"""
SO LEITURA. Roda AGORA o SQL original do Power BI (Consulta4) e soma 01/10 a 26/10/2026 e o
dia 26/10, para comparar com a tela do painel novo no mesmo instante. Se bater, a diferenca
contra o Power BI das 08:19 e so o WinThor que mudou desde entao (nao a regra).

Uso: python -X utf8 sql_original_agora.py
"""
import os
import sys
from datetime import date

import oracledb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from conferir_power_bi import SQL_ORIGINAL  # noqa: E402  (carrega o ENV)


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 120_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.execute("SELECT TO_CHAR(SYSDATE, 'DD/MM/YYYY HH24:MI:SS') FROM dual")
    print("Foto do WinThor:", cur.fetchone()[0])
    cur.execute(SQL_ORIGINAL)
    cols = [d[0].lower() for d in cur.description]
    linhas = [dict(zip(cols, r)) for r in cur.fetchall()]
    for rot, de, ate in (("01/10 a 26/10", date(2026, 10, 1), date(2026, 10, 26)), ("dia 26/10", date(2026, 10, 26), date(2026, 10, 26))):
        sel = [x for x in linhas if de <= x["data"].date() <= ate]
        v = sum((x["vlvenda"] or 0) for x in sel)
        q = sum(x["qtped"] for x in sel)
        print(f"{rot}: venda R$ {v:,.2f}, pedidos {q:,}")
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
