"""
SO LEITURA. As colunas da 146 que ainda nao bateram: Vl.bonificacao (alem da condicao 5), Vl.tabela
(sobra no nosso), Qt.itens, clientes cadastrados e visitas. Le o WinThor direto, 01 a 29/10/2026.

Uso: python -X utf8 investigar_bonif_tabela_146.py
"""
import os
import sys
from datetime import date

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)
DE, ATE = date(2026, 10, 1), date(2026, 10, 29)

BASE = """
WITH ped AS (
  SELECT c.numped, c.codusur, c.codsupervisor, c.codcli, c.condvenda, c.numitens, c.vlbonific AS c_vlbonific
    FROM pcpedc c
    JOIN pcplpag pl ON pl.codplpag = c.codplpag
    JOIN pcusuari u ON u.codusur = c.codusur
    JOIN pcclient cl ON cl.codcli = c.codcli
    JOIN pccidade cid ON cid.codcidade = cl.codcidade
   WHERE c.data BETWEEN :de AND :ate
     AND c.codfilial IN ('1','11','10','7','12') AND c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL
     AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))
)"""


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 300_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.execute("SELECT column_name FROM all_tab_columns WHERE table_name = 'PCPEDC' AND column_name LIKE '%BONIF%'")
    print("PCPEDC *BONIF*:", [r[0] for r in cur.fetchall()])

    # 1) itens fora do comum nos pedidos normais dos supervisores com diferenca
    cur.execute(BASE + """
      SELECT p.codsupervisor, p.condvenda,
             COUNT(*) AS linhas,
             SUM(CASE WHEN NVL(i.vlbonific,0) > 0 THEN 1 ELSE 0 END) AS l_vlbonif,
             SUM(CASE WHEN NVL(i.vlbonific,0) > 0 THEN i.qt * i.vlbonific END) AS vlbonif,
             SUM(CASE WHEN NVL(i.vlbonific,0) > 0 THEN i.qt * NVL(i.st,0) END) AS st_bonif,
             SUM(CASE WHEN NVL(i.vlbonific,0) > 0 THEN i.qt * (NVL(i.ptabela,0) - NVL(i.st,0)) END) AS tab_bonif,
             SUM(CASE WHEN NVL(i.pvenda,0) = 0 THEN i.qt * (NVL(i.ptabela,0) - NVL(i.st,0)) END) AS tab_pv0,
             SUM(CASE WHEN NVL(i.pvenda,0) = 0 THEN 1 ELSE 0 END) AS l_pv0,
             SUM(CASE WHEN i.coddegustacao IS NOT NULL THEN i.qt * (NVL(i.ptabela,0) - NVL(i.st,0)) END) AS tab_degust,
             SUM(CASE WHEN NVL(i.qt,0) = 0 THEN 1 ELSE 0 END) AS l_qt0,
             SUM(CASE WHEN NVL(i.pbonific,0) > 0 THEN i.qt * i.pbonific END) AS pbonific,
             MAX(p.c_vlbonific) AS c_vlbonific_max, SUM(DISTINCT NVL(p.c_vlbonific,0)) AS c_vlbonific_soma_dist
        FROM ped p JOIN pcpedi i ON i.numped = p.numped
       WHERE p.codsupervisor IN (6, 7, 17, 21, 32)
       GROUP BY p.codsupervisor, p.condvenda ORDER BY 1, 2""", de=DE, ate=ATE)
    nomes = [d[0].lower() for d in cur.description]
    print("\nPor supervisor e condicao de venda:")
    print("  ", nomes)
    for r in cur.fetchall():
        print("  ", [float(x) if isinstance(x, (int, float)) or hasattr(x, "as_integer_ratio") else x for x in r])

    # 2) cabecalho: VLBONIFIC da PCPEDC por supervisor
    cur.execute(BASE + """
      SELECT codsupervisor, condvenda, COUNT(*), SUM(NVL(c_vlbonific,0)) FROM ped WHERE codsupervisor IN (6,7,17,21,32)
       GROUP BY codsupervisor, condvenda ORDER BY 1, 2""", de=DE, ate=ATE)
    print("\nPCPEDC.VLBONIFIC por supervisor e condicao:", cur.fetchall())

    # 3) supervisor 6: os itens que podem explicar a sobra de tabela
    cur.execute(BASE + """
      SELECT p.numped, p.condvenda, i.codprod, i.qt, i.qtorig, i.pvenda, i.ptabela, i.st, i.vlbonific, i.bonific, i.perdesc
        FROM ped p JOIN pcpedi i ON i.numped = p.numped
       WHERE p.codsupervisor = 6 AND (NVL(i.pvenda,0) = 0 OR NVL(i.vlbonific,0) > 0 OR NVL(i.perdesc,0) >= 99
             OR NVL(i.ptabela,0) - NVL(i.st,0) <= 0 OR i.pvenda > i.ptabela)""", de=DE, ate=ATE)
    print("\nSupervisor 6, itens fora do comum:")
    for r in cur.fetchall()[:30]:
        print("  ", r)

    # 4) Qt.itens: linhas com QT > 0, por RCA do supervisor 7
    cur.execute(BASE + """
      SELECT p.codusur, COUNT(*) AS linhas, SUM(CASE WHEN i.qt > 0 THEN 1 ELSE 0 END) AS qt_pos,
             SUM(CASE WHEN p.condvenda NOT IN (5,6,11,12) THEN 1 ELSE 0 END) AS l_venda,
             SUM(CASE WHEN i.qt > 0 AND p.condvenda NOT IN (5,6,11,12) THEN 1 ELSE 0 END) AS qt_pos_venda,
             COUNT(DISTINCT p.numped || '-' || i.codprod) AS ped_prod
        FROM ped p JOIN pcpedi i ON i.numped = p.numped WHERE p.codsupervisor = 7 GROUP BY p.codusur ORDER BY 1""", de=DE, ate=ATE)
    print("\nQt.itens por RCA (sup 7) — WinThor: 795=3071 946=3298 11=1309 664=1270 935=1750 1267=911 1255=882 1270=833 1209=193 584=2")
    for r in cur.fetchall():
        print("  ", r)

    # 5) clientes cadastrados e visitas por RCA
    cur.execute("""SELECT u.codusur,
                          (SELECT COUNT(*) FROM pcclient c WHERE c.codusur1 = u.codusur) AS c1,
                          (SELECT COUNT(*) FROM pcclient c WHERE c.codusur1 = u.codusur OR c.codusur2 = u.codusur) AS c12,
                          (SELECT COUNT(DISTINCT uc.codcli) FROM pcusurcli uc WHERE uc.codusur = u.codusur) AS usurcli,
                          (SELECT COUNT(*) FROM pcvisita v WHERE v.codusur = u.codusur AND v.data BETWEEN :de AND :ate) AS vis,
                          (SELECT COUNT(*) FROM pcvisita v WHERE v.codusur = u.codusur AND v.data BETWEEN :de AND :ate AND NVL(v.cancelado,'N') = 'N') AS vis_ok,
                          (SELECT COUNT(DISTINCT v.codcli || '-' || TO_CHAR(v.data,'YYYYMMDD')) FROM pcvisita v WHERE v.codusur = u.codusur AND v.data BETWEEN :de AND :ate) AS vis_dia
                     FROM pcusuari u WHERE u.codusur IN (795, 946, 11, 664, 935, 1267, 1255, 1270, 1209, 584) ORDER BY 1""", de=DE, ate=ATE)
    print("\nClientes cad. e visitas — WinThor cad: 795=142 946=72 11=80 664=143 935=77 1267=114 1255=87 1270=120 1209=0 584=1444;"
          " visitas: 795=247 946=190 11=174 664=236 935=143 1267=86 1255=93 1270=90 1209=36 584=1")
    for r in cur.fetchall():
        print("  ", r)
    cur.execute("SELECT COUNT(*), COUNT(CASE WHEN dtexclusao IS NULL THEN 1 END) FROM pcclient")
    print("\nPCCLIENT total (WinThor 62016):", cur.fetchone())
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
