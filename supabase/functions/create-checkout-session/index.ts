import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Sostituita dall'integrazione Paddle (vedi create-paddle-transaction e
// paddle-webhook in questo stesso progetto). Non è stato possibile
// eliminare questa funzione con gli strumenti a disposizione, quindi resta
// distribuita come stub inerte: nessun segreto Stripe è più configurato e
// risponde sempre 410 Gone.
Deno.serve(() =>
  new Response("Questa funzione è stata dismessa: l'integrazione pagamenti ora usa Paddle.", { status: 410 })
);
