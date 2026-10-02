-- Assistente de sala: escopo do menu, trava de escrita e registro das mexidas na fila.
--
-- Três coisas que andavam juntas na prática e por isso vêm no mesmo arquivo:
--
--  1. O menu da assistente estava errado nos dois sentidos — mostrava Check-in e
--     escondia o Farol (nunca existiu linha `farol` para esta role, e sem linha o
--     `canAccess` nega). Aqui ele passa a ser exatamente Fila + Farol.
--
--  2. A tela já impedia a assistente de editar a fila desde 8358063, mas só a
--     tela: a RLS liberava escrita para qualquer um do tenant. A trava real é
--     esta, no banco.
--
--  3. Quem mexe na fila agora precisa dizer por quê, e isso fica registrado.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Escopo do menu: só Fila de Atendimento e Farol
-- ─────────────────────────────────────────────────────────────────────────────

-- O Farol faltava. Sem `can_view` aqui o item some do menu mesmo com o módulo
-- embutido cadastrado e ativo — quem decide a exibição é o `canAccess`.
insert into public.role_permissions (role_name, module, sub_module, can_view, can_create, can_edit, can_delete)
values ('assistente_sala', 'farol', '', true, false, false, false)
on conflict (role_name, module, sub_module) do update
  set can_view = excluded.can_view;

-- Check-in sai: é o único outro módulo que a role enxergava.
update public.role_permissions
   set can_view = false, can_create = false, can_edit = false, can_delete = false
 where role_name = 'assistente_sala' and module = 'checkins';

-- A fila fica visível e somente-leitura. `can_create`/`can_edit` estavam true e
-- contradiziam a trava da tela; a RLS abaixo é que passa a valer, mas deixar os
-- flags coerentes evita que a próxima pessoa a ler a matriz conclua o contrário.
update public.role_permissions
   set can_view = true, can_create = false, can_edit = false, can_delete = false
 where role_name = 'assistente_sala' and module = 'fila_atendimento';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. "Atualizações" deixa de ser incondicional no menu
-- ─────────────────────────────────────────────────────────────────────────────
-- O item era renderizado sem passar pelo `canAccess`, então aparecia para todo
-- mundo. Passa a ser permissão como qualquer outro item, o que exige semear a
-- linha para as roles que devem continuar vendo — senão o link some para todas.
insert into public.role_permissions (role_name, module, sub_module, can_view, can_create, can_edit, can_delete)
select papel::text, 'implementacoes', '', true, false, false, false
  from unnest(enum_range(null::public.app_role)) as papel
 where papel::text <> 'assistente_sala'
on conflict (role_name, module, sub_module) do update
  set can_view = excluded.can_view;

insert into public.role_permissions (role_name, module, sub_module, can_view, can_create, can_edit, can_delete)
values ('assistente_sala', 'implementacoes', '', false, false, false, false)
on conflict (role_name, module, sub_module) do update
  set can_view = excluded.can_view;

-- `parceiro` não está no enum `app_role` — só existe como string em
-- `role_permissions`, cuja coluna `role_name` é TEXT. O `enum_range` acima não o
-- alcança, e sem esta linha ele seria o único papel sem Atualizações caso o
-- valor entre no enum algum dia.
insert into public.role_permissions (role_name, module, sub_module, can_view, can_create, can_edit, can_delete)
values ('parceiro', 'implementacoes', '', true, false, false, false)
on conflict (role_name, module, sub_module) do nothing;

-- Quem tem whitelist pessoal (`user_module_access`) não passa por
-- `role_permissions`: a lista pessoal substitui o padrão da role por inteiro.
-- Sem esta linha, os usuários nessa situação perderiam o link de Atualizações
-- como efeito colateral de uma mudança que não era sobre eles.
insert into public.user_module_access (user_id, tenant_id, module)
select distinct uma.user_id, uma.tenant_id, 'implementacoes'
  from public.user_module_access uma
 where not exists (
         select 1 from public.user_roles ur
          where ur.user_id = uma.user_id
            and ur.role = 'assistente_sala'::public.app_role
       )
on conflict (user_id, module) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trava de escrita da fila no banco
-- ─────────────────────────────────────────────────────────────────────────────
-- A policy antiga era FOR ALL por tenant, sem olhar papel. Vira um par:
-- leitura para o tenant inteiro, escrita para o tenant menos a assistente.
-- `has_role` é SECURITY DEFINER, então não recursiona na RLS de `user_roles`.
drop policy if exists fila_tenant_rls on public.fila_atendimento;

create policy fila_leitura_tenant on public.fila_atendimento
  for select
  using (tenant_id in (select p.tenant_id from public.profiles p where p.id = auth.uid()));

create policy fila_escrita_tenant on public.fila_atendimento
  for all
  using (
    tenant_id in (select p.tenant_id from public.profiles p where p.id = auth.uid())
    and not public.has_role(auth.uid(), 'assistente_sala'::public.app_role)
  )
  with check (
    tenant_id in (select p.tenant_id from public.profiles p where p.id = auth.uid())
    and not public.has_role(auth.uid(), 'assistente_sala'::public.app_role)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Registro das alterações da fila
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabela própria, e não `activity_logs`, por dois motivos: aquela tabela tem
-- rotina de retenção que apaga linhas antigas, e a pergunta que se faz aqui é
-- "o que aconteceu com este paciente hoje", que ali fica cara de responder no
-- meio de page_view e erro de JS.
--
-- `user_nome` é cópia, não join: o nome tem que sobreviver ao perfil sair.
create table if not exists public.fila_movimentacoes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  atendimento_id text not null,
  user_id        uuid references auth.users(id) on delete set null,
  user_nome      text,
  acao           text not null check (acao in ('reordenar', 'mover_medico', 'prioridade')),
  motivo         text not null,
  motivo_detalhe text,
  paciente_nome  text,
  modalidade_id  integer,
  de             jsonb not null default '{}'::jsonb,
  para           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists fila_movimentacoes_tenant_data_idx
  on public.fila_movimentacoes (tenant_id, created_at desc);

-- Atende o histórico dentro do card do paciente.
create index if not exists fila_movimentacoes_atendimento_idx
  on public.fila_movimentacoes (tenant_id, atendimento_id, created_at desc);

alter table public.fila_movimentacoes enable row level security;

-- Lê quem é do tenant, inclusive a assistente: o registro serve para ela também
-- entender por que a fila mudou debaixo dela.
create policy fila_movimentacoes_leitura on public.fila_movimentacoes
  for select
  using (tenant_id in (select p.tenant_id from public.profiles p where p.id = auth.uid()));

-- Escreve só quem pode mexer na fila, e só em nome próprio.
create policy fila_movimentacoes_insercao on public.fila_movimentacoes
  for insert
  with check (
    tenant_id in (select p.tenant_id from public.profiles p where p.id = auth.uid())
    and user_id = auth.uid()
    and not public.has_role(auth.uid(), 'assistente_sala'::public.app_role)
  );

-- Sem policy de UPDATE/DELETE de propósito: registro que se edita não é registro.

grant select, insert on public.fila_movimentacoes to authenticated;
