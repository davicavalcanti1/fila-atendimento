# Fila de Atendimento

Fila de pacientes por modalidade, sincronizada com o Farol (NetRis): quem está
"encaminhado para exame" aparece aqui, e a recepção reordena por arrasto,
transfere entre médicos, marca prioridade e observações. Cada mexida exige
motivo e fica registrada. A assistente de sala vê a fila em modo leitura e
escolhe quais médicos acompanhar; supervisor/admin enxergam a sessão de cada
assistente em tempo real.

Telas: `/fila-atendimento` (hub por modalidade + assistentes ativos) e
`/fila-atendimento/:slug` (a fila em si, kanban por médico).

## Origem

Módulo desmembrado do sistema **controleoperacional** (Imago) em 02/out/2026,
no mesmo molde dos spinoffs `farol`, `ocorrencias` e `receituarios`. Cópia fiel
de `src/features/fila/` e das migrations específicas do módulo a partir da
`main` do repo de origem (commit `a091ed6`).

## Como roda

```
npm install && npm --prefix server install
npm run server     # Express :3001 — login por nome.sobrenome e health
npm run dev        # Vite :5173, abre em /fila-atendimento-app/
```

`.env` na raiz (Vite) e `server/.env` (service role), ambos gitignored —
referência em cada `.env.example`.

## O que o módulo lê e escreve

| Tabela | Papel |
|---|---|
| `farol_timestamps` | **lê** — a lista de pacientes do dia e a situação. É alimentada pelo Farol (edge function `poll-farol-timestamps`, repo `farol`) |
| `farol_historico` | **lê** — timeline do atendimento no diálogo de detalhes |
| `fila_atendimento` | **escreve** — overlay local: posição, prioridade, observações, médico override, baixa local |
| `fila_assistente_state` | **escreve** — seleção de médicos e salas extras por usuário e modalidade |
| `fila_movimentacoes` | **escreve** — registro de cada alteração, com motivo |
| `profiles`, `user_roles`, `tenants` | **lê** — identidade, papel e tenant (compartilhados com o sistema) |

Não há chamada ao NetRis daqui: `src/services/netris/client.ts` só guarda os
IDs de situação e modalidade.

## Dependência do Farol

A Fila não tem fonte própria de pacientes. Se o poll do Farol parar, a fila
esvazia. Ver `project_imago_vault_secrets_pg_cron` e o repo `farol`.

## Embutido no sistema

Preparado conforme o ADR 0003 (`imago-platform/docs/adr`): assets em
`/fila-atendimento-app`, API em `/fila-atendimento-api`, `basename` lido do
endereço, barra própria some em iframe. Para aparecer no menu do sistema basta
o serviço `projetos_davi_fila-atendimento` existir no EasyPanel e o cadastro em
`/developer/modulos` — ver `DEPLOY.md`.
