/* =============================================================================
 * pag-pedidos.js — a aba Pedidos, no jeito da rotina 146 (Resumo de Vendas) do WinThor.
 *
 * Pedido do Júlio (2026-10-29): "na aba Pedidos siga a mesma maneira que as telas do WinThor com as
 * mesmas abas"; a Visão geral continua igual e o clique nela "sai filtrando tudo assim como está".
 *   · aberta pelo menu: começa em Por supervisor → RCA → cliente → pedidos do cliente → itens (a
 *     tela lateral), com as colunas e o rodapé da 146 (/api/resumo e /api/pedidos);
 *   · as outras abas (Por prazo, Por evolução, Por classe…) agrupam o mesmo recorte de outro jeito,
 *     e o clique numa linha abre o Analítico (os pedidos) só daquela linha;
 *   · aberta por um clique da Visão geral: cai no Analítico (trajetória + pedidos), como era.
 * Selecionar (faturados) e Clientes (físicos/jurídicos) são os da tela de filtro da 146.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

var ABAS = [["sup", "Por supervisor"], ["prazo", "Por prazo"], ["dia", "Por evolução"], ["classe", "Por classe"],
  ["regiao", "Por região"], ["emitente", "Por emitente"], ["analitico", "Analítico"], ["cobranca", "Por cobrança"],
  ["checkout", "Por check out"], ["origem", "Origem venda"], ["area", "Por área de atuação"], ["fornecedor", "Por fornecedor"]];
var PARAM = { prazo: "plano", cobranca: "cob", emitente: "emit", regiao: "regp", area: "area", classe: "classe",
  origem: "orig", checkout: "caixa", fornecedor: "forn" };
var ORIGEM = { F: "Força de vendas", T: "Telemarketing", C: "Call center", B: "Balcão", R: "Balcão reserva", W: "Web", E: "E-commerce" };
var POSICAO = { L: "Liberado", M: "Montado", B: "Bloqueado", P: "Pendente", F: "Faturado", C: "Cancelado sem data" };
var NIVEL = ["sup", "rca", "cli"];

/* estado da 146: aba, caminho Supervisor → RCA → Cliente, Selecionar, Clientes e a linha clicada nas outras abas */
function novo(aba) { return { aba: aba || "sup", trilha: [], sel: "todos", tipo: "todos", dim: null }; }
function est() { if (!L.estado.r146) L.estado.r146 = novo(); return L.estado.r146; }
function copia(x) { return x ? JSON.parse(JSON.stringify(x)) : null; }

L.pilha = [];
/* abre os pedidos de um recorte (o clique da Visão geral e da trajetória): mud = { f: { chave: [ids] }, periodo }.
   Guarda a tela de antes e cai no Analítico. */
L.abrirPedidos = function (mud, rotulo) {
  L.pilha.push({ pagina: L.estado.pagina, filtros: copia(L.estado.filtros), periodo: Object.assign({}, L.estado.periodo), rolagem: window.scrollY,
                 origem: L.estado.origem, r146: copia(L.estado.r146) });
  mud = mud || {};
  Object.keys(mud.f || {}).forEach(function (k) { if (mud.f[k] && mud.f[k].length) L.estado.filtros[k] = mud.f[k].slice(); else delete L.estado.filtros[k]; });
  if (mud.periodo) L.estado.periodo = mud.periodo;
  L.estado.origem = rotulo || null;
  var s = novo("analitico"), antes = L.estado.r146;
  if (antes && L.estado.pagina === "pedidos") { s.sel = antes.sel; s.tipo = antes.tipo; }
  L.estado.r146 = s;
  L.irPara("pedidos", { veioDeClique: true });
  L.atualizarFaixa();
};
L.voltar = function () {
  var s = L.pilha.pop();
  if (!s) return L.irPara("visao");
  L.estado.filtros = s.filtros; L.estado.periodo = s.periodo; L.estado.origem = s.origem; L.estado.r146 = s.r146;
  L.irPara(s.pagina);
  L.construirFiltros();
  setTimeout(function () { window.scrollTo({ top: s.rolagem || 0 }); }, 60);
};

L.registrarPagina({
  id: "pedidos", grupo: "Relatório 146", titulo: "Pedidos", menu: "Pedidos", icone: "tabela",
  olho: "Resumo de vendas, no jeito da 146 do WinThor",
  filtros: ["uf", "regiao", "sup", "fil", "rca"],
  render: render,
});

/* ------------------------------ parâmetros das APIs ------------------------------ */
function consulta(p, mais) {
  var f = L.estado.filtros, s = est(), m = { de: L.isoDeDia(p.de), ate: L.isoDeDia(p.ate) };
  if ((f.uf || []).length) m.uf = f.uf.map(L.ufDeId).join(",");
  if ((f.sup || []).length) m.sup = f.sup.join(",");
  if ((f.fil || []).length) m.fil = f.fil.join(",");
  if ((f.rca || []).length) m.rca = f.rca.join(",");
  if ((f.regiao || []).length) m.reg = f.regiao.map(function (id) { return L.REGIOES[id - 1].k; }).join(",");
  if (s.sel !== "todos") m.sel = s.sel;
  if (s.tipo !== "todos") m.tipo = s.tipo;
  Object.keys(mais || {}).forEach(function (k) { if (mais[k] != null) m[k] = mais[k]; });
  return Object.keys(m).map(function (k) { return k + "=" + encodeURIComponent(m[k]); }).join("&");
}
function maisDaTrilha(s) { var m = {}; s.trilha.forEach(function (t) { m[t.tipo] = t.k == null ? -1 : t.k; }); return m; }
function maisDaDim(s) {
  var d = s.dim, m = {};
  if (!d) return m;
  if (d.aba === "dia") { m.de = d.k; m.ate = d.k; }
  else m[PARAM[d.aba]] = d.k == null || d.k === -1 || d.k === "-1" ? "_" : d.k;
  return m;
}
function buscar(url) { return fetch(url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : L.erroHttp(r, "o resumo"); }); }

