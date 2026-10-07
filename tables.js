'use strict';
// Offene Rechnungen: zentral gespeichert, erst bei Bezahlung als Verkauf gezählt.
let seats = [], selectedSeat = null, seatRevision = 0, seatDirty = false, seatsReady = false;
let directCart = [], directReference = '';
const baseDevice = persistDevice;
persistDevice = function() {
  baseDevice();
  if (!cloudUser) return;
  localStorage.setItem(deviceKey() + '-tables', JSON.stringify({selectedSeat,seatRevision,seatDirty,directCart,directReference}));
};
const baseOpenAccount = openAccount;
openAccount = async function(user) {
  seats=[]; selectedSeat=null; seatDirty=false; seatsReady=false; directCart=[]; directReference='';
  if (user) {
    try {
      const saved=JSON.parse(localStorage.getItem('pau-kasse-device-'+user.id+'-tables')||'null');
      if (saved) {selectedSeat=saved.selectedSeat;seatRevision=saved.seatRevision;seatDirty=!!saved.seatDirty;directCart=saved.directCart||[];directReference=saved.directReference||'';}
    } catch {}
  }
  await baseOpenAccount(user);
};
async function loadSeats() {
  const user=cloudUser;if(!user)return;
  const init=await db.rpc('pau_kasse_table_init');if(init.error)throw init.error;
  const result=await db.from('pau_kasse_tables').select('*').eq('user_id',user.workspace_id||user.id).order('table_number',{nullsFirst:false}).order('name');
  if(result.error)throw result.error;if(cloudUser?.id!==user.id)return;
  seats=result.data;seatsReady=true;
  if(selectedSeat && !seatDirty && !pendingSale) {
    const seat=seats.find(x=>x.id===selectedSeat);
    if(seat){state.cart=structuredClone(seat.lines);seatRevision=seat.revision;state.reference=seat.name;}
    else {selectedSeat=null;state.cart=directCart;state.reference=directReference;}
  }
}
const baseRefresh = refreshCloud;
refreshCloud = async function() {await baseRefresh();await loadSeats();};
function seatAmount(lines) {return lines.reduce((sum,line)=>sum+line.price*line.qty,0);}
function renderTables() {
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view==='tables'));
  main.innerHTML=`<div class="page-top"><div><h1>Tische & Einzelpersonen</h1><p class="sub">Offene Rechnungen auswählen und ergänzen</p></div></div><div class="seat-actions"><button data-new-seat>+ Tisch hinzufügen</button><button data-new-person>+ Einzelperson</button><button data-seat-refresh>Übersicht aktualisieren</button><button data-direct>Ohne Tisch abrechnen</button></div><div class="seat-grid">${seats.map(seat=>`<button class="seat-card ${seat.lines.length?'occupied':''}" data-seat="${seat.id}"><strong>${esc(seat.name)}</strong><span>${seat.lines.length?'Rechnung offen':seat.permanent?'Frei':'Noch keine Artikel'}</span><b>${money(seatAmount(seat.lines))}</b></button>`).join('')}</div><p class="note">Einzelpersonen verschwinden nach der Bezahlung. Feste Tische werden wieder frei. Offene Rechnungen zählen noch nicht zum Umsatz.</p>`;
}
const baseRender=render;
render=function(){if(!cloudUser)return;if(view==='tables')renderTables();else baseRender();};
const baseSale=renderSale;
renderSale=function(){
  baseSale();
  if(!seatsReady)return;
  const seat=seats.find(x=>x.id===selectedSeat);
  const bar=document.createElement('div');bar.className='seat-toolbar';
  bar.innerHTML=`<strong>${seat?esc(seat.name):'Ohne Tisch'}</strong><span>${selectedSeat?(seatDirty?'Noch nicht zentral gespeichert':'Zentral gespeichert'):''}</span><button data-seats>Zur Tischübersicht</button>${selectedSeat?'<button data-save-seat>Rechnung speichern</button><button data-reload-seat>Rechnung neu laden</button>':state.cart.length?'<label>Rechnung zuordnen<select id="assign-seat"><option value="">Tisch / Einzelperson wählen</option>'+seats.map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join('')+'</select></label><button data-assign-seat>Zuordnen & speichern</button>':''}`;
  main.prepend(bar);
  if(selectedSeat){const reference=main.querySelector('#reference');if(reference){reference.value=seat?.name||'Offene Rechnung';reference.disabled=true;}}
};
async function saveSeat() {
  if(!selectedSeat||!seatDirty)return true;
  if(pendingSale) {toast('Bitte die unbestätigte Zahlung erneut abschließen.');return false;}
  const id=selectedSeat;const lines=structuredClone(state.cart);cloudBusy=true;
  try {
    const result=await db.rpc('pau_kasse_table_save_details',{p_id:id,p_revision:seatRevision,p_lines:lines,p_details:typeof paymentDraft==='undefined'?{}:structuredClone(paymentDraft)});
    if(result.error)throw result.error;
    seatRevision=result.data;seatDirty=false;
    const seat=seats.find(x=>x.id===id);if(seat){seat.lines=lines;seat.revision=seatRevision;if(typeof paymentDraft!=='undefined')seat.details=structuredClone(paymentDraft);}
    persistDevice();return true;
  } catch(error){toast('Rechnung nicht bestätigt gespeichert: '+message(error));return false;}
  finally{cloudBusy=false;}
}
async function chooseSeat(id) {
  if(pendingSale){toast('Bitte die unbestätigte Zahlung erneut abschließen.');return;}
  if(!await saveSeat())return;
  if(!selectedSeat){directCart=structuredClone(state.cart);directReference=state.reference;}
  await loadSeats();
  if(id){const seat=seats.find(x=>x.id===id);if(!seat)throw Error('Rechnung nicht mehr vorhanden.');selectedSeat=id;seatRevision=seat.revision;state.cart=structuredClone(seat.lines);state.reference=seat.name;}
  else{selectedSeat=null;state.cart=structuredClone(directCart);state.reference=directReference;}
  seatDirty=false;view='sale';save();render();window.scrollTo({top:0,behavior:'smooth'});
}
async function assignDirectSeat(id) {
  if(!id||selectedSeat||!state.cart.length||pendingSale)return;
  const source=structuredClone(state.cart);
  await loadSeats();const seat=seats.find(x=>x.id===id);if(!seat)throw Error('Rechnung nicht mehr vorhanden.');
  const assignedPayment=typeof prepareAssignedPayment==='function'?prepareAssignedPayment(seat):null;
  if(!await ask('Rechnung zuordnen?',`${seat.name}: aktuelle Artikel zur offenen Rechnung hinzufügen?`,'Zuordnen'))return;
  selectedSeat=id;seatRevision=seat.revision;
  if(assignedPayment){paymentDraft=assignedPayment;directPayment=blankPayment();}
  state.cart=[...structuredClone(seat.lines),...source];state.reference=seat.name;seatDirty=true;
  // Die Artikel bleiben bei Speicherfehlern als lokaler Tischentwurf erhalten.
  directCart=[];directReference='';save();
  await saveSeat();renderSale();
}
const baseCheckout=checkout;
checkout=async function(){
  if(!selectedSeat)return baseCheckout();
  if(cloudBusy||!state.cart.length)return;
  if(!pendingSale&&!await saveSeat())return;
  const amount=total();const seat=seats.find(x=>x.id===selectedSeat);
  if(!await ask('Rechnung bezahlen?',`${seat?.name||'Offene Rechnung'} · ${money(amount)} abrechnen?`,'Bezahlt'))return;
  cloudBusy=true;
  try {
    if(!pendingSale)pendingSale={id:uid(),tableId:selectedSeat,tableRevision:seatRevision,lines:structuredClone(state.cart)};
    if(pendingSale.tableId!==selectedSeat)throw Error('Bitte zuerst die ausstehende Zahlung abschließen.');
    persistDevice();
    const result=await db.rpc('pau_kasse_table_checkout',{p_id:pendingSale.id,p_table:pendingSale.tableId,p_revision:pendingSale.tableRevision});
    if(result.error)throw result.error;
    pendingSale=null;selectedSeat=null;seatDirty=false;state.cart=[];state.reference='';
    // Unabhängige Rechnung bleibt erhalten, auch wenn ein Tisch bezahlt wird.
    state.cart=structuredClone(directCart);state.reference=directReference;save();
    await refreshCloud();view='tables';render();toast('Bezahlt · '+money(amount));
  }catch(error){
    if(error.code==='P0001' && /Rechnung wurde geändert/.test(message(error))){pendingSale=null;seatDirty=true;save();}
    toast('Zahlung nicht bestätigt: '+message(error)+'.');
  }
  finally{cloudBusy=false;}
};
// Änderungen nach der vorhandenen Artikellogik speichern.
main.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled||cloudBusy||!cloudUser)return;
  try{
    if(selectedSeat&&(b.dataset.add||b.dataset.qty!==undefined||b.hasAttribute('data-clear'))){
      if(pendingSale)return;
      seatDirty=true;save();
      // Verwerfen verwendet einen Bestätigungsdialog: Änderungen erst danach erkennen.
      if(b.hasAttribute('data-clear'))return;
      await saveSeat();if(view==='sale')renderSale();return;
    }
    if(b.hasAttribute('data-reload-seat')){
      if(pendingSale){toast('Bitte zuerst die unbestätigte Zahlung abschließen.');return;}
      if(seatDirty&&!await ask('Lokale Änderungen verwerfen?','Die zentral gespeicherte Rechnung wird geladen. Nicht bestätigte Änderungen gehen verloren.','Neu laden'))return;
      seatDirty=false;await loadSeats();save();render();
    }
    if(b.hasAttribute('data-assign-seat'))await assignDirectSeat(main.querySelector('#assign-seat')?.value);
    if(b.hasAttribute('data-save-seat')){if(await saveSeat()){render();toast('Rechnung gespeichert');}}
    if(b.dataset.seat)await chooseSeat(b.dataset.seat);
    if(b.hasAttribute('data-direct'))await chooseSeat(null);
    if(b.hasAttribute('data-seats')){if(await saveSeat()){await loadSeats();view='tables';render();}}
    if(b.hasAttribute('data-seat-refresh')){await loadSeats();render();}
    if(b.hasAttribute('data-new-seat')||b.hasAttribute('data-new-person')){
      const permanent=b.hasAttribute('data-new-seat');const name=permanent?'Tisch':prompt('Name der Einzelperson');
      if(!name?.trim())return;
      cloudBusy=true;let result;
      try{result=await db.rpc('pau_kasse_table_create',{p_id:uid(),p_name:name,p_permanent:permanent});if(result.error)throw result.error;await loadSeats();}
      finally{cloudBusy=false;}
      if(permanent)render();else await chooseSeat(result.data);
    }
  }catch(error){toast(message(error));}
});
main.addEventListener('click', async e=>{
  const b=e.target.closest('[data-clear]');
  if(!b||!selectedSeat)return;
  e.stopImmediatePropagation();
  if(cloudBusy||pendingSale)return;
  if(!await ask('Offene Rechnung leeren?','Alle Artikel dieser offenen Rechnung entfernen?','Leeren'))return;
  state.cart=[];if(typeof blankPayment==='function')paymentDraft=blankPayment();seatDirty=true;save();await saveSeat();renderSale();
},true);
