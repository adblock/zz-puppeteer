/*
@File     ：automatic_operation_spider.py
@Author   ：qingyang
@Date     ：2021/8/9 10:01
@describe ：超级互动城 自动化操作 爬虫
*/

const puppeteer = require('puppeteer');
const config = require('../config');
const { asyncForEach,setJs } = require('../commons/func');
const { mongoInit, mysqlCfgSql} = require('../commons/db');
const { getCookiesByMongo } = require("../commons/account");
const moment = require('moment');
const log4js = require('log4js');

process.setMaxListeners(999999999);

let CHECK_TIMER = 5;    // 检查周期，以分钟为单位
let G_MONGO = '';
let LOGGER = '';
let IS_RUNNING = {};      // 计划是否正在运行中
let RANGE_PRICE = 0.025;
const startCrawl = async (page, wangwang, campaign_list) => {
    console.log('start');
    // try {
        let token = '';
        let suberr = 1;
        // 拦截请求, 获取fetch需要的token等字段
        await page.setRequestInterception(true);
        page.on('request',  async(request) => {
            if(request.url().indexOf('isProtocolSigned.json') > -1) {
                let params = request.url().match(/&timeStr=(\S+)/);
                if(params.length > 0){
                    token = params[0];       // 获取token 等字段
                }
                return request.continue();
            } else {
                return request.continue();
            }
        });

        // 订阅 reponse 事件，参数是一个 reponse 实体
        await page.on('response', async (response) => {
            try {
                if (response.url().indexOf('https://chaojihudong.taobao.com/indexbp.html') !== -1) {
                    let text = await response.text();
                    if (text.indexOf('_____tmd_____/punish') !== -1) {
                        suberr = 0;
                    }
                }
            } catch (e) {
                if (
                      e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
                      e.message.indexOf('Session closed. Most likely the page has been closed') === -1
                ) {
                    console.log(111111111);
                    await logPrint(e.message);
                }
            }
        });
          // 进入后台
          await page.waitFor(1000 + Math.round(Math.random()) * 100);
          await page.goto('https://hudongcheng.taobao.com/indexbp.html', {waitUntil: "networkidle0"});
          //若cookie 失效，或有滑块，或一直加载状态，开始下一个店铺
          if (page.url().indexOf('https://hudongcheng.taobao.com/index.html') >-1 || page.url().indexOf('punish?x5secdata') > -1 || suberr === 0) {
            await logPrint('页面加载未完成')
          } else {
            if (token) {
                console.log(token)
              await getCampaignCrowd(page, token, campaign_list);
              await logPrint(wangwang + ": 改价成功");
            }
          }
        // } catch (e) {
        //   if (
        //           e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
        //           e.message.indexOf('Session closed. Most likely the page has been closed') === -1
        //   ) {
        //     console.log(222222222);
        //     await logPrint(e.message);
        //   }
        // }
};

/**
 * 获取计划人群数据
 * @param page
 * @param token
 * @param campaign_list
 * @returns {Promise<Array>}
 */
