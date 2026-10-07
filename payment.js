'use strict';
// Zahlungen und getrennte, serverseitig festgelegte Benutzerbereiche.
let depositKinds=[{name:'Pfand 1',price:0},{name:'Pfand 2',price:0}];
function blankPayment(){return {method:'cash',tip:0,tender:null,deposits:depositKinds.map(x=>({name:x.name,rate:x.price,issued:0,returned:0}))};}
let paymentDraft=blankPayment(),directPayment=blankPayment(),paymentBoot=0;
async function resolveLoginEmail(name){
  if(name.includes('@'))return name;
  const result=await db.rpc('pau_kasse_login_email',{p_name:name});
  if(result.error)throw result.error;if(!result.data)throw Error('Benutzername oder Passwort stimmt nicht.');return result.data;
}
const paymentDeviceBase=persistDevice;
persistDevice=function(){paymentDeviceBase();if(cloudUser)localStorage.setItem(deviceKey()+'-payment',JSON.stringify({paymentDraft,directPayment}));};
const paymentOpenBase=openAccount;
openAccount=async function(user){
  const generation=++paymentBoot;
  if(user){
    const result=await db.rpc('pau_kasse_profile');
    if(generation!==paymentBoot)return;
    if(result.error){cloudUser=null;loginScreen('Benutzereinrichtung fehlt: Bitte zuerst die neue SQL-Datei ausführen.');return;}
    user={...user,...result.data};
    const r=await db.from('pau_kasse_deposits').select('*').eq('user_id',user.workspace_id).maybeSingle();
    if(generation!==paymentBoot)return;
    if(r.error){cloudUser=null;loginScreen(message(r.error));return;}
    depositKinds=r.data?.kinds||[{name:'Pfand 1',price:0},{name:'Pfand 2',price:0}];
    paymentDraft=blankPayment();directPayment=blankPayment();
    try{const saved=JSON.parse(localStorage.getItem('pau-kasse-device-'+user.id+'-payment')||'null');if(saved){paymentDraft=saved.paymentDraft;directPayment=saved.directPayment||blankPayment();}}catch{}
  }
  if(generation!==paymentBoot)return;
  await paymentOpenBase(user);
  if(user&&cloudUser?.id===user.id){account.innerHTML=`<strong class="mode-label">${user.is_test?'TEST · keine echten Umsätze':'ECHTE KASSE'}</strong><span>${esc(user.username)}</span><button data-reload>Aktualisieren</button><button data-password>Passwort ändern</button><button data-logout>Abmelden</button>`;}
};
const paymentLoadSeatsBase=loadSeats;
loadSeats=async function(){const previousSeat=selectedSeat;await paymentLoadSeatsBase();if(previousSeat&&!selectedSeat)paymentDraft=structuredClone(directPayment);if(selectedSeat&&!seatDirty&&!pendingSale){const seat=seats.find(x=>x.id===selectedSeat);paymentDraft=seat?.details?.deposits?structuredClone(seat.details):blankPayment();}};
const paymentChooseBase=chooseSeat;
chooseSeat=async function(id){
  if(pendingSale)return;
  if(selectedSeat&&seatDirty&&!await saveSeat())return;
  if(!selectedSeat)directPayment=structuredClone(paymentDraft);
  await paymentChooseBase(id);
  const seat=seats.find(x=>x.id===selectedSeat);
  if(selectedSeat)paymentDraft=seat?.details?.deposits?structuredClone(seat.details):blankPayment();else paymentDraft=structuredClone(directPayment);
  save();render();
};
function prepareAssignedPayment(seat){
  const source=structuredClone(paymentDraft);
  const merged=seat?.details?.deposits?structuredClone(seat.details):blankPayment();
  merged.deposits.forEach((kind,i)=>{
    const incoming=source.deposits[i];
    if(incoming&&(incoming.issued||incoming.returned)&&kind.rate!==incoming.rate)throw Error('Die Pfandbeträge unterscheiden sich. Bitte Tisch auswählen und Mengen dort ergänzen.');
    kind.issued+=incoming?.issued||0;kind.returned+=incoming?.returned||0;
  });
  merged.tip+=source.tip;
  return merged;
}
function paymentTotals(lines=state.cart,p=paymentDraft){
  const subtotal=seatAmount(lines);const deposit=p.deposits.reduce((s,x)=>s+(x.issued-x.returned)*x.rate,0);
  const due=subtotal+deposit+p.tip;const tender=p.tender===null?Math.max(due,0):p.tender;
  return {subtotal,deposit,tip:p.tip,due,change:p.method==='cash'?tender-due:0};
}
function euroField(cents){return cents===null?'':(cents/100).toFixed(2).replace('.',',');}
function paymentPanel(){const sums=paymentTotals();return `<section class="payment-panel"><h3>Zahlung</h3><label>Zahlungsart<select data-pay="method"><option value="cash" ${paymentDraft.method==='cash'?'selected':''}>Bar</option><option value="card" ${paymentDraft.method==='card'?'selected':''}>Mit Karte bezahlt</option></select></label><div class="payment-fields"><label>Trinkgeld (optional)<input data-pay="tip" inputmode="decimal" value="${euroField(paymentDraft.tip)}"></label>${paymentDraft.method==='cash'?`<label>Gegeben (optional)<input data-pay="tender" inputmode="decimal" value="${euroField(paymentDraft.tender)}" placeholder="Passend bezahlt"></label>`:''}</div><details><summary>Gläserpfand (optional) · ${money(sums.deposit)}</summary>${paymentDraft.deposits.map((kind,i)=>`<div class="deposit-kind"><strong>${esc(kind.name)} · ${money(kind.rate)} je Glas</strong><div class="payment-fields"><label>Ausgegeben<input type="number" min="0" max="100000" data-deposit="${i}" data-count="issued" value="${kind.issued}"></label><label>Zurückgenommen<input type="number" min="0" max="100000" data-deposit="${i}" data-count="returned" value="${kind.returned}"></label></div></div>`).join('')}</details><div class="payment-total"><span>Zu zahlen inkl. Pfand/Trinkgeld</span><b>${money(sums.due)}</b>${paymentDraft.method==='cash'?`<span>Rückgeld${sums.change<0?' · Betrag fehlt':''}</span><b>${money(sums.change)}</b>`:'<span>Mit Karte bezahlt</span>'}</div></section>`;}
const paymentSaleBase=renderSale;
renderSale=function(){
  paymentSaleBase();const receipt=main.querySelector('.receipt');if(!receipt)return;
  const button=receipt.querySelector('[data-checkout]');const panel=document.createElement('div');panel.innerHTML=paymentPanel();button.before(panel);
  const sums=paymentTotals();const mobile=main.querySelector('.mobile-total b');if(mobile)mobile.textContent=money(sums.due);button.disabled=!state.cart.length&&!sums.deposit;
  if(cloudUser?.is_test)button.textContent='TEST · Abrechnung abschließen';
};
function readPayment(){
  let valid=true;
  main.querySelectorAll('[data-pay]').forEach(el=>{
    if(el.dataset.pay==='method'){paymentDraft.method=el.value;return;}
    const raw=el.value.trim();if(!raw&&el.dataset.pay==='tender'){paymentDraft.tender=null;return;}
    if(!/^\d{1,7}([,.]\d{1,2})?$/.test(raw||'0')){valid=false;el.setAttribute('aria-invalid','true');return;}
    paymentDraft[el.dataset.pay]=Math.round(Number((raw||'0').replace(',','.'))*100);
  });
  main.querySelectorAll('[data-count]').forEach(el=>{if(!/^\d+$/.test(el.value)||Number(el.value)>100000){valid=false;return;}paymentDraft.deposits[Number(el.dataset.deposit)][el.dataset.count]=Number(el.value);});
  return valid;
}
main.addEventListener('change',async e=>{
  if(!e.target.matches('[data-pay],[data-count]'))return;
  if(cloudBusy||pendingSale)return;
  if(!readPayment()){toast('Bitte gültige Zahlungsbeträge eingeben.');return;}
  if(selectedSeat){seatDirty=true;save();await saveSeat();}else save();renderSale();
});
main.addEventListener('click',async e=>{
  const b=e.target.closest('[data-clear]');if(!b||selectedSeat)return;
  e.stopImmediatePropagation();if(cloudBusy||pendingSale)return;
  if(!await ask('Rechnung verwerfen?','Artikel und Zahlungsangaben dieser Eingabe leeren?','Verwerfen'))return;
  state.cart=[];state.reference='';paymentDraft=blankPayment();directPayment=blankPayment();save();renderSale();
},true);
const paymentOldCheckout=checkout;
checkout=async function(){
  if(pendingSale&&!pendingSale.payment)return paymentOldCheckout();
  if(cloudBusy||!cloudUser)return;
  if(!pendingSale&&!readPayment()){toast('Bitte Zahlungsangaben prüfen.');return;}
  const snapshot=pendingSale?.payment||structuredClone(paymentDraft);const sums=paymentTotals(state.cart,snapshot);
  if(!state.cart.length&&!sums.deposit)return;
  if(snapshot.method==='cash'&&sums.change<0){toast('Der gegebene Betrag reicht nicht aus.');return;}
  if(snapshot.deposits.some(x=>(x.issued||x.returned)&&x.rate===0)){toast('Bitte zuerst den Pfandbetrag unter Artikel & Preise einstellen.');return;}
  if(selectedSeat&&!pendingSale){seatDirty=true;if(!await saveSeat())return;}
  if(!await ask(cloudUser.is_test?'TEST-Zahlung abschließen?':'Zahlung abschließen?',`${money(sums.due)} · ${snapshot.method==='cash'?'Bar, Rückgeld '+money(sums.change):'Mit Karte bezahlt'}${cloudUser.is_test?' · nur Testbereich':''}`,'Bezahlt'))return;
  cloudBusy=true;
  try{
    if(!pendingSale)pendingSale={id:uid(),lines:structuredClone(state.cart),payment:snapshot,tableId:selectedSeat,tableRevision:seatRevision};
    save();const r=await db.rpc('pau_kasse_pay',{p_id:pendingSale.id,p_lines:pendingSale.lines,p_payment:pendingSale.payment,p_table:pendingSale.tableId||null,p_revision:pendingSale.tableId?pendingSale.tableRevision:null});
    if(r.error)throw r.error;
    const wasSeat=!!selectedSeat;pendingSale=null;seatDirty=false;selectedSeat=null;
    if(wasSeat){state.cart=structuredClone(directCart);state.reference=directReference;paymentDraft=structuredClone(directPayment);view='tables';}
    else{state.cart=[];state.reference='';directCart=[];directReference='';paymentDraft=blankPayment();directPayment=blankPayment();}
    save();await refreshCloud();render();toast((cloudUser.is_test?'TEST gespeichert · ':'Bezahlt · ')+money(sums.due));
  }catch(error){if(error.code==='P0001'&&/Rechnung wurde geändert/.test(message(error))){pendingSale=null;seatDirty=true;save();}toast('Zahlung nicht bestätigt: '+message(error));}
  finally{cloudBusy=false;}
};
function paymentSummary(sales){return sales.reduce((s,x)=>{s.tip+=Number(x.tip_cents||0);s.deposit+=Number(x.deposit_cents||0);if(x.payment_method==='cash')s.cash+=Number(x.total_cents)+Number(x.tip_cents||0)+Number(x.deposit_cents||0);if(x.payment_method==='card')s.card+=Number(x.total_cents)+Number(x.tip_cents||0)+Number(x.deposit_cents||0);return s;},{tip:0,deposit:0,cash:0,card:0});}
function summaryHtml(s){return `<div class="payment-stats"><span>Trinkgeld <b>${money(s.tip)}</b></span><span>Pfand netto <b>${money(s.deposit)}</b></span><span>Bar <b>${money(s.cash)}</b></span><span>Karte <b>${money(s.card)}</b></span></div>`;}
const paymentDayBase=renderDay;
renderDay=function(){paymentDayBase();const box=document.createElement('div');box.innerHTML=summaryHtml(paymentSummary(cloudSales.filter(x=>x.business_date===selectedDate)));main.append(box);};
const paymentYearBase=renderYear;
renderYear=function(){paymentYearBase();const archive=archivedYears.find(x=>x.year===chosenYear);const summary=archive?.summary?.payment||paymentSummary(cloudSales.filter(x=>Number(x.business_date.slice(0,4))===chosenYear));const box=document.createElement('div');box.innerHTML=summaryHtml(summary);main.append(box);};
const paymentSettingsBase=renderSettings;
renderSettings=function(){paymentSettingsBase();const box=document.createElement('section');box.className='panel deposit-settings';box.innerHTML=`<h2>Gläserpfand · zwei Arten</h2><p class="note">Optional. Die Beträge gelten für neue Rechnungen; vorhandene offene Rechnungen behalten ihren bisherigen Pfandbetrag.</p>${depositKinds.map((kind,i)=>`<div class="payment-fields"><label>Bezeichnung ${i+1}<input data-pfand-name="${i}" value="${esc(kind.name)}" maxlength="60"></label><label>Pfand je Glas (€)<input data-pfand-price="${i}" value="${euroField(kind.price)}" inputmode="decimal"></label></div>`).join('')}<button data-save-deposits>Pfand-Einstellungen speichern</button>`;main.querySelector('.sticky-save').before(box);};
main.addEventListener('click',async e=>{
  const b=e.target.closest('[data-save-deposits],[data-move-day-tests],[data-move-all-tests]');if(!b||cloudBusy||!cloudUser)return;
  try{
    if(b.hasAttribute('data-save-deposits')){
      const kinds=depositKinds.map((kind,i)=>{const name=main.querySelector('[data-pfand-name="'+i+'"]').value.trim();const raw=main.querySelector('[data-pfand-price="'+i+'"]').value.trim();if(!name||!/^\d{1,5}([,.]\d{1,2})?$/.test(raw))throw Error('Bitte Pfandbezeichnung und gültigen Betrag eingeben.');return {name,price:Math.round(Number(raw.replace(',','.'))*100)};});
      cloudBusy=true;const r=await db.from('pau_kasse_deposits').upsert({user_id:cloudUser.workspace_id,kinds});if(r.error)throw r.error;depositKinds=kinds;if(!state.cart.length&&!selectedSeat){paymentDraft=blankPayment();directPayment=blankPayment();save();}toast('Pfand-Einstellungen gespeichert');
    }

  }catch(error){toast(message(error));}finally{cloudBusy=false;}
});
account.addEventListener('click',e=>{if(e.target.closest('[data-password]')&&!cloudBusy)showPasswordDialog();});
function showPasswordDialog(){
  const overlay=document.createElement('div');overlay.className='password-overlay';overlay.innerHTML=`<form class="panel"><h2>Passwort ändern</h2><label>Aktuelles Passwort<input type="password" name="current" required autocomplete="current-password"></label><label>Neues Passwort (mindestens 6 Zeichen)<input type="password" name="next" minlength="6" required autocomplete="new-password"></label><label>Neues Passwort wiederholen<input type="password" name="again" minlength="6" required autocomplete="new-password"></label><p class="password-error" role="alert"></p><div class="actions"><button type="button" data-password-cancel>Abbrechen</button><button class="primary">Speichern</button></div></form>`;document.body.append(overlay);
  overlay.querySelector('[data-password-cancel]').onclick=()=>overlay.remove();
  overlay.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const f=e.target;const submit=f.querySelector('.primary');submit.disabled=true;
    try{if(f.next.value!==f.again.value)throw Error('Die neuen Passwörter stimmen nicht überein.');const check=await db.auth.signInWithPassword({email:cloudUser.email,password:f.current.value});if(check.error)throw check.error;const result=await db.auth.updateUser({password:f.next.value});if(result.error)throw result.error;overlay.remove();toast('Passwort geändert');}catch(error){f.querySelector('.password-error').textContent=message(error);submit.disabled=false;}
  };
}

