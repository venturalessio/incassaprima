-- Passaggio da Stripe a Paddle come piattaforma di pagamento (Merchant of
-- Record): stesse colonne e stesso modello di grant (bloccate, solo
-- service_role puo' scriverle), solo rinominate per riflettere il nuovo
-- fornitore. Nessun dato reale da migrare: l'integrazione Stripe non e'
-- mai stata attivata in produzione (nessuna chiave reale configurata,
-- nessun cliente pagante).
alter table public.organizations rename column stripe_customer_id to paddle_customer_id;
alter table public.organizations rename column stripe_subscription_id to paddle_subscription_id;
alter table public.organizations rename column stripe_subscription_status to paddle_subscription_status;

alter table public.organizations rename constraint organizations_stripe_customer_id_key to organizations_paddle_customer_id_key;
alter table public.organizations rename constraint organizations_stripe_subscription_id_key to organizations_paddle_subscription_id_key;
