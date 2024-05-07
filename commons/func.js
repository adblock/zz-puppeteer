const https = require("https");
const dateFormat = require('dateformat');
const config = require('../config');
const { mongoQuery, mysqlCfgSql } = require('../commons/db');
const { URL, URLSearchParams } = require('url');
const moment = require('moment');
const { Console } = require("console");

// ForEach async
async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

// 获取url参数
async function getUrlParams(url,key){
    let ourl = new URL(url);
    let params = new URLSearchParams(ourl.search);
    return params.get(key);
}

// 获取当天的超级推荐店铺列表
async function getTuijianShopList(date) {
    let db = await mongoQuery();
    const shop_list = await db.collection('chaojituijian.shop_list').find({}).sort({_id:-1}).limit(1).toArray();
    return shop_list;
}

// param $isAt 是否AT管理员
async function sendDingding (content, isAt=false){
    let queryParams = {
        "msgtype": "text",
         "text": {
             "content": content,
         }
    };
    if(isAt === true){
        queryParams.at = {
                 "atMobiles": [18561738659], 
                 "isAtAll": false
             }
    }
    const requestData = JSON.stringify(queryParams);
    const req = https.request({
        hostname: 'oapi.dingtalk.com',
        port: 443,
        path: '/robot/send?access_token=5adb0ed002a46761df517eacee2a99ba285c613891adf110255bce2ea326a047',
        method: "POST",
        json: true,
        headers: {
            'Content-Type' : "application/json; charset=utf-8"
        }
    },(res) => {
        process.exit()
    });
    req.write(requestData);
    req.on('error',function(err){
        console.error(err);
    });
    req.end();
}

// 获取当天的钻展店铺列表
async function getZuanzhanShopList() {
    let db = await mongoQuery();
    const shop_list = await db.collection('zuanzhan.shop_list').find({}).sort({_id:-1}).limit(1).toArray();
    return shop_list;
}
 
// 设置浏览器js值
const setJs = async (page) => {
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
        Object.defineProperty(chrome, 'runtime', {
            get: function () {
                return { "OnInstalledReason": { "CHROME_UPDATE": "chrome_update", "INSTALL": "install", "SHARED_MODULE_UPDATE": "shared_module_update", "UPDATE": "update" }, "OnRestartRequiredReason": { "APP_UPDATE": "app_update", "OS_UPDATE": "os_update", "PERIODIC": "periodic" }, "PlatformArch": { "ARM": "arm", "MIPS": "mips", "MIPS64": "mips64", "X86_32": "x86-32", "X86_64": "x86-64" }, "PlatformNaclArch": { "ARM": "arm", "MIPS": "mips", "MIPS64": "mips64", "X86_32": "x86-32", "X86_64": "x86-64" }, "PlatformOs": { "ANDROID": "android", "CROS": "cros", "LINUX": "linux", "MAC": "mac", "OPENBSD": "openbsd", "WIN": "win" }, "RequestUpdateCheckStatus": { "NO_UPDATE": "no_update", "THROTTLED": "throttled", "UPDATE_AVAILABLE": "update_available" } }
            },
        });
    });
    return page;
}

//通过产品平台从新工单获取店铺数据
async function getNewShopBossByPPro(productIds='',page = null) {
    let sqls = 'select DISTINCT ocs.f_copy_wangwangid from t_order as o '
    +' left join t_order_copy_shop as ocs on o.id=ocs.f_foreign_order_id ' 
    +' where o.f_order_status =\'inService\' '
    +' and o.f_product_platform in(\''+ productIds +'\')'+ ' order by o.id asc ';
    let shop_lists = await mysqlCfgSql(config.new_boss, sqls);
    if(page!==null){
        shop_lists = shop_lists.slice(page[0],page[1]);
    }
    shop_lists = Object.values(shop_lists);
    if (shop_lists.length>0){
        return shop_lists
    } else{
        process.exit()
    }
}

