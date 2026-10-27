"""
Conferencia do Relatorio 146 contra o Power BI — SO LEITURA (nao grava nada).

Roda no WinThor, numa transacao so de leitura (mesma foto para todas as consultas):
  1. o SQL ORIGINAL do Power BI (Consulta4, secao 4.1 da documentacao), no grao
     dia x UF do cliente x supervisor x RCA x filial;
  2. o SQL NOVO, um pedido por linha (o que o Agente Lube vai gravar);
  3. soma o novo no grao do original e compara linha a linha (pedidos, venda, lucro);
  4. compara os numeros da tela contra os valores lidos do modelo publicado
     (atualizacao de 27/10/2026 08:19:52, secao 12 da documentacao).

Numeros de referencia (Power BI, 27/10/2026 08:19:52): conferencia\referencias-power-bi.json,
que fica so na maquina (sao valores de venda e o repositorio e publico). Sem ele, o script
mostra os numeros sem comparar.

Uso: python -I -X utf8 conferir_power_bi.py
"""
import json
import os
import sys
import time
from collections import defaultdict
from datetime import date
from decimal import Decimal

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)
oracledb.defaults.fetch_decimals = True

_ARQ_REF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "referencias-power-bi.json")
REF = json.load(open(_ARQ_REF, encoding="utf-8")) if os.path.exists(_ARQ_REF) else {}

SQL_ORIGINAL = r"""
SELECT
pcpedc.data,
PCCIDADE.UF,
 PCPEDC.CODSUPERVISOR,
 coalesce(PCSUPERV.NOME, '* NAO VINCULADO *') SUPERVISOR,
 pcpedc.codusur,
 PCPEDC.CODFILIAL,
 pcusuari.nome as rca,
 count (DISTINCT(PCPEDC.CODCLI)) POSITIVACAO,
 COUNT(PCPEDC.NUMPED) QTPED,
 AVG(coalesce(PCPEDC.NUMITENS,0)) MEDIAQTITENS,
 MAX(NVL((SELECT (NVL(PCMETARCA.VLVENDAPREV,0)) FROM PCMETARCA WHERE 0 = 0
 AND PCMETARCA.DATA = PCPEDC.DATA
 AND PCMETARCA.CODFILIAL IN ('1','11','10','7','12')
 AND PCMETARCA.CODUSUR = PCPEDC.CODUSUR),0) ) META_DIARIA,

 SUM(DECODE(PCPEDC.CONDVENDA,5, 0 ,6, 0, 11, 0, 12, 0 ,PCPEDC.VLATEND - NVL(PCPEDC.VLOUTRASDESP,0) - coalesce(PCPEDC.VLFRETE,0) - NVL((SELECT SUM(NVL(I.ST,0) * NVL(I.QT,0)) FROM PCPEDI I WHERE I.NUMPED = PCPEDC.NUMPED AND NVL(I.BONIFIC, 'N') = 'N'),0)
 )) VLVENDA,

 SUM((coalesce(DECODE(PCPEDC.CONDVENDA,5, 0 ,6, 0, 11, 0, 12, 0 ,PCPEDC.VLATEND - NVL(PCPEDC.VLOUTRASDESP,0) - coalesce(PCPEDC.VLFRETE,0) - NVL((SELECT SUM(NVL(I.ST,0) * NVL(I.QT,0)) FROM PCPEDI I WHERE I.NUMPED = PCPEDC.NUMPED AND NVL(I.BONIFIC, 'N') = 'N'),0)
),0))) - SUM((SELECT SUM(coalesce(I.VLCUSTOFIN,0) * coalesce(I.QT,0)) FROM PCPEDI I WHERE I.NUMPED = PCPEDC.NUMPED ) - NVL((SELECT SUM(NVL(I.ST,0) * NVL(I.QT,0)) FROM PCPEDI I WHERE I.NUMPED = PCPEDC.NUMPED) ,0)
) VLLUCRO,

 SUM(coalesce(DECODE(PCPEDC.CONDVENDA, 5, 0, 6, 0,
 1, (SELECT COUNT(*) FROM PCPEDI I WHERE I.NUMPED = PCPEDC.NUMPED AND coalesce(I.BONIFIC, 'N') = 'N'),
 14, (SELECT COUNT(*) FROM PCPEDI I WHERE I.NUMPED = PCPEDC.NUMPED AND coalesce(I.BONIFIC, 'N') = 'N'), PCPEDC.NUMITENS), 0)) QTITENS

FROM PCSUPERV, PCUSUARI, PCPLPAG, PCPEDC, PCCLIENT, PCCIDADE
WHERE PCPEDC.CODPLPAG = PCPLPAG.CODPLPAG
 AND PCPEDC.CODUSUR = PCUSUARI.CODUSUR
 AND PCPEDC.CODCLI = PCCLIENT.codcli
 AND PCCLIENT.codcidade = PCCIDADE.codcidade
 AND PCPEDC.CODSUPERVISOR = PCSUPERV.CODSUPERVISOR(+)
 AND PCPEDC.POSICAO IN ('L','M','B','P','F','C')
AND not exists (
 select 1
 from pcpedc c
 where
 PCPEDC.DATA >= TO_DATE('01/jan/2026')
 and c.condvenda in (4, 8, 10, 13, 20, 98, 99)
 and c.condvenda = PCPEDC.condvenda
 AND c.codfilial = pcpedc.codfilial
 )
 AND PCPEDC.DTCANCEL IS NULL
 and PCPEDC.DATA >= TO_DATE('01/jan/2026')
 AND PCPEDC.CODFILIAL IN ('1','11','10','7','12')
GROUP BY PCCIDADE.UF, pcpedc.data, pcpedc.codusur,pcpedc.codfilial, pcusuari.nome, PCPEDC.CODSUPERVISOR, coalesce(PCSUPERV.NOME, '* NAO VINCULADO *')
"""

