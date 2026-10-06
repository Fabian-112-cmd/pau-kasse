'use strict';

// Speicherung und Ausgangsartikel
const KEY = 'bader-pau-kasse-v1';
const WINE_SIZES = ['Wein 0,1 l', 'Wein 0,2 l', 'Schorle 0,25 l', 'Schorle 0,5 l', 'Flasche 0,75 l', 'Flasche 1,0 l'];
const DRINK_SIZES = ['0,25 l', '0,5 l'];
const FOOD_NAMES = ['Fleischknöpfe mit Sauerkraut und Brot', 'Leberknödel mit Specksoße und Brot',
  'Saumagen mit Sauerkraut und Brot', 'Rebknorzenspieß mit Kartoffelsalat', 'Schafskäse mit Brot',
  'Hausmacher Teller', 'Schmalzbrot', 'Seelachsfilet paniert mit Kartoffelsalat',
  'Flammkuchen Elsässer', 'Flammkuchen mit Käse', 'Flammkuchen mit Spezialkäse'
];
const defaults = () => ({
  items: [...Array.from({
    length: 15
  }, (_, i) => ({
    id: 'w' + i,
    category: 'wine',
    name: 'Wein ' + (i + 1),
    variants: WINE_SIZES.map((label, j) => ({
      label,
      price: [320, 500, 370, 580][j] ?? null
    }))
  })), ...['Cola', 'Fanta', 'Sprite', 'Traubensaft rot – Schorle',
    'Traubensaft weiß – Schorle'
  ].map((name, i) => ({
    id: 'd' + i,
    category: 'drink',
    name,
    variants: DRINK_SIZES.map((label, j) => ({
      label,
      price: [280, 450][j]
    }))
  })), ...FOOD_NAMES.map((name, i) => ({
    id: 'f' + i,
    category: 'food',
    name,
    variants: [{
      label: 'Portion',
      price: [1150, 1150, 1150, 1650, 850, 790, 350, 1450, 1050, 1050, 1250][i]
    }]
  }))],
  days: {},
  cart: [],
  reference: ''
});
let state;
let storageOK = true;
try {
  state = JSON.parse(localStorage.getItem(KEY)) || defaults();
  if (!Array.isArray(state.items) || !state.days || !Array.isArray(state.cart)) throw Error();
} catch {
  state = defaults();
}
let view = 'sale',
  category = 'wine',
  editCategory = 'wine',
  draft = null,
  selectedDate = today();
const main = document.querySelector('#main');
if (!/^\d{4}$/.test(state.pin || '')) state.pin = '1234';


// Datum, Beträge und Hilfsfunktionen
function today() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}
const money = n => new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR'
}).format(n / 100);
const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
} [c]));
const uid = () => crypto.randomUUID();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageOK = true;
    return true;
  } catch {
    storageOK = false;
    toast('Speichern nicht möglich. Bitte Browser-Speicher prüfen.');
    return false;
  }
}
let toastTimer;

function toast(text) {
  const el = document.querySelector('#toast');
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.style.display = 'none', 3500);
}
async function ask(title, text, button = 'Bestätigen') {
  const d = document.querySelector('#confirm');
  document.querySelector('#dialog-title').textContent = title;
  document.querySelector('#dialog-text').textContent = text;
  document.querySelector('#confirm-button').textContent = button;
  return new Promise(resolve => {
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), {
      once: true
    });
    d.showModal();
  });
}

function total() {
  return state.cart.reduce((a, c) => a + c.price * c.qty, 0);
}
const tabNames = {
  wine: 'Weine',
  drink: 'Alkoholfrei',
  food: 'Essen'
};

function tabs(active, attr) {
  return '<div class="tabs">' + Object.entries(tabNames).map(([k, v]) =>
    `<button class="${active===k?'active':''}" ${attr}="${k}">${v}</button>`).join('') + '</div>';
}

