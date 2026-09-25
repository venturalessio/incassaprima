# Roadmap — prossimi passi

Elenco di lavoro non ancora fatto, tenuto aggiornato mano a mano che si
procede. Non è un impegno di scadenze, solo memoria condivisa tra le
sessioni di sviluppo.

## Debiti tecnici / bug noti

- ~~**Header sempre "IncassaPrima Pro"**~~ Fatto il 22/09/2026: la
  scritta in alto a sinistra era statica, "Pro" per chiunque a
  prescindere dal piano reale. Aggiunta `planLabel()` in `app/app.js`
  (stessa logica di `hasPaidFeatures()`: un'azienda gestita da
  un'identità Studio mostra "Studio", non il proprio `org.plan` che è
  sempre `'free'`) e collegata a `updateFeaturesByPlan()`, già la
  funzione centrale chiamata a ogni cambio di sessione/organizzazione.
  Testo e colore cambiano tra Free (grigio, `var(--muted)`), Pro (blu,
  `var(--blue)`) e Studio (viola, `var(--violet)`) — riferimento visivo
  immediato sul piano attivo. Verificato con Playwright in modalità
  locale: mostra "Free" in grigio, come atteso.
- ~~**Nessun gating reale delle funzionalità per piano.**~~ Scoperto e
  **risolto lato client il 22/09/2026**. Scoperto testando un account
  tornato a `plan='free'`: Regole automatiche, Analisi incassi,
  import/export e anagrafica Clienti (tutte pensate come Pro/Studio,
  vedi `app/index.html` e la landing) restavano completamente
  accessibili a un utente Free loggato — nessun controllo su `org.plan`
  esisteva in `app/app.js`/`app/lib/*.js` (a parte i due usi per il
  badge Studio e il modal Piani), né nelle policy RLS su Postgres.
  Deciso con l'utente: (1) il sync cloud base resta disponibile a
  tutti gli utenti loggati anche Free (solo fatture/scadenze/3 modelli
  sollecito/rilevamento duplicati); (2) il gating per ora è **solo lato
  client** (niente RLS), accettando che un utente esperto possa
  aggirarlo da console — nessun dato sensibile è comunque in gioco,
  le RLS esistenti restano invariate. Aggiunto `hasPaidFeatures()`
  (`org.plan === 'pro' || 'studio'` oppure `org.managed_by` impostato,
  così un'azienda gestita da un'identità Studio eredita l'accesso
  dall'abbonamento dell'identità) e usato per: nascondere i pulsanti
  Regole/coda di approvazione/Analisi incassi/Clienti/Team/Esporta
  CSV/Importa file (`updateFeaturesByPlan()`, già la funzione centrale
  chiamata a ogni cambio di sessione/organizzazione) **e** come
  guardia difensiva dentro ognuna delle funzioni corrispondenti
  (`openRules`, `openApprovalQueue`, `openAnalytics`, `openCustomers`,
  `openTeam`, `exportCsv`, `importFile`), con un toast che rimanda al
  modal Piani. "Rileva duplicati" resta sempre visibile (è una
  funzionalità Free). Verificato con Playwright in modalità locale
  (nessun login) e poi **dal vivo con un account cloud Free reale**
  (nuova registrazione `ventura.alessio+free@gmail.com`, confermata
  via email dall'utente): barra ridotta a
  Guida/Piani/"Esci dal cloud"/"Rileva duplicati"/"Azzera dati locali",
  nessun pulsante Pro/Studio visibile — confermato anche sul database
  (`plan='free'`, `managed_by=null`, come atteso per una registrazione
  nuova). **Resta da fare**: valutare se/quando aggiungere anche policy
  RLS lato server, per ora accettato come rischio noto.
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
- ~~**Landing: CTA Studio verso il form di richiesta**~~ Fatto il
  22/09/2026: con Studio ora self-service (vedi sopra), il CTA "Voglio
  testare Studio" puntava ancora al form "lascia i tuoi dati, ti
  contattiamo noi per attivare Studio" — fuorviante, dato che basta
  creare un account gratis nell'app e passare a Studio dal modal Piani
  senza aspettare nessuno. Cambiato il link della card Studio su
  `index.html` da `#richiedi-accesso` ad `app/` (come Pro), e riscritta
  la sezione del form da "STUDIO SU RICHIESTA" a un contatto generico
  ("Hai domande?"). Rimosso anche il piccolo script che precompilava il
  campo "Piano di interesse" del form al click sulla card Studio,
  ormai senza più nessun link che lo attivi.
- ~~**Blocco analytics/aging**~~ Fatto il 20/09/2026: la logica di
  calcolo (fasce di anzianità, top debitori) è stata estratta in
  `app/lib/analytics.js` (`computeAnalytics`), con 5 nuovi test;
  `renderAnalytics()` ora si occupa solo del rendering DOM.
- **Leaked password protection** disabilitata su Supabase Auth: va
  attivata manualmente dalla dashboard (Authentication → Policies),
  nessun tool disponibile per farlo via API/MCP.

## Funzionalità da costruire

- ~~**Fatturazione reale del piano Pro**~~ Fatto il 21/09/2026:
  checkout self-service via **Paddle** (Merchant of Record). Prima
  versione era su Stripe, integrata e mergiata lo stesso giorno, poi
  sostituita su richiesta esplicita dell'utente prima di andare live
  (vedi sotto "Perché Paddle e non Stripe"): nessun cliente reale è mai
  passato dall'integrazione Stripe. Tre funzioni Edge
  (`create-paddle-transaction`, `create-portal-session`,
  `paddle-webhook`) + colonne `paddle_customer_id`/
  `paddle_subscription_id`/`paddle_subscription_status` su
  `organizations` (le prime due bloccate, solo `service_role`) +
  funzione `upgrade_to_studio` (pronta per il self-service Studio
  futuro, testata dal vivo con dati usa e getta, vedi sotto — non
  legata a una piattaforma di pagamento specifica, non ha richiesto
  modifiche nel passaggio a Paddle). In-app: pulsante "Piani" in header
  (il modal esisteva già ma non era mai stato collegato a nessun
  pulsante), CTA "Passa a Pro" nel modal Piani (apre il checkout overlay
  di Paddle.js, senza uscire dalla pagina), "Gestisci abbonamento" per
  chi ha già un piano a pagamento attivo.
  - **Perché Paddle e non Stripe**: la prima integrazione (mergiata,
    poi sostituita) usava Stripe, scelto perché i clienti italiani B2B
    si aspettano una fattura elettronica SdI vera. Approfondendo però è
    emerso che le aziende italiane comprano regolarmente SaaS esteri
    (Notion, Slack, Figma, AWS...) senza fattura SdI, gestiti dal
    commercialista con reverse charge/autofattura — un attrito minore
    di quanto stimato. Il vantaggio di un Merchant of Record (Paddle
    emette lui la fattura al cliente finale e gestisce IVA/sales tax
    nelle varie giurisdizioni) ha quindi prevalso, soprattutto senza
    partita IVA aperta. **Attenzione**: un MoR non elimina l'obbligo
    fiscale sul reddito percepito dai payout — da concordare comunque
    con un commercialista, vedi punto "Partita IVA" sotto.
  - ~~**Studio self-service**~~ Fatto e **verificato end-to-end con un
    acquisto vero il 22/09/2026** (vedi sotto). Checkout iniziale
    Studio con lo stesso circuito di Pro: `create-paddle-transaction`
    accetta `plan: 'studio'` e crea la transazione con il solo prezzo
    base (quantity 1) — `upgrade_to_studio` parte sempre da 1 azienda
    gestita, quindi non serve calcolare aziende extra in fase di primo
    checkout. Il webhook (`subscription.created`), per
    `target_plan === 'studio'`, chiama `upgrade_to_studio(organization_id,
    owner_user_id)` (letto da `custom_data`, impostato server-side) e
    salva i campi `paddle_*` sulla **nuova organizzazione identità**
    restituita, non su quella di partenza (che diventa `managed_by`,
    `plan='free'`). Offerto anche da Pro (non solo da Free), come
    permesso da `upgrade_to_studio` stesso. **Cancellazione**: decisione
    presa esplicitamente con l'utente — l'organizzazione identità torna
    a `plan='free'`, le aziende gestite restano nel database intatte ma
    inaccessibili (`managed_by` invariato) finché non si riattiva
    l'abbonamento o si risolve manualmente; nessuna eliminazione
    automatica di dati. In-app: modal Piani offre "Passa a Studio —
    €19/mese" accanto a "Passa a Pro"/"Gestisci abbonamento", a seconda
    del piano corrente.
    - **Collaudo in due fasi**: prima verificata a livello di database
      (organizzazione e utente usa e getta, creati e poi eliminati)
      la logica `upgrade_to_studio` + aggiornamento `paddle_*` sulla
      nuova identità — risultato corretto. Poi, impostato il secret
      `PADDLE_PRICE_ID_STUDIO` (live), **acquisto Studio vero (€19) fatto
      dall'app** con l'account di test: pagamento completato, email di
      conferma con fattura ricevuta da Paddle, piano passato
      correttamente a Studio sulla nuova organizzazione identità,
      organizzazione di partenza riassegnata come azienda gestita.
      Circuito end-to-end confermato: checkout → pagamento →
      webhook → `upgrade_to_studio`. Abbonamento di test poi annullato
      dal Customer Portal Paddle (resta `active` fino a fine periodo
      già pagato — stesso comportamento già visto con Pro, il downgrade
      a Free scatterà automaticamente al termine).
    - **Bug scoperto durante questo collaudo (non nel codice nuovo)**:
      l'organizzazione di test usata per il primissimo collaudo Pro in
      sandbox aveva ancora `paddle_customer_id`/`paddle_subscription_id`
      sandbox residui nel database dopo il passaggio a Paddle live.
      `create-paddle-transaction` li passava correttamente a Paddle
      (comportamento voluto: riusa il customer esistente), ma Paddle
      live rispondeva `404 customer not found` perché quell'id esisteva
      solo in sandbox — da qui un primo tentativo fallito ("impossibile
      avviare il pagamento"). Risolto ripulendo a mano i campi `paddle_*`
      residui su quella singola organizzazione (query mirata, nessuna
      modifica di codice necessaria: non è un problema che si ripresenta
      per organizzazioni create direttamente in live).
    **Catalogo** (22/09/2026, sandbox e live): prodotto "IncassaPrima
    Studio" con due prezzi separati, combinati sulla stessa
    transazione — Paddle non supporta prezzi a scaglioni in un unico
    oggetto. Prezzo base (`€19,00/mese`, quantità fissa 1) + prezzo
    azienda extra (`€5,00/mese`, quantità = aziende oltre le 3 incluse,
    omesso dalla transazione se 0). Verificato dal vivo in sandbox:
    transazione con base + 2 extra → totale `€29,00`, corretto. ID
    prezzi:
    - Sandbox: base `pri_01m34bmjf5awf0tg5y5715g6d1`, extra
      `pri_01m34bpg67ma4xsecqggd5xhpe`.
    - Live: base `pri_01m34btwe2mje622eg51y79yge`, extra
      `pri_01m34bvvdd3nds12psqnfv1kj5`.
    Resta da collegare la quantity extra-aziende (`app/lib/billing.js`,
    `computeStudioBilling`) a una quantity reale sulla transazione
    quando lo Studio aggiunge/rimuove aziende dopo il primo checkout
    (oggi non tocca affatto il billing Paddle).
  - ~~**Configurazione e test sandbox**~~ Fatto il 21/09/2026: account
    Paddle sandbox creato, prodotto/prezzo Pro configurato, webhook
    collegato, i 4 secret impostati (`PADDLE_API_KEY`,
    `PADDLE_PRICE_ID_PRO`, `PADDLE_WEBHOOK_SECRET` su Supabase,
    `PADDLE_CLIENT_TOKEN` pubblico in `app/app.js`), e **acquisto di
    prova completato dall'app vera** (carta di test, overlay Paddle.js):
    piano passato a Pro correttamente, email di conferma con fattura
    ricevuta da Paddle. Circuito end-to-end verificato: checkout →
    pagamento → webhook → aggiornamento piano. Richiesto un passaggio
    non ovvio non documentato altrove: impostare un "Default payment
    link" (URL completo, dominio approvato) in Checkout Settings su
    Paddle, altrimenti la creazione di transazioni fallisce — da
    rifare anche sull'account live.
  - ~~**Attivazione account live**~~ Fatto il 22/09/2026: **IncassaPrima
    Pro è ora acquistabile per davvero**. Passaggio a "Live" su Paddle,
    stessa configurazione rifatta (prodotto/prezzo/webhook/chiavi/
    default payment link). Superati due ostacoli non ovvi:
    (1) `transaction_checkout_not_enabled` finché non si completa la
    verifica venditore di Paddle (dati bancari, verifica identità,
    verifica del sito) — Paddle richiede anche una vera politica di
    rimborso pubblica, aggiunta a `termini.html`; (2) la verifica del
    dominio falliva perché `venturalessio.github.io` (radice) dà 404 —
    il sito vive sotto `/incassaprima/`. Risolto creando il repository
    `venturalessio/venturalessio.github.io` con un redirect alla radice
    verso `/incassaprima/` (non limita la pubblicazione di altre app
    future, che restano comunque raggiungibili al proprio percorso).
    Verificato dal vivo: creazione transazione contro `api.paddle.com`
    (non sandbox) riuscita con successo (201), badge "IN ARRIVO" tolto
    dalla card Pro, dati di payout (bonifico) confermati da Paddle.
  - **Partita IVA**: decisioni prese il 20/09/2026 dopo una ricerca di
    mercato. L'utente **non ha ancora partita IVA**; per un abbonamento
    ricorrente la "prestazione occasionale" non è percorribile (rischio
    di riqualificazione dell'attività come abituale, con sanzioni).
    Percorso indicato: apertura di una partita IVA in **regime
    forfettario** (gratuita, imposta sostitutiva 5% i primi 5 anni). Con
    Paddle come Merchant of Record la fatturazione verso i singoli
    abbonati non serve più (la emette Paddle), ma resta da chiarire con
    un commercialista come dichiarare i payout ricevuti da Paddle
    (**Da verificare prima di procedere**: codice ATECO corretto e
    corretto inquadramento fiscale dei payout). Necessaria prima di
    passare le chiavi Paddle in modalità live.
  - **Prezzi** (già su landing page e modal Piani in-app): Pro da
    €9/mese; Studio da €19/mese fino a 3 aziende gestite, +€5/mese per
    ogni azienda aggiuntiva (modello analogo a Danea Easyfatt, che fa
    pagare €120/anno per azienda aggiuntiva sulle licenze
    multi-azienda).
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

## Marketing e crescita

Con Pro e Studio ora self-service e funzionanti, il 22/09/2026 si è
iniziato a lavorare sulla visibilità: SEO tecnica sul sito, contenuti
per outreach diretto ai commercialisti (target naturale di Studio),
copy per eventuali annunci a pagamento, materiali di lancio su
directory/community. Sessione senza accesso diretto a piattaforme
pubblicitarie o social: il lavoro fatto qui è copy/contenuti/codice,
la pubblicazione effettiva (annunci, post, form di lancio) resta
sempre a carico dell'utente.

- ~~**Identità visiva: nuovo simbolo del brand**~~ Fatto il 25/09/2026.
  Il vecchio logo-mark era un semplice "€" — scontato per un prodotto
  che non è un gestionale di fatturazione, e uguale a mille altri
  loghi fintech. Definita una brand foundation (personalità,
  positioning, direzione creativa) esplorata in un mockup su Artifact,
  poi applicata al prodotto: nuovo simbolo con tre barre orizzontali
  decrescenti (l'idea di "priorità ordinate", coerente con la vista
  "chi contattare oggi" dell'app) più un punto ambra sulla barra più
  urgente. Sostituiti `icons/icon-192.png` e `icons/icon-512.png`
  (usati da manifest PWA, apple-touch-icon, OG/Twitter image) generati
  via rendering SVG→PNG con Playwright, e il logo-mark testuale "€" in
  `index.html` (header e footer) con l'SVG inline. Palette e
  tipografia della landing (blu `#2563eb`, DM Sans/Manrope) **non
  toccate**: già coerenti con la nuova direzione, non serviva un
  redesign più ampio.

- ~~**SEO tecnica base**~~ Fatto il 22/09/2026: aggiunti `robots.txt`
  e `sitemap.xml` alla radice del sito (referenziati a vicenda),
  `<link rel="canonical">` e dati strutturati JSON-LD
  (`SoftwareApplication` con le tre offerte Free/Pro/Studio) su
  `index.html`. Mancavano del tutto prima; meta description/OG/Twitter
  card c'erano già. Nessun contenuto nuovo, solo infrastruttura che
  aiuta i motori di ricerca a indicizzare correttamente il sito.
- ~~**Dominio personalizzato `incassaprima.it`**~~ Fatto il 22/09/2026:
  registrato su register.it, DNS propagati (4 record A verso GitHub
  Pages), file `CNAME` aggiunto al repository, certificato HTTPS
  generato automaticamente da GitHub Pages — verificato dal vivo
  (`https://incassaprima.it/` risponde 200). Aggiornati
  canonical/OG/Twitter/JSON-LD in `index.html`, `sitemap.xml` e
  `robots.txt` dal vecchio `venturalessio.github.io/incassaprima` al
  nuovo dominio. **Resta da fare** (in ordine): (1) autorizzare
  `https://incassaprima.it/app/` come redirect URL nelle impostazioni
  Supabase Auth (Authentication → URL Configuration), altrimenti
  aggiornare `emailRedirectTo` in `app/app.js` (riga ~1460, ancora
  puntato al vecchio dominio) romperebbe la conferma email delle nuove
  registrazioni; (2) una volta autorizzato, aggiornare quel redirect
  nel codice; (3) approvare il nuovo dominio su Paddle (checkout live,
  stesso passaggio già fatto per `venturalessio.github.io`) prima di
  usarlo nei materiali di marketing/outreach già preparati. Incluse nel
  pacchetto dominio anche 2 caselle email (`info@`, `alessio@`
  `@incassaprima.it`, con DKIM e DMARC attivati) e una PEC gratuita per
  il primo anno (non ancora configurata).
