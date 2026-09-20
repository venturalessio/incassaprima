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
- ~~**Blocco analytics/aging**~~ Fatto il 20/09/2026: la logica di
  calcolo (fasce di anzianità, top debitori) è stata estratta in
  `app/lib/analytics.js` (`computeAnalytics`), con 5 nuovi test;
  `renderAnalytics()` ora si occupa solo del rendering DOM.
- **Leaked password protection** disabilitata su Supabase Auth: va
  attivata manualmente dalla dashboard (Authentication → Policies),
  nessun tool disponibile per farlo via API/MCP.

## Funzionalità da costruire

- **Fatturazione reale dei piani Pro/Studio**: integrazione pagamenti
  (Stripe o simile) + webhook che aggiorna `organizations.plan` con
  `service_role` (oggi il campo è scrivibile solo da lì, per design).
- **Promemoria automatici via email** — infrastruttura completata il
  20/09/2026, **ma non ancora attivabile per clienti reali**. Funzione
  Edge `send-reminder-emails` pianificata (`pg_cron`, ogni giorno alle
  06:00 UTC) che genera le bozze di sollecito per tutte le
  organizzazioni (non serve più avere il browser aperto) e, per chi
  attiva il nuovo interruttore "Invia i solleciti automaticamente via
  email" nel modal Regole, invia davvero l'email tramite Resend.
  Dettagli tecnici completi in `supabase/README.md`. **Cosa manca
  prima di poterlo offrire davvero**:
  1. creare un account Resend e impostare `RESEND_API_KEY` come secret
     della funzione (oggi assente: senza, la funzione genera solo le
     bozze, non invia nulla — sicuro, nessun rischio ad aver
     distribuito l'infrastruttura in anticipo);
  2. **comprare/usare un dominio proprio e verificarlo su Resend**
     (record DNS SPF/DKIM) — senza dominio verificato le email
     arrivano solo alla propria casella Resend di test, mai a clienti
     reali (regola anti-phishing di tutti i provider email);
  3. impostare `CRON_SECRET` come secret della funzione (**obbligatorio
     anche solo per la generazione automatica delle bozze**: senza,
     il cron job gira ma la funzione rifiuta ogni chiamata con 401 —
     verificato dal vivo, comportamento fail-safe voluto).
  Fino ad allora il checkbox resta visibile ma esplicitamente etichettato
  come "contattaci prima di abilitarlo", e non è stato aggiunto
  all'elenco pubblico delle funzionalità Pro/Studio per non promettere
  qualcosa che il singolo utente non può ancora attivare da solo.
- ~~**Multi-utente per organizzazione**~~ Fatto il 20/09/2026: inviti
  via link (`?invite=<token>`) per aggiungere collaboratori a
  qualunque organizzazione (Pro, identità Studio o azienda gestita).
  Solo il proprietario può creare/vedere/revocare gli inviti (modal
  "Team" in-app); l'accettazione avviene tramite la funzione
  server-side `accept_organization_invite`, che verifica validità e
  scadenza e — per la v1 — **funziona solo per chi non ha ancora un
  account IncassaPrima**: chi ha già una propria organizzazione viene
  rifiutato con un errore esplicito (nessuno switcher
  multi-organizzazione). Un invito può opzionalmente essere legato a
  un indirizzo email specifico. Estendere a un vero multi-organizzazione
  è lavoro futuro, non necessario per il modello di business attuale.
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
- **Cancellazione/esportazione dati self-service** (bassa priorità).
  Oggi (vedi `privacy.html`) la cancellazione account e l'esportazione
  dei propri dati sono gestite manualmente scrivendo un'email — adeguato
  ai volumi attuali (pochi account di test) e comunque conforme ai
  termini di legge (risposta entro 30 giorni). Da costruire come
  funzionalità self-service (pulsante "Elimina account"/"Esporta i miei
  dati" nell'app, con relative funzioni server-side) quando il numero di
  utenti reali renderà insostenibile il processo manuale.
