const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs} = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const moment = require('moment');
const https = require('https');

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
    page.setDefaultTimeout(50000);
    page.setDefaultNavigationTimeout(50000);

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


/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest = async (page,url)=>{
    let reponse = await page.evaluate(async (url) => {
        let headers = {
            'sec-fetch-mode':'cors',
            'sec-fetch-site':'same-origin',
            'sec-fetch-dest':'empty',
            'content-type':'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url, {headers:headers});
        return await response.json();
    },url);
    return reponse;
};

/**
 * 存储 活动 数据
 * @param save_data
 * @param wangwang
 * @returns {Promise<void>}
 */
const saveActivityData = async(save_data, wangwang) => {
    let today = moment(new Date()).format("YYYY-MM-DD");
    let data = {
        data:save_data,
        created_at:new Date(),
        updated_at:new Date(),
        crawl_date:today,
        nick_name: wangwang
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('yunying.activity_data').deleteMany({'nick_name': wangwang, 'crawl_date':today});
    await db.collection('yunying.activity_data').insertOne(data);
    console.log(wangwang + ' 活动数据 -- 插入成功')
};

/**
 * 存储优惠券数据
 * @param save_data
 * @param wangwang
 * @returns {Promise<void>}
 */
const saveCouponData = async(save_data, wangwang) => {
    let today = moment(new Date()).format("YYYY-MM-DD");
    let data = {
        data:save_data,
        created_at:new Date(),
        updated_at:new Date(),
        crawl_date:today,
        nick_name: wangwang
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('yunying.coupon_data').deleteMany({'nick_name': wangwang, 'crawl_date':today});
    await db.collection('yunying.coupon_data').insertOne(data);
    console.log(wangwang + ' 优惠券数据 -- 插入成功')
};


/**
 * 存储 软件数据
 * @param save_data
 * @param wangwang
 * @returns {Promise<void>}
 */
const saveServiceData = async(save_data, wangwang) => {
    let today = moment(new Date()).format("YYYY-MM-DD");
    let data = {
        data:save_data,
        created_at:new Date(),
        updated_at:new Date(),
        crawl_date:today,
        nick_name: wangwang
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('yunying.service_data').deleteMany({'nick_name': wangwang, 'crawl_date':today});
    await db.collection('yunying.service_data').insertOne(data);
    console.log(wangwang + ' 软件服务数据 -- 插入成功')
};

/**
 * 发送邮件
 * @param type
 * @param crawl_date
 * @returns {Promise<void>}
 */
const sendMail = async(type, crawl_date) => {
    const mail_url = config.yunying_mail_url + type + '/' + crawl_date;
    console.log('send mail-------------');
    await https.get(mail_url, function(res) {
        console.log("邮件发送结果 " + res.statusCode);
        process.exit()
    }).on('error', function(e) {
        console.log("邮件发送错误: " + e.message);
        process.exit()
    });
};

module.exports = { getBrowser, getPage, sendReauest, saveActivityData, saveCouponData, saveServiceData, sendMail };
