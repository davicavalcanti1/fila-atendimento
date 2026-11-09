# Changelog — Fila de Atendimento

## 0.1.3 — 09/nov/2026
### Corrigido
- **Backoff quando o banco responde com erro de servidor** (item 4 do plano da queda de
  30/out). Antes, com o banco lento, toda tela continuava tentando no mesmo ritmo (30 s +
  avisos do Realtime) e piorava a queda. Agora (`src/lib/backoffServidor.ts`, mesmo
  arquivo do Farol):
  - O `fetch` do cliente Supabase observa as respostas do PostgREST: 5xx, 408, 429, erro
    de rede ou timeout põem a aba em espera; um sucesso zera; outros 4xx (401 de sessão,
    403, 400) não mexem no backoff e seguem como antes.
  - Espera de 30–60 s na 1ª falha, dobrando a cada falha seguida até 2,5–5 min, com
    sorteio para as telas não voltarem todas juntas.
  - Tela do assistente: em espera, a recarga de 30 s é pulada e os avisos do Realtime
    (Farol, Fila, seleção de médicos) só marcam "sujo"; quando a espera acaba, a próxima
    tentativa relê tudo (Farol + Fila + seleção + divisão de médicos).
  - Hub (contagem por modalidade), "quem está com quantos médicos" e o indicador de
    sincronização também pulam a volta em espera.
  - Desligada a repetição embutida do supabase-js (GET em 503/520/rede: +3 tentativas em
    1, 2 e 4 s), que quadruplicava cada leitura com o banco caindo.
  - Erro de servidor não limpa mais a seleção de médicos, a divisão de médicos nem zera a
    contagem do Hub. A fila já ficava na tela; a faixa "Esta tela não conseguiu atualizar
    a fila" continua sendo o aviso de desatualizado.
- Testes do backoff: `npm test` (`tests/backoffServidor.test.ts`, `node --test`).

## 0.1.2 — 03/nov/2026
### Alterado
- **Layout responsivo para celular e tablet (< 1024 px).** Só classes `max-lg:`/`max-sm:`
  (Tailwind), então o PC (>= 1024 px) fica idêntico. Nada de lógica, dados ou textos mudou.
  - Botões e chips (Atualizar, Sair, médicos, "Ver como", prioridade, motivo, Outra sala /
    Remover sala, editar/detalhes do card) com alvo de toque de 40 px.
  - Cabeçalho da página, cabeçalho de cada médico/lista e aviso de modo leitura quebram linha
    em vez de estourar a largura.
  - Diálogos cabem na tela (largura 100vw − 2 rem, altura máx. da tela com rolagem interna,
    X maior); detalhes do paciente em 1 coluna abaixo de 640 px.
  - Campos de texto com 16 px para o iOS não dar zoom; barra superior e rodapé respeitam a
    safe-area.

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
