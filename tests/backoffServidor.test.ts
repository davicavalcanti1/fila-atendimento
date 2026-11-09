// Testes do backoff de erro de servidor (src/lib/backoffServidor.ts).
// Rodar: npm test  (node --test, sem dependência nova; o Node 22.18+ lê .ts direto)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atrasoBackoff, criarBackoff, criarFetchComBackoff, conferirLeitura, ehErroDeServidor,
  ErroServidor, intervaloComBackoff, pularSeEmBackoff, repetirSeNaoForServidor, statusDeServidor,
} from "../src/lib/backoffServidor.ts";

const relogio = (inicio = 1_000_000) => {
  let t = inicio;
  return { agora: () => t, andar: (ms: number) => { t += ms; } };
};

test("espera dobra a cada falha e para em 5 min (teto, sorteio no máximo)", () => {
  const max = () => 0.999999;
  assert.deepEqual(
    [1, 2, 3, 4, 5, 10, 100].map(n => atrasoBackoff(n, max)),
    [60_000, 120_000, 240_000, 300_000, 300_000, 300_000, 300_000],
  );
});

test("sorteio fica entre a metade do teto e o teto (nunca antes de 30 s)", () => {
  assert.equal(atrasoBackoff(1, () => 0), 30_000);
  assert.equal(atrasoBackoff(4, () => 0), 150_000);
  for (let i = 0; i < 500; i++) {
    const a = atrasoBackoff(2);
    assert.ok(a >= 60_000 && a <= 120_000, `fora da faixa: ${a}`);
  }
  assert.equal(atrasoBackoff(0), 0);
});

test("telas que falharam juntas não voltam juntas (jitter espalha)", () => {
  const voltas = new Set(Array.from({ length: 20 }, () => Math.round(atrasoBackoff(1) / 1000)));
  assert.ok(voltas.size > 5, `só ${voltas.size} segundos distintos para 20 telas`);
});

test("falha entra em backoff, espera passa, sucesso zera", () => {
  const r = relogio();
  const b = criarBackoff({ agora: r.agora, aleatorio: () => 0 });
  assert.equal(b.emBackoff(), false);
  assert.equal(b.falhou(), 30_000);
  assert.equal(b.emBackoff(), true);
  r.andar(29_999);
  assert.equal(b.esperaRestanteMs(), 1);
  r.andar(1);
  assert.equal(b.emBackoff(), false);
  assert.equal(b.falhou(), 60_000); // 2ª falha seguida dobra
  assert.equal(b.falhas, 2);
  b.sucesso();
  assert.equal(b.emBackoff(), false);
  assert.equal(b.falhas, 0);
  assert.equal(b.falhou(), 30_000); // depois do sucesso recomeça do início
});

test("várias falhas durante a mesma espera contam uma vez só", () => {
  const r = relogio();
  const b = criarBackoff({ agora: r.agora, aleatorio: () => 0 });
  b.falhou();
  r.andar(1_000);
  assert.equal(b.falhou(), 29_000); // devolve o que falta, não dobra
  b.falhou();
  assert.equal(b.falhas, 1);
});

test("classificação: 5xx/408/429/rede/timeout entram; 4xx e sucesso não", () => {
  for (const s of [0, 408, 429, 500, 502, 503, 504, 520]) assert.equal(statusDeServidor(s), true, `status ${s}`);
  for (const s of [200, 201, 204, 304, 400, 401, 403, 404, 406, 409]) assert.equal(statusDeServidor(s), false, `status ${s}`);
  assert.equal(statusDeServidor(undefined), false);

  // resposta do supabase-js
  assert.equal(ehErroDeServidor({ data: null, error: { message: "x" }, status: 503 }), true);
  assert.equal(ehErroDeServidor({ data: null, error: { message: "TypeError: Failed to fetch" }, status: 0 }), true);
  assert.equal(ehErroDeServidor({ data: null, error: { message: "JWT expired" }, status: 401 }), false);
  assert.equal(ehErroDeServidor({ data: [], error: null, status: 200 }), false);
  // erro lançado pelo fetch
  assert.equal(ehErroDeServidor(new TypeError("Failed to fetch")), true);
  assert.equal(ehErroDeServidor(Object.assign(new Error("t"), { name: "TimeoutError" })), true);
  assert.equal(ehErroDeServidor(Object.assign(new Error("a"), { name: "AbortError" })), false);
  assert.equal(ehErroDeServidor(null), false);
});

test("fetch do Supabase: 5xx/rede alimentam o backoff, 2xx zera, 4xx não mexe", async () => {
  const r = relogio();
  const b = criarBackoff({ agora: r.agora, aleatorio: () => 0 });
  let proxima: () => Promise<Response> = async () => new Response("[]", { status: 200 });
  const f = criarFetchComBackoff(b, () => proxima());
  const rest = "https://x.supabase.co/rest/v1/farol_timestamps?select=*";

  proxima = async () => new Response("", { status: 401 });
  assert.equal((await f(rest)).status, 401);
  assert.equal(b.emBackoff(), false);

  proxima = async () => new Response("", { status: 503 });
  assert.equal((await f(rest)).status, 503); // devolve a resposta como veio
  assert.equal(b.emBackoff(), true);

  r.andar(30_000);
  proxima = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(f(rest), TypeError);
  assert.equal(b.falhas, 2);

  proxima = async () => new Response("[]", { status: 200 });
  await f(rest);
  assert.equal(b.falhas, 0);
  assert.equal(b.emBackoff(), false);

  // fora do PostgREST (auth, functions) não conta
  proxima = async () => new Response("", { status: 500 });
  await f("https://x.supabase.co/auth/v1/token");
  await f(new URL("https://x.supabase.co/functions/v1/poll"));
  assert.equal(b.emBackoff(), false);
});

test("conferirLeitura lança só para erro de servidor; 4xx volta como veio", () => {
  const ok = { data: [1], error: null, status: 200 };
  assert.equal(conferirLeitura(ok), ok);
  const sessao = { data: null, error: { message: "JWT expired" }, status: 401 };
  assert.equal(conferirLeitura(sessao), sessao);
  assert.throws(() => conferirLeitura({ data: null, error: { message: "upstream" }, status: 504 }),
    (e: unknown) => e instanceof ErroServidor && e.status === 504);
});

test("pularSeEmBackoff, intervalo e retry do react-query", () => {
  const r = relogio();
  const b = criarBackoff({ agora: r.agora, aleatorio: () => 1 });
  const intervalo = intervaloComBackoff(30_000, b);
  pularSeEmBackoff(b); // fora do backoff não lança
  assert.equal(intervalo(), 30_000);

  b.falhou(); // 60 s com sorteio no máximo
  assert.throws(() => pularSeEmBackoff(b), ErroServidor);
  assert.equal(intervalo(), 60_000);
  r.andar(45_000);
  assert.equal(intervalo(), 30_000); // faltam 15 s, mas nunca menos que o normal

  assert.equal(repetirSeNaoForServidor(0, new ErroServidor(503, "x")), false);
  assert.equal(repetirSeNaoForServidor(0, new Error("outro")), true);
  assert.equal(repetirSeNaoForServidor(3, new Error("outro")), false);
});
