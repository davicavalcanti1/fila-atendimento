import { differenceInMinutes, format } from "date-fns";
import { cn } from "@/lib/utils";
import { type ViewerDaFila } from "../hooks/useFilaAssistente";

/**
 * Divisão de médicos do dia — quem ficou com quem.
 *
 * Portado do controleoperacional (Caio, 10–11/09/2026), com uma coisa a mais:
 * a presença real.
 *
 * 🚨 Continua NÃO se chamando "Acompanhando agora". O painel mostra a ESCOLHA
 * do dia, gravada quando alguém clica num médico, e ela vale mesmo com a pessoa
 * fora da tela. Em 10/09 uma assistente apareceu como "acompanhando agora" sete
 * horas depois de ir embora. O horário da escolha fica, e agora o LED verde diz
 * separadamente quem está com a fila aberta neste momento — duas informações
 * que antes eram confundidas numa só.
 *
 * Só aparece para a coordenação (admin, developer, supervisor). A tranca é a
 * RLS de `fila_assistente_state`; a página só evita renderizar o que o banco já
 * não manda.
 */

/** Escolha velha e pessoa fora da tela: continua valendo, mas sem peso visual. */
const MINUTOS_ATE_ESMAECER = 120;

function ha(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export function DivisaoMedicosHoje({ viewers, now }: { viewers: ViewerDaFila[]; now: Date }) {
  if (viewers.length === 0) return null;
  const onlineAgora = viewers.filter(v => v.online).length;

  return (
    <section className="panel px-4 py-2.5">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="console-label !text-foreground/80">Divisão de médicos — hoje</span>
        <span className="font-mono text-[11px] font-bold text-muted-foreground">{viewers.length}</span>
        <span className="console-label ml-auto">
          {onlineAgora} online · horário = quando escolheu
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {viewers.map(v => {
          const minutos = differenceInMinutes(now, v.marcadoEm);
          const apagado = !v.online && minutos >= MINUTOS_ATE_ESMAECER;
          return (
            <li key={v.id} className={cn("flex items-baseline gap-2 text-xs min-w-0", apagado && "opacity-50")}>
              <span
                className={cn("lamp h-1.5 w-1.5 shrink-0 self-center", v.online ? "lamp-ok" : "")}
                title={v.online ? "Com a fila aberta agora" : "Fora da fila agora"}
              />
              <span className={cn("shrink-0 font-semibold", v.souEu ? "text-primary" : "text-foreground")}>
                {v.souEu ? `${v.nome} (você)` : v.nome}
              </span>
              <span className="text-muted-foreground min-w-0">
                {v.medicos.join(" · ")}{" "}
                <span
                  className="font-mono text-[10px] text-muted-foreground/80 whitespace-nowrap"
                  title={`Escolha feita às ${format(v.marcadoEm, "HH:mm")}. ${v.online ? "Está com a fila aberta agora." : "Não está com a fila aberta agora."}`}
                >
                  · {format(v.marcadoEm, "HH:mm")}{minutos >= 60 && ` (há ${ha(minutos)})`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
