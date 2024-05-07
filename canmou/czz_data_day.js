const puppeteer = require('puppeteer');
const { getCookiesByMongo } = require("../commons/account");
const { asyncForEach } = require("../commons/func");
const config = require('../config');
const { setJs } = require('../commons/func');
const { getYesterday } = require('../commons/dateFunc');
const { mongoQuery } = require('../commons/db');
const moment = require('moment');
const { connection } = require('../commons/MysqlOrm');

// 启动登录
const startServer = async (account, crawl_date) => {
    if(!crawl_date){
        crawl_date = await getYesterday();
    }
    const now = new Date();
    const data = {'date': crawl_date, 'wangwang': account.wangwang_id, 'created_at': now, 'updated_at': now};
    const browser = await puppeteer.launch({
        headless: config.headless,
        args: [
            '--no-sandbox',
        ],
        ignoreDefaultArgs: ["--enable-automation"]
    });
    const page = await setJs(await browser.newPage());
    page.setViewport({
        width: 1376,
        height: 1376
    });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    // 赋予浏览器圣洁的cookie
    const f_raw_cookies = account.f_raw_cookies;
    if(f_raw_cookies !== null || f_raw_cookies!==[]){
        if (f_raw_cookies.hasOwnProperty('sycmCookie')) {
            await asyncForEach(f_raw_cookies.sycmCookie, async (value, index) => {
                await page.setCookie(value);
            });
        }
    }
    console.log(account.wangwang_id);

    // 拦截请求
    await page.setRequestInterception(true);
    await page.on('request', async(request)=>{
        if(request.url().indexOf('report/rptBpp4pCustomSum.htm') > -1){     // 拦截直通车接口，返回昨日数据
            const url = request.url().replace(/startDate=(\d{4}-\d{1,2}-\d{1,2})/, 'startDate='+crawl_date).
                                      replace(/endDate=(\d{4}-\d{1,2}-\d{1,2})/, 'endDate='+crawl_date);
            console.log(url)
            await request.continue({'url':url});
        } else if((request.url().indexOf('https://zuanshi.taobao.com/api/report/account/findDaySum.json') >- 1
            && request.url().endsWith('bizCode=zszw')) || (request.url().indexOf('api/account/report/findDaySum') > -1)){
            const url = request.url().replace(/startTime=(\d{4}-\d{1,2}-\d{1,2})/, 'startTime='+crawl_date).
                                      replace(/endTime=(\d{4}-\d{1,2}-\d{1,2})/, 'endTime='+crawl_date);
            console.log(url)
            await request.continue({'url':url});
        }else if(['image', 'font'].includes(request.resourceType())) {
            return request.abort();
        }
        else {
            request.continue({});
        }



    });


    // 监听response
    await page.on('response',
        async (response) => {
            try {
                if(response.url().indexOf('api/report/account/findDaySum.json')>-1 && response.url().endsWith('bizCode=zszw')){
                    const resp = await response.json();
                    // console.log(resp['data']['list'])
                    if(!data.hasOwnProperty('zz')){
                        data.zz = resp;
                        console.log('zz data success')
                    }
                }
                if(response.url().indexOf('report/rptBpp4pCustomSum.htm')>-1){
                    const resp = await response.json();
                    // console.log(resp['result']['list'])
                    if(!data.hasOwnProperty('ztc')){
                        data.ztc = resp;
                        console.log('ztc data success')
                    }
                }
                if(response.url().indexOf('api/account/report/findDaySum')>-1){
                    const resp = await response.json();
                    // console.log(resp['data']['list'])
                    if(!data.hasOwnProperty('cjtj')){
                        data.cjtj = resp;
                        console.log('cjtj data success')
                    }
                }
                if(response.url().indexOf('getLoginStatus.htm')>-1){
                    console.log('login fail.....');
                    process.exit()
                }
            } catch (err) {
                console.log(err);
                process.exit();
            }
        });

    // 直通车报表 页面
    const ztc_url = 'https://subway.simba.taobao.com';  // 直通车直接跳转报表页面不行，先跳转到直通车推广页面
    const resp = await page.goto(ztc_url, {waitUntil:'networkidle2'});

    const ztc_report_url = 'https://subway.simba.taobao.com/#!/report/bpreport/index';
    await page.goto(ztc_report_url, {waitUntil:'networkidle0'});
    await page.waitFor(3000);


    // 钻展报表页面
    const zz_report_url = 'https://zuanshi.taobao.com/index_poquan.jsp?file=index_poquan.jsp#!/report/whole';
    await page.goto(zz_report_url, {waitUntil:'networkidle0'});
    await page.waitFor(3000);

    // 超级推荐报表页面
    const cjtj_report_url = 'https://tuijian.taobao.com/indexbp-feedflow.html?#!/report/whole/index?alias=all&perspective=report';
    await page.goto(cjtj_report_url, {waitUntil:'networkidle0'});
    await page.waitFor(3000);

    console.log(data)
    await saveData(data)

};

const saveData = async(data)=>{
    let db = await mongoQuery();
    const wangwang = data['wangwang'];
    const date = data['date'];
    let now = moment().format("YYYY-MM-DD HH:mm:ss");
    await db.collection('yunying_czz_data_day').deleteOne({'date': date, 'wangwang':wangwang});
    await db.collection('yunying_czz_data_day').insertOne(data);

    const conn = await connection(config.mysql_zhizuan);

    const mysql_data = {'f_shop': wangwang, 'f_date': date, 'created_at':now, 'updated_at':now};
    if('ztc' in data){
        const list = data['ztc']['result']['list'];
        if(list[0]){
            mysql_data['f_ztc_charge'] = list[0]['cost'];
            mysql_data['f_ztc_uv'] = list[0]['click'];
            mysql_data['f_ztc_payCount'] = list[0]['transactionshippingtotal'];
        }
    }
    if('zz' in data){
        const list = data['zz']['data']['list'];
        if(list[0]){
            mysql_data['f_zz_charge'] = list[0]['charge'];
            mysql_data['f_zz_uv'] = list[0]['uv'];
            mysql_data['f_zz_payCount'] = list[0]['alipayInShopNum'];
        }
    }
    if('cjtj' in data){
        const list = data['cjtj']['data']['list'];
        if(list[0]){
            mysql_data['f_cjtj_charge'] = list[0]['charge'];
            mysql_data['f_cjtj_uv'] = list[0]['uv'];
            mysql_data['f_cjtj_payCount'] = list[0]['alipayInShopNum'];
        }
    }
    // 更新数据
    await conn.delete('t_yunying_czz_day').where('f_shop', wangwang).where('f_date', date).execute();
    const result = await conn.insert("t_yunying_czz_day", mysql_data).execute();
    console.log(result)
};

// 设置为那啥
process.setMaxListeners(0);
(async () => {
    // 第一个参数是账号id
    const args = process.argv.splice(2);
    const wangwang = args[0];
    let crawl_date = args[1];
    let account = await getCookiesByMongo(wangwang);
    await startServer(account, crawl_date).catch(async (err) => {
        console.error(err);
    });

    process.exit()
})();
