/**
 * /api/pacote?nome=base|recente|hoje&v=<versão> — um dos três pacotes prontos, comprimido.
 *
 * Quem monta é o AGENTE LUBE: depois de gravar pedidos, ele roda relatorio146.atualizar_painel(),
 * que refaz só o pacote cujo intervalo de datas mudou. O banco guarda texto (o Postgres não tem
 * gzip; o TOAST comprime no disco): a compressão é aqui (~2 MB da base viram ~300 KB).
 * Bytes crus (application/octet-stream + X-Pacote: gzip), como o Inventário: o que trafega é
 * sempre o comprimido. Venda por RCA é dado da empresa: cache só no navegador de quem entrou.
 */
"use strict";
const zlib = require("zlib");
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const nome = q.get("nome"), v = q.get("v");
    if (!/^(base|recente|hoje)$/.test(nome || "")) return json(res, 400, { erro: "nome", mensagem: "Pacote desconhecido." });
    const l = (await consultar("SELECT versao, payload FROM relatorio146.pacote WHERE nome = $1", [nome])).rows[0];
    if (!l) return json(res, 404, { erro: "sem_pacote", mensagem: "O pacote '" + nome + "' ainda não foi montado." });
    const corpo = zlib.gzipSync(Buffer.from(l.payload, "utf8"), { level: 6 });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Pacote", "gzip");
    res.setHeader("X-Versao", l.versao);
    res.setHeader("Content-Length", corpo.length);
    // a URL leva a versão: se bater, o navegador pode reaproveitar sem perguntar de novo
    res.setHeader("Cache-Control", v && v === l.versao ? "private, max-age=31536000, immutable" : "private, no-cache");
    res.end(corpo);
  } catch (e) {
    erroBanco(res, e);
  }
};
