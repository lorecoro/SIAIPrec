const fs      = require('fs');
const sql     = require('mysql');

// Read the SSL certificate files
const ca = fs.readFileSync('ssl/ca-cert.pem');
const cert = fs.readFileSync('ssl/client-cert.pem');
const key = fs.readFileSync('ssl/client-key.pem');

// Function to connect to the database
async function connectToDb(bot) {
  const con = sql.createConnection({
    host: bot.server,
    user: bot.user,
    password: bot.password,
    database: bot.database,
    ssl: {
      ca: ca,
      cert: cert,
      key: key
    }
  });
  
  con.connect((err) => {
    if (err) {
        console.error('Error connecting to the database:', err.stack);
        return;
    }
  });

  return con;
}

// Function to disconnect from the database
async function disconnectFromDb(con) {
  con.end((err) => {
    if (err) {
        console.error('Error closing the database connection:', err.stack);
    }
  });
}

// Function to select data without JOIN
async function selectData(
  bot, table, columns, whereConditions, whereValues, callback
) {
  const connection = await connectToDb(bot);
  const whereSQL = whereConditions.join(' AND ');
  
  const sql = `
    SELECT ${columns}
    FROM ${table} AS t
    WHERE ${whereSQL}
  `;
  
  connection.query(sql, whereValues, (err, results) => {
    if (err) {
      console.error('Error selecting data:', err.stack);
      callback(err, null);
      return;
    }
    callback(null, results);
  });

  await disconnectFromDb(connection);
}

// Function to select data with a JOIN
async function selectDataWithJoin(
  bot, table1, table2, columns, joinCondition, whereConditions, whereValues, callback
) {
  const connection = await connectToDb(bot);
  const columnsSQL = columns.join(', ');
  const whereSQL = whereConditions.join(' AND ');
  
  const sql = `
    SELECT ${columnsSQL}
    FROM ${table1} AS t1
    JOIN ${table2} AS t2 ON ${joinCondition}
    WHERE ${whereSQL}
  `;
  
  connection.query(sql, whereValues, (err, results) => {
    if (err) {
      console.error('Error selecting data:', err.stack);
      callback(err, null);
      return;
    }
    callback(null, results);
  });

  await disconnectFromDb(connection);
}

// Function to insert data into a table
async function insertData(bot, table, data) {
  const connection = await connectToDb(bot);
  const sql = `INSERT INTO ?? SET ?`;
  connection.query(sql, [table, data], (err, results) => {
    if (err) {
      console.error('Error inserting data:', err.stack);
      return;
    }
    console.log('Data inserted, ID:', results.insertId);
  });

  await disconnectFromDb(connection);
}

// Function to update data in a table
async function updateData(bot, table, setClause, whereConditions, whereValues) {
  const connection = await connectToDb(bot);

  // Construct the SET clause from the setClause object
  const setParts = Object.entries(setClause).map(([column, value]) => `${column} = ?`);
  const setSQL = setParts.join(', ');

  // Construct the WHERE clause, handling NULL values
  const whereParts = whereConditions.map((condition, index) => {
      const value = whereValues[index];
      if (value === null) {
          return condition.replace('= ?', 'IS NULL');
      }
      return condition;
  });
  const whereSQL = whereParts.join(' AND ');

  // Filter out null values from whereValues for the placeholders
  const filteredWhereValues = whereValues.filter(value => value !== null);

  const sql = `
    UPDATE ${table} AS t
    SET ${setSQL}
    WHERE ${whereSQL}
  `;

  const values = [...Object.values(setClause), ...filteredWhereValues];
  connection.query(sql, values, (err, results) => {
    if (err) {
      console.error('Error updating data:', err.stack);
      return;
    }
    console.log('Data updated, affected rows:', results.affectedRows);
  });

  await disconnectFromDb(connection);
}

// Function to update data in a table with a JOIN
async function updateDataWithJoin(table1, table2, setClause, joinCondition, whereConditions) {
  const sql = `
    UPDATE ?? AS t1
    JOIN ?? AS t2 ON ${joinCondition}
    SET ?
    WHERE ${whereConditions.join(' AND ')}
  `;
  connection.query(sql, [table1, table2, setClause], (err, results) => {
    if (err) {
      console.error('Error updating data:', err.stack);
      return;
    }
    console.log('Data updated, affected rows:', results.affectedRows);
  });
}

module.exports = { selectData, selectDataWithJoin, insertData, updateData, updateDataWithJoin };