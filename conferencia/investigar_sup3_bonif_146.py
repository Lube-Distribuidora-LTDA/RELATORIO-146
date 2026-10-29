"""
SO LEITURA. Duas diferencas contra o print da 146 (01 a 29/10/2026): (1) supervisor 3 com 2 pedidos a
mais no WinThor — pedidos fora das juncoes obrigatorias herdadas do Power BI? ou cancelados depois do
print? (2) bonificacao dos supervisores 16 e 17 acima do WinThor (valores de referencia no
referencias-winthor-146.json, fora do Git).

Uso: python -X utf8 investigar_sup3_bonif_146.py
"""
import os
import sys
from datetime import date

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)
DE, ATE = date(2026, 10, 1), date(2026, 10, 29)


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 300_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")

    print("(1) supervisor 3: pedidos do periodo que as juncoes tiram ou que foram cancelados hoje")
    cur.execute("""
      SELECT c.numped, c.data, c.codusur, c.codcli, c.condvenda, c.posicao, c.vlatend, c.dtcancel, c.codplpag,
             (SELECT COUNT(*) FROM pcplpag pl WHERE pl.codplpag = c.codplpag) AS tem_plano,
             (SELECT COUNT(*) FROM pcusuari u WHERE u.codusur = c.codusur) AS tem_rca,
             (SELECT COUNT(*) FROM pcclient cl WHERE cl.codcli = c.codcli) AS tem_cli,
             (SELECT COUNT(*) FROM pcclient cl JOIN pccidade cid ON cid.codcidade = cl.codcidade WHERE cl.codcli = c.codcli) AS tem_cidade,
             c.codfilial
        FROM pcpedc c
       WHERE c.data BETWEEN :de AND :ate AND c.codsupervisor = 3
         AND c.codfilial IN ('1','11','10','7','12')
         AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))
         AND (c.dtcancel IS NOT NULL AND c.dtcancel >= TRUNC(SYSDATE) - 1
              OR c.posicao NOT IN ('L','M','B','P','F','C')
              OR NOT EXISTS (SELECT 1 FROM pcplpag pl WHERE pl.codplpag = c.codplpag)
              OR NOT EXISTS (SELECT 1 FROM pcclient cl JOIN pccidade cid ON cid.codcidade = cl.codcidade WHERE cl.codcli = c.codcli))
       ORDER BY c.vlatend DESC""", de=DE, ate=ATE)
    for r in cur.fetchall()[:20]:
        print("  ", r)

    print("\n(1b) todos os supervisores: pedidos que so as juncoes tiram (WinThor conta? venda)")
    cur.execute("""
      SELECT c.codsupervisor, COUNT(*), SUM(c.vlatend)
        FROM pcpedc c
       WHERE c.data BETWEEN :de AND :ate AND c.codfilial IN ('1','11','10','7','12')
         AND c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL
         AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))
         AND (NOT EXISTS (SELECT 1 FROM pcplpag pl WHERE pl.codplpag = c.codplpag)
              OR NOT EXISTS (SELECT 1 FROM pcusuari u WHERE u.codusur = c.codusur)
              OR NOT EXISTS (SELECT 1 FROM pcclient cl JOIN pccidade cid ON cid.codcidade = cl.codcidade WHERE cl.codcli = c.codcli))
       GROUP BY c.codsupervisor""", de=DE, ate=ATE)
    print("  ", cur.fetchall())

    print("\n(2) bonificacao (condicao 5) dos supervisores 16 e 17 (comparar com o referencias-winthor-146.json)")
    cur.execute("""
      SELECT c.codsupervisor, c.numped, c.vlatend, c.vlbonific, c.totvlbonific, c.custobonificacao,
             NVL(c.vloutrasdesp,0), NVL(c.vlfrete,0), c.posicao,
             (SELECT SUM(i.qt * NVL(i.pbonific,0)) FROM pcpedi i WHERE i.numped = c.numped) AS pbonif,
             (SELECT SUM(i.qt * NVL(i.st,0)) FROM pcpedi i WHERE i.numped = c.numped) AS st,
             (SELECT SUM(i.qt * NVL(i.vlbonific,0)) FROM pcpedi i WHERE i.numped = c.numped) AS vlbonif_it,
             (SELECT SUM(i.qt * NVL(i.pvenda,0)) FROM pcpedi i WHERE i.numped = c.numped) AS pvenda,
             (SELECT SUM(NVL(i.qtorig, i.qt) * NVL(i.pbonific,0)) FROM pcpedi i WHERE i.numped = c.numped) AS pbonif_orig
        FROM pcpedc c
       WHERE c.data BETWEEN :de AND :ate AND c.codsupervisor IN (16, 17) AND c.condvenda = 5
         AND c.codfilial IN ('1','11','10','7','12') AND c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL
       ORDER BY 1, 2""", de=DE, ate=ATE)
    nomes = ["sup", "numped", "vlatend", "vlbonific", "totvlbonific", "custobonif", "desp", "frete", "pos", "pbonif", "st", "vlbonif_it", "pvenda", "pbonif_orig"]
    linhas = cur.fetchall()
    print("  ", nomes)
    for r in linhas:
        print("  ", [float(x) if hasattr(x, "as_integer_ratio") and not isinstance(x, bool) else x for x in r])
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
