// Funzioni pure di formattazione/parsing di date e importi.
// Nessuna dipendenza da DOM, state applicativo o Supabase: testabili
// direttamente con Node.

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function moneyFromCents(cents) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(Number(cents || 0) / 100);
}

export function money(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(Number(value || 0));
}

export function dateIt(value) {
  if (!value) return '—';
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Interpreta importi in formato italiano (1.250,50) o con notazioni miste
// (1250.50, 1250,50, 1.250.000) restituendo un Number in stile JS.
export function parseItalianAmount(value) {
  let s = String(value || '').trim().replace(/\s/g, '').replace(/€/g, '');
  if (!s) return NaN;

  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');

  if (comma > -1) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (dot > -1) {
    const decimals = s.slice(dot + 1);
    if (decimals.length === 3) s = s.replace(/\./g, '');
    else s = s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '');
  }

  return Number(s);
}

// Converte una stringa 'YYYY-MM-DD' in un Date locale a mezzanotte,
// oppure null se non è una data valida.
export function parseDateOnly(value) {
  const [year, month, day] = String(value || '')
    .slice(0, 10)
    .split('-')
    .map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}
