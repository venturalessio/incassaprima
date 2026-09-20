CREATE INDEX IF NOT EXISTS idx_invoices_organization_status
  ON public.invoices (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_invoices_organization_created_at
  ON public.invoices (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_customer_id
  ON public.invoices (customer_id);

CREATE INDEX IF NOT EXISTS idx_reminders_invoice_id
  ON public.reminders (invoice_id);

CREATE INDEX IF NOT EXISTS idx_reminders_invoice_status
  ON public.reminders (invoice_id, status);

CREATE INDEX IF NOT EXISTS idx_invoice_activity_log_organization_created_at
  ON public.invoice_activity_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_activity_log_invoice_created_at
  ON public.invoice_activity_log (invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_organization_members_user_organization
  ON public.organization_members (user_id, organization_id);
