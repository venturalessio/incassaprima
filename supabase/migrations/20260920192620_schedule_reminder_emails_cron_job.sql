-- Pianifica l'esecuzione giornaliera della funzione send-reminder-emails
-- (genera le bozze di sollecito mancanti per tutte le organizzazioni e,
-- per quelle con automatic_email_enabled=true, invia davvero l'email).
--
-- Autenticazione verso la funzione: un segreto condiviso nell'header
-- x-cron-secret (la funzione è distribuita con verify_jwt=false e lo
-- confronta con la propria variabile d'ambiente CRON_SECRET, da impostare
-- manualmente nel progetto — vedi supabase/README.md). Non usa la
-- service_role key: se questo comando viene letto da chi ha accesso al
-- database, il danno massimo possibile è un'esecuzione anticipata/extra
-- della funzione stessa (idempotente e innocua), non un accesso più ampio.
--
-- NOTA: il valore reale di x-cron-secret applicato in produzione NON è
-- questo placeholder — è stato generato con gen_random_uuid() al momento
-- della migrazione ed è volutamente omesso da questo file per non
-- versionare un segreto nel repository, anche se a basso rischio. Il
-- valore reale è impostato anche come secret CRON_SECRET della funzione
-- (vedi supabase/README.md per la procedura di rotazione/allineamento).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-reminder-emails-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://dxlmtihwvcqstrxwzapj.supabase.co/functions/v1/send-reminder-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '__REDACTED_SEE_NOTE_ABOVE__'
    ),
    body := '{}'::jsonb
  );
  $$
);
