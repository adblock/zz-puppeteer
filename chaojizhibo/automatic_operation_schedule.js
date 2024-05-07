/*
@File     ：automatic_operation_schedule.py
@Author   ：qingyang
@Date     ：2021/6/21 10:37 
@describe ：调度自动操作爬虫，监听爬虫状态
*/
const config = require('../config');
const {asyncForEach} = require('../commons/func');
const {mongoQuery, mongoInit, mysqlCfgSql} = require('../commons/db');
const moment = require('moment');
const { modifyCampaignStatus } = require('./modify_campaign_status_by_wangwang');
const child_process = require('child_process');


let TYPE_CJZB = 'chaozhi';      // 超级直播
let PROCESS_DICT = {};          // 进程列表（每家店铺 对应一个进程）

const new_process = async(wangwang) => {
    console.log(wangwang, ': 开启进程');
    let workerProcess = child_process.fork(config['auto_operation_path'] + 'automatic_operation_spider.js', [ wangwang ]);
    PROCESS_DICT[wangwang] = workerProcess;

    workerProcess.on('out', function (data) {
        let out = 'stdout: ' + data;
        console.log(out, workerProcess.pid);
    });
    workerProcess.on('message', function (message) {
        console.log(message, workerProcess.pid);
    });
    workerProcess.on('error', function (data) {
        let error = 'stderr: ' + data;
        console.log(error, workerProcess.pid);
    });
    workerProcess.on('close', function (code) {
      console.log('closeeeeeeeeeeeeeee', workerProcess.pid);
    });
    const interval = setInterval(async function(){        // 定时（10s）查看 子进程是否还存在，如果不存在删掉进程
        let recv = workerProcess.send('Are you ok?');
        console.log('send to workerProcess and recv:', recv);
        if(!recv){
            console.log('workProcess exit()', workerProcess.pid);
            if(PROCESS_DICT.hasOwnProperty(wangwang)){
                await modifyCampaignStatus(wangwang);
                if(PROCESS_DICT[wangwang]){
                    PROCESS_DICT[wangwang].kill();
                }
                delete PROCESS_DICT[wangwang];
            }
            clearInterval(interval);
        }
    }, 10000);
};

const getAutoShops = async(type) => {
    let now = moment().format('HH:mm:ss');
    let sqls = "select * from t_automatic_operation_spider where f_type='" + type + "' and f_start <= '" + now + "%' and " +
        "f_end > '" + now + "';";
    console.log(sqls);
    let shop_list = await mysqlCfgSql(config.mysql_zhizuan, sqls);
    shop_list = Object.values(shop_list);

    if(shop_list.length === 0){
        console.log('当前没有定时任务');
    } else {    // 过滤 ： 是否在投放中
        let temp_shop_list = [];
        await asyncForEach(shop_list, async(shop) => {
            let wangwang = shop.f_wangwang;
            let boss_sql = `select id from t_order where f_foreign_order_state_id=2 and f_foreign_sku_kind='超级直播' and f_copy_wangwangid='${wangwang}';`
            let order_exist = await mysqlCfgSql(config.mysql_boss, boss_sql);
            if(order_exist.length > 0){
                temp_shop_list.push(shop);
            }
        });
        shop_list = temp_shop_list;
    }
    return shop_list
};

const schedule = async ()=>{
    // 获取数据库 需要自动操作的店铺
    let shop_list = await getAutoShops(TYPE_CJZB);
    console.log(shop_list);
    let wangwang_list = [];
    await asyncForEach(shop_list, async(shop) => {
        let wangwang = shop.f_wangwang;
        if(wangwang_list.indexOf(wangwang) === -1){
            wangwang_list.push(wangwang);
        }
        if(!PROCESS_DICT.hasOwnProperty(wangwang)){  // 如果进程字典里没有这家店铺，执行并存起来
            try {
                await new_process(wangwang);
            } catch (e) {
                console.log(e)
            }
        }
    });
    console.log(wangwang_list);
    // 遍历当前进程字典，如果没有需要自动操作的店铺，需要结束进程
    await asyncForEach(Object.keys(PROCESS_DICT), async(wangwang) => {
        if(wangwang_list.indexOf(wangwang) === -1){
            await modifyCampaignStatus(wangwang);
            if(PROCESS_DICT[wangwang]){
                PROCESS_DICT[wangwang].kill();
            }
            delete PROCESS_DICT[wangwang];
            console.log(wangwang, ': 当前没有可执行定时任务，结束爬虫进程')
        }
    })
}

(async () => {
    await schedule();
    // 每5分钟去查询是否有 新的 需要自动操作的计划
    setInterval(async function () {
        await schedule();
    }, 5 * 1000 * 60);
})();
