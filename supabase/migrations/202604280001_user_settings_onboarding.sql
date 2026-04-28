alter table public.user_settings
  add column if not exists onboarding_completed boolean,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_step integer;

update public.user_settings
set onboarding_completed = coalesce(onboarding_completed, false)
where onboarding_completed is null;

update public.user_settings
set onboarding_step = coalesce(onboarding_step, 1)
where onboarding_step is null;

update public.user_settings
set onboarding_step = 1
where onboarding_step < 1;

update public.user_settings
set onboarding_step = 5
where onboarding_step > 5;

update public.user_settings
set
  onboarding_completed = true,
  onboarding_step = 5
where onboarding_completed = false
  and coalesce(nullif(btrim(settings_payload->>'companyName'), ''), '') <> ''
  and coalesce(nullif(btrim(settings_payload->>'ownerName'), ''), '') <> ''
  and coalesce(nullif(btrim(settings_payload->>'companyStreet'), ''), '') <> ''
  and coalesce(nullif(btrim(settings_payload->>'companyPostalCode'), ''), '') <> ''
  and coalesce(nullif(btrim(settings_payload->>'companyCity'), ''), '') <> ''
  and coalesce(nullif(btrim(settings_payload->>'companyEmail'), ''), '') <> ''
  and coalesce(nullif(btrim(settings_payload->>'companyIban'), ''), '') <> ''
  and (
    coalesce(nullif(btrim(settings_payload->>'taxNumber'), ''), '') <> ''
    or coalesce(nullif(btrim(settings_payload->>'vatId'), ''), '') <> ''
  );

update public.user_settings
set onboarding_completed_at = timezone('utc', now())
where onboarding_completed = true and onboarding_completed_at is null;

update public.user_settings
set onboarding_completed_at = null
where onboarding_completed = false;

alter table public.user_settings
  alter column onboarding_completed set default false,
  alter column onboarding_step set default 1,
  alter column onboarding_completed set not null,
  alter column onboarding_step set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_onboarding_step_check'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings
      add constraint user_settings_onboarding_step_check
      check (onboarding_step >= 1 and onboarding_step <= 5);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_onboarding_timestamp_check'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings
      add constraint user_settings_onboarding_timestamp_check
      check (
        (onboarding_completed = true and onboarding_completed_at is not null)
        or (onboarding_completed = false and onboarding_completed_at is null)
      );
  end if;
end
$$;
