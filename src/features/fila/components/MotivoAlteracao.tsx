import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import {
  MOTIVO_OPTIONS, MOTIVO_EXIGE_DETALHE, ACAO_LABEL,
  type AlteracaoPendente,
} from "../hooks/useFilaAssistente";

/** Motivo válido = escolhido, e com detalhe preenchido quando é "outro". */
export function motivoCompleto(motivo: string, detalhe: string): boolean {
  if (!motivo) return false;
  if (motivo === MOTIVO_EXIGE_DETALHE) return detalhe.trim().length >= 3;
  return true;
}

interface CamposProps {
  motivo:     string;
  setMotivo:  (v: string) => void;
  detalhe:    string;
  setDetalhe: (v: string) => void;
  disabled?:  boolean;
}

/**
 * Os campos de motivo, sem diálogo em volta. Existe separado porque a edição de
 * prioridade já tem diálogo próprio e empilhar um segundo por cima seria pior
 * que embutir os campos no que já está aberto.
 */
export function CamposDeMotivo({ motivo, setMotivo, detalhe, setDetalhe, disabled }: CamposProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="console-label !text-foreground/80 mb-2 block">
          Motivo da alteração <span className="text-destructive-strong">*</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(MOTIVO_OPTIONS).map(([key, opt]) => {
            const active = motivo === key;
            return (
              <button
                key={key}
                type="button"
                title={opt.descricao}
                disabled={disabled}
                onClick={() => setMotivo(key)}
                aria-pressed={active}
                className={`inline-flex items-center h-7 px-2.5 rounded-sm border text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:border-primary/50 hover:text-primary"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {motivo && (
          <p className="text-[11px] text-muted-foreground mt-1.5">
            {MOTIVO_OPTIONS[motivo]?.descricao}
          </p>
        )}
      </div>

      {motivo === MOTIVO_EXIGE_DETALHE && (
        <div>
          <label className="console-label !text-foreground/80 mb-2 block">
            Descreva o motivo <span className="text-destructive-strong">*</span>
          </label>
          <textarea
            value={detalhe}
            onChange={(e) => setDetalhe(e.target.value)}
            disabled={disabled}
            rows={2}
            placeholder="Em uma frase, o que motivou esta alteração"
            className="w-full rounded-sm border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
}

interface DialogProps {
  alteracao:  AlteracaoPendente | null;
  salvando:   boolean;
  motivo:     string;
  setMotivo:  (v: string) => void;
  detalhe:    string;
  setDetalhe: (v: string) => void;
  onConfirmar: () => void;
  onCancelar:  () => void;
}

/**
 * Diálogo do arrasto. O card já voltou para a origem quando isto abre: a
 * alteração só existe depois da confirmação, e cancelar não precisa desfazer
 * nada porque nada foi escrito.
 */
export function DialogMotivoAlteracao({
  alteracao, salvando, motivo, setMotivo, detalhe, setDetalhe, onConfirmar, onCancelar,
}: DialogProps) {
  const pronto = motivoCompleto(motivo, detalhe);

  return (
    <Dialog open={!!alteracao} onOpenChange={(o) => { if (!o && !salvando) onCancelar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{alteracao ? ACAO_LABEL[alteracao.acao] : "Alterar a fila"}</DialogTitle>
          <DialogDescription>
            A alteração só é aplicada depois do motivo, e fica registrada com seu nome e horário.
          </DialogDescription>
        </DialogHeader>

        {alteracao && (
          <div className="rounded-sm border border-border border-l-[3px] border-l-primary bg-muted/40 px-3 py-2.5 text-sm text-foreground flex items-start gap-2">
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <span>{alteracao.resumo}</span>
          </div>
        )}

        <div className="py-1">
          <CamposDeMotivo
            motivo={motivo} setMotivo={setMotivo}
            detalhe={detalhe} setDetalhe={setDetalhe}
            disabled={salvando}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar} disabled={!pronto || salvando}>
            {salvando ? "Salvando…" : "Confirmar alteração"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