const getCampaignCrowd = async(page, token, campaign_list) => {
    await asyncForEach(campaign_list, async(campaign) => {
        let campaign_id = campaign['f_campaign_id'];
        token = token.replace(/bizCode=(\S+)/, 'bizCode=interactiveLive');

        // 判断 是否是投放时间的开始或结束（开始的时候开启计划，结束的时候暂停计划）
        let today = moment().format('YYYY-MM-DD');
        let start = today + ' ' + campaign['f_start'];
        let end = today + ' ' + campaign['f_end'];
        console.log('start:', moment(start));
        console.log('end:', moment(end));
        console.log('now:', moment());

        await page.waitFor(3000);
        let crowd_dict = await getCrowdInfo(page, token, campaign_id);
        // 出价 策略
        if (Object.keys(crowd_dict).length > 0) {
            if(moment(start) <= moment() && moment() <= moment(end)){   // 在投放时间就 跑改价策略
                // 单元数据
                let adgroup_id = Object.values(crowd_dict)[0]['adgroupId'];
                let crowd_list = [];

                if(!(IS_RUNNING.hasOwnProperty(campaign_id) && IS_RUNNING[campaign_id] === 1)){
                    await asyncForEach(Object.values(crowd_dict), async (crowd) => {
                        crowd_list.push(crowd['crowdId']);
                        let crowd_price = {"campaignId":campaign_id,"adgroupId":adgroup_id,"crowdId":crowd['crowdId'],"targetType":crowd['targetType'],"price":campaign['f_min_price'].toString(),"discount":"","warnPrice":"180","status":"start"};
                        console.log(crowd_price);
                        await modifyPrice(page, token, campaign_id, crowd_price);
                    });
                    await modifyCampaignStatus(page, token, campaign_id, 'start');
                }else {
                    let need_price_crowd_dict = await strategyPrice(crowd_dict, campaign, crowd_list);
                    if(need_price_crowd_dict){  // 修改出价
                        await asyncForEach(Object.values(need_price_crowd_dict), async(crowd) => {
                            let crowd_price = {"campaignId":campaign_id,"adgroupId":adgroup_id,"crowdId":crowd['crowdId'],"targetType":crowd['targetType'],"price":crowd['price'],"discount":"","warnPrice":"180","status":"start"};
                            await modifyPrice(page, token, campaign_id, crowd_price);
                        });
                    } else {    // 超过预算暂停计划
                        await modifyCampaignStatus(page, token, campaign_id, 'pause');
                    }
                }
            } else {    // 将出价改为最低出价并暂停计划
                await modifyCampaignStatus(page, token, campaign_id, 'pause');
            }
        } else {
            console.log('当前计划没有人群。。。');
        }
    });
};

const modifyPrice = async(page, token, campaign_id, need_price_crowd_dict) => {
    let url = 'https://hudongcheng.taobao.com/api/crowd/batchModify.json?' + token;
    let form_data = {
        // 'campaignId': campaign_id,
        'crowdList': JSON.stringify([need_price_crowd_dict])
    };
    let resp = await sendPostRequest(page, form_data, url);
    console.log(resp);
};

/**
 * 改价策略
 * @param crowd_dict
 * @param campaign
 // * @param crowd_list
 * @returns {Promise<void>}
 */
