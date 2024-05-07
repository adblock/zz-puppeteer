/**
 * 生意参谋->市场搜索分析 近30天TOP100热搜词表
 */
const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach, setJs, getUrlParams, getCZZShopBoss} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const dateFormat = require('dateformat');
const {getCookiesByMongo} = require("../commons/account");
const CryptoJS = require('crypto-js');
const JSEncrypt = require('node-jsencrypt');
process.setMaxListeners(999999999);

const G_NUM = config.tuijian_spider_concurrency; // 浏览器的启动数量
let G_BROWSER_LIST = []; // 浏览器列表
let G_SHOP_LIST = []; // 店铺列表
let crawldate = ''; // 抓取数据的时间
let G_END_SHOP_HASH = {}; // 请求结束的店铺
let G_SHOP_LIST_ORG = []; // 原始的店铺列表

const startCrawl = async (shop, orgBrowser) => {
  let browser = null;
  let wangwang = shop.wangwang;
  let word = '护肩';
  try {
    console.log(wangwang);
    let browserWSEndpoint = orgBrowser.ws;
    browser = await puppeteer.connect({browserWSEndpoint});
    const page = await setCookie(browser, wangwang);
    let token = '';
    let suberr = 0;
    let error = 0;
    page.on('response', async (response) => {
      if (response.url().indexOf('_____tmd_____/punish') !== -1) {
        await page.waitFor(3000);
        console.log('出现滑块');
        suberr=1;
      }
      //获取token
      if (response.url().indexOf('sycm.taobao.com/custom/menu/getPersonalView.json') !== -1) {
        token = await getUrlParams(response.url(), 'token');
        console.log(token);
      }
      //未开通此功能
      if (response.url().indexOf('productOrder/listUserCategorys.json?') !== -1) {
        error = 1;
      }
    });

    // 进入后台
    const homeUrl = 'https://sycm.taobao.com/mc/mq/search_analyze?';
    await page.goto(homeUrl, {waitUntil: 'networkidle2'});
    if (page.url().indexOf('custom/login.htm') !== -1 || page.url().indexOf('custom/no_permission') !== -1 || error===1 || suberr === 1) {
      console.error('Cookie过期或生意参谋未授权');
      await endAndAdd(wangwang, browser);
    } else {
      if (token) {
        let search_data = await getSearch_Word(page, token, word);
        await saveData(wangwang, search_data, word);
      }
      await endAndAdd(wangwang, browser);
    }
  } catch (e) {
    if (
            e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
            e.message.indexOf('Session closed. Most likely the page has been closed') === -1
    ) {
      console.log(222222222);
      console.log(e.message);
      await endAndAdd(wangwang);
    }
  }
};
/**
 * 行业近30天TOP100热搜词表
 **/
const getSearch_Word = async (page, token, word) => {
  let search_data = [];
  let count = 100;    //top100条数据
  let month_data = dateFormat(new Date().getTime() - 30 * 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  let url = 'https://sycm.taobao.com/mc/searchword/relatedWord.json?dateRange=' + month_data + '%7C' + crawldate +
          '&dateType=recent30&pageSize=100&page=1&order=desc&orderBy=seIpvUvHits&keyword=' + word + '&device=0&indexCode=&token=' + token;
  console.log(url);
  let respon = await sendReauest(page, url);
  let code = respon['data'];
  let res_data = sycmEnc(code);     //data解密
  await asyncForEach(res_data, async (item) => {
    if (count) {
      search_data.push(item);
      count--;
    }
  })
  console.log(search_data.length);
  return search_data;
}

// 生意参谋data解密
function sycmEnc(e) {
  let s = "w28Cz694s63kBYk4";
  l = CryptoJS.enc.Utf8.parse(s);
  u = {
    iv: CryptoJS.enc.Utf8.parse("4kYBk36s496zC82w"),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  };
  let n = e;
  try {
    n = JSON.parse(CryptoJS.AES.decrypt(function (e) {
      return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Hex.parse(e))
    }(e), l, u).toString(CryptoJS.enc.Utf8))
  } catch (e) {
    return "i.isFunction(t) && t(e)",
            null
  }
  return n
}

