-- Mantiene inalterata la logica RLS; evita la rivalutazione per-riga di auth.uid().
DROP POLICY IF EXISTS "Members can add reminders" ON public.reminders;
CREATE POLICY "Members can add reminders"
ON public.reminders
FOR INSERT
TO authenticated
WITH CHECK (
  (created_by = (select auth.uid()))
  AND EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.id = reminders.invoice_id
      AND is_organization_member(i.organization_id)
  )
);

DROP POLICY IF EXISTS "Members can add invoice activity" ON public.invoice_activity_log;
CREATE POLICY "Members can add invoice activity"
ON public.invoice_activity_log
FOR INSERT
TO authenticated
WITH CHECK (
  is_organization_member(organization_id)
  AND (actor_user_id = (select auth.uid()))
);

DROP POLICY IF EXISTS "Members can add activity log" ON public.activity_log;
CREATE POLICY "Members can add activity log"
ON public.activity_log
FOR INSERT
TO authenticated
WITH CHECK (
  (user_id = (select auth.uid()))
  AND is_organization_member(organization_id)
);
