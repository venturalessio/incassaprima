-- Rimuove il privilegio EXECUTE ereditato dal ruolo PUBLIC.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_organization_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_organization_owner(uuid) FROM PUBLIC;
