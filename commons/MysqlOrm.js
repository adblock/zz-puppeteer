const config = require('../config');
const DbClient  = require('ali-mysql-client');


const connection = async(mysqlCfg)=>{
    if(!mysqlCfg){
        mysqlCfg = config.mysql;
    }
    const db = new DbClient(mysqlCfg);
    return db

};

module.exports = { connection };