var Sequelize      = require('sequelize');
const { sequelize } = require('../commons/Sequelize');

const canmouJiaoyi = sequelize.define('t_sycm_jiaoyi', {
    // 自增长主键ID
    id: {
        filed: 'id',
        primaryKey: true,
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true
    },
    f_uv: {
        type: Sequelize.INTEGER,
        field: 'f_uv'
    },
    f_payAmt: {
        type: Sequelize.DOUBLE,
        field: 'f_payAmt'
    },
    f_orderBuyerCnt: {
        type: Sequelize.INTEGER,
        field: 'f_orderBuyerCnt'
    },
    f_payBuyerCnt: {
        type: Sequelize.INTEGER,
        field: 'f_payBuyerCnt'
    },
    f_orderAmt: {
        type: Sequelize.DOUBLE,
        field: 'f_orderAmt'
    },
    f_orderRate: {
        type: Sequelize.DOUBLE,
        field: 'f_orderRate'
    },
    f_payRate: {
        type: Sequelize.DOUBLE,
        field: 'f_payRate'
    },
    f_payPct: {
        type: Sequelize.DOUBLE,
        field: 'f_payPct'
    },
    f_orderToPayRate: {
        type: Sequelize.DOUBLE,
        field: 'f_orderToPayRate'
    },
    f_date: {
        type: Sequelize.STRING,
        field: 'f_date'
    },
    f_shop: {
        type: Sequelize.STRING,
        field: 'f_shop'
    },
    f_mouth: {
        type: Sequelize.STRING,
        field: 'f_mouth'
    },
    f_insert_type: {
        type: Sequelize.INTEGER,
        field: 'f_insert_type'
    },
    created_at: {
        type: Sequelize.DataTypes,
        field: 'created_at'
    },
    updated_at: {
        type: Sequelize.DataTypes,
        field: 'updated_at'
    },
},
    {
        tableName: 't_sycm_jiaoyi',
        timestamps: false,
        freezeTableName: true
    })

module.exports = { canmouJiaoyi };