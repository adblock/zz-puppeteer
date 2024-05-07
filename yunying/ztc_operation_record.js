const puppeteer = require('puppeteer');
const moment = require('moment');
const { getBrowser, getPage, sendMail } = require('./yunying_commons');
const { getYunyingAccount } = require('../commons/account');
const { getAllShopBoss, asyncForEach, getHeader } = require('../commons/func');
const {mongoQuery} = require('../commons/db');


let G_CRAWL_DATE = '';    // 爬取日期

/**
 * 获取token
 * @param {Object} page 浏览器page对象
 * @param common_url    url前部公用
 * */
getToken = async (page, common_url) => {
    // 获取token
    let token = await sendReauest(page, {}, common_url + '/bpenv/getLoginUserInfo.htm');
    return token.result.token
};


const startCrawl = async(shop, page) => {
    await page.goto('https://subway.simba.taobao.com/', {waitUntil:'networkidle0'});
    await page.waitForSelector('body');
    let common_url = page.url().match(/[a-zA-z]+:\/\/[^\s]*?\//)[0];
    const token = await getToken(page, common_url);
    if(page.url().indexOf('indexnew.jsp') > -1){
        console.log('cookie失效，登录失败');
        await saveNologinData(shop);
    } else {
        if(token){
            await getOperationRecord(shop, page, token);
        } else {
            await page.waitFor(5000);
            await getOperationRecord(shop, page, token);
        }
    }
};


/**
 * 获取操作记录数据
 * @param shop
 * @param page
 * @param body
 * @returns {Promise<void>}
 */
const getOperationRecord = async(shop, page, token) => {
    //有部分店（LABONutrition海外旗舰店类似的） 前部分url不一样，用正则匹配 通用
    let common_url = page.url().match(/[a-zA-z]+:\/\/[^\s]*?\//)[0];
    let save_data = {};     // 需要存储的数据
    let typeArr = ['keyword', 'adgroup', 'account', 'creative'];    // 操作记录的数据类型（关键词/宝贝/计划/创意相关）
    let crawl_date = G_CRAWL_DATE.replace(/-/g, '');
    let form_data = {
        'fromTime': crawl_date + '000000',
        'toTime': crawl_date + '235959',
        'pageSize': 200,
        'sla': 'json',
        'query': '{"sourceClientId":"1"}',
        'isAjaxRequest': 'true',
        'token': token,
        '_referer': '/account/operation',
    };

    await asyncForEach(typeArr, async(type) => {
        form_data['toPage'] = 1;
        let operation_url = common_url + 'oplog/' + type + '/list.htm';
        console.log(operation_url);
        save_data[type] = await getOperationRecursive(page, operation_url, form_data, [])
    });
    await saveData(shop, save_data)

};

/**
 * 递归获取所有页数
 * @param page          page 实例
 * @param url           请求url
 * @param form_data     请求体
 * @param type_data     返回的数据
 * @returns {Promise<*>}
 */
const getOperationRecursive = async(page, url, form_data, type_data) => {
    let response = await sendReauest(page, form_data, url);
    let items = response['result']['items'];
    if(items.length > 0){
        type_data = type_data.concat(items);
        form_data['toPage'] = form_data['toPage'] + 1;
        return await getOperationRecursive(page, url, form_data, type_data)
    } else {
        return type_data
    }

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
 * 存储数据
 * @param wangwang
 * @param save_data
 * @returns {Promise<void>}
 */
const saveData = async(wangwang, save_data) => {
    let data = {
        crawl_date: G_CRAWL_DATE,
        data:save_data,
        created_at:moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        updated_at:moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        shop_name: wangwang,
        shop_no_login:''
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('yunying.ztc_operation_record').deleteMany({$or:[{"shop_no_login":wangwang},{"shop_name":wangwang}], 'crawl_date':G_CRAWL_DATE});
    await db.collection('yunying.ztc_operation_record').insertOne(data);
};


/**
 * 存储 异常店铺数据
 * @param wangwang
 * @returns {Promise<void>}
 */
const saveNologinData = async(wangwang) => {
    let data = {
        crawl_date: G_CRAWL_DATE,
        data:'',
        created_at:moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        updated_at:moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        shop_name: '',
        shop_no_login:wangwang
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('yunying.ztc_operation_record').deleteMany({$or:[{"shop_no_login":wangwang},{"shop_name":wangwang}], 'crawl_date':G_CRAWL_DATE});
    await db.collection('yunying.ztc_operation_record').insertOne(data);
};

/**
 * 开始爬取之前处理
 * @param shop_on_service   需要爬取的店铺
 * @param retry_shop        异常后需要重试的店铺
 * @param retry             重试次数
 * @returns {Promise<*>}
 */
const startBefore = async(shop_on_service, retry_shop, retry) => {
    await asyncForEach(shop_on_service, async(shop) => {
        let wangwang = shop.f_copy_wangwangid;
        let browser = await getBrowser();                        // 获取浏览器实例
        try {
            console.log(wangwang);
            let account = await getYunyingAccount(wangwang);         // 获取cookie信息
            let page = await getPage(browser, account);              // 获取设置cookie的页面，如果cookie失效返回null
            if(page){
                await startCrawl(wangwang, page);
                await browser.close();
            } else {
                console.log('cookie 失效');
                await saveNologinData(wangwang);
                await browser.close();
            }
        } catch (e) {
            console.log(e);
            if(retry === 3){    // 重试3次
                await saveNologinData(wangwang);
            } else {
                retry_shop.push(shop)
            }
            await browser.close();
        }
    });
    return retry_shop
};

(async()=>{
    // 接受参数(日期)  不传参数默认爬取今天的
    G_CRAWL_DATE = process.argv[2];
    if(!G_CRAWL_DATE){
        G_CRAWL_DATE = moment(new Date()).format("YYYY-MM-DD");
    }
    // 获取 服务中运营店铺的cookie
    let shop_on_service = await getAllShopBoss();
    let retry_shop = [];    // 异常店铺(需要重试的店铺)
    retry_shop = await startBefore(shop_on_service, retry_shop, 0);

    if(retry_shop.length > 0){      // 重试
        for(let retry=1; retry<=3; retry++){
            retry_shop = await startBefore(retry_shop, [], retry);
            if(retry_shop.length === 0){
                break
            }
        }
    }
    await sendMail('yy_ztc', G_CRAWL_DATE);
})();
