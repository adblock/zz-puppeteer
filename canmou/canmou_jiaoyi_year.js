/**
 * 生意參謀 年度交易数据
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs} = require('../commons/func');
const { getYesterday } = require('../commons/dateFunc');
const {mongoQuery} = require('../commons/db');
const dateFormat = require('dateformat');
const { getCookiesByMongo } = require("../commons/account");
const moment = require('moment');

process.setMaxListeners(999999999);

const G_NUM = config.tuijian_spider_concurrency; // 浏览器的启动数量
let G_BROWSER_LIST = []; // 浏览器列表
let G_SHOP_LIST = []; // 店铺列表
let G_END_SHOP_HASH = {}; // 请求结束的店铺
let G_SHOP_LIST_ORG = []; // 原始的店铺列表

const startCrawl = async (shop, orgBrowser) => {
    try {
        console.log(shop);
        let wangwang = shop.wangwang;
        let save_data = [];
        let fetchUrl = [];
        let browserWSEndpoint = orgBrowser.ws;
        const browser = await puppeteer.connect({browserWSEndpoint});
        const page = await setCookie(browser, wangwang);

        // 订阅 reponse 事件，参数是一个 reponse 实体
        await page.on('response',
            async (response) => {
                try {
                    // 出现滑块
                    if (response.url().indexOf('_____tmd_____/punish') !== -1) {
                        console.log('出现滑块');
                        await page.waitFor(3000);
                        await page.reload();
                    }
                    // 登录失败
                    if(response.url().indexOf('custom/login.htm') > -1){
                        console.log('登录失败');
                        await saveErrorData(wangwang, 'cookie失效，登录失败');
                        await browser.close();
                        await setBrowser();
                        await assign();
                    }

                    // 获取fetch接口获取数据
                    if (response.url().indexOf('get_summary.json') > -1 && response.url().indexOf('dateType=month') > -1) {
                        let data = await response.json();
                        if(data.hasOwnProperty('data')){
                            save_data.push(data['data']);
                        }
                        let url = fetchUrl.shift();
                        if(url !== undefined){
                            await page.evaluate((url) => {
                                fetch(new Request(url, {
                                    headers: {
                                        'referer': 'https://sycm.taobao.com/bda/tradinganaly/overview/overview.htm',
                                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36'
                                    }
                                }))
                            }, url);
                        } else {
                            if(save_data.length === 12){    // 数据正常，存储数据
                                await saveDate(wangwang, save_data);
                                await addShopToEndList(wangwang);
                                await browser.close();
                                await setBrowser();
                                await assign();
                            } else {
                                await saveErrorData(wangwang, '数据不全');
                                // 重新启动
                                await addShopToEndList(wangwang);
                                await browser.close();
                                await setBrowser();
                                await assign();
                            }
                        }
                    }
                    // 获取默认接口 构造月数据url
                    if(response.url().indexOf('get_summary.json') > -1 && response.url().indexOf('dateType=recent1') > -1){
                        let yesterday = await getYesterday();
                        const mouthBegin = moment(yesterday).startOf('month').format("YYYY-MM-DD");
                        const url = response.url().replace(/dateRange=(\d{4}-\d{1,2}-\d{1,2})%7C(\d{4}-\d{1,2}-\d{1,2})/,
                                                            'dateRange='+mouthBegin + '%7C' + yesterday)
                                                  .replace(/dateType=recent1/, 'dateType=month');
                        fetchUrl.push(url);
                        for(let i = 1; i < 12; i++){
                            let begin = moment(mouthBegin).subtract(i, 'months').format("YYYY-MM-DD");
                            let end = moment(mouthBegin).subtract(i, 'months').endOf('month').format("YYYY-MM-DD");
                            let fet_url = url.replace(/dateRange=(\d{4}-\d{1,2}-\d{1,2})%7C(\d{4}-\d{1,2}-\d{1,2})/,
                                                            'dateRange='+begin + '%7C' + end);
                            fetchUrl.push(fet_url)
                        }
                        await page.evaluate((url) => {
                            fetch(new Request(url, {
                                headers: {
                                    'referer': 'https://sycm.taobao.com/bda/tradinganaly/overview/overview.htm',
                                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36'
                                }
                            }))
                        }, fetchUrl.shift());
                    }
                }catch (e) {
                    console.log(e);
                    await saveErrorData(wangwang, e);
                    await browser.close();
                    await setBrowser();
                    await assign();
                }
            });

        const homeUrl = 'https://sycm.taobao.com/bda/tradinganaly/overview/overview.htm';
        await page.goto(homeUrl, {waitUntil: 'networkidle2'});
    }catch (e) {
        if(e.message.indexOf('Navigation failed because browser has disconnected!') === -1){
             console.log(e);
        }
    }
};


const saveDate = async (wangwang, save_data) => {
    let today = dateFormat(new Date(), "yyyy-mm-dd");
    let data = {
        data:save_data,
        created_at:new Date(),
        updated_at:new Date(),
        crawl_date: today,
        nick_name: wangwang,
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('canmou.jiaoyi_data_year').deleteMany({'crawl_date': today, 'nick_name': wangwang});
    await db.collection('canmou.jiaoyi_data_year').insertOne(data);
};

const saveErrorData  = async (wangwang, err) => {
    let today = dateFormat(new Date(), "yyyy-mm-dd");
    let data = {
        error: err,
        created_at: new Date(),
        updated_at: new Date(),
        crawl_date: today,
        nick_name: wangwang
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('canmou.jiaoyi_data_year_error').deleteMany({
        'crawl_date': today,
        'nick_name': wangwang
    });
    await db.collection('canmou.canmou_jiaoyi_data_error').insertOne(data);
};

// 抓取数据结束
const endCrawl = async function() {
    console.log('end');
    console.log(Object.keys(G_END_SHOP_HASH).length, G_SHOP_LIST_ORG.length);
    if(Object.keys(G_END_SHOP_HASH).length === G_SHOP_LIST_ORG.length){
        console.log('店铺爬取完成');
        process.exit()
    }
};

const addShopToEndList = async (wangwang)=>{
    G_END_SHOP_HASH[wangwang] = true;
};

// 分配请求再请求
const assign  = async () => {
    const browserCount = G_BROWSER_LIST.length;
    for (let i = 0; i < browserCount; ++i) {
        //从列表获取一个店铺
        const shop = G_SHOP_LIST.shift();
        if(shop !== undefined){
            startCrawl(
                shop,
                G_BROWSER_LIST.pop()//从数组末尾取
            );
        }
    }
    await endCrawl();
};

// 赋值cookie
const setCookie = async (browser, wangwang)=>{
    let account = await getCookiesByMongo(wangwang);
    // 关闭无用的page
    let pages = await browser.pages();
    for (let i = 0; i < pages.length; ++i) {
        if(i>0){
            await pages[i].close();
        }
    }

    let page = await setJs(await browser.newPage());

    page.setDefaultTimeout(50000);
    page.setDefaultNavigationTimeout(50000);
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

//创建浏览器
const setBrowser = async ()=>{
    const browser = await puppeteer.launch({
        headless: config.headless,
        args: [
        ],
        // slowMo:1000,
        ignoreDefaultArgs: ["--enable-automation"]
    });

    G_BROWSER_LIST.push({
        ws:browser.wsEndpoint()
    });
};

(async () => {
    let today = dateFormat(new Date(), "yyyy-mm-dd");
    let db = await mongoQuery();
    let shop_list = await db.collection('sub_account_login').find({'f_date':today, 'f_valid_status': 1}).
    project({_id:0, wangwang_id:1}).toArray();
    const data = await db.collection('canmou.jiaoyi_data_year').find({'crawl_date':today}).
    project({_id:0, nick_name:1}).toArray();
    // 过滤已爬取
    let del_index_arr = [];
    if(data){
        shop_list.forEach((shop, index, array)=>{
            let shop_num = 0;
            data.forEach((d, i, a)=>{
                if (shop['wangwang_id'] === d['nick_name']){
                    del_index_arr.push(index)
                }
            });
        });
        // 删除数组
        del_index_arr.sort(function(a,b){
            return b - a
        });
        del_index_arr.forEach(function(index) { shop_list.splice(index, 1)})
    }
    G_SHOP_LIST_ORG = shop_list;
    shop_list.forEach(function (value) {
        G_SHOP_LIST.push({
            wangwang:value.wangwang_id,
            retry:0
        });
    });

    // 生成N个常驻的浏览器
    for (i = 0; i < G_NUM; i++) {
        await setBrowser();
    }

    await assign();
})();
