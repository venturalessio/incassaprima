import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStudioBilling, STUDIO_INCLUDED_COMPANIES, STUDIO_EXTRA_COMPANY_CENTS } from '../app/lib/billing.js';

test('computeStudioBilling: sotto o pari alla soglia inclusa, nessun extra', () => {
  assert.equal(computeStudioBilling(0).extraCompanies, 0);
  assert.equal(computeStudioBilling(STUDIO_INCLUDED_COMPANIES).extraCompanies, 0);
  assert.equal(computeStudioBilling(STUDIO_INCLUDED_COMPANIES).extraMonthlyCents, 0);
});

test('computeStudioBilling: sopra la soglia calcola le aziende extra e il costo', () => {
  const result = computeStudioBilling(STUDIO_INCLUDED_COMPANIES + 2);
  assert.equal(result.extraCompanies, 2);
  assert.equal(result.extraMonthlyCents, 2 * STUDIO_EXTRA_COMPANY_CENTS);
});

test('computeStudioBilling: valori non validi o negativi trattati come zero', () => {
  assert.equal(computeStudioBilling(-5).companyCount, 0);
  assert.equal(computeStudioBilling(NaN).companyCount, 0);
  assert.equal(computeStudioBilling(undefined).companyCount, 0);
});

test('computeStudioBilling: restituisce sempre companyCount e includedCompanies coerenti', () => {
  const result = computeStudioBilling(7);
  assert.equal(result.companyCount, 7);
  assert.equal(result.includedCompanies, STUDIO_INCLUDED_COMPANIES);
});
