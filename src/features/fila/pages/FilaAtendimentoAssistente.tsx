import React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/contexts/AuthContext";
import { differenceInMinutes } from "date-fns";
import {
  Plus, X, RefreshCw, Stethoscope, Users, Eye, ArrowRightLeft, Info, Pencil,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { type FilaSlug } from "./FilaAtendimento";
import { PacienteDetalhesDialog } from "../components/PacienteDetalhesDialog";
import {
  useFilaAssistente,
  PRIORIDADE_OPTIONS,
  formatMin,
  type GroupedCard,
  type Coluna,
} from "../hooks/useFilaAssistente";
import { useEffect, useState } from "react";
import { DialogMotivoAlteracao, CamposDeMotivo, motivoCompleto } from "../components/MotivoAlteracao";

export default function FilaAtendimentoAssistente() {
  const { profile, role } = useAuth();
  const tenantId = profile?.tenant_id ?? "";
  const myUserId = profile?.id ?? "";

  const { slug } = useParams<{ slug?: FilaSlug }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const previewUserId = searchParams.get("as");
  const isPreview = !!previewUserId && (role === "supervisor" || role === "admin" || role === "developer");
  const targetUserId = isPreview ? previewUserId! : myUserId;
  // assistente_sala pode visualizar mas não editar a fila. Escolher quais
  // médicos acompanhar não é edição — isso continua liberado (ver `isPreview`).
  const readOnly = isPreview || role === "assistente_sala";

  // Motivo em curso. Zerado a cada abertura para não herdar a justificativa da
  // alteração anterior, que é o jeito mais fácil de o registro virar ficção.
  const [motivo, setMotivo] = useState("");
  const [motivoDetalhe, setMotivoDetalhe] = useState("");

  const {
    // Meta da modalidade
    mod,
    modalidadeLabel,
    porMedico,

    // Estado
    state,
    loading,
    savingState,
    now,
    clockTime,
    assistenteList,
    viewers,
    viewersPorMedico,
    alteracaoPendente,
    salvandoAlteracao,
    detalhesGroup,
    setDetalhesGroup,
    editingGroup,
    setEditingGroup,
    editPrioridade,
    setEditPrioridade,
    editObs,
    setEditObs,
    savingEdit,

    // Dados derivados
    medicosDoDia,
    groupsBySection,
    colunas,

    // Funções de carregamento
    loadFarol,
    loadOverlays,
    loadState,
    loadAssistentes,

    // Refs dos canais
    farolChannelRef,
    filaChannelRef,
    stateChannelRef,

    // Handlers
    toggleMedico,
    duplicarMedico,
    removerSala,
    onDragEnd,
    confirmarAlteracao,
    cancelarAlteracao,
    startEdit,
    saveEdit,
    refresh,
    toPacienteAtendimentos,
    groupsDaColuna,
    listaDoEscopo,
  } = useFilaAssistente({
    slug,
    user: profile ? { id: profile.id, tenant_id: profile.tenant_id, full_name: profile.full_name } : null,
    role,
    readOnly,
    isPreview,
  });

  // Motivo sempre em branco quando um diálogo abre: herdar a justificativa da
  // alteração anterior é o caminho mais curto para o registro virar ficção.
  // Zerado ao abrir, e não por efeito depois, para não existir um quadro pintado
  // com o motivo anterior já marcado e o botão de confirmar habilitado.
  const limparMotivo = () => { setMotivo(""); setMotivoDetalhe(""); };
  const aoArrastar = (r: Parameters<typeof onDragEnd>[0]) => { limparMotivo(); onDragEnd(r); };
  const aoEditar   = (g: GroupedCard) => { limparMotivo(); startEdit(g); };

  // ── Efeito principal: subscriptions + carregamento inicial ──────────────────
  // Fica aqui porque depende de targetUserId que é derivado no componente.
  useEffect(() => {
    if (!tenantId) return;
    let viewersTimer: ReturnType<typeof setTimeout> | null = null;
    loadFarol(); // já encadeia os overlays dos atendimentos de hoje
    loadState(targetUserId);
    loadAssistentes();

    farolChannelRef.current = supabase
      .channel(`assist-farol-${tenantId}`)
      .on("postgres_changes" as any, {
        event: "*", schema: "public", table: "farol_timestamps",
        filter: `tenant_id=eq.${tenantId}`,
      }, () => loadFarol())
      .subscribe();

    filaChannelRef.current = supabase
      .channel(`assist-overlay-${tenantId}`)
      .on("postgres_changes" as any, {
        event: "*", schema: "public", table: "fila_atendimento",
        filter: `tenant_id=eq.${tenantId}`,
      }, () => loadOverlays())
      .subscribe();

    const modalidadeKey = mod.modalidadeIds[0];
    stateChannelRef.current = supabase
      .channel(`assist-state-${tenantId}-${targetUserId}-${modalidadeKey}`)
      .on("postgres_changes" as any, {
        event: "*", schema: "public", table: "fila_assistente_state",
        filter: `tenant_id=eq.${tenantId}`,
      }, (payload: any) => {
        const row = payload?.new ?? payload?.old;
        if (row?.user_id === targetUserId && row?.modalidade_id === modalidadeKey) loadState(targetUserId);
        // Qualquer linha do tenant mexe em "quem está acompanhando quem" —
        // inclusive as de outras pessoas e de outras modalidades, que é
        // justamente o que essa lista precisa refletir. Agrupado no tempo
        // porque selecionar médicos gera um evento por clique, e cada um custa
        // três consultas vezes o número de telas abertas.
        if (viewersTimer) clearTimeout(viewersTimer);
        viewersTimer = setTimeout(loadAssistentes, 800);
      })
      .subscribe();

    const interval = setInterval(loadFarol, 30_000);
    return () => {
      if (farolChannelRef.current) supabase.removeChannel(farolChannelRef.current);
      if (filaChannelRef.current)  supabase.removeChannel(filaChannelRef.current);
      if (stateChannelRef.current) supabase.removeChannel(stateChannelRef.current);
      if (viewersTimer) clearTimeout(viewersTimer);
      clearInterval(interval);
    };
  }, [tenantId, targetUserId, mod.modalidadeIds[0], loadFarol, loadOverlays, loadState, loadAssistentes]);

  // ── Render helpers ──────────────────────────────────────────────────────────
  if (!tenantId) {
    return <MainLayout><div className="p-6 text-muted-foreground">Carregando…</div></MainLayout>;
  }

  const isSupervisorMode = !readOnly && (role === "supervisor" || role === "admin" || role === "developer");

  function cardClasses(isDragging: boolean, isPriority: boolean, isAgendado: boolean) {
    return `shrink-0 rounded-lg border p-2.5 text-sm shadow-sm transition cursor-pointer hover:shadow-md ${
      isDragging ? "ring-2 ring-blue-400 shadow-lg" : ""
    } ${
      isPriority
        ? "bg-red-100 border-red-300"
        : isAgendado
          ? "bg-amber-50/70 border-amber-200"
          : "bg-card border-border"
    }`;
  }

  function cardInner(g: GroupedCard, isAgendado: boolean) {
    const prio = PRIORIDADE_OPTIONS[g.prioridadeMax] ?? PRIORIDADE_OPTIONS.normal;
    const tempoEspera = differenceInMinutes(now, g.chegouEmMin);
    const exames = g.itens.map(i => i.exame).filter(Boolean) as string[];
    const obs = g.itens.find(i => i.observacoes)?.observacoes ?? null;
    return (
      <>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground truncate flex items-center gap-1.5">
              <span>{prio.emoji}</span>
              <span className="truncate">{g.nome}</span>
              {g.itens.length > 1 && (
                <span className="text-[10px] font-bold bg-blue-100 text-blue-800 rounded-full px-1.5 py-0.5 shrink-0">
                  {g.itens.length} exames
                </span>
              )}
            </p>
            {exames.length > 0 && (
              <p className="text-xs text-muted-foreground truncate" title={exames.join(" · ")}>
                {exames.join(" · ")}
              </p>
            )}
          </div>
          {g.horarioMin && (
            <span className="text-xs font-mono text-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
              {g.horarioMin}
            </span>
          )}
          {!readOnly && (
            <button
              onClick={(e) => { e.stopPropagation(); aoEditar(g); }}
              title="Editar prioridade & observações"
              className="shrink-0 p-1 rounded hover:bg-amber-100 text-muted-foreground hover:text-amber-700"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setDetalhesGroup(g); }}
            title="Ver detalhes"
            className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
          <span>{g.itens[0].sala ? `Sala NetRis: ${g.itens[0].sala}` : "—"}</span>
          {!isAgendado && <span title="Tempo de espera">⏱ {formatMin(tempoEspera)}</span>}
        </div>

        {obs && (
          <p className="mt-1.5 text-[11px] text-foreground bg-muted/40 rounded px-1.5 py-1 truncate">
            {obs}
          </p>
        )}

        {g.hasAnyOverride && (
          <p className="mt-1.5 text-[10px] text-blue-700 flex items-center gap-1">
            <ArrowRightLeft className="h-3 w-3" />
            Transferido
          </p>
        )}
      </>
    );
  }

  function renderGroupCard(g: GroupedCard, index: number, isAgendado: boolean) {
    const isPriority = g.prioridadeMax !== "normal";
    return (
      <Draggable
        key={g.groupId}
        draggableId={g.groupId}
        index={index}
        isDragDisabled={readOnly}
      >
        {(prov, snap) => (
          <div
            ref={prov.innerRef}
            {...prov.draggableProps}
            {...prov.dragHandleProps}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              setDetalhesGroup(g);
            }}
            className={cardClasses(snap.isDragging, isPriority, isAgendado)}
          >
            {cardInner(g, isAgendado)}
          </div>
        )}
      </Draggable>
    );
  }

  // Fila única (sem kanban por médico)
  function renderLinearLista(opts?: {
    fila?: GroupedCard[];
    agendados?: GroupedCard[];
    scopeKey?: string;
    title?: string;
    hideEmpty?: boolean;
  }) {
    const grupoFila      = opts?.fila      ?? groupsBySection.fila;
    const grupoAgendados = opts?.agendados ?? groupsBySection.agendados;
    const scope = opts?.scopeKey ?? "linear";
    const title = opts?.title;

    if (opts?.hideEmpty && grupoFila.length === 0 && grupoAgendados.length === 0) {
      return null;
    }

    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {title && (
          <div className="px-4 py-2 border-b border-border bg-muted/40 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <span className="text-xs text-muted-foreground">
              {grupoFila.length} na fila · {grupoAgendados.length} a chegar
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
          {/* Box: Na fila */}
          <div className="flex flex-col">
            <div className="px-3 py-2 text-xs uppercase tracking-wider font-semibold text-blue-700 bg-blue-50 border-b border-blue-100 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              Na fila ({grupoFila.length})
            </div>
            <Droppable droppableId={`${scope}::SEC::fila`}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`p-2 space-y-2 min-h-[160px] flex flex-col ${snapshot.isDraggingOver ? "bg-blue-50/60" : ""}`}
                >
                  {grupoFila.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-3">vazio</p>
                  )}
                  {grupoFila.map((g, idx) => renderGroupCard(g, idx, false))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
          {/* Box: A chegar */}
          <div className="flex flex-col">
            <div className="px-3 py-2 text-xs uppercase tracking-wider font-semibold text-amber-700 bg-amber-50 border-b border-amber-100 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              A chegar ({grupoAgendados.length})
            </div>
            <Droppable droppableId={`${scope}::SEC::agendados`}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`p-2 space-y-2 min-h-[160px] flex flex-col ${snapshot.isDraggingOver ? "bg-amber-50/60" : ""}`}
                >
                  {grupoAgendados.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-3">nenhum agendado</p>
                  )}
                  {grupoAgendados.map((g, idx) => renderGroupCard(g, idx, true))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        </div>
      </div>
    );
  }

  // Neurocardio agrega múltiplos tipos de exame
  function renderNeurocardio() {
    const exames = [
      { id: 15, label: "Eletrocardiograma",   icon: "🫀" },
      { id: 14, label: "Eletroencefalograma", icon: "🧠" },
      { id: 18, label: "Espirometria",        icon: "🫁" },
      { id: 19, label: "Holter",              icon: "📟" },
      { id: 20, label: "Retorno MAPA",        icon: "🩺" },
      { id: 21, label: "Retorno Holter",      icon: "🩺" },
    ];
    return (
      <div className="space-y-3">
        {exames.map(ex => {
          // O prefixo "linear-" é o que faz o onDragEnd tratar estes blocos como
          // lista linear; e a lista vem do listaDoEscopo pra ele reordenar
          // exatamente o que está na tela.
          const scopeKey = `linear-neuro-${ex.id}`;
          return (
            <React.Fragment key={ex.id}>
              {renderLinearLista({
                fila:       listaDoEscopo(scopeKey, "fila"),
                agendados:  listaDoEscopo(scopeKey, "agendados"),
                scopeKey,
                title:      `${ex.icon} ${ex.label}`,
                hideEmpty:  true,
              })}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // Cada coluna (médico ou sala extra) ocupa 1 linha COMPLETA com 2 boxes lado a lado.
  function renderRowColuna(col: Coluna) {
    const grupoFila      = groupsDaColuna(col, groupsBySection.fila);
    const grupoAgendados = groupsDaColuna(col, groupsBySection.agendados);
    const vendo          = viewersPorMedico.get(col.medico) ?? [];

    return (
      <div key={col.id} className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header da coluna do médico */}
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2 bg-muted/40">
          <div className="min-w-0 flex items-center gap-2 flex-wrap">
            <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm font-semibold text-foreground truncate">{col.label}</p>
            <span className="text-xs text-muted-foreground shrink-0">
              · {grupoFila.length} na fila · {grupoAgendados.length} a chegar
            </span>
            {vendo.length > 0 && (
              <span
                className="text-[11px] text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-full px-2 py-0.5 flex items-center gap-1 shrink-0"
                title={`Acompanhando este médico: ${vendo.map(v => v.nome).join(", ")}`}
              >
                <Eye className="h-3 w-3" />
                {vendo.map(v => (v.souEu ? "você" : v.nome)).join(", ")}
              </span>
            )}
          </div>
          {!isPreview && (
            col.salaId ? (
              <button
                onClick={() => removerSala(col.salaId!)}
                title="Remover esta sala"
                className="text-xs text-rose-600 hover:bg-rose-50 rounded p-1 flex items-center gap-1"
              >
                <X className="h-3.5 w-3.5" /> Remover sala
              </button>
            ) : (
              <button
                onClick={() => duplicarMedico(col.medico)}
                title="Duplicar (atendendo em outra sala)"
                className="text-xs text-blue-600 hover:bg-blue-50 rounded p-1 flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" /> Duplicar p/ outra sala
              </button>
            )
          )}
        </div>

        {/* Linha com os 2 boxes lado a lado */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
          {/* Box: Na fila */}
          <div className="flex flex-col">
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-blue-700 bg-blue-50 border-b border-blue-100 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              Na fila ({grupoFila.length})
            </div>
            <Droppable droppableId={`${col.id}::SEC::fila`}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`p-2 space-y-2 min-h-[160px] flex flex-col ${snapshot.isDraggingOver ? "bg-blue-50/60" : ""}`}
                >
                  {grupoFila.length === 0 && (
                    <p className="text-[11px] text-muted-foreground text-center py-3">vazio</p>
                  )}
                  {grupoFila.map((g, idx) => renderGroupCard(g, idx, false))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>

          {/* Box: A chegar */}
          <div className="flex flex-col">
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-amber-700 bg-amber-50 border-b border-amber-100 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              A chegar ({grupoAgendados.length})
            </div>
            <Droppable droppableId={`${col.id}::SEC::agendados`}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`p-2 space-y-2 min-h-[160px] flex flex-col ${snapshot.isDraggingOver ? "bg-amber-50/60" : ""}`}
                >
                  {grupoAgendados.length === 0 && (
                    <p className="text-[11px] text-muted-foreground text-center py-3">nenhum agendado</p>
                  )}
                  {grupoAgendados.map((g, idx) => renderGroupCard(g, idx, true))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        </div>
      </div>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-4 p-4 md:p-6">

        {/* Header navy gradient */}
        <div className="rounded-2xl bg-gradient-to-r from-[#0c3582] to-[#0a2b6b] text-white p-4 md:p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Stethoscope className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-cyan-300">
                {readOnly ? `Visão do Assistente — ${modalidadeLabel} (read-only)` : `Fila — ${modalidadeLabel}`}
              </h1>
              <p className="text-xs text-white/70">
                {porMedico
                  ? "Sincronizada com o Farol · Selecione os médicos para montar a sua visão"
                  : "Sincronizada com o Farol · Pacientes na fila e a chegar"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="font-mono leading-none text-right">
              <span className="text-3xl md:text-4xl font-extrabold tabular-nums">
                {String(clockTime.getHours()).padStart(2, "0")}:{String(clockTime.getMinutes()).padStart(2, "0")}
              </span>
              <span className="ml-1 text-base md:text-lg text-cyan-300 tabular-nums">
                {String(clockTime.getSeconds()).padStart(2, "0")}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => refresh(targetUserId)} className="bg-white/15 hover:bg-white/25 text-white border-white/20">
              <RefreshCw className="h-4 w-4 mr-1.5" /> Atualizar
            </Button>
          </div>
        </div>

        {readOnly && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-3">
            <Eye className="h-4 w-4 text-amber-700" />
            <span className="text-sm text-amber-900">
              Você está visualizando a fila de outro assistente — alterações estão desabilitadas.
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSearchParams({})}>
              Sair do modo preview
            </Button>
          </div>
        )}

        {/* Quem está acompanhando quem, agora. Vale para todo mundo, não só
            para a supervisão: é o que evita duas pessoas cuidarem do mesmo
            médico sem saber, e é a informação que some quando alguém pergunta
            "quem estava vendo esse aqui?" depois do fato. */}
        {viewers.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2 text-sm text-foreground mb-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold">Acompanhando agora</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {viewers.map(v => (
                <div key={v.id} className="flex items-start gap-2 text-xs">
                  <span className={`shrink-0 font-semibold ${v.souEu ? "text-blue-700" : "text-foreground"}`}>
                    {v.souEu ? `${v.nome} (você)` : v.nome}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-muted-foreground">{v.medicos.join(" · ")}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isSupervisorMode && assistenteList.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2 text-sm text-foreground mb-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold">Visão dos assistentes:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {assistenteList.map(a => (
                <button
                  key={a.id}
                  onClick={() => setSearchParams({ as: a.id })}
                  className="text-xs px-2.5 py-1 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200 hover:bg-cyan-100"
                >
                  {a.full_name || a.email || a.id.slice(0, 8)}
                </button>
              ))}
            </div>
          </div>
        )}

        <DragDropContext onDragEnd={aoArrastar}>
          {porMedico ? (
            <>
              <div className="rounded-xl border border-border bg-card p-3 md:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">Médicos com pacientes hoje</p>
                  {savingState && <span className="text-xs text-muted-foreground">salvando…</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {medicosDoDia.length === 0 && (
                    <span className="text-sm text-muted-foreground">Nenhum médico no farol hoje.</span>
                  )}
                  {medicosDoDia.map(m => {
                    const active = state.medicos_selecionados.includes(m);
                    // Quem mais está com este médico aberto. Aparece no chip
                    // para a escolha ser informada antes de duas pessoas
                    // acompanharem o mesmo médico sem saber uma da outra.
                    const outros = (viewersPorMedico.get(m) ?? []).filter(v => !v.souEu);
                    return (
                      <button
                        key={m}
                        onClick={() => toggleMedico(m)}
                        disabled={isPreview}
                        title={outros.length > 0 ? `Também acompanhando: ${outros.map(v => v.nome).join(", ")}` : undefined}
                        className={`text-xs px-2.5 py-1 rounded-full border transition flex items-center gap-1.5 ${
                          active
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-card text-foreground border-border hover:border-primary"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {m}
                        {outros.length > 0 && (
                          <span className={`inline-flex items-center gap-0.5 text-[10px] rounded-full px-1.5 ${
                            active ? "bg-white/20 text-white" : "bg-cyan-50 text-cyan-800 border border-cyan-200"
                          }`}>
                            <Eye className="h-2.5 w-2.5" />
                            {outros.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {state.medicos_selecionados.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-muted-foreground">
                  Selecione 1 ou mais médicos acima para visualizar suas filas.
                </div>
              ) : (
                <div className="space-y-3">
                  {colunas.map(renderRowColuna)}
                </div>
              )}
            </>
          ) : mod.slug === "neurocardio" ? (
            renderNeurocardio()
          ) : (
            renderLinearLista()
          )}
        </DragDropContext>

        {loading && (
          <p className="text-xs text-muted-foreground text-center py-2">Carregando dados…</p>
        )}
      </div>

      {/* Modal de detalhes */}
      <PacienteDetalhesDialog
        open={!!detalhesGroup}
        onClose={() => setDetalhesGroup(null)}
        atendimentos={detalhesGroup ? toPacienteAtendimentos(detalhesGroup) : []}
      />

      {/* Dialog de edição de prioridade & observações */}
      <Dialog open={!!editingGroup} onOpenChange={v => { if (!v) setEditingGroup(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar paciente</DialogTitle>
            <DialogDescription>
              {editingGroup?.nome}
              {editingGroup && editingGroup.itens.length > 1 && (
                <span className="text-xs text-muted-foreground"> · {editingGroup.itens.length} exames</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block">Prioridade / preferência</label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(PRIORIDADE_OPTIONS).map(([key, opt]) => {
                  const active = editPrioridade === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setEditPrioridade(key)}
                      className={`text-xs px-2.5 py-1.5 rounded-full border transition flex items-center gap-1.5 ${
                        active
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-card text-foreground border-border hover:border-primary"
                      }`}
                    >
                      <span>{opt.emoji}</span>
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block">Observações</label>
              <textarea
                value={editObs}
                onChange={(e) => setEditObs(e.target.value)}
                placeholder="Notas internas sobre o paciente (sala, condição, contato, etc.)"
                rows={4}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <CamposDeMotivo
              motivo={motivo} setMotivo={setMotivo}
              detalhe={motivoDetalhe} setDetalhe={setMotivoDetalhe}
              disabled={savingEdit}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingGroup(null)} disabled={savingEdit}>
              Cancelar
            </Button>
            <Button
              onClick={() => saveEdit(motivo, motivoDetalhe.trim() || null)}
              disabled={savingEdit || !motivoCompleto(motivo, motivoDetalhe)}
            >
              {savingEdit ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DialogMotivoAlteracao
        alteracao={alteracaoPendente}
        salvando={salvandoAlteracao}
        motivo={motivo} setMotivo={setMotivo}
        detalhe={motivoDetalhe} setDetalhe={setMotivoDetalhe}
        onConfirmar={() => confirmarAlteracao(motivo, motivoDetalhe.trim() || null)}
        onCancelar={cancelarAlteracao}
      />
    </MainLayout>
  );
}
