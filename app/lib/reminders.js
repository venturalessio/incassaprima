// Logica pura di idoneità/scelta del modello per i promemoria automatici.
// Condivisa tra l'app (bozze generate quando l'utente ha il browser aperto)
// e la funzione server-side che genera/invia i promemoria su base
// pianificata, così le due parti applicano sempre le stesse regole.

import { today } from './format.js';
import { diffDays } from './invoices.js';

// Vero se una fattura è idonea alla creazione automatica di un promemoria:
// deve avere un cliente collegato con i solleciti non sospesi, e uno stato
// aperto (oppure "promessa di pagamento" con la data promessa già passata).
export function isEligibleForAutomaticReminder(invoice, customer, referenceDate = today()) {
  if (!invoice) return false;

  const status = invoice.status || 'open';

  if (invoice.source === 'local') return false;
  if (!customer || customer.reminders_paused) return false;
  if (['paid', 'disputed', 'paused'].includes(status)) return false;

  if (
    status === 'promised' &&
    invoice.promised_payment_date &&
    invoice.promised_payment_date >= referenceDate
  ) {
    return false;
  }

  return (
    status === 'open' ||
    (
      status === 'promised' &&
      (
        !invoice.promised_payment_date ||
        invoice.promised_payment_date < referenceDate
      )
    )
  );
}

// Modello di sollecito suggerito in base ai giorni di ritardo e alle
// regole dell'organizzazione (null se non è ancora il caso di sollecitare).
export function suggestedAutomaticModel(invoice, reminderSettings, referenceDate = today()) {
  const days = diffDays(invoice, referenceDate);
  const firstDays = Number(reminderSettings?.first_reminder_after_days || 3);
  const secondDays = Number(reminderSettings?.second_reminder_after_days || 15);

  if (days >= secondDays) return 'second';
  if (days >= firstDays) return 'first';
  return null;
}
