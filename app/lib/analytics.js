// Calcoli per la dashboard "Analisi incassi": totale scaduto, fasce di
// anzianità crediti e classifica dei principali debitori. Nessuna
// dipendenza da DOM, state applicativo o Supabase.

import { today } from './format.js';
import { diffDays, invoiceStatus } from './invoices.js';

export function computeAnalytics(invoices, referenceDate = today()) {
  const overdueInvoices = invoices.filter(
    (invoice) => invoiceStatus(invoice, referenceDate) === 'overdue'
  );

  let overdueCents = 0;

  const aging = {
    from0to30: { cents: 0, count: 0 },
    from31to60: { cents: 0, count: 0 },
    from61to90: { cents: 0, count: 0 },
    over90: { cents: 0, count: 0 }
  };

  const debtors = new Map();

  overdueInvoices.forEach((invoice) => {
    const cents = invoice.amount_cents !== undefined
      ? Number(invoice.amount_cents || 0)
      : Math.round(Number(invoice.amount || 0) * 100);

    const days = diffDays(invoice, referenceDate);
    const customer = invoice.customer_name || invoice.customer || 'Cliente';

    overdueCents += cents;

    if (days <= 30) {
      aging.from0to30.cents += cents;
      aging.from0to30.count += 1;
    } else if (days <= 60) {
      aging.from31to60.cents += cents;
      aging.from31to60.count += 1;
    } else if (days <= 90) {
      aging.from61to90.cents += cents;
      aging.from61to90.count += 1;
    } else {
      aging.over90.cents += cents;
      aging.over90.count += 1;
    }

    const current = debtors.get(customer) || {
      name: customer,
      cents: 0,
      count: 0,
      oldestDays: 0
    };

    current.cents += cents;
    current.count += 1;
    current.oldestDays = Math.max(current.oldestDays, days);

    debtors.set(customer, current);
  });

  const topDebtors = [...debtors.values()]
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 10);

  return {
    overdueCount: overdueInvoices.length,
    overdueCents,
    aging,
    topDebtors
  };
}