const strategyPrice = async(crowd_dict, campaign) => {
    // let crowd_list = adgroup_data['crowdList'];
    // await asyncForEach(crowd_list, async(crowd) => {
    //     need_price_crowd_dict[crowd['crowdId']] = crowd;
    // });
    let wangwang = campaign['f_wangwang'];
    let campaign_id = campaign['f_campaign_id'];
    let max_price = campaign['f_max_price'];
    await logPrint(wangwang + ': ' + campaign_id);

    let crowds_cost_now = 0;
    let charge_dict = {};
    let need_price_crowd_dict = {};
    await asyncForEach(Object.keys(crowd_dict), async(crowd_key) => {
        let crowd = crowd_dict[crowd_key];
        need_price_crowd_dict[crowd_key] = crowd;
        let reportInfoList = crowd['reportInfoList'];
        if(reportInfoList.length > 0){
            let charge = reportInfoList[0]['charge'];
            if(typeof charge === "number"){
                crowds_cost_now += charge;
                charge_dict[crowd_key] = charge;
            } else {
                charge_dict[crowd_key] = 0;
            }
        } else {
            charge_dict[crowd_key] = 0;
        }
    });
    let budget = campaign['f_budget'];    // 预算
    let total_budget = campaign['total_budget'];    // 总预算
    let start_charge = campaign['f_start_charge'];
    let crawl_date = campaign['f_crawl_date'];
    let today = moment().format('YYYY-MM-DD');

    if(crawl_date !== today){    // 如果不是今天运行的，更新数据
        start_charge = crowds_cost_now;
        // 更新数据库
        let update_sql = `update t_automatic_operation_spider set f_crowd_start_charge='${JSON.stringify(charge_dict)}', f_crawl_date='${today}', f_start_charge=${start_charge} where id=${campaign.id};`;
        console.log(update_sql);
        await mysqlCfgSql(config.mysql_zhizuan, update_sql);
    }
    await logPrint('当前时间总花费(crowds_cost_now): ' + crowds_cost_now);

    // 计算再这段投放时间内的消耗
    let charge_span = crowds_cost_now - start_charge;
    await logPrint('此段投放时间内已经产生的花费(charge_span): ' + charge_span);
    // 如果总消耗 大于等于 总预算了，暂停计划
    if(crowds_cost_now >= total_budget || charge_span >= budget){
        return null
    } else {
        let end_time = today + ' ' + campaign['f_end'];    // 投放 结束时间
        let start_time = today + ' ' + campaign['f_start'];    // 投放 开始时间
        let start_to_end = moment(end_time).diff(moment(), 'minutes');   // 投放时长
        await logPrint('剩余的投放时长(minutes):' + start_to_end);
        let start_to_end_all = moment(end_time).diff(moment(start_time), 'minutes');    // 总投放时长
        let start_to_now = moment().diff(moment(start_time), 'minutes');    // 已经运行的时间
        let should_charge_now = budget/start_to_end_all/Object.keys(crowd_dict).length * start_to_now;
        await logPrint('截止到当前时间每个人群应该的理想花费(should_charge_now): ' + should_charge_now);

        // let average_crowd_cost = (budget-charge_span)/Object.keys(crowd_dict).length;
        // let average_cost = average_crowd_cost/start_to_end*CHECK_TIMER;     // 在最小单位里应该的花费
        if(typeof should_charge_now !== "number"){
            should_charge_now = 0;
        }
        await logPrint('最小单位时间每个人群应该的花费(should_charge_now): ' + should_charge_now);
        // 判断 消耗 改价
        // 获取 该计划最近半个小时的 人群信息
        let crowd_data = await G_MONGO.db.collection('chaojihudong.hudong_crowd_data').find({'nick_name': wangwang,
        'campaign_id': campaign_id, 'created_at': { "$gte" : start_time, "$lt" : end_time}}).sort({"created_at": -1}).toArray();
        if(crowd_data.length > 0){
            let crowd_charge_dict = JSON.parse(campaign.f_crowd_start_charge);
            let crowd_data_recently = crowd_data[0]['data'];    // 最新的一条数据
            await asyncForEach(Object.keys(crowd_data_recently), async(crowd_key) => {        // 1，先去比较最近一次的消耗和现在的消耗
                let crowd = crowd_data_recently[crowd_key];
                console.log(crowd['crowdName']);
                let charge_recently = crowd['reportInfoList'];
                if(charge_recently.length > 0){
                    charge_recently = charge_recently[0]['charge'];
                    if(charge_recently === null){
                        charge_recently = 0;
                    }
                } else{
                    charge_recently = 0;
                }
                await logPrint('最近一次的消耗(charge_recently): ' + charge_recently);
                await logPrint('当前时间的消耗(charge_now): ' + charge_dict[crowd_key]);
                let crowd_charge = 0;
                if(crowd_charge_dict.hasOwnProperty(crowd_key)){
                    crowd_charge = charge_dict[crowd_key] - crowd_charge_dict[crowd_key];
                } else {    // 没有该人群开始时的消耗，可能新增，默认时0并更新数据库
                    // 更新数据库
                    crowd_charge_dict[crowd_key] = crowd_charge;
                    let update_sql = `update t_automatic_operation_spider set f_crowd_start_charge='${JSON.stringify(crowd_charge_dict)}' where id=${campaign.id};`;
                    await mysqlCfgSql(config.mysql_zhizuan, update_sql);
                }
                await logPrint('本次投放时间内该人群的消耗(crowd_charge): ' + crowd_charge);

                if(typeof charge_recently === "number"){
                    if(charge_dict[crowd_key] > charge_recently){       // 当前消耗比上一次消耗 变多了, 下一步判断 周期内花费是否花超（先简单假设，数据每次报存的都是最小单位的检查周期）
                        if(crowd_charge >= should_charge_now){     // 目前的消耗和理想中的消耗对比
                            let check_timer_charge = charge_dict[crowd_key] - charge_recently;  // 一个检查周期内的花费
                            if(check_timer_charge > should_charge_now){      // 一个检查周期内花费超过了应该有的平均花费，降价 （正常的话价格不变）
                                let weight = check_timer_charge/should_charge_now;   // 超出 应该有的平均花费 多少倍
                                if(need_price_crowd_dict.hasOwnProperty(crowd_key)){
                                    let price_now = need_price_crowd_dict[crowd_key]['price'];
                                    let modify_price = price_now - price_now * RANGE_PRICE * weight;    // 百分之五*倍数 降价
                                    if(modify_price < 0.5){
                                        modify_price = 0.5
                                    }
                                    await logPrint('现在的出价(price_now): ' + price_now);
                                    await logPrint('修改后的出价(modify_price): ' + modify_price);
                                    need_price_crowd_dict[crowd_key]['price'] = modify_price
                                }
                            } else {
                                let price_now = need_price_crowd_dict[crowd_key]['price'];
                                let weight = should_charge_now/crowd_charge;
                                need_price_crowd_dict[crowd_key]['price'] = await addPriceWeight(price_now, max_price, weight);
                            }
                        }
                    } else {        // 当前消耗和上次相比没有变化，在比较一下更早的 几条（或者一条）数据 todo
                        let is_modify = true;       // 因为消耗没变化，默认是要加价的
                        if(crowd_charge < should_charge_now){     // 现在消耗小于理想消耗，进行权重加价
                            let price_now = need_price_crowd_dict[crowd_key]['price'];
                            let weight = should_charge_now/crowd_charge;
                            need_price_crowd_dict[crowd_key]['price'] = await addPriceWeight(price_now, max_price, weight);
                        } else {        // 当前消耗大于等于应该花费，正常判断
                            let n = 1;      // todo
                            if(crowd_data.length > n){      // 比较更早的一条，保证有两条数据，同理，如果要比较更早的n条，要有n+1 数据
                                for(let i=1; i<n+1; i++){
                                    let crowd_data_recently_n = crowd_data[i]['data'];    // 最新的第 n 条数据
                                    let crowd_n = crowd_data_recently_n[crowd_key];
                                    let charge_recently_n = crowd_n['reportInfoList'][0]['charge'];
                                    if(charge_recently_n === null){
                                        charge_recently_n = 0;
                                    }
                                    await logPrint('最近n条的花费(charge_recently_n): ' + charge_recently_n);
                                    if(typeof charge_recently_n === "number"){
                                        if(charge_dict[crowd_key] > charge_recently_n){     // 在选择的时间内消耗是有变化的，不需要加价了 （新增：要大于应该有的花费的1/2）
                                            if((charge_dict[crowd_key] - charge_recently_n) > should_charge_now/2){  // 如果这次单位时间内花费没有应该有的花费的1/2，也需要提高出价 todo
                                                is_modify = false;
                                            }
                                        }
                                    }
                                }
                                if(is_modify) {
                                    let price_now = need_price_crowd_dict[crowd_key]['price'];
                                    need_price_crowd_dict[crowd_key]['price'] = await addPriceWeight(price_now, max_price);
                                }
                            }
                        }
                    }
                }
            })
        }
    }
    // 存储 人群列表
    await saveCrowd(wangwang, crowd_dict, campaign_id);
    return need_price_crowd_dict;
};

