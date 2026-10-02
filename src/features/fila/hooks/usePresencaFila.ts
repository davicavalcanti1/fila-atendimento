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
// Nome, papel e modalidade aberta. NÃO anuncia os médicos selecionados, de
// propósito: quem está com qual médico é informação de coordenação (decisão do
// Caio em 11/09/2026), trancada pela RLS de `fila_assistente_state` (migration
// 20260911180000). O canal de presença é público — mandar os médicos por aqui
// abriria para qualquer assistente o que o banco fecha. A divisão de médicos
// continua vindo da tabela, e a presença só diz QUEM está online. Nome e papel
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
// mesma pessoa. A lista junta tudo: modalidades somadas, e o "desde" é o da aba
// mais antiga.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** O que uma aba anuncia. */
interface MetaPresenca {
  user_id:       string;
  nome:          string;
  papel:         string | null;
  modalidade_id: number | null;
  /** ISO de quando esta aba entrou. */
  desde:         string;
}

/** Uma pessoa online, com as abas dela já somadas. */
export interface PessoaOnline {
  id:          string;
  nome:        string;
  papel:       string | null;
  modalidades: number[];
  /** ISO — a aba mais antiga desta pessoa que ainda está aberta. */
  desde:       string;
  souEu:       boolean;
}

interface Params {
  tenantId: string;
  /**
   * Quem sou eu. Obrigatório até para só escutar: a chave de presença do canal
   * é o user_id, e o canal é compartilhado entre o hub e a fila.
   */
  eu?: { id: string; nome: string; papel: string | null } | null;
  /**
   * O que anunciar. `null` = escuta sem aparecer (o hub, e o supervisor em
   * preview, que não está acompanhando médico nenhum — está olhando a tela de
   * outra pessoa, e anunciar a seleção DELA como sua inventaria presença).
   */
  anuncio?: { modalidadeId: number } | null;
}

