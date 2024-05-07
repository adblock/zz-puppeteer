/**
 * 直通车 工具->流量解析 关键词+3个行业类目
 * 近13个月的数据
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getUrlParams} = require('../commons/func');
const {mongoQuery, mysqlCfgSql} = require('../commons/db');
const dateFormat = require('dateformat');
const ObjectId = require('mongodb').ObjectId;
const { getCookiesByMongo } = require("../commons/account");
process.setMaxListeners(999999999);

let crawldate = '';       // 抓取数据的时间
let G_MONGO_ID = '';      //mongo_id
let G_WANGWANG = '';      //店铺名

const startCrawl = async (wangwang, retry = 0) => {
  let browser = null;
  try {
    let token = '';
    let suberr = 0;
    let keyword = await getKeyWord(wangwang);    //从sql中查找店铺下不同的关键词
    browser = await setBrowser();
    const page = await setCookie(browser, wangwang);
    // 订阅 reponse 事件，参数是一个 reponse 实体
    await page.on('response', async (response) => {
      if (response.url().indexOf('suberror') > -1) {
        await page.waitFor(3000);
        suberr = 1
      }
      //获取token
      if (response.url().indexOf('home_modules/find.htm') > -1) {
        token = await getUrlParams(response.url(), 'token');
      }
    });

    // 直通车首页 实时数据
    const ztc_url = 'https://subway.simba.taobao.com/#!/home';
    await page.goto(ztc_url, {waitUntil: 'networkidle0'});
    await page.waitFor(1000);
    await page.goto('https://subway.simba.taobao.com/#!/tool/traffic-analysis/index?', {waitUntil: 'networkidle0'});
    if (page.url().indexOf('indexnew.jsp') > -1 || page.$$('.error-page').length > 0 || suberr === 1) {
      console.log('cookies失效或直通车未授权');
      throw new Error('error cookies loss');
    } else {
      try {   // 不重定向的店铺（正常店铺） 会timeout 5s
        await page.waitForResponse(response => response.url().indexOf('account/getRealBalance.json') > -1 || response.url().indexOf('getaccountwithcoupon$?sla=json') > -1, {timeout: 5000});
      } catch (e) {
        console.log('wait balance');
      }
      let category = await getCateId(page, token, keyword);
      let save_data = await getMarketData(page, token, category);
      await saveData(save_data, G_MONGO_ID);
      await page.waitFor(1000);
      process.exit();
    }
  } catch (e) {
    if (
            e.message.indexOf('aaaaaaaaaaaa') === -1 ||
            e.message.indexOf('error cookies loss') !== -1
    ) {
      await browser.close();
      console.log(e.message);
      console.log('运营报表数据3----未获取');
      retry += 1;
      console.log('重试', retry, '次');
      if (retry < 4) {
        await startCrawl(wangwang, retry);
      } else {
        console.error('退出进程')
        process.exit();
      }
    }
  }
};
//从sql中查找关键词f_keyword
const getKeyWord = async (wangwang) => {
  let word = [];
  let keywords = "select distinct f_keyword from t_sycm_competitive_products where f_wangwangid='" + wangwang + '\'';
  let sql_data = await mysqlCfgSql(config.mysql_zhizuan, keywords);
  sql_data.forEach(function (item) {
    word.push(item.f_keyword);
  });
  console.log(word);
  return word;
}

//获取3个类目的cateid
const getCateId = async (page, token, keyword) => {
  let cate = [];
  await asyncForEach(keyword, async (word_item) => {
    let url = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/traffic/word/category$';
    let respon = await sendReauest(page,
            {
              'word': word_item,
              'sla': 'json',
              'isAjaxRequest': 'true',
              'token': token,
            }, url);
    let cate_id = respon['result']['cateList'];
    let temp_cate = {};
    temp_cate['word'] = word_item;
    temp_cate['category'] = cate_id;
    cate.push(temp_cate);
  })
  return cate;
}
/**
 * 获取行业近13个月日期，展现指数，点击指数，点击转化率
 * **/
const getMarketData = async (page, token, category) => {
  let url = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/traffic/report/word/category$';
  console.log(category);
  let cate_id = '';
  let keyword = '';
  //category 格式：{ word: '护肩', category: [cateid, catename] }
  await asyncForEach(category, async (items) => {
    let temp_data = [];                     //每个关键词内的类目和具体数据
    await asyncForEach(items['category'], async (item) => {
      let save_data = {};
      //取出cateId，keyword（护肩）作为data参数;
      cate_id = item['cateId'];
      keyword = items['word'];
      let form_data = {
        'word': keyword,
        'cateId': cate_id,
        'sla': 'json',
        'isAjaxRequest': 'true',
        'startDate': dateFormat(new Date().getTime() - 395 * 24 * 60 * 60 * 1000, 'yyyy-mm-dd'), //13个月 395天
        'endDate': dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd'),
        'token': token,
      };
      let respon = await sendReauest(page, form_data, url);
      save_data['cate'] = item['cateName'];
      save_data['data'] = respon['result'];
      temp_data.push(save_data);
    })
    items['category'] = temp_data;
  })
  return category;
}

// 存储数据到mongo
const saveData = async (save_data, mongo_id) => {
  // 存入数据
  let db = await mongoQuery();
  await db.collection('report.yunying_report_data').updateOne({mongo_id: mongo_id}, {$set: {ztc_market_data: save_data}});
  console.log('存入数据库ok');
};

/**
 * 格式化数据得方法
 * @param {Object} data 数据
 * */
const parseDataToUrl = async (data) => {
  return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
};

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {Object} body 请求发送的数据
 * @param {String} url  请求的url
 * */
const sendReauest = async (page, body, url) => {
  body = await parseDataToUrl(body);
  return await page.evaluate(async (body, url) => {
    let headers = {
      'referer': 'https://subway.simba.taobao.com',
      'origin': 'https://subway.simba.taobao.com',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-dest': 'empty',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
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
//创建浏览器
const setBrowser = async () => {
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

(async () => {
  const args = process.argv.splice(2);
  G_MONGO_ID = args[0];
  console.log(G_MONGO_ID);
  // 根据mongo id 查询 要爬取的店铺信息
  let db = await mongoQuery();
  const shop_data = await db.collection('report_spider_status_list').find({_id:ObjectId(G_MONGO_ID)}).toArray();
  console.log(shop_data[0].spider_type);
  G_WANGWANG = shop_data[0].shop_name;
  console.log(G_WANGWANG);

  crawldate = dateFormat(new Date(), "yyyy-mm-dd");
  await startCrawl(G_WANGWANG);
})();