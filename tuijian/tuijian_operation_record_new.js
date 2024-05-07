/**
 * 超级推荐 筛选一定条件的操作记录
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getUrlParams} = require('../commons/func');
const {mongoInit} = require('../commons/db');
const dateFormat = require('dateformat');
const { getCookiesByMongo } = require("../commons/account");
const { getCZZShopBossOperate } = require('../commons/func');
const http = require('http');

process.setMaxListeners(999999999);

const G_NUM = config.tuijian_spider_concurrency; // 浏览器的启动数量
let G_BROWSER_LIST = []; // 浏览器列表
let G_SHOP_LIST = []; // 店铺列表
let G_CRAWL_DATE = ''; // 抓取数据的时间
let G_END_SHOP_HASH = {}; // 请求结束的店铺
let G_SHOP_LIST_ORG = []; // 原始的店铺列表
let G_SEND_STATUS = true;
let G_MONGO = null;

const startCrawl = async (shop, orgBrowser) => {
  try {
    console.log(shop);
    orgBrowser.is_run = true;
    let token = '';
    let huakuai = 0;    // 是否有滑块
    let save_data = {};
    let wangwang = shop.wangwang;

    // 获取page
    let page = await setPage(orgBrowser.ws);

    // 拦截请求, 获取fetch需要的token等字段
    await page.setRequestInterception(true);
    page.on('request',  async(request) => {
      if(request.url().indexOf('isProtocolSigned.json') > -1) {
        let params = request.url().match(/&timeStr=(\S+)/);
        if(params && token === ''){
          token = params[0];       // 获取token 等字段
        }
        return request.continue();
      } else {
        return request.continue();
      }
    });

    // 订阅 reponse 事件，参数是一个 reponse 实体
    await page.on('response', async (response) => {
      if (response.url().indexOf('punish?x5secdata') > -1) {
        if(token){
          console.log('滑块块块块块块块块块块块块');
          huakuai = 1;
          G_SHOP_LIST.push(shop);
          await assign(orgBrowser)
        }
      }
      if (response.url().indexOf('https://tuijian.taobao.com/indexbp-feedflow.html') !== -1) {
        let text = await response.text();
        if (text.indexOf('_____tmd_____/punish') !== -1) {
          if(token){
            console.log('出现滑块');
            huakuai = 1;
            G_SHOP_LIST.push(shop);
            await assign(orgBrowser)
          }
        }
      }
    });

    // 进入后台
    let account = await getCookiesByMongo(wangwang);
    if(account && account.f_raw_cookies) {
      // 赋予浏览器圣洁的cookie
      await asyncForEach(account.f_raw_cookies.sycmCookie, async (value, index) => {
        await page.setCookie(value);
      });
      await page.goto('https://tuijian.taobao.com/indexbp-feedflow.html', {waitUntil: "networkidle0"});
      // 超级推荐 未登录处理
      if (page.url().indexOf('https://tuijian.taobao.com/index.html') > -1) {
        console.log('登录失败');
        if (shop.retry < 3) {
          shop.retry = shop.retry + 1;
          G_SHOP_LIST.push(shop);
          await assign(orgBrowser);
        } else {
          await addShopToEndList(wangwang);
          await saveNologinData(wangwang);
          await assign(orgBrowser);
        }
      }
    }else {
      console.log('cookie 失效');
      if (shop.retry < 3) {
        shop.retry = shop.retry + 1;
        G_SHOP_LIST.push(shop);
        await assign(orgBrowser);
      } else {
        await addShopToEndList(wangwang);
        await saveNologinData(wangwang);
        await assign(orgBrowser);
      }
    }

    if (page.url().indexOf('https://tuijian.taobao.com/indexbp-feedflow.html') > -1) {
      if (token) {
        save_data = await getSaveData(page, token);
        if (huakuai === 0) {
          // 存储数据判断是否符合条件
          await saveDataJudge(save_data, shop, orgBrowser);
        }
      } else {
        console.error('token 为空，出现滑块');
        if (shop.retry < 3) {
          await page.waitFor(5000);
          await page.goto('https://tuijian.taobao.com/indexbp-feedflow.html', {waitUntil: "networkidle0"});
          if(token){
            save_data = await getSaveData(page, token);
            if(huakuai === 0){
              // 存储数据判断是否符合条件
              await saveDataJudge(save_data, shop, orgBrowser);
            }
          } else{
            shop.retry = shop.retry + 1;
            G_SHOP_LIST.push(shop);
            await assign(orgBrowser)
          }
        } else {
          await addShopToEndList(wangwang);
          await saveNologinData(wangwang);
          await assign(orgBrowser);
        }
      }
    }
  }catch (e) {
    if(
            e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
            e.message.indexOf('Session closed. Most likely the page has been closed') === -1
    ) {
      console.log('all error',shop.wangwang);
      G_SHOP_LIST.push(shop);
      console.log(e);
      await assign(orgBrowser)
    }
  }
};

const saveDataJudge = async (save_data, shop, orgBrowser) => {
  // 存储数据
  await saveData(shop.wangwang, save_data);
  // 重新启动
  await addShopToEndList(shop.wangwang);
  await assign(orgBrowser);
};

/**
 * fetch url  获取操作记录
 * @param page
 * @param token
 * @returns {Promise<void>}
 */
