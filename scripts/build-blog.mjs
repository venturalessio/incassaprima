// Scarica gli articoli da HeyCatch e rigenera /blog/, le pagine articolo e la sitemap.
// Gira su GitHub Actions (.github/workflows/blog.yml) con la chiave nel segreto
// HEYCATCH_API_KEY: la chiave non finisce mai nei file del sito.
// Un errore dell'API non fa mai fallire il sito: restano le ultime pagine buone.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSafeSlug, renderArticle, renderIndex, renderSitemap, SITE } from './blog/render.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLOG_DIR = join(ROOT, 'blog');
const API = process.env.HEYCATCH_API_BASE || 'https://api.heycatch.ai/v1';
const KEY = process.env.HEYCATCH_API_KEY;
const PAGE = 50;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function getJson(path, params = {}) {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('key', KEY);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (response.status === 429 && attempt === 0) {
      const wait = Math.min(Number(response.headers.get('retry-after')) || 5, 60);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    if (!response.ok) throw new ApiError(response.status, `HeyCatch ha risposto ${response.status} su ${path}`);
    return response.json();
  }
  throw new ApiError(429, `HeyCatch: troppe richieste su ${path}`);
}

async function fetchAllArticles() {
  const list = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += PAGE) {
    const page = await getJson('/articles', { limit: PAGE, offset });
    total = Number(page.total) || 0;
    list.push(...(page.articles || []));
    if (!page.articles?.length) break;
  }

  const articles = [];
  for (const item of list) {
    if (!isSafeSlug(item.slug)) {
      console.warn(`Articolo saltato: slug non valido (${JSON.stringify(item.slug)})`);
      continue;
    }
    const { article } = await getJson(`/articles/${encodeURIComponent(item.slug)}`);
    articles.push({ ...item, ...article });
  }
  return articles.sort((a, b) => String(b.published_at || b.published).localeCompare(String(a.published_at || a.published)));
}

async function readStaticPages() {
  const xml = await readFile(join(ROOT, 'sitemap.xml'), 'utf8');
  const pages = [];
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) || []) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1];
    if (!loc || loc.startsWith(`${SITE}/blog/`)) continue;
    pages.push({ loc, lastmod: /<lastmod>([^<]+)<\/lastmod>/.exec(block)?.[1] || '' });
  }
  return pages;
}

// Il link "Blog" nel menu della home compare solo quando c'è almeno un articolo.
async function toggleHomeLink(show) {
  const file = join(ROOT, 'index.html');
  const html = await readFile(file, 'utf8');
  const link = show ? '\n      <a href="blog/">Blog</a>\n      ' : '';
  const next = html.replace(/<!-- blog-link -->[\s\S]*?<!-- \/blog-link -->/, `<!-- blog-link -->${link}<!-- /blog-link -->`);
  if (next !== html) await writeFile(file, next);
}

async function writeSite(articles) {
  await mkdir(BLOG_DIR, { recursive: true });
  const keep = new Set(['index.html', ...articles.map((article) => `${article.slug}.html`)]);
  for (const name of await readdir(BLOG_DIR)) {
    if (name.endsWith('.html') && !keep.has(name)) await rm(join(BLOG_DIR, name));
  }

  await writeFile(join(BLOG_DIR, 'index.html'), renderIndex(articles));
  for (const article of articles) {
    await writeFile(join(BLOG_DIR, `${article.slug}.html`), renderArticle(article));
  }

  const lastmod = articles.map((article) => String(article.updated || article.published || '').slice(0, 10)).sort().pop() || '';
  await writeFile(join(ROOT, 'sitemap.xml'), renderSitemap(await readStaticPages(), articles, lastmod));
  await toggleHomeLink(articles.length > 0);
}

async function main() {
  if (!KEY) {
    console.warn('HEYCATCH_API_KEY non impostata: blog non aggiornato.');
    return;
  }
  try {
    const articles = await fetchAllArticles();
    await writeSite(articles);
    console.log(`Blog aggiornato: ${articles.length} articoli.`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      // Chiave revocata o progetto HeyCatch cancellato: pagina vuota invece di articoli orfani.
      await writeSite([]);
      console.warn(`${error.message}. Chiave revocata o progetto cancellato: blog svuotato.`);
      return;
    }
    console.warn(`${error.message}. Restano le ultime pagine pubblicate.`);
  }
}

await main();
