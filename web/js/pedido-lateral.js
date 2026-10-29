/* =============================================================================
 * pedido-lateral.js — a tela lateral do pedido (pedido do Júlio, 2026-10-29: "quando eu clicar
 * no pedido, ele abra uma tela lateral igual essa [o relatório do Trade] e mostre listado tudo
 * que tem nesse pedido").
 *
 * Abre na hora com o cabeçalho que a linha clicada já tem (cliente, RCA, data, posição) e busca
 * os itens em /api/pedido. Os itens (PCPEDI) chegam pelo AGENTE LUBE e ficam guardados só para
 * os pedidos dos últimos 62 dias; pedido mais antigo mostra o total e explica.
 *
 * Conta do item, a mesma do pedido no 146 (provado em 2026-10-29: a soma dos itens fecha com a
 * venda do pedido em todos os 22.487 pedidos com venda dos últimos 62 dias):
 *   venda = QT × (PVENDA − ST); zero no item bonificado e no pedido de condição 5, 6, 11 e 12
 *   custo = QT × VLCUSTOFIN − QT × ST          lucro = venda − custo
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var COND_ZERO = [5, 6, 11, 12];
var POSICAO = { L: "Liberado", M: "Montado", B: "Bloqueado", P: "Pendente", F: "Faturado", C: "Cancelado sem data" };
var atual = null, aba = "itens", pedidoTok = 0;

function n(x) { return x == null ? null : +x; }
function nomeCliente(p) { return p.cliente ? L.titulo(p.cliente) : "Cliente " + p.codcli; }
function quando(p) {
  var dia = L.diaDeIso(p.data), sem = L.titulo(L.DIAS_SEMANA[L.dowDe(dia)]);
  return sem + ", " + L.fData(p.data) + (p.hora == null ? "" : " às " + String(p.hora).padStart(2, "0") + ":" + String(p.minuto || 0).padStart(2, "0"));
}

/* a conta de cada item (ver o topo) */
function contas(d) {
  var p = d.pedido, zero = COND_ZERO.indexOf(+p.condvenda) >= 0;
  return (d.itens || []).map(function (it) {
    var qt = n(it.qt) || 0, pv = n(it.pvenda) || 0, st = n(it.st) || 0, cf = n(it.vlcustofin) || 0, tab = n(it.ptabela), orig = n(it.qtorig);
    var bonif = it.bonific && it.bonific !== "N", venda = zero || bonif ? 0 : qt * (pv - st), custo = qt * cf - qt * st;
    var corte = orig != null && orig > qt ? orig - qt : 0;
    return Object.assign({}, it, {
      qtn: qt, qtorign: orig, preco: pv - st, precoPed: pv, stn: st, tabn: tab, bonif: bonif,
      // %Desc como a 146: preço contra a tabela, os dois sem ST (negativo = abaixo da tabela)
      desconto: tab - st > 0 ? (pv - st) / (tab - st) - 1 : null, tabelaSemSt: qt * ((tab || 0) - st),
      valorPed: qt * pv, venda: venda, custo: custo, lucro: venda - custo,
      corte: corte, vCorte: corte * (pv - st),
    });
  });
}

/* ------------------------------ abrir / fechar ------------------------------ */
L.abrirPedido = function (linha) {
  atual = { linha: linha, dados: null, erro: null };
  aba = "itens";
  L.dica.esconder(); if (L.fecharPopover) L.fecharPopover();
  L.$("dossie").classList.add("on"); L.$("dossie-fundo").classList.add("on");
  document.body.style.overflow = "hidden";
  desenhar();
  var meu = ++pedidoTok;
  fetch("api/pedido?numped=" + encodeURIComponent(linha.numped), { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : L.erroHttp(r, "o pedido"); })
    .then(function (d) { if (meu !== pedidoTok || !atual) return; atual.dados = d; desenhar(); })
    .catch(function (e) { if (meu !== pedidoTok || !atual) return; atual.erro = e.message || String(e); desenhar(); });
};
L.fecharPedido = function () {
  atual = null; pedidoTok++;
  L.$("dossie").classList.remove("on"); L.$("dossie-fundo").classList.remove("on"); document.body.style.overflow = "";
};
L.pedidoAberto = function () { return L.$("dossie").classList.contains("on"); };
document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && L.pedidoAberto() && !document.querySelector(".pop")) L.fecharPedido(); });
document.addEventListener("click", function (ev) { if (ev.target && ev.target.id === "dossie-fundo") L.fecharPedido(); });
window.addEventListener("hashchange", function () { if (L.pedidoAberto()) L.fecharPedido(); });   // voltar do navegador, link colado

