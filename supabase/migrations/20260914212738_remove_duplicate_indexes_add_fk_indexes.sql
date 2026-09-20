-- Rimuove solo gli indici duplicati creati dalla migrazione precedente.
DROP INDEX IF EXISTS public.idx_invoices_customer_id;
DROP INDEX IF EXISTS public.idx_invoice_activity_log_organization_created_at;
DROP INDEX IF EXISTS public.idx_invoice_activity_log_invoice_created_at;

-- Aggiunge indici per le chiavi esterne segnalate dal Performance Advisor.
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id
  ON public.activity_log (user_id);

CREATE INDEX IF NOT EXISTS idx_invoice_activity_log_actor_user_id
  ON public.invoice_activity_log (actor_user_id);

CREATE INDEX IF NOT EXISTS idx_reminders_created_by
  ON public.reminders (created_by);
