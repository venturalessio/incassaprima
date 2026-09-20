import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCsvHeader,
  detectCsvDelimiter,
  parseCsvText,
  normalizeImportedStatus,
  normalizeImportedDate,
  importKey,
  csvValueByAliases,
  sanitizeCsvValue,
  buildCsv
} from '../app/lib/csv.js';

test('normalizeCsvHeader: rimuove accenti, BOM e caratteri non alfanumerici', () => {
  assert.equal(normalizeCsvHeader('Numero Fattura'), 'numerofattura');
  assert.equal(normalizeCsvHeader('Città'), 'citta');
  assert.equal(normalizeCsvHeader('﻿Cliente'), 'cliente');
});

test('detectCsvDelimiter: sceglie il separatore più frequente sulla prima riga', () => {
  assert.equal(detectCsvDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectCsvDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectCsvDelimiter('a\tb\tc'), '\t');
  assert.equal(detectCsvDelimiter(''), ',');
});

test('parseCsvText: gestisce virgolette, valori con delimitatore incluso e righe vuote', () => {
  const text = 'nome,importo\n"Rossi, Impianti",100\n\n"Con ""virgolette""",200';
  const rows = parseCsvText(text, ',');
  assert.deepEqual(rows, [
    ['nome', 'importo'],
    ['Rossi, Impianti', '100'],
    ['Con "virgolette"', '200']
  ]);
});

test('parseCsvText: gestisce fine riga CRLF', () => {
  const rows = parseCsvText('a,b\r\n1,2\r\n', ',');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('normalizeImportedStatus: riconosce le etichette italiane e inglesi più comuni', () => {
  assert.equal(normalizeImportedStatus('Pagata'), 'paid');
  assert.equal(normalizeImportedStatus('paid'), 'paid');
  assert.equal(normalizeImportedStatus('Contestata'), 'disputed');
  assert.equal(normalizeImportedStatus('Sospeso'), 'paused');
  assert.equal(normalizeImportedStatus('qualcosa di sconosciuto'), 'open');
});

test('normalizeImportedDate: accetta sia YYYY-MM-DD sia DD/MM/YYYY', () => {
  assert.equal(normalizeImportedDate('2026-08-30'), '2026-08-30');
  assert.equal(normalizeImportedDate('30/08/2026'), '2026-08-30');
  assert.equal(normalizeImportedDate('30.08.2026'), '2026-08-30');
});

test('normalizeImportedDate: rifiuta date inesistenti o malformate', () => {
  assert.equal(normalizeImportedDate('31/02/2026'), null);
  assert.equal(normalizeImportedDate('non una data'), null);
  assert.equal(normalizeImportedDate(''), null);
});

test('importKey: normalizza spazi e maiuscole per rilevare duplicati', () => {
  assert.equal(
    importKey('Rossi  Impianti', ' 24/2026 ', '2026-08-30'),
    importKey('rossi impianti', '24/2026', '2026-08-30')
  );
  assert.equal(importKey('', '24/2026', '2026-08-30'), null);
  assert.equal(importKey('Rossi', '', '2026-08-30'), null);
  assert.equal(importKey('Rossi', '24/2026', ''), null);
});

test('csvValueByAliases: prende il primo alias presente nella riga', () => {
  const columns = { cliente: 0, importo: 1 };
  assert.equal(csvValueByAliases(['Rossi', '100'], columns, ['nome', 'cliente']), 'Rossi');
  assert.equal(csvValueByAliases(['Rossi', '100'], columns, ['nomemancante']), '');
});

test('sanitizeCsvValue: neutralizza i valori che Excel interpreterebbe come formule', () => {
  assert.equal(sanitizeCsvValue('=CMD(...)'), "'=CMD(...)");
  assert.equal(sanitizeCsvValue('+1234'), "'+1234");
  assert.equal(sanitizeCsvValue('-1234'), "'-1234");
  assert.equal(sanitizeCsvValue('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(sanitizeCsvValue('Rossi Impianti SRL'), 'Rossi Impianti SRL');
});

test('buildCsv: produce righe quotate correttamente e sanitizzate', () => {
  const csv = buildCsv(['nome', 'note'], [['Rossi "Sas"', '=1+1']]);
  assert.equal(csv, '"nome","note"\n"Rossi ""Sas""","\'=1+1"');
});
