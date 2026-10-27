/* =============================================================================
 * dados.js — os pacotes do Relatório 146, juntos, e as contas da tela.
 *
 * O banco guarda três pacotes prontos (relatorio146.pacote), no grão do Power BI
 * (dia × UF do cliente × supervisor × RCA × filial): "base" (desde 01/01/2025 até 61
 * dias atrás), "recente" (60 dias até anteontem) e "hoje" (ontem e hoje). O AGENTE LUBE
 * remonta o pacote que mudou depois de gravar; aqui eles viram uma tabela só, cada um
 * valendo no próprio intervalo de datas. Quem filtra e soma é o navegador.
 *
 * A cópia de cada pacote fica no navegador (IndexedDB): abrir de novo só baixa o que mudou.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* ------------------------------ datas (dia = dias desde 01/01/2025) ------------------------------ */
var BASE = Date.UTC(2025, 0, 1);
L.isoDeDia = function (d) { return new Date(BASE + d * 864e5).toISOString().slice(0, 10); };
L.diaDeIso = function (iso) { return Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - BASE) / 864e5); };
L.fDia = function (d) { return L.fData(L.isoDeDia(d)); };
L.fDiaCurto = function (d) { var s = L.isoDeDia(d); return s.slice(8, 10) + "/" + s.slice(5, 7); };
L.mesDeDia = function (d) { var s = L.isoDeDia(d); return +s.slice(0, 4) * 100 + +s.slice(5, 7); };   // 202610
L.fMesK = function (k) { return L.MES3[k % 100 - 1] + "/" + String(Math.floor(k / 100)).slice(2); };
L.fMesKLongo = function (k) { return L.MESES[k % 100 - 1] + "/" + Math.floor(k / 100); };
L.DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
L.dowDe = function (d) { return new Date(BASE + d * 864e5).getUTCDay(); };
/* "hoje" é o de Brasília, que vem do banco (o Power BI usava o dia em UTC: depois das 21h já era amanhã) */
L.hojeDia = function () {
  if (L.META && L.META.hoje) return L.diaDeIso(L.META.hoje);
  var n = new Date(); return Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - BASE) / 864e5);
};
function primeiroDoMes(d) { var s = L.isoDeDia(d); return L.diaDeIso(s.slice(0, 8) + "01"); }
function ultimoDoMes(d) { var s = L.isoDeDia(d), y = +s.slice(0, 4), m = +s.slice(5, 7); return L.diaDeIso(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)); }
function somarMeses(d, n) {                       // mesmo dia, n meses depois (limita ao fim do mês)
  var s = L.isoDeDia(d), y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + n, dia = +s.slice(8, 10);
  var yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12, fim = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return L.diaDeIso(new Date(Date.UTC(yy, mm, Math.min(dia, fim))).toISOString().slice(0, 10));
}
L.somarMeses = somarMeses; L.primeiroDoMes = primeiroDoMes; L.ultimoDoMes = ultimoDoMes;
L.segundaDe = function (d) { return d - ((L.dowDe(d) + 6) % 7); };

/* ------------------------------ regiões (cartões) ------------------------------ */
/* Os cartões regionais do Power BI eram por SUPERVISOR (listas de nomes); a participação por UF,
   pela cidade do CLIENTE. As duas convivem, cada uma com o nome que diz o que conta. */
L.REGIOES = [
  { id: 1, k: "ES", rot: "ES", longo: "Equipes ES" },
  { id: 2, k: "BA", rot: "BA", longo: "Equipes BA" },
  { id: 3, k: "RJ", rot: "RJ", longo: "Equipes RJ" },
  { id: 4, k: "INTERNA", rot: "Operação interna", longo: "Operação interna" },
  { id: 5, k: "FORA", rot: "Fora das regionais", longo: "Fora das regionais" },
];
var REG_POR_K = {}; L.REGIOES.forEach(function (r) { REG_POR_K[r.k] = r; });
L.regiaoDeK = function (k) { return REG_POR_K[k] || REG_POR_K.FORA; };

