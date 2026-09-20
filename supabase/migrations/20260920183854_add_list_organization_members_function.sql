create or replace function public.list_organization_members(target_organization_id uuid)
returns table(user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_organization_member(target_organization_id) then
    raise exception 'Non fai parte di questa organizzazione.';
  end if;

  return query
    select
      om.user_id,
      u.email::text,
      om.role,
      om.created_at as joined_at
    from public.organization_members om
    join auth.users u on u.id = om.user_id
    where om.organization_id = target_organization_id
    order by om.created_at asc;
end;
$$;

revoke all on function public.list_organization_members(uuid) from public;
revoke execute on function public.list_organization_members(uuid) from anon;
grant execute on function public.list_organization_members(uuid) to authenticated;
