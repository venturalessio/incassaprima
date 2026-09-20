-- Impedisce ai ruoli client di invocare direttamente funzioni
-- SECURITY DEFINER attraverso l'endpoint RPC pubblico.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_organization_member(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_organization_owner(uuid) FROM anon, authenticated;