/**
 * 根据权重加价
 * @param price_now
 * @param max_price
 * @param weight
 * @returns {Promise<void>}
 */
const addPriceWeight = async(price_now, max_price=1, weight=1) => {
    if(weight === Infinity){     // 默认是5倍（Infinity表示人群目前还是0花费）
        weight = 5;
    }
    console.log(price_now, weight);
    let modify_price = price_now + price_now * RANGE_PRICE * weight;   // 百分之五*权重加价
    // let modify_price = price_now + price_now * 0.05;   // 百分之五*权重加价
    if(modify_price > max_price){   // 超过最高出价设为最高出价
        modify_price = max_price;
    }
    await logPrint('现在的出价(price_now): ' + price_now);
    await logPrint('修改后的出价(modify_price): ' + modify_price);
    return modify_price;
};


/**
 * 存储 计划单元数据
 * @param wangwang
 * @param save_data
 * @param campaign_id
 * @returns {Promise<void>}
 */
const saveCrowd = async(wangwang, save_data, campaign_id) => {
    let data = {
        data: save_data,
        campaign_id: campaign_id,
        created_at:moment().format('YYYY-MM-DD HH:mm:ss'),
        updated_at:new Date(),
        nick_name: wangwang
    };
    // 存入数据
    let minutes_30_ago = moment().add(-0.5, "hours").format('YYYY-MM-DD HH:mm:ss');
    await G_MONGO.db.collection('chaojihudong.hudong_crowd_data').deleteMany({'nick_name': wangwang, 'campaign_id': campaign_id, 'created_at': {'$lt': minutes_30_ago}});
    await G_MONGO.db.collection('chaojihudong.hudong_crowd_data').insertOne(data);
};

