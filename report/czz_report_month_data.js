/**
 * 报表
 * 生意参谋，直通车，超级推荐，钻展        昨日数据+ 月每天数据+月汇总数据
 */
const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getCZZAIShopList} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const dateFormat = require('dateformat');
const moment = require('moment');
const { getYesterday } = require('../commons/dateFunc');
const { getCookiesByMongo } = require("../commons/account");

process.setMaxListeners(999999999);

const G_NUM = config.tuijian_spider_concurrency; // 浏览器的启动数量
let G_BROWSER_LIST = []; // 浏览器列表
let G_SHOP_LIST = []; // 店铺列表
let G_CRAWL_DATE = ''; // 抓取数据的时间
let G_END_SHOP_HASH = {}; // 请求结束的店铺
let G_SHOP_LIST_ORG = []; // 原始的店铺列表

const startCrawl = async (shop, orgBrowser, retry = 0) => {
    let wangwang = shop.wangwang;
    console.log(wangwang);
    let browserWSEndpoint = orgBrowser.ws;
    let browser = await puppeteer.connect({browserWSEndpoint});
    try {
        const new_page = await setCookie(browser, wangwang);
        //开始爬取数据： 生意参谋，超 直 钻
        await getCrawlDate(new_page, wangwang, browser);
        console.log('over');
        await endAndAdd(wangwang, browser);

    } catch (e) {
        if (
            e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
            e.message.indexOf('Session closed. Most likely the page has been closed') === -1
        ) {
            console.log(222222222);
            console.log(e.message);
            //重试三次
            retry = retry + 1;
            if (retry < 3) {
                await startCrawl(shop, orgBrowser, retry);
            } else {
                await endAndAdd(wangwang, browser);
            }
        }
    }
};