function desenhar() {
  var box = L.$("dossie"), p = (atual.dados && atual.dados.pedido) || atual.linha;
  L.limpar(box);
  box.appendChild(cabecalho(p));
  var corpo = L.h("div", { class: "dos-corpo" });
  box.appendChild(corpo);
  if (atual.erro) { corpo.appendChild(L.h("div", { class: "vazio" }, L.h("b", { text: "Não foi possível ler o pedido" }), atual.erro, L.h("div", { style: { marginTop: "14px" } }, L.h("button", { class: "btn pri", type: "button", text: "Tentar de novo", onclick: function () { L.abrirPedido(atual.linha); } })))); return; }
  if (!atual.dados) { corpo.appendChild(L.h("div", { class: "vazio", html: "<b>Lendo o pedido…</b>Os itens, direto do banco." })); return; }
  var itens = contas(atual.dados);
  corpo.appendChild(indicadores(p, itens));
  var barra = L.h("div", { class: "dos-abas" });
  [["itens", "Itens do pedido"], ["resumo", "Resumo"]].forEach(function (a) {
    barra.appendChild(L.h("button", { type: "button", class: aba === a[0] ? "on" : "", text: a[1], onclick: function () { aba = a[0]; desenhar(); } }));
  });
  corpo.appendChild(barra);
  try {
    corpo.appendChild(aba === "resumo" ? abaResumo(p, itens) : abaItens(p, itens));
    L.executarFila();
  } catch (e) { console.error(e); corpo.appendChild(L.erroTela("Não foi possível montar o pedido", e.message || String(e))); }
  box.scrollTop = 0;
}