function juntar(estado: Record<string, MetaPresenca[]>, meuId: string | undefined): PessoaOnline[] {
  const pessoas: PessoaOnline[] = [];
  for (const [chave, metas] of Object.entries(estado)) {
    if (!metas?.length) continue;
    const modalidades = new Set<number>();
    let desde = metas[0].desde;
    for (const m of metas) {
      if (m.modalidade_id != null) modalidades.add(m.modalidade_id);
      if (m.desde < desde) desde = m.desde;
    }
    const id = metas[0].user_id ?? chave;
    pessoas.push({
      id,
      nome:        metas[0].nome || id.slice(0, 8),
      papel:       metas[0].papel ?? null,
      modalidades: [...modalidades],
      desde,
      souEu:       id === meuId,
    });
  }
  return pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// ── Um canal por tenant, aberto enquanto o app estiver aberto ────────────────
// O canal NÃO pode ser criado e destruído por componente. O `removeChannel` do
// supabase-js só tira o canal da lista depois da resposta do servidor, e o
// `supabase.channel(nome)` devolve o canal existente quando o nome ainda está na
// lista. Desmontar e remontar na mesma hora — o StrictMode faz isso em todo
// efeito no dev, e navegar do hub para a fila faz o mesmo em produção —
// devolvia o canal antigo, já inscrito, e o `.on("presence")` estourava:
// "cannot add `presence` callbacks … after `subscribe()`".
//
// Então o canal vive num registro do módulo e não fecha quando a tela sai:
// sair só retira o anúncio (untrack), e a pessoa some da lista dos outros do
// mesmo jeito. Fechar a aba encerra a conexão inteira, que é a saída real.
//
// A única recriação é quando muda o usuário (a chave de presença é fixada na
// entrada do canal). Aí o novo só é criado depois que o antigo terminou de
// sair, que é a corrida acima resolvida por ordem, não por sorte.

type Ouvinte = (pessoas: Record<string, MetaPresenca[]>) => void;
type Canal = ReturnType<typeof supabase.channel>;

interface Sala {
  chave:     string;
  canal:     Canal | null;
  ouvintes:  Set<Ouvinte>;
  /** Anúncio de cada consumidor; vale o último não nulo. */
  anuncios:  Map<symbol, MetaPresenca | null>;
  inscrito:  boolean;
  estado:    Record<string, MetaPresenca[]>;
}

const salas = new Map<string, Sala>();

function metaVigente(sala: Sala): MetaPresenca | null {
  let vigente: MetaPresenca | null = null;
  for (const m of sala.anuncios.values()) if (m) vigente = m;
  return vigente;
}

function publicar(sala: Sala) {
  if (!sala.canal || !sala.inscrito) return;
  const meta = metaVigente(sala);
  if (meta) sala.canal.track(meta);
  else sala.canal.untrack();
}

function conectar(sala: Sala, nome: string) {
  // Sem chave própria, o Realtime gera uma por conexão e a mesma pessoa
  // apareceria uma vez por aba.
  const canal = supabase.channel(nome, { config: { presence: { key: sala.chave } } });
  sala.canal = canal;
  canal.on("presence", { event: "sync" }, () => {
    sala.estado = canal.presenceState() as unknown as Record<string, MetaPresenca[]>;
    for (const o of sala.ouvintes) o(sala.estado);
  });
  canal.subscribe((status) => {
    sala.inscrito = status === "SUBSCRIBED";
    if (sala.inscrito) publicar(sala);
  });
}

function abrirSala(tenantId: string, chave: string): Sala {
  const nome = `fila-presenca-${tenantId}`;
  const existente = salas.get(nome);
  if (existente && existente.chave === chave) return existente;

  const sala: Sala = { chave, canal: null, ouvintes: new Set(), anuncios: new Map(), inscrito: false, estado: {} };
  salas.set(nome, sala);

  const anterior = existente?.canal;
  if (!anterior) {
    conectar(sala, nome);
  } else {
    existente.inscrito = false;
    anterior.untrack()
      .catch(() => undefined)
      .then(() => supabase.removeChannel(anterior))
      .finally(() => { if (salas.get(nome) === sala) conectar(sala, nome); });
  }
  return sala;
}

export function usePresencaFila({ tenantId, eu, anuncio }: Params) {
  const [estado, setEstado] = useState<Record<string, MetaPresenca[]>>({});
  const desdeRef = useRef(new Date().toISOString());
  const idRef    = useRef(Symbol("consumidor-presenca"));
  const meuId    = eu?.id;

  // ── Ouvir a sala ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId || !meuId) return;
    const sala = abrirSala(tenantId, meuId);
    const ouvinte: Ouvinte = (e) => setEstado(e);
    sala.ouvintes.add(ouvinte);
    setEstado(sala.estado);
    const id = idRef.current;
    return () => {
      sala.ouvintes.delete(ouvinte);
      sala.anuncios.delete(id);
      publicar(sala);
    };
  }, [tenantId, meuId]);

  // ── O que eu anuncio ─────────────────────────────────────────────────────
  // Em efeito separado: trocar de modalidade não pode reabrir o canal — a
  // pessoa piscaria fora e dentro da lista dos outros.
  const chaveAnuncio = anuncio ? String(anuncio.modalidadeId) : "";
  useEffect(() => {
    if (!tenantId || !meuId) return;
    const sala = salas.get(`fila-presenca-${tenantId}`);
    if (!sala) return;
    sala.anuncios.set(idRef.current, eu && anuncio ? {
      user_id:       eu.id,
      nome:          eu.nome,
      papel:         eu.papel,
      modalidade_id: anuncio.modalidadeId,
      desde:         desdeRef.current,
    } : null);
    publicar(sala);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, meuId, chaveAnuncio, eu?.nome, eu?.papel]);

  const online = useMemo(() => juntar(estado, meuId), [estado, meuId]);
  return useMemo(() => ({ online }), [online]);
}