//获取爬取的时间
const getCrawlDate = async (new_page, wangwang, browser) => {
    let date = new Date();
    let firstDay = '';
    let lastDay = '';
    let yesterday = await getYesterday();
    //日期的处理
    if (date.getDate() === 1) {   //本月的1号，取上个月的数据, 否则取1号到昨天的数据
        firstDay = dateFormat(new Date(date.getFullYear(), date.getMonth() - 1, 1), 'yyyy-mm-dd');       //上个月的第一天
        lastDay = dateFormat(new Date(date.getFullYear(), date.getMonth(), 0), 'yyyy-mm-dd');                   //上个月的最后一天
    } else {
        firstDay = dateFormat(new Date(date.getFullYear(), date.getMonth(), 1), 'yyyy-mm-dd');   // 本月第一天
        lastDay = await getYesterday();            //昨天
    }
    console.log(firstDay, '-->', lastDay);
    let effect_key = ['click', 'impression'];   //存数据库 的键,效果 点击效果，展现效果
    let time_key = ['total', 'day', 'month'];   //日 ，月， 本月总计
    let result_citj = {};
    let result_zz = {};
    let page;
    //本月2号，total == day == month
    if (date.getDate() === 2) {
        //超级推荐
        let time_citj = [firstDay, lastDay, 30, 'tuijian.taobao.com/api/account/report/findDaySum.json?'];
        //遍历点击 or 展现效果
        await asyncForEach(effect_key, async (effect) => {
            result_citj[effect] = {};
            let data_cjtj = await getDayData_Citj(new_page, time_citj[0], time_citj[1], time_citj[2], time_citj[3], effect);
            result_citj[effect] = {'total': data_cjtj, 'day': data_cjtj, 'month': data_cjtj};

        })

        await new_page.close();  //新开一个页面
        page = await setCookie(browser, wangwang);

        //钻展
        let time_zz = [firstDay, lastDay, 30, 'zuanshi.taobao.com/api/report/account/findDaySum.json?'];
        //遍历点击 or 展现效果
        await asyncForEach(effect_key, async (effect) => {
            result_zz[effect] = {};
            let data_zz = await getDayData_Zz(page, time_zz[0], time_zz[1], time_zz[2], time_zz[3], effect);
            result_zz[effect] = {'total': data_zz, 'day': data_zz, 'month': data_zz};
        })

    } else {
        // 超级推荐  点击/展现效果   月汇总数据 + 昨日数据+ 月每天数据  ,
        let time_citj = {
            'total': [firstDay, lastDay, 30, 'tuijian.taobao.com/api/account/report/findDaySum.json?'],
            'day': [yesterday, yesterday, 30, 'tuijian.taobao.com/api/account/report/findDayList.json?'],
            'month': [firstDay, lastDay, 30, 'tuijian.taobao.com/api/account/report/findDayList.json?']
        };
        //遍历点击 or 展现效果
        await asyncForEach(effect_key, async (effect) => {
            result_citj[effect] = {};
            //遍历 日期：日，月，本月总计。  参数为：日期，转化周期，接口url
            await asyncForEach(time_key, async (key, index) => {
                let startDate = time_citj[key][0];
                let endDate = time_citj[key][1];
                let period = time_citj[key][2];    //转换周期 3天，或 15 天
                let url_param = time_citj[key][3];
                console.log('---------------------->', index);
                //请求接口获取数据
                let data = await getDayData_Citj(new_page, startDate, endDate, period, url_param, effect);
                result_citj[effect][key] = data;
            })
        })

        await new_page.close();  //新开一个页面
        page = await setCookie(browser, wangwang);

        //钻展  点击/展现效果  月汇总数据 + 昨日数据+ 月每天数据 ,
        let time_zz = {
            'total': [firstDay, lastDay, 30, 'zuanshi.taobao.com/api/report/account/findDaySum.json?'],
            'day': [yesterday, yesterday, 30, 'zuanshi.taobao.com/api/report/account/findDayList.json?'],
            'month': [firstDay, lastDay, 30, 'zuanshi.taobao.com/api/report/account/findDayList.json?']
        };
        //遍历点击 or 展现效果
        await asyncForEach(effect_key, async(effect)=>{
            result_zz[effect] = {};
            //遍历 日期：日，月，本月总计。  参数为：日期，转化周期，接口url
            await asyncForEach(time_key, async (key, index) => {
                let startDate = time_zz[key][0];
                let endDate = time_zz[key][1];
                let period = time_zz[key][2];    //转换周期 3天，或 15 天
                let url_param = time_zz[key][3];
                console.log('--------------', index);
                //请求接口获取数据
                let data = await getDayData_Zz(page, startDate, endDate, period, url_param, effect);
                result_zz[effect][key] = data;
            })
        })
    }
    await page.close();  //新开一个页面
    let next_page = await setCookie(browser, wangwang);

    //生意参谋日数据
    let result_canmou = await getDayData_Canmou(next_page, wangwang, browser);

    //直通车
    //月汇总数据 + 昨日数据+ 月每天数据
    let time_ztc = {
        'total': [firstDay, lastDay],
        'day': [yesterday, yesterday],
        'month': [firstDay, lastDay]
    };
    let result_ztc = {};
    await asyncForEach(time_key, async (key, index) => {
        let data;
        let startDate = time_ztc[key][0];
        let endDate = time_ztc[key][1];
        console.log('-------------------', index);   //转化周期默认为30天
        if (key.includes('total') === false) {
            //请求接口获取数据
            data = await getDayData_Ztc(next_page, wangwang, startDate, endDate);
        } else {
            data = await getTotalData_Ztc(next_page,wangwang, startDate, endDate);
        }
        result_ztc[key] = data;
    })

    //Ai 智投
    let result_ai = await getDayCost_AI(next_page, firstDay, lastDay, yesterday);

    //保存数据到mongo
    await saveData(wangwang, result_canmou[0], result_ztc, result_citj, result_zz, result_ai, result_canmou[1]);
}

/**
 * 超级推荐     报表-> 商品推广-> 数据汇总   日数据+ 本月每日数据+ 月数据
 * @param page
 * @param startDate  开始时间
 * @param endDate    结束时间
 * @param period     转化周期
 * @param url_param   接口url
 * @param effect    点击/展现效果
 * @returns {Promise<{}>}
 */
