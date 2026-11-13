/**
 * /api/positivacao — o cartão "Positivação" da Visão geral (pedido do Júlio, 2026-11-13): clientes
 * diferentes com pedido no recorte. É a mesma conta de "Clientes atendidos" e "Qt.clientes pos." da
 * aba Pedidos (COUNT DISTINCT do cliente dos pedidos da regra da 146).
 *
 *   ?de&ate e os filtros de _filtros.js (a tela manda reg=ES,BA,RJ,FORA para deixar a operação
 *   interna de fora, como a venda da Visão geral)
 *   &pa=AAAA-MM-DD,AAAA-MM-DD  &aa=AAAA-MM-DD,AAAA-MM-DD   períodos das comparações (opcionais)
 *   &interna=1                 também conta os clientes da operação interna no período, à parte
 *
 * O pacote do navegador soma dia × UF × supervisor × RCA × filial, sem o cliente: cliente distinto não
 * se soma de pedaços, por isso a conta vem do banco. Uma consulta só, uma conexão só.
 * Devolve { clientes, pa, aa, interna } (null no que não foi pedido).
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");
const { filtros, BASE } = require("./_filtros");

const PAR = /^(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})$/;
const MAX_DIAS = 1200;     // "Tudo" vai de 2025-01-01 até hoje; é só uma contagem

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const vals = [], partes = [];
    // cada parte é o mesmo filtro em outro período (ou com a região trocada); os $n de cada uma andam para frente
    const parte = (nome, de, ate, reg) => {
      const qq = new URLSearchParams(q);
      qq.set("de", de); qq.set("ate", ate);
      if (reg) qq.set("reg", reg);
      const f = filtros(qq, MAX_DIAS);
      if (f.erro) return f.erro;
      const desloca = vals.length;
      vals.push(...f.vals);
      const onde = f.onde.replace(/\$(\d+)/g, (_, n) => "$" + (Number(n) + desloca));
      partes.push(`'${nome}', (SELECT COUNT(DISTINCT pe.codcli) FROM ${BASE} WHERE ${onde})`);
      return null;
    };
    let erro = parte("clientes", q.get("de"), q.get("ate"));
    for (const nome of ["pa", "aa"]) {
      const m = PAR.exec(q.get(nome) || "");
      if (!erro && m) erro = parte(nome, m[1], m[2]);
    }
    if (!erro && q.get("interna") === "1") erro = parte("interna", q.get("de"), q.get("ate"), "INTERNA");
    if (erro) return json(res, 400, { erro: "filtros", mensagem: erro });

    const r = await consultar(`SELECT json_build_object(${partes.join(", ")}) AS r`, vals);
    const out = (r.rows[0] && r.rows[0].r) || {};
    json(res, 200, { de: q.get("de"), ate: q.get("ate"), clientes: out.clientes ?? null,
                     pa: out.pa ?? null, aa: out.aa ?? null, interna: out.interna ?? null });
  } catch (e) {
    erroBanco(res, e);
  }
};
