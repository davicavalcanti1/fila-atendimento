// =============================================================================
// Quando a fila foi atualizada pela última vez, de verdade
// =============================================================================
// A Fila não fala com o NetRis. Ela lê `farol_timestamps`, que a edge function
// `poll-farol-timestamps` (repo farol) atualiza a cada 3 minutos. Se essa
// rotina parar, a fila congela sem aviso nenhum — e o pg_cron não serve de
// alarme, porque marca "succeeded" só por ter disparado a chamada HTTP, mesmo
// quando o NetRis recusou.
//
// O sinal confiável é `integracao_heartbeat`: a edge function grava ali o
// horário de cada rodada que TERMINOU bem. É o que este hook lê.
//
// Não serve olhar `farol_timestamps.atualizado_em`: desde a correção do diff
// a linha só muda quando o dado do paciente muda, então uma fila calma e
// correta pode ficar meia hora sem nenhuma linha nova.
// =============================================================================

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const NOME_ROTINA = "poll-farol-timestamps";

/** Uma rodada perdida ainda é ruído (a rodada seguinte costuma vir). */
export const LIMITE_ATENCAO_MIN = 6;
/** Duas rodadas perdidas: a fila provavelmente está parada. */
export const LIMITE_CRITICO_MIN = 10;

export type EstadoSincronizacao = "carregando" | "ok" | "atencao" | "critico" | "desconhecido";

export interface Sincronizacao {
  estado:     EstadoSincronizacao;
  /** Última rodada bem-sucedida do poll do Farol. */
  ultimaEm:   Date | null;
  /** Minutos desde `ultimaEm`, recalculado sozinho. */
  minutos:    number | null;
}

export function useSincronizacaoFarol(tenantId: string): Sincronizacao {
  const [ultimaEm, setUltimaEm] = useState<Date | null>(null);
  const [falhou, setFalhou]     = useState(false);
  const [lido, setLido]         = useState(false);
  const [agora, setAgora]       = useState(() => Date.now());

  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    const ler = async () => {
      const { data, error } = await (supabase as any)
        .from("integracao_heartbeat")
        .select("ultimo_em")
        .eq("nome", NOME_ROTINA)
        // Linha por tenant ou global (tenant nulo): vale a mais recente das duas.
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        .order("ultimo_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!vivo) return;
      setLido(true);
      if (error) { setFalhou(true); return; }
      setFalhou(false);
      setUltimaEm(data?.ultimo_em ? new Date(data.ultimo_em) : null);
    };
    ler();
    // A rotina roda a cada 3 min; ler a cada 1 min basta para o aviso aparecer
    // no máximo um minuto depois de cruzar o limite.
    const t = setInterval(ler, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, [tenantId]);

  // Recalcula a idade sem precisar de nova leitura.
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  if (!lido) return { estado: "carregando", ultimaEm: null, minutos: null };
  // Não conseguir ler o registro não é o mesmo que a fila estar parada — mas
  // também não é "tudo certo". Fica como desconhecido, em âmbar.
  if (falhou) return { estado: "desconhecido", ultimaEm, minutos: null };
  // Leu e não existe registro: a rotina nunca rodou bem, ou rodava sem gravar.
  if (!ultimaEm) return { estado: "critico", ultimaEm: null, minutos: null };

  const minutos = Math.max(0, Math.floor((agora - ultimaEm.getTime()) / 60_000));
  const estado: EstadoSincronizacao =
    minutos >= LIMITE_CRITICO_MIN ? "critico" :
    minutos >= LIMITE_ATENCAO_MIN ? "atencao" : "ok";
  return { estado, ultimaEm, minutos };
}