/* ------------------------------ cabeçalho: abas da 146, Selecionar e Clientes ------------------------------ */
function barra(s) {
  var abas = L.h("div", { class: "r146-abas", role: "tablist" });
  ABAS.forEach(function (a) {
    abas.appendChild(L.h("button", { type: "button", role: "tab", class: s.aba === a[0] ? "on" : "", text: a[1],
      onclick: function () { if (s.aba === a[0] && !s.trilha.length && !s.dim) return; s.aba = a[0]; s.trilha = []; s.dim = null; L.irPara("pedidos"); } }));
  });
  var seg = function (rot, chave, ops) {
    var box = L.h("div", { class: "seg" });
    ops.forEach(function (o) { box.appendChild(L.h("button", { type: "button", class: s[chave] === o[0] ? "on" : "", text: o[1],
      onclick: function () { if (s[chave] === o[0]) return; s[chave] = o[0]; L.irPara("pedidos"); } })); });
    return L.h("label", { class: "r146-op" }, L.h("span", { text: rot }), box);
  };
  return L.h("div", { class: "r146-cab" }, abas,
    L.h("div", { class: "r146-ops" },
      seg("Selecionar", "sel", [["todos", "Todos"], ["fat", "Apenas faturados"], ["naofat", "Apenas não faturados"]]),
      seg("Clientes", "tipo", [["todos", "Todos"], ["F", "Físicos"], ["J", "Jurídicos"]])));
}

/* trilha: 146 › Supervisores › 7 - ES - VITORIA NORTE › 795 - DANILO… (cada pedaço volta àquele nível) */
function trilha(s, titulo) {
  var t = L.h("div", { class: "r146-trilha" });
  if (L.pilha.length && s.aba === "analitico" && !s.dim) t.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("devolucao") + " Voltar", onclick: L.voltar, title: "Volta para a tela e os filtros de antes" }));
  var partes = [];
  if (s.aba === "sup") {
    partes.push(["Supervisores", function () { s.trilha = []; L.irPara("pedidos"); }]);
    s.trilha.forEach(function (x, i) { partes.push([(x.k == null ? "" : x.k + " - ") + L.titulo(x.nome || ""), function () { s.trilha = s.trilha.slice(0, i + 1); L.irPara("pedidos"); }]); });
    if (s.trilha.length) t.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("devolucao") + " Voltar", title: "Volta um nível",
      onclick: function () { s.trilha.pop(); L.irPara("pedidos"); } }));
  } else if (s.dim) {
    var aba = ABAS.filter(function (a) { return a[0] === s.dim.aba; })[0];
    t.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("devolucao") + " Voltar", title: "Volta para " + aba[1],
      onclick: function () { s.aba = s.dim.aba; s.dim = null; L.irPara("pedidos"); } }));
    partes.push([aba[1], function () { s.aba = s.dim.aba; s.dim = null; L.irPara("pedidos"); }]);
    partes.push([s.dim.nome, null]);
  } else partes.push([titulo, null]);
  var caminho = L.h("div", { class: "caminho" }, L.h("b", { class: "num", text: "146" }));
  partes.forEach(function (p, i) {
    caminho.appendChild(L.h("span", { class: "sep", text: "›" }));
    var ultimo = i === partes.length - 1;
    caminho.appendChild(p[1] && !ultimo ? L.h("button", { type: "button", text: p[0], onclick: p[1] }) : L.h("span", { class: ultimo ? "atual" : "", text: p[0] }));
  });
  t.appendChild(caminho);
  t.appendChild(L.h("div", { class: "desc", html: (L.estado.origem && s.aba === "analitico" && !s.dim ? "<b>" + L.esc(L.estado.origem) + "</b> · " : "") + L.esc(L.descricaoFiltros()) }));
  return t;
}

/* ------------------------------ rodapé da 146 (Clientes · Pedidos · Vendas · Bonif./Desc.) ------------------------------ */
function rodape(res) {
  var T = res.totais || {}, venda = +T.venda || 0, tabela = +T.tabela || 0, cmv = +T.cmv || 0, n = +T.pedidos || 0, meta = res.meta == null ? null : +res.meta;
  var c = function (rot, val, dica) { return L.h("div", { class: "c", title: dica || null }, L.h("small", { text: rot }), L.h("b", { class: "num", text: val })); };
  var g = function (tit) { var d = L.h("div", { class: "g" }, L.h("h4", { text: tit })); for (var i = 1; i < arguments.length; i++) d.appendChild(arguments[i]); return d; };
  return L.h("div", { class: "r146-rodape" },
    g("Clientes", c("Total cadastrado", res.cli_cad == null ? "—" : L.fInt(res.cli_cad), "Clientes cadastrados até o fim do período (da carteira dos RCAs filtrados, se houver)"),
                  c("Positivados", L.fInt(T.cli_pos))),
    g("Pedidos", c("Emitidos", L.fInt(n)), c("Média itens", L.fNum(+T.media_itens || 0, 2)), c("Prazo médio (dias)", L.fNum(+T.pz_medio || 0, 2)),
                 c("Vl. médio", L.fBRL(n ? venda / n : null, 2))),
    g("Vendas", c("Total venda", L.fBRL(venda, 2)), c("Total meta", meta == null ? "—" : L.fBRL(meta, 2), res.meta_ok ? "" : "Sem meta com este filtro (cliente, UF, tipo, faturados ou a linha de outra aba)"),
                c("Meta (%)", meta ? L.fNum(venda / meta * 100, 2) : "—"), c("Lucro (%)", venda ? L.fNum((venda - cmv) / venda * 100, 2) : "—"),
                c("Peso vendido (kg)", L.fNum(+T.peso || 0, 3)), c("Total proj. vendas", res.proj_fator == null ? "—" : L.fBRL(venda * res.proj_fator, 2), "Venda ÷ dias úteis passados × dias úteis do período (segunda a sexta)"),
                c("Vl. lucro", L.fBRL(venda - cmv, 2))),
    g("Bonif./Desc. concedidos", c("Desc. médio (%)", tabela ? L.fNum((venda / tabela - 1) * 100, 2) : "—", "Venda contra o preço de tabela"),
                                 c("Bonific. médio (%)", venda ? L.fNum((+T.bonif || 0) / venda * 100, 2) : "—")));
}

