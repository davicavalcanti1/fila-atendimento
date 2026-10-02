-- =============================================================================
-- Fila do Assistente: estado por modalidade
-- =============================================================================
-- Até agora a fila_assistente_state tinha PK (user_id, tenant_id) — uma linha
-- por usuário, assumindo que cada usuário só trabalha em UMA modalidade
-- (Ultrassom). Com a abertura da visão de assistente para o supervisor em
-- TODAS as modalidades (US, RM, TC, etc.), cada usuário precisa ter seleção
-- de médicos / salas-extras independente por modalidade.
--
-- Mudança: adiciona modalidade_id e move a PK para
-- (tenant_id, user_id, modalidade_id). Registros existentes assumem
-- modalidade_id = 2 (Ultrassonografia), que era o único escopo até hoje.
-- =============================================================================

ALTER TABLE public.fila_assistente_state
  ADD COLUMN IF NOT EXISTS modalidade_id integer;

-- Pros registros já existentes — todos eram de US (única modalidade suportada).
UPDATE public.fila_assistente_state
SET modalidade_id = 2
WHERE modalidade_id IS NULL;

ALTER TABLE public.fila_assistente_state
  ALTER COLUMN modalidade_id SET NOT NULL;

-- Troca a PK: dropa a antiga (user_id, tenant_id) e cria a nova com modalidade.
ALTER TABLE public.fila_assistente_state
  DROP CONSTRAINT IF EXISTS fila_assistente_state_pkey;

ALTER TABLE public.fila_assistente_state
  ADD CONSTRAINT fila_assistente_state_pkey
  PRIMARY KEY (tenant_id, user_id, modalidade_id);

-- Índice de busca por user dentro do tenant — usado pra listar "assistentes
-- ativos hoje" no hub do supervisor.
CREATE INDEX IF NOT EXISTS idx_fila_assistente_state_tenant_user
  ON public.fila_assistente_state (tenant_id, user_id);
