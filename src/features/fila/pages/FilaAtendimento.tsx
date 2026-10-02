import { useState, useEffect, useCallback } from "react";
import { hojeBRT } from "@/lib/dataBRT";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/contexts/AuthContext";
import { SITUACAO } from "@/services/netris/client";
import { ListOrdered, Users, ChevronRight, RefreshCw, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import FilaAtendimentoAssistente from "./FilaAtendimentoAssistente";

// Situações usadas por cada modalidade (espelha o que cada página do Farol filtra)
const SIT_FAROL = [SITUACAO.ENCAMINHADO_EXAME];
const SIT_RM_TC = [
  SITUACAO.ENCAMINHADO_EXAME,
  SITUACAO.ANAMNESE,
  SITUACAO.PACIENTE_PREPARADO,
  SITUACAO.PREPARADO_ENFERMAGEM,
  SITUACAO.ENCAMINHADO_RM_TC,
];

// Cada fila reflete exatamente o que o Farol mostra da modalidade correspondente.
export const FILA_MODALIDADES = [
  { slug: "ultrassom",     label: "Ultrassonografia",           modalidadeIds: [2],                      situacaoIds: SIT_FAROL },
  { slug: "radiografia",   label: "Radiografia",                modalidadeIds: [1],                      situacaoIds: SIT_FAROL },
  { slug: "tomografia",    label: "Tomografia",                 modalidadeIds: [4],                      situacaoIds: SIT_RM_TC },
  { slug: "mamografia",    label: "Mamografia",                 modalidadeIds: [6],                      situacaoIds: SIT_FAROL },
  { slug: "densitometria", label: "Densitometria",              modalidadeIds: [7],                      situacaoIds: SIT_FAROL },
  { slug: "ressonancia",   label: "Ressonância Magnética",      modalidadeIds: [5, 16],                  situacaoIds: SIT_RM_TC },
  { slug: "ecocardiograma",label: "Ecocardiograma",             modalidadeIds: [10],                     situacaoIds: SIT_FAROL },
  { slug: "neurocardio",   label: "Neurocardio & Espirometria", modalidadeIds: [14, 15, 18, 19, 20, 21], situacaoIds: SIT_FAROL },
] as const;

export type FilaSlug = typeof FILA_MODALIDADES[number]["slug"];

// "YYYY-MM-DD" em São Paulo — idêntico ao que a edge function usa em data_ref
export function todayBRT(): string {
  return hojeBRT();
}

function ModalidadeCard({
  slug, label, modalidadeIds, situacaoIds,
}: {
  slug: string;
  label: string;
  modalidadeIds: readonly number[];
  situacaoIds: readonly number[];
}) {
  const navigate = useNavigate();
  const [count, setCount] = useState<number | null>(null);

  const load = useCallback(() => {
    (supabase as any)
      .from("farol_timestamps")
      .select("atendimento_id", { count: "exact", head: true })
      .eq("data_ref", todayBRT())
      .in("modalidade_id", modalidadeIds)
      .in("situacao_id", situacaoIds)
      .is("dispensed_at", null)
      .then(({ count: c }: { count: number | null }) => setCount(c ?? 0));
  }, [modalidadeIds.join(","), situacaoIds.join(",")]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <button
      onClick={() => navigate(`/fila-atendimento/${slug}`)}
      className="group w-full bg-card border border-border rounded-2xl p-5 text-left hover:border-primary/50 hover:shadow-card-hover transition-all flex flex-col gap-3"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-muted group-hover:bg-primary/10 transition-colors">
          <ListOrdered className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors mt-1" />
      </div>

      <div>
        <p className="font-bold text-foreground text-sm leading-tight">{label}</p>
        {count === null ? (
          <p className="text-xs text-muted-foreground mt-1">Carregando…</p>
        ) : (
          <p className={`text-xs mt-1 font-semibold ${count > 0 ? "text-primary" : "text-muted-foreground"}`}>
            {count === 0 ? "Fila vazia" : `${count} paciente${count !== 1 ? "s" : ""} aguardando`}
          </p>
        )}
      </div>
    </button>
  );
}

// Hub de modalidades (UI atual — supervisor/admin/recepcao).
function FilaHub() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const tenantId = profile?.tenant_id ?? "";
  const [total, setTotal] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [assistentes, setAssistentes] = useState<Array<{
    id: string; full_name: string | null; email: string | null;
    medicos_count: number; updated_at: string;
  }>>([]);

  const allMod = FILA_MODALIDADES.flatMap(m => m.modalidadeIds);
  const allSit = Array.from(new Set(FILA_MODALIDADES.flatMap(m => m.situacaoIds)));

  const loadTotal = useCallback(async () => {
    if (!tenantId) return;
    const { count } = await (supabase as any)
      .from("farol_timestamps")
      .select("atendimento_id", { count: "exact", head: true })
      .eq("data_ref", todayBRT())
      .in("modalidade_id", allMod)
      .in("situacao_id", allSit)
      .is("dispensed_at", null);
    setTotal(count ?? 0);
  }, [tenantId, allMod.join(","), allSit.join(",")]);

  // Listagem de assistentes ATIVOS — só os que tem fila_assistente_state
  // gravado hoje E pelo menos 1 médico selecionado. Inclui contagem de
  // médicos e horário da última alteração pra supervisor saber quem está
  // realmente trabalhando agora.
  const loadAssistentes = useCallback(async () => {
    if (!tenantId) return;
    if (role !== "supervisor" && role !== "admin" && role !== "developer") return;

    // Início do dia em São Paulo (00:00 BRT) em ISO
    const startOfDayBRT = (() => {
      const todayStr = hojeBRT();
      // 00:00 BRT = 03:00 UTC
      return `${todayStr}T03:00:00.000Z`;
    })();

    const { data: states } = await (supabase as any)
      .from("fila_assistente_state")
      .select("user_id, medicos_selecionados, updated_at")
      .eq("tenant_id", tenantId)
      .gte("updated_at", startOfDayBRT);

    const ativos = (states as Array<{
      user_id: string; medicos_selecionados: string[]; updated_at: string;
    }> | null) ?? [];
    const filtered = ativos.filter(s => (s.medicos_selecionados?.length ?? 0) > 0);

    if (filtered.length === 0) { setAssistentes([]); return; }

    // Filtra só quem realmente tem role 'assistente_sala'. Agora que supervisor/
    // admin/dev também usam a tela do assistente (cada modalidade tem seleção
    // própria), eles também escrevem em fila_assistente_state — não devem
    // aparecer nesta lista, que é destinada a mostrar quem está montando fila
    // de verdade na recepção.
    const { data: rolesRows } = await (supabase as any)
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "assistente_sala")
      .in("user_id", filtered.map(s => s.user_id));
    const assistenteIds = new Set(
      ((rolesRows as Array<{ user_id: string }> | null) ?? []).map(r => r.user_id)
    );
    const apenasAssistentes = filtered.filter(s => assistenteIds.has(s.user_id));

    if (apenasAssistentes.length === 0) { setAssistentes([]); return; }

    const ids = apenasAssistentes.map(s => s.user_id);
    const { data: profs } = await (supabase as any)
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);

    const byId = new Map<string, { full_name: string | null; email: string | null }>();
    for (const p of ((profs as any[]) ?? [])) byId.set(p.id, p);

    setAssistentes(
      apenasAssistentes
        .map(s => ({
          id:            s.user_id,
          full_name:     byId.get(s.user_id)?.full_name ?? null,
          email:         byId.get(s.user_id)?.email ?? null,
          medicos_count: s.medicos_selecionados.length,
          updated_at:    s.updated_at,
        }))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    );
  }, [tenantId, role]);

  useEffect(() => { loadTotal(); loadAssistentes(); }, [loadTotal, loadAssistentes, tick]);

  const canSeeAssistentes = role === "supervisor" || role === "admin" || role === "developer";

  return (
    <MainLayout>
      <div className="space-y-6 p-4 md:p-6 animate-in fade-in duration-300">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <ListOrdered className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Fila de Atendimento</h1>
              <p className="text-sm text-muted-foreground">
                Sincronizada com o Farol · Selecione a modalidade
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setTick(t => t + 1)}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Atualizar
          </Button>
        </div>

        {/* Resumo total */}
        {total !== null && total > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 border border-border rounded-xl px-4 py-3">
            <Users className="h-4 w-4 text-muted-foreground/60" />
            <span>
              <strong className="text-foreground">{total}</strong> paciente{total !== 1 ? "s" : ""} no total em todas as filas
            </span>
          </div>
        )}

        {/* Grid de modalidades */}
        {tenantId && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" key={tick}>
            {FILA_MODALIDADES.map(m => (
              <ModalidadeCard
                key={m.slug}
                slug={m.slug}
                label={m.label}
                modalidadeIds={m.modalidadeIds}
                situacaoIds={m.situacaoIds}
              />
            ))}
          </div>
        )}

        {/* Assistentes ATIVOS — só pra supervisor/admin/dev */}
        {canSeeAssistentes && (
          <div className="rounded-2xl border border-border bg-card p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Stethoscope className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">
                    Assistentes ativos hoje
                    <span className="ml-2 text-xs font-semibold text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5 align-middle">
                      {assistentes.length}
                    </span>
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Quem fez ao menos uma seleção hoje. Clique para abrir a fila do assistente em modo leitura.
                  </p>
                </div>
              </div>
            </div>
            {assistentes.length === 0 ? (
              <p className="text-sm text-slate-400">
                Nenhum assistente ativo no momento. Aparecem aqui assim que selecionarem médicos no painel.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {assistentes.map(a => {
                  const updatedHHMM = new Intl.DateTimeFormat("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                    hour: "2-digit", minute: "2-digit",
                  }).format(new Date(a.updated_at));
                  const nome = a.full_name || a.email || a.id.slice(0, 8);
                  return (
                    <button
                      key={a.id}
                      onClick={() => navigate(`/fila-atendimento?as=${a.id}`)}
                      className="text-left rounded-xl border border-cyan-200 bg-cyan-50/60 hover:bg-cyan-50 hover:border-cyan-300 px-3 py-2.5 transition group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-cyan-900 text-sm truncate">{nome}</span>
                        <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Ativo hoje" />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-cyan-700 mt-1">
                        <span>{a.medicos_count} médico{a.medicos_count !== 1 ? "s" : ""}</span>
                        <span className="font-mono">{updatedHHMM}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
}

export default function FilaAtendimento() {
  const { role } = useAuth();
  const [searchParams] = useSearchParams();
  const previewAs = searchParams.get("as");

  // assistente_sala agora vê o FilaHub (visão geral, read-only por natureza).
  // Para entrar numa fila específica, navega para /fila-atendimento/:slug
  // onde FilaAtendimentoAssistente detecta a role e ativa readOnly.
  //
  // supervisor/admin/developer vê em modo preview quando ?as=<user_id> está setado.
  if (previewAs && (role === "supervisor" || role === "admin" || role === "developer")) {
    return <FilaAtendimentoAssistente />;
  }

  return <FilaHub />;
}