const getDayData_Citj = async (page, startDate, endDate, period, url_param, effect) => {
    let data = {};
    let params = '';
    page.on('response', async (response) => {
        //获取指定时间段的url
        if (response.url().indexOf(url_param) > -1) {
            let url_resp = response.url();
            let url_time = '&startTime=' + startDate + '&endTime=' + endDate + '&effect=30&effectType=' + effect + '&';
            if (url_resp.includes(url_time) > -1) {
                params = url_resp.match(/&timeStr=\S+/) + '';
            } else {
                console.log('url拼接error');
            }
        }
    });
    // 进入后台
    let url = 'https://tuijian.taobao.com/indexbp-feedflow.html#!/report/item?alias=item&bizCode=feedFlowItem&perspective=report&startTime=' + startDate + '&endTime=' + endDate + '&vs=false&effectType='+effect+'&tab=campaign';
    await page.goto(url, {waitUntil: "networkidle0"});
    //未登录处理
    if (page.url().indexOf('https://tuijian.taobao.com/index.html?mxredirectUrl=') > -1) {
        console.log('cookies失效或超级推荐未授权');
    } else {
        await page.waitFor(3000);  //等待接口响应的参数
        let url_cjtj = 'https://' + url_param + '&bizCode=feedFlowItem&startTime=' + startDate + '&endTime=' + endDate + '&effect=' + period + '&effectType=' + effect + params;
        console.log('超级推荐', url_cjtj);
        let resp = await sendReauest(page, url_cjtj);
        if (resp['data']['list']) {
            data = resp['data']['list'];
        }
    }
    return data;
}

/**
 * 钻展      报表->账户汇总报表-> 数据汇总  日数据+ 本月每日数据+ 月数据
 * @param page
 * @param startDate   开始时间
 * @param endDate     结束时间
 * @param period      转化周期
 * @param url_param   接口url
 * @param effect    点击/展现效果
 * @returns {Promise<{}>}
 */
const getDayData_Zz = async (page, startDate, endDate, period, url_param, effect) => {
    let data = {};
    let params = '';
    page.on('response', async (response) => {
        //获取指定时间段的url
        if (response.url().indexOf(url_param) > -1) {
            let url_resp = response.url();
            let url_time = '&startTime=' + startDate + '&endTime=' + endDate + '&effectType=' + effect + '&';
            if (url_resp.includes(url_time) > -1) {
                params = url_resp.match(/&timeStr=\S+/) + '';
            } else {
                console.log('url拼接error');
            }
        }
    });
    // 进入后台
    let url = 'https://zuanshi.taobao.com/index_poquan.jsp#!/report1/whole?startTime=' + startDate + '&endTime=' + endDate + '&effectType='+effect;
    await page.goto(url, {waitUntil: "networkidle0"});
    //未登录处理
    if (page.url().indexOf('https://zuanshi.taobao.com/index.html?mxredirectUrl=') > -1) {
        console.log('cookies失效或钻展未授权');
    } else {
        await page.waitFor(5000);  //等待接口响应的参数
        let url_zz = 'https://' + url_param + '&startTime=' + startDate + '&endTime=' + endDate + '&effectType=' + effect + '&effectPeriod=' + period + params;
        console.log('钻展', url_zz);
        let resp = await sendReauest(page, url_zz);
        if (resp['data']['list']) {
            data = resp['data']['list'];
        }
    }
    return data;
}
/**
 * 生意参谋的数据   首页-> 运营视窗     店铺月总销售额+ 日数据+ 月数据
 * @param page
 * @param wangwang
 * @param browser
 * @returns {Promise<{}>}
 */