const paymentYearDataBase=yearData;
yearData=function(year){const data=paymentYearDataBase(year);if(!data.closed){data.summary.payment=paymentSummary(cloudSales.filter(x=>Number(x.business_date.slice(0,4))===year));data.summary.payments=cloudSales.filter(x=>Number(x.business_date.slice(0,4))===year);}return data;};
const paymentTablesBase=renderTables;
renderTables=function(){paymentTablesBase();main.querySelectorAll('[data-seat]').forEach(button=>{const seat=seats.find(x=>x.id===button.dataset.seat);if(!seat?.details?.deposits)return;const sums=paymentTotals(seat.lines,seat.details);button.querySelector('b').textContent=money(sums.due);if(sums.deposit||sums.tip){button.classList.add('occupied');button.querySelector('span').textContent='Rechnung offen';}});};

const paymentRefreshBase=refreshCloud;
refreshCloud=async function(){await paymentRefreshBase();const user=cloudUser;if(!user)return;const result=await db.from('pau_kasse_deposits').select('*').eq('user_id',user.workspace_id||user.id).maybeSingle();if(result.error)throw result.error;if(cloudUser?.id!==user.id)return;if(result.data){depositKinds=result.data.kinds;if(!selectedSeat&&!state.cart.length&&!paymentDraft.tip&&!paymentDraft.deposits.some(x=>x.issued||x.returned)){paymentDraft=blankPayment();directPayment=blankPayment();}}};

