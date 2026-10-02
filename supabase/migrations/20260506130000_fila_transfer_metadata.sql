-- Fila de Atendimento — auditoria de transferências de médico no kanban do US.
--
-- Quando alguém transfere um paciente entre médicos (botão Transferir ou drag
-- inter-coluna), o card precisa exibir:
--   • Quem fez a transferência
--   • O horário exato
--   • Pra qual médico o paciente estava agendado originalmente (esse vem de
--     farol_timestamps.medico, não precisa de coluna nova aqui)

ALTER TABLE public.fila_atendimento
  ADD COLUMN IF NOT EXISTS transferred_by_name TEXT,
  ADD COLUMN IF NOT EXISTS transferred_at      TIMESTAMPTZ;

COMMENT ON COLUMN public.fila_atendimento.transferred_by_name IS
  'Nome (full_name) do usuário que fez a última transferência. Limpa quando medico_override volta a NULL (Voltar ao original).';

COMMENT ON COLUMN public.fila_atendimento.transferred_at IS
  'Timestamp da última transferência. Limpa quando medico_override volta a NULL.';
