/**
 * 直通车 计划 修改日限额
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getBudgetShops,getHeader,updateStatus} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const { getCookiesByMongo } = require("../commons/account");
const moment = require('moment');

process.setMaxListeners(999999999);

// 任务类型，1:改日限额；2：自动暂停；3：自动开启
let MODIFY_BUDGET = 1;
let MODIFY_PAUSE = 2;
let MODIFY_START = 3;
const startCrawl = async (page, wangwang, campaign_list) => {
    try {
        let body = '';
        // 拦截销售分析实时数据请求
        await page.setRequestInterception(true);
        await page.on('request', async(request)=>{
            if(request.url().indexOf('getGuideInfos') > -1 && request.method() === 'POST'){
                body = request.postData();
                await request.continue({'url':request.url()});
            } else if (request.url().indexOf('getNewbieStatus') > -1 && request.method() === 'GET') {
                body = request.url();
                 await request.continue({'url':request.url()});
            } else {
                request.continue({});
            }
        });

        // 直通车首页 实时数据
        const ztc_url = 'https://subway.simba.taobao.com';
        await page.goto(ztc_url, {waitUntil:'networkidle0'});
        if(page.url().indexOf('indexnew.jsp') > -1){
            console.log(wangwang + 'cookie 失效');
        }else if(page.$$('.error-page').length > 0){
            console.log(wangwang + '登录失败');
        }else {
            try {   // 不重定向的店铺（正常店铺） 会timeout 5s
                await page.waitForResponse(response => response.url().indexOf('account/getRealBalance.json') > -1 || response.url().indexOf('getaccountwithcoupon$?sla=json') > -1, {timeout: 5000});
            } catch (e) {
                console.log('wait balance');
            }
            console.log(campaign_list);
            if(body){
                await setData(page, body, campaign_list);
            }
        }
    }catch (e) {
        console.log(wangwang + e.message);
    }
};

/**
 * 更改数据入口
 * @param page
 * @param body
 * @param campaign_list
 * @returns {Promise<Array>}
 */
const setData = async(page, body, campaign_list) => {
    let common_url = page.url().match(/[a-zA-z]+:\/\/[^\s]*?\//)[0];
    const headerArr = await getHeader(body);
    await asyncForEach(campaign_list, async(campaign) => {
        let set_param = {
            'common_url': common_url,
            'headerArr': headerArr,
            'campaign': campaign
        };
        let modify_type = campaign['f_type'];
        if(modify_type === MODIFY_BUDGET){
            await setBudget(page, set_param);
        } else if (modify_type === MODIFY_PAUSE){
            await setPause(page, set_param);
        } else if(modify_type === MODIFY_START){
            await setStart(page, set_param);
        }
    });
};

/**
 * 更改日限额
 * @param page
 * @param set_param
 * @returns {Promise<Array>}
 */
const setBudget = async(page, set_param) => {
    let campaign = set_param.campaign;
    let common_url = set_param.common_url;
    let headerArr = set_param.headerArr;

    let campaign_json = JSON.parse(campaign.json);
    let budget = campaign.daily_limit;
    let campaign_id = campaign.plan_id;
    console.log('计划：“' + campaign.plan_name + '”想要修改的预算为：' + budget);
    let update_url = common_url + 'dailylimit/update.htm';
    let form_date = {
        'campaignId': campaign_id,
        'budget': budget * 100,              // 不低于30
        'smooth': campaign_json['smooth'],
        'sla': 'json',
        'isAjaxRequest': 'true',
        'token': headerArr,
        '_referer': '/manage/campaign/index',
    };
    let resp = await sendReauest(page, form_date, update_url);
    if(resp['code'] === '200'){
        console.log('更新日限额成功');
        await updateStatus(campaign.id, 1)
    } else {
        console.log('更新日限额失败');
        console.log(resp);
        await updateStatus(campaign.id, 2)
    }
};

/**
 * 暂停
 * @param page
 * @param set_param
 * @returns {Promise<Array>}
 */
const setPause = async(page, set_param) => {
    let campaign = set_param.campaign;
    let common_url = set_param.common_url;
    let headerArr = set_param.headerArr;
    let campaign_id = campaign.plan_id;
    console.log('计划：“' + campaign.plan_name + '”：自动暂停');
    let update_url = common_url + 'campaign/updateOnlineStatus.htm';
    let form_date = {
        'idList': `[${campaign_id}]`,
        'onlineState': '0',              // state 0 是暂停
        'sla': 'json',
        'isAjaxRequest': 'true',
        'token': headerArr,
        '_referer': '/manage/campaign/index',
    };
    let resp = await sendReauest(page, form_date, update_url);
    if(resp['code'] === '200'){
        console.log('自动暂停成功');
        await updateStatus(campaign.id, 1)
    } else {
        console.log('自动暂停失败');
        console.log(resp);
        await updateStatus(campaign.id, 2)
    }
};

/**
 * 自动开启
 * @param page
 * @param set_param
 * @returns {Promise<Array>}
 */
const setStart = async(page, set_param) => {
    let campaign = set_param.campaign;
    let common_url = set_param.common_url;
    let headerArr = set_param.headerArr;
    let campaign_id = campaign.plan_id;
    console.log('计划：“' + campaign.plan_name + '”：自动开启');
    let update_url = common_url + 'campaign/updateOnlineStatus.htm';
    let form_date = {
        'idList': `[${campaign_id}]`,
        'onlineState': '1',              // state 1 是投放
        'sla': 'json',
        'isAjaxRequest': 'true',
        'token': headerArr,
        '_referer': '/manage/campaign/index',
    };
    let resp = await sendReauest(page, form_date, update_url);
    if(resp['code'] === '200'){
        console.log('自动开启成功');
        await updateStatus(campaign.id, 1)
    } else {
        console.log('自动开启失败');
        console.log(resp);
        await updateStatus(campaign.id, 2)
    }
};

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param body
 * @param {String} url  请求的url
 * */
const sendReauest = async (page, body, url)=>{
    body = await parseDataToUrl(body);
    return await page.evaluate(async (body,url) => {
        let headers = {
            'referer':'https://subway.simba.taobao.com/',
            'origin':'https://subway.simba.taobao.com',
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
 * 格式化数据得方法
 * @param {Object} data 数据
 * */
const parseDataToUrl = async (data)=>{
    return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
};

// 存储 更改状态到mysql
const saveData  = async (wangwang, save_data) => {
    let data = {
        data:save_data,
        created_at:new Date(),
        updated_at:new Date(),
        crawl_date:G_CRAWL_DATE,
        nick_name: wangwang,
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('zuanzhan.zz_campaign_data').deleteMany({'crawl_date': G_CRAWL_DATE, 'nick_name': wangwang});
    await db.collection('zuanzhan.zz_campaign_data').insertOne(data);
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

(async () => {
    const args = process.argv.splice(2);    // 传参数代表重试
    let retry = 0;
    if(args.length > 0) {
        retry = 1;
    }
    // 获取需要更新日限额的计划列表
    let shop_dict = await getBudgetShops('zhitongche', retry);
    await asyncForEach(Object.keys(shop_dict), async(shop) =>{
        try {
            console.log(shop);
            let browser = await setBrowser();     // 设置浏览器
            let page = await setCookie(browser, shop);
            await startCrawl(page, shop, shop_dict[shop]);
            await browser.close();
        } catch (e) {
            console.log(e);
        }
    });
    process.exit();
})();
