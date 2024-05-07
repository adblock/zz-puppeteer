/**
 * 直通车 历史数据爬取：最近7天的15天累计数据的环比
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getHeader} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const moment = require('moment');
const ObjectId = require('mongodb').ObjectId;

let G_START = '';
let G_END = '';
let G_WANGWANG = '';
let G_MONGO_ID = '';
let G_USER = '';

const startCrawl = async(page) => {
    let retry = 0;              // 重试次数
    let save_data = null;
    try{
        save_data = await getData(page, retry);
    }catch (e) {
        console.log(e);
        retry += 1;
        if(retry <= 3){
           save_data = await getData(page, retry)
        }
    }
    if(save_data){     // 如果爬取全部结束就存储数据
        console.log('save data ........');
        await saveData(save_data);
    } else {
        await updateSpiderStatus('爬取失败');
        console.log('爬取数据失败');
        process.exit()
    }
};

// 获取 所有数据方法
const getData = async(page, retry) => {
    let save_data = {};         // 存储数据 对象

    let body = '';
    // 订阅 reponse 事件，参数是一个 reponse 实体
    await page.on('request', async (request) => {
        if(request.url().indexOf('getGuideInfos') > -1 && request.method() === 'POST'){
            body = request.postData();
        } else if (request.url().indexOf('getNewbieStatus') > -1 && request.method() === 'GET') {
            body = request.url();
        }
    });
    await page.goto('https://subway.simba.taobao.com/', {waitUntil:'networkidle0'});
    await page.waitForSelector('body');

    let common_url = page.url().match(/[a-zA-z]+:\/\/[^\s]*?\//)[0];
    if(body){
        const token = await getHeader(body);

        if(page.url().indexOf('indexnew.jsp') > -1){
            console.log('无 可用cookie');
            await updateSpiderStatus('爬取失败');
            console.log('status:error');
            process.exit()
        }
        // 店铺概览数据
        const shop_data = await shopSum(page, common_url, token);
        console.log('shop data')
        save_data.shop_data = shop_data['result']['list'];
        // 店铺图表数据
        console.log('shop chart')
        let shop_chart = await shopChart(page, common_url, token);
        if(shop_chart){
            save_data.shop_chart = shop_chart;
        }
        // 计划概览数据
        console.log('campaign data')
        let campaign_data = await campaignSum(page, common_url, token);
        let campaign_list = campaign_data['result']['pagelist'];
        save_data.campaign_data = campaign_list;
        // 计划id列表
        let campaignIdArr = [];
        for(let campaign of campaign_list){
            campaignIdArr.push(campaign.campaignid)
        }
        // 计划图表数据
        console.log('campaign chart')
        save_data.campaign_chart = await campaignChart(page, common_url, token, campaignIdArr);

        if(Object.keys(save_data).length === 4){     // 如果爬取全部结束就存储数据
            return save_data
        } else {
            retry += 1;
            if(retry <= 3){
                await getData(page, retry)
            } else {
                return null
            }
        }
    } else {
        console.log('页面加载失败');
        await updateSpiderStatus('爬取失败');
        console.log('status:error');
        process.exit()
    }
};

// 获取计划图表数据
const campaignChart = async(page, common_url, token, campaignIdArr) => {
    let campaignTypeArr = ['searchimpression',
            'searchtransaction',
            'impression',
            'avgpos',
            'carttotal',
            'click',
            'cost',
            'coverage',
            'cpc',
            'cpm',
            'ctr',
            'directcarttotal',
            'directtransaction',
            'directtransactionshipping',
            'favitemtotal',
            'favshoptotal',
            'favtotal',
            'indirectcarttotal',
            'indirecttransaction',
            'indirecttransactionshipping',
            'roi',
            'transactionshippingtotal',
            'transactiontotal'];    // 计划折线图 字段（比店铺的少）
    let campaignChartObj = {};      // 单个计划折线图 数据 数组
    let campaignChartDict = {};      // 所有 计划折线图 数据 对象

    for(let campaign_id of campaignIdArr){
        for(let i=0; i<campaignTypeArr.length; i++){
            let chart_url = common_url + 'report/rptBpp4pCampaignLinechart.htm?startDate='+ G_START +
                    '&endDate=' + G_END + '&effect=-1&campaignid=' + campaign_id + '&field=' + campaignTypeArr[i];
            let chart_response = await sendReauest(page, {
                'sla': 'json',
                'isAjaxRequest': 'true',
                'token': token,
                '_referer': '/report/bpreport/index',
            }, chart_url);
            campaignChartObj[chart_response['result']['type']] = chart_response['result']['list'];
        }
        if(Object.keys(campaignChartObj).length === 23){
            campaignChartDict[campaign_id] = campaignChartObj;
            campaignChartObj = {}
        }
    }
    return campaignChartDict
};

// 获取计划概览数据
const campaignSum = async(page, common_url, token) => {
    return await sendReauest(page,
        {
            'sla': 'json',
            'isAjaxRequest': 'true',
            'token': token,
            '_referer': '/report/bpreport/index',
        },
        common_url + 'report/rptBpp4pCampaignList.htm?startDate='+G_START+'&endDate='+G_END+'&offset=0&pageSize=50&effect=-1')
};

// 获取店铺图表数据
const shopChart = async(page, common_url, token) => {
    let shopTypeArr = ['searchimpression',
            'searchtransaction',
            'impression',
            'avgpos',
            'carttotal',
            'click',
            'cost',
            'coverage',
            'cpc',
            'cpm',
            'ctr',
            'dirEprePayAmt',
            'dirEprePayCnt',
            'directcarttotal',
            'directtransaction',
            'directtransactionshipping',
            'eprePayAmt',
            'eprePayCnt',
            'favitemtotal',
            'favshoptotal',
            'favtotal',
            'indirEprePayAmt',
            'indirEprePayCnt',
            'indirectcarttotal',
            'indirecttransaction',
            'indirecttransactionshipping',
            'newuv',
            'newuvrate',
            'roi',
            'shopnewuv',
            'transactionshippingtotal',
            'transactiontotal'];        // 店铺折线图的字段
    let shopChartObj = {};      // 店铺折线图 数据

    for(let i=0; i<shopTypeArr.length; i++){
        let chart_url = common_url + 'report/rptBpp4pCustomLinechart.htm?startDate='+ G_START +
                '&endDate=' + G_END + '&effect=-1&field=' + shopTypeArr[i];
        let chart_response = await sendReauest(page, {
            'sla': 'json',
            'isAjaxRequest': 'true',
            'token': token,
            '_referer': '/report/bpreport/index',
        }, chart_url);
        shopChartObj[chart_response['result']['type']] = chart_response['result']['list'];
    }
    if(Object.keys(shopChartObj).length === 32){
        return shopChartObj
    } else {
        return null
    }

};

// 获取店铺概览数据
const shopSum = async(page, common_url, token) => {
    // const headerArr = await getHeader(body);    // 获取token
    return await sendReauest(page,
        {
            'sla': 'json',
            'isAjaxRequest': 'true',
            'token': token,
            '_referer': '/report/bpreport/index',
        },
        common_url + 'report/rptBpp4pCustomSum.htm?startDate='+G_START+'&endDate='+G_END+'&effect=-1')
};

// 存储数据到mongo
const saveData  = async (save_data) => {
    let data = {
        data:save_data,
        created_at:new Date(),
        updated_at:new Date(),
        crawl_date:moment(new Date()).format("YYYY-MM-DD"),
        start: G_START,
        end: G_END,
        effect: -1,
        user_id: G_USER,
        nick_name: G_WANGWANG,
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('report.ztc_report_data').deleteMany({'start': G_START, 'end': G_END, 'nick_name': G_WANGWANG});
    await db.collection('report.ztc_report_data').insertOne(data);
    await updateSpiderStatus('爬取完成');
    process.exit()
};

// 设置page
const setPage = async(browser, cookies) => {
    let page = await setJs(await browser.newPage());

    page.setDefaultTimeout(50000);
    page.setDefaultNavigationTimeout(50000);
    page.setViewport({
        width: 1376,
        height: 1376
    });

    if(cookies && cookies.f_raw_cookies){
        // 赋予浏览器圣洁的cookie
        await asyncForEach(cookies.f_raw_cookies.sycmCookie, async (value, index) => {
            await page.setCookie(value);
        });
    }
    return page;
};

// 修改爬虫运行状态（MongoDB）
const updateSpiderStatus = async(status) => {
    let db = await mongoQuery();
    await db.collection('report_spider_status_list').updateOne({_id:ObjectId(G_MONGO_ID)}, {$set:{'spider_type': status}})
};


/**
 * 格式化数据得方法
 * @param {Object} data 数据
 * */