const getCrowdInfo = async(page, token, campaign_id) => {
    let today = moment().format('YYYY-MM-DD');

    let url = `https://hudongcheng.taobao.com/api/crowd/findPage.json?r=mx_1682&campaignId=${campaign_id}&statusList=%5B%22start%22%2C%22pause%22%5D&offset=0&pageSize=40&needReport=true&reportQuery=%7B%22bizCode%22%3A%22interactiveLive%22%2C%22logDateList%22%3A%5B%22${today}%22%5D%7D&campaignTypeList=%5B%22cpm%22%5D` + token;
    // let url = "https://hudongcheng.taobao.com/api/crowd/findPage.json?r=mx_3135&bizCode=interactiveLive&campaignId=2188819240&statusList=%5B%22start%22%2C%22pause%22%5D&offset=0&pageSize=40&needReport=true&reportQuery=%7B%22bizCode%22%3A%22interactiveLive%22%2C%22logDateList%22%3A%5B%222021-08-09%22%5D%7D&campaignTypeList=%5B%22cpm%22%5D&timeStr=1628491287944&dynamicToken=208224220200212224224216428460208228440488448428&csrfID=16284872587400-781873813125123257";
    console.log(url);
    await page.waitFor(5000);
    let resp = await sendRequest(page, url);
    let resp_list = resp['data']['list'];
    let save_data = {};
    await asyncForEach(resp_list, async(crowd) => {
        save_data[crowd['crowdId']] = crowd;
    });
    return save_data;
};

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendRequest = async (page,url)=>{
    return await page.evaluate(async (url) => {
        let headers = {
            'sec-fetch-mode':'cors',
            'sec-fetch-site':'same-site',
            'sec-fetch-dest':'empty',
            'content-type':'application/x-www-form-urlencoded; charset=UTF-8',
        };
        const response = await fetch(url, {headers:headers});
        return await response.json();
    },url);
};

/**
 * 格式化数据得方法
 * @param {Object} data 数据
 * */
const parseDataToUrl = async (data)=>{
    return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
};

/**
 * 发送请求的方法（POST）
 * @param {Object} page page类
 * @param body
 * @param {String} url  请求的url
 * */
const sendPostRequest = async (page, body, url)=>{
    body = await parseDataToUrl(body);
    return await page.evaluate(async (body,url) => {
        let headers = {
            'sec-fetch-mode':'cors',
            'sec-fetch-site':'same-origin',
            'sec-fetch-dest':'empty',
            'content-type':'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url,
            {
                body:body,
                credentials: 'include',
                method: 'POST',
                headers:headers,
            }
        );
        return await response.json();
    },body,url);
};

/**
 * 发送请求的方法（POST）
 * @param {Object} page page类
 * @param body
 * @param {String} url  请求的url
 * */
const sendPutRequest = async (page, body, url)=>{
    body = await parseDataToUrl(body);
    return await page.evaluate(async (body,url) => {
        let headers = {
            'sec-fetch-mode':'cors',
            'sec-fetch-site':'same-origin',
            'sec-fetch-dest':'empty',
            'content-type':'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url,
            {
                body:body,
                credentials: 'include',
                method: 'PUT',
                headers:headers,
            }
        );
        return await response.json();
    },body,url);
};

//创建浏览器
const setBrowser = async ()=>{
    return await puppeteer.launch({
        headless: config.headless,
        args: [
            "--disable-gpu",
            "--disable-setuid-sandbox",
            "--force-device-scale-factor",
            "--ignore-certificate-errors",
            "--no-sandbox",
        ],
        ignoreDefaultArgs: ["--enable-automation"]
    });
};

