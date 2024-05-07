/**
 * 流量 直通车筛选一定条件的操作记录
 * */
const puppeteer = require('puppeteer');
const moment = require('moment');
const config = require('../config');
const { getCZZShopBossOperate, asyncForEach, getHeader, setJs } = require('../commons/func');
const { getCookiesByMongo } = require('../commons/account');
const { mongoInit } = require('../commons/db');
const http = require('http');
const dateFormat = require('dateformat');

let G_MONGO = null;
let G_CRAWL_DATE = '';    // 爬取日期

const startCrawl = async(shop, page) => {
  let body = ''; // 通用请求体
  await page.setRequestInterception(true);
  await page.on('request', async(request)=> {
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
  await page.goto('https://subway.simba.taobao.com/', {waitUntil:'networkidle0'});
  if(page.url().indexOf('indexnew.jsp') > -1){
    throw new Error('cookie 失效,登陆失败');
  } else {
    if(body){
      await getOperationRecord(shop, page, body);
    } else {
      await page.waitFor(5000);
      await getOperationRecord(shop, page, body);
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
const getOperationRecord = async(shop, page, body) => {
  //有部分店（LABONutrition海外旗舰店类似的） 前部分url不一样，用正则匹配 通用
  let common_url = page.url().match(/[a-zA-z]+:\/\/[^\s]*?\//)[0];
  let save_data = [];     // 需要存储的数据
  const headerArr = await getHeader(body);    // 获取token(索引为0)， session(索引为1)
  let typeArr = ['keyword', 'adgroup', 'account', 'creative'];    // 操作记录的数据类型（关键词/宝贝/计划/创意相关）
  let crawl_date = G_CRAWL_DATE.replace(/-/g, '');
  let form_data = {
    'fromTime': crawl_date + '000000',
    'toTime': crawl_date + '235959',
    'pageSize': 200,
    'sla': 'json',
    'query': '{"sourceClientId":"1"}',
    'isAjaxRequest': 'true',
    'token': headerArr,
    '_referer': '/account/operation',
  };

  await asyncForEach(typeArr, async(type) => {
    form_data['toPage'] = 1;
    let operation_url = common_url + 'oplog/' + type + '/list.htm';
    console.log(operation_url);
    let data = await getOperationRecursive(page, operation_url, form_data, [])
    await asyncForEach(data, async (data_item) => {
      save_data.push(data_item);
    });
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
    shop_login:'是',
    type:'直通车',
  };
  // 存入数据
  await G_MONGO.db.collection('operation_record_no_delete').insertOne(data);
  await G_MONGO.db.collection('zhitongche_operation_record_new').deleteMany({"shop_name":wangwang, 'crawl_date':G_CRAWL_DATE});
  await G_MONGO.db.collection('zhitongche_operation_record_new').insertOne(data);
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
    shop_name: wangwang,
    shop_login:'否',
    type:'直通车'
  };
  // 存入数据
  await G_MONGO.db.collection('operation_record_no_delete').insertOne(data);
  await G_MONGO.db.collection('zhitongche_operation_record_new').deleteMany({"shop_name":wangwang, 'crawl_date':G_CRAWL_DATE});
  await G_MONGO.db.collection('zhitongche_operation_record_new').insertOne(data);
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
      console.log(wangwang, retry);
      let account = await getCookiesByMongo(wangwang);         // 获取cookie信息
      let page = await getPage(browser, account);              // 获取设置cookie的页面，如果cookie失效返回null
      if (page) {
        await startCrawl(wangwang, page);
        await browser.close();
      } else {
        console.log('cookie 失效');
        if (retry < 3){
          retry_shop.push(shop);
        }else{
          await saveNologinData(wangwang);
        }
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
(async()=>{
  G_MONGO = await mongoInit();
  // 接受参数(日期)  不传参数默认爬取昨天的
  G_CRAWL_DATE = process.argv[2];
  if (!G_CRAWL_DATE) {
    G_CRAWL_DATE = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  }
  // 获取 服务中运营店铺的cookie
  let shop_on_service = await getCZZShopBossOperate();
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
  await G_MONGO.close();
  console.log('——---爬取完毕———')
  process.exit();
})();
