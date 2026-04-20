create table if not exists public.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default timezone('utc', now()),
  trial_start timestamptz not null default timezone('utc', now()),
  trial_end timestamptz not null default (timezone('utc', now()) + interval '30 days'),
  subscription_status text not null default 'trial',
  plan text not null default 'trial',
  stripe_customer_id text,
  stripe_subscription_id text,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.user_access
  add column if not exists email text,
  add column if not exists created_at timestamptz,
  add column if not exists trial_start timestamptz,
  add column if not exists trial_end timestamptz,
  add column if not exists subscription_status text,
  add column if not exists plan text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_access'
      and column_name = 'user_id'
  ) then
    raise exception 'public.user_access ist vorhanden, aber Spalte user_id fehlt.';
  end if;
end
$$;

update public.user_access
set created_at = coalesce(created_at, timezone('utc', now()))
where created_at is null;

update public.user_access
set trial_start = coalesce(trial_start, created_at, timezone('utc', now()))
where trial_start is null;

update public.user_access
set trial_end = coalesce(trial_end, trial_start + interval '30 days', timezone('utc', now()) + interval '30 days')
where trial_end is null;

update public.user_access
set trial_end = trial_start
where trial_end < trial_start;

update public.user_access
set subscription_status = 'trial'
where subscription_status is null or btrim(subscription_status) = '';

update public.user_access
set subscription_status = 'trial'
where subscription_status not in (
  'trial',
  'active',
  'trialing',
  'past_due',
  'incomplete',
  'unpaid',
  'canceled'
);

update public.user_access
set plan = 'trial'
where plan is null or btrim(plan) = '';

update public.user_access
set email = coalesce(email, '')
where email is null;

update public.user_access
set updated_at = coalesce(updated_at, created_at, timezone('utc', now()))
where updated_at is null;

alter table public.user_access
  alter column created_at set default timezone('utc', now()),
  alter column trial_start set default timezone('utc', now()),
  alter column trial_end set default (timezone('utc', now()) + interval '30 days'),
  alter column subscription_status set default 'trial',
  alter column plan set default 'trial',
  alter column updated_at set default timezone('utc', now()),
  alter column created_at set not null,
  alter column trial_start set not null,
  alter column trial_end set not null,
  alter column subscription_status set not null,
  alter column plan set not null,
  alter column email set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_access_trial_window_check'
      and conrelid = 'public.user_access'::regclass
  ) then
    alter table public.user_access
      add constraint user_access_trial_window_check
      check (trial_end >= trial_start);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_access_subscription_status_check'
      and conrelid = 'public.user_access'::regclass
  ) then
    alter table public.user_access
      add constraint user_access_subscription_status_check
      check (
        subscription_status in (
          'trial',
          'active',
          'trialing',
          'past_due',
          'incomplete',
          'unpaid',
          'canceled'
        )
      );
  end if;
end
$$;

create index if not exists user_access_email_idx
  on public.user_access (email);

create index if not exists user_access_trial_end_idx
  on public.user_access (trial_end);

create index if not exists user_access_stripe_customer_idx
  on public.user_access (stripe_customer_id);

create index if not exists user_access_stripe_subscription_idx
  on public.user_access (stripe_subscription_id);

create or replace function public.user_access_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists user_access_touch_updated_at on public.user_access;
create trigger user_access_touch_updated_at
before update on public.user_access
for each row execute function public.user_access_touch_updated_at();

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
grant select, insert, update, delete on public.user_access to service_role;
