/* ============================================================
   OhMyGoch Trip OS · app.js
   Orquestador · boot · setView · switchTrip · daymode · sync · PWA
   ============================================================ */

import * as bus from './ui/bus.js';
import * as uiToday from './ui/today.js';
import * as uiWallet from './ui/wallet.js';
import * as uiImport from './ui/event-modal.js';   // event modal
import * as uiMgmt from './ui/management.js';
import * as uiChat from './ui/chat.js';
import * as uiMap from './ui/map.js';
import * as uiFreetour from './ui/freetour.js';

import * as trips from './trips.js';
import * as sync from './sync.js';
import * as vault from './vault.js';
import * as crypto from './crypto.js';
import * as wallet from './wallet.js';
import * as chat from './chat.js';
import * as notif from './notifications.js';
import * as alerts from './alerts.js';
import * as daymode from './daymode.js';
import * as settings from './settings.js';

import { analyzeMulti } from './parser.js';
import { extractTextFromPdf, isPdfFile, fmtBytes } from './pdf-import.js';
import { extractTextFromImage, isImageFile } from './ocr-import.js';

const { ctx, register, call, on, emit, toast, openModalEl, closeModalEl } = bus;

const IS_DEV =
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  location.hostname === '0.0.0.0' ||
  location.protocol === 'file:';

/* ============================================================
   STATE HELPERS
   ============================================================ */
async function loadAll() {
  const active = await trips.getActiveTrip();
  ctx.trip = active || { id: 'default', title: 'Mi viaje', flag: '🌍', days: 0, travelers: 1 };
  ctx.events = await trips.getTripEvents(ctx.trip.id);
}

async function renderAll() {
  uiToday.render();
  await uiWallet.render();
  uiMgmt.render();
  await uiChat.render();
}

/* ============================================================
   ACCIONES · slots compartidos
   ============================================================ */
async function saveEvent(ev) {
  ev.tripId = ctx.trip?.id;
  ev.updatedAt = Date.now();
  await trips.idbPut(trips.STORES.EVENTS, ev);
  sync.setEvent(ev);
  await loadAll();
  await renderAll();
}

async function deleteEvent(id, { silent = false } = {}) {
  try {
    const files = await wallet.getFilesByEvent(id);
    for (const f of files) await wallet.deleteFile(f.id);
  } catch {}
  await trips.idbDelete(trips.STORES.EVENTS, id);
  sync.deleteEventSync(id);
  await loadAll();
  await renderAll();
  if (!silent) toast('Evento eliminado');
}

async function toggleDone(id) {
  const e = ctx.events.find(x => x.id === id);
  if (!e) return;
  e.done = !e.done;
  e.updatedAt = Date.now();
  await trips.idbPut(trips.STORES.EVENTS, e);
  sync.setEvent(e);
  await loadAll();
  await renderAll();
  toast(e.done ? '✓ Marcado como hecho' : 'Marcado como pendiente');
}

register('saveEvent', saveEvent);
register('deleteEvent', deleteEvent);
register('toggleDone', toggleDone);
register('openEventModal', (id) => uiImport.open(id));
register('renderAll', renderAll);
register('setView', setView);
register('reloadAll', async () => {
  await trips.ensureInitialized();
  await loadAll();
  await renderAll();
  await refreshSubsystems();
  await startSync();
});

/* ============================================================
   TABS
   ============================================================ */
function setView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
  document.getElementById('viewport')?.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'wallet') uiWallet.render();
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.tab)));

/* ============================================================
   SWITCH TRIP
   ============================================================ */
async function switchTrip(newTripId, { force = false } = {}) {
  if (!force && newTripId === ctx.trip?.id) return;
  try { sync.destroySync(); } catch {}
  if (newTripId) await trips.setActiveTrip(newTripId);
  await loadAll();
  await renderAll();
  if (daymode.isDayModeActive()) daymode.refresh();
  await startSync();
  await refreshSubsystems();
}
register('switchTrip', switchTrip);

/* ============================================================
   SYNC
   ============================================================ */
