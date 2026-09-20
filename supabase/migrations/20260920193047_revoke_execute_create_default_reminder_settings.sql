-- create_default_reminder_settings() è un trigger (returns trigger):
-- Postgres rifiuta di eseguirlo al di fuori del contesto di un trigger
-- qualunque sia il chiamante o i privilegi, quindi il Security Advisor
-- segnala un accesso teorico ma non sfruttabile. Revocato comunque per
-- pulizia, seguendo la prassi già adottata per le altre funzioni.
revoke all on function public.create_default_reminder_settings() from public;
revoke execute on function public.create_default_reminder_settings() from anon, authenticated;
