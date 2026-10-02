-- Fila de Atendimento agora lê da tabela farol_timestamps (mesma fonte do Farol).
-- A tabela fila_atendimento vira um "overlay" que só armazena dados locais da fila:
--   posicao (drag-and-drop), prioridade, observacoes e dispensed_at (remoção local).
-- A lista de pacientes e sua situação vêm sempre do Farol — quando o paciente recebe
-- baixa no Farol (dispensed_at em farol_timestamps), ele some da fila automaticamente.

-- Permite linhas "overlay" sem posição definida (paciente que nunca foi arrastado)
ALTER TABLE public.fila_atendimento
  ALTER COLUMN posicao DROP NOT NULL;

-- Remoção local da fila (não afeta o Farol)
ALTER TABLE public.fila_atendimento
  ADD COLUMN IF NOT EXISTS dispensed_at TIMESTAMPTZ;

-- Campos que eram obrigatórios mas que agora vêm do farol_timestamps deixam de ser
ALTER TABLE public.fila_atendimento
  ALTER COLUMN nome DROP NOT NULL;

-- Index pra lookup rápido do overlay por (tenant, atendimento)
CREATE INDEX IF NOT EXISTS idx_fila_atendimento_tenant_atendimento
  ON public.fila_atendimento (tenant_id, atendimento_id);
