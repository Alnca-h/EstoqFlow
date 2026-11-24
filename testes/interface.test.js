'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const publicDir = join(__dirname, '..', 'computador', 'public');
const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
const js = readFileSync(join(publicDir, 'app.js'), 'utf8');
const css = readFileSync(join(publicDir, 'style.css'), 'utf8');

test('site mantém as quatro telas e formulários', () => {
  for (const tela of ['painel', 'novo', 'pedidos', 'movimentacoes']) {
    assert.ok(html.includes(`id="view-${tela}"`));
  }
  for (const campo of ['requester', 'order-date', 'description', 'order-items']) {
    assert.ok(html.includes(`id="${campo}"`));
  }
});

test('site mostra apenas quantidade dos materiais', () => {
  assert.match(js, /Disponível: \$\{item\.qty\}/);
  assert.doesNotMatch(js, /Disponível:.*item\.capacity/);
  assert.doesNotMatch(js, /materialPct|displayPct|statusColor/);
  assert.match(js, /stock-num/);
});

test('site não mostra data, conexão e avisos retirados', () => {
  assert.doesNotMatch(html, /id="clock"|id="connection"|Reposição protegida|Como funciona o indicador/);
  assert.doesNotMatch(css, /\.topbar|\.connection-pill|\.explainer/);
  assert.match(html, /id="order-form"/);
});

test('pedidos e históricos continuam ligados à API Node.js', () => {
  for (const endpoint of ['/api/estoque', '/api/pedidos', '/api/movimentacoes']) {
    assert.ok(js.includes(endpoint));
  }
  assert.match(js, /api\/pedidos\/\$\{id\}\/reenviar/);
});
