"""
SO LEITURA. Relatorio 146 por supervisor numa filial: WinThor agora x banco do painel (pedidos e clientes
positivados), e a lista de filiais com a UF. Serve para conferir o painel com o filtro Filial contra a rotina 146
com a mesma filial (a 146 "ES" do Julio em 2026-11-10 era a filial 1).

Uso: python -X utf8 conferir_filial_146.py [AAAA-MM-DD AAAA-MM-DD] [filial,filial]
"""
import os
import sys
from datetime import date

import oracledb
import psycopg2
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)

# a regra do 146 (a mesma do fluxo relatorio146.pedido do agente)
PED = """
SELECT NVL(c.codsupervisor, -1) AS sup, COUNT(*) AS pedidos, COUNT(DISTINCT c.codcli) AS clientes
  FROM pcpedc c
  JOIN pcplpag pl ON pl.codplpag = c.codplpag
  JOIN pcusuari u ON u.codusur = c.codusur
  JOIN pcclient cl ON cl.codcli = c.codcli
  JOIN pccidade cid ON cid.codcidade = cl.codcidade
 WHERE c.data BETWEEN :de AND :ate
   AND c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL
   AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))
   AND c.codfilial IN ({fil})
 GROUP BY NVL(c.codsupervisor, -1)"""


def main():
    args = sys.argv[1:]
    de = date.fromisoformat(args[0]) if len(args) >= 2 else date.today().replace(day=1)
    ate = date.fromisoformat(args[1]) if len(args) >= 2 else date.today()
    fil = (args[2] if len(args) >= 3 else "1").split(",")
    ora = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"],
                           dsn=oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                                                service_name=os.environ["ORACLE_SERVICE_NAME"].strip()))
    ora.module = "CONFERENCIA 146"
    ora.call_timeout = 300_000
    cur = ora.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.execute("SELECT codigo, uf, cidade FROM pcfilial ORDER BY TO_NUMBER(codigo)")
    print("Filiais (codigo, UF, cidade):")
    for r in cur.fetchall():
        print("  ", r)
    marcas = ",".join(f":f{i}" for i in range(len(fil)))
    cur.execute(PED.format(fil=marcas), de=de, ate=ate, **{f"f{i}": f for i, f in enumerate(fil)})
    w = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
    pg = psycopg2.connect(host=os.environ["SUPABASE_DB_HOST"].strip(), port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
                          dbname=os.environ.get("SUPABASE_DB_NAME", "postgres").strip(), user=os.environ["SUPABASE_DB_USER"].strip(),
                          password=os.environ["SUPABASE_DB_PASSWORD"].strip(), application_name="conferencia-146", connect_timeout=20)
    with pg.cursor() as c:
        c.execute("""SELECT COALESCE(codsupervisor, -1), count(*), count(DISTINCT codcli) FROM relatorio146.pedido
                      WHERE data BETWEEN %s AND %s AND codfilial = ANY(%s) GROUP BY 1""", (de, ate, fil))
        b = {r[0]: (r[1], r[2]) for r in c.fetchall()}
    pg.rollback()
    print(f"\nFilial {','.join(fil)}, {de:%d/%m/%Y} a {ate:%d/%m/%Y} (supervisor: WinThor agora | painel):")
    iguais = 0
    for s in sorted(set(w) | set(b)):
        ok = w.get(s) == b.get(s)
        iguais += ok
        print(f"   sup {s:>4}: {w.get(s)} | {b.get(s)}  {'igual' if ok else 'DIFERENTE'}")
    print(f"{iguais} de {len(set(w) | set(b))} supervisores iguais")
    ora.rollback()
    ora.close()
    pg.close()


if __name__ == "__main__":
    sys.exit(main())
