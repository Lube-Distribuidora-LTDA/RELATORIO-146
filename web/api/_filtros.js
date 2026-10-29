/**
 * _filtros.js — os filtros da tela, iguais para /api/pedidos e /api/resumo (arquivo com "_" no
 * começo não vira rota na Vercel).
 *
 *   ?de=AAAA-MM-DD&ate=AAAA-MM-DD   datas do pedido (obrigatórias; no máximo 400 dias)
 *   &uf=ES,RJ  &sup=1,6,-1  &fil=1,12  &rca=123  &reg=ES,BA,RJ,INTERNA,FORA      os filtros do painel
 *   &cli=603                                       cliente (o caminho Supervisor → RCA → Cliente)
 *   &sel=fat|naofat                                Selecionar da 146: só faturados / só não faturados
 *   &tipo=F|J                                      Clientes da 146: físicos / jurídicos
 *   &plano= &cob= &emit= &orig= &regp= &area= &classe= &caixa= &forn=
 *                                                  a linha clicada nas outras abas da 146 ("_" = sem)
 *
 * Devolve { erro } ou { de, ate, onde (SQL com $n), vals, extras, metaOk }. `extras` diz se há
 * filtro que o pacote do navegador não conhece (a trajetória some); `metaOk` diz se a meta ainda
 * faz sentido (filtro por cliente, UF, tipo etc. não divide a meta).
 */
"use strict";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const BASE = `relatorio146.pedido pe
    LEFT JOIN core.dim_cliente dc ON dc.codcli = pe.codcli
    LEFT JOIN relatorio146.grupo_supervisor g ON g.codsupervisor = pe.codsupervisor`;
const REGIAO = "(CASE WHEN g.grupo IN ('ES', 'BA', 'RJ', 'INTERNA') THEN g.grupo ELSE 'FORA' END)";

function lista(q, nome, re) {
  const v = q.get(nome);
  if (!v) return null;
  const itens = v.split(",").map((x) => x.trim()).filter((x) => re.test(x));
  return itens.length ? itens : null;
}

function filtros(q, maxDias) {
  const de = q.get("de"), ate = q.get("ate");
  if (!DATA.test(de || "") || !DATA.test(ate || "")) return { erro: "Informe de e ate (AAAA-MM-DD)." };
  if ((new Date(ate) - new Date(de)) / 864e5 > (maxDias || 400)) return { erro: "Escolha no máximo " + (maxDias || 400) + " dias." };
  const vals = [de, ate], onde = ["pe.data BETWEEN $1::date AND $2::date"];
  let extras = false, metaOk = true;
  const add = (sql, v, tipo) => { vals.push(v); onde.push(sql.replace("$?", "$" + vals.length + "::" + tipo)); };
  const num = (x) => x.map(Number);

  const ufs = lista(q, "uf", /^[A-Z]{0,2}$/);
  if (ufs) { add("COALESCE(dc.uf, pe.uf, '') = ANY($?)", ufs, "text[]"); metaOk = false; }
  const sup = lista(q, "sup", /^-?\d{1,6}$/);
  if (sup) add("COALESCE(pe.codsupervisor, -1) = ANY($?)", num(sup), "int[]");
  const fil = lista(q, "fil", /^\d{1,3}$/);
  if (fil) add("pe.codfilial = ANY($?)", fil, "text[]");
  const rca = lista(q, "rca", /^\d{1,7}$/);
  if (rca) add("pe.codusur = ANY($?)", num(rca), "int[]");
  const reg = lista(q, "reg", /^(ES|BA|RJ|INTERNA|FORA)$/);
  if (reg) add(REGIAO + " = ANY($?)", reg, "text[]");

  const cli = lista(q, "cli", /^\d{1,9}$/);
  if (cli) { add("pe.codcli = ANY($?)", num(cli), "int[]"); extras = true; metaOk = false; }
  const sel = q.get("sel");
  if (sel === "fat") { onde.push("pe.posicao = 'F'"); extras = true; metaOk = false; }
  if (sel === "naofat") { onde.push("pe.posicao <> 'F'"); extras = true; metaOk = false; }
  const tipo = q.get("tipo");
  if (tipo === "F" || tipo === "J") { add("pe.tipofj = $?", tipo, "text"); extras = true; metaOk = false; }

  // a linha clicada nas outras abas ("_" = a linha "sem ..." daquela aba)
  const dims = [
    ["plano", "COALESCE(pe.codplpag, -1)", /^(-?\d{1,6}|_)$/, "int[]"],
    ["cob", "COALESCE(pe.codcob, '_')", /^([A-Z0-9]{1,8}|_)$/, "text[]"],
    ["emit", "COALESCE(pe.codemitente, -1)", /^(-?\d{1,9}|_)$/, "int[]"],
    ["orig", "COALESCE(pe.origemped, '_')", /^([A-Z0-9]{1,3}|_)$/, "text[]"],
    ["regp", "COALESCE(pe.numregiao, -1)", /^(-?\d{1,6}|_)$/, "int[]"],
    ["area", "COALESCE(pe.areaatuacao, '_')", /^([A-Z0-9]{1,3}|_)$/, "text[]"],
    ["classe", "COALESCE(pe.classevenda, '_')", /^([A-Z0-9]{1,3}|_)$/, "text[]"],
    ["caixa", "COALESCE(pe.numcaixa, -1)", /^(-?\d{1,6}|_)$/, "int[]"],
  ];
  for (const [nome, col, re, tipoSql] of dims) {
    const v = lista(q, nome, re);
    if (!v) continue;
    const vv = tipoSql === "int[]" ? v.map((x) => (x === "_" ? -1 : Number(x))) : v;
    add(col + " = ANY($?)", vv, tipoSql);
    extras = true; metaOk = false;
  }
  const forn = lista(q, "forn", /^\d{1,9}$/);
  if (forn) {
    add(`EXISTS (SELECT 1 FROM relatorio146.item fi JOIN inventario.produto fp ON fp.codprod = fi.codprod
                  WHERE fi.numped = pe.numped AND fp.codfornec = ANY($?))`, num(forn), "int[]");
    extras = true; metaOk = false;
  }
  return { de, ate, onde: onde.join("\n     AND "), vals, extras, metaOk, sup, rca, fil, reg };
}

module.exports = { filtros, BASE, REGIAO, lista };
