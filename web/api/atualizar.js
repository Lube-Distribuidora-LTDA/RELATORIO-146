/**
 * /api/atualizar (POST) — o botão Atualizar pede ao AGENTE LUBE uma leitura do WinThor agora.
 *
 * A ponte é o próprio banco: agente.pedir_atualizacao() grava o pedido e avisa por NOTIFY;
 * o agente, na SRV-IA, escuta na conexão que já mantém aberta para fora, lê os pedidos no
 * WinThor na hora, remonta o pacote que mudou e responde no pedido (agente.pedido). Nenhuma
 * porta aberta na rede da Lube, e o painel nunca chega no Oracle. O navegador acompanha por
 * /api/versao?pedido=<id>. Dez cliques seguidos viram uma leitura só.
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { erro: "metodo", mensagem: "Use POST." }, { Allow: "POST" });
  if (semConfiguracao(res)) return;
  try {
    const r = await consultar(
      `WITH a AS (SELECT max(visto_em) AS visto, bool_or(ligado) AS ligado FROM agente.batimento WHERE visto_em > now() - interval '3 minutes')
       SELECT a.visto, coalesce(a.ligado, false) AS ligado,
              CASE WHEN a.visto IS NOT NULL AND a.ligado THEN agente.pedir_atualizacao('relatorio146', 'painel relatorio-146') END AS pedido
         FROM a`, []);
    const l = r.rows[0] || {};
    if (!l.pedido) {
      return json(res, 200, { agente: false, visto_em: l.visto || null,
        mensagem: l.visto ? "O agente do WinThor está em pausa." : "O agente do WinThor não está ligado agora." });
    }
    json(res, 200, { agente: true, pedido: Number(l.pedido) });
  } catch (e) {
    erroBanco(res, e);
  }
};
