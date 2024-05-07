/**
 * 报表   传入参数某一家店铺和特定的日期     node .js wangwang_id 2021-10-10
 * 生意参谋，直通车，超级推荐，钻展        昨日数据+ 月每天数据+月汇总数据
 */
const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getCZZAIShopList} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const dateFormat = require('dateformat');
const moment = require('moment');
const {getDynamicToken} = require('./dynamictoken');
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
    let date = new Date(G_CRAWL_DATE);
    let firstDay = '';
    let lastDay = '';
    let yesterday = dateFormat(new Date(date.getFullYear(), date.getMonth(), date.getDate()-1), 'yyyy-mm-dd');
    //日期的处理
    if (date.getDate() === 1) {   //本月的1号，取上个月的数据, 否则取1号到昨天的数据
        firstDay = dateFormat(new Date(date.getFullYear(), date.getMonth() - 1, 1), 'yyyy-mm-dd');       //上个月的第一天
        lastDay = dateFormat(new Date(date.getFullYear(), date.getMonth(), 0), 'yyyy-mm-dd');                   //上个月的最后一天
    } else {
        firstDay = dateFormat(new Date(date.getFullYear(), date.getMonth(), 1), 'yyyy-mm-dd');                  // 本月第一天
        lastDay = yesterday;   //昨天
    }
    console.log(firstDay, '-->', lastDay);
    let effect_key = ['click', 'impression'];   //存数据库 的键,效果 点击效果，展现效果
    let time_key = ['total', 'day', 'month'];   //日 ，月， 本月总计

    //超级推荐+引力魔方
    let result_cjtj = await getDayData_Cjtj(new_page, effect_key, time_key, firstDay, lastDay, yesterday);
    //钻展
    let result_zz = await getDayData_Zz(new_page, effect_key, time_key, firstDay, lastDay, yesterday);

    await new_page.close();  //新开一个页面
    let next_page = await setCookie(browser, wangwang);

    //生意参谋
     let result_canmou = await getDayData_Canmou(next_page, wangwang, browser, yesterday);
    //直通车
     let result_ztc = await getDayData_Ztc(next_page, wangwang, time_key, firstDay, lastDay, yesterday);
     //Ai 智投
    let result_ai = await getDayCost_AI(next_page, firstDay, lastDay, yesterday);

    //保存数据到mongo
    await saveData(wangwang, result_canmou[0], result_ztc, result_cjtj[0], result_cjtj[1], result_zz, result_ai, result_canmou[1], yesterday);

}

/**
 * 超级推荐     报表-> 商品推广-> 数据汇总   日数据+ 本月每日数据+ 月数据
 * @param page
 * @param effect_key             效果：展现/点击
 * @param time_key               日期：
 * @param startDate              开始日期
 * @param endDate                结束日期
 * @param yesterday              昨天
 * @returns {Promise<{}>}
 */
const getDayData_Cjtj = async (page, effect_key, time_key, startDate, endDate, yesterday) => {
    let tj_data = {};
    let display_data = {};
    let csrfID = '';
    let magic = false;
    page.on('response', async (response) => {
        if (response.url().indexOf('tuijian.taobao.com/api/component/findComponentList.json?') > -1) {
            csrfID = response.url().match(/(?<=&csrfID=)\S+/) + '';
        }
        //判断是否开通引力魔方
        if (response.url().indexOf('tuijian.taobao.com/api2/member/getInfo.json?') > -1) {
           magic = true;
        }
    });

    // 进入后台
    let url = 'https://tuijian.taobao.com/indexbp-feedflow.html?#!/report/item?alias=item&perspective=report';
    await page.goto(url, {waitUntil: "networkidle0"});
    //未登录处理
    if (page.url().indexOf('https://tuijian.taobao.com/index.html?mxredirectUrl=') > -1) {
        console.log('cookies失效或超级推荐未授权');
    } else {
        let url_type = 'https://tuijian.taobao.com/api/member/getInfo.json?&callback=jQuery&bizCode=feedFlow&invitationCode=&dynamicToken=&csrfID=&';
        let refer  = 'https://tuijian.taobao.com/indexbp.html';
        let pintoken = await getPinAndToken(page, url_type, refer);        // 获取info.json接口获取参数pin seedToken
        let timestamp =new Date().getTime();                                   //设置一个时间戳,获取DynamicToken的值
        let dynamic_token = await getDynamicToken(pintoken[0],pintoken[1], timestamp);
        console.log(dynamic_token);

        //旧版超级推荐
        tj_data = await tuiJian(page, effect_key, time_key, startDate, endDate, yesterday, timestamp, dynamic_token, csrfID);
        //开通了 引力魔方
        await page.goto('https://tuijian.taobao.com/indexbp-display.html?#!/report/index?report=', {waitUntil: "networkidle0"});
        if (magic) {
            display_data = await magicTuiJian(page, effect_key, time_key, startDate, endDate, yesterday, timestamp, dynamic_token, csrfID);
        }
    }
    return [tj_data, display_data];
}