# Um pedido por linha: o que o agente grava. As subconsultas repetidas do original viram
# uma soma por pedido (it). Mesmos filtros e mesmas juncoes internas do original.
SQL_PEDIDO = r"""
WITH ped AS (
  SELECT c.numped, c.data, c.codfilial, c.codusur, c.codsupervisor, c.codcli,
         c.condvenda, c.posicao, c.numitens, c.codplpag, c.vlatend,
         NVL(c.vloutrasdesp, 0) AS vloutrasdesp, NVL(c.vlfrete, 0) AS vlfrete{extra_ped}
    FROM pcpedc c
   WHERE c.data >= :desde
     AND c.codfilial IN ('1','11','10','7','12')
     AND c.posicao IN ('L','M','B','P','F','C')
     AND c.dtcancel IS NULL
     AND (c.condvenda IS NULL OR c.condvenda NOT IN (4,8,10,13,20,98,99))
),
it AS (
  SELECT i.numped,
         SUM(CASE WHEN NVL(i.bonific,'N') = 'N' THEN NVL(i.st,0) * NVL(i.qt,0) END) AS st_vendido,
         SUM(NVL(i.st,0) * NVL(i.qt,0))                                            AS st_total,
         SUM(NVL(i.vlcustofin,0) * NVL(i.qt,0))                                    AS custo,
         SUM(CASE WHEN NVL(i.bonific,'N') = 'N' THEN 1 ELSE 0 END)                 AS itens_vendidos
    FROM pcpedi i
   WHERE i.numped IN (SELECT numped FROM ped)
   GROUP BY i.numped
)
SELECT p.numped, p.data, p.codfilial, cid.uf, p.codsupervisor,
       NVL(s.nome, '* NAO VINCULADO *') AS supervisor,
       p.codusur, u.nome AS rca, p.codcli, p.condvenda, p.posicao{extra_sel},
       CASE WHEN p.condvenda IN (5,6,11,12) THEN 0
            ELSE p.vlatend - p.vloutrasdesp - p.vlfrete - NVL(it.st_vendido,0) END AS venda,
       it.custo - NVL(it.st_total,0) AS custo_liq,
       CASE WHEN p.condvenda IN (5,6) THEN 0
            WHEN p.condvenda IN (1,14) THEN NVL(it.itens_vendidos,0)
            ELSE NVL(p.numitens,0) END AS qtitens
  FROM ped p
  LEFT JOIN it ON it.numped = p.numped
  JOIN pcplpag  pl  ON pl.codplpag   = p.codplpag
  JOIN pcusuari u   ON u.codusur     = p.codusur
  JOIN pcclient cl  ON cl.codcli     = p.codcli
  JOIN pccidade cid ON cid.codcidade = cl.codcidade
  LEFT JOIN pcsuperv s ON s.codsupervisor = p.codsupervisor
"""