// Weinmerkmale: bestehende Artikel bleiben bis zur Zuordnung neutral.
const WINE_FIELDS = {
  wineType: {
    label: 'Weinart',
    values: {
      white: 'Weißwein',
      rose: 'Rosé',
      red: 'Rotwein',
      spritzer: 'Schorle'
    }
  },
  sweetness: {
    label: 'Geschmack',
    values: {
      dry: 'Trocken',
      medium: 'Halbtrocken',
      sweet: 'Lieblich',
      verySweet: 'Süß'
    }
  },
  cultivation: {
    label: 'Anbau',
    values: {
      organic: 'Bio',
      conventional: 'Normal'
    }
  }
};
const wineFilters = {
  wineType: '',
  sweetness: '',
  cultivation: ''
};

function effectiveWineType(item) {
  const visible = item.variants.filter(v => v.price !== null);
  return item.wineType === 'spritzer' || (visible.length && visible.every(v => /schorle/i.test(v.label))) ? 'spritzer' : item.wineType;
}
function wineFieldValue(item, field) {
  return field === 'wineType' ? effectiveWineType(item) : item[field];
}
function addBottleFields(items) {
  for (const item of items.filter(x => x.category === 'wine')) {
    for (const label of WINE_SIZES.slice(4)) {
      const size = label.includes('0,75') ? /0[,.]75\s*l/i : /(?:^|\s)1(?:[,.]0)?\s*l/i;
      if (!item.variants.some(v => size.test(v.label))) item.variants.push({label, price:null});
    }
  }
}
function wineMatches(item) {
  return Object.entries(wineFilters).every(([field, value]) => !value || wineFieldValue(item, field) === value);
}

function wineFilterControls() {
  const available = state.items.filter(x => x.category === 'wine' && x.variants.some(v => v.price !== null));
  // If articles changed, remove a filter whose group no longer exists.
  for (const field of Object.keys(WINE_FIELDS)) {
    if (wineFilters[field] && !available.some(x => wineFieldValue(x, field) === wineFilters[field])) wineFilters[field] = '';
  }
  return '<div class="wine-filters">' + Object.entries(WINE_FIELDS).map(([field, spec]) =>
      `<label>${spec.label}<select data-wine-filter="${field}"><option value="">Alle</option>${Object.entries(spec.values).filter(([value]) => available.some(x => wineFieldValue(x, field) === value)).map(([value,label]) => `<option value="${value}" ${wineFilters[field]===value?'selected':''}>${label}</option>`).join('')}</select></label>`).join('') +
    '<button class="text-button" data-clear-wine-filters>Alle Weine anzeigen</button></div>';
}

function wineBadges(item) {
  const labels = item.cultivation === 'organic' ? ['Bio'] : [];
  if (item.alcoholFree) labels.push('Alkoholfrei');
  return '<div class="wine-badges">' + labels.map(label => `<span>${esc(label)}</span>`).join('') + '</div>';
}

function wineEditor(item) {
  if (item.category !== 'wine') return '';
  return '<div class="wine-editor">' + Object.entries(WINE_FIELDS).map(([field, spec]) =>
      `<label>${spec.label}<select data-wine-field="${field}" data-wine-id="${esc(item.id)}"><option value="">Noch nicht zugeordnet</option>${Object.entries(spec.values).map(([value,label]) => `<option value="${value}" ${item[field]===value?'selected':''}>${label}</option>`).join('')}</select></label>`).join('') +
    `<label class="wine-checkbox"><input type="checkbox" data-alcohol-free="${esc(item.id)}" ${item.alcoholFree?'checked':''}> Alkoholfreier Wein</label></div>`;
}