// 从boss 新工单获取店铺数据根据子产品获取
async function getNewShopBoss(type='',page = null) {
    let sqls = 'select DISTINCT ocs.f_copy_wangwangid from t_order as o '
    +' left join t_order_copy_shop as ocs on o.id=ocs.f_foreign_order_id ' 
    +' where o.f_order_status =\'inService\' '
    +' and o.f_sub_product_name in(\''+ type +'\')'+ ' order by o.id asc ';
    let shop_lists = await mysqlCfgSql(config.new_boss, sqls);
    if(page!==null){
        shop_lists = shop_lists.slice(page[0],page[1]);
    }
    shop_lists = Object.values(shop_lists);
    if (shop_lists.length>0){
        return shop_lists
    } else{
        process.exit()
    }
}

async function getCZZShopBoss(type='超级推荐',page = null, add_type = '') {
    let sqls = 'select\n' +
        '       distinct t_order.f_copy_wangwangid\n' +
        'from t_order\n' +
        '         left join t_product on t_order.f_foreign_product_id = t_product.id\n' +
        'where t_product.f_foreign_sku_kind in (\'淘宝/天猫代运营\',\''+ type +'\',\''+ add_type +'\''+')'+
        '  and t_order.f_foreign_order_state_id = 2 order by t_order.id asc';
    let shop_lists = await mysqlCfgSql(config.mysql_boss, sqls);
    if(page!==null){
        shop_lists = shop_lists.slice(page[0],page[1]);
    }
    shop_lists = Object.values(shop_lists);
    if (shop_lists.length>0){
        return shop_lists
    } else{
        process.exit()
    }
}


// 从boss 获取订单店铺  操作记录
async function getCZZShopBossOperate(page = null) {
    //筛选条件：主任务保留(（1：未投放，2：投放中）or (3:已暂停 10，冻结中 最近暂停日期30天内) or （4：已结束中 服务结束日期30天内）)
    let sqls =' select distinct t_order.f_copy_wangwangid\n' +
            'from (t_order left join t_product on t_order.f_foreign_product_id = t_product.id) \n' +
            'left join t_task on t_order.id = t_task.f_foreign_order_id\n' +
            'where t_product.f_foreign_sku_kind in (\'超级推荐\',\'直通车\',\'钻展\')\n'+
            'and (t_task.f_foreign_task_state_id in (1,2) \n' +
            'or (t_task.f_foreign_task_state_id in (3,10) and datediff(now(),t_task.f_last_stop_time) <= 30)\n' +
            'or (t_task.f_foreign_task_state_id = 4 and datediff(now(),t_task.f_task_end_time) <= 30))';

    let newSqls = 'select DISTINCT ocs.f_copy_wangwangid from t_order as o '+
    ' left join t_order_copy_shop as ocs on o.id=ocs.f_foreign_order_id '+
    ' left join (SELECT ol.f_foreign_order_id,max(ol.f_effect_date) as f_pause_time from t_order_log as ol where ol.f_event=\'pause\' GROUP'+
    ' BY ol.f_foreign_order_id) as a on a.f_foreign_order_id = o.id where o.f_sub_product_name in(\'引力魔方\',\'直通车\') '+
    ' and ((o.f_order_status in(\'approve\',\'inService\')) '+
    ' or (o.f_order_status in(\'pause\') and datediff(now(),f_pause_time) <= 30) '+
    ' or (o.f_order_status =\'finish\' and datediff(now(),o.f_end_service_date) <= 30))';

    let shop_lists = await mysqlCfgSql(config.mysql_boss, sqls);
    let shop_lists_new = await mysqlCfgSql(config.new_boss, newSqls);
    shop_lists_total = [...shop_lists, ...shop_lists_new]
    let shopList = [];//合并去重后的数组
    shop_lists_total.forEach((value,key)=>{
        if(!shopList.includes(value)){
            shopList.push(value);
        }
    })
    if(page!==null){
        shopList = shopList.slice(page[0],page[1]);
    }
    shopList = Object.values(shopList);
    if (shopList.length>0){
        return shopList
    } else{
        process.exit()
    }
}

