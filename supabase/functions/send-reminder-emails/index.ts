import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { today } from "./lib/format.js";
import { fillTemplate } from "./lib/invoices.js";
import { isEligibleForAutomaticReminder, suggestedAutomaticModel } from "./lib/reminders.js";
import { reminderModels } from "./lib/templates.js";

// Funzione pianificata (pg_cron, vedi migrazione schedule_reminder_emails_cron_job)
// che ogni giorno, per ogni organizzazione:
//  1) genera le bozze di sollecito mancanti (stessa logica di
//     generateScheduledReminders() lato client, così i promemoria non
//     dipendono più dall'avere il browser aperto);
//  2) se l'organizzazione ha attivato l'invio automatico
//     (organization_reminder_settings.automatic_email_enabled), invia
//     davvero l'email tramite Resend invece di lasciarla in coda di
//     approvazione.
//
// Autenticazione: non richiede un JWT utente (viene chiamata da pg_cron,
// non da un browser). Verifica invece un segreto condiviso nell'header
// x-cron-secret, confrontato con CRON_SECRET — per questo la funzione va
// distribuita con verify_jwt=false.

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const REMINDER_FROM_EMAIL = Deno.env.get("REMINDER_FROM_EMAIL") || "IncassaPrima <onboarding@resend.dev>";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const referenceDate = today();

  const summary = {
    organizationsProcessed: 0,
    remindersCreated: 0,
    emailsSent: 0,
    emailsFailed: 0,
    errors: [] as string[]
  };

  const { data: settingsRows, error: settingsError } = await supabase
    .from("organization_reminder_settings")
    .select(
      "organization_id, first_reminder_after_days, second_reminder_after_days, automatic_email_enabled, organizations(name)"
    );

  if (settingsError) {
    return new Response(JSON.stringify({ error: settingsError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  for (const settings of settingsRows ?? []) {
    summary.organizationsProcessed += 1;
    try {
      await processOrganization(supabase, settings, referenceDate, summary);
    } catch (err) {
      summary.errors.push(
        `org ${settings.organization_id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return new Response(JSON.stringify(summary), {
    headers: { "Content-Type": "application/json" }
  });
});

async function processOrganization(
  supabase: ReturnType<typeof createClient>,
  settings: any,
  referenceDate: string,
  summary: {
    remindersCreated: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }
) {
  const organizationId = settings.organization_id;

  const { data: invoices, error: invoicesError } = await supabase
    .from("invoices")
    .select(
      "id, status, due_date, amount_cents, invoice_number, promised_payment_date, customers(name, email, reminders_paused)"
    )
    .eq("organization_id", organizationId);

  if (invoicesError) throw new Error(invoicesError.message);
  if (!invoices?.length) return;

  const invoiceIds = invoices.map((invoice: any) => invoice.id);

  const { data: existingReminders, error: remindersError } = await supabase
    .from("reminders")
    .select("invoice_id, template_key, status")
    .in("invoice_id", invoiceIds);

  if (remindersError) throw new Error(remindersError.message);

  const alreadyHandled = new Set(
    (existingReminders ?? [])
      .filter((r: any) => r.status !== "cancelled")
      .map((r: any) => `${r.invoice_id}:${r.template_key}`)
  );

  let ownerEmail: string | null | undefined;

  for (const invoice of invoices as any[]) {
    const customer = invoice.customers
      ? { reminders_paused: invoice.customers.reminders_paused }
      : null;

    const invoiceForLogic = {
      ...invoice,
      customer_name: invoice.customers?.name,
      customer_email: invoice.customers?.email
    };

    if (!isEligibleForAutomaticReminder(invoiceForLogic, customer, referenceDate)) continue;

    const templateKey = suggestedAutomaticModel(invoiceForLogic, settings, referenceDate);
    if (!templateKey) continue;

    const key = `${invoice.id}:${templateKey}`;
    if (alreadyHandled.has(key)) continue;

    const template = (reminderModels as any)[templateKey];
    const subject = fillTemplate(template.subject, invoiceForLogic, referenceDate);
    const body = fillTemplate(template.body, invoiceForLogic, referenceDate);
    const recipientEmail: string | null = invoiceForLogic.customer_email || null;

    const baseReminder = {
      invoice_id: invoice.id,
      template_key: templateKey,
      channel: "email",
      subject_snapshot: subject,
      body_snapshot: body,
      recipient_email: recipientEmail,
      created_by: null as string | null
    };

    if (!settings.automatic_email_enabled) {
      // Stessa logica lato client: crea solo la bozza per la coda di
      // approvazione, nessun invio reale.
      const { error } = await supabase.from("reminders").insert({
        ...baseReminder,
        status: "scheduled",
        scheduled_at: new Date().toISOString()
      });
      if (!error) summary.remindersCreated += 1;
      else summary.errors.push(`reminder ${invoice.id}: ${error.message}`);
      continue;
    }

    if (!recipientEmail) {
      await supabase.from("reminders").insert({
        ...baseReminder,
        status: "failed",
        error_message: "Il cliente non ha un indirizzo email."
      });
      summary.emailsFailed += 1;
      continue;
    }

    if (!RESEND_API_KEY) {
      await supabase.from("reminders").insert({
        ...baseReminder,
        status: "failed",
        error_message: "Invio automatico non configurato (RESEND_API_KEY mancante)."
      });
      summary.emailsFailed += 1;
      continue;
    }

    if (ownerEmail === undefined) {
      ownerEmail = await fetchOwnerEmail(supabase, organizationId);
    }

    const organizationName = settings.organizations?.name || "IncassaPrima";
    const sendResult = await sendReminderEmail({
      to: recipientEmail,
      subject,
      body,
      replyTo: ownerEmail || undefined,
      organizationName
    });

    if (sendResult.ok) {
      await supabase.from("reminders").insert({
        ...baseReminder,
        status: "sent",
        sent_at: new Date().toISOString()
      });
      await supabase.from("invoice_activity_log").insert({
        organization_id: organizationId,
        invoice_id: invoice.id,
        actor_user_id: null,
        event_type: "reminder_auto_sent",
        message: `Sollecito automatico "${template.label}" inviato via email.`,
        metadata: { template_key: templateKey, recipient_email: recipientEmail }
      });
      summary.emailsSent += 1;
    } else {
      await supabase.from("reminders").insert({
        ...baseReminder,
        status: "failed",
        error_message: sendResult.error
      });
      await supabase.from("invoice_activity_log").insert({
        organization_id: organizationId,
        invoice_id: invoice.id,
        actor_user_id: null,
        event_type: "reminder_auto_failed",
        message: `Invio automatico del sollecito "${template.label}" non riuscito: ${sendResult.error}`,
        metadata: { template_key: templateKey, recipient_email: recipientEmail }
      });
      summary.emailsFailed += 1;
    }
  }
}

async function fetchOwnerEmail(
  supabase: ReturnType<typeof createClient>,
  organizationId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const { data: userData } = await supabase.auth.admin.getUserById(data.user_id);
  return userData?.user?.email || null;
}

async function sendReminderEmail({
  to,
  subject,
  body,
  replyTo,
  organizationName
}: {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  organizationName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: REMINDER_FROM_EMAIL,
        to: [to],
        reply_to: replyTo,
        subject,
        text: `${body}\n\n—\nPromemoria automatico inviato tramite IncassaPrima per conto di ${organizationName}.`
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { ok: false, error: `Resend ${response.status}: ${errorBody.slice(0, 300)}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
