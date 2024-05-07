const Sequelize = require('sequelize');
const config = require('../config');
/**
 * @param database 数据库名
 * @param user 数据库用户名
 * @param password 数据库连接密码
 */
const sequelize = new Sequelize(config.mysql_zhizuan.database, config.mysql_zhizuan.user, config.mysql_zhizuan.password, {
    // 数据库host
    host: config.mysql_zhizuan.host,
    // 数据库端口
    port: 3306,
    // sequelize支持 mysql、sqlite、postgres、mssql, 选择自己的数据库语言
    dialect: 'mysql',
    pool: {
        max: 100, // 连接池中最大连接数量
        min: 0, // 连接池中最小连接数量
        idle: 10000 //如果一个线程 10 秒钟内没有被使用过的话，那么就释放线程
    }
})

module.exports = { sequelize };