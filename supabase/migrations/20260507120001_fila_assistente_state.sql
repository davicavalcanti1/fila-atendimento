-- Tabela de estado da Fila do Assistente de Sala.
--
-- Persiste a seleção de médicos do assistente + duplicações manuais
-- (médicos atendendo em 2+ salas que o assistente separou em colunas extras),
-- pra que o supervisor consiga visualizar EXATAMENTE o que cada assistente
-- está vendo no momento — em tempo real via realtime channel.
--
-- Uma linha por usuário (assistente). Multi-tenant por tenant_id.

CREATE TABLE IF NOT EXISTS public.fila_assistente_state (
  user_id              UUID         NOT NULL,
  tenant_id            UUID         NOT NULL,

  -- Lista de nomes de médicos selecionados (mesmo formato que farol_timestamps.medico).
  medicos_selecionados TEXT[]       NOT NULL DEFAULT '{}',

  -- Cada item: { id: string, medico: string, sala_label: string }
  -- "id" é o identificador único da coluna virtual (ex.: "<medico>__<n>"),
  -- usado pelo drag&drop pra direcionar pacientes pra uma sala extra.
  -- Quando vazio, todo paciente do médico vai pra coluna principal dele.
  salas_extra          JSONB        NOT NULL DEFAULT '[]'::jsonb,

  -- Mapa atendimento_id -> sala_extra.id. Pacientes não mapeados ficam na
  -- coluna principal do médico. O assistente mantém esse mapa via drag&drop
  -- quando um mesmo médico atende em 2+ salas.
  paciente_sala_map    JSONB        NOT NULL DEFAULT '{}'::jsonb,

  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE
);

ALTER TABLE public.fila_assistente_state ENABLE ROW LEVEL SECURITY;

-- O próprio assistente (e supervisor/admin/developer) consegue ler todas as
-- linhas do tenant — o supervisor precisa enxergar a sessão de cada
-- assistente.
DROP POLICY IF EXISTS "fila_assistente_state read" ON public.fila_assistente_state;
CREATE POLICY "fila_assistente_state read" ON public.fila_assistente_state
  FOR SELECT
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'developer'::public.app_role)
      OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
      OR public.has_role(auth.uid(), 'assistente_sala'::public.app_role)
    )
  );

-- Só o próprio assistente escreve a sua linha (admin/developer também podem
-- — útil pra suporte/preview eventual).
DROP POLICY IF EXISTS "fila_assistente_state write own" ON public.fila_assistente_state;
CREATE POLICY "fila_assistente_state write own" ON public.fila_assistente_state
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'developer'::public.app_role)
    )
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'developer'::public.app_role)
    )
  );

-- Trigger pra atualizar updated_at automaticamente — o supervisor usa esse
-- timestamp pra saber quem está ativo "agora".
CREATE OR REPLACE FUNCTION public.fila_assistente_state_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fila_assistente_state_touch_updated_at ON public.fila_assistente_state;
CREATE TRIGGER fila_assistente_state_touch_updated_at
  BEFORE UPDATE ON public.fila_assistente_state
  FOR EACH ROW EXECUTE FUNCTION public.fila_assistente_state_touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.fila_assistente_state;
