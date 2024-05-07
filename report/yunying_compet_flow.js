/**
 * 生意参谋首页->运营视窗     一年的销售数据
 * 竞争->竞品分析->入店来源   竞品的流量来源
 * 生意参谋->流量->店铺来源->流量来源    本店流量来源
 * 流量->商品来源->手淘搜索/直通车详情       本店关键词
 * 竞争->竞品分析->入店搜索词->引流/成交关键词    竞品关键词
 */
const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getUrlParams} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const dateFormat = require('dateformat');
const { mysqlCfgSql } = require('../commons/db');
const {getCookiesByMongo} = require("../commons/account");
const ObjectId = require('mongodb').ObjectId;
const CryptoJS = require('crypto-js');
const JSEncrypt = require('node-jsencrypt');
process.setMaxListeners(999999999);

let G_SELF_TYPE = [0, 4];// 本店商品类型（mysql）
let crawldate = '';       // 抓取数据的时间
let G_MONGO_ID = '';      //mongo_id
let G_WANGWANG = '';      //店铺名

const startCrawl = async (wangwang, retry = 0) => {
  let browser = null;
  browser = await setBrowser();
  const page = await setCookie(browser, wangwang);
  let data_ids = await getSqlData(wangwang);      //从sql中取出商品和竞品的id
  let token = '';
  let cateid = '';
  try {
    page.on('response', async (response) => {
      if (response.url().indexOf('_____tmd_____/punish') !== -1) {
        await page.waitFor(3000);
        await huaJudge(page);
        console.log('出现滑块');
        await browser.close();
      }
      //获取token
      if (response.url().indexOf('sycm.taobao.com/custom/menu/getPersonalView.json') !== -1) {
        token = await getUrlParams(response.url(), 'token');
        console.log(token);
      }
      //获取cateid
      if (response.url().indexOf('getMonitoredListExcludeGreatShop.json?') !== -1) {
        cateid = await getUrlParams(response.url(), 'firstCateId');
        console.log('cateid', cateid);
      }
    });

    // 进入后台
    const homeUrl = 'https://sycm.taobao.com/mc/ci/item/analysis?';
    await page.goto(homeUrl, {waitUntil: 'networkidle2'});
    if (page.url().indexOf('custom/login.htm') !== -1 || page.url().indexOf('custom/no_permission') !== -1) {
      console.log('cookies失效或生意参谋未授权');
      throw new Error('error cookies loss');
    } else {
      if (token) {
        //竞品的流量来源
        let compet_data = await getCompetitive_Flow(page, token, data_ids[2], cateid);
        //添加一条数据到数据库
        await saveCompetData(compet_data,G_MONGO_ID);
        //一年的销售数据
        let yunying_year_crontab = await getYear_Crontab(page, token);
        await saveYearCrontab(yunying_year_crontab,G_MONGO_ID);
        //本店流量来源
        let product_flow_source = await getProduct_Flow(page, token);
        await saveFlowSource(product_flow_source,G_MONGO_ID);
        //本店关键词
        let product_keyword = await getProduct_Word(page, data_ids[0], token);
        await saveProductKeyword(product_keyword,G_MONGO_ID);
        //竞品关键词
        let compet_keyword = await getCompet_Word(page, token, data_ids[1], cateid);
        await saveCompetKeyword(compet_keyword,G_MONGO_ID);

        await page.waitFor(1000);
        process.exit();
      }
    }
  } catch (e) {
    if (
            e.message.indexOf('Target closed') !== -1 ||
            e.message.indexOf('aaaaaaaaaaaa') === -1 ||
            e.message.indexOf('error cookies loss') !== -1
    ) {
      await browser.close();
      console.log(e.message);
      console.log('运营报表数据1----未获取');
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
 * 获取sql中的ids   竞品和商品的 f_itemId
 * @param wangwang
 */
const getSqlData = async (wangwang) => {
  let compet_ids = [];       //竞品的f_itemId
  let product_ids = [];      //本店的f_itemId
  let ids = {}              //存放所有商品的ids
  //获取 竞品数据
  const wangwang_sql = "select * from t_sycm_competitive_products where f_wangwangid='" + wangwang + "' order by f_type;";
  let sql_data = await mysqlCfgSql(config.mysql_zhizuan, wangwang_sql);
  //筛选出该店铺的竞品信息
  sql_data.forEach(function (value) {
    if (G_SELF_TYPE.indexOf(value.f_type) > -1) { // 本店商品
      product_ids.push(value.f_itemId);
    } else {
      compet_ids.push(value.f_itemId);
    }
    ids[value.f_itemId] = value.f_type;
  });
  return [product_ids, compet_ids, ids];
}
/**
 * 生意参谋首页->运营视窗  店铺按月份销售数据  time：1年
 * @param page、
 * @param token
 */
const getYear_Crontab = async (page, token) => {
  try {
    let crontab_data = [];
    let date = new Date();
    let firstDay = new Date(date.getFullYear(), date.getMonth() - 1, 1).toLocaleDateString();      //上个月的第一天
    let lastDay = new Date(date.getFullYear(), date.getMonth(), 0).toLocaleDateString();                //上个月的最后一天
    let url = 'https://sycm.taobao.com/portal/coreIndex/getTableData.json?dateRange=' + firstDay + '%7C' + lastDay + '&dateType=month&device=0&indexCode=&token=' + token;
    let respon = await sendReauest(page, url);
    await asyncForEach(respon['content']['data'], async (item) => {
      crontab_data.push(item);
    })
    console.log('getYear_Crontab')
    return crontab_data;
  } catch (e) {
    return null;
  }
}
/**
 *竞争->竞品分析->入店来源  竞品和商品流量来源   时间：7天 对比指标：访客数，支付转化指数，交易指数
 * @param page
 * @param token
 * @param product_ids     本店商品的id
 * @param compet_ids      竞品id
 * @param cateid        默认类目
 * @returns
 */
const getCompetitive_Flow = async (page, token, products_ids, cateid) => {
  let data = {};
  data['selfproduct'] = {};
  data['competitive'] = {};  //初始化
  let start_date = dateFormat(new Date().getTime() - 7 * 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  let end_date = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  let self = '';                 //拼接url的参数
  let upper_word = '';          //筛选数据的关键词
  let type_data = '';           //mongo存放本店or 竞品的关键词
  let keys = Object.keys(products_ids)
  await asyncForEach(keys, async (id) => {     //遍历所有商品的ids
    let time = Math.floor(Math.random() * 10) + 10;    //等待时间
    await page.waitFor(time * 1000);
    let temp_data = {};
    let type = products_ids[id];

    //取出数据库存的数据type,判断本店商品 or 竞品
    if (G_SELF_TYPE.indexOf(type) > -1) {
      console.log('本店商品');
      self = '&selfItemId=' + id;    //本店商品的iD
      upper_word = 'selfItem';
      type_data = 'selfproduct';
    } else {
      console.log('竞品');
      self = '&rivalItem1Id=' + id;    //竞品的iD
      upper_word = 'rivalItem1';
      type_data = 'competitive';
    }

    let compare = ['uv', 'payRateIndex', 'tradeIndex'];               //对比指标
    await asyncForEach(compare, async (item) => {
      let result = '';
      let url = 'https://sycm.taobao.com/mc/rivalItem/analysis/getFlowSource.json?device=2&cateId=' + cateid +
          self + '&dateType=recent7&dateRange=' + start_date + '%7C' + end_date + '&indexCode='
          + item + '&order=desc&token=' + token;
      let respon = await sendReauest(page, url);
      if (respon['data']) {           //判断商品是否存在
        let code = respon['data'];
        result = sycmEnc(code);       //data解密
        let obj = {};
        await asyncForEach(result, async (item_cate) => {
          obj[item_cate['pageName']['value']] = item_cate[upper_word + firstUpperCase(item)]['value'];
        })
        temp_data[item] = obj;
      } else {
        temp_data[item] = null;
      }
    })
    data[type_data][id] = temp_data;        //selfproduct:'[id]:'三个指标的数据''
  })
  console.log('getCompetitive_Flow');
  return data;
}

//将字符串的首字母大写
function firstUpperCase(str) {
  let string = str.substring(0, 1).toUpperCase() + str.substring(1);
  return string;
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

/**
 * 生意参谋->流量->店铺来源->流量来源   本店流量来源+趋势  time：30天
 * @param page
 * @param token
 * @returns {Promise<*>}
 */
const getProduct_Flow = async (page, token) => {
  try {
    let start_date = dateFormat(new Date().getTime() - 30 * 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
    let end_date = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
    let url = 'https://sycm.taobao.com/flow/v5/shop/source/tree.json?dateRange=' + start_date + '%7C'
        + end_date + '&dateType=recent30&order=desc&orderBy=uv&device=2&belong=all&token=' + token;
    let respon = await sendReauest_Product(page, url);
    let product_data = respon['data'];

    //取出每条数据的趋势
    await asyncForEach(product_data, async (trend_item) => {    //一级目录
      let trendId = '&pageId=' + trend_item['pageId']['value'] + '&pPageId=' + trend_item['pPageId']['value'];

      await getTrendData(page, trend_item, trendId, token);   //获取趋势图
      await getChildTrend(page, trend_item, token);     //下一级目录获取id和趋势图
    });
    console.log('getProduct_Flow');
    return product_data;
  } catch (e) {
    return null
  }
}

/**
 * 本店流量来源->获取多级目录的pageId .趋势图
 * @param page
 * @param trend_item  二级目录，三级目录下的每条数据
 * @param token
 */
const getChildTrend = async (page, trend_item, token) => {
  if (trend_item.hasOwnProperty('children') === true) {         //二级目录
    let child = trend_item['children'];
    await asyncForEach(child, async (item, index) => {
      if (item['uv'].hasOwnProperty('cycleCrc') === true) {   //获取展示在页面的 有效数据
        let childId = '&pageId=' + item['pageId']['value'] + '&pPageId=' + item['pPageId']['value'];
        console.log('查找趋势图的children', index);

        //趋势图放到['trend']中
        await getTrendData(page, item, childId, token);
        //递归调用，查找三级目录
        await getChildTrend(page, item, token);
      }
    })
  }
}

/**
 *  本店流量来源->显示趋势图     time :30天  分类：5个类目 访客数，加购人数，支付等
 * @param page
 * @param trendItem       每条数据
 * @param trendId         pageid,构造url参数
 * @param token
 * @returns {Promise<void>}
 */
const getTrendData = async (page, trendItem, trendId, token) => {
  trendItem['trend'] = {};
  let start_date = dateFormat(new Date().getTime() - 30 * 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  let end_date = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  let categ = ['uv', 'cartByrCnt', 'payAmt', 'payByrCnt', 'payRate'];    //5个类目下的趋势图

  await asyncForEach(categ, async (item) => {
    let url = 'https://sycm.taobao.com/flow/v3/shop/source/trend.json?dateType=recent30&dateRange=' + start_date + '%7C'
        + end_date + '&indexCode=' + item + '&device=2&belong=all' + trendId + '&token=' + token;
    let response = await sendReauest_Product(page, url);
    trendItem['trend'][item] = response['data']               //放到每条数据的trend属性中

  })
}


/**
 * 搜索端关键词 （本店商品） 流量->商品来源->手淘搜索/直通车 详情   time：7天
 * @param page
 * @param products_ids 本店商品id
 * @param token
 * @returns {Promise<[]>}
 */
const getProduct_Word = async (page, products_ids, token) => {
  try {
    let product_data = [];
    let start_date = dateFormat(new Date().getTime() - 7 * 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
    let end_date = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
    console.log(products_ids, '\n', start_date, '\n', end_date, '\n');
    await asyncForEach(products_ids, async (id) => {
      let product_item = {};
      //直通车详情
      let ztc_url = 'https://sycm.taobao.com/flow/v3/new/item/source/detail.json?dateRange=' + start_date + '%7C' + end_date +
              '&dateType=recent7&order=desc&orderBy=uv&pageId=22.2&pPageId=22&itemId=' + id +
              '&device=2&pageLevel=2&childPageType=se_keyword&belong=all&token=' + token;
      let respon = await sendReauest_Product(page, ztc_url);
      product_item['id'] = id;
      product_item['ztc'] = respon['data']['data'];
      //手淘搜索详情
      let enter_url = 'https://sycm.taobao.com/flow/v3/new/item/source/detail.json?dateRange=' + start_date + '%7C' + end_date +
              '&dateType=recent7&order=desc&orderBy=uv&itemId=' + id + '&device=2&pageId=23.s1150' +
              '&pPageId=23&pageLevel=2&childPageType=se_keyword&belong=all&token=' + token;
      let resp = await sendReauest_Product(page, enter_url);
      product_item['enter'] = resp['data']['data'];
      product_data.push(product_item);
    })
    console.log('getProduct_Word')
    return product_data;
  } catch (e) {
    return null
  }
}

/**
 * 搜索端关键词（竞品）  竞争->竞品分析->入店搜索词->引流/成交关键词   time：1天
 * @param page
 * @param token
 * @param compet_ids  竞品的id
 * @param cateid     类目
 * @returns {Promise<[]>}
 */
const getCompet_Word = async (page, token, compet_ids, cateid) => {
  try {
    let compete_data = [];
    let date = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
    console.log(compet_ids, '\n', cateid, '\n', date);
    let topType = ['flow', 'trade'];      //引流/成交关键词
    await asyncForEach(compet_ids, async (id) => {
      let compete_item = {};
      compete_item['id'] = id;
      await asyncForEach(topType, async (type) => {
        let url = 'https://sycm.taobao.com/mc/rivalItem/analysis/getKeywords.json?dateRange=' + date + '%7C' + date +
                '&dateType=day&device=2&sellerType=0&cateId=' + cateid + '&itemId=' + id + '&topType=' + type + '&token=' + token;
        let respon = await sendReauest(page, url);
        let result = await sycmEnc(respon['data']);       //data解密
        compete_item[type] = result;
      })
      compete_data.push(compete_item);
    })
    console.log('getCompet_Word')
    console.log(compete_data);
    return compete_data;
  } catch (e) {
    return null
  }
}
const saveData = async (wangwang, mongo_id) => {
  let data = {
    mongo_id: mongo_id,
    wangwang_id: wangwang,
    product_type: 'yunying',
    crawldate: crawldate
  }
  // 存入数据
  let db = await mongoQuery();
  await db.collection('report.yunying_report_data').deleteMany({'mongo_id':mongo_id});
  await db.collection('report.yunying_report_data').insertOne(data);
  console.log('存入记录为店铺名称');
};

/**
 * 写入一条数据
 * @param wangwang
 * @param save_data
 */
// 添加一条数据到mongo
const saveCompetData = async (data, mongo_id) => {
  // 存入数据
  let db = await mongoQuery();
  await db.collection('report.yunying_report_data').updateOne({mongo_id: mongo_id}, {
    $set: {competitive_flow_source: data}});
  console.log('竞品流量来源--->存入数据库ok');
};
// 添加一条数据到mongo
const saveYearCrontab = async (data, mongo_id) => {
  // 存入数据
  let db = await mongoQuery();
  await db.collection('report.yunying_report_data').updateOne({mongo_id: mongo_id}, {
    $set: {yunying_year_crontab: data}});
  console.log('年销售数据--->存入数据库ok');
};
// 添加一条数据到mongo
const saveFlowSource = async (data, mongo_id) => {
  // 存入数据
  let db = await mongoQuery();
  await db.collection('report.yunying_report_data').updateOne({mongo_id: mongo_id}, {
    $set: {product_flow_source: data}});
  console.log('本店流量来源--->存入数据库ok');
};
// 添加一条数据到mongo
const saveProductKeyword = async (data, mongo_id) => {
  // 存入数据
  let db = await mongoQuery();
  await db.collection('report.yunying_report_data').updateOne({mongo_id: mongo_id}, {
    $set: {product_keyword: data}});
  console.log('本店关键词--->存入数据库ok');
};
// 添加一条数据到mongo
const saveCompetKeyword = async (data, mongo_id) => {
  // 存入数据
  let db = await mongoQuery();
  await db.collection('report.yunying_report_data').updateOne({mongo_id: mongo_id}, {
    $set: {compet_keyword: data}});
  console.log('竞品关键词--->存入数据库ok');
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
      'referer': 'https://sycm.taobao.com/mc/ci/item/analysis?'
    };
    const response = await fetch(url, {headers: headers});
    return await response.json();
  }, url, transit_id);
};
//本店商品流量
const sendReauest_Product = async (page, url) => {
  return await page.evaluate(async (url) => {
    let headers = {
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-dest': 'empty',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'referer': 'https://sycm.taobao.com/flow/monitor/itemsource?',
      'user-agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
    };
    const response = await fetch(url, {headers: headers});
    return await response.json();
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
// 判斷是否有滑塊，有嘗試三次
const huaJudge = async(page) => {
  const frames = await page.frames();
  const loginFrame = frames.find(f => f.url().indexOf("_tmd_") > -1);
  if(loginFrame){
    console.log('huakuai......');
    let hua1 = await loginFrame.$('#nc_1_n1z');
    let hua2 = await loginFrame.$('#nc_2_n1z');
    for (let i = 0; i < 10; i++) {
      if (hua1 || hua2) {
        let slide = await loginFrame.$('#nc_1_n1z');
        if(hua2){
          slide = await loginFrame.$('#nc_2_n1z');
        }
        await page.waitFor(1500);
        const loc = await slide.boundingBox();
        await page.mouse.move(loc.x, loc.y);
        await page.mouse.down();
        let step = Math.floor(Math.random() * 20) + 60;
        await page.mouse.move(loc.x + 400, loc.y, {steps: step});
        await page.mouse.up();
        await page.waitFor(1000);
        const err = await loginFrame.$('.errloading');
        if (err) {
          await loginFrame.click('.errloading > span.nc-lang-cnt > a')
        }
        const huaText = await loginFrame.$('#nc_1__scale_text');
        if (huaText) {
          const text = await loginFrame.$eval('#nc_1__scale_text > span.nc-lang-cnt', el => el.innerHTML);
          console.log(text);
          if (text.indexOf('验证通过') > -1) {
            break
          }
        }
        hua1 = await loginFrame.$('#nc_1_n1z');
        hua2 = await loginFrame.$('#nc_2_n1z');
      } else {
        break
      }
    }
  }
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
  await saveData(G_WANGWANG, G_MONGO_ID);    //存入商品的mongoid
  await startCrawl(G_WANGWANG);
})();