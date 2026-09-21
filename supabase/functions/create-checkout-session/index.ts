import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

// Crea una sessione di Stripe Checkout per passare al piano Pro (unico
// piano offerto in self-service per ora — Studio resta ad attivazione
// manuale, vedi supabase/README.md). Chiamata da un utente autenticato
// (verify_jwt=true), non dal webhook.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_PRICE_ID_PRO = Deno.env.get("STRIPE_PRICE_ID_PRO");
const APP_URL = Deno.env.get("APP_URL") || "https://venturalessio.github.io/incassaprima/app/";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Metodo non consentito." }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Non autenticato." }, 401);

  const supabaseAsUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data: userData, error: userError } = await supabaseAsUser.auth.getUser();
  if (userError || !userData?.user) return jsonResponse({ error: "Sessione non valida." }, 401);

  let body: { plan?: string; organization_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corpo della richiesta non valido." }, 400);
  }

  if (body.plan !== "pro") {
    return jsonResponse(
      { error: "Il checkout automatico è disponibile solo per il piano Pro. Per Studio contattaci." },
      400
    );
  }

  if (!body.organization_id) {
    return jsonResponse({ error: "Organizzazione mancante." }, 400);
  }

  if (!stripe || !STRIPE_PRICE_ID_PRO) {
    return jsonResponse(
      { error: "I pagamenti non sono ancora configurati. Riprova più tardi o contattaci." },
      503
    );
  }

  const supabaseService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: membership, error: membershipError } = await supabaseService
    .from("organization_members")
    .select("role, organizations(id, name, plan, managed_by, stripe_customer_id)")
    .eq("user_id", userData.user.id)
    .eq("organization_id", body.organization_id)
    .maybeSingle();

  if (membershipError) return jsonResponse({ error: membershipError.message }, 500);
  if (!membership || membership.role !== "owner") {
    return jsonResponse({ error: "Non sei il proprietario di questa organizzazione." }, 403);
  }

  const organization = membership.organizations as any;
  if (organization.managed_by !== null || organization.plan === "studio") {
    return jsonResponse({ error: "Questa organizzazione non può passare al piano Pro." }, 400);
  }

  let customerId: string | null = organization.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userData.user.email,
      name: organization.name,
      metadata: { organization_id: organization.id }
    });
    customerId = customer.id;

    await supabaseService
      .from("organizations")
      .update({ stripe_customer_id: customerId })
      .eq("id", organization.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: STRIPE_PRICE_ID_PRO, quantity: 1 }],
    success_url: `${APP_URL}?checkout=success`,
    cancel_url: `${APP_URL}?checkout=cancelled`,
    metadata: { organization_id: organization.id, target_plan: "pro" },
    subscription_data: {
      metadata: { organization_id: organization.id, target_plan: "pro" }
    }
  });

  return jsonResponse({ url: session.url });
});
