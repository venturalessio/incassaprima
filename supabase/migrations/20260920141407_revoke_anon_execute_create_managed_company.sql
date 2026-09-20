-- Supabase concede EXECUTE di default anche al ruolo anon (non solo a
-- PUBLIC) sulle nuove funzioni nello schema public. create_managed_company
-- deve essere chiamabile solo da utenti autenticati.
revoke execute on function public.create_managed_company(text) from anon;
