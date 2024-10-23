const fs      = require('fs');
const yaml    = require('yaml');
const net     = require('net');
const moment  = require('moment-timezone');
const yargs   = require('yargs');
const crypto  = require('crypto');
const { selectData, insertData, updateData } = require('./sql');

const codes   = yaml.parse(
  fs.readFileSync('codes.yml', 'utf8')
).codes;

const bl      = yaml.parse(
  fs.readFileSync('blacklist.yml', 'utf8')
).codes;

const config  = yaml.parse(
  fs.readFileSync('config.yml', 'utf8')
);

function decryptHex(encrypted, password) {
  try {
    let iv = Buffer.alloc(16);
    iv.fill(0);
    let crypted = Buffer.from(encrypted, 'hex');
    let aes;
    switch (password.length) {
      case 16:
        aes = 'AES-128-CBC';
        break;
      case 24:
        aes = 'aes-192-cbc';
        break;
      case 32:
        aes = 'aes-256-cbc';
        break;
      default:
        return undefined;
    }
    let decipher = crypto.createDecipheriv(aes, password, iv);
    decipher.setAutoPadding(false);
    let decoded = decipher.update(crypted, 'hex', 'utf8');
    decoded += decipher.final('utf8');
    return (decoded ? decoded : undefined);
  } catch (e) {
    if(config.server.verbose > 0) {
      console.error(e);
    }
    return undefined;
  }
}

/*
 *  Specify default range to timestamps
 */
if(config.server.diff.negative > 0) {
  config.server.diff.negative = -20;
}
if(config.server.diff.positive < 0) {
  config.server.diff.positive = 40;
}

/*
 *  Parse arguments like port and debug.
 */
const argv = yargs
    .option('port', {
        alias: 'p',
        description: 'Specify a port for this instance.',
        type: 'number',
    })
    .option('debug', {
        alias: 'd',
        description: 'Debug messages to console.',
        type: 'boolean',
    })
    .help()
    .alias('help', 'h')
    .argv;

if(argv.port) {
  config.server.port = argv.port;
}

if(argv.debug) {
  config.dispatcher.push({
    type: 'console',
    format: 'human'
  });
}

/*
 *  RAW dispatcher to console. Useful for debugging.
 */
const consoleDispatch = function(data, bot) {
  console.log({data});
};

/*
 *  MYSQL Dispatcher.
 */
const mysqlDispatch = async function(data, bot) {
  if (!data || !data.timestampH) {
    if(config.server.verbose > 1) {
      console.error('No data to dispatch');
    }
    return;
  }

  const now = moment().local();

  // Insert the event
  const dataToInsert = {
    data_ora_dtr: data.timestampH.pe ?? data.timestampH.csr,
    segnale_ids: data.sia.code,
    segnale_id: null,
    ingresso_obji: Number.isInteger(data.sia.address) ? data.sia.address : null,
    ingresso_id: null,
    impianto_pnlcode: data.account,
    impianto_id: null,
    origine: 'SiaIP_'+config.server.port,
    created_at: now.format('YYYY-MM-DD HH:mm:ss'),
    updated_at: now.format('YYYY-MM-DD HH:mm:ss')
  };

  await insertData(bot, 'impianto_ricezione', dataToInsert);

  // Update the event type id
  await updateEventType(bot, data.sia.code);

  let idsctec = 0;
  // Update the system code; first try with all 6 chars
  idsctec = await updateSystemCode(bot, data.account);
  // Then try with 4 chars
  if (!idsctec) {
    idsctec = await updateSystemCode(bot, data.account.slice(-4));
  }

  // Update the zone id
  if (idsctec && data.sia.address && Number.isInteger(data.sia.address)) {
    await updateZoneCode(bot, idsctec, data.sia.address);
  }
};

/*
 * Search for the event type id and update the events table
 */
const updateEventType = async function(bot, code) {
  // Look for the id of the event type
  const table = 'impianto_ricezione_segnale';
  const columns = ['t.id', 't.codice_segnale'];
  const whereConditions = ['t.codice_segnale = ?'];
  const whereValues = [code];
  const now = moment().local();

  await selectData(bot, table, columns, whereConditions, whereValues, async (err, results) => {
    if (err) {
      if(config.server.verbose > 0) {
        console.error('Error:', err);
      }
    } else {
      if (results.length > 0) {
        // If found, update the column in the events table
        const id = results[0].id;
        const table = 'impianto_ricezione';
        const setClause = { 
          't.segnale_id': id,
          't.updated_at': now.format('YYYY-MM-DD HH:mm:ss')
        };
        const whereConditions = [
          't.segnale_id = ?',
          't.segnale_ids = ?'
        ];
        const whereValues = [null, code];
        if(config.server.verbose > 1) {
          console.log('Update impianto_ricezione: set segnale_id to', id);
        }
        await updateData(bot, table, setClause, whereConditions, whereValues);
      }
    }
  });
}

