/* =============================================================================
 * pag-pedidos.js — os pedidos por trás de cada número (padrão da casa: todo número clicável
 * abre o detalhe já filtrado, com Voltar para a tela e os filtros de antes).
 * Os pedidos vêm do banco na hora (/api/pedidos), com cliente, cidade, posição e lucro.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

L.pilha = [];
/* abre os pedidos de um recorte: mud = { f: { chave: [ids] }, periodo }. Guarda a tela de antes. */
L.abrirPedidos = function (mud, rotulo) {
  L.pilha.push({ pagina: L.estado.pagina, filtros: JSON.parse(JSON.stringify(L.estado.filtros)), periodo: Object.assign({}, L.estado.periodo), rolagem: window.scrollY, origem: L.estado.origem });
  mud = mud || {};
  Object.keys(mud.f || {}).forEach(function (k) { if (mud.f[k] && mud.f[k].length) L.estado.filtros[k] = mud.f[k].slice(); else delete L.estado.filtros[k]; });
  if (mud.periodo) L.estado.periodo = mud.periodo;
  L.estado.origem = rotulo || null;
  L.irPara("pedidos", { veioDeClique: true });
  L.atualizarFaixa();
};
L.voltar = function () {
  var s = L.pilha.pop();
  if (!s) return L.irPara("visao");
  L.estado.filtros = s.filtros; L.estado.periodo = s.periodo; L.estado.origem = s.origem;
  L.irPara(s.pagina);
  L.construirFiltros();
  setTimeout(function () { window.scrollTo({ top: s.rolagem || 0 }); }, 60);
};

L.registrarPagina({
  id: "pedidos", grupo: "Relatório 146", titulo: "Pedidos", menu: "Pedidos", icone: "tabela",
  olho: "Os pedidos por trás de cada número",
  filtros: ["uf", "regiao", "sup", "fil", "rca"],
  render: render,
});

var POSICAO = { L: "Liberado", M: "Montado", B: "Bloqueado", P: "Pendente", F: "Faturado", C: "Cancelado sem data" };

/* trajetória do recorte no período (pedido do Júlio, 2026-10-29: clicou no RCA, quer ver "a trajetória de todo o período
   para saber como é o resultado dele"): venda por dia em colunas — por mês quando o período passa de 62 dias —, com os
   mesmos filtros da tela, a média tracejada e o clique abrindo os pedidos do dia (ou do mês). Sai do pacote que o
   navegador já tem: aparece na hora, antes da lista. */
function painelTrajetoria(p) {
  var porMes = p.dias > 62, R = L.R, idx = L.filtrar(L.spec()), hoje = L.hojeDia();
  var chaves = [], pos = new Map(), d;
  for (d = p.de; d <= p.ate; d++) {
    var k = porMes ? L.mesDeDia(d) : d;
    if (!pos.has(k)) { pos.set(k, chaves.length); chaves.push(k); }
  }
  var v = chaves.map(function () { return 0; }), q = v.slice(), l = v.slice();
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], c = pos.get(porMes ? L.mesDeDia(R.d[i]) : R.d[i]);
    if (c == null) continue;
    v[c] += R.v[i]; q[c] += R.q[i]; if (R.l[i] === R.l[i]) l[c] += R.l[i];
  }
  var comVenda = v.filter(function (x) { return x > 0; }), media = comVenda.length ? comVenda.reduce(function (a, b) { return a + b; }, 0) / comVenda.length : 0;
  var C = L.cores(), emAndamento = function (n) { return porMes ? chaves[n] === L.mesDeDia(hoje) : chaves[n] === hoje; };
  var rotulo = function (n) { return porMes ? L.fMesKLongo(chaves[n]) : L.titulo(L.DIAS_SEMANA[L.dowDe(chaves[n])]) + ", " + L.fDia(chaves[n]); };
  var el = L.painel({ titulo: "Trajetória no período", classe: "c-12",
    sub: "Venda por " + (porMes ? "mês" : "dia") + " · " + p.rot + " · com os filtros acima · clique numa coluna para ver os pedidos " + (porMes ? "do mês" : "do dia"),
    acoes: comVenda.length ? L.h("span", { class: "leg-media", html: "<i></i>Média <b>" + L.esc(L.fRc(media)) + "</b>" + (porMes ? " por mês" : " por dia com venda") }) : null });
  var box = L.h("div");
  el.corpo.appendChild(box);
  if (!comVenda.length) { el.corpo.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda</b>Nenhum pedido no período com os filtros atuais." })); box.remove(); return el; }
  var cfg = {
    categorias: chaves.map(function (k) { return porMes ? L.fMesK(k) : L.fDiaCurto(k); }),
    series: [{ nome: "Venda", valores: v, cor: C.d[0] }],
    corBarra: function (n) { return emAndamento(n) ? C.d[5] : C.d[0]; },
    altura: 270, tipo: "moeda", fmt: L.fRc, larguraMax: 46,
    ref: [{ valor: media, rot: "" }],
    dica: function (n) {
      return { titulo: rotulo(n) + (emAndamento(n) ? " (em andamento)" : ""),
        linhas: [{ rot: "Venda", val: L.fBRL(v[n], 2), cor: C.d[0] }, { rot: "Pedidos", val: L.fInt(q[n]) },
                 { rot: "Ticket médio", val: L.fBRL(q[n] ? v[n] / q[n] : null, 2) }, { rot: "% de lucro", val: L.fPct(v[n] ? l[n] / v[n] : null, 2) },
                 { rot: "Média do período", val: L.fBRL(media, 2) }],
        clique: "Clique para ver os pedidos " + (porMes ? "do mês" : "do dia") };
    },
    aoClicar: function (n) {
      var de = porMes ? Math.max(p.de, L.primeiroDoMes(L.diaDeIso(String(chaves[n]).slice(0, 4) + "-" + String(chaves[n]).slice(4) + "-01"))) : chaves[n];
      var ate = porMes ? Math.min(p.ate, L.ultimoDoMes(de)) : chaves[n];
      L.abrirPedidos({ periodo: { r: "livre", de: L.isoDeDia(de), ate: L.isoDeDia(ate) } }, rotulo(n));
    },
  };
  L.fila.push(function () { L.graf.colunas(box, cfg); });
  return el;
}

