import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logError } from "@/lib/logger";
import { toast } from "sonner";
import { hojeBRT } from "@/lib/dataBRT";
import type { DropResult } from "@hello-pangea/dnd";
import { supabase } from "@/integrations/supabase/client";
import { differenceInMinutes } from "date-fns";
import { todayBRT, FILA_MODALIDADES, type FilaSlug } from "../pages/FilaAtendimento";
import { SITUACAO } from "@/services/netris/client";
import type { PacienteAtendimento } from "../components/PacienteDetalhesDialog";

// ── Tipos exportados ──────────────────────────────────────────────────────────

export interface FarolRow {
  atendimento_id:     string;
  nome_paciente:      string;
  cpf:                string | null;
  modalidade_id:      number;
  exame:              string | null;
  medico:             string | null;
  sala:               string | null;
  hora_inicial_ms:    number | null;
  situacao_id:        number;
  situacao_nome:      string | null;
  primeira_vez:       string;
  telefone?:          string | null;
  data_nascimento?:   string | null;
  convenio?:          string | null;
}

export interface FilaOverlay {
  atendimento_id:      string;
  posicao:             number | null;
  medico_override:     string | null;
  prioridade:          string;
  observacoes:         string | null;
  dispensed_at:        string | null;
  transferred_by_name: string | null;
  transferred_at:      string | null;
}

export interface SalaExtra { id: string; medico: string; sala_label: string; }

export interface AssistenteState {
  medicos_selecionados: string[];
  salas_extra:          SalaExtra[];
  paciente_sala_map:    Record<string, string>; // atendimento_id -> sala_extra.id
}

export interface ProfileLite { id: string; full_name: string | null; email: string | null; }

// Card "atomico" por atendimento — usado na ordenação interna do grupo.
export interface CardItem {
  atendimento_id: string;
  nome:           string;
  cpf:            string | null;
  exame:          string | null;
  sala:           string | null;
  horario:        string | null;
  medico:         string | null;
  medicoOriginal: string | null;
  situacao_id:    number;
  situacao_nome:  string | null;
  posicao:        number | null;
  prioridade:     string;
  observacoes:    string | null;
  hasOverride:    boolean;
  transferredAt:  string | null;
  transferredBy:  string | null;
  chegouEm:       Date;
  // raw row pra montar PacienteAtendimento sem refazer fetch
  raw:            FarolRow;
}

// Agrupado por paciente (mesmo CPF, mesmo médico, mesma seção).
export interface GroupedCard {
  groupId:    string; // chave única usada como draggableId
  cpfKey:     string; // identifica o paciente
  nome:       string;
  medico:     string | null;
  prioridadeMax: string;
  posicao:    number | null;
  horarioMin: string | null;
  chegouEmMin: Date;
  hasAnyOverride: boolean;
  itens:      CardItem[];
}

export type Section = "fila" | "agendados";
export type Coluna = { id: string; medico: string; salaId?: string; label: string };

// ── Constantes ────────────────────────────────────────────────────────────────

export const PRIORIDADE_OPTIONS: Record<string, { label: string; emoji: string }> = {
  normal:   { label: "Normal",      emoji: "👤" },
  idoso:    { label: "Idoso",       emoji: "👴" },
  pcd:      { label: "PCD",         emoji: "♿" },
  gestante: { label: "Gestante",    emoji: "🤰" },
  autista:  { label: "Autista",     emoji: "🧩" },
  crianca:  { label: "Prioritário", emoji: "⭐" },
};

// Motivos de alteração da fila. Lista fechada porque texto livre em campo
// obrigatório vira "ok" e "ajuste" em duas semanas, e aí o registro não responde
// mais a pergunta que ele existe para responder. "outro" pede detalhe justamente
// para que o que falta na lista apareça e possa virar opção.
export const MOTIVO_OPTIONS: Record<string, { label: string; descricao: string }> = {
  encaixe:          { label: "Encaixe",              descricao: "Paciente incluído fora da ordem agendada" },
  prioridade_legal: { label: "Prioridade",           descricao: "Idoso, PCD, gestante, criança ou autista" },
  urgencia_clinica: { label: "Urgência clínica",     descricao: "Quadro do paciente exige antecipar" },
  atraso_medico:    { label: "Atraso do médico",     descricao: "Remanejamento por atraso ou ausência" },
  troca_sala:       { label: "Troca de sala",        descricao: "Paciente passou a ser atendido em outra sala" },
  pedido_paciente:  { label: "Pedido do paciente",   descricao: "Solicitação do próprio paciente ou acompanhante" },
  correcao:         { label: "Correção de erro",     descricao: "Desfazendo lançamento equivocado" },
  outro:            { label: "Outro",                descricao: "Descreva o motivo" },
};

export const MOTIVO_EXIGE_DETALHE = "outro";

export type AcaoFila = "reordenar" | "mover_medico" | "prioridade";

export const ACAO_LABEL: Record<AcaoFila, string> = {
  reordenar:    "Reordenar a fila",
  mover_medico: "Mover de médico",
  prioridade:   "Alterar prioridade",
};

// "A chegar" é fixa: A_CONFIRMAR, CONFIRMADO, CHEGOU, ATENDIMENTO
const SIT_AGENDADOS = [
  SITUACAO.A_CONFIRMAR,
  SITUACAO.CONFIRMADO,
  SITUACAO.CHEGOU,
  SITUACAO.ATENDIMENTO,
];

const DEFAULT_SLUG = "ultrassom";

const EMPTY_STATE: AssistenteState = {
  medicos_selecionados: [],
  salas_extra:          [],
  paciente_sala_map:    {},
};

// ── Funções puras auxiliares ──────────────────────────────────────────────────

