/**
 * 引力魔方 计划 修改日限额
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getBudgetShops, updateStatus} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const {getDynamicToken} = require('../report/dynamictoken');
const { getCookiesByMongo } = require("../commons/account");
const moment = require('moment');

process.setMaxListeners(999999999);

// 任务类型，1:改日限额；2：自动暂停；3：自动开启
let MODIFY_BUDGET = 1;
let MODIFY_PAUSE = 2;
let MODIFY_START = 3;
const startCrawl = async (page, wangwang, campaign_list) => {
    try {
        let csrfID = '';
        let mofang = false;
        page.on('response', async (response) => {
            //获取参数 csrfID
            if (response.url().indexOf('tuijian.taobao.com/api2/component/findList/bp-permissions.json?') > -1) {
                csrfID = response.url().match(/(?<=&csrfID=)\S+/) + '';
            }
            //判断是否开通引力魔方
            if (response.url().indexOf('tuijian.taobao.com/api2/member/getInfo.json?') > -1) {
                mofang = true;
            }
        });

        // 进入后台
        await page.waitFor(1000+Math.round(Math.random())*100);
        await page.goto('https://tuijian.taobao.com/indexbp.html#!/manage/index?tab=campaign', {waitUntil: "networkidle0"});
        if(page.url().indexOf('https://tuijian.taobao.com/index.html?mxredirectUrl=') > -1){
            console.log('cookie 失效');
        }else {
            if(mofang){
                await setBudget(page, csrfID, campaign_list);
            } else {
                console.log('未开通引力魔方');
            }
        }
    }catch (e) {
        if (e.message.includes('Error: Page crashed!') === -1 ||
            e.message.includes('Unhandled promise rejection') === -1) {
            console.log(wangwang + e.message);
        }
    }
};

/**
 * 获取计划数据
 * @param page
 * @param token
 * @param campaign_list
 * @returns {Promise<Array>}
 */
const setBudget = async(page, csrfID, campaign_list) => {
    //获取from_data的参数
    let url_type = 'https://tuijian.taobao.com/api2/member/getInfo.json?&callback=jQuery&bizCode=display&invitationCode=&dynamicToken=&csrfID=&';
    let refer  = 'https://tuijian.taobao.com/indexbp.html';
    let pintoken = await getPinAndToken(page, url_type, refer);            // 获取info.json接口获取参数pin seedToken
    let timestamp =new Date().getTime();                                   //设置一个时间戳,获取DynamicToken的值
    let dynamic_token = await getDynamicToken(pintoken[0],pintoken[1], timestamp);
    console.log(dynamic_token);

    //初始化url, from_data
    let update_url = 'https://tuijian.taobao.com/api2/campaign/batchModify.json?';
    let from_data = {
        "timeStr": timestamp,
        "dynamicToken": dynamic_token,
        "csrfID": csrfID,
    };

    await asyncForEach(campaign_list, async(campaign) => {
        let campaign_json = JSON.parse(campaign.json);
        let budget = campaign.daily_limit;
        let campaign_id = campaign.plan_id;
        from_data['bizCode'] = campaign_json['bizCode'];

        let modify_type = campaign['f_type'];
        if(modify_type === MODIFY_BUDGET){
            console.log('计划：“' + campaign.plan_name + '”想要修改的预算为：' + budget);
            from_data['campaignList'] = JSON.stringify([{"campaignId": campaign_id, "bizCode": campaign_json['bizCode'], "daybudget": budget}]);

        } else if (modify_type === MODIFY_PAUSE){
            console.log('计划：“' + campaign.plan_name + '”：自动暂停');
            from_data['campaignList'] = JSON.stringify([{"campaignId":campaign_id, "status":"pause"}]);

        } else if(modify_type === MODIFY_START){
            console.log('计划：“' + campaign.plan_name + '”：自动开启');
            from_data['campaignList'] = JSON.stringify([{"campaignId":campaign_id, "status":"start"}]);

         }
        let resp = await sendReauest(page, from_data, update_url);
        if(resp['info']['ok']){
            console.log('更新成功');
            await updateStatus(campaign.id, 1);
        } else {
            console.log('更新失败');
            console.log(resp);
            await updateStatus(campaign.id, 2);
        }
    });
};


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
 * 发送请求的方法
 * @param {Object} page page类
 * @param body
 * @param {String} url  请求的url
 * */
const sendReauest = async (page, body, url)=>{
    body = await parseDataToUrl(body);
    return await page.evaluate(async (body,url) => {
        let headers = {
            'referer':'https://tuijian.taobao.com/indexbp.html',
            'origin':'https://tuijian.taobao.com',
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
    let shop_dict = await getBudgetShops('yinlimofang', retry);
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
