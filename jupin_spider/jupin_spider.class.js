const puppeteer = require('puppeteer');
const { asyncForEach, setJs } = require('../commons/func');
const { getCookiesInMongo } = require("../commons/account");
const { mongoInit } = require('../commons/db');

/**
 * 聚品的puppteer爬虫的通用逻辑类
 * */
class JupinSpider {
    constructor(option={
        'shopList':[], // 店铺列表
        'spider':undefined,
    }){
        this._mongo = {}; // mongo全局的链接
        this._browserList = []; // 浏览器列表
        this._endShopHash = {}; // 请求结束的店铺
        this._shopList = []; // 店铺列表
        this._shopListOrg = option.shopList; // 原始的店铺列表
        this._spider = option.spider; // 具体爬虫逻辑的实例
        this._browser= {}; // 浏览器实例
    }

    /**
    * 设置mongo的全局对象
    * */
    setMongo = async () => {
        // 全局的mongo链接
        this._mongo = await mongoInit();
    };

    /**
    *  设置店铺列表
    * */
    setShopList = async () => {
        if(this._shopListOrg.length > 0){
            this._shopListOrg.forEach(function (value) {
                this._shopList.push({
                    wangwang:value.f_copy_wangwangid,
                    retry:0
                });
            }, this);
        }
    };

    /**
    * 创建浏览器
    * */
    setBrowser = async () => {
        const browser = await puppeteer.launch({
            headless: false,
            args: [
                "--disable-gpu",
                "--disable-setuid-sandbox",
                "--force-device-scale-factor",
                "--ignore-certificate-errors",
                "--no-sandbox",
            ],
            slowMo:1000,
            ignoreDefaultArgs: ["--enable-automation"]
        });

        this._browserList.push({
            ws:browser.wsEndpoint()
        });
    };

    /**
    * 赋值cookies
    * */
    setPageCookie = async (browser, wangwang)=>{
        let account = await getCookiesInMongo(wangwang, this._mongo);
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
        const page = await setJs(pages[1]);
        page.setDefaultTimeout(600000);
        page.setDefaultNavigationTimeout(600000);
        page.setViewport({
            width: 1376,
            height: 1376
        });
        // 拦截静态文件请求
        await page.setRequestInterception(true);
        page.on('request',  request => {
            if(['image', 'font'].includes(request.resourceType())) {
                return request.abort();
            }
            return request.continue();
        });
        if(account && account.f_raw_cookies){
            // 赋予浏览器圣洁的cookie
            await asyncForEach(account.f_raw_cookies.sycmCookie, async (value, index) => {
                await page.deleteCookie(value);
                await page.setCookie(value);
            });
        }
        return page;
    };

    /**
    * 抓取数据结束
    * */
    endCrawl = async function() {
        console.log('end');
        console.log(Object.keys(this._endShopHash).length, this._shopListOrg.length);
        if(Object.keys(this._endShopHash).length === this._shopListOrg.length){
            // 关闭mongo链接
            await this._mongo.close();
            console.log('店铺爬取完成');
            if(this._spider.spiderName){
                if(this._spider.spiderName.indexOf('ReportAnalysisData') === -1){
                    process.exit()
                }
            } else {
                process.exit()
            }
        }
    };

    addShopToEndList = async (wangwang)=>{
        this._endShopHash[wangwang] = true;
    };

    /**
    * 获取一个浏览器
    * */
    getBrower = async () => {
        const orgBrowser = this._browserList.pop();
        const browserWSEndpoint = orgBrowser.ws;
        this._browser = await puppeteer.connect({browserWSEndpoint});
        return this._browser;
    };

    /**
    * 分配请求再请求
    * */
    assign  = async () => {
        await this.endCrawl();
        const browserCount = this._browserList.length;
        for(let i = 0; i < browserCount; i++){
            // 从列表获取一个店铺
            const shop = this._shopList.shift();
            if(shop !== undefined){
                console.log(shop);
                // 浏览器实例
                const browser = await this.getBrower();
                const page = await this.setPageCookie(browser, shop.wangwang);
                await this._spider.init({
                    'wangwang':shop.wangwang,
                    'page':page,
                    'mongo':this._mongo,
                    'nextRound':this.nextRound
                });
            }else {
                await this.endCrawl();
            }
        }
    };

    /**
    * 再来一轮
    * */
    nextRound = async (wangwang) => {
        await this.addShopToEndList(wangwang);
        await this._browser.close();
        await this.setBrowser();
        await this.assign();
    }

    /**
    * 启动的方法
    * */
    init = async () => {
     //   console.log(this._shopListOrg);
        await this.setMongo();
        await this.setShopList();
        await this.setBrowser();
        await this.assign();
    }
}

module.exports = { JupinSpider };
