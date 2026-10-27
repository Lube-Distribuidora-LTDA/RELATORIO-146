/* =============================================================================
 * app.js — inicialização, menu, rotas, link da visão, busca, tema, modo apresentação,
 * o painel ao vivo (AGENTE LUBE) e o botão Atualizar. Veio do Movimentação de Inventário.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var tokRender = 0;
L.estado.periodo = { r: "mes" };

/* ------------------------------ hash (link da visão) ------------------------------ */
function estadoHash() {
  return "#/" + L.estado.pagina + "?e=" + encodeURIComponent(JSON.stringify({ f: L.estado.filtros, p: L.estado.periodo }));
}
L.sincronizarHash = L.debounce(function () { try { history.replaceState(null, "", estadoHash()); } catch (e) {} }, 150);
function lerHash() {
  var m = /^#\/([\w-]+)(?:\?e=(.*))?$/.exec(location.hash || ""), out = { pagina: null, e: null };
  if (!m) return out;
  out.pagina = m[1];
  try { if (m[2]) out.e = JSON.parse(decodeURIComponent(m[2])); } catch (e) {}
  return out;
}

/* ------------------------------ menu ------------------------------ */
function construirMenu() {
  var nav = L.limpar(L.$("menu-itens")), grupos = [], vistos = {};
  L.ordemPaginas.forEach(function (id) { var g = L.paginas[id].grupo; if (!vistos[g]) { vistos[g] = 1; grupos.push(g); } });
  grupos.forEach(function (g) {
    nav.appendChild(L.h("div", { class: "grupo-menu", text: g }));
    L.ordemPaginas.filter(function (id) { return L.paginas[id].grupo === g; }).forEach(function (id) {
      var p = L.paginas[id];
      nav.appendChild(L.h("button", { class: "item-menu", type: "button", "data-p": id, html: L.ic(p.icone) + "<span>" + L.esc(p.menu || p.titulo) + "</span>",
        onclick: function () { L.pilha = []; L.estado.origem = null; L.irPara(id); document.body.classList.remove("menu-aberto"); } }));
    });
  });
  rodape();
}
function rodape() {
  var M = L.META, u = M.ult_pedido;
  L.$("menu-rodape").innerHTML =
    '<div><span class="vivo"></span><b>Pedidos até ' + L.esc(u ? u.slice(8, 10) + "/" + u.slice(5, 7) + " " + u.slice(11, 16) : "—") + "</b></div>" +
    "<div>Do WinThor pelo agente · dado novo às " + L.esc(hhmmss(M.ao_vivo)) + (L.ORIGEM === "offline" ? " · <b>sem conexão</b>" : "") + "</div>" +
    "<div>Desde " + L.esc(L.fData(M.desde)) + " · " + L.fInt(L.R.n) + " linhas</div>" +
    '<div class="versao">versão ' + L.esc(window.VERSAO || "") + "</div>";
}
function marcarMenu() { document.querySelectorAll(".item-menu").forEach(function (b) { b.classList.toggle("ativo", b.dataset.p === L.estado.pagina); }); }

/* ------------------------------ rotas e renderização ------------------------------ */
L.irPara = function (id, params) {
  if (!L.paginas[id]) return;
  var mudou = L.estado.pagina !== id;
  L.estado.pagina = id; L.estado.params = params || {};
  if (mudou) { L.construirFiltros(); marcarMenu(); }
  L.sincronizarHash();
  renderizar();
  window.scrollTo({ top: 0 });
};
function renderizar() {
  if (!L.R) return;
  var pag = L.paginaAtual(), tok = ++tokRender, cont = L.$("conteudo");
  L.$("titulo").textContent = pag.titulo; L.$("olho").textContent = pag.olho || "";
  document.title = pag.titulo + " — Relatório 146 · Lube";
  L.fila.length = 0;
  var raiz = L.h("div", { class: "pagina" });
  // a tela é montada fora do documento e entra de uma vez (o cálculo leva milissegundos)
  setTimeout(function () {
    if (tok !== tokRender) return;
    try {
      var t0 = performance.now();
      pag.render(raiz, L.estado.params || {});
      L.limpar(cont); cont.appendChild(raiz);
      L.executarFila();
      L.ultimoRenderMs = Math.round(performance.now() - t0);
    } catch (e) {
      console.error(e);
      L.limpar(cont); cont.appendChild(L.erroTela("Não foi possível montar esta tela", (e && e.message) || String(e)));
    }
  }, 0);
}
L.ouvir("filtros", function () { L.atualizarFaixa(); renderizar(); });

