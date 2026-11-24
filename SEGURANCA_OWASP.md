# Segurança — Checklist OWASP IoT Top 10

**Arquitetura atual:** HTML/CSS/JS no navegador + **Node.js/Express** (PC) + SQLite + MQTT público + ESP32 no Wokwi.

**Escopo do projeto:** apenas os três primeiros itens do adicional de segurança. **Não foi implementada autenticação nem criptografia MQTT** (4º item).

Referência OWASP IoT Top 10 (2018): https://owasp.org/www-project-internet-of-things/

| Item OWASP | Risco identificado | Medida / situação |
|---|---|---|
| **I1 — Weak, Guessable, or Hardcoded Passwords** | Colocar senha Wi-Fi ou de broker no código/repositório | `wokwi/secrets.example.h` e `computador/.env.example` são modelos; arquivos reais ignorados em `.gitignore`. A rede padrão Wokwi-GUEST não exige senha. |
| **I2 — Insecure Network Services** | Broker público aceita mensagens de terceiros | **Risco mantido**; não use em estoque real. |
| **I3 — Insecure Ecosystem Interfaces** | Mensagem MQTT malformada ou grande pode comprometer os registros | **Correção parcial:** firmware rejeita comandos acima de 512 bytes; Node.js rejeita mensagens MQTT acima de 2048 bytes, campos inválidos, saldos impossíveis e eventos malformados. API valida datas, campos e quantidades. |
| **I4 — Lack of Secure Update Mechanism** | Firmware não verifica atualização OTA | Não implementado; upload manual no Wokwi. |
| **I5 — Use of Insecure or Outdated Components** | Bibliotecas podem ficar desatualizadas | Dependências declaradas em `package.json`, bibliotecas Arduino no `libraries.txt`; exigir revisão antes de uso real. |
| **I6 — Insufficient Privacy Protection** | Nomes e descrições de pedidos ficam no computador | SQLite local, site limitado a `127.0.0.1`, não colocar dados reais em testes. |
| **I7 — Insecure Data Transfer and Storage** | MQTT sem TLS/autenticação; SQLite sem criptografia | **Risco assumido** por decisão do projeto; uso somente didático. |
| **I8 — Lack of Device Management** | Sem gestão remota de firmware e dispositivos | Não implementado. |
| **I9 — Insecure Default Settings** | Broker público e tópico demonstrativo | Limitação documentada; não é controle de acesso. |
| **I10 — Lack of Physical Hardening** | Acesso ao Monitor Serial permite repor | Restrição operacional: reposição só no terminal do Wokwi, não pelo site; simulador precisa estar sob controle de quem apresenta. |

## Itens do adicional de segurança

### 1. Credenciais fora do repositório (até 3%)

- `wokwi/secrets.example.h` sem credencial real; eventual `wokwi/secrets.h` é ignorado.
- `computador/.env.example` sem credencial real; eventual `computador/.env` é ignorado.
- O arquivo `.gitignore` também ignora `node_modules`, banco SQLite e outros arquivos locais.
- **Observação:** `.gitignore` não remove segredos que tenham sido publicados anteriormente.

### 2. Checklist OWASP IoT Top 10 (até 3%)

A tabela acima relaciona cada categoria ao sistema, diferenciando o que foi corrigido e os riscos assumidos.

### 3. Correção de vulnerabilidade (até 2%)

**Falha escolhida:** mensagens MQTT e dados da API sem validação suficiente poderiam gerar históricos incoerentes. Os tratamentos implementados e reaproveitados são:

- `wokwi/sketch.ino`: limita tamanho de comandos, rejeita quantidade inválida e valida todos os itens antes de descontar.
- `computador/src/bridge.js`: rejeita payloads MQTT maiores que 2048 bytes, JSON incorreto e campos de estoque inválidos.
- `computador/src/database.js`: rejeita reposições com `event_id`, `name`, `item_id` ou `qty` inválidos; impede duplicação de histórico, usando IDs únicos e transações.
- `computador/src/operations.js`: valida solicitante, descrição, data, materiais e quantidades; falhas de estoque não são gravadas como movimentação concluída.
- `computador/server.js`: limita JSON recebido a 12 KiB, oferece apenas rotas permitidas e escuta em `127.0.0.1`.
- `computador/public/app.js`: usa `escapeHTML` ao mostrar textos do histórico.

**Evidência:** executar `npm test` dentro da pasta `computador`; há testes de rejeição de JSON inválido, payload grande, reposição malformada e duplicidade de eventos.

### 4. Autenticação ou criptografia (até 2%) — NÃO feito

O servidor utiliza `mqtt://test.mosquitto.org:1883` sem autenticação/TLS, como pedido. Portanto, **nem integridade nem autenticidade de mensagens válidas são garantidas**; terceiro que conheça o tópico pode simular dados. Nunca utilizar essa configuração para controle de estoque real.

## Nota para o relatório

A migração de Python para Node.js preservou o protocolo MQTT e o firmware. A mudança de biblioteca não altera as limitações de segurança da arquitetura. Na apresentação, mostrar os exemplos de `.env`, `.gitignore`, este checklist e os testes automatizados. A nota adicional é atribuída pelo professor, não garantida pelo código.


## Atualizacao: sensor DHT22 (temperatura)

- A faixa de temperatura e configurada **apenas** no Monitor Serial do ESP32, e os dois limites sao validados (minimo menor que maximo; intervalo de -40 a 80 C).
- A faixa fica somente na RAM e volta ao padrao quando a simulacao reinicia. Somente as quantidades do estoque sao gravadas nas Preferences/NVS do ESP32.
- Se o DHT22 falhar, a leitura e identificada como **erro**, nao como temperatura normal, e o LED azul liga por precaucao.
- O MQTT mantem os mesmos topicos/payloads para pedidos e estoque: **nao** aceita reposicao nem modificacao de limites de temperatura pela rede.
- A conexao MQTT publica continua **sem autenticacao e sem TLS**, conforme decisao do projeto. Usar somente em demonstracao com dados ficticios.

## Armazenamento simplificado

O ESP32 persiste apenas as quantidades dos materiais. Pedidos, solicitantes, datas e movimentacoes sao armazenados exclusivamente no SQLite do computador. Para evitar respostas duplicadas, o sketch mantem somente em **RAM** os identificadores de 12 pedidos recentes, que somem ao reiniciar. Sem armazenamento de eventos no ESP32, uma reposicao feita com Node.js desligado nao possui historico recuperavel; apos reiniciar com pedido pendente, confirme os saldos antes de reenviar.