function parametros(p) {
  var f = L.estado.filtros, q = ["de=" + L.isoDeDia(p.de), "ate=" + L.isoDeDia(p.ate)];
  if ((f.uf || []).length) q.push("uf=" + f.uf.map(L.ufDeId).join(","));
  if ((f.sup || []).length) q.push("sup=" + f.sup.join(","));
  if ((f.fil || []).length) q.push("fil=" + f.fil.join(","));
  if ((f.rca || []).length) q.push("rca=" + f.rca.join(","));
  if ((f.regiao || []).length) q.push("reg=" + f.regiao.map(function (id) { return L.REGIOES[id - 1].k; }).join(","));
  return q.join("&");
}

function render(raiz) {
  var p = L.periodo();
  var cab = L.h("div", { class: "det-cab" });
  if (L.pilha.length) cab.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("devolucao") + " Voltar", onclick: L.voltar, title: "Volta para a tela e os filtros de antes" }));
  cab.appendChild(L.h("div", { class: "desc", html: (L.estado.origem ? "<b>" + L.esc(L.estado.origem) + "</b> · " : "") + L.esc(L.descricaoFiltros()) }));
  raiz.appendChild(cab);
  var kpis = L.h("div", { class: "kpis-espera" });
  if (p.dias <= 400) raiz.appendChild(kpis);
  raiz.appendChild(painelTrajetoria(p));
  if (p.dias > 400) {
    raiz.appendChild(L.h("div", { class: "vazio", html: "<b>Período grande demais para listar pedido a pedido</b>Escolha até 400 dias (por exemplo, Ano atual ou 12 meses)." }));
    return;
  }
  var corpo = L.h("div", { class: "vazio", html: "<b>Lendo os pedidos…</b>Do banco, com os filtros acima." });
  raiz.appendChild(corpo);
  var url = "api/pedidos?" + parametros(p);
  fetch(url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : L.erroHttp(r, "os pedidos"); }).then(function (res) {
    if (!corpo.isConnected) return;
    var t = res.totais || {}, venda = +t.venda || 0, lucro = +t.lucro || 0, n = +t.pedidos || 0;
    kpis.classList.remove("kpis-espera");
    L.limpar(kpis).appendChild(L.kpis(
      L.kpi({ icone: "dinheiro", rot: "Venda", valor: venda, fmt: L.fR, fmtTitulo: function (v) { return L.fBRL(v, 2); }, classe: "heroi" }),
      L.kpi({ icone: "prancheta", rot: "Pedidos", valor: n, fmt: L.fInt }),
      L.kpi({ icone: "etiqueta", rot: "Ticket médio", valor: n ? venda / n : null, fmt: function (v) { return L.fBRL(v, 2); } }),
      L.kpi({ icone: "percent", rot: "% de lucro", valor: venda ? lucro / venda : null, fmt: function (v) { return L.fPct(v, 2); } }),
      L.kpi({ icone: "pessoas", rot: "Clientes atendidos", valor: +t.clientes || 0, fmt: L.fInt, ajuda: "Clientes diferentes com pedido no recorte (positivação)." })));
    var linhas = res.linhas || [];
    var tab = L.tabela({
      titulo: "Relatório 146 — Pedidos", arquivo: "relatorio-146-pedidos", aba: "Pedidos",
      filtrosTexto: function () { return (L.estado.origem ? L.estado.origem + " · " : "") + L.descricaoFiltros(); },
      linhas: linhas, porPagina: 50, ordem: { id: "data", desc: true },
      buscaTexto: function (r) { return r.numped + " " + (r.cliente || "") + " " + r.codcli + " " + (r.cidade || "") + " " + (r.rca || "") + " " + (r.supervisor || ""); },
      buscaDica: "Buscar pedido, cliente, cidade, RCA…",
      colunas: [
        { id: "numped", titulo: "Pedido", tipo: "texto", valor: function (r) { return String(r.numped); }, ordVal: function (r) { return +r.numped; } },
        { id: "data", titulo: "Data", tipo: "data", valor: function (r) { return r.data; }, ordVal: function (r) { return r.data + " " + String(r.hora == null ? 99 : r.hora).padStart(2, "0") + String(r.minuto == null ? 99 : r.minuto).padStart(2, "0"); } },
        { id: "hora", titulo: "Hora", tipo: "texto", valor: function (r) { return r.hora == null ? "" : String(r.hora).padStart(2, "0") + ":" + String(r.minuto || 0).padStart(2, "0"); } },
        { id: "cliente", titulo: "Cliente", tipo: "texto", valor: function (r) { return r.cliente ? L.titulo(r.cliente) : "Cliente " + r.codcli; }, titleTd: function (r) { return (r.cliente || "") + " (cód. " + r.codcli + ")"; } },
        { id: "cidade", titulo: "Cidade", tipo: "texto", valor: function (r) { return r.cidade ? L.titulo(r.cidade) : ""; } },
        { id: "uf", titulo: "UF", tipo: "texto", valor: function (r) { return r.uf || ""; } },
        { id: "rca", titulo: "RCA", tipo: "texto", valor: function (r) { return L.titulo(r.rca); } },
        { id: "sup", titulo: "Supervisor", tipo: "texto", essencial: false, valor: function (r) { return r.supervisor ? L.titulo(r.supervisor) : ""; } },
        { id: "fil", titulo: "Filial", tipo: "texto", essencial: false, valor: function (r) { return r.codfilial; } },
        { id: "pos", titulo: "Posição", tipo: "tag", valor: function (r) { return POSICAO[r.posicao] || r.posicao; },
          fmt: function (v, r) { return { html: '<span class="pos ' + L.esc(r.posicao) + '">' + L.esc(v) + "</span>" }; } },
        { id: "cond", titulo: "Cond. venda", tipo: "inteiro", essencial: false, somar: false, valor: function (r) { return r.condvenda; },
          dica: "Condição de venda do WinThor. 5, 6, 11 e 12 contam como pedido com venda zero (bonificação, troca…)." },
        { id: "venda", titulo: "Venda", tipo: "moeda", valor: function (r) { return r.venda == null ? null : +r.venda; } },
        { id: "lucro", titulo: "Lucro", tipo: "moeda", valor: function (r) { return r.lucro == null ? null : +r.lucro; }, classe: function (v) { return v != null && v < 0 ? "neg" : ""; } },
        { id: "pl", titulo: "% de lucro", tipo: "pct", somar: false, valor: function (r) { return r.lucro == null || !+r.venda ? null : +r.lucro / +r.venda; }, fmt: function (v) { return L.fPct(v, 2); }, classe: function (v) { return v != null && v < 0 ? "neg" : ""; } },
        { id: "itens", titulo: "Itens", tipo: "inteiro", valor: function (r) { return r.qtitens == null ? null : +r.qtitens; } },
      ],
      totais: function () { return [
        { rot: "Venda", valor: L.fBRL(venda, 2), pri: true }, { rot: "Pedidos", valor: L.fInt(n) },
        { rot: "Lucro", valor: L.fBRL(lucro, 2) }, { rot: "Clientes", valor: L.fInt(+t.clientes || 0) }]; },
      aoClicar: function (r) { L.abrirPedido(r); },        // a tela lateral com os itens (pedido-lateral.js)
      vazio: "Nenhum pedido com estes filtros.",
    });
    var novo = L.h("div");
    if (n > linhas.length) novo.appendChild(L.h("div", { class: "aviso-limite", text: "Mostrando os " + L.fInt(linhas.length) + " pedidos mais recentes de " + L.fInt(n) + ". Os totais acima são do recorte inteiro; para a lista completa, diminua o período ou filtre." }));
    novo.appendChild(L.painel({ titulo: "Pedidos", sub: p.rot + " · do mais novo para o mais velho · clique no pedido para ver os itens", classe: "c-12", semPad: true, corpo: tab }));
    corpo.replaceWith(novo);
  }).catch(function (e) {
    if (!corpo.isConnected) return;
    corpo.replaceWith(L.erroTela("Não foi possível ler os pedidos", e.message || String(e)));
  });
}

})();