//旧版超级推荐
const tuiJian = async (page, effect_key, time_key, startDate, endDate, yesterday, timestamp, dynamic_token, csrfID) => {
    let result_cjtj = {};
    // 参数为：日期，转化周期，接口url
    let time_cjtj = {
        'total': [startDate, endDate, 30, 'tuijian.taobao.com/api/account/report/findDaySum.json?'],
        'day': [yesterday, yesterday, 30, 'tuijian.taobao.com/api/account/report/findDayList.json?'],
        'month': [startDate, endDate, 30, 'tuijian.taobao.com/api/account/report/findDayList.json?']
    };

    //遍历点击 or 展现效果
    await asyncForEach(effect_key, async (effect) => {
        console.log('超级推荐', effect);
        result_cjtj[effect] = {};
        //遍历 日期：日，月，本月总计。
        await asyncForEach(time_key, async (key) => {
            let data;
            //请求接口获取数据
            let url_cjtj = 'https://' + time_cjtj[key][3] + '&bizCode=feedFlowItem&startTime=' + time_cjtj[key][0] + '&endTime=' + time_cjtj[key][1] + '&effect=' + time_cjtj[key][2] + '&effectType=' + effect + '&timeStr=' + timestamp + '&dynamicToken=' + dynamic_token + '&csrfID=' + csrfID;
            await page.waitFor(300);

            let resp = await sendReauest(page, url_cjtj);
            if (resp['data']['list']) {
                data = resp['data']['list'];
            }
            result_cjtj[effect][key] = data;
        })
    })
    return result_cjtj;
}

// 新版引力魔方   超级推荐->引力魔方->报表   周期30天 + 点击，展现效果 + 日/月/分日 数据
const magicTuiJian = async(page, effect_key, time_key, startDate, endDate, yesterday,timestamp, dynamic_token, csrfID)=>{
    let result_cjtj = {};
    let refer = 'https://tuijian.taobao.com/indexbp-display.html?';
    // 参数为：日期，转化周期，接口url
    let time_cjtj = {
        'total': [startDate, endDate, 'https://tuijian.taobao.com/api2/report/multiDimension/findSum.json?'],
        'day': [yesterday, yesterday, 'https://tuijian.taobao.com/api2/report/multiDimension/findSumList.json?'],
        'month': [startDate, endDate, 'https://tuijian.taobao.com/api2/report/multiDimension/findSumList.json?']
    };

    //遍历点击 or 展现效果
    await asyncForEach(effect_key, async (effect) => {
        await page.waitFor(300);
        console.log('引力魔方', effect);
        result_cjtj[effect] = {};
        //遍历 日期：日，月，本月总计。
        await asyncForEach(time_key, async (key) => {
            let data;
            let body = {
                "bizCode": "displayDefault",
                "startTime": time_cjtj[key][0],
                "endTime": time_cjtj[key][1],
                "effect": 30,
                "effectType": effect,
                "rptDomainOption": JSON.stringify({"needCampaign": true, "needPromotion": true, "needCreative": true}),
                "timeStr": timestamp,
                "dynamicToken": dynamic_token,
                "csrfID": csrfID
            };
            let url_magic = time_cjtj[key][2];
            //post请求接口获取数据
            let resp = await sendReauest_Ztc(page, body, url_magic, refer);
            if (resp['data']['list']) {
                data = resp['data']['list'];
            }
            result_cjtj[effect][key] = data;
        })
    })
    return result_cjtj;
}

