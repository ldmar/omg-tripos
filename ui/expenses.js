/* ============================================================
   ui/expenses.js · Sección de gastos en el tab Grupo
   - Render balance por viajero + settlements + lista
   - El modal de crear/editar viene en F5.3 (slot openExpenseModal)
   ============================================================ */

import * as bus from './bus.js';
import * as expenses from '../expenses.js';
import * as trips from '../trips.js';
import { escapeHtml, toast, call } from './bus.js';

const { ctx } = bus;

/* ---------- Estado del módulo ---------- */
let cachedTravelers = [];
let cachedExpenses  = [];

/* ============================================================
   Init
   ============================================================ */
export function init() {
  document.getElementById('expensesAddBtn')?.addEventListener('click', openAddExpense);
  document.getElementById('expensesList')?.addEventListener('click', onExpenseClick);
}

function openAddExpense() {
  if (!ctx.trip?.id) { toast('Sin viaje activo'); return; }
  if (!bus.ctx.openExpenseModal) {
    toast('Próximamente: modal de gastos');
    return;
  }
  call('openExpenseModal');
}

function onExpenseClick(e) {
  const card = e.target.closest('[data-expense-id]');
  if (!card) return;
  if (!bus.ctx.openExpenseModal) return;
  call('openExpenseModal', card.dataset.expenseId);
}

/* ============================================================
   Render principal
   ============================================================ */
export async function render() {
  if (!ctx.trip?.id) return;

  try {
    cachedTravelers = await trips.getTravelersByTrip(ctx.trip.id);
  } catch { cachedTravelers = []; }

  try {
    cachedExpenses = await expenses.getAllExpenses(ctx.trip.id);
  } catch { cachedExpenses = []; }

  renderBalance();
  renderSettlements();
  renderList();
}

/* ============================================================
   Helpers de viajero
   ============================================================ */
function travelerById(id) {
  return cachedTravelers.find(t => t.id === id) || null;
}
function travelerLabel(id) {
  return travelerById(id)?.name || 'Desconocido';
}
function travelerColor(id) {
  return travelerById(id)?.color || '#8a8d94';
}
function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2)
    .map(w => w[0] || '').join('').toUpperCase() || '?';
}
function currentCurrency() {
  return cachedExpenses[0]?.currency || ctx.trip?.currency || 'EUR';
}

/* ============================================================
   Balance por viajero
   ============================================================ */
function renderBalance() {
  const el = document.getElementById('expensesBalance');
  if (!el) return;

  if (!cachedTravelers.length) {
    el.innerHTML = '';
    return;
  }

  const ids = cachedTravelers.map(t => t.id);
  const balances = expenses.computeBalances(cachedExpenses, ids);
  const cur = currentCurrency();

  el.innerHTML = cachedTravelers.map(t => {
    const b = balances[t.id] || { balance: 0 };
    const net = b.balance;

    let cls = 'expenses-balance__row';
    let sign = '';
    if (net > 0.01)       { cls += ' is-credit'; sign = '+'; }
    else if (net < -0.01) { cls += ' is-debt';   sign = '-'; }

    const amount = Math.abs(net).toFixed(2);

    return `
      <div class="${cls}">
        <div class="expenses-balance__avatar" style="--a:${t.color}">
          ${escapeHtml(initials(t.name))}
        </div>
        <span class="expenses-balance__name">${escapeHtml(t.name)}</span>
        <span class="expenses-balance__amount">${sign}${amount} ${cur}</span>
      </div>`;
  }).join('');
}

/* ============================================================
   Settlements · "cómo saldar"
   ============================================================ */
function renderSettlements() {
  const wrap = document.getElementById('expensesSettlements');
  const list = document.getElementById('expensesSettlementsList');
  if (!wrap || !list) return;

  if (!cachedTravelers.length || !cachedExpenses.length) {
    wrap.hidden = true;
    return;
  }

  const ids = cachedTravelers.map(t => t.id);
  const balances = expenses.computeBalances(cachedExpenses, ids);
  const settlements = expenses.computeSettlements(balances);

  if (!settlements.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const cur = currentCurrency();

  list.innerHTML = settlements.map(s => `
    <li class="expenses-settle__item">
      <span class="expenses-settle__from">${escapeHtml(travelerLabel(s.from))}</span>
      <svg class="expenses-settle__arrow" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6"/>
      </svg>
      <span class="expenses-settle__to">${escapeHtml(travelerLabel(s.to))}</span>
      <span class="expenses-settle__amount">${s.amount.toFixed(2)} ${cur}</span>
    </li>
  `).join('');
}

/* ============================================================
   Lista de gastos
   ============================================================ */
function renderList() {
  const el = document.getElementById('expensesList');
  const empty = document.getElementById('expensesEmpty');
  if (!el || !empty) return;

  if (!cachedExpenses.length) {
    el.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const cats = expenses.getCategories();

  el.innerHTML = cachedExpenses.map(ex => {
    const cat = cats[ex.category] || cats.other;
    const payerName = travelerLabel(ex.paidBy);
    const amongCount = (ex.splitAmong?.length) || cachedTravelers.length;
    const date = new Date(ex.createdAt).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'short',
    });

    const title = ex.locked ? '🔒 Gasto' : (ex.title || 'Gasto');
    const amount = Number(ex.amount).toFixed(2);

    return `
      <article class="expense-card" data-expense-id="${ex.id}">
        <div class="expense-card__ico" style="--c:${cat.color}">${cat.icon}</div>
        <div class="expense-card__body">
          <h5 class="expense-card__title">${escapeHtml(title)}</h5>
          <p class="expense-card__meta">
            Pagó ${escapeHtml(payerName)} · ${amongCount} pers. · ${date}
          </p>
        </div>
        <div class="expense-card__amount">${amount} ${escapeHtml(ex.currency || 'EUR')}</div>
      </article>`;
  }).join('');
}