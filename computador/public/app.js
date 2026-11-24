'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const appState = { online: false, items: [], quantities: new Map(), stockSignature: '', fetching: false };
const sectionNames = { painel: 'Visão geral', novo: 'Novo pedido', pedidos: 'Histórico de pedidos', movimentacoes: 'Movimentações' };
let toastTimer;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}
function pad(value) { return String(value).padStart(2, '0'); }
function dateToday() {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}
function monthToday() {
  const d = new Date();
  return `${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}
function showToast(message, kind = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast ${kind === 'error' ? 'error' : kind === 'warning' ? 'warning' : ''}`;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 6500);
}
async function fetchJSON(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('O servidor enviou uma resposta inválida.'); }
  if (!response.ok) throw new Error(data.message || 'Não foi possível completar a operação.');
  return data;
}
function validDate(value) {
  if (!/^\d{2}\/\d{2}\/\d{2}$/.test(value)) return false;
  const [day, month, year] = value.split('/').map(Number);
  const fullYear = year <= 68 ? 2000 + year : 1900 + year;
  const parsed = new Date(fullYear, month - 1, day);
  return parsed.getFullYear() === fullYear && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}
function validMonth(value) {
  return /^(0[1-9]|1[0-2])\/\d{2}$/.test(value);
}

