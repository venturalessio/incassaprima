/*
  INCASSAPRIMA PRO 1
  1) Sostituisci INCOLLA_QUI... con Project URL e Publishable key di Supabase.
  2) Non inserire mai una chiave sb_secret_ o service_role in questo file.
*/

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

    localInvoices: []
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

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function moneyFromCents(cents) {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR'
    }).format(Number(cents || 0) / 100);
  }

  function money(value) {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR'
    }).format(Number(value || 0));
  }

  function dateIt(value) {
    if (!value) return '—';
    const parts = value.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function parseItalianAmount(value) {
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

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(window.__incassaToast);
    window.__incassaToast = setTimeout(() => { el.style.display = 'none'; }, 2800);
  }

  function setStatus(message, type = 'info') {
    const el = $('syncStatus');
    if (!el) return;
    el.textContent = message;
    el.className = `sync-status ${type}`;
  }

  function diffDays(invoice) {
    const due = new Date(`${invoice.due_date || invoice.due}T00:00:00`).getTime();
    const now = new Date(`${today()}T00:00:00`).getTime();
    return Math.ceil((now - due) / 86400000);
  }

  function invoiceStatus(invoice) {
    const rawStatus = invoice.status || (invoice.paid ? 'paid' : 'open');
    if (rawStatus === 'paid') return 'paid';
    if (rawStatus === 'promised') return 'promised';
    if (rawStatus === 'disputed') return 'disputed';
    if (rawStatus === 'paused') return 'paused';
    const days = diffDays(invoice);
    if (days > 0) return 'overdue';
    if (days >= -7) return 'due';
    return 'upcoming';
  }

  function statusLabel(status) {
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
  if (!customer || customer._paused) return false;
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
  function recommendedModel(invoice) {
    const days = diffDays(invoice);
    if (days <= 2) return 'courtesy';
    if (days <= 14) return 'first';
    return 'second';
  }

  function recommendationText(invoice) {
    const days = diffDays(invoice);
    if (days < 0) return `Mancano ${Math.abs(days)} giorni alla scadenza: consigliato il promemoria cortese.`;
    if (days === 0) return 'La fattura scade oggi: consigliato il promemoria cortese.';
    if (days <= 2) return `La fattura è scaduta da ${days} giorno${days === 1 ? '' : 'i'}: consigliato il promemoria cortese.`;
    if (days <= 14) return `La fattura è scaduta da ${days} giorni: consigliato il primo sollecito.`;
    return `La fattura è scaduta da ${days} giorni: consigliato il secondo sollecito.`;
  }

  function fillTemplate(text, invoice) {
    const customer = invoice.customer_name || invoice.customer || 'Cliente';
    const number = invoice.invoice_number || invoice.number || '—';
    const amount = invoice.amount_cents !== undefined
      ? moneyFromCents(invoice.amount_cents)
      : money(invoice.amount);
    const due = invoice.due_date || invoice.due;
    const days = Math.max(0, diffDays(invoice));

    return text
      .replace(/\{\{cliente\}\}/g, customer)
      .replace(/\{\{numero\}\}/g, number)
      .replace(/\{\{importo\}\}/g, amount)
      .replace(/\{\{scadenza\}\}/g, dateIt(due))
      .replace(/\{\{giorni_ritardo\}\}/g, String(days));
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
      status: invoice.paid ? 'paid' : 'open',
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

  async function loadettings() {
  if (!state.session || !state.organization) return;

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
    state.ettings = data;
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
      .select('organization_id, role, organizations(id, name, plan)')
      .eq('user_id', state.session.user.id)
      .limit(1);

    if (membershipError) {
      setStatus(`Errore organizzazione: ${membershipError.message}`, 'error');
      return;
    }

    if (!memberships || !memberships.length) {
      setStatus('Account creato ma organizzazione non trovata. Controlla il trigger SQL.', 'error');
      return;
    }

    state.organization = memberships[0].organizations;
    const organizationId = memberships[0].organization_id;
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
      customer_email: invoice.customers ? invoice.customers.email : '' ,
      source: 'cloud'
    }));

    updateCustomerOptions();
render();
await loadScheduledReminders();
await generateScheduledReminders();
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
    }).sort((a, b) => (a.due_date || a.due).localeCompare(b.due_date || b.due));
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
    `Fattura ${invoice.invoice_number || invoice.number || 'senza numero'} · ${
      invoice.amount_cents !== undefined
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

    if (!local) return;

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

  closeStatusModal();
  await loadCloudData();
  toast('Stato fattura aggiornato.');
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
    updateAccountUi();
    state.organization = null;
    state.customers = [];
    state.invoices = [];
    state.scheduledReminders = [];
state.activeScheduledReminder = null;
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
    const source = state.session ? state.invoices : state.localInvoices.map(localToView);
    const header = ['cliente', 'numero_fattura', 'importo_euro', 'scadenza', 'email', 'stato'];
    const rows = source.map((invoice) => [
      invoice.customer_name || invoice.customer || '',
      invoice.invoice_number || invoice.number || '',
      invoice.amount_cents !== undefined ? (Number(invoice.amount_cents) / 100).toFixed(2) : Number(invoice.amount || 0).toFixed(2),
      invoice.due_date || invoice.due || '',
      invoice.customer_email || invoice.email || '',
      invoice.status || (invoice.paid ? 'paid' : 'open')
    ]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'incassaprima-scadenze.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 700);
  }

  async function importCsv(file) {
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      toast('Il CSV è vuoto o non valido.');
      return;
    }

    const parseLine = (line) => {
      const matches = line.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g) || [];
      return matches.map((value) => value.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, ''));
    };

    const rows = lines.slice(1).map(parseLine).filter((values) => values.length >= 4 && values[0]);
    if (!rows.length) {
      toast('Nessuna riga valida trovata nel CSV.');
      return;
    }

    if (!state.session) {
      rows.forEach((values) => {
        const amount = parseItalianAmount(values[2]);
        if (Number.isFinite(amount) && values[3]) {
          state.localInvoices.push({
            id: `${Date.now()}-${Math.random()}`,
            customer: values[0],
            number: values[1],
            amount,
            due: values[3],
            email: values[4] || '',
            paid: values[5] === 'paid' || values[5] === 'true'
          });
        }
      });
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state.localInvoices));
      render();
      toast(`${rows.length} righe importate in locale.`);
      return;
    }

    let imported = 0;
    for (const values of rows) {
      const amount = parseItalianAmount(values[2]);
      const dueDate = values[3];
      if (!Number.isFinite(amount) || !dueDate) continue;

      let customer = state.customers.find((item) => item.name.trim().toLowerCase() === values[0].trim().toLowerCase());
      if (!customer) {
        const { data, error } = await state.supabase.from('customers').insert({
          organization_id: state.organization.id,
          name: values[0],
          email: values[4] || null
        }).select().single();
        if (error) continue;
        customer = data;
        state.customers.push(customer);
      }

      const status = ['paid', 'promised', 'disputed', 'paused'].includes(values[5]) ? values[5] : 'open';
      const { data, error } = await state.supabase.from('invoices').insert({
        organization_id: state.organization.id,
        customer_id: customer.id,
        invoice_number: values[1] || null,
        amount_cents: Math.round(amount * 100),
        due_date: dueDate,
        status,
        paid_at: status === 'paid' ? new Date().toISOString() : null
      }).select('*, customers(name, email)').single();

      if (!error && data) {
        state.invoices.push({
          ...data,
          customer_name: data.customers?.name || customer.name,
          customer_email: data.customers?.email || customer.email || '',
          source: 'cloud'
        });
        imported += 1;
      }
    }

    updateCustomerOptions();
    render();
    toast(`${imported} righe importate nel cloud.`);
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
    `Storico solleciti — ${invoice.customer_name || 'Cliente'}`;

  $('historySubtitle').textContent =
    `Fattura ${invoice.invoice_number || 'senza numero'} · ${moneyFromCents(invoice.amount_cents)}`;

  $('historyContent').innerHTML =
    '<div class="empty">Caricamento storico…</div>';

  $('historyBack').style.display = 'flex';

  const { data, error } = await state.supabase
    .from('reminders')
    .select('*')
    .eq('invoice_id', invoice.id)
    .order('created_at', { ascending: false });

  if (error) {
    $('historyContent').innerHTML =
      `<div class="empty">Impossibile caricare lo storico: ${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!data || !data.length) {
    $('historyContent').innerHTML =
      '<div class="empty">Nessun sollecito registrato per questa fattura.</div>';
    return;
  }

  $('historyContent').innerHTML = `
    <p class="history-count">
      ${data.length} ${data.length === 1 ? 'sollecito registrato' : 'solleciti registrati'}
    </p>

    <div class="history-list">
      ${data.map((reminder) => `
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
            ${reminder.recipient_email ? ` · ${escapeHtml(reminder.recipient_email)}` : ''}
          </p>

          <details>
            <summary>Visualizza testo registrato</summary>
            <div class="history-message">
              <p><strong>Oggetto:</strong> ${escapeHtml(reminder.subject_snapshot)}</p>
              <p>${escapeWithBreaks(reminder.body_snapshot)}</p>
            </div>
          </details>
        </article>
      `).join('')}
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

function openCustomers() {
  if (!state.session) {
    toast('Accedi al cloud per gestire l’anagrafica clienti.');
    return;
  }
  $('customerSearch').value = '';
  $('customersBack').style.display = 'flex';
  renderCustomers();
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
    return;
  }

  const invoiceIds = state.invoices.map((invoice) => invoice.id);

  if (!invoiceIds.length) {
    state.scheduledReminders = [];
    updateApprovalBadge();
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
    (allReminders || []).map(
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
        if (!invoice) return '';
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
              <button type="button" class="small secondary" data-approval-op="cancel" data-reminder-id="${reminder.id}">Annulla</button>
              <button type="button" class="small violet" data-approval-op="approve" data-reminder-id="${reminder.id}">Apri e approva</button>
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
function openScheduledReminder(reminderId) {
  const reminder = state.scheduledReminders.find((item) => String(item.id) === String(reminderId));
  if (!reminder) return;
  const invoice = findInvoiceById(reminder.invoice_id);
  if (!invoice) {
    toast('La fattura associata a questa bozza non è disponibile.');
    return;
  }

  state.activeScheduledReminder = reminder;
  closeApprovalQueue();
  openReminder(invoice, reminder.template_key);

  // Ripristina esattamente il testo della bozza programmata.
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
    $('customersBtn').addEventListener('click', openCustomers);
    $('rulesBtn').addEventListener('click', openRules);
$('closeRulesBtn').addEventListener('click', closeRules);
$('cancelRulesBtn').addEventListener('click', closeRules);
$('saveRulesBtn').addEventListener('click', saveRules);
$('rulesBack').addEventListener('click', (event) => {
  if (event.target === $('rulesBack')) closeRules();
});

$('closeCustomersBtn').addEventListener('click', closeCustomers);
$('customersBack').addEventListener('click', (event) => {
  if (event.target === $('customersBack')) closeCustomers();
});
$('customerSearch').addEventListener('input', renderCustomers);
$('newCustomerBtn').addEventListener('click', () => openCustomerEditor(null));
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
$('approvalContent').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-approval-op]');
  if (!button) return;
  if (button.dataset.approvalOp === 'cancel') await cancelScheduledReminder(button.dataset.reminderId);
  if (button.dataset.approvalOp === 'approve') openScheduledReminder(button.dataset.reminderId);
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
      await importCsv(event.target.files[0]);
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
})();
