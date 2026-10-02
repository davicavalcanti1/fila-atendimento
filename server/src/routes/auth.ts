// =============================================================================
// Login por usuário (nome.sobrenome) além do e-mail
// =============================================================================
// A recepção entra no sistema de gestão com `nome.sobrenome` e senha. O Farol
// pedia e-mail, porque o Supabase Auth só conhece e-mail — e as duas coisas não
// batem: dos 54 perfis, só 35 têm o e-mail começando pelo username. Os outros
// 19 entram com gmail, hotmail, icloud ou o domínio interno auth.imago.local.
// Derivar o e-mail colando um domínio no username, portanto, não funciona: é
// preciso consultar.
//
// ── Por que a consulta mora aqui e não no navegador ──────────────────────────
// A tentação é expor uma função pública `email_por_usuario(text)` e resolver no
// cliente. Isso entregaria, para qualquer um que alcance o projeto, o mapa
// username → e-mail de todo o quadro de funcionários — e boa parte desses
// e-mails é PESSOAL. Username é `nome.sobrenome`, ou seja, adivinhável. Seria
// uma lista de e-mails pessoais de graça, num sistema de saúde.
//
// Aqui o e-mail nunca sai: quem entra manda usuário e senha, e o que volta é a
// sessão — ou um 401 que não diz QUAL dos dois estava errado. Usuário
// inexistente e senha errada respondem exatamente a mesma coisa, de propósito.
// =============================================================================

import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase.js";

const router = Router();

const corpoLogin = z.object({
  usuario: z.string().min(1).max(200),
  senha:   z.string().min(1).max(200),
});

/**
 * Cliente com a chave PUBLICÁVEL, não a de serviço.
 *
 * É deliberado: a chave de serviço emitiria sessão para qualquer um sem
 * conferir senha nenhuma, e um bug nesta rota viraria porta aberta. Com a
 * publicável, o Supabase valida a senha como validaria vindo do navegador —
 * este endpoint só troca o identificador, nunca a verificação.
 */
const chavePublicavel = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const supabasePublico = chavePublicavel
  ? createClient(process.env.SUPABASE_URL!, chavePublicavel, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// ── Freio de tentativa ──────────────────────────────────────────────────────
// Em memória e por processo: não é proteção contra ataque distribuído, e não se
// pretende isso. O que ela impede é o caso barato — varrer usernames de um IP só
// para descobrir quais existem, medindo tempo de resposta. Quem precisar de
// proteção séria coloca isso no Redis que o módulo já tem.
const JANELA_MS = 5 * 60_000;
const MAX_TENTATIVAS = 12;
const tentativas = new Map<string, { n: number; desde: number }>();

function excedeu(chave: string): boolean {
  const agora = Date.now();
  const atual = tentativas.get(chave);
  if (!atual || agora - atual.desde > JANELA_MS) {
    tentativas.set(chave, { n: 1, desde: agora });
    return false;
  }
  atual.n += 1;
  return atual.n > MAX_TENTATIVAS;
}

// Mapa que nunca esvazia é vazamento. Uma limpeza preguiçosa a cada janela
// basta: são dezenas de chaves, não milhões.
setInterval(() => {
  const limite = Date.now() - JANELA_MS;
  for (const [k, v] of tentativas) if (v.desde < limite) tentativas.delete(k);
}, JANELA_MS).unref?.();

/** Resolve o identificador digitado em e-mail. `null` = não existe. */
async function emailDoIdentificador(identificador: string): Promise<string | null> {
  const limpo = identificador.trim();
  // Já é e-mail: não há o que resolver, e não se consulta o banco à toa.
  if (limpo.includes("@")) return limpo.toLowerCase();

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .ilike("username", limpo)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as { email?: string } | null)?.email ?? null;
}

router.post("/login", async (req, res) => {
  if (!supabasePublico) {
    // Degrada em vez de mentir: sem a chave publicável esta rota não tem como
    // validar senha, e o cliente sabe cair para o login por e-mail direto.
    return res.status(503).json({
      erro: "indisponivel",
      mensagem: "Login por usuário indisponível — falta SUPABASE_PUBLISHABLE_KEY no servidor.",
    });
  }

  const corpo = corpoLogin.safeParse(req.body);
  if (!corpo.success) {
    return res.status(400).json({ erro: "invalido", mensagem: "Informe usuário e senha." });
  }

  const ip = req.ip ?? "desconhecido";
  if (excedeu(`${ip}`) || excedeu(`u:${corpo.data.usuario.toLowerCase()}`)) {
    return res.status(429).json({
      erro: "muitas_tentativas",
      mensagem: "Tentativas demais. Espere alguns minutos e tente de novo.",
    });
  }

  // A MESMA resposta para usuário inexistente e para senha errada. Distinguir os
  // dois transforma a tela de login num confirmador de quem trabalha aqui.
  const recusar = () =>
    res.status(401).json({ erro: "credenciais", mensagem: "Usuário ou senha inválidos." });

  try {
    const email = await emailDoIdentificador(corpo.data.usuario);
    if (!email) return recusar();

    const { data, error } = await supabasePublico.auth.signInWithPassword({
      email,
      password: corpo.data.senha,
    });
    if (error || !data.session) return recusar();

    // Só os tokens. O objeto `user` do Supabase carrega o e-mail e os metadados
    // dele, e o cliente não precisa de nada disso para montar a sessão — quem
    // preenche o perfil depois é o AuthContext, já autenticado.
    return res.json({
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (e) {
    // Sem `e` no corpo da resposta: a mensagem do Postgres pode citar coluna,
    // tabela e política. Log do lado de cá, genérico do lado de lá.
    console.error("[auth/login] falha ao resolver identificador:", e);
    return res.status(500).json({ erro: "interno", mensagem: "Não foi possível entrar agora." });
  }
});

export default router;
