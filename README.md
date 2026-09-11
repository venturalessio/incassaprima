# IncassaPrima — PWA pronta per GitHub Pages

## Contenuto
- `index.html`: landing page pubblica
- `app/index.html`: MVP scadenzario
- `app/app.js`: logica applicativa
- `styles.css`: stile della landing
- `manifest.webmanifest`, `service-worker.js`, `icons/`: asset PWA
- `privacy.html`: informativa iniziale per versione locale

## Pubblicazione gratis con GitHub Pages
1. Crea un account su https://github.com.
2. Crea un repository pubblico chiamato `incassaprima`.
3. Carica **tutto il contenuto di questa cartella**, mantenendo invariati cartelle e nomi.
4. Nel repository: `Settings` → `Pages`.
5. In “Build and deployment”: Source `Deploy from a branch`; Branch `main`; Folder `/(root)`; poi `Save`.
6. Dopo 1–3 minuti apri `https://venturalessio.github.io/incassaprima/`.
7. L'app è a `https://venturalessio.github.io/incassaprima/app/`.

## Test prima del lancio
- Inserisci `2.500`, `2.500,00`, `1.250,50`; devono diventare rispettivamente €2.500,00 e €1.250,50.
- Prova i tre modelli di sollecito.
- Prova CSV export/import.
- Apri landing, privacy e app da smartphone.
- In iPhone: Safari → Condividi → Aggiungi a Home.
- In Android: Chrome → menu → Installa app/Aggiungi a schermata Home.

## Da modificare prima di condividere
1. Sostituisci ogni `ciao@incassaprima.example` in `index.html` e `privacy.html` con una email reale.
2. Se desideri, cambia il nome del prodotto e i testi della landing.
3. Le icone sono provvisorie: sostituiscile quando avrai un logo.

## Nota tecnica
I dati delle fatture vengono salvati solo nel browser (`localStorage`). Non sono sincronizzati fra PC e telefono e non costituiscono una soluzione fiscale o contabile. Per una versione Pro: backend, account, database, consenso/privacy aggiornati, cancellazione account e log di invio.
