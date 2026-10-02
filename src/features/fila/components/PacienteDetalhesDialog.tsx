import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { differenceInYears, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { classePrioridade } from "../lib/prioridade";
import {
  User, Phone, CalendarDays, Stethoscope, FileText, Clock, ArrowRightLeft, CreditCard, ListChecks,
} from "lucide-react";

// Forma do row em farol_timestamps + campos extras (nullable se a edge function
// ainda não foi redeployada). O componente lida com ausência das colunas novas.
export interface PacienteAtendimento {
  atendimento_id:  string;
  nome_paciente:   string;
  cpf:             string | null;
  modalidade_id:   number;
  exame:           string | null;
  medico:          string | null;          // efetivo (override aplicado)
  medico_original: string | null;          // do farol_timestamps.medico (NetRis)
  sala:            string | null;
  hora_inicial_ms: number | null;          // ms desde meia-noite (horário agendado)
  situacao_id:     number;
  situacao_nome:   string | null;
  primeira_vez:    string;                 // ISO timestamp — entrada na fila
  telefone?:       string | null;
  data_nascimento?: string | null;         // YYYY-MM-DD
  convenio?:       string | null;
  observacoes?:    string | null;
  prioridade?:     string;
  transferred_by_name?: string | null;
  transferred_at?: string | null;
  hasOverride?:    boolean;
}

interface HistoricoRow {
  atendimento_id:      string;
  primeira_vez:        string;
  ultima_vez:          string;
  situacao_id_final:   number;
  situacao_nome_final: string | null;
}

interface Props {
  open:        boolean;
  onClose:     () => void;
  atendimentos: PacienteAtendimento[]; // 1+ atendimentos do mesmo paciente
}

const PRIO_LABEL: Record<string, string> = {
  normal:   "Normal",
  idoso:    "Idoso",
  pcd:      "PCD",
  gestante: "Gestante",
  autista:  "Autista",
  crianca:  "Prioritário",
};

function maskCpf(cpf: string | null): string {
  if (!cpf) return "—";
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function maskPhone(phone?: string | null): string {
  if (!phone) return "—";
  const d = phone.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

function calcIdade(dataNascimento?: string | null): number | null {
  if (!dataNascimento) return null;
  try {
    return differenceInYears(new Date(), parseISO(dataNascimento));
  } catch { return null; }
}

function formatHoraMs(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const BRT_OFFSET = 3 * 3_600_000; // NetRis envia em UTC, exibe em BRT (UTC-3)
  const brt = ms - BRT_OFFSET;
  if (brt < 0) return "—";
  const h = Math.floor(brt / 3_600_000) % 24;
  const m = Math.floor((brt % 3_600_000) / 60_000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function PacienteDetalhesDialog({ open, onClose, atendimentos }: Props) {
  const [historico, setHistorico] = useState<Map<string, HistoricoRow>>(new Map());

  useEffect(() => {
    if (!open || atendimentos.length === 0) return;
    const ids = atendimentos.map(a => a.atendimento_id);
    (async () => {
      const { data } = await (supabase as any)
        .from("farol_historico")
        .select("atendimento_id,primeira_vez,ultima_vez,situacao_id_final,situacao_nome_final")
        .in("atendimento_id", ids);
      const m = new Map<string, HistoricoRow>();
      for (const row of ((data as HistoricoRow[]) ?? [])) m.set(row.atendimento_id, row);
      setHistorico(m);
    })();
  }, [open, atendimentos]);

  if (atendimentos.length === 0) return null;
  const principal = atendimentos[0]; // dados do paciente são iguais em todos
  const idade = calcIdade(principal.data_nascimento);
  const algumaPrio = atendimentos.find(a => a.prioridade && a.prioridade !== "normal");

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-muted-foreground" />
            <span className="text-lg">{principal.nome_paciente}</span>
            {algumaPrio && (
              <Badge className={`ml-1 rounded-sm prio-chip uppercase tracking-wider text-[10px] ${classePrioridade(algumaPrio.prioridade)}`}>
                {PRIO_LABEL[algumaPrio.prioridade ?? "normal"]}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* ── Dados do paciente ──────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-3 text-sm">
          <Field icon={<User className="h-3.5 w-3.5" />} label="CPF" value={maskCpf(principal.cpf)} />
          <Field icon={<CalendarDays className="h-3.5 w-3.5" />} label="Idade"
                 value={idade !== null ? `${idade} anos` : "—"} />
          <Field icon={<Phone className="h-3.5 w-3.5" />} label="Telefone" value={maskPhone(principal.telefone)} />
          <Field icon={<CreditCard className="h-3.5 w-3.5" />} label="Convênio / pagamento" value={principal.convenio || "—"} />
        </section>

        {/* ── Lista de exames do dia ─────────────────────────────────────── */}
        <section className="mt-4">
          <h3 className="console-label flex items-center gap-1.5 mb-2">
            <ListChecks className="h-3.5 w-3.5" />
            {atendimentos.length === 1 ? "Exame" : `Exames (${atendimentos.length})`}
          </h3>
          <div className="space-y-2">
            {atendimentos.map(a => {
              const hist = historico.get(a.atendimento_id);
              return (
                <div key={a.atendimento_id} className="panel p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-semibold text-foreground">{a.exame || "—"}</p>
                    <span className="font-mono text-sm font-bold text-foreground shrink-0">
                      {formatHoraMs(a.hora_inicial_ms)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Stethoscope className="h-3 w-3 text-muted-foreground" />
                      Médico atual: <strong className="text-foreground">{a.medico || "—"}</strong>
                    </div>
                    {a.medico_original && a.medico_original !== a.medico && (
                      <div className="flex items-center gap-1.5">
                        <ArrowRightLeft className="h-3 w-3 text-primary" />
                        Originalmente: <span className="text-primary">{a.medico_original}</span>
                      </div>
                    )}
                    <div>Sala (NetRis): <strong className="text-foreground">{a.sala || "—"}</strong></div>
                    <div>Situação: <strong className="text-foreground">{a.situacao_nome || a.situacao_id}</strong></div>
                  </div>

                  {/* Timeline disponível: primeira_vez / ultima_vez */}
                  <div className="mt-2 pt-2 border-t border-border grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      Entrada na fila:{" "}
                      <strong className="font-mono text-foreground">
                        {format(parseISO(a.primeira_vez), "HH:mm:ss", { locale: ptBR })}
                      </strong>
                    </div>
                    {hist?.ultima_vez && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        Última atualização:{" "}
                        <strong className="font-mono text-foreground">
                          {format(parseISO(hist.ultima_vez), "HH:mm:ss", { locale: ptBR })}
                        </strong>
                      </div>
                    )}
                  </div>

                  {a.observacoes && (
                    <div className="mt-2 text-xs border-l-2 border-warning bg-warning/10 text-foreground px-2 py-1">
                      <FileText className="h-3 w-3 inline mr-1" />
                      {a.observacoes}
                    </div>
                  )}

                  {a.hasOverride && a.transferred_by_name && a.transferred_at && (
                    <div className="mt-2 text-[11px] text-primary flex items-center gap-1">
                      <ArrowRightLeft className="h-3 w-3" />
                      Transferido por <strong>{a.transferred_by_name}</strong> às{" "}
                      {format(parseISO(a.transferred_at), "HH:mm", { locale: ptBR })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {(principal.telefone == null && principal.data_nascimento == null && principal.convenio == null) && (
          <p className="mt-3 text-xs text-warning-strong bg-warning/10 border border-warning/40 rounded-sm px-2 py-1.5">
            Telefone, idade e convênio só ficam disponíveis após o redeploy da edge function
            <code className="mx-1 px-1 bg-card rounded border">poll-farol-timestamps</code>.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-muted/40 rounded-sm px-3 py-2">
      <span className="console-label flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}