const getDayData_Canmou = async (page, wangwang, browser) => {
    let token = '';
    let suberr = false;  //标识是否出现滑块
    let result;
    let result_uv;
    page.on('response', async (response) => {
        //出现滑块
        if (response.url().indexOf('_____tmd_____/punish') !== -1) {
            await page.waitFor(3000);
            suberr = true;  //出现滑块
        }
        //获取token
        if (response.url().indexOf('getPersonalView.json?') > -1) {
            token = response.url().match(/token=.*?&|token=.*?/)+ '';
        }
    });
    // 进入后台
    await page.goto('https://sycm.taobao.com/portal/home.htm?');
    if (page.url().indexOf('sycm.taobao.com/custom/login.htm?') !== -1 || page.url().indexOf('sycm.taobao.com/custom/no_permission') !== -1 || suberr) {
        console.log('Cookie过期或生意参谋未授权');
        await endAndAdd(wangwang, browser);
    } else {
        let yesterday = await getYesterday();
        //首页-> 运营视窗 ，店铺月总销售额+ 日数据+ 月数据
        result = await getCanmouMonthData(page, token, yesterday);
        //流量-> 店铺来源  获取超 直 钻 万相台 本月每天的访客数
        result_uv = await getCanmouUvData(page, token, yesterday);
    }
    return [result, result_uv];
}


/**
 * 生意参谋-> 首页-> 运营视窗 ，店铺月总销售额+ 日数据+ 月数据
 * @param page
 * @param token
 * @param yesterday    昨天
 * @returns {Promise<{}>}
 */
const getCanmouMonthData = async(page, token, yesterday)=>{
    let result = {};
    let category = ['total', 'day', 'month'];  //店铺月总销售额+ 日数据+ 月数据
    await asyncForEach(category, async (item, index) => {
        await page.waitFor(1000);
        console.log('------------', item, index);
        let url = '';
        if (item.includes('total')) {
            let date = new Date();
            let firstDay = dateFormat(new Date(date.getFullYear(), date.getMonth() - 1, 1), 'yyyy-mm-dd');       //上个月的第一天
            let lastDay = dateFormat(new Date(date.getFullYear(), date.getMonth(), 0), 'yyyy-mm-dd');                   //上个月的最后一天
            url = 'https://sycm.taobao.com/portal/coreIndex/getShopMainIndexes.json?dateType=month&dateRange=' + firstDay + '%7C' + lastDay + '&device=0&' + token;
        } else if (item.includes('day')) {
            url = 'https://sycm.taobao.com/portal/coreIndex/getShopMainIndexes.json?dateType=day&dateRange=' + yesterday + '%7C' + yesterday + '&device=0&' + token;
        } else if (item.includes('month')) {
            url = 'https://sycm.taobao.com/portal/coreIndex/getTableData.json?dateRange=' + yesterday + '%7C' + yesterday + '&dateType=day&device=0&indexCode=&' + token;
        } else {
            console.log('生意参谋，error');
        }
        console.log('生意参谋', url);
        let data;
        let resp = await sendReauest_Canmou(page, url);
        let content = resp['content']['data'];

        if (content) {
            //月数据处理，只保留本月的数据
            if(item.includes('month')){   //时间戳转化为日期格式，且保存本月的数据
                data = [];
                let date =new Date();
                let firstday;
                if(date.getDate() === 1){   //是否为本月的1号，是， 则取上个月的1号
                    firstday = new Date(date.getFullYear(), date.getMonth()-1, 1).getTime();
                }else{
                    firstday = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
                }
                await asyncForEach(content, async(items)=>{
                    let stamp = items['statDate'];
                    if (stamp >= firstday) {     //大于或等于1号时间戳，则添加date属性
                        items['date'] = moment(stamp).format('YYYY-MM-DD');
                        data.push(items);
                    }
                })
            }else{
                data = content;
            }
        }
        result[item] = data;
    })
   return result;
}

/**
 * 生意参谋->流量 ->店铺流量->付费流量  获取超 直 钻 万相台 本月每天的访客数
 * @param page
 * @param token
 * @param yesterday      昨天
 * @returns {Promise<{}>}
 */
