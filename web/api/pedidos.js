/**
 * /api/pedidos — os pedidos por trás de um número da tela (o "detalhe" de cada clique, a aba Analítico
 * e a tela "Pedidos do cliente" da 146).
 *
 *   ?de&ate e os filtros de _filtros.js (UF, supervisor, filial, RCA, região, cliente, faturados,
 *   físicos/jurídicos e a linha clicada nas outras abas)
 *
 * Devolve até 5.000 pedidos, do mais novo para o mais velho, e os totais do recorte inteiro.
 * Cliente, cidade, RCA e supervisor vêm do cadastro atual (core.dim_*), como o pacote do painel; as
 * colunas da 146 (tabela, bonificação, CMV real, peso, carregamento, plano) vêm do pedido (ver
 * db/04-resumo-winthor.sql).
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");
const { filtros, BASE, REGIAO } = require("./_filtros");

const LIMITE = 5000;

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const f = filtros(q);
    if (f.erro) return json(res, 400, { erro: "filtros", mensagem: f.erro });
    const sql = `
WITH f AS (
  SELECT pe.numped, pe.data, pe.hora, pe.minuto, pe.codfilial, COALESCE(dc.uf, pe.uf) AS uf,
         pe.codsupervisor, COALESCE(ds.nome, pe.supervisor) AS supervisor,
         pe.codusur, COALESCE(dr.nome, pe.rca) AS rca, pe.codcli, dc.cliente, dc.cidade,
         pe.posicao, pe.condvenda, pe.venda,
         CASE WHEN pe.custo_liq IS NULL THEN NULL ELSE COALESCE(pe.venda, 0) - pe.custo_liq END AS lucro,
         pe.custo_liq AS cmv, pe.custo_real AS cmv_real, pe.vltabela AS tabela, pe.bonific AS bonif,
         pe.qtitens, pe.numitens, pe.linhas, pe.mix, pe.peso, pe.numcar, pe.codplpag, pl.descricao AS plano,
         pe.prazo, pe.origemped, pe.codcob, pe.dtfat, ${REGIAO} AS regiao
    FROM ${BASE}
    LEFT JOIN core.dim_supervisor ds ON ds.codsupervisor = pe.codsupervisor
    LEFT JOIN core.dim_rca dr ON dr.codusur = pe.codusur
    LEFT JOIN relatorio146.plano pl ON pl.codplpag = pe.codplpag
   WHERE ${f.onde}
)
SELECT (SELECT json_build_object('pedidos', count(*), 'venda', sum(venda), 'lucro', sum(lucro),
                                 'clientes', count(DISTINCT codcli), 'itens', sum(qtitens),
                                 'tabela', sum(tabela), 'bonif', sum(bonif), 'cmv', sum(cmv), 'cmv_real', sum(cmv_real),
                                 'peso', sum(peso)) FROM f) AS totais,
       (SELECT COALESCE(json_agg(t), '[]') FROM (
          SELECT numped, to_char(data, 'YYYY-MM-DD') AS data, hora, minuto, codfilial, uf, codsupervisor, supervisor,
                 codusur, rca, codcli, cliente, cidade, posicao, condvenda, venda, lucro, cmv, cmv_real, tabela, bonif,
                 qtitens, numitens, linhas, mix, peso, numcar, codplpag, plano, prazo, origemped, codcob,
                 to_char(dtfat, 'YYYY-MM-DD') AS dtfat, regiao
            FROM f ORDER BY data DESC, hora DESC NULLS LAST, minuto DESC NULLS LAST, numped DESC
           LIMIT ${LIMITE}) t) AS linhas`;
    const r = await consultar(sql, f.vals);
    const l = r.rows[0] || {};
    json(res, 200, { limite: LIMITE, extras: f.extras, totais: l.totais || {}, linhas: l.linhas || [] });
  } catch (e) {
    erroBanco(res, e);
  }
};
