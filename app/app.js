/*
  INCASSAPRIMA PRO 1
  1) Sostituisci INCOLLA_QUI... con Project URL e Publishable key di Supabase.
  2) Non inserire mai una chiave sb_secret_ o service_role in questo file.
*/

import {
  today,
  moneyFromCents,
  money,
  dateIt,
  escapeHtml,
  parseItalianAmount,
  parseDateOnly
} from './lib/format.js';

import {
  diffDays,
  invoiceStatus,
  statusLabel,
  recommendedModel,
  recommendationText,
  fillTemplate
} from './lib/invoices.js';

import {
  normalizeCsvHeader,
  detectCsvDelimiter,
  parseCsvText,
  normalizeImportedStatus,
  normalizeImportedDate,
  importKey,
  csvValueByAliases,
  formatImportProblems,
  buildCsv
} from './lib/csv.js';

(function () {
  'use strict';

  const SUPABASE_URL = 'https://dxlmtihwvcqstrxwzapj.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ibxT_9Bc7rUznsufgMS7ow_u5ydz5fa';
  const LOCAL_KEY = 'incassaprima_pwa_v1';

  const $ = (id) => document.getElementById(id);
  const state = {
    supabase: null,
    session: null,
    organization: null,
    customers: [],
    invoices: [],
    activeInvoice: null,
    statusInvoice: null,
    activeCustomer: null,
    scheduledReminders: [],
    activeScheduledReminder: null,
    reminderSettings: {
      first_reminder_after_days: 3,
      second_reminder_after_days: 15,
      approval_required: true,
      automatic_email_enabled: false
    },

    localInvoices: [],

    // Modalità Studio: la propria organizzazione "identità" (creata alla
    // registrazione) è l'area di lavoro predefinita, per le fatture dirette
    // dello studio — esattamente come per un utente Pro. Lo switcher
    // permette inoltre di entrare in una o più aziende gestite
    // (organizations.managed_by = identità), isolate tra loro e
    // dall'identità stessa.
    isStudioAccount: false,
    studioIdentityOrgId: null,
    studioIdentityOrg: null,
    studioCompanies: [],
    studioMetrics: {
      totalOpenCents: 0,
      totalOverdueCents: 0,
      totalOverdueCount: 0,
      byCompany: {},
      own: { openCents: 0, overdueCents: 0, overdueCount: 0 }
    }
  };

  const models = {
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

  function configured() {
    return SUPABASE_URL.startsWith('https://') &&
      SUPABASE_URL.includes('.supabase.co') &&
      SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_');
  }

  function toast(message, persistent = false) {
    const el = $('toast');
    if (!el) return;

    clearTimeout(window.__incassaToast);
    window.__incassaToast = null;

    el.textContent = message;
    el.style.display = 'block';

    if (!persistent) {
      window.__incassaToast = setTimeout(() => {
        el.style.display = 'none';
        window.__incassaToast = null;
      }, 2800);
    }
  }

  function showImportSummary(message) {
    window.alert(`Importazione CSV completata\n\n${message}`);
  }

  function closeImportSummary() {
    const back = $('importSummaryBack');
    if (!back) return;

    back.style.display = 'none';
  }

  function setStatus(message, type = 'info') {
    const el = $('syncStatus');
    if (!el) return;
    el.textContent = message;
    el.className = `sync-status ${type}`;
  }

  function getCustomerForInvoice(invoice) {
    if (!invoice || !invoice.customer_id) return null;

    return state.customers.find(
      (customer) => customer.id === invoice.customer_id
    ) || null;
  }

  function isEligibleForAutomaticReminder(invoice) {
    const customer = getCustomerForInvoice(invoice);
    const status = invoice.status || 'open';
    const todayIso = today();

    if (!invoice || invoice.source !== 'cloud') return false;
    if (!customer || customer.reminders_paused) return false;
    if (['paid', 'disputed', 'paused'].includes(status)) return false;

    if (
      status === 'promised' &&
      invoice.promised_payment_date &&
      invoice.promised_payment_date >= todayIso
    ) {
      return false;
    }

    return (
      status === 'open' ||
      (
        status === 'promised' &&
        (
          !invoice.promised_payment_date ||
          invoice.promised_payment_date < todayIso
        )
      )
    );
  }
  function normalizeLocalInvoices() {
    try {
      const data = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
      state.localInvoices = Array.isArray(data) ? data : [];
    } catch {
      state.localInvoices = [];
    }
  }

  function localToView(invoice) {
    return {
      id: invoice.id,
      customer_name: invoice.customer,
      customer_email: invoice.email || '',
      invoice_number: invoice.number || '',
      amount: Number(invoice.amount || 0),
      due: invoice.due,
      status: invoice.status || (invoice.paid ? 'paid' : 'open'),
      promised_payment_date: invoice.promised_payment_date || null,
      source: 'local'
    };
  }
  function updateAccountUi() {
    const authButton = $('authBtn');
    const signOutButton = $('signOutBtn');

    if (!authButton || !signOutButton) return;

    if (state.session) {
      authButton.style.display = 'none';
      signOutButton.style.display = 'inline-block';
    } else {
      authButton.style.display = 'inline-block';
      signOutButton.style.display = 'none';
    }

    // Gestione visibilità funzionalità per piano
    updateFeaturesByPlan();
  }

  function updateFeaturesByPlan() {
    // Dashboard Studio: visibile solo per gli account Studio (indipendentemente
    // dal piano dell'azienda attualmente aperta, che è sempre 'free').
    const studioBtn = $('studioBtn');
    if (studioBtn) {
      studioBtn.style.display = state.isStudioAccount ? 'inline-block' : 'none';
    }
  }

  async function initializeSupabase() {
    if (!configured()) {
      setStatus('Modalità locale: configura Supabase per attivare Pro.', 'warning');
      return;
    }

    if (!window.supabase || !window.supabase.createClient) {
      setStatus('Errore: libreria Supabase non caricata.', 'error');
      return;
    }

    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

    const { data, error } = await state.supabase.auth.getSession();
    if (error) {
      setStatus(`Errore sessione: ${error.message}`, 'error');
      return;
    }

    state.session = data.session;
    updateAccountUi();
    if (state.session) {
      await loadCloudData();
      setStatus(`Cloud attivo · ${state.session.user.email}`, 'success');
    } else {
      setStatus('Modalità locale. Accedi per salvare nel cloud.', 'info');
    }
  }


  async function loadReminderSettings() {
    if (!state.session || !state.organization) {
      return;
    }

    const { data, error } = await state.supabase
      .from('organization_reminder_settings')
      .select('*')
      .eq('organization_id', state.organization.id)
      .maybeSingle();

    if (error) {
      console.error('Errore caricamento regole:', error.message);
      return;
    }

    if (data) {
      state.reminderSettings = data;
    }
  }
  async function loadCloudData() {
    if (!state.supabase || !state.session) return;

    const { data: memberships, error: membershipError } = await state.supabase
      .from('organization_members')
      .select('organization_id, role, organizations(id, name, plan, managed_by)')
      .eq('user_id', state.session.user.id);

    if (membershipError) {
      setStatus(`Errore organizzazione: ${membershipError.message}`, 'error');
      return;
    }

    if (!memberships || !memberships.length) {
      setStatus('Account creato ma organizzazione non trovata. Controlla il trigger SQL.', 'error');
      return;
    }

    const identityMembership = memberships.find(
      (m) => m.organizations && m.organizations.plan === 'studio'
    );

    if (identityMembership) {
      // Account Studio: l'organizzazione "identità" è anche l'area di
      // lavoro predefinita (lo studio ha le sue fatture dirette, come un
      // utente Pro). Le aziende gestite sono le altre organizzazioni
      // collegate ad essa tramite managed_by, raggiungibili dallo switcher.
      state.isStudioAccount = true;
      state.studioIdentityOrgId = identityMembership.organization_id;
      state.studioIdentityOrg = identityMembership.organizations;
      state.studioCompanies = memberships
        .filter((m) => m.organizations && m.organizations.managed_by === state.studioIdentityOrgId)
        .map((m) => m.organizations)
        .sort((a, b) => a.name.localeCompare(b.name));

      await loadOrganizationData(state.studioIdentityOrg);
      return;
    }

    state.isStudioAccount = false;
    state.studioIdentityOrgId = null;
    state.studioCompanies = [];

    await loadOrganizationData(memberships[0].organizations);
  }

  // Carica clienti, fatture, regole di sollecito e promemoria programmati
  // per una singola organizzazione (la propria, per un utente Free/Pro, o
  // un'azienda scelta dallo switcher Studio) e la imposta come attiva.
  async function loadOrganizationData(organization) {
    state.organization = organization;
    updateAccountUi();

    const organizationId = organization.id;
    await loadReminderSettings();

    const { data: customers, error: customerError } = await state.supabase
      .from('customers')
      .select('*')
      .eq('organization_id', organizationId)
      .order('name');

    if (customerError) {
      setStatus(`Errore clienti: ${customerError.message}`, 'error');
      return;
    }

    const { data: invoices, error: invoiceError } = await state.supabase
      .from('invoices')
      .select('*, customers(name, email)')
      .eq('organization_id', organizationId)
      .order('due_date');

    if (invoiceError) {
      setStatus(`Errore fatture: ${invoiceError.message}`, 'error');
      return;
    }

    state.customers = customers || [];
    state.invoices = (invoices || []).map((invoice) => ({
      ...invoice,
      customer_name: invoice.customers ? invoice.customers.name : 'Cliente',
      customer_email: invoice.customers ? invoice.customers.email : '',
      source: 'cloud'
    }));

    updateCustomerOptions();
    render();
    await loadScheduledReminders();
    await generateScheduledReminders();
  }

  // Apre un'azienda gestita dallo Studio: carica i suoi dati e torna alla
  // vista principale, esattamente come per un account Pro.
  async function selectCompany(organizationId) {
    const company = state.studioCompanies.find((c) => c.id === organizationId);
    if (!company) return;

    closeStudio();
    setStatus(`Cloud attivo · ${company.name}`, 'success');
    await loadOrganizationData(company);
  }

  // Torna alle fatture dirette dello Studio (la propria organizzazione
  // identità), dopo essere stati dentro un'azienda gestita.
  async function openOwnStudio() {
    if (!state.studioIdentityOrg) return;

    closeStudio();
    setStatus(`Cloud attivo · ${state.studioIdentityOrg.name}`, 'success');
    await loadOrganizationData(state.studioIdentityOrg);
  }

  // Rinomina un'organizzazione (l'identità Studio o un'azienda gestita).
  // Le RLS permettono già all'owner di aggiornare solo la colonna name,
  // nessuna funzione server-side necessaria.
  async function renameOrganization(organizationId, currentName) {
    const input = window.prompt('Nuovo nome:', currentName);
    if (input === null) return;

    const trimmed = input.trim();
    if (trimmed.length < 2) {
      toast('Il nome deve avere almeno 2 caratteri.');
      return;
    }
    if (trimmed === currentName) return;

    const { error } = await state.supabase
      .from('organizations')
      .update({ name: trimmed })
      .eq('id', organizationId);

    if (error) {
      toast(`Impossibile rinominare: ${error.message}`);
      return;
    }

    if (state.studioIdentityOrg && state.studioIdentityOrg.id === organizationId) {
      state.studioIdentityOrg.name = trimmed;
    }
    const company = state.studioCompanies.find((c) => c.id === organizationId);
    if (company) company.name = trimmed;
    if (state.organization && state.organization.id === organizationId) {
      state.organization.name = trimmed;
    }

    renderStudio();
    toast('Nome aggiornato.');
  }

  // Elimina definitivamente un'azienda gestita (clienti, fatture, storico
  // compresi) tramite la funzione server-side dedicata: richiede di
  // scrivere il nome esatto come conferma, non è mai possibile eliminare
  // l'identità Studio da qui.
  async function deleteManagedCompany(organizationId, name) {
    const confirmation = window.prompt(
      `Stai per eliminare definitivamente "${name}" con tutti i suoi clienti e fatture. L'operazione non è reversibile.\n\nScrivi il nome esatto dell'azienda per confermare:`
    );
    if (confirmation === null) return;
    if (confirmation !== name) {
      toast('Nome non corrispondente: eliminazione annullata.');
      return;
    }

    const { error } = await state.supabase.rpc('delete_managed_company', {
      company_id: organizationId
    });

    if (error) {
      toast(`Impossibile eliminare l'azienda: ${error.message}`);
      return;
    }

    if (state.organization && state.organization.id === organizationId) {
      await loadOrganizationData(state.studioIdentityOrg);
    }

    await refreshStudioCompanies();
    await loadStudioOverview();
    renderStudio();
    toast('Azienda eliminata.');
  }

  // Ricarica solo l'elenco delle aziende gestite (dopo averne creata una),
  // senza toccare l'azienda eventualmente già aperta.
  async function refreshStudioCompanies() {
    if (!state.supabase || !state.session || !state.studioIdentityOrgId) return;

    const { data: memberships, error } = await state.supabase
      .from('organization_members')
      .select('organizations(id, name, plan, managed_by)')
      .eq('user_id', state.session.user.id);

    if (error) {
      toast(`Errore caricamento aziende: ${error.message}`);
      return;
    }

    state.studioCompanies = (memberships || [])
      .map((m) => m.organizations)
      .filter((org) => org && org.managed_by === state.studioIdentityOrgId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Calcola i totali "da incassare"/"scaduto" per ogni azienda gestita, il
  // totale aggregato su tutte insieme e quello delle fatture dirette dello
  // Studio, in un'unica query (le RLS esistenti restituiscono solo le
  // fatture delle organizzazioni di cui l'utente è membro, quindi nessun
  // controllo aggiuntivo è necessario qui). Le fatture dirette dello
  // Studio non entrano nel totale aggregato "aziende gestite": sono
  // mostrate a parte, in `own`.
  async function loadStudioOverview() {
    const companyIds = state.studioCompanies.map((c) => c.id);
    const allIds = state.studioIdentityOrgId ? [...companyIds, state.studioIdentityOrgId] : companyIds;

    const byCompany = {};
    companyIds.forEach((id) => {
      byCompany[id] = { openCents: 0, overdueCents: 0, overdueCount: 0 };
    });
    const own = { openCents: 0, overdueCents: 0, overdueCount: 0 };

    if (!allIds.length) {
      state.studioMetrics = { totalOpenCents: 0, totalOverdueCents: 0, totalOverdueCount: 0, byCompany, own };
      return;
    }

    const { data: invoices, error } = await state.supabase
      .from('invoices')
      .select('organization_id, amount_cents, status, due_date')
      .in('organization_id', allIds);

    if (error) {
      console.error('Errore caricamento riepilogo Studio:', error.message);
      return;
    }

    let totalOpenCents = 0;
    let totalOverdueCents = 0;
    let totalOverdueCount = 0;

    (invoices || []).forEach((invoice) => {
      const status = invoiceStatus(invoice);
      if (['paid', 'disputed', 'paused'].includes(status)) return;

      const cents = Number(invoice.amount_cents || 0);

      if (invoice.organization_id === state.studioIdentityOrgId) {
        own.openCents += cents;
        if (status === 'overdue') {
          own.overdueCents += cents;
          own.overdueCount += 1;
        }
        return;
      }

      const bucket = byCompany[invoice.organization_id];
      if (!bucket) return;

      bucket.openCents += cents;
      totalOpenCents += cents;

      if (status === 'overdue') {
        bucket.overdueCents += cents;
        bucket.overdueCount += 1;
        totalOverdueCents += cents;
        totalOverdueCount += 1;
      }
    });

    state.studioMetrics = { totalOpenCents, totalOverdueCents, totalOverdueCount, byCompany, own };
  }

  async function createManagedCompany(name) {
    const trimmed = String(name || '').trim();
    if (trimmed.length < 2) {
      toast('Inserisci un nome azienda di almeno 2 caratteri.');
      return;
    }

    const { data: newOrgId, error } = await state.supabase.rpc('create_managed_company', {
      company_name: trimmed
    });

    if (error) {
      toast(`Impossibile creare l'azienda: ${error.message}`);
      return;
    }

    await refreshStudioCompanies();
    await loadStudioOverview();
    renderStudio();
    toast('Azienda creata.');
    return newOrgId;
  }

  function updateCustomerOptions() {
    const select = $('customerSelect');
    if (!select) return;

    const selected = select.value;
    select.innerHTML = '<option value="">Nuovo cliente / inserisci nome</option>' +
      state.customers.map((customer) =>
        `<option value="${customer.id}">${escapeHtml(customer.name)}${customer.email ? ` · ${escapeHtml(customer.email)}` : ''}</option>`
      ).join('');
    select.value = selected;
  }

  function shownInvoices() {
    const query = ($('search')?.value || '').toLowerCase();
    const filter = $('filter')?.value || 'all';
    const source = state.session ? state.invoices : state.localInvoices.map(localToView);

    return source.filter((invoice) => {
      const status = invoiceStatus(invoice);
      const text = `${invoice.customer_name || invoice.customer || ''} ${invoice.invoice_number || invoice.number || ''}`.toLowerCase();
      const matchesText = !query || text.includes(query);
      const matchesStatus = filter === 'all' || (filter === 'open'
        ? !['paid', 'disputed', 'paused'].includes(status)
        : status === filter);
      return matchesText && matchesStatus;
    }).sort((a, b) => String(a.due_date || a.due || '').localeCompare(String(b.due_date || b.due || '')));
  }

  function render() {
    const source = state.session ? state.invoices : state.localInvoices.map(localToView);
    let openCents = 0;
    let overdueCents = 0;
    let paidCents = 0;
    let overdueCount = 0;

    source.forEach((invoice) => {
      const cents = invoice.amount_cents !== undefined
        ? Number(invoice.amount_cents)
        : Math.round(Number(invoice.amount || 0) * 100);
      const status = invoiceStatus(invoice);
      if (status === 'paid') paidCents += cents;
      else if (!['disputed', 'paused'].includes(status)) {
        openCents += cents;
        if (status === 'overdue') {
          overdueCents += cents;
          overdueCount += 1;
        }
      }
    });

    $('openTotal').textContent = moneyFromCents(openCents);
    $('overdueTotal').textContent = moneyFromCents(overdueCents);
    $('overdueCount').textContent = overdueCount;
    $('paidTotal').textContent = moneyFromCents(paidCents);

    const list = shownInvoices();
    if (!list.length) {
      $('tableWrap').innerHTML = '<div class="empty">Nessuna scadenza trovata. Aggiungine una qui sopra.</div>';
      renderPriorityDashboard();
      return;
    }

    $('tableWrap').innerHTML = `
      <table>
        <thead><tr>
          <th>Cliente / fattura</th><th>Scadenza</th><th>Importo</th><th>Stato</th><th>Azioni</th>
        </tr></thead>
        <tbody>
          ${list.map((invoice) => {
      const status = invoiceStatus(invoice);
      const amount = invoice.amount_cents !== undefined ? moneyFromCents(invoice.amount_cents) : money(invoice.amount);
      const customer = invoice.customer_name || invoice.customer || 'Cliente';
      const number = invoice.invoice_number || invoice.number || 'Senza numero';
      const email = invoice.customer_email || invoice.email || '';
      const customerRecord = getCustomerForInvoice(invoice);

      const autoPaused = Boolean(
        customerRecord && customerRecord.reminders_paused
      );

      const autoPausedNote = autoPaused
        ? '<br><small style="color:#b45309;font-weight:700">⚠ Auto-solleciti sospesi per cliente</small>'
        : '';
      return `
              <tr>
                <td><strong>${escapeHtml(customer)}</strong><br><small>${escapeHtml(number)}${email ? ` · ${escapeHtml(email)}` : ''}</small>${autoPausedNote}</td>
                <td>${dateIt(invoice.due_date || invoice.due)}</td>
                <td class="amount">${amount}</td>
                <td><span class="badge ${status}">${statusLabel(status)}</span></td>
                <td><div class="rowactions">
                  ${!['paid', 'disputed', 'paused'].includes(status) ? `<button type="button" class="small violet" data-op="remind" data-id="${invoice.id}">Sollecito</button>` : ''}
                  <button type="button" class="small secondary" data-op="history" data-id="${invoice.id}">Storico</button>
                  <button type="button" class="small secondary" data-op="status" data-id="${invoice.id}">${status === 'paid' ? 'Riapri' : 'Stato'}</button>
                  <button type="button" class="small danger" data-op="delete" data-id="${invoice.id}">Elimina</button>
                </div></td>
              </tr>`;
    }).join('')}
        </tbody>
      </table>`;
    renderPriorityDashboard();
  }

  async function addInvoice() {
    const customerName = $('customer').value.trim();
    const customerEmail = $('email').value.trim();
    const customerId = $('customerSelect').value;
    const invoiceNumber = $('number').value.trim();
    const amount = parseItalianAmount($('amount').value);
    const dueDate = $('dueDate').value;
    const issueDate = $('issueDate').value || null;

    if (!customerId && !customerName) {
      toast('Inserisci il nome del cliente oppure seleziona un cliente esistente.');
      $('customer').focus();
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Inserisci un importo valido, ad esempio 2.500,00.');
      $('amount').focus();
      return;
    }
    if (!dueDate) {
      toast('Inserisci la data di scadenza.');
      $('dueDate').focus();
      return;
    }

    if (state.session && state.isStudioAccount && !state.organization) {
      toast('Seleziona prima un\'azienda dalla dashboard Studio.');
      openStudio();
      return;
    }

    if (!state.session) {
      const localInvoice = {
        id: `${Date.now()}-${Math.random()}`,
        customer: customerName,
        number: invoiceNumber,
        amount,
        due: dueDate,
        email: customerEmail,
        paid: false
      };
      state.localInvoices.push(localInvoice);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state.localInvoices));
      clearForm();
      render();
      toast('Scadenza salvata in locale. Accedi per salvarla nel cloud.');
      return;
    }

    setStatus('Salvataggio cloud in corso…', 'info');
    let actualCustomerId = customerId;

    if (!actualCustomerId) {
      const { data: newCustomer, error: customerError } = await state.supabase
        .from('customers')
        .insert({
          organization_id: state.organization.id,
          name: customerName,
          email: customerEmail || null
        })
        .select()
        .single();

      if (customerError) {
        setStatus(`Errore salvataggio cliente: ${customerError.message}`, 'error');
        return;
      }
      actualCustomerId = newCustomer.id;
      state.customers.push(newCustomer);
    }

    const { data: newInvoice, error: invoiceError } = await state.supabase
      .from('invoices')
      .insert({
        organization_id: state.organization.id,
        customer_id: actualCustomerId,
        invoice_number: invoiceNumber || null,
        amount_cents: Math.round(amount * 100),
        issue_date: issueDate,
        due_date: dueDate,
        status: 'open'
      })
      .select('*, customers(name, email)')
      .single();

    if (invoiceError) {
      setStatus(`Errore salvataggio fattura: ${invoiceError.message}`, 'error');
      return;
    }

    state.invoices.push({
      ...newInvoice,
      customer_name: newInvoice.customers?.name || customerName,
      customer_email: newInvoice.customers?.email || customerEmail,
      source: 'cloud'
    });
    updateCustomerOptions();
    clearForm();
    render();
    setStatus(`Cloud attivo · ${state.session.user.email}`, 'success');
    toast(`Scadenza salvata nel cloud: ${moneyFromCents(newInvoice.amount_cents)}`);
  }

  function clearForm() {
    $('customerSelect').value = '';
    $('customer').value = '';
    $('email').value = '';
    $('number').value = '';
    $('amount').value = '';
    $('issueDate').value = '';
    $('dueDate').value = today();
  }

  function findInvoice(id) {
    const source = state.session ? state.invoices : state.localInvoices.map(localToView);
    return source.find((invoice) => String(invoice.id) === String(id));
  }

  function openStatusModal(invoice) {
    state.statusInvoice = invoice;

    const current = invoice.status &&
      ['open', 'paid', 'promised', 'disputed', 'paused'].includes(invoice.status)
      ? invoice.status
      : 'open';

    $('statusTitle').textContent = 'Aggiorna stato fattura';

    $('statusSubtitle').textContent =
      `Fattura ${invoice.invoice_number || invoice.number || 'senza numero'} · ${invoice.amount_cents !== undefined
        ? moneyFromCents(invoice.amount_cents)
        : money(invoice.amount)
      }`;

    const selected = document.querySelector(
      `input[name="invoiceStatus"][value="${current}"]`
    );

    if (selected) selected.checked = true;

    $('promiseDate').value = invoice.promised_payment_date || '';
    $('promiseField').classList.toggle('visible', current === 'promised');
    $('statusBack').style.display = 'flex';
  }

  function closeStatusModal() {
    state.statusInvoice = null;
    $('statusBack').style.display = 'none';
  }

  function selectedInvoiceStatus() {
    const selected = document.querySelector(
      'input[name="invoiceStatus"]:checked'
    );

    return selected ? selected.value : null;
  }

  async function saveInvoiceStatus() {
    const invoice = state.statusInvoice;
    const status = selectedInvoiceStatus();

    if (!invoice || !status) {
      toast('Seleziona uno stato per la fattura.');
      return;
    }

    const promiseDate = $('promiseDate').value || null;

    if (status === 'promised' && !promiseDate) {
      toast('Inserisci la data promessa di pagamento.');
      $('promiseDate').focus();
      return;
    }

    if (!state.session) {
      const local = state.localInvoices.find(
        (item) => String(item.id) === String(invoice.id)
      );

      if (!local) {
        return;
      }

      local.status = status;
      local.paid = status === 'paid';
      local.promised_payment_date =
        status === 'promised' ? promiseDate : null;
      local.paid_at =
        status === 'paid' ? new Date().toISOString() : null;

      localStorage.setItem(LOCAL_KEY, JSON.stringify(state.localInvoices));
      closeStatusModal();
      render();
      toast('Stato aggiornato in locale.');
      return;
    }

    const previousStatus = invoice.status || 'open';

    const update = {
      status,
      paid_at: status === 'paid' ? new Date().toISOString() : null,
      promised_payment_date:
        status === 'promised' ? promiseDate : null
    };

    const { error } = await state.supabase
      .from('invoices')
      .update(update)
      .eq('id', invoice.id);

    if (error) {
      toast(`Errore aggiornamento stato: ${error.message}`);
      return;
    }

    await logInvoiceActivity(
      invoice.id,
      'invoice_status_changed',
      `Stato fattura aggiornato da "${statusLabel(previousStatus)}" a "${statusLabel(status)}".`,
      {
        previous_status: previousStatus,
        new_status: status,
        promised_payment_date: status === 'promised' ? promiseDate : null
      }
    );

    if (status === 'promised') {
      await logInvoiceActivity(
        invoice.id,
        'payment_promise_created',
        `Promessa di pagamento registrata per il ${dateIt(promiseDate)}.`,
        {
          promised_payment_date: promiseDate
        }
      );
    }

    const promiseIsFuture =
      status === 'promised' &&
      promiseDate >= today();

    const mustCancelScheduledReminders =
      status === 'paid' ||
      status === 'disputed' ||
      status === 'paused' ||
      promiseIsFuture;

    if (mustCancelScheduledReminders) {
      const { data: cancelledReminders, error: cancelError } =
        await state.supabase
          .from('reminders')
          .update({ status: 'cancelled' })
          .eq('invoice_id', invoice.id)
          .eq('status', 'scheduled')
          .select('id, template_key');

      if (cancelError) {
        console.error(
          'Errore annullamento bozze fattura:',
          cancelError.message
        );
      } else if (cancelledReminders && cancelledReminders.length) {
        await Promise.all(
          cancelledReminders.map((reminder) =>
            logInvoiceActivity(
              invoice.id,
              'reminder_cancelled',
              `Bozza ${scheduledReminderLabel(reminder.template_key)} annullata: fattura ${statusLabel(status).toLowerCase()}.`,
              {
                reminder_id: reminder.id,
                reminder_template_key: reminder.template_key,
                cancellation_reason: status
              }
            )
          )
        );
      }
    }

    closeStatusModal();
    await loadCloudData();

    toast(
      mustCancelScheduledReminders
        ? 'Stato aggiornato e bozze attive annullate.'
        : 'Stato fattura aggiornato.'
    );
  }

  async function deleteInvoice(invoice) {
    if (!window.confirm('Eliminare definitivamente questa scadenza?')) return;

    if (!state.session) {
      state.localInvoices = state.localInvoices.filter((item) => String(item.id) !== String(invoice.id));
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state.localInvoices));
      render();
      toast('Scadenza eliminata.');
      return;
    }

    const { error } = await state.supabase.from('invoices').delete().eq('id', invoice.id);
    if (error) {
      toast(`Errore eliminazione: ${error.message}`);
      return;
    }

    state.invoices = state.invoices.filter((item) => String(item.id) !== String(invoice.id));
    render();
    toast('Scadenza eliminata dal cloud.');
  }

  function openReminder(invoice, forceModel) {
    state.activeInvoice = invoice;
    const key = forceModel || recommendedModel(invoice);
    const customer = invoice.customer_name || invoice.customer || 'Cliente';
    const number = invoice.invoice_number || invoice.number || 'senza numero';
    const amount = invoice.amount_cents !== undefined ? moneyFromCents(invoice.amount_cents) : money(invoice.amount);

    $('modalTitle').textContent = `Sollecito — ${customer}`;
    $('modalSubtitle').textContent = `Fattura ${number} · ${amount} · scadenza ${dateIt(invoice.due_date || invoice.due)}`;
    const customerRecord = getCustomerForInvoice(invoice);

    const autoPaused = Boolean(
      customerRecord && customerRecord.reminders_paused
    );

    const manualWarning = autoPaused
      ? ' ⚠ Attenzione: gli auto-solleciti sono sospesi per questo cliente. Stai preparando un sollecito manuale, che rimane consentito e verrà registrato nello storico.'
      : '';

    $('recommendation').textContent =
      `${recommendationText(invoice)} Puoi scegliere un modello diverso prima dell’invio.${manualWarning}`;

    $('recommendation').classList.toggle('manual-warning', autoPaused);

    $('modalBack').style.display = 'flex';
    chooseModel(key);
  }

  function closeReminder() {
    $('modalBack').style.display = 'none';
    state.activeInvoice = null;
    state.activeScheduledReminder = null;
  }

  function chooseModel(key) {
    if (!state.activeInvoice) return;
    $('modelChoice').value = key;
    $('mailSubject').value = fillTemplate(models[key].subject, state.activeInvoice);
    $('mailBody').value = fillTemplate(models[key].body, state.activeInvoice);
  }

  async function saveReminderLog(status) {
    if (!state.session || !state.activeInvoice || state.activeInvoice.source !== 'cloud') return;

    const { error } = await state.supabase.from('reminders').insert({
      invoice_id: state.activeInvoice.id,
      template_key: $('modelChoice').value,
      channel: status === 'sent' ? 'email' : 'manual',
      status,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      subject_snapshot: $('mailSubject').value,
      body_snapshot: $('mailBody').value,
      recipient_email: state.activeInvoice.customer_email || null,
      created_by: state.session.user.id
    });

    if (error) toast(`Nota: storico sollecito non salvato (${error.message}).`);
  }

  async function copyReminder() {
    const text = `Oggetto: ${$('mailSubject').value}\n\n${$('mailBody').value}`;
    try {
      await navigator.clipboard.writeText(text);
      await saveReminderLog('draft');
      toast('Testo copiato negli appunti.');
    } catch {
      window.prompt('Copia il testo:', text);
    }
  }

  async function openEmail() {
    const email =
      state.activeInvoice?.customer_email ||
      state.activeInvoice?.email ||
      '';

    if (state.activeScheduledReminder && state.session) {
      const reminder = state.activeScheduledReminder;

      const { error } = await state.supabase
        .from('reminders')
        .update({
          status: 'sent',
          channel: 'email',
          sent_at: new Date().toISOString(),
          subject_snapshot: $('mailSubject').value,
          body_snapshot: $('mailBody').value,
          recipient_email: email || null
        })
        .eq('id', reminder.id)
        .eq('status', 'scheduled');

      if (error) {
        toast(`Impossibile approvare la bozza: ${error.message}`);
        return;
      }

      await logInvoiceActivity(
        reminder.invoice_id,
        'reminder_approved',
        'Sollecito approvato: aperto il client email per l’invio manuale.',
        {
          reminder_id: reminder.id,
          reminder_template_key: reminder.template_key,
          recipient_email: email || '',
          subject: $('mailSubject').value
        }
      );

      state.activeScheduledReminder = null;
      await loadScheduledReminders();
      toast('Bozza approvata: apertura email in corso.');
    } else {
      await saveReminderLog('sent');
    }

    window.location.href =
      `mailto:${encodeURIComponent(email)}` +
      `?subject=${encodeURIComponent($('mailSubject').value)}` +
      `&body=${encodeURIComponent($('mailBody').value)}`;
  }
  async function signUp() {
    if (!configured()) {
      toast('Prima configura Project URL e Publishable key nel file app.js.');
      return;
    }
    const email = $('signupEmail').value.trim();
    const password = $('signupPassword').value;
    const organizationName = $('organizationName').value.trim();

    if (!email || !password || password.length < 8) {
      toast('Inserisci email e password di almeno 8 caratteri.');
      return;
    }

    const { data, error } = await state.supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: 'https://venturalessio.github.io/incassaprima/app/',
        data: {
          organization_name: organizationName || undefined
        }
      }
    });

    if (error) {
      toast(`Registrazione non riuscita: ${error.message}`);
      return;
    }

    if (data.session) {
      state.session = data.session;
      updateAccountUi();
      await loadCloudData();
      setStatus(`Cloud attivo · ${email}`, 'success');
      closeAuth();
      toast('Account creato e cloud attivo.');
    } else {
      closeAuth();
      setStatus('Account creato. Conferma l’email per attivare il cloud.', 'warning');
      toast('Controlla la tua email e conferma l’indirizzo.');
    }
  }

  async function signIn() {
    if (!configured()) {
      toast('Prima configura Project URL e Publishable key nel file app.js.');
      return;
    }
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    if (!email || !password) {
      toast('Inserisci email e password.');
      return;
    }

    const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast(`Accesso non riuscito: ${error.message}`);
      return;
    }

    state.session = data.session;
    updateAccountUi();
    await loadCloudData();
    setStatus(`Cloud attivo · ${email}`, 'success');
    closeAuth();
    toast('Accesso eseguito.');
  }

  async function signOut() {
    if (!state.supabase) return;
    await state.supabase.auth.signOut();
    state.session = null;
    state.organization = null;
    state.customers = [];
    state.invoices = [];
    state.scheduledReminders = [];
    state.activeScheduledReminder = null;
    state.isStudioAccount = false;
    state.studioIdentityOrgId = null;
    state.studioIdentityOrg = null;
    state.studioCompanies = [];
    updateAccountUi();
    updateApprovalBadge();
    normalizeLocalInvoices();
    updateCustomerOptions();
    render();
    setStatus('Modalità locale. Accedi per salvare nel cloud.', 'info');
    toast('Disconnesso dal cloud.');
  }

  function openAuth() {
    if (!configured()) {
      toast('Configura prima Project URL e Publishable key nel file app.js.');
      return;
    }
    $('authBack').style.display = 'flex';
  }

  function closeAuth() {
    $('authBack').style.display = 'none';
  }

  function exportCsv() {
    if (!state.session) {
      toast('Accedi al cloud per esportare le fatture in CSV. È una funzionalità del piano Pro.');
      return;
    }

    const header = ['cliente', 'numero_fattura', 'importo_euro', 'scadenza', 'email', 'stato'];
    const rows = state.invoices.map((invoice) => [
      invoice.customer_name || invoice.customer || '',
      invoice.invoice_number || invoice.number || '',
      invoice.amount_cents !== undefined ? (Number(invoice.amount_cents) / 100).toFixed(2) : Number(invoice.amount || 0).toFixed(2),
      invoice.due_date || invoice.due || '',
      invoice.customer_email || invoice.email || '',
      invoice.status || (invoice.paid ? 'paid' : 'open')
    ]);
    const csv = buildCsv(header, rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'incassaprima-scadenze.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 700);
  }

  function currentImportInvoiceSource() {
    return state.invoices;
  }

  function buildExistingImportKeys() {
    const keys = new Set();

    currentImportInvoiceSource().forEach((invoice) => {
      const key = importKey(
        invoice.customer_name || invoice.customer,
        invoice.invoice_number || invoice.number,
        invoice.due_date || invoice.due
      );

      if (key) keys.add(key);
    });

    return keys;
  }

  async function readImportRows(file) {
    const fileName = String(file.name || '').toLowerCase();
    const isCsv = fileName.endsWith('.csv');
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    if (!isCsv && !isExcel) {
      toast('Formato non supportato. Seleziona un file CSV, XLSX oppure XLS.');
      return null;
    }

    if (isCsv) {
      const text = await file.text();
      const delimiter = detectCsvDelimiter(text);

      return {
        parsedRows: parseCsvText(text, delimiter),
        sourceLabel: 'CSV',
        details: `Separatore rilevato: ${delimiter === '\t' ? 'tabulazione' : delimiter}`
      };
    }

    if (typeof XLSX === 'undefined') {
      toast('Lettore Excel non disponibile. Ricarica la pagina e riprova.');
      return null;
    }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;

    if (!worksheet) {
      toast('Il file Excel non contiene fogli leggibili.');
      return null;
    }

    const parsedRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
      dateNF: 'yyyy-mm-dd'
    });

    return {
      parsedRows,
      sourceLabel: 'Excel',
      details: `Foglio importato: ${firstSheetName}`
    };
  }

  async function importFile(file) {
    if (!file) return;

    if (!state.session) {
      toast('Accedi al cloud per importare fatture da file CSV o Excel. È una funzionalità del piano Pro.');
      return;
    }

    if (state.isStudioAccount && !state.organization) {
      toast('Seleziona prima un\'azienda dalla dashboard Studio.');
      openStudio();
      return;
    }

    try {
      const importedData = await readImportRows(file);

      if (!importedData) {
        return;
      }

      const { parsedRows, sourceLabel, details } = importedData;

      if (parsedRows.length < 2) {
        toast('Il file è vuoto oppure non contiene righe da importare.');
        return;
      }

      const headerRow = parsedRows[0].map(normalizeCsvHeader);

      const columns = {};
      headerRow.forEach((header, index) => {
        if (header && columns[header] === undefined) {
          columns[header] = index;
        }
      });

      const customerColumn = [
        'cliente',
        'customer',
        'ragionesociale',
        'nomecliente',
        'denominazione'
      ].find((key) => columns[key] !== undefined);

      const amountColumn = [
        'importoeuro',
        'importo',
        'amount',
        'totale',
        'importofattura'
      ].find((key) => columns[key] !== undefined);

      const dueDateColumn = [
        'scadenza',
        'datascadenza',
        'duedate',
        'due'
      ].find((key) => columns[key] !== undefined);

      if (!customerColumn || !amountColumn || !dueDateColumn) {
        toast(
          'Intestazioni non valide. Servono almeno: cliente, importo e scadenza.'
        );
        return;
      }

      const existingKeys = buildExistingImportKeys();
      const fileKeys = new Set();
      const validRows = [];
      const invalidRows = [];
      const duplicateRows = [];

      parsedRows.slice(1).forEach((row, index) => {
        const line = index + 2;

        const customerName = csvValueByAliases(row, columns, [
          'cliente',
          'customer',
          'ragionesociale',
          'nomecliente',
          'denominazione'
        ]);

        const invoiceNumber = csvValueByAliases(row, columns, [
          'numerofattura',
          'numero',
          'fattura',
          'invoicenumber',
          'invoice'
        ]);

        const amountRaw = csvValueByAliases(row, columns, [
          'importoeuro',
          'importo',
          'amount',
          'totale',
          'importofattura'
        ]);

        const dueDateRaw = csvValueByAliases(row, columns, [
          'scadenza',
          'datascadenza',
          'duedate',
          'due'
        ]);

        const email = csvValueByAliases(row, columns, [
          'email',
          'emailcliente',
          'customeremail'
        ]);

        const statusRaw = csvValueByAliases(row, columns, [
          'stato',
          'status'
        ]);

        const issueDateRaw = csvValueByAliases(row, columns, [
          'dataemissione',
          'emissione',
          'issuedate',
          'issue'
        ]);

        if (!customerName) {
          invalidRows.push({
            line,
            reason: 'cliente mancante'
          });
          return;
        }

        if (!invoiceNumber) {
          invalidRows.push({
            line,
            reason: 'numero fattura mancante'
          });
          return;
        }

        const amount = parseItalianAmount(amountRaw);

        if (!Number.isFinite(amount) || amount <= 0) {
          invalidRows.push({
            line,
            reason: 'importo non valido o non positivo'
          });
          return;
        }

        const dueDate = normalizeImportedDate(dueDateRaw);

        if (!dueDate) {
          invalidRows.push({
            line,
            reason: 'scadenza non valida; usa YYYY-MM-DD o GG/MM/AAAA'
          });
          return;
        }

        const issueDate = issueDateRaw
          ? normalizeImportedDate(issueDateRaw)
          : null;

        if (issueDateRaw && !issueDate) {
          invalidRows.push({
            line,
            reason: 'data emissione non valida'
          });
          return;
        }

        const key = importKey(customerName, invoiceNumber, dueDate);

        if (key && (existingKeys.has(key) || fileKeys.has(key))) {
          duplicateRows.push({
            line,
            reason: `fattura duplicata (${customerName} · ${invoiceNumber} · ${dueDate})`
          });
          return;
        }

        if (key) {
          fileKeys.add(key);
        }

        validRows.push({
          line,
          customerName,
          invoiceNumber,
          amount,
          dueDate,
          issueDate,
          email,
          status: normalizeImportedStatus(statusRaw)
        });
      });

      if (!validRows.length) {
        const problems = [...invalidRows, ...duplicateRows];

        showImportSummary(
          `Nessuna fattura importabile.\n\n` +
          `${invalidRows.length} righe non valide.\n` +
          `${duplicateRows.length} fatture duplicate ignorate.\n\n` +
          `Dettaglio:\n${formatImportProblems(problems)}`
        );

        return;
      }

      const destination = state.session ? 'nel cloud' : 'in locale';

      const confirmed = window.confirm(
        `Anteprima importazione ${sourceLabel}\n\n` +
        `File: ${file.name}\n` +
        `${details}\n\n` +
        `Fatture da importare: ${validRows.length}\n` +
        `Righe non valide: ${invalidRows.length}\n` +
        `Duplicati ignorati: ${duplicateRows.length}\n\n` +
        `Le ${validRows.length} fatture valide verranno salvate ${destination}. ` +
        `Vuoi procedere?` +
        formatImportProblems([...invalidRows, ...duplicateRows])
      );

      if (!confirmed) {
        toast('Importazione annullata.');
        return;
      }

      if (!state.session) {
        validRows.forEach((row) => {
          state.localInvoices.push({
            id: `${Date.now()}-${Math.random()}`,
            customer: row.customerName,
            number: row.invoiceNumber,
            amount: row.amount,
            due: row.dueDate,
            email: row.email,
            status: row.status,
            paid: row.status === 'paid',
            paid_at: row.status === 'paid' ? new Date().toISOString() : null,
            issue_date: row.issueDate
          });
        });

        localStorage.setItem(LOCAL_KEY, JSON.stringify(state.localInvoices));
        render();

        setTimeout(() => {
          showImportSummary(
            `${validRows.length} fatture importate in locale. ${duplicateRows.length} duplicate e ${invalidRows.length} righe non valide ignorate.`
          );
        }, 0);

        return;
      }

      if (!state.organization) {
        toast('Organizzazione cloud non disponibile. Riprova dopo avere effettuato l’accesso.');
        return;
      }

      const customerCache = new Map();

      state.customers.forEach((customer) => {
        customerCache.set(
          String(customer.name || '').trim().toLowerCase(),
          customer
        );
      });

      let imported = 0;
      let failed = 0;

      for (const row of validRows) {
        const customerKey = row.customerName.trim().toLowerCase();
        let customer = customerCache.get(customerKey);

        if (!customer) {
          const { data, error } = await state.supabase
            .from('customers')
            .insert({
              organization_id: state.organization.id,
              name: row.customerName,
              email: row.email || null
            })
            .select()
            .single();

          if (error || !data) {
            console.error('Errore creazione cliente durante importazione:', error);
            failed += 1;
            continue;
          }

          customer = data;
          customerCache.set(customerKey, customer);
          state.customers.push(customer);
        }

        const { data, error } = await state.supabase
          .from('invoices')
          .insert({
            organization_id: state.organization.id,
            customer_id: customer.id,
            invoice_number: row.invoiceNumber || null,
            amount_cents: Math.round(row.amount * 100),
            issue_date: row.issueDate,
            due_date: row.dueDate,
            status: row.status,
            paid_at: row.status === 'paid' ? new Date().toISOString() : null
          })
          .select('*, customers(name, email)')
          .single();

        if (error || !data) {
          console.error('Errore creazione fattura durante importazione:', error);
          failed += 1;
          continue;
        }

        state.invoices.push({
          ...data,
          customer_name: data.customers
            ? data.customers.name
            : customer.name,
          customer_email: data.customers
            ? data.customers.email
            : customer.email || '',
          source: 'cloud'
        });

        imported += 1;
      }

      updateCustomerOptions();
      render();

      setTimeout(() => {
        showImportSummary(
          `${imported} fatture importate nel cloud. ${duplicateRows.length} duplicate, ${invalidRows.length} non valide${failed ? ` e ${failed} non salvate` : ''}.`
        );
      }, 0);
    } catch (error) {
      console.error('Errore importazione file:', error);
      toast('Impossibile leggere o importare il file. Verifica formato e intestazioni.');
    }
  }

  function customerImportUpdate(existingCustomer, row, mode) {
    const update = {};

    if (mode === 'fill-missing') {
      if (!existingCustomer.email && row.email) {
        update.email = row.email;
      }

      if (!existingCustomer.pec && row.pec) {
        update.pec = row.pec;
      }

      if (!existingCustomer.phone && row.phone) {
        update.phone = row.phone;
      }
    }

    if (mode === 'overwrite') {
      if (row.email) {
        update.email = row.email;
      }

      if (row.pec) {
        update.pec = row.pec;
      }

      if (row.phone) {
        update.phone = row.phone;
      }
    }

    return update;
  }

  function chooseCustomerImportMode(summary) {
    return new Promise((resolve) => {
      const back = $('importSummaryBack');
      const title = $('importSummaryTitle');
      const content = $('importSummaryContent');

      const skipButton = $('importCustomersSkipBtn');
      const fillMissingButton = $('importCustomersFillMissingBtn');
      const overwriteButton = $('importCustomersOverwriteBtn');
      const closeButton = $('closeImportSummaryActionBtn');
      const closeIconButton = $('closeImportSummaryBtn');

      title.textContent = 'Come gestire i clienti già presenti';

      content.innerHTML = `
      <p>Nel file sono stati trovati clienti già presenti nella tua anagrafica.</p>

      <div class="history-entry">
        <strong>Nuovi clienti da creare:</strong> ${summary.newCustomers}<br>
        <strong>Clienti già presenti:</strong> ${summary.existingCustomers}<br>
        <strong>Righe non valide:</strong> ${summary.invalidRows}<br>
        <strong>Ripetuti nel file:</strong> ${summary.duplicateRows}
      </div>

      <p class="hint">
        Scegli come gestire i clienti già presenti. Le celle vuote dell’Excel
        non cancelleranno mai dati già registrati.
      </p>
    `;

      closeButton.style.display = 'none';
      skipButton.style.display = 'inline-flex';
      fillMissingButton.style.display = 'inline-flex';
      overwriteButton.style.display = 'inline-flex';

      back.style.display = 'flex';

      let completed = false;

      const finish = (mode) => {
        if (completed) return;
        completed = true;

        skipButton.style.display = 'none';
        fillMissingButton.style.display = 'none';
        overwriteButton.style.display = 'none';
        closeButton.style.display = 'inline-flex';

        back.style.display = 'none';

        skipButton.onclick = null;
        fillMissingButton.onclick = null;
        overwriteButton.onclick = null;
        closeButton.onclick = null;
        closeIconButton.onclick = null;

        resolve(mode);
      };

      skipButton.onclick = () => finish('skip');
      fillMissingButton.onclick = () => finish('fill-missing');
      overwriteButton.onclick = () => finish('overwrite');

      closeButton.onclick = () => finish('skip');
      closeIconButton.onclick = () => finish('skip');
    });
  }

  async function importCustomersFile(file) {
    if (!file) return;

    try {
      const importedData = await readImportRows(file);

      if (!importedData) {
        return;
      }

      const { parsedRows, sourceLabel, details } = importedData;

      if (parsedRows.length < 2) {
        toast('Il file è vuoto oppure non contiene righe da importare.');
        return;
      }

      const headerRow = parsedRows[0].map(normalizeCsvHeader);

      const columns = {};
      headerRow.forEach((header, index) => {
        if (header && columns[header] === undefined) {
          columns[header] = index;
        }
      });

      const nameAliases = [
        'nome',
        'nomecliente',
        'cliente',
        'ragionesociale',
        'denominazione',
        'name',
        'customer',
        'customername'
      ];

      const emailAliases = [
        'email',
        'emailcliente',
        'customeremail',
        'mail'
      ];

      const pecAliases = [
        'pec',
        'peccliente',
        'customerpec'
      ];

      const phoneAliases = [
        'telefono',
        'tel',
        'phone',
        'cellulare',
        'mobile'
      ];

      const nameColumn = nameAliases.find(
        (key) => columns[key] !== undefined
      );

      if (!nameColumn) {
        toast(
          'Intestazioni non valide. Serve una colonna nome cliente: nome, cliente o ragione sociale.'
        );
        return;
      }

      const existingCustomers = new Map();

      state.customers.forEach((customer) => {
        const key = String(customer.name || '').trim().toLowerCase();

        if (key && !existingCustomers.has(key)) {
          existingCustomers.set(key, customer);
        }
      });

      const fileKeys = new Set();
      const newRows = [];
      const existingRows = [];
      const invalidRows = [];
      const duplicateRows = [];

      parsedRows.slice(1).forEach((row, index) => {
        const line = index + 2;

        const name = csvValueByAliases(row, columns, nameAliases);
        const email = csvValueByAliases(row, columns, emailAliases);
        const pec = csvValueByAliases(row, columns, pecAliases);
        const phone = csvValueByAliases(row, columns, phoneAliases);

        if (!name) {
          invalidRows.push({
            line,
            reason: 'nome cliente mancante'
          });
          return;
        }

        const key = name.trim().toLowerCase();

        if (fileKeys.has(key)) {
          duplicateRows.push({
            line,
            reason: `cliente ripetuto nel file (${name})`
          });
          return;
        }

        fileKeys.add(key);

        const customerRow = {
          line,
          name,
          email: email || null,
          pec: pec || null,
          phone: phone || null
        };

        const existingCustomer = existingCustomers.get(key);

        if (existingCustomer) {
          existingRows.push({
            ...customerRow,
            customer: existingCustomer
          });
          return;
        }

        newRows.push(customerRow);
      });

      if (!newRows.length && !existingRows.length) {
        const problems = [...invalidRows, ...duplicateRows];

        showImportSummary(
          `Nessun cliente importabile.\n\n` +
          `${invalidRows.length} righe non valide.\n` +
          `${duplicateRows.length} clienti ripetuti nel file ignorati.\n\n` +
          `Dettaglio:\n${formatImportProblems(problems)}`
        );

        return;
      }

      const existingMode = existingRows.length
        ? await chooseCustomerImportMode({
          newCustomers: newRows.length,
          existingCustomers: existingRows.length,
          invalidRows: invalidRows.length,
          duplicateRows: duplicateRows.length
        })
        : 'skip';

      const updateCount = existingRows.filter((row) => {
        return Object.keys(
          customerImportUpdate(row.customer, row, existingMode)
        ).length > 0;
      }).length;

      const customersToUpdate = existingRows
        .filter((row) => {
          return Object.keys(
            customerImportUpdate(row.customer, row, existingMode)
          ).length > 0;
        })
        .map((row) => {
          const update = customerImportUpdate(
            row.customer,
            row,
            existingMode
          );

          const fields = [];

          if (update.email) fields.push('email');
          if (update.pec) fields.push('PEC');
          if (update.phone) fields.push('telefono');

          return `• ${row.name}: ${fields.join(', ')}`;
        });

      const updateDetails = customersToUpdate.length
        ? `\n\nClienti da aggiornare:\n${customersToUpdate.join('\n')}`
        : '';

      const confirmed = window.confirm(
        `Conferma importazione clienti\n\n` +
        `Nuovi clienti da creare: ${newRows.length}\n` +
        `Clienti esistenti da aggiornare: ${updateCount}\n` +
        `Clienti esistenti ignorati: ${existingRows.length - updateCount}\n` +
        `Righe non valide: ${invalidRows.length}\n` +
        `Ripetuti nel file ignorati: ${duplicateRows.length}\n\n` +
        `Modalità clienti esistenti: ` +
        `${existingMode === 'fill-missing'
          ? 'completa campi mancanti'
          : existingMode === 'overwrite'
            ? 'aggiorna con Excel'
            : 'ignora'}.` +
        updateDetails +
        `\n\nVuoi procedere?` +
        formatImportProblems([...invalidRows, ...duplicateRows])
      );

      if (!confirmed) {
        toast('Importazione annullata.');
        return;
      }

      if (!state.session) {
        let created = 0;
        let updated = 0;

        newRows.forEach((row) => {
          state.customers.push({
            id: `${Date.now()}-${Math.random()}`,
            name: row.name,
            email: row.email,
            pec: row.pec,
            phone: row.phone,
            reminders_paused: false
          });

          created += 1;
        });

        existingRows.forEach((row) => {
          const update = customerImportUpdate(
            row.customer,
            row,
            existingMode
          );

          if (!Object.keys(update).length) {
            return;
          }

          Object.assign(row.customer, update);
          updated += 1;
        });

        updateCustomerOptions();
        renderCustomers();

        setTimeout(() => {
          showImportSummary(
            `${created} clienti creati in locale. ` +
            `${updated} clienti aggiornati. ` +
            `${existingRows.length - updated} clienti esistenti ignorati. ` +
            `${duplicateRows.length} ripetuti e ${invalidRows.length} righe non valide ignorati.`
          );
        }, 0);

        return;
      }

      if (!state.organization) {
        toast(
          'Organizzazione cloud non disponibile. Riprova dopo avere effettuato l’accesso.'
        );
        return;
      }

      let created = 0;
      let updated = 0;
      let failed = 0;

      for (const row of newRows) {
        const { data, error } = await state.supabase
          .from('customers')
          .insert({
            organization_id: state.organization.id,
            name: row.name,
            email: row.email,
            pec: row.pec,
            phone: row.phone
          })
          .select()
          .single();

        if (error || !data) {
          console.error('Errore creazione cliente durante importazione:', error);
          failed += 1;
          continue;
        }

        state.customers.push(data);
        created += 1;
      }

      for (const row of existingRows) {
        const update = customerImportUpdate(
          row.customer,
          row,
          existingMode
        );

        if (!Object.keys(update).length) {
          continue;
        }

        const { data, error } = await state.supabase
          .from('customers')
          .update(update)
          .eq('id', row.customer.id)
          .select()
          .single();

        if (error || !data) {
          console.error(
            'Errore aggiornamento cliente durante importazione:',
            error
          );
          failed += 1;
          continue;
        }

        const customerIndex = state.customers.findIndex(
          (customer) => String(customer.id) === String(data.id)
        );

        if (customerIndex !== -1) {
          state.customers[customerIndex] = data;
        }

        updated += 1;
      }

      updateCustomerOptions();
      renderCustomers();

      setTimeout(() => {
        showImportSummary(
          `${created} clienti creati nel cloud. ` +
          `${updated} clienti aggiornati. ` +
          `${existingRows.length - updated} clienti esistenti ignorati. ` +
          `${duplicateRows.length} ripetuti e ${invalidRows.length} righe non valide ignorati` +
          `${failed ? `. ${failed} operazioni non salvate` : ''}.`
        );
      }, 0);
    } catch (error) {
      console.error('Errore importazione clienti:', error);
      toast(
        'Impossibile leggere o importare il file. Verifica formato e intestazioni.'
      );
    }
  }

  function duplicateGroupKey(invoice) {
    const customerName = String(
      invoice.customer_name || invoice.customer || ''
    )
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    const invoiceNumber = String(
      invoice.invoice_number || invoice.number || ''
    )
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    const dueDate = String(
      invoice.due_date || invoice.due || ''
    ).trim();

    if (!customerName || !invoiceNumber || !dueDate) {
      return null;
    }

    return `${customerName}::${invoiceNumber}::${dueDate}`;
  }

  function detectDuplicateInvoices() {
    const source = state.session
      ? state.invoices
      : state.localInvoices.map(localToView);

    const groups = new Map();

    source.forEach((invoice) => {
      const key = duplicateGroupKey(invoice);

      if (!key) return;

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push(invoice);
    });

    const duplicates = [...groups.values()]
      .filter((invoices) => invoices.length > 1)
      .sort((firstGroup, secondGroup) => {
        const firstName = String(
          firstGroup[0].customer_name || firstGroup[0].customer || ''
        );

        const secondName = String(
          secondGroup[0].customer_name || secondGroup[0].customer || ''
        );

        return firstName.localeCompare(secondName, 'it');
      });

    if (!duplicates.length) {
      toast('Controllo duplicati completato: nessuna fattura duplicata trovata.');
      return;
    }

    const invoicesInvolved = duplicates.reduce(
      (total, group) => total + group.length,
      0
    );

    const details = duplicates
      .slice(0, 12)
      .map((group) => {
        const first = group[0];
        const customer = first.customer_name || first.customer || 'Cliente';
        const number = first.invoice_number || first.number || 'Senza numero';
        const dueDate = first.due_date || first.due || '—';
        const amount =
          first.amount_cents !== undefined
            ? moneyFromCents(first.amount_cents)
            : money(first.amount);

        return (
          `• ${customer} · fattura ${number} · scadenza ${dateIt(dueDate)} · ${amount}\n` +
          `  ${group.length} record con gli stessi dati`
        );
      })
      .join('\n\n');

    const moreGroups =
      duplicates.length > 12
        ? `\n\n…e altri ${duplicates.length - 12} gruppi duplicati.`
        : '';

    window.alert(
      `Controllo duplicati completato\n\n` +
      `Gruppi duplicati trovati: ${duplicates.length}\n` +
      `Fatture coinvolte: ${invoicesInvolved}\n\n` +
      `${details}${moreGroups}\n\n` +
      `Nessuna fattura è stata modificata o eliminata.`
    );
  }

  function escapeWithBreaks(value) {
    return escapeHtml(value).replace(/\n/g, '<br>');
  }

  function reminderLabel(templateKey) {
    return {
      courtesy: 'Promemoria cortese',
      first: 'Primo sollecito',
      second: 'Secondo sollecito',
      custom: 'Modello personalizzato'
    }[templateKey] || templateKey || 'Modello non indicato';
  }

  function reminderStatusLabel(status) {
    return {
      draft: 'Testo copiato',
      scheduled: 'Programmato',
      sent: 'Email aperta',
      failed: 'Non riuscito',
      cancelled: 'Annullato'
    }[status] || status || '—';
  }

  function channelLabel(channel) {
    return {
      manual: 'Copia manuale',
      email: 'Email precompilata',
      whatsapp: 'WhatsApp'
    }[channel] || channel || '—';
  }

  function dateTimeIt(value) {
    if (!value) return '—';

    return new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  async function openHistory(invoice) {
    if (!state.session || invoice.source !== 'cloud') {
      toast('Lo storico è disponibile per le scadenze salvate nel cloud.');
      return;
    }

    $('historyTitle').textContent =
      `Storico attività — ${invoice.customer_name || 'Cliente'}`;

    $('historySubtitle').textContent =
      `Fattura ${invoice.invoice_number || 'senza numero'} · ${moneyFromCents(invoice.amount_cents)}`;

    $('historyContent').innerHTML =
      '<div class="empty">Caricamento storico…</div>';

    $('historyBack').style.display = 'flex';

    const [
      { data: reminders, error: remindersError },
      { data: activities, error: activitiesError }
    ] = await Promise.all([
      state.supabase
        .from('reminders')
        .select('*')
        .eq('invoice_id', invoice.id)
        .order('created_at', { ascending: false }),

      state.supabase
        .from('invoice_activity_log')
        .select('*')
        .eq('invoice_id', invoice.id)
        .order('created_at', { ascending: false })
    ]);

    if (remindersError || activitiesError) {
      const message = remindersError?.message || activitiesError?.message;

      $('historyContent').innerHTML =
        `<div class="empty">Impossibile caricare lo storico: ${escapeHtml(message)}</div>`;

      return;
    }

    const reminderEvents = (reminders || []).map((reminder) => ({
      type: 'reminder',
      created_at: reminder.created_at,
      reminder
    }));

    const activityEvents = (activities || []).map((activity) => ({
      type: 'activity',
      created_at: activity.created_at,
      activity
    }));

    const events = [...reminderEvents, ...activityEvents]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!events.length) {
      $('historyContent').innerHTML =
        '<div class="empty">Nessuna attività registrata per questa fattura.</div>';

      return;
    }

    $('historyContent').innerHTML = `
    <p class="history-count">
      ${events.length} ${events.length === 1 ? 'attività registrata' : 'attività registrate'}
    </p>

    <div class="history-list">
      ${events.map((event) => {
      if (event.type === 'reminder') {
        const reminder = event.reminder;

        return `
            <article class="history-item">
              <div class="history-item-head">
                <strong>${escapeHtml(reminderLabel(reminder.template_key))}</strong>

                <span class="badge ${reminder.status === 'sent' ? 'paid' : 'upcoming'}">
                  ${escapeHtml(reminderStatusLabel(reminder.status))}
                </span>
              </div>

              <p class="history-meta">
                ${dateTimeIt(reminder.created_at)}
                · ${escapeHtml(channelLabel(reminder.channel))}
                ${reminder.recipient_email
            ? ` · ${escapeHtml(reminder.recipient_email)}`
            : ''}
              </p>

              <details>
                <summary>Visualizza testo registrato</summary>

                <div class="history-message">
                  <p><strong>Oggetto:</strong> ${escapeHtml(reminder.subject_snapshot)}</p>
                  <p>${escapeWithBreaks(reminder.body_snapshot)}</p>
                </div>
              </details>
            </article>
          `;
      }

      const activity = event.activity;

      const activityBadge = {
        reminder_scheduled: {
          label: 'Bozza proposta',
          className: 'due'
        },
        reminder_cancelled: {
          label: 'Annullata',
          className: 'paused'
        },
        reminder_approved: {
          label: 'Approvata',
          className: 'paid'
        },
        invoice_status_changed: {
          label: 'Stato aggiornato',
          className: 'upcoming'
        },
        payment_promise_created: {
          label: 'Promessa pagamento',
          className: 'due'
        }
      }[activity.event_type] || {
        label: 'Attività',
        className: 'upcoming'
      };

      return `
  <article class="history-item">
    <div class="history-item-head">
      <strong>${escapeHtml(activity.message)}</strong>

      <span class="badge ${activityBadge.className}">
        ${escapeHtml(activityBadge.label)}
      </span>
    </div>

    <p class="history-meta">
      ${dateTimeIt(activity.created_at)}
    </p>
  </article>
`;
    }).join('')}
    </div>
  `;
  }

  function closeHistory() {
    $('historyBack').style.display = 'none';
  }
  function customerInvoices(customerId) {
    return state.invoices.filter((invoice) => invoice.customer_id === customerId);
  }

  function customerMetrics(customer) {
    const invoices = customerInvoices(customer.id);
    let openCents = 0;
    let overdueCents = 0;
    let openCount = 0;

    invoices.forEach((invoice) => {
      const status = invoiceStatus(invoice);
      const cents = Number(invoice.amount_cents || 0);
      if (!['paid', 'disputed', 'paused'].includes(status)) {
        openCents += cents;
        openCount += 1;
        if (status === 'overdue') overdueCents += cents;
      }
    });

    return { invoices, openCents, overdueCents, openCount };
  }

  function renderCustomers() {
    const query = ($('customerSearch').value || '').trim().toLowerCase();
    const customers = state.customers
      .filter((customer) => {
        const text = `${customer.name || ''} ${customer.email || ''} ${customer.pec || ''}`.toLowerCase();
        return !query || text.includes(query);
      })
      .sort((a, b) => {
        const aMetrics = customerMetrics(a);
        const bMetrics = customerMetrics(b);
        return bMetrics.overdueCents - aMetrics.overdueCents || a.name.localeCompare(b.name);
      });

    if (!customers.length) {
      $('customersContent').innerHTML = '<div class="customer-empty">Nessun cliente trovato. Aggiungine uno oppure crea una fattura con un nuovo cliente.</div>';
      return;
    }

    $('customersContent').innerHTML = `
    <div class="customer-list">
      ${customers.map((customer) => {
      const metrics = customerMetrics(customer);
      return `
          <article class="customer-row">
            <div>
              <strong>${escapeHtml(customer.name)}</strong>
              <small>${escapeHtml(customer.email || customer.pec || customer.phone || 'Nessun contatto registrato')}</small>
              ${customer.reminders_paused ? '<small style="color:#b45309;font-weight:700">Solleciti automatici sospesi</small>' : ''}
            </div>
            <div class="customer-metric"><span>Da incassare</span><b>${moneyFromCents(metrics.openCents)}</b></div>
            <div class="customer-metric"><span>Scaduto</span><b style="color:${metrics.overdueCents ? '#b91c1c' : '#162033'}">${moneyFromCents(metrics.overdueCents)}</b></div>
            <div class="customer-actions"><button type="button" class="small secondary" data-customer-op="edit" data-customer-id="${customer.id}">Apri</button></div>
          </article>`;
    }).join('')}
    </div>`;
  }

  function renderStudio() {
    const query = ($('studioSearch').value || '').trim().toLowerCase();

    const companies = state.studioCompanies
      .filter((company) => !query || company.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));

    const activeNotice = state.organization
      ? `<p class="smallhint" style="margin-bottom:12px">Stai lavorando su: <strong>${escapeHtml(state.organization.name)}</strong></p>`
      : '';

    const metrics = state.studioMetrics;
    const summary = state.studioCompanies.length
      ? `
      <div class="stats" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">
        <div class="stat">
          <span>Da incassare su tutte le aziende gestite</span>
          <strong>${moneyFromCents(metrics.totalOpenCents)}</strong>
        </div>
        <div class="stat">
          <span>Scaduto su tutte le aziende gestite</span>
          <strong style="color:${metrics.totalOverdueCents ? '#b91c1c' : '#162033'}">${moneyFromCents(metrics.totalOverdueCents)}</strong>
          <small class="smallhint">${metrics.totalOverdueCount} fattur${metrics.totalOverdueCount === 1 ? 'a scaduta' : 'e scadute'}</small>
        </div>
      </div>`
      : '';

    const ownIsActive = Boolean(state.organization && state.organization.id === state.studioIdentityOrgId);
    const ownRow = state.studioIdentityOrg
      ? `
      <article class="customer-row" style="border-color:#c7d2fe">
        <div>
          <strong>${escapeHtml(state.studioIdentityOrg.name)}</strong>
          <small>Le tue fatture dirette</small>
          ${ownIsActive ? '<small style="color:#047857;font-weight:700">Aperta ora</small>' : ''}
        </div>
        <div class="customer-metric"><span>Da incassare</span><b>${moneyFromCents(metrics.own.openCents)}</b></div>
        <div class="customer-metric"><span>Scaduto</span><b style="color:${metrics.own.overdueCents ? '#b91c1c' : '#162033'}">${moneyFromCents(metrics.own.overdueCents)}</b></div>
        <div class="customer-actions">
          <button type="button" class="small secondary" data-studio-company-op="open-own">Apri</button>
          <button type="button" class="small secondary" data-studio-company-op="rename" data-studio-company-id="${state.studioIdentityOrg.id}" data-studio-company-name="${escapeHtml(state.studioIdentityOrg.name)}">Rinomina</button>
        </div>
      </article>`
      : '';

    const companiesList = companies.length
      ? companies.map((company) => {
      const companyMetrics = metrics.byCompany[company.id] || { openCents: 0, overdueCents: 0 };
      return `
          <article class="customer-row">
            <div>
              <strong>${escapeHtml(company.name)}</strong>
              ${company.id === (state.organization && state.organization.id) ? '<small style="color:#047857;font-weight:700">Aperta ora</small>' : ''}
            </div>
            <div class="customer-metric"><span>Da incassare</span><b>${moneyFromCents(companyMetrics.openCents)}</b></div>
            <div class="customer-metric"><span>Scaduto</span><b style="color:${companyMetrics.overdueCents ? '#b91c1c' : '#162033'}">${moneyFromCents(companyMetrics.overdueCents)}</b></div>
            <div class="customer-actions">
              <button type="button" class="small secondary" data-studio-company-op="open" data-studio-company-id="${company.id}">Apri</button>
              <button type="button" class="small secondary" data-studio-company-op="rename" data-studio-company-id="${company.id}" data-studio-company-name="${escapeHtml(company.name)}">Rinomina</button>
              <button type="button" class="small danger" data-studio-company-op="delete" data-studio-company-id="${company.id}" data-studio-company-name="${escapeHtml(company.name)}">Elimina</button>
            </div>
          </article>`;
    }).join('')
      : '<p>Nessuna azienda gestita ancora aggiunta. Usa il modulo qui sopra per aggiungerne una.</p>';

    $('studioClientsContent').innerHTML = `
    ${summary}
    ${activeNotice}
    <div class="customer-list">
      ${ownRow}
    </div>
    <p class="smallhint" style="margin:16px 0 8px">Aziende gestite</p>
    <div class="customer-list">
      ${companiesList}
    </div>`;
  }

  function openCustomers() {
    if (!state.session) {
      toast('Accedi al cloud per gestire l’anagrafica clienti.');
      return;
    }
    if (state.isStudioAccount && !state.organization) {
      openStudio();
      return;
    }
    $('customerSearch').value = '';
    $('customersBack').style.display = 'flex';
    renderCustomers();
  }

  function openGuide() {
    $('guideBack').style.display = 'flex';
  }

  function openStudio() {
    $('studioBack').style.display = 'flex';
    renderStudio();

    // Aggiorna i totali in background: mostra subito i dati già in
    // memoria (se presenti) e li rinfresca appena arrivano quelli veri.
    loadStudioOverview().then(renderStudio);
  }

  function closeStudio() {
    $('studioBack').style.display = 'none';
  }

  function closeGuide() {
    $('guideBack').style.display = 'none';
  }

  function openPlans() {
    $('plansBack').style.display = 'flex';
  }

  function closePlans() {
    $('plansBack').style.display = 'none';
  }

  function closeCustomers() {
    $('customersBack').style.display = 'none';
  }

  function renderCustomerInvoices(customer) {
    const invoices = customerInvoices(customer.id).sort((a, b) => b.due_date.localeCompare(a.due_date));
    if (!invoices.length) {
      $('customerInvoices').innerHTML = '<div class="customer-empty">Nessuna fattura registrata per questo cliente.</div>';
      return;
    }

    $('customerInvoices').innerHTML = `
    <div class="customer-invoice-list">
      ${invoices.map((invoice) => {
      const status = invoiceStatus(invoice);
      return `
          <div class="customer-invoice">
            <div><strong>${escapeHtml(invoice.invoice_number || 'Senza numero')}</strong><small>Scadenza ${dateIt(invoice.due_date)}</small></div>
            <div style="text-align:right"><strong>${moneyFromCents(invoice.amount_cents)}</strong><br><span class="badge ${status}">${statusLabel(status)}</span></div>
          </div>`;
    }).join('')}
    </div>`;
  }

  function openCustomerEditor(customer) {
    state.activeCustomer = customer || null;
    const isNew = !customer;
    const metrics = customer ? customerMetrics(customer) : { openCents: 0, overdueCents: 0, openCount: 0 };

    $('customerEditTitle').textContent = isNew ? 'Nuovo cliente' : customer.name;
    $('customerEditSubtitle').textContent = isNew ? 'Compila almeno nome e, se disponibile, email.' : 'Modifica i dati e le preferenze di sollecito.';
    $('editCustomerName').value = customer?.name || '';
    $('editCustomerEmail').value = customer?.email || '';
    $('editCustomerPec').value = customer?.pec || '';
    $('editCustomerPhone').value = customer?.phone || '';
    $('editCustomerNotes').value = customer?.notes || '';
    $('editCustomerPaused').checked = Boolean(customer?.reminders_paused);

    $('customerSummary').innerHTML = isNew ? '' : `
    <div><span>Da incassare</span><b>${moneyFromCents(metrics.openCents)}</b></div>
    <div><span>Scaduto</span><b style="color:${metrics.overdueCents ? '#b91c1c' : '#162033'}">${moneyFromCents(metrics.overdueCents)}</b></div>
    <div><span>Fatture aperte</span><b>${metrics.openCount}</b></div>`;

    renderCustomerInvoices(customer || { id: '__new__' });
    $('customerEditBack').style.display = 'flex';
  }

  function closeCustomerEditor() {
    state.activeCustomer = null;
    $('customerEditBack').style.display = 'none';
  }

  async function saveCustomer() {
    if (!state.session || !state.organization) {
      toast('Accedi al cloud prima di salvare un cliente.');
      return;
    }

    const name = $('editCustomerName').value.trim();
    const email = $('editCustomerEmail').value.trim();
    const pec = $('editCustomerPec').value.trim();
    const phone = $('editCustomerPhone').value.trim();
    const notes = $('editCustomerNotes').value.trim();
    const remindersPaused = $('editCustomerPaused').checked;

    if (!name) {
      toast('Inserisci il nome del cliente.');
      $('editCustomerName').focus();
      return;
    }

    const payload = {
      name,
      email: email || null,
      pec: pec || null,
      phone: phone || null,
      notes: notes || null,
      reminders_paused: remindersPaused
    };

    if (state.activeCustomer) {
      const { error } = await state.supabase
        .from('customers')
        .update(payload)
        .eq('id', state.activeCustomer.id);

      if (error) {
        toast(`Errore salvataggio cliente: ${error.message}`);
        return;
      }

      toast('Cliente aggiornato.');
    } else {
      const { error } = await state.supabase
        .from('customers')
        .insert({ ...payload, organization_id: state.organization.id });

      if (error) {
        toast(`Errore creazione cliente: ${error.message}`);
        return;
      }

      toast('Cliente creato.');
    }

    closeCustomerEditor();
    await loadCloudData();
    if ($('customersBack').style.display === 'flex') renderCustomers();
  }

  function scheduledReminderLabel(templateKey) {
    return {
      courtesy: 'Promemoria cortese',
      first: 'Primo sollecito',
      second: 'Secondo sollecito'
    }[templateKey] || templateKey;
  }
  function getPriorityInfo(invoice) {
    const status = invoiceStatus(invoice);
    const days = diffDays(invoice);
    if (status === 'paid') {
      return null;
    }
    const firstDays = Number(
      state.reminderSettings?.first_reminder_after_days || 3
    );

    const secondDays = Number(
      state.reminderSettings?.second_reminder_after_days || 15
    );

    if (status === 'disputed' || status === 'paused') {
      return {
        type: 'blocked',
        label: status === 'disputed' ? 'Contestata' : 'Sospesa',
        detail: 'Solleciti automatici bloccati.',
        priority: 1
      };
    }

    if (
      status === 'promised' &&
      invoice.promised_payment_date &&
      invoice.promised_payment_date >= today()
    ) {
      return {
        type: 'promise',
        label: 'Promessa pagamento',
        detail: `Previsto il ${dateIt(invoice.promised_payment_date)}.`,
        priority: 2
      };
    }

    if (days >= secondDays) {
      return {
        type: 'critical',
        label: 'Critica',
        detail: `Scaduta da ${days} giorni: secondo sollecito previsto.`,
        priority: 5
      };
    }

    if (days >= firstDays) {
      return {
        type: 'high',
        label: 'Da sollecitare',
        detail: `Scaduta da ${days} giorni: primo sollecito previsto.`,
        priority: 4
      };
    }

    if (status === 'overdue') {
      return {
        type: 'high',
        label: 'In ritardo',
        detail: `Scaduta da ${days} giorni: sotto la soglia del primo sollecito.`,
        priority: 3
      };
    }

    return null;
  }
  function hasScheduledReminder(invoice) {
    return state.scheduledReminders.some(
      (reminder) => String(reminder.invoice_id) === String(invoice.id)
    );
  }
  function renderPriorityDashboard() {
    const content = $('priorityContent');
    const summary = $('prioritySummary');

    if (!content || !summary) {
      return;
    }

    const source = state.session
      ? state.invoices
      : state.localInvoices.map(localToView);

    const priorities = source
      .map((invoice) => ({
        invoice,
        info: getPriorityInfo(invoice)
      }))
      .filter((item) => item.info)
      .sort((a, b) => {
        if (b.info.priority !== a.info.priority) {
          return b.info.priority - a.info.priority;
        }

        const aDays = diffDays(a.invoice);
        const bDays = diffDays(b.invoice);

        if (bDays !== aDays) {
          return bDays - aDays;
        }

        const aAmount = a.invoice.amount_cents !== undefined
          ? Number(a.invoice.amount_cents)
          : Math.round(Number(a.invoice.amount || 0) * 100);

        const bAmount = b.invoice.amount_cents !== undefined
          ? Number(b.invoice.amount_cents)
          : Math.round(Number(b.invoice.amount || 0) * 100);

        return bAmount - aAmount;
      })
      .slice(0, 5);

    if (!priorities.length) {
      summary.textContent = 'Nessuna urgenza';
      content.innerHTML =
        '<div class="empty">Nessuna fattura richiede attenzione immediata.</div>';
      return;
    }

    const criticalCount = priorities.filter(
      (item) => item.info.type === 'critical'
    ).length;

    const highCount = priorities.filter(
      (item) => item.info.type === 'high'
    ).length;

    summary.textContent = criticalCount
      ? `${criticalCount} critica${criticalCount === 1 ? '' : 'he'}`
      : highCount
        ? `${highCount} da sollecitare`
        : `${priorities.length} da monitorare`;

    content.innerHTML = `
    <div class="priority-list">
      ${priorities.map(({ invoice, info }) => {
      const amount = invoice.amount_cents !== undefined
        ? moneyFromCents(invoice.amount_cents)
        : money(invoice.amount);

      const customer = invoice.customer_name || invoice.customer || 'Cliente';
      const number = invoice.invoice_number || invoice.number || 'Senza numero';

      return `
          <article class="priority-item ${info.type}">
            <div class="priority-main">
              <strong>${escapeHtml(customer)}</strong>
              <small>Fattura ${escapeHtml(number)} · scadenza ${dateIt(invoice.due_date || invoice.due)}</small>
            </div>

            <div>
              <span class="badge ${info.type === 'critical'
          ? 'overdue'
          : info.type === 'high'
            ? 'due'
            : info.type === 'promise'
              ? 'promised'
              : 'disputed'}">
                ${escapeHtml(info.label)}
              </span>

              <span class="priority-detail">
                ${escapeHtml(info.detail)}
              </span>
            </div>

            <div class="priority-amount">
              ${amount}
            </div>

            <div class="priority-action">
  ${(() => {
          const hasDraft = hasScheduledReminder(invoice);
          if (info.type === 'critical' || info.type === 'high') {
            return hasDraft
              ? `<button type="button" class="small violet" data-priority-op="draft" data-priority-id="${invoice.id}">Apri bozza</button>`
              : `<button type="button" class="small violet" data-priority-op="remind" data-priority-id="${invoice.id}">Sollecito</button>`;
          }
          return `<button type="button" class="small secondary" data-priority-op="status" data-priority-id="${invoice.id}">Apri stato</button>`;
        })()}
