# Roadmap — prossimi passi

Elenco di lavoro non ancora fatto, tenuto aggiornato mano a mano che si
procede. Non è un impegno di scadenze, solo memoria condivisa tra le
sessioni di sviluppo.

## Debiti tecnici / bug noti

- **Migrazione Pro → Studio con dati già esistenti.** Se un'organizzazione
  che ha già clienti/fatture viene promossa a `plan = 'studio'`, quei dati
  restano "intrappolati" nell'identità Studio (che l'app non carica più
  come area di lavoro). Successo una volta il 20/09/2026 sull'account di
  test, corretto manualmente (nuova identità Studio + organizzazione
  esistente riassegnata come azienda gestita via `managed_by`, dati
  intatti). **Priorità bassa**: il modello di business previsto è che le
  aziende comprino il piano Pro direttamente (raramente passano a Studio
  in seguito) e i commercialisti si registrino fin da subito come Studio.
  Se il caso si ripresenta, ripetere lo stesso intervento manuale finché
  non vale la pena costruire un flusso automatico di conversione.
- ~~**Vista aggregata Studio.**~~ Fatto il 20/09/2026: lo switcher mostra
  ora un riepilogo aggregato ("da incassare"/"scaduto" su tutte le
  aziende insieme) più i due totali per ogni singola azienda.
- ~~**Copy marketing "Studio"**~~ Fatto il 20/09/2026: landing pubblica e
  modal Piani in-app riscritti per riflettere esattamente le funzionalità
  reali di Free/Pro/Studio (aggiunta anche la card Studio, prima assente
  dalla landing pubblica).
- **Blocco analytics/aging** in `app/app.js` (funzione intorno alle righe
  3100-3180) ancora inline nel render, non estratto in `app/lib/` — buon
  prossimo candidato per continuare il lavoro di modularizzazione/test
  iniziato con `format.js`/`invoices.js`/`csv.js`.
- **Leaked password protection** disabilitata su Supabase Auth: va
  attivata manualmente dalla dashboard (Authentication → Policies),
  nessun tool disponibile per farlo via API/MCP.

## Funzionalità da costruire

- **Fatturazione reale dei piani Pro/Studio**: integrazione pagamenti
  (Stripe o simile) + webhook che aggiorna `organizations.plan` con
  `service_role` (oggi il campo è scrivibile solo da lì, per design).
- **Promemoria automatici via email**: Edge Function + servizio email
  (Resend/SendGrid o simile) + cron che rispetti
  `organization_reminder_settings` (colonne già pronte nel DB, nessuna
  automazione dietro).
- **Multi-utente per organizzazione**: oggi `organization_members` non ha
  un modo per invitare colleghi oltre al proprietario creato alla
  registrazione — serve un flusso di invito (email + accettazione).
- ~~**Rinominare/eliminare un'azienda dall'interfaccia**~~ Fatto il
  20/09/2026: dallo switcher Studio si può rinominare sia l'identità
  Studio sia ogni azienda gestita (semplice UPDATE, le RLS lo
  permettevano già), ed eliminare un'azienda gestita (clienti, fatture
  e storico compresi) tramite la funzione server-side
  `delete_managed_company`, che richiede di scrivere il nome esatto
  come conferma e non permette mai di eliminare l'identità Studio.
- **Inserimento fatture tramite fotocamera** (bassa priorità). A costo
  zero è realizzabile solo in versione "assistita": OCR interamente
  client-side (es. Tesseract.js, nessuna chiamata a pagamento) che
  legge il testo della foto e prova a pre-compilare cliente/importo/
  data con euristiche, ma con precisione molto inferiore a uno scanner
  (angolazioni, luce, formati di fattura tutti diversi) — l'utente
  dovrà quasi sempre correggere qualcosa. Un vero "punta e si compila
  da sola" richiede un servizio OCR/AI a pagamento (Google Vision,
  Mindee, un modello vision). Da valutare solo dopo le voci sopra, che
  portano più valore diretto per lo sforzo richiesto.
