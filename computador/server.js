'use strict';
const express = require('express');
const path = require('node:path');
const config = require('./src/config');
const {openDatabase} = require('./src/database');
const {EspBridge} = require('./src/bridge');
const {currentPeriod} = require('./src/dates');
const {RequestError,currentStock,placeOrder,resendOrder,getOrders,getMovements} = require('./src/operations');

function createApp(db,bridge) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'12kb',strict:true}));
  app.use(express.static(path.join(__dirname,'public'),{index:false,dotfiles:'ignore'}));
  app.get('/', (_req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
  app.get('/api/estoque', (_req,res) => res.json(currentStock(bridge)));
  app.post('/api/pedidos', async (req,res) => {
    if (!req.is('application/json')) throw new RequestError('Envie os dados em JSON.');
    const {statusCode,body} = await placeOrder(db,bridge,req.body);
    res.status(statusCode).json(body);
  });
  app.get('/api/pedidos', (req,res) => res.json(getOrders(db,req.query.period || currentPeriod())));
  app.get('/api/movimentacoes', (req,res) => res.json(getMovements(db,req.query.period || currentPeriod())));
  app.post('/api/pedidos/:id/reenviar', async (req,res) => {
    const {statusCode,body} = await resendOrder(db,bridge,req.params.id);
    res.status(statusCode).json(body);
  });
  app.use((err,_req,res,_next) => {
    if (err instanceof RequestError) return res.status(err.status).json({ok:false,message:err.message});
    if (err.type === 'entity.too.large') return res.status(413).json({ok:false,message:'Pedido muito grande.'});
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ok:false,message:'JSON inválido.'});
    if (err instanceof Error && (/^(Informe |Data inválida|Mês inválido)/.test(err.message)))
      return res.status(400).json({ok:false,message:err.message});
    console.error('[WEB] Erro inesperado:',err);
    return res.status(500).json({ok:false,message:'Erro interno do servidor.'});
  });
  return app;
}
function main() {
  const db = openDatabase();
  const bridge = new EspBridge(db,config);
  bridge.start();
  const server = createApp(db,bridge).listen(config.webPort,'127.0.0.1',() => {
    console.log('\n============================================');
    console.log('CONTROLE DE ESTOQUE - NODE.JS + ESP32/WOKWI');
    console.log(`Abra: http://127.0.0.1:${config.webPort}`);
    console.log('Reposicao SOMENTE no Monitor Serial do Wokwi.');
    console.log('============================================\n');
  });
  let closing = false;
  function stop() {
    if (closing) return;
    closing = true;
    server.close(() => { bridge.stop(); db.close(); process.exit(0); });
  }
  process.on('SIGINT',stop);
  process.on('SIGTERM',stop);
}
if (require.main === module) main();
module.exports = { createApp };
