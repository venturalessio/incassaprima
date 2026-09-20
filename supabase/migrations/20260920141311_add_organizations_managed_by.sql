-- Collega un'azienda gestita alla sua organizzazione Studio "identità".
-- NULL = organizzazione autonoma (utente Free/Pro normale, o identità
-- Studio stessa). Non-NULL = azienda cliente creata e gestita da uno
-- Studio.
alter table public.organizations
  add column managed_by uuid references public.organizations(id) on delete restrict;

create index idx_organizations_managed_by on public.organizations (managed_by);
