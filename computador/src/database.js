'use strict';
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const { normalizeDate, dateDisplay, localToday } = require('./dates');

const DB_PATH = join(__dirname, '..', 'historico_estoque.db');
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
function openDatabase(path = DB_PATH) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 8000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      requester TEXT NOT NULL,
      order_date TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS order_items (
      order_id TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      PRIMARY KEY (order_id, item_id),
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );
    CREATE TABLE IF NOT EXISTS movements (
      id TEXT PRIMARY KEY,
      movement_date TEXT NOT NULL,
      direction TEXT NOT NULL,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      order_id TEXT
    );
  `);
  return db;
}
function savePending(db, requester, dateIso, description, selections) {
  const id = randomUUID().replaceAll('-', '');
  transaction(db, () => {
    db.prepare(`INSERT INTO orders (id, requester, order_date, description, status)
                VALUES (?, ?, ?, ?, 'PENDENTE')`).run(id, requester, dateIso, description);
    const stmt = db.prepare(`INSERT INTO order_items (order_id, item_id, item_name, quantity)
                             VALUES (?, ?, ?, ?)`);
    for (const item of selections) stmt.run(id, item.id, item.name, item.qty);
  });
  return id;
}
function confirmOrder(db, id, response) {
  if (!/^[0-9a-f]{32}$/.test(id) || typeof response?.ok !== 'boolean') return false;
  return transaction(db, () => {
    const order = db.prepare('SELECT status, order_date FROM orders WHERE id = ?').get(id);
    if (!order || order.status !== 'PENDENTE') return false;
    if (response.ok === true) {
      db.prepare("UPDATE orders SET status='CONFIRMADO' WHERE id=?").run(id);
      const items = db.prepare('SELECT item_id, item_name, quantity FROM order_items WHERE order_id = ?').all(id);
      const insert = db.prepare(`INSERT OR IGNORE INTO movements
        (id, movement_date, direction, item_name, quantity, order_id)
        VALUES (?, ?, 'SAIDA', ?, ?, ?)`);
      for (const item of items) insert.run(`out:${id}:${item.item_id}`, order.order_date,
                                           item.item_name, item.quantity, id);
    } else {
      const error = typeof response.error === 'string' ? response.error.slice(0, 250) : 'Pedido recusado pelo ESP32';
      db.prepare("UPDATE orders SET status='RECUSADO', error=? WHERE id=?").run(error, id);
    }
    return true;
  });
}
function registerRefill(db, p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (typeof p.event_id !== 'string' || !/^[0-9]{1,10}-[a-fA-F0-9]{1,8}$/.test(p.event_id)) return false;
  if (!Number.isInteger(p.item_id) || p.item_id < 0 || p.item_id > 255) return false;
  if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > 10000) return false;
  if (typeof p.name !== 'string' || p.name.length < 1 || p.name.length > 40 || /[\x00-\x1f\x7f]/.test(p.name)) return false;
  let when = localToday();
  if (typeof p.when === 'string') {
    const match = /^(\d{2}\/\d{2}\/\d{2}) (\d{2}):(\d{2})$/.exec(p.when);
    if (match && Number(match[2]) < 24 && Number(match[3]) < 60) {
      try { when = normalizeDate(match[1]); } catch {}
    }
  }
  const result = db.prepare(`INSERT OR IGNORE INTO movements (id, movement_date, direction, item_name, quantity)
                             VALUES (?, ?, 'ENTRADA', ?, ?)`).run(`refill:${p.event_id}`, when, p.name, p.qty);
  return result.changes > 0;
}
function listOrders(db, period) {
  const rows = db.prepare(`SELECT id, requester, order_date, description, status, error
                           FROM orders WHERE substr(order_date,1,7)=?
                           ORDER BY order_date DESC, rowid DESC`).all(period);
  const byOrder = db.prepare('SELECT item_name, quantity FROM order_items WHERE order_id=? ORDER BY item_id');
  return rows.map(row => ({
    id: row.id, requester: row.requester, date: dateDisplay(row.order_date),
    description: row.description, status: row.status, error: row.error,
    items: byOrder.all(row.id).map(it => ({ name: it.item_name, qty: it.quantity }))
  }));
}
function listMovements(db, period) {
  return db.prepare(`SELECT movement_date, direction, item_name, quantity, order_id
                     FROM movements WHERE substr(movement_date,1,7)=?
                     ORDER BY movement_date DESC, rowid DESC`).all(period).map(row => ({
    date: dateDisplay(row.movement_date), direction: row.direction, name: row.item_name,
    qty: row.quantity, order_id: row.order_id,
  }));
}
function getPending(db, id) {
  const order = db.prepare('SELECT status FROM orders WHERE id=?').get(id);
  if (!order) return null;
  const items = db.prepare('SELECT item_id, item_name, quantity FROM order_items WHERE order_id=? ORDER BY item_id')
                  .all(id).map(row => ({id:row.item_id,name:row.item_name,qty:row.quantity}));
  return { status: order.status, items };
}
module.exports = { DB_PATH, openDatabase, savePending, confirmOrder, registerRefill,
                   listOrders, listMovements, getPending, transaction };
