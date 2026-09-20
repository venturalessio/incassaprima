import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffDays, invoiceStatus, recommendedModel, fillTemplate } from '../app/lib/invoices.js';
import { moneyFromCents } from '../app/lib/format.js';

const REF = '2026-09-20';

test('diffDays: positivo se scaduta, negativo se futura', () => {
  assert.equal(diffDays({ due_date: '2026-09-10' }, REF), 10);
  assert.equal(diffDays({ due_date: '2026-09-30' }, REF), -10);
  assert.equal(diffDays({ due_date: REF }, REF), 0);
});

test('diffDays: senza scadenza valida restituisce 0', () => {
  assert.equal(diffDays({}, REF), 0);
});

test('invoiceStatus: uno stato esplicito ha sempre priorità sulla data', () => {
  assert.equal(invoiceStatus({ status: 'paid', due_date: '2020-01-01' }, REF), 'paid');
  assert.equal(invoiceStatus({ status: 'disputed', due_date: '2020-01-01' }, REF), 'disputed');
  assert.equal(invoiceStatus({ status: 'paused', due_date: '2099-01-01' }, REF), 'paused');
});

test('invoiceStatus: senza stato esplicito deriva da giorni di ritardo', () => {
  assert.equal(invoiceStatus({ due_date: '2026-09-10' }, REF), 'overdue');
  assert.equal(invoiceStatus({ due_date: '2026-09-25' }, REF), 'due');
  assert.equal(invoiceStatus({ due_date: '2026-10-20' }, REF), 'upcoming');
});

test('recommendedModel: sceglie il tono in base ai giorni di ritardo', () => {
  assert.equal(recommendedModel({ due_date: '2026-09-19' }, REF), 'courtesy');
  assert.equal(recommendedModel({ due_date: '2026-09-10' }, REF), 'first');
  assert.equal(recommendedModel({ due_date: '2026-08-01' }, REF), 'second');
});

test('fillTemplate: sostituisce tutti i segnaposto con i dati della fattura', () => {
  const text = fillTemplate(
    'Ciao {{cliente}}, fattura {{numero}} di {{importo}} scaduta il {{scadenza}} ({{giorni_ritardo}} giorni).',
    {
      customer_name: 'Rossi Impianti SRL',
      invoice_number: '24/2026',
      amount_cents: 250000,
      due_date: '2026-08-30'
    },
    REF
  );

  assert.equal(
    text,
    `Ciao Rossi Impianti SRL, fattura 24/2026 di ${moneyFromCents(250000)} scaduta il 30/08/2026 (21 giorni).`
  );
});

test('fillTemplate: giorni di ritardo non può essere negativo nel testo', () => {
  const text = fillTemplate('{{giorni_ritardo}}', { due_date: '2026-10-01' }, REF);
  assert.equal(text, '0');
});
