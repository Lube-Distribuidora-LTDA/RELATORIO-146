/* =============================================================================
 * pag-visao.js — Visão geral: a tela "FATURAMENTO 146" do Power BI, com a cara da Lube.
 *
 * Mesmos números do original (seção 8 da documentação técnica), com o que estava errado lá
 * corrigido sem mudar o valor:
 *   · "hoje" e "semana" no dia de Brasília (o Power BI usava UTC: depois das 21h já era amanhã);
 *   · região sem venda mostra R$ 0, não " BA";
 *   · os meses do período em ordem de calendário (o cartão pegava o primeiro em ordem alfabética);
 *   · % por UF sempre sobre o total de todas as UFs (com uma UF marcada, o original passava de 100%);
 *   · ticket e % de lucro com "—" quando não há pedido (o original mostrava NaN/Infinito).
 * Os cartões regionais seguem POR EQUIPE (supervisor), e a participação POR UF DO CLIENTE: são
 * duas regras diferentes, e cada uma diz na tela o que conta.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.fR = function (v) { return L.fBRL(v, 0); };
L.fRc = function (v) { return L.fAbrev(v, true); };
var CLASSE_REG = { ES: "reg-es", BA: "reg-ba", RJ: "reg-rj", INTERNA: "reg-in" };
var ICONE_REG = { ES: "pino", BA: "pino", RJ: "pino", INTERNA: "armazem" };

L.registrarPagina({
  id: "visao", grupo: "Relatório 146", titulo: "Visão geral", menu: "Visão geral", icone: "home",
  olho: "Faturamento 146 · venda por pedido",
  filtros: ["uf", "regiao", "sup", "fil", "rca"],
  render: render,
});

/* venda, pedidos e lucro do recorte, no total e por região dos cartões */
function valores(idx) {
  var out = { tot: L.somar(idx), reg: {} };
  L.REGIOES.forEach(function (r) { out.reg[r.k] = L.somar(idx, function (i) { return L.regiaoDaLinha(i) === r.k; }); });
  return out;
}
function regiaoId(k) { return L.regiaoDeK(k).id; }

