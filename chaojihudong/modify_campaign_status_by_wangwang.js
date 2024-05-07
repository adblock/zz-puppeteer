/*
@File     ：modify_campaign_status_by_wangwang.py
@Author   ：qingyang
@Date     ：2021/8/9 10:04
@describe ：
*/
const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getBudgetShops, updateStatus} = require('../commons/func');
const {mongoQuery, mysqlCfgSql} = require('../commons/db');
const { getCookiesByMongo } = require("../commons/account");
const moment = require('moment');

const startCrawl = async(page, campaign_list) => {
    try {
        let token = '';
        let suberr = 1;
        // 拦截请求, 获取fetch需要的token等字段
        await page.setRequestInterception(true);
        page.on('request',  async(request) => {
            if(request.url().indexOf('isProtocolSigned.json') > -1) {
                let params = request.url().match(/&timeStr=(\S+)/);
                if(params.length > 0){
                    token = params[0];       // 获取token 等字段
                }
                return request.continue();
            } else {
                return request.continue();
            }
        });

        // 订阅 reponse 事件，参数是一个 reponse 实体
        await page.on('response', async (response) => {
            try {
                if (response.url().indexOf('https://chaojihudong.taobao.com/indexbp.html') !== -1) {
                    let text = await response.text();
                    if (text.indexOf('_____tmd_____/punish') !== -1) {
                        await page.waitFor(30000);
                        suberr = 0;
                    }
                }
            } catch (e) {
                if (
                      e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
                      e.message.indexOf('Session closed. Most likely the page has been closed') === -1
                ) {
                    console.log(111111111);
                    console.log(e.message);
                }
            }
        });
          // 进入后台
          await page.waitFor(1000 + Math.round(Math.random()) * 100);
          await page.goto('https://chaojihudong.taobao.com/indexbp.html', {waitUntil: "networkidle0"});
          //若cookie 失效，或有滑块，或一直加载状态，开始下一个店铺
          if (page.url().indexOf('https://chaojihudong.taobao.com/index.html') >-1 || page.url().indexOf('punish?x5secdata') > -1 || suberr === 0) {
            console.log('页面加载未完成');
          } else {
            if (token) {
              await modifyStatus(page, token, campaign_list);
            }
          }
        } catch (e) {
          if (
                  e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
                  e.message.indexOf('Session closed. Most likely the page has been closed') === -1
          ) {
            console.log(222222222);
            console.log(e.message);
          }
        }
};

/**
 * 获取计划数据
 * @param page
 * @param token
 * @param campaign_list
 * @returns {Promise<Array>}
 */
const modifyStatus = async(page, token, campaign_list) => {
    console.log(campaign_list)
    await asyncForEach(campaign_list, async(campaign) => {
        token = token.replace(/bizCode=(\S+)/, 'bizCode=interactiveLive');
        let campaign_id = campaign.f_campaign_id;
        let update_url = 'https://hudongcheng.taobao.com/api/campaign/batchModify.json?' + token;
        let from_data = {
                'campaignIdList': '[' +campaign_id+ ']',
                'status': 'pause'
            };
        console.log(from_data);
        let resp = await sendReauest(page, from_data, update_url);
        if(resp['info']['ok']){
            console.log('更新成功');
        } else {
            console.log('更新失败');
        }
    });
};

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param body
 * @param {String} url  请求的url
 * */
const sendReauest = async (page, body, url)=>{
    body = await parseDataToUrl(body);
    return await page.evaluate(async (body,url) => {
        let headers = {
            'sec-fetch-mode':'cors',
            'sec-fetch-site':'same-origin',
            'sec-fetch-dest':'empty',
            'content-type':'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url,
            {
                body:body,
                credentials: 'include',
                method: 'PUT',
                headers:headers,
            }
        );
        return await response.json();
    },body,url);
};

/**
 * 格式化数据得方法
 * @param {Object} data 数据
 * */
const parseDataToUrl = async (data)=>{
    return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
};

//创建浏览器
const setBrowser = async ()=>{
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

// 赋值cookie
const setCookie = async (browser, wangwang)=>{
    let account = await getCookiesByMongo(wangwang);
    // 关闭无用的page
    let pages = await browser.pages();
    await asyncForEach(pages,async function(page,index) {
        if(index>0){
            await page.close();
        }
    });
    await browser.newPage();
    pages = await browser.pages();
    // page配置js
    page = await setJs(pages[1]);
    page.setDefaultTimeout(90000);
    page.setDefaultNavigationTimeout(90000);
    page.setViewport({
        width: 1376,
        height: 1376
    });
    if(account && account.f_raw_cookies){
        // 赋予浏览器圣洁的cookie
        await asyncForEach(account.f_raw_cookies.sycmCookie, async (value, index) => {
            await page.setCookie(value);
        });
    }
    return page;
};

const modifyCampaignStatus = async(wangwang)=>{
    try {
        console.log(wangwang);
        let now = moment().format('HH:mm:ss');
        let sqls = "select * from t_automatic_operation_spider where f_type='chaohu' and f_end < '" + now + "%' and f_wangwang='" + wangwang + "';";
        console.log(sqls);
        let campaign_list = await mysqlCfgSql(config.mysql_zhizuan, sqls);
        campaign_list = Object.values(campaign_list);
        if(campaign_list.length > 0){
            let browser = await setBrowser();     // 设置浏览器
            let page = await setCookie(browser, wangwang);
            await startCrawl(page, campaign_list);
            await browser.close();
        }
    } catch (e) {
        console.log(e);
    }
};

module.exports = { modifyCampaignStatus };