// Kompakte Weinkacheln unter gemeinsamen Gruppenüberschriften.
function wineNameHtml(name) {
  // Kurze Zusätze wie -S- bleiben beim Zeilenumbruch zusammen.
  return esc(name).replace(/-\s*([A-Za-zÄÖÜäöüß]{1,4})\s*-/g, '<span class="wine-name-suffix">-$1-</span>');
}
function catalogCard(item, number) {
  return `<article class="item"><div class="item-top"><span class="number">${String(number).padStart(2,'0')}</span><h3>${item.category==='wine'?wineNameHtml(item.name)+wineBadges(item):esc(item.name)}</h3></div><div class="sizes">${item.variants.map((variant,index)=>variant.price===null?'':`<button data-add="${esc(item.id)}" data-variant="${index}" aria-label="${esc(item.name+' '+variant.label+' hinzufügen')}"><span>${esc(variant.label)}</span><b>${money(variant.price)}</b></button>`).join('')}</div></article>`;
}
function wineGroups(items) {
  const types = ['white','rose','red',''];
  const tastes = ['dry','medium','sweet','verySweet',''];
  const groups = [];
  const schorle = items.filter(item => effectiveWineType(item) === 'spritzer');
  if (schorle.length) groups.push({title: 'Schorle', items: schorle});
  const wines = items.filter(item => !schorle.includes(item));
  for (const type of types) {
    for (const taste of tastes) {
      const rows = wines.filter(item =>
        (WINE_FIELDS.wineType.values[item.wineType] ? item.wineType : '') === type &&
        (WINE_FIELDS.sweetness.values[item.sweetness] ? item.sweetness : '') === taste);
      if (!rows.length) continue;
      const title = [WINE_FIELDS.wineType.values[type] || 'Weitere Weine', WINE_FIELDS.sweetness.values[taste]].filter(Boolean).join(' · ');
      groups.push({title, items:rows});
    }
  }
  return groups;
}
function catalogContent(items) {
  if (!items.length) return '<div class="empty">Keine passenden Artikel. Prüfe die Weinfilter oder trage unter „Artikel & Preise“ Preise ein.</div>';
  if (category !== 'wine') return '<div class="catalog">' + items.map((item,index)=>catalogCard(item,index+1)).join('') + '</div>';
  return '<div class="wine-groups">' + wineGroups(items).map(group =>
    `<section class="wine-group"><h2 class="wine-group-title">${esc(group.title)}</h2><div class="catalog">${group.items.map(item=>catalogCard(item,items.indexOf(item)+1)).join('')}</div></section>`).join('') + '</div>';
}

// Ansichten anzeigen
function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset
    .view === view));
  if (view === 'sale') renderSale();
  else if (view === 'day') renderDay();
  else if (view === 'year') renderYear();
  else renderSettings();
}

// Abrechnung und Artikelauswahl
function renderSale() {
  const filters = category === 'wine' ? wineFilterControls() : '';
  const items = state.items.filter(x => x.category === category && x.variants.some(v => v.price !== null) && (category !== 'wine' || wineMatches(x)));
  main.innerHTML =
    `<div class="page-top"><div><h1>Abrechnen</h1><p class="sub">Artikel antippen · Menge korrigieren · Abschließen</p></div></div><div class="work"><section>${tabs(category,'data-cat')}${filters}${catalogContent(items)}</section><aside class="receipt" id="receipt"><div class="receipt-head"><h2>Aktuelle Rechnung</h2><span class="chip">${state.cart.reduce((s,c)=>s+c.qty,0)} Artikel</span></div><label for="reference">Tisch / Person (optional)</label><input id="reference" placeholder="z. B. Tisch 4 · Person 2" value="${esc(state.reference)}"><div class="receipt-list">${state.cart.map((c,i)=>`<div class="line"><div class="line-title"><strong>${esc(c.name)}</strong><b>${money(c.price*c.qty)}</b></div><small>${esc(c.label)} · ${money(c.price)} je Stück</small><div class="quantity"><button data-qty="${i}" data-change="-1" aria-label="${esc(c.name)} verringern">−</button><span>${c.qty}</span><button data-qty="${i}" data-change="1" aria-label="${esc(c.name)} erhöhen">+</button></div></div>`).join('')||'<div class="empty">Noch keine Artikel.<br>Wähle links Getränke oder Essen aus.</div>'}</div><div class="total"><span>Gesamt</span><b>${money(total())}</b></div><button class="primary wide" data-checkout ${state.cart.length?'':'disabled'}>Abrechnung abschließen</button><button class="text-button" data-clear ${state.cart.length?'':'disabled'}>Rechnung verwerfen</button><p class="note">Abgeschlossene Artikel zählen zur Tagesübersicht. Die Tisch- oder Personenangabe wird dabei nicht aufbewahrt.</p></aside></div><div class="mobile-total"><div><small>Aktuelle Rechnung</small><b>${money(total())}</b></div><button data-receipt>Rechnung ansehen (${state.cart.reduce((s,c)=>s+c.qty,0)})</button></div>`;
}

