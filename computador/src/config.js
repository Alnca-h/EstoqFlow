'use strict';
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { loadEnvFile } = require('node:process');
const localEnv = resolve(__dirname, '..', '.env');
if (existsSync(localEnv)) loadEnvFile(localEnv);
const config = {
  host: process.env.MQTT_HOST || 'test.mosquitto.org',
  port: Number(process.env.MQTT_PORT || 1883),
  baseTopic: process.env.MQTT_BASE_TOPIC || 'estoque-aula-7c282d2689',
  webPort: Number(process.env.WEB_PORT || 5000),
  mqttUsername: process.env.MQTT_USER || undefined,
  mqttPassword: process.env.MQTT_PASSWORD || undefined,
};
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw Error('MQTT_PORT invalida');
if (!Number.isInteger(config.webPort) || config.webPort < 1 || config.webPort > 65535) throw Error('WEB_PORT invalida');
if (!/^[a-zA-Z0-9_/-]{1,100}$/.test(config.baseTopic)) throw Error('MQTT_BASE_TOPIC invalido');
module.exports = config;
