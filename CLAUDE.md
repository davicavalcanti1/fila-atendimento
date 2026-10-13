# Regras do projeto — Fila de Atendimento (Imago)

Este arquivo vale para qualquer pessoa ou agente (Claude Code, Codex etc.) que mexa neste repo.
As regras de versionamento do sistema principal estão em `controleoperacional/CLAUDE.md` (seção 2).

---

## 0. Antes de QUALQUER trabalho: confirme que está na versão mais recente

**Esta regra vale para humanos e para agentes (Claude Code, Codex, outros), em
todos os repos da Imago (`controleoperacional`, `fila-atendimento`, `farol`,
`checkin` e demais módulos).** Foi escrita depois de um incidente real:

> Em 02/out/2026 a Fila de Atendimento foi extraída do sistema para um repo
> próprio a partir de um `main` local **30 commits atrás do GitHub**. Ficaram de
> fora as mudanças de 10 a 23/set — o Ecocardiograma separado por médico, a
> "Divisão de médicos — hoje" e a trava de leitura na RLS. O build com o código
> velho foi ao ar às 18:55; o porte do que faltava foi mergeado às 19:31, mas
> **ninguém refez o deploy**. Resultado: a recepção voltou a ver o
> Ecocardiograma todo misturado, e o conserto já existia no `main`.

Duas falhas, duas travas. Faça as duas.

### 0.1 — Antes de editar, extrair, copiar ou criar branch

1. `git fetch origin` e confira que o `main` local **não está atrás** do remoto:
   ```bash
   git fetch origin
   git rev-list --left-right --count main...origin/main   # esquerda=só local, direita=só remoto
   ```
   Se o número da direita for maior que 0, **traga o remoto primeiro**
   (`git pull --ff-only` ou rebase). Não comece em cima de base velha.
2. **Nunca** extraia um módulo, porte código ou copie arquivos de uma pasta local
   sem antes conferir que ela é o `origin/main` atual. A fonte da verdade é o
   GitHub, não a pasta da sua máquina.
3. Ao extrair/portar, liste o que mudou na origem desde o último ponto em comum
   (`git log --since=<data> -- <pasta>` no repo de origem) e confirme que cada
   item **entrou** no destino. A pergunta é "o que o outro lado fez enquanto eu
   não olhava?", não "o que eu fiz?".
4. Se o repo de origem tem mais de um clone (a máquina da clínica, a de casa, a
   de outra pessoa), assuma que **pode haver commits que você não tem**. Só o
   `fetch` resolve a dúvida.

### 0.2 — Depois de mergear: o deploy tem que ter o commit certo

Código no `main` **não** é código no ar. Um merge sem deploy é o mesmo bug,
só que mais difícil de achar.

1. Depois de mergear em `main`, **refaça o deploy** do serviço no EasyPanel
   (ver `reference_easypanel_servicos_imago` / tabela de serviços) e anote
   qual commit foi publicado.
2. Confirme no ar. Para módulos embutidos, compare o `Last-Modified` do
   bundle em produção com a hora do último commit do `main`:
   ```bash
   curl -sI https://gestao.imagoradiologia.cloud/<modulo>-app/assets/<chunk>.js | grep -i last-modified
   git log -1 --format=%ad origin/main
   ```
   Se o bundle for **mais velho** que o último commit, o deploy está atrás.
3. Teste a tela do que mudou **em produção**, não só no preview local.
   "Subiu" só vale depois de ver funcionando.
4. Se você mergeou algo "em seguida" a um deploy já feito (como o porte de
   02/out, 37 minutos depois), **o deploy anterior não conta**. Refaça.

### 0.3 — Se o seu agente está tocando em um módulo que saiu deste repo

Módulos extraídos (`fila-atendimento`, `farol`, `checkin`, `receituarios`,
`controle-midia`, `ocorrencias`…) continuam recebendo mudanças feitas aqui
até o corte. **Antes do corte**, diff do que a pasta do módulo tem neste repo
contra o que o repo novo tem. Depois do corte, remova daqui — não antes.

---

## Deste repo em particular

- Serviço no EasyPanel: `projetos_davi_fila-atendimento` (porta 3001). Veja `DEPLOY.md`.
- O último commit publicado deve ser o `origin/main`. Conferência rápida: o `Last-Modified` de
  `https://gestao.imagoradiologia.cloud/fila-atendimento-app/assets/FilaAtendimento-*.js`
  precisa ser **depois** do último commit do `main`.
- Ecocardiograma e Ultrassom abrem em kanban por médico (`POR_MEDICO_SLUGS` em
  `src/features/fila/hooks/useFilaAssistente.ts`). Se o Ecocardiograma aparecer misturado, o
  primeiro suspeito é deploy atrás do `main`, não bug de código.