// 超直钻历史数据  过滤重复店铺
async function dropHistoryShopList(shop_list, table_name, crawldate) {
    let db = await mongoQuery();
    const data = await db.collection(table_name).find({'date': crawldate}).project({_id: 0, nick_name: 1}).toArray();
    let del_index_arr = [];
    if (data) {
        shop_list.forEach((shop, index, array) => {
            let shop_num = 0;
            data.forEach((d, i, a) => {
                if (shop['f_copy_wangwangid'] === d['nick_name']) {
                    shop_num += 1;
                }
            });
            if (shop_num === 4) {
                del_index_arr.push(index)
            }
        });
        // 删除数组
        del_index_arr.sort(function (a, b) {
            return b - a
        });
        del_index_arr.forEach(function (index) {
            shop_list.splice(index, 1)
        })
    }
    return shop_list;
}


// 从boss 获取所有服务中运营店铺
async function getAllShopBoss() {
    const sqls_yunying = 'select\n' +
        '       distinct t_order.f_copy_wangwangid\n' +
        'from t_order\n' +
        '         left join t_product on t_order.f_foreign_product_id = t_product.id\n' +
        'where t_product.f_foreign_sku_kind in (\'淘宝/天猫代运营\')' + //,
        'and t_order.f_foreign_order_state_id = 2';
    let shop_list_yunying = await mysqlCfgSql(config.mysql_boss, sqls_yunying);
    let shop_list = shop_list_yunying
    if (shop_list.length>0){
        return shop_list;
    } else{
        process.exit()
    }

}
//从新工单中获取服务中的运营店铺数据
async function getAllShopBossNew() {
    const sqls_yunying = 'select DISTINCT ocs.f_copy_wangwangid from t_order as o '
    +' left join t_order_copy_shop as ocs on o.id=ocs.f_foreign_order_id ' 
    +' where o.f_order_status =\'inService\' '
    +' and o.f_top_product_id =2  order by o.id asc ';
    let shop_list_yunying = await mysqlCfgSql(config.new_boss, sqls_yunying);
    let shop_list = shop_list_yunying
    if (shop_list.length>0){
        return shop_list;
    } else{
        process.exit()
    }

   
}






// 从boss 获取所有服务中运营店铺
async function getAllShopBossLiuliangYunying() {
    const sqls_yunying = 'select\n' +
        '       distinct t_order.f_copy_wangwangid\n' +
        'from t_order\n' +
        '         left join t_product on t_order.f_foreign_product_id = t_product.id\n' +
        'where t_product.f_foreign_sku_kind in (\'淘宝/天猫代运营\')' + //,
        'and t_order.f_foreign_order_state_id = 2';
    let shop_list_yunying = await mysqlCfgSql(config.mysql_boss, sqls_yunying);
    const sqls_liuliang = 'select\n' +
        '       distinct t_order.f_copy_wangwangid\n' +
        'from t_order\n' +
        '         left join t_product on t_order.f_foreign_product_id = t_product.id\n' +
        'where t_product.f_foreign_sku_kind in (\'直通车\',\'钻展\',\'超级推荐\')' + //,
        'and t_order.f_foreign_order_state_id = 2';
    let shop_list_liuliang = await mysqlCfgSql(config.mysql_boss, sqls_liuliang);
    let shop_list = shop_list_yunying.concat(shop_list_liuliang);
    if (shop_list.length>0){
        return shop_list;
    } else{
        process.exit()
    }
}

// 从boss 获取所有超直钻，Ai智能投放的店铺
async function getCZZAIShopList() {
    const sqls_czzai = 'select\n' +
        '       distinct t_order.f_copy_wangwangid\n' +
        'from t_order\n' +
        '         left join t_product on t_order.f_foreign_product_id = t_product.id\n' +
        'where t_product.f_foreign_sku_kind in (\'直通车\',\'钻展\',\'超级推荐\',\'万相台\')' +
        'and t_order.f_foreign_order_state_id = 2';
    let shop_list = await mysqlCfgSql(config.mysql_boss, sqls_czzai);
    if (shop_list.length>0){
        return shop_list;
    } else{
        process.exit()
    }
}

