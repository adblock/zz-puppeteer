/**
 * 流量 钻展筛选一定条件的操作记录
 * */
const puppeteer = require('puppeteer');
const moment = require('moment');
const config = require('../config');
const { getCZZShopBossOperate, asyncForEach, setJs } = require('../commons/func');
const { getCookiesByMongo } = require('../commons/account');
const { mongoInit } = require('../commons/db');
const http = require('http');
const dateFormat = require('dateformat');

let G_MONGO = null;
let G_CRAWL_DATE = '';    // 爬取日期

const startCrawl = async(shop, page) => {
  let token = ''; // 通用请求体
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
    throw new Error('cookie失效,页面登陆失败');
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
 * @param token
 * @returns {Promise<void>}
 */
const getOperationRecord = async(shop, page, token) => {
  let operation_url = 'https://zuanshi.taobao.com/log/getOperationLog.json?startTime=' + G_CRAWL_DATE + '&endTime=' +
          G_CRAWL_DATE + '&perPageSize=40&objectType=&opType=' + token + '&toPage=1';

  console.log(operation_url);
  let save_data = await getOperationRecursive(page, operation_url, []);
  await saveData(shop, save_data);

};

/**
 * 递归获取所有页数
 * @param page          page 实例
 * @param url           请求url
 * @param type_data     返回的数据
 * @returns {Promise<*>}
 */
const getOperationRecursive = async(page, url, type_data) => {
  let response = await sendReauest(page, url);
  let items = response['data']['data'];
  if(items.length > 0){
    type_data = type_data.concat(items);
    let curr_page = url.match(/toPage=(\d+)/)[1];
    let next_page = parseInt(curr_page) + 1;
    url = url.replace(/toPage=(\d+)/, 'toPage=' + next_page);
    return await getOperationRecursive(page, url, type_data)
  } else {
    return type_data
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
    type:'钻展',
  };
  // 存入数据
  await G_MONGO.db.collection('operation_record_no_delete').insertOne(data);
  await G_MONGO.db.collection('zuanzhan_operation_record_new').deleteMany({"shop_name":wangwang, 'crawl_date':G_CRAWL_DATE});
  await G_MONGO.db.collection('zuanzhan_operation_record_new').insertOne(data);
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
    type:'钻展',
  };
  // 存入数据
  await G_MONGO.db.collection('operation_record_no_delete').insertOne(data);
  await G_MONGO.db.collection('zuanzhan_operation_record_new').deleteMany({"shop_name":wangwang, 'crawl_date':G_CRAWL_DATE});
  await G_MONGO.db.collection('zuanzhan_operation_record_new').insertOne(data);
};

/**
 * 开始爬取之前处理
 * @param shop_on_service   需要爬取的店铺
 * @param retry_shop        异常后需要重试的店铺
 * @param retry             重试次数
 * @returns {Promise<*>}
 */
const startBefore = async(shop_on_service, retry_shop, retry) => {
  await asyncForEach(shop_on_service, async (shop) => {
    let wangwang = shop.f_copy_wangwangid;
    let browser = await getBrowser();                        // 获取浏览器实例
    try {
      console.log(shop_on_service.length, wangwang, retry);
      let account = await getCookiesByMongo(wangwang);         // 获取cookie信息
      let page = await getPage(browser, account);              // 获取设置cookie的页面，如果cookie失效返回null
      if(page){
        await startCrawl(wangwang, page);
        await browser.close();
      } else {
        console.log('cookie 失效');
        if (retry < 3) {
          retry_shop.push(shop);
        } else {
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
  console.log('——---爬取完毕———');
  process.exit();
})();