/* ============================================================
   ui/chat.js · Render + send del chat
   ============================================================ */

import * as bus from './bus.js';
import * as chat from '../chat.js';
import * as vault from '../vault.js';
import { escapeHtml, toast } from './bus.js';

const { ctx } = bus;

export function init() {
  document.getElementById('chatSend')?.addEventListener('click', send);
  document.getElementById('chatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  chat.onNewMessage(() => render());
  chat.onStatusChange(() => render());
}

export async function render() {
  const list = document.getElementById('chatList');
  const empty = document.getElementById('chatEmpty');
  const count = document.getElementById('chatCount');
  const bar = document.getElementById('chatInputBar');
  if (!list || !empty || !bar) return;

  const messages = chat.getMessages();
  bar.hidden = !vault.isUnlocked();

  if (!messages.length) {
    list.innerHTML = '';
    empty.hidden = false;
    count.textContent = '—';
    return;
  }
  empty.hidden = true;
  count.textContent = String(messages.length);

  const myId = chat.getLocalId();
  const rows = await Promise.all(messages.map(async m => {
    const text = await chat.decryptMessageBody(m);
    const mine = m.authorId === myId;
    const time = new Date(m.createdAt).toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    let statusIcon = '';
    if (mine) {
      statusIcon = m.status === 'unsent' ? ' <span class="status">⚠</span>'
                 : m.status === 'pending' ? ' <span class="status">⏳</span>'
                 : ' <span class="status">✓</span>';
    }
    return `
      <li class="${mine ? 'chat__me' : ''}">
        <div class="bubble ${mine ? '' : 'bubble--other'}">${escapeHtml(text)}</div>
        <small>${mine ? '' : escapeHtml(m.authorName) + ' · '}${time}${statusIcon}</small>
      </li>`;
  }));

  list.innerHTML = rows.join('');
  requestAnimationFrame(() => {
    const scroller = list.closest('.scroll');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
}

async function send() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  if (!vault.isUnlocked()) { toast('Desbloqueá el vault primero'); return; }

  input.value = '';
  input.disabled = true;
  try {
    await chat.sendMessage(text);
  } catch (err) {
    toast('No se pudo enviar: ' + err.message);
    input.value = text;
  } finally {
    input.disabled = false;
    input.focus();
    await render();
  }
}