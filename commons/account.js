const { mysqlQuery, mongoQuery, mongoInit }  = require('./db');

// 获取一个可用的有效cookies
const getOneAccountCookiesByid = async(account_id) => {
    account = await mysqlQuery('select * from t_sycm_account where  id = ' + account_id);
    if(account.length>0){
        return account[0];
    }else{
        return undefined;
    }
}

// 获取mongodb 的子账号cookie 账号信息
const getCookiesByMongo = async(wangwang_id) => {
    let db = await mongoQuery();
    let account = await db.collection('sub_account_login').find({'wangwang_id':wangwang_id}).sort({'f_date':-1}).limit(1).toArray()
    if(account.length>0){
        return account[0];
    }else{
        return undefined;
    }
};

// 获取mongodb 的子账号cookie 账号信息 可关闭链接
const getCookiesInMongo = async(wangwang_id, mongo = undefined) => {
    if(mongo === undefined){
        mongo = await mongoInit();
    }
    const account = await mongo.db.collection('sub_account_login').find({'wangwang_id':wangwang_id}).sort({'f_date':-1}).limit(1).toArray()
    if(account.length>0){
        return account[0];
    }else{
        return undefined;
    }
};

// 获取mongodb 运营的子账号cookie 账号信息
const getYunyingAccount = async(wangwang_id) => {
    let db = await mongoQuery();
    let account = await db.collection('sub_account_login').find({'wangwang_id':wangwang_id}).sort({'f_date':-1}).limit(1).toArray()
    if(account.length>0){
        return account[0];
    }else{
        return undefined;
    }
};
// 获取mongodb 的随机一个子账号cookie 账号信息
const getOneCookieByMongo = async() => {
    let db = await mongoQuery();
    let account = await db.collection('sub_account_login').find({'f_valid_status':1}).sort({'f_date':-1}).toArray()
    if(account.length>0){
        return account[Math.floor( Math.random() * account.length )];
    }else{
        return undefined;
    }
}

module.exports = { getOneAccountCookiesByid, getCookiesByMongo, getOneCookieByMongo, getCookiesInMongo, getYunyingAccount }