/*
 * Search for the system id and update the events table
 */
const updateSystemCode = async function(bot, code) {
  // Look for the id of the system
  const table = 'impsctec';
  const columns = ['t.idsctec', 't.codprg'];
  const whereConditions = ['t.codprg = ?'];
  const whereValues = [code];
  const now = moment().local();

  return new Promise(async (resolve, reject) => {
    await selectData(bot, table, columns, whereConditions, whereValues, async (err, results) => {
      if (err) {
        if(config.server.verbose > 0) {
          console.error('Error:', err);
        }
        return reject(err); // Reject promise on error
      } else {
        if (results.length > 0) {
          // If found, update the column in the events table
          const id = results[0].idsctec;
          const table = 'impianto_ricezione';
          const setClause = { 
            't.impianto_id': id,
            't.updated_at': now.format('YYYY-MM-DD HH:mm:ss')
          };
          const whereConditions = [
            't.impianto_id = ?',
            't.impianto_pnlcode = ?',
            'LENGTH(t.segnale_ids) = ?'
          ];
          const whereValues = [null, code, 2];
          if(config.server.verbose > 1) {
            console.log('Update impianto_ricezione: set impianto_id to', id);
          }
          try {
            await updateData(bot, table, setClause, whereConditions, whereValues);
            resolve(id);
          } catch (updateErr) {
            reject(updateErr);
          }
        } else {
          resolve(null);
        }
      }
    });
  });
}

/*
 * Search for the zone id and update the events table
 */
const updateZoneCode = async function(bot, code, zone) {
  // Look for the id of the zone
  const table = 'imppunti';
  const columns = ['t.idzone, t.zona, t.idsctec'];
  const whereConditions = [
    't.idsctec = ?',
    't.zona = ?'
  ];
  const whereValues = [code, zone];
  const now = moment().local();

  await selectData(bot, table, columns, whereConditions, whereValues, async (err, results) => {
    if (err) {
      if(config.server.verbose > 0) {
        console.error('Error:', err);
      }
    } else {
      if (results.length > 0) {
        // If found, update the column in the events table
        const id = results[0].idzone;
        const table = 'impianto_ricezione';
        const setClause = { 
          't.ingresso_id': id,
          't.updated_at': now.format('YYYY-MM-DD HH:mm:ss')
        };
        const whereConditions = [
          't.ingresso_id = ?',
          't.impianto_pnlcode = ?',
          't.ingresso_obji = ?',
          't.origine LIKE ?'
        ];
        const whereValues = [null, code, zone, "SiaIP%"];
        if(config.server.verbose > 1) {
          console.log('Update impianto_ricezione: set ingresso_id to', id);
        }
        await updateData(bot, table, setClause, whereConditions, whereValues);
      }
    }
  });
}

/*
 *  Send the results to each one of dispatcher configured.
 */
const dispatch = async function(data) {
  if(config.dispatcher !== undefined) {
    config.dispatcher.forEach(bot => {
      switch(bot.type) {
        case 'mysql':
          mysqlDispatch(data, bot);
          break;
        case 'console':
          consoleDispatch(data, bot);
          break;
        default:
          console.info(`Unknown dispatcher ${bot.type}.`);
      }
    });
  }
};

/*
 *  CRC-16
 *  Poly: 0x8005 (CRC-16/ARC)
 */
