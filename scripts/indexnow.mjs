// Avvisa Bing e gli altri motori IndexNow che le pagine della sitemap sono cambiate.
// La chiave IndexNow è pubblica per costruzione: il file <chiave>.txt sta nella radice del sito.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = '80410fbbfa33a5c53fd54b4814e8683a';
const HOST = 'incassaprima.it';

const xml = await readFile(join(ROOT, 'sitemap.xml'), 'utf8');
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

try {
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
    signal: AbortSignal.timeout(20000),
  });
  console.log(`IndexNow: ${urlList.length} indirizzi inviati, risposta ${response.status}.`);
} catch (error) {
  // Un errore di IndexNow non deve mai bloccare la pubblicazione.
  console.warn(`IndexNow non raggiungibile: ${error.message}`);
}
