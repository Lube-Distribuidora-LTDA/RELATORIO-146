"""
SO LEITURA. Positivacao (clientes diferentes com pedido) do Relatorio 146: WinThor agora x banco do painel,
por supervisor, no mes passado e no mes atual. Mostra tambem as variantes que a rotina 146 pode estar
usando na tela (so faturados, so com venda) e os pedidos que diferem entre os dois lados.

Uso: python -X utf8 conferir_positivacao_146.py [AAAA-MM-DD AAAA-MM-DD]
"""
import os
import sys
from datetime import date, timedelta

import oracledb
import psycopg2
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)

# a regra do 146 (a mesma do fluxo relatorio146.pedido do agente), todas as filiais
PED = """
SELECT c.numped, c.codcli, NVL(c.codsupervisor, -1) AS sup, c.posicao, c.condvenda,
       CASE WHEN c.condvenda IN (5,6,11,12) THEN 0 ELSE c.vlatend END AS vlatend
  FROM pcpedc c
  JOIN pcplpag pl ON pl.codplpag = c.codplpag
  JOIN pcusuari u ON u.codusur = c.codusur
  JOIN pcclient cl ON cl.codcli = c.codcli
  JOIN pccidade cid ON cid.codcidade = cl.codcidade
 WHERE c.data BETWEEN :de AND :ate
   AND c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL
   AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))"""


def periodos():
    if len(sys.argv) == 3:
        return [(date.fromisoformat(sys.argv[1]), date.fromisoformat(sys.argv[2]))]
    hoje = date.today()
    ini = hoje.replace(day=1)
    ant = (ini - timedelta(days=1)).replace(day=1)
    return [(ant, ini - timedelta(days=1)), (ini, hoje)]


def main():
    ora = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"],
                           dsn=oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                                                service_name=os.environ["ORACLE_SERVICE_NAME"].strip()))
    ora.module = "CONFERENCIA 146"
    ora.call_timeout = 300_000
    cur = ora.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    pg = psycopg2.connect(host=os.environ["SUPABASE_DB_HOST"].strip(), port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
                          dbname=os.environ.get("SUPABASE_DB_NAME", "postgres").strip(), user=os.environ["SUPABASE_DB_USER"].strip(),
                          password=os.environ["SUPABASE_DB_PASSWORD"].strip(), application_name="conferencia-146", connect_timeout=20)
    for de, ate in periodos():
        cur.execute(PED, de=de, ate=ate)
        w = {r[0]: r for r in cur.fetchall()}
        with pg.cursor() as c:
            c.execute("""SELECT numped, codcli, COALESCE(codsupervisor, -1), posicao, condvenda, venda
                           FROM relatorio146.pedido WHERE data BETWEEN %s AND %s""", (de, ate))
            b = {r[0]: r for r in c.fetchall()}
        pg.rollback()
        print(f"\n=== {de:%d/%m/%Y} a {ate:%d/%m/%Y} ===")
        so_w = [k for k in w if k not in b]
        so_b = [k for k in b if k not in w]
        print(f"pedidos: WinThor {len(w):,} | painel {len(b):,} | so no WinThor {len(so_w)} | so no painel {len(so_b)}")
        for k in so_w[:5]:
            print("   so no WinThor:", w[k])
        for k in so_b[:5]:
            print("   so no painel:", b[k])

        def pos(d, filtro=lambda r: True):
            tot, porsup = set(), {}
            for r in d.values():
                if not filtro(r):
                    continue
                tot.add(r[1])
                porsup.setdefault(r[2], set()).add(r[1])
            return tot, porsup

        tw, sw = pos(w)
        tb, sb = pos(b)
        print(f"positivados (todos os pedidos): WinThor {len(tw):,} | painel {len(tb):,}")
        print(f"   variantes no WinThor: so faturados {len(pos(w, lambda r: r[3] == 'F')[0]):,}; "
              f"so com venda {len(pos(w, lambda r: (r[5] or 0) > 0)[0]):,}; "
              f"faturados com venda {len(pos(w, lambda r: r[3] == 'F' and (r[5] or 0) > 0)[0]):,}")
        soma = sum(len(v) for v in sw.values())
        print(f"   soma da coluna Qt.clientes pos. dos supervisores: {soma:,} (cliente com pedido em 2 supervisores conta 2 vezes)")
        dif = [(s, len(sw.get(s, ())), len(sb.get(s, ()))) for s in sorted(set(sw) | set(sb)) if len(sw.get(s, ())) != len(sb.get(s, ()))]
        print("   supervisores diferentes (sup, WinThor, painel):", dif or "nenhum")
    ora.rollback()
    ora.close()
    pg.close()


if __name__ == "__main__":
    sys.exit(main())
