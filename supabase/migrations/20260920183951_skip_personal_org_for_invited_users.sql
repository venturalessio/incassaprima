create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_organization_id uuid;
  organization_name text;
begin
  if nullif(trim(new.raw_user_meta_data ->> 'invite_token'), '') is not null then
    return new;
  end if;

  organization_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'organization_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(new.email, '@', 1) || ' - Impresa'
  );

  insert into public.organizations (name)
  values (organization_name)
  returning id into new_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, new.id, 'owner');

  return new;
end;
$function$;