function cabecalho(p) {
  var chip = function (ic, t, titulo) { return L.h("span", { title: titulo || null, html: L.ic(ic) + " " + L.esc(t) }); };
  var subs = [chip("calendario", quando(p)),
    chip("loja", nomeCliente(p) + " · cód. " + p.codcli),
    p.cidade ? chip("pino", L.titulo(p.cidade) + (p.uf ? " · " + p.uf : "")) : null,
    chip("pessoas", "RCA " + L.titulo(p.rca || "") + " (" + p.codusur + ")"),
    p.supervisor ? chip("estrela", "Sup. " + L.titulo(p.supervisor)) : null,
    chip("armazem", "Filial " + p.codfilial),
    p.numcar ? chip("caminhao", "Carregamento " + p.numcar) : null,
    p.codplpag != null && p.plano ? chip("calendario", "Plano " + p.codplpag + " - " + L.titulo(p.plano)) : null,
    L.h("span", { html: '<span class="pos ' + L.esc(p.posicao) + '">' + L.esc(POSICAO[p.posicao] || p.posicao || "") + "</span>" })];
  if (COND_ZERO.indexOf(+p.condvenda) >= 0) subs.push(chip("info", "Condição de venda " + p.condvenda + ": conta venda zero no 146"));
  var acoes = L.h("div", { class: "dos-acoes" });
  var f = L.estado.filtros;
  if (p.codusur != null && !((f.rca || []).length === 1 && +f.rca[0] === +p.codusur))
    acoes.appendChild(L.h("button", { class: "btn ouro", type: "button", html: L.ic("filtro") + " Pedidos deste RCA", title: "Lista os pedidos do RCA no período da tela",
      onclick: function () { var nome = L.titulo(p.rca || ""); L.fecharPedido(); L.abrirPedidos({ f: { rca: [+p.codusur] } }, "RCA " + nome); } }));
  acoes.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("copiar") + " Copiar nº", title: "Copia o número do pedido (para achar no WinThor)",
    onclick: function () { (navigator.clipboard ? navigator.clipboard.writeText(String(p.numped)) : Promise.reject()).then(function () { L.toast("Pedido " + p.numped + " copiado", "ok"); }, function () { L.toast("Não foi possível copiar", "erro"); }); } }));
  acoes.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("baixar") + " Imprimir / PDF", onclick: imprimir }));
  acoes.appendChild(L.h("button", { class: "btn-ic", type: "button", title: "Fechar (Esc)", html: L.ic("x"), onclick: L.fecharPedido }));
  return L.h("div", { class: "dos-cab" },
    L.h("div", { class: "dos-ped-ic", html: L.ic("prancheta") }),
    L.h("div", { style: { minWidth: 0 } },
      L.h("div", { class: "olho", html: L.ic("prancheta").replace("<svg", '<svg style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2"') + "<span>Relatório · Pedido</span>" }),
      L.h("h2", { text: "Pedido " + p.numped }), L.h("div", { class: "sub" }, subs)),
    acoes);
}
function imprimir() {
  var tema = document.documentElement.getAttribute("data-tema");
  document.documentElement.setAttribute("data-tema", "claro"); document.body.classList.add("imprimindo");
  setTimeout(function () { L.redesenharTudo(); window.print(); document.body.classList.remove("imprimindo"); document.documentElement.setAttribute("data-tema", tema); L.redesenharTudo(); }, 250);
}

/* ------------------------------ cartões ------------------------------ */
function indicadores(p, itens) {
  var venda = n(p.venda), lucro = n(p.lucro), un = 0, corte = 0, nCorte = 0;
  itens.forEach(function (x) { un += x.qtn; corte += x.vCorte; if (x.corte) nCorte++; });
  // tabela do pedido como a 146 (VLTABELA − despesas − frete − ST); sem ela, a dos itens
  var tab = p.tabela != null ? n(p.tabela) : itens.reduce(function (a, x) { return a + (x.bonif ? 0 : x.tabelaSemSt); }, 0);
  var soma = itens.reduce(function (a, x) { return a + x.venda; }, 0);
  var legVenda = !itens.length ? "sem ST, frete e outras despesas" : Math.abs(soma - (venda || 0)) > 0.05 ? "itens somam " + L.fBRL(soma, 2)
    : itens.length === 1 ? "o item do pedido, sem ST" : "soma dos " + L.fInt(itens.length) + " itens, sem ST";
  return L.kpis(
    L.kpi({ icone: "dinheiro", rot: "Venda", valor: venda, fmt: function (v) { return L.fBRL(v, 2); }, classe: "heroi", leg: L.h("span", { text: legVenda }) }),
    L.kpi({ icone: "percent", rot: "Lucro", valor: lucro, fmt: function (v) { return L.fBRL(v, 2); }, classe: lucro != null && lucro < 0 ? "perigo" : "",
      leg: L.h("span", { text: venda ? L.fPct(lucro / venda, 2) + " de lucro" : "pedido sem venda" }) }),
    L.kpi({ icone: "caixa", rot: "Itens", valor: itens.length || n(p.qtitens), fmt: L.fInt, leg: L.h("span", { text: itens.length ? L.fNum(un, un % 1 ? 2 : 0) + " unidades" : "contados pelo 146" }) }),
    L.kpi({ icone: "etiqueta", rot: "%Desc. (146)", valor: tab && venda ? venda / tab - 1 : null, fmt: function (v) { return L.fPct(v, 2); },
      ajuda: "Venda contra o valor de tabela, os dois sem ST, como a coluna %Desc. da rotina 146 (negativo = abaixo da tabela).",
      leg: L.h("span", { text: tab ? "tabela " + L.fBRL(tab, 2) : "sem preço de tabela" }) }),
    L.kpi({ icone: "alerta", rot: "Corte no atendimento", valor: corte, fmt: function (v) { return L.fBRL(v, 2); }, classe: corte ? "perigo" : "zero",
      ajuda: "Quantidade pedida que não foi atendida (QTORIG − QT), ao preço do item.", leg: L.h("span", { text: nCorte ? L.fInt(nCorte) + (nCorte > 1 ? " itens cortados" : " item cortado") : "nada cortado" }) }));
}

