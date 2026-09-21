import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Crea una transazione Paddle (l'equivalente di una Stripe Checkout
// Session) per passare al piano Pro. Il client apre poi il checkout
// overlay di Paddle.js passando l'id restituito qui: organization_id e
// target_plan finiscono in custom_data lato server (quindi fidati), non
// possono essere manomessi dal browser come accadrebbe passandoli
// direttamente al checkout lato client. Chiamata da un utente
// autenticato (verify_jwt=true).

const PADDLE_API_KEY = Deno.env.get("PADDLE_API_KEY");
const PADDLE_PRICE_ID_PRO = Deno.env.get("PADDLE_PRICE_ID_PRO");
const PADDLE_ENVIRONMENT = Deno.env.get("PADDLE_ENVIRONMENT") || "sandbox";
const PADDLE_API_BASE =
  PADDLE_ENVIRONMENT === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  if (!PADDLE_API_KEY || !PADDLE_PRICE_ID_PRO) {
    return jsonResponse(
      { error: "I pagamenti non sono ancora configurati. Riprova più tardi o contattaci." },
      503
    );
  }

  const supabaseService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: membership, error: membershipError } = await supabaseService
    .from("organization_members")
    .select("role, organizations(id, name, plan, managed_by, paddle_customer_id)")
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

  const transactionBody: Record<string, unknown> = {
    items: [{ price_id: PADDLE_PRICE_ID_PRO, quantity: 1 }],
    custom_data: { organization_id: organization.id, target_plan: "pro" }
  };
  if (organization.paddle_customer_id) {
    transactionBody.customer_id = organization.paddle_customer_id;
  }

  const paddleResponse = await fetch(`${PADDLE_API_BASE}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PADDLE_API_KEY}`,
      "Content-Type": "application/json",
      "Paddle-Version": "1"
    },
    body: JSON.stringify(transactionBody)
  });

  if (!paddleResponse.ok) {
    const errorBody = await paddleResponse.text();
    console.error("Errore creazione transazione Paddle:", errorBody);
    return jsonResponse({ error: "Impossibile avviare il pagamento. Riprova più tardi." }, 502);
  }

  const paddleData = await paddleResponse.json();
  const transactionId = paddleData?.data?.id;
  if (!transactionId) return jsonResponse({ error: "Risposta inattesa da Paddle." }, 502);

  return jsonResponse({ transaction_id: transactionId });
});
