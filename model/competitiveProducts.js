var Sequelize      = require('sequelize');
const { sequelize } = require('../commons/Sequelize');

const competitiveProducts = sequelize.define('t_sycm_competitive_products_detail', {
    // 自增长主键ID
    id: {
        filed: 'id',
        primaryKey: true,
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true
    },
    f_wangwangid: {
        type: Sequelize.STRING,
        field: 'f_wangwangid'
    },
    f_itemId: {
        type: Sequelize.STRING,
        field: 'f_itemId'
    },
    f_type: {
        type: Sequelize.INTEGER,
        field: 'f_type'
    },
    f_date: {
        type: Sequelize.STRING,
        field: 'f_date'
    },
    sales_ranking: {
        type: Sequelize.INTEGER,
        field: 'sales_ranking'
    },
    sales_people: {
        type: Sequelize.INTEGER,
        field: 'sales_people'
    },
    price: {
        type: Sequelize.DECIMAL,
        field: 'price'
    },
    f_keyword: {
        type: Sequelize.STRING,
        field: 'f_keyword'
    },
    f_foreign_products_id: {
        type: Sequelize.INTEGER,
        field: 'f_foreign_products_id'
    },
    receiving_people: {
        type: Sequelize.STRING,
        field: 'receiving_people'
    },
    pictUrl: {
        type: Sequelize.STRING,
        field: 'pictUrl'
    },
    payAmt: {
        type: Sequelize.DECIMAL,
        field: 'payAmt'
    },
    itmUv: {
        type: Sequelize.INTEGER,
        field: 'itmUv'
    },
    itemCartCnt: {
        type: Sequelize.INTEGER,
        field: 'itemCartCnt'
    },
    payRate: {
        type: Sequelize.DECIMAL,
        field: 'payRate'
    },
    preferential_activity: {
        type: Sequelize.STRING,
        field: 'preferential_activity'
    },
    stss_uv: {
        type: Sequelize.INTEGER,
        field: 'stss_uv'
    },
    ztc_uv: {
        type: Sequelize.INTEGER,
        field: 'ztc_uv'
    },
    sttj_uv: {
        type: Sequelize.INTEGER,
        field: 'sttj_uv'
    },
    cjtj_uv: {
        type: Sequelize.INTEGER,
        field: 'cjtj_uv'
    },
    stss_payRate: {
        type: Sequelize.STRING,
        field: 'stss_payRate'
    },
    ztc_payRate: {
        type: Sequelize.STRING,
        field: 'ztc_payRate'
    },
    sttj_payRate: {
        type: Sequelize.STRING,
        field: 'sttj_payRate'
    },
    cjtj_payRate: {
        type: Sequelize.STRING,
        field: 'cjtj_payRate'
    },
    created_at: {
        type: Sequelize.DataTypes,
        field: 'created_at'
    },
    updated_at: {
        type: Sequelize.DataTypes,
        field: 'updated_at'
    },
},{
    tableName: 't_sycm_competitive_products_detail',
    timestamps: false,
    freezeTableName: true
})

module.exports = { competitiveProducts };