const crc16 = function(data) {
  const crctab16 = new Uint16Array([
    0x0000, 0xC0C1, 0xC181, 0x0140, 0xC301, 0x03C0, 0x0280, 0xC241,
    0xC601, 0x06C0, 0x0780, 0xC741, 0x0500, 0xC5C1, 0xC481, 0x0440,
    0xCC01, 0x0CC0, 0x0D80, 0xCD41, 0x0F00, 0xCFC1, 0xCE81, 0x0E40,
    0x0A00, 0xCAC1, 0xCB81, 0x0B40, 0xC901, 0x09C0, 0x0880, 0xC841,
    0xD801, 0x18C0, 0x1980, 0xD941, 0x1B00, 0xDBC1, 0xDA81, 0x1A40,
    0x1E00, 0xDEC1, 0xDF81, 0x1F40, 0xDD01, 0x1DC0, 0x1C80, 0xDC41,
    0x1400, 0xD4C1, 0xD581, 0x1540, 0xD701, 0x17C0, 0x1680, 0xD641,
    0xD201, 0x12C0, 0x1380, 0xD341, 0x1100, 0xD1C1, 0xD081, 0x1040,
    0xF001, 0x30C0, 0x3180, 0xF141, 0x3300, 0xF3C1, 0xF281, 0x3240,
    0x3600, 0xF6C1, 0xF781, 0x3740, 0xF501, 0x35C0, 0x3480, 0xF441,
    0x3C00, 0xFCC1, 0xFD81, 0x3D40, 0xFF01, 0x3FC0, 0x3E80, 0xFE41,
    0xFA01, 0x3AC0, 0x3B80, 0xFB41, 0x3900, 0xF9C1, 0xF881, 0x3840,
    0x2800, 0xE8C1, 0xE981, 0x2940, 0xEB01, 0x2BC0, 0x2A80, 0xEA41,
    0xEE01, 0x2EC0, 0x2F80, 0xEF41, 0x2D00, 0xEDC1, 0xEC81, 0x2C40,
    0xE401, 0x24C0, 0x2580, 0xE541, 0x2700, 0xE7C1, 0xE681, 0x2640,
    0x2200, 0xE2C1, 0xE381, 0x2340, 0xE101, 0x21C0, 0x2080, 0xE041,
    0xA001, 0x60C0, 0x6180, 0xA141, 0x6300, 0xA3C1, 0xA281, 0x6240,
    0x6600, 0xA6C1, 0xA781, 0x6740, 0xA501, 0x65C0, 0x6480, 0xA441,
    0x6C00, 0xACC1, 0xAD81, 0x6D40, 0xAF01, 0x6FC0, 0x6E80, 0xAE41,
    0xAA01, 0x6AC0, 0x6B80, 0xAB41, 0x6900, 0xA9C1, 0xA881, 0x6840,
    0x7800, 0xB8C1, 0xB981, 0x7940, 0xBB01, 0x7BC0, 0x7A80, 0xBA41,
    0xBE01, 0x7EC0, 0x7F80, 0xBF41, 0x7D00, 0xBDC1, 0xBC81, 0x7C40,
    0xB401, 0x74C0, 0x7580, 0xB541, 0x7700, 0xB7C1, 0xB681, 0x7640,
    0x7200, 0xB2C1, 0xB381, 0x7340, 0xB101, 0x71C0, 0x7080, 0xB041,
    0x5000, 0x90C1, 0x9181, 0x5140, 0x9301, 0x53C0, 0x5280, 0x9241,
    0x9601, 0x56C0, 0x5780, 0x9741, 0x5500, 0x95C1, 0x9481, 0x5440,
    0x9C01, 0x5CC0, 0x5D80, 0x9D41, 0x5F00, 0x9FC1, 0x9E81, 0x5E40,
    0x5A00, 0x9AC1, 0x9B81, 0x5B40, 0x9901, 0x59C0, 0x5880, 0x9841,
    0x8801, 0x48C0, 0x4980, 0x8941, 0x4B00, 0x8BC1, 0x8A81, 0x4A40,
    0x4E00, 0x8EC1, 0x8F81, 0x4F40, 0x8D01, 0x4DC0, 0x4C80, 0x8C41,
    0x4400, 0x84C1, 0x8581, 0x4540, 0x8701, 0x47C0, 0x4680, 0x8641,
    0x8201, 0x42C0, 0x4380, 0x8341, 0x4100, 0x81C1, 0x8081, 0x4040
  ]);
  let len = data.length;
  let buffer = 0;
  let crc;
  while (len--) {
    crc = ((crc >>> 8) ^ (crctab16[(crc ^ (data[buffer++])) & 0xff]));
  }
  return crc;
};

/*
 *  Transform CRC to hex and 4 zero-padding string
 */
const crc16str = function(str) {
  return crc16(Buffer.from(str)).toString(16).toUpperCase().padStart(4, "0");
};

/*
 *  Calculate the size of a message and transform to a 4 zero-padding string in hex
 */
const msgSize = function(str) {
  return str.length.toString(16).toUpperCase().padStart(4, "0");
};

/*
 *  Transform socket data block to JSON object
 */
