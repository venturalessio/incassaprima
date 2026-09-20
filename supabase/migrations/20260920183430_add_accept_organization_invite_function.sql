-- Accetta un invito: aggiunge il chiamante come membro dell'organizzazione
-- indicata dal token. Per la v1, funziona solo per chi non ha ancora
-- un account IncassaPrima con una propria organizzazione (nessuno
-- switcher multi-org per utenti Free/Pro esistenti, per ora).
create or replace function public.accept_organization_invite(invite_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite record;
  caller_email text;
  has_existing_membership boolean;
begin
  select * into invite
  from public.organization_invites
  where token = invite_token
    and accepted_at is null
    and expires_at > now();

  if invite is null then
    raise exception 'Invito non valido, già usato o scaduto.';
  end if;

  select exists (
    select 1 from public.organization_members where user_id = auth.uid()
  ) into has_existing_membership;

  if has_existing_membership then
    raise exception 'Il tuo account ha già un''organizzazione: per ora gli inviti funzionano solo per chi non ha ancora un account IncassaPrima.';
  end if;

  caller_email := auth.jwt() ->> 'email';

  if invite.invited_email is not null
     and lower(invite.invited_email) <> lower(coalesce(caller_email, '')) then
    raise exception 'Questo invito è destinato a un altro indirizzo email.';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (invite.organization_id, auth.uid(), invite.role);

  update public.organization_invites
  set accepted_at = now(), accepted_by = auth.uid()
  where id = invite.id;

  return invite.organization_id;
end;
$$;

revoke all on function public.accept_organization_invite(uuid) from public;
revoke execute on function public.accept_organization_invite(uuid) from anon;
grant execute on function public.accept_organization_invite(uuid) to authenticated;
