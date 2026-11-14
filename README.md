# IncassaPrima

Scadenzario fatture e solleciti per artigiani e micro-imprese.

- Sito: https://incassaprima.it
- App: https://incassaprima.it/app/
- Contatti: info@incassaprima.it

## Contenuto
- `index.html`, `styles.css`: landing page pubblica (i font sono caricati nei `<link>` di ogni pagina, non dal CSS)
- `about.html` (servita come `/about`): pagina Chi siamo
- `privacy.html`, `termini.html`, `404.html`: pagine legali e pagina di errore
- `app/index.html`, `app/app.js`, `app/lib/`: l'app (scadenzario, solleciti, analisi incassi)
- `manifest.webmanifest`, `service-worker.js`, `icons/`: file della PWA
- `supabase/`: migrazioni SQL e funzioni del progetto Supabase (vedi `supabase/README.md`)
- `blog/`, `scripts/`: pagine del blog generate dagli articoli di HeyCatch (vedi "Blog")
- `tests/`: test automatici della logica in `app/lib/` e del blog
- `ROADMAP.md`: lavoro aperto e decisioni prese

## Pubblicazione
Il sito è pubblicato con GitHub Pages dal ramo `main` (cartella principale) sul dominio indicato in `CNAME`.
Ogni push su `main` va online in pochi minuti.

Quando cambi `styles.css`, `index.html` o i file dell'app, aumenta il numero di `CACHE` in `service-worker.js`: altrimenti chi ha già aperto il sito continua a vedere la versione salvata.

## Blog
Spento il 14 novembre 2026, quando è stato disdetto HeyCatch. Restano `scripts/build-blog.mjs` e `scripts/blog/render.js`, con i loro test, se un giorno si vuole riattivare il blog: basta rimettere un workflow che lanci lo script con la chiave nel segreto `HEYCATCH_API_KEY`.

## Test
```
npm test
```
Gli stessi test girano su GitHub Actions a ogni pull request.

## Dati
Chi accede con un account salva fatture e clienti nel cloud su Supabase. Senza account l'app funziona in modalità locale: i dati restano solo nel browser (`localStorage`) e non sono sincronizzati fra dispositivi.
