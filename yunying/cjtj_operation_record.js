/*
@File     ：cjtj_operation_record.py
@Author   ：qingyang
@Date     ：2021/9/28 09:59 
@describe ：运营超级推荐操作记录
*/

const puppeteer = require('puppeteer');
const moment = require('moment');
const { getBrowser, getPage, sendMail } = require('./yunying_commons');
const { getYunyingAccount } = require('../commons/account');
const { getAllShopBoss, asyncForEach, getHeader } = require('../commons/func');
const {mongoQuery} = require('../commons/db');


let G_CRAWL_DATE = '';    // 爬取日期
const startCrawl = async(shop, page) => {
  let token = ''; // 通用请求体
  await page.setRequestInterception(true);
  page.on('request',  async(request) => {
    if(request.url().indexOf('isProtocolSigned.json') > -1) {
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
  await page.goto('https://tuijian.taobao.com/indexbp-feedflow.html', {waitUntil: "networkidle0"});
  // 超级推荐 未登录处理
  if(page.url().indexOf('https://tuijian.taobao.com/index.html') > -1){
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
  console.log(token);
  let typeObj = {'104': 'creative', '107': 'target', '110': 'adzone', '102': 'campaign', '103': 'adgroup'};
  let save_data = {};
  for (let type in typeObj) {
    console.log(type);
    let oper_url = 'https://tuijian.taobao.com/api/log/findOperationLog.json?r=mx_1379&startTime=' + G_CRAWL_DATE
            + '&endTime=' + G_CRAWL_DATE + '&offset=0&pageSize=40&campaignId=&adgroupId=&entityType=' + type +
            '&page=1&entityTypes=%5B%22' + type + '%22%5D' + token;
    const operation = await sendReauest(page, oper_url);
    if(operation['data'].hasOwnProperty('list')){
        save_data[typeObj[type]] = operation;
    }
  }
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
        shop_no_login:''
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('yunying.cjtj_operation_record').deleteMany({$or:[{"shop_no_login":wangwang},{"shop_name":wangwang}], 'crawl_date':G_CRAWL_DATE});
    await db.collection('yunying.cjtj_operation_record').insertOne(data);
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
    await db.collection('yunying.cjtj_operation_record').deleteMany({$or:[{"shop_no_login":wangwang},{"shop_name":wangwang}], 'crawl_date':G_CRAWL_DATE});
    await db.collection('yunying.cjtj_operation_record').insertOne(data);
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
    await sendMail('yy_cjtj', G_CRAWL_DATE);
})();