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

**Modello Studio → aziende gestite**: un account Studio ha
un'organizzazione "identità" (quella creata alla registrazione, con
`plan = 'studio'`) che non ospita mai clienti o fatture proprie, e una o
più organizzazioni "azienda" collegate tramite `managed_by`, ciascuna
isolata dalle altre esattamente come qualunque organizzazione Free/Pro
(stesse RLS, nessuna eccezione). L'app decide quale mostrare in base
all'organizzazione attiva in `state.organization`, non serve alcuna
policy dedicata per la lettura/scrittura di clienti e fatture.

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

## Regola operativa

Ogni futura modifica allo schema, alle policy RLS, agli indici, alle
funzioni o ai privilegi del database deve essere aggiunta come una nuova
migrazione SQL in `supabase/migrations/`, revisionata e applicata prima
del rilascio del codice che la richiede. Dopo ogni modifica, verificare
che `supabase/migrations/` sia ancora allineata con
`supabase_migrations.schema_migrations` sul progetto reale (stesso
timestamp = stessa migrazione), per evitare che il repository diverga
di nuovo dalla produzione.
