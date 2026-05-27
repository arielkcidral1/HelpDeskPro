-- Schema remoto para o HelpDesk Pro no Supabase/PostgreSQL.
-- Cole este arquivo no SQL Editor do Supabase e execute antes de publicar o site.

create table if not exists public.support_staff (
  id bigserial primary key,
  name text not null,
  email text not null unique,
  role text not null,
  senha text not null,
  foto text default '',
  created_at timestamptz default now()
);

create table if not exists public.clients (
  id bigserial primary key,
  name text not null,
  cpf text not null unique,
  email text not null unique,
  senha text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.tickets (
  id text primary key,
  client_id bigint references public.clients(id) on delete set null,
  user_name text not null,
  user_cpf text default '',
  user_email text default '',
  setor text not null,
  tipo text not null,
  prioridade text default 'Nao definida',
  descricao text not null,
  status text default 'Aberto',
  responsavel text default '',
  observacoes text default '[]',
  historico text default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.notifications (
  id bigserial primary key,
  titulo text not null,
  texto text not null,
  destinatario text default '',
  ignorar text default '',
  read boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.chat_messages (
  id bigserial primary key,
  chat_key text not null,
  autor text not null,
  texto text not null,
  is_staff boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.chats_suporte (
  cpf text primary key,
  client_id bigint references public.clients(id) on delete set null,
  nome text not null,
  assunto text default '',
  observacao text default '',
  responsavel text default '',
  encerrado boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.app_config (
  key text primary key,
  value text not null
);

create table if not exists public.client_activity_log (
  id bigserial primary key,
  client_id bigint references public.clients(id) on delete set null,
  client_name text default '',
  client_cpf text default '',
  client_email text default '',
  action text not null,
  details text default '',
  created_at timestamptz default now()
);

alter table public.tickets
  add column if not exists client_id bigint references public.clients(id) on delete set null;

alter table public.chats_suporte
  add column if not exists client_id bigint references public.clients(id) on delete set null;

create index if not exists idx_tickets_created_at on public.tickets (created_at);
create index if not exists idx_tickets_status on public.tickets (status);
create index if not exists idx_clients_cpf on public.clients (cpf);
create index if not exists idx_clients_email on public.clients (email);
create index if not exists idx_client_activity_client_created on public.client_activity_log (client_id, created_at desc);
create index if not exists idx_notifications_created_at on public.notifications (created_at desc);
create index if not exists idx_chat_messages_key_created on public.chat_messages (chat_key, created_at);
create index if not exists idx_chats_suporte_encerrado on public.chats_suporte (encerrado);

insert into public.support_staff (name, email, role, senha, foto) values
  ('Administrador', 'admin@helpdesk.local', 'Admin', 'admin', ''),
  ('Ariel', 'ariel@helpdesk.local', 'Gerente', '123', 'ariel.jpeg'),
  ('Kevin', 'kevin@helpdesk.local', 'Gerente', '123', 'kevin.jpeg'),
  ('Gustavo', 'gustavo@helpdesk.local', 'Gerente', '123', 'gustavo.jpeg'),
  ('Heloisa', 'heloisa@helpdesk.local', 'Gerente', '123', 'helo.jpeg'),
  ('Gabriel', 'fofinho@helpdesk.local', 'Gerente', '123', 'gabriel.jpeg'),
  ('Pedro', 'sarrinho@helpdesk.local', 'Gerente', '123', 'pedro.jpeg')
on conflict (email) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tickets_updated_at on public.tickets;
create trigger trg_tickets_updated_at
before update on public.tickets
for each row execute function public.set_updated_at();

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

-- O site atual nao tem login real do Supabase, entao estas policies liberam
-- leitura/escrita com a anon key publica. Para uso interno isso sincroniza tudo;
-- para producao aberta, coloque autenticacao antes de expor o link publicamente.
alter table public.support_staff enable row level security;
alter table public.clients enable row level security;
alter table public.tickets enable row level security;
alter table public.notifications enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chats_suporte enable row level security;
alter table public.app_config enable row level security;
alter table public.client_activity_log enable row level security;

drop policy if exists "helpdesk_public_all_support_staff" on public.support_staff;
create policy "helpdesk_public_all_support_staff" on public.support_staff
for all using (true) with check (true);

drop policy if exists "helpdesk_public_all_clients" on public.clients;
create policy "helpdesk_public_all_clients" on public.clients
for all using (true) with check (true);

drop policy if exists "helpdesk_public_all_tickets" on public.tickets;
create policy "helpdesk_public_all_tickets" on public.tickets
for all using (true) with check (true);

drop policy if exists "helpdesk_public_all_notifications" on public.notifications;
create policy "helpdesk_public_all_notifications" on public.notifications
for all using (true) with check (true);

drop policy if exists "helpdesk_public_all_chat_messages" on public.chat_messages;
create policy "helpdesk_public_all_chat_messages" on public.chat_messages
for all using (true) with check (true);

drop policy if exists "helpdesk_public_all_chats_suporte" on public.chats_suporte;
create policy "helpdesk_public_all_chats_suporte" on public.chats_suporte
for all using (true) with check (true);

drop policy if exists "helpdesk_public_all_app_config" on public.app_config;
create policy "helpdesk_public_all_app_config" on public.app_config
for all using (true) with check (true);

drop policy if exists "helpdesk_public_all_client_activity_log" on public.client_activity_log;
create policy "helpdesk_public_all_client_activity_log" on public.client_activity_log
for all using (true) with check (true);