export function msToHHMM(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const BRT_OFFSET = 3 * 3_600_000; // NetRis envia em UTC, exibe em BRT (UTC-3)
  const brt = ms - BRT_OFFSET;
  if (brt < 0) return null;
  const h = Math.floor(brt / 3_600_000) % 24;
  const m = Math.floor((brt % 3_600_000) / 60_000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatMin(min: number): string {
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

function medicoEffOf(row: FarolRow, ov: FilaOverlay | undefined): string | null {
  const override = ov?.medico_override;
  const hasOverride = override !== undefined && override !== null;
  if (hasOverride) return (override!.trim() || null);
  return row.medico ? row.medico.trim() || null : null;
}

function priorityWeight(p: string): number {
  if (p === "normal") return 0;
  return 1;
}

// Todo caminho em que o arrasto não se aplica mais precisa dizer isso em voz
// alta. Sair calado depois de a pessoa ter escrito um motivo é indistinguível de
// ter salvado: o diálogo fecha igual, e ela sai acreditando que reordenou.
function avisarArrastoVencido() {
  toast.warning("A fila mudou e o movimento não vale mais.", {
    description: "Nada foi alterado. Confira a fila e refaça, se ainda for o caso.",
  });
}

// Falha de save da fila não pode morrer no logError: em produção o logger é
// no-op, então o card voltava sozinho pro lugar de origem sem nenhum aviso —
// era impossível distinguir "RLS negou" de "sessão Supabase expirou" de bug.
function avisarFalha(oQue: string, error: unknown) {
  logError(`[FilaAssistente] falha ao salvar ${oQue}:`, error);
  const msg = (error as { message?: string } | null | undefined)?.message;
  toast.error(`Não foi possível salvar ${oQue}.`, {
    description: msg
      ? `${msg} — recarregue a página e confirme se você continua logado.`
      : "Recarregue a página e confirme se você continua logado.",
  });
}

// Neurocardio junta várias modalidades numa página só: cada bloco de exame vê
// apenas os itens da sua modalidade, e o groupId ganha sufixo porque o
// draggableId precisa ser único dentro do DragDropContext.
function filtrarPorModalidade(lista: GroupedCard[], modalidadeId: number): GroupedCard[] {
  const out: GroupedCard[] = [];
  for (const g of lista) {
    const itens = g.itens.filter(i => i.raw.modalidade_id === modalidadeId);
    if (itens.length === 0) continue;
    out.push({ ...g, itens, groupId: `${g.groupId}::mod-${modalidadeId}` });
  }
  return out;
}

// Escopo de uma lista linear -> "linear" (fila única) ou "linear-neuro-<modId>".
const SCOPE_NEURO = /^linear-neuro-(\d+)$/;

// ── Escrita pendente ──────────────────────────────────────────────────────────
// Um GET de overlays que sai ANTES do upsert commitar volta com o valor antigo.
// Chegando depois do update otimista, ele desfaz o que a pessoa acabou de fazer:
// o card volta pro lugar de origem e só pula pra frente no reload seguinte — o
// pisca-pisca do drag. A correção não é serializar as leituras (elas vêm de
// realtime, de intervalo e de refresh manual, sem ordem garantida): é lembrar o
// que acabamos de gravar e reaplicar por cima de cada leitura até o banco
// concordar. Cada entrada morre quando converge, quando o save falha (aí o banco
// é a verdade) ou por validade, pra alteração de outro usuário não ficar
// mascarada pra sempre caso o valor nunca convirja.
const PENDENTE_TTL_MS = 10_000;

type Pendente = { campos: Partial<FilaOverlay>; expira: number };

const OVERLAY_VAZIO: Omit<FilaOverlay, "atendimento_id"> = {
  posicao:             null,
  medico_override:     null,
  prioridade:          "normal",
  observacoes:         null,
  dispensed_at:        null,
  transferred_by_name: null,
  transferred_at:      null,
};

function marcarPendente(
  mapa: Map<string, Pendente>,
  aid: string,
  campos: Partial<FilaOverlay>,
) {
  const atual = mapa.get(aid);
  mapa.set(aid, {
    campos: { ...(atual?.campos ?? {}), ...campos },
    expira: Date.now() + PENDENTE_TTL_MS,
  });
}

function descartarPendentes(mapa: Map<string, Pendente>, aids: Iterable<string>) {
  for (const aid of aids) mapa.delete(aid);
}

function aplicarPendentes(mapa: Map<string, Pendente>, lidos: Map<string, FilaOverlay>) {
  const agora = Date.now();
  for (const [aid, pendente] of mapa) {
    if (pendente.expira <= agora) { mapa.delete(aid); continue; }
    const row = lidos.get(aid);
    if (!row) {
      // Linha nova: o INSERT ainda não apareceu nesta leitura. Sem isso o card
      // perde a posição e salta pro fim da lista (posicao null ordena por último).
      lidos.set(aid, { atendimento_id: aid, ...OVERLAY_VAZIO, ...pendente.campos });
      continue;
    }
    const convergiu = Object.entries(pendente.campos)
      .every(([campo, valor]) => (row as unknown as Record<string, unknown>)[campo] === valor);
    if (convergiu) { mapa.delete(aid); continue; }
    lidos.set(aid, { ...row, ...pendente.campos });
  }
}

// ── Parâmetros do hook ────────────────────────────────────────────────────────

interface UseFilaAssistenteParams {
  slug:     string | undefined;
  user:     { id: string; tenant_id: string; full_name?: string | null } | null | undefined;
  role:     string | null | undefined;
  /** Não pode alterar a fila: assistente de sala, ou supervisor em preview. */
  readOnly: boolean;
  /**
   * Está olhando a tela de outra pessoa. Separado de `readOnly` porque escolher
   * quais médicos acompanhar é preferência própria, não edição da fila — juntar
   * as duas coisas foi o que fez a assistente parar de gravar a seleção dela e
   * deixou o painel "quem está vendo quem" permanentemente vazio.
   */
  isPreview: boolean;
  toast?:   (opts: { title: string; variant?: string }) => void;
}

/** Quem está com um médico aberto agora, para exibir na coluna dele. */
export interface ViewerDaFila {
  id:       string;
  nome:     string;
  medicos:  string[];
  souEu:    boolean;
}

/** Alteração aguardando motivo antes de ir para o banco. */
export interface AlteracaoPendente {
  acao:          AcaoFila;
  pacienteNome:  string;
  de:            Record<string, unknown>;
  para:          Record<string, unknown>;
  resumo:        string;
  /**
   * Ordem das listas afetadas no instante do arrasto.
   *
   * O `destination.index` do arrasto é um índice, e índice só quer dizer alguma
   * coisa junto com a lista que ele indexa. Entre o arrasto e a confirmação a
   * fila continua se mexendo por realtime — paciente chega, é dispensado, outra
   * assistente reordena. Aplicar o índice antigo sobre a lista nova põe o
   * paciente ao lado de outra pessoa, sem erro nenhum e com um registro dizendo
   * que foi intencional. Então comparamos: mudou a lista, a alteração é
   * recusada e a pessoa refaz vendo o estado atual.
   */
  assinatura:    string;
}

// ── Hook principal ────────────────────────────────────────────────────────────

export function useFilaAssistente({
  slug,
  user,
  role,
  readOnly,
  isPreview,
}: UseFilaAssistenteParams) {
  const tenantId   = user?.tenant_id ?? "";
  const myUserId   = user?.id ?? "";

  // Modalidade derivada do slug
  const mod = useMemo(
    () =>
      FILA_MODALIDADES.find(m => m.slug === slug)
      ?? FILA_MODALIDADES.find(m => m.slug === DEFAULT_SLUG)
      ?? FILA_MODALIDADES[0],
    [slug],
  );
  const modalidadeIds  = mod.modalidadeIds;
  const sitFila        = mod.situacaoIds;
  const modalidadeKey  = modalidadeIds[0]; // chave estável p/ fila_assistente_state
  const modalidadeLabel = mod.label;
  // Só Ultrassom tem kanban por médico
  const porMedico = mod.slug === "ultrassom";

  // ── Estado ──────────────────────────────────────────────────────────────────
  const [farolRows, setFarolRows]     = useState<FarolRow[]>([]);
  const [overlays, setOverlays]       = useState<Map<string, FilaOverlay>>(new Map());
  const [state, setState]             = useState<AssistenteState>(EMPTY_STATE);
  const [loading, setLoading]         = useState(true);
  const [savingState, setSavingState] = useState(false);
  const [now, setNow]                 = useState(() => new Date());
  const [clockTime, setClockTime]     = useState(() => new Date());
  const [assistenteList, setAssistenteList] = useState<ProfileLite[]>([]);
  const [viewers, setViewers]               = useState<ViewerDaFila[]>([]);
  const [alteracaoPendente, setAlteracaoPendente] = useState<AlteracaoPendente | null>(null);
  const [salvandoAlteracao, setSalvandoAlteracao] = useState(false);
  const [detalhesGroup, setDetalhesGroup]   = useState<GroupedCard | null>(null);
  const [editingGroup, setEditingGroup]     = useState<GroupedCard | null>(null);
  const [editPrioridade, setEditPrioridade] = useState<string>("normal");
  const [editObs, setEditObs]               = useState<string>("");
  const [savingEdit, setSavingEdit]         = useState(false);

  // targetUserId é definido externamente (isPreview ? previewUserId : myUserId)
  // mas o hook precisa saber qual user visualizar — passamos via parâmetro extra
  // ao chamar loadState. Internamente usamos myUserId para persistência.
  // O componente pode passar `targetUserId` para loadState se necessário;
  // aqui guardamos como prop extra para uso dentro do hook.
  // Para preservar a lógica original, o componente passará readOnly + targetUserId.
  // Adicionamos targetUserId como parâmetro opcional do hook.

  // atendimento_ids do farol de hoje — recorte usado pra buscar os overlays.
  const farolIdsRef = useRef<string[]>([]);

  // Escritas ainda não confirmadas por uma leitura (ver bloco "Escrita pendente").
  const pendentesRef = useRef<Map<string, Pendente>>(new Map());

  // O drag que está esperando o motivo. Guardado em ref, e não em state, porque
  // nada na tela depende dele até a confirmação — o card já voltou para a origem.
  const dragPendenteRef = useRef<DropResult | null>(null);

  const farolChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const filaChannelRef  = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const stateChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Timers ──────────────────────────────────────────────────────────────────
  //
  // O relógio para enquanto um diálogo de motivo está aberto. Não é detalhe de
  // exibição: a lista de "a chegar" esconde agendado cuja hora já passou, e esse
  // corte é reavaliado a cada minuto. Com o relógio andando, um agendado saindo
  // da janela mudava a lista sozinho e a confirmação era recusada com "a fila
  // mudou" sem que nada de relevante tivesse mudado — bastava demorar um minuto
  // escolhendo o motivo. Congelar também evita a lista se remexer sob o diálogo.
  const congelarRelogio = alteracaoPendente !== null || editingGroup !== null;
  useEffect(() => {
    if (congelarRelogio) return;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [congelarRelogio]);
  useEffect(() => {
    const t = setInterval(() => setClockTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Loaders ─────────────────────────────────────────────────────────────────
  // Só os overlays dos atendimentos que estão na tela hoje. Antes a query puxava
  // TODO o histórico do tenant (sem filtro de data e sem limite), o que expõe a
  // leitura ao teto de linhas do PostgREST — passando dele, as posições de hoje
  // simplesmente não voltavam e o drag "não persistia" sem erro nenhum.
  const fetchOverlays = useCallback(async (ids: string[]) => {
    if (!tenantId || ids.length === 0) { setOverlays(new Map()); return; }
    const CHUNK = 150; // mantém a URL do GET curta
    const m = new Map<string, FilaOverlay>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await (supabase as any)
        .from("fila_atendimento")
        .select("atendimento_id,posicao,medico_override,prioridade,observacoes,dispensed_at,transferred_by_name,transferred_at")
        .eq("tenant_id", tenantId)
        .in("atendimento_id", ids.slice(i, i + CHUNK));
      if (error) {
        logError("[FilaAssistente] falha ao carregar overlays:", error);
        toast.error("Não foi possível carregar a ordem/prioridades da fila.", {
          description: "A lista está sendo exibida na ordem do Farol.",
        });
        return;
      }
      for (const row of ((data as FilaOverlay[]) ?? [])) m.set(row.atendimento_id, row);
    }
    aplicarPendentes(pendentesRef.current, m);
    setOverlays(m);
  }, [tenantId]);

  const loadFarol = useCallback(async () => {
    if (!tenantId) return;
    const sits = Array.from(new Set([...sitFila, ...SIT_AGENDADOS]));
    const { data } = await (supabase as any)
      .from("farol_timestamps")
      .select("atendimento_id,nome_paciente,cpf,modalidade_id,exame,medico,sala,hora_inicial_ms,situacao_id,situacao_nome,primeira_vez,telefone,data_nascimento,convenio")
      .eq("data_ref", todayBRT())
      .in("modalidade_id", modalidadeIds as readonly number[])
      .in("situacao_id", sits)
      .is("dispensed_at", null);
    const rows = (data as FarolRow[]) ?? [];
    farolIdsRef.current = rows.map(r => r.atendimento_id);
    setFarolRows(rows);
    setLoading(false);
    // Encadeado: os overlays dependem dos ids do farol, então recarregar a lista
    // sem recarregar as posições deixaria a fila fora de ordem por um instante.
    await fetchOverlays(farolIdsRef.current);
  }, [tenantId, modalidadeIds.join(","), sitFila.join(","), fetchOverlays]);

  const loadOverlays = useCallback(async () => {
    await fetchOverlays(farolIdsRef.current);
  }, [fetchOverlays]);

  const loadState = useCallback(async (targetUserId: string) => {
    if (!tenantId || !targetUserId) return;
    const { data } = await (supabase as any)
      .from("fila_assistente_state")
      .select("medicos_selecionados,salas_extra,paciente_sala_map")
      .eq("tenant_id", tenantId)
      .eq("user_id", targetUserId)
      .eq("modalidade_id", modalidadeKey)
      .maybeSingle();
    if (data) {
      setState({
        medicos_selecionados: (data.medicos_selecionados as string[]) ?? [],
        salas_extra:          (data.salas_extra as SalaExtra[]) ?? [],
        paciente_sala_map:    (data.paciente_sala_map as Record<string, string>) ?? {},
      });
    } else {
      setState(EMPTY_STATE);
    }
  }, [tenantId, modalidadeKey]);

  // Quem está com a fila aberta hoje e em quais médicos.
  //
  // Antes isto só rodava para supervisor/admin/developer e abortava quando
  // `readOnly` — ou seja, nunca para a assistente, que é justamente quem a lista
  // rastreia. Agora roda para todo mundo. A RLS de `fila_assistente_state` é por
  // papel (admin, developer, supervisor e assistente_sala leem as linhas dos
  // outros), então quem está fora dessa lista recebe zero linhas e o painel
  // simplesmente não aparece — sem erro e sem tela quebrada.
  const loadAssistentes = useCallback(async () => {
    if (!tenantId) return;
    const startOfDayBRT = `${hojeBRT()}T03:00:00.000Z`; // 00:00 BRT = 03:00 UTC

    const { data: states } = await (supabase as any)
      .from("fila_assistente_state")
      .select("user_id, medicos_selecionados, updated_at")
      .eq("tenant_id", tenantId)
      .gte("updated_at", startOfDayBRT);

    // Uma linha por usuário: o estado é por modalidade, e quem trabalhou em duas
    // no mesmo dia aparecia duas vezes com listas diferentes de médicos.
    const porUsuario = new Map<string, Set<string>>();
    for (const s of (states as Array<{ user_id: string; medicos_selecionados: string[] }>) ?? []) {
      if (!(s.medicos_selecionados?.length)) continue;
      const atual = porUsuario.get(s.user_id) ?? new Set<string>();
      for (const m of s.medicos_selecionados) atual.add(m);
      porUsuario.set(s.user_id, atual);
    }

    if (porUsuario.size === 0) { setViewers([]); setAssistenteList([]); return; }

    const ids = [...porUsuario.keys()];
    const [{ data: profs }, { data: rolesRows }] = await Promise.all([
      (supabase as any).from("profiles").select("id, full_name, email").in("id", ids),
      (supabase as any).from("user_roles").select("user_id")
        .eq("tenant_id", tenantId).eq("role", "assistente_sala").in("user_id", ids),
    ]);

    const perfis = new Map(
      ((profs as ProfileLite[]) ?? []).map(p => [p.id, p] as const)
    );
    const assistenteIds = new Set(
      ((rolesRows as Array<{ user_id: string }> | null) ?? []).map(r => r.user_id)
    );

    setViewers(
      ids.map(id => {
        const p = perfis.get(id);
        return {
          id,
          nome:    p?.full_name || p?.email || id.slice(0, 8),
          medicos: [...(porUsuario.get(id) ?? [])].sort((a, b) => a.localeCompare(b, "pt-BR")),
          souEu:   id === myUserId,
        };
      }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    );

    // Os chips de preview do supervisor continuam listando só assistentes.
    setAssistenteList(
      ids.filter(id => assistenteIds.has(id))
         .map(id => perfis.get(id))
         .filter((p): p is ProfileLite => !!p),
    );
  }, [tenantId, myUserId]);

  // "Dr. Fulano → Davi, Maria". Chave é o nome do médico, do jeito que vem do
  // farol — a fila inteira identifica médico por string, não por id.
  const viewersPorMedico = useMemo(() => {
    const mapa = new Map<string, ViewerDaFila[]>();
    for (const v of viewers) {
      for (const medico of v.medicos) {
        const lista = mapa.get(medico) ?? [];
        lista.push(v);
        mapa.set(medico, lista);
      }
    }
    return mapa;
  }, [viewers]);

  // ── Efeito principal: subscriptions + carregamento inicial ──────────────────
  // O targetUserId é injetado via closure de fora; o componente chama o hook
  // com targetUserId como parâmetro e nós o expõem aqui via parâmetro extra.
  // Para manter a assinatura limpa do hook, o componente passa targetUserId
  // como parte dos params e o hook o guarda em ref para uso no closure.
  // NOTA: o useEffect abaixo precisa do targetUserId → recebemos via param
  // adicional registrado abaixo como `_targetUserId` e usado diretamente.

  // ── Persistência ────────────────────────────────────────────────────────────
  // Preferência de quem olha, não conteúdo da fila: quem é somente-leitura na
  // fila continua gravando a própria seleção. Só o preview não grava, porque ali
  // a tela é de outra pessoa e salvar sobrescreveria a escolha dela.
  const persistState = useCallback(async (next: AssistenteState) => {
    if (isPreview || !tenantId || !myUserId) return;
    setSavingState(true);
    try {
      const { error } = await (supabase as any)
        .from("fila_assistente_state")
        .upsert(
          {
            user_id:              myUserId,
            tenant_id:            tenantId,
            modalidade_id:        modalidadeKey,
            medicos_selecionados: next.medicos_selecionados,
            salas_extra:          next.salas_extra,
            paciente_sala_map:    next.paciente_sala_map,
          },
          { onConflict: "tenant_id,user_id,modalidade_id" }
        );
      if (error) avisarFalha("a seleção de médicos", error);
    } finally {
      setSavingState(false);
    }
  }, [isPreview, tenantId, myUserId, modalidadeKey]);

  const updateState = useCallback((mut: (s: AssistenteState) => AssistenteState) => {
    setState(prev => {
      const next = mut(prev);
      persistState(next);
      return next;
    });
  }, [persistState]);

  // ── Handlers de médicos ──────────────────────────────────────────────────────
  const toggleMedico = useCallback((medico: string) => {
    if (isPreview) return;
    updateState(s => {
      const has = s.medicos_selecionados.includes(medico);
      if (has) {
        const novasSalas = s.salas_extra.filter(x => x.medico !== medico);
        const idsRemovidos = new Set(
          s.salas_extra.filter(x => x.medico === medico).map(x => x.id)
        );
        const novoMap = Object.fromEntries(
          Object.entries(s.paciente_sala_map).filter(([, v]) => !idsRemovidos.has(v))
        );
        return {
          medicos_selecionados: s.medicos_selecionados.filter(m => m !== medico),
          salas_extra:          novasSalas,
          paciente_sala_map:    novoMap,
        };
      }
      return { ...s, medicos_selecionados: [...s.medicos_selecionados, medico] };
    });
  }, [isPreview, updateState]);

  const duplicarMedico = useCallback((medico: string) => {
    if (isPreview) return;
    updateState(s => {
      const existentes = s.salas_extra.filter(x => x.medico === medico).length;
      const n = existentes + 2;
      const novaSala: SalaExtra = {
        id:         `${medico}__${Date.now()}`,
        medico,
        sala_label: `Sala ${n}`,
      };
      return { ...s, salas_extra: [...s.salas_extra, novaSala] };
    });
  }, [isPreview, updateState]);

  const removerSala = useCallback((salaId: string) => {
    if (isPreview) return;
    updateState(s => ({
      ...s,
      salas_extra:       s.salas_extra.filter(x => x.id !== salaId),
      paciente_sala_map: Object.fromEntries(
        Object.entries(s.paciente_sala_map).filter(([, v]) => v !== salaId)
      ),
    }));
  }, [isPreview, updateState]);

  // ── useMemo: items ───────────────────────────────────────────────────────────
  const items = useMemo<CardItem[]>(() => {
    const list: CardItem[] = [];
    for (const r of farolRows) {
      const ov = overlays.get(r.atendimento_id);
      if (ov?.dispensed_at) continue;
      const medico = medicoEffOf(r, ov);
      list.push({
        atendimento_id: r.atendimento_id,
        nome:           r.nome_paciente,
        cpf:            r.cpf,
        exame:          r.exame,
        sala:           r.sala,
        horario:        msToHHMM(r.hora_inicial_ms),
        medico,
        medicoOriginal: r.medico,
        situacao_id:    r.situacao_id,
        situacao_nome:  r.situacao_nome,
        posicao:        ov?.posicao ?? null,
        prioridade:     ov?.prioridade ?? "normal",
        observacoes:    ov?.observacoes ?? null,
        hasOverride:    !!(ov && ov.medico_override !== null && ov.medico_override !== undefined),
        transferredAt:  ov?.transferred_at ?? null,
        transferredBy:  ov?.transferred_by_name ?? null,
        chegouEm:       new Date(r.primeira_vez),
        raw:            r,
      });
    }
    return list;
  }, [farolRows, overlays]);

  // ── useMemo: activeItems ─────────────────────────────────────────────────────
  const activeItems = useMemo<CardItem[]>(() => {
    const brtNow = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(now);
    const [bh, bm] = brtNow.split(":").map(Number);
    const nowMinBrt = bh * 60 + bm;

    return items.filter(c => {
      if (sitFila.includes(c.situacao_id)) return true;
      if (!SIT_AGENDADOS.includes(c.situacao_id)) return false;
      if (c.situacao_id === SITUACAO.CHEGOU || c.situacao_id === SITUACAO.ATENDIMENTO) return true;
      if (!c.horario) return true;
      const [hh, mm] = c.horario.split(":").map(Number);
      const horarioMin = hh * 60 + mm;
      return horarioMin >= nowMinBrt;
    });
  }, [items, now, sitFila.join(",")]);

  // ── useMemo: medicosDoDia ────────────────────────────────────────────────────
  const medicosDoDia = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const it of activeItems) {
      const m = it.medico?.trim();
      if (m) set.add(m);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [activeItems]);

  // ── groupItems (função pura, não precisa ser memo por si só) ─────────────────
  function groupItems(source: CardItem[], section: Section): GroupedCard[] {
    const map = new Map<string, GroupedCard>();
    for (const it of source) {
      const cpfKey = (it.cpf && it.cpf.trim()) || `nome::${it.nome.trim().toLowerCase()}`;
      const medKey = it.medico ?? "__sem_medico__";
      const groupId = `g::${section}::${medKey}::${cpfKey}`;
      const existing = map.get(groupId);
      if (existing) {
        existing.itens.push(it);
        if (priorityWeight(it.prioridade) > priorityWeight(existing.prioridadeMax)) {
          existing.prioridadeMax = it.prioridade;
        }
        if (it.posicao !== null && (existing.posicao === null || it.posicao < existing.posicao)) {
          existing.posicao = it.posicao;
        }
        if (it.horario && (!existing.horarioMin || it.horario < existing.horarioMin)) {
          existing.horarioMin = it.horario;
        }
        if (it.chegouEm < existing.chegouEmMin) existing.chegouEmMin = it.chegouEm;
        if (it.hasOverride) existing.hasAnyOverride = true;
      } else {
        map.set(groupId, {
          groupId,
          cpfKey,
          nome:       it.nome,
          medico:     it.medico,
          prioridadeMax: it.prioridade,
          posicao:    it.posicao,
          horarioMin: it.horario,
          chegouEmMin: it.chegouEm,
          hasAnyOverride: it.hasOverride,
          itens:      [it],
        });
      }
    }
    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (a.posicao !== null && b.posicao !== null) return a.posicao - b.posicao;
      if (a.posicao !== null) return -1;
      if (b.posicao !== null) return 1;
      if (a.horarioMin && b.horarioMin) return a.horarioMin.localeCompare(b.horarioMin);
      if (a.horarioMin) return -1;
      if (b.horarioMin) return 1;
      return a.chegouEmMin.getTime() - b.chegouEmMin.getTime();
    });
    return list;
  }

  // ── useMemo: groupsBySection ─────────────────────────────────────────────────
  const groupsBySection = useMemo(() => {
    const filaItems      = activeItems.filter(c => sitFila.includes(c.situacao_id));
    const agendadosItems = activeItems.filter(c => SIT_AGENDADOS.includes(c.situacao_id));
    return {
      fila:      groupItems(filaItems, "fila"),
      agendados: groupItems(agendadosItems, "agendados"),
    };
  }, [activeItems, sitFila.join(",")]);

  // ── useMemo: colunas ─────────────────────────────────────────────────────────
  const colunas = useMemo<Coluna[]>(() => {
    const ativosSet = new Set(medicosDoDia);
    const out: Coluna[] = [];
    for (const m of state.medicos_selecionados) {
      if (!ativosSet.has(m)) continue;
      out.push({ id: `main::${m}`, medico: m, label: m });
      for (const sx of state.salas_extra.filter(s => s.medico === m)) {
        out.push({ id: `extra::${sx.id}`, medico: m, salaId: sx.id, label: `${m} — ${sx.sala_label}` });
      }
    }
    return out;
  }, [state, medicosDoDia]);

  // ── groupsDaColuna (função auxiliar pura) ────────────────────────────────────
  function groupsDaColuna(col: Coluna, source: GroupedCard[]): GroupedCard[] {
    if (col.salaId) {
      const idsExtra = new Set(
        Object.entries(state.paciente_sala_map)
          .filter(([, v]) => v === col.salaId)
          .map(([k]) => k)
      );
      return source.filter(g => g.medico === col.medico && g.itens.every(i => idsExtra.has(i.atendimento_id)));
    }
    const idsExtraDoMedico = new Set(
      state.salas_extra.filter(s => s.medico === col.medico).map(s => s.id)
    );
    return source.filter(g => {
      if (g.medico !== col.medico) return false;
      const allMapped = g.itens.every(i => {
        const mapped = state.paciente_sala_map[i.atendimento_id];
        return mapped && idsExtraDoMedico.has(mapped);
      });
      return !allMapped;
    });
  }

  // ── listaDoEscopo ────────────────────────────────────────────────────────────
  // Lista exibida por um bloco linear. A fila única usa o escopo "linear" e vê a
  // seção inteira; o Neurocardio usa "linear-neuro-<modId>" e vê só a modalidade
  // daquele bloco. Render e onDragEnd PRECISAM usar esta mesma função — quando o
  // drag reordenava a lista cheia, o groupId do card (com sufixo ::mod-) não era
  // encontrado e o save nunca acontecia.
  const listaDoEscopo = useCallback((scope: string, section: Section): GroupedCard[] => {
    const base = section === "fila" ? groupsBySection.fila : groupsBySection.agendados;
    const m = SCOPE_NEURO.exec(scope);
    return m ? filtrarPorModalidade(base, Number(m[1])) : base;
  }, [groupsBySection]);

  // ── Registro das alterações ──────────────────────────────────────────────────
  // Grava depois da escrita da fila, nunca antes: registro de uma alteração que
  // não aconteceu é pior que registro nenhum. Se a gravação do log falhar, a
  // alteração fica de pé e a pessoa é avisada — desfazer a fila por causa do log
  // seria trocar um problema por outro maior.
  const registrarMovimentacao = useCallback(async (
    entradas: Array<{
      atendimento_id: string;
      paciente_nome:  string | null;
      acao:           AcaoFila;
      de:             Record<string, unknown>;
      para:           Record<string, unknown>;
    }>,
    motivo: string,
    motivoDetalhe: string | null,
  ) => {
    if (entradas.length === 0) return;
    const { error } = await (supabase as any).from("fila_movimentacoes").insert(
      entradas.map(e => ({
        tenant_id:      tenantId,
        atendimento_id: e.atendimento_id,
        user_id:        myUserId,
        user_nome:      user?.full_name ?? null,
        acao:           e.acao,
        motivo,
        motivo_detalhe: motivoDetalhe,
        paciente_nome:  e.paciente_nome,
        modalidade_id:  modalidadeKey,
        de:             e.de,
        para:           e.para,
      })),
    );
    if (error) {
      logError("[FilaAssistente] falha ao registrar movimentação:", error);
      toast.warning("A alteração foi salva, mas não entrou no registro.", {
        description: "Avise a supervisão — o histórico desta mexida ficou sem justificativa.",
      });
    }
  }, [tenantId, myUserId, user?.full_name, modalidadeKey]);

  // ── onDragEnd ────────────────────────────────────────────────────────────────
  // Duas etapas: `onDragEnd` só descreve o que a pessoa tentou fazer e abre o
  // diálogo de motivo; `aplicarDrag` é que escreve, e só é chamado na confirmação.
  // Nada de UI otimista antes disso — o card volta para a origem e fica lá até a
  // justificativa existir, que é a leitura honesta de "ainda não foi salvo".
  const aplicarDrag = useCallback(async (result: DropResult, motivo: string, motivoDetalhe: string | null) => {
    if (readOnly) return;
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // Path "linear" — fila sem kanban (inclui os blocos por exame do Neurocardio)
    if (source.droppableId.startsWith("linear")) {
      if (source.droppableId !== destination.droppableId) return;
      const [scopeLinear, sectionLinear] = source.droppableId.split("::SEC::") as [string, Section];
      const baseList = listaDoEscopo(scopeLinear, sectionLinear);
      const newList = [...baseList];
      const idxFrom = newList.findIndex(g => g.groupId === draggableId);
      if (idxFrom < 0) { avisarArrastoVencido(); return; }
      const [moved] = newList.splice(idxFrom, 1);
      newList.splice(destination.index, 0, moved);

      const novasPos = new Map<string, number>();
      let pos = 0;
      for (const g of newList) {
        for (const it of g.itens) {
          novasPos.set(it.atendimento_id, pos++);
        }
      }
      setOverlays(prev => {
        const m = new Map(prev);
        for (const [aid, p] of novasPos) {
          const existing = m.get(aid) ?? {
            atendimento_id:      aid,
            posicao:             null,
            medico_override:     null,
            prioridade:          "normal",
            observacoes:         null,
            dispensed_at:        null,
            transferred_by_name: null,
            transferred_at:      null,
          };
          m.set(aid, { ...existing, posicao: p });
        }
        return m;
      });

      const payloads = Array.from(novasPos.entries()).map(([aid, p]) => {
        const existing = overlays.get(aid);
        return {
          tenant_id:      tenantId,
          atendimento_id: aid,
          posicao:        p,
          prioridade:     existing?.prioridade ?? "normal",
          observacoes:    existing?.observacoes ?? null,
        };
      });
      if (payloads.length > 0) {
        for (const p of payloads) marcarPendente(pendentesRef.current, p.atendimento_id, { posicao: p.posicao });
        const { error } = await (supabase as any)
          .from("fila_atendimento")
          .upsert(payloads, { onConflict: "tenant_id,atendimento_id" });
        if (error) {
          descartarPendentes(pendentesRef.current, payloads.map(p => p.atendimento_id));
          avisarFalha("a nova ordem da fila", error);
          await fetchOverlays(farolIdsRef.current); // volta pro estado real do banco
          return;
        }
        // Registra só o card arrastado: as outras posições mudaram por
        // consequência, e listar todas afogaria o histórico do dia.
        await registrarMovimentacao(
          moved.itens.map(it => ({
            atendimento_id: it.atendimento_id,
            paciente_nome:  moved.nome,
            acao:           "reordenar" as const,
            // `ordem`, e nao `posicao`: estes sao ordinais de card na lista,
            // enquanto a coluna `posicao` do banco conta atendimento a atendimento.
            // Paciente com dois exames desalinha os dois numeros.
            de:             { ordem: idxFrom + 1, secao: sectionLinear },
            para:           { ordem: destination.index + 1, secao: sectionLinear },
          })),
          motivo, motivoDetalhe,
        );
      }
      return;
    }

    const [srcColId, srcSection] = source.droppableId.split("::SEC::");
    const [dstColId, dstSection] = destination.droppableId.split("::SEC::");
    if (srcSection !== dstSection) return;

    const colSrc = colunas.find(c => c.id === srcColId);
    const colDst = colunas.find(c => c.id === dstColId);
    if (!colSrc || !colDst) { avisarArrastoVencido(); return; }

    const section = srcSection as Section;
    const sourceList = section === "fila" ? groupsBySection.fila : groupsBySection.agendados;

    const groupMoved = sourceList.find(g => g.groupId === draggableId);
    if (!groupMoved) { avisarArrastoVencido(); return; }
    const atendimentoIds = groupMoved.itens.map(i => i.atendimento_id);

    // 1) Reconstrói grupos da seção pra recalcular posicao
    const grupos = new Map<string, GroupedCard[]>();
    for (const col of colunas) grupos.set(col.id, groupsDaColuna(col, sourceList));

    const srcList = grupos.get(srcColId) ?? [];
    const idx = srcList.findIndex(g => g.groupId === draggableId);
    if (idx < 0) { avisarArrastoVencido(); return; }

    // 2) paciente_sala_map — depois das validações de propósito: quando isto
    // rodava antes, um retorno mais abaixo deixava o paciente trocado de sala
    // sem que a fila mudasse nem o registro existisse.
    if (colSrc.salaId !== colDst.salaId) {
      updateState(s => {
        const map = { ...s.paciente_sala_map };
        for (const id of atendimentoIds) {
          if (colDst.salaId) map[id] = colDst.salaId;
          else               delete map[id];
        }
        return { ...s, paciente_sala_map: map };
      });
    }

    const [grupoMovido] = srcList.splice(idx, 1);
    grupos.set(srcColId, srcList);

    const dstList = grupos.get(dstColId) ?? [];
    const grupoAtualizado = { ...grupoMovido, medico: colDst.medico };
    dstList.splice(destination.index, 0, grupoAtualizado);
    grupos.set(dstColId, dstList);

    // 3) Override e auditoria
    let newOverride: string | null = null;
    let transferredByName: string | null = null;
    let transferredAt: string | null = null;
    if (colSrc.medico !== colDst.medico) {
      transferredByName = user?.full_name ?? null;
      transferredAt     = new Date().toISOString();
      newOverride = colDst.medico;
    }

    // 4) Optimistic UI
    setOverlays(prev => {
      const m = new Map(prev);
      for (const col of colunas) {
        const list = grupos.get(col.id) ?? [];
        let pos = 0;
        for (const g of list) {
          for (const it of g.itens) {
            const existing = m.get(it.atendimento_id) ?? {
              atendimento_id:      it.atendimento_id,
              posicao:             null,
              medico_override:     null,
              prioridade:          it.prioridade,
              observacoes:         it.observacoes,
              dispensed_at:        null,
              transferred_by_name: null,
              transferred_at:      null,
            };
            const isMoved = atendimentoIds.includes(it.atendimento_id);
            const original = (it.medicoOriginal ?? "").trim();
            const overrideEff = isMoved && colSrc.medico !== colDst.medico
              ? (newOverride === original ? null : newOverride)
              : existing.medico_override;
            m.set(it.atendimento_id, {
              ...existing,
              posicao: pos,
              medico_override:     overrideEff,
              ...(isMoved && colSrc.medico !== colDst.medico ? {
                transferred_by_name: transferredByName,
                transferred_at:      transferredAt,
              } : {}),
            });
            pos++;
          }
        }
      }
      return m;
    });

    // 5) Persiste em batch
    //
    // ATENÇÃO: todos os objetos do lote precisam ter EXATAMENTE as mesmas chaves.
    // O PostgREST monta o INSERT a partir das chaves do primeiro objeto e recusa
    // o lote inteiro ("All object keys must match") quando um deles difere — era
    // o que acontecia ao transferir paciente entre médicos: só as linhas movidas
    // levavam medico_override/transferred_*, então NADA era salvo, nem as
    // posições. Por isso os campos de transferência vão sempre, repetindo o
    // valor já persistido para quem não se moveu.
    const trocouMedico = colSrc.medico !== colDst.medico;
    const payloads: any[] = [];
    for (const col of colunas) {
      const list = grupos.get(col.id) ?? [];
      let pos = 0;
      for (const g of list) {
        for (const it of g.itens) {
          const ov = overlays.get(it.atendimento_id);
          const isMoved = atendimentoIds.includes(it.atendimento_id);
          const original = (it.medicoOriginal ?? "").trim();
          const foiTransferido = isMoved && trocouMedico;
          const overrideEff = foiTransferido
            ? (newOverride === original ? null : newOverride)
            : (ov?.medico_override ?? null);
          payloads.push({
            tenant_id:      tenantId,
            atendimento_id: it.atendimento_id,
            posicao:        pos,
            prioridade:     it.prioridade,
            observacoes:    it.observacoes,
            medico_override: overrideEff,
            // Voltar o paciente pro médico original limpa a auditoria junto com
            // o override — o selo "Transferido" lê exatamente esse par.
            transferred_by_name: foiTransferido
              ? (overrideEff === null ? null : transferredByName)
              : (ov?.transferred_by_name ?? null),
            transferred_at: foiTransferido
              ? (overrideEff === null ? null : transferredAt)
              : (ov?.transferred_at ?? null),
          });
          pos++;
        }
      }
    }
    if (payloads.length > 0) {
      for (const p of payloads) {
        marcarPendente(pendentesRef.current, p.atendimento_id, {
          posicao:             p.posicao,
          medico_override:     p.medico_override,
          transferred_by_name: p.transferred_by_name,
          transferred_at:      p.transferred_at,
        });
      }
      const { error } = await (supabase as any)
        .from("fila_atendimento")
        .upsert(payloads, { onConflict: "tenant_id,atendimento_id" });
      if (error) {
        descartarPendentes(pendentesRef.current, payloads.map(p => p.atendimento_id));
        avisarFalha("a fila", error);
        await fetchOverlays(farolIdsRef.current);
        return;
      }
      await registrarMovimentacao(
        atendimentoIds.map(aid => ({
          atendimento_id: aid,
          paciente_nome:  groupMoved.nome,
          acao:           trocouMedico ? ("mover_medico" as const) : ("reordenar" as const),
          de:             { medico: colSrc.medico, sala: colSrc.label, ordem: idx + 1, secao: section },
          para:           { medico: colDst.medico, sala: colDst.label, ordem: destination.index + 1, secao: section },
        })),
        motivo, motivoDetalhe,
      );
    }
  }, [readOnly, colunas, groupsBySection, listaDoEscopo, groupsDaColuna, tenantId, user?.full_name, updateState, overlays, fetchOverlays, registrarMovimentacao]);

  // Descreve o que o arrasto faria, para o diálogo mostrar antes de pedir o
  // motivo. Devolve null quando o drop não muda nada — aí não há o que justificar.
  const descreverDrag = useCallback((result: DropResult): AlteracaoPendente | null => {
    const { source, destination, draggableId } = result;
    if (!destination) return null;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return null;

    if (source.droppableId.startsWith("linear")) {
      if (source.droppableId !== destination.droppableId) return null;
      const [scopeLinear, sectionLinear] = source.droppableId.split("::SEC::") as [string, Section];
      const lista = listaDoEscopo(scopeLinear, sectionLinear);
      const de = lista.findIndex(x => x.groupId === draggableId);
      if (de < 0) return null;
      const g = lista[de];
      const para = destination.index + 1;
      return {
        acao: "reordenar",
        pacienteNome: g.nome,
        de: { ordem: de + 1 },
        para: { ordem: para },
        resumo: `${g.nome} sai da ${de + 1}ª para a ${para}ª posição.`,
        assinatura: lista.map(x => x.groupId).join("|"),
      };
    }

    const [srcColId, srcSection] = source.droppableId.split("::SEC::");
    const [dstColId, dstSection] = destination.droppableId.split("::SEC::");
    if (srcSection !== dstSection) return null;
    const colSrc = colunas.find(c => c.id === srcColId);
    const colDst = colunas.find(c => c.id === dstColId);
    if (!colSrc || !colDst) return null;
    const sourceList = srcSection === "fila" ? groupsBySection.fila : groupsBySection.agendados;
    const g = sourceList.find(x => x.groupId === draggableId);
    if (!g) return null;

    const trocouMedico = colSrc.medico !== colDst.medico;
    // Só as duas colunas envolvidas: exigir a fila inteira parada recusaria a
    // alteração por causa de um paciente de outro médico, que não a afeta.
    const assinatura = [colSrc, colDst]
      .map(c => `${c.id}:${groupsDaColuna(c, sourceList).map(x => x.groupId).join(",")}`)
      .join("|");
    return {
      acao: trocouMedico ? "mover_medico" : "reordenar",
      pacienteNome: g.nome,
      de:   { medico: colSrc.medico, sala: colSrc.label },
      para: { medico: colDst.medico, sala: colDst.label },
      resumo: trocouMedico
        ? `${g.nome} passa de ${colSrc.label} para ${colDst.label}.`
        : `${g.nome} muda de posição em ${colDst.label}.`,
      assinatura,
    };
  }, [colunas, groupsBySection, listaDoEscopo, groupsDaColuna]);

  const onDragEnd = useCallback((result: DropResult) => {
    if (readOnly) return;
    const descricao = descreverDrag(result);
    if (!descricao) return;
    dragPendenteRef.current = result;
    setAlteracaoPendente(descricao);
  }, [readOnly, descreverDrag]);

  const cancelarAlteracao = useCallback(() => {
    dragPendenteRef.current = null;
    setAlteracaoPendente(null);
  }, []);

  // ── Handlers de edição ───────────────────────────────────────────────────────
  function startEdit(g: GroupedCard) {
    if (readOnly) return;
    setEditingGroup(g);
    setEditPrioridade(g.prioridadeMax);
    const obs = g.itens.find(i => i.observacoes)?.observacoes ?? "";
    setEditObs(obs);
  }

  async function saveEdit(motivo: string, motivoDetalhe: string | null) {
    if (!editingGroup || readOnly) return;
    setSavingEdit(true);
    try {
      const atendimentoIds = editingGroup.itens.map(i => i.atendimento_id);
      const prioridadeAntes = editingGroup.prioridadeMax;
      const obsAntes = editingGroup.itens.find(i => i.observacoes)?.observacoes ?? null;
      const payloads = atendimentoIds.map(aid => {
        const existing = overlays.get(aid);
        return {
          tenant_id:      tenantId,
          atendimento_id: aid,
          posicao:        existing?.posicao ?? null,
          prioridade:     editPrioridade,
          observacoes:    editObs.trim() ? editObs.trim() : null,
        };
      });
      // Optimistic
      setOverlays(prev => {
        const m = new Map(prev);
        for (const p of payloads) {
          const existing = m.get(p.atendimento_id) ?? {
            atendimento_id:      p.atendimento_id,
            posicao:             null,
            medico_override:     null,
            prioridade:          "normal",
            observacoes:         null,
            dispensed_at:        null,
            transferred_by_name: null,
            transferred_at:      null,
          };
          m.set(p.atendimento_id, { ...existing, prioridade: p.prioridade, observacoes: p.observacoes });
        }
        return m;
      });
      for (const p of payloads) {
        marcarPendente(pendentesRef.current, p.atendimento_id, {
          prioridade:  p.prioridade,
          observacoes: p.observacoes,
        });
      }
      const { error } = await (supabase as any)
        .from("fila_atendimento")
        .upsert(payloads, { onConflict: "tenant_id,atendimento_id" });
      if (error) {
        descartarPendentes(pendentesRef.current, payloads.map(p => p.atendimento_id));
        avisarFalha("a prioridade/observações", error);
        await fetchOverlays(farolIdsRef.current);
        return;
      }
      const obsDepois = editObs.trim() ? editObs.trim() : null;
      if (prioridadeAntes !== editPrioridade || obsAntes !== obsDepois) {
        await registrarMovimentacao(
          atendimentoIds.map(aid => ({
            atendimento_id: aid,
            paciente_nome:  editingGroup.nome,
            acao:           "prioridade" as const,
            de:             { prioridade: prioridadeAntes, observacoes: obsAntes },
            para:           { prioridade: editPrioridade, observacoes: obsDepois },
          })),
          motivo, motivoDetalhe,
        );
      }
      setEditingGroup(null);
    } finally {
      setSavingEdit(false);
    }
  }

  // Confirmação do diálogo do arrasto. A edição de prioridade tem caminho
  // próprio (`saveEdit`), porque o diálogo dela já estava aberto e os campos de
  // motivo foram embutidos lá em vez de empilhar um segundo por cima.
  const confirmarAlteracao = useCallback(async (motivo: string, motivoDetalhe: string | null) => {
    const drag = dragPendenteRef.current;
    const pedido = alteracaoPendente;
    if (!drag || !pedido) return;

    // A fila pode ter andado enquanto a pessoa escolhia o motivo. Se as listas
    // envolvidas não são mais as mesmas, o índice do arrasto aponta para outro
    // lugar: recusar e pedir para refazer é o único desfecho honesto — aplicar
    // mexeria no paciente errado, e com um registro afirmando que foi de propósito.
    const agora = descreverDrag(drag);
    if (!agora || agora.assinatura !== pedido.assinatura) {
      toast.warning("A fila mudou enquanto você escolhia o motivo.", {
        description: "Nada foi alterado. Confira a fila e refaça o movimento.",
      });
      dragPendenteRef.current = null;
      setAlteracaoPendente(null);
      return;
    }

    setSalvandoAlteracao(true);
    try {
      await aplicarDrag(drag, motivo, motivoDetalhe);
    } finally {
      setSalvandoAlteracao(false);
      dragPendenteRef.current = null;
      setAlteracaoPendente(null);
    }
  }, [aplicarDrag, alteracaoPendente, descreverDrag]);

  // ── refresh ──────────────────────────────────────────────────────────────────
  const refresh = useCallback((targetUserId: string) => {
    supabase.functions.invoke("poll-farol-timestamps", { body: {} }).catch(() => {});
    loadFarol(); // já encadeia os overlays — chamar loadOverlays aqui usaria os ids antigos
    loadState(targetUserId);
  }, [loadFarol, loadState]);

  // ── toPacienteAtendimentos ───────────────────────────────────────────────────
  function toPacienteAtendimentos(g: GroupedCard): PacienteAtendimento[] {
    return g.itens.map(it => ({
      atendimento_id:      it.atendimento_id,
      nome_paciente:       it.nome,
      cpf:                 it.cpf,
      modalidade_id:       it.raw.modalidade_id,
      exame:               it.exame,
      medico:              it.medico,
      medico_original:     it.medicoOriginal,
      sala:                it.sala,
      hora_inicial_ms:     it.raw.hora_inicial_ms,
      situacao_id:         it.situacao_id,
      situacao_nome:       it.situacao_nome,
      primeira_vez:        it.raw.primeira_vez,
      telefone:            it.raw.telefone ?? null,
      data_nascimento:     it.raw.data_nascimento ?? null,
      convenio:            it.raw.convenio ?? null,
      observacoes:         it.observacoes,
      prioridade:          it.prioridade,
      transferred_by_name: it.transferredBy,
      transferred_at:      it.transferredAt,
      hasOverride:         it.hasOverride,
    }));
  }

  // ── Retorno do hook ──────────────────────────────────────────────────────────
  return {
    // Meta da modalidade
    mod,
    modalidadeLabel,
    porMedico,
    sitFila,

    // Estado
    farolRows,
    overlays,
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
    items,
    activeItems,
    medicosDoDia,
    groupsBySection,
    colunas,

    // Funções de carregamento (expostas para uso externo, ex.: realtime)
    loadFarol,
    loadOverlays,
    loadState,
    loadAssistentes,

    // Refs dos canais (gerenciados internamente mas expostos para o useEffect do componente)
    farolChannelRef,
    filaChannelRef,
    stateChannelRef,

    // Handlers
    persistState,
    updateState,
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
  } as const;
}
