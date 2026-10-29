"""
SO LEITURA. Confere a /api/resumo do painel (servidor local, porta 3106) contra os prints da rotina
146 do WinThor (referencias-winthor-146.json, fora do Git): por supervisor, por RCA do supervisor 7 e
o rodape. Diferenca so pode vir de pedido feito depois do print.

Uso: python -X utf8 conferir_resumo_api.py [http://localhost:3106]
"""
import json
import os
import sys
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))


def api(base, qs):
    with urllib.request.urlopen(f"{base}/api/resumo?{qs}", timeout=120) as r:
        return json.load(r)


def n(x):
    return float(x or 0)


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3106"
    ref = json.load(open(os.path.join(AQUI, "referencias-winthor-146.json"), encoding="utf-8"))
    de, ate = ref["periodo"]
    r = api(base, f"por=sup&de={de}&ate={ate}")
    got = {int(l["k"]): l for l in r["linhas"]}
    cols = ref["colunas_sup"]
    campos = [("pedidos", "pedidos", 0), ("cli_pos", "cli_pos", 0), ("rcas", "rcas", 0), ("meta", "meta", 0.01),
              ("venda", "venda", 0.01), ("bonif", "bonif", 0.01), ("tabela", "tabela", 0.01), ("cmv", "cmv", 0.01),
              ("cmv_real", "cmv_real", 0.01), ("qt_itens", "qt_itens", 0), ("peso", "peso", 0.001), ("mix", "mix", 0)]
    print("Por supervisor: colunas iguais / diferentes (WinThor -> painel)")
    iguais = total = 0
    for linha in ref["supervisores"]:
        w = dict(zip(cols, linha))
        g = got.get(w["cod"], {})
        dif = []
        for cw, cg, tol in campos:
            total += 1
            if abs(n(w[cw]) - n(g.get(cg))) <= tol + 1e-9:
                iguais += 1
            else:
                dif.append(f"{cw} {w[cw]:,} -> {n(g.get(cg)):,.2f}")
        media = round(n(g.get("media_itens")), 2)
        pz = round(n(g.get("pz_medio")))
        extra = [] if (media == w["media_itens"] and pz == w["pz_medio"]) else [f"media {w['media_itens']}->{media} pz {w['pz_medio']}->{pz}"]
        print(f"  {w['cod']:>3}: {'tudo igual' if not dif and not extra else '; '.join(dif + extra)}")
    print(f"  {iguais} de {total} valores iguais")

    t = r["totais"]
    w = ref["totais"]
    print(f"\nRodape: pedidos {w['pedidos']} -> {t['pedidos']}; positivados {w['cli_pos']} -> {t['cli_pos']};"
          f" cadastrados {w['cli_cad']} -> {r['cli_cad']}; venda {w['venda']:,.2f} -> {n(t['venda']):,.2f};"
          f" meta {w['meta']:,.2f} -> {n(r['meta']):,.2f}; peso {w['peso']:,.3f} -> {n(t['peso']):,.3f};"
          f" media itens {w['media_itens']} -> {n(t['media_itens']):.2f}; prazo {w['pz_medio']} -> {n(t['pz_medio']):.2f}")

    r = api(base, f"por=rca&sup=7&de={de}&ate={ate}")
    got = {int(l["k"]): l for l in r["linhas"]}
    cols = ref["colunas_rca"]
    campos = [("pedidos", "pedidos", 0), ("cli_pos", "cli_pos", 0), ("visitas", "visitas", 0), ("cli_cad", "cli_cad", 0),
              ("meta", "meta", 0.01), ("venda", "venda", 0.01), ("tabela", "tabela", 0.01), ("cmv", "cmv", 0.01),
              ("cmv_real", "cmv_real", 0.01), ("qt_itens", "qt_itens", 0), ("peso", "peso", 0.001), ("bonif", "bonif", 0.01),
              ("mix", "mix", 0)]
    print("\nPor RCA do supervisor 7")
    iguais = total = 0
    for linha in ref["rcas_sup7"]:
        w = dict(zip(cols, linha))
        g = got.get(w["cod"], {})
        dif = []
        for cw, cg, tol in campos:
            total += 1
            if abs(n(w[cw]) - n(g.get(cg))) <= tol + 1e-9:
                iguais += 1
            else:
                dif.append(f"{cw} {w[cw]:,} -> {n(g.get(cg)):,.2f}")
        print(f"  {w['cod']:>5}: {'tudo igual' if not dif else '; '.join(dif)}")
    print(f"  {iguais} de {total} valores iguais")


if __name__ == "__main__":
    sys.exit(main())
