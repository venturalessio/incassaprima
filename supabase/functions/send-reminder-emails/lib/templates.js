// Testi dei modelli di sollecito. Condivisi tra l'app (bozze manuali) e la
// funzione server-side che genera/invia i promemoria automatici, così i
// due lati producono sempre lo stesso identico testo.

export const reminderModels = {
  courtesy: {
    label: '1. Promemoria cortese',
    subject: 'Promemoria scadenza fattura {{numero}}',
    body: `Buongiorno {{cliente}},

ti ricordiamo cortesemente che la fattura n. {{numero}}, di importo {{importo}}, è in scadenza il {{scadenza}}.

Restiamo a disposizione per qualsiasi necessità.

Grazie.`
  },
  first: {
    label: '2. Primo sollecito',
    subject: 'Promemoria pagamento fattura {{numero}}',
    body: `Buongiorno {{cliente}},

con la presente ricordiamo che la fattura n. {{numero}}, dell’importo di {{importo}}, con scadenza {{scadenza}}, risulta ancora da saldare.

Qualora il pagamento fosse già stato effettuato, ti chiediamo di ignorare questa comunicazione. Diversamente, puoi indicarci la data prevista di pagamento?

Grazie per la collaborazione.`
  },
  second: {
    label: '3. Secondo sollecito',
    subject: 'Secondo sollecito — fattura {{numero}} scaduta',
    body: `Buongiorno {{cliente}},

non risulta ancora pervenuto il pagamento della fattura n. {{numero}}, per un importo di {{importo}}, scaduta il {{scadenza}}.

Chiediamo cortesemente di procedere al saldo oppure di comunicarci entro breve la data prevista di pagamento.

Se hai già effettuato il pagamento, invia cortesemente la relativa contabile o ignora questa comunicazione.

Cordiali saluti.`
  }
};
