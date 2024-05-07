/**
 * 钻展 计划 修改日限额
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getBudgetShops, updateStatus} = require('../commons/func');
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
        let token = '';
        // 拦截请求, 获取fetch需要的token等字段
        await page.setRequestInterception(true);
        page.on('request',  async(request) => {
            if(request.url().indexOf('zuanshi.taobao.com/code/all.json') > -1) {
                let params = request.url().match(/&timeStr=(\S+)/);
                if(params.length > 0 && token === ''){
                    token = params[0];       // 获取token 等字段
                }
                return request.continue();
            } else {
                return request.continue();
            }
        });

        // 进入后台
        await page.goto('https://zuanshi.taobao.com/index_poquan.jsp', {waitUntil: "networkidle0"});
        // 钻展 未登录处理
        if(page.url().indexOf('zuanshi.taobao.com/index.html?mxredirectUrl=') > -1){
            console.log(wangwang + '登录失败');
        } else {
            if(token){
                await setBudget(page, token, campaign_list);
            }
        }
    }catch (e) {
        console.log(wangwang + e.message);
    }
};

/**
 * 获取计划数据
 * @param page
 * @param token
 * @param campaign_list
 * @returns {Promise<Array>}
 */
const setBudget = async(page, token, campaign_list) => {
    await asyncForEach(campaign_list, async(campaign) => {
        let campaign_json = JSON.parse(campaign.json);
        token = token.replace(/bizCode=(\S+)/, 'bizCode=' + campaign_json['bizCode']);
        let budget = campaign.daily_limit;
        let campaign_id = campaign.plan_id;
        let update_url = 'https://zuanshi.taobao.com/poquan/api/campaign/batchModByIds.json?' + token;
        let body = '';
        let modify_type = campaign['f_type'];
        if(modify_type === MODIFY_BUDGET){
            console.log('计划：“' + campaign.plan_name + '”想要修改的预算为：' + budget);
            body = {
                'campaignIdList': '[' +campaign_id+ ']',
                'campaignId': campaign_id,
                'dayBudget': budget      // 不低于50
            };
        } else if (modify_type === MODIFY_PAUSE){
            console.log('计划：“' + campaign.plan_name + '”：自动暂停');
            body = {
                'campaignIdList': '[' +campaign_id+ ']',
                'status': '0'
            };
        } else if(modify_type === MODIFY_START){
            console.log('计划：“' + campaign.plan_name + '”：自动开启');
            body = {
                'campaignIdList': '[' +campaign_id+ ']',
                'status': '1'
            };
        }
        let resp = await sendReauest(page, body, update_url);
        if(resp['data']['successNum'].toString() === '1'){
            console.log('更新成功');
            await updateStatus(campaign.id, 1)
        } else {
            console.log('更新成功');
            console.log(resp);
            await updateStatus(campaign.id, 2)
        }
    });
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
            'referer':'https://zuanshi.taobao.com',
            'origin':'https://zuanshi.taobao.com',
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
    const args = process.argv.splice(2);
    let retry = 0;
    if(args.length > 0) {
        retry = 1;
    }
    // 获取需要更新日限额的计划列表
    let shop_dict = await getBudgetShops('zuanzhan', retry);
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
