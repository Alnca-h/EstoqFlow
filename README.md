# EstoqFlow — Programa de Gerenciamento de Estoque

Projeto individual de **Victor Alencar Marques**, desenvolvido para a disciplina de Internet das Coisas.

O EstoqFlow é um sistema de gerenciamento de estoque voltado a pequenas empresas. Os materiais de papelaria são utilizados somente como exemplo na demonstração.

Este repositório contém **apenas o programa externo**, feito com Node.js, Express, HTML, CSS e JavaScript. O código e a montagem do ESP32 no Wokwi não estão incluídos aqui.

## Funcionalidades

- Consulta das quantidades de cada material.
- Cadastro de pedidos com solicitante, data, descrição e quantidades.
- Desconto de materiais após confirmação pelo ESP32.
- Histórico de pedidos e movimentações por mês e ano.
- Armazenamento dos históricos em banco SQLite no computador.
- Comunicação por MQTT com o ESP32, que mantém os saldos e recebe pedidos.

A reposição de materiais é feita **somente no Monitor Serial do ESP32**. O site não oferece reposição.

## Requisitos

- Node.js 24.15 ou superior.
- Conexão à internet para o broker MQTT de demonstração.
- Simulação do ESP32 em execução no Wokwi para receber e enviar dados.

## Como executar

No VS Code, abra a pasta `EstoqFlow_Programa_GitHub` e execute no terminal:

```powershell
cd computador
npm.cmd install
npm.cmd start
```

Abra `http://127.0.0.1:5000` no navegador. O servidor deve permanecer em execução.

## Configuração

O arquivo `computador/.env.example` é um exemplo de configuração e **não contém senhas reais**.

Para alterar valores, faça uma cópia como `computador/.env` e edite a cópia. O arquivo `.env` está protegido pelo `.gitignore` e não deve ser enviado ao GitHub.

**Atenção:** o tópico MQTT configurado no Node.js deve ser exatamente igual ao tópico no `sketch.ino` do ESP32. Alterar apenas o programa impedirá a comunicação.

O projeto utiliza o broker público `test.mosquitto.org`, sem autenticação ou criptografia. Use apenas dados fictícios e não utilize essa configuração em operação comercial real.

## Testes

```powershell
cd computador
npm.cmd install
npm.cmd test
npm.cmd audit
```

Os testes aqui incluídos verificam o programa Node.js e a interface, mas não substituem o teste real de integração com o Wokwi.

## Estrutura

- `computador/server.js`: servidor web e API.
- `computador/src/`: regras de pedidos, histórico, configuração, banco SQLite e MQTT.
- `computador/public/`: interface HTML, CSS e JavaScript.
- `computador/.env.example`: exemplo de configuração.
- `testes/`: testes automatizados do programa.
- `.gitignore`: arquivos locais que não devem ser enviados.
- `SEGURANCA_OWASP.md`: levantamento de riscos e correções.
- `PASSO_A_PASSO_GITHUB.md`: instruções de publicação.

## Sobre a parte física

O ESP32 é executado em projeto separado no Wokwi, com DHT22, quatro LEDs e comandos de estoque, reposição e temperatura no Monitor Serial. Para a entrega da disciplina, forneça separadamente o **link público do Wokwi**.

## Segurança e finalidade

Este é um protótipo acadêmico. Validações e tratamento de dados foram implementados no programa, mas o MQTT de demonstração é público e não possui autenticação. A documentação de segurança está em `SEGURANCA_OWASP.md`.
