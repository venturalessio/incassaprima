import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

// Riceve gli eventi Stripe (checkout completato, abbonamento aggiornato o
// cancellato) e aggiorna organizations di conseguenza. Non richiede un JWT
// utente (chiamata da Stripe, non dal browser): distribuita con
// verify_jwt=false e autenticata invece verificando la firma della
// richiesta con STRIPE_WEBHOOK_SECRET.
//
// Per ora gestisce solo il piano Pro (unico offerto in self-service).
// Se in futuro il checkout Studio arriverà qui con
// metadata.target_plan === 'studio', andrà chiamata upgrade_to_studio
// con l'utente proprietario corretto invece di limitarsi a un update.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// Stati che chiudono davvero l'abbonamento: si torna al piano Free.
// "past_due" è escluso di proposito: è un tentativo di addebito fallito in
// corso di ripetizione, non revochiamo l'accesso su un singolo fallimento.
const DOWNGRADE_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Metodo non consentito.", { status: 405 });

  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return new Response("Webhook non configurato.", { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Firma mancante.", { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`Firma non valida: ${err instanceof Error ? err.message : String(err)}`, {
      status: 400
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const organizationId = session.metadata?.organization_id;
      const targetPlan = session.metadata?.target_plan;

      if (!organizationId || targetPlan !== "pro") break;

      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;

      await supabase
        .from("organizations")
        .update({
          plan: "pro",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          stripe_subscription_status: "active"
        })
        .eq("id", organizationId);

      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle();

      if (!org) break;

      const updates: Record<string, unknown> = { stripe_subscription_status: subscription.status };
      if (DOWNGRADE_STATUSES.has(subscription.status)) {
        updates.plan = "free";
      }

      await supabase.from("organizations").update(updates).eq("id", org.id);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;

      await supabase
        .from("organizations")
        .update({ plan: "free", stripe_subscription_status: "canceled" })
        .eq("stripe_subscription_id", subscription.id);

      break;
    }

    default:
      break;
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" }
  });
});