// 获取接口数据(jsonp等)
async function getDataFromJsonp(response) {
    let data = null;
    let url = new URL(response.url());
    let params = new URLSearchParams(url.search);
    let callback = eval(params.get('callback') + ' = function(params){ data=params }');
    let text = await response.text();
    eval(text);
    return data;
}

/**
 * 发送请求的方法并解析jsonp数据
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest = async (page,url)=>{
    let reponse = await page.evaluate(async (url) => {
        let headers = {
            // 'referer':'https://tuijian.taobao.com/indexbp.html',
            // 'origin':'https://tuijian.taobao.com/indexbp.html',
            'sec-fetch-mode':'cors',
            'sec-fetch-site':'same-origin',
            'sec-fetch-dest':'empty',
            'content-type':'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url, {headers:headers});
        let data = await response.text();
        var startWith = data.split("(")[0];
        var dataStart = data.split(startWith)[1];
        var dataEnd = dataStart.replace(/;/g, "");
        var str = eval("(" + dataEnd + ")");
        return str;
    },url);
    return reponse;
};

/**
 * 获取请求头数据（token, session_id)
 * @param body
 * @returns {Promise<*[]>} [ token, _h, t]
 */
const getHeader = async function(body) {
    const token = body.match(/token=(\S+?)&/);
    return token[1]
};

/**
 * // 获取更改日限额的列表
 * @param type      // 产品类型
 * @param retry     // 重试（重新爬取 当前时间失败的店铺）
 * @returns {Promise<Object>}   {'店铺'：'计划列表'}
 */
const getBudgetShops = async(type, retry=0) => {
    let shop_dict = {};
    let now = moment().format('HH');
    let crawl_date = moment().format('YYYY-MM-DD');
    let sqls = "select * from t_daily_limit where product_type='" + type + "' and change_time like '" + now + "%' and " +
        "crawl_date != '" + crawl_date + "';";
    if(retry){
        sqls = "select * from t_daily_limit where product_type='" + type + "' and change_time like '" + now + "%' and " +
        "status in (0,2);";
    }
    let shop_list = await mysqlCfgSql(config.mysql_zhizuan, sqls);
    shop_list = Object.values(shop_list);

    if(shop_list.length === 0){
        console.log('当前没有定时任务');
        process.exit();
    }

    await asyncForEach(shop_list, async(shop) => {
        if(shop_dict.hasOwnProperty(shop.wangwangid)){
            let campaign_list = shop_dict[shop.wangwangid];
            campaign_list.push(shop);
            shop_dict[shop.wangwangid] = campaign_list;
        } else {
            shop_dict[shop.wangwangid] = [shop]
        }
    });
    return shop_dict
};


/**
 * // 日限额 数据 更改状态到mysql
 * @param id_key        计划数据的主键id
 * @param status        日限额更新状态
 * @returns {Promise<void>}
 */
const updateStatus  = async (id_key, status) => {
    let crawl_date = moment().format("YYYY-MM-DD");
    let sql = "update t_daily_limit set crawl_date='" + crawl_date + "', status='" + status + "' where id=" + id_key;
    // 更新数据
    let updateStatus = await mysqlCfgSql(config.mysql_zhizuan, sql);
    console.log(updateStatus)
};

module.exports = { asyncForEach, sendDingding, setJs, getUrlParams, getCZZShopBoss, getNewShopBoss,getNewShopBossByPPro, getAllShopBoss, getAllShopBossNew,getCZZAIShopList, getDataFromJsonp,
sendReauest, getAllShopBossLiuliangYunying, getHeader, getBudgetShops, updateStatus, getCZZShopBossOperate, dropHistoryShopList };
