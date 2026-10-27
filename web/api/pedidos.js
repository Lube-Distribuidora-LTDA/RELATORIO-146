/**
 * /api/pedidos — os pedidos por trás de um número da tela (o "detalhe" de cada clique).
 *
 *   ?de=AAAA-MM-DD&ate=AAAA-MM-DD   datas do pedido (obrigatórias; no máximo 400 dias)
 *   &uf=ES,RJ                       UF do cliente (cadastro atual, como no painel)
 *   &sup=1,6,-1                     supervisor (-1 = pedido sem supervisor)
 *   &fil=1,12                       filial
 *   &rca=123,456                    RCA
 *   &reg=ES,BA,RJ,INTERNA,FORA      região dos cartões (equipes do supervisor)
 *
 * Devolve até 5.000 pedidos, do mais novo para o mais velho, e os totais do recorte inteiro.
 * Cliente, cidade, RCA e supervisor vêm do cadastro atual (core.dim_*), como o pacote do painel.
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

const LIMITE = 5000;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function lista(q, nome, re) {
  const v = q.get(nome);
  if (!v) return null;
  const itens = v.split(",").map((x) => x.trim()).filter((x) => re.test(x));
  return itens.length ? itens : null;
}

const SQL = `
WITH p AS (
  SELECT pe.numped, pe.data, pe.hora, pe.minuto, pe.codfilial, COALESCE(dc.uf, pe.uf) AS uf,
         pe.codsupervisor, COALESCE(ds.nome, pe.supervisor) AS supervisor,
         pe.codusur, COALESCE(dr.nome, pe.rca) AS rca, pe.codcli, dc.cliente, dc.cidade,
         pe.posicao, pe.condvenda, pe.venda,
         CASE WHEN pe.custo_liq IS NULL THEN NULL ELSE COALESCE(pe.venda, 0) - pe.custo_liq END AS lucro,
         pe.qtitens,
         CASE WHEN g.grupo IN ('ES', 'BA', 'RJ', 'INTERNA') THEN g.grupo ELSE 'FORA' END AS regiao
    FROM relatorio146.pedido pe
    LEFT JOIN core.dim_cliente dc ON dc.codcli = pe.codcli
    LEFT JOIN core.dim_supervisor ds ON ds.codsupervisor = pe.codsupervisor
    LEFT JOIN core.dim_rca dr ON dr.codusur = pe.codusur
    LEFT JOIN relatorio146.grupo_supervisor g ON g.codsupervisor = pe.codsupervisor
   WHERE pe.data BETWEEN $1::date AND $2::date
),
f AS (
  SELECT * FROM p
   WHERE ($3::text[] IS NULL OR COALESCE(uf, '') = ANY($3))
     AND ($4::int[]  IS NULL OR COALESCE(codsupervisor, -1) = ANY($4))
     AND ($5::text[] IS NULL OR codfilial = ANY($5))
     AND ($6::int[]  IS NULL OR codusur = ANY($6))
     AND ($7::text[] IS NULL OR regiao = ANY($7))
)
SELECT (SELECT json_build_object('pedidos', count(*), 'venda', sum(venda), 'lucro', sum(lucro),
                                 'clientes', count(DISTINCT codcli), 'itens', sum(qtitens)) FROM f) AS totais,
       (SELECT COALESCE(json_agg(t), '[]') FROM (
          SELECT numped, to_char(data, 'YYYY-MM-DD') AS data, hora, minuto, codfilial, uf, codsupervisor, supervisor,
                 codusur, rca, codcli, cliente, cidade, posicao, condvenda, venda, lucro, qtitens, regiao
            FROM f ORDER BY data DESC, hora DESC NULLS LAST, minuto DESC NULLS LAST, numped DESC
           LIMIT ${LIMITE}) t) AS linhas`;

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const de = q.get("de"), ate = q.get("ate");
    if (!DATA.test(de || "") || !DATA.test(ate || "")) return json(res, 400, { erro: "datas", mensagem: "Informe de e ate (AAAA-MM-DD)." });
    if ((new Date(ate) - new Date(de)) / 864e5 > 400) return json(res, 400, { erro: "periodo", mensagem: "Escolha no máximo 400 dias para ver os pedidos." });
    const ufs = lista(q, "uf", /^[A-Z]{0,2}$/);
    const sup = lista(q, "sup", /^-?\d{1,6}$/);
    const fil = lista(q, "fil", /^\d{1,3}$/);
    const rca = lista(q, "rca", /^\d{1,7}$/);
    const reg = lista(q, "reg", /^(ES|BA|RJ|INTERNA|FORA)$/);
    const r = await consultar(SQL, [de, ate, ufs, sup && sup.map(Number), fil, rca && rca.map(Number), reg]);
    const l = r.rows[0] || {};
    json(res, 200, { limite: LIMITE, totais: l.totais || {}, linhas: l.linhas || [] });
  } catch (e) {
    erroBanco(res, e);
  }
};
