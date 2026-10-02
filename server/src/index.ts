// Primeiro import de propósito: valida o ambiente e derruba o processo com
// mensagem legível se faltar o essencial, antes que qualquer outro módulo carregue
// e leia uma env undefined.
import { config, emProducao } from "./config.js";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRoutes from "./routes/auth.js";
import { rotaSaude } from "./routes/saude.js";

const app = express();

// Confia em UM proxy à frente (EasyPanel/nginx): `req.ip` passa a ser o
// cliente real, e não o proxy, sem aceitar X-Forwarded-For forjado inteiro.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

// ── Por que a API tem dois prefixos ─────────────────────────────────────────
// Este app roda em dois lugares ao mesmo tempo:
//
//   1. no host próprio, onde ele é a raiz do domínio
//   2. sob gestao.imagoradiologia.cloud/fila-atendimento/, servido por proxy do
//      nginx do controleoperacional — quem já está logado no sistema entra aqui
//      sem novo login (mesma origem = mesma sessão Supabase). Ver ADR 0003.
//
// No caso 2 o `/api/` do domínio JÁ É do Express do controleoperacional. Daí o
// prefixo próprio, que é o que o frontend usa (src/lib/apiBase.ts). O `/api`
// continua montado porque no host próprio não colide com ninguém.
const API = "/fila-atendimento-api";

app.use(`${API}/health`, rotaSaude);
app.use("/api/health", rotaSaude);
app.use("/health", rotaSaude);

app.use(`${API}/auth`, authRoutes);
app.use("/api/auth", authRoutes);

// 404 de API em JSON, e não na página de erro HTML do Express. Precisa vir
// depois das rotas e antes do fallback de SPA.
for (const prefixo of [API, "/api"]) {
  app.use(prefixo, (req, res) => {
    res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.baseUrl}${req.path}` });
  });
}

// Em produção (container único) o Express também serve o build do Vite.
// Em dev quem serve o front é o Vite (:5173) com proxy pra cá.
if (emProducao) {
  const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

  // Assets primeiro, com cache longo: o nome tem hash, então são imutáveis por
  // construção. Sem isto o navegador revalida cada arquivo em cada abertura.
  // O index.html fica de fora, senão deploy novo não chega a quem já abriu.
  const assetsDir = path.join(distDir, "assets");
  const cacheImutavel = { maxAge: "1y", immutable: true } as const;
  app.use("/fila-atendimento-app/assets", express.static(assetsDir, cacheImutavel));
  app.use("/assets", express.static(assetsDir, cacheImutavel));

  // `/fila-atendimento-app` é onde o sistema encontra este módulo (ver ADR 0003).
  // A raiz continua servindo o host próprio. `redirect: false`: sem isso o
  // express.static responde o caminho sem barra com 301 — um lugar a mais onde o
  // Location pode sair errado atravessando o proxy.
  app.use("/fila-atendimento-app", express.static(distDir, { redirect: false }));
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

// Erro em JSON, sem stack trace no corpo. Quatro parâmetros: é a assinatura
// pela qual o Express reconhece um handler de erro.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err?.status === "number" ? err.status : 500;
  if (status === 413) return res.status(413).json({ error: "Envio grande demais." });
  console.error(`[erro] ${req.method} ${req.originalUrl}:`, err?.message);
  res.status(status).json({ error: status >= 500 ? "Erro interno." : (err?.message ?? "Requisição inválida.") });
});

app.listen(config.PORT, () => {
  console.log(`[fila-atendimento-api] http://localhost:${config.PORT} (${config.NODE_ENV})`);
});