/* ------------------------------ colunas da 146 ------------------------------ */
function contas(r, T, fator) {
  var x = r, n = function (v) { return v == null ? null : +v; };
  x.venda = n(r.venda) || 0; x.tabela = n(r.tabela) || 0; x.cmv = n(r.cmv) || 0; x.cmv_real = n(r.cmv_real); x.bonif = n(r.bonif) || 0;
  x.meta = n(r.meta); x.peso = n(r.peso); x.mix = n(r.mix);
  x.lucro = x.venda - x.cmv; x.plucro = x.venda ? x.lucro / x.venda : null; x.desc = x.tabela ? x.venda / x.tabela - 1 : null;
  x.pbonif = x.venda ? x.bonif / x.venda : null; x.part = T.venda ? x.venda / T.venda : null;
  x.pmeta = x.meta ? x.venda / x.meta : null; x.proj = fator == null ? null : x.venda * fator;
  return x;
}
var pct2 = function (v) { return v == null ? "" : L.fPct(v, 2); };
var negativo = function (v) { return v != null && v < 0 ? "neg" : ""; };
var C = {
  pedidos: { id: "pedidos", titulo: "Qt.pedidos", tipo: "inteiro", valor: function (r) { return +r.pedidos; } },
  cli_pos: { id: "cli_pos", titulo: "Qt.clientes pos.", tipo: "inteiro", valor: function (r) { return +r.cli_pos; }, dica: "Clientes com pedido no período (positivados)" },
  rcas: { id: "rcas", titulo: "Qt.rcas", tipo: "inteiro", valor: function (r) { return +r.rcas; }, essencial: false },
  visitas: { id: "visitas", titulo: "Tot.visitas", tipo: "inteiro", valor: function (r) { return +r.visitas; }, dica: "Cliente × dia com pedido" },
  cad: { id: "cad", titulo: "Qt.clientes cad.", tipo: "inteiro", valor: function (r) { return r.cli_cad == null ? null : +r.cli_cad; }, somar: true, dica: "Clientes com o RCA como RCA 1 ou 2, cadastrados até o fim do período" },
  meta: { id: "meta", titulo: "Vl.meta", tipo: "moeda", valor: function (r) { return r.meta; } },
  venda: { id: "venda", titulo: "Vl.venda", tipo: "moeda", barra: true, valor: function (r) { return r.venda; } },
  part: { id: "part", titulo: "%Part.vendas", tipo: "pct", somar: false, valor: function (r) { return r.part; }, fmt: pct2 },
  pmeta: { id: "pmeta", titulo: "%Metas", tipo: "pct", somar: false, valor: function (r) { return r.pmeta; }, fmt: pct2 },
  proj: { id: "proj", titulo: "Proj.vendas", tipo: "moeda", essencial: false, valor: function (r) { return r.proj; }, dica: "Venda ÷ dias úteis passados × dias úteis do período" },
  desc: { id: "desc", titulo: "%Desc.", tipo: "pct", somar: false, valor: function (r) { return r.desc; }, fmt: pct2, classe: negativo, dica: "Venda contra o preço de tabela" },
  bonif: { id: "bonif", titulo: "Vl.bonificação", tipo: "moeda", valor: function (r) { return r.bonif; } },
  pbonif: { id: "pbonif", titulo: "%Bonificação", tipo: "pct", somar: false, essencial: false, valor: function (r) { return r.pbonif; }, fmt: pct2 },
  plucro: { id: "plucro", titulo: "%Lucro", tipo: "pct", somar: false, valor: function (r) { return r.plucro; }, fmt: pct2, classe: negativo },
  media: { id: "media", titulo: "Qt.média itens", tipo: "num2", somar: false, essencial: false, valor: function (r) { return +r.media_itens; }, exportarTipo: "moeda" },
  tabela: { id: "tabela", titulo: "Vl.tabela", tipo: "moeda", essencial: false, valor: function (r) { return r.tabela; } },
  cmv: { id: "cmv", titulo: "Vl.CMV", tipo: "moeda", valor: function (r) { return r.cmv; } },
  lucro: { id: "lucro", titulo: "Vl.Lucro", tipo: "moeda", valor: function (r) { return r.lucro; }, classe: negativo },
  cmvr: { id: "cmvr", titulo: "Vl.CMV real", tipo: "moeda", essencial: false, valor: function (r) { return r.cmv_real; } },
  itens: { id: "itens", titulo: "Qt.itens", tipo: "inteiro", valor: function (r) { return +r.qt_itens; } },
  pz: { id: "pz", titulo: "Pz.médio", tipo: "inteiro", somar: false, essencial: false, valor: function (r) { return r.pz_medio == null ? null : Math.round(+r.pz_medio); } },
  peso: { id: "peso", titulo: "Peso (Kg)", tipo: "num", essencial: false, valor: function (r) { return r.peso; }, fmt: function (v) { return v == null ? "" : L.fNum(v, 3); }, exportarTipo: "moeda" },
  mix: { id: "mix", titulo: "Qt.mix vend.", tipo: "inteiro", somar: false, valor: function (r) { return r.mix; }, fmt: function (v) { return v == null ? "—" : L.fInt(v); },
         dica: "Produtos diferentes vendidos (só para os últimos 62 dias, que têm os itens)" },
};
function col(id, mais) { return Object.assign({}, C[id], mais || {}); }

