const { mongoQuery } = require('../commons/db');
const {asyncForEach,setJs} = require('../commons/func');
const ObjectId = require('mongodb').ObjectId;
const puppeteer = require('puppeteer');
const config = require('../config');

/**
 * 设置page
 * @param browser       浏览器实例
 * @param cookies       cookie
 * @returns {Promise<*>}
 */
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

/**
 * 修改爬虫运行状态（MongoDB）
 * @param mongo_id          爬虫状态表的id
 * @param status            爬取状态（爬取中，爬取成功，爬取失败）
 * @returns {Promise<void>}
 */
const updateSpiderStatus = async(mongo_id, status) => {
    console.log(status);
    let db = await mongoQuery();
    await db.collection('report_spider_status_list').updateOne({_id:ObjectId(mongo_id)}, {$set:{'spider_type': status}})
};


/**
 * 获取指定旺旺cookie
 * @param wangwang
 * @returns cookies
 */
const getCookies = async(wangwang) => {
    let db = await mongoQuery();
    // 获取店铺 cookie
    return await db.collection('sub_account_login').find({'wangwang_id': wangwang}).
    project({_id:0, f_raw_cookies:1, wangwang_id:1}).sort({'f_date':-1}).limit(1).toArray();
};

/**
 * 获取browser 实例
 * @returns browser
 */
const getBrowser = async() => {
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

/**
 * 获取计划图表数据
 * @param page
 * @param campaign_url_dict         计划url对象：{计划id: 计划url}
 * @returns {Promise<void>}
 */
const campaignChart = async(page, campaign_url_dict) => {
    console.log('campaignChart');
    let campaignChartDict = {};      // 所有 计划折线图 数据 对象
    for(let campaign_id in campaign_url_dict){
        let resp = await sendReauest(page, campaign_url_dict[campaign_id]);
        campaignChartDict[campaign_id] = resp['data']['list']
    }
    return campaignChartDict
};

/**
 * 获取 计划的id列表 和 计划概览数据
 * @param page      page 实例
 * @param campaign_url     超级推荐的token
 * @returns [arr]   返回 [计划id列表, 计划概览数据]
 */
const campaignSum = async(page, campaign_url) => {
    console.log('campaignSum');
    const campaign_data = await sendReauest(page, campaign_url);
    let campaign_list = campaign_data['data']['list'];
        let campaign_sum = [];
        let campaign_id_list = [];
        for(let campaign of campaign_list){
            if(campaign_url.indexOf('zuanshi') > -1){       // 钻展的 是计划组
                campaign_id_list.push(campaign['campaignGroupId']);
                // 计划详细数据（钻展计划组的详细计划）
                let campaign_detail = campaign_url.replace(/componentType=(\S+?)&/, 'componentType=campaign&');
                campaign_detail += '&campaignGroupId=' + campaign['campaignGroupId'];
                campaign['campaignDetail'] = await getDataList(page, campaign_detail);
                campaign_sum.push(campaign)
            } else {
                campaign_id_list.push(campaign['campaignId']);
                campaign_sum.push(campaign['reportInfoList'][0])
            }

        }
    return [campaign_id_list, campaign_sum]
};

/**
 * 获取店铺图表数据
 * @param page
 * @param chart_url
 * @returns {Promise<*>}
 */
const shopChart = async(page, chart_url) => {
    console.log('shopChart');
    const shop_chart = await sendReauest(page, chart_url);
    return shop_chart['data']['list']
};

/**
 * 获取店铺概览数据
 * @param page
 * @param shop_sum_url
 * @returns {Promise<*>}
 */
const shopSum = async(page, shop_sum_url) => {
    console.log('shopSum');
    const shop_data = await sendReauest(page, shop_sum_url);
    return  shop_data['data']['list'];
};

/**
 * 报表通用 获取response 的 ['data']['list']数据
 * @param page
 * @param url
 * @returns {Promise<*>}
 */
const getDataList = async(page, url) => {
    const data = await sendReauest(page, url);
    return data['data']['list'];
};

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest = async (page,url)=>{
    let reponse = await page.evaluate(async (url) => {
        let headers = {
            // 'referer':'https://tuijian.taobao.com/indexbp.html',
            // 'origin':'https://tuijian.taobao.com/indexbp.html',
            'sec-fetch-mode':'cors',
            'sec-fetch-site':'same-origin',
            'sec-fetch-dest':'empty',
            'content-type':'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url, {headers:headers});
        return await response.json();
    },url);
    return reponse;
};

module.exports = { setPage, updateSpiderStatus, getCookies, getBrowser, shopChart, shopSum, campaignChart, campaignSum};