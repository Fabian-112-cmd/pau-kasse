'use strict';

// Anmeldung und zentrale Daten. Der alte Gerätespeicher bleibt unverändert.
const legacy = structuredClone(state);
let cloudUser = null;
let cloudBusy = false;
let pendingSale = null;
let revision = 0;
let archivedYears = [];
let cloudSales = [];
let authGeneration = 0;
const account = document.querySelector('#account');
const db = window.supabase?.createClient(PAU_CONFIG.url, PAU_CONFIG.key, {
  auth: {
    storageKey: 'pau-kasse-auth-v1',
    persistSession: true,
    autoRefreshToken: true
  }
});
const oldRender = render;
render = function() {
  if (cloudUser) oldRender();
};

function deviceKey() {
  return 'pau-kasse-device-' + cloudUser.id;
}

function persistDevice() {
  if (!cloudUser) return;
  localStorage.setItem(deviceKey(), JSON.stringify({
    cart: state.cart,
    reference: state.reference,
    pin: state.pin,
    pendingSale
  }));
}
save = function() {
  try {
    persistDevice();
    return true;
  } catch {
    toast('Gerätespeicher nicht verfügbar.');
    return false;
  }
};

function message(error) {
  return error?.message || 'Verbindung fehlgeschlagen. Bitte erneut versuchen.';
}

function loginScreen(text = '') {
  document.querySelector('nav').hidden = true;
  account.innerHTML = '';
  main.innerHTML = `<section class="panel login"><h1>PAU · MAYA</h1><p>Kasse anmelden</p>
    <form id="login-form"><label>Benutzername<input type="text" name="email" required autocomplete="username" placeholder="Test oder Bedienung 1"></label>
    <label>Passwort<input type="password" name="password" required autocomplete="current-password"></label>
    <p id="login-error" role="alert">${esc(text)}</p><button class="primary wide">Anmelden</button></form>
    <p class="note">Test oder Bedienung 1, 2, 3 auswählen. Die bisherige Inhaber-Anmeldung per E-Mail bleibt möglich.</p></section>`;
  document.querySelector('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const b = f.querySelector('button');
    b.disabled = true;
    try {
      if (!db) throw Error('Anmeldedienst konnte nicht geladen werden. Internetverbindung prüfen und Seite neu laden.');
      const {
        error
      } = await db.auth.signInWithPassword({
        email: await resolveLoginEmail(f.email.value.trim()),
        password: f.password.value
      });
      if (error) throw error;
    } catch (error) {
      document.querySelector('#login-error').textContent = message(error);
      b.disabled = false;
    }
  });
}

async function refreshCloud() {
  const user = cloudUser;
  if (!user) throw Error('Bitte anmelden.');
  const results = await Promise.all([
    db.from('pau_kasse_catalog').select('*').eq('user_id', user.workspace_id || user.id).maybeSingle(),
    db.from('pau_kasse_years').select('*').eq('user_id', user.workspace_id || user.id).order('year', {
      ascending: false
    })
  ]);
  for (const r of results)
    if (r.error) throw r.error;
  const catalog = results[0].data;
  if (!catalog) throw Error('Artikelvorlage noch nicht eingerichtet.');
  const sales = [];
  for (let start = 0;; start += 1000) {
    const r = await db.from('pau_kasse_sales').select('*').eq('user_id', user.workspace_id || user.id).order('created_at').order('id').range(start, start + 999);
    if (r.error) throw r.error;
    sales.push(...r.data);
    if (r.data.length < 1000) break;
  }
  if (cloudUser?.id !== user.id) return;
  cloudSales = sales;
  state.items = catalog.items;
  revision = catalog.revision;
  archivedYears = results[1].data;
  state.days = {};
  for (const sale of sales) {
    if (archivedYears.some(y => y.year === Number(sale.business_date.slice(0, 4)))) continue;
    const day = state.days[sale.business_date] ||= {
      count: 0,
      total: 0,
      items: {}
    };
    day.count += sale.receipt_count;
    day.total += Number(sale.total_cents);
    for (const line of sale.lines) {
      const key = JSON.stringify([line.name, line.label, line.category]);
      const row = day.items[key] ||= {
        name: line.name,
        label: line.label,
        category: line.category,
        qty: 0,
        total: 0
      };
      row.qty += line.qty;
      row.total += line.total ?? line.qty * line.price;
    }
  }
}

