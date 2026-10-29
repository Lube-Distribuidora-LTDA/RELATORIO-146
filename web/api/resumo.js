/**
 * /api/resumo — a tela "Resumo de Vendas" da rotina 146 do WinThor (pedido do Júlio, 2026-10-29: a aba
 * Pedidos "siga a mesma maneira que as telas do WinThor com as mesmas abas").
 *
 *   ?por=sup|rca|cli|dia|prazo|cobranca|emitente|regiao|area|classe|origem|checkout|fornecedor
 *   &de&ate e os filtros de _filtros.js
 *
 * Cada linha traz as colunas da 146, com as contas conferidas contra os prints do Júlio (01 a
 * 29/10/2026; ver db/04-resumo-winthor.sql): pedidos, clientes positivados, RCAs, visitas (cliente ×
 * dia com pedido), venda, tabela, bonificação, CMV, CMV real, Qt.itens (linhas fora das condições
 * 5, 6, 11, 12), média de itens (NUMITENS ÷ pedidos), prazo médio (ponderado pela venda), peso,
 * mix (produtos distintos dos pedidos com venda; só com itens, 62 dias), meta (PCMETASUP/PCMETARCA)
 * e, por RCA, os clientes cadastrados (RCA 1 ou 2, cadastrados até o fim do período).
 * Os totais são o rodapé da 146 (Clientes, Pedidos, Vendas, Bonif./Desc.).
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");
const { filtros, BASE, REGIAO } = require("./_filtros");

const SUP = "LEFT JOIN core.dim_supervisor ds ON ds.codsupervisor = pe.codsupervisor";
const POR = {
  sup: { k: "pe.codsupervisor", nome: "COALESCE(ds.nome, pe.supervisor)", joins: SUP },
  rca: { k: "pe.codusur", nome: "COALESCE(dr.nome, pe.rca)", joins: "LEFT JOIN core.dim_rca dr ON dr.codusur = pe.codusur " + SUP,
         mais: [["pe.codsupervisor", "codsupervisor"], ["COALESCE(ds.nome, pe.supervisor)", "supervisor"]] },
  cli: { k: "pe.codcli", nome: "dc.cliente", mais: [["dc.cidade", "cidade"], ["COALESCE(dc.uf, pe.uf)", "uf"]] },
  dia: { k: "to_char(pe.data, 'YYYY-MM-DD')", nome: "NULL::text" },
  prazo: { k: "COALESCE(pe.codplpag, -1)", nome: "pl.descricao", joins: "LEFT JOIN relatorio146.plano pl ON pl.codplpag = pe.codplpag",
           mais: [["pl.numdias", "numdias"]] },
  cobranca: { k: "COALESCE(pe.codcob, '_')", nome: "cb.cobranca", joins: "LEFT JOIN relatorio146.cobranca cb ON cb.codcob = pe.codcob" },
  emitente: { k: "COALESCE(pe.codemitente, -1)", nome: "em.nome", joins: "LEFT JOIN relatorio146.emitente em ON em.matricula = pe.codemitente" },
  regiao: { k: "COALESCE(pe.numregiao, -1)", nome: "rg.regiao", joins: "LEFT JOIN relatorio146.regiao rg ON rg.numregiao = pe.numregiao",
            mais: [["rg.uf", "uf"]] },
  area: { k: "COALESCE(pe.areaatuacao, '_')", nome: "ar.descricao", joins: "LEFT JOIN relatorio146.area ar ON ar.codigo = pe.areaatuacao" },
  classe: { k: "COALESCE(pe.classevenda, '_')", nome: "NULL::text" },
  origem: { k: "COALESCE(pe.origemped, '_')", nome: "NULL::text" },
  checkout: { k: "COALESCE(pe.numcaixa, -1)", nome: "NULL::text" },
};

// dia de hoje em Brasília e o fator da projeção (dias úteis de segunda a sexta)
function hojeBrasilia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function diasUteis(de, ate) {
  let n = 0;
  for (let d = new Date(de + "T12:00:00Z"); d <= new Date(ate + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const s = d.getUTCDay();
    if (s !== 0 && s !== 6) n++;
  }
  return n;
}
function fatorProjecao(de, ate, hoje) {
  if (ate <= hoje) return 1;
  const feitos = diasUteis(de, hoje < de ? de : hoje), todos = diasUteis(de, ate);
  return feitos ? todos / feitos : null;
}
function menosDias(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/* totais do rodapé, a partir dos pedidos do recorte (b) */
const TOTAIS = `SELECT COUNT(*) AS pedidos, COUNT(DISTINCT codcli) AS cli_pos, COUNT(DISTINCT codusur) AS rcas,
         COUNT(DISTINCT codcli::text || '|' || data) AS visitas,
         SUM(venda) AS venda, SUM(vltabela) AS tabela, SUM(bonific) AS bonif, SUM(custo_liq) AS cmv, SUM(custo_real) AS cmv_real,
         SUM(CASE WHEN condvenda IN (5,6,11,12) THEN 0 ELSE linhas END) AS qt_itens,
         SUM(numitens)::numeric / NULLIF(COUNT(*), 0) AS media_itens,
         SUM(prazo * venda) / NULLIF(SUM(venda), 0) AS pz_medio, SUM(peso) AS peso
    FROM b`;