const getCanmouUvData = async (page, token, yesterday) => {
    let page_url ='https://sycm.taobao.com/flow/monitor/shopsource/construction?belong=all&dateRange='+yesterday+'%7C'+yesterday+'&dateType=today';
    await page.goto(page_url,{waitUntil: "networkidle0"});
    let url_trend = 'https://sycm.taobao.com/flow/v5/shop/source/tree.json?dateRange=' + yesterday + '%7C'
        + yesterday + '&dateType=recent1&order=desc&orderBy=uv&device=2&belong=all&' + token;
    console.log('-------------->访客数');
    let respon_trend = await sendReauest(page, url_trend);
    let detail_uv = {};
    //取出超 直 钻 万相台的pageId ,作为url参数，保存为字典格式
    if (respon_trend['data']) {
        await asyncForEach(respon_trend['data'], async (trend_item) => {
            if (trend_item['pageName']['value'].includes('付费流量')) {   //一级目录
                let type = {'万相台': 'ai', '直通车': 'ztc', '超级推荐': 'cjtj', '智钻': 'zz', 'AI智能投放': 'ai'};

                if (trend_item['children']) {
                    await asyncForEach(trend_item['children'], async (item) => {     //二级目录
                        let name = item['pageName']['value'];
                        //取出平台的id, 并保存为字典
                        if (Object.keys(type).includes(name)) {
                            let param_id = '&pageId=' + item['pageId']['value'] + '&pPageId=' + item['pPageId']['value'];
                            detail_uv[type[name]] = param_id;
                        }
                    })
                }
            }
        })
    }

    //处理日期，获取uv 访客数
    let date = new Date();
    let url_params ='';
    let count_month = 0;  //截取数组的个数 与天数相同
    if (date.getDate() === 1) {   //本月的1号，取上个月的数据, 接口不同， 否则默认昨天
         let lastmonth_first = dateFormat(new Date(date.getFullYear(), date.getMonth() - 1, 1), 'yyyy-mm-dd');       //上个月的第一天
         let lastmonth_end = dateFormat(new Date(date.getFullYear(), date.getMonth(), 0), 'yyyy-mm-dd');                   //上个月的最后一天
         let beforemonth_first = dateFormat(new Date(date.getFullYear(), date.getMonth() - 2, 1), 'yyyy-mm-dd');       //上上个月的第一天
         let beforemonth_end = dateFormat(new Date(date.getFullYear(), date.getMonth()-1, 0), 'yyyy-mm-dd');           //上上个月的最后一天
         url_params = 'https://sycm.taobao.com/flow/long/period/nodistinct/shop/source/trend.json?dateType=compareRange&dateRange='+lastmonth_first+'%7C'+lastmonth_end+'%2C'+beforemonth_first+'%7C'+beforemonth_end;
         count_month = 31;
    } else {
        url_params = 'https://sycm.taobao.com/flow/v3/shop/source/trend.json?dateType=recent1&dateRange='+yesterday+'%7C'+yesterday;
        let day =new Date(yesterday);
        count_month = day.getDate();
    }
    //请求四个平台 超 直 钻 万相台 ,本月每天访客的数据
    let keys =['ai','ztc','cjtj','zz'];
    let result_uv = {};
    await asyncForEach(keys, async(item)=>{
        let pageId= detail_uv[item];
        let url = url_params+'&indexCode=uv&device=2&belong=all'+pageId+'&'+token;
        let respon = await sendReauest(page, url);
        //截取本月的天数 的访客数
        if(respon['data']){
            respon['data']['my'] = respon['data']['my'].splice(-count_month,count_month);
            result_uv[item] = respon['data'];
        }
    })
    return result_uv;
}

/**
 * 直通车     报表-> 账户报表 ->数据汇总   日数据+ 本月每日数据
 * @param page
 * @param wangwang
 * @param startDate   开始时间
 * @param endDate     结束时间
 * @returns {Promise<{}>}
 */