async function saveCatalog(items) {
  if (cloudBusy || !cloudUser) return false;
  cloudBusy = true;
  try {
    const r = await db.from('pau_kasse_catalog').update({
        items,
        revision: revision + 1,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', cloudUser.workspace_id || cloudUser.id).eq('revision', revision).select('revision');
    if (r.error) throw r.error;
    if (!r.data.length) throw Error('Die Artikel wurden auf einem anderen Gerät geändert. Bitte abbrechen und neu laden.');
    state.items = items;
    revision = r.data[0].revision;
    return true;
  } catch (error) {
    toast(message(error));
    return false;
  } finally {
    cloudBusy = false;
  }
}

async function openAccount(user) {
  const generation = ++authGeneration;
  cloudUser = user;
  draft = null;
  view = 'sale';
  Object.keys(wineFilters).forEach(field => wineFilters[field] = '');
  pendingSale = null;
  state = {
    ...defaults(),
    pin: legacy.pin || '1234'
  };
  if (!user) {
    loginScreen();
    return;
  }
  main.innerHTML = '<p class="empty">Gespeicherte Daten werden geladen …</p>';
  document.querySelector('nav').hidden = true;
  account.innerHTML = `<span>${esc(user.email || '')}</span><button data-reload>Aktualisieren</button><button data-logout>Abmelden</button>`;
  try {
    const saved = JSON.parse(localStorage.getItem(deviceKey()) || 'null');
    if (saved) {
      state.cart = saved.cart || [];
      state.reference = saved.reference || '';
      state.pin = /^\d{4}$/.test(saved.pin) ? saved.pin : '1234';
      pendingSale = saved.pendingSale || null;
    }
    if (pendingSale) state.cart = structuredClone(pendingSale.lines);
    const r = await db.from('pau_kasse_catalog').select('user_id').eq('user_id', user.workspace_id || user.id).maybeSingle();
    if (r.error) throw r.error;
    if (generation !== authGeneration) return;
    if (!r.data) {
      main.innerHTML = `<section class="panel login"><h1>Artikel einrichten</h1><p>Welche Artikel sollen für diese Kasse verwendet werden?</p><button class="primary wide" data-initialize="legacy">Artikel und Preise dieses Geräts übernehmen</button><button class="wide" data-initialize="defaults">Mit Grundvorlage starten</button><p class="note">Tageszahlen können anschließend separat importiert werden.</p></section>`;
      return;
    }
    await refreshCloud();
    if (generation !== authGeneration) return;
    document.querySelector('nav').hidden = false;
    render();
  } catch (error) {
    if (generation !== authGeneration) return;
    main.innerHTML = `<section class="panel"><h1>Daten konnten nicht geladen werden</h1><p>${esc(message(error))}</p><p>Bitte die zusätzliche SQL-Datei aus dem Download ausführen und anschließend „Aktualisieren“ drücken.</p></section>`;
  }
}

function yearData(year) {
  const archive = archivedYears.find(x => x.year === year);
  if (archive) return {
    summary: archive.summary,
    closed: true
  };
  const days = Object.entries(state.days).filter(([date]) => Number(date.slice(0, 4)) === year);
  return {
    closed: false,
    summary: {
      year,
      total: days.reduce((s, [, d]) => s + d.total, 0),
      count: days.reduce((s, [, d]) => s + d.count, 0),
      sales: days.map(([date, d]) => ({
        date,
        lines: Object.values(d.items),
        total: d.total,
        count: d.count
      }))
    }
  };
}
let chosenYear = Number(today().slice(0, 4));

function renderYear() {
  const years = [...new Set([Number(today().slice(0, 4)), ...Object.keys(state.days).map(d => Number(d.slice(0, 4))), ...archivedYears.map(x => x.year)])].sort((a, b) => b - a);
  const {
    summary,
    closed
  } = yearData(chosenYear);
  const days = {};
  for (const sale of summary.sales) {
    const d = days[sale.date] ||= {
      total: 0,
      count: 0
    };
    d.total += sale.total;
    d.count += sale.count;
  }
  main.innerHTML = `<div class="page-top"><div><h1>Jahresübersicht</h1><p class="sub">${closed?'Abgeschlossen · Archiv':'Laufendes Jahr'}</p></div><label>Jahr<select id="year-select">${years.map(y=>`<option ${y===chosenYear?'selected':''}>${y}</option>`).join('')}</select></label></div>
    <div class="stats"><div class="stat"><span>Jahresumsatz</span><b>${money(summary.total)}</b></div><div class="stat"><span>Abrechnungen</span><b>${summary.count}</b></div></div>
    <section class="panel"><h2>Tageszahlen</h2><table><thead><tr><th>Datum</th><th>Abrechnungen</th><th>Umsatz</th></tr></thead><tbody>${Object.entries(days).sort().map(([date,d])=>`<tr><td>${date}</td><td>${d.count}</td><td>${money(d.total)}</td></tr>`).join('')||'<tr><td colspan="3">Noch keine Verkäufe</td></tr>'}</tbody></table><div class="actions"><button data-export-year>Jahr herunterladen</button>${closed?'':'<button class="danger" data-close-year>Jahr abschließen</button>'}</div><p class="note">Beim Abschluss bleiben alle Verkäufe im Archiv erhalten. Artikel und Preise bleiben bestehen. Ein abgeschlossenes Jahr nimmt keine weiteren Verkäufe an; ab Januar beginnt das neue Jahr bei null.</p></section>
    ${Object.keys(legacy.days).length?'<section class="panel"><h2>Bisherige Gerätedaten</h2><p>Vor der Umstellung gespeicherte Tageszahlen dieses Geräts übernehmen. Dieselben Verkäufe bitte nur von einem Gerät importieren.</p><button data-import>Alte Tageszahlen importieren</button></section>':''}`;
}

function downloadJSON(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json'
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
account.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || cloudBusy) return;
  if (b.hasAttribute('data-reload')) await openAccount(cloudUser);
  if (b.hasAttribute('data-logout')) {
    if (draft && !await ask('Abmelden?', 'Nicht gespeicherte Artikeländerungen werden verworfen.')) return;
    save();
    const {
      error
    } = await db.auth.signOut({
      scope: 'local'
    });
    if (error) toast(message(error));
  }
});
main.addEventListener('change', e => {
  if (e.target.id === 'year-select') {
    chosenYear = Number(e.target.value);
    renderYear();
  }
});
main.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || cloudBusy || !cloudUser) return;
  try {
    if (b.dataset.initialize) {
      cloudBusy = true;
      const items = b.dataset.initialize === 'legacy' ? legacy.items : defaults().items;
      const {
        error
      } = await db.from('pau_kasse_catalog').insert({
        user_id: cloudUser.workspace_id || cloudUser.id,
        items
      });
      if (error) throw error;
      await openAccount(cloudUser);
    }
    if (b.hasAttribute('data-export-year')) downloadJSON('PAU-MAYA-' + chosenYear + '.json', yearData(chosenYear).summary);
    if (b.hasAttribute('data-close-year')) {
      if (!await unlockSettings()) return;
      if (!await ask('Jahr ' + chosenYear + ' abschließen?', 'Alle Zahlen werden archiviert. Danach sind für dieses Jahr keine weiteren Verkäufe oder Importe möglich. Artikel und Preise bleiben erhalten.', 'Jahr abschließen')) return;
      cloudBusy = true;
      const {
        error
      } = await db.rpc('pau_kasse_close_year', {
        p_year: chosenYear
      });
      if (error) throw error;
      await refreshCloud();
      render();
      toast('Jahr abgeschlossen und archiviert.');
    }
    if (b.hasAttribute('data-import')) {
      if (!await unlockSettings()) return;
      if (!await ask('Alte Tageszahlen übernehmen?', 'Nur importieren, wenn diese Verkäufe noch nicht von einem anderen Gerät übernommen wurden. Wiederholungen von diesem Gerät werden erkannt.', 'Importieren')) return;
      cloudBusy = true;
      const key = 'pau-kasse-import-source';
      let source = localStorage.getItem(key);
      if (!source) {
        source = uid();
        localStorage.setItem(key, source);
      }
      const days = Object.fromEntries(Object.entries(legacy.days).filter(([, d]) => d.count > 0));
      const {
        data,
        error
      } = await db.rpc('pau_kasse_import', {
        p_source: source,
        p_days: days
      });
      if (error) throw error;
      await refreshCloud();
      render();
      toast(data + ' Tagesübersichten übernommen.');
    }
  } catch (error) {
    toast(message(error));
  } finally {
    cloudBusy = false;
  }
});

if (!db) loginScreen('Anmeldedienst nicht geladen. Bitte Internetverbindung prüfen und neu laden.');
else {
  let currentAuthId;
  db.auth.onAuthStateChange((event, session) => {
    const next = session?.user?.id || null;
    if (next === currentAuthId) return;
    currentAuthId = next;
    // Supabase callback remains synchronous; database requests run outside it.
    setTimeout(() => openAccount(session?.user || null), 0);
  });
}