var CHAVE = {
  sup: ["Cód.", "Supervisor"], rca: ["Cód.RCA", "RCA"], cli: ["Cód.", "Cliente"], dia: ["Data", "Dia da semana"],
  prazo: ["Cód.", "Plano de pagamento"], cobranca: ["Cód.", "Cobrança"], emitente: ["Matrícula", "Emitente"], regiao: ["Cód.", "Região"],
  area: ["Cód.", "Área de atuação"], classe: ["Classe", "Classe de venda do cliente"], origem: ["Cód.", "Origem da venda"],
  checkout: ["Caixa", "Check out"], fornecedor: ["Cód.", "Fornecedor"],
};
function nomeLinha(por, r) {
  var vazio = r.k == null || r.k === -1 || r.k === "_";
  if (por === "dia") return L.titulo(L.DIAS_SEMANA[L.dowDe(L.diaDeIso(r.k))]);
  if (por === "origem") return vazio ? "Sem origem" : ORIGEM[r.k] || "Origem " + r.k;
  if (por === "classe") return vazio ? "Sem classe" : "Classe " + r.k;
  if (por === "checkout") return vazio ? "Sem check out (pedido de venda)" : "Caixa " + r.k;
  var sem = { prazo: "Sem plano de pagamento", cobranca: "Sem cobrança", emitente: "Sem emitente", regiao: "Sem região", area: "Sem área de atuação", fornecedor: "Sem fornecedor no cadastro" };
  if (vazio && sem[por]) return sem[por];
  if (!r.nome) return por === "emitente" ? "Matrícula " + r.k : por === "sup" ? "* NÃO VINCULADO *" : String(r.k);
  return L.titulo(r.nome) + (por === "regiao" && r.uf ? " · " + r.uf : "");
}
function colunasDe(por) {
  var ch = CHAVE[por];
  var cod = { id: "k", titulo: ch[0], tipo: por === "dia" ? "data" : "texto", alinhar: "esq", valor: function (r) { return r.k == null || r.k === -1 || r.k === "_" ? "" : String(r.k); },
    ordVal: function (r) { var v = +r.k; return isNaN(v) ? String(r.k) : v; }, fmt: por === "dia" ? function (v, r) { return L.fData(r.k); } : null };
  var nome = { id: "nome", titulo: ch[1], tipo: "texto", valor: function (r) { return r._nome; } };
  if (por === "sup") return [cod, nome, col("pedidos"), col("cli_pos"), col("rcas", { essencial: true }), col("meta"), col("venda"), col("part"), col("pmeta"), col("proj"),
    col("desc"), col("bonif"), col("pbonif"), col("plucro"), col("media"), col("tabela"), col("cmv"), col("lucro"), col("cmvr"), col("itens"), col("pz"), col("peso"), col("mix")];
  if (por === "rca") return [cod, nome, col("cli_pos"), col("pedidos"), col("visitas"), col("cad"), col("venda"), col("pmeta", { titulo: "%Meta" }), col("proj"), col("meta"),
    col("desc"), col("pbonif", { titulo: "%Bonif.", essencial: true }), col("plucro"), col("media", { titulo: "Média itens" }), col("tabela"), col("cmv"), col("part", { titulo: "%Part.vendas", essencial: false }),
    col("cmvr"), { id: "sup", titulo: "Supervisor", tipo: "texto", essencial: false, valor: function (r) { return (r.codsupervisor == null ? "" : r.codsupervisor + " - ") + L.titulo(r.supervisor || ""); } },
    col("itens"), col("peso"), col("bonif", { essencial: false }), col("mix")];
  if (por === "cli") return [cod, nome, { id: "cidade", titulo: "Cidade", tipo: "texto", essencial: false, valor: function (r) { return r.cidade ? L.titulo(r.cidade) + (r.uf ? " · " + r.uf : "") : ""; } },
    col("pedidos"), col("venda"), col("tabela", { essencial: true }), col("cmv"), col("cmvr", { essencial: true }), col("desc"), col("pbonif", { titulo: "%Bonif.", essencial: true }),
    col("plucro"), col("bonif"), col("lucro", { essencial: false }), col("itens", { essencial: false }), col("mix")];
  return [cod, nome, col("pedidos"), col("cli_pos"), col("venda"), col("part"), col("tabela"), col("desc"), col("bonif"), col("pbonif"), col("cmv"), col("lucro"),
    col("plucro"), col("cmvr"), col("itens"), col("media"), col("pz"), col("peso"), col("mix")]
    .filter(function (c) { return por !== "fornecedor" || (c.id !== "peso" && c.id !== "media" && c.id !== "pz"); });   // por item não há peso nem prazo
}

/* ------------------------------ render ------------------------------ */
function render(raiz) {
  var s = est(), p = L.periodo();
  raiz.appendChild(barra(s));
  if (s.aba === "analitico") return renderAnalitico(raiz, p, s);
  var nivel = s.aba === "sup" ? s.trilha.length : 0;
  raiz.appendChild(trilha(s, ABAS.filter(function (a) { return a[0] === s.aba; })[0][1]));
  if (p.dias > 400) { raiz.appendChild(L.h("div", { class: "vazio", html: "<b>Período grande demais</b>Escolha até 400 dias (por exemplo, Ano atual ou 12 meses)." })); return; }
  if (s.aba === "sup" && nivel >= 3) return renderPedidosCliente(raiz, p, s);
  var por = s.aba === "sup" ? NIVEL[nivel] : s.aba;
  var corpo = L.h("div", { class: "vazio", html: "<b>Lendo o resumo…</b>Do banco, com os filtros acima." });
  raiz.appendChild(corpo);
  // clicou no RCA: a trajetória dele vem junto (pedida em paralelo com a lista de clientes)
  var dias = s.aba === "sup" && nivel === 2 ? buscar("api/resumo?por=dia&" + consulta(p, maisDaTrilha(s))) : null;
  buscar("api/resumo?por=" + por + "&" + consulta(p, maisDaTrilha(s))).then(function (res) {
    if (!corpo.isConnected) return;
    corpo.replaceWith(montarResumo(por, res, s, dias));
    L.executarFila();
  }).catch(function (e) { if (corpo.isConnected) corpo.replaceWith(L.erroTela("Não foi possível ler o resumo", e.message || String(e))); });
}

