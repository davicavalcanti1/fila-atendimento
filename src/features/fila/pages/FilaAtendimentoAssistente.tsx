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
import { type FilaSlug, faixaDaEspera, fmtTempo, CODIGO_FILA, LAMP } from "./FilaAtendimento";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { PacienteDetalhesDialog } from "../components/PacienteDetalhesDialog";
import {
  useFilaAssistente,
  PRIORIDADE_OPTIONS,
  type GroupedCard,
  type Coluna,
} from "../hooks/useFilaAssistente";
import { useEffect, useState } from "react";
import { DialogMotivoAlteracao, CamposDeMotivo, motivoCompleto } from "../components/MotivoAlteracao";
import { classePrioridade } from "../lib/prioridade";
import { DivisaoMedicosHoje } from "../components/DivisaoMedicosHoje";
import { IndicadorSincronizacao, FaixaFilaDesatualizada } from "../components/IndicadorSincronizacao";

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
    ultimaCargaTela,
    falhaCargaTela,
    viewersDoDia,
    podeVerAcompanhamento,
    loadAssistentes,
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
    loadFarol(); // já encadeia os overlays dos atendimentos de hoje
    loadState(targetUserId);
    loadAssistentes();
    let divisaoTimer: ReturnType<typeof setTimeout> | null = null;

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
        // A divisão de médicos vem desta tabela (a presença só diz quem está
        // online). Agrupado no tempo: selecionar médicos gera um evento por
        // clique. Para quem não é coordenação, loadAssistentes sai na hora.
        if (divisaoTimer) clearTimeout(divisaoTimer);
        divisaoTimer = setTimeout(loadAssistentes, 800);
      })
      .subscribe();

    const interval = setInterval(loadFarol, 30_000);
    return () => {
      if (divisaoTimer) clearTimeout(divisaoTimer);
      if (farolChannelRef.current) supabase.removeChannel(farolChannelRef.current);
      if (filaChannelRef.current)  supabase.removeChannel(filaChannelRef.current);
      if (stateChannelRef.current) supabase.removeChannel(stateChannelRef.current);
      clearInterval(interval);
    };
  }, [tenantId, targetUserId, mod.modalidadeIds[0], loadFarol, loadOverlays, loadState, loadAssistentes]);

  // ── Render helpers ──────────────────────────────────────────────────────────
  if (!tenantId) {
    return (
      <MainLayout>
        <div className="panel flex items-center justify-center py-14">
          <span className="console-label">Carregando…</span>
        </div>
      </MainLayout>
    );
  }

  const isSupervisorMode = !readOnly && (role === "supervisor" || role === "admin" || role === "developer");

  // ── Card do paciente ────────────────────────────────────────────────────────
  // Mesma regra do Farol: o chrome é neutro e a cor é sempre informação. Aqui
  // a informação que pinta o card é a PRIORIDADE — cada tipo tem a sua cor
  // (idoso, PCD, gestante, autista, prioritário; tokens --prio-* em
  // index.css), em fundo diluído com a barra cheia na aresta e o nome escrito
  // no card. Paciente normal fica branco. O tempo de espera é o único outro
  // sinal, e fica restrito ao LED pequeno no canto.
  function cardClasses(isDragging: boolean, prioridade: string, isAgendado: boolean) {
    const prioClasse = classePrioridade(prioridade);
    return cn(
      "relative shrink-0 rounded-sm bg-card pl-3 pr-2 py-2 text-sm cursor-pointer transition-shadow",
      "shadow-[0_0_0_1px_rgb(12_20_32/0.08)] hover:shadow-card-hover",
      isAgendado && !isDragging && "bg-card/60",
      prioClasse && `${prioClasse} prio-card`,
      isDragging && "shadow-lg ring-1 ring-primary",
    );
  }

  function cardInner(g: GroupedCard, isAgendado: boolean) {
    const prio = PRIORIDADE_OPTIONS[g.prioridadeMax] ?? PRIORIDADE_OPTIONS.normal;
    const isPriority = g.prioridadeMax !== "normal";
    const tempoEspera = Math.max(0, differenceInMinutes(now, g.chegouEmMin));
    const exames = g.itens.map(i => i.exame).filter(Boolean) as string[];
    const obs = g.itens.find(i => i.observacoes)?.observacoes ?? null;
    return (
      <>
        <div className="flex items-start gap-2">
          {/* Coluna do horário: mono e alinhada, é o que se lê primeiro
              descendo a lista ("quem é o das 10:40?"). */}
          <span className={cn(
            "font-mono text-xs font-bold w-11 shrink-0 pt-px tabular-nums",
            g.horarioMin ? "text-foreground" : "text-muted-foreground/50",
          )}>
            {g.horarioMin ?? "--:--"}
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground truncate leading-snug flex items-center gap-1.5">
              <span className="truncate">{g.nome}</span>
              {g.itens.length > 1 && (
                <span className="font-mono text-[10px] font-bold text-muted-foreground border border-border rounded-sm px-1 shrink-0">
                  {g.itens.length}×
                </span>
              )}
            </p>
            {exames.length > 0 && (
              <p className="text-[11px] text-muted-foreground truncate" title={exames.join(" · ")}>
                {exames.join(" · ")}
              </p>
            )}
          </div>

          <div className="flex items-center shrink-0 -mr-1">
            {!readOnly && (
              <button
                onClick={(e) => { e.stopPropagation(); aoEditar(g); }}
                title="Editar prioridade & observações"
                className="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setDetalhesGroup(g); }}
              title="Ver detalhes"
              className="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1 pl-[3.25rem] text-[11px] text-muted-foreground">
          {isPriority && (
            <span className="inline-flex items-center h-4 px-1.5 rounded-sm prio-chip text-[9px] font-bold uppercase tracking-[0.14em]">
              {prio.label}
            </span>
          )}
          {g.hasAnyOverride && (
            <span className="inline-flex items-center gap-1 console-label !text-primary" title="Transferido de médico">
              <ArrowRightLeft className="h-2.5 w-2.5" /> Transf.
            </span>
          )}
          <span className="truncate" title="Sala no NetRis">{g.itens[0].sala ?? ""}</span>
          {!isAgendado && (
            <span className="ml-auto inline-flex items-center gap-1.5 shrink-0" title="Tempo na fila">
              <span className={cn("lamp h-1.5 w-1.5", LAMP[faixaDaEspera(tempoEspera)])} />
              <span className={cn(
                "font-mono font-bold",
                tempoEspera >= 60 ? "text-destructive-strong" : tempoEspera >= 30 ? "text-warning-strong" : "text-foreground/80",
              )}>
                {fmtTempo(tempoEspera)}
              </span>
            </span>
          )}
        </div>

        {obs && (
          <p className="mt-1.5 ml-[3.25rem] text-[11px] text-foreground/80 border-l-2 border-warning pl-1.5 truncate" title={obs}>
            {obs}
          </p>
        )}
      </>
    );
  }

  function renderGroupCard(g: GroupedCard, index: number, isAgendado: boolean) {
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
            className={cardClasses(snap.isDragging, g.prioridadeMax, isAgendado)}
          >
            {cardInner(g, isAgendado)}
          </div>
        )}
      </Draggable>
    );
  }

  // As duas metades de toda fila: quem já está aqui e quem ainda vai chegar.
  // "Na fila" leva o ponto ciano (é a lista que se opera); "A chegar" vai
  // apagado de propósito — não pede ação ainda.
  //
  // Funções chamadas direto, e NÃO componentes (<Secao/>): declarado dentro do
  // render, um componente vira um tipo novo a cada render — e o relógio
  // re-renderiza esta tela todo segundo. O React desmontaria e remontaria os
  // Droppables no meio do arrasto.
  function renderSecao(tipo: "fila" | "agendados", grupos: GroupedCard[], droppableId: string, vazioTexto: string) {
    const quantidade = grupos.length;
    const isAgendado = tipo === "agendados";
    return (
      <div className="flex flex-col min-w-0">
        <div className="px-3 py-2 border-b border-border/70 flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 rounded-full", tipo === "fila" ? "bg-primary" : "bg-muted-foreground/40")} />
          <span className="console-label !text-foreground/80">{tipo === "fila" ? "Na fila" : "A chegar"}</span>
          <span className="font-mono text-[11px] font-bold text-muted-foreground">{quantidade}</span>
        </div>
        <Droppable droppableId={droppableId}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={cn(
                "p-2 space-y-1.5 min-h-[140px] flex flex-col bg-background/50 transition-colors",
                snapshot.isDraggingOver && "drop-ativo",
              )}
            >
              {quantidade === 0 && (
                <p className="console-label text-center py-4 opacity-60">{vazioTexto}</p>
              )}
              {grupos.map((g, idx) => renderGroupCard(g, idx, isAgendado))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    );
  }

  function renderDuasSecoes(scope: string, fila: GroupedCard[], agendados: GroupedCard[]) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/70">
        {renderSecao("fila", fila, `${scope}::SEC::fila`, "vazio")}
        {renderSecao("agendados", agendados, `${scope}::SEC::agendados`, "nenhum agendado")}
      </div>
    );
  }

  // Fila única (sem kanban por médico)
  function renderLinearLista(opts?: {
    fila?: GroupedCard[];
    agendados?: GroupedCard[];
    scopeKey?: string;
    codigo?: string;
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
      <section className="panel overflow-hidden">
        {title && (
          <div className="px-4 py-2.5 border-b border-border/70 flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2 min-w-0">
              {opts?.codigo && (
                <span className="font-mono text-sm font-bold tracking-[0.12em] text-foreground/90">{opts.codigo}</span>
              )}
              <p className="text-[13px] font-semibold text-muted-foreground truncate">{title}</p>
            </div>
            <Contagem fila={grupoFila.length} agendados={grupoAgendados.length} />
          </div>
        )}
        {renderDuasSecoes(scope, grupoFila, grupoAgendados)}
      </section>
    );
  }

  // Neurocardio agrega múltiplos tipos de exame. Os emojis saíram: o código
  // (ECG, EEG…) é o mesmo do chip de modalidade do Farol.
  function renderNeurocardio() {
    const exames = [
      { id: 15, label: "Eletrocardiograma",   codigo: "ECG"  },
      { id: 14, label: "Eletroencefalograma", codigo: "EEG"  },
      { id: 18, label: "Espirometria",        codigo: "ESP"  },
      { id: 19, label: "Holter",              codigo: "HOL"  },
      { id: 20, label: "Retorno MAPA",        codigo: "MAPA+" },
      { id: 21, label: "Retorno Holter",      codigo: "HOL+" },
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
                codigo:     ex.codigo,
                title:      ex.label,
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
      <section key={col.id} className="panel overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/70 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5 flex-wrap">
            <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm font-bold text-foreground truncate">{col.label}</p>
            <Contagem fila={grupoFila.length} agendados={grupoAgendados.length} />
            {vendo.length > 0 && (
              <span
                className="inline-flex items-center gap-1 h-5 px-1.5 rounded-sm border border-border text-[11px] text-muted-foreground shrink-0"
                title={`Marcou este médico hoje: ${vendo.map(v => v.nome).join(", ")}. É a escolha do dia, não presença na sala.`}
              >
                <Eye className="h-3 w-3" />
                {vendo.map(v => (v.souEu ? "você" : v.nome)).join(", ")}
              </span>
            )}
          </div>
          {!isPreview && (
            col.salaId ? (
              <Button
                variant="ghost" size="sm"
                onClick={() => removerSala(col.salaId!)}
                title="Remover esta sala"
                className="h-7 px-2 gap-1 text-[11px] font-bold uppercase tracking-wider text-destructive-strong hover:text-destructive-strong hover:bg-destructive/10 shrink-0"
              >
                <X className="h-3.5 w-3.5" /> Remover sala
              </Button>
            ) : (
              <Button
                variant="ghost" size="sm"
                onClick={() => duplicarMedico(col.medico)}
                title="Duplicar (atendendo em outra sala)"
                className="h-7 px-2 gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:text-primary hover:bg-primary/10 shrink-0"
              >
                <Plus className="h-3.5 w-3.5" /> Outra sala
              </Button>
            )
          )}
        </div>
        {renderDuasSecoes(col.id, grupoFila, grupoAgendados)}
      </section>
    );
  }

  const hh = String(clockTime.getHours()).padStart(2, "0");
  const mm = String(clockTime.getMinutes()).padStart(2, "0");
  const ss = String(clockTime.getSeconds()).padStart(2, "0");
  const codigoModalidade = CODIGO_FILA[mod.slug] ?? "";

  return (
    <MainLayout>
      <div className="space-y-3 animate-fade-in">
        <PageHeader
          eyebrow={codigoModalidade ? `Fila · ${codigoModalidade}` : "Fila"}
          title={modalidadeLabel}
          subtitle={
            readOnly
              ? "Somente leitura · sincronizada com o Farol"
              : porMedico
                ? "Sincronizada com o Farol · selecione os médicos para montar a sua visão"
                : "Sincronizada com o Farol · na fila e a chegar"
          }
          actions={
            <>
              <IndicadorSincronizacao tenantId={tenantId} telaEm={ultimaCargaTela} telaFalhou={falhaCargaTela} />
              {/* Relógio aqui e não na barra: embutida no sistema a barra some,
                  e na fila a hora é instrumento de trabalho. Os segundos vão
                  menores e apagados — provam que a tela está viva, mas ninguém
                  precisa lê-los. */}
              <div className="flex items-baseline gap-0.5 pr-2 border-r border-border" aria-label={`Agora: ${hh}:${mm}`}>
                <span className="font-mono text-xl font-bold text-foreground leading-none">{hh}:{mm}</span>
                <span className="font-mono text-[11px] text-muted-foreground leading-none">:{ss}</span>
              </div>
              <Button
                variant="outline" size="sm"
                onClick={() => refresh(targetUserId)}
                className="h-8 text-[11px] font-bold uppercase tracking-wider gap-1.5"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Atualizar
              </Button>
            </>
          }
        />

        <FaixaFilaDesatualizada tenantId={tenantId} telaFalhou={falhaCargaTela} />

        {readOnly && (
          <div className="panel flex items-center gap-3 px-4 py-2.5 border-l-[3px] border-l-warning">
            <Eye className="h-4 w-4 text-warning-strong shrink-0" />
            <span className="text-sm text-foreground">
              {isPreview
                ? "Você está vendo a fila de outro assistente — alterações estão desabilitadas."
                : "Fila em modo leitura — a ordem é definida pela recepção."}
            </span>
            {isPreview && (
              <Button
                size="sm" variant="ghost"
                className="ml-auto h-7 text-[11px] font-bold uppercase tracking-wider"
                onClick={() => setSearchParams({})}
              >
                Sair do preview
              </Button>
            )}
          </div>
        )}

        {/* Divisão de médicos do dia — só coordenação (Caio, 11/09/2026); a
            tranca é a RLS. `viewersDoDia` já vem sem os médicos de ontem, e com
            o LED de quem está online agora. */}
        {podeVerAcompanhamento && <DivisaoMedicosHoje viewers={viewersDoDia} now={now} />}

        {isSupervisorMode && assistenteList.length > 0 && (
          <div className="panel px-4 py-2.5 flex items-center gap-3 flex-wrap">
                <span className="console-label shrink-0 w-24">Ver como</span>
                {assistenteList.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setSearchParams({ as: a.id })}
                    className="inline-flex items-center gap-1.5 h-6 px-2 rounded-sm border border-border bg-card text-xs text-foreground hover:border-primary/50 hover:text-primary transition-colors"
                  >
                    <Eye className="h-3 w-3" />
                    {a.full_name || a.email || a.id.slice(0, 8)}
                  </button>
                ))}
          </div>
        )}

        <DragDropContext onDragEnd={aoArrastar}>
          {porMedico ? (
            <>
              <div className="panel px-4 py-3">
                <div className="flex items-center gap-2 mb-2.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="console-label !text-foreground/80">Médicos com pacientes hoje</span>
                  <span className="font-mono text-[11px] font-bold text-muted-foreground">{medicosDoDia.length}</span>
                  {savingState && <span className="console-label ml-auto">salvando…</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
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
                        aria-pressed={active}
                        title={outros.length > 0 ? `Também marcou este médico hoje: ${outros.map(v => v.nome).join(", ")}` : undefined}
                        className={cn(
                          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-sm border text-xs font-medium transition-colors",
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card text-foreground border-border hover:border-primary/50 hover:text-primary",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                        )}
                      >
                        {m}
                        {outros.length > 0 && (
                          <span className={cn(
                            "inline-flex items-center gap-0.5 font-mono text-[10px] font-bold",
                            active ? "text-primary-foreground/80" : "text-muted-foreground",
                          )}>
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
                <div className="rounded-sm border border-dashed border-border bg-card/40 py-12 flex flex-col items-center gap-2 text-muted-foreground">
                  <Stethoscope className="h-5 w-5 opacity-40" />
                  <p className="text-sm">Selecione um ou mais médicos acima para ver as filas.</p>
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
          <p className="console-label text-center py-2">Carregando dados…</p>
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
                <span className="font-mono text-xs text-muted-foreground"> · {editingGroup.itens.length} exames</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="console-label !text-foreground/80 mb-2 block">Prioridade / preferência</label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(PRIORIDADE_OPTIONS).map(([key, opt]) => {
                  const active = editPrioridade === key;
                  const prioClasse = classePrioridade(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setEditPrioridade(key)}
                      className={cn(
                        "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-sm border text-xs font-medium transition-colors",
                        prioClasse,
                        active
                          ? (prioClasse ? "prio-chip" : "bg-foreground text-background border-foreground")
                          : "bg-card text-foreground border-border hover:border-foreground/40",
                      )}
                    >
                      {/* A amostra da cor aparece mesmo desmarcado: a escolha
                          é também a escolha de como o card vai ficar. */}
                      {prioClasse && !active && (
                        <span className="h-2 w-2 rounded-[1px]" style={{ backgroundColor: "hsl(var(--prio))" }} />
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="console-label !text-foreground/80 mb-2 block">Observações</label>
              <textarea
                value={editObs}
                onChange={(e) => setEditObs(e.target.value)}
                placeholder="Notas internas sobre o paciente (sala, condição, contato, etc.)"
                rows={4}
                className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
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

/** "3 na fila · 2 a chegar", com os números em mono para alinharem entre colunas. */
function Contagem({ fila, agendados }: { fila: number; agendados: number }) {
  return (
    <span className="inline-flex items-baseline gap-2 text-[11px] text-muted-foreground shrink-0">
      <span><span className="font-mono font-bold text-foreground">{fila}</span> na fila</span>
      <span className="text-border">|</span>
      <span><span className="font-mono font-bold text-foreground/70">{agendados}</span> a chegar</span>
    </span>
  );
}