async function startSync() {
  try {
    if (!ctx.trip?.id) return;
    try { sync.destroySync(); } catch {}
    const { roomId } = await sync.initSync(ctx.trip.id);
    sync.setLocalUser({ name: 'Vos', color: '#ff5c39' });
    sync.setTripMeta({
      title: ctx.trip.title, flag: ctx.trip.flag,
      startDate: ctx.trip.startDate, endDate: ctx.trip.endDate,
      travelers: ctx.trip.travelers, currency: ctx.trip.currency,
      timezone: ctx.trip.timezone,
    });
    sync.onRemoteChange(async () => {
      await applyRemoteState();
      await renderAll();
      toast('⟳ Actualizado desde otro dispositivo');
    });
    sync.onTripMetaChange(async (meta) => {
      if (!meta?.title) return;
      if (meta.title === ctx.trip.title && meta.flag === ctx.trip.flag) return;
      ctx.trip = await trips.updateTrip(ctx.trip.id, {
        title: meta.title, flag: meta.flag,
        startDate: meta.startDate || ctx.trip.startDate,
        endDate: meta.endDate || ctx.trip.endDate,
      });
      uiToday.render();
      toast(`✓ Viaje actualizado: ${meta.title}`);
    });
    sync.onPeersChange(peers => renderPeers(peers));
    await applyRemoteState();
    await renderAll();
    const url = new URL(location.href);
    url.searchParams.set('join', `${ctx.trip.id}~${sync.getSecret(ctx.trip.id)}`);
    const link = document.getElementById('shareLink');
    if (link) link.value = url.toString();
    updateSyncStatus();
  } catch (err) {
    console.warn('Sync no disponible:', err);
    updateSyncStatus('error');
  }
}

async function applyRemoteState() {
  const remote = sync.getAllEvents();
  if (!remote.length) return;
  const filtered = remote.filter(ev => !ev.tripId || ev.tripId === ctx.trip.id);
  const local = await trips.getTripEvents(ctx.trip.id);
  const byId = new Map(local.map(e => [e.id, e]));
  for (const rEv of filtered) {
    if (!rEv.tripId) rEv.tripId = ctx.trip.id;
    const lEv = byId.get(rEv.id);
    if (!lEv) await trips.idbPut(trips.STORES.EVENTS, rEv);
    else if ((rEv.updatedAt || 0) > (lEv.updatedAt || 0)) await trips.idbPut(trips.STORES.EVENTS, rEv);
  }
}

function renderPeers(peers) {
  const count = peers.length;
  const badge = document.getElementById('peersBadge');
  const list = document.getElementById('peersList');
  const cnt = document.getElementById('peersCount');
  if (cnt) cnt.textContent = count;
  if (badge) { badge.textContent = count; badge.hidden = count === 0; }
  if (!list) return;
  if (!count) { list.innerHTML = `<li class="peers__empty">Nadie más conectado todavía</li>`; return; }
  list.innerHTML = peers.map(p => `
    <li class="peer">
      <div class="peer__avatar" style="background:${p.color}">${(p.name || '?')[0].toUpperCase()}</div>
      <span class="peer__name">${p.name}</span>
      <span class="peer__dot"></span>
    </li>`).join('');
}

function updateSyncStatus(mode = 'auto') {
  const status = document.getElementById('shareStatus');
  const txt = document.getElementById('shareStatusText');
  if (!status || !txt) return;
  status.classList.remove('is-online', 'is-offline');
  if (mode === 'error') { status.classList.add('is-offline'); txt.textContent = 'Sync no disponible.'; return; }
  if (!navigator.onLine) { status.classList.add('is-offline'); txt.textContent = 'Sin internet'; return; }
  const peers = sync.getPeerCount?.() || 0;
  if (peers > 0) { status.classList.add('is-online'); txt.textContent = `${peers} ${peers === 1 ? 'dispositivo conectado' : 'dispositivos conectados'}`; }
  else { status.classList.add('is-offline'); txt.textContent = 'Listo para compartir'; }
}

/* Share modal — mantengo el wiring inline */
function openShare() {
  const m = document.getElementById('shareModal');
  if (!m) return;
  openModalEl(m);
  const link = document.getElementById('shareLink');
  if (link?.value && !document.getElementById('shareQr')?.querySelector('canvas,img')) renderQr(link.value);
  updateSyncStatus();
}
function closeShare() { closeModalEl(document.getElementById('shareModal')); }