// Tagesübersicht
function renderDay() {
  const day = state.days[selectedDate] || {
    count: 0,
    total: 0,
    items: {}
  };
  const rows = Object.values(day.items).sort((a, b) => a.name.localeCompare(b.name, 'de') || a.label
    .localeCompare(b.label));
  const food = rows.filter(x => x.category === 'food').reduce((s, x) => s + x.qty, 0);
  const drinks = rows.filter(x => x.category !== 'food').reduce((s, x) => s + x.qty, 0);
  main.innerHTML =
    `<div class="page-top"><div><h1>Tagesübersicht</h1><p class="sub">Gemeinsam gespeicherte Verkäufe</p></div><label>Datum<input class="date-input" type="date" id="day-date" value="${selectedDate}"></label></div><div class="stats"><div class="stat"><span>Tagesumsatz</span><b>${money(day.total)}</b></div><div class="stat"><span>Abrechnungen</span><b>${day.count}</b></div><div class="stat"><span>Getränke / Essen</span><b>${drinks} / ${food}</b></div></div><div class="panel"><h2>Verkaufte Artikel</h2><div class="table-wrap"><table><thead><tr><th>Artikel</th><th>Größe</th><th class="right">Anzahl</th><th class="right">Umsatz</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.label)}</td><td class="right">${x.qty}</td><td class="right">${money(x.total)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Für diesen Tag liegen noch keine Abrechnungen vor.</td></tr>'}</tbody></table></div><div class="actions"><button data-export ${rows.length?'':'disabled'}>Tagesübersicht herunterladen</button></div></div><p class="note">Verkäufe und Artikel werden nach erfolgreicher Speicherung zentral aufbewahrt. Mit derselben Anmeldung sind sie auf allen Geräten verfügbar.</p>`;
}

// Artikel und Preise bearbeiten
function renderSettings() {
  if (!draft) {
    draft = structuredClone(state.items);
    addBottleFields(draft);
  }
  const items = draft.filter(x => x.category === editCategory);
  main.innerHTML =
    `<div class="page-top"><div><h1>Artikel & Preise</h1><p class="sub">Namen, Größen und Preise selbst bearbeiten</p></div></div><div class="notice"><strong>Grundvorlage mit Beispielpreisen.</strong> Bitte vor der Nutzung eure Preise eintragen. Leeres Preisfeld = diese Größe wird in der Auswahl ausgeblendet. Preise gelten in Euro.</div>${tabs(editCategory,'data-edit-cat')}<div class="panel"><div class="page-top"><h2>${tabNames[editCategory]} (${items.length})</h2><button data-new class="primary">+ Artikel hinzufügen</button></div><div class="editor">${items.map((it,i)=>`<div class="settings-row ${editCategory}"><span class="number">${i+1}</span><label>Artikelname<input data-name="${esc(it.id)}" value="${esc(it.name)}" placeholder="Artikelname"></label><div class="variant-editor">${it.variants.map((v,j)=>`<label>${esc(v.label)}<input type="text" inputmode="decimal" data-price="${esc(it.id)}" data-variant="${j}" value="${v.price===null?'':(v.price/100).toFixed(2).replace('.',',')}" placeholder="ausgeblendet" aria-label="Preis ${esc(it.name+' '+v.label)}"></label>`).join('')}</div>${wineEditor(it)}<div style="grid-column:2/-1;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end"><button data-move="${esc(it.id)}" data-direction="-1" ${i===0?'disabled':''}>Nach oben</button><button data-move="${esc(it.id)}" data-direction="1" ${i===items.length-1?'disabled':''}>Nach unten</button><button class="text-button" data-sizes="${esc(it.id)}">Größen bearbeiten</button><button class="text-button danger" data-delete="${esc(it.id)}">Artikel löschen</button></div></div>`).join('')||'<p class="empty">Noch keine Artikel. Füge deinen ersten Artikel hinzu.</p>'}</div></div><div class="sticky-save"><button data-change-pin>PIN ändern</button><button data-cancel-settings>Abbrechen</button><button class="primary" data-save-settings>Änderungen speichern</button></div>`;
}