ES = {1, 6, 17, 16, 13, 4, 8, 7, 12}
BA = {30, 34, 33, 32, 31}
RJ = {21, 22, 23}
INTERNA = {3}


def brl(v):
    if v is None:
        return "—"
    s = f"{v:,.2f}"
    return "R$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def linhas(cur):
    cols = [d[0].lower() for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def main():
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 240_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")
    cur.execute("SELECT TO_CHAR(SYSDATE, 'DD/MM/YYYY HH24:MI:SS') FROM dual")
    print("Foto do WinThor:", cur.fetchone()[0])

    cur.execute("""SELECT DISTINCT column_name FROM all_tab_columns
                    WHERE table_name = 'PCPEDC' AND column_name IN ('HORA','MINUTO','DTFAT','NUMNOTA')""")
    tem = {r[0] for r in cur.fetchall()}
    print("PCPEDC tem:", sorted(tem))
    extra_ped = ", c.hora, c.minuto" if {"HORA", "MINUTO"} <= tem else ""
    extra_sel = ", p.hora, p.minuto" if extra_ped else ""

    t = time.perf_counter()
    cur.execute(SQL_ORIGINAL)
    orig = linhas(cur)
    t_orig = time.perf_counter() - t
    print(f"\n1) SQL original: {len(orig):,} linhas em {t_orig:.1f} s")

    t = time.perf_counter()
    cur.execute(SQL_PEDIDO.format(extra_ped=extra_ped, extra_sel=extra_sel), desde=date(2026, 1, 1))
    peds = linhas(cur)
    t_ped = time.perf_counter() - t
    print(f"2) SQL novo (um pedido por linha): {len(peds):,} pedidos em {t_ped:.1f} s")

    for dias in (1, 40):
        t = time.perf_counter()
        cur.execute("SELECT TRUNC(SYSDATE) - :d FROM dual", d=dias)
        desde = cur.fetchone()[0]
        cur.execute(SQL_PEDIDO.format(extra_ped=extra_ped, extra_sel=extra_sel), desde=desde)
        n = len(cur.fetchall())
        print(f"   janela de {dias} dia(s) (desde {desde:%d/%m}): {n:,} pedidos em {time.perf_counter() - t:.2f} s")

    # --- 3) soma o novo no grao do original ---
    soma = defaultdict(lambda: {"qtped": 0, "venda": None, "venda0": Decimal(0), "custo": None,
                                "clientes": set(), "qtitens": Decimal(0)})
    for p in peds:
        k = (p["data"], p["uf"], p["codsupervisor"], p["codusur"], str(p["codfilial"]))
        s = soma[k]
        s["qtped"] += 1
        if p["venda"] is not None:
            s["venda"] = (s["venda"] or Decimal(0)) + p["venda"]
            s["venda0"] += p["venda"]
        if p["custo_liq"] is not None:
            s["custo"] = (s["custo"] or Decimal(0)) + p["custo_liq"]
        s["clientes"].add(p["codcli"])
        s["qtitens"] += p["qtitens"] or 0

    difs = defaultdict(int)
    exemplos = []
    chaves_orig = set()
    for o in orig:
        k = (o["data"], o["uf"], o["codsupervisor"], o["codusur"], str(o["codfilial"]))
        chaves_orig.add(k)
        s = soma.get(k)
        if s is None:
            difs["linha so no original"] += 1
            exemplos.append(("so no original", k))
            continue
        lucro = None if s["custo"] is None else s["venda0"] - s["custo"]
        comps = {
            "qtped": (o["qtped"], s["qtped"]),
            "vlvenda": (o["vlvenda"], s["venda"]),
            "vllucro": (o["vllucro"], lucro),
            "positivacao": (o["positivacao"], len(s["clientes"])),
            "qtitens": (o["qtitens"], s["qtitens"]),
        }
        for nome, (a, b) in comps.items():
            if (a is None) != (b is None) or (a is not None and abs(Decimal(a) - Decimal(b)) > Decimal("0.000001")):
                difs[nome] += 1
                if len(exemplos) < 12:
                    exemplos.append((nome, k, a, b))
    for k in soma.keys() - chaves_orig:
        difs["linha so no novo"] += 1
        exemplos.append(("so no novo", k))

    print(f"\n3) Novo somado no grao do original: {len(soma):,} linhas x {len(orig):,} do original")
    if not difs:
        print("   IGUAL linha por linha (pedidos, venda, lucro, positivacao, itens).")
    else:
        for nome, n in difs.items():
            print(f"   DIFERENCA em {nome}: {n} linha(s)")
        for e in exemplos[:12]:
            print("    ", e)

    tot_v = sum((o["vlvenda"] or 0) for o in orig)
    tot_l = sum((o["vllucro"] or 0) for o in orig)
    tot_p = sum(o["qtped"] for o in orig)
    print(f"   Original: venda {brl(tot_v)}, pedidos {tot_p:,}, lucro {brl(tot_l)}")
    if REF.get("modelo"):
        print("   (Power BI: " + REF["modelo"] + ")")

    # --- 4) numeros da tela ---
    def tela(ini, fim):
        sel = [p for p in peds if ini <= p["data"].date() <= fim]
        v = lambda f: sum((p["venda"] or 0) for p in sel if f(p))
        n = lambda f: sum(1 for p in sel if f(p))
        tudo = lambda p: True
        total, ped = v(tudo), n(tudo)
        lucro = sum((p["venda"] or 0) for p in sel) - sum((p["custo_liq"] or 0) for p in sel if p["custo_liq"] is not None)
        r = {
            "TOTAL VENDAS": brl(total), "Pedidos": f"{ped:,}", "TICKET": brl(total / ped if ped else None),
            "% lucro": f"{lucro / total * 100:.2f}%" if total else "—",
        }
        for nome, grupo in (("ES", ES), ("BA", BA), ("RJ", RJ)):
            f = lambda p, g=grupo: p["codsupervisor"] in g
            r[f"TOTAL {nome}"] = brl(v(f))
            r[f"TICKET {nome}"] = brl(v(f) / n(f) if n(f) else None)
        r["INTERNA"] = brl(v(lambda p: p["codsupervisor"] in INTERNA))
        r["% ES/BA/RJ"] = " / ".join(f"{v(lambda p, u=u: p['uf'] == u) / total * 100:.2f}%" for u in ("ES", "BA", "RJ"))
        return r

    print("\n4) Tela (todas as UFs, sem supervisor/filial)")
    for titulo, ini, fim, ref in (("Dia 26/10/2026", date(2026, 10, 26), date(2026, 10, 26), REF.get("dia", {})),
                                  ("01/10 a 26/10/2026", date(2026, 10, 1), date(2026, 10, 26), REF.get("mes", {}))):
        print(f"   {titulo}")
        for k, val in tela(ini, fim).items():
            pbi = ref.get(k, "")
            marca = "" if not pbi else ("  ok" if pbi.replace(",", "").replace(".", "") == val.replace(",", "").replace(".", "") else "  <-- Power BI " + pbi)
            print(f"     {k:<14} {val:>22}{marca}")

    # Pedidos de 26/10 e do mes por posicao (o que ainda pode mudar)
    pos = defaultdict(int)
    for p in peds:
        if p["data"].date() >= date(2026, 10, 1):
            pos[p["posicao"]] += 1
    print("\n   Pedidos de outubro por posicao:", dict(sorted(pos.items())))
    if extra_ped:
        hoje = [p for p in peds if p["data"].date() == date.today()]
        com_hora = sum(1 for p in hoje if p.get("hora") is not None)
        print(f"   Pedidos de hoje: {len(hoje)}, com hora preenchida: {com_hora}")

    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
