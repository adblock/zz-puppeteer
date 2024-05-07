/**
 * 生意參謀 交易数据爬虫的计划任务 （可以 传入某个店铺 和 日期 获取补抓）
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getAllShopBoss,getUrlParams} = require('../commons/func');
const dateFormat = require('dateformat');
const { mysqlCfgSql,mongoQuery } = require('../commons/db');
const { canmouJiaoyi } = require('../model/canmouJiaoyi');
const { getYunyingAccount } = require('../commons/account');
const moment = require('moment');
const { connection } = require('../commons/MysqlOrm');

process.setMaxListeners(999999999);

const G_NUM = config.tuijian_spider_concurrency; // 浏览器的启动数量
let G_BROWSER_LIST = []; // 浏览器列表
let G_SHOP_LIST = []; // 店铺列表
let G_END_SHOP_HASH = {}; // 请求结束的店铺
let G_SHOP_LIST_ORG = []; // 原始的店铺列表
// let G_CRAWL_DATE_ARRAY = []; // 抓取数据的时间数组

const startCrawl = async (shop, orgBrowser) => {
    try {
        console.log('\n');
        console.log(shop)
        let wangwang = shop[0].wangwang;
        let browserWSEndpoint = orgBrowser.ws;
        const browser = await puppeteer.connect({browserWSEndpoint});
        const page = await setCookie(browser, wangwang);

        // 打开生意参谋首页
        const homeUrl = 'https://sycm.taobao.com/portal/home.htm';
        await page.goto(homeUrl, {
            waitUntil: 'networkidle2',
        });
        let h4 = await page.$eval('h4', node => node.innerText)
        console.log(h4)

        //如果首页有实时概况则表示生意参谋已授权
        if(h4 === '实时概况'){
            // 拦截销售分析实时数据请求
            await getEverydayData(browser, page, shop)

        }else if(h4 === '官方动态') {
            //如果有官方动态则表示Cookie过期
            console.error('Cookie过期')
            // 重新启动
            await addShopToEndList(wangwang);
            await setBrowser();
            await assign();
            browser.close()
        }else{
            //生意参谋未授权
            console.error('生意参谋未授权')
            // 重新启动
            await addShopToEndList(wangwang);
            await setBrowser();
            await assign();
            browser.close()
        }
    }catch (e) {
        console.log(e);
    }
};

async function getEverydayData(browser, page, shop) {
    if(shop.length > 0){
        let wangwang = shop[0].wangwang;
        //获取店铺主推辅推产品id
        const sql = "select f_itemId,f_type from t_sycm_zhutui_futui where f_wangwangid='" + wangwang + "'";
        const zhutui_futui = await mysqlCfgSql(config.mysql_zhizuan, sql);

        let product_count = 0;
        if (zhutui_futui.length === 0){
            console.log(wangwang+'未设置主推辅推产品')
            // 重新启动
            await addShopToEndList(wangwang);
            await setBrowser();
            await assign();
            browser.close()
        }else{
            product_count = zhutui_futui.length;
        }

        let i = 1;

        let shop_info = shop.shift();
        await asyncForEach(zhutui_futui, async (value, index) => {
            if(i < product_count + 1){
                //循环访问主推辅推产品
                await getProducts(browser, page, shop_info, i, product_count, value, shop);
                i+=1
            }
        });
    }
}


async function getProducts(browser, page, shop, insert_count, product_count, zhutui_futui, shop_all) {
    let item_id = '';//产品id
    let insert_data = {};//待写入数据
    let wangwang = shop.wangwang;
    let crawl_date = shop.crawl_date;
    let product_type = zhutui_futui.f_type; // 主推副推类型
    item_id = zhutui_futui.f_itemId;
    let token = '';

    await page.on('response', async (response) => {
        //获取cookie
        if (response.url().indexOf('menu/getPersonalView.json?') > -1) {
            token = response.url().match(/token=(\S+)/);
        }
    });
    console.log(token);
    // 进入后台
    let url = 'https://sycm.taobao.com/cc/item_archives?';
    await page.goto(url, {waitUntil: "networkidle2"});

    //访问销售分析页面， 存入两条数据
    insert_data['sales_analysis'] = await getSaleAnalysis(page, token, crawl_date, item_id);
    //访问流量来源页面
    insert_data['traffic_source'] = await getFlowSource(page, token, crawl_date, item_id);

    //存数据
    const preDate = await moment(crawl_date);
    await saveMongo(insert_data, wangwang, preDate, product_type, item_id);
    await saveMysql(insert_data, wangwang, dateFormat(preDate, "yyyy-mm-dd"), product_type, item_id);

    //同一店铺写入数据次数等于主推辅推产品数则表示该店爬完
    if (insert_count === product_count) {
        if (shop_all.length === 0) {
            // 重新启动
            await addShopToEndList(wangwang);
            await setBrowser();
            await assign();
            browser.close()
        } else {
            await getEverydayData(browser, page, shop_all)
        }
    }

}

//销售分析数据
const getSaleAnalysis = async(page, token,crawl_date,item_id)=>{
    let overview_data;
    let url = 'https://sycm.taobao.com/cc/item/sale/overview.json?dateType=day&dateRange='+crawl_date+'%7C'+crawl_date+'&device=0&itemId='+item_id+'&'+token;
    let overview = await sendReauest(page, url);
    if(overview['data']){
        overview_data = overview['data'];
    }
    console.log(crawl_date,'销售分析数据ok');
    return overview_data;
}

//流量来源数据
const getFlowSource = async(page, token,crawl_date,item_id)=>{
    let cc_data;
    let url = 'https://sycm.taobao.com/flow/v4/item/source/cc.json?dateType=day&dateRange='+crawl_date+'%7C'+crawl_date+'&device=2&belong=all&crowdType=all&itemId='+item_id+'&page=1&order=desc&orderBy=uv&'+token;
    let resp = await sendReauest(page, url);
    if(resp['data']){
        cc_data = resp['data'];
    }
    console.log(crawl_date,'流量来源数据ok');
    return cc_data;
}




// 存储数据到mongo
const saveMongo = async (save_data, wangwang_id, preDate, product_type, item_id) => {
    let data = {
        data: save_data,
        created_at: new Date(),
        updated_at: new Date(),
        date: dateFormat(preDate, "yyyy-mm-dd"),
        wangwang_id: wangwang_id,
        product_type: product_type,
        f_itemId: item_id
    };

    let db = await mongoQuery();
    // 删除对应当日数据
    await db.collection('canmou.zhutui_futui').deleteMany({
        date:dateFormat(preDate, "yyyy-mm-dd"),
        wangwang_id:wangwang_id,
        product_type:product_type,
        f_itemId:item_id,
    });
    // 存入数据
    await db.collection('canmou.zhutui_futui').insertOne(data);
}


//存储数据到mysql
const saveMysql = async(detail, wangwang, crawl_date, product_type, item_id) => {
    const conn = await connection(config.mysql_zhizuan);

    // 先删除数据
    let sql_del = "delete from t_sycm_zhutui_futui_detail where f_date = '" + crawl_date + "' and f_wangwangid = '" + wangwang + "'" + " and f_type = '" + product_type + "' and f_itemId= '" + item_id + "'";
    await mysqlCfgSql(config.mysql_zhizuan, sql_del);
    let detailObj = {};
    try{
        let now = moment().format("YYYY-MM-DD HH:mm:ss")
        detailObj['created_at'] = now;
        detailObj['updated_at'] = now;
        detailObj['f_wangwangid'] = wangwang;
        detailObj['f_type'] = product_type;
        detailObj['f_itemId'] = item_id;
        detailObj['f_date'] = crawl_date;
        if(detail.sales_analysis != null && Object.keys(detail.sales_analysis).length > 0){
            if(detail.sales_analysis.hasOwnProperty('itmUv')){
                detailObj['itmUv'] = detail.sales_analysis.itmUv.value;
                detailObj['payAmt'] = detail.sales_analysis.payAmt.value;
                detailObj['payItmCnt'] = detail.sales_analysis.payItmCnt.value;
                detailObj['itemCartCnt'] = detail.sales_analysis.itemCartCnt.value;
                detailObj['payRate'] = Number((detail.sales_analysis.payRate.value)*100).toFixed(2);
                detailObj['salesPayByrCnt'] = detail.sales_analysis.payByrCnt.value;
            }
        }

        if(detail.traffic_source != null && Object.keys(detail.traffic_source).length > 0){
            await asyncForEach(detail.traffic_source['item'], async (value, index) => {
                if(value.pageName.value === '手淘搜索'){
                    detailObj['jpUv'] = value.uv.value;
                    detailObj['payByrCnt'] = value.payByrCnt.value;
                    detailObj['searchPayRate'] = Number((value.payRate.value)*100).toFixed(2);
                }

                if(value.pageName.value === '直通车'){
                    detailObj['pv'] = value.pv.value;
                    detailObj['ztcUv'] = value.uv.value;
                    detailObj['ztcPayByrCnt'] = value.payByrCnt.value;
                    detailObj['ztcPayRate'] = Number((value.payRate.value)*100).toFixed(2);
                }
                if(value.pageName.value === '超级推荐'){
                    detailObj['cjtjUv'] = value.uv.value;
                    detailObj['cjtjPayByrCnt'] = value.payByrCnt.value;
                    detailObj['cjtjPayRate'] = Number((value.payRate.value)*100).toFixed(2);
                }
                if(value.pageName.value === '手淘推荐'){
                    detailObj['sttjUv'] = value.uv.value;
                    detailObj['sttjPayByrCnt'] = value.payByrCnt.value;
                    detailObj['sttjPayRate'] = Number((value.payRate.value)*100).toFixed(2);
                }
                if(value.pageName.value === '智钻'){
                    detailObj['zzUv'] = value.uv.value;
                    detailObj['zzPayByrCnt'] = value.payByrCnt.value;
                    detailObj['zzPayRate'] = Number((value.payRate.value)*100).toFixed(2);
                }
            });
        }

        // 插入数据
        const result = await conn.insert("t_sycm_zhutui_futui_detail", detailObj).execute();
        console.log(result)
    }catch (e) {
        console.error(e)
    }
}
//发送请求
const sendReauest = async (page, url) => {
    return await page.evaluate(async (url) => {
        let headers = {
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-dest': 'empty',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url, {headers: headers});
        return await response.json();
    }, url);
};


// 抓取数据结束
const endCrawl = async function() {
    console.log('end');
    console.log(Object.keys(G_END_SHOP_HASH).length, G_SHOP_LIST_ORG.length);
    if(Object.keys(G_END_SHOP_HASH).length === G_SHOP_LIST_ORG.length){
        console.log('店铺爬取完成');
        process.exit()
    }
};

const addShopToEndList = async (wangwang)=>{
    G_END_SHOP_HASH[wangwang] = true;
};

// 分配请求再请求
const assign  = async () => {
    const browserCount = G_BROWSER_LIST.length;
    for (let i = 0; i < browserCount; ++i) {
        //从列表获取一个店铺
        const shop = G_SHOP_LIST.shift();
        if(shop !== undefined){
            startCrawl(
                shop,
                G_BROWSER_LIST.pop()//从数组末尾取
            );
        }
    }
    await endCrawl();
};


// 赋值cookie
const setCookie = async (browser, wangwang)=>{
    let account = await getYunyingAccount(wangwang);
    // 关闭无用的page
    let pages = await browser.pages();
    for (let i = 0; i < pages.length; ++i) {
        if(i>0){
            await pages[i].close();
        }
    }

    let page = await setJs(await browser.newPage());

    page.setDefaultTimeout(50000);
    page.setDefaultNavigationTimeout(50000);
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
}

//创建浏览器
const setBrowser = async ()=>{
    const browser = await puppeteer.launch({
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

    G_BROWSER_LIST.push({
        ws:browser.wsEndpoint()
    });
}


//根据日期获取爬取的店铺
async function getDataByDate(crawl_date_all) {
    let shop_array = [];
    let zhutui_count = [];
    let zhutui_shop_count = [];
    let new_shop_lists = [];

    //获取当日已写入主推辅推产品详情
    const zhutui_futui_sql = "select f_wangwangid, f_itemId from t_sycm_zhutui_futui_detail where f_date='" + crawl_date_all +"'";
    const zhutui_futui = await mysqlCfgSql(config.mysql_zhizuan, zhutui_futui_sql);
    zhutui_count = await wangwangIdCount(zhutui_futui, 'f_itemId');

    //获取设置了主推辅推产品的 投放中店铺
    const zhutui_futui_shop = await getShopOnServer();
    zhutui_shop_count = await wangwangIdCount(zhutui_futui_shop, 'f_itemId');

    //取差集
    zhutui_futui_shop.forEach((element , index)=> {
        if(zhutui_count[element.f_itemId] !== zhutui_shop_count[element.f_itemId]) {
            shop_array.push(element.f_wangwangid)
        }
    });

    for(let shop of await unique(shop_array)){
        const account = await getYunyingAccount(shop);
        if (account) {
            new_shop_lists.push([{
                wangwang:shop,
                retry:0,
                crawl_date: crawl_date_all,
            }]);
        }
    }

    if (new_shop_lists.length>0){
        G_SHOP_LIST = JSON.parse(JSON.stringify(new_shop_lists));
        G_SHOP_LIST_ORG = JSON.parse(JSON.stringify(new_shop_lists));
    }
}

// 获取设置了主推辅推产品的 投放中店铺
async function getShopOnServer() {
    const all_shop = await getAllShopBoss();
    let shops_str = '';
    for(let shop of all_shop){
        shops_str += "'" + shop['f_copy_wangwangid'] + "',"
    }
    const zhutui_futui_shop_sql = "select f_wangwangid, f_itemId from t_sycm_zhutui_futui where f_wangwangid in (" +
                                   shops_str.substring(0, shops_str.length-1) + ");";

    return await mysqlCfgSql(config.mysql_zhizuan, zhutui_futui_shop_sql);
}


//根据wangwangid获取爬取的店铺
async function getDataByWangwangid(wangwangid) {
    let new_shop_lists = [];
    const account = await getYunyingAccount(wangwangid);
    const day = dateFormat(new Date(new Date().getTime() - 24*60*60*1000), 'dd');
    const mouth = dateFormat(new Date(new Date().getTime() - 24*60*60*1000), 'yyyy-mm');    // 本月

    if(account){
        //获取店铺的主推辅推产品
        const zhutui_futui_shop_sql = "select f_itemId from t_sycm_zhutui_futui where f_wangwangid='" + wangwangid +"'";
        const zhutui_futui_shop = await mysqlCfgSql(config.mysql_zhizuan, zhutui_futui_shop_sql);

        //获取已写入主推辅推产品详情
        let zhutui_futui_dict = {};
        for(let shop of zhutui_futui_shop){
            const zhutui_futui_sql = "select f_date from t_sycm_zhutui_futui_detail where f_date like'" + mouth + "%' and f_itemId='" + shop.f_itemId +"'";
            let zhutui_futui = await mysqlCfgSql(config.mysql_zhizuan, zhutui_futui_sql);
            let date_arr = [];
            for(let zhufu of zhutui_futui){
                date_arr.push(zhufu.f_date)
            }
            zhutui_futui_dict[shop.f_itemId] = date_arr
        }


        //获取当月没有写入的店铺对应的日期
        for(let i=1; i<=day; i++){
            const itemDate = mouth + '-' + ('0' + i).slice(-2);
            for(let shop of zhutui_futui_shop) {
                if (zhutui_futui_dict[shop.f_itemId].indexOf(itemDate) === -1) {
                    new_shop_lists.push({
                        wangwang: wangwangid,
                        retry: 0,
                        crawl_date: itemDate,
                    });
                    break
                }
            }
        }
    }
    if (new_shop_lists.length>0){
        G_SHOP_LIST.push(JSON.parse(JSON.stringify(new_shop_lists)));
        G_SHOP_LIST_ORG.push(JSON.parse(JSON.stringify(new_shop_lists)));
    }else{
        console.log(wangwangid+'：暂无需要爬取的数据');
    }
}

//获取当月全部店铺数据
async function getCanmouList() {
    let new_zhutui_futui_product = [];
    //获取设置了主推辅推产品的 投放中店铺
    const zhutui_futui_product = await getShopOnServer();

    zhutui_futui_product.forEach((element , index)=> {
        new_zhutui_futui_product.push(element.f_wangwangid)
    });

    await asyncForEach(await unique(new_zhutui_futui_product), async (value, index) => {

        await getDataByWangwangid(value)
    });
}

//获取每个wangwangId出现的次数
async function wangwangIdCount(data, key) {
    var map = {};
    var i = 0, len = data .length;
    //循环查找
    for (; i < len; i++) {
        //数组里的i个元素
        var v = data[i][key];
        //将数组的i个元素作为map对象的属性查看其属性值
        var counts = map[v];
        //如果map对象没有该属性，则设置该属性的值为1，有的话在其基础上再+1
        if (counts) {
            map[v] += 1;
        } else {
            map[v] = 1;
        }
    }
    return map;
}

//数组去重
async function unique(array){
    var temp = {}, r = [], len = array.length, val, type;
    for (var i = 0; i < len; i++) {
        val = array[i];
        type = typeof val;
        if (!temp[val]) {
            temp[val] = [type];
            r.push(val);
        } else if (temp[val].indexOf(type) < 0) {
            temp[val].push(type);
            r.push(val);
        }
    }
    return r;
}


(async () => {
    const args = process.argv.splice(2);
    if(args.length === 2){
        // 店铺和日期都输入
        G_SHOP_LIST.push([{
            wangwang:args[0],
            retry:0,
            crawl_date: args[1],
        }]);
        G_SHOP_LIST_ORG.push([{
            wangwang:args[0],
            retry:0
        }]);
    } else if (args.length === 1) {   // 只传一个参数
        // 判断传入的是日期还是店铺
        if(args[0].match(/^\d{4}-\d{1,2}-\d{1,2}$/)){
            await getDataByDate(args[0]);
        } else {
            await getDataByWangwangid(args[0]);
        }
    }else{
        await getCanmouList();//获取当月全部店铺数据
    }
    if (G_SHOP_LIST.length===0){
        console.log('暂无店铺需要爬取');
        process.exit()
    }

    // 生成N个常驻的浏览器
    for (i = 0; i < G_NUM; i++) {
        await setBrowser();
    }

    await assign();
})();