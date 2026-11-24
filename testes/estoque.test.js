'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { openDatabase,savePending,confirmOrder,registerRefill,listOrders,listMovements,getPending } = require('../computador/src/database');
const { normalizeDate,normalizeMonth } = require('../computador/src/dates');
const { EspBridge } = require('../computador/src/bridge');
const { placeOrder,resendOrder,currentStock,RequestError } = require('../computador/src/operations');

const stock = [
  {id:0,name:'Papel A4',qty:100,capacity:100},
  {id:1,name:'Caneta',qty:80,capacity:80},
  {id:2,name:'Lapis',qty:60,capacity:60},
  {id:3,name:'Borracha',qty:50,capacity:50},
  {id:4,name:'Pasta',qty:40,capacity:40},
];
const config = { host:'test.mosquitto.org',port:1883,baseTopic:'estoque-aula-7c282d2689' };
const fresh = () => openDatabase(':memory:');
function fakeBridge(db) {
  const bridge = new EspBridge(db,config);
  bridge.connected = true;
  bridge.stock = stock.map(it=>({...it}));
  bridge.lastStockAt = Date.now();
  bridge.sendOrder = (id,items) => {
    const reply = {type:'result',id,ok:true};
    bridge.processMessage(bridge.topics.result,Buffer.from(JSON.stringify(reply)));
    return true;
  };
  return bridge;
}
const request = (items = [{id:0,qty:2}]) => ({ requester:'Teste',date:'23/11/26',description:'Oficina',items });

