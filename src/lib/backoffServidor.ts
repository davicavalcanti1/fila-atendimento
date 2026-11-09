// Backoff quando o banco (Supabase/PostgREST) responde 5xx, cai a rede ou dá timeout.
//
// Por que existe (nov/2026, item 4 do plano da queda de 30/out): com o banco
// lento, todas as telas (TVs, recepção, assistentes) continuavam tentando no
// mesmo ritmo — recarga de 30 s + avisos do Realtime — e cada tentativa que
// falhava ainda era repetida pelo próprio supabase-js (1 s, 2 s, 4 s). Quem
// estava caindo recebia mais carga justamente quando menos aguentava.
//
// Como funciona:
// - DETECÇÃO num lugar só: o `fetch` do cliente Supabase passa por
//   `criarFetchComBackoff`, que olha toda resposta do PostgREST (`/rest/v1/`).
//   5xx, 408, 429, erro de rede ou timeout → `falhou()`; 2xx/3xx → `sucesso()`;
//   outros 4xx (401 de sessão, 403 da RLS, 400) NÃO mexem no backoff.
// - REAÇÃO em quem lê sozinho (intervalos e avisos do Realtime): enquanto
//   `emBackoff()`, não lê — o aviso só marca "sujo" e a próxima tentativa
//   relê tudo. Ação do usuário (salvar, dar baixa) continua indo direto.
// - A espera dobra a cada falha seguida, com sorteio, e um sucesso zera.
//
// Sem imports de propósito: roda direto no `node --test` (tests/backoffServidor.test.ts).

/** Primeira espera (teto); a sorteada fica entre a metade e o teto: 30–60 s. */
export const BACKOFF_BASE_MS = 60_000;
/** Espera máxima: 5 min (sorteada entre 2,5 e 5 min). */
export const BACKOFF_MAX_MS = 5 * 60_000;

/**
 * Espera depois da n-ésima falha seguida.
 *
 * Teto = min(máx, base × 2^(n−1)) → 60 s, 2 min, 4 min, 5 min, 5 min…
 * Sorteio "equal jitter": metade do teto fixa + metade aleatória. A metade fixa
 * garante que ninguém volta antes de 30 s (nunca mais rápido que a recarga
 * normal); a aleatória espalha as telas que caíram juntas para não voltarem
 * todas no mesmo segundo.
 */
export function atrasoBackoff(
  falhas: number,
  aleatorio: () => number = Math.random,
  baseMs: number = BACKOFF_BASE_MS,
  maxMs: number = BACKOFF_MAX_MS,
): number {
  if (falhas <= 0) return 0;
  const teto = Math.min(maxMs, baseMs * 2 ** Math.min(falhas - 1, 30));
  return Math.round(teto / 2 + aleatorio() * (teto / 2));
}

/** Status HTTP que significa "servidor com problema". 0 = rede (supabase-js). */
export function statusDeServidor(status: number | null | undefined): boolean {
  if (typeof status !== "number") return false;
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/**
 * Aceita a resposta do supabase-js (`{ error, status }`), um `Response` do fetch
 * ou um erro lançado pelo fetch. Erro de rede do fetch é `TypeError`; timeout de
 * `AbortSignal.timeout` é `TimeoutError`. `AbortError` (cancelamento manual) não conta.
 */
export function ehErroDeServidor(x: unknown): boolean {
  if (x == null || typeof x !== "object") return false;
  const o = x as { status?: unknown; error?: unknown; name?: unknown };
  if (typeof o.status === "number") {
    if ("error" in o && !o.error) return false; // resposta do supabase-js sem erro
    return statusDeServidor(o.status);
  }
  return o.name === "TypeError" || o.name === "TimeoutError";
}

/** Lançado por `conferirLeitura`/`pularSeEmBackoff`; o react-query não repete este erro. */
export class ErroServidor extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.name = "ErroServidor";
    this.status = status;
  }
}

export interface OpcoesBackoff {
  baseMs?: number;
  maxMs?: number;
  agora?: () => number;
  aleatorio?: () => number;
}

export function criarBackoff(op: OpcoesBackoff = {}) {
  const baseMs    = op.baseMs ?? BACKOFF_BASE_MS;
  const maxMs     = op.maxMs ?? BACKOFF_MAX_MS;
  const agora     = op.agora ?? (() => Date.now());
  const aleatorio = op.aleatorio ?? Math.random;
  let falhas = 0;
  let ate = 0;

  return {
    get falhas() { return falhas; },
    emBackoff: () => agora() < ate,
    esperaRestanteMs: () => Math.max(0, ate - agora()),
    /**
     * Registra uma falha e devolve quanto falta para a próxima tentativa.
     * Falha que chega DURANTE a espera (pedido que já estava no ar, ou várias
     * consultas da mesma tela caindo juntas) não dobra de novo: só conta a
     * falha de quem tentou depois que a espera acabou.
     */
    falhou(): number {
      const t = agora();
      if (t < ate) return ate - t;
      falhas++;
      ate = t + atrasoBackoff(falhas, aleatorio, baseMs, maxMs);
      return ate - t;
    },
    sucesso() { falhas = 0; ate = 0; },
  };
}

export type Backoff = ReturnType<typeof criarBackoff>;

/** Um por aba: se o banco caiu, caiu para todas as leituras da tela. */
export const backoffBanco: Backoff = criarBackoff();

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** `fetch` do cliente Supabase: observa as respostas do PostgREST e alimenta o backoff. */
export function criarFetchComBackoff(b: Backoff = backoffBanco, fetchBase?: Fetch): Fetch {
  const f: Fetch = fetchBase ?? ((i, n) => globalThis.fetch(i, n));
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/rest/v1/")) return f(input, init);
    let res: Response;
    try {
      res = await f(input, init);
    } catch (e) {
      if (ehErroDeServidor(e)) b.falhou();
      throw e;
    }
    if (statusDeServidor(res.status)) b.falhou();
    else if (res.status < 400) b.sucesso();
    return res;
  };
}

/**
 * Para queryFn do react-query: erro de servidor vira exceção (o react-query
 * mantém o último dado na tela em vez de trocar por lista vazia). Qualquer
 * outra resposta volta como veio — 4xx segue o tratamento que já existia.
 */
export function conferirLeitura<T>(res: T): T {
  if (ehErroDeServidor(res)) {
    const r = res as { status?: number; error?: { message?: string } | null };
    throw new ErroServidor(r.status ?? 0, r.error?.message ?? "servidor indisponível");
  }
  return res;
}

/** Para queryFn: em backoff não vai ao banco (mantém o último dado). */
export function pularSeEmBackoff(b: Backoff = backoffBanco): void {
  if (b.emBackoff()) throw new ErroServidor(0, "aguardando o servidor voltar (backoff)");
}

/** `refetchInterval` do react-query: em backoff, espera o que falta (nunca menos que o normal). */
export function intervaloComBackoff(normalMs: number, b: Backoff = backoffBanco) {
  return () => (b.emBackoff() ? Math.max(normalMs, b.esperaRestanteMs()) : normalMs);
}

/** `retry` padrão do react-query (3 tentativas), menos para erro de servidor: o backoff cuida. */
export function repetirSeNaoForServidor(falhas: number, erro: unknown): boolean {
  return !(erro instanceof ErroServidor) && falhas < 3;
}