// 获取 get_transit_id
const get_transit_id = async () => {
  let encryptor = new JSEncrypt();  // 创建加密对象实例
  let pubKey = '-----BEGIN PUBLIC KEY-----MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCJ50kaClQ5XTQfzkHAW9Ehi+iXQKUwVWg1R0SC3uYIlVmneu6AfVPEj6ovMmHa2ucq0qCUlMK+ACUPejzMZbcRAMtDAM+o0XYujcGxJpcc6jHhZGO0QSRK37+i47RbCxcdsUZUB5AS0BAIQOTfRW8XUrrGzmZWtiypu/97lKVpeQIDAQAB-----END PUBLIC KEY-----'
  encryptor.setPublicKey(pubKey);  //设置公钥
  return encryptor.encrypt('w28Cz694s63kBYk4')  // 对内容进行加密
};

// 存储数据到mongo
const saveData = async (wangwang, save_data, word) => {
  let data = {
    data: save_data,
    date: crawldate,
    nick_name: wangwang,
    days: '30',
    keyword: word,
    create_date: dateFormat(new Date(), 'yyyy-mm-dd')
  };
  // 存入数据
  let db = await mongoQuery();
  await db.collection('yunying.canmou_hotsearch_word').deleteMany({'date': crawldate, 'nick_name': wangwang});
  await db.collection('yunying.canmou_hotsearch_word').insertOne(data);
  console.log('存入数据库成功');
};

/**
 * 结束并添加到end里面，并调取下一家
 * @param wangwang
 * @param browser
 * @returns {Promise<void>}
 */
const endAndAdd = async (wangwang, browser) => {
  if (browser) {
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
const sendReauest = async (page, url) => {
  let transit_id = await get_transit_id();
  return await page.evaluate(async (url, transit_id) => {
    let headers = {
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-dest': 'empty',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'transit-id': transit_id,
      'user-agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
      'referer': 'https://sycm.taobao.com/mc/mq/search_analyze?'
    };
    const response = await fetch(url, {headers: headers});
    return await response.json();
  }, url, transit_id);
};

// 抓取数据结束
const endCrawl = async function () {
  console.log('end');
  console.log(Object.keys(G_END_SHOP_HASH).length, G_SHOP_LIST_ORG.length);
  if (Object.keys(G_END_SHOP_HASH).length === G_SHOP_LIST_ORG.length) {
    console.log('店铺爬取完成');
    process.exit();
  }
};
const addShopToEndList = async (wangwang) => {
  G_END_SHOP_HASH[wangwang] = true;
};

// 分配请求再请求
const assign = async () => {
  await endCrawl();
  const browserCount = G_BROWSER_LIST.length;
  for (let i = 0; i < browserCount; i++) {
    // 从列表获取一个店铺
    const shop = G_SHOP_LIST.shift();
    if (shop !== undefined) {
      startCrawl(
              shop,
              G_BROWSER_LIST.pop()
      );
    } else {
      await endCrawl();
    }
  }
};

//创建浏览器
const setBrowser = async () => {
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
    ws: browser.wsEndpoint()
  });
}

// 生成店铺列表
const setShopList = async (shop_list, page = null) => {
  console.log(shop_list.length);
  if (shop_list.length === 0) {
    process.exit();
  }
  G_SHOP_LIST_ORG = shop_list;
  shop_list.forEach(function (value) {
    G_SHOP_LIST.push({
      wangwang: value.f_copy_wangwangid,
      retry: 0
    });
  });
};

// 赋值cookie
const setCookie = async (browser, wangwang) => {
  let account = await getCookiesByMongo(wangwang);
  // 关闭无用的page
  let pages = await browser.pages();
  await asyncForEach(pages, async function (page, index) {
    if (index > 0) {
      await page.close();
    }
  });
  await browser.newPage();
  pages = await browser.pages();
  // page配置js
  page = await setJs(pages[1]);
  page.setDefaultTimeout(600000);
  page.setDefaultNavigationTimeout(600000);
  page.setViewport({
    width: 1376,
    height: 1376
  });
  if (account && account.f_raw_cookies) {
    // 赋予浏览器圣洁的cookie
    await asyncForEach(account.f_raw_cookies.sycmCookie, async (value, index) => {
      await page.setCookie(value);
    });
  }
  return page;
}

(async () => {
  //page 1,2;
  const args = process.argv.splice(2);
  let page = null;
  if (typeof (args[0]) !== 'undefined' && typeof (args[1]) !== 'undefined') {
    page = [args[0], args[1]]
  }
  //默认爬取昨天的数据
  crawldate = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  let shopList = await getCZZShopBoss('直通车', page);
  await setShopList(shopList, page);
  // 生成N个常驻的浏览器
  for (i = 0; i < G_NUM; i++) {
    await setBrowser();
  }
  await assign();
})();
