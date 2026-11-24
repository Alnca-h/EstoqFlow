'use strict';
const { normalizeDate, normalizeMonth } = require('./dates');
const { savePending, listOrders, listMovements, getPending } = require('./database');

class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function fail(msg, status) { throw new RequestError(msg, status); }
function currentStock(bridge) {
  const items = bridge.getLiveStock();
  if (!items || !items.length) return {
    online: false, mqtt_connected: bridge.connected, items: [], worst_pct: null,
    led: null, message: 'ESP32 sem dados recentes. Inicie a simulação no Wokwi.'
  };
  const worst = Math.min(...items.map(it => Math.trunc(100 * it.qty / it.capacity)));
  return { online: true, mqtt_connected: bridge.connected, items,
           worst_pct: worst, led: worst >= 80 ? 'verde' : worst >= 30 ? 'amarelo' : 'vermelho' };
}
function statusResponse(id, result) {
  if (result === null) return {statusCode:202, body: {
    ok: true, status:'PENDENTE', id,
    message: 'Pedido enviado, mas o ESP32 ainda não confirmou. Confira o histórico antes de reenviar.'
  }};
  if (result.ok === true) return {statusCode:200, body: {
    ok:true,status:'CONFIRMADO',id,
    message:'Pedido confirmado! Os materiais foram descontados no ESP32.'
  }};
  throw new RequestError(String(result.error || 'Pedido recusado pelo ESP32.').slice(0,250),409);
}
async function placeOrder(db, bridge, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Formato de pedido inválido.');
  const {requester,description,date,items} = payload;
  if (typeof requester !== 'string' || requester.trim().length < 1 || requester.trim().length > 100)
    fail('Informe o nome do solicitante (até 100 caracteres).');
  if (typeof description !== 'string' || description.trim().length < 1 || description.trim().length > 500)
    fail('Informe a descrição do pedido (até 500 caracteres).');
  if (typeof date !== 'string') fail('Informe uma data no formato dd/mm/aa.');
  let dateIso;
  try { dateIso = normalizeDate(date); } catch (err) { fail(err.message); }
  if (!Array.isArray(items) || items.length < 1) fail('Selecione pelo menos um material.');
  if (items.length > 30) fail('Quantidade de tipos de materiais acima do limite.');

  const stock = await bridge.askForStock();
  if (!stock) fail('ESP32 sem resposta. Inicie a simulação Wokwi.',503);
  const available = new Map(stock.map(it => [it.id, it]));
  const seen = new Set();
  const selections = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Lista de materiais inválida.');
    if (!Number.isInteger(item.id) || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 10000)
      fail('Material e quantidade devem ser números inteiros válidos.');
    if (seen.has(item.id)) fail('Um mesmo material não pode aparecer duas vezes.');
    const entry = available.get(item.id);
    if (!entry) fail('Material não encontrado no estoque do ESP32.');
    if (item.qty > entry.qty) fail(`Estoque insuficiente de ${entry.name}.`,409);
    seen.add(item.id);
    selections.push({ id: item.id, name: entry.name, qty: item.qty });
  }
  const id = savePending(db, requester.trim(), dateIso, description.trim(), selections);
  if (!bridge.sendOrder(id, selections)) return {statusCode:202,body: {
    ok:true,status:'PENDENTE',id,
    message:'Pedido salvo como pendente: falha ao enviar por MQTT. Você poderá reenviá-lo pelo histórico.'
  }};
  return statusResponse(id, await bridge.waitForResult(id));
}
async function resendOrder(db, bridge, id) {
  if (!/^[0-9a-f]{32}$/.test(id)) fail('Identificador de pedido inválido.');
  const stored = getPending(db,id);
  if (!stored) fail('Pedido não encontrado.',404);
  if (stored.status !== 'PENDENTE') fail('Esse pedido não está pendente.',409);
  if (!stored.items.length) fail('Esse pedido não contém materiais.',409);
  if (!await bridge.askForStock()) fail('ESP32 offline. Não foi possível reenviar.',503);
  if (!bridge.sendOrder(id,stored.items)) fail('Sem conexão MQTT. O pedido permanece pendente.',503);
  return statusResponse(id,await bridge.waitForResult(id));
}
function getOrders(db,period) { return {ok:true,orders:listOrders(db,normalizeMonth(period)),period:normalizeMonth(period)}; }
function getMovements(db,period) { return {ok:true,movements:listMovements(db,normalizeMonth(period)),period:normalizeMonth(period)}; }
module.exports = { RequestError, currentStock, statusResponse, placeOrder, resendOrder, getOrders, getMovements };
