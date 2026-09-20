-- Bug scoperto: nessuna riga di organization_reminder_settings viene mai
-- creata automaticamente (né handle_new_user() né create_managed_company()
-- ne inseriscono una), quindi saveRules() — che fa un UPDATE, non un
-- upsert — non ha mai avuto nessuna riga da aggiornare per nessuna
-- organizzazione esistente. Corretto con un trigger che crea la riga di
-- default per ogni nuova organizzazione, qualunque sia la funzione che la
-- inserisce, più il backfill delle organizzazioni già esistenti.
create or replace function public.create_default_reminder_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_reminder_settings (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

create trigger organizations_create_reminder_settings
after insert on public.organizations
for each row execute function public.create_default_reminder_settings();

insert into public.organization_reminder_settings (organization_id)
select o.id
from public.organizations o
left join public.organization_reminder_settings s on s.organization_id = o.id
where s.organization_id is null;
