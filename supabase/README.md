# Supabase

Questa cartella contiene le migrazioni SQL versionate del progetto
Supabase di IncassaPrima (`incassaprima-prod`). I file sono allineati
1:1 con `supabase_migrations.schema_migrations` sul progetto reale: lo
stesso timestamp nel nome file corrisponde alla stessa versione applicata
in produzione.

## Baseline

Il database di produzione esisteva prima dell'introduzione delle
migrazioni nel repository. La migrazione baseline è solo documentativa:
non contiene istruzioni DDL e non deve ricreare lo schema esistente.

## Migrazioni applicate

- `20260914205225` / `20260914205405` — revoche dei privilegi EXECUTE
  sulle funzioni SECURITY DEFINER esposte nello schema public.
- `20260914212345` / `20260914212738` — indici per le query più
  frequenti e per le foreign key, con rimozione dei duplicati creati
  dalla prima passata.
- `20260914212938` — riscrittura delle policy RLS che usavano
  `auth.uid()` per usare `(select auth.uid())`, evitando la
  rivalutazione per riga suggerita dal Performance Advisor.
- `20260920133310` — revoca dell'UPDATE su `public.organizations` per
  il ruolo `authenticated` e concessione solo sulla colonna `name`.
  Prima di questa migrazione qualunque owner poteva modificare la
  colonna `plan` della propria organizzazione con una PATCH REST diretta
  (`/rest/v1/organizations?id=eq.<id>`), auto-promuovendosi a pro/studio
  senza alcun controllo lato server. Il campo `plan` deve ora essere
  scritto solo da un processo con `service_role` (es. webhook di
  fatturazione).
- `20260920141311` — aggiunge `organizations.managed_by`: collega
  un'azienda gestita alla sua organizzazione Studio "identità" (`NULL`
  per un'organizzazione autonoma, cioè un utente Free/Pro o l'identità
  Studio stessa).
- `20260920141325` — aggiunge la funzione `create_managed_company`
  (`SECURITY DEFINER`): crea una nuova azienda gestita solo se chi
  chiama è owner di un'organizzazione con `plan = 'studio'`, sullo
  stesso modello di `handle_new_user()`. Nessuna nuova policy RLS
  necessaria: la funzione crea anche la riga in `organization_members`,
  quindi tutte le policy esistenti su clienti/fatture/promemoria si
  applicano invariate all'azienda appena creata.
- `20260920141407` — revoca l'EXECUTE su `create_managed_company` dal
  ruolo `anon` (vedi nota sotto: Supabase lo concede di default anche
  ad `anon`, non solo a `PUBLIC`).
- `20260920151806` — aggiunge la funzione `delete_managed_company`
  (`SECURITY DEFINER`): elimina un'azienda gestita (clienti, fatture e
  storico compresi) solo se chi chiama è owner dell'azienda stessa e
  solo se `managed_by is not null`, così l'identità Studio non può mai
  essere eliminata per questa via.
- `20260920183410` — aggiunge la tabella `organization_invites` (invito
  con `token uuid` univoco, `role`, `invited_email` opzionale,
  `expires_at` di default a 7 giorni), con RLS che permette solo
  all'owner dell'organizzazione di creare/vedere/eliminare i propri
  inviti.
- `20260920183430` — aggiunge la funzione `accept_organization_invite`
  (`SECURITY DEFINER`): verifica che l'invito sia valido, non scaduto e
  non già accettato; **v1: rifiuta esplicitamente chi ha già una
  qualunque riga in `organization_members`** (nessuno switcher
  multi-organizzazione, funziona solo per chi non ha ancora un account
  IncassaPrima); se l'invito specifica `invited_email`, lo confronta
  (case-insensitive) con `auth.jwt() ->> 'email'`; se tutto è valido,
  inserisce la riga di membership e marca l'invito come accettato.
- `20260920183854` — aggiunge la funzione `list_organization_members`
  (`SECURITY DEFINER`): espone email/ruolo/data di ingresso dei membri
  di un'organizzazione ai suoi stessi membri, uníta con `auth.users`
  (i client non possono interrogare `auth.users` direttamente).
- `20260920183951` — modifica `handle_new_user()` aggiungendo una
  guardia iniziale: se `raw_user_meta_data ->> 'invite_token'` è
  presente, la funzione non crea più un'organizzazione personale per il
  nuovo utente, perché la aggiungerà lui stesso a quella dell'invito
  chiamando `accept_organization_invite` subito dopo la conferma email.
- `20260920184643` — aggiunge la funzione `get_invite_preview`
  (`SECURITY DEFINER`, **unica di questo gruppo concessa anche ad
  `anon`**): dato solo il token, restituisce nome dell'organizzazione,
  ruolo proposto e validità, senza richiedere autenticazione. Serve a
  mostrare "Stai per unirti a: **Nome Azienda**" nella pagina di
  registrazione prima che l'utente invitato abbia un account — nessun
  dato sensibile esposto oltre al nome scelto dall'organizzazione
  stessa, e il token è già il "segreto" del link di invito.

