const puppeteer = require('puppeteer');
const moment = require('moment');
const { getBrowser, getPage, sendMail } = require('./yunying_commons');
const { getAllShopBoss, asyncForEach } = require('../commons/func');
const { getYunyingAccount } = require('../commons/account');
const {mongoQuery} = require('../commons/db');


let G_CRAWL_DATE = '';    // 爬取日期

const startCrawl = async(shop, page) => {
    // 微淘页面（阿里创作平台）
    let we_url = 'https://we.taobao.com/creation/all?tab=all&subTab=all';   // 全部作品
    await page.goto(we_url, {waitUntil: 'networkidle0'});
    if(page.url().indexOf('login') > -1){
        console.log('cookie失效，登录失败');
        await saveNologinData(shop);
    } else {
        let merchant_url = 'https://we.taobao.com/merchant/list.json?tab=all&subTab=all&range=' + G_CRAWL_DATE + '...' + G_CRAWL_DATE + '&pageIndex=1';
        let resp = await getDetail(page, merchant_url, []);
        await saveData(shop, resp)
    }

};


const getDetail = async(page, merchant_url, save_data) => {
    let resp = await sendReauest(page, merchant_url);
    let data_source = resp['data']['components'][3]['props']['dataSource'];
    if(data_source.length > 0){
        save_data = save_data.concat(data_source);
        let curr_page = merchant_url.match(/pageIndex=(\d+)/)[1];
        let next_page = parseInt(curr_page) + 1;
        merchant_url = merchant_url.replace(/pageIndex=(\d+)/, 'pageIndex=' + next_page);
        return await getDetail(page, merchant_url, save_data)
    } else {
        return save_data;
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
 * 存储数据方法
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
    await db.collection('yunying.we_taobao').deleteMany({$or:[{"shop_no_login":wangwang},{"shop_name":wangwang}], 'crawl_date':G_CRAWL_DATE});
    await db.collection('yunying.we_taobao').insertOne(data);
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
    await db.collection('yunying.we_taobao').deleteMany({$or:[{"shop_no_login":wangwang},{"shop_name":wangwang}], 'crawl_date':G_CRAWL_DATE});
    await db.collection('yunying.we_taobao').insertOne(data);
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
    await sendMail('wetao', G_CRAWL_DATE);
})();