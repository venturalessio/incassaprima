# Supabase

Questa cartella contiene le migrazioni SQL versionate del progetto
Supabase di IncassaPrima.

## Baseline

Il database di produzione esisteva prima dell'introduzione delle
migrazioni nel repository. La migrazione baseline è solo documentativa:
non contiene istruzioni DDL e non deve ricreare lo schema esistente.

## Migrazioni di sicurezza

Le migrazioni successive documentano le revoche dei privilegi EXECUTE
sulle funzioni SECURITY DEFINER esposte nello schema public. Sono già
state applicate al progetto di produzione `incassaprima-prod`.

## Regola operativa

Ogni futura modifica allo schema, alle policy RLS, agli indici, alle
funzioni o ai privilegi del database deve essere aggiunta come una nuova
migrazione SQL in `supabase/migrations/`, revisionata e applicata prima
del rilascio del codice che la richiede.
