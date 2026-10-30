# Changelog — Fila de Atendimento

## 0.1.1 — 30/out/2026
### Corrigido
- **Rajada de consultas que derrubou o banco em 30/out (08:20–08:51).** A tela do
  assistente relia o Farol *e* a Fila a cada aviso do Realtime, um por linha
  regravada pelo poll, sem filtrar modalidade. Às 08:23 isso deu 2.552 consultas
  ao `farol_timestamps` em 10 s, 100% vindas de `useFilaAssistente.loadFarol`.
  - Avisos agrupados: uma recarga até 1,5 s depois do primeiro aviso
    (`src/lib/agruparChamadas.ts`), nos canais do Farol e da Fila.
  - Aviso de paciente de outra modalidade é ignorado (exclusão, que chega sem
    modalidade, ainda recarrega).
  - Aviso do Farol só relê a Fila se a lista de atendimentos mudou; posição e
    prioridade continuam chegando pelo canal da própria Fila.
  - Recarga de segurança de 30 s não roda com a aba escondida; ao voltar, recarrega.
