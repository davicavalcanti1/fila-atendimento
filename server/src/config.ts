import { z } from "zod";

/**
 * Validação do ambiente na subida do processo.
 *
 * Env ausente não dá erro na subida: vira `undefined`, o processo sobe, e a
 * falha aparece na primeira requisição que dependia dela — semanas depois, como
 * um 500 sem explicação. Aqui ela derruba o processo com mensagem legível.
 *
 * Só o Supabase é fatal: sem ele este serviço não faz nada. A chave publicável
 * degrada só o login por `nome.sobrenome` (cai para e-mail), então vira aviso.
 */

const esquema = z.object({
  SUPABASE_URL: z.string().url({
    message: "precisa ser a URL do projeto Supabase (https://xxx.supabase.co)",
  }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, { message: "ausente ou truncada" }),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = esquema.safeParse(process.env);

if (!parsed.success) {
  const problemas = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");

  console.error(
    `\n✕ [fila-atendimento-api] ambiente inválido — o processo não vai subir:\n\n${problemas}\n\n` +
      `Confira o .env (ou as variáveis do EasyPanel). Referência: .env.example\n`,
  );
  process.exit(1);
}

export const config = parsed.data;
export const emProducao = config.NODE_ENV === "production";

if (!process.env.SUPABASE_PUBLISHABLE_KEY && !process.env.SUPABASE_ANON_KEY) {
  console.warn(
    `\n⚠ [fila-atendimento-api] SUPABASE_PUBLISHABLE_KEY ausente. O serviço sobe, mas\n` +
      `  o login por usuário (nome.sobrenome) fica indisponível — só e-mail entra.\n`,
  );
}