/**
 * 钻展      报表->账户汇总报表-> 数据汇总  日数据+ 本月每日数据+ 月数据
 * @param page
 * @param effect_key             效果：展现/点击
 * @param time_key               日期：
 * @param startDate              开始日期
 * @param endDate                结束日期
 * @param yesterday              昨天
 * @returns {Promise<{}>}
 */
const getDayData_Zz = async (page, effect_key, time_key, startDate, endDate, yesterday) => {
    let result_zz = {};
    let csrfID = '';
    page.on('response', async (response) => {
        if (response.url().indexOf('zuanshi.taobao.com/api/report/code/findIndex.json?') > -1) {
            csrfID = response.url().match(/&csrfID=\S+/) + '';
        }
    });

    // 进入后台
    let url_go = 'https://zuanshi.taobao.com/index_poquan.jsp#!/report1/whole?startTime=' + startDate + '&endTime=' + endDate;
    await page.goto(url_go, {waitUntil: "networkidle0"});
    //未登录处理
    if (page.url().indexOf('https://zuanshi.taobao.com/index.html?mxredirectUrl=') > -1) {
        console.log('cookies失效或钻展未授权');
    } else {
        let url_type = 'https://zuanshi.taobao.com/loginUser/info.json?&callback=jQuery&bizCode=zszw&dynamicToken=&csrfID=&';
        let refer  = 'https://zuanshi.taobao.com/index_poquan.jsp';
        let pintoken = await getPinAndToken(page, url_type, refer);        // 获取info.json接口获取参数pin seedToken
        let timestamp =new Date().getTime();                                   //设置一个时间戳,获取DynamicToken的值
        let dynamic_token = await getDynamicToken(pintoken[0],pintoken[1], timestamp);
        console.log(dynamic_token);

        //点击效果，开始时间，结束时间，转化周期，链接
        let time_zz = {
            'total': [startDate, endDate, 30, 'zuanshi.taobao.com/api/report/account/findDaySum.json?'],
            'day': [yesterday, yesterday, 30, 'zuanshi.taobao.com/api/report/account/findDayList.json?'],
            'month': [startDate, endDate, 30, 'zuanshi.taobao.com/api/report/account/findDayList.json?']
        };

        //遍历点击 or 展现效果
        await asyncForEach(effect_key, async(effect)=>{
            console.log('钻展',effect);
            result_zz[effect] = {};
            //遍历 日期：日，月，本月总计
            await asyncForEach(time_key, async (key) => {
                let data = {};
                let url_zz = 'https://' + time_zz[key][3] + '&startTime=' + time_zz[key][0] + '&endTime=' + time_zz[key][1] + '&effectType=' + effect + '&effectPeriod=' + time_zz[key][2] + '&timeStr=' + timestamp + '&dynamicToken=' + dynamic_token + csrfID;
                await page.waitFor(300);

                let resp = await sendReauest(page, url_zz);
                if (resp['data']['list']) {
                    data = resp['data']['list'];
                }
                result_zz[effect][key] = data;
            })
        })
        return result_zz;
    }
}

/**
 * 获取参数pin seedToken
 * @param page
 * @param url_type     url链接
 * @param refer        headers的refer参数
 * @returns {Promise<(string|number)[]>}
 */
const getPinAndToken = async(page, url_type,refer)=>{
    //发送请求，从info.json接口获取参数pin seedToken
    let json = await sendReauest_jsonp(page, url_type, refer);
    let pin = 0;
    let seedToken = '';
    if (json['data']) {
        pin = json['data']['pin'];
        seedToken = json['data']['seedToken'];
    }
    return [seedToken,pin];
}
/**
 * 生意参谋的数据   首页-> 运营视窗     店铺月总销售额+ 日数据+ 月数据
 * @param page
 * @param wangwang
 * @param browser
 * @returns {Promise<{}>}
 */