/* ------------------------------ itens ------------------------------ */
function abaItens(p, itens) {
  var d = atual.dados;
  if (!itens.length) {
    var antigo = d.itens_desde && p.data < d.itens_desde;
    return L.h("div", { class: "vazio", html: antigo
      ? "<b>Itens guardados só para os últimos 62 dias</b>Este pedido é de " + L.esc(L.fData(p.data)) + "; os itens ficam no painel para os pedidos desde " + L.esc(L.fData(d.itens_desde)) + ". O total acima é o do pedido."
      : "<b>Os itens ainda não chegaram</b>O agente lê os itens do WinThor de 30 em 30 segundos. Feche e abra de novo em instantes." });
  }
  var zero = COND_ZERO.indexOf(+p.condvenda) >= 0;
  var t = L.tabela({
    titulo: "Relatório 146 — Pedido " + p.numped, arquivo: "relatorio-146-pedido-" + p.numped, aba: "Itens",
    filtrosTexto: function () { return "Pedido " + p.numped + " · " + nomeCliente(p) + " · " + L.fData(p.data) + " · RCA " + L.titulo(p.rca || ""); },
    linhas: itens, porPagina: 100, fotoCod: function (x) { return { cod: x.codprod, foto: x.foto }; }, fotoColuna: "prod",
    buscaTexto: function (x) { return x.codprod + " " + (x.descricao || "") + " " + (x.fornecedor || ""); }, buscaDica: "Buscar produto, código, fornecedor…",
    colunas: [
      { id: "prod", titulo: "Produto", tipo: "texto", valor: function (x) { return x.descricao || "Produto " + x.codprod; } },
      { id: "cod", titulo: "Código", tipo: "inteiro", somar: false, valor: function (x) { return x.codprod; }, fmt: function (v) { return String(v); } },
      { id: "emb", titulo: "Embalagem", tipo: "texto", essencial: false, valor: function (x) { return x.embalagem || ""; } },
      { id: "forn", titulo: "Fornecedor", tipo: "texto", essencial: false, valor: function (x) { return x.fornecedor ? L.titulo(x.fornecedor) : ""; } },
      { id: "qt", titulo: "Qtd.", tipo: "num2", valor: function (x) { return x.qtn; }, fmt: function (v) { return L.fNum(v, v % 1 ? 2 : 0); }, exportarTipo: "inteiro" },
      { id: "qtorig", titulo: "Pedida", tipo: "num2", essencial: false, valor: function (x) { return x.qtorign; }, fmt: function (v) { return v == null ? "" : L.fNum(v, v % 1 ? 2 : 0); }, exportarTipo: "inteiro",
        dica: "Quantidade pedida antes do corte (QTORIG)." },
      { id: "preco", titulo: "Preço un.", tipo: "moeda", somar: false, valor: function (x) { return x.preco; }, dica: "Preço de venda por unidade, sem ST (PVENDA − ST)." },
      { id: "tab", titulo: "Preço tabela", tipo: "moeda", somar: false, essencial: false, valor: function (x) { return x.tabn; } },
      { id: "desc", titulo: "Desconto", tipo: "pct", somar: false, essencial: false, valor: function (x) { return x.desconto; }, fmt: function (v) { return v == null ? "" : L.fPct(v, 2); },
        dica: "Preço contra o preço de tabela, os dois sem ST, como a 146 (negativo = abaixo da tabela)." },
      { id: "st", titulo: "ST un.", tipo: "moeda", somar: false, essencial: false, valor: function (x) { return x.stn; } },
      { id: "vped", titulo: "Valor no pedido", tipo: "moeda", essencial: false, valor: function (x) { return x.valorPed; }, dica: "QT × PVENDA, com ST, como no pedido do WinThor." },
      { id: "venda", titulo: "Venda", tipo: "moeda", barra: true, valor: function (x) { return x.venda; }, dica: "Venda do item no Relatório 146: QT × (PVENDA − ST)." },
      { id: "custo", titulo: "Custo", tipo: "moeda", essencial: false, valor: function (x) { return x.custo; }, dica: "QT × custo financeiro, sem ST." },
      { id: "lucro", titulo: "Lucro", tipo: "moeda", valor: function (x) { return x.lucro; }, classe: function (v) { return v < 0 ? "neg" : ""; } },
      { id: "pl", titulo: "% de lucro", tipo: "pct", somar: false, valor: function (x) { return x.venda ? x.lucro / x.venda : null; }, fmt: function (v) { return L.fPct(v, 2); }, classe: function (v) { return v != null && v < 0 ? "neg" : ""; } },
      { id: "sit", titulo: "Situação", tipo: "tag", ord: false, valor: function (x) { return x.bonif ? "Bonificado" : x.corte ? "Corte de " + L.fNum(x.corte, x.corte % 1 ? 2 : 0) : ""; },
        fmt: function (v, x) { return { html: x.bonif ? L.tag("Bonificado", "info") : x.corte ? L.tag(v, "perigo") : "" }; } },
    ],
    totais: function (res) {
      var ls = res.todas || res.linhas, v = 0, l = 0, u = 0;
      ls.forEach(function (x) { v += x.venda; l += x.lucro; u += x.qtn; });
      return [{ rot: "Venda", valor: L.fBRL(v, 2), pri: true }, { rot: "Lucro", valor: L.fBRL(l, 2) }, { rot: "% de lucro", valor: v ? L.fPct(l / v, 2) : "—" },
              { rot: "Itens", valor: L.fInt(ls.length) }, { rot: "Unidades", valor: L.fNum(u, u % 1 ? 2 : 0) }];
    },
    vazio: "Nenhum item com essa busca.",
  });
  var raiz = L.h("div");
  var temFoto = itens.some(function (x) { return x.foto; });
  raiz.appendChild(L.grade(L.painel({ titulo: "Itens do pedido", classe: "c-12", semPad: true, corpo: t,
    sub: (itens.length === 1 ? "1 item" : L.fInt(itens.length) + " itens · na ordem do pedido") + (temFoto ? " · passe o mouse na foto para ampliar" : "") })));
  raiz.appendChild(L.nota(zero
    ? "Pedido com condição de venda " + p.condvenda + ": o Relatório 146 conta a venda dele como zero (a coluna Valor no pedido, em Todas, mostra o valor dos itens)."
    : "Venda = quantidade × (preço − ST), a mesma conta do Relatório 146; frete e outras despesas ficam fora. Os itens vêm do WinThor pelo agente."));
  return raiz;
}

