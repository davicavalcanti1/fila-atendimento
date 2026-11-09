import { createClient } from "@supabase/supabase-js";
import { criarFetchComBackoff } from "@/lib/backoffServidor";

const _supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const _supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!_supabaseUrl || !_supabaseKey) {
  throw new Error("[Supabase] VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY são obrigatórias.");
}

export const SUPABASE_URL: string = _supabaseUrl;

export const supabase = createClient(_supabaseUrl, _supabaseKey, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
  // Toda resposta do PostgREST passa pelo backoff (src/lib/backoffServidor.ts):
  // 5xx/rede/timeout põem a aba em espera e as leituras automáticas param.
  global: { fetch: criarFetchComBackoff() },
  // Sem a repetição embutida do supabase-js (GET em 503/520/rede: +3 tentativas
  // em 1, 2 e 4 s). Com o banco caindo ela quadruplicava cada leitura; quem
  // decide quando tentar de novo agora é o backoff.
  db: { retry: false },
});
