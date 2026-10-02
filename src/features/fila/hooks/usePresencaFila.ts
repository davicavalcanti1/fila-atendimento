// =============================================================================
// Presença real na Fila: quem está com a tela aberta AGORA
// =============================================================================
// Até 02/10 "quem está acompanhando" era deduzido de `fila_assistente_state`:
// quem tinha salvo uma seleção de médicos em algum momento do dia. Ninguém
// saía da lista — a assistente que trabalhou às 8h e foi embora continuava
// "acompanhando" o Dr. Fulano até meia-noite, e o hub a mostrava como ativa.
//
// Agora é Realtime Presence do Supabase: cada aba aberta na fila se anuncia num
// canal do tenant e some dele quando a aba fecha (na hora) ou quando a conexão
// cai (pelo timeout do heartbeat, coisa de ~30s). Não há tabela nem migration:
// presença vive só na memória do servidor de Realtime.
//
// ── O que cada aba anuncia ───────────────────────────────────────────────────
// Nome, papel, modalidade aberta e os médicos selecionados nela. Nome e papel
// vêm do próprio cliente, então são DECLARADOS, não verificados: servem para
// exibir quem está onde, nunca para autorizar nada. Quem decide o que cada um
// pode ler ou gravar continua sendo a RLS.
//
// ── Privacidade do canal ─────────────────────────────────────────────────────
// O canal é público no Realtime (não usa realtime.messages com RLS). Quem tiver
// a chave publicável e o id do tenant consegue entrar e ver nomes de
// funcionários e de médicos — nada de paciente passa por aqui. Fechar isso é
// trocar para canal privado com policy em realtime.messages.
//
// ── Várias abas da mesma pessoa ──────────────────────────────────────────────
// A chave de presença é o user_id, então duas abas viram duas "metas" sob a
// mesma pessoa. A lista junta tudo: médicos somados, modalidades somadas, e o
// "desde" é o da aba mais antiga.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** O que uma aba anuncia. */
interface MetaPresenca {
  user_id:       string;
  nome:          string;
  papel:         string | null;
  modalidade_id: number | null;
  medicos:       string[];
  /** ISO de quando esta aba entrou. */
  desde:         string;
}

/** Uma pessoa online, com as abas dela já somadas. */
export interface PessoaOnline {
  id:          string;
  nome:        string;
  papel:       string | null;
  medicos:     string[];
  modalidades: number[];
  /** ISO — a aba mais antiga desta pessoa que ainda está aberta. */
  desde:       string;
  souEu:       boolean;
}

interface Params {
  tenantId: string;
  /** Quem sou eu. Sem isto o hook só escuta, não se anuncia. */
  eu?: { id: string; nome: string; papel: string | null } | null;
  /**
   * O que anunciar. `null` = escuta sem aparecer (o hub, e o supervisor em
   * preview, que não está acompanhando médico nenhum — está olhando a tela de
   * outra pessoa, e anunciar a seleção DELA como sua inventaria presença).
   */
  anuncio?: { modalidadeId: number; medicos: string[] } | null;
}

function juntar(estado: Record<string, MetaPresenca[]>, meuId: string | undefined): PessoaOnline[] {
  const pessoas: PessoaOnline[] = [];
  for (const [chave, metas] of Object.entries(estado)) {
    if (!metas?.length) continue;
    const medicos = new Set<string>();
    const modalidades = new Set<number>();
    let desde = metas[0].desde;
    for (const m of metas) {
      for (const med of m.medicos ?? []) medicos.add(med);
      if (m.modalidade_id != null) modalidades.add(m.modalidade_id);
      if (m.desde < desde) desde = m.desde;
    }
    const id = metas[0].user_id ?? chave;
    pessoas.push({
      id,
      nome:        metas[0].nome || id.slice(0, 8),
      papel:       metas[0].papel ?? null,
      medicos:     [...medicos].sort((a, b) => a.localeCompare(b, "pt-BR")),
      modalidades: [...modalidades],
      desde,
      souEu:       id === meuId,
    });
  }
  return pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function usePresencaFila({ tenantId, eu, anuncio }: Params) {
  const [online, setOnline] = useState<PessoaOnline[]>([]);
  const canalRef   = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const inscrito   = useRef(false);
  const desdeRef   = useRef(new Date().toISOString());
  const meuId      = eu?.id;

  // O anúncio mais recente, lido pelo callback de inscrição. Em ref porque o
  // canal é criado uma vez por tenant/pessoa, e trocar de médico não pode
  // derrubar e recriar o canal — isso faria a pessoa piscar fora e dentro da
  // lista dos outros a cada clique.
  const anuncioRef = useRef(anuncio);
  anuncioRef.current = anuncio;

  const montarMeta = (): MetaPresenca | null => {
    if (!eu || !anuncioRef.current) return null;
    return {
      user_id:       eu.id,
      nome:          eu.nome,
      papel:         eu.papel,
      modalidade_id: anuncioRef.current.modalidadeId,
      medicos:       anuncioRef.current.medicos,
      desde:         desdeRef.current,
    };
  };

  // ── Canal: um por tenant e pessoa ─────────────────────────────────────────
  useEffect(() => {
    if (!tenantId) return;
    const canal = supabase.channel(`fila-presenca-${tenantId}`, {
      // Sem chave própria, o Realtime gera uma por conexão e a mesma pessoa
      // apareceria uma vez por aba.
      config: { presence: { key: meuId ?? "" } },
    });
    canalRef.current = canal;

    canal.on("presence", { event: "sync" }, () => {
      setOnline(juntar(canal.presenceState() as unknown as Record<string, MetaPresenca[]>, meuId));
    });

    canal.subscribe((status) => {
      inscrito.current = status === "SUBSCRIBED";
      if (!inscrito.current) return;
      const meta = montarMeta();
      if (meta) canal.track(meta);
    });

    return () => {
      inscrito.current = false;
      canalRef.current = null;
      // untrack antes de sair: avisa os outros na hora, em vez de esperar o
      // timeout do heartbeat.
      canal.untrack().finally(() => supabase.removeChannel(canal));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, meuId]);

  // ── Reanuncia quando muda o que eu acompanho ─────────────────────────────
  const chaveAnuncio = anuncio ? `${anuncio.modalidadeId}|${anuncio.medicos.join("§")}` : "";
  useEffect(() => {
    const canal = canalRef.current;
    if (!canal || !inscrito.current) return;
    const meta = montarMeta();
    if (meta) canal.track(meta);
    else canal.untrack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveAnuncio, eu?.nome, eu?.papel]);

  return useMemo(() => ({ online }), [online]);
}
