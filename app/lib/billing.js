// Calcolo del costo extra dello Studio in base al numero di aziende
// gestite, secondo il modello di prezzo pubblicato (vedi ROADMAP.md):
// un tot di aziende incluse nel canone base, poi un costo per ogni
// azienda aggiuntiva. Nessuna dipendenza da DOM, state applicativo o
// Supabase: la fatturazione resta manuale finché non esisterà
// un'integrazione di pagamento reale, questo serve solo a mostrare
// all'utente (e al titolare, per fatturare a mano) quanto costerebbe.

export const STUDIO_INCLUDED_COMPANIES = 3;
export const STUDIO_EXTRA_COMPANY_CENTS = 500;

export function computeStudioBilling(companyCount) {
  const count = Math.max(0, Number(companyCount) || 0);
  const extraCount = Math.max(0, count - STUDIO_INCLUDED_COMPANIES);

  return {
    companyCount: count,
    includedCompanies: STUDIO_INCLUDED_COMPANIES,
    extraCompanies: extraCount,
    extraMonthlyCents: extraCount * STUDIO_EXTRA_COMPANY_CENTS
  };
}