function montarResumo(por, res, s, dias) {
  var raiz = L.h("div"), T = res.totais || {}, fator = res.proj_fator;
  T.venda = +T.venda || 0;
  raiz.appendChild(rodape(res));
  if (dias) { var gt = L.grade(painelTrajetoriaRca(L.periodo(), s, dias)); gt.style.marginBottom = "16px"; raiz.appendChild(gt); }
  if (por === "fornecedor" && res.sem_itens) {
    raiz.appendChild(L.h("div", { class: "vazio", html: "<b>Por fornecedor só nos últimos 62 dias</b>A conta por fornecedor sai dos itens dos pedidos, que o painel guarda desde " + L.esc(L.fData(res.itens_desde)) + ". Escolha um período a partir dessa data." }));
    return raiz;
  }
  var linhas = (res.linhas || []).map(function (r) { contas(r, T, fator); r._nome = nomeLinha(por, r); return r; });
  if (por === "dia" && linhas.length > 1) raiz.appendChild(L.grade(graficoEvolucao(linhas)));
  var titulos = { sup: "Por supervisor", rca: "RCAs", cli: "Clientes", dia: "Por evolução" };
  var tit = s.aba === "sup" ? (s.trilha.length ? titulos[por] + " de " + (s.trilha[s.trilha.length - 1].k == null ? "" : s.trilha[s.trilha.length - 1].k + " - ") + L.titulo(s.trilha[s.trilha.length - 1].nome || "") : "Por supervisor") : ABAS.filter(function (a) { return a[0] === s.aba; })[0][1];
  var clique = { sup: "clique no supervisor para ver os RCAs", rca: "clique no RCA para ver os clientes", cli: "clique no cliente para ver os pedidos" }[por] || "clique na linha para ver os pedidos";
  var t = L.tabela({
    titulo: "Relatório 146 — " + tit, arquivo: "relatorio-146-" + por, aba: tit.slice(0, 30),
    filtrosTexto: function () { return L.descricaoFiltros(); },
    linhas: linhas, porPagina: 100, fixas: 2,
    ordem: por === "dia" || por === "cli" ? { id: "k", desc: false } : { id: "venda", desc: true },   // como a 146: clientes por código
    buscaTexto: function (r) { return r.k + " " + r._nome; }, buscaDica: "Buscar código ou nome…",
    colunas: colunasDe(por),
    aoClicar: function (r) {
      if (s.aba === "sup") { s.trilha.push({ tipo: por, k: r.k, nome: r.nome || r._nome }); L.irPara("pedidos"); return; }
      s.dim = { aba: s.aba, k: r.k, nome: (por === "dia" ? L.fData(r.k) + " · " : (r.k == null || r.k === -1 || r.k === "_" ? "" : r.k + " - ")) + r._nome };
      s.aba = "analitico"; L.irPara("pedidos");
    },
    vazio: "Nenhuma venda com estes filtros.",
  });
  var sub = L.fInt(linhas.length) + " linha" + (linhas.length === 1 ? "" : "s") + " · " + L.periodo().rot + " · " + clique + (res.mix_ok ? "" : " · mix só nos últimos 62 dias");
  raiz.appendChild(L.grade(L.painel({ titulo: tit, sub: sub, classe: "c-12", semPad: true, corpo: t })));
  if (por === "origem") raiz.appendChild(L.nota("Origem do pedido no WinThor (ORIGEMPED): F força de vendas, T telemarketing, B balcão, R balcão reserva, C call center."));
  if (por === "classe") raiz.appendChild(L.nota("Classe de venda do cadastro do cliente (CLASSEVENDA). Quase nenhum cliente tem classe preenchida no WinThor."));
  if (por === "checkout") raiz.appendChild(L.nota("Caixa (NUMCAIXA) do pedido, usado nas vendas de balcão com check out. Pedido de venda comum não tem caixa."));
  if (por === "fornecedor") raiz.appendChild(L.nota("Por fornecedor sai dos itens: venda = quantidade × (preço − ST); o rodapé é o dos pedidos (com despesas e frete fora da tabela)."));
  return raiz;
}

function graficoEvolucao(linhas) {
  var ord = linhas.slice().sort(function (a, b) { return a.k < b.k ? -1 : 1; }), Cc = L.cores(), hoje = L.isoDeDia(L.hojeDia());
  var el = L.painel({ titulo: "Venda por dia", sub: "clique numa coluna para ver os pedidos do dia", classe: "c-12" }), box = L.h("div");
  el.corpo.appendChild(box);
  L.fila.push(function () {
    L.graf.colunas(box, { categorias: ord.map(function (r) { return L.fData(r.k).slice(0, 5); }), series: [{ nome: "Venda", valores: ord.map(function (r) { return r.venda; }), cor: Cc.d[0] }],
      corBarra: function (n) { return ord[n].k === hoje ? Cc.d[5] : Cc.d[0]; }, altura: 240, tipo: "moeda", fmt: L.fRc, larguraMax: 46,
      dica: function (n) { var r = ord[n]; return { titulo: r._nome + ", " + L.fData(r.k), linhas: [{ rot: "Venda", val: L.fBRL(r.venda, 2) }, { rot: "Pedidos", val: L.fInt(r.pedidos) }, { rot: "% de lucro", val: L.fPct(r.plucro, 2) }], clique: "Clique para ver os pedidos do dia" }; },
      aoClicar: function (n) { var s = est(), r = ord[n]; s.dim = { aba: "dia", k: r.k, nome: L.fData(r.k) + " · " + r._nome }; s.aba = "analitico"; L.irPara("pedidos"); } });
  });
  return el;
}