/* ------------------------------ busca: RCA ou supervisor vira filtro ------------------------------ */
function iniciarBusca() {
  var inp = L.$("busca-global"), box = L.$("busca-box"), pop = null;
  var tipos = [["rca", "RCAs"], ["sup", "Supervisores"]];
  function fechar() { if (pop) { pop.remove(); pop = null; } }
  function buscar() {
    var q = L.norm(inp.value).split(/\s+/).filter(Boolean);
    fechar();
    if (!q.length) return;
    var grupos = [];
    tipos.forEach(function (t) {
      var itens = L.DIM[t[0]].itens(), achou = [];
      for (var i = 0; i < itens.length && achou.length < 8; i++) { var n = itens[i].n; if (q.every(function (x) { return n.indexOf(x) >= 0; })) achou.push(itens[i]); }
      if (achou.length) grupos.push([t, achou]);
    });
    pop = L.h("div", { class: "pop", style: { width: "420px", maxHeight: "72vh" } });
    var lista = L.h("div", { class: "pop-lista" }), primeiro = null;
    if (!grupos.length) lista.appendChild(L.h("div", { class: "pop-vazio", text: "Nada encontrado para “" + inp.value + "”" }));
    grupos.forEach(function (g) {
      lista.appendChild(L.h("div", { class: "grupo-menu", style: { padding: "10px 10px 4px" }, text: g[0][1] }));
      g[1].forEach(function (x) {
        var tx = L.h("span", { class: "tx", title: x.t }); tx.innerHTML = L.destacar(x.t, q);
        var b = L.h("button", { class: "pop-item", type: "button", onclick: function () {
          fechar(); inp.value = ""; inp.blur();
          L.setFiltro(g[0][0], [x.id]); L.toast("Filtro: " + L.DIM[g[0][0]].rot + " " + x.t, "ok");
        } }, tx, x.s ? L.h("span", { class: "cn", text: x.s }) : null);
        if (!primeiro) primeiro = b;
        lista.appendChild(b);
      });
    });
    pop.appendChild(lista); pop._primeiro = primeiro;
    var r = box.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - 428, r.left)) + "px"; pop.style.top = (r.bottom + 6) + "px";
    document.body.appendChild(pop);
  }
  inp.addEventListener("input", L.debounce(buscar, 120));
  inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && pop && pop._primeiro) pop._primeiro.click(); if (ev.key === "Escape") { fechar(); inp.value = ""; inp.blur(); } });
  document.addEventListener("mousedown", function (ev) { if (pop && !pop.contains(ev.target) && !box.contains(ev.target)) fechar(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { ev.preventDefault(); inp.focus(); } });
}

/* ------------------------------ tema, apresentação ------------------------------ */
function aplicarTema(t) {
  document.documentElement.setAttribute("data-tema", t);
  try { localStorage.setItem("r146-tema", t); } catch (e) {}
  L.estado.tema = t;
  L.$("btn-tema").innerHTML = L.ic(t === "escuro" ? "sol" : "lua");
  setTimeout(L.redesenharTudo, 30);
}
function apresentar(on) {
  L.estado.apresentando = on;
  document.body.classList.toggle("apresentando", on);
  if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(function () {});
  setTimeout(L.redesenharTudo, 120);
}
function navegarPaginas(d) { var i = L.ordemPaginas.indexOf(L.estado.pagina) + d; if (i >= 0 && i < L.ordemPaginas.length) L.irPara(L.ordemPaginas[i]); }

/* ------------------------------ ao vivo (AGENTE LUBE) ------------------------------ */
/* De 15 em 15 s, com a aba à vista, o painel pergunta se algum pacote mudou (/api/versao). Se o
   agente remontou um pacote, baixa só ele e redesenha a tela sem animar, no mesmo filtro e
   período. Com uma lista aberta (filtro, busca), espera fechar. */