const COLS_B = `pe.numped, pe.data, pe.codcli, pe.codusur, pe.codsupervisor, pe.condvenda, pe.venda, pe.vltabela, pe.bonific,
           pe.custo_liq, pe.custo_real, pe.linhas, pe.numitens, pe.prazo, pe.peso`;

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const por = q.get("por") || "sup";
    if (!POR[por] && por !== "fornecedor") return json(res, 400, { erro: "por", mensagem: "Agrupamento desconhecido." });
    const f = filtros(q);
    if (f.erro) return json(res, 400, { erro: "filtros", mensagem: f.erro });
    const vals = f.vals.slice();
    const p = (v, tipo) => { vals.push(v); return "$" + vals.length + "::" + tipo; };
    const hoje = hojeBrasilia(), itensDesde = menosDias(hoje, 62), mixOk = f.de >= itensDesde;

    // meta e carteira do total: só sem filtro que divida a meta (cliente, UF, tipo, as outras abas)
    const filMeta = f.fil ? ` AND m.codfilial = ANY(${p(f.fil, "text[]")})` : "";
    let metaTot = "NULL::numeric", rcasCart = null;
    if (f.metaOk) {
      if (f.rca) {
        metaTot = `(SELECT SUM(m.valor) FROM relatorio146.meta_rca m WHERE m.data BETWEEN $1::date AND $2::date
                      AND m.codusur = ANY(${p(f.rca.map(Number), "int[]")})${filMeta})`;
        rcasCart = `SELECT unnest(${p(f.rca.map(Number), "int[]")}) AS r`;
      } else {
        const cs = [];
        if (f.sup) cs.push(`COALESCE(m.codsupervisor, -1) = ANY(${p(f.sup.map(Number), "int[]")})`);
        if (f.reg) cs.push(`${REGIAO} = ANY(${p(f.reg, "text[]")})`);
        metaTot = `(SELECT SUM(m.valor) FROM relatorio146.meta_sup m LEFT JOIN relatorio146.grupo_supervisor g ON g.codsupervisor = m.codsupervisor
                     WHERE m.data BETWEEN $1::date AND $2::date${filMeta}${cs.length ? " AND " + cs.join(" AND ") : ""})`;
        if (cs.length) rcasCart = `SELECT r.codusur AS r FROM core.dim_rca r LEFT JOIN relatorio146.grupo_supervisor g ON g.codsupervisor = r.codsupervisor
                                     WHERE ${cs.join(" AND ").replace(/m\.codsupervisor/g, "r.codsupervisor")}`;
      }
    }
    // "cadastrados até o fim do período" como a 146 compara: DTCADASTRO (com hora) <= o último dia à meia-noite,
    // ou seja, quem foi cadastrado NO último dia fica de fora (RCA 1255: 87, não 88)
    const cartTot = rcasCart
      ? `(SELECT COUNT(DISTINCT x.codcli) FROM (
            SELECT c.codcli FROM relatorio146.cliente c WHERE c.codusur1 IN (${rcasCart}) AND (c.dtcadastro IS NULL OR c.dtcadastro < $2::date)
            UNION SELECT c.codcli FROM relatorio146.cliente c WHERE c.codusur2 IN (${rcasCart}) AND (c.dtcadastro IS NULL OR c.dtcadastro < $2::date)) x)`
      : `(SELECT COUNT(*) FROM relatorio146.cliente c WHERE c.dtexclusao IS NULL AND (c.dtcadastro IS NULL OR c.dtcadastro < $2::date))`;

    let sql;
    if (por === "fornecedor") {
      if (!mixOk) return json(res, 200, { por, linhas: [], totais: {}, itens_desde: itensDesde, sem_itens: true });
      sql = `
WITH b AS (SELECT ${COLS_B} FROM ${BASE} WHERE ${f.onde}),
it AS (
  SELECT COALESCE(pr.codfornec, -1) AS k, pr.fornecedor, b.numped, b.codcli, b.condvenda, b.venda AS venda_ped, i.codprod,
         COALESCE(i.qt, 0) AS qt, COALESCE(i.pvenda, 0) AS pvenda, COALESCE(i.ptabela, 0) AS ptabela, COALESCE(i.st, 0) AS st,
         COALESCE(i.vlcustofin, 0) AS custo, COALESCE(i.vlcustoreal, 0) AS custo_real, COALESCE(i.pbonific, 0) AS pbonific,
         (b.condvenda IN (5,6,11,12) OR COALESCE(i.bonific, 'N') <> 'N') AS zero
    FROM b JOIN relatorio146.item i ON i.numped = b.numped LEFT JOIN inventario.produto pr ON pr.codprod = i.codprod),
g AS (
  SELECT k, MAX(fornecedor) AS nome, COUNT(DISTINCT numped) AS pedidos, COUNT(DISTINCT codcli) AS cli_pos,
         SUM(CASE WHEN zero THEN 0 ELSE qt * (pvenda - st) END) AS venda,
         SUM(CASE WHEN zero THEN 0 ELSE qt * (ptabela - st) END) AS tabela,
         SUM(qt * pbonific) - SUM(CASE WHEN condvenda = 5 THEN qt * st ELSE 0 END) AS bonif,
         SUM(qt * custo - qt * st) AS cmv, SUM(qt * custo_real - qt * st) AS cmv_real,
         SUM(CASE WHEN condvenda IN (5,6,11,12) THEN 0 ELSE 1 END) AS qt_itens,
         COUNT(DISTINCT CASE WHEN venda_ped > 0 THEN codprod END) AS mix
    FROM it GROUP BY k)
SELECT json_build_object(
  'linhas', COALESCE((SELECT json_agg(g) FROM g), '[]'),
  'totais', (SELECT row_to_json(t) FROM (${TOTAIS}) t),
  'mix', (SELECT COUNT(DISTINCT i.codprod) FROM b JOIN relatorio146.item i ON i.numped = b.numped WHERE b.venda > 0),
  'meta', ${metaTot}, 'cli_cad', ${cartTot}) AS r`;
    } else {
      const d = POR[por], mais = d.mais || [];
      const maisB = mais.map(([e, a]) => `, ${e} AS x_${a}`).join("");
      const maisG = mais.map(([, a]) => `, MAX(x_${a}) AS ${a}`).join("");
      let meta = "mt AS (SELECT k, NULL::numeric AS meta FROM g WHERE false)";
      if (por === "sup") meta = `mt AS (SELECT m.codsupervisor AS k, SUM(m.valor) AS meta FROM relatorio146.meta_sup m
                                         WHERE m.data BETWEEN $1::date AND $2::date${filMeta} GROUP BY 1)`;
      if (por === "rca") meta = `mt AS (SELECT m.codusur AS k, SUM(m.valor) AS meta FROM relatorio146.meta_rca m
                                         WHERE m.data BETWEEN $1::date AND $2::date${filMeta} GROUP BY 1)`;
      const cad = por === "rca"
        ? `cad AS (SELECT x.r AS k, COUNT(DISTINCT x.codcli) AS cli_cad FROM (
              SELECT c.codusur1 AS r, c.codcli FROM relatorio146.cliente c WHERE c.codusur1 IN (SELECT k FROM g) AND (c.dtcadastro IS NULL OR c.dtcadastro < $2::date)
              UNION ALL
              SELECT c.codusur2, c.codcli FROM relatorio146.cliente c WHERE c.codusur2 IN (SELECT k FROM g) AND (c.dtcadastro IS NULL OR c.dtcadastro < $2::date)) x
            GROUP BY x.r)`
        : "cad AS (SELECT k, NULL::bigint AS cli_cad FROM g WHERE false)";
      const mx = mixOk
        ? `mx AS (SELECT b.k, COUNT(DISTINCT i.codprod) AS mix FROM b JOIN relatorio146.item i ON i.numped = b.numped WHERE b.venda > 0 GROUP BY b.k)`
        : "mx AS (SELECT k, NULL::bigint AS mix FROM g WHERE false)";
      sql = `
WITH b AS (
  SELECT ${COLS_B}, ${d.k} AS k, ${d.nome} AS x_nome${maisB}
    FROM ${BASE} ${d.joins || ""}
   WHERE ${f.onde}
),
g AS (
  SELECT k, MAX(x_nome) AS nome${maisG},
         COUNT(*) AS pedidos, COUNT(DISTINCT codcli) AS cli_pos, COUNT(DISTINCT codusur) AS rcas,
         COUNT(DISTINCT codcli::text || '|' || data) AS visitas,
         SUM(venda) AS venda, SUM(vltabela) AS tabela, SUM(bonific) AS bonif, SUM(custo_liq) AS cmv, SUM(custo_real) AS cmv_real,
         SUM(CASE WHEN condvenda IN (5,6,11,12) THEN 0 ELSE linhas END) AS qt_itens,
         SUM(numitens)::numeric / COUNT(*) AS media_itens,
         SUM(prazo * venda) / NULLIF(SUM(venda), 0) AS pz_medio, SUM(peso) AS peso
    FROM b GROUP BY k
),
${meta}, ${cad}, ${mx}
SELECT json_build_object(
  'linhas', COALESCE((SELECT json_agg(x) FROM (
      SELECT g.*, mx.mix, mt.meta, cad.cli_cad FROM g LEFT JOIN mx USING (k) LEFT JOIN mt USING (k) LEFT JOIN cad USING (k)) x), '[]'),
  'totais', (SELECT row_to_json(t) FROM (${TOTAIS}) t),
  'mix', ${mixOk ? "(SELECT COUNT(DISTINCT i.codprod) FROM b JOIN relatorio146.item i ON i.numped = b.numped WHERE b.venda > 0)" : "NULL"},
  'meta', ${metaTot}, 'cli_cad', ${cartTot}) AS r`;
    }
    const r = await consultar(sql, vals);
    const out = (r.rows[0] && r.rows[0].r) || {};
    json(res, 200, Object.assign({ por, de: f.de, ate: f.ate, hoje, itens_desde: itensDesde, mix_ok: mixOk,
                                    proj_fator: fatorProjecao(f.de, f.ate, hoje), meta_ok: f.metaOk }, out));
  } catch (e) {
    erroBanco(res, e);
  }
};
