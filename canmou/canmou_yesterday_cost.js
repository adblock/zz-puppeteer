/**
 * 昨日消耗数据  AI智投，超级直播，超级互动城，直通车，钻展，超级推荐
 */
const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getAllShopBoss} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const dateFormat = require('dateformat');
const { getYunyingAccount } = require('../commons/account');
const { getYesterday } = require('../commons/dateFunc');

process.setMaxListeners(999999999);

const G_NUM = config.tuijian_spider_concurrency; // 浏览器的启动数量
let G_BROWSER_LIST = []; // 浏览器列表
let G_SHOP_LIST = []; // 店铺列表
let G_CRAWL_DATE = ''; // 抓取数据的时间
let G_END_SHOP_HASH = {}; // 请求结束的店铺
let G_SHOP_LIST_ORG = []; // 原始的店铺列表

const startCrawl = async (shop, orgBrowser) => {
    let wangwang = shop.wangwang;
    let yesterday =  await getYesterday();
    try {
        let browserWSEndpoint = orgBrowser.ws;
        let browser = await puppeteer.connect({browserWSEndpoint});
        const page = await setCookie(browser, wangwang);
        console.log(wangwang);

        //开始爬取数据
        await getData(page, yesterday, wangwang);
        await endAndAdd(wangwang,browser);
    }catch (e) {
        if(
            e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
            e.message.indexOf('Session closed. Most likely the page has been closed') === -1
        ){
            console.log('222222222',e.message);
            await endAndAdd(wangwang,browser);
        }
    }
};

//开始爬取数据
const getData = async (page, yesterday, wangwang) => {
    //AI智投
    let cost_ai = await getYesterdayCost_AI(page, yesterday);
    //超级直播
    let cost_zhibo = await getYesterdayCost_ZhiBo(page, yesterday);
    //直通车
    let cost_ztc = await getYesterdayCost_Ztc(page, yesterday, wangwang);
    //超级互动城
    let cost_hudong = await getYesterdayCost_HuDong(page, yesterday);

    //钻展
    let cost_zz = await getYesterdayCost_Zz(page, yesterday);
    // 超级推荐
    let cost_cjtj = await getYesterdayCost_Cjtj(page, yesterday);
    // 引力魔方
    let cost_ylmf = await getYesterdayCost_Ylmf(page, yesterday);
    //保存数据
     await saveCostData(wangwang, cost_ai, cost_zhibo,cost_ztc, cost_hudong, cost_zz, cost_cjtj, cost_ylmf, yesterday);
}

//AI智投
const getYesterdayCost_AI = async (page, yesterday, retry = 0) => {
    let csrfID = '';
    let data = {};
    try {
        page.on('response', async (response) => {
            if (response.url().indexOf('adbrain.taobao.com/api/gw/strategy/brand/find.json?') > -1) {
                csrfID = response.url().match(/&csrfID=\S+/);
            }
        });
        // 进入后台
        let url = 'https://adbrain.taobao.com/indexbp.html#!/home/index?';
        await page.goto(url, {waitUntil: "networkidle0"});
        //未登录处理
        if (page.url().indexOf('https://adbrain.taobao.com/index.html') > -1) {
            console.log('Ai智投->账号未授权');
        } else {
            let url_ai = 'https://adbrain.taobao.com/api/account/report/findOverProductAccountRealTime.json?&bizCode=dkx&logDateList=%5B%22' + yesterday + '%22%5D' + csrfID;
            data = await sendReauest(page, url_ai);
        }
        console.log('AI智投----->', Object.keys(data).length);
        return data;
    } catch (e) {
        console.log(e.message);
        retry = retry + 1;
        if (retry <= 2) {
            await getYesterdayCost_AI(page, yesterday, retry);
        } else {
            return data;
        }
    }
}