/* UF vira número (para o filtro e o link da visão): "ES" -> 17747; sem UF -> 0 */
L.ufId = function (uf) { return uf ? uf.charCodeAt(0) * 256 + uf.charCodeAt(1) : 0; };
L.ufDeId = function (id) { return id ? String.fromCharCode(Math.floor(id / 256), id % 256) : ""; };

/* ------------------------------ cópia no navegador ------------------------------ */
var IDB = "relatorio146-lube", LOJA = "pacotes";
function idbAbrir() {
  return new Promise(function (ok, erro) {
    if (!window.indexedDB) return erro(new Error("sem IndexedDB"));
    var r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = function () { r.result.createObjectStore(LOJA); };
    r.onsuccess = function () { ok(r.result); }; r.onerror = function () { erro(r.error); };
  });
}
function idbLer(nome) {
  return idbAbrir().then(function (db) { return new Promise(function (ok) {
    var q = db.transaction(LOJA, "readonly").objectStore(LOJA).get(nome);
    q.onsuccess = function () { ok(q.result || null); }; q.onerror = function () { ok(null); };
  }); }).catch(function () { return null; });
}
function idbGravar(nome, obj) {
  return idbAbrir().then(function (db) { return new Promise(function (ok) {
    var tx = db.transaction(LOJA, "readwrite"); tx.objectStore(LOJA).put(obj, nome);
    tx.oncomplete = function () { ok(true); }; tx.onerror = function () { ok(false); };
  }); }).catch(function () { return false; });
}
function erroHttp(r, oque) {
  return r.json().catch(function () { return {}; }).then(function (j) {
    if (r.status === 401) throw new Error("Sua sessão do Painel Lube expirou. Entre de novo pelo portal.");
    throw new Error("Não foi possível ler " + oque + " (" + r.status + (j && j.mensagem ? ": " + j.mensagem : j && j.erro ? ": " + j.erro : "") + ").");
  });
}
L.erroHttp = erroHttp;
function baixarPacote(nome, versao) {
  return fetch("api/pacote?nome=" + encodeURIComponent(nome) + "&v=" + encodeURIComponent(versao || "x"), { cache: "no-store" }).then(function (r) {
    if (!r.ok) return erroHttp(r, "o pacote de dados (" + nome + ")");
    var corpo = r.body;
    if (r.headers.get("X-Pacote") === "gzip" && window.DecompressionStream) corpo = corpo.pipeThrough(new DecompressionStream("gzip"));
    return new Response(corpo).text();
  }).then(function (txt) { return JSON.parse(txt); });
}
L.versaoNoBanco = function () { return fetch("api/versao?_=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : erroHttp(r, "a versão dos dados"); }); };

/* ------------------------------ carga: versão → pacotes que mudaram → juntar ------------------------------ */
L.PAC = {};               // nome -> { versao, j }
L.carregarTudo = function (aviso) {
  aviso = aviso || function () {};
  return L.versaoNoBanco().then(function (ver) {
    L.ULTIMA_VERSAO = ver; L.CONFERIDO_EM = new Date();
    if (!ver.pacotes || !ver.pacotes.length) throw new Error("Os pacotes do painel ainda não foram montados no banco.");
    var baixou = false;
    return Promise.all(ver.pacotes.map(function (p) {
      return idbLer(p.nome).then(function (c) {
        if (c && c.versao === p.versao) { L.PAC[p.nome] = c; return; }
        baixou = true;
        aviso("Baixando os dados" + (c ? " novos" : " (só na primeira vez)") + "…");
        return baixarPacote(p.nome, p.versao).then(function (j) { L.PAC[p.nome] = { versao: p.versao, j: j }; idbGravar(p.nome, L.PAC[p.nome]); });
      });
    })).then(function () { L.ORIGEM = baixou ? "banco" : "copia"; montar(); });
  }, function (e) {
    // sem o servidor: abre com as cópias guardadas, avisando
    return Promise.all(["base", "recente", "hoje"].map(function (n) { return idbLer(n).then(function (c) { if (c) L.PAC[n] = c; }); })).then(function () {
      if (!Object.keys(L.PAC).length) throw e;
      L.ORIGEM = "offline"; L.toast("Sem conexão com o servidor: mostrando os dados guardados neste computador", "erro");
      montar();
    });
  });
};
/* Ao vivo: baixa só os pacotes cuja versão mudou e remonta. Devolve true se remontou. */
L.atualizarAoVivo = function (ver) {
  L.ULTIMA_VERSAO = ver; L.CONFERIDO_EM = new Date();
  var mudaram = (ver.pacotes || []).filter(function (p) { return !L.PAC[p.nome] || L.PAC[p.nome].versao !== p.versao; });
  if (!mudaram.length) return Promise.resolve(false);
  return Promise.all(mudaram.map(function (p) {
    return baixarPacote(p.nome, p.versao).then(function (j) { L.PAC[p.nome] = { versao: p.versao, j: j }; idbGravar(p.nome, L.PAC[p.nome]); });
  })).then(function () { L.ORIGEM = "banco"; montar(); return true; });
};

/* ------------------------------ botão Atualizar: a ponte até o agente ------------------------------ */
L.pedirAtualizacao = function () {
  return fetch("api/atualizar", { method: "POST", cache: "no-store" }).then(function (r) {
    if (r.status === 404) return { agente: false, mensagem: "Este painel ainda não tem a ponte com o agente." };
    return r.ok ? r.json() : erroHttp(r, "o pedido de atualização");
  });
};
L.esperarPedido = function (id, limiteMs) {
  var fim = Date.now() + (limiteMs || 45000);
  return new Promise(function (ok, falha) {
    (function olhar() {
      fetch("api/versao?pedido=" + encodeURIComponent(id) + "&_=" + Date.now(), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : erroHttp(r, "o pedido de atualização"); })
        .then(function (v) {
          var p = v.pedido;
          if (p && /^(atendido|erro|expirado)$/.test(p.status)) return ok(v);
          if (Date.now() > fim) { v.pedido = Object.assign({}, p || {}, { status: "demorou" }); return ok(v); }
          setTimeout(olhar, 700);
        }, falha);
    })();
  });
};

/* ------------------------------ juntar os pacotes ------------------------------ */
L.R = null;               // { n, d, u, s, c, f, q, v, l } — uma linha por dia × UF × supervisor × RCA × filial
function montar() {
  var camadas = Object.keys(L.PAC).map(function (k) { return L.PAC[k].j; }).filter(Boolean)
    .sort(function (a, b) { return a.meta.desde < b.meta.desde ? -1 : 1; });
  var n = 0;
  camadas.forEach(function (j) { n += j.r.n; });
  var R = { n: 0, d: new Int16Array(n), u: new Uint16Array(n), s: new Int32Array(n), c: new Int32Array(n), f: new Int16Array(n),
            q: new Int32Array(n), v: new Float64Array(n), l: new Float64Array(n) };
  var sup = new Map(), rca = new Map(), grupos = new Map(), ufs = new Map(), k = 0;
  camadas.forEach(function (j, ci) {
    var de = L.diaDeIso(j.meta.desde), prox = camadas[ci + 1], ate = j.meta.ate ? L.diaDeIso(j.meta.ate) : Infinity;
    if (prox) ate = Math.min(ate, L.diaDeIso(prox.meta.desde) - 1);      // a camada mais nova vale por cima
    var r = j.r;
    for (var i = 0; i < r.n; i++) {
      var d = r.d[i];
      if (d < de || d > ate) continue;
      var uf = r.u[i] || "", id = L.ufId(uf);
      if (!ufs.has(id)) ufs.set(id, { id: id, uf: uf, v: 0 });
      R.d[k] = d; R.u[k] = id; R.s[k] = r.s[i] == null ? -1 : r.s[i]; R.c[k] = r.c[i]; R.f[k] = r.f[i];
      R.q[k] = r.q[i]; R.v[k] = r.v[i] == null ? 0 : +r.v[i]; R.l[k] = r.l[i] == null ? NaN : +r.l[i];
      ufs.get(id).v += R.v[k];
      k++;
    }
    (j.sup || []).forEach(function (x) { sup.set(x[0], x[1]); });
    (j.rca || []).forEach(function (x) { rca.set(x[0], x[1]); });
    (j.grupos || []).forEach(function (x) { grupos.set(x[0], x[1]); });
  });
  R.n = k;
  L.R = R; L.SUP = sup; L.RCA = rca; L.GRUPOS = grupos;
  L.UFS = Array.from(ufs.values()).sort(function (a, b) { return b.v - a.v; });
  var hoje = L.PAC.hoje && L.PAC.hoje.j, base = L.PAC.base && L.PAC.base.j;
  L.META = {
    hoje: hoje ? hoje.meta.hoje : null,
    ult_pedido: hoje ? hoje.meta.ult_pedido : null,
    ao_vivo: hoje ? hoje.meta.gerado_em : null,
    desde: base ? base.meta.desde : "2025-01-01",
    pacotes: Object.keys(L.PAC).map(function (nome) { return { nome: nome, versao: L.PAC[nome].versao, gerado_em: L.PAC[nome].j.meta.gerado_em }; }),
  };
  L.diaMin = R.n ? R.d[0] : 0;
  cacheFiltro.clear();
  definirDimensoes();
}

/* ------------------------------ dimensões (filtros e nomes) ------------------------------ */
var MIN = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, em: 1, a: 1, o: 1, para: 1, com: 1 };
function titulo(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim().split(" ").map(function (w, i) {
    if (!w) return w; if (i && MIN[w]) return w;
    if (/^(es|rj|ba|mg|sp|pr|sc|rca|me|ltda|ii|iii)$/.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}
L.titulo = titulo;
L.nomeSup = function (cod) { return cod < 0 ? "* NAO VINCULADO *" : (L.SUP.get(cod) || "Supervisor " + cod); };
L.nomeRca = function (cod) { return L.RCA.get(cod) || "RCA " + cod; };
L.grupoDeSup = function (cod) { var g = L.GRUPOS.get(cod); return g === "ES" || g === "BA" || g === "RJ" || g === "INTERNA" ? g : "FORA"; };
L.NOMES_UF = { ES: "Espírito Santo", RJ: "Rio de Janeiro", BA: "Bahia", MG: "Minas Gerais", SP: "São Paulo", PR: "Paraná", SC: "Santa Catarina",
               RS: "Rio Grande do Sul", GO: "Goiás", DF: "Distrito Federal", PE: "Pernambuco", SE: "Sergipe", AL: "Alagoas" };

function definirDimensoes() {
  var R = L.R;
  var visto = { s: new Set(), c: new Set(), f: new Set() };
  for (var i = 0; i < R.n; i++) { visto.s.add(R.s[i]); visto.c.add(R.c[i]); visto.f.add(R.f[i]); }
  L.DIM = {
    regiao: { rot: "Região (equipes)", nome: function (id) { var r = L.REGIOES[id - 1]; return r ? r.longo : String(id); },
              todos: function () { return L.REGIOES.map(function (r) { return { id: r.id, t: r.longo }; }); } },
    uf: { rot: "UF do cliente", nome: function (id) { var u = L.ufDeId(id); return u ? u + (L.NOMES_UF[u] ? " · " + L.NOMES_UF[u] : "") : "Sem UF"; },
          todos: function () { return L.UFS.map(function (x) { return { id: x.id, t: x.uf ? x.uf + (L.NOMES_UF[x.uf] ? " · " + L.NOMES_UF[x.uf] : "") : "Sem UF" }; }); } },
    sup: { rot: "Supervisor", nome: function (id) { return L.nomeSup(id); },
           todos: function () { return Array.from(visto.s).sort(function (a, b) { return L.nomeSup(a).localeCompare(L.nomeSup(b), "pt-BR"); })
             .map(function (s) { return { id: s, t: L.nomeSup(s), s: s >= 0 ? "cód. " + s : "" }; }); } },
    fil: { rot: "Filial", nome: function (id) { return "Filial " + id; },
           todos: function () { return Array.from(visto.f).sort(function (a, b) { return a - b; }).map(function (f) { return { id: f, t: "Filial " + f }; }); } },
    rca: { rot: "RCA", nome: function (id) { return titulo(L.nomeRca(id)); },
           todos: function () { return Array.from(visto.c).sort(function (a, b) { return L.nomeRca(a).localeCompare(L.nomeRca(b), "pt-BR"); })
             .map(function (c) { return { id: c, t: titulo(L.nomeRca(c)), s: "cód. " + c }; }); } },
  };
  Object.keys(L.DIM).forEach(function (k) {
    var d = L.DIM[k]; d.cache = null;
    d.itens = function () { if (!d.cache) { d.cache = d.todos().map(function (x) { x.n = L.norm(x.t + " " + (x.s || "") + " " + x.id); return x; }); } return d.cache; };
  });
}
L.nomeDe = function (dim, id) { var d = L.DIM && L.DIM[dim]; return d ? d.nome(id) : String(id); };

/* ------------------------------ período ------------------------------ */
L.RAPIDOS = [["hoje", "Hoje"], ["semana", "Semana"], ["mes", "Mês atual"], ["mesant", "Mês anterior"], ["d30", "30 dias"], ["ano", "Ano atual"], ["m12", "12 meses"], ["tudo", "Tudo"]];
L.periodo = function (per) {
  per = per || L.estado.periodo || { r: "mes" };
  var hoje = L.hojeDia(), de, ate, rot;
  switch (per.r) {
    case "hoje": de = ate = hoje; rot = "Hoje, " + L.fDia(hoje); break;
    case "semana": de = L.segundaDe(hoje); ate = hoje; rot = "Semana (segunda a hoje)"; break;
    case "d30": de = hoje - 29; ate = hoje; rot = "Últimos 30 dias"; break;
    case "mes": de = primeiroDoMes(hoje); ate = hoje; rot = L.fMesKLongo(L.mesDeDia(hoje)) + " (até " + L.fDiaCurto(hoje) + ")"; break;
    case "mesant": ate = primeiroDoMes(hoje) - 1; de = primeiroDoMes(ate); rot = L.fMesKLongo(L.mesDeDia(de)); break;
    case "ano": de = L.diaDeIso(L.isoDeDia(hoje).slice(0, 4) + "-01-01"); ate = hoje; rot = "Ano de " + L.isoDeDia(hoje).slice(0, 4); break;
    case "m12": de = primeiroDoMes(somarMeses(hoje, -11)); ate = hoje; rot = "Últimos 12 meses"; break;
    case "tudo": de = L.diaMin || 0; ate = hoje; rot = "Tudo (desde " + L.fDia(de) + ")"; break;
    default:
      de = per.de != null ? L.diaDeIso(per.de) : primeiroDoMes(hoje); ate = per.ate != null ? L.diaDeIso(per.ate) : hoje;
      if (ate < de) { var x = de; de = ate; ate = x; }
      rot = de === ate ? L.fDia(de) : L.fDia(de) + " a " + L.fDia(ate);
      if (de === primeiroDoMes(de) && ate === ultimoDoMes(de)) rot = L.fMesKLongo(L.mesDeDia(de));
  }
  return { de: de, ate: ate, rot: rot, r: per.r || "livre", dias: ate - de + 1 };
};
/* meses do período em ordem de calendário ("Setembro / Outubro"): o cartão do Power BI pegava o
   primeiro em ordem ALFABÉTICA (set+out mostrava "Outubro") */
L.mesesDoPeriodo = function (p) {
  var out = [], m = L.mesDeDia(p.de), fim = L.mesDeDia(p.ate);
  while (m <= fim && out.length < 30) { out.push(m); m = m % 100 === 12 ? m + 89 : m + 1; }
  return out;
};
/* comparações (padrão da casa): mês fechado com os meses antes; mês em andamento com o mesmo
   trecho do mês anterior; datas livres com os N dias antes. Ano anterior: as mesmas datas. */
function mesesEntre(de, ate) { var a = L.mesDeDia(de), b = L.mesDeDia(ate); return (Math.floor(b / 100) * 12 + b % 100) - (Math.floor(a / 100) * 12 + a % 100) + 1; }
L.comparacoes = function (p) {
  if (p.r === "tudo") return { pa: null, aa: null };
  var de = p.de, ate = p.ate, pa = null;
  var inicioMes = de === primeiroDoMes(de), meses = mesesEntre(de, ate);
  if (p.r === "ano") pa = null;
  else if (p.r === "semana") pa = { de: de - 7, ate: ate - 7 };
  else if (inicioMes && ate === ultimoDoMes(ate)) pa = { de: somarMeses(de, -meses), ate: ultimoDoMes(somarMeses(de, -1)) };
  else if (inicioMes && ate === L.hojeDia()) pa = { de: somarMeses(de, -meses), ate: somarMeses(ate, -meses) };
  else pa = { de: de - p.dias, ate: de - 1 };
  var aa = { de: somarMeses(de, -12), ate: somarMeses(ate, -12) };
  var curto = function (x) {
    if (x.de === primeiroDoMes(x.de) && x.ate === ultimoDoMes(x.ate)) return x.de === primeiroDoMes(x.ate) ? L.fMesK(L.mesDeDia(x.de)) : L.fMesK(L.mesDeDia(x.de)) + "–" + L.fMesK(L.mesDeDia(x.ate));
    var a = L.isoDeDia(x.de), b = L.isoDeDia(x.ate), mesmoAno = a.slice(0, 4) === b.slice(0, 4);
    var fd = function (s, ano) { return s.slice(8, 10) + "/" + s.slice(5, 7) + (ano ? "/" + s.slice(2, 4) : ""); };
    return x.de === x.ate ? fd(a, true) : fd(a, !mesmoAno) + "–" + fd(b, true);
  };
  var rotDe = function (x) {
    if (x.de === primeiroDoMes(x.de) && x.ate === ultimoDoMes(x.ate)) return x.de === primeiroDoMes(x.ate) ? L.fMesKLongo(L.mesDeDia(x.de)) : L.fMesK(L.mesDeDia(x.de)) + " a " + L.fMesK(L.mesDeDia(x.ate));
    return x.de === x.ate ? L.fDia(x.de) : L.fDia(x.de) + " a " + L.fDia(x.ate);
  };
  if (pa) { pa.rot = rotDe(pa); pa.curto = curto(pa); } aa.rot = rotDe(aa); aa.curto = curto(aa);
  var ini = L.diaMin || 0;
  return { pa: pa && pa.ate >= ini ? pa : null, aa: aa.ate >= ini ? aa : null };
};

/* ------------------------------ filtros → linhas ------------------------------ */
/* spec = { de, ate, f: { chave: [ids] }, sem: [chaves ignoradas] }. Devolve os índices que passam. */
var cacheFiltro = new Map();
function busca(arr, v, n, sup) { var a = 0, b = n; while (a < b) { var m = (a + b) >> 1; if (sup ? arr[m] <= v : arr[m] < v) a = m + 1; else b = m; } return a; }
L.filtrar = function (spec) {
  var chave = JSON.stringify(spec);
  if (cacheFiltro.has(chave)) return cacheFiltro.get(chave);
  var R = L.R, f = spec.f || {}, sem = spec.sem || [];
  var i0 = spec.de == null ? 0 : busca(R.d, spec.de, R.n, false), i1 = spec.ate == null ? R.n : busca(R.d, spec.ate, R.n, true);
  var testes = [];
  function usa(k) { return f[k] && f[k].length && sem.indexOf(k) < 0; }
  if (usa("uf")) { var su = new Set(f.uf); testes.push(function (i) { return su.has(R.u[i]); }); }
  if (usa("sup")) { var ss = new Set(f.sup); testes.push(function (i) { return ss.has(R.s[i]); }); }
  if (usa("fil")) { var sf = new Set(f.fil); testes.push(function (i) { return sf.has(R.f[i]); }); }
  if (usa("rca")) { var sc = new Set(f.rca); testes.push(function (i) { return sc.has(R.c[i]); }); }
  if (usa("regiao")) { var sr = new Set(f.regiao); testes.push(function (i) { return sr.has(L.regiaoDeK(L.grupoDeSup(R.s[i])).id); }); }
  var out = new Int32Array(Math.max(0, i1 - i0)), n = 0;
  for (var i = i0; i < i1; i++) {
    var ok = true;
    for (var t = 0; t < testes.length && ok; t++) ok = testes[t](i);
    if (ok) out[n++] = i;
  }
  var res = out.subarray(0, n);
  if (cacheFiltro.size > 200) cacheFiltro.clear();
  cacheFiltro.set(chave, res);
  return res;
};
L.spec = function (extra, periodo) {
  var p = periodo || L.periodo();
  var s = { de: p.de, ate: p.ate, f: Object.assign({}, L.estado.filtros) };
  if (extra) { if (extra.f) Object.assign(s.f, extra.f); if (extra.sem) s.sem = extra.sem; if (extra.de != null) s.de = extra.de; if (extra.ate != null) s.ate = extra.ate; }
  return s;
};

/* somas: venda, pedidos, lucro (só das linhas com lucro, igual ao Power BI) */
L.somar = function (idx, teste) {
  var R = L.R, v = 0, q = 0, l = 0, vl = 0;
  for (var k = 0; k < idx.length; k++) {
    var i = idx[k];
    if (teste && !teste(i)) continue;
    v += R.v[i]; q += R.q[i];
    if (R.l[i] === R.l[i]) l += R.l[i];
  }
  return { v: v, q: q, l: l, ticket: q ? v / q : null, pctLucro: v ? l / v : null };
};
L.agrupar = function (idx, chaveDe) {
  var R = L.R, m = new Map();
  for (var k = 0; k < idx.length; k++) {
    var i = idx[k], ch = chaveDe(i), g = m.get(ch);
    if (!g) { g = { k: ch, v: 0, q: 0, l: 0 }; m.set(ch, g); }
    g.v += R.v[i]; g.q += R.q[i]; if (R.l[i] === R.l[i]) g.l += R.l[i];
  }
  return Array.from(m.values()).map(function (g) { g.ticket = g.q ? g.v / g.q : null; g.pctLucro = g.v ? g.l / g.v : null; return g; });
};
L.regiaoDaLinha = function (i) { return L.grupoDeSup(L.R.s[i]); };

/* texto dos filtros (planilha e detalhe) */
L.descricaoFiltros = function (extra, semPeriodo) {
  var partes = [];
  if (!semPeriodo) partes.push("Período: " + L.periodo().rot);
  var f = Object.assign({}, L.estado.filtros, extra || {});
  Object.keys(f).forEach(function (k) {
    if (!L.DIM[k] || !f[k] || !f[k].length) return;
    partes.push(L.DIM[k].rot + ": " + f[k].map(function (id) { return L.nomeDe(k, id); }).join("; "));
  });
  return partes.join(" · ") || "Sem filtros";
};

})();
