create table if not exists public.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  trial_start timestamptz not null,
  trial_end timestamptz not null,
  subscription_status text not null default 'trial',
  plan text not null default 'trial',
  stripe_customer_id text,
  stripe_subscription_id text
);

create index if not exists user_access_email_idx
  on public.user_access (email);

create index if not exists user_access_stripe_customer_idx
  on public.user_access (stripe_customer_id);

alter table public.user_access enable row level security;

drop policy if exists "user_access_select_own" on public.user_access;
create policy "user_access_select_own"
  on public.user_access
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_access_insert_own" on public.user_access;
create policy "user_access_insert_own"
  on public.user_access
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_access_update_own" on public.user_access;
create policy "user_access_update_own"
  on public.user_access
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.user_access to authenticated;
