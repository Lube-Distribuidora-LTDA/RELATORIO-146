"""
SO LEITURA. De onde a rotina 146 (Resumo de Vendas) do WinThor tira cada coluna: le o pedido de
gabarito dos prints do Julio (795019087, cliente 603, RCA 795) e mostra as colunas candidatas da
PCPEDC, as somas da PCPEDI e as tabelas de meta, plano de pagamento, cobranca, emitente, regiao e
atividade.

Uso: python -X utf8 investigar_colunas_146.py [numped]
"""
import os
import sys

import oracledb
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
load_dotenv(ENV)
oracledb.defaults.fetch_decimals = True


def tabela(cur, sql, **binds):
    cur.execute(sql, binds)
    nomes = [d[0] for d in cur.description]
    return nomes, cur.fetchall()


def colunas(cur, tab, filtro=None):
    cur.execute("SELECT column_name FROM all_tab_columns WHERE table_name = :t ORDER BY column_id", t=tab)
    cols = [r[0] for r in cur.fetchall()]
    return [c for c in cols if not filtro or any(f in c for f in filtro)]


def main():
    numped = int(sys.argv[1]) if len(sys.argv) > 1 else 795019087
    dsn = oracledb.makedsn(os.environ["ORACLE_HOST"].strip(), int(os.environ.get("ORACLE_PORT", "1521")),
                           service_name=os.environ["ORACLE_SERVICE_NAME"].strip())
    conn = oracledb.connect(user=os.environ["ORACLE_USER"].strip(), password=os.environ["ORACLE_PASSWORD"], dsn=dsn)
    conn.module = "CONFERENCIA 146"
    conn.call_timeout = 120_000
    cur = conn.cursor()
    cur.execute("SET TRANSACTION READ ONLY")

    cand = colunas(cur, "PCPEDC", ("VL", "PESO", "CUSTO", "NUMCAR", "PLPAG", "PRAZO", "COB", "EMITENTE", "ORIGEM", "CHECKOUT",
                                    "NUMITENS", "CONDVENDA", "REGIAO", "PRACA", "TIPOVENDA", "BONIFIC", "DTFAT", "VLTABELA"))
    nomes, linhas = tabela(cur, f"SELECT {', '.join(cand)} FROM pcpedc WHERE numped = :n", n=numped)
    print(f"PCPEDC {numped} (colunas nao nulas e diferentes de zero):")
    for n, v in zip(nomes, linhas[0]):
        if v not in (None, 0):
            print(f"   {n:<22} {v}")

    ci = ["PTABELA", "ST", "VLCUSTOFIN", "VLCUSTOREAL", "VLBONIFIC", "PBONIFIC", "PESOBRUTO"]
    somas = ", ".join(f"SUM(NVL(i.{c},0) * NVL(i.qt,0)) AS {c}" for c in ci)
    nomes, linhas = tabela(cur, f"""SELECT COUNT(*) AS itens, COUNT(DISTINCT codprod) AS mix, SUM(i.qt) AS qt,
                                           SUM(CASE WHEN NVL(i.bonific,'N') <> 'N' THEN 1 ELSE 0 END) AS itens_bonific, {somas}
                                      FROM pcpedi i WHERE numped = :n""", n=numped)
    print("PCPEDI somas x QT:")
    for n, v in zip(nomes, linhas[0]):
        print(f"   {n:<28} {v}")
    nomes, linhas = tabela(cur, """SELECT SUM(i.qt * NVL(p.pesobruto, 0)) AS peso_bruto, SUM(i.qt * NVL(p.pesoliq, 0)) AS peso_liq
                                     FROM pcpedi i JOIN pcprodut p ON p.codprod = i.codprod WHERE i.numped = :n""", n=numped)
    print("Peso pelos produtos:", dict(zip(nomes, linhas[0])))

    print("\nPCPLPAG colunas:", colunas(cur, "PCPLPAG", ("DIAS", "PRAZO", "DESCRICAO", "CODPLPAG", "NUMPR")))
    print("PCCLIENT candidatas:", colunas(cur, "PCCLIENT", ("CLASSE", "ATV", "AREA", "PRACA", "TIPOFJ", "CODUSUR")))
    print("PCUSUARI candidatas:", colunas(cur, "PCUSUARI", ("AREA", "ATUA", "SUPERV")))
    cur.execute("""SELECT table_name FROM all_tables WHERE table_name IN ('PCMETA','PCMETARCA','PCMETASUP','PCATIVI','PCAREAATUACAO',
                     'PCREGIAO','PCPRACA','PCCOB','PCEMPR','PCVISITA','PCCLASSE','PCCLASSEVENDA','PCCLASSECLI') ORDER BY 1""")
    print("Tabelas que existem:", [r[0] for r in cur.fetchall()])
    for t in ("PCMETA", "PCMETARCA", "PCMETASUP"):
        cols = colunas(cur, t)
        if cols:
            print(f"{t}: {cols[:40]}")

    # bonificacao: os pedidos do RCA 795 em outubro com bonificacao (condicao 5 ou item bonificado)
    print("\nRCA 795, 01 a 29/10, pedidos com bonificacao (cliente, numped, condvenda, vlatend, vlbonific itens, st, custo):")
    nomes, linhas = tabela(cur, """
        SELECT c.codcli, c.numped, c.condvenda, c.vlatend, NVL(c.vloutrasdesp,0) AS desp, NVL(c.vlfrete,0) AS frete,
               (SELECT SUM(NVL(i.vlbonific,0) * i.qt) FROM pcpedi i WHERE i.numped = c.numped) AS vlbonific_qt,
               (SELECT SUM(NVL(i.vlbonific,0)) FROM pcpedi i WHERE i.numped = c.numped) AS vlbonific,
               (SELECT SUM(CASE WHEN NVL(i.bonific,'N') <> 'N' THEN i.qt * i.pvenda END) FROM pcpedi i WHERE i.numped = c.numped) AS bonif_pvenda,
               (SELECT SUM(NVL(i.st,0) * i.qt) FROM pcpedi i WHERE i.numped = c.numped) AS st,
               (SELECT SUM(NVL(i.vlcustofin,0) * i.qt) FROM pcpedi i WHERE i.numped = c.numped) AS custo
          FROM pcpedc c
         WHERE c.codusur = 795 AND c.data BETWEEN DATE '2026-10-01' AND DATE '2026-10-29'
           AND c.codfilial IN ('1','11','10','7','12') AND c.posicao IN ('L','M','B','P','F','C') AND c.dtcancel IS NULL
           AND c.codcli IN (8361, 10224, 10306, 595054, 600798)
           AND (c.condvenda IN (5,6,11,12) OR EXISTS (SELECT 1 FROM pcpedi i WHERE i.numped = c.numped AND (NVL(i.bonific,'N') <> 'N' OR NVL(i.vlbonific,0) <> 0)))
         ORDER BY c.codcli, c.numped""")
    print("   ", nomes)
    for r in linhas:
        print("   ", r)

    # meta do RCA 795 e do supervisor 7 em outubro
    for t, campo, cod in (("PCMETARCA", "CODUSUR", 795), ("PCMETASUP", "CODSUPERVISOR", 7)):
        cols = colunas(cur, t)
        if not cols:
            continue
        data = next((c for c in ("DATA", "DTMETA", "DTINICIO", "MES") if c in cols), None)
        filtro = f" AND {data} BETWEEN DATE '2026-10-01' AND DATE '2026-10-31'" if data else ""
        try:
            nomes, linhas = tabela(cur, f"SELECT * FROM {t} WHERE {campo} = :c{filtro} AND ROWNUM <= 5", c=cod)
            print(f"\n{t} {campo}={cod}:", nomes)
            for r in linhas:
                print("   ", r)
        except oracledb.Error as e:
            print(f"{t}: {e}")
    conn.rollback()
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
