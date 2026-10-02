// Auth por Bearer do Supabase — o frontend manda o access_token da sessão.
// O sistema de origem também aceitava sessão Express ("FromAny"); aqui não há
// sessão, então requireAuthFromAny valida só o Bearer. O nome foi mantido para
// as rotas copiadas não precisarem mudar.
//
// ── O QUE MUDOU EM 20/AGO ────────────────────────────────────────────────────
// Antes o middleware só respondia "é alguém logado?" e seguia. Isso bastava
// enquanto todas as rotas eram leitura de fila. Deixou de bastar quando entrou
// `/api/integracao`, que grava o token do NetRis: ali é preciso saber QUEM é —
// de que tenant, com que papel — porque a credencial é por tenant e trocá-la
// não é ato de quem opera a fila.
//
// Então o middleware passou a anexar `req.usuario`. As rotas antigas continuam
// funcionando iguais; ganharam o tenant de graça.

import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase.js";

export interface UsuarioDaRequisicao {
  id: string;
  email: string | null;
  /** Nulo quando o perfil não tem tenant. Rota que grava por tenant recusa. */
  tenantId: string | null;
  /** De `user_roles.role`. Nulo quando o usuário não tem papel atribuído. */
  papel: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioDaRequisicao;
    }
  }
}

/**
 * Papéis que podem mexer em configuração de integração.
 *
 * Deliberadamente curto: trocar o token do NetRis derruba o Farol para a
 * recepção inteira se errar. `supervisor` está fora — ele opera a fila, não a
 * credencial.
 */
export const PAPEIS_CONFIGURACAO = ["admin", "developer"];

async function carregarUsuario(token: string): Promise<UsuarioDaRequisicao | null> {
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  // As duas consultas em paralelo, e nenhuma delas é fatal: um perfil sem linha
  // em `user_roles` continua autenticado — só não passa no gate de papel. Ficar
  // 401 aqui transformaria "sem permissão para configurar" em "não conseguiu
  // entrar no Farol", que é bem pior e mais difícil de diagnosticar.
  const [{ data: perfil }, { data: papel }] = await Promise.all([
    supabaseAdmin.from("profiles").select("tenant_id").eq("id", user.id).maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
  ]);

  return {
    id: user.id,
    email: user.email ?? null,
    tenantId: (perfil as { tenant_id?: string | null } | null)?.tenant_id ?? null,
    papel: (papel as { role?: string } | null)?.role ?? null,
  };
}

export async function requireAuthFromAny(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const usuario = await carregarUsuario(authHeader.slice(7));
    if (usuario) {
      req.usuario = usuario;
      return next();
    }
  }
  return res.status(401).json({ error: "Não autorizado." });
}

export const requireSupabaseAuth = requireAuthFromAny;

/**
 * Gate de papel. Use DEPOIS de `requireAuthFromAny`.
 *
 * Devolve 403 e não 404: quem chegou aqui está autenticado, e esconder a
 * existência da rota de um usuário legítimo do próprio tenant só rende ticket de
 * suporte. A mensagem diz o papel que falta, porque a pessoa vai perguntar.
 */
export function exigirPapel(...papeis: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const usuario = req.usuario;
    if (!usuario) {
      // Middleware fora de ordem. Falhar fechado é o único caminho seguro: um
      // gate que passa quando não sabe quem é não é um gate.
      return res.status(500).json({ error: "Gate de papel usado antes da autenticação." });
    }
    if (!usuario.papel || !papeis.includes(usuario.papel)) {
      return res.status(403).json({
        error: `Esta ação exige o papel ${papeis.join(" ou ")}.`,
      });
    }
    return next();
  };
}

/**
 * O tenant da requisição, ou 400.
 *
 * Existe porque perfil sem `tenant_id` é estado real (o owner global do
 * controleoperacional não tem), e uma rota que grava por tenant não pode
 * inventar um. Dizer "sua conta não está vinculada a um tenant" é acionável;
 * um 500 do Postgres por `null` em coluna NOT NULL não é.
 */
export function exigirTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.usuario?.tenantId) {
    return res.status(400).json({
      error: "Sua conta não está vinculada a um tenant — peça a um administrador.",
    });
  }
  return next();
}
