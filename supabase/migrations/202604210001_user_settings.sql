create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.user_settings
  add column if not exists user_id uuid,
  add column if not exists settings_payload jsonb,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_pkey'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings
      add primary key (user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_user_id_fkey'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings
      add constraint user_settings_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end
$$;

update public.user_settings
set settings_payload = '{}'::jsonb
where settings_payload is null;

update public.user_settings
set created_at = coalesce(created_at, timezone('utc', now()))
where created_at is null;

update public.user_settings
set updated_at = coalesce(updated_at, created_at, timezone('utc', now()))
where updated_at is null;

alter table public.user_settings
  alter column settings_payload set default '{}'::jsonb,
  alter column created_at set default timezone('utc', now()),
  alter column updated_at set default timezone('utc', now()),
  alter column settings_payload set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_payload_object_check'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings
      add constraint user_settings_payload_object_check
      check (jsonb_typeof(settings_payload) = 'object');
  end if;
end
$$;

create or replace function public.user_settings_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists user_settings_touch_updated_at on public.user_settings;
create trigger user_settings_touch_updated_at
before update on public.user_settings
for each row execute function public.user_settings_touch_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own"
  on public.user_settings
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own"
  on public.user_settings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own"
  on public.user_settings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.user_settings to authenticated;
grant select, insert, update, delete on public.user_settings to service_role;