/* trajetória do RCA (pedido do Júlio, 2026-10-29: "quando eu clicar no RCA na aba de Pedidos precisa abrir o gráfico também,
   depois que for pra pedidos pode sumir, só na área RCA"): na tela dos clientes do RCA, a venda dele por dia — por mês acima
   de 62 dias —, do banco e com o mesmo recorte da tabela (Selecionar, Clientes, filtros), média tracejada e o clique abrindo
   os pedidos do dia (ou do mês) daquele RCA. Nos pedidos do cliente ele some. */
function painelTrajetoriaRca(p, s, dias) {
  var sup = s.trilha[0], rca = s.trilha[1], porMes = p.dias > 62, hoje = L.hojeDia(), Cc = L.cores();
  var el = L.painel({ titulo: "Trajetória de " + rca.k + " - " + L.titulo(rca.nome || ""), classe: "c-12",
    sub: "Venda por " + (porMes ? "mês" : "dia") + " · " + p.rot + " · com os filtros acima · clique numa coluna para ver os pedidos " + (porMes ? "do mês" : "do dia") });
  var box = L.h("div", { class: "vazio", html: "<b>Lendo a trajetória…</b>" });
  el.corpo.appendChild(box);
  dias.then(function (res) {
    if (!box.isConnected) return;
    var chaves = [], pos = new Map(), d;
    for (d = p.de; d <= p.ate; d++) { var k = porMes ? L.mesDeDia(d) : d; if (!pos.has(k)) { pos.set(k, chaves.length); chaves.push(k); } }
    var v = chaves.map(function () { return 0; }), q = v.slice(), l = v.slice();
    (res.linhas || []).forEach(function (r) {
      var dia = L.diaDeIso(r.k), c = pos.get(porMes ? L.mesDeDia(dia) : dia);
      if (c == null) return;
      v[c] += +r.venda || 0; q[c] += +r.pedidos || 0; l[c] += (+r.venda || 0) - (+r.cmv || 0);
    });
    var comVenda = v.filter(function (x) { return x > 0; }), media = comVenda.length ? comVenda.reduce(function (a, b) { return a + b; }, 0) / comVenda.length : 0;
    if (!comVenda.length) { box.innerHTML = "<b>Sem venda</b>Nenhum pedido deste RCA no período com os filtros atuais."; return; }
    var emAndamento = function (n) { return porMes ? chaves[n] === L.mesDeDia(hoje) : chaves[n] === hoje; };
    var rotulo = function (n) { return porMes ? L.fMesKLongo(chaves[n]) : L.titulo(L.DIAS_SEMANA[L.dowDe(chaves[n])]) + ", " + L.fDia(chaves[n]); };
    el.cab.appendChild(L.h("div", { class: "painel-acoes" }, L.h("span", { class: "leg-media", html: "<i></i>Média <b>" + L.esc(L.fRc(media)) + "</b>" + (porMes ? " por mês" : " por dia com venda") })));
    var g = L.h("div");
    box.replaceWith(g);
    L.graf.colunas(g, {
      categorias: chaves.map(function (k) { return porMes ? L.fMesK(k) : L.fDiaCurto(k); }),
      series: [{ nome: "Venda", valores: v, cor: Cc.d[0] }],
      corBarra: function (n) { return emAndamento(n) ? Cc.d[5] : Cc.d[0]; },
      altura: 270, tipo: "moeda", fmt: L.fRc, larguraMax: 46, ref: [{ valor: media, rot: "" }],
      dica: function (n) {
        return { titulo: rotulo(n) + (emAndamento(n) ? " (em andamento)" : ""),
          linhas: [{ rot: "Venda", val: L.fBRL(v[n], 2), cor: Cc.d[0] }, { rot: "Pedidos", val: L.fInt(q[n]) },
                   { rot: "Ticket médio", val: L.fBRL(q[n] ? v[n] / q[n] : null, 2) }, { rot: "% de lucro", val: L.fPct(v[n] ? l[n] / v[n] : null, 2) },
                   { rot: "Média do período", val: L.fBRL(media, 2) }],
          clique: "Clique para ver os pedidos " + (porMes ? "do mês" : "do dia") };
      },
      aoClicar: function (n) {
        var de = porMes ? Math.max(p.de, L.primeiroDoMes(L.diaDeIso(String(chaves[n]).slice(0, 4) + "-" + String(chaves[n]).slice(4) + "-01"))) : chaves[n];
        var ate = porMes ? Math.min(p.ate, L.ultimoDoMes(de)) : chaves[n];
        L.abrirPedidos({ f: { sup: [sup.k == null ? -1 : sup.k], rca: [rca.k] }, periodo: { r: "livre", de: L.isoDeDia(de), ate: L.isoDeDia(ate) } },
                       rca.k + " - " + L.titulo(rca.nome || "") + " · " + rotulo(n));
      },
    });
    L.executarFila();
  }).catch(function (e) { if (box.isConnected) box.innerHTML = "<b>Não foi possível ler a trajetória</b>" + L.esc(e.message || String(e)); });
  return el;
}

