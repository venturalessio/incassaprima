// Pagine statiche del blog: gli articoli li scrive HeyCatch, qui li trasformiamo
// in HTML con lo stile del sito. Nessuna chiamata di rete in questo file.
import sanitizeHtml from 'sanitize-html';

export const SITE = 'https://incassaprima.it';
const SITE_LANG = 'it';
const RTL = new Set(['ar', 'he', 'fa', 'ur']);

const LOGO = `<span class="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
          <rect x="40" y="52" width="80" height="14" rx="7" fill="#fff"></rect>
          <rect x="40" y="78" width="56" height="14" rx="7" fill="#fff" opacity="0.72"></rect>
          <rect x="40" y="104" width="36" height="14" rx="7" fill="#fff" opacity="0.48"></rect>
          <circle cx="128" cy="59" r="7" fill="#F59E0B"></circle>
        </svg>
      </span>`;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Lo slug diventa un nome di file: teniamo solo caratteri sicuri.
export function isSafeSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,150}$/.test(slug);
}

export function articleUrl(slug) {
  return `${SITE}/blog/${slug}`;
}

export function formatDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function meta(article) {
  const parts = [];
  const date = formatDate(article.published);
  if (date) parts.push(`<time datetime="${escapeHtml(String(article.published).slice(0, 10))}">${escapeHtml(date)}</time>`);
  if (Number.isFinite(article.read_time) && article.read_time > 0) parts.push(`${article.read_time} min di lettura`);
  return parts.join(' · ');
}

export function sanitizeArticleHtml(html) {
  return sanitizeHtml(String(html ?? ''), {
    allowedTags: [
      'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'a', 'blockquote', 'strong', 'em', 'b', 'i',
      'code', 'pre', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption'
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      h2: ['id'],
      h3: ['id'],
      th: ['scope', 'colspan', 'rowspan'],
      td: ['colspan', 'rowspan']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || '';
        const external = /^https?:\/\//i.test(href) && !href.startsWith(SITE);
        return {
          tagName,
          attribs: external ? { ...attribs, rel: 'noopener', target: '_blank' } : attribs
        };
      }
    }
  });
}

// Indice: un link per ogni <h2> con id, tranne la FAQ, letto dall'HTML già ripulito.
export function tableOfContents(cleanHtml) {
  const items = [];
  const re = /<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g;
  let match;
  while ((match = re.exec(cleanHtml))) {
    if (match[1] === 'faq') continue;
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    if (text) items.push({ id: match[1], text });
  }
  return items;
}

// Inserisce l'indice dopo la lista "Key takeaways", o in cima se non c'è.
export function withTableOfContents(cleanHtml) {
  const items = tableOfContents(cleanHtml);
  if (!items.length) return cleanHtml;
  const toc = `<nav class="blog-toc" aria-labelledby="indice"><h2 id="indice">Indice</h2><ol>${items
    .map((item) => `<li><a href="#${item.id}">${item.text}</a></li>`)
    .join('')}</ol></nav>`;
  const takeaways = /^\s*<h2>[^<]*<\/h2>\s*<(ul|ol)>[\s\S]*?<\/\1>/.exec(cleanHtml);
  if (takeaways) {
    const end = takeaways.index + takeaways[0].length;
    return cleanHtml.slice(0, end) + toc + cleanHtml.slice(end);
  }
  return toc + cleanHtml;
}

