-- fila_atendimento (overlay com posicao/prioridade/medico_override) precisa
-- estar no realtime pra que mudanças do supervisor (reordenação, transferência,
-- prioridade) reflitam ao vivo na fila do assistente_sala — e em qualquer
-- outra sessão observando a mesma fila.
--
-- Antes só `farol_timestamps` estava na publication; o supervisor enxergava as
-- próprias alterações via UI otimista, mas terceiros (assistente, outro
-- supervisor logado em paralelo) só viam ao recarregar.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.fila_atendimento;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