// Eingaben prüfen
function readEditor() {
  let valid = true;
  document.querySelectorAll('[data-wine-field]').forEach(el => {
    const item = draft.find(x => x.id === el.dataset.wineId);
    if (item) item[el.dataset.wineField] = el.value;
  });
  document.querySelectorAll('[data-alcohol-free]').forEach(el => {
    const item = draft.find(x => x.id === el.dataset.alcoholFree);
    if (item) item.alcoholFree = el.checked;
  });
  document.querySelectorAll('[data-name]').forEach(el => {
    draft.find(x => x.id === el.dataset.name).name = el.value.trim();
    el.removeAttribute('aria-invalid');
    if (!el.value.trim()) {
      valid = false;
      el.setAttribute('aria-invalid', 'true');
    }
  });
  document.querySelectorAll('[data-price]').forEach(el => {
    const it = draft.find(x => x.id === el.dataset.price),
      v = el.value.trim();
    el.removeAttribute('aria-invalid');
    if (v === '') {
      it.variants[Number(el.dataset.variant)].price = null;
      return;
    }
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(v)) {
      valid = false;
      el.setAttribute('aria-invalid', 'true');
      return;
    }
    const n = Math.round(Number(v.replace(',', '.')) * 100);
    if (!Number.isSafeInteger(n) || n < 0 || n > 9999999) {
      valid = false;
      el.setAttribute('aria-invalid', 'true');
      return;
    }
    it.variants[Number(el.dataset.variant)].price = n;
  });
  return valid;
}

// Abrechnung abschließen
async function checkout() {
  if (!cloudUser || cloudBusy || !state.cart.length) return;
  const lines = structuredClone(state.cart);
  const amount = total();
  if (!await ask('Abrechnung abschließen?', `${money(amount)} zentral speichern?`, 'Abschließen')) return;
  cloudBusy = true;
  const button = main.querySelector('[data-checkout]');
  if (button) button.disabled = true;
  try {
    if (!pendingSale) pendingSale = {
      id: uid(),
      lines
    };
    persistDevice();
    const {
      error
    } = await db.rpc('pau_kasse_checkout', {
      p_id: pendingSale.id,
      p_lines: pendingSale.lines
    });
    if (error) throw error;
    pendingSale = null;
    state.cart = [];
    state.reference = '';
    save();
    await refreshCloud();
    render();
    toast(`Gespeichert · ${money(amount)}`);
  } catch (error) {
    toast('Speicherung nicht bestätigt: ' + error.message + '. Bitte erneut abschließen.');
  } finally {
    cloudBusy = false;
    if (button?.isConnected) button.disabled = false;
  }
}