//超级互动城
const getYesterdayCost_HuDong = async (page, yesterday, retry = 0) => {
    let data = {};
    let timestr = '';
    try {
        page.on('response', async (response) => {
            if (response.url().indexOf('hudongcheng.taobao.com/api/component/findComponentList.json?') > -1) {
                timestr = response.url().match(/&timeStr\S+/) + '';
            }
        });
        // 进入后台
        let url = 'https://hudongcheng.taobao.com/indexbp.html#!/report/live?alias=live&bizCode=interactiveLive&perspective=report&startTime=' + yesterday + '&endTime=' + yesterday + '&vs=false&effect=30';
        await page.goto(url, {waitUntil: "networkidle0"});
        if (page.url().indexOf('https://hudongcheng.taobao.com/index.html?mxredirectUrl=') > -1) {
            console.log('账号未开通超级互动城');
        } else {
            let url_hudong = 'https://hudongcheng.taobao.com/api/account/report/findDaySum.json?&bizCode=interactiveLive&startTime=' + yesterday + '&endTime=' + yesterday + '&effect=30&effectType=click' + timestr;
            data = await sendReauest(page, url_hudong);
        }
        console.log('互动城----->', Object.keys(data).length);
        return data;
    } catch (e) {
        console.log(e.message);
        retry = retry + 1;
        if (retry <= 2) {
            await getYesterdayCost_HuDong(page, yesterday, retry);
        } else {
            return data;
        }
    }

}

//超级直播
const getYesterdayCost_ZhiBo = async (page, yesterday, retry = 0) => {
    let data = {};
    let csrfID = '';
    try {
        page.on('response', async (response) => {
            if (response.url().indexOf('adbrain.taobao.com/api/common/findCodeList.json?') > -1) {
                csrfID = response.url().match(/&csrfID=\S+&/);
            }
        });
        // 进入后台
        let url = 'https://adbrain.taobao.com/indexbp-live.html#!/report-duration/index?';
        await page.goto(url, {waitUntil: "networkidle0"});

        //未登录处理
        if (page.url().indexOf('https://adbrain.taobao.com/index-live.html?mxredirectUrl=') > -1) {
            console.log('账号未开通超级直播');
        } else {
            let url_zhibo = 'https://adbrain.taobao.com/api/account/report/findOverProductAccount.json?&bizCode=fastLive&queryUDF=false&campaignId=&startTime=' + yesterday + '&endTime=' + yesterday + '&effect=15&effectType=click' + csrfID;
            data = await sendReauest(page, url_zhibo);
        }
        console.log('超级直播----->', Object.keys(data).length);
        return data;
    } catch (e) {
        console.log(e.message);
        retry = retry + 1;
        if (retry <= 2) {
            await getYesterdayCost_ZhiBo(page, yesterday, retry);
        } else {
            return data;
        }
    }

}

