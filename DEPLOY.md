# Deploy — Fila de Atendimento

## Estado (02/out/2026)

| | |
|---|---|
| Type-check do front | ✅ `npx tsc --noEmit` (strict) |
| Build do front | ✅ `npm run build` |
| Type-check do servidor | ✅ `npx tsc --noEmit -p server/tsconfig.json` |
| Sobe em modo produção | ✅ `/health` 200 com `banco: "ok"`, SPA na raiz e sob `/fila-atendimento-app`, assets com cache imutável, `/fila-atendimento-api/*` inexistente devolve 404 em JSON, login inválido devolve 401 legível |
| Migrations | **nada a aplicar** — as três tabelas do módulo já existem no banco da Imago (conferido em 02/out) |
| `docker build` | **não testado** — esta máquina não tem Docker. Trate o primeiro build da imagem como parte da tarefa |

## No EasyPanel

Container único: o Express serve a API **e** o `dist` do Vite. Porta **3001**.

Nome do serviço: **`projetos_davi_fila-atendimento`**. Não é escolha livre: é
dele que o nginx do controleoperacional deriva o destino do proxy
(`/<slug>-app` e `/<slug>-api` → `projetos_davi_<slug>`). Nome diferente = 502
dentro do sistema, sem nada no código apontando o motivo.

### Build args (o Vite inlina em build time — env de runtime não tem efeito)

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

### Env de runtime

```
SUPABASE_URL                 obrigatória
SUPABASE_SERVICE_ROLE_KEY    obrigatória — o processo NÃO sobe sem ela, de propósito
SUPABASE_PUBLISHABLE_KEY     a mesma chave publicável do front; sem ela só e-mail loga
PORT=3001
```

A `SUPABASE_SERVICE_ROLE_KEY` **nunca** entra como build arg: build arg fica no
histórico de camadas e aparece em `docker history`.

No EasyPanel as env vars valem no build E no runtime (o Dockerfile declara os
ARGs), então dá para colar tudo na aba Environment.

## Depois que subir

1. `GET /health` deve responder `dependencias.banco: "ok"`. `degradado` =
   `SUPABASE_SERVICE_ROLE_KEY` errada ou rede.
2. Abrir o host próprio, logar com `nome.sobrenome`, abrir uma fila e arrastar
   um card: tem que pedir motivo e salvar (toast de erro se a RLS recusar).
3. Domínio do EasyPanel apontando para a porta **3001**, não 80 ("Service is
   not reachable" do Traefik é isso).

## Entrar no menu do sistema

Só depois do passo acima validado:

1. Cadastrar em `gestao.imagoradiologia.cloud/developer/modulos` com slug
   `fila-atendimento`, ícone `ListOrdered`.
2. **Remover do controleoperacional** as rotas `/fila-atendimento` e
   `/fila-atendimento/:slug` (App.tsx), o item de Sidebar/TopNav, a entrada
   em `SLUGS_DE_TELAS` do ModulosManager e a feature `src/features/fila`.
   Enquanto as rotas existirem no React Router de lá, o clique é resolvido no
   cliente e nunca chega ao proxy. Pelo CLAUDE.md de lá, remover módulo é bump
   MAJOR.
3. Primeiro sintoma de "tela carregando em loop" no embed: a guarda de
   `SIGNED_IN` no AuthContext do sistema (ADR 0003, seção de armadilhas).