// Bedienung und Schaltflächen
main.addEventListener('input', e => {
  if (e.target.id === 'reference') {
    state.reference = e.target.value;
    save();
  }
});
main.addEventListener('change', e => {
  if (e.target.dataset.wineFilter) {
    wineFilters[e.target.dataset.wineFilter] = e.target.value;
    renderSale();
  }
  if (e.target.id === 'day-date') {
    selectedDate = e.target.value || today();
    renderDay();
  }
});
main.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || b.disabled || cloudBusy) return;
  if (pendingSale && (b.dataset.add || b.dataset.qty !== undefined || b.hasAttribute('data-clear'))) {
    toast('Bitte die noch unbestätigte Rechnung erneut abschließen.');
    return;
  }
  if (b.hasAttribute('data-clear-wine-filters')) {
    Object.keys(wineFilters).forEach(field => wineFilters[field] = '');
    renderSale();
  }
  if (b.dataset.cat) {
    category = b.dataset.cat;
    renderSale();
  }
  if (b.dataset.add) {
    const it = state.items.find(x => x.id === b.dataset.add);
    const v = it.variants[Number(b.dataset.variant)];
    const key = it.id + '|' + v.label + '|' + v.price + '|' + it.name;
    const row = state.cart.find(x => x.key === key);
    if (row) row.qty++;
    else state.cart.push({
      key,
      id: it.id,
      name: it.name,
      label: v.label,
      price: v.price,
      category: it.category,
      qty: 1
    });
    save();
    renderSale();
  }
  if (b.dataset.qty !== undefined) {
    const i = Number(b.dataset.qty);
    state.cart[i].qty += Number(b.dataset.change);
    if (state.cart[i].qty <= 0) state.cart.splice(i, 1);
    save();
    renderSale();
  }
  if (b.hasAttribute('data-checkout')) await checkout();
  if (b.hasAttribute('data-clear') && await ask('Rechnung verwerfen?',
      'Die aktuelle Eingabe wird geleert. Die Tagesübersicht bleibt erhalten.', 'Verwerfen'
    )) {
    state.cart = [];
    state.reference = '';
    save();
    renderSale();
  }
  if (b.hasAttribute('data-receipt')) document.querySelector('#receipt').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
  if (b.dataset.editCat) {
    if (!readEditor()) {
      toast('Bitte gültige Preise und Artikelnamen eintragen.');
      return;
    }
    editCategory = b.dataset.editCat;
    renderSettings();
  }
  if (b.hasAttribute('data-new')) {
    if (!readEditor()) {
      toast('Bitte gültige Preise und Artikelnamen eintragen.');
      return;
    }
    draft.push({
      id: uid(),
      name: editCategory === 'wine' ? 'Neuer Wein' : editCategory === 'drink' ?
        'Neues Getränk' : 'Neues Essen',
      category: editCategory,
      variants: (editCategory === 'wine' ? WINE_SIZES : editCategory === 'drink' ?
        DRINK_SIZES : ['Portion']).map(label => ({
        label,
        price: null
      }))
    });
    renderSettings();
    main.querySelector('.settings-row:last-child input')?.focus();
  }
  if (b.dataset.delete) {
    if (!readEditor()) {
      toast('Bitte Eingaben prüfen.');
      return;
    }
    const it = draft.find(x => x.id === b.dataset.delete);
    if (await ask('Artikel löschen?',
        `„${it.name}“ wird aus der Auswahl entfernt. Bereits erfasste Tageszahlen bleiben erhalten.`,
        'Löschen')) {
      draft = draft.filter(x => x.id !== it.id);
      renderSettings();
    }
  }
  if (b.dataset.move) {
    if (!readEditor()) {
      toast('Bitte Eingaben prüfen.');
      return;
    }
    moveItem(b.dataset.move, Number(b.dataset.direction));
    renderSettings();
  }
  if (b.dataset.sizes) {
    if (!readEditor()) {
      toast('Bitte Eingaben prüfen.');
      return;
    }
    const it = draft.find(x => x.id === b.dataset.sizes);
    const next = prompt(
      'Größen / Varianten mit Semikolon trennen. Bestehende Preise bleiben nach Position erhalten.',
      it.variants.map(v => v.label).join('; '));
    if (next !== null) {
      const labels = next.split(';').map(x => x.trim()).filter(Boolean);
      if (!labels.length || labels.length > 8 || new Set(labels).size !== labels.length) {
        toast('Bitte 1 bis 8 unterschiedliche Größen eintragen.');
        return;
      }
      it.variants = labels.map((label, i) => ({
        label,
        price: it.variants[i]?.price ?? null
      }));
      renderSettings();
    }
  }
  if (b.hasAttribute('data-change-pin')) {
    const next = await pinPrompt('Neuen PIN festlegen', 'Bitte vier Ziffern eingeben.');
    if (next === null) return;
    const again = await pinPrompt('PIN wiederholen',
      'Neuen PIN zur Bestätigung erneut eingeben.');
    if (again !== next) {
      toast('Die PINs stimmen nicht überein.');
      return;
    }
    const previous = state.pin;
    state.pin = next;
    if (save()) toast('PIN geändert.');
    else state.pin = previous;
  }
  if (b.hasAttribute('data-save-settings')) {
    if (!readEditor()) {
      toast('Bitte Artikelnamen und Preise prüfen (z. B. 3,50).');
      return;
    }
    if (await saveCatalog(structuredClone(draft))) {
      draft = null;
      view = 'sale';
      render();
      toast('Artikel und Preise gespeichert.');
    }
  }
  if (b.hasAttribute('data-cancel-settings')) {
    draft = null;
    view = 'sale';
    render();
  }
  if (b.hasAttribute('data-reset-day') && await ask('Tagesübersicht zurücksetzen?',
      `Alle Tageszahlen vom ${selectedDate} werden auf diesem Gerät gelöscht.`, 'Zurücksetzen'
    )) {
    const previous = state.days[selectedDate];
    delete state.days[selectedDate];
    if (save()) {
      renderDay();
      toast('Tagesübersicht zurückgesetzt.');
    } else state.days[selectedDate] = previous;
  }
  if (b.hasAttribute('data-export')) {
    const day = state.days[selectedDate];
    const cell = x => '"' + String(x).replace(/"/g, '""') + '"';
    const rows = [
      ['Datum', selectedDate],
      ['Tagesumsatz EUR', (day.total / 100).toFixed(2).replace('.', ',')],
      ['Abrechnungen', day.count],
      [],
      ['Artikel', 'Größe', 'Anzahl', 'Umsatz EUR'], ...Object.values(day.items).map(x => [x
        .name, x.label, x.qty, (x.total / 100).toFixed(2).replace('.', ',')
      ])
    ];
    const blob = new Blob(['\ufeff' + rows.map(r => r.map(cell).join(';')).join('\r\n')], {
      type: 'text/csv;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Bader-PAU-' + selectedDate + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
});

// Navigation mit PIN-Schutz
document.querySelector('nav').addEventListener('click', async e => {
  const b = e.target.closest('[data-view]');
  if (!b || !cloudUser) return;
  if (b.dataset.view === 'settings' && view !== 'settings' && !await unlockSettings()) return;
  if (view === 'settings' && b.dataset.view !== 'settings' && draft) {
    if (!await ask('Bearbeitung verlassen?',
        'Nicht gespeicherte Änderungen werden verworfen.', 'Verlassen')) return;
    draft = null;
  }
  view = b.dataset.view;
  if (view === 'day') selectedDate = today();
  if (view === 'day' || view === 'year') {
    try {
      await refreshCloud();
    } catch (error) {
      toast(error.message);
      return;
    }
  }
  render();
  window.scrollTo(0, 0);
});
// Start erfolgt nach Prüfung der Anmeldung in cloud.js.


// Artikelreihenfolge
function moveItem(id, direction) {
  const index = draft.findIndex(x => x.id === id);
  if (index < 0) return;
  const cat = draft[index].category;
  const indices = draft.map((x, i) => x.category === cat ? i : -1).filter(i => i >= 0);
  const position = indices.indexOf(index),
    target = indices[position + direction];
  if (target === undefined) return;
  [draft[index], draft[target]] = [draft[target], draft[index]];
}


// PIN-Eingabe
async function pinPrompt(title, message) {
  const d = document.createElement('dialog');
  d.innerHTML =
    `<form><h2>${esc(title)}</h2><p>${esc(message)}</p><label>Vierstelliger PIN<input type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" required autocomplete="off" style="width:100%;margin-top:8px;font-size:24px;letter-spacing:.3em"></label><div class="dialog-actions"><button type="button" data-pin-cancel>Abbrechen</button><button type="submit" class="primary">Bestätigen</button></div></form>`;
  document.body.appendChild(d);
  return new Promise(resolve => {
    let result = null;
    const input = d.querySelector('input');
    input.addEventListener('input', () => input.value = input.value.replace(/[^0-9]/g, ''));
    d.querySelector('[data-pin-cancel]').addEventListener('click', () => d.close());
    d.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      if (/^\d{4}$/.test(input.value)) {
        result = input.value;
        d.close();
      }
    });
    d.addEventListener('close', () => {
      d.remove();
      resolve(result);
    }, {
      once: true
    });
    d.showModal();
    input.focus();
  });
}

// PIN prüfen
async function unlockSettings() {
  const pin = await pinPrompt('Artikel & Preise entsperren',
    'Zum Bearbeiten bitte den vierstelligen PIN eingeben.');
  if (pin === null) return false;
  if (pin !== state.pin) {
    toast('PIN ist nicht richtig.');
    return false;
  }
  return true;
}
