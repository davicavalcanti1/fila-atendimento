import { Router } from "express";
import { readFileSync } from "node:fs";
import { supabaseAdmin } from "../lib/supabase.js";
import { config } from "../config.js";

/**
 * Health check que diz a verdade.
 *
 * Antes este endpoint devolvia `{ ok: true }` fixo — respondia 200 mesmo com o
 * banco inacessível. Endpoint assim é pior que não ter: transforma qualquer painel
 * que o consome em enfeite, e dá a impressão de que há monitoramento onde não há.
 *
 * Agora ele **degrada**: se o Postgres não responde, devolve 503 e diz qual
 * dependência caiu. É o mesmo contrato do molde de módulo e do que o Hub da
 * plataforma consome, para não haver um health para o Docker e outro para o painel.
 *
 * Sem autenticação, de propósito: quem monitora não tem sessão. Por isso não expõe
 * nada sensível — nem contagem de registros, nem nome de tenant, nem detalhe do
 * erro do banco.
 */

const iniciadoEm = Date.now();

/** A versão mora no package.json da raiz do módulo; o caminho muda entre dev
 *  (src/) e produção (dist/), então tenta os candidatos em vez de fixar um. */
const versao = (() => {
  for (const rel of ["../../package.json", "../../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
      if (typeof pkg.version === "string" && pkg.name !== "@farol/server") return pkg.version;
    } catch {
      /* tenta o próximo */
    }
  }
  return "desconhecida";
})();

export const rotaSaude: Router = Router();

rotaSaude.get("/", async (_req, res) => {
  const inicio = Date.now();
  let banco: "ok" | "falha" = "falha";

  try {
    // `*` com head: true não retorna linha nenhuma e não depende do nome de
    // nenhuma coluna. Fixar uma coluna aqui é frágil: a primeira versão pedia
    // `id`, que esta tabela não tem — a chave é atendimento_id —, e o health
    // reportava banco em falha quando o banco estava perfeito.
    const { error } = await supabaseAdmin
      .from("fila_atendimento")
      .select("*", { head: true, count: "exact" })
      .limit(1);
    banco = error ? "falha" : "ok";
  } catch {
    banco = "falha";
  }

  const saudavel = banco === "ok";

  res.status(saudavel ? 200 : 503).json({
    // `ok` fica por compatibilidade: se algo já consumia este endpoint esperando
    // o formato antigo, continua funcionando.
    ok: saudavel,
    status: saudavel ? "saudavel" : "degradado",
    versao,
    ambiente: config.NODE_ENV,
    uptimeSegundos: Math.floor((Date.now() - iniciadoEm) / 1000),
    verificadoEm: new Date().toISOString(),
    latenciaMs: Date.now() - inicio,
    dependencias: { banco },
  });
});
