"""
Mede, SO LEITURA, quanto o WinThor leva para devolver os pedidos de uma janela curta
(o que o agente vai ler de 30 em 30 s) em tres formas do mesmo SQL, e confere que as
tres devolvem exatamente as mesmas linhas.

Uso: python -X utf8 medir_janela.py
"""
import os
import sys
import time
from datetime import date

import oracledb
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from conferir_power_bi import SQL_PEDIDO  # noqa: E402

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)
oracledb.defaults.fetch_decimals = True

EXTRA_PED = ", c.hora, c.minuto"
EXTRA_SEL = ", p.hora, p.minuto"
V1 = SQL_PEDIDO.format(extra_ped=EXTRA_PED, extra_sel=EXTRA_SEL)

# V2: a soma dos itens empurrada para dentro de cada pedido (indice de PCPEDI por NUMPED)
V2 = V1.replace("LEFT JOIN it ON it.numped = p.numped", "LEFT JOIN it ON it.numped = p.numped") \
       .replace("SELECT p.numped, p.data", "SELECT /*+ PUSH_PRED(it) USE_NL(it) */ p.numped, p.data")

# V3: OUTER APPLY, um pedido de cada vez
V3 = """
WITH ped AS (
  SELECT c.numped, c.data, c.codfilial, c.codusur, c.codsupervisor, c.codcli,
         c.condvenda, c.posicao, c.numitens, c.codplpag, c.vlatend,
         NVL(c.vloutrasdesp, 0) AS vloutrasdesp, NVL(c.vlfrete, 0) AS vlfrete, c.hora, c.minuto
    FROM pcpedc c
   WHERE c.data >= :desde
     AND c.codfilial IN ('1','11','10','7','12')
     AND c.posicao IN ('L','M','B','P','F','C')
     AND c.dtcancel IS NULL
     AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))
)
SELECT p.numped, p.data, p.codfilial, cid.uf, p.codsupervisor,
       NVL(s.nome, '* NAO VINCULADO *') AS supervisor,
       p.codusur, u.nome AS rca, p.codcli, p.condvenda, p.posicao, p.hora, p.minuto,
       CASE WHEN p.condvenda IN (5,6,11,12) THEN 0
            ELSE p.vlatend - p.vloutrasdesp - p.vlfrete - NVL(it.st_vendido,0) END AS venda,
       it.custo - NVL(it.st_total,0) AS custo_liq,
       CASE WHEN p.condvenda IN (5,6) THEN 0
            WHEN p.condvenda IN (1,14) THEN NVL(it.itens_vendidos,0)
            ELSE NVL(p.numitens,0) END AS qtitens
  FROM ped p
  OUTER APPLY (
    SELECT SUM(CASE WHEN NVL(i.bonific,'N') = 'N' THEN NVL(i.st,0) * NVL(i.qt,0) END) AS st_vendido,
           SUM(NVL(i.st,0) * NVL(i.qt,0))                                            AS st_total,
           SUM(NVL(i.vlcustofin,0) * NVL(i.qt,0))                                    AS custo,
           SUM(CASE WHEN NVL(i.bonific,'N') = 'N' THEN 1 ELSE 0 END)                 AS itens_vendidos
      FROM pcpedi i
     WHERE i.numped = p.numped
  ) it
  JOIN pcplpag  pl  ON pl.codplpag   = p.codplpag
  JOIN pcusuari u   ON u.codusur     = p.codusur
  JOIN pcclient cl  ON cl.codcli     = p.codcli
  JOIN pccidade cid ON cid.codcidade = cl.codcidade
  LEFT JOIN pcsuperv s ON s.codsupervisor = p.codsupervisor
"""

SO_PED = """SELECT COUNT(*) FROM pcpedc c WHERE c.data >= :desde AND c.codfilial IN ('1','11','10','7','12')
   AND c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL"""


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 240_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.execute("SELECT TRUNC(SYSDATE) - 1 FROM dual")
    ontem = cur.fetchone()[0]
    cur.execute("SELECT TRUNC(SYSDATE) - 40 FROM dual")
    quarenta = cur.fetchone()[0]

    t = time.perf_counter()
    cur.execute(SO_PED, desde=ontem)
    print(f"so PCPEDC (ontem e hoje): {cur.fetchone()[0]} pedidos em {time.perf_counter() - t:.2f} s")

    resultados = {}
    for nome, sql in (("V1 juncao com soma", V1), ("V2 PUSH_PRED", V2), ("V3 OUTER APPLY", V3)):
        for desde, rotulo in (((ontem, "ontem e hoje"), (quarenta, "40 dias")) if nome != "V1 juncao com soma" else ((ontem, "ontem e hoje"),)):
            tempos = []
            for _ in range(2):
                t = time.perf_counter()
                cur.execute(sql, desde=desde)
                rows = cur.fetchall()
                tempos.append(time.perf_counter() - t)
            resultados[(nome, rotulo)] = sorted(rows, key=lambda r: r[0])
            print(f"{nome:<20} {rotulo:<13} {len(rows):>7,} linhas  {min(tempos):6.2f} s (melhor de 2)")

    for rotulo in ("ontem e hoje",):
        base = resultados[("V1 juncao com soma", rotulo)]
        for nome in ("V2 PUSH_PRED", "V3 OUTER APPLY"):
            print(f"{nome} = V1 ({rotulo})?", resultados[(nome, rotulo)] == base)
    print("V3 = V2 (40 dias)?", resultados[("V3 OUTER APPLY", "40 dias")] == resultados[("V2 PUSH_PRED", "40 dias")])

    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