// Administrative reset, protected independently by a server-checked code.
const resetSettingsBase = renderSettings;
renderSettings = function() {
  resetSettingsBase();
  if (!cloudUser?.is_admin) return;
  const section = document.createElement('details');
  section.className = 'panel';
  section.innerHTML = `<summary>Verwaltung</summary><p>Alle Umsätze und Jahresarchive dieses Kassenbereichs auf null setzen. Offene Rechnungen werden geleert, feste Tische bleiben erhalten. Artikel, Preise, Pfandbeträge und Benutzer bleiben erhalten. Vorher wird eine Sicherung in der Datenbank erstellt.</p><button class="danger" data-reset-register>Kasse auf null zurücksetzen</button>`;
  main.querySelector('.sticky-save').before(section);
};
main.addEventListener('click', async event => {
  const button = event.target.closest('[data-reset-register]');
  if (!button || cloudBusy || !cloudUser?.is_admin) return;
  if (pendingSale) { toast('Bitte zuerst die unbestätigte Zahlung klären.'); return; }
  cloudBusy = true;
  button.disabled = true;
  try {
    const code = await pinPrompt('Kasse zurücksetzen', 'Separaten vierstelligen Reset-Code eingeben. Alle anderen Geräte vorher abmelden und keine weiteren Buchungen erfassen.');
    if (code === null) return;
    if (!await ask('Wirklich alles auf null setzen?', 'Alle Umsätze, Trinkgeld- und Pfandsummen sowie Jahresarchive dieses Kassenbereichs werden zurückgesetzt. Offene Rechnungen werden geleert und Einzelpersonen entfernt. Artikel, Preise und Benutzer bleiben erhalten. Vorher wird eine Datenbanksicherung erstellt.', 'Auf null zurücksetzen')) return;
    const result = await db.rpc('pau_kasse_reset', {p_code: code});
    if (result.error) throw result.error;
    pendingSale = null; selectedSeat = null; seatRevision = 0; seatDirty = false;
    state.cart = []; state.reference = ''; directCart = []; directReference = '';
    paymentDraft = blankPayment(); directPayment = blankPayment();
    save(); await refreshCloud(); view = 'day'; render();
    toast('Kasse zurückgesetzt · Sicherung erstellt');
  } catch (error) { toast(message(error)); }
  finally { cloudBusy = false; button.disabled = false; }
});
