# SIA node service

Allows you to log SIA-DC-09 events to a MySQL database.

Certain peripherals can be ignored by adding them to a blacklist.yml file

## Standard compatibility

Tested with Axel Atlantis, Inim Prime, Inim Smartliving, Satel

## Install

```bash
cd SIAIPrec
git pull
npm i
```

## Sample config

```yaml
server:
  port: 8094
  key: '0123456789abcdef'
  verbose: 2
  diff:
    negative: -20
    positive: 40
dispatcher:
  -
    type: 'mysql'
    format: 'human'
    user: 'foo'
    password: 'P4$$w0Rd'
    database: 'db'
    server: '10.0.2.15'
    port: 1433
```

Errors will be displayed when verbose is either 1 or 2.
Other informative messages with 2.
0 is to be considered a mostly "silent" mode.

## Execution

```bash
pm2 start server.js
pm2 monit
pm2 logs
pm2 stop server.js
pm2 delete server.js
```
Logs are stored in /root/.pm2/logs/

## Dispatchers

At the moment it only supports dispatchers type ...

- ✅ `console`
- ✅ `mysql`

You can specify the number of dispatchers you need.

```yaml
dispatcher:
  -
    type: 'mysql'
    format: 'human'
    user: 'other'
    password: '$3cr3t'
    database: 'sia-events-backup'
    server: '190.13.132.109'
    port: 1433
  -
    type: 'console'
    format: 'human'
```