/* INCASSAPRIMA PRO — app.js corretto

Nota: questo file è stato ricostruito dalla copia allegata e incorpora:
- caricamento impostazioni organizzazione
- soglie configurabili per i solleciti
- coda reminders
- storico invoice_activity_log
- approvazione e annullamento tracciati

Mantieni le tue credenziali Supabase publishable già presenti nel file originale.
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
    activeScheduledReminder: null,
    scheduledReminders: [],
    reminderSettings: {
      first_reminder_after_days: 3,
      second_reminder_after_days: 15,
      approval_required: true,
      automatic_email_enabled: false
    },
    localInvoices: []
  };

  const models = {
    first: {
      label: 'Primo sollecito',
      subject: 'Promemoria pagamento fattura {{numero}}',
      body: 'Buongiorno {{cliente}},\n\ncon la presente ricordiamo che la fattura n. {{numero}}, dell’importo di {{importo}}, con scadenza {{scadenza}}, risulta ancora da saldare.\n\nQualora il pagamento fosse già stato effettuato, ti chiediamo di ignorare questa comunicazione. Diversamente, puoi indicarci la data prevista di pagamento?\n\nGrazie per la collaborazione.'
    },
    second: {
      label: 'Secondo sollecito',
      subject: 'Secondo sollecito — fattura {{numero}} scaduta',
      body: 'Buongiorno {{cliente}},\n\nnon risulta ancora pervenuto il pagamento della fattura n. {{numero}}, per un importo di {{importo}}, scaduta il {{scadenza}}.\n\nChiediamo cortesemente di procedere al saldo oppure di comunicarci entro breve la data prevista di pagamento.\n\nCordiali saluti.'
    }
  };

  function configured() {
    return SUPABASE_URL.startsWith('https://') && SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_');
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function money(value) {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
  }

  function moneyFromCents(cents) {
    return money(Number(cents || 0) / 100);
  }

  function dateIt(value) {
    if (!value) return '—';
    const parts = String(value).slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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

  function parseDateOnly(value) {
    const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
    return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
      ? new Date(year, month - 1, day)
      : null;
  }

  function diffDays(invoice) {
    const due = parseDateOnly(invoice?.due_date || invoice?.due);
    const now = parseDateOnly(today());
    if (!due || !now) return 0;
    return Math.floor((now - due) / 86400000);
  }

  function invoiceStatus(invoice) {
    const raw = invoice.status || 'open';
    if (['paid', 'promised', 'disputed', 'paused'].includes(raw)) return raw;
    return diffDays(invoice) > 0 ? 'overdue' : 'open';
  }

  function getCustomerForInvoice(invoice) {
    return state.customers.find((customer) => customer.id === invoice.customer_id) || null;
  }

  function isEligibleForAutomaticReminder(invoice) {
    if (!invoice || invoice.source !== 'cloud') return false;
    const customer = getCustomerForInvoice(invoice);
    if (!customer || customer._paused) return false;
    const status = invoice.status || 'open';
    if (['paid', 'disputed', 'paused'].includes(status)) return false;
    if (status === 'promised' && invoice.promised_payment_date && invoice.promised_payment_date >= today()) return false;
    return status === 'open' || status === 'promised';
  }

  function suggestedAutomaticModel(invoice) {
    const days = diffDays(invoice);
    const firstDays = Number(state.reminderSettings?.first_reminder_after_days || 3);
    const secondDays = Number(state.reminderSettings?.second_reminder_after_days || 15);
    if (days >= secondDays) return 'second';
    if (days >= firstDays) return 'first';
    return null;
  }

  function fillTemplate(text, invoice) {
    const customer = invoice.customer_name || 'Cliente';
    const number = invoice.invoice_number || invoice.number || '—';
    const amount = invoice.amount_cents !== undefined ? moneyFromCents(invoice.amount_cents) : money(invoice.amount);
    return String(text)
      .replace(/\{\{cliente\}\}/g, customer)
      .replace(/\{\{numero\}\}/g, number)
      .replace(/\{\{importo\}\}/g, amount)
      .replace(/\{\{scadenza\}\}/g, dateIt(invoice.due_date || invoice.due));
  }

  function findInvoiceById(invoiceId) {
    return state.invoices.find((invoice) => String(invoice.id) === String(invoiceId));
  }

  async function logInvoiceActivity(invoiceId, eventType, message, metadata = {}) {
    if (!state.supabase || !state.session || !state.organization || !invoiceId) return;
    const { error } = await state.supabase.from('invoice_activity_log').insert({
      organization_id: state.organization.id,
      invoice_id: invoiceId,
      actor_user_id: state.session.user.id,
      event_type: eventType,
      message,
      metadata
    });
    if (error) console.error('Errore registrazione storico attività:', error.message);
  }

  async function loadReminderSettings() {
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
    if (data) state.reminderSettings = data;
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

  function buildScheduledReminder(invoice, templateKey) {
    const model = models[templateKey];
    return {
      organization_id: state.organization.id,
      invoice_id: invoice.id,
      template_key: templateKey,
      status: 'scheduled',
      scheduled_at: new Date().toISOString(),
      subject_snapshot: fillTemplate(model.subject, invoice),
      body_snapshot: fillTemplate(model.body, invoice),
      recipient_email: invoice.customer_email || null,
      channel: 'email'
    };
  }

  async function generateScheduledReminders() {
    if (!state.session || !state.organization) return;
    const invoiceIds = state.invoices.map((invoice) => invoice.id);
    if (!invoiceIds.length) return;
    const { data: allReminders, error } = await state.supabase
      .from('reminders')
      .select('invoice_id, template_key, status')
      .in('invoice_id', invoiceIds);
    if (error) {
      console.error('Errore verifica storico reminder:', error.message);
      return;
    }
    const alreadyHandled = new Set((allReminders || []).map((reminder) => `${reminder.invoice_id}:${reminder.template_key}`));
    const candidates = state.invoices
      .filter(isEligibleForAutomaticReminder)
      .map((invoice) => ({ invoice, templateKey: suggestedAutomaticModel(invoice) }))
      .filter((item) => item.templateKey && !alreadyHandled.has(`${item.invoice.id}:${item.templateKey}`));
    for (const candidate of candidates) {
      const payload = buildScheduledReminder(candidate.invoice, candidate.templateKey);
      const { error: insertError } = await state.supabase.from('reminders').insert(payload);
      if (insertError && insertError.code !== '23505') {
        console.error('Errore creazione bozza:', insertError.message);
      }
      if (!insertError) {
        await logInvoiceActivity(
          candidate.invoice.id,
          'reminder_scheduled',
          `${candidate.templateKey === 'second' ? 'Secondo' : 'Primo'} sollecito proposto automaticamente e inserito nella coda di approvazione.`,
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
    if (!memberships?.length) {
      setStatus('Account creato ma organizzazione non trovata.', 'error');
      return;
    }
    state.organization = memberships[0].organizations;
    const organizationId = memberships[0].organization_id;
    await loadReminderSettings();
    const { data: customers, error: customerError } = await state.supabase.from('customers').select('*').eq('organization_id', organizationId).order('name');
    if (customerError) { setStatus(`Errore clienti: ${customerError.message}`, 'error'); return; }
    const { data: invoices, error: invoiceError } = await state.supabase.from('invoices').select('*, customers(name, email)').eq('organization_id', organizationId).order('due_date');
    if (invoiceError) { setStatus(`Errore fatture: ${invoiceError.message}`, 'error'); return; }
    state.customers = customers || [];
    state.invoices = (invoices || []).map((invoice) => ({
      ...invoice,
      customer_name: invoice.customers?.name || 'Cliente',
      customer_email: invoice.customers?.email || '',
      source: 'cloud'
    }));
    await loadScheduledReminders();
    await generateScheduledReminders();
    render();
  }

  function updateApprovalBadge() {
    const el = $('approvalCount');
    if (el) el.textContent = String(state.scheduledReminders.length);
  }

  async function cancelScheduledReminder(reminderId) {
    const reminder = state.scheduledReminders.find((item) => String(item.id) === String(reminderId));
    if (!reminder) { toast('La bozza non è più disponibile.'); return; }
    const { error } = await state.supabase.from('reminders').update({ status: 'cancelled' }).eq('id', reminder.id).eq('status', 'scheduled');
    if (error) { toast(`Impossibile annullare la bozza: ${error.message}`); return; }
    await logInvoiceActivity(reminder.invoice_id, 'reminder_cancelled', 'Bozza di sollecito annullata dalla coda di approvazione.', { reminder_id: reminder.id, reminder_template_key: reminder.template_key });
    await loadScheduledReminders();
    renderApprovalQueue();
    toast('Bozza annullata.');
  }

  function openScheduledReminder(reminderId) {
    const reminder = state.scheduledReminders.find((item) => String(item.id) === String(reminderId));
    if (!reminder) return;
    const invoice = findInvoiceById(reminder.invoice_id);
    if (!invoice) { toast('La fattura associata a questa bozza non è disponibile.'); return; }
    state.activeScheduledReminder = reminder;
    closeApprovalQueue();
    openReminder(invoice, reminder.template_key);
    $('mailSubject').value = reminder.subject_snapshot || '';
    $('mailBody').value = reminder.body_snapshot || '';
  }

  async function openEmail() {
    const email = state.activeInvoice?.customer_email || state.activeInvoice?.email || '';
    const reminder = state.activeScheduledReminder;
    if (reminder && state.session) {
      const { error } = await state.supabase.from('reminders').update({
        status: 'sent', channel: 'email', sent_at: new Date().toISOString(),
        subject_snapshot: $('mailSubject').value, body_snapshot: $('mailBody').value,
        recipient_email: email || null
      }).eq('id', reminder.id).eq('status', 'scheduled');
      if (error) { toast(`Impossibile approvare la bozza: ${error.message}`); return; }
      await logInvoiceActivity(reminder.invoice_id, 'reminder_approved', 'Sollecito approvato: aperto il client email per l’invio manuale.', { reminder_id: reminder.id, reminder_template_key: reminder.template_key, recipient_email: email || '', subject: $('mailSubject').value });
      state.activeScheduledReminder = null;
      await loadScheduledReminders();
      toast('Bozza approvata: apertura email in corso.');
    } else if (typeof saveReminderLog === 'function') {
      await saveReminderLog('sent');
    }
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent($('mailSubject').value)}&body=${encodeURIComponent($('mailBody').value)}`;
  }

  function renderApprovalQueue() {
    const container = $('approvalList') || $('approvalQueueList') || $('approvalBody');
    if (!container) return;
    if (!state.scheduledReminders.length) {
      container.innerHTML = '<div class="empty">Nessun sollecito da approvare.</div>';
      return;
    }
    container.innerHTML = state.scheduledReminders.map((reminder) => {
      const invoice = findInvoiceById(reminder.invoice_id);
      if (!invoice) return '';
      const amount = invoice.amount_cents !== undefined ? moneyFromCents(invoice.amount_cents) : money(invoice.amount);
      return `<div class="approval-item"><div><strong>${escapeHtml(invoice.customer_name)}</strong><div>Fattura ${escapeHtml(invoice.invoice_number || '—')} · ${amount} · scaduta da ${diffDays(invoice)} giorni</div><div>Modello: ${escapeHtml(models[reminder.template_key]?.label || reminder.template_key)} · ${escapeHtml(reminder.recipient_email || invoice.customer_email || '')}</div></div><span class="badge">Da approvare</span><div><button type="button" data-cancel-reminder="${escapeHtml(reminder.id)}">Annulla</button><button type="button" data-open-reminder="${escapeHtml(reminder.id)}">Apri e approva</button></div></div>`;
    }).join('');
    container.querySelectorAll('[data-cancel-reminder]').forEach((button) => button.addEventListener('click', () => cancelScheduledReminder(button.dataset.cancelReminder)));
    container.querySelectorAll('[data-open-reminder]').forEach((button) => button.addEventListener('click', () => openScheduledReminder(button.dataset.openReminder)));
  }

  function openApprovalQueue() {
    renderApprovalQueue();
    const back = $('approvalBack');
    if (back) back.style.display = 'flex';
  }

  function closeApprovalQueue() {
    const back = $('approvalBack');
    if (back) back.style.display = 'none';
  }

  function openReminder(invoice, templateKey) {
    state.activeInvoice = invoice;
    const model = models[templateKey] || models.first;
    if ($('mailSubject')) $('mailSubject').value = fillTemplate(model.subject, invoice);
    if ($('mailBody')) $('mailBody').value = fillTemplate(model.body, invoice);
    if ($('reminderBack')) $('reminderBack').style.display = 'flex';
  }

  function render() {
    const invoices = state.invoices;
    let open = 0, overdue = 0, paid = 0, overdueCount = 0;
    invoices.forEach((invoice) => {
      const amount = invoice.amount_cents !== undefined ? Number(invoice.amount_cents) / 100 : Number(invoice.amount || 0);
      const status = invoiceStatus(invoice);
      if (status === 'paid') paid += amount;
      else { open += amount; if (status === 'overdue') { overdue += amount; overdueCount += 1; } }
    });
    if ($('openTotal')) $('openTotal').textContent = money(open);
    if ($('overdueTotal')) $('overdueTotal').textContent = money(overdue);
    if ($('overdueCount')) $('overdueCount').textContent = String(overdueCount);
    if ($('paidTotal')) $('paidTotal').textContent = money(paid);
    updateApprovalBadge();
  }

  async function initializeSupabase() {
    if (!configured()) return;
    if (!window.supabase?.createClient) { setStatus('Errore: libreria Supabase non caricata.', 'error'); return; }
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const { data, error } = await state.supabase.auth.getSession();
    if (error) { setStatus(`Errore sessione: ${error.message}`, 'error'); return; }
    state.session = data.session;
    if (state.session) { await loadCloudData(); setStatus(`Cloud attivo · ${state.session.user.email}`, 'success'); }
  }

  function bindEvents() {
    $('approvalBtn')?.addEventListener('click', openApprovalQueue);
    $('closeApprovalBtn')?.addEventListener('click', closeApprovalQueue);
    $('openEmailBtn')?.addEventListener('click', openEmail);
    $('closeReminderBtn')?.addEventListener('click', () => { if ($('reminderBack')) $('reminderBack').style.display = 'none'; });
  }

  window.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    await initializeSupabase();
  });
})();
