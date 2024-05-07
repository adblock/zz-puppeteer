/**
 * 淘宝页面->竞品的详细数据
 * 链接 标题 付款人数 销量 价格区间 优惠券 评价数 淘金币 SKU 特色服务 付款方式 主图 缩略图
 * 生意参谋-> 市场-> 搜索排行   热搜词表
 */
const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach, setJs, getUrlParams} = require('../commons/func');
const {mongoQuery,mysqlCfgSql} = require('../commons/db');
const dateFormat = require('dateformat');
const {getCookiesByMongo} = require("../commons/account");
const CryptoJS = require('crypto-js');
const JSEncrypt = require('node-jsencrypt');
const ObjectId = require('mongodb').ObjectId;
process.setMaxListeners(999999999);

let G_SELF_TYPE = [0, 4];// 本店商品类型（mysql）
let crawldate = '';       // 抓取数据的时间
let G_MONGO_ID = '';      //mongo_id
let G_WANGWANG = '';      //店铺名
let SALE_people ={};      // //sql中找到每个商品的付款人数

const startCrawl = async (wangwang, retry = 0) => {
  let browser = null;
  try {
    browser = await setBrowser();
    const page = await setCookie(browser, wangwang);
    let data_ids = await getSqlData(wangwang);      //从sql中取出商品和竞品的id
    let save_data = await getCompetitive_Detail(page, data_ids[2], browser); //获取竞品的淘宝页面详细数据
    //保存数据
    await saveTba_Data(save_data[0], G_MONGO_ID);
    //搜索热词
    let search_data = await getHotSearch_Cate(page, wangwang, save_data[1], browser);
    await saveWords_Data(search_data, G_MONGO_ID);
    await page.waitFor(1000);
    process.exit();
  } catch (e) {
    if (
        e.message.indexOf('Target closed') !== -1 ||
        e.message.indexOf('aaaaaaaaaaaa') === -1 ||
        e.message.indexOf('error cookies is loss') !== -1
    ) {
      await browser.close();
      console.log(e.message);
      console.log('运营报表数据2----未获取');
      retry += 1;
      console.log('重试', retry, '次');
      if (retry < 4) {
        await startCrawl(wangwang, retry);
      } else {
        console.error('退出进程');
        process.exit();
      }
    }
  }
};
/**
 * 获取sql中的ids
 * @param wangwang
 */
const getSqlData = async (wangwang) => {
  let day = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  let compet_ids = [];       //竞品的f_itemId
  let product_ids = [];      //本店的f_itemId
  let ids = [];
  //获取 竞品数据
  const wangwang_sql = "select * from t_sycm_competitive_products where f_wangwangid='" + wangwang + "' order by f_type;";
  let sql_data = await mysqlCfgSql(config.mysql_zhizuan, wangwang_sql);
  //筛选出该店铺的竞品信息
  sql_data.forEach(function (value) {
    ids.push(value.f_itemId);
    if (G_SELF_TYPE.indexOf(value.f_type) > -1) { // 本店商品
      product_ids.push(value.f_itemId);
    } else {
      compet_ids.push(value.f_itemId);
    }
  });

  //获取数据库的商品的付款人数
  const saleman_sql = "select f_itemId,sales_people from t_sycm_competitive_products_detail where f_wangwangid='" + wangwang + "'and f_date like'" + day + "%' ";
  let saleman = await mysqlCfgSql(config.mysql_zhizuan, saleman_sql);
  await asyncForEach(saleman, async(item)=>{
    SALE_people[item['f_itemId']] = item['sales_people'];
  })
  console.log(SALE_people);
  return [product_ids, compet_ids, ids];
}

/**
 * 获取商品详细的数据 :天猫淘宝店铺
 * @param new_page
 * @param ids
 * @returns {Promise<void>}
 */