const getSaveData = async (page, token) => {
  console.log(token);
  let typeObj = {'104': 'creative', '107': 'target', '110': 'adzone', '102': 'campaign', '103': 'adgroup'};
  let save_data = [];
  for (let type in typeObj) {
    console.log(type);
    let oper_url = 'https://tuijian.taobao.com/api/log/findOperationLog.json?r=mx_1379&startTime=' + G_CRAWL_DATE
            + '&endTime=' + G_CRAWL_DATE + '&offset=0&pageSize=40&campaignId=&adgroupId=&entityType=' + type +
            '&page=1&entityTypes=%5B%22' + type + '%22%5D' + token;
    const operation = await sendReauest(page, oper_url);
    await asyncForEach(operation['data']['list'], async (data) => {
      save_data.push(data);
    });
  }
  return save_data;
}

/**
 * 获取当前店铺的 page实例
 * @param browserWSEndpoint
 * @returns {Promise<*>}：page
 */
const setPage = async(browserWSEndpoint) => {
  const browser = await puppeteer.connect({browserWSEndpoint});
  // 关闭无用的page
  let pages = await browser.pages();
  for (let i = 0; i < pages.length; ++i) {
    if(i>0){
      await pages[i].close();
    }
  }
  let page = await setJs(await browser.newPage());
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
  page.setViewport({
    width: 1376,
    height: 1376
  });
  return page
};

// 存储数据到mongo
const saveData  = async (wangwang, save_data) => {
  let data = {
    data:save_data,
    created_at:new Date(),
    updated_at:new Date(),
    crawl_date:G_CRAWL_DATE,
    shop_name: wangwang,
    shop_login:'是',
    type: '超级推荐'
  };
  // 存入数据
  await G_MONGO.db.collection('operation_record_no_delete').insertOne(data);
  await G_MONGO.db.collection('chaojituijian_operation_record_new').deleteMany({'crawl_date': G_CRAWL_DATE, 'shop_name': wangwang});
  await G_MONGO.db.collection('chaojituijian_operation_record_new').insertOne(data);
};

const saveNologinData  = async (wangwang) => {
  let data = {
    data:'',
    created_at:new Date(),
    updated_at:new Date(),
    crawl_date:G_CRAWL_DATE,
    shop_name: wangwang,
    shop_login:'否',
    type: '超级推荐',
  };
  // 存入数据
  await G_MONGO.db.collection('operation_record_no_delete').insertOne(data);
  await G_MONGO.db.collection('chaojituijian_operation_record_new').deleteMany({'crawl_date': G_CRAWL_DATE, 'shop_name': wangwang});
  await G_MONGO.db.collection('chaojituijian_operation_record_new').insertOne(data);
};

// 抓取数据结束
const endCrawl = async function() {
  if(Object.keys(G_END_SHOP_HASH).length >= G_SHOP_LIST_ORG.length && G_SEND_STATUS){
    G_SEND_STATUS = false;
    console.log('----爬取完毕---');
    process.exit();
  }
  if(G_SHOP_LIST.length === 0){
    G_SHOP_LIST_ORG.forEach(function (value) {
      if(G_END_SHOP_HASH.hasOwnProperty(value.wangwang) === false){
        G_SHOP_LIST.push({
          wangwang:value.wangwang,
          retry:0
        })
      }
    });
  }
  console.log(Object.keys(G_END_SHOP_HASH).length, G_SHOP_LIST_ORG.length, G_SHOP_LIST.length);
};

const addShopToEndList = async (wangwang)=>{
  G_END_SHOP_HASH[wangwang] = true;
};

// 分配请求再请求
const assign  = async (browser) => {

  if (browser !== undefined){
    browser.is_run = false;
  }
  await endCrawl();

  for (let i = 0; i < G_BROWSER_LIST.length; ++i) {
    if(G_BROWSER_LIST[i].is_run === false){
      // 从列表获取一个店铺
      const shop = G_SHOP_LIST.shift();
      if(shop !== undefined){
        startCrawl(
                shop,
                G_BROWSER_LIST[i]
        );
      }
    }
  }
};

// 生成店铺列表
const setShopList = async ()=> {
  let shop_list = await getCZZShopBossOperate();
  shop_list.forEach(function (value) {
    G_SHOP_LIST.push({
      wangwang:value.f_copy_wangwangid,
      retry:0
    });
    G_SHOP_LIST_ORG.push({
      wangwang:value.f_copy_wangwangid,
      retry:0
    });
  });
  console.log(G_SHOP_LIST.length,G_SHOP_LIST_ORG.length);
};

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest = async (page,url)=>{
  return await page.evaluate(async (url) => {
    let headers = {
      'referer':'https://tuijian.taobao.com/indexbp-feedflow.html',
      'origin':'https://tuijian.taobao.com/indexbp-feedflow.html',
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
 * 生成 G_NUM 个常驻的浏览器
 * @returns {Promise<void>}
 */
const setBrowsers = async() => {
  for (i = 0; i < G_NUM; i++) {
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
      ws:browser.wsEndpoint(),
      is_run:false
    });
  }
};

(async () => {
  const args = process.argv.splice(2);
  G_CRAWL_DATE = args[0];
  // 接受参数(日期)  不传参数默认爬取昨天的
  if (G_CRAWL_DATE === undefined){
    G_CRAWL_DATE = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  }

  G_MONGO = await mongoInit();
  // 生成 G_NUM 个常驻的浏览器
  await setBrowsers();
  // 获取店铺列表
  await setShopList();
  await assign();
})();