var AO_VIVO_MS = 15000, vivoOcupado = false;
function hhmmss(iso) { return iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"; }
function mostrarVivo() {
  var el = L.$("ao-vivo"); if (!el) return;
  var a = (L.ULTIMA_VERSAO || {}).agente || {}, vivo = !!a.vivo;
  el.classList.toggle("on", vivo);
  el.querySelector("b").textContent = vivo ? "Ao vivo · " + hhmmss(L.CONFERIDO_EM) : "Agente parado · dado de " + hhmmss(L.META.ao_vivo);
  el.title = vivo
    ? "O AGENTE LUBE lê os pedidos no WinThor de 30 em 30 segundos e a tela muda sozinha. Conferido às " + hhmmss(L.CONFERIDO_EM) + "; último dado novo às " + hhmmss(L.META.ao_vivo) + "."
    : "O agente do WinThor não está ligado: o painel mostra o que ele leu por último (" + hhmmss(L.META.ao_vivo) + ") e volta a mudar sozinho quando ele voltar.";
}
function podeAplicar() { return !document.querySelector(".pop"); }
function redesenharAoVivo() {
  L.semAnimar = true; document.body.classList.add("sem-animar");
  rodape(); mostrarVivo(); L.construirFiltros();
  if (L.estado.pagina !== "pedidos") renderizar();          // a lista de pedidos não se refaz sozinha (ela tem busca e página)
  clearTimeout(redesenharAoVivo.t);
  redesenharAoVivo.t = setTimeout(function () { L.semAnimar = false; document.body.classList.remove("sem-animar"); }, 1500);
}
function cicloAoVivo() {
  if (vivoOcupado || document.hidden || !L.R || L.$("btn-atualizar").classList.contains("girando")) return;
  vivoOcupado = true;
  L.versaoNoBanco().then(function (v) {
    if (!podeAplicar()) { L.ULTIMA_VERSAO = v; L.CONFERIDO_EM = new Date(); mostrarVivo(); return; }
    return L.atualizarAoVivo(v).then(function (mudou) { if (mudou) redesenharAoVivo(); else mostrarVivo(); });
  }).catch(function (e) {
    console.warn("Ao vivo: não consegui perguntar a versão", e);
    var el = L.$("ao-vivo"); if (el) { el.classList.remove("on"); el.querySelector("b").textContent = "Sem conexão"; }
  }).then(function () { vivoOcupado = false; });
}

/* ------------------------------ botão Atualizar: pede ao agente uma leitura agora ------------------------------ */
function textoPedido(p) {
  p = p || {};
  if (p.status === "demorou") return "O agente ainda está lendo o WinThor; a tela muda sozinha assim que terminar.";
  if (p.status !== "atendido") return "O agente não conseguiu ler o WinThor agora" + (p.mensagem ? ": " + p.mensagem : ".");
  var d = p.detalhe || {}, novos = 0, mudaram = 0, sairam = 0, seg = p.segundos != null ? " (" + L.fNum(p.segundos, 1) + " s)" : "";
  ["relatorio146.pedido", "relatorio146.pedido_60d"].forEach(function (k) { var x = d[k]; if (!x) return; novos += x.novas || 0; mudaram += x.alteradas || 0; sairam += x.apagadas || 0; });
  var partes = [];
  if (novos) partes.push(L.fInt(novos) + (novos === 1 ? " pedido novo" : " pedidos novos"));
  if (mudaram) partes.push(L.fInt(mudaram) + (mudaram === 1 ? " pedido mudou" : " pedidos mudaram"));
  if (sairam) partes.push(L.fInt(sairam) + (sairam === 1 ? " pedido saiu (cancelado)" : " pedidos saíram (cancelados)"));
  return "WinThor lido agora" + seg + ": " + (partes.length ? partes.join(", ") + "." : "nada mudou, o painel já estava em dia.");
}
function atualizarDados() {
  var b = L.$("btn-atualizar");
  if (b.classList.contains("girando")) return;
  b.classList.add("girando");
  var fim = function () { b.classList.remove("girando"); };
  L.pedirAtualizacao().then(function (r) {
    if (!r || !r.agente) {
      return L.versaoNoBanco().then(function (v) { return L.atualizarAoVivo(v); }).then(function (mudou) {
        if (mudou) redesenharAoVivo(); else mostrarVivo();
        fim(); L.toast((r && r.mensagem ? r.mensagem + " " : "") + "O painel mostra o que ele leu às " + hhmmss(L.META.ao_vivo) + ".", "erro");
      });
    }
    L.toast("Lendo o WinThor agora…", "ok");
    return L.esperarPedido(r.pedido, 45000).then(function (v) {
      return L.atualizarAoVivo(v).then(function (mudou) {
        if (mudou || L.estado.pagina === "pedidos") { redesenharAoVivo(); if (L.estado.pagina === "pedidos") renderizar(); } else mostrarVivo();
        fim();
        L.toast(textoPedido(v.pedido), v.pedido && v.pedido.status === "atendido" ? "ok" : "erro");
      });
    });
  }).catch(function (e) { fim(); L.toast("Não foi possível atualizar: " + (e.message || e), "erro"); });
}

/* ------------------------------ início ------------------------------ */
function iniciar() {
  L.$("ic-busca").innerHTML = L.ic("busca");
  L.$("btn-menu").innerHTML = L.ic("menu");
  L.$("btn-apresentar").innerHTML = L.ic("maximizar");
  L.$("btn-link").innerHTML = L.ic("link");
  L.$("btn-atualizar").innerHTML = L.ic("relogio");
  aplicarTema(document.documentElement.getAttribute("data-tema") || "escuro");
  L.$("btn-tema").addEventListener("click", function () { aplicarTema(L.estado.tema === "escuro" ? "claro" : "escuro"); });
  L.$("btn-menu").addEventListener("click", function () { document.body.classList.toggle("menu-aberto"); });
  L.$("btn-apresentar").addEventListener("click", function () { apresentar(!L.estado.apresentando); });
  L.$("btn-link").addEventListener("click", function () {
    var url = location.href.split("#")[0] + estadoHash();
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { L.toast("Link desta visão copiado (filtros e período juntos)", "ok"); }, function () { L.toast("Não foi possível copiar o link", "erro"); });
  });
  L.$("btn-atualizar").addEventListener("click", atualizarDados);
  document.addEventListener("keydown", function (ev) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if ((ev.key === "f" || ev.key === "F") && !ev.ctrlKey && !ev.metaKey) apresentar(!L.estado.apresentando);
    if (L.estado.apresentando) { if (ev.key === "ArrowRight") navegarPaginas(1); if (ev.key === "ArrowLeft") navegarPaginas(-1); }
  });
  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && L.estado.apresentando) { L.estado.apresentando = false; document.body.classList.remove("apresentando"); setTimeout(L.redesenharTudo, 120); } });

  var cont = L.$("conteudo"), espera = L.espera("Abrindo o Relatório 146…");
  L.limpar(cont).appendChild(espera);
  var aviso = function (t) { var x = espera.querySelector(".espera-txt div"); if (x) x.textContent = t; };
  if (!window.DecompressionStream) { L.limpar(cont).appendChild(L.erroTela("Navegador antigo", "Este painel precisa do Chrome ou do Edge atualizados.")); return; }
  L.carregarTudo(aviso).then(function () {
    construirMenu(); iniciarBusca();
    var h = lerHash();
    L.estado.pagina = h.pagina && L.paginas[h.pagina] ? h.pagina : L.ordemPaginas[0];
    if (h.e) { L.estado.filtros = h.e.f || {}; L.estado.periodo = h.e.p || { r: "mes" }; }
    L.construirFiltros(); marcarMenu();
    renderizar();
    mostrarVivo();
    setInterval(cicloAoVivo, AO_VIVO_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) cicloAoVivo(); });
  }).catch(function (e) {
    console.error(e);
    L.limpar(cont).appendChild(L.erroTela("Não foi possível carregar os dados", (e && e.message) || String(e)));
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