const getCompetitive_Detail = async (new_page, ids, browser) => {
  try {
    console.log('item_id', ids);
    let save_data = [];
    let cid_list = [];
    let text;
    let categoryid = '';
    let shopname = '';
    let flag = 1;
    let url_text = '';

    // 订阅 reponse 事件，参数是一个 reponse 实体
    await new_page.on('response', async (response) => {

      if (response.url().indexOf('_____tmd_____/punish') !== -1) {
        console.log('出现滑块')
        new_page.waitFor(3000);
        await browser.close();
      }
      //获取tmall销量
      if (response.url().indexOf('initItemDetail.htm') !== -1) {
        flag = 1;
      }
      //获取taobao销量
      if (response.url().indexOf('item/detail/sib.htm') !== -1) {
        flag = 0;
      }
      //获取淘宝店铺的名字
      if (response.url().indexOf('tui.taobao.com/recommend?') !== -1) {
        url_text = await response.text();
        let names = url_text.match(/shopName":".*?"/) + '';
        if (names.indexOf('null') === -1) {
          let namess = names.replace('shopName":"', '');
          shopname = namess.replace('"', '');
          console.log(shopname);
        }
      }
    });
    //拼接url并访问
    await asyncForEach(ids, async (id) => {
      if (id) {      //id不为空
        let detail_url = 'https://item.taobao.com/item.htm?&id=' + id;
        console.log(detail_url);
        await new_page.goto(detail_url, {waitUntil: 'networkidle2'});
        if (flag === 1) {
          console.log('天猫');
          await new_page.waitFor(1000);
          let shop_service = await new_page.$('.tm-laysku-dd');
          if (shop_service) {
            shopname = await new_page.$eval('.slogo-shopname> strong', ele => ele.innerText);
            text = await getCompet_Tma(new_page, id);
            //获取类目
            categoryid = await getCategoryid(new_page);
          } else {
            shopname = null;
            text = '商品不存在或已下架';
          }
        }
        if (flag === 0) {
          console.log('淘宝');
          await new_page.waitFor(1000);
          let service_tb = await new_page.$('#J_tbExtra');
          if (service_tb) {
            text = await getCompet_Tba(new_page, id);
            //获取类目
            categoryid = await getCategoryid(new_page);
          } else {
            shopname = null;
            text = '商品不存在或已下架';
          }
        }
        console.log('本店的店铺', shopname);
        save_data.push({'shopname': shopname, 'id': id, 'url': detail_url, 'data': text});
        cid_list.push(categoryid);
        await new_page.waitFor(6000);
      }

    })
    console.log(cid_list);
    return [save_data, cid_list];
  } catch (e) {
    console.log(e.message);
    throw new Error('error cookies is loss');
  }
}


/**
 * 竞品为淘宝   链接 标题 付款人数 销量 价格区间 优惠券 评价数 淘金币 SKU 特色服务 付款方式 主图 缩略图
 * @param new_page
 * @returns {Promise<{}>}
 */
const getCompet_Tba = async (new_page, id) => {
  let data_tba = {};
  let pictures = [];
  let sku_prices = [];
  let price1 = '';
  let price2 = '';
  await new_page.waitFor(2000);
  let video_is = 0;   //判断是否有视频，保存视频
  let video = await new_page.$('video.lib-video');
  if(video){
    video_is = 1;
  }
  let title = await new_page.$('#J_Title > h3');
  if (title !== null) {
    title = await new_page.$eval('#J_Title > h3', ele => ele.innerText);
  }
  let price = '';
  price1 = await new_page.$('#J_PromoPriceNum')
  price2 = await new_page.$('.tb-rmb-num')
  if (price1 || price2) {
    if (price1) {
      price = await new_page.$eval('#J_PromoPriceNum', ele => ele.innerText);
    } else {
      price = await new_page.$eval('.tb-rmb-num', ele => ele.innerText);
    }
  } else {
    price = '';
  }
  let sale = await new_page.$('#J_SellCounter');
  if (sale !== null) {
    sale = await new_page.$eval('#J_SellCounter', ele => ele.innerText);
  }
  let pingjia = await new_page.$('#J_RateCounter');
  if (pingjia !== null) {
    pingjia = await new_page.$eval('#J_RateCounter', ele => ele.innerText);
  }
  await new_page.waitForSelector('.J_coin> strong');
  let coin = await new_page.$('.J_coin> strong');
  if (coin !== null) {
    coin = await new_page.$eval('.J_coin> strong', ele => ele.innerText);
  }
  let quan = await new_page.$$('.tb-coupon');
  if (quan !== null) {
    quan = await new_page.$$eval('.tb-coupon', element => element.map(ele => ele.innerText));
  }

  let mainpic = await new_page.$eval('#J_ImgBooth', el => el.src);     //主图800x800
  mainpic = mainpic.toString().match(/.*?.png_|.*?.jpg_/)+'800x800';

  let longpic = await new_page.$$eval('.tb-pic> a > img', element => element.map(ele => ele['src']));
  //将缩略图放大750x1000
  await asyncForEach(longpic, async (item) => {
    let item_pic = item.match(/.*?.png_|.*?.jpg_/) + '750x1000';
    pictures.push(item_pic);
  })
  let service = await new_page.$$eval('#J_tbExtra > dl:nth-child(1) > dd > a', element => element.map(ele => ele.innerText));
  let pay = await new_page.$$eval('#J_tbExtra > dl:nth-child(2) > dd > a', element => element.map(ele => ele.innerText));

  //sku中商品不同的款式和价格
  await new_page.waitFor(1000);
  let sku_items = await new_page.$$('.J_Prop.tb-prop.J_Prop_Color> dd >.J_TSaleProp> li> a');

  await asyncForEach(sku_items, async (item) => {
    //判断a 元素存在   class="tb-out-of-stock" style="display: none;"
    let item_none = await item.boundingBox();
    if (item_none !== null) {
      let skus = {};
      await item.click();
      await new_page.waitFor(100);
      let sku_title = await new_page.$eval('.tb-selected > a > span', ele => ele.innerText)
      let sku_price = '';
      if (price1) {
        sku_price = await new_page.$eval('#J_PromoPriceNum', ele => ele.innerText);
      } else {
        sku_price = await new_page.$eval('.tb-rmb-num', ele => ele.innerText)
      }
      skus['title'] = sku_title;
      skus['price'] = sku_price;
      sku_prices.push(skus);
    }
  })

  //存储数据
  data_tba['title'] = title;
  data_tba['price'] = price;
  data_tba['salepeople'] = SALE_people[id]||''; //付款人数
  data_tba['salecount'] = sale;
  data_tba['pingjia'] = pingjia;
  data_tba['coin'] = coin;
  data_tba['quan'] = quan;
  data_tba['video_is'] = video_is;
  data_tba['mainpic'] = mainpic;
  data_tba['pictures'] = pictures;
  data_tba['service'] = service;
  data_tba['pay'] = pay;
  data_tba['sku_prices'] = sku_prices;
  console.log(data_tba);
  return data_tba;
}


/**
 * 竞品为天猫   链接 标题 付款人数 销量 价格区间  SKU 特色服务 付款方式 主图 缩略图
 * @param new_page
 * @returns {Promise<{}>}
 */
const getCompet_Tma = async (new_page, id) => {
  let data_tma = {};
  let pictures = [];
  let sku_prices = [];
  await new_page.waitFor(1000);
  //判断元素是否为存在,不存在则为空
  let video_is = 0;   //判断是否有视频，保存视频
  let video_src = null;
  let video = await new_page.$('video.lib-video');
  if(video){
    video_is = 1;
    video_src = await new_page.$eval('video.lib-video>source',  el => el.src);
  }
  let title = await new_page.$('.tb-detail-hd > h1');
  if (title !== null) {
    title = await new_page.$eval('.tb-detail-hd > h1', ele => ele.innerText);
  }
  let price = await new_page.$('.tm-promo-price >.tm-price');
  if (price !== null) {
    price = await new_page.$eval('.tm-promo-price >.tm-price', ele => ele.innerText);
  }
  let sale = await new_page.$('.tm-ind-sellCount > div >.tm-count');
  if (sale !== null) {
    sale = await new_page.$eval('.tm-ind-sellCount > div >.tm-count', ele => ele.innerText);
  }
  await new_page.waitForSelector('.tm-ind-reviewCount > div >.tm-count');
  let pingjia = await new_page.$('.tm-ind-reviewCount > div >.tm-count');
  if (pingjia !== null) {
    pingjia = await new_page.$eval('.tm-ind-reviewCount > div >.tm-count', ele => ele.innerText);
  }

  let mainpic = await new_page.$eval('#J_ImgBooth', el => el.src);      //主图800x800
  mainpic = mainpic.toString().match(/.*?.png_|.*?.jpg_/)+'800x800';

  let longpic = await new_page.$$eval('#J_UlThumb > li > a > img', element => element.map(ele => ele['src']));
  //将缩略图放大750x1000
  await asyncForEach(longpic, async (item) => {
    let item_pic = item.match(/.*?.png_|.*?.jpg_/) + '750x1000';
    pictures.push(item_pic);
  })
  let service = await new_page.$$eval('.tm-laysku-dd > ul > li > a', element => element.map(ele => ele.innerText));
  let pay = await new_page.$$eval('.pay-credit > a', element => element.map(ele => ele.innerText));
  //sku中商品不同的款式和价格
  await new_page.waitFor(1000);
  let sku_items = await new_page.$$('.tm-img-prop>dd>.J_TSaleProp>li>a');
  await asyncForEach(sku_items, async (item) => {
    //判断a元素不存在  class="tb-out-of-stock" style="display: none;",返回null
    let item_none = await item.boundingBox();
    if (item_none !== null) {
      let skus = {};
      await item.click();
      await new_page.waitFor(20);
      let sku_title = await new_page.$eval('.tb-selected > a > span', ele => ele.innerText)
      let sku_price = await new_page.$eval('#J_PromoPrice > dd > div > span', ele => ele.innerText);
      skus['title'] = sku_title;
      skus['price'] = sku_price;
      sku_prices.push(skus);
    }
  })

  //存储数据
  data_tma['title'] = title;
  data_tma['price'] = price;
  data_tma['salepeople'] = SALE_people[id]||''; //付款人数
  data_tma['salecount'] = sale;
  data_tma['pingjia'] = pingjia;
  data_tma['video_is'] = video_is;
  data_tma['video'] = video_src;
  data_tma['mainpic'] = mainpic;
  data_tma['pictures'] = pictures;
  data_tma['service'] = service;
  data_tma['pay'] = pay;
  data_tma['sku_prices'] = sku_prices;
  console.log(data_tma);
  return data_tma;
}

//获取子类目
const getCategoryid = async (new_page) => {
  const shop_config = await new_page.evaluate(() => window.g_config);
  let categoryid = 0;
  if (shop_config) {
    if (shop_config.hasOwnProperty('categoryId')) {       // 天猫店
      categoryid = await getCategory(shop_config['categoryId']);
    } else {
      if (shop_config.hasOwnProperty('idata')) {
        categoryid = await getCategory(shop_config['idata']['item']['cid']);
      }
    }
  }
  return categoryid;
}
/**
 *  根据cid 获取类目名称
 * @param cid               类目id
 * @returns {Promise<*>}    类目名称
 */
const getCategory = async (cid) => {
  let cidorg = {};
  let db = await mongoQuery();
  let category = await db.collection('goods_category_data').find({cid: parseInt(cid)}).toArray();
  if (category.length > 0) {
    cidorg[category[0]['cid']] = category[0]['name'];
    return cidorg;
  } else {
    return '';
  }
};

// 添加一条数据到mongo
const saveTba_Data = async (save_data, mongo_id) => {
  // 存入数据
  let db = await mongoQuery();
  await db.collection('report.yunying_report_data').updateOne({mongo_id: mongo_id}, {$set: {competitive_tba: save_data}});
  console.log('详情页存入数据库ok');
};

// 添加一条数据到mongo
const saveWords_Data = async (save_data, mongo_id) => {
  // 存入数据
  let db = await mongoQuery();
  await db.collection('report.yunying_report_data').updateOne({mongo_id: mongo_id}, {$set: {hotsearch_words: save_data}});
  console.log('搜索词存入数据库ok');
};

/**
 * 进入生意参谋页面 ->市场->搜索排行->      7天TOP100热搜词
 * @param page
 * @param wangwang
 * @param cidlist             行业三级类目
 * @param browser
 * @returns {Promise<*[]>}       热搜词结果
 */
const getHotSearch_Cate = async (page, wangwang, cidlist, browser) => {
  let token = '';
  let suberr = 0;
  let search_data = '';
  //从数据库里查找关键词
  let keyword = await getKeyWord(wangwang);
  page.on('response', async (response) => {
    if (response.url().indexOf('_____tmd_____/punish') !== -1) {
      await page.waitFor(3000);
      console.log('出现滑块');
      await browser.close();
    }
    //获取token
    if (response.url().indexOf('sycm.taobao.com/custom/menu/getPersonalView.json') !== -1) {
      token = await getUrlParams(response.url(), 'token');
    }
  });
  // 进入后台
  const homeUrl = 'https://sycm.taobao.com/mc/ci/item/analysis?';
  await page.goto(homeUrl, {waitUntil: 'networkidle2'});
  if (page.url().indexOf('custom/login.htm') !== -1 || page.url().indexOf('custom/no_permission') !== -1 || suberr === 1) {
    console.error('Cookie过期或生意参谋未授权');
    throw new Error('error cookies is loss');
  } else {
    //7天 TOP100热搜词
    //part1
    search_data = await getHotSearch_Words(page, token, wangwang, cidlist);
    //part2
    //search_data = await getHotSearch(page,token,keyword)
  }
  return search_data;

}
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
/**
 *  生意参谋-> 市场-> 搜索排行->TOP100热搜词和子类目 time：7天
 * @param page
 * @param token
 * @param wangwang
 * @param cidlist   行业三级类目
 */
const getHotSearch_Words = async (page, token, wangwang, cidlist) => {
  let cid_list = unique(cidlist);     //子类目删去重复
  console.log(cid_list);
  let search_data = {};
  let start_date = dateFormat(new Date().getTime() - 7 * 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  let end_date = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  await asyncForEach(cid_list, async (item) => {
    if(item){
      let item_id = Object.keys(item);
      let item_name = Object.values(item);
      console.log(item_id, '\n', item_name);
      let url = 'https://sycm.taobao.com/mc/industry/searchWord.json?dateRange=' + start_date + '%7C' + end_date +
          '&dateType=recent7&order=desc&orderBy=seIpvUvHits&cateId=' + item_id + '&device=0&token=' + token;
      console.log(url);
      let respon = await sendReauest_HotWords(page, url);
      search_data[item_name] = sycmEnc(respon['data']);
    }
  })
  return search_data;
}
//part 2            生意参谋->市场->搜索分析->   关键词+top100      time:7天
const getHotSearch = async (page, token, keyword) => {
  let result = {};
  let start_date = dateFormat(new Date().getTime() - 7 * 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
  let end_date = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');

  await asyncForEach(keyword, async (word) => {
    let url = 'https://sycm.taobao.com/mc/searchword/relatedWord.json?dateRange=' + start_date + '%7C' + end_date
        + '&dateType=recent7&pageSize=100&page=1&order=desc&orderBy=seIpvUvHits&keyword=' + word
        + '&device=0&indexCode=seIpvUvHits%2CsePvIndex%2CclickRate%2CclickHits%2CpayConvRate&token=' + token;
    let respon = await sendReauest_HotWords(page, url);
    let search_data = sycmEnc(respon['data']);
    result[word] = search_data.slice(0, 100);  //前100个元素
  })
  console.log(result);
  return result;
}

/**
 * 子类目去重复
 * @param uniqueArr
 * @returns {*}
 */
function unique(uniqueArr) {
  let has = {};
  return uniqueArr.reduce(function (arr, item) {
    !has[Object.keys(item)] && (has[Object.keys(item)] = true && arr.push(item));
    return arr;
  }, []);
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
//创建浏览器
const setBrowser = async () => {
  return await puppeteer.launch({
    headless: config.headless,
    dumpio: true,              //打开页面后卡住
    args: [
      "--unlimited-storage",
      "--full-memory-crash-report",
      "--disable-gpu",
      "--disable-setuid-sandbox",
      "--force-device-scale-factor",
      "--ignore-certificate-errors",
      "--no-sandbox",
      "--window-size=1376,1376"
    ],
    ignoreDefaultArgs: ["--enable-automation"]
  });
}
//热搜词
const sendReauest_HotWords = async (page, url) => {
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
      //'referer': 'https://sycm.taobao.com/mc/mq/search_rank?'
    };
    const response = await fetch(url, {headers: headers});
    return await response.json();
  }, url, transit_id);
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