-- Converte un'organizzazione normale (Free/Pro) in un account Studio:
-- crea una nuova organizzazione "identità" con plan='studio' e riassegna
-- l'organizzazione esistente come sua prima azienda gestita (managed_by),
-- esattamente l'intervento fatto manualmente in passato per evitare che i
-- dati di chi promuove un'organizzazione già in uso restino "intrappolati"
-- (vedi ROADMAP.md). Riceve acting_user_id esplicito invece di usare
-- auth.uid() perché va chiamata da un contesto server-side (funzione Edge
-- con service role), non da un utente autenticato direttamente — per
-- questo l'EXECUTE è concesso solo a service_role: se fosse chiamabile
-- dal client, chiunque potrebbe auto-promuoversi a Studio gratis.
create or replace function public.upgrade_to_studio(target_organization_id uuid, acting_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_identity_id uuid;
  org_name text;
begin
  if not exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id
      and user_id = acting_user_id
      and role = 'owner'
  ) then
    raise exception 'L''utente indicato non è proprietario di questa organizzazione.';
  end if;

  if exists (
    select 1 from public.organizations
    where id = target_organization_id
      and (managed_by is not null or plan = 'studio')
  ) then
    raise exception 'Questa organizzazione non può passare al piano Studio.';
  end if;

  select name into org_name from public.organizations where id = target_organization_id;

  insert into public.organizations (name, plan)
  values (org_name || ' - Studio', 'studio')
  returning id into new_identity_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_identity_id, acting_user_id, 'owner');

  update public.organizations
  set managed_by = new_identity_id, plan = 'free'
  where id = target_organization_id;

  return new_identity_id;
end;
$$;

revoke all on function public.upgrade_to_studio(uuid, uuid) from public;
revoke execute on function public.upgrade_to_studio(uuid, uuid) from anon, authenticated;
grant execute on function public.upgrade_to_studio(uuid, uuid) to service_role;
