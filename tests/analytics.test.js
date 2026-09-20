import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAnalytics } from '../app/lib/analytics.js';

const REF = '2026-09-20';

function invoice(customer, dueDate, amountCents, status = 'open') {
  return { customer_name: customer, due_date: dueDate, amount_cents: amountCents, status };
}

test('computeAnalytics: ignora le fatture non scadute (pagate, promesse, future)', () => {
  const result = computeAnalytics([
    invoice('Rossi SRL', '2026-09-10', 10000, 'paid'),
    invoice('Bianchi SRL', '2026-09-10', 20000, 'promised'),
    invoice('Verdi SRL', '2026-10-10', 30000, 'open')
  ], REF);

  assert.equal(result.overdueCount, 0);
  assert.equal(result.overdueCents, 0);
  assert.equal(result.topDebtors.length, 0);
});

test('computeAnalytics: colloca ogni fattura scaduta nella fascia di anzianità giusta', () => {
  const result = computeAnalytics([
    invoice('A', '2026-09-01', 1000),   // 19 giorni -> 0-30
    invoice('B', '2026-08-01', 2000),   // 50 giorni -> 31-60
    invoice('C', '2026-07-01', 3000),   // 81 giorni -> 61-90
    invoice('D', '2026-05-01', 4000)    // 142 giorni -> oltre 90
  ], REF);

  assert.equal(result.aging.from0to30.count, 1);
  assert.equal(result.aging.from0to30.cents, 1000);
  assert.equal(result.aging.from31to60.count, 1);
  assert.equal(result.aging.from31to60.cents, 2000);
  assert.equal(result.aging.from61to90.count, 1);
  assert.equal(result.aging.from61to90.cents, 3000);
  assert.equal(result.aging.over90.count, 1);
  assert.equal(result.aging.over90.cents, 4000);

  assert.equal(result.overdueCount, 4);
  assert.equal(result.overdueCents, 10000);
});

test('computeAnalytics: i confini delle fasce (esattamente 30/60/90 giorni) restano nella fascia inferiore', () => {
  const result = computeAnalytics([
    invoice('A', '2026-08-21', 100), // esattamente 30 giorni
    invoice('B', '2026-07-22', 100), // esattamente 60 giorni
    invoice('C', '2026-06-22', 100)  // esattamente 90 giorni
  ], REF);

  assert.equal(result.aging.from0to30.count, 1);
  assert.equal(result.aging.from31to60.count, 1);
  assert.equal(result.aging.from61to90.count, 1);
  assert.equal(result.aging.over90.count, 0);
});

test('computeAnalytics: raggruppa più fatture dello stesso cliente e tiene il ritardo massimo', () => {
  const result = computeAnalytics([
    invoice('Rossi SRL', '2026-09-10', 10000), // 10 giorni
    invoice('Rossi SRL', '2026-08-01', 5000)   // 50 giorni
  ], REF);

  assert.equal(result.topDebtors.length, 1);
  assert.equal(result.topDebtors[0].name, 'Rossi SRL');
  assert.equal(result.topDebtors[0].cents, 15000);
  assert.equal(result.topDebtors[0].count, 2);
  assert.equal(result.topDebtors[0].oldestDays, 50);
});

test('computeAnalytics: la classifica debitori è ordinata per importo scaduto ed è limitata a 10', () => {
  const invoices = Array.from({ length: 12 }, (_, i) =>
    invoice(`Cliente ${i}`, '2026-08-01', (i + 1) * 1000)
  );

  const result = computeAnalytics(invoices, REF);

  assert.equal(result.topDebtors.length, 10);
  assert.equal(result.topDebtors[0].name, 'Cliente 11');
  assert.equal(result.topDebtors[0].cents, 12000);
  assert.equal(result.topDebtors[9].cents, 3000);
});
