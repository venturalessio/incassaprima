import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Riceve gli eventi Paddle (sottoscrizione creata/aggiornata/cancellata) e
// aggiorna organizations di conseguenza. Non richiede un JWT utente
// (chiamata da Paddle, non dal browser): distribuita con verify_jwt=false
// e autenticata invece verificando la firma della richiesta con
// PADDLE_WEBHOOK_SECRET (header Paddle-Signature: ts=...;h1=..., dove h1 è
// l'HMAC-SHA256 esadecimale di "ts:rawBody" — vedi
// developer.paddle.com/webhooks/about/signature-verification).
//
// Per ora gestisce solo il piano Pro (unico offerto in self-service).
// Se in futuro il checkout Studio arriverà qui con
// custom_data.target_plan === 'studio', andrà chiamata upgrade_to_studio
// con l'utente proprietario corretto invece di limitarsi a un update.

const PADDLE_WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Stati che chiudono davvero l'abbonamento: si torna al piano Free.
// "past_due" è escluso di proposito: è un tentativo di addebito fallito in
// corso di ripetizione (Paddle Retain ritenta automaticamente), non
// revochiamo l'accesso su un singolo fallimento. "paused" è incluso: un
// abbonamento in pausa non sta generando incassi, quindi non ha senso
// mantenere l'accesso Pro nel frattempo.
const DOWNGRADE_STATUSES = new Set(["canceled", "paused"]);

// Tolleranza sul timestamp della firma: protegge dai replay senza essere
// troppo rigida su ritardi di rete/orologio (stesso ordine di grandezza
// usato da altri provider di webhook).
const SIGNATURE_TOLERANCE_SECONDS = 300;

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function verifyPaddleSignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;

  const parts: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [key, value] = part.split("=");
    if (key && value) parts[key] = value;
  }

  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return false;

  const tsNumber = Number(ts);
  if (!Number.isFinite(tsNumber) || Math.abs(Date.now() / 1000 - tsNumber) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${rawBody}`));
  const expectedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqualHex(expectedHex, h1);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Metodo non consentito.", { status: 405 });

  if (!PADDLE_WEBHOOK_SECRET) {
    return new Response("Webhook non configurato.", { status: 503 });
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("paddle-signature");

  const isValid = await verifyPaddleSignature(rawBody, signatureHeader, PADDLE_WEBHOOK_SECRET);
  if (!isValid) return new Response("Firma non valida.", { status: 400 });

  let event: { event_type?: string; data?: any };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Corpo non valido.", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  switch (event.event_type) {
    case "subscription.created": {
      const subscription = event.data;
      const organizationId = subscription?.custom_data?.organization_id;
      const targetPlan = subscription?.custom_data?.target_plan;

      if (!organizationId || targetPlan !== "pro") break;

      await supabase
        .from("organizations")
        .update({
          plan: "pro",
          paddle_customer_id: subscription.customer_id,
          paddle_subscription_id: subscription.id,
          paddle_subscription_status: subscription.status
        })
        .eq("id", organizationId);

      break;
    }

    case "subscription.updated": {
      const subscription = event.data;

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("paddle_subscription_id", subscription.id)
        .maybeSingle();

      if (!org) break;

      const updates: Record<string, unknown> = { paddle_subscription_status: subscription.status };
      if (DOWNGRADE_STATUSES.has(subscription.status)) {
        updates.plan = "free";
      }

      await supabase.from("organizations").update(updates).eq("id", org.id);
      break;
    }

    case "subscription.canceled": {
      const subscription = event.data;

      await supabase
        .from("organizations")
        .update({ plan: "free", paddle_subscription_status: "canceled" })
        .eq("paddle_subscription_id", subscription.id);

      break;
    }

    default:
      break;
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" }
  });
});