export function jsonLdScript(jsonLd, canonical) {
  if (!jsonLd || typeof jsonLd !== 'object' || Array.isArray(jsonLd) || !Object.keys(jsonLd).length) return '';
  const data = { ...jsonLd };
  if (!data.url) {
    data.url = canonical;
    data.mainEntityOfPage = canonical;
  }
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function layout({ title, description, canonical, ogType, head = '', body, showBlogLink }) {
  return `<!doctype html>
<html lang="${SITE_LANG}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#0f3d87">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="/icons/icon-192.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap">
  <link rel="stylesheet" href="/styles.css">
  <meta property="og:type" content="${ogType}">
  <meta property="og:locale" content="it_IT">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${SITE}/icons/og-1200x630.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <script defer src="https://cloud.umami.is/script.js" data-website-id="0184a7f4-3c39-463a-a679-da1e49ad8595"></script>
${head}</head>

<body>
  <header class="site-header">
    <a class="logo" href="/" aria-label="IncassaPrima home">
      ${LOGO}
      <span>IncassaPrima</span>
    </a>

    <nav class="nav-links" aria-label="Navigazione principale">
      <a href="/#come-funziona">Come funziona</a>
      <a href="/#gratis">Piani</a>
${showBlogLink ? '      <a href="/blog/" aria-current="page">Blog</a>\n' : ''}      <a class="button button-small button-outline" href="/app/">Apri gratis</a>
    </nav>
  </header>

  <main class="blog-main">
${body}
  </main>

  <footer class="site-footer">
    <div>
      <a class="logo" href="/" aria-label="IncassaPrima home">
        ${LOGO}
        <span>IncassaPrima</span>
      </a>
      <p>Scadenzario e solleciti per artigiani, professionisti e micro-imprese.</p>
    </div>

    <div class="footer-links">
      <a href="/app/">Apri l’app</a>
      <a href="/about">Chi siamo</a>
      <a href="/scadenzario-excel-vs-incassaprima">Excel vs IncassaPrima</a>
      <a href="/privacy.html">Privacy</a>
      <a href="/termini.html">Termini di servizio</a>
      <a href="mailto:info@incassaprima.it">Contatti</a>
    </div>
  </footer>
</body>
</html>
`;
}

export function renderIndex(articles) {
  const list = articles.length
    ? `    <ol class="blog-list">
${articles
  .map(
    (article) => `      <li>
        <a href="/blog/${article.slug}">${escapeHtml(article.title)}</a>
        <p class="blog-meta">${meta(article)}</p>
      </li>`
  )
  .join('\n')}
    </ol>`
    : '    <p class="blog-empty">Ancora nessun articolo. Il primo arriva a breve.</p>';

  return layout({
    title: 'Blog | IncassaPrima',
    description: 'Guide pratiche su fatture, scadenze e solleciti di pagamento per artigiani, professionisti e micro-imprese.',
    canonical: `${SITE}/blog/`,
    ogType: 'website',
    showBlogLink: articles.length > 0,
    body: `    <h1 class="blog-title">Blog</h1>
${list}`
  });
}

export function renderArticle(article) {
  const canonical = articleUrl(article.slug);
  const clean = sanitizeArticleHtml(article.content_html);
  const language = typeof article.language === 'string' ? article.language.toLowerCase() : SITE_LANG;
  const langAttrs = language && language !== SITE_LANG
    ? ` lang="${escapeHtml(language)}"${RTL.has(language) ? ' dir="rtl"' : ''}`
    : '';
  const image = article.hero_image_url || article.featured_image;
  const imageTag = /^https:\/\//.test(image || '')
    ? `      <img class="blog-hero" src="${escapeHtml(image)}" alt="">\n`
    : '';

  return layout({
    title: `${article.title} | IncassaPrima`,
    description: article.meta_description || '',
    canonical,
    ogType: 'article',
    showBlogLink: true,
    head: jsonLdScript(article.jsonLd, canonical) ? `  ${jsonLdScript(article.jsonLd, canonical)}\n` : '',
    body: `    <article class="blog-article"${langAttrs}>
      <a class="blog-back" href="/blog/">← Tutti gli articoli</a>
      <h1 class="blog-title">${escapeHtml(article.title)}</h1>
      <p class="blog-meta">${meta(article)}</p>
${imageTag}      <div class="prose">
${withTableOfContents(clean)}
      </div>
      <aside class="blog-cta">
        <p><strong>Hai fatture da incassare?</strong> Con IncassaPrima vedi chi sollecitare oggi e prepari l’email in un clic. Piano base gratuito, senza registrazione né carta.</p>
        <a class="button" href="/app/">Apri lo scadenzario gratis</a>
      </aside>
    </article>`
  });
}

// Sitemap: le pagine fisse del sito più /blog/ e ogni articolo.
export function renderSitemap(staticPages, articles, blogLastmod) {
  const entries = [
    ...staticPages,
    { loc: `${SITE}/blog/`, lastmod: blogLastmod },
    ...articles.map((article) => ({ loc: articleUrl(article.slug), lastmod: String(article.updated || article.published || '').slice(0, 10) }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map((entry) => `  <url>
    <loc>${escapeHtml(entry.loc)}</loc>${entry.lastmod ? `\n    <lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : ''}
  </url>`)
  .join('\n')}
</urlset>
`;
}