//直通车
const getYesterdayCost_Ztc = async (page, yesterday, wangwang, retry = 0) => {
    let sessionid = '';
    let token = '';
    let data = {};
    try {
        page.on('response', async (response) => {
            if (response.url().indexOf('subway-guide/find.htm?') > -1) {
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
            url = 'https://subway.simba.taobao.com/#!/report/bpreport/index?page=1&start=' + yesterday + '&end=' + yesterday + '&effect=1';
        }
        await page.goto(url, {waitUntil: "networkidle0"});
        await page.waitFor(2000);
        //未登录处理
        if (page.url().indexOf('https://subway.simba.taobao.com/indexnew.jsp') > -1) {
            console.log('cookies失效或直通车未授权');
        } else {
            let url_ztc = '';
            if (wangwang.includes('海外旗舰店')) {
                url_ztc = 'https://subway.simba.tmall.hk/openapi/param2/1/gateway.subway/rpt/rptCustomerByDay$?queryParam=%7B%22startDate%22%3A%22' + yesterday + '%22%2C%22endDate%22%3A%22' + yesterday + '%22%2C%22effect%22%3A%221%22%7D&sla=json&isAjaxRequest=true' + token + '&_referer=%2Freport%2Fbpreport%2Findex%3Fpage%3D1%26start%3D' + yesterday + '%26end%3D' + yesterday + '%26effect%3D1' + sessionid;
            } else {
                url_ztc = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/rpt/rptCustomerByDay$?' +
                    'queryParam=%7B%22startDate%22%3A%22' + yesterday + '%22%2C%22endDate%22%3A%22' + yesterday + '%22%2C%22effect%22%3A%221%22%7D&sla=json&isAjaxRequest=true' + token + '%26effect%3D1%26start%3D' + yesterday + '%26end%3D' + yesterday + sessionid;
            }
            let resp = await sendReauest_Ztc(page, url_ztc);
            if (resp['result']) {
                data = resp['result'];
            }
        }
        console.log('直通车-->', Object.keys(data).length);
        return data;
    } catch (e) {
        console.log(e.message);
        retry = retry + 1;
        if (retry <= 2) {
            await getYesterdayCost_Ztc(page, yesterday, wangwang, retry);
        } else {
            return data;
        }
    }

}

//超级推荐
const getYesterdayCost_Cjtj = async (page, yesterday, retry = 0) => {
    let data = {};
    let timestr = '';
    try {
        page.on('response', async (response) => {
            if (response.url().indexOf('tuijian.taobao.com/api/account/report/findCrowdDayList.json?') > -1) {
                timestr = response.url().match(/&timeStr\S+/) + '';
            }
        });
        // 进入后台
        let url = 'https://tuijian.taobao.com/indexbp-feedflow.html?#!/report/whole/index?alias=all&bizCode=feedFlow&perspective=report&startTime=' + yesterday + '&endTime=' + yesterday;
        await page.goto(url, {waitUntil: "networkidle0"});
        await page.waitFor(500);

        //未登录处理
        if (page.url().indexOf('https://tuijian.taobao.com/index.html?mxredirectUrl=') > -1) {
            console.log('cookies失效或超级推荐未授权');
        } else {
            let url_cjtj = 'https://tuijian.taobao.com/api/account/report/findDayList.json?&bizCode=feedFlow&startTime=' + yesterday + '&endTime=' + yesterday + '&effectType=click&effect=30' + timestr;
            data = await sendReauest(page, url_cjtj);
        }
        console.log('超级推荐-->', Object.keys(data).length);
        return data;
    } catch (e) {
        console.log(e.message);
        retry = retry + 1;
        if (retry <= 2) {
            await getYesterdayCost_Cjtj(page, yesterday, retry);
        } else {
            return data;
        }
    }

}

//引力魔方
const getYesterdayCost_Ylmf = async (page, yesterday, retry = 0) => {
    let data = {};
    let timestr = '';
    let magic = false;
    try {
        page.on('response', async (response) => {
            //获取参数 csrfID
            if (response.url().indexOf('tuijian.taobao.com/api2/component/findList/bp-permissions.json?') > -1) {
                timestr = response.url().match(/&timeStr\S+/) + '';
            }
            //判断是否开通引力魔方
            if (response.url().indexOf('tuijian.taobao.com/api2/member/getInfo.json?') > -1) {
                magic = true;
            }
        });

        // 进入后台
        let url = 'https://tuijian.taobao.com/indexbp-display.html?#!/report/index?alias=def&bizCode=displayDefault&startTime=' + yesterday;
        await page.goto(url, {waitUntil: "networkidle0"});
        await page.waitFor(500);

        //开通了引力魔方
        if (magic) {
            //取出必要的参数
            let timestamp = timestr.match(/(?<=&timeStr=).*?(?=&)/) + '';
            let dynamic_token = timestr.match(/(?<=&dynamicToken=).*?(?=&)/) + '';
            let csrfID = timestr.match(/(?<=&csrfID=)\S+/) + '';
            let url_ylmf = 'https://tuijian.taobao.com/api2/report/multiDimension/findSum.json?';
            let body = {
                "bizCode": "displayDefault",
                "startTime": yesterday,
                "endTime": yesterday,
                "effect": 30,
                "effectType": 'impression',
                "rptDomainOption": JSON.stringify({"needCampaign": true, "needPromotion": true}),
                "timeStr": parseInt(timestamp),
                "dynamicToken": dynamic_token,
                "csrfID": csrfID
            };

            let resp = await sendReauest_Post(page, body, url_ylmf);
            if (resp['data']['list']) {
                data = resp['data']['list'];
            }
        }
        console.log('引力魔方-->', Object.keys(data).length);
        return data;
    } catch (e) {
        console.log(e.message);
        retry = retry + 1;
        if (retry <= 2) {
            await getYesterdayCost_Ylmf(page, yesterday, retry);
        } else {
            return data;
        }
    }
}

//钻展
const getYesterdayCost_Zz = async (page, yesterday, retry = 0) => {
    let data = {};
    let timestr = '';
    try {
        page.on('response', async (response) => {
            if (response.url().indexOf('zuanshi.taobao.com/code/all.json?') > -1) {
                timestr = response.url().match(/&timeStr\S+/) + '';
            }
        });
        // 进入后台
        let url = 'https://zuanshi.taobao.com/index_poquan.jsp#!/report1/whole?startTime=' + yesterday + '&endTime=' + yesterday;
        await page.goto(url, {waitUntil: "networkidle0"});
        await page.waitFor(500);

        //未登录处理
        if (page.url().indexOf('https://zuanshi.taobao.com/index.html?mxredirectUrl=') > -1) {
            console.log('cookies失效或钻展未授权');
        } else {
            let url_zz = 'https://zuanshi.taobao.com/api/report/account/findDayList.json?&startTime=' + yesterday + '&endTime=' + yesterday + '&effectType=impression&effectPeriod=30' + timestr;
            data = await sendReauest(page, url_zz);
        }
        console.log('钻展-->', Object.keys(data).length);
        return data;

    } catch (e) {
        console.log(e.message);
        retry = retry + 1;
        if (retry <= 2) {
            await getYesterdayCost_Zz(page, yesterday, retry);
        } else {
            return data;
        }
    }

}

// 存储数据到mongo
const saveCostData  = async (wangwang, cost_ai, cost_zhibo,cost_ztc, cost_hudong, cost_zz, cost_cjtj, cost_ylmf, yesterday) => {
    let data = {
        name: wangwang,
        created_at:new Date(),
        crawl_date:yesterday,
        ai:cost_ai,
        zhibo:cost_zhibo,
        ztc:cost_ztc,
        hudong:cost_hudong,
        zz:cost_zz,
        cjtj:cost_cjtj,
        ylmf:cost_ylmf
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('canmou.yesterday_cost').deleteMany({'crawl_date': yesterday, 'name': wangwang});
    await db.collection('canmou.yesterday_cost').insertOne(data);
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
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36'
        };
        const response = await fetch(url, {headers:headers});
        return await response.json();
    },url);
};
/**
 * 格式化数据得方法
 * @param {Object} data 数据
 * */
const parseDataToUrl = async (data) => {
    return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
};

//发送post请求
const sendReauest_Post = async (page, body, url) => {
    body = await parseDataToUrl(body);
    return await page.evaluate(async (body, url) => {
        let headers = {
            'referer':'https://tuijian.taobao.com/indexbp-display.html',
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

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest_Ztc = async (page,url)=>{
    return await page.evaluate(async (url) => {
        let headers = {
            'referer': 'https://subway.simba.taobao.com/',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36'
        };
        const response = await fetch(url, {headers:headers});
        return await response.json();
    },url);
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
const setShopList = async ()=> {
    let shop_list = await getAllShopBoss();
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
    let account = await getYunyingAccount(wangwang);
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
    let page = await setJs(pages[1]);
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
    await setShopList();
    // 生成N个常驻的浏览器
    for (i = 0; i < G_NUM; i++) {
        await setBrowser();
    }
    await assign();
})();
