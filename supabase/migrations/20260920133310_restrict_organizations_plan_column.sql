-- Impedisce ai client (ruolo authenticated) di modificare il piano
-- della propria organizzazione via REST/RLS. Il campo `plan` deve poter
-- essere cambiato solo da un processo server-side con service_role
-- (es. webhook di fatturazione), non dal proprietario dell'organizzazione
-- che oggi potrebbe auto-promuoversi a pro/studio con una PATCH diretta.
revoke update on public.organizations from authenticated;
grant update (name) on public.organizations to authenticated;
