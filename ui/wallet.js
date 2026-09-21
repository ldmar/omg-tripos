/* ============================================================
   ui/wallet.js · Grid + Viewer + Categoría + Upload
   ============================================================ */

import * as bus from './bus.js';
import * as wallet from '../wallet.js';
import * as vault from '../vault.js';
import { escapeHtml, openModalEl, closeModalEl, toast, call } from './bus.js';

const { ctx } = bus;

let filter = 'all';
let filesCache = [];
let objectUrls = [];
let pendingFiles = [];
let pendingCategory = 'boarding';
let viewerFile = null;
let viewerUrl = null;
let currentViewerFileId = null;

export function init() {
  document.getElementById('walletUploadBtn')?.addEventListener('click', () => {
    document.getElementById('walletUploadInput').click();
  });
  document.getElementById('walletUploadInput')?.addEventListener('change', onUploadChange);
  document.getElementById('walletFilters')?.addEventListener('click', onFilterClick);
  document.getElementById('wcatGrid')?.addEventListener('click', onWcatClick);
  document.getElementById('wcatConfirm')?.addEventListener('click', onWcatConfirm);
  document.getElementById('walletCatModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-wcat-close') || e.target.closest('[data-wcat-close]')) closeModalEl(document.getElementById('walletCatModal'));
  });
  document.getElementById('wvClose')?.addEventListener('click', closeViewer);
  document.getElementById('wvShare')?.addEventListener('click', onShareViewer);
  document.getElementById('wvDownload')?.addEventListener('click', onDownloadViewer);
  document.getElementById('wvOpenNew')?.addEventListener('click', () => {
    if (viewerUrl) window.open(viewerUrl, '_blank', 'noopener');
  });
  document.getElementById('wvDelete')?.addEventListener('click', onDeleteViewer);
}

export async function render() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];

  try { filesCache = await wallet.getAllFiles(ctx.trip?.id); }
  catch (err) { console.error('Wallet load error:', err); filesCache = []; }

  const grid = document.getElementById('walletGrid');
  const empty = document.getElementById('walletEmpty');
  const stats = document.getElementById('walletStats');

  // Vault locked
  const anyLocked = filesCache.some(f => f.locked);
  if (anyLocked && !vault.isUnlocked()) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <div class="empty__icon">🔒</div>
        <h4>Documentos cifrados</h4>
        <p>Desbloqueá con tu PIN para verlos.</p>
        <div class="empty__actions">
          <button class="btn btn--primary" id="walletUnlockBtn">Desbloquear</button>
        </div>
      </div>`;
    empty.hidden = true;
    stats.textContent = `${filesCache.length} · 🔒`;
    document.getElementById('walletUnlockBtn')?.addEventListener('click', () => bus.emit('request-unlock'));
    return;
  }

  const count = filesCache.length;
  const totalBytes = filesCache.reduce((s, f) => s + (f.size || 0), 0);
  stats.textContent = count ? `${count} · ${wallet.fmtBytes(totalBytes)}` : 'Vacío';

  const list = filter === 'all' ? filesCache : filesCache.filter(f => f.category === filter);
  if (!list.length) {
    grid.innerHTML = '';
    empty.hidden = filesCache.length > 0;
    return;
  }
  empty.hidden = true;

  const cats = wallet.getCategories();
  grid.innerHTML = list.map(f => {
    const cat = cats[f.category] || cats.other;
    const isLinked = !!f.eventId;
    let thumbHtml = `<div class="wallet-card__thumb-icon">${cat.icon}</div>`;

    if (f.locked) {
      thumbHtml = `<div class="wallet-card__thumb-icon">🔒</div>`;
    } else if (f.thumbnail) {
      const url = URL.createObjectURL(f.thumbnail);
      objectUrls.push(url);
      thumbHtml = `<img src="${url}" alt="" loading="lazy" />`;
    } else if (wallet.isPdf(f)) {
      thumbHtml = `<div class="wallet-card__thumb-icon">📄</div>`;
    } else if (wallet.isImage(f) && f.blob) {
      const url = URL.createObjectURL(f.blob);
      objectUrls.push(url);
      thumbHtml = `<img src="${url}" alt="" loading="lazy" />`;
    }

    const date = new Date(f.uploadedAt).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'short',
    });

    return `
      <div class="wallet-card" data-file-id="${f.id}">
        <div class="wallet-card__thumb">
          ${thumbHtml}
          <div class="wallet-card__cat-badge">${cat.label}</div>
          ${isLinked ? '<div class="wallet-card__linked">🔗</div>' : ''}
        </div>
        <div class="wallet-card__body">
          <p class="wallet-card__name">${escapeHtml(f.name)}</p>
          <p class="wallet-card__meta"><span>${date}</span><span>${wallet.fmtBytes(f.size)}</span></p>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('[data-file-id]').forEach(el => {
    el.addEventListener('click', () => openViewer(el.dataset.fileId));
  });
}

/* ---------- Upload ---------- */
function onFilterClick(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  filter = chip.dataset.cat;
  document.querySelectorAll('#walletFilters .chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.cat === filter);
  });
  render();
}