document.getElementById('shareBtn')?.addEventListener('click', openShare);
document.getElementById('groupInviteBtn')?.addEventListener('click', openShare);
document.getElementById('shareModal')?.addEventListener('click', e => {
  if (e.target.hasAttribute('data-share-close') || e.target.closest('[data-share-close]')) closeShare();
});
document.getElementById('shareCopy')?.addEventListener('click', async () => {
  const link = document.getElementById('shareLink');
  if (!link) return;
  try { await navigator.clipboard.writeText(link.value); toast('Link copiado'); }
  catch { link.select(); document.execCommand('copy'); toast('Link copiado'); }
});
document.getElementById('shareNativeBtn')?.addEventListener('click', async () => {
  const link = document.getElementById('shareLink');
  if (!link) return;
  const data = { title: 'OhMyGoch Trip OS · ' + (ctx.trip?.title || ''), text: 'Sumate a nuestro viaje:', url: link.value };
  if (navigator.share) { try { await navigator.share(data); } catch {} }
  else { try { await navigator.clipboard.writeText(link.value); toast('Link copiado'); } catch {} }
});

async function renderQr(text) {
  const el = document.getElementById('shareQr');
  if (!el || !text) return;
  el.innerHTML = `<div class="share__qr-placeholder">Generando QR…</div>`;
  try {
    if (!window.QRCode) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    el.innerHTML = '';
    new QRCode(el, { text, width: 240, height: 240, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel?.M ?? 0 });
  } catch {
    el.innerHTML = `<div class="share__qr-placeholder">QR no disponible · copiá el link</div>`;
  }
}

/* ============================================================
   JOIN HANDLER
   ============================================================ */
