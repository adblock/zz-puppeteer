/**
 * 生意参谋->服务->体验诊断   店铺30天基础服务考核得分
 */
const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach, setJs, getUrlParams} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const dateFormat = require('dateformat');
const {getCookiesByMongo} = require("../commons/account");
const ObjectId = require('mongodb').ObjectId;

process.setMaxListeners(999999999);
let crawldate = '';       // 抓取数据的时间
let G_MONGO_ID = '';      //mongo_id
let G_WANGWANG = '';      //店铺名

const startCrawl = async (wangwang, retry = 0) => {
  let browser = null;
  try {
    browser = await setBrowser();
    const page = await setCookie(browser, wangwang);
    let token = '';
    let jsonp = '';
    let suberr = 0;
    let flag = 2;  //判断店铺  0：天猫 1:淘宝 2：海外
    let score;   //存放店铺的数据
    page.on('response', async (response) => {
      if (response.url().indexOf('_____tmd_____/punish') !== -1) {
        await page.waitFor(3000);
        console.log('出现滑块');
        suberr = 1;
      }
      //获取token
      if (response.url().indexOf('sycm.taobao.com/custom/menu/getPersonalView.json') !== -1) {
        token = await getUrlParams(response.url(), 'token');
      }
      //判断为天猫店铺
      if (response.url().indexOf('common/expScore?') !== -1) {
        flag = 0;
      }
      //判断为淘宝店铺
      if (response.url().indexOf('getSellerValuesByBizType?') !== -1) {
        flag = 1;
        jsonp = await response.url().match(/(?<=&callback=)(\S+)/)[0];
      }
    });

    // 进入后台
    const homeUrl = 'https://sycm.taobao.com/qos/service/frame/tiyanzhenduan/new?'; //体验诊断页面
    await page.goto(homeUrl, {waitUntil: 'networkidle2'});
    if (page.url().indexOf('custom/login.htm') !== -1 || page.url().indexOf('custom/no_permission') !== -1 || suberr === 1) {
      console.log('cookies失效或生意参谋未授权');
      throw new Error('error cookies loss');
    } else {
      if (token) {
        if (flag === 0) {
          score = await getServiceScore_Tma(page);
        }
        if (flag === 1) {
          score = await getServiceScore_Tba(page, jsonp);
        }
        if (flag === 2) {
          const homeUrl = 'https://fuwushuju.tmall.com/dashboard/sellerBoardDetail.htm?&schemeId=116';
          await page.goto(homeUrl, {waitUntil: 'networkidle2'});
          score = await getServiceScore_Intel(page);
          console.log('海外-------');
        }
        await saveData(score, G_MONGO_ID);
        await page.waitFor(1000);
        process.exit();
      }
    }
  } catch (e) {
    if (
            e.message.indexOf('aaaaaaaaaaaa') === -1 ||
            e.message.indexOf('error cookies loss') !== -1
    ) {
      await browser.close();
      console.log('运营报表数据4----未获取');
      console.log(e.message);
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
/**
 * 获取天猫店铺的基础服务分数
 * @param page
 */
const getServiceScore_Tma = async (page) => {
  let save_data = [];
  for (let i = 1; i < 31; i++) {
    let crawl_date = dateFormat(new Date().getTime() - i * 24 * 60 * 60 * 1000, 'yyyymmdd');
    let url = 'https://sycm.taobao.com/sdx/diagnose/new/common/expScore?&type=service&dateId=' + crawl_date;
    let respon = await sendReauest(page, url);
    //取出30天的服务分数
    let item = respon['data'];
    let service_data = {};
    service_data['goods'] = parseFloat(item['goods'][0]['currentScore']) || 0;
    service_data['logistics'] = parseFloat(item['logistics'][0]['currentScore']) || 0;
    service_data['after'] = parseFloat(item['after'][0]['currentScore']) || 0;
    service_data['dispute'] = parseFloat(item['dispute'][0]['currentScore']) || 0;
    service_data['consult'] = parseFloat(item['consult'][0]['currentScore']) || 0;
    service_data['dateId'] = crawl_date;
    save_data.push(service_data);
  }
  console.log('天猫店铺的服务分数ok');
  return save_data;
}
/**
 * 获取淘宝店铺的基础服务分数
 * @param page
 * @param jsonp
 */
const getServiceScore_Tba = async (page, jsonp) => {
  let text = '';     //jsonp文本
  let data = '';     //json数据
  let save_data = [];
  for (let i = 1; i < 31; i++) {
    let crawl_date = dateFormat(new Date().getTime() - i * 24 * 60 * 60 * 1000, 'yyyymmdd');
    let url = 'https://sycm.taobao.com/sdx/diagnose/dataApi/getSellerValuesByBizType?type=star&bizType=taobao&theme=biz&callback=' + jsonp + '&bizDate=' + crawl_date;
    //转化为可处理的json数据
    text = await sendReauest_jsonp(page, url);
    text = text.replace(jsonp, "")
    data = eval("(" + text + ")");
    //判断某一项服务
    let name = data['data']['dimMetircList']['dataSource'];
    let service_data = {};
    service_data['dateId'] = crawl_date;
    name.forEach(function (item) {
      let value = item['category']['value'];
      if (value === '商品体验') {
        service_data['goods'] = parseFloat(item['metricScore']);
      }
      if (value === '物流体验') {
        service_data['logistics'] = parseFloat(item['metricScore']);
      }
      if (value === '售后体验' && item['categoryRowSpan'] === 2) {
        service_data['after'] = parseFloat(item['metricScore']);
      }
      if (value === '纠纷体验') {
        service_data['dispute'] = parseFloat(item['metricScore']);
      }
      if (value === '咨询体验' && item['categoryRowSpan'] === 2) {
        service_data['consult'] = parseFloat(item['metricScore']);
      }
    })
    save_data.push(service_data);
  }
  console.log('淘宝店铺的服务分数ok');
  return save_data;
}
/**
 * 获取国际店铺的基础服务分数 ,缺少物流体验，共4项
 * @param page
 */
const getServiceScore_Intel = async (page) => {
  let save_data = [];   //无物流体验指标
  for (let i = 1; i < 31; i++) {
    let crawl_date = dateFormat(new Date().getTime() - i * 24 * 60 * 60 * 1000, 'yyyy.mm.dd');
    let url = 'https://fuwushuju.tmall.com/dashboard/ajax/schemeDetail.do?schemeId=116&date=' + crawl_date;
    let respon = await sendReauest(page, url);
    let name = respon['data']['groupViews'];
    let service_data = {};
    service_data['goods'] = name[0]['value'];
    service_data['after'] = name[1]['value'];
    service_data['dispute'] = name[2]['value'];
    service_data['consult'] = name[3]['value'];
    service_data['dateId'] = crawl_date;
    save_data.push(service_data);
  }
  console.log('海外店铺的服务分数ok');
  return save_data;
}

// 添加一条数据到mongo
const saveData = async (score, mongo_id) => {
  // 存入数据
  let db = await mongoQuery();
  await db.collection('report.yunying_report_data').updateOne({mongo_id: mongo_id}, {
    $set: {shop_service_score: score}});
  console.log('存入数据库ok');
};

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest = async (page, url) => {
  return await page.evaluate(async (url) => {
    let headers = {
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-dest': 'empty',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'user-agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
    };
    const response = await fetch(url, {headers: headers});
    return await response.json();
  }, url);
};
const sendReauest_jsonp = async (page, url) => {
  return await page.evaluate(async (url) => {
    let headers = {
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-dest': 'empty',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'user-agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
      'referer': 'https://sycm.taobao.com/sdx/dailyreport.html'
    };
    const response = await fetch(url, {headers: headers});
    return await response.text();
  }, url);
};

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
}

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