/* ------------------------------ pedidos do cliente (o último nível da 146) ------------------------------ */
function renderPedidosCliente(raiz, p, s) {
  var corpo = L.h("div", { class: "vazio", html: "<b>Lendo os pedidos do cliente…</b>Do banco." });
  raiz.appendChild(corpo);
  buscar("api/pedidos?" + consulta(p, maisDaTrilha(s))).then(function (res) {
    if (!corpo.isConnected) return;
    var t = res.totais || {}, cli = s.trilha[2], novo = L.h("div");
    var linhas = (res.linhas || []).map(function (r) { return contas(r, { venda: +t.venda || 0 }, null); });
    var tab = L.tabela({
      titulo: "Relatório 146 — Pedidos do cliente " + cli.k, arquivo: "relatorio-146-pedidos-cliente", aba: "Pedidos do cliente",
      filtrosTexto: function () { return "Cliente " + cli.k + " - " + cli.nome + " · " + L.descricaoFiltros(); },
      linhas: linhas, porPagina: 100, fixas: 2, ordem: { id: "data", desc: true },
      buscaTexto: function (r) { return r.numped + " " + (r.plano || ""); }, buscaDica: "Buscar pedido…",
      colunas: colunasPedido(true),
      aoClicar: function (r) { L.abrirPedido(r); },
      vazio: "Nenhum pedido deste cliente com estes filtros.",
    });
    novo.appendChild(L.grade(L.painel({ titulo: "Pedidos do cliente: " + cli.k + " - " + L.titulo(cli.nome || ""), sub: L.fInt(linhas.length) + " pedidos · clique no pedido para ver os itens", classe: "c-12", semPad: true, corpo: tab })));
    corpo.replaceWith(novo);
  }).catch(function (e) { if (corpo.isConnected) corpo.replaceWith(L.erroTela("Não foi possível ler os pedidos", e.message || String(e))); });
}

/* as colunas do pedido: as da tela "Pedidos do cliente" da 146 (+ cliente, RCA e supervisor no Analítico) */
function colunasPedido(doCliente) {
  var cols = [
    { id: "data", titulo: "Data", tipo: "data", valor: function (r) { return r.data; }, ordVal: function (r) { return r.data + " " + String(r.hora == null ? 99 : r.hora).padStart(2, "0") + String(r.minuto == null ? 99 : r.minuto).padStart(2, "0"); } },
    { id: "numped", titulo: "Nº Pedido", tipo: "texto", valor: function (r) { return String(r.numped); }, ordVal: function (r) { return +r.numped; } },
    { id: "hora", titulo: "Hora", tipo: "texto", essencial: !doCliente, valor: function (r) { return r.hora == null ? "" : String(r.hora).padStart(2, "0") + ":" + String(r.minuto || 0).padStart(2, "0"); } },
    { id: "tv", titulo: "T.V.", tipo: "inteiro", somar: false, valor: function (r) { return r.condvenda; }, fmt: function (v) { return v == null ? "" : String(v); },
      dica: "Tipo de venda (condição de venda do WinThor). 5, 6, 11 e 12 contam como venda zero (bonificação, troca…)." },
    { id: "pos", titulo: "Pos.", tipo: "tag", valor: function (r) { return POSICAO[r.posicao] || r.posicao; },
      fmt: function (v, r) { return { html: '<span class="pos ' + L.esc(r.posicao) + '">' + L.esc(v) + "</span>" }; } },
  ];
  if (!doCliente) cols.push(
    { id: "cliente", titulo: "Cliente", tipo: "texto", valor: function (r) { return r.cliente ? L.titulo(r.cliente) : "Cliente " + r.codcli; }, titleTd: function (r) { return (r.cliente || "") + " (cód. " + r.codcli + ")"; } },
    { id: "cidade", titulo: "Cidade", tipo: "texto", essencial: false, valor: function (r) { return r.cidade ? L.titulo(r.cidade) : ""; } },
    { id: "uf", titulo: "UF", tipo: "texto", valor: function (r) { return r.uf || ""; } },
    { id: "rca", titulo: "RCA", tipo: "texto", valor: function (r) { return L.titulo(r.rca); } },
    { id: "sup", titulo: "Supervisor", tipo: "texto", essencial: false, valor: function (r) { return r.supervisor ? L.titulo(r.supervisor) : ""; } },
    { id: "fil", titulo: "Filial", tipo: "texto", essencial: false, valor: function (r) { return r.codfilial; } });
  cols.push(
    { id: "numcar", titulo: "Nº Carregamento", tipo: "texto", essencial: doCliente, valor: function (r) { return r.numcar == null || +r.numcar === 0 ? "" : String(r.numcar); } },
    { id: "nitens", titulo: "Nº Itens", tipo: "inteiro", valor: function (r) { return r.numitens == null ? null : +r.numitens; } },
    col("tabela", { essencial: doCliente }), col("venda", { barra: false }), col("bonif", { titulo: "Vl.bonific.", essencial: doCliente }),
    col("desc", { titulo: "%Desc" }), col("cmv", { essencial: doCliente }), col("lucro", { essencial: !doCliente }), col("plucro"), col("cmvr", { titulo: "Vl.CMV real" }),
    col("peso"), { id: "plano", titulo: "Plano Pagto", tipo: "texto", essencial: doCliente, valor: function (r) { return r.codplpag == null ? "" : r.codplpag + " - " + (r.plano ? L.titulo(r.plano) : ""); } },
    col("mix", { titulo: "Qt.mix vend.", fmt: function (v) { return v == null ? "" : L.fInt(v); } }));
  return cols;
}