async function onUploadChange(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!ctx.trip?.id) { toast('Creá un viaje primero'); return; }
  if (!files.length) return;

  if (!vault.isUnlocked()) {
    const go = confirm('No hay PIN configurado. Los archivos se guardarán SIN cifrar.\n\n¿Configurar PIN ahora?');
    if (go) {
      bus.emit('request-unlock');
      return;
    }
  }

  const valid = files.filter(f => {
    if (f.size > 15 * 1024 * 1024) { toast(`${f.name} · más de 15MB`); return false; }
    return true;
  });
  if (!valid.length) return;

  pendingFiles = valid;
  pendingCategory = wallet.autoCategory?.(valid[0], null) || 'boarding';
  openWcat();
}

/* ---------- Category modal ---------- */
function openWcat() {
  const cats = wallet.getCategories();
  document.getElementById('wcatFiles').innerHTML = pendingFiles.length === 1
    ? `<strong>${escapeHtml(pendingFiles[0].name)}</strong> · ${wallet.fmtBytes(pendingFiles[0].size)}`
    : `<strong>${pendingFiles.length} archivos</strong> por subir`;
  document.getElementById('wcatGrid').innerHTML = Object.entries(cats).map(([k, v]) => `
    <button type="button" class="wcat__item ${k === pendingCategory ? 'is-active' : ''}" data-cat="${k}" style="--wcat-c:${v.color}">
      <span class="wcat__item-check">✓</span>
      <span class="wcat__item-icon">${v.icon}</span>
      <span>${v.label}</span>
    </button>`).join('');
  openModalEl(document.getElementById('walletCatModal'));
}

function onWcatClick(e) {
  const btn = e.target.closest('.wcat__item');
  if (!btn) return;
  pendingCategory = btn.dataset.cat;
  document.querySelectorAll('#wcatGrid .wcat__item').forEach(b => {
    b.classList.toggle('is-active', b.dataset.cat === pendingCategory);
  });
}

async function onWcatConfirm() {
  if (!pendingFiles.length) return;
  let ok = 0, fail = 0;
  for (const f of pendingFiles) {
    try {
      await wallet.saveFile(f, { tripId: ctx.trip?.id, category: pendingCategory });
      ok++;
    } catch (err) {
      console.warn(err); fail++;
    }
  }
  closeModalEl(document.getElementById('walletCatModal'));
  pendingFiles = [];
  await render();
  if (ok && !fail) toast(`✓ ${ok} archivo${ok > 1 ? 's' : ''} subido${ok > 1 ? 's' : ''}`);
  else if (ok && fail) toast(`${ok} subidos · ${fail} con error`);
  else toast('No se pudo subir');
}

/* ---------- Viewer ---------- */
async function openViewer(fileId) {
  const file = await wallet.getFile(fileId);
  if (!file) { toast('Archivo no encontrado'); return; }
  if (file.locked) { toast('Desbloqueá para verlo'); return; }

  viewerFile = file;
  currentViewerFileId = fileId;
  document.getElementById('wvName').textContent = file.name;

  const content = document.getElementById('wvContent');
  content.innerHTML = '';
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = URL.createObjectURL(file.blob);

  if (wallet.isPdf(file)) {
    const iframe = document.createElement('iframe');
    iframe.src = viewerUrl;
    iframe.title = file.name;
    content.appendChild(iframe);
  } else if (wallet.isImage(file)) {
    const img = document.createElement('img');
    img.src = viewerUrl;
    img.alt = file.name;
    content.appendChild(img);
  } else {
    content.innerHTML = `<div class="wallet-viewer__error">Este tipo no se puede visualizar.<br>Tocá ⬇ para descargarlo.</div>`;
  }
  openModalEl(document.getElementById('walletViewer'));
}

function closeViewer() {
  closeModalEl(document.getElementById('walletViewer'));
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
  document.getElementById('wvContent').innerHTML = '';
  viewerFile = null;
  currentViewerFileId = null;
}

async function onShareViewer() {
  if (!viewerFile) return;
  try {
    if (navigator.share && navigator.canShare?.({ files: [viewerFile.blob] })) {
      await navigator.share({
        files: [new File([viewerFile.blob], viewerFile.name, { type: viewerFile.mime })],
        title: viewerFile.name,
      });
    } else toast('Compartir no soportado · usá Descargar');
  } catch (err) { if (err.name !== 'AbortError') toast('No se pudo compartir'); }
}

function onDownloadViewer() {
  if (!viewerFile || !viewerUrl) return;
  const a = document.createElement('a');
  a.href = viewerUrl;
  a.download = viewerFile.name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast('Descargando…');
}

async function onDeleteViewer() {
  if (!currentViewerFileId) return;
  if (!confirm(`¿Eliminar "${viewerFile.name}"?`)) return;
  await wallet.deleteFile(currentViewerFileId);
  closeViewer();
  await render();
  toast('Archivo eliminado');
}

/* ---------- Refresh desde app ---------- */
export async function refresh() { await render(); }