async function handleJoin() {
  const params = new URLSearchParams(location.search);
  const join = params.get('join');
  if (!join) return false;
  const parts = join.split('~');
  if (parts.length !== 2) { history.replaceState({}, '', location.pathname); return false; }
  const [joinTripId, secret] = parts;
  if (!joinTripId || !secret) { history.replaceState({}, '', location.pathname); return false; }
  localStorage.setItem(`ohmygoch_secret_${joinTripId}`, secret);
  const existing = await trips.getTrip(joinTripId);
  if (!existing?.title) {
    await trips.idbPut(trips.STORES.TRIPS, {
      id: joinTripId, title: existing?.title || 'Viaje compartido',
      flag: existing?.flag || '🌍', startDate: null, endDate: null, days: 0,
      travelers: 1, currency: 'EUR',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  }
  await trips.setActiveTrip(joinTripId);
  history.replaceState({}, '', location.pathname);
  return true;
}

/* ============================================================
   DAYMODE
   ============================================================ */
daymode.setEventProvider(() => ctx.events);
daymode.setOnEventDone(async (id) => { await toggleDone(id); });
document.getElementById('daymodeBtn')?.addEventListener('click', () => daymode.enterDayMode());
document.getElementById('daymodeClose')?.addEventListener('click', () => daymode.exitDayMode());
document.getElementById('daymodeDoneBtn')?.addEventListener('click', async () => { await daymode.actionDone(); toast('✓ Hecho'); });
document.getElementById('daymodeSkipBtn')?.addEventListener('click', () => daymode.actionSkip());
document.getElementById('daymodeNavBtn')?.addEventListener('click', async () => {
  const res = await daymode.actionNavigate();
  if (res && !res.ok && res.reason === 'sin-ubicacion') toast('Sin ubicación para este evento');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && daymode.isDayModeActive()) daymode.exitDayMode();
});

/* ============================================================
   FAB
   ============================================================ */
document.getElementById('fab')?.addEventListener('click', () => call('openEventModal'));

/* ============================================================
   IMPORT · Drag&drop de PDF/imagen (dinámico)
   ============================================================ */
const pdfDrop = document.getElementById('pdfDrop');
function handleDroppedFile(file) {
  if (!file) return;
  if (isPdfFile(file)) return handlePdfFile(file);
  if (isImageFile(file)) return handleImageFile(file);
  toast('Formato no soportado');
}
function handlePdfFile(file) {
  showDropStatus(file.name, 'Extrayendo texto…');
  extractTextFromPdf(file).then(text => {
    if (!text || text.length < 30) { showDropStatus(file.name, 'No pude extraer texto'); return; }
    document.getElementById('importText').value = text;
    document.getElementById('importAnalyzeBtn').disabled = false;
    hideDropStatus();
    toast(`✓ PDF procesado · ${fmtBytes(file.size)}`);
  }).catch(err => showDropStatus(file.name, 'Error: ' + err.message));
}
function handleImageFile(file) {
  showDropStatus(file.name, 'Preparando OCR…');
  extractTextFromImage(file, pct => showDropStatus(file.name, `Reconociendo… ${pct}%`))
    .then(text => {
      if (!text || text.length < 20) { showDropStatus(file.name, 'No pude leer texto'); return; }
      document.getElementById('importText').value = text;
      document.getElementById('importAnalyzeBtn').disabled = false;
      hideDropStatus();
      toast(`✓ Imagen procesada · ${fmtBytes(file.size)}`);
    })
    .catch(err => showDropStatus(file.name, 'Error: ' + err.message));
}
function showDropStatus(name, status) {
  if (!pdfDrop) return;
  pdfDrop.classList.add('is-processing');
  pdfDrop.innerHTML = `<div class="pdf-drop__spinner"></div><strong>${name}</strong><span>${status}</span>`;
}
function hideDropStatus() {
  if (!pdfDrop) return;
  pdfDrop.classList.remove('is-processing');
  pdfDrop.innerHTML = `<svg class="pdf-drop__icon"><use href="#i-file"/></svg><strong>Arrastrá PDF o imagen</strong><span>o <u>elegí un archivo</u></span>`;
}
if (pdfDrop) {
  pdfDrop.addEventListener('click', e => {
    if (e.target.closest('input[type=file]')) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf,image/*';
    input.onchange = () => { const f = input.files?.[0]; if (f) handleDroppedFile(f); };
    input.click();
  });
  ['dragenter', 'dragover'].forEach(ev => pdfDrop.addEventListener(ev, e => { e.preventDefault(); pdfDrop.classList.add('is-dragover'); }));
  ['dragleave', 'drop'].forEach(ev => pdfDrop.addEventListener(ev, e => { e.preventDefault(); pdfDrop.classList.remove('is-dragover'); }));
  pdfDrop.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) handleDroppedFile(f); });
}
document.getElementById('cameraBtn')?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = () => { const f = input.files?.[0]; if (f) handleDroppedFile(f); };
  input.click();
});

/* Share target */
(function handleShareTarget() {
  const params = new URLSearchParams(location.search);
  if (params.get('action') !== 'share-target') return;
  const shared = params.get('text') || params.get('url') || params.get('title') || '';
  if (shared) setTimeout(() => emit('open-import', { prefill: shared }), 400);
  history.replaceState({}, '', location.pathname);
})();

/* ============================================================
   SUBSISTEMAS · notif + alerts + chat
   ============================================================ */
async function refreshSubsystems() {
  notif.refreshEvents(ctx.events);
  if (notif.getSettings().enabled) {
    notif.start(ctx.events);
    alerts.startAlerts(ctx.trip.id, ctx.events);
  } else alerts.stopAlerts();

  chat.destroyChat();
  try {
    const peerId = sync.getSnapshot?.()?.peerId || 'local';
    await chat.initChat(ctx.trip.id, { id: peerId, name: 'Vos', color: '#ff5c39' });
  } catch (err) { console.warn('[app] chat init falló:', err); }
  await uiChat.render();
}

/* ============================================================
   LOCK SCREEN
   ============================================================ */
const lockscreen = document.getElementById('lockscreen');
const lockTitle = document.getElementById('lockTitle');
const lockSub = document.getElementById('lockSub');
const lockPin = document.getElementById('lockPin');
const lockBtn = document.getElementById('lockBtn');
const lockError = document.getElementById('lockError');
const lockSkip = document.getElementById('lockSkip');
const lockStrength = document.getElementById('lockStrength');

let lockMode = 'unlock';

function showLockError(msg) { lockError.textContent = msg; lockError.hidden = false; lockPin.focus(); lockPin.select(); }
function clearLockError() { lockError.hidden = true; lockError.textContent = ''; }

function updateLockStrength() {
  if (lockMode !== 'setup') { lockStrength.hidden = true; return; }
  const s = crypto.pinStrength(lockPin.value);
  lockStrength.hidden = !lockPin.value;
  lockStrength.dataset.score = s.score;
  lockStrength.textContent = s.label;
}

async function bootLock() {
  const configured = await vault.isConfigured();
  lockMode = configured ? 'unlock' : 'setup';
  lockTitle.textContent = configured ? 'Desbloqueá OhMyGoch' : 'Configurá tu PIN';
  lockSub.textContent = configured
    ? 'Tus datos cifrados te esperan en este dispositivo'
    : 'Vas a cifrar documentos, chat y datos de viajeros con una clave que no sale de acá';
  lockBtn.textContent = configured ? 'Desbloquear' : 'Crear PIN';
  lockSkip.hidden = configured;
  lockStrength.hidden = true;
  lockError.hidden = true;
  lockPin.value = '';
  lockscreen.hidden = false;
  lockPin.focus();

  return new Promise(resolve => {
    const done = (unlocked) => { lockscreen.hidden = true; cleanup(); resolve(unlocked); };
    const onSubmit = async () => {
      clearLockError();
      const pin = lockPin.value.trim();
      if (pin.length < 4) return showLockError('Mínimo 4 caracteres');
      lockBtn.disabled = true;
      try {
        if (lockMode === 'setup') await vault.setup(pin);
        else await vault.unlock(pin);
        done(true);
      } catch (err) { showLockError(err.message || 'Error'); }
      finally { lockBtn.disabled = false; }
    };
    const onSkip = () => done(false);
    const onKey = (e) => { if (e.key === 'Enter') onSubmit(); };
    const onInput = () => updateLockStrength();
    function cleanup() {
      lockBtn.removeEventListener('click', onSubmit);
      lockSkip.removeEventListener('click', onSkip);
      lockPin.removeEventListener('keydown', onKey);
      lockPin.removeEventListener('input', onInput);
    }
    lockBtn.addEventListener('click', onSubmit);
    lockSkip.addEventListener('click', onSkip);
    lockPin.addEventListener('keydown', onKey);
    lockPin.addEventListener('input', onInput);
  });
}

vault.onLock(() => {
  toast('🔒 Vault bloqueado');
  lockscreen.hidden = false;
  lockPin.value = '';
  lockError.hidden = true;
  lockBtn.textContent = 'Desbloquear';
  lockMode = 'unlock';
  bootLock();
});

on('request-unlock', async () => {
  await bootLock();
  await renderAll();
});

function installVaultKeepAlive() {
  const touch = () => vault.touch();
  ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, touch, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') vault.touch(); });
}
installVaultKeepAlive();

/* ============================================================
   PWA · SW
   ============================================================ */
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    console.log('✅ SW registrado · scope:', reg.scope);
  } catch (err) { console.warn('SW error:', err); }
}

/* ============================================================
   PWA · Install
   ============================================================ */
let deferredPrompt = null;
let INSTALL_BANNER_KILLED = false;

function isPWAInstalled() {
  try {
    if (localStorage.getItem('ohmygoch_installed') === '1') return true;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.navigator.standalone === true) return true;
    if (document.referrer?.startsWith('android-app://')) return true;
    return false;
  } catch { return false; }
}
function markInstalled() {
  localStorage.setItem('ohmygoch_installed', '1');
  INSTALL_BANNER_KILLED = true;
  document.getElementById('installBanner').hidden = true;
  document.body.classList.add('is-standalone');
}
function killInstallBanner() {
  INSTALL_BANNER_KILLED = true;
  document.getElementById('installBanner').hidden = true;
  deferredPrompt = null;
}
function applyStandaloneClass() {
  const on = isPWAInstalled();
  document.body.classList.toggle('is-standalone', on);
  if (on) markInstalled();
  return on;
}
if (isPWAInstalled()) markInstalled();
if (localStorage.getItem('ohmygoch_install_dismissed') === '1') INSTALL_BANNER_KILLED = true;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  if (INSTALL_BANNER_KILLED || isPWAInstalled()) { if (isPWAInstalled()) markInstalled(); return; }
  deferredPrompt = e;
  document.getElementById('installBanner').hidden = false;
});

