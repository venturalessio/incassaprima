import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDate,
  isSafeSlug,
  jsonLdScript,
  renderArticle,
  renderIndex,
  renderSitemap,
  sanitizeArticleHtml,
  tableOfContents,
  withTableOfContents
} from '../scripts/blog/render.js';

const article = {
  slug: 'come-sollecitare-una-fattura',
  title: 'Come sollecitare una fattura',
  meta_description: 'Guida pratica al sollecito.',
  published: '2026-10-14',
  updated: '2026-10-15',
  read_time: 6,
  language: 'it',
  featured_image: '',
  hero_image_url: '',
  jsonLd: { '@type': 'Article', headline: 'Come </script> sollecitare' },
  content_html:
    '<h2>Key takeaways</h2><ul><li>Uno</li></ul><p>Testo</p>' +
    '<h2 id="primo">Primo passo</h2><p onclick="x()">Ciao<script>alert(1)</script></p>' +
    '<a href="javascript:alert(1)">no</a><h2 id="faq">FAQ</h2><h3>Domanda?</h3><p>Sì</p>'
};

test('sanitize toglie script, eventi e link javascript ma tiene gli id dei titoli', () => {
  const clean = sanitizeArticleHtml(article.content_html);
  assert.ok(!clean.includes('<script'));
  assert.ok(!clean.includes('onclick'));
  assert.ok(!clean.includes('javascript:'));
  assert.ok(clean.includes('<h2 id="primo">'));
});

test('indice: un link per ogni h2 con id, senza FAQ, dopo i Key takeaways', () => {
  const clean = sanitizeArticleHtml(article.content_html);
  assert.deepEqual(tableOfContents(clean), [{ id: 'primo', text: 'Primo passo' }]);
  const html = withTableOfContents(clean);
  assert.ok(html.indexOf('</ul>') < html.indexOf('blog-toc'));
  assert.ok(html.indexOf('blog-toc') < html.indexOf('<p>Testo</p>'));
});

test('niente indice se nessun titolo ha un id', () => {
  assert.equal(withTableOfContents('<p>Solo testo</p>'), '<p>Solo testo</p>');
});

test('slug accettati solo con caratteri sicuri', () => {
  assert.ok(isSafeSlug('come-sollecitare-2026'));
  assert.ok(!isSafeSlug('../index'));
  assert.ok(!isSafeSlug('Maiuscole'));
  assert.ok(!isSafeSlug(''));
});

test('JSON-LD con < scritto come \\u003c e url canonico aggiunto', () => {
  const script = jsonLdScript(article.jsonLd, 'https://incassaprima.it/blog/x');
  assert.ok(!script.slice(1, -9).includes('</script>'));
  assert.ok(script.includes('\\u003c/script>'));
  assert.ok(script.includes('"mainEntityOfPage":"https://incassaprima.it/blog/x"'));
  assert.equal(jsonLdScript({}, 'x'), '');
});

test('pagina articolo: un solo h1, canonical assoluto, descrizione solo nei meta', () => {
  const html = renderArticle(article);
  assert.equal(html.match(/<h1/g).length, 1);
  assert.ok(html.includes('<link rel="canonical" href="https://incassaprima.it/blog/come-sollecitare-una-fattura">'));
  assert.equal(html.split('Guida pratica al sollecito.').length - 1, 3);
  assert.ok(html.includes('14 ottobre 2026'));
  assert.ok(html.includes('6 min di lettura'));
  assert.ok(!html.includes('hck_'));
});

test('articolo: briciole di pane e "Leggi anche" con parole chiave in comune prima', () => {
  const others = [
    { slug: 'recente', title: 'Recente', keywords: ['iva'] },
    { slug: 'simile', title: 'Simile', keywords: ['Sollecito'] },
    article
  ];
  const html = renderArticle({ ...article, keywords: ['sollecito'] }, others);
  assert.ok(html.includes('"@type":"BreadcrumbList"'));
  assert.ok(html.includes('<a href="/">Home</a>'));
  const related = html.slice(html.indexOf('Leggi anche'));
  assert.ok(related.indexOf('/blog/simile') < related.indexOf('/blog/recente'));
  assert.ok(!related.includes(`/blog/${article.slug}"`));
  assert.ok(related.includes('/scadenzario-excel-vs-incassaprima'));
});

test('articolo in un\'altra lingua: lang sul contenitore', () => {
  assert.ok(renderArticle({ ...article, language: 'en' }).includes('<article class="blog-article" lang="en">'));
  assert.ok(renderArticle({ ...article, language: 'ar' }).includes('lang="ar" dir="rtl"'));
});

test('indice del blog: messaggio quando è vuoto, link Blog nascosto', () => {
  const empty = renderIndex([]);
  assert.ok(empty.includes('Ancora nessun articolo'));
  assert.ok(!empty.includes('href="/blog/" aria-current'));
  const full = renderIndex([article]);
  assert.ok(full.includes('href="/blog/come-sollecitare-una-fattura"'));
  assert.ok(!full.includes('Guida pratica al sollecito.</p>'));
});

test('sitemap con pagine fisse, /blog/ e articoli', () => {
  const xml = renderSitemap([{ loc: 'https://incassaprima.it/', lastmod: '2026-10-07' }], [article], '2026-10-15');
  assert.ok(xml.includes('<loc>https://incassaprima.it/blog/</loc>'));
  assert.ok(xml.includes('<loc>https://incassaprima.it/blog/come-sollecitare-una-fattura</loc>\n    <lastmod>2026-10-15</lastmod>'));
});

test('date in italiano', () => {
  assert.equal(formatDate('2026-01-05'), '5 gennaio 2026');
  assert.equal(formatDate(''), '');
});