function navigate(view) {
  const name = sectionNames[view] ? view : 'painel';
  $$('.view').forEach((section) => {
    section.classList.toggle('active', section.id === `view-${name}`);
    section.hidden = section.id !== `view-${name}`;
  });
  $$('.nav-button').forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.location.hash = name;
  if (name === 'pedidos') loadOrders();
  if (name === 'movimentacoes') loadMovements();
}
function renderStockGrid(items) {
  const grid = $('#stock-grid');
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state full-width">Nenhum saldo recente. Inicie o ESP32 no Wokwi e confirme a conexão Wi-Fi/MQTT.</div>';
    return;
  }
  grid.innerHTML = items.map((item) => `
    <article class="stock-card">
      <div class="stock-head"><span class="stock-name">${escapeHTML(item.name)}</span></div>
      <div class="stock-num">${item.qty} <span>${item.qty === 1 ? 'unidade' : 'unidades'}</span></div>
    </article>
  `).join('');
}
function renderOrderMaterials() {
  const root = $('#order-items');
  if (!appState.online) {
    root.innerHTML = '<div class="empty-state">O ESP32 precisa estar conectado para registrar pedidos.</div>';
    updateOrderSummary();
    return;
  }
  root.innerHTML = appState.items.map((item) => {
    const number = appState.quantities.get(item.id) || 0;
    return `<div class="order-item"><div><div class="order-item-title">${escapeHTML(item.name)}</div><div class="order-item-detail">Disponível: ${item.qty}</div></div>
      <div class="quantity-control"><button type="button" data-step="-1" data-id="${item.id}" aria-label="Diminuir ${escapeHTML(item.name)}">−</button>
      <input type="number" inputmode="numeric" min="0" max="10000" step="1" value="${number}" data-qty="${item.id}" aria-label="Quantidade de ${escapeHTML(item.name)}">
      <button type="button" data-step="1" data-id="${item.id}" aria-label="Aumentar ${escapeHTML(item.name)}">+</button></div></div>`;
  }).join('');
  updateOrderSummary();
}
function updateOrderSummary() {
  const selected = appState.items.filter((item) => (appState.quantities.get(item.id) || 0) > 0);
  const total = selected.reduce((sum, item) => sum + appState.quantities.get(item.id), 0);
  const invalid = selected.some((item) => {
    const qty = appState.quantities.get(item.id);
    return !Number.isInteger(qty) || qty < 0 || qty > item.qty || qty > 10000;
  });
  $('#order-total').textContent = `${total} ${total === 1 ? 'unidade' : 'unidades'}`;
  $('#submit-order').disabled = !appState.online || !selected.length || invalid;
  const summary = $('#order-summary');
  summary.innerHTML = !selected.length ? '<span class="muted">Nenhum item selecionado.</span>' : selected.map((item) =>
    `<div class="summary-line"><span>${escapeHTML(item.name)}</span><strong>${appState.quantities.get(item.id)} un.</strong></div>`
  ).join('') + (invalid ? '<span class="error-details">Quantidade acima do estoque disponível.</span>' : '');
}
function updateStock(data) {
  appState.online = !!data.online;
  appState.items = data.items || [];
  renderStockGrid(appState.online ? appState.items : []);
  const signature = JSON.stringify(appState.online ? appState.items : []);
  if (signature !== appState.stockSignature) {
    appState.stockSignature = signature;
    renderOrderMaterials();
  }
}
async function refreshStock() {
  if (appState.fetching) return;
  appState.fetching = true;
  try { updateStock(await fetchJSON('/api/estoque')); }
  catch { updateStock({ online: false, mqtt_connected: false, items: [] }); }
  finally { appState.fetching = false; }
}
async function placeOrder(event) {
  event.preventDefault();
  const requester = $('#requester').value.trim();
  const date = $('#order-date').value.trim();
  const description = $('#description').value.trim();
  const items = appState.items.filter((item) => appState.quantities.get(item.id) > 0)
    .map((item) => ({ id: item.id, qty: appState.quantities.get(item.id) }));
  if (!requester || requester.length > 100) return showToast('Informe o nome do solicitante.', 'error');
  if (!validDate(date)) return showToast('Informe uma data válida no formato dd/mm/aa.', 'error');
  if (!description || description.length > 500) return showToast('Informe a descrição do pedido.', 'error');
  if (!items.length) return showToast('Selecione pelo menos um material.', 'error');
  if (!appState.online) return showToast('ESP32 desconectado. Inicie o Wokwi.', 'error');
  if (items.some(({ id, qty }) => !Number.isInteger(qty) || qty <= 0 || qty > appState.items.find((i) => i.id === id).qty)) {
    return showToast('A quantidade solicitada excede o estoque disponível.', 'error');
  }
  const button = $('#submit-order');
  button.disabled = true;
  button.textContent = 'Enviando para o ESP32...';
  try {
    const result = await fetchJSON('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester, date, description, items }) });
    showToast(result.message, result.status === 'PENDENTE' ? 'warning' : 'success');
    appState.quantities.clear();
    $('#order-form').reset();
    $('#order-date').value = dateToday();
    renderOrderMaterials();
    await refreshStock();
    navigate('pedidos');
  } catch (error) {
    showToast(error.message, 'error');
    await refreshStock();
  } finally {
    button.textContent = 'Confirmar pedido →';
    updateOrderSummary();
  }
}
function statusTag(status) {
  const value = String(status || '').toLowerCase();
  const css = ['confirmado', 'pendente', 'recusado'].includes(value) ? value : 'pendente';
  return `<span class="status-tag ${css}">${escapeHTML(status)}</span>`;
}
async function loadOrders() {
  const root = $('#orders-results');
  const period = $('#orders-month').value.trim();
  if (!validMonth(period)) return showToast('Use o formato mm/aa para o mês.', 'error');
  root.innerHTML = '<div class="empty-state">Carregando pedidos...</div>';
  try {
    const data = await fetchJSON(`/api/pedidos?period=${encodeURIComponent(period)}`);
    if (!data.orders.length) { root.innerHTML = '<div class="empty-state">Nenhum pedido encontrado para este mês.</div>'; return; }
    root.innerHTML = `<table class="data-table"><thead><tr><th>Data / solicitante</th><th>Pedido e materiais</th><th>Status</th></tr></thead><tbody>${data.orders.map((o) =>
      `<tr><td><strong>${escapeHTML(o.requester)}</strong><br>${escapeHTML(o.date)}</td><td><strong>${escapeHTML(o.description)}</strong>
        <ul class="list-details">${o.items.map((i) => `<li>${escapeHTML(i.name)}: ${i.qty} un.</li>`).join('')}</ul></td>
        <td>${statusTag(o.status)}${o.error ? `<span class="error-details">${escapeHTML(o.error)}</span>` : ''}
        ${o.status === 'PENDENTE' ? `<button type="button" class="retry" data-retry="${o.id}">Reenviar pedido</button>` : ''}</td></tr>`
    ).join('')}</tbody></table>`;
  } catch (error) { root.innerHTML = `<div class="empty-state">${escapeHTML(error.message)}</div>`; }
}
async function loadMovements() {
  const root = $('#movements-results');
  const period = $('#movements-month').value.trim();
  if (!validMonth(period)) return showToast('Use o formato mm/aa para o mês.', 'error');
  root.innerHTML = '<div class="empty-state">Carregando movimentações...</div>';
  try {
    const data = await fetchJSON(`/api/movimentacoes?period=${encodeURIComponent(period)}`);
    if (!data.movements.length) { root.innerHTML = '<div class="empty-state">Nenhuma movimentação encontrada para este mês.</div>'; return; }
    root.innerHTML = `<table class="data-table"><thead><tr><th>Data</th><th>Material</th><th>Movimentação</th><th>Quantidade</th></tr></thead><tbody>${data.movements.map((m) =>
      `<tr><td>${escapeHTML(m.date)}</td><td><strong>${escapeHTML(m.name)}</strong></td>
      <td><span class="direction ${m.direction === 'ENTRADA' ? 'entrada' : 'saida'}">${m.direction === 'ENTRADA' ? '↓ Entrada' : '↑ Saída'}</span></td>
      <td><strong>${m.direction === 'ENTRADA' ? '+' : '−'}${m.qty}</strong></td></tr>`
    ).join('')}</tbody></table>`;
  } catch (error) { root.innerHTML = `<div class="empty-state">${escapeHTML(error.message)}</div>`; }
}
async function retryOrder(event) {
  const button = event.target.closest('[data-retry]');
  if (!button) return;
  const id = button.dataset.retry;
  if (!/^[a-f0-9]{32}$/.test(id)) return;
  button.disabled = true;
  button.textContent = 'Reenviando...';
  try {
    const data = await fetchJSON(`/api/pedidos/${id}/reenviar`, { method: 'POST' });
    showToast(data.message, data.status === 'PENDENTE' ? 'warning' : 'success');
  } catch (error) { showToast(error.message, 'error'); }
  finally { await loadOrders(); await refreshStock(); }
}
function setQuantity(id, value) {
  const quantity = Math.max(0, Math.min(10000, Number.isInteger(value) ? value : 0));
  appState.quantities.set(id, quantity);
  const control = $(`[data-qty="${id}"]`);
  if (control) control.value = String(quantity);
  updateOrderSummary();
}

document.addEventListener('DOMContentLoaded', () => {
  $('#order-date').value = dateToday();
  $('#orders-month').value = monthToday();
  $('#movements-month').value = monthToday();
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('#refresh-stock').addEventListener('click', refreshStock);
  $('#order-form').addEventListener('submit', placeOrder);
  $('#orders-filter').addEventListener('submit', (event) => { event.preventDefault(); loadOrders(); });
  $('#movements-filter').addEventListener('submit', (event) => { event.preventDefault(); loadMovements(); });
  $('#orders-results').addEventListener('click', retryOrder);
  $('#order-items').addEventListener('input', (event) => {
    if (!event.target.matches('[data-qty]')) return;
    const id = Number(event.target.dataset.qty);
    setQuantity(id, Number(event.target.value));
  });
  $('#order-items').addEventListener('click', (event) => {
    const button = event.target.closest('[data-step]');
    if (!button) return;
    const id = Number(button.dataset.id);
    setQuantity(id, (appState.quantities.get(id) || 0) + Number(button.dataset.step));
  });
  const initial = window.location.hash.slice(1);
  navigate(initial && sectionNames[initial] ? initial : 'painel');
  refreshStock();
  window.setInterval(refreshStock, 5000);
});