document.getElementById('installBtn')?.addEventListener('click', async () => {
  if (INSTALL_BANNER_KILLED) return;
  if (isPWAInstalled()) { markInstalled(); return; }
  if (!deferredPrompt) { alert('📲 Menú ⋮ → Instalar aplicación'); return; }
  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') { markInstalled(); toast('¡Instalada! 🎉'); }
    else { killInstallBanner(); toast('Instalación cancelada'); }
  } catch { killInstallBanner(); }
  deferredPrompt = null;
});
document.getElementById('installAlreadyBtn')?.addEventListener('click', () => {
  localStorage.setItem('ohmygoch_installed', '1');
  killInstallBanner();
  document.body.classList.add('is-standalone');
  toast('✓ Banner silenciado');
});
document.getElementById('installClose')?.addEventListener('click', () => {
  localStorage.setItem('ohmygoch_install_dismissed', '1');
  killInstallBanner();
});
window.addEventListener('appinstalled', () => { markInstalled(); toast('OhMyGoch instalada'); });

/* ============================================================
   PWA · Online/Offline
   ============================================================ */
const offlineBanner = document.getElementById('offlineBanner');
let isConfirmedOffline = false;
let checkInFlight = false;

async function pingSelf() {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('./index.html?_=' + Date.now(), { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch { return false; }
}
function setOffline(offline) {
  if (offline === isConfirmedOffline) return;
  isConfirmedOffline = offline;
  if (offlineBanner) offlineBanner.hidden = !offline;
  document.documentElement.dataset.online = offline ? '0' : '1';
}
async function checkConnectivity() {
  if (checkInFlight) return;
  checkInFlight = true;
  try {
    if (navigator.onLine) { setOffline(false); return; }
    const alive = await pingSelf();
    setOffline(!alive);
  } finally { checkInFlight = false; }
}
setTimeout(checkConnectivity, 1500);
setInterval(checkConnectivity, 30000);
window.addEventListener('online', () => { setOffline(false); setTimeout(checkConnectivity, 2000); });
window.addEventListener('offline', () => setTimeout(checkConnectivity, 3000));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(checkConnectivity, 500);
});