// 赋值cookie
const setCookie = async (browser, wangwang)=>{
    let account = await getCookiesByMongo(wangwang);
    // 关闭无用的page
    let pages = await browser.pages();
    await asyncForEach(pages,async function(page,index) {
        if(index>0){
            await page.close();
        }
    });
    await browser.newPage();
    pages = await browser.pages();
    // page配置js
    page = await setJs(pages[1]);
    page.setDefaultTimeout(90000);
    page.setDefaultNavigationTimeout(90000);
    page.setViewport({
        width: 1376,
        height: 1376
    });
    if(account && account.f_raw_cookies){
        // 赋予浏览器圣洁的cookie
        await asyncForEach(account.f_raw_cookies.sycmCookie, async (value, index) => {
            await page.setCookie(value);
        });
    }
    return page;
};


const modifyCampaignStatus = async(page, token, campaign_id, status) => {
    let update_url = 'https://hudongcheng.taobao.com/api/campaign/batchModify.json?' + token;
    console.log(update_url);
    let from_data = {
        'campaignIdList': '[' +campaign_id+ ']',
        'status': status
    };
    if(status === 'start'){
        IS_RUNNING[campaign_id] = 1
    } else {
        IS_RUNNING[campaign_id] = 0;
    }
    let resp = await sendPutRequest(page, from_data, update_url);
    if(resp['info']['ok']){
        await logPrint('计划'+status+'更新成功');
    } else {
        await logPrint('计划'+status+'更新失败', 'error');
        console.log(resp);
    }
};

const getAutoShopByWangwang = async(wangwang) => {
    let now = moment().format('HH:mm:ss');
    let sqls = "select * from t_automatic_operation_spider where f_type='chaohu' and f_start <= '" + now + "%' and " +
        "f_end > '" + now + "' and f_wangwang='" + wangwang + "';";
    console.log(sqls, 'ssss');
    let campaign_list = await mysqlCfgSql(config.mysql_zhizuan, sqls);
    campaign_list = Object.values(campaign_list);
    if(campaign_list.length > 0){
        // 获取总预算
        let sql_budget = `select f_budget from t_automatic_operation_spider where f_type='chaohu' and f_wangwang='${wangwang}'`;
        let shop_budget = await mysqlCfgSql(config.mysql_zhizuan, sql_budget);
        let total_budget = 0;
        await asyncForEach(shop_budget, async(budget) => {
            total_budget += budget.f_budget;
        });
        await asyncForEach(campaign_list, async(campaign) => {
            campaign['total_budget'] = total_budget;
        });
    }
    return campaign_list;
};

const sechdle = async(wangwang) =>{
    G_MONGO = await mongoInit();
    // 获取需要 自动操作的店铺 计划
    let campaign_list = await getAutoShopByWangwang(wangwang);
    if(campaign_list.length > 0){
        let browser = await setBrowser();     // 设置浏览器
        try {
            let page = await setCookie(browser, wangwang);
            await startCrawl(page, wangwang, campaign_list);
            await page.waitFor(1000);
            await browser.close();
            await G_MONGO.close();
        } catch (e) {
            console.log(e);
            await logPrint(wangwang + '改价失败' + e.toString(), 'error');
            if(browser){
                await browser.close();
            }
        }
    } else {
        await logPrint(wangwang + ': 暂无改价任务')
    }
};

const setLog = async(wangwang) => {
    let today = moment().format('YYYY-MM-DD');
    log4js.configure({
        appenders:{
            out:{
                type: 'file',
                filename: 'logs/' + today + '_' + wangwang + '.log'
            }
        },
        categories: { default: { appenders: ["out"], level: "info" }}
    });
    LOGGER = log4js.getLogger('chaojihudongcheng_automatic_operation_spider');
};

const logPrint = async(message, level='info') => {
    if(level === 'info'){
        console.log(message);
        LOGGER.info(message);
    } else if(level === 'error'){
        console.error(message);
        LOGGER.error(message);
    } else {
        console.error('level error' + message);
        LOGGER.error('level error' + message);
    }
};

(async () => {
    const args = process.argv.splice(2);
    let wangwang = args[0];
    await setLog(wangwang);
    await sechdle(wangwang);
    setInterval(function(){
        sechdle(wangwang)
    },CHECK_TIMER *1000 * 60);
})();