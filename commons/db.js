const mysql = require('mysql')
const config = require('../config')
const pool = mysql.createPool(config.mysql)
const MongoClient = require('mongodb').MongoClient;

// mysql 查询
const mysqlQuery = function( sql, values ) {
  return new Promise(( resolve, reject ) => {
    pool.getConnection(function(err, connection) {
      if (err) {
        reject( err )
      } else {
        connection.query(sql, values, ( err, rows) => {
          if ( err ) {
            reject( err )
          } else {
            resolve( rows )
          }
          connection.release()
        })
      } 
    })
  })
}

// mysql 传入配置和sql语句执行
const mysqlCfgSql = function(config_this, sql, values ) {
  const pool_this = mysql.createPool(config_this)
  return new Promise(( resolve, reject ) => {
    pool_this.getConnection(function(err, connection) {
      if (err) {
        reject( err )
      } else {
        connection.query(sql, values, ( err, rows) => {
          if ( err ) {
            reject( err )
          } else {
            resolve( rows )
          }
          connection.release()
        })
      }
    })
  })
}

// mongo 查询
const mongoQuery = async () => {
  const client = await MongoClient.connect(config.mongo.url, {useUnifiedTopology: true});
  const db = client.db('zz_web');
  return db;
}

/*
* mongo 链接初始化
* @param dbName 数据库名称
* */
const mongoInit = async (dbName='zz_web') => {
  const client = await MongoClient.connect(config.mongo.url, {useUnifiedTopology: true});
  const db = client.db('zz_web');
  const clientClose = async function () {
    await client.close();
  };
  return {
    'db':db,
    'client':client,
    'close':clientClose
  };
};

module.exports = { mysqlQuery, mongoQuery, mysqlCfgSql, mongoInit }
