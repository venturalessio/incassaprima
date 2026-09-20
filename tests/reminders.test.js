import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEligibleForAutomaticReminder, suggestedAutomaticModel } from '../app/lib/reminders.js';

const REF = '2026-09-20';

function invoice(overrides = {}) {
  return {
    id: 'inv-1',
    status: 'open',
    due_date: '2026-09-01',
    ...overrides
  };
}

function customer(overrides = {}) {
  return { id: 'cust-1', reminders_paused: false, ...overrides };
}

test('isEligibleForAutomaticReminder: fattura aperta con cliente attivo è idonea', () => {
  assert.equal(isEligibleForAutomaticReminder(invoice(), customer(), REF), true);
});

test('isEligibleForAutomaticReminder: nessuna fattura non è idonea', () => {
  assert.equal(isEligibleForAutomaticReminder(null, customer(), REF), false);
});

test('isEligibleForAutomaticReminder: fatture locali (non cloud) non sono idonee', () => {
  assert.equal(isEligibleForAutomaticReminder(invoice({ source: 'local' }), customer(), REF), false);
});

test('isEligibleForAutomaticReminder: senza cliente collegato non è idonea', () => {
  assert.equal(isEligibleForAutomaticReminder(invoice(), null, REF), false);
});

test('isEligibleForAutomaticReminder: cliente con solleciti sospesi non è idonea', () => {
  assert.equal(
    isEligibleForAutomaticReminder(invoice(), customer({ reminders_paused: true }), REF),
    false
  );
});

test('isEligibleForAutomaticReminder: stati pagata/contestata/sospesa non sono idonei', () => {
  assert.equal(isEligibleForAutomaticReminder(invoice({ status: 'paid' }), customer(), REF), false);
  assert.equal(isEligibleForAutomaticReminder(invoice({ status: 'disputed' }), customer(), REF), false);
  assert.equal(isEligibleForAutomaticReminder(invoice({ status: 'paused' }), customer(), REF), false);
});

test('isEligibleForAutomaticReminder: promessa di pagamento futura non è idonea', () => {
  assert.equal(
    isEligibleForAutomaticReminder(
      invoice({ status: 'promised', promised_payment_date: '2026-09-25' }),
      customer(),
      REF
    ),
    false
  );
});

test('isEligibleForAutomaticReminder: promessa di pagamento già scaduta è idonea', () => {
  assert.equal(
    isEligibleForAutomaticReminder(
      invoice({ status: 'promised', promised_payment_date: '2026-09-10' }),
      customer(),
      REF
    ),
    true
  );
});

test('isEligibleForAutomaticReminder: promessa di pagamento senza data è idonea', () => {
  assert.equal(
    isEligibleForAutomaticReminder(
      invoice({ status: 'promised', promised_payment_date: null }),
      customer(),
      REF
    ),
    true
  );
});

test('suggestedAutomaticModel: nessun modello prima della soglia del primo sollecito', () => {
  const inv = invoice({ due_date: '2026-09-19' }); // 1 giorno di ritardo
  assert.equal(suggestedAutomaticModel(inv, { first_reminder_after_days: 3, second_reminder_after_days: 15 }, REF), null);
});

test('suggestedAutomaticModel: primo sollecito raggiunta la soglia', () => {
  const inv = invoice({ due_date: '2026-09-15' }); // 5 giorni di ritardo
  assert.equal(suggestedAutomaticModel(inv, { first_reminder_after_days: 3, second_reminder_after_days: 15 }, REF), 'first');
});

test('suggestedAutomaticModel: secondo sollecito raggiunta la soglia', () => {
  const inv = invoice({ due_date: '2026-09-01' }); // 19 giorni di ritardo
  assert.equal(suggestedAutomaticModel(inv, { first_reminder_after_days: 3, second_reminder_after_days: 15 }, REF), 'second');
});

test('suggestedAutomaticModel: usa i valori di default se le impostazioni mancano', () => {
  const inv = invoice({ due_date: '2026-09-01' }); // 19 giorni di ritardo
  assert.equal(suggestedAutomaticModel(inv, null, REF), 'second');
});
