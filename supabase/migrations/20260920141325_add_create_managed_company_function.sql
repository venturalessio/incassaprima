-- Crea una nuova azienda gestita da uno Studio: solo l'owner di
-- un'organizzazione con piano 'studio' può chiamarla. La funzione
-- (SECURITY DEFINER) crea l'organizzazione figlia e la relativa
-- membership in una singola transazione, sullo stesso modello di
-- handle_new_user().
create or replace function public.create_managed_company(company_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  studio_org_id uuid;
  new_org_id uuid;
  trimmed_name text := trim(company_name);
begin
  if trimmed_name is null or char_length(trimmed_name) < 2 then
    raise exception 'Il nome dell''azienda deve avere almeno 2 caratteri.';
  end if;

  select o.id into studio_org_id
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
    and m.role = 'owner'
    and o.plan = 'studio'
  limit 1;

  if studio_org_id is null then
    raise exception 'Solo il titolare di un''organizzazione con piano Studio può aggiungere aziende gestite.';
  end if;

  insert into public.organizations (name, plan, managed_by)
  values (trimmed_name, 'free', studio_org_id)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, auth.uid(), 'owner');

  return new_org_id;
end;
$$;

revoke all on function public.create_managed_company(text) from public;
grant execute on function public.create_managed_company(text) to authenticated;
