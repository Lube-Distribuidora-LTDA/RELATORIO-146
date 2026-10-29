/**
 * servidor_local.js — abre o painel no seu computador, antes (ou sem) publicar na Vercel.
 *
 * Serve a pasta web/ e atende /api/* com AS MESMAS funções que a Vercel usa, contra o
 * DATA WAREHOUSE de verdade. A senha do banco vem de um ENV que já existe nesta máquina
 * (o do agente ou o do Inventário): é lida para a memória deste processo e nunca é impressa
 * nem gravada.
 *
 *   cd web
 *   npm install            (uma vez)
 *   node servidor_local.js
 *   abra http://localhost:3106
 *
 * Só escuta a própria máquina (127.0.0.1): aqui não tem o login do Painel Lube.
 * Onde procura o ENV: o caminho passado como argumento, AGENTE_ENV, a pasta do agente e a
 * do Inventário na Área de Trabalho.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const WEB = __dirname;
const PORTA = Number(process.env.PORTA || 3106);
const BI = path.join(WEB, "..", "..");

const candidatos = [process.argv[2], process.env.AGENTE_ENV,
  path.join(BI, "22. AGENTE LUBE", "1 - CONFIGURACAO", "ENV"),
  path.join(BI, "16. INVENTARIO", "etl", "ENV")].filter(Boolean);
const arquivoEnv = candidatos.find((c) => fs.existsSync(c));
if (!arquivoEnv && !process.env.SUPABASE_DB_PASSWORD) {
  console.error("Nao achei o arquivo ENV. Passe o caminho: node servidor_local.js \"C:\\caminho\\ENV\"");
  process.exit(1);
}
if (arquivoEnv) {
  for (const linha of fs.readFileSync(arquivoEnv, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m || linha.trim().startsWith("#")) continue;
    let v = m[2];
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
process.env.SUPABASE_DB_PORT = process.env.SUPABASE_DB_PORT || "5432";

const rotas = {
  "/api/versao": require(path.join(WEB, "api", "versao.js")),
  "/api/pacote": require(path.join(WEB, "api", "pacote.js")),
  "/api/pedidos": require(path.join(WEB, "api", "pedidos.js")),
  "/api/pedido": require(path.join(WEB, "api", "pedido.js")),
  "/api/img": require(path.join(WEB, "api", "img.js")),
  "/api/atualizar": require(path.join(WEB, "api", "atualizar.js")),
};
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2",
};

http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (rotas[u.pathname]) return rotas[u.pathname](req, res);
  const f = path.join(WEB, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  // só serve o que está dentro de web/, nunca o código do servidor, as funções, o SQL nem o node_modules
  const ok = f.startsWith(WEB + path.sep) && !f.includes("node_modules") && !f.includes(path.sep + "api" + path.sep) &&
             !f.includes(path.sep + "db" + path.sep) && !/servidor_local\.js$|\.ts$|package(-lock)?\.json$/.test(f) &&
             fs.existsSync(f) && fs.statSync(f).isFile();
  if (!ok) { res.statusCode = 404; return res.end("nao encontrado"); }
  res.setHeader("Content-Type", TIPOS[path.extname(f)] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.end(fs.readFileSync(f));
}).listen(PORTA, "127.0.0.1", () => console.log("Painel em http://localhost:" + PORTA + "   (Ctrl+C para parar)"));