/* ------------------------------ resumo ------------------------------ */
function abaResumo(p, itens) {
  var raiz = L.h("div"), C = L.cores();
  if (!itens.length) return abaItens(p, itens);
  var top = itens.filter(function (x) { return x.venda > 0; }).sort(function (a, b) { return b.venda - a.venda; }).slice(0, 12);
  var pTop = L.painel({ titulo: "Onde está a venda", sub: "os " + top.length + " itens que mais vendem no pedido", classe: "c-7" }), bTop = L.h("div");
  pTop.corpo.appendChild(bTop);
  var porForn = new Map();
  itens.forEach(function (x) { var k = x.fornecedor || "Sem fornecedor no cadastro", o = porForn.get(k) || { v: 0, l: 0, n: 0 }; o.v += x.venda; o.l += x.lucro; o.n++; porForn.set(k, o); });
  var forn = Array.from(porForn.entries()).map(function (e) { return { k: e[0], v: e[1].v, l: e[1].l, n: e[1].n }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 10);
  var pForn = L.painel({ titulo: "Por fornecedor", sub: porForn.size + " fornecedor" + (porForn.size > 1 ? "es" : "") + " no pedido", classe: "c-5" }), bForn = L.h("div");
  pForn.corpo.appendChild(bForn);
  if (top.length) L.fila.push(function () {
    L.graf.barras(bTop, { itens: top.map(function (x) { return { rot: x.descricao || "Produto " + x.codprod, valor: x.venda }; }), fmt: function (v) { return L.fBRL(v, 2); }, linhaH: 28,
      total: itens.reduce(function (a, x) { return a + x.venda; }, 0), cor: function (i) { return i === 0 ? C.ouro : C.d[0]; },
      dica: function (i) { var x = top[i]; return { titulo: x.descricao || "Produto " + x.codprod, linhas: [{ rot: "Código", val: String(x.codprod) }, { rot: "Quantidade", val: L.fNum(x.qtn, x.qtn % 1 ? 2 : 0) },
        { rot: "Preço un.", val: L.fBRL(x.preco, 2) }, { rot: "Venda", val: L.fBRL(x.venda, 2) }, { rot: "% de lucro", val: L.fPct(x.venda ? x.lucro / x.venda : null, 2) }] }; } });
  }); else bTop.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda</b>Este pedido conta venda zero no 146." }));
  L.fila.push(function () {
    L.graf.barras(bForn, { itens: forn.map(function (x) { return { rot: L.titulo(x.k), valor: Math.max(0, x.v) }; }), fmt: function (v) { return L.fBRL(v, 0); }, linhaH: 28,
      cor: function (i) { return i === 0 ? C.ouro : C.d[0]; },
      dica: function (i) { var x = forn[i]; return { titulo: L.titulo(x.k), linhas: [{ rot: "Itens", val: L.fInt(x.n) }, { rot: "Venda", val: L.fBRL(x.v, 2) }, { rot: "% de lucro", val: L.fPct(x.v ? x.l / x.v : null, 2) }] }; } });
  });
  raiz.appendChild(L.grade(pTop, pForn));
  // a conta do pedido, do valor dos itens até a venda do 146
  var ped = 0, st = 0, venda = 0, custo = 0;
  itens.forEach(function (x) { ped += x.valorPed; st += x.qtn * x.stn; venda += x.venda; custo += x.custo; });
  var linhas = [["Valor dos itens no pedido (com ST)", ped], ["− ST dos itens", -st]];
  if (COND_ZERO.indexOf(+p.condvenda) >= 0) linhas.push(["− Condição de venda " + p.condvenda + " (conta zero no 146)", -(ped - st)]);
  else if (Math.abs(ped - st - venda) > 0.005) linhas.push(["− Itens bonificados", venda - (ped - st)]);
  linhas.push(["= Venda do pedido no 146", venda, "tot"], ["− Custo (financeiro, sem ST)", -custo], ["= Lucro", venda - custo, "tot"]);
  var conta = L.h("div", { class: "conta-ped" });
  // linha que subtrai já diz "−" no texto: o valor vai sem sinal, em vermelho
  linhas.forEach(function (r) { var menos = r[0].charAt(0) === "−"; conta.appendChild(L.h("div", { class: "l" + (r[2] ? " " + r[2] : "") }, L.h("span", { text: r[0] }),
    L.h("b", { class: "num" + (menos || r[1] < -0.005 ? " neg" : ""), text: L.fBRL(menos ? Math.abs(r[1]) : r[1], 2) }))); });
  var pConta = L.painel({ titulo: "A conta do pedido", sub: "do valor dos itens à venda e ao lucro do Relatório 146", classe: "c-12", corpo: conta });
  var gc = L.grade(pConta); gc.style.marginTop = "16px";
  raiz.appendChild(gc);
  return raiz;
}

})();