function render(raiz) {
  var p = L.periodo(), cmp = L.comparacoes(p);
  var atual = valores(L.filtrar(L.spec()));
  var pa = cmp.pa ? valores(L.filtrar(L.spec({ de: cmp.pa.de, ate: cmp.pa.ate }))) : null;
  var aa = cmp.aa ? valores(L.filtrar(L.spec({ de: cmp.aa.de, ate: cmp.aa.ate }))) : null;
  var meses = L.mesesDoPeriodo(p).map(function (m) { return L.MESES[m % 100 - 1]; });

  raiz.appendChild(L.h("div", { class: "linha-kpi-tit" }, L.h("h2", { text: "Vendas" }),
    L.h("span", { text: p.rot + (meses.length > 1 && meses.length <= 4 ? " · " + meses.join(" / ") : "") })));

  /* linha 1: venda no total e por região (equipes do supervisor) */
  function cmpDe(get) { return { pa: pa ? get(pa) : null, aa: aa ? get(aa) : null, cmp: cmp }; }
  function sub(rot, valor) { return L.h("span", { class: "sub", html: L.esc(rot) + " <b>" + L.esc(valor) + "</b>" }); }
  var t = atual.tot;
  var k1 = [L.kpi({ icone: "dinheiro", rot: "Total de vendas", valor: t.v, fmt: L.fR, fmtTitulo: function (v) { return L.fBRL(v, 2); }, classe: "heroi",
                    cmp: cmpDe(function (x) { return x.tot.v; }),
                    leg: sub("Lucro", L.fPct(t.pctLucro, 1)),
                    ajuda: "Venda dos pedidos do período (data do pedido): valor atendido menos outras despesas, frete e ST. Bonificação e troca contam como pedido com venda zero.",
                    aoClicar: function () { L.abrirPedidos({}, "Total de vendas"); } })];
  ["ES", "BA", "RJ", "INTERNA"].forEach(function (k) {
    var r = L.regiaoDeK(k), v = atual.reg[k];
    k1.push(L.kpi({ icone: ICONE_REG[k], rot: r.longo, valor: v.v, fmt: L.fR, fmtTitulo: function (x) { return L.fBRL(x, 2); }, classe: CLASSE_REG[k] + (v.v ? "" : " zero"),
      cmp: cmpDe(function (x) { return x.reg[k].v; }),
      leg: sub("do total", L.fPct(t.v ? v.v / t.v : null, 1)),
      ajuda: k === "INTERNA" ? "Venda do supervisor LUBE DISTRIBUIDORA (código 3)." : "Venda das equipes (supervisores) " + k + " — pelo supervisor do pedido, não pela UF do cliente.",
      aoClicar: function () { L.abrirPedidos({ f: { regiao: [r.id] } }, r.longo); } }));
  });
  raiz.appendChild(L.kpis.apply(null, k1));

  /* linha 2: ticket médio (venda ÷ pedidos) no total e por região, e os pedidos */
  var k2 = [L.kpi({ icone: "etiqueta", rot: "Ticket médio", valor: t.ticket, fmt: function (v) { return L.fBRL(v, 2); }, classe: t.q ? "" : "zero",
                    cmp: cmpDe(function (x) { return x.tot.ticket; }),
                    leg: sub("Pedidos", L.fInt(t.q)),
                    ajuda: "Venda ÷ quantidade de pedidos (bonificação e troca entram na conta dos pedidos, como no relatório original).",
                    aoClicar: function () { L.abrirPedidos({}, "Ticket médio"); } })];
  ["ES", "BA", "RJ"].forEach(function (k) {
    var r = L.regiaoDeK(k), v = atual.reg[k];
    k2.push(L.kpi({ icone: "etiqueta", rot: "Ticket " + r.longo.replace("Equipes ", "equipes "), valor: v.ticket, fmt: function (x) { return L.fBRL(x, 2); }, classe: CLASSE_REG[k] + (v.q ? "" : " zero"),
      cmp: cmpDe(function (x) { return x.reg[k].ticket; }),
      leg: sub("Pedidos", L.fInt(v.q)),
      aoClicar: function () { L.abrirPedidos({ f: { regiao: [r.id] } }, "Ticket " + r.longo); } }));
  });
  k2.push(L.kpi({ icone: "prancheta", rot: "Pedidos", valor: t.q, fmt: L.fInt, classe: t.q ? "" : "zero",
    cmp: cmpDe(function (x) { return x.tot.q; }),
    leg: sub("Operação interna", L.fInt(atual.reg.INTERNA.q)),
    aoClicar: function () { L.abrirPedidos({}, "Pedidos"); } }));
  raiz.appendChild(L.kpis.apply(null, k2));

  /* o que não entra em nenhum cartão regional (FARMA, INATIVO, supervisor novo) não some */
  var fora = atual.reg.FORA;
  if (fora.v || fora.q) {
    var porSup = L.agrupar(L.filtrar(L.spec({ f: { regiao: [regiaoId("FORA")] } })), function (i) { return L.R.s[i]; })
      .sort(function (a, b) { return b.v - a.v; });
    raiz.appendChild(L.h("div", { class: "fora-reg" }, L.icEl("info"),
      L.h("span", { html: "Fora dos cartões regionais: <b>" + L.esc(L.fBRL(fora.v, 2)) + "</b> em " + L.fInt(fora.q) + " pedido" + (fora.q === 1 ? "" : "s") + " —" }),
      porSup.map(function (g) {
        return L.h("button", { type: "button", text: L.titulo(L.nomeSup(g.k)) + " (" + L.fRc(g.v) + ")", title: "Abrir os pedidos de " + L.nomeSup(g.k),
          onclick: function () { L.abrirPedidos({ f: { sup: [g.k] } }, L.nomeSup(g.k)); } });
      })));
  }

  var grade = L.grade();
  raiz.appendChild(grade);
  grade.appendChild(painelHoje());
  grade.appendChild(painelUf(p));
  grade.appendChild(painelMes());
  grade.appendChild(painelRcas(p, t));
}

/* ------------------------------ hoje e semana ------------------------------ */
/* Como no original: hoje por UF ignora o período e o filtro de UF (respeita equipe, filial e
   RCA); a semana (segunda a hoje) ignora o período e respeita a UF. */
