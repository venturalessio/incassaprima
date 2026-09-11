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
    if (state.session) {
      await loadCloudData();
      setStatus(`Cloud attivo · ${state.session.user.email}`, 'success');
    } else {
      setStatus('Modalità locale. Accedi per salvare nel cloud.', 'info');
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
            return `
              <tr>
                <td><strong>${escapeHtml(customer)}</strong><br><small>${escapeHtml(number)}${email ? ` · ${escapeHtml(email)}` : ''}</small></td>
                <td>${dateIt(invoice.due_date || invoice.due)}</td>
                <td class="amount">${amount}</td>
                <td><span class="badge ${status}">${statusLabel(status)}</span></td>
                <td><div class="rowactions">
                  ${!['paid', 'disputed', 'paused'].includes(status) ? `<button type="button" class="small violet" data-op="remind" data-id="${invoice.id}">Sollecito</button>` : ''}
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

  async function changeStatus(invoice) {
    const current = invoiceStatus(invoice);
    const choice = window.prompt(
      'Imposta stato: open, paid, promised, disputed, paused',
      current === 'overdue' || current === 'due' || current === 'upcoming' ? 'open' : current
    );
    if (!choice) return;

    const allowed = ['open', 'paid', 'promised', 'disputed', 'paused'];
    const status = choice.trim().toLowerCase();
    if (!allowed.includes(status)) {
      toast('Stato non valido. Usa: open, paid, promised, disputed o paused.');
      return;
    }

    if (!state.session) {
      const local = state.localInvoices.find((item) => String(item.id) === String(invoice.id));
      if (!local) return;
      local.paid = status === 'paid';
      local.status = status;
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state.localInvoices));
      render();
      toast('Stato aggiornato in locale.');
      return;
    }

    const update = {
      status,
      paid_at: status === 'paid' ? new Date().toISOString() : null,
      promised_payment_date: status === 'promised' ? window.prompt('Data promessa pagamento (AAAA-MM-GG), facoltativa:') || null : null
    };

    const { error } = await state.supabase.from('invoices').update(update).eq('id', invoice.id);
    if (error) {
      toast(`Errore aggiornamento: ${error.message}`);
      return;
    }

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
    $('recommendation').textContent = `${recommendationText(invoice)} Puoi scegliere un modello diverso prima dell’invio.`;
    $('modalBack').style.display = 'flex';
    chooseModel(key);
  }

  function closeReminder() {
    $('modalBack').style.display = 'none';
    state.activeInvoice = null;
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
    const email = state.activeInvoice?.customer_email || state.activeInvoice?.email || '';
    await saveReminderLog('sent');
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent($('mailSubject').value)}&body=${encodeURIComponent($('mailBody').value)}`;
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
      await loadCloudData();
      setStatus(`Cloud attivo · ${email}`, 'success');
      closeAuth();
      toast('Account creato e cloud attivo.');
    } else {
      toast('Account creato. Controlla l’email per confermare l’accesso.');
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

  function bindEvents() {
    $('addBtn').addEventListener('click', addInvoice);
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
      if (button.dataset.op === 'status') await changeStatus(invoice);
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
    $('copyBtn').addEventListener('click', copyReminder);
    $('emailBtn').addEventListener('click', openEmail);

    $('authBtn').addEventListener('click', openAuth);
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
    await initializeSupabase();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('../service-worker.js');
  }

  start();
})();
