import { useState, useEffect, useCallback, useMemo } from "react";
import { usePresencaFila } from "../hooks/usePresencaFila";
import { IndicadorSincronizacao, FaixaFilaDesatualizada } from "../components/IndicadorSincronizacao";
import { hojeBRT } from "@/lib/dataBRT";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/contexts/AuthContext";
import { SITUACAO } from "@/services/netris/client";
import { ArrowRight, RefreshCw, Stethoscope } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import FilaAtendimentoAssistente from "./FilaAtendimentoAssistente";

// Situações usadas por cada modalidade (espelha o que cada página do Farol filtra)
const SIT_FAROL: readonly number[] = [SITUACAO.ENCAMINHADO_EXAME];
const SIT_RM_TC: readonly number[] = [
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

/** Código curto de cada fila — o mesmo que o Farol usa no card da modalidade. */
export const CODIGO_FILA: Record<string, string> = {
  ultrassom: "US", radiografia: "RX", tomografia: "TC", mamografia: "MG",
  densitometria: "DO", ressonancia: "RM", ecocardiograma: "ECO", neurocardio: "NC",
};

/**
 * Classe do LED por faixa, ESCRITA POR EXTENSO. Montar `lamp-${faixa}` por
 * template parece equivalente e não é: o Tailwind só mantém no CSS a classe
 * que encontra literal no código, e `.lamp-warn`/`.lamp-crit` sumiam do build —
 * todo LED aceso saía cinza.
 */
export const LAMP: Record<"ok" | "warn" | "crit", string> = {
  ok: "lamp-ok", warn: "lamp-warn", crit: "lamp-crit",
};

/** Mesmos cortes do LED do Farol (statusAgendado.faixaDaEspera). */
export function faixaDaEspera(min: number): "ok" | "warn" | "crit" {
  if (min >= 60) return "crit";
  if (min >= 30) return "warn";
  return "ok";
}

export function fmtTempo(min: number) {
  if (min < 1) return "0m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/**
 * O card do hub responde uma pergunta só: quantos estão na fila desta
 * modalidade. Tempo de espera NÃO entra aqui de propósito — a Fila organiza a
 * sequência dos pacientes, e o tempo só importa dentro dela, no card de cada
 * um. Quem quer saber de atraso por modalidade olha o Farol.
 */
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

  const vazio = count === 0;

  return (
    <button
      onClick={() => navigate(`/fila-atendimento/${slug}`)}
      className={cn(
        "panel panel-hover group w-full text-left flex flex-col overflow-hidden",
        vazio && "opacity-70 hover:opacity-100",
      )}
    >
      <div className="flex items-baseline gap-2 px-4 pt-3.5">
        <span className="font-mono text-sm font-bold tracking-[0.12em] text-foreground/90">
          {CODIGO_FILA[slug] ?? slug.slice(0, 2).toUpperCase()}
        </span>
        <h3 className="text-[13px] font-semibold text-muted-foreground leading-tight truncate">{label}</h3>
      </div>

      <div className="px-4 pt-3 pb-3.5">
        <p className={cn("readout text-[2.5rem] md:text-[3rem]", vazio ? "text-muted-foreground" : "text-foreground")}>
          {count === null ? "…" : count}
        </p>
        <p className="console-label mt-1.5">
          {count === null ? "carregando" : count === 1 ? "paciente na fila" : "pacientes na fila"}
        </p>
      </div>

      <div className="mt-auto border-t border-border/70 px-4 py-2 flex items-center justify-between bg-background/40">
        <span className="console-label">{vazio ? "Fila vazia" : "Sincronizada com o Farol"}</span>
        <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary">
          Abrir <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

// Hub de modalidades (supervisor/admin/recepcao).
function FilaHub() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const tenantId = profile?.tenant_id ?? "";
  const [total, setTotal] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

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

  // Assistentes de sala com a fila aberta AGORA — presença real do Realtime
  // (ver usePresencaFila). O hub só escuta: quem está aqui não está
  // acompanhando médico, então não se anuncia.
  //
  // Antes era quem tinha salvo seleção em algum momento de hoje, e ninguém saía
  // da lista até meia-noite. O horário exibido agora é "online desde".
  // Médicos de cada pessoa hoje, da tabela protegida pela RLS da coordenação
  // (a presença não carrega médicos — ver usePresencaFila). Soma por pessoa:
  // quem trabalha Ultrassom e Ecocardiograma tem uma linha em cada.
  const [medicosPorPessoa, setMedicosPorPessoa] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!tenantId || !(role === "supervisor" || role === "admin" || role === "developer")) return;
    let vivo = true;
    const ler = async () => {
      const { data } = await (supabase as any)
        .from("fila_assistente_state")
        .select("user_id, medicos_selecionados")
        .eq("tenant_id", tenantId)
        .gte("updated_at", `${hojeBRT()}T03:00:00.000Z`);
      if (!vivo) return;
      const m = new Map<string, number>();
      for (const st of (data as Array<{ user_id: string; medicos_selecionados: string[] }> | null) ?? []) {
        m.set(st.user_id, (m.get(st.user_id) ?? 0) + (st.medicos_selecionados?.length ?? 0));
      }
      setMedicosPorPessoa(m);
    };
    ler();
    const t = setInterval(ler, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, [tenantId, role, tick]);

  const { online } = usePresencaFila({
    tenantId,
    eu: profile?.id ? { id: profile.id, nome: profile.full_name || "Sem nome", papel: role ?? null } : null,
    anuncio: null,
  });
  const canSeeAssistentes = role === "supervisor" || role === "admin" || role === "developer";
  const assistentes = useMemo(
    () => canSeeAssistentes
      ? online
          .filter(p => p.papel === "assistente_sala")
          .map(p => ({
            id:            p.id,
            full_name:     p.nome,
            email:         null as string | null,
            medicos_count: medicosPorPessoa.get(p.id) ?? 0,
            updated_at:    p.desde,
          }))
      : [],
    [online, canSeeAssistentes, medicosPorPessoa],
  );

  useEffect(() => { loadTotal(); }, [loadTotal, tick]);

  return (
    <MainLayout>
      <div className="space-y-4 animate-fade-in">
        <PageHeader
          eyebrow="Recepção"
          title="Filas"
          subtitle="Pacientes encaminhados para exame agora, por modalidade"
          actions={
            <>
              {tenantId && <IndicadorSincronizacao tenantId={tenantId} />}
              {total !== null && (
                <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-sm border border-border bg-card">
                  <span className="font-mono text-sm font-bold text-foreground">{total}</span>
                  <span className="console-label">no total</span>
                </span>
              )}
              <Button variant="outline" size="sm" className="h-8 text-[11px] font-bold uppercase tracking-wider gap-1.5" onClick={() => setTick(t => t + 1)}>
                <RefreshCw className="h-3.5 w-3.5" /> Atualizar
              </Button>
            </>
          }
        />

        {tenantId && <FaixaFilaDesatualizada tenantId={tenantId} />}

        {tenantId && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" key={tick}>
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
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/70">
              <div className="flex items-center gap-2.5 min-w-0">
                <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0" />
                <h2 className="text-sm font-bold text-foreground">Assistentes online agora</h2>
                <span className="font-mono text-xs font-bold text-foreground/80">{assistentes.length}</span>
              </div>
              <span className="console-label hidden sm:block">Clique para ver a fila do assistente em modo leitura</span>
            </div>
            {assistentes.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                Nenhum assistente com a fila aberta agora. Aparecem aqui assim que abrem uma fila, e saem quando fecham.
              </p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {assistentes.map(a => {
                  const updatedHHMM = new Intl.DateTimeFormat("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                    hour: "2-digit", minute: "2-digit",
                  }).format(new Date(a.updated_at));
                  const nome = a.full_name || a.email || a.id.slice(0, 8);
                  return (
                    <li key={a.id}>
                      <button
                        onClick={() => navigate(`/fila-atendimento?as=${a.id}`)}
                        className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted/60 transition-colors"
                      >
                        <span className="lamp lamp-ok h-1.5 w-1.5 shrink-0" title="Online agora" />
                        <span className="flex-1 min-w-0 truncate text-sm font-semibold text-foreground">{nome}</span>
                        <span className="console-label shrink-0">{a.medicos_count} méd.</span>
                        <span className="font-mono text-[11px] text-muted-foreground shrink-0" title="Online desde">{updatedHHMM}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
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
