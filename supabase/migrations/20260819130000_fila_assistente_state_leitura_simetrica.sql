-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: fila_assistente_state_leitura_simetrica
-- Data: 19/08/2026
-- Descrição: A policy de SELECT de fila_assistente_state só liberava
--            admin/developer/supervisor/assistente_sala, mas a policy de
--            escrita libera QUALQUER usuário do tenant na própria linha
--            (user_id = auth.uid()). O resultado era write-only: um usuário de
--            outro papel (recepção, enfermagem, etc.) selecionava os médicos na
--            Fila do Ultrassom, a linha era gravada e nunca voltava na leitura
--            — no primeiro reload a seleção sumia e as colunas do kanban
--            desapareciam, sem erro nenhum (RLS devolve lista vazia).
--
--            Correção: a leitura passa a cobrir também a própria linha, para
--            qualquer papel. A visão cruzada (ler a linha de OUTRO usuário do
--            tenant) continua restrita a admin/developer/supervisor —
--            assistente_sala segue na lista porque o hub do assistente lista os
--            colegas ativos no dia.
--
--            Nada de novo é exposto: quem já podia escrever a própria linha
--            agora consegue lê-la de volta.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "fila_assistente_state read" ON public.fila_assistente_state;

CREATE POLICY "fila_assistente_state read" ON public.fila_assistente_state
  FOR SELECT
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      -- a própria sessão de trabalho, independente do papel
      user_id = auth.uid()
      -- visão cruzada: quem acompanha a fila dos assistentes
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'developer'::public.app_role)
      OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
      OR public.has_role(auth.uid(), 'assistente_sala'::public.app_role)
    )
  );

COMMENT ON TABLE public.fila_assistente_state IS
  'Estado da Fila por usuário e modalidade (médicos selecionados, salas extras, mapa paciente->sala). Leitura: a própria linha para qualquer papel do tenant, e todas as linhas do tenant para admin/developer/supervisor/assistente_sala. Escrita: a própria linha (admin/developer também escrevem as demais).';
