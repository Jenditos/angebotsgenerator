alter table public.user_access enable row level security;
alter table public.user_access force row level security;

drop policy if exists "user_access_update_own" on public.user_access;
revoke update, delete on table public.user_access from authenticated;

drop policy if exists "user_access_insert_own" on public.user_access;
create policy "user_access_insert_own"
  on public.user_access
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and subscription_status = 'trial'
    and plan = 'trial'
    and stripe_customer_id is null
    and stripe_subscription_id is null
    and trial_start >= timezone('utc', now()) - interval '10 minutes'
    and trial_start <= timezone('utc', now()) + interval '10 minutes'
    and trial_end >= trial_start
    and trial_end <= trial_start + interval '30 days'
  );

grant select, insert on table public.user_access to authenticated;
grant select, insert, update, delete on table public.user_access to service_role;
