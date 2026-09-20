// Logica pura sullo stato e le scadenze delle fatture: nessuna
// dipendenza da DOM, state applicativo o Supabase.

import { today, parseDateOnly, dateIt, money, moneyFromCents } from './format.js';

// Giorni trascorsi dalla scadenza (positivo = scaduta, negativo = a venire).
export function diffDays(invoice, referenceDate = today()) {
  const due = parseDateOnly(invoice.due_date || invoice.due);
  const currentDay = parseDateOnly(referenceDate);

  if (!due || !currentDay) {
    return 0;
  }

  return Math.floor((currentDay - due) / 86400000);
}

export function invoiceStatus(invoice, referenceDate = today()) {
  const rawStatus = invoice.status || (invoice.paid ? 'paid' : 'open');
  if (rawStatus === 'paid') return 'paid';
  if (rawStatus === 'promised') return 'promised';
  if (rawStatus === 'disputed') return 'disputed';
  if (rawStatus === 'paused') return 'paused';
  const days = diffDays(invoice, referenceDate);
  if (days > 0) return 'overdue';
  if (days >= -7) return 'due';
  return 'upcoming';
}

export function statusLabel(status) {
  return {
    paid: 'Pagata',
    promised: 'Promessa di pagamento',
    disputed: 'Contestata',
    paused: 'Sospesa',
    overdue: 'Scaduta',
    due: 'Entro 7 giorni',
    upcoming: 'Da incassare'
  }[status] || status;
}

export function recommendedModel(invoice, referenceDate = today()) {
  const days = diffDays(invoice, referenceDate);
  if (days <= 2) return 'courtesy';
  if (days <= 14) return 'first';
  return 'second';
}

export function recommendationText(invoice, referenceDate = today()) {
  const days = diffDays(invoice, referenceDate);
  if (days < 0) return `Mancano ${Math.abs(days)} giorni alla scadenza: consigliato il promemoria cortese.`;
  if (days === 0) return 'La fattura scade oggi: consigliato il promemoria cortese.';
  if (days <= 2) return `La fattura è scaduta da ${days} giorno${days === 1 ? '' : 'i'}: consigliato il promemoria cortese.`;
  if (days <= 14) return `La fattura è scaduta da ${days} giorni: consigliato il primo sollecito.`;
  return `La fattura è scaduta da ${days} giorni: consigliato il secondo sollecito.`;
}

export function fillTemplate(text, invoice, referenceDate = today()) {
  const customer = invoice.customer_name || invoice.customer || 'Cliente';
  const number = invoice.invoice_number || invoice.number || '—';
  const amount = invoice.amount_cents !== undefined
    ? moneyFromCents(invoice.amount_cents)
    : money(invoice.amount);
  const due = invoice.due_date || invoice.due;
  const days = Math.max(0, diffDays(invoice, referenceDate));

  return text
    .replace(/\{\{cliente\}\}/g, customer)
    .replace(/\{\{numero\}\}/g, number)
    .replace(/\{\{importo\}\}/g, amount)
    .replace(/\{\{scadenza\}\}/g, dateIt(due))
    .replace(/\{\{giorni_ritardo\}\}/g, String(days));
}
