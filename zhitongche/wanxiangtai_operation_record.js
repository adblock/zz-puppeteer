/**
 * 万相台 操作记录
 * */
const puppeteer = require('puppeteer');
const moment = require('moment');
const config = require('../config');
const { getNewShopBoss, asyncForEach, getHeader, setJs } = require('../commons/func');
const { getCookiesByMongo } = require('../commons/account');
const { mongoInit } = require('../commons/db');
const https = require('https');

let G_MONGO = null;
let G_CRAWL_DATE = '';    // 爬取日期

const startCrawl = async(shop, page) => {
     let body = ''; // 通用请求体
    let csrfId = '';
    //拦截请求，获取csrfId
    await page.setRequestInterception(true);
    await page.on('request', async(request)=> {
        if(request.url().indexOf('/oplog/findList.json') > -1 && request.method() === 'POST'){
            const params =  request.url().match(/csrfId=(\S+?)&/); 
            if(params){
                csrfId = params[1];//数组1代表csrfId的值
            }
            // body = request.postData();
            await request.continue({'url':request.url()});
        } else {
            request.continue({});
        }
    });

    await page.goto('https://one.alimama.com/index.html#!/account/operation/index', {waitUntil:'networkidle0'});
   
    if(page.url().indexOf('adbrain.taobao.com') > -1 || page.url().indexOf('login/index') > -1 ){
        console.log('cookie失效，登录失败');
        await saveNologinData(shop);
    } if(page.url().indexOf('mxredirectUrl') > -1){
        console.log('子账号暂无权限登录');
        await saveNologinData(shop);
    }else {
        console.log(page.url());
        await page.waitFor(2000);
        await getOperationRecord(shop, page, csrfId);
    }
};


/**
 * 获取操作记录数据
 * @param shop
 * @param page
 * @param csrfId 需要的参数
 * @returns {Promise<void>}
 */
const getOperationRecord = async(shop, page, csrfId) => {
    //有部分店（LABONutrition海外旗舰店类似的） 前部分url不一样，用正则匹配 通用
    let common_url = page.url().match(/[a-zA-z]+:\/\/[^\s]*?\//)[0];
    let save_data = {};     // 需要存储的数据
    let typeArr =['onebpSearch', 'onebpDisplay', 'onebpAdStrategyCeKuan'];    // 操作记录的数据类型（关键词/宝贝/计划/创意相关）
    let crawl_date = G_CRAWL_DATE.replace(/-/g, '');

    let form_data = {
        'endTime': moment(crawl_date).format('YYYY-MM-DD'), 
        'entityTypeGroupCode': 'all',
        'operationTypeGroupCode': 'all',
        'pageSize': 40,
        'startTime': moment(crawl_date).format('YYYY-MM-DD'),
    };
    await asyncForEach(typeArr, async(type) => {
        form_data['offset'] = 0;
        let operation_url = common_url + 'oplog/findList.json?csrfId='+csrfId+'&bizCode=' + type;
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
    let items = response['data']['list'];       
    if(items.length > 0 ){
        type_data = type_data.concat(items);
        form_data['offset'] = form_data['offset'] + 40;
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
    console.log(body);
    return await page.evaluate(async (body,url) => {
        let headers = {
            'referer':'https://one.alimama.com/index.html',
            'origin':'https://one.alimama.com/',
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
    let date = moment(G_CRAWL_DATE).format('YYYYMMDD');
    let data = {
        crawl_date: G_CRAWL_DATE,
        data:save_data,
        created_at:moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        updated_at:moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        shop_name: wangwang,
        shop_no_login:'',
        type:'wxt',
        date: date
    };
    // 存入数据
    await G_MONGO.db.collection('operation_record_no_delete_wxt').insertOne(data);
    await G_MONGO.db.collection('wanxiangtai_operation_record').deleteMany({$or:[{"shop_no_login":wangwang},{"shop_name":wangwang}], 'crawl_date':G_CRAWL_DATE});
    await G_MONGO.db.collection('wanxiangtai_operation_record').insertOne(data);
};


/**
 * 存储 异常店铺数据
 * @param wangwang
 * @returns {Promise<void>}
 */
const saveNologinData = async(wangwang) => {
    let date = moment(G_CRAWL_DATE).format('YYYYMMDD');
    let data = {
        type:'wxt',
        date: date,
        crawl_date: G_CRAWL_DATE,
        data:'',
        created_at:moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        updated_at:moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        shop_name: '',
        shop_no_login:wangwang
    };
    // 存入数据
    await G_MONGO.db.collection('operation_record_no_delete_wxt').insertOne(data);
    await G_MONGO.db.collection('wanxiangtai_operation_record').deleteMany({$or:[{"shop_no_login":wangwang},{"shop_name":wangwang}], 'crawl_date':G_CRAWL_DATE});
    await G_MONGO.db.collection('wanxiangtai_operation_record').insertOne(data);
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
            let account = await getCookiesByMongo(wangwang);         // 获取cookie信息
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

//创建浏览器
const getBrowser = async ()=>{
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
 * 获取page(设置cookie）
 * @param browser
 * @param cookies
 * @returns {Promise<*>}
 */
const getPage = async(browser, cookies)=>{
    let page = await setJs(await browser.newPage());
    page.setDefaultTimeout(90000);
    page.setDefaultNavigationTimeout(90000);

    if(cookies && cookies.f_raw_cookies){
        // 赋予浏览器圣洁的cookie
        await asyncForEach(cookies.f_raw_cookies.sycmCookie, async (value, index) => {
            await page.setCookie(value);
        });
    } else {
        return null
    }
    return page
};

/**
 * 发送邮件
 * @returns {Promise<void>}
 */
const sendMail = async() => {
    const mail_url = config.php_url + 'wxt/' + G_CRAWL_DATE;
    console.log('send mail-------------');
    await G_MONGO.close();
    await https.get(mail_url, function(res) {
        console.log("邮件发送结果 " + res.statusCode);
        process.exit()
    }).on('error', function(e) {
        console.log("邮件发送错误: " + e.message);
        process.exit()
    });
};

(async()=>{
    G_MONGO = await mongoInit();
    // 接受参数(日期)  不传参数默认爬取今天的
    G_CRAWL_DATE = process.argv[2];
    if(!G_CRAWL_DATE){
        G_CRAWL_DATE = moment(new Date()).format("YYYY-MM-DD");
    }
    // 获取 服务中运营店铺的cookie
    let shop_on_service = await getNewShopBoss(type="万相台','引力魔方','直通车','直播万相台");
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
    // await sendMail();
    await G_MONGO.close();
    console.log('——---爬取完毕———')
    process.exit();
})();
