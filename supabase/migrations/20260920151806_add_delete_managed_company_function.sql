-- Elimina un'azienda gestita da uno Studio con tutti i suoi dati
-- collegati (clienti, fatture, solleciti, log). Solo il proprietario può
-- chiamarla, e solo su un'organizzazione "azienda" (managed_by non nullo):
-- l'identità Studio stessa non è mai eliminabile da qui.
create or replace function public.delete_managed_company(company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  is_owner boolean;
  is_managed boolean;
begin
  select
    exists (
      select 1 from public.organization_members m
      where m.organization_id = company_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    ),
    exists (
      select 1 from public.organizations o
      where o.id = company_id and o.managed_by is not null
    )
  into is_owner, is_managed;

  if not is_owner or not is_managed then
    raise exception 'Azienda non trovata, non gestita da questo account, oppure non eliminabile (identità Studio).';
  end if;

  delete from public.reminders r
  using public.invoices i
  where r.invoice_id = i.id and i.organization_id = company_id;

  delete from public.invoice_activity_log where organization_id = company_id;
  delete from public.activity_log where organization_id = company_id;
  delete from public.invoices where organization_id = company_id;
  delete from public.customers where organization_id = company_id;
  delete from public.organization_reminder_settings where organization_id = company_id;
  delete from public.organization_members where organization_id = company_id;
  delete from public.organizations where id = company_id;
end;
$$;

revoke all on function public.delete_managed_company(uuid) from public;
revoke execute on function public.delete_managed_company(uuid) from anon;
grant execute on function public.delete_managed_company(uuid) to authenticated;