const parseRequest = async function(data, key_txt) {
  const now = moment().local();
  let csrTimestamp = now;
  let peTimestamp;
  let chunk = data.toString('utf8');
  let data_encrypted_hex = chunk.substring(chunk.indexOf("[")+1);
  let data_decrypted = decryptHex(data_encrypted_hex, key_txt);
  if (!data_decrypted || data_decrypted == '') {
    if(config.server.verbose > 1) {
      console.warn('Nessuna informazione utile in ', data_encrypted_hex);
    }
    return {};
  }
  let msgTimestamp = data_decrypted.slice(data_decrypted.lastIndexOf("_"));
  let relevantData = data_decrypted.slice(data_decrypted.lastIndexOf("|")+1, data_decrypted.lastIndexOf("]"));

  let msg = chunk.substring(chunk.indexOf('"'));
  msg = msg.substring(0, msg.lastIndexOf("\r"));
  // let crc = crc16str(msg);
  // let size = msgSize(msg);
  let type = msg.substring(1, msg.lastIndexOf('"'));
  let id = msg.substring(msg.lastIndexOf('"') + 1, msg.lastIndexOf('['));
  if(msgTimestamp != '') {
    peTimestamp = moment.utc(msgTimestamp, '_HH:mm:ss,MM-DD-YYYY');
    // Timezone might be UTC or local
    const tempdiff = parseInt(peTimestamp.format('X')) - parseInt(csrTimestamp.format('X'));
    if (tempdiff > 6900 && tempdiff < 7500) {
      peTimestamp = moment(msgTimestamp, '_HH:mm:ss,MM-DD-YYYY');
    }
  } else {
    peTimestamp = now;
  }
  const diff = parseInt(peTimestamp.format('X')) - parseInt(csrTimestamp.format('X'));
  let timestamp = {
    pe: parseInt(peTimestamp.format('X')),
    csr: parseInt(csrTimestamp.format('X')),
    diff
  }
  let timestampH = {
    pe: peTimestamp.format('YYYY-MM-DD HH:mm:ss'),
    csr: csrTimestamp.format('YYYY-MM-DD HH:mm:ss'),
    diff
  }
  let account = id.substring(id.indexOf('#')+1);

  // Check if the code is in the blacklist
  if (bl.some(item => item.code === account)) {
    return false;
  }

  let prefix = id.substring(id.indexOf('L'), id.indexOf('#'));
  let sequence = id.indexOf('R') != -1?id.substring(0, id.indexOf('R')):id.substring(0, id.indexOf('L'));

  let sia = {
    data: null,
    code: null,
    address: null,
  };

  if (relevantData !== '') {
    // Certe stringhe iniziano con Nri0 anziche' con N: rimuovo i primi 3 caratteri
    let nri0 = relevantData.indexOf("Nri");
    if (nri0 > -1) {
      relevantData = relevantData.substring(3);
    }
    sia.code = relevantData.slice(1,3);
    // We only want the address if it is a "zone"
    const thiscode = codes.find(entry => entry.code === sia.code);
    if (thiscode && thiscode.address == 'zone') {
      let address = '';
      let caret = relevantData.indexOf("^");
      if (caret == -1) {
        address = relevantData.substring(3);
      }
      else {
        address = relevantData.substring(3, caret);
      }
      sia.address = address ? Number(address) : null;
    }
  }

  let responseMsg;
  if(timestamp.diff < config.server.diff.negative || timestamp.diff > config.server.diff.positive) {
    if (config.server.verbose > 0) {
      console.warn('Comunicazione respinta per ora centrale sballata');
    }
    let timestamp = csrTimestamp.format('_HH:mm:ss,MM-DD-YYYY');
    responseMsg = `"NAK"0000R0L0[]${timestamp}`;
  } else {
    responseMsg = `"ACK"${sequence}${prefix}${account}[]`;
  }

  let responseCrc = crc16str(responseMsg);
  let responseSize = msgSize(responseMsg);
  let response = `\n${responseCrc}${responseSize}${responseMsg}\r`;

  return {data_decrypted, type, account, sia, timestamp, timestampH, response};
};

/*
 *  Start a TCP server to dispatch every block of data received
 */
let server = net.createServer(function(socket) {
  socket.on('error', function(err) {
    if(config.server.verbose > 0) {
      console.error(err);
    }
  });
  socket.on('data', async function(data) {
    let request = await parseRequest(data, config.server.key);
    if (request) {
      await dispatch(request);
      let response = request.response;
      let status = socket.write(response);
    }
  });
});

/*
 *  Start to listen in configured or argument passed port.
 */
server.listen(config.server.port);