/* ------------------------------ Analítico (o detalhe de cada clique) ------------------------------ */
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
  var Cc = L.cores(), emAndamento = function (n) { return porMes ? chaves[n] === L.mesDeDia(hoje) : chaves[n] === hoje; };
  var rotulo = function (n) { return porMes ? L.fMesKLongo(chaves[n]) : L.titulo(L.DIAS_SEMANA[L.dowDe(chaves[n])]) + ", " + L.fDia(chaves[n]); };
  var el = L.painel({ titulo: "Trajetória no período", classe: "c-12",
    sub: "Venda por " + (porMes ? "mês" : "dia") + " · " + p.rot + " · com os filtros acima · clique numa coluna para ver os pedidos " + (porMes ? "do mês" : "do dia"),
    acoes: comVenda.length ? L.h("span", { class: "leg-media", html: "<i></i>Média <b>" + L.esc(L.fRc(media)) + "</b>" + (porMes ? " por mês" : " por dia com venda") }) : null });
  var box = L.h("div");
  el.corpo.appendChild(box);
  if (!comVenda.length) { el.corpo.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda</b>Nenhum pedido no período com os filtros atuais." })); box.remove(); return el; }
  var cfg = {
    categorias: chaves.map(function (k) { return porMes ? L.fMesK(k) : L.fDiaCurto(k); }),
    series: [{ nome: "Venda", valores: v, cor: Cc.d[0] }],
    corBarra: function (n) { return emAndamento(n) ? Cc.d[5] : Cc.d[0]; },
    altura: 270, tipo: "moeda", fmt: L.fRc, larguraMax: 46,
    ref: [{ valor: media, rot: "" }],
    dica: function (n) {
      return { titulo: rotulo(n) + (emAndamento(n) ? " (em andamento)" : ""),
        linhas: [{ rot: "Venda", val: L.fBRL(v[n], 2), cor: Cc.d[0] }, { rot: "Pedidos", val: L.fInt(q[n]) },
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

function renderAnalitico(raiz, p, s) {
  raiz.appendChild(trilha(s, "Analítico"));
  var semPacote = !!s.dim || s.sel !== "todos" || s.tipo !== "todos";   // o pacote do navegador não tem esses recortes
  var kpis = L.h("div", { class: "kpis-espera" });
  if (p.dias <= 400) raiz.appendChild(kpis);
  if (!semPacote) raiz.appendChild(painelTrajetoria(p));
  if (p.dias > 400 && !(s.dim && s.dim.aba === "dia")) {
    raiz.appendChild(L.h("div", { class: "vazio", html: "<b>Período grande demais para listar pedido a pedido</b>Escolha até 400 dias (por exemplo, Ano atual ou 12 meses)." }));
    return;
  }
  var corpo = L.h("div", { class: "vazio", html: "<b>Lendo os pedidos…</b>Do banco, com os filtros acima." });
  raiz.appendChild(corpo);
  buscar("api/pedidos?" + consulta(p, maisDaDim(s))).then(function (res) {
    if (!corpo.isConnected) return;
    var t = res.totais || {}, venda = +t.venda || 0, lucro = +t.lucro || 0, n = +t.pedidos || 0;
    kpis.classList.remove("kpis-espera");
    L.limpar(kpis).appendChild(L.kpis(
      L.kpi({ icone: "dinheiro", rot: "Venda", valor: venda, fmt: L.fR, fmtTitulo: function (v) { return L.fBRL(v, 2); }, classe: "heroi" }),
      L.kpi({ icone: "prancheta", rot: "Pedidos", valor: n, fmt: L.fInt }),
      L.kpi({ icone: "etiqueta", rot: "Ticket médio", valor: n ? venda / n : null, fmt: function (v) { return L.fBRL(v, 2); } }),
      L.kpi({ icone: "percent", rot: "% de lucro", valor: venda ? lucro / venda : null, fmt: function (v) { return L.fPct(v, 2); } }),
      L.kpi({ icone: "pessoas", rot: "Clientes atendidos", valor: +t.clientes || 0, fmt: L.fInt, ajuda: "Clientes diferentes com pedido no recorte (positivação)." })));
    var linhas = (res.linhas || []).map(function (r) { return contas(r, { venda: venda }, null); });
    var tab = L.tabela({
      titulo: "Relatório 146 — Pedidos", arquivo: "relatorio-146-pedidos", aba: "Pedidos",
      filtrosTexto: function () { return (s.dim ? s.dim.nome + " · " : L.estado.origem ? L.estado.origem + " · " : "") + L.descricaoFiltros(); },
      linhas: linhas, porPagina: 50, ordem: { id: "data", desc: true },
      buscaTexto: function (r) { return r.numped + " " + (r.cliente || "") + " " + r.codcli + " " + (r.cidade || "") + " " + (r.rca || "") + " " + (r.supervisor || ""); },
      buscaDica: "Buscar pedido, cliente, cidade, RCA…",
      colunas: colunasPedido(false),
      totais: function () { return [
        { rot: "Venda", valor: L.fBRL(venda, 2), pri: true }, { rot: "Pedidos", valor: L.fInt(n) },
        { rot: "Lucro", valor: L.fBRL(lucro, 2) }, { rot: "Clientes", valor: L.fInt(+t.clientes || 0) }]; },
      aoClicar: function (r) { L.abrirPedido(r); },        // a tela lateral com os itens (pedido-lateral.js)
      vazio: "Nenhum pedido com estes filtros.",
    });
    var novo = L.h("div");
    if (n > linhas.length) novo.appendChild(L.h("div", { class: "aviso-limite", text: "Mostrando os " + L.fInt(linhas.length) + " pedidos mais recentes de " + L.fInt(n) + ". Os totais acima são do recorte inteiro; para a lista completa, diminua o período ou filtre." }));
    novo.appendChild(L.painel({ titulo: "Pedidos", sub: (s.dim && s.dim.aba === "dia" ? s.dim.nome : p.rot) + " · do mais novo para o mais velho · clique no pedido para ver os itens", classe: "c-12", semPad: true, corpo: tab }));
    corpo.replaceWith(novo);
  }).catch(function (e) {
    if (!corpo.isConnected) return;
    corpo.replaceWith(L.erroTela("Não foi possível ler os pedidos", e.message || String(e)));
  });
}

})();