const getDayData_Ztc = async (page, wangwang, startDate, endDate) => {
    let sessionid = '';
    let token = '';
    page.on('response', async (response) => {
        if (response.url().indexOf('component/subway-guide/find.htm?') > -1) {
            let params = response.url();
            sessionid = params.match(/&sessionId\S+/);
            token = params.match(/&token.*?&/);
            if (!sessionid) {
                sessionid = '&';
            }
        }
    });
    // 进入后台
    let url = '';
    if (wangwang.includes('海外旗舰店')) {
        url = 'https://subway.simba.tmall.hk/index.jsp#!/report/bpreport/index';
    } else {
        url = 'https://subway.simba.taobao.com/#!/report/bpreport/index?page=1&start=' + startDate + '&end=' + endDate + '&effect=30';
    }
    await page.goto(url, {waitUntil: "networkidle0"});
    await page.waitFor(2000);
    let data = {};
    //未登录处理
    if (page.url().indexOf('https://subway.simba.taobao.com/indexnew.jsp') > -1) {
        console.log('cookies失效或直通车未授权');
    } else {
        let url_ztc = '';
        if (wangwang.includes('海外旗舰店')) {
            url_ztc = 'https://subway.simba.tmall.hk/openapi/param2/1/gateway.subway/rpt/rptCustomerByDay$?queryParam=%7B%22startDate%22%3A%22' + startDate + '%22%2C%22endDate%22%3A%22' + endDate + '%22%2C%22effect%22%3A%2230%22%7D&sla=json&isAjaxRequest=true' + token + '&_referer=%2Freport%2Fbpreport%2Findex%3Fpage%3D1%26start%3D' + startDate + '%26end%3D' + endDate + '%26effect%3D30' + sessionid;
        } else {
            url_ztc = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/rpt/rptCustomerByDay$?' +
                'queryParam=%7B%22startDate%22%3A%22' + startDate + '%22%2C%22endDate%22%3A%22' + endDate + '%22%2C%22effect%22%3A%2230%22%7D&sla=json&isAjaxRequest=true' + token + '%26effect%3D30%26start%3D' + startDate + '%26end%3D' + endDate + sessionid;
         }

        let resp = await sendReauest(page, url_ztc);
        if (resp['result']) {
            data = resp['result'];
        }
    }
    return data;
}
/**
 * 直通车       报表-> 账户报表 ->数据汇总    月数据
 * @param page
 * @param startDate    开始时间
 * @param endDate      结束时间
 * @returns {Promise<*>}
 */
const getTotalData_Ztc = async (page, wangwang, startDate, endDate) => {
    let data;
    let token = '';
    page.on('response', async (response) => {
        //获取token
        if (response.url().indexOf('gateway.subway/common/campaign/list$?') > -1) {
            let params = response.url();
            token = params.match(/(?<=&token=).*?(?=&)/) + '';
        }
    });

    // 进入后台
    let url = 'https://subway.simba.taobao.com/#!/manage/campaign/index';
    await page.goto(url, {waitUntil: "networkidle0"});
    await page.waitFor(3000);  //等待接口响应的参数
    console.log('IM token', token);
    let url_ztc ='';
    if (wangwang.includes('海外旗舰店')) {
        url_ztc = 'https://subway.simba.tmall.hk/openapi/param2/1/gateway.subway/rpt/rptCustomerTotal$';
    }else{
        url_ztc = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/rpt/rptCustomerTotal$';
    }
    let body = {
        "queryParam": JSON.stringify({"page": "1", "pageSize": 40, "startDate": startDate,
            "endDate": endDate, "effectEqual": "30", "pvType": ["1", "4", "2", "5", "6"]}),
        "sla": "json",
        "isAjaxRequest": true,
        "token": token,
        "_referer": "/report/bpreport/index?page=1&start=" + startDate + "&end=" + endDate + "&effect=30",
    }
    let resp = await sendReauest_Ztc(page, body, url_ztc);
    if (resp['result']) {
        data = resp['result'];
    }
    return data;
}

/**
 * AI智投   报表->  账户总览 -> 数据汇总   店铺月总销售额+ 日数据+ 月数据  默认转化周期15天
 * @param page
 * @param firstDay         本月开始日期
 * @param lastDay          本月结束日期
 * @param yesterday        昨日
 * @returns {Promise<{}>}
 */
