import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

// Crea una sessione del Billing Portal di Stripe (gestione/annullamento
// self-service dell'abbonamento) per l'organizzazione indicata. Chiamata
// da un utente autenticato (verify_jwt=true).

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
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

  let body: { organization_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corpo della richiesta non valido." }, 400);
  }

  if (!body.organization_id) return jsonResponse({ error: "Organizzazione mancante." }, 400);

  if (!stripe) {
    return jsonResponse({ error: "I pagamenti non sono ancora configurati." }, 503);
  }

  const supabaseService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: membership, error: membershipError } = await supabaseService
    .from("organization_members")
    .select("role, organizations(stripe_customer_id)")
    .eq("user_id", userData.user.id)
    .eq("organization_id", body.organization_id)
    .maybeSingle();

  if (membershipError) return jsonResponse({ error: membershipError.message }, 500);
  if (!membership || membership.role !== "owner") {
    return jsonResponse({ error: "Non sei il proprietario di questa organizzazione." }, 403);
  }

  const customerId = (membership.organizations as any)?.stripe_customer_id;
  if (!customerId) {
    return jsonResponse({ error: "Nessun abbonamento attivo trovato per questa organizzazione." }, 400);
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: APP_URL
  });

  return jsonResponse({ url: portalSession.url });
});
