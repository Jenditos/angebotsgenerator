create table if not exists public.business_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_key text not null,
  document_type text,
  idempotency_key text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, entity_type, entity_key),
  constraint business_records_entity_type_check
    check (entity_type in ('customer', 'project', 'document', 'appointment', 'activity')),
  constraint business_records_entity_key_check
    check (btrim(entity_key) <> ''),
  constraint business_records_document_type_check
    check (document_type is null or (entity_type = 'document' and btrim(document_type) <> '')),
  constraint business_records_idempotency_key_check
    check (
      idempotency_key is null
      or (
        entity_type = 'document'
        and document_type is not null
        and btrim(idempotency_key) <> ''
      )
    )
);

create unique index if not exists business_records_document_idempotency_idx
  on public.business_records (user_id, entity_type, document_type, idempotency_key)
  where entity_type = 'document' and idempotency_key is not null;

create index if not exists business_records_user_type_updated_idx
  on public.business_records (user_id, entity_type, updated_at desc);

alter table public.business_records enable row level security;
alter table public.business_records force row level security;

drop policy if exists "Users read own business records" on public.business_records;
create policy "Users read own business records"
  on public.business_records for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users write own business records" on public.business_records;
create policy "Users write own business records"
  on public.business_records for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own business records" on public.business_records;
create policy "Users update own business records"
  on public.business_records for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own business records" on public.business_records;
create policy "Users delete own business records"
  on public.business_records for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.business_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  counter_type text not null,
  counter_year integer not null default 0,
  last_value bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, counter_type, counter_year),
  constraint business_counters_type_check check (btrim(counter_type) <> ''),
  constraint business_counters_year_check check (counter_year >= 0),
  constraint business_counters_value_check
    check (last_value between 0 and 9007199254740991)
);

alter table public.business_counters enable row level security;
alter table public.business_counters force row level security;
drop policy if exists "Users read own business counters" on public.business_counters;
revoke all on table public.business_counters from anon, authenticated;

create or replace function public.allocate_business_sequence(
  p_user_id uuid,
  p_counter_type text,
  p_counter_year integer default 0,
  p_floor bigint default 0
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  next_value bigint;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id must not be null';
  end if;
  if p_counter_type is null or btrim(p_counter_type) = '' then
    raise exception using
      errcode = '22023',
      message = 'p_counter_type must not be empty';
  end if;
  if p_counter_year is null or p_counter_year < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_counter_year must be a non-negative integer';
  end if;
  if p_floor is null or p_floor < 0 or p_floor >= 9007199254740991 then
    raise exception using
      errcode = '22023',
      message = 'p_floor is outside the supported range';
  end if;

  insert into public.business_counters (
    user_id,
    counter_type,
    counter_year,
    last_value,
    updated_at
  )
  values (
    p_user_id,
    btrim(p_counter_type),
    p_counter_year,
    p_floor + 1,
    now()
  )
  on conflict (user_id, counter_type, counter_year)
  do update set
    last_value = greatest(
      public.business_counters.last_value,
      excluded.last_value - 1
    ) + 1,
    updated_at = now()
  where public.business_counters.last_value < 9007199254740991
  returning last_value into next_value;

  if next_value is null then
    raise exception using
      errcode = '22003',
      message = 'business sequence exceeds the supported range';
  end if;

  return next_value;
end;
$$;

revoke all on function public.allocate_business_sequence(uuid, text, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.allocate_business_sequence(uuid, text, integer, bigint)
  to service_role;

create table if not exists public.email_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_payload text not null check (length(encrypted_payload) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_connections enable row level security;
alter table public.email_connections force row level security;
revoke all on table public.email_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.email_connections to service_role;
