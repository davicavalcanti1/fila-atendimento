-- Divisão de médicos: leitura das linhas dos OUTROS volta a ser da supervisão
-- para cima.
--
-- Contexto. Em 19/08/2026 a migration `..._leitura_simetrica.sql` incluiu
-- `assistente_sala` na leitura para que o painel "Acompanhando agora" também
-- aparecesse para quem ele rastreia. Em 11/09/2026 o Caio decidiu o contrário:
-- quem está com qual médico é informação de coordenação, e coordenação é
-- admin, developer e supervisor. A assistente continua lendo e gravando a
-- PRÓPRIA linha — o `user_id = auth.uid()` permanece na policy, então a fila
-- dela não muda em nada.
--
-- 🚨 Esta migration é a tranca. O `podeVerAcompanhamento` do React só evita
-- renderizar (e evita três consultas por evento de realtime em ~21 telas);
-- sozinho ele seria teatro, porque a chave publicável na mão de qualquer
-- pessoa logada leria a tabela inteira pelo PostgREST.
--
-- Consequência aceita e conhecida: as assistentes perdem também o contador de
-- colisão nos chips ("outra pessoa já marcou esta médica"), porque ele se
-- alimenta exatamente destas linhas.
--
-- 🕐 Histórico, porque a decisão foi e voltou: em 10/09 isto foi proposto, ele
-- aprovou, e ao ler o custo do contador desistiu — naquele dia subiu só o nome
-- novo do painel (v9.2.5). Em 11/09 ele pediu a restrição de novo, já sabendo
-- do contador. Não reabrir sem ordem nova.
--
-- Reversível: basta recriar a policy com `assistente_sala` de volta na lista.

DROP POLICY IF EXISTS "fila_assistente_state read" ON public.fila_assistente_state;

CREATE POLICY "fila_assistente_state read"
  ON public.fila_assistente_state
  FOR SELECT
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'developer'::public.app_role)
      OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
    )
  );

COMMENT ON POLICY "fila_assistente_state read" ON public.fila_assistente_state IS
  'Cada pessoa lê a própria linha; admin, developer e supervisor leem as de todos. '
  'assistente_sala foi retirada da leitura ampla em 11/09/2026 (antes: migration de 19/08).';

-- O comentário da tabela foi escrito pela migration de 19/08 e ficaria mentindo.
COMMENT ON TABLE public.fila_assistente_state IS
  'Estado da Fila por usuário e modalidade (médicos selecionados, salas extras, mapa paciente->sala). '
  'Leitura: a própria linha para qualquer papel do tenant, e todas as linhas do tenant para '
  'admin/developer/supervisor. Escrita: a própria linha (admin/developer também escrevem as demais).';