const getDayData_Canmou = async (page, wangwang, browser, yesterday) => {
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
            token = response.url().match(/token=.*?&|token=\S+/)+ '';
        }
    });
    // 进入后台
    await page.goto('https://sycm.taobao.com/portal/home.htm?');
    await page.waitFor(2000);
    if (page.url().indexOf('sycm.taobao.com/custom/login.htm?') !== -1 || page.url().indexOf('sycm.taobao.com/custom/no_permission') !== -1 || suberr) {
        console.log('Cookie过期或生意参谋未授权');
        await endAndAdd(wangwang, browser);
    } else {

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
const getCanmouMonthData = async(page, token, yesterday, retry = 0)=>{
    let result = {};
    let category = ['total', 'day', 'month'];  //店铺月总销售额+ 日数据+ 月数据
    await asyncForEach(category, async (item, index) => {
        await page.waitFor(1000);
        console.log('------------', item, index);
        let date = new Date(G_CRAWL_DATE);
        let url = '';
        let day31 = false;
        let resp_dayOne = '';
        if (item.includes('total')) {
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

        //本月1号，查询上个月是否为31天，月份表中
        if(item.includes('month') && date.getDate() === 1) {
            let date_31 = date.getMonth();
            let list_month = [1, 3, 5, 7, 8, 10, 12];
            if (list_month.includes(date_31)) {   //上个月是否是31天
                day31 = true;
                let dayOne = dateFormat(new Date(date.getFullYear(), date.getMonth() - 1, 1), 'yyyy-mm-dd');       //上个月的第一天
                let url_dayOne = 'https://sycm.taobao.com/portal/coreIndex/getShopMainIndexes.json?dateType=day&dateRange=' + dayOne + '%7C' + dayOne + '&device=0&' + token;
               console.log(url_dayOne);
                resp_dayOne = await sendReauest_Canmou(page, url_dayOne);
            }
        }

        if (content) {
            //月数据处理，只保留本月的数据
            if(item.includes('month')){   //时间戳转化为日期格式，且保存本月的数据
                data = [];
                let firstday;
                if(date.getDate() === 1){   //是否为本月的1号，是， 则取上个月的1号
                    firstday = new Date(date.getFullYear(), date.getMonth()-1, 1).getTime();
                }else{
                    firstday = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
                }
                if(day31){ //插入号数据
                    let item_one = resp_dayOne['content']['data'];
                    item_one['date'] = moment(item_one['statDate']).format('YYYY-MM-DD');
                    data.push(item_one);
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
        }else{
            //若接口返回数据为空，重试两次
            if(retry <3){
                retry = retry+1;
                console.log('--------------------重试',retry,'次');
                await getCanmouMonthData(page, token, yesterday, retry);
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
    let date = new Date(G_CRAWL_DATE);
    let url_trend = 'https://sycm.taobao.com/flow/v5/shop/source/tree.json?dateRange='+yesterday+'%7C'+yesterday+'&dateType=day&pageSize=10&page=1&order=desc&orderBy=uv&device=2&belong=all&indexCode=uv%2CcrtByrCnt%2CcrtRate'+token;
    console.log('-------------->访客数');
    let respon_trend = await sendReauest(page, url_trend);
    let detail_uv = {};
    //取出超 直 钻 万相台的pageId ,作为url参数，保存为字典格式
    if (respon_trend['data']) {
        await asyncForEach(respon_trend['data'], async (trend_item) => {
            if (trend_item['pageName']['value'].includes('付费流量')) {   //一级目录
                let type = {'万相台': 'ai', '直通车': 'ztc', '超级推荐': 'cjtj', '智钻': 'zz', 'AI智能投放': 'ai','引力魔方':'ylmf'};

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
    let url_params = '';
    let count_month = 0;  //截取数组的个数 与天数相同
    let url_dayone = '';
    let day31 = false;
    if (date.getDate() === 1) {   //本月的1号，取上个月的数据, 接口不同， 否则默认昨天
        url_params = 'https://sycm.taobao.com/flow/v3/shop/source/trend.json?dateType=day&dateRange=' + yesterday + '%7C' + yesterday;
        count_month = 30;
        //本月1号，查询上个月是否为31天，月份表中
        let date_31 = date.getMonth();
        let list_month = [1, 3, 5, 7, 8, 10, 12];
        if (list_month.includes(date_31)) {   //上个月是否是31天
            day31 = true;
            let day_One = dateFormat(new Date(date.getFullYear(), date.getMonth() - 1, 1), 'yyyy-mm-dd');       //上个月的第一天
            url_dayone = 'https://sycm.taobao.com/flow/v3/shop/source/trend.json?dateType=day&dateRange=' + day_One + '%7C' + day_One;
        }
    } else {
        url_params = 'https://sycm.taobao.com/flow/v3/shop/source/trend.json?dateType=day&dateRange=' + yesterday + '%7C' + yesterday;
        let day = new Date(yesterday);
        count_month = day.getDate();
    }

    //请求四个平台 超 直 钻 万相台 ,本月每天访客的数据
    let keys = ['ai', 'ztc', 'cjtj', 'zz', 'ylmf'];
    let result_uv = {};
    await asyncForEach(keys, async (item) => {
        result_uv[item]= {};
        result_uv[item]['my'] = [];
        let pageId = detail_uv[item];
        let url = url_params + '&indexCode=uv&device=2&belong=all' + pageId + '&' + token;
        let respon = await sendReauest(page, url);
        if (day31) {
            let url_one = url_dayone + '&indexCode=uv&device=2&belong=all' + pageId + '&' + token;
            let respon_one = await sendReauest(page, url_one);
            if (respon_one['data']) {
                let my_one = respon_one['data']['my'].splice(-1);
                result_uv[item]['my'].push(my_one[0]);
            }
        }
        //截取本月的天数 的访客数
        if (respon['data']) {
            let my_day = respon['data']['my'].splice(-count_month, count_month);
            await asyncForEach(my_day, async (temp)=>{
                result_uv[item]['my'].push(temp);
            })

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
const getDayData_Ztc = async (page, wangwang, time_key, startDate, endDate, yesterday) => {
    let result_ztc = {};
    let sessionid = '';
    let token = '';
    page.on('response', async (response) => {
        if (response.url().indexOf('component/subway-guide/find.htm?') > -1) {
            let params = response.url();
            sessionid = params.match(/&sessionId\S+/)+'';
            token = params.match(/&token.*?&/)+'';
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

    //未登录处理
    if (page.url().indexOf('https://subway.simba.taobao.com/indexnew.jsp') > -1) {
        console.log('cookies失效或直通车未授权');
    } else {
        let time_ztc = {
            'day': [yesterday, yesterday],
            'month': [startDate, endDate]
        };
        // 直通车 ，月数据+ 昨日数据+ 月每天数据
        await asyncForEach(time_key, async (key) => {
            let data;
            if (key.includes('total')) {
                data = await getTotalData_Ztc(page, wangwang, startDate, endDate, token);    //月汇总数据,发送post请求
            } else {
                let url_ztc = '';
                if (wangwang.includes('海外旗舰店')) {
                    url_ztc = 'https://subway.simba.tmall.hk/openapi/param2/1/gateway.subway/rpt/rptCustomerByDay$?queryParam=%7B%22startDate%22%3A%22' + time_ztc[key][0] + '%22%2C%22endDate%22%3A%22' + time_ztc[key][1] + '%22%2C%22effect%22%3A%2230%22%7D&sla=json&isAjaxRequest=true' + token + '&_referer=%2Freport%2Fbpreport%2Findex%3Fpage%3D1%26start%3D' + time_ztc[key][0] + '%26end%3D' + time_ztc[key][1] + '%26effect%3D30' + sessionid;
                } else {
                    url_ztc = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/rpt/rptCustomerByDay$?' +
                        'queryParam=%7B%22startDate%22%3A%22' + time_ztc[key][0] + '%22%2C%22endDate%22%3A%22' + time_ztc[key][1] + '%22%2C%22effect%22%3A%2230%22%7D&sla=json&isAjaxRequest=true' + token + '%26effect%3D30%26start%3D' + time_ztc[key][0] + '%26end%3D' + time_ztc[key][1] + sessionid;
                }

                let resp = await sendReauest(page, url_ztc);
                if (resp['result']) {
                    data = resp['result'];
                }
            }
            result_ztc[key] = data;
        })
    }
    return result_ztc;
}
/**
 * 直通车       报表-> 账户报表 ->数据汇总    月数据
 * @param page
 * @param startDate    开始时间
 * @param endDate      结束时间
 * @returns {Promise<*>}
 */
const getTotalData_Ztc = async (page, wangwang, startDate, endDate, token) => {
    let data;
    let token_ztc = token.match(/(?<=&token=).*?(?=&)/) + '';
    let refer = 'https://subway.simba.taobao.com/';
    console.log('直通车 token', token_ztc);
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
        "token": token_ztc,
        "_referer": "/report/bpreport/index?page=1&start=" + startDate + "&end=" + endDate + "&effect=30",
    }
    let resp = await sendReauest_Ztc(page, body, url_ztc, refer);
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

const sendReauest_jsonp = async (page,url,refer)=>{
    let reponse = await page.evaluate(async (url, refer) => {
        let headers = {
            'referer': refer,
            'sec-ch-ua-platform': 'Windows',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url, {headers:headers});
        let text = await response.text();
        text=text.replace('jQuery',"")
        //转换格式
        let json = eval("("+text+")");
        return json;
    },url,refer);
    return reponse;
};

/**
 * 格式化数据得方法
 * @param {Object} data 数据
 * */
const parseDataToUrl = async (data) => {
    return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
};

//发送post请求
const sendReauest_Ztc = async (page, body, url, refer) => {
    body = await parseDataToUrl(body);
    return await page.evaluate(async (body, url, refer) => {
        let headers = {
            'referer':refer,
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
    }, body, url, refer);
};

// 存储数据到mongo
const saveData = async (wangwang, result_canmou, result_ztc, result_citj, display_cjtj, result_zz, result_ai, result_uv, yesterday) => {
    let data = {
        canmou: result_canmou,
        ztc: result_ztc,
        cjtj: result_citj,
        display:display_cjtj,
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
const setShopList = async (shop_name, type, G_CRAWL_DATE) => {
    let shop_list;
    let shopList;
    if(type.includes('getMany')){
        //取出所有爬取的店铺列表
        shopList = await getCZZAIShopList();
        let yesterday = await getYesterday();
        shop_list =  await dropHistoryShopList(shopList,'report.czz_month_data',yesterday);    //过滤已经爬取的今天的店铺
    }else if(type.includes('getDate')){
        //爬取指定日期的所有店铺列表
        shopList = await getCZZAIShopList();
        let adate = new Date(G_CRAWL_DATE);
        let adate_crawl = dateFormat(new Date(adate.getFullYear(), adate.getMonth(), adate.getDate()-1), 'yyyy-mm-dd');
        shop_list =  await dropHistoryShopList(shopList,'report.czz_month_data',adate_crawl);    //过滤已经爬取的某个时间的店铺
    } else{
        //爬取某个店铺
        shop_list = [{'f_copy_wangwangid':shop_name}]
    }

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
    let page = await setJs(pages[1]);
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
    let shop_name;
    let type = '';
    //传入的参数 进行判断
    if (args.length === 2) {      //传入两个参数，某一家店铺和特定的日期
        shop_name = args[0];
        G_CRAWL_DATE = args[1];
        type = 'getOne';
    }else if(args.length === 1){   //传入一个参数，默认为日期，
        G_CRAWL_DATE = args[0];
        type = 'getDate';
    }else{                         //不传参数，默认爬取所有的店铺，当天的日期
        G_CRAWL_DATE = dateFormat(new Date(), "yyyy-mm-dd");
        type = 'getMany';
    }

    // 获取店铺列表
    await setShopList(shop_name, type, G_CRAWL_DATE);
    // 生成N个常驻的浏览器
    for (i = 0; i < G_NUM; i++) {
        await setBrowser();
    }
    await assign();
})();
