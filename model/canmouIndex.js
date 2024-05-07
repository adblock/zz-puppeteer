var Sequelize      = require('sequelize');
const { sequelize } = require('../commons/Sequelize');

const canmouIndex = sequelize.define('t_sycm_index', {
    // 自增长主键ID
    id: {
        filed: 'id',
        primaryKey: true,
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true
    },
    f_insert_type: {
        type: Sequelize.INTEGER,
        field: 'f_insert_type'
    },
    f_shop: {
        type: Sequelize.STRING,
        field: 'f_shop'
    },
    f_week: {
        type: Sequelize.STRING,
        field: 'f_week'
    },
    f_date: {
        type: Sequelize.STRING,
        field: 'f_date'
    },
    f_cateLevel: {
        type: Sequelize.INTEGER,
        field: 'f_cateLevel'
    },
    f_rank: {
        type: Sequelize.INTEGER,
        field: 'f_rank'
    },
    f_rankCycleCqc: {
        type: Sequelize.INTEGER,
        field: 'f_rankCycleCqc'
    },
    f_payAmt: {
        type: Sequelize.INTEGER,
        field: 'f_payAmt'
    },
    f_payAmt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_payAmt_cycle'
    },
    f_uv: {
        type: Sequelize.INTEGER,
        field: 'f_uv'
    },
    f_uv_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_uv_cycle'
    },
    f_cartCnt: {
        type: Sequelize.INTEGER,
        field: 'f_cartCnt'
    },
    f_cartCnt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_cartCnt_cycle'
    },
    f_p4pExpendAmt: {
        type: Sequelize.DOUBLE,
        field: 'f_p4pExpendAmt'
    },
    f_p4pExpendAmt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_p4pExpendAmt_cycle'
    },
    f_payByrCnt: {
        type: Sequelize.INTEGER,
        field: 'f_payByrCnt'
    },
    f_payByrCnt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_payByrCnt_cycle'
    },
    f_olderPayAmt: {
        type: Sequelize.DOUBLE,
        field: 'f_olderPayAmt'
    },
    f_olderPayAmt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_olderPayAmt_cycle'
    },
    f_cartByrCnt: {
        type: Sequelize.INTEGER,
        field: 'f_cartByrCnt'
    },
    f_cartByrCnt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_cartByrCnt_cycle'
    },
    f_pv: {
        type: Sequelize.INTEGER,
        field: 'f_pv'
    },
    f_pv_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_pv_cycle'
    },
    f_payRate_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_payRate_cycle'
    },
    f_payOrdCnt: {
        type: Sequelize.INTEGER,
        field: 'f_payOrdCnt'
    },
    f_payOrdCnt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_payOrdCnt_cycle'
    },
    f_payOldByrCnt: {
        type: Sequelize.INTEGER,
        field: 'f_payOldByrCnt'
    },
    f_payOldByrCnt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_payOldByrCnt_cycle'
    },
    f_tkExpendAmt: {
        type: Sequelize.DOUBLE,
        field: 'f_tkExpendAmt'
    },
    f_tkExpendAmt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_tkExpendAmt_cycle'
    },
    f_payItmCnt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_payItmCnt_cycle'
    },
    f_payItmCnt: {
        type: Sequelize.INTEGER,
        field: 'f_payItmCnt'
    },
    f_payPct: {
        type: Sequelize.DOUBLE,
        field: 'f_payPct'
    },
    f_payPct_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_payPct_cycle'
    },
    f_rfdSucAmt: {
        type: Sequelize.DOUBLE,
        field: 'f_rfdSucAmt'
    },
    f_rfdSucAmt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_rfdSucAmt_cycle'
    },
    f_feedCharge: {
        type: Sequelize.DOUBLE,
        field: 'f_feedCharge'
    },
    f_payRate: {
        type: Sequelize.INTEGER,
        field: 'f_payRate'
    },
    f_feedCharge_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_feedCharge_cycle'
    },
    f_cltItmCnt: {
        type: Sequelize.INTEGER,
        field: 'f_cltItmCnt'
    },
    f_cltItmCnt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_cltItmCnt_cycle'
    },
    f_zzExpendAmt: {
        type: Sequelize.DOUBLE,
        field: 'f_zzExpendAmt'
    },
    f_zzExpendAmt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_zzExpendAmt_cycle'
    },
    f_cubeAmt: {
        type: Sequelize.DOUBLE,
        field: 'f_cubeAmt'
    },
    f_cubeAmt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_cubeAmt_cycle'
    },
    f_adStrategyAmt: {
        type: Sequelize.DOUBLE,
        field: 'f_adStrategyAmt'
    },
    f_adStrategyAmt_cycle: {
        type: Sequelize.DOUBLE,
        field: 'f_adStrategyAmt_cycle'
    },
    f_tkExpendAmtRate: {
        type: Sequelize.DOUBLE,
        field: 'f_tkExpendAmtRate'
    },
    f_without_false_sales: {
        type: Sequelize.DOUBLE,
        field: 'f_without_false_sales'
    },
    f_chargeRate: {
        type: Sequelize.DOUBLE,
        field: 'f_chargeRate'
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
        tableName: 't_sycm_index',
        timestamps: false,
        freezeTableName: true
    })

module.exports = { canmouIndex };