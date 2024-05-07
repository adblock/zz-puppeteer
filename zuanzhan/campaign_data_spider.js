/**
 * 钻展 计划数据
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getUrlParams,getCZZShopBoss} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const dateFormat = require('dateformat');
const { getCookiesByMongo } = require("../commons/account");
const { getYesterday } = require('../commons/dateFunc');
const http = require('http');

process.setMaxListeners(999999999);

const G_NUM = config.tuijian_spider_concurrency; // 浏览器的启动数量
let G_BROWSER_LIST = []; // 浏览器列表
let G_SHOP_LIST = []; // 店铺列表
let G_CRAWL_DATE = ''; // 抓取数据的时间
let G_END_SHOP_HASH = {}; // 请求结束的店铺
let G_SHOP_LIST_ORG = []; // 原始的店铺列表

const startCrawl = async (shop, orgBrowser) => {
    let browser = null;
    let wangwang = shop.wangwang;
    try {
        console.log(wangwang);
        let browserWSEndpoint = orgBrowser.ws;
        browser = await puppeteer.connect({browserWSEndpoint});
        const page = await setCookie(browser, wangwang);
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
            console.log('登录失败');
            await endAndAdd(wangwang, browser);
        } else {
            if(token){
                let save_data = await getData(page, token);
                await saveData(wangwang, save_data);
            }
            await endAndAdd(wangwang, browser);
        }
    }catch (e) {
        if(
            e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
            e.message.indexOf('Session closed. Most likely the page has been closed') === -1
        ){
            console.log(222222222);
            console.log(e.message);
            await endAndAdd(wangwang);
        }
    }
};

/**
 * 获取计划数据
 * @param page
 * @param token
 * @returns {Promise<Array>}
 */
const getData = async(page, token) => {
    let quanceArr = ['PoquanWeizhi', 'PoquanFanxingqu', 'PoquanXingqu', 'PoquanZidingyi'];
    let return_data = [];
    await asyncForEach(quanceArr, async(type)=>{
        let url_end = token + type;
        let campaign_group_url = 'https://zuanshi.taobao.com/poquan/api/campaign/page.json?campaignGroupId=&' +
            'currentPage=1&pageSize=100&status=-1&dmcType=-1&constraintType=0&marketAim=1' + url_end;
        let resp = await sendReauest(page, campaign_group_url);
        await asyncForEach(resp['data']['campaigns'], async(campaign) => {
            campaign.campaignType = type;
            return_data.push(campaign);
        })
    });

    let campaign_url = 'https://zuanshi.taobao.com/api/report/component/findList.json?componentType=campaign&componentIdList=&logDateList=%5B%22' + G_CRAWL_DATE + '%22%5D' + token;
    console.log(campaign_url);
    let resp = await sendReauest(page, campaign_url);
    let result = resp['data']['list'];
    let campaign_obj = {};
    await asyncForEach(result, async(data) => {
        campaign_obj[data.campaignId] = data;
    });
    await asyncForEach(return_data, async(data) => {
        data['reportInfoList'] = [campaign_obj[data.campaignId]]
    });
    return return_data
};

/**
 * 结束并添加到end里面，并调取下一家
 * @param wangwang
 * @param browser
 * @returns {Promise<void>}
 */
const endAndAdd = async(wangwang, browser) => {
    if(browser){
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

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest = async (page,url)=>{
    return await page.evaluate(async (url) => {
        let headers = {
            'sec-fetch-mode':'cors',
            'sec-fetch-site':'same-origin',
            'sec-fetch-dest':'empty',
            'content-type':'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url, {headers:headers});
        return await response.json();
    },url);
};

// 存储数据到mongo
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

// 抓取数据结束
const endCrawl = async function() {
    console.log('end');
    console.log(Object.keys(G_END_SHOP_HASH).length, G_SHOP_LIST_ORG.length);
    if(Object.keys(G_END_SHOP_HASH).length === G_SHOP_LIST_ORG.length){
        console.log('店铺爬取完成');
        process.exit();
    }
};

const addShopToEndList = async (wangwang)=>{
    G_END_SHOP_HASH[wangwang] = true;
};

// 分配请求再请求
const assign  = async () => {
    await endCrawl();
    const browserCount = G_BROWSER_LIST.length;
    for(let i = 0; i < browserCount; i++){
     // 从列表获取一个店铺
        const shop = G_SHOP_LIST.shift();
        if(shop !== undefined){
            startCrawl(
                shop,
                G_BROWSER_LIST.pop()
            );
        }else {
            await endCrawl();
        }
    }
};

//创建浏览器
const setBrowser = async ()=>{
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
        ws:browser.wsEndpoint()
    });
}

// 生成店铺列表
const setShopList = async (page=null)=> {
    let shop_list = await getCZZShopBoss('钻展',page);
    console.log(shop_list.length);
    if(shop_list.length === 0){
        process.exit();
    }
    G_SHOP_LIST_ORG = shop_list;
    shop_list.forEach(function (value) {
        G_SHOP_LIST.push({
            wangwang:value.f_copy_wangwangid,
            retry:0
        });
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
    page.setDefaultTimeout(600000);
    page.setDefaultNavigationTimeout(600000);
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
}

(async () => {
    const args = process.argv.splice(2);
    let page = null;
    if( typeof(args[0])!== 'undefined' && typeof(args[1])!== 'undefined'){
        page = [args[0],args[1]]
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
