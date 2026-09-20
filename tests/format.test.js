import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItalianAmount, money, moneyFromCents, dateIt, escapeHtml, parseDateOnly } from '../app/lib/format.js';

test('parseItalianAmount: formato italiano con virgola decimale', () => {
  assert.equal(parseItalianAmount('2.500,00'), 2500);
  assert.equal(parseItalianAmount('1.250,50'), 1250.5);
  assert.equal(parseItalianAmount('2,500'), 2.5);
});

test('parseItalianAmount: formato semplice senza migliaia', () => {
  assert.equal(parseItalianAmount('2500'), 2500);
  assert.equal(parseItalianAmount('2500,5'), 2500.5);
});

test('parseItalianAmount: formato con punto come decimale (stile US)', () => {
  assert.equal(parseItalianAmount('2500.50'), 2500.5);
});

test('parseItalianAmount: punto come separatore delle migliaia (3 decimali)', () => {
  assert.equal(parseItalianAmount('1.250.000'), 1250000);
});

test('parseItalianAmount: simbolo euro e spazi vengono ignorati', () => {
  assert.equal(parseItalianAmount('€ 2.500,00'), 2500);
  assert.equal(parseItalianAmount(' 2.500,00 '), 2500);
});

test('parseItalianAmount: input vuoto o non numerico', () => {
  assert.ok(Number.isNaN(parseItalianAmount('')));
  assert.ok(Number.isNaN(parseItalianAmount(null)));
  assert.ok(Number.isNaN(parseItalianAmount('abc')));
});

// Il separatore delle migliaia ("." in it-IT) dipende dai dati CLDR
// installati con Node: alcune build ne hanno un sottoinsieme e non lo
// applicano. Normalizziamo rimuovendolo per testare solo ciò che conta
// per l'app: cifre corrette, virgola come separatore decimale, simbolo €.
const stripGrouping = (s) => s.replace(/\./g, '');

test('money e moneyFromCents formattano in EUR con virgola decimale', () => {
  assert.match(stripGrouping(money(2500)), /2500,00/);
  assert.match(stripGrouping(moneyFromCents(250000)), /2500,00/);
  assert.match(moneyFromCents(0), /0,00/);
  assert.match(money(2500), /€/);
});

test('dateIt converte YYYY-MM-DD in DD/MM/YYYY', () => {
  assert.equal(dateIt('2026-08-30'), '30/08/2026');
  assert.equal(dateIt(''), '—');
  assert.equal(dateIt(null), '—');
});

test('escapeHtml neutralizza i caratteri pericolosi per XSS', () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );
  assert.equal(escapeHtml("O'Brien & Figli"), 'O&#039;Brien &amp; Figli');
  assert.equal(escapeHtml(null), '');
});

test('parseDateOnly costruisce una data locale valida', () => {
  const d = parseDateOnly('2026-01-05');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 5);
});

test('parseDateOnly restituisce null per input invalido', () => {
  assert.equal(parseDateOnly(''), null);
  assert.equal(parseDateOnly(null), null);
  assert.equal(parseDateOnly('non-una-data'), null);
});
