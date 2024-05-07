/**
 * 生意參謀 超值钻数据，需要在交易数据爬取完成之后再进行爬取
*/
const https = require("https");
const { spawn } = require('child_process');
const { mysqlQuery, mysqlCfgSql } = require('../commons/db');
const config = require("../config");
const dateFormat = require('dateformat');
const { sendDingding, asyncForEach } = require('../commons/func');
const { getCookiesByMongo } = require('../commons/account');
const { getYesterday } = require("../commons/dateFunc");

(async () => {
    const args = process.argv.splice(2);
    let accountArr = [];
    if(args.length === 2){     // 店铺和日期都输入
        let wangwang = args[0];
        let crawl_date = args[1];
        const account = await getCookiesByMongo(wangwang);
        if(account){
            accountArr.push([account, crawl_date])
        }
    } else if (args.length === 1) {   // 只传一个参数
        if(args[0].match(/^\d{4}-\d{1,2}-\d{1,2}$/)){       // 判断传入的是日期还是店铺
            let crawl_date = args[0];
            const sqls = 'select\n' +
            '       distinct t_order.f_copy_wangwangid\n' +
            'from t_order\n' +
            '         left join t_product on t_order.f_foreign_product_id = t_product.id\n' +
            'where t_product.f_foreign_sku_kind =\'淘宝/天猫代运营\'' +
            '  and t_order.f_foreign_order_state_id = 2;';
            let shop_lists = await mysqlCfgSql(config.mysql_boss, sqls);
            for(let shop of shop_lists){
                const account = await getCookiesByMongo(shop.f_copy_wangwangid);
                if(account){
                    accountArr.push([account, crawl_date])
                }
            }
        } else {
            let wangwang = args[0];
            const account = await getCookiesByMongo(wangwang);
            const day = dateFormat(new Date(new Date().getTime() - 24*60*60*1000), 'dd');
            const mouth = dateFormat(new Date(new Date().getTime() - 24*60*60*1000), 'yyyy-mm');    // 本月
            if(account){
                for(let i=1; i<=day; i++){
                    const itemDate = mouth + '-' + ('0' + i).slice(-2);
                    accountArr.push([account, itemDate])
                }
            }
        }
    } else if (args.length === 0) {       // 没有参数
        let crawl_date = await getYesterday();
        const shop_list = await getYunyingShop();
        for(let shop of shop_list){
            const account = await getCookiesByMongo(shop.f_copy_wangwangid);
            if(account){
                accountArr.push([account, crawl_date])
            }
        }
    }
console.log(accountArr)
    if(accountArr.length > 0){
        let group_num = config.canmou_index_concurrency;
        // 运行结果
        let current_spider  = [];
        let result_spider   = [];
        let dingding_result = {
            'success': [],
            'error': []
        };
        await run_spider(accountArr, 0, group_num-1, current_spider, result_spider, group_num, dingding_result);
    }else {
        process.exit()
    }

})();

async function run_spider(shop_list, start, end, current_spider, result_spider, group_num, dingding_result){
    console.log(start, end);
    console.log(dingding_result);

    shop_list.forEach((element , index)=> {
        if(index  >= start && index  <= end){
            let crawl_date = element[1];
            element = element[0];
            // 运行写入
            current_spider.push(element.wangwang_id);

            // 唤起爬虫
            ls = spawn('node', [config.canmou_login_user_data+'/czz_data_day.js', element.wangwang_id, crawl_date]);
            ls.stdout.on('data', (data) => {
                console.log(element.wangwang_id);
                console.log(`stdout: ${data}`);
            });
            ls.stderr.on('data', (data) => {
                console.log(element.wangwang_id);
                const stderr = `stderr: ${data}`;
                console.error(stderr);
                const errLen = dingding_result['error'].length
                let flag = true;
                for (let errVal of dingding_result['error']) {
                    if (errVal.indexOf(element.wangwang_id) > -1) {
                        flag = false;
                        break;
                    }
                }
                if (errLen === 0 || flag){
                    let err_mess = element.wangwang_id + '----' + stderr;
                    err_mess += 'dateeeeeeeeeee:------' + crawl_date + '\n';
                    dingding_result['error'].push(err_mess)
                }

            });
            // 关闭打印
            ls.on('close', async (code) => {
                console.log(current_spider);
                const errLen = dingding_result['error'].length
                let flag = true;
                for (let errVal of dingding_result['error']) {
                    if (errVal.indexOf(element.wangwang_id) > -1) {
                        flag = false;
                        break;
                    }
                }
                console.log(flag)
                if (errLen === 0 || flag){
                    let mess = element.wangwang_id;
                    mess += '---date: ' + crawl_date + '\n';
                    dingding_result['success'].push(mess)
                }
                console.log('all=======================,'+result_spider);
                current_spider.find((e, i)=>{
                    if(e ===  element.wangwang_id){
                        console.log(element.wangwang_id);
                        // 从当前的运行列表删除，添加到结果列表
                        current_spider.splice(i, 1);
                        result_spider.push(element.wangwang_id);
                    }
                });

                if(current_spider.length == 0 && result_spider.length<shop_list.length){
                    // 启动下一轮
                    console.log('启动下一轮');
                    await run_spider(shop_list, start+group_num, end+group_num, current_spider, result_spider, group_num, dingding_result);
                }
                if(result_spider.length==shop_list.length){
                    console.log('close');
                    console.log(result_spider);
                    console.log(dingding_result);
                    let errText = '\n失败的店铺：\n'+dingding_result['error'];
                    const text = config.serverName + "-生意参谋 交易数据 爬虫运行结果：\n成功爬取的店铺：\n" + dingding_result['success'].toString().replace(/,/g, '\n') + errText.replace(/,/g, '')
                    await sendDingding(text);
                }
            });
        }

    });
}

async function getYunyingShop() {
    // 先判断是否有昨天的数据
    const mouth = dateFormat(new Date(new Date().getTime() - 24*60*60*1000), 'yyyy-mm');
    const day = dateFormat(new Date(new Date().getTime() - 24*60*60*1000), 'dd');
    // 过滤已爬取店铺
    const sqls = 'select\n' +
    '       distinct t_order.f_copy_wangwangid\n' +
    'from t_order\n' +
    '         left join t_product on t_order.f_foreign_product_id = t_product.id\n' +
    'where t_product.f_foreign_sku_kind =\'淘宝/天猫代运营\'' +
    '  and t_order.f_foreign_order_state_id = 2;';
    let shop_lists = await mysqlCfgSql(config.mysql_boss, sqls);
    shop_lists = Object.values(shop_lists);
    console.log(shop_lists.length);
    await asyncForEach(shop_lists, async (shop, index) => {
        const sql = "select count(id) from t_yunying_czz_day where f_date like'" + mouth + "%' and f_shop='" + shop.f_copy_wangwangid +"'";
        const count = await mysqlCfgSql(config.mysql_zhizuan, sql);
        if (count[0]['count(id)'] === Number(day)){
            shop_lists.splice(index, 1)
        }
    });
    console.log(shop_lists.length);
    if (shop_lists.length>0){
        return shop_lists
    } else{
        process.exit()
    }
}