</div>
          </article>
        `;
    }).join('')}
    </div>
  `;
  }
  function suggestedAutomaticModel(invoice) {
    const days = diffDays(invoice);
    const firstDays = Number(state.reminderSettings?.first_reminder_after_days || 3);
    const secondDays = Number(state.reminderSettings?.second_reminder_after_days || 15);

    if (days >= secondDays) return 'second';
    if (days >= firstDays) return 'first';
    return null;
  }

  function buildScheduledReminder(invoice, templateKey) {
    return {
      invoice_id: invoice.id,
      template_key: templateKey,
      channel: 'email',
      status: 'scheduled',
      scheduled_at: new Date().toISOString(),
      subject_snapshot: fillTemplate(models[templateKey].subject, invoice),
      body_snapshot: fillTemplate(models[templateKey].body, invoice),
      recipient_email: invoice.customer_email || null,
      created_by: state.session.user.id
    };
  }

  async function loadScheduledReminders() {
    if (!state.session || !state.organization) {
      state.scheduledReminders = [];
      updateApprovalBadge();
      renderPriorityDashboard();
      return;
    }

    const invoiceIds = state.invoices.map((invoice) => invoice.id);

    if (!invoiceIds.length) {
      state.scheduledReminders = [];
      updateApprovalBadge();
      renderPriorityDashboard();
      return;
    }

    const { data, error } = await state.supabase
      .from('reminders')
      .select('*')
      .in('invoice_id', invoiceIds)
      .eq('status', 'scheduled')
      .order('scheduled_at', { ascending: true });

    if (error) {
      console.error('Errore caricamento bozze:', error.message);
      state.scheduledReminders = [];
    } else {
      state.scheduledReminders = data || [];
    }

    updateApprovalBadge();
    renderPriorityDashboard();
  }

  function updateApprovalBadge() {
    const count = $('approvalCount');
    if (!count) return;
    count.textContent = state.scheduledReminders.length;
    count.style.display = state.scheduledReminders.length ? 'inline-grid' : 'none';
  }
  async function logInvoiceActivity(invoiceId, eventType, message, metadata = {}) {
    if (!state.supabase || !state.session || !state.organization || !invoiceId) {
      return;
    }

    const { error } = await state.supabase
      .from('invoice_activity_log')
      .insert({
        organization_id: state.organization.id,
        invoice_id: invoiceId,
        actor_user_id: state.session.user.id,
        event_type: eventType,
        message,
        metadata
      });

    if (error) {
      console.error('Errore registrazione storico attività:', error.message);
    }
  }
  async function generateScheduledReminders() {
    if (!state.session || !state.organization) return;

    const invoiceIds = state.invoices.map((invoice) => invoice.id);

    if (!invoiceIds.length) return;

    /*
      Carichiamo lo storico completo dei reminder delle fatture visibili.
      Non basta guardare solo le bozze scheduled:
      un reminder già sent, draft o cancelled deve bloccare la ricreazione
      dello stesso modello.
    */
    const { data: allReminders, error } = await state.supabase
      .from('reminders')
      .select('invoice_id, template_key, status')
      .in('invoice_id', invoiceIds);

    if (error) {
      console.error('Errore verifica storico reminder:', error.message);
      return;
    }

    /*
      Chiave esempio: "uuid-fattura:first".
      Se esiste qualsiasi reminder storico per quel modello, non creiamo
      una nuova bozza automatica.
    */
    const alreadyHandled = new Set(
      allReminders
        .filter((reminder) => reminder.status !== 'cancelled')
        .map(
          (reminder) => `${reminder.invoice_id}:${reminder.template_key}`
        )
    );

    const candidates = state.invoices
      .filter((invoice) => isEligibleForAutomaticReminder(invoice))
      .map((invoice) => ({
        invoice,
        templateKey: suggestedAutomaticModel(invoice)
      }))
      .filter(
        (item) =>
          item.templateKey &&
          !alreadyHandled.has(`${item.invoice.id}:${item.templateKey}`)
      );

    if (!candidates.length) return;

    for (const candidate of candidates) {
      const payload = buildScheduledReminder(
        candidate.invoice,
        candidate.templateKey
      );

      const { error: insertError } = await state.supabase
        .from('reminders')
        .insert(payload);

      /*
        23505 = un'altra sessione ha creato la stessa bozza nel frattempo.
        Non è un errore da mostrare all'utente.
      */
      if (insertError && insertError.code !== '23505') {
        console.error('Errore creazione bozza:', insertError.message);
      }
      if (!insertError) {
        const templateLabel = candidate.templateKey === 'second'
          ? 'Secondo sollecito'
          : 'Primo sollecito';

        await logInvoiceActivity(
          candidate.invoice.id,
          'reminder_scheduled',
          `${templateLabel} proposto automaticamente e inserito nella coda di approvazione.`,
          {
            reminder_template_key: candidate.templateKey,
            first_reminder_after_days: state.reminderSettings.first_reminder_after_days,
            second_reminder_after_days: state.reminderSettings.second_reminder_after_days
          }
        );
      }
    }

    await loadScheduledReminders();
  }

  async function openApprovalQueue() {
    if (!state.session) {
      toast('Accedi al cloud per visualizzare i solleciti da approvare.');
      return;
    }

    await loadScheduledReminders();
    $('approvalBack').style.display = 'flex';
    renderApprovalQueue();
  }

  function closeApprovalQueue() {
    $('approvalBack').style.display = 'none';
  }

  function openAnalytics() {
    if (!state.session) {
      toast('Accedi al cloud per visualizzare l’analisi incassi.');
      return;
    }
    if (state.isStudioAccount && !state.organization) {
      openStudio();
      return;
    }

    $('analyticsBack').style.display = 'flex';
    renderAnalytics();
  }

  function closeAnalytics() {
    $('analyticsBack').style.display = 'none';
  }
  function renderAnalytics() {
    const invoices = state.session
      ? state.invoices
      : state.localInvoices.map(localToView);

    const overdueInvoices = invoices.filter(
      (invoice) => invoiceStatus(invoice) === 'overdue'
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

      const days = diffDays(invoice);
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

    $('analyticsOverdueTotal').textContent = moneyFromCents(overdueCents);

    $('analyticsOverdueCount').textContent =
      `${overdueInvoices.length} fattur${overdueInvoices.length === 1 ? 'a scaduta' : 'e scadute'
      }`;

    $('aging0to30').textContent = moneyFromCents(aging.from0to30.cents);
    $('aging0to30Count').textContent =
      `${aging.from0to30.count} fattur${aging.from0to30.count === 1 ? 'a' : 'e'
      }`;

    $('aging31to60').textContent = moneyFromCents(aging.from31to60.cents);
    $('aging31to60Count').textContent =
      `${aging.from31to60.count} fattur${aging.from31to60.count === 1 ? 'a' : 'e'
      }`;

    $('aging61to90').textContent = moneyFromCents(aging.from61to90.cents);
    $('aging61to90Count').textContent =
      `${aging.from61to90.count} fattur${aging.from61to90.count === 1 ? 'a' : 'e'
      }`;

    $('agingOver90').textContent = moneyFromCents(aging.over90.cents);
    $('agingOver90Count').textContent =
      `${aging.over90.count} fattur${aging.over90.count === 1 ? 'a' : 'e'
      }`;

    const topDebtors = [...debtors.values()]
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 10);

    if (!topDebtors.length) {
      $('topDebtorsContent').innerHTML = `
      <div class="analytics-empty">
        Nessuna fattura scaduta al momento.
      </div>`;
      return;
    }

    $('topDebtorsContent').innerHTML = `
    <div class="top-debtors-list">
      ${topDebtors.map((debtor, index) => `
        <article class="top-debtor-row">
          <span class="top-debtor-rank">${index + 1}</span>

          <div class="top-debtor-main">
            <strong>${escapeHtml(debtor.name)}</strong>
            <small>
              ${debtor.count} fattur${debtor.count === 1 ? 'a' : 'e'
      } scadut${debtor.count === 1 ? 'a' : 'e'
      } · fino a ${debtor.oldestDays} giorni di ritardo
            </small>
          </div>

          <div class="top-debtor-amount">
            ${moneyFromCents(debtor.cents)}
          </div>
        </article>
      `).join('')}
    </div>`;
  }

  function renderApprovalQueue() {
    const reminders = state.scheduledReminders;
    if (!reminders.length) {
      $('approvalContent').innerHTML = '<div class="approval-empty">Nessun sollecito da approvare. Le fatture idonee e scadute compariranno qui come bozze.</div>';
      return;
    }

    $('approvalContent').innerHTML = `
    <div class="approval-list">
      ${reminders.map((reminder) => {
      const invoice = state.invoices.find(
        (invoice) => invoice.id === reminder.invoice_id
      );
      if (!invoice) {
        return `
    <div class="empty">
      Fattura collegata non trovata per il sollecito.
    </div>
  `;
      }
      const days = diffDays(invoice);
      return `
          <article class="approval-item">
            <div class="approval-item-head">
              <div>
                <h3>${escapeHtml(invoice.customer_name || 'Cliente')}</h3>
                <p>Fattura ${escapeHtml(invoice.invoice_number || 'senza numero')} · ${moneyFromCents(invoice.amount_cents)} · scaduta da ${days} giorni</p>
                <p>Modello: <strong>${escapeHtml(scheduledReminderLabel(reminder.template_key))}</strong>${reminder.recipient_email ? ` · ${escapeHtml(reminder.recipient_email)}` : ' · email cliente non inserita'}</p>
              </div>
              <span class="badge due">Da approvare</span>
            </div>
            <div class="approval-actions">
  <button
    type="button"
    class="small secondary"
    data-approval-op="history"
    data-invoice-id="${invoice.id}"
  >
    Storico
  </button>

  <button
    type="button"
    class="small secondary"
    data-approval-op="cancel"
    data-reminder-id="${reminder.id}"
  >
    Annulla
  </button>

  <button
    type="button"
    class="small violet"
    data-approval-op="approve"
    data-reminder-id="${reminder.id}"
  >
    Apri e approva
  </button>
</div>
          </article>`;
    }).join('')}
    </div>`;
  }

  async function cancelScheduledReminder(reminderId) {
    const reminder = state.scheduledReminders.find(
      (item) => String(item.id) === String(reminderId)
    );

    if (!reminder) {
      toast('La bozza non è più disponibile.');
      return;
    }

    const { error } = await state.supabase
      .from('reminders')
      .update({ status: 'cancelled' })
      .eq('id', reminder.id)
      .eq('status', 'scheduled');

    if (error) {
      toast(`Impossibile annullare la bozza: ${error.message}`);
      return;
    }

    await logInvoiceActivity(
      reminder.invoice_id,
      'reminder_cancelled',
      'Bozza di sollecito annullata dalla coda di approvazione.',
      {
        reminder_id: reminder.id,
        reminder_template_key: reminder.template_key
      }
    );

    await loadScheduledReminders();
    renderApprovalQueue();
    toast('Bozza annullata.');
  }
  function findInvoiceById(invoiceId) {
    return state.invoices.find(
      (invoice) => String(invoice.id) === String(invoiceId)
    );
  }
  async function openScheduledReminder(reminderId) {
    const reminder = state.scheduledReminders.find(
      (item) => String(item.id) === String(reminderId)
    );

    if (!reminder) {
      return;
    }

    const invoice = findInvoiceById(reminder.invoice_id);

    if (!invoice) {
      toast('La fattura associata a questa bozza non è disponibile.');
      return;
    }

    const status = invoiceStatus(invoice);
    const hasValidPromise =
      status === 'promised' &&
      invoice.promised_payment_date &&
      invoice.promised_payment_date >= today();

    if (
      status === 'paid' ||
      status === 'disputed' ||
      status === 'paused' ||
      hasValidPromise
    ) {
      const { error } = await state.supabase
        .from('reminders')
        .update({ status: 'cancelled' })
        .eq('id', reminder.id)
        .eq('status', 'scheduled');

      if (error) {
        toast(`Impossibile annullare la bozza: ${error.message}`);
        return;
      }

      await logInvoiceActivity(
        reminder.invoice_id,
        'reminder_cancelled',
        `Bozza annullata: fattura ora ${statusLabel(status)}.`,
        {
          reminder_id: reminder.id,
          reminder_template_key: reminder.template_key,
          cancellation_reason: status
        }
      );

      await loadScheduledReminders();
      renderApprovalQueue();

      toast(
        hasValidPromise
          ? 'Bozza annullata: è presente una promessa di pagamento futura.'
          : `Bozza annullata: fattura ${statusLabel(status).toLowerCase()}.`
      );

      return;
    }

    state.activeScheduledReminder = reminder;
    closeApprovalQueue();
    openReminder(invoice, reminder.template_key);

    $('mailSubject').value = reminder.subject_snapshot;
    $('mailBody').value = reminder.body_snapshot;
  }
  function openRules() {
    if (!state.session || !state.organization) {
      toast('Accedi al cloud per modificare le regole di sollecito.');
      return;
    }

    $('rulesError').textContent = '';
    $('rulesError').classList.remove('visible');
    $('firstReminderDays').value = state.reminderSettings.first_reminder_after_days || 3;
    $('secondReminderDays').value = state.reminderSettings.second_reminder_after_days || 15;
    $('rulesBack').style.display = 'flex';
  }

  function closeRules() {
    $('rulesBack').style.display = 'none';
  }

  function showRulesError(message) {
    $('rulesError').textContent = message;
    $('rulesError').classList.add('visible');
  }

  async function saveRules() {
    if (!state.session || !state.organization) return;

    const firstDays = Number($('firstReminderDays').value);
    const secondDays = Number($('secondReminderDays').value);

    if (!Number.isInteger(firstDays) || firstDays < 1 || firstDays > 60) {
      showRulesError('Il primo sollecito deve essere un numero intero da 1 a 60 giorni.');
      return;
    }

    if (!Number.isInteger(secondDays) || secondDays < 2 || secondDays > 120) {
      showRulesError('Il secondo sollecito deve essere un numero intero da 2 a 120 giorni.');
      return;
    }

    if (secondDays <= firstDays) {
      showRulesError('Il secondo sollecito deve essere successivo al primo.');
      return;
    }

    const payload = {
      first_reminder_after_days: firstDays,
      second_reminder_after_days: secondDays,
      approval_required: true,
      automatic_email_enabled: false
    };

    const { data, error } = await state.supabase
      .from('organization_reminder_settings')
      .update(payload)
      .eq('organization_id', state.organization.id)
      .select()
      .single();

    if (error) {
      showRulesError(`Impossibile salvare le regole: ${error.message}`);
      return;
    }

    state.reminderSettings = data;
    closeRules();
    await generateScheduledReminders();
    toast('Regole sollecito salvate.');
  }

  function bindEvents() {
    $('addBtn').addEventListener('click', addInvoice);
    $('duplicateCheckBtn').addEventListener('click', detectDuplicateInvoices);
    $('customersBtn').addEventListener('click', openCustomers);
    $('analyticsBtn').addEventListener('click', openAnalytics);
    $('rulesBtn').addEventListener('click', openRules);
    $('guideBtn').addEventListener('click', openGuide);
    $('studioBtn').addEventListener('click', openStudio);
    // Listener per il modal Piani (chiusura)
    $('studioSearch').addEventListener('input', renderStudio);

    $('studioClientsContent').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-studio-company-op]');
      if (!button) return;

      if (button.dataset.studioCompanyOp === 'open') {
        selectCompany(button.dataset.studioCompanyId);
      } else if (button.dataset.studioCompanyOp === 'open-own') {
        openOwnStudio();
      } else if (button.dataset.studioCompanyOp === 'rename') {
        renameOrganization(button.dataset.studioCompanyId, button.dataset.studioCompanyName);
      } else if (button.dataset.studioCompanyOp === 'delete') {
        deleteManagedCompany(button.dataset.studioCompanyId, button.dataset.studioCompanyName);
      }
    });

    $('studioAddCompanyBtn').addEventListener('click', async () => {
      const input = $('studioNewCompanyName');
      const newOrgId = await createManagedCompany(input.value);
      if (newOrgId) {
        input.value = '';
      }
    });
    $('studioNewCompanyName').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        $('studioAddCompanyBtn').click();
      }
    });
    $('closePlansBtn').addEventListener('click', closePlans);
    $('closePlansActionBtn').addEventListener('click', closePlans);
    $('plansBack').addEventListener('click', (event) => {
      if (event.target === $('plansBack')) closePlans();
    });
    $('closeRulesBtn').addEventListener('click', closeRules);
    $('closeGuideBtn').addEventListener('click', closeGuide);
    $('closeStudioBtn').addEventListener('click', closeStudio);
    $('closeStudioActionBtn').addEventListener('click', closeStudio);
    $('studioBack').addEventListener('click', (event) => {
      if (event.target === $('studioBack')) closeStudio();
    });
    $('closeGuideActionBtn').addEventListener('click', closeGuide);
    $('guideBack').addEventListener('click', (event) => {
      if (event.target === $('guideBack')) closeGuide();
    });
    $('cancelRulesBtn').addEventListener('click', closeRules);
    $('saveRulesBtn').addEventListener('click', saveRules);
    $('rulesBack').addEventListener('click', (event) => {
      if (event.target === $('rulesBack')) closeRules();
    });

    $('closeCustomersBtn').addEventListener('click', closeCustomers);
    $('customersBackBtn').addEventListener('click', closeCustomers);
    $('customersBack').addEventListener('click', (event) => {
      if (event.target === $('customersBack')) closeCustomers();
    });
    $('customerSearch').addEventListener('input', renderCustomers);
    $('newCustomerBtn').addEventListener('click', () => openCustomerEditor(null));
    $('importCustomersBtn').addEventListener('click', () => {
      if (!state.session) {
        toast('Accedi al cloud per importare clienti.');
        return;
      }
      $('importCustomersFile').click();
    });

    $('importCustomersFile').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      await importCustomersFile(file);
      event.target.value = '';
    });
    $('customersContent').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-customer-op]');
      if (!button) return;
      const customer = state.customers.find((item) => item.id === button.dataset.customerId);
      if (customer && button.dataset.customerOp === 'edit') openCustomerEditor(customer);
    });
    $('closeCustomerEditBtn').addEventListener('click', closeCustomerEditor);
    $('cancelCustomerEditBtn').addEventListener('click', closeCustomerEditor);
    $('customerEditBack').addEventListener('click', (event) => {
      if (event.target === $('customerEditBack')) closeCustomerEditor();
    });
    $('saveCustomerBtn').addEventListener('click', saveCustomer);

    $('search').addEventListener('input', render);
    $('filter').addEventListener('change', render);
    $('customerSelect').addEventListener('change', (event) => {
      const customer = state.customers.find((item) => item.id === event.target.value);
      if (customer) {
        $('customer').value = customer.name;
        $('email').value = customer.email || '';
      }
    });
    $('priorityContent').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-priority-op]');

      if (!button) {
        return;
      }

      const invoice = findInvoice(button.dataset.priorityId);

      if (!invoice) {
        return;
      }

      if (button.dataset.priorityOp === 'remind') {
        openReminder(invoice);
      }

      if (button.dataset.priorityOp === 'draft') {
        const reminder = state.scheduledReminders.find(
          (item) => String(item.invoice_id) === String(invoice.id)
        );
        if (reminder) {
          openScheduledReminder(reminder.id);
        }
      }

      if (button.dataset.priorityOp === 'status') {
        openStatusModal(invoice);
      }
    });
    $('tableWrap').addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-op]');
      if (!button) return;
      const invoice = findInvoice(button.dataset.id);
      if (!invoice) return;
      if (button.dataset.op === 'remind') openReminder(invoice);
      if (button.dataset.op === 'history') await openHistory(invoice);
      if (button.dataset.op === 'status') openStatusModal(invoice);
      if (button.dataset.op === 'delete') await deleteInvoice(invoice);
    });

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-preview]');
      if (!button) return;
      openReminder({
        id: 'preview',
        customer_name: 'Rossi Impianti SRL',
        customer_email: 'amministrazione@rossiimpianti.it',
        invoice_number: '24/2026',
        amount_cents: 250000,
        due_date: today(),
        status: 'open',
        source: 'preview'
      }, button.dataset.preview);
    });

    $('modelChoice').addEventListener('change', (event) => chooseModel(event.target.value));
    $('closeBtn').addEventListener('click', closeReminder);
    $('modalBack').addEventListener('click', (event) => {
      if (event.target === $('modalBack')) closeReminder();
    });
    $('closeHistoryBtn').addEventListener('click', closeHistory);

    $('historyBack').addEventListener('click', (event) => {
      if (event.target === $('historyBack')) closeHistory();
    });
    $('closeStatusBtn').addEventListener('click', closeStatusModal);

    $('cancelStatusBtn').addEventListener('click', closeStatusModal);

    $('saveStatusBtn').addEventListener('click', saveInvoiceStatus);

    $('statusBack').addEventListener('click', (event) => {
      if (event.target === $('statusBack')) closeStatusModal();
    });

    document.querySelectorAll('input[name="invoiceStatus"]').forEach((input) => {
      input.addEventListener('change', () => {
        $('promiseField').classList.toggle(
          'visible',
          input.value === 'promised' && input.checked
        );
      });
    });
    $('copyBtn').addEventListener('click', copyReminder);
    $('emailBtn').addEventListener('click', openEmail);

    $('authBtn').addEventListener('click', openAuth);
    $('approvalBtn').addEventListener('click', openApprovalQueue);
    $('closeApprovalBtn').addEventListener('click', closeApprovalQueue);
    $('approvalBack').addEventListener('click', (event) => {
      if (event.target === $('approvalBack')) closeApprovalQueue();
    });
    $('closeAnalyticsBtn').addEventListener('click', closeAnalytics);
    $('analyticsBack').addEventListener('click', (event) => {
      if (event.target === $('analyticsBack')) closeAnalytics();
    });
    $('approvalContent').addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-approval-op]');

      if (!button) {
        return;
      }

      if (button.dataset.approvalOp === 'history') {
        const invoice = findInvoice(button.dataset.invoiceId);

        if (invoice) {
          openHistory(invoice);
        }

        return;
      }

      if (button.dataset.approvalOp === 'cancel') {
        await cancelScheduledReminder(button.dataset.reminderId);
      }

      if (button.dataset.approvalOp === 'approve') {
        openScheduledReminder(button.dataset.reminderId);
      }
    });
    $('closeAuthBtn').addEventListener('click', closeAuth);
    $('authBack').addEventListener('click', (event) => {
      if (event.target === $('authBack')) closeAuth();
    });
    $('signUpBtn').addEventListener('click', signUp);
    $('signInBtn').addEventListener('click', signIn);
    $('signOutBtn').addEventListener('click', signOut);

    $('exportBtn').addEventListener('click', exportCsv);
    $('importFile').addEventListener('change', async (event) => {
      await importFile(event.target.files[0]);
      event.target.value = '';
    });
    $('resetBtn').addEventListener('click', () => {
      if (!confirm('Azzero tutte le scadenze locali in questo browser? I dati cloud non verranno cancellati.')) return;
      state.localInvoices = [];
      localStorage.removeItem(LOCAL_KEY);
      render();
      toast('Dati locali azzerati.');
    });
  }

  async function start() {
    normalizeLocalInvoices();
    $('dueDate').value = today();
    bindEvents();
    render();
    updateAccountUi();
    await initializeSupabase();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('../service-worker.js');
  }

  start();
  $('closeImportSummaryBtn')?.addEventListener('click', closeImportSummary);

  $('closeImportSummaryActionBtn')?.addEventListener(
    'click',
    closeImportSummary
  );

  $('importSummaryBack')?.addEventListener('click', (event) => {
    if (event.target === $('importSummaryBack')) {
      closeImportSummary();
    }
  });
})();
