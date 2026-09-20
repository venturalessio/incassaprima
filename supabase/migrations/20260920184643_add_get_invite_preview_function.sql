-- Anteprima di un invito dato solo il token, senza richiedere di essere
-- già membri dell'organizzazione: chi apre il link di invito deve poter
-- vedere il nome dell'organizzazione a cui si sta per unire, prima ancora
-- di creare un account. Nessun dato sensibile esposto: solo nome
-- organizzazione, ruolo proposto e validità.
create or replace function public.get_invite_preview(invite_token uuid)
returns table(organization_name text, role text, valid boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite record;
begin
  select oi.role, oi.accepted_at, oi.expires_at, o.name as org_name
  into invite
  from public.organization_invites oi
  join public.organizations o on o.id = oi.organization_id
  where oi.token = invite_token;

  if invite is null then
    return query select null::text, null::text, false;
    return;
  end if;

  return query select
    invite.org_name,
    invite.role,
    (invite.accepted_at is null and invite.expires_at > now());
end;
$$;

revoke all on function public.get_invite_preview(uuid) from public;
grant execute on function public.get_invite_preview(uuid) to anon;
grant execute on function public.get_invite_preview(uuid) to authenticated;