**Limite v1 degli inviti**: gli inviti funzionano solo per chi non ha
ancora nessun account IncassaPrima. Un utente che ha già una propria
organizzazione (Free/Pro/Studio) non può accettare un invito a
un'altra organizzazione: `accept_organization_invite` lo rifiuta con un
errore esplicito lato server (non solo lato UI). Estendere il supporto
a un vero multi-organizzazione (switcher tra organizzazioni di cui si è
membri) è un lavoro futuro, non fatto in questa v1.

**Modello Studio → aziende gestite**: un account Studio ha
un'organizzazione "identità" (quella creata alla registrazione, con
`plan = 'studio'`) che non ospita mai clienti o fatture proprie, e una o
più organizzazioni "azienda" collegate tramite `managed_by`, ciascuna
isolata dalle altre esattamente come qualunque organizzazione Free/Pro
(stesse RLS, nessuna eccezione). L'app decide quale mostrare in base
all'organizzazione attiva in `state.organization`, non serve alcuna
policy dedicata per la lettura/scrittura di clienti e fatture.

- `20260920191843` — **bug corretto**: nessuna riga di
  `organization_reminder_settings` veniva mai creata automaticamente
  (né `handle_new_user()` né `create_managed_company()` ne inserivano
  una), quindi `saveRules()` lato app — che fa un `UPDATE`, non un
  upsert — non aveva mai avuto nessuna riga da aggiornare per
  **nessuna** organizzazione esistente: le regole di sollecito non si
  potevano davvero salvare. Aggiunto un trigger
  `create_default_reminder_settings()` che crea la riga di default per
  ogni nuova organizzazione, più il backfill delle organizzazioni già
  esistenti. Lato app, `saveRules()` è stato aggiornato per usare
  `upsert` invece di `update`, come difesa aggiuntiva.
- `20260920192620` — pianifica (`pg_cron` + `pg_net`) l'esecuzione
  giornaliera (06:00 UTC) della funzione Edge `send-reminder-emails`
  (vedi sezione dedicata sotto).
- `20260920193047` — revoca l'EXECUTE su `create_default_reminder_settings`
  da `anon`/`authenticated` (per pulizia: essendo `returns trigger`,
  Postgres rifiuta comunque di eseguirla fuori da un trigger, quindi non
  è mai stata realmente invocabile via RPC).

## Promemoria automatici via email

`supabase/functions/send-reminder-emails/` contiene una funzione Edge
pianificata (cron giornaliero alle 06:00 UTC, job
`send-reminder-emails-daily`) che per ogni organizzazione:

1. genera le bozze di sollecito mancanti con la stessa identica logica
   di idoneità/modello usata lato client (`app/lib/reminders.js`,
   `app/lib/templates.js` — mirrorati in `lib/` dentro la cartella della
   funzione: **vanno tenuti sincronizzati manualmente**, non c'è build
   step condiviso tra browser e Deno in questo progetto);
