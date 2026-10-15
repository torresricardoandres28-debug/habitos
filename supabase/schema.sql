-- Pega todo este script en Supabase > SQL Editor > New query > Run.
create table if not exists public.habits (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  primary key (user_id, id)
);

alter table public.habits enable row level security;

drop policy if exists "habits_select_own" on public.habits;
drop policy if exists "habits_insert_own" on public.habits;
drop policy if exists "habits_update_own" on public.habits;
drop policy if exists "habits_delete_own" on public.habits;

create policy "habits_select_own" on public.habits for select using (auth.uid() = user_id);
create policy "habits_insert_own" on public.habits for insert with check (auth.uid() = user_id);
create policy "habits_update_own" on public.habits for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "habits_delete_own" on public.habits for delete using (auth.uid() = user_id);