const getDayCost_AI = async (page, firstDay, lastDay, yesterday) => {
    let csrfID = '';
    page.on('response', async (response) => {
        if (response.url().indexOf('adbrain.taobao.com/api/gw/strategy/brand/find.json?') > -1) {
            csrfID = response.url().match(/&csrfID=\S+/);
        }
    });
    // 进入后台
    let url = 'https://adbrain.taobao.com/#!/strategy/overview?';
    await page.goto(url, {waitUntil: "networkidle0"});
    let video_pop = await page.$('.fXFonOkacZ >div > div > div>div');
    if (video_pop) {  //弹出动画，则关闭
        await page.click('.fXFonOkacZ >div > div > div>div')
    }
    let result = {};
    //未登录处理
    if (page.url().indexOf('https://adbrain.taobao.com/index.html') > -1) {
        console.log('Ai智投->账号未授权');
    } else {
        let keys= ['total', 'day', 'month'];
        let ai_time = {
            'total': [firstDay, lastDay, 'findOverProductAccount.json?'],
            'day': [yesterday, yesterday, 'findOverProductAccountDayList.json?'],
            'month': [firstDay, lastDay, 'findOverProductAccountDayList.json?']
        };
        await asyncForEach(keys, async (key, index) => {
            let startDate = ai_time[key][0];
            let endDate = ai_time[key][1];
            let url_param = ai_time[key][2];
            console.log('ai智投----------', index);
            let url_ai = 'https://adbrain.taobao.com/api/account/report/' + url_param + '&startTime=' + startDate + '&endTime=' + endDate + '&effect=30&bizCode=dkx&unifyType=kuan' + csrfID;
            let resp = await sendReauest(page, url_ai);

            let content = resp['data']['list'];
            //月每天的数据，需要将日期作为键值
            if (content) {
                if (key.includes('month')) {
                    result[key] = {};
                    await asyncForEach(content, async (item) => {
                        result[key][item['logDate']] = item;
                    })
                } else {
                    result[key] = content;
                }
            }
        })
    }
    return result;
}

/**
 * 结束并添加到end里面，并调取下一家
 * @param wangwang
 * @param browser
 * @returns {Promise<void>}
 */
const endAndAdd = async (wangwang, browser) => {
    if (browser) {
        await addShopToEndList(wangwang);
        await browser.close();
        await setBrowser();
        await assign();
    } else {
        await addShopToEndList(wangwang);
        await setBrowser();
        await assign();
    }

};

