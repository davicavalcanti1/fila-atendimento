-- Fila de Atendimento: kanban por médico em ultrassom
--
-- 1) Adiciona coluna medico_override em fila_atendimento.
--    A fila combina farol_timestamps (fonte da verdade do NetRis) com o overlay
--    fila_atendimento (posicao/prioridade/observacoes/dispensed_at).
--    O kanban do US precisa permitir "transferir" um paciente de um médico para
--    outro sem mexer no NetRis — esse override fica só no overlay.
--
-- 2) Concede permissão de visualização e edição da fila para o role admin.
--    Antes só recepcao e supervisor enxergavam.

ALTER TABLE public.fila_atendimento
  ADD COLUMN IF NOT EXISTS medico_override TEXT;

COMMENT ON COLUMN public.fila_atendimento.medico_override IS
  'Médico atribuído manualmente na fila — sobrescreve farol_timestamps.medico na visualização. Usado pelo kanban por médico em ultrassom.';

INSERT INTO public.role_permissions (role_name, module, sub_module, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'fila_atendimento', '', true, true, true, true)
ON CONFLICT (role_name, module, sub_module) DO UPDATE
  SET can_view = true, can_create = true, can_edit = true, can_delete = true;
