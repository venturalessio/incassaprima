-- Colonne per collegare un'organizzazione al proprio cliente/abbonamento
-- Stripe. stripe_customer_id e stripe_subscription_id restano bloccati
-- (nessun grant a anon/authenticated, solo service_role): non servono
-- al client, li usano solo le funzioni Edge con la service role key.
-- stripe_subscription_status resta leggibile dai membri dell'organizzazione
-- (stessa RLS di SELECT già esistente su organizations), utile in futuro
-- per mostrare lo stato dell'abbonamento in-app.
alter table public.organizations
  add column stripe_customer_id text unique,
  add column stripe_subscription_id text unique,
  add column stripe_subscription_status text;

revoke select, insert, update on public.organizations from anon, authenticated;
grant select (id, name, plan, created_at, updated_at, managed_by, stripe_subscription_status) on public.organizations to anon, authenticated;
grant insert (id, name, plan, created_at, updated_at, managed_by) on public.organizations to anon, authenticated;
grant update (name) on public.organizations to authenticated;
