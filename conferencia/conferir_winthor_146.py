"""
SO LEITURA. Confere, contra os prints da rotina 146 (Resumo de Vendas) do WinThor, as formulas
candidatas de cada coluna, lendo o WinThor direto: por supervisor (todos) e por RCA (supervisor 7).
Os valores de referencia ficam em referencias-winthor-146.json (fora do Git: tem valores de venda).

Uso: python -X utf8 conferir_winthor_146.py
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

# um pedido por linha, a regra do 146 (a mesma do agente) + as colunas candidatas
PED = """
WITH ped AS (
  SELECT c.numped, c.data, c.codfilial, c.codusur, c.codsupervisor, c.codcli, c.condvenda, c.posicao, c.numitens,
         c.vlatend, NVL(c.vloutrasdesp,0) AS desp, NVL(c.vlfrete,0) AS frete, NVL(c.totpeso,0) AS peso,
         NVL(c.prazomedio,0) AS prazo
    FROM pcpedc c
    JOIN pcplpag pl ON pl.codplpag = c.codplpag
    JOIN pcusuari u ON u.codusur = c.codusur
    JOIN pcclient cl ON cl.codcli = c.codcli
    JOIN pccidade cid ON cid.codcidade = cl.codcidade
   WHERE c.data BETWEEN :de AND :ate
     AND c.codfilial IN ('1','11','10','7','12') AND c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL
     AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))
), p AS (
  SELECT ped.*,
         CASE WHEN condvenda IN (5,6,11,12) THEN 0 ELSE vlatend - desp - frete - NVL(it.st_vendido,0) END AS venda,
         it.custo - NVL(it.st_total,0) AS cmv, it.custo_real - NVL(it.st_total,0) AS cmv_real,
         CASE WHEN condvenda IN (5,6,11,12) THEN 0 ELSE NVL(it.tabela_vend,0) END AS tabela,
         CASE WHEN condvenda = 5 THEN NVL(it.bonif,0) - NVL(it.st_total,0) ELSE 0 END AS bonif5,
         CASE WHEN condvenda IN (5,6,11,12) THEN NVL(it.bonif,0) - NVL(it.st_total,0) ELSE 0 END AS bonif56,
         it.linhas, it.linhas_vend
    FROM ped
    OUTER APPLY (
      SELECT SUM(CASE WHEN NVL(i.bonific,'N') = 'N' THEN NVL(i.st,0) * NVL(i.qt,0) END) AS st_vendido,
             SUM(NVL(i.st,0) * NVL(i.qt,0)) AS st_total,
             SUM(NVL(i.vlcustofin,0) * NVL(i.qt,0)) AS custo,
             SUM(NVL(i.vlcustoreal,0) * NVL(i.qt,0)) AS custo_real,
             SUM(CASE WHEN NVL(i.bonific,'N') = 'N' THEN (NVL(i.ptabela,0) - NVL(i.st,0)) * NVL(i.qt,0) END) AS tabela_vend,
             SUM(NVL(i.vlbonific,0) * NVL(i.qt,0)) AS bonif,
             COUNT(*) AS linhas, SUM(CASE WHEN NVL(i.bonific,'N') = 'N' THEN 1 ELSE 0 END) AS linhas_vend
        FROM pcpedi i WHERE i.numped = ped.numped) it
)
"""

AGG = """
SELECT {chave} AS k, COUNT(*) AS pedidos,
       COUNT(DISTINCT codcli) AS cli_todos, COUNT(DISTINCT CASE WHEN venda > 0 THEN codcli END) AS cli_venda,
       COUNT(DISTINCT codusur) AS rcas,
       SUM(venda) AS venda, SUM(tabela) AS tabela, SUM(cmv) AS cmv, SUM(cmv_real) AS cmv_real,
       SUM(bonif5) AS bonif5, SUM(bonif56) AS bonif56,
       SUM(numitens) AS numitens, SUM(linhas) AS linhas, SUM(CASE WHEN venda > 0 THEN numitens END) AS numitens_venda,
       COUNT(CASE WHEN venda > 0 THEN 1 END) AS ped_venda,
       SUM(peso) AS peso, SUM(CASE WHEN venda > 0 THEN peso END) AS peso_venda,
       AVG(prazo) AS prazo_simples, SUM(prazo * venda) / NULLIF(SUM(venda),0) AS prazo_pond,
       AVG(CASE WHEN venda > 0 THEN prazo END) AS prazo_venda
  FROM p {filtro} GROUP BY {chave}"""

MIX = """
SELECT {chave} AS k, COUNT(DISTINCT i.codprod) AS mix_todos,
       COUNT(DISTINCT CASE WHEN p.venda > 0 THEN i.codprod END) AS mix_venda
  FROM p JOIN pcpedi i ON i.numped = p.numped {filtro} GROUP BY {chave}"""


def rodar(cur, sql, de, ate):
    cur.execute(sql, de=de, ate=ate)
    nomes = [d[0].lower() for d in cur.description]
    return {r[0]: dict(zip(nomes, r)) for r in cur.fetchall()}


def f(x):
    return float(x or 0)


def marca(ok):
    return "  " if ok else "<>"


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

    sup = rodar(cur, PED + AGG.format(chave="codsupervisor", filtro=""), de, ate)
    mix = rodar(cur, PED + MIX.format(chave="p.codsupervisor", filtro=""), de, ate)
    cur.execute("SELECT codsupervisor, SUM(vlvendaprev) FROM pcmetasup WHERE data BETWEEN :de AND :ate GROUP BY codsupervisor", de=de, ate=ate)
    meta_sup = {r[0]: f(r[1]) for r in cur.fetchall()}

    cols = ref["colunas_sup"]
    print("POR SUPERVISOR (WinThor | candidatos)")
    for linha in ref["supervisores"]:
        w = dict(zip(cols, linha))
        a = sup.get(w["cod"], {})
        m = mix.get(w["cod"], {})
        venda = f(a.get("venda"))
        print(f"\nsup {w['cod']}: pedidos {w['pedidos']} | {a.get('pedidos')}   cli_pos {w['cli_pos']} | todos {a.get('cli_todos')} venda>0 {a.get('cli_venda')}"
              f"   rcas {w['rcas']} | {a.get('rcas')}")
        print(f"   venda {w['venda']:,.2f} | {venda:,.2f} {marca(abs(venda - w['venda']) < 0.05)}"
              f"   tabela {w['tabela']:,.2f} | {f(a.get('tabela')):,.2f} {marca(abs(f(a.get('tabela')) - w['tabela']) < 0.05)}"
              f"   cmv {w['cmv']:,.2f} | {f(a.get('cmv')):,.2f} {marca(abs(f(a.get('cmv')) - w['cmv']) < 0.05)}"
              f"   cmv_real {w['cmv_real']:,.2f} | {f(a.get('cmv_real')):,.2f} {marca(abs(f(a.get('cmv_real')) - w['cmv_real']) < 0.05)}")
        print(f"   bonif {w['bonif']:,.2f} | cond5 {f(a.get('bonif5')):,.2f} cond5-6-11-12 {f(a.get('bonif56')):,.2f}"
              f"   meta {w['meta']:,.2f} | {meta_sup.get(w['cod'], 0):,.2f}")
        print(f"   qt_itens {w['qt_itens']} | numitens {a.get('numitens')} linhas {a.get('linhas')} numitens_venda {a.get('numitens_venda')}"
              f"   media {w['media_itens']} | numitens/ped {f(a.get('numitens'))/max(1, a.get('pedidos', 1)):.2f}"
              f" numitens_venda/ped_venda {f(a.get('numitens_venda'))/max(1, f(a.get('ped_venda'))):.2f}"
              f" linhas/ped {f(a.get('linhas'))/max(1, a.get('pedidos', 1)):.2f}")
        print(f"   peso {w['peso']:,.3f} | todos {f(a.get('peso')):,.3f} venda>0 {f(a.get('peso_venda')):,.3f}"
              f"   pz {w['pz_medio']} | simples {f(a.get('prazo_simples')):.2f} pond {f(a.get('prazo_pond')):.2f} venda>0 {f(a.get('prazo_venda')):.2f}"
              f"   mix {w['mix']} | todos {m.get('mix_todos')} venda>0 {m.get('mix_venda')}")

    rca = rodar(cur, PED + AGG.format(chave="codusur", filtro="WHERE codsupervisor = 7"), de, ate)
    mixr = rodar(cur, PED + MIX.format(chave="p.codusur", filtro="WHERE p.codsupervisor = 7"), de, ate)
    cur.execute("SELECT codusur, SUM(vlvendaprev) FROM pcmetarca WHERE data BETWEEN :de AND :ate GROUP BY codusur", de=de, ate=ate)
    meta_rca = {r[0]: f(r[1]) for r in cur.fetchall()}
    cur.execute("SELECT codusur1, COUNT(*), COUNT(CASE WHEN dtexclusao IS NULL THEN 1 END), COUNT(CASE WHEN dtexclusao IS NULL AND NVL(bloqueio,'N') = 'N' THEN 1 END) FROM pcclient GROUP BY codusur1")
    cad = {r[0]: r[1:] for r in cur.fetchall()}
    cur.execute("SELECT column_name FROM all_tab_columns WHERE table_name = 'PCVISITA' ORDER BY column_id")
    print("\nPCVISITA:", [r[0] for r in cur.fetchall()][:30])
    cols = ref["colunas_rca"]
    print("\nPOR RCA DO SUPERVISOR 7")
    for linha in ref["rcas_sup7"]:
        w = dict(zip(cols, linha))
        a = rca.get(w["cod"], {})
        m = mixr.get(w["cod"], {})
        venda = f(a.get("venda"))
        print(f"rca {w['cod']}: ped {w['pedidos']}|{a.get('pedidos')} cli_pos {w['cli_pos']}|{a.get('cli_todos')}/{a.get('cli_venda')}"
              f" venda {w['venda']:,.2f}|{venda:,.2f}{marca(abs(venda - w['venda']) < 0.05)}"
              f" meta {w['meta']:,.0f}|{meta_rca.get(w['cod'], 0):,.0f} cad {w['cli_cad']}|{cad.get(w['cod'])}"
              f" itens {w['qt_itens']}|{a.get('numitens')}/{a.get('linhas')} media {w['media_itens']}"
              f" bonif {w['bonif']:,.2f}|{f(a.get('bonif5')):,.2f} mix {w['mix']}|{m.get('mix_todos')}/{m.get('mix_venda')}"
              f" peso {w['peso']:,.3f}|{f(a.get('peso')):,.3f}")
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
