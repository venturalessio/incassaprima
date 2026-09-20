// Parsing/normalizzazione CSV ed Excel e sanitizzazione dell'export.
// Nessuna dipendenza da DOM, state applicativo o Supabase.

export function normalizeCsvHeader(value) {
  return String(value || '')
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function detectCsvDelimiter(text) {
  const firstLine = String(text || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .find((line) => line.trim());

  if (!firstLine) return ',';

  const candidates = [',', ';', '\t'];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: firstLine.split(delimiter).length - 1
    }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

export function parseCsvText(text, delimiter) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(value.trim());
      value = '';
      continue;
    }

    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }

      row.push(value.trim());

      if (row.some((cell) => cell !== '')) {
        rows.push(row);
      }

      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  row.push(value.trim());

  if (row.some((cell) => cell !== '')) {
    rows.push(row);
  }

  return rows;
}

export function normalizeImportedStatus(value) {
  const normalized = normalizeCsvHeader(value);

  const statuses = {
    open: 'open',
    aperta: 'open',
    daincassare: 'open',
    unpaid: 'open',

    paid: 'paid',
    pagata: 'paid',
    pagato: 'paid',

    promised: 'promised',
    promessapagamento: 'promised',
    promessadipagamento: 'promised',

    disputed: 'disputed',
    contestata: 'disputed',
    contestato: 'disputed',

    paused: 'paused',
    sospesa: 'paused',
    sospeso: 'paused'
  };

  return statuses[normalized] || 'open';
}

export function normalizeImportedDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let year;
  let month;
  let day;

  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);

  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);

    if (!match) return null;

    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function importKey(customerName, invoiceNumber, dueDate) {
  const customer = String(customerName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  const number = String(invoiceNumber || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  if (!customer || !number || !dueDate) return null;

  return `${customer}::${number}::${dueDate}`;
}

export function csvValueByAliases(row, columns, aliases) {
  for (const alias of aliases) {
    const index = columns[alias];

    if (index !== undefined && row[index] !== undefined) {
      return String(row[index] || '').trim();
    }
  }

  return '';
}

export function formatImportProblems(rows) {
  if (!rows.length) return '';

  const preview = rows
    .slice(0, 8)
    .map((row) => `• Riga ${row.line}: ${row.reason}`)
    .join('\n');

  const suffix =
    rows.length > 8
      ? `\n• …e altre ${rows.length - 8} righe`
      : '';

  return `\n\nDettaglio:\n${preview}${suffix}`;
}

// Neutralizza i valori che Excel/Sheets interpreterebbero come formule
// (CSV/formula injection) prefissandoli con un apice.
export function sanitizeCsvValue(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return text;
}

export function buildCsv(header, rows) {
  return [header, ...rows]
    .map((row) => row.map((value) => `"${sanitizeCsvValue(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
