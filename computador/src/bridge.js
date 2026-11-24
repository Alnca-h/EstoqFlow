'use strict';
const { randomUUID } = require('node:crypto');
const { confirmOrder, registerRefill } = require('./database');
const { EventEmitter } = require('node:events');
class EspBridge extends EventEmitter {
  constructor(db, config, clientFactory) {
    super();
    this.db = db;
    this.config = config;
    this.clientFactory = clientFactory || ((url, options) => require('mqtt').connect(url, options));
    this.client = null;
    this.connected = false;
    this.stock = null;
    this.lastStockAt = 0;
    this.results = new Map();
  }
  get topics() {
    const root = this.config.baseTopic;
    return { cmd: `${root}/cmd`, state: `${root}/state`, result: `${root}/result`, refill: `${root}/refill` };
  }
  start() {
    const {host,port,mqttUsername,mqttPassword} = this.config;
    this.client = this.clientFactory(`mqtt://${host}:${port}`, {
      clientId: 'estoque-node-' + randomUUID().replaceAll('-', '').slice(0,12),
      protocolVersion: 4, reconnectPeriod: 5000, connectTimeout: 12000,
      keepalive: 45, clean: true, queueQoSZero: false,
      ...(mqttUsername ? { username: mqttUsername, password: mqttPassword || '' } : {}),
    });
    this.client.on('connect', () => {
      this.connected = true;
      const t = this.topics;
      this.client.subscribe([t.state, t.result, t.refill], { qos: 1 }, (err) => {
        if (err) console.warn('[MQTT] Erro ao inscrever:', err.message);
      });
      this.sync();
      console.log('[MQTT] Node.js conectado; aguardando dados do ESP32.');
    });
    this.client.on('close', () => { this.connected = false; this.stock = null; this.emit('offline'); });
    this.client.on('offline', () => { this.connected = false; this.emit('offline'); });
    this.client.on('error', err => console.warn('[MQTT] Falha de conexao:', err.message));
    this.client.on('message', (topic, data) => this.processMessage(topic, data));
  }
  stop() { if (this.client) this.client.end(true); this.connected = false; }
  publish(topic, obj, qos=1) {
    if (!this.connected || !this.client) return false;
    const payload = JSON.stringify(obj);
    try {
      this.client.publish(topic, payload, { qos, retain: false }, err => {
        if (err) console.warn('[MQTT] Falha ao publicar:', err.message);
      });
      return true;
    } catch (err) { console.warn('[MQTT] Publicacao falhou:', err.message); return false; }
  }
  sync() { return this.publish(this.topics.cmd, { type: 'sync' }); }
  processMessage(topic, raw) {
    if (!Buffer.isBuffer(raw)) raw = Buffer.from(raw);
    if (raw.length === 0 || raw.length > 2048) return false;
    let obj;
    try { obj = JSON.parse(raw.toString('utf8')); }
    catch { return false; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const t = this.topics;
    try {
      if (topic === t.state && obj.type === 'state') {
        const parsed = this.validateStock(obj.items);
        if (!parsed) return false;
        this.stock = parsed;
        this.lastStockAt = Date.now();
        this.emit('stock', parsed);
        return true;
      }
      if (topic === t.result && obj.type === 'result') {
        if (typeof obj.id !== 'string' || !/^[0-9a-f]{32}$/.test(obj.id) || typeof obj.ok !== 'boolean') return false;
        if (!confirmOrder(this.db, obj.id, obj)) return false;
        this.results.set(obj.id, obj);
        if (this.results.size > 100) this.results.delete(this.results.keys().next().value);
        this.emit('result', obj.id, obj);
        return true;
      }
      if (topic === t.refill && obj.type === 'refill') {
        if (registerRefill(this.db, obj)) {
          console.log(`[ESP32] Reposicao registrada: +${obj.qty} ${obj.name}`);
          this.emit('refill', obj);
          return true;
        }
      }
    } catch (err) {
      console.warn('[SEGURANCA] Mensagem MQTT rejeitada:', err.message);
    }
    return false;
  }
  validateStock(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 30) return null;
    const ids = new Set();
    const result = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') return null;
      const { id, qty, capacity, name } = item;
      if (!Number.isInteger(id) || id < 0 || id > 255 || ids.has(id) ||
          !Number.isInteger(qty) || qty < 0 || !Number.isInteger(capacity) ||
          capacity < 1 || capacity > 10000 || qty > capacity ||
          typeof name !== 'string' || name.length < 1 || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) return null;
      ids.add(id);
      result.push({ id, qty, capacity, name, pct: Math.round(qty * 1000 / capacity) / 10 });
    }
    return result;
  }
  getLiveStock() {
    return this.connected && this.stock && Date.now() - this.lastStockAt < 14000 ? this.stock : null;
  }
  async askForStock(timeoutMs = 12000) {
    if (!this.connected) return null;
    const existing = this.getLiveStock();
    if (existing) return existing;
    return new Promise(resolve => {
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.off('stock', onStock);
        this.off('offline', onOffline);
        resolve(value);
      };
      const onStock = items => finish(items);
      const onOffline = () => finish(null);
      const timer = setTimeout(() => finish(this.getLiveStock()), timeoutMs);
      this.on('stock', onStock);
      this.on('offline', onOffline);
      if (!this.sync()) finish(null);
    });
  }
  sendOrder(id, selections) {
    return this.publish(this.topics.cmd, {
      type: 'order', id,
      items: selections.map(item => ({ id: item.id, qty: item.qty }))
    });
  }
  async waitForResult(id, timeoutMs = 15000) {
    if (this.results.has(id)) {
      const result = this.results.get(id);
      this.results.delete(id);
      return result;
    }
    return new Promise(resolve => {
      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.off('result', onResult);
        resolve(value);
      };
      const onResult = (received, payload) => {
        if (received === id) {
          this.results.delete(id);
          finish(payload);
        }
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.on('result', onResult);
      if (this.results.has(id)) {
        const found = this.results.get(id);
        this.results.delete(id);
        finish(found);
      }
    });
  }
}
module.exports = { EspBridge };