test('data dd/mm/aa e filtro mm/aa (inclui anos bissextos)',() => {
  assert.equal(normalizeDate('23/11/26'),'2026-11-23');
  assert.equal(normalizeDate('29/02/24'),'2024-02-29');
  assert.equal(normalizeMonth('11/26'),'2026-11');
  assert.throws(()=>normalizeDate('31/02/26'));
  assert.throws(()=>normalizeMonth('13/26'));
});
test('banco mantém esquema original e registra pedido pendente',() => {
  const db=fresh();
  try {
    const id=savePending(db,'Teste','2026-11-23','Oficina',[{id:0,name:'Papel A4',qty:10}]);
    assert.match(id,/^[a-f0-9]{32}$/);
    assert.equal(getPending(db,id).status,'PENDENTE');
    assert.equal(listOrders(db,'2026-11')[0].items[0].qty,10);
  } finally {db.close();}
});
test('confirmação registra saída uma vez; respostas duplicadas são ignoradas',() => {
  const db=fresh();
  try {
    const id=savePending(db,'Teste','2026-11-23','Oficina',[{id:0,name:'Papel A4',qty:10}]);
    assert.equal(confirmOrder(db,id,{ok:true}),true);
    assert.equal(confirmOrder(db,id,{ok:true}),false);
    assert.equal(listMovements(db,'2026-11').length,1);
    assert.equal(listOrders(db,'2026-11')[0].status,'CONFIRMADO');
  } finally {db.close();}
});
test('pedido recusado não cria movimentação',() => {
  const db=fresh();
  try {
    const id=savePending(db,'Teste','2026-11-23','Oficina',[{id:0,name:'Papel A4',qty:5}]);
    assert.equal(confirmOrder(db,id,{ok:false,error:'Estoque insuficiente'}),true);
    assert.equal(listMovements(db,'2026-11').length,0);
    assert.equal(listOrders(db,'2026-11')[0].status,'RECUSADO');
  } finally {db.close();}
});
test('reposição valida campos e não duplica eventos',() => {
  const db=fresh();
  try {
    const p={type:'refill',event_id:'2-ab123',item_id:1,name:'Caneta',qty:20,when:'23/11/26 12:40'};
    assert.equal(registerRefill(db,p),true);
    assert.equal(registerRefill(db,p),false);
    assert.equal(registerRefill(db,{...p,event_id:'3-ab',qty:'20'}),false);
    assert.equal(registerRefill(db,{...p,event_id:'4-ab',name:'x\n'}),false);
    assert.equal(listMovements(db,'2026-11').length,1);
  } finally {db.close();}
});
test('payload MQTT do Wokwi atualiza estado e LEDs conforme menor estoque',() => {
  const db=fresh();
  try {
    const bridge=fakeBridge(db);
    const items=stock.map(it=>({...it}));
    items[0].qty=25;
    assert.equal(bridge.processMessage(bridge.topics.state,Buffer.from(JSON.stringify({type:'state',worst_pct:25,items}))),true);
    assert.equal(currentStock(bridge).led,'vermelho');
    assert.equal(currentStock(bridge).worst_pct,25);
  } finally {db.close();}
});
test('MQTT rejeita JSON inválido, campos inválidos e payload acima do limite',() => {
  const db=fresh();
  try {
    const bridge=fakeBridge(db);
    assert.equal(bridge.processMessage(bridge.topics.state,Buffer.from('{bad')),false);
    assert.equal(bridge.processMessage(bridge.topics.state,Buffer.alloc(2050)),false);
    assert.equal(bridge.processMessage(bridge.topics.state,Buffer.from(JSON.stringify({type:'state',items:[{id:0,qty:'9',capacity:100,name:'Papel A4'}]}))),false);
    assert.equal(bridge.processMessage(bridge.topics.refill,Buffer.from(JSON.stringify({type:'refill',event_id:'x',item_id:0,qty:1,name:'Papel A4'}))),false);
  } finally {db.close();}
});
test('novo pedido passa pelo backend Node e aparece no histórico',async()=>{
  const db=fresh();
  try {
    const bridge=fakeBridge(db);
    const response=await placeOrder(db,bridge,request());
    assert.equal(response.statusCode,200);
    assert.equal(response.body.status,'CONFIRMADO');
    assert.equal(listOrders(db,'2026-11').length,1);
    assert.equal(listMovements(db,'2026-11')[0].qty,2);
  } finally {db.close();}
});
test('novo pedido sem saldo é recusado sem gravar pedido',async()=>{
  const db=fresh();
  try {
    const bridge=fakeBridge(db);
    await assert.rejects(placeOrder(db,bridge,request([{id:0,qty:101}])),err=>err instanceof RequestError && err.status===409);
    assert.equal(listOrders(db,'2026-11').length,0);
  } finally {db.close();}
});
test('novo pedido com item repetido é recusado',async()=>{
  const db=fresh();
  try {
    const bridge=fakeBridge(db);
    await assert.rejects(placeOrder(db,bridge,request([{id:0,qty:1},{id:0,qty:1}])),/duas vezes/);
  } finally {db.close();}
});
test('novo pedido de ESP32 offline falha sem criar registro',async()=>{
  const db=fresh();
  try {
    const bridge=fakeBridge(db);bridge.connected=false;
    await assert.rejects(placeOrder(db,bridge,request()),err=>err.status===503);
    assert.equal(listOrders(db,'2026-11').length,0);
  } finally {db.close();}
});
test('reenviar mantém mesmo ID e ESP32 evita débito repetido',async()=>{
  const db=fresh();
  try {
    const bridge=fakeBridge(db);
    const id=savePending(db,'Teste','2026-11-23','Oficina',[{id:0,name:'Papel A4',qty:5}]);
    const response=await resendOrder(db,bridge,id);
    assert.equal(response.body.id,id);
    assert.equal(response.body.status,'CONFIRMADO');
    await assert.rejects(resendOrder(db,bridge,id),err=>err.status===409);
    assert.equal(listMovements(db,'2026-11').length,1);
  } finally {db.close();}
});
test('pedido sem resposta do dispositivo continua pendente',async()=>{
  const db=fresh();
  try {
    const bridge=fakeBridge(db);
    bridge.sendOrder=()=>false;
    const response=await placeOrder(db,bridge,request());
    assert.equal(response.statusCode,202);
    assert.equal(getPending(db,response.body.id).status,'PENDENTE');
  } finally {db.close();}
});
test('não há código de reposição via API ou mensagem enviada pelo Node',() => {
  const db=fresh();
  try {
    const bridge=fakeBridge(db);
    const called=[];
    bridge.publish=(topic,obj)=>{called.push(obj);return true;};
    delete bridge.sendOrder; // chama o método real da classe, não o mock de confirmação
    bridge.sync();
    bridge.sendOrder('0'.repeat(32),[{id:0,qty:1}]);
    assert.deepEqual(called.map(it=>it.type),['sync','order']);
  } finally {db.close();}
});