2. se l'organizzazione ha `automatic_email_enabled = true` (impostabile
   dalla UI "Regole sollecito"), invia davvero l'email tramite
   [Resend](https://resend.com) invece di lasciare solo la bozza in coda
   di approvazione, e registra l'esito in `invoice_activity_log`.

**Autenticazione della funzione**: distribuita con `verify_jwt=false`
(non viene chiamata da un browser autenticato, ma dal cron job) e
protetta invece da un segreto condiviso: la funzione confronta l'header
`x-cron-secret` con la propria variabile d'ambiente `CRON_SECRET`. Se
`CRON_SECRET` non è impostata (default all'atto della creazione), la
funzione rifiuta **ogni** richiesta con 401 — fail-closed, nessuna
esecuzione accidentale senza configurazione esplicita.

**Configurazione richiesta (manuale, non automatizzabile da qui)**: le
Edge Function secrets non sono raggiungibili via SQL/MCP, vanno impostate
dalla Dashboard Supabase (Project Settings → Edge Functions →
`send-reminder-emails` → Secrets) o via CLI (`supabase secrets set`):

- `CRON_SECRET` — **obbligatorio** perché il cron job funzioni. Deve
  avere lo stesso valore usato nell'header `x-cron-secret` della
  migrazione `20260920192620` (generato con `gen_random_uuid()` al
  momento dell'applicazione, volutamente non versionato in chiaro nel
  repository — vedi il commento nel file di quella migrazione). Se il
  valore va recuperato di nuovo, va letto da
  `cron.job where jobname = 'send-reminder-emails-daily'` sul progetto
  reale (mai da questo repository).
- `RESEND_API_KEY` — opzionale. Se assente, la funzione genera comunque
  le bozze ma non invia email automaticamente per nessuna
  organizzazione (ogni tentativo di invio automatico viene registrato
  come `reminders.status = 'failed'` con
  `error_message = 'Invio automatico non configurato...'`): sicuro da
  lasciare non impostata finché non si è pronti.
- `REMINDER_FROM_EMAIL` — opzionale, default
  `IncassaPrima <onboarding@resend.dev>` (il dominio sandbox di Resend:
  consegna solo all'indirizzo email del proprio account Resend, utile
  per i test). **Richiede un dominio proprio verificato su Resend
  (record DNS SPF/DKIM) prima di poter inviare a clienti reali** — una
  volta verificato, impostare qui un mittente su quel dominio (es.
  `IncassaPrima <promemoria@incassaprima.it>`).

Il toggle "Invia i solleciti automaticamente via email" nella UI
"Regole sollecito" resta a disposizione di ogni organizzazione ma va
attivato consapevolmente solo dopo aver completato questa
configurazione: finché `RESEND_API_KEY` non è impostata, attivarlo non
causa danni (le email semplicemente non partono, con errore registrato),
ma nemmeno funziona.

## Attenzione: EXECUTE concesso di default anche ad `anon`

Ogni volta che si crea una nuova funzione nello schema `public`,
Supabase le concede EXECUTE non solo a `PUBLIC` ma anche esplicitamente
ad `anon` e `authenticated` (privilegi di default a livello di schema).
`revoke ... from public` **non basta** a togliere l'accesso ad `anon`:
serve un `revoke execute on function ... from anon` esplicito subito
dopo la creazione, se la funzione non deve essere chiamabile da utenti
non autenticati. È già successo due volte in questo progetto
(`create_managed_company` in `20260920141407`) — controllarlo con
`get_advisors(type: "security")` dopo ogni nuova funzione.

## Nota: EXECUTE su `is_organization_member` / `is_organization_owner`

Le migrazioni `20260914205225` e `20260914205405` revocano l'EXECUTE su
`is_organization_member` e `is_organization_owner` per `anon`,
`authenticated` e `PUBLIC`. In pratica questa revoca **non è (né può
essere) in vigore per il ruolo `authenticated`**: le policy RLS di
`organizations`, `customers`, `invoices`, `reminders`, ecc. richiamano
queste funzioni nelle clausole `USING`/`WITH CHECK`, e Postgres richiede
che il ruolo che esegue la query abbia EXECUTE sulle funzioni usate al
suo interno — anche quando sono `SECURITY DEFINER`. Revocarlo davvero
rompe ogni SELECT/INSERT/UPDATE/DELETE sulle tabelle applicative.

Il Security Advisor di Supabase segnala quindi (WARN, non ERROR) che
`authenticated` può chiamare direttamente
`/rest/v1/rpc/is_organization_member` e `/rest/v1/rpc/is_organization_owner`.
È un compromesso accettato: le due funzioni restituiscono solo un
booleano sulla propria appartenenza/ruolo in un'organizzazione, senza
esporre dati sensibili. Una chiusura "vera" del WARN richiederebbe di
sostituire le chiamate a funzione nelle policy con subquery inline
— operazione delicata perché `organization_members` referenzia sé
stessa nella propria policy di SELECT, e oggi evita la ricorsione solo
grazie a `SECURITY DEFINER` — e va fatta in un ambiente di staging con
dati reali di test, non applicata a freddo su produzione.

## Nota: `pg_net` nello schema `public`

Il Security Advisor segnala (WARN) che l'estensione `pg_net` è installata
nello schema `public`. È un compromesso accettato: `pg_net` **non
supporta** `alter extension ... set schema` (errore
`extension "pg_net" does not support SET SCHEMA`), e le funzioni
effettive (`net.http_post`, ecc., usate dal cron job dei promemoria) sono
comunque nel proprio schema dedicato `net`, non in `public` — spostare
l'estensione richiederebbe drop/ricreazione con il rischio di rompere il
cron job funzionante, per un beneficio puramente di pulizia. Pattern
comune a moltissimi progetti Supabase che usano `pg_net`.

## Regola operativa

Ogni futura modifica allo schema, alle policy RLS, agli indici, alle
funzioni o ai privilegi del database deve essere aggiunta come una nuova
migrazione SQL in `supabase/migrations/`, revisionata e applicata prima
del rilascio del codice che la richiede. Dopo ogni modifica, verificare
che `supabase/migrations/` sia ancora allineata con
`supabase_migrations.schema_migrations` sul progetto reale (stesso
timestamp = stessa migrazione), per evitare che il repository diverga
di nuovo dalla produzione.
