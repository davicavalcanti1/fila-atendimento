-- Fila de Atendimento: fila ordenável por drag-and-drop sincronizada com o Farol (NetRis)
CREATE TABLE IF NOT EXISTS public.fila_atendimento (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  atendimento_id      TEXT NOT NULL,
  nome                TEXT NOT NULL,
  cpf                 TEXT,
  exame               TEXT,
  medico              TEXT,
  horario_agendamento TEXT,
  chegou_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  prioridade          TEXT NOT NULL DEFAULT 'normal',
  observacoes         TEXT,
  posicao             INTEGER NOT NULL DEFAULT 0,
  situacao_id         INTEGER,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, atendimento_id)
);

ALTER TABLE public.fila_atendimento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fila_tenant_rls" ON public.fila_atendimento
  USING (
    tenant_id IN (
      SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- Permissões para recepcao e supervisor visualizarem/editarem a fila
INSERT INTO public.role_permissions (role_name, module, sub_module, can_view, can_create, can_edit, can_delete)
VALUES
  ('recepcao',   'fila_atendimento', '', true, true, true, true),
  ('supervisor', 'fila_atendimento', '', true, true, true, true)
ON CONFLICT (role_name, module, sub_module) DO UPDATE
  SET can_view = true, can_create = true, can_edit = true, can_delete = true;
