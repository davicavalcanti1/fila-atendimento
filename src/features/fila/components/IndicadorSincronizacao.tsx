// Indicador "a fila está em dia?" — fica no cabeçalho do hub e da fila.
//
// Duas perguntas diferentes, e o indicador responde as duas:
//   1. a FONTE está viva? — última rodada do poll do Farol com o NetRis
//   2. a TELA está viva? — última vez que esta aba conseguiu ler a fila
// A primeira é a linha grande, com o LED. A segunda é a linha miúda embaixo, e
// só aparece onde a tela tem leitura própria para relatar (na fila).

import { cn } from "@/lib/utils";
import {
  useSincronizacaoFarol, LIMITE_ATENCAO_MIN, LIMITE_CRITICO_MIN,
  type EstadoSincronizacao,
} from "../hooks/useSincronizacaoFarol";

// Classes escritas por extenso: o Tailwind descarta classe montada por template.
const LAMP: Record<EstadoSincronizacao, string> = {
  carregando:   "",
  ok:           "lamp-ok",
  atencao:      "lamp-warn",
  desconhecido: "lamp-warn",
  critico:      "lamp-crit",
};

const TEXTO: Record<EstadoSincronizacao, string> = {
  carregando:   "text-muted-foreground",
  ok:           "text-foreground",
  atencao:      "text-warning-strong",
  desconhecido: "text-warning-strong",
  critico:      "text-destructive-strong",
};

const hhmm = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const hhmmss = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo" });

function idade(min: number): string {
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `há ${h}h${String(m).padStart(2, "0")}` : `há ${h}h`;
}

interface Props {
  tenantId: string;
  /** Última leitura bem-sucedida da fila nesta aba. Omitir no hub. */
  telaEm?: Date | null;
  /** A última tentativa de leitura da fila nesta aba falhou. */
  telaFalhou?: boolean;
}

export function IndicadorSincronizacao({ tenantId, telaEm, telaFalhou }: Props) {
  const { estado, ultimaEm, minutos } = useSincronizacaoFarol(tenantId);

  const principal =
    estado === "carregando"   ? "verificando…" :
    estado === "desconhecido" ? "sem verificação" :
    estado === "critico" && !ultimaEm ? "sem sincronização" :
    estado === "critico"      ? `parada ${idade(minutos!)}` :
    `NetRis ${idade(minutos!)}`;

  const explicacao =
    estado === "carregando"   ? "Verificando a última sincronização com o NetRis." :
    estado === "desconhecido" ? "Não foi possível ler o registro de sincronização. A fila pode estar em dia ou não." :
    !ultimaEm                 ? "Não há registro de sincronização com o NetRis. A fila pode estar desatualizada." :
    estado === "critico"      ? `A fila pode estar desatualizada: a última sincronização com o NetRis foi às ${hhmm(ultimaEm)}. Normal é a cada 3 min.` :
    estado === "atencao"      ? `Uma rodada de sincronização atrasou: a última foi às ${hhmm(ultimaEm)}. Normal é a cada 3 min; vira alerta com ${LIMITE_CRITICO_MIN} min.` :
                                `Sincronizada com o NetRis às ${hhmm(ultimaEm)}. Atualiza a cada 3 min; alerta a partir de ${LIMITE_ATENCAO_MIN} min.`;

  const titulo = [
    explicacao,
    telaFalhou ? "A última leitura da fila nesta tela falhou — mostrando a anterior." : null,
    telaEm ? `Esta tela leu a fila pela última vez às ${hhmmss(telaEm)}.` : null,
  ].filter(Boolean).join("\n");

  const alerta = estado === "critico" || telaFalhou;

  return (
    <div
      role="status"
      aria-live="polite"
      title={titulo}
      className={cn(
        "inline-flex flex-col justify-center h-8 px-2.5 rounded-sm border bg-card min-w-0",
        alerta ? "border-destructive/50" : estado === "atencao" || estado === "desconhecido" ? "border-warning/60" : "border-border",
      )}
    >
      <span className="inline-flex items-center gap-1.5 leading-none">
        {LAMP[estado] && <span className={cn("lamp h-1.5 w-1.5 shrink-0", LAMP[estado])} />}
        <span className={cn("font-mono text-[11px] font-bold whitespace-nowrap", TEXTO[estado])}>{principal}</span>
      </span>
      {(telaEm || telaFalhou) && (
        <span className={cn(
          "font-mono text-[9px] leading-none mt-1 whitespace-nowrap",
          telaFalhou ? "text-destructive-strong font-bold" : "text-muted-foreground",
        )}>
          {telaFalhou ? "leitura falhou" : `tela ${hhmmss(telaEm!)}`}
        </span>
      )}
    </div>
  );
}

/**
 * Faixa abaixo do cabeçalho, só quando a fila provavelmente está parada.
 * A etiqueta do cabeçalho é discreta de propósito — fica o dia todo na tela —
 * e por isso mesmo some do campo de visão no único momento em que importa.
 */
export function FaixaFilaDesatualizada({ tenantId, telaFalhou }: Pick<Props, "tenantId" | "telaFalhou">) {
  const { estado, ultimaEm } = useSincronizacaoFarol(tenantId);
  if (estado !== "critico" && !telaFalhou) return null;

  const fonteParada = estado === "critico";
  return (
    <div role="alert" className="panel flex items-start gap-3 px-4 py-2.5 border-l-[3px] border-l-destructive">
      <span className="lamp lamp-crit h-2 w-2 shrink-0 mt-1.5" />
      <div className="min-w-0 text-sm">
        <p className="font-bold text-destructive-strong">
          {fonteParada ? "A fila pode estar desatualizada" : "Esta tela não conseguiu atualizar a fila"}
        </p>
        <p className="text-muted-foreground text-xs mt-0.5">
          {fonteParada
            ? (ultimaEm
                ? `A última sincronização com o NetRis foi às ${hhmm(ultimaEm)} — o normal é a cada 3 minutos. Confira no NetRis antes de chamar o próximo paciente.`
                : "Não há registro de sincronização com o NetRis. Confira no NetRis antes de chamar o próximo paciente.")
            : "Mostrando a última fila que carregou. Verifique a conexão; a tela tenta de novo sozinha a cada 30 segundos."}
          {fonteParada && telaFalhou && " Esta tela também não conseguiu ler a fila agora."}
        </p>
      </div>
    </div>
  );
}