const parseDataToUrl = async (data)=>{
    return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
};


/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {Object} body 请求发送的数据
 * @param {String} url  请求的url
 * */
const sendReauest = async (page,body,url)=>{
    body = await parseDataToUrl(body);
    let reponse = await page.evaluate(async (body,url) => {
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
    return reponse;
};

(async() => {
    console.log('begin');
    try{
        let today = moment(new Date()).format("YYYY-MM-DD");
        const args = process.argv.splice(2);
        G_MONGO_ID = args[0];
        console.log(G_MONGO_ID);
        // // 根据mongo id 查询 要爬取的店铺信息
        let db = await mongoQuery();
        const shop_data = await db.collection('report_spider_status_list').find({_id:ObjectId(G_MONGO_ID)}).toArray();
        G_START = shop_data[0].start_time;
        G_END = shop_data[0].end_time;
        G_USER = shop_data[0].user_id;
        G_WANGWANG = shop_data[0].shop_name;
        console.log(G_WANGWANG);

        // 获取店铺 cookie
        let cookies = await db.collection('sub_account_login').find({'wangwang_id': G_WANGWANG}).
        project({_id:0, f_raw_cookies:1, wangwang_id:1}).sort({'f_date':-1}).limit(1).toArray();
        if(cookies.length > 0){
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
            let page = await setPage(browser, cookies[0]);

            await updateSpiderStatus('爬取中');
            console.log('status:ok');
            await startCrawl(page);
        } else {
            console.log('无 可用cookie');
            await updateSpiderStatus('爬取失败');
            console.log('status:error');
            process.exit()
        }

    } catch (e) {
        console.log(e);
        await updateSpiderStatus('爬取失败');
        console.log('status:error');
        process.exit()
    }
})();