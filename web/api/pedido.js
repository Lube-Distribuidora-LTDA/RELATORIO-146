/**
 * /api/pedido?numped=<número> — um pedido com tudo o que tem nele, para a tela lateral que abre
 * ao clicar no pedido (pedido do Júlio, 2026-10-29).
 *
 * Cabeçalho de relatorio146.pedido (cliente, RCA e supervisor do cadastro atual, como a lista) e
 * os itens de relatorio146.item, que o AGENTE LUBE grava só para os últimos 62 dias: pedido mais
 * antigo volta sem itens e com `itens_desde`, para a tela explicar. Tudo numa função do banco,
 * relatorio146.pedido_detalhe().
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  const n = new URL(req.url, "http://x").searchParams.get("numped");
  if (!/^\d{1,12}$/.test(n || "")) return json(res, 400, { erro: "numped", mensagem: "Informe o número do pedido." });
  try {
    const r = await consultar("SELECT relatorio146.pedido_detalhe($1::bigint) AS d", [n]);
    const d = (r.rows[0] && r.rows[0].d) || {};
    if (!d.pedido) return json(res, 404, { erro: "nao_encontrado", mensagem: "O pedido " + n + " não está no Relatório 146." });
    json(res, 200, d);
  } catch (e) {
    erroBanco(res, e);
  }
};