const sendReauest_Canmou = async (page, url) => {
    return await page.evaluate(async (url) => {
        let headers = {
            'referer': 'https://sycm.taobao.com/portal/home.htm',
            'sycm-referer': '/portal/home.htm',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-dest': 'empty',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url, {headers: headers});
        return await response.json();
    }, url);
};
/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest = async (page, url) => {
    return await page.evaluate(async (url) => {
        let headers = {
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-dest': 'empty',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url, {headers: headers});
        return await response.json();
    }, url);
};
/**
 * 格式化数据得方法
 * @param {Object} data 数据
 * */
const parseDataToUrl = async (data) => {
    return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
};

//发送post请求
const sendReauest_Ztc = async (page, body, url) => {
    body = await parseDataToUrl(body);
    return await page.evaluate(async (body, url) => {
        let headers = {
            'origin': 'https://subway.simba.taobao.com',
            'referer': 'https://subway.simba.taobao.com/',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'user-agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36'

        };
        const response = await fetch(url,
            {
                body: body,
                credentials: 'include',
                method: 'POST',
                headers: headers,
            }
        );
        return await response.json();
    }, body, url);
};

// 存储数据到mongo
const saveData = async (wangwang, result_canmou, result_ztc, result_citj, result_zz, result_ai, result_uv) => {
    let yesterday = await getYesterday();
    let data = {
        canmou: result_canmou,
        ztc: result_ztc,
        cjtj: result_citj,
        zz: result_zz,
        ai: result_ai,
        uv:result_uv,
        crawl_date: yesterday,
        created_at:dateFormat(new Date(), "yyyy-mm-dd HH:mm:ss"),
        nick_name: wangwang,
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('report.czz_month_data').deleteMany({'crawl_date': yesterday, 'nick_name': wangwang});
    await db.collection('report.czz_month_data').insertOne(data);
    console.log('超直钻 存入数据库okok');
};

// 抓取数据结束
const endCrawl = async function () {
    console.log(Object.keys(G_END_SHOP_HASH).length, G_SHOP_LIST_ORG.length);
    if (Object.keys(G_END_SHOP_HASH).length === G_SHOP_LIST_ORG.length) {
        console.log('店铺爬取完成');
        process.exit();
    }
};

const addShopToEndList = async (wangwang) => {
    G_END_SHOP_HASH[wangwang] = true;
};

// 分配请求再请求
const assign = async () => {
    await endCrawl();
    const browserCount = G_BROWSER_LIST.length;
    for (let i = 0; i < browserCount; i++) {
        // 从列表获取一个店铺
        const shop = G_SHOP_LIST.shift();
        if (shop !== undefined) {
            startCrawl(
                shop,
                G_BROWSER_LIST.pop()
            );
        } else {
            await endCrawl();
        }
    }
};

//创建浏览器
const setBrowser = async () => {
    const browser = await puppeteer.launch({
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

    G_BROWSER_LIST.push({
        ws: browser.wsEndpoint()
    });
}

// 生成店铺列表
const setShopList = async (page) => {
    let shopList = await getCZZAIShopList();
    if(page!==null){
        shopList = shopList.slice(page[0],page[1]);
    }
    let yesterday = await getYesterday();
    //过滤已经爬取的今天的店铺
    let shop_list =  await dropHistoryShopList(shopList,'report.czz_month_data',yesterday);
    if (shop_list.length === 0) {
        process.exit();
    }
    G_SHOP_LIST_ORG = shop_list;
    shop_list.forEach(function (value) {
        G_SHOP_LIST.push({
            wangwang: value.f_copy_wangwangid,
            retry: 0
        });
    });
};
//过滤今天已经爬取的店铺
async function dropHistoryShopList(shop_list, table_name, crawldate) {
    let db = await mongoQuery();
    const data = await db.collection(table_name).find({'crawl_date': crawldate}).project({_id: 0, nick_name: 1}).toArray();
    let del_index_arr = [];
    if (data) {
        shop_list.forEach((shop, index) => {
            data.forEach((d) => {
                if (shop['f_copy_wangwangid'] === d['nick_name']) {
                    del_index_arr.push(index);
                }
            });
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
// 赋值cookie
const setCookie = async (browser, wangwang) => {
    let account = await getCookiesByMongo(wangwang);
    // 关闭无用的page
    let pages = await browser.pages();
    await asyncForEach(pages, async function (page, index) {
        if (index > 0) {
            await page.close();
        }
    });
    await browser.newPage();
    pages = await browser.pages();
    // page配置js
    page = await setJs(pages[1]);
    page.setDefaultTimeout(600000);
    page.setDefaultNavigationTimeout(600000);
    page.setViewport({
        width: 1376,
        height: 1376
    });
    if (account && account.f_raw_cookies) {
        // 赋予浏览器圣洁的cookie
        await asyncForEach(account.f_raw_cookies.sycmCookie, async (value, index) => {
            await page.setCookie(value);
        });
    }
    return page;
}

(async () => {

    const args = process.argv.splice(2);
    let page = null;
    if (typeof (args[0]) !== 'undefined' && typeof (args[1]) !== 'undefined') {
        page = [args[0], args[1]]
    }
    G_CRAWL_DATE = dateFormat(new Date(), "yyyy-mm-dd");
    // 获取店铺列表
    await setShopList(page);
    // 生成N个常驻的浏览器
    for (i = 0; i < G_NUM; i++) {
        await setBrowser();
    }
    await assign();
})();