function painelHoje() {
  var hoje = L.hojeDia(), seg = L.segundaDe(hoje);
  var idx = L.filtrar(L.spec({ de: hoje, ate: hoje, sem: ["uf"] }));
  var tot = L.somar(idx);
  var porUf = L.agrupar(idx, function (i) { return L.R.u[i]; }).sort(function (a, b) { return b.v - a.v; });
  var fixas = ["ES", "BA", "RJ"].map(function (u) { var id = L.ufId(u); return porUf.filter(function (g) { return g.k === id; })[0] || { k: id, v: 0, q: 0 }; });
  var outras = porUf.filter(function (g) { return ["ES", "BA", "RJ"].indexOf(L.ufDeId(g.k)) < 0; });
  var linhas = fixas.concat(outras.length ? [{ k: -1, v: outras.reduce(function (s, g) { return s + g.v; }, 0), q: outras.reduce(function (s, g) { return s + g.q; }, 0), outras: outras }] : []);
  var max = Math.max.apply(null, linhas.map(function (g) { return g.v; }).concat([1]));
  var ult = L.META.ult_pedido, ateHora = ult && ult.slice(0, 10) === L.isoDeDia(hoje) ? " · último pedido às " + ult.slice(11, 16) : "";
  var semana = L.somar(L.filtrar(L.spec({ de: seg, ate: hoje })));

  var el = L.painel({ titulo: "Hoje", sub: L.DIAS_SEMANA[L.dowDe(hoje)] + ", " + L.fDia(hoje) + " · por UF do cliente", classe: "c-4" });
  var v = L.h("div", { class: "v num" });
  L.contar(v, tot.v, L.fR);
  el.corpo.appendChild(L.h("div", { class: "hoje-topo" }, L.h("div", null, v, L.h("small", { text: L.fInt(tot.q) + " pedido" + (tot.q === 1 ? "" : "s") + ateHora })),
    L.h("button", { class: "mini-btn", type: "button", html: L.ic("tabela") + " Pedidos", onclick: function () { L.abrirPedidos({ periodo: { r: "hoje" }, f: { uf: [] } }, "Hoje"); } })));
  var lista = L.h("div", { class: "hoje-ufs" });
  linhas.forEach(function (g) {
    var sigla = g.k === -1 ? "+" + outras.length : L.ufDeId(g.k);
    var nome = g.k === -1 ? "Outras UFs: " + g.outras.map(function (o) { return L.ufDeId(o.k) || "sem UF"; }).join(", ") : (L.NOMES_UF[sigla] || sigla);
    var b = L.h("button", { class: "hoje-uf", type: "button", title: nome + " — clique para ver os pedidos de hoje",
      onclick: function () { L.abrirPedidos({ periodo: { r: "hoje" }, f: { uf: g.k === -1 ? g.outras.map(function (o) { return o.k; }) : [g.k] } }, "Hoje · " + nome); } },
      L.h("span", { class: "sg", text: sigla }),
      L.h("span", { class: "br" }, L.h("i", { style: { width: (g.v > 0 ? Math.max(2, g.v / max * 100) : 0).toFixed(1) + "%", background: g.k === L.ufId("ES") ? "var(--d1)" : g.k === L.ufId("BA") ? "var(--d4)" : g.k === L.ufId("RJ") ? "var(--d3)" : "var(--d8)" } })),
      L.h("span", { class: "vv num", html: L.esc(L.fR(g.v)) + "<small>" + L.fInt(g.q) + " ped.</small>" }));
    lista.appendChild(b);
  });
  el.corpo.appendChild(lista);
  el.corpo.appendChild(L.h("button", { class: "semana", type: "button", title: "Clique para ver os pedidos da semana",
    onclick: function () { L.abrirPedidos({ periodo: { r: "semana" } }, "Semana"); } },
    L.h("span", { class: "r", html: "Semana<small>" + L.esc(L.fDiaCurto(seg) + " a " + L.fDiaCurto(hoje) + " · " + L.fInt(semana.q) + " pedidos") + "</small>" }),
    L.h("span", { class: "v num", text: L.fR(semana.v) })));
  return el;
}

/* ------------------------------ participação por UF do cliente ------------------------------ */
function painelUf(p) {
  var temFiltroUf = (L.estado.filtros.uf || []).length > 0;
  var idx = L.filtrar(L.spec({ sem: ["uf"] }));
  var tot = L.somar(idx).v;
  var g = L.agrupar(idx, function (i) { return L.R.u[i]; }).filter(function (x) { return x.v; }).sort(function (a, b) { return b.v - a.v; });
  var el = L.painel({ titulo: "Participação por UF do cliente", sub: "Pela cidade do cliente · " + p.rot + (temFiltroUf ? " · sobre todas as UFs (o filtro de UF não muda esta conta)" : ""), classe: "c-8" });
  if (!g.length) { el.corpo.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda</b>Nada no período com os filtros atuais." })); return el; }
  var cores = { ES: "var(--d1)", BA: "var(--d4)", RJ: "var(--d3)" };
  var lista = L.h("div", { class: "uf-lista" });
  g.forEach(function (x, n) {
    var uf = L.ufDeId(x.k), pct = tot ? x.v / tot : 0;
    var barra = L.h("i", { style: { width: "0%", "--cor": cores[uf] || "var(--d8)" } });
    lista.appendChild(L.h("button", { class: "uf-linha" + (n === 0 ? " top1" : ""), type: "button", title: "Clique para ver os pedidos de clientes " + (uf ? "de " + uf : "sem UF"),
      onclick: function () { L.abrirPedidos({ f: { uf: [x.k] } }, "Clientes " + (uf || "sem UF")); },
      onmousemove: function (ev) { L.dica.mostrar(ev, { titulo: (uf || "Sem UF") + (L.NOMES_UF[uf] ? " · " + L.NOMES_UF[uf] : ""), linhas: [
        { rot: "Venda", val: L.fBRL(x.v, 2) }, { rot: "Participação", val: L.fPct(pct, 2) }, { rot: "Pedidos", val: L.fInt(x.q) }, { rot: "Ticket médio", val: L.fBRL(x.ticket, 2) }],
        clique: "Clique para abrir os pedidos" }); },
      onmouseleave: L.dica.esconder },
      L.h("span", { class: "medalha " + (n < 3 ? "m" + (n + 1) : "mx"), text: (n + 1) + "º" }),
      L.h("span", { class: "uf-nome" }, L.h("b", { text: uf || "Sem UF" }), L.h("span", { text: L.NOMES_UF[uf] || "" }), L.h("div", { class: "uf-barra" }, barra)),
      L.h("span", { class: "uf-pct num", html: L.esc(L.fPct(pct, 2)) + "<small>" + L.esc(L.fRc(x.v)) + "</small>" })));
    L.fila.push(function () { requestAnimationFrame(function () { barra.style.width = Math.max(0.6, pct * 100).toFixed(2) + "%"; }); });
  });
  el.corpo.appendChild(lista);
  return el;
}

/* ------------------------------ venda por dia do mês corrente ------------------------------ */
/* Como no original, o gráfico mostra sempre o mês corrente (o período escolhido não muda);
   respeita UF, equipe, filial e RCA. A linha dourada é a venda para clientes do ES. */
function painelMes() {
  var hoje = L.hojeDia(), de = L.primeiroDoMes(hoje), n = hoje - de + 1;
  var tot = new Array(n).fill(0), es = new Array(n).fill(0), qd = new Array(n).fill(0), idEs = L.ufId("ES");
  var idx = L.filtrar(L.spec({ de: de, ate: hoje })), R = L.R, k, i;
  for (k = 0; k < idx.length; k++) { i = idx[k]; tot[R.d[i] - de] += R.v[i]; qd[R.d[i] - de] += R.q[i]; }
  var idxEs = L.filtrar(L.spec({ de: de, ate: hoje, sem: ["uf"] }));
  for (k = 0; k < idxEs.length; k++) { i = idxEs[k]; if (R.u[i] === idEs) es[R.d[i] - de] += R.v[i]; }
  var cats = []; for (k = 0; k < n; k++) cats.push(L.fDiaCurto(de + k));
  var C = L.cores();
  var el = L.painel({ titulo: "Venda por dia · " + L.fMesKLongo(L.mesDeDia(hoje)), sub: "Mês corrente, dia a dia (não muda com o período escolhido) · hoje ainda em andamento (tracejado)", classe: "c-12",
    acoes: L.h("div", { class: "leg-mes" }, L.h("span", { html: '<i style="background:' + C.d[0] + '"></i>Venda' }), L.h("span", { html: '<i style="background:' + C.ouro + '"></i>Clientes do ES' })) });
  var box = L.h("div");
  el.corpo.appendChild(box);
  var cfg = {
    categorias: cats, altura: 300, tipo: "moeda", fmt: L.fRc, rotulos: "destaque", rotuloMin: 1,
    series: [{ nome: "Venda", valores: tot, cor: C.d[0], destaque: true, area: true, parcial: n - 1 },
             { nome: "Clientes do ES", valores: es, cor: C.ouro, parcial: n - 1 }],
    dica: function (j) {
      return { titulo: L.titulo(L.DIAS_SEMANA[L.dowDe(de + j)]) + ", " + L.fDia(de + j) + (j === n - 1 ? " (em andamento)" : ""),
        linhas: [{ rot: "Venda", val: L.fBRL(tot[j], 2), cor: C.d[0] }, { rot: "Clientes do ES", val: L.fBRL(es[j], 2), cor: C.ouro },
                 { rot: "Pedidos", val: L.fInt(qd[j]) }, { rot: "Ticket médio", val: L.fBRL(qd[j] ? tot[j] / qd[j] : null, 2) }],
        clique: "Clique para ver os pedidos do dia" };
    },
    aoClicar: function (j) { var iso = L.isoDeDia(de + j); L.abrirPedidos({ periodo: { r: "livre", de: iso, ate: iso } }, "Dia " + L.fDia(de + j)); },
  };
  L.fila.push(function () { L.graf.linhas(box, cfg); });
  return el;
}

/* ------------------------------ RCAs por ticket médio ------------------------------ */
function painelRcas(p, tot) {
  var idx = L.filtrar(L.spec()), R = L.R, m = new Map();
  for (var k = 0; k < idx.length; k++) {
    var i = idx[k], ch = R.c[i] + "|" + R.u[i], g = m.get(ch);
    if (!g) { g = { cod: R.c[i], uId: R.u[i], v: 0, q: 0, l: 0, sups: new Map() }; m.set(ch, g); }
    g.v += R.v[i]; g.q += R.q[i]; if (R.l[i] === R.l[i]) g.l += R.l[i];
    g.sups.set(R.s[i], (g.sups.get(R.s[i]) || 0) + R.v[i]);
  }
  var linhas = Array.from(m.values()).map(function (g) {
    var sup = -1, mx = -Infinity; g.sups.forEach(function (v, s) { if (v > mx) { mx = v; sup = s; } });
    return { cod: g.cod, uId: g.uId, uf: L.ufDeId(g.uId) || "—", nome: L.titulo(L.nomeRca(g.cod)), sup: L.titulo(L.nomeSup(sup)), codSup: sup,
             v: g.v, q: g.q, l: g.l, ticket: g.q ? g.v / g.q : null, pctLucro: g.v ? g.l / g.v : null };
  });
  var el = L.painel({ titulo: "RCAs por ticket médio", sub: "RCA × UF do cliente · " + p.rot + " · clique na linha para ver os pedidos", classe: "c-12", semPad: true });
  el.corpo.appendChild(L.tabela({
    titulo: "Relatório 146 — RCAs por ticket médio", arquivo: "relatorio-146-rcas", aba: "RCAs",
    linhas: linhas, rank: true, ordem: { id: "ticket", desc: true }, porPagina: 25,
    buscaTexto: function (r) { return r.nome + " " + r.cod + " " + r.uf + " " + r.sup; }, buscaDica: "Buscar RCA, código, UF ou supervisor…",
    colunas: [
      { id: "nome", titulo: "RCA", tipo: "texto", valor: function (r) { return r.nome; }, titleTd: function (r) { return r.nome + " (cód. " + r.cod + ")"; } },
      { id: "uf", titulo: "UF", tipo: "texto", valor: function (r) { return r.uf; } },
      { id: "sup", titulo: "Supervisor", tipo: "texto", essencial: false, valor: function (r) { return r.sup; } },
      { id: "cod", titulo: "Código", tipo: "inteiro", essencial: false, somar: false, valor: function (r) { return r.cod; } },
      { id: "v", titulo: "Vendas", tipo: "moeda", barra: true, valor: function (r) { return r.v; } },
      { id: "ticket", titulo: "Ticket médio", tipo: "moeda", somar: false, valor: function (r) { return r.ticket; } },
      { id: "pl", titulo: "% de lucro", tipo: "pct", somar: false, valor: function (r) { return r.pctLucro; }, fmt: function (v) { return L.fPct(v, 2); }, classe: function (v) { return v != null && v < 0 ? "neg" : ""; } },
      { id: "q", titulo: "Pedidos", tipo: "inteiro", valor: function (r) { return r.q; } },
    ],
    totais: function () { return [
      { rot: "Vendas", valor: L.fBRL(tot.v, 2), pri: true }, { rot: "Pedidos", valor: L.fInt(tot.q) },
      { rot: "Ticket médio", valor: L.fBRL(tot.ticket, 2) }, { rot: "% de lucro", valor: L.fPct(tot.pctLucro, 2) }]; },
    aoClicar: function (r) { L.abrirPedidos({ f: { rca: [r.cod], uf: [r.uId] } }, r.nome + " · " + r.uf); },
    vazio: "Nenhum pedido no período com os filtros atuais.",
  }));
  return el;
}

})();