/* ============================================================
   BOOT
   ============================================================ */
(async function boot() {
  applyStandaloneClass();

  // Init módulos de UI (wiring DOM, una sola vez)
  uiToday.init();
  uiWallet.init();
  uiImport.init();          // event modal
  uiMgmt.init();
  uiMgmt.initRangePicker();
  uiChat.init();
  uiMap.init();
  uiFreetour.init();

  await bootLock();
  settings.loadAutoLock();

  await handleJoin();
  await trips.ensureInitialized();

  await loadAll();
  await renderAll();
  await startSync();
  await refreshSubsystems();

  notif.loadSettings();

  // Migración silenciosa de adjuntos v1 → v2
  if (vault.isUnlocked()) {
    try {
      const result = await wallet.reencryptPlaintext();
      if (result.migrated > 0) {
        console.log(`🔐 Migrados ${result.migrated} archivos a cifrado en reposo`);
        await uiWallet.render();
      }
      if (result.orphans > 0) console.warn(`⚠️ ${result.orphans} archivos huérfanos`);
    } catch (err) { console.warn('[boot] migración falló:', err); }
  }

  if (IS_DEV) {
    console.log('🛠️  Modo DEV · SW desactivado');
    console.log('📚 Viaje:', ctx.trip?.title, '·', ctx.events.length, 'eventos',
                '· vault:', vault.isUnlocked() ? 'unlocked' : 'locked');
  } else {
    console.log('🌐 Modo PROD · registrando SW');
    registerSW();
  }

  // SW notification click
  navigator.serviceWorker?.addEventListener('message', ev => {
    if (ev.data?.type === 'notification-click' && ev.data.eventId) {
      const evt = ctx.events.find(x => x.id === ev.data.eventId);
      if (evt) { setView('today'); call('openEventModal', evt.id); }
    }
  });
})();
