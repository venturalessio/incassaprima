-- Inviti per aggiungere collaboratori a un'organizzazione (identità
-- Studio, azienda gestita, o organizzazione Free/Pro normale). Solo
-- l'owner può crearli/vederli/eliminarli; l'accettazione avviene via
-- funzione SECURITY DEFINER, non tramite RLS diretta.
create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  role text not null default 'member' check (role in ('owner', 'member')),
  invited_email text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id)
);

create unique index organization_invites_token_key on public.organization_invites (token);
create index idx_organization_invites_organization on public.organization_invites (organization_id);

alter table public.organization_invites enable row level security;

create policy "Owners can view invites for their organization"
on public.organization_invites
for select
to authenticated
using (is_organization_owner(organization_id));

create policy "Owners can create invites for their organization"
on public.organization_invites
for insert
to authenticated
with check (is_organization_owner(organization_id) and created_by = (select auth.uid()));

create policy "Owners can delete invites for their organization"
on public.organization_invites
for delete
to authenticated
using (is_organization_owner(organization_id));
