// Testes de src/lib/carregarUsuarioUmaVez.ts — rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarCarregadorDeUsuario } from "../src/lib/carregarUsuarioUmaVez.ts";

function contador() {
  const chamadas: string[] = [];
  const ler = async (id: string) => { chamadas.push(id); };
  return { chamadas, ler };
}

test("mesma pessoa em vários eventos lê uma vez só", async () => {
  const { chamadas, ler } = contador();
  const c = criarCarregadorDeUsuario(ler);
  await c.carregar("a");
  await c.carregar("a"); // TOKEN_REFRESHED
  await c.carregar("a"); // SIGNED_IN ao voltar o foco
  assert.deepEqual(chamadas, ["a"]);
});

test("chamadas em paralelo esperam a mesma leitura (ninguém libera a tela antes)", async () => {
  let soltar!: () => void;
  const portao = new Promise<void>((r) => { soltar = r; });
  let lidas = 0;
  let terminou = false;
  const c = criarCarregadorDeUsuario(async () => { lidas++; await portao; terminou = true; });
  const p1 = c.carregar("a"); // evento INITIAL_SESSION
  const p2 = c.carregar("a"); // getSession da carga
  assert.equal(p1, p2);
  soltar();
  await p2;
  assert.equal(terminou, true, "p2 só resolve depois da leitura de verdade");
  assert.equal(lidas, 1);
});

test("pessoa diferente lê de novo", async () => {
  const { chamadas, ler } = contador();
  const c = criarCarregadorDeUsuario(ler);
  await c.carregar("a");
  await c.carregar("b");
  assert.deepEqual(chamadas, ["a", "b"]);
});

test("depois de esquecer (saída), a mesma pessoa lê de novo", async () => {
  const { chamadas, ler } = contador();
  const c = criarCarregadorDeUsuario(ler);
  await c.carregar("a");
  c.esquecer();
  await c.carregar("a");
  assert.deepEqual(chamadas, ["a", "a"]);
});

test("leitura que falhou não fica guardada", async () => {
  let n = 0;
  const c = criarCarregadorDeUsuario(async () => { n++; if (n === 1) throw new Error("rede"); });
  await assert.rejects(c.carregar("a"));
  await c.carregar("a");
  assert.equal(n, 2);
});
