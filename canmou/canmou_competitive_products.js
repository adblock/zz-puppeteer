/**
 * 生意參謀 竞品数据爬虫的计划任务（可以 传入某个店铺 和 日期 获取补抓）
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getAllShopBoss,getUrlParams,getDataFromJsonp,sendReauest} = require('../commons/func');
const { getOneCookieByMongo, getCookiesByMongo } = require("../commons/account");
const { getYesterday } = require("../commons/dateFunc");
const { mysqlCfgSql } = require('../commons/db');
const moment = require('moment');
const { competitiveProducts } = require('../model/competitiveProducts');

process.setMaxListeners(999999999);

const G_NUM = config.tuijian_spider_concurrency; // 浏览器的启动数量
let G_BROWSER_LIST = []; // 浏览器列表
let G_SHOP_LIST = []; // 店铺列表
let GET_ONE = 1;//获取单店数据
let GET_MANY = 2;//获取多店数据
let MAX_PAGE_SIZE = 5;//最大爬取页码
let G_SELF_TYPE = [0, 4];// 本店商品类型（mysql）

/**
 * 开始运行爬虫
 * @param orgBrowser
 * @returns {Promise<void>}
 */
const startCrawl = async (orgBrowser) => {
    try {
        console.log('\n');
        let browserWSEndpoint = orgBrowser.ws;
        const browser = await puppeteer.connect({browserWSEndpoint});
        const page = await setCookie(browser);

        const homeUrl = 'https://s.taobao.com/search?q=';
        await page.goto(homeUrl, {waitUntil: 'networkidle0'});

        //如果跳登录页面则表示Cookie过期
        if(page.url().indexOf('member/login.jhtml') !== -1) {
            console.error('Cookie过期');
            await setBrowser();
            await assign();
            browser.close()
        }
        else{
            // 出现滑块
            let slider = false;
            const slider_page = await page.$('#nocaptcha');
            if(slider_page != null){
                slider = await page.$eval('#nocaptcha', (elem) => {
                    return window.getComputedStyle(elem).getPropertyValue('display') !== 'none' && elem.offsetHeight
                });
                if(slider !== false){
                    console.log('出现滑块块块块块块块块块块块块');
                    await setBrowser();
                    await assign();
                    browser.close()
                }
            } else {
                console.log('登录正常');
                //循环请求
                await getData(page, browser);
            }
        }
    }catch (e) {
        console.log(e);
    }
};

/**
 * 获取数据
 * @param page
 * @param browser
 * @returns {Promise<*|undefined>}       递归
 */
const getData  = async (page, browser) => {
    //从列表获取一个店铺
    let shop = G_SHOP_LIST.shift();
    const wangwang = shop.wangwang;
    console.log('\n');
    console.log(wangwang);

    //获取 竞品数据
    const competitive_products_sql = "select * from t_sycm_competitive_products where f_wangwangid='" + wangwang + "' order by f_type;";
    let competitive_products_shop = await mysqlCfgSql(config.mysql_zhizuan, competitive_products_sql);

    if(competitive_products_shop.length > 0){
        let insert_products_count = 0;//已写入的竞品数据个数
        let current_page = 1;//当前页码
        //获取竞品数据
        await getCompetitiveProducts(browser, page, competitive_products_shop, wangwang, [], insert_products_count, current_page);

    }else{
        console.error('竞品数据未设置')
    }

    //递归查询下一家店铺
    if(G_SHOP_LIST.length > 0){
        return getData(page, browser)
    }else{
        console.error('爬取完毕')
        process.exit()
    }
}

/**
 * 获取竞品数据
 * @param browser
 * @param page
 * @param competitive_products_shop     当前店铺的本店和竞品mysql查询的数据
 * @param wangwang                      当前店铺
 * @param product_array                 商品数组（存到mysql）
 * @param insert_products_count         已写入的竞品数据个数
 * @param current_page                  当前页码
 * @returns {Promise<*|undefined>}      递归
 */
const getCompetitiveProducts  = async (browser, page, competitive_products_shop, wangwang, product_array, insert_products_count, current_page) => {
    let competitive_products = {};//对应旺旺id的竞品数据
    let products_ids = [];//对应旺旺id的竞品itemId
    let keyword = '';//搜索的关键字
    let item_self = '';
    //筛选出该店铺的竞品信息
    competitive_products_shop.forEach(function (value) {
        if(G_SELF_TYPE.indexOf(value.f_type) > -1){ // 本店商品
            item_self = value.f_itemId;
        }
        competitive_products[value.f_itemId] = value;
        keyword = value.f_keyword;
        products_ids.push(value.f_itemId);
    });
    //拼接关键词查询宝贝
    const searchUrl = 'https://s.taobao.com/search?q=' + keyword + '&sort=sale-desc';
    await page.goto(searchUrl, {waitUntil: 'networkidle2'});

    let page_data = [];
    let product_array_not_matched = [];
    const page_size = (current_page - 1) * 44;

    // 出现滑块
    let slider = false;
    const slider_page = await page.$('#nocaptcha');
    if(slider_page != null){
        slider = await page.$eval('#nocaptcha', (elem) => {
            return window.getComputedStyle(elem).getPropertyValue('display') !== 'none' && elem.offsetHeight
        });
        if(slider !== false){
            console.log('滑块块块块块块块块块块块块');
            await addShopToShopList(wangwang);
            await setBrowser();
            await assign();
            browser.close()
        }
    }

    //页面随机滚动
    await page.evaluate(function () {
        for (var y = 0; y <= Math.floor(Math.random() * 5000); y += 100) {
            window.scrollTo(0, y)
        }
    });

    // 订阅 reponse 事件，参数是一个 reponse 实体
    await page.on('response',
        async (response) => {
            try {
                //弹框滑块及全屏滑块
                if(response.url().indexOf('punish?x5secdata')>-1 || response.url().indexOf('_____tmd_____/punish') !== -1){
                    console.log('滑块块块块块块块块块块块块');
                    await page.waitFor(3000);
                }
            }catch (e) {
                console.log(e);
                await addShopToShopList(wangwang);
                await setBrowser();
                await assign();
                browser.close()
            }
        });

    //如果是第一页则从js获取数据否则从接口获取数据
    if(current_page === 1){
        page_data = await page.evaluate(() => window.Search.get('app').userConfig.data.mods.itemlist.data.auctions);
    }
    else{
        const timestamp = Date.parse(new Date()) + '_1054';
        const s = page_size - 44;
        const initiative_id = 'staobaoz_'+ moment(new Date()).add(-1, 'days').format("YYYY-MM-DD");
        let list_url = 'https://s.taobao.com/search?data-key=s&data-value='+ page_size +'&ajax=true&_ksTS='+ timestamp +'&callback=jsonp1055&q='+ keyword +'&imgfile=&js=1&stats_click=search_radio_all%3A1&initiative_id='+ initiative_id +'&ie=utf-8&bcoffset=0&p4ppushleft=%2C44&ntoffset=21&style=grid&sort=sale-desc&s='+ s;
        console.log(list_url);

        const raw_data = await sendReauest(page, list_url);
        try {
           if(Object.keys(raw_data).length > 0){
                if(raw_data.mods.hasOwnProperty('itemlist') && raw_data.mods.itemlist.status === 'show'){
                    page_data = raw_data.mods.itemlist.data.auctions;
                }else{
                    console.log('数据获取有误')
                }
            }else{
                console.log('数据获取有误')
            }
        }catch (e) {
            console.error(e);
            console.error(raw_data);
            await addShopToShopList(wangwang);
            await setBrowser();
            await assign();
            browser.close()
        }
    }
    if(page_data.length > 0){
        let sycm_page = await setCookie(browser, wangwang);
        await asyncForEach(page_data, async (value, index) => {
            //能匹配到则写入对应数据,否则写入0
            if(products_ids.includes(value.nid) === true){
                //获取排名
                const product = competitive_products[value.nid];
                if(value.nid === item_self){
                    await getSycmSelfData(sycm_page, product, browser);
                } else {
                    await getSycmComData(sycm_page, product, item_self, value.nid, browser)
                }
                product['ranking'] = page_size + index + 1;
                product['price'] = parseFloat(value.view_price);
                product['sales_people'] = parseInt(value.view_sales);

                //删除已爬取数据
                delete competitive_products[value.nid];

                await getItemDetail(browser, value, product);
                product_array.push(product);
            }
        });
        await sycm_page.close();
    }else{
        console.log('暂无数据');
    }
    //写入匹配到的数据
    if(product_array.length > 0){
        insert_products_count += product_array.length;
    }

    //如果写入数据数量小于设置的竞品数据数量
    if(insert_products_count < products_ids.length && current_page <= MAX_PAGE_SIZE){
        current_page += 1;
        return getCompetitiveProducts(browser, page, competitive_products_shop, wangwang, product_array, insert_products_count, current_page);
    } else {
        product_array = await productHandle(product_array, item_self);
        await saveMysql(product_array);
        //写入未匹配到的数据
        if(Object.keys(competitive_products).length > 0){
            for(let key in competitive_products) {
                const product_not_matched = competitive_products[key];
                product_not_matched['ranking'] = 0;
                product_not_matched['sold_total'] = 0;
                product_array_not_matched.push(product_not_matched)
            }
            await saveMysql(product_array_not_matched);
        }
    }
};

const productHandle = async(productArr, item_self) =>{
    console.log(item_self)
    // 分成本店商品和竞品
    let selfArr = [];
    let compArr = [];
    await asyncForEach(productArr, async(product) => {
        console.log(product.f_itemId)
        if(product.f_itemId === item_self){
            selfArr = selfArr.concat(product);
        } else {
            compArr.push(product);
        }
    });
    if(selfArr.length>0){
        let source_dict = {'手淘搜索':'stss_', '直通车': 'ztc_', '手淘推荐': 'sttj_', '超级推荐': 'cjtj_'}
        // 竞品
        await asyncForEach(compArr, async(comp) => {
            console.log(comp)
            console.log(selfArr, 'ssssssssss')
            comp['payAmt'] = parseFloat(comp.payAmt) * parseFloat(selfArr[0].payAmt);
            comp['itmUv'] = parseFloat(comp.itmUv) * parseFloat(selfArr[0].itmUv);
            comp['itemCartCnt'] = parseFloat(comp.itemCartCnt) * parseFloat(selfArr[0].itemCartCnt);
            comp['payRate'] = parseFloat(comp.payRate) * parseFloat(selfArr[0].payRate);
            if(comp.hasOwnProperty('uv_handle')){
                await asyncForEach(comp['uv_handle'], async(source)=>{
                    let key_uv = source_dict[source[0]] + 'uv';
                    comp[key_uv] = source[2]==='-'?0:parseInt(source[2]);
                    if(!selfArr[0].hasOwnProperty(key_uv)){
                        selfArr[0][key_uv] = source[1]==='-'?0:parseInt(source[1]);
                    }
                });
            }
            if(comp.hasOwnProperty('pay_handle')){
                await asyncForEach(comp['pay_handle'], async(source)=>{
                    let key_uv = source_dict[source[0]] + 'payRate';
                    if(!selfArr[0].hasOwnProperty(key_uv)){
                        selfArr[0][key_uv] = source[1]==='-'?0:source[3];
                        // selfArr[0][key_uv] = source[1]==='-'?0:source[1];
                    }
                    if(source[1] === '-' || parseInt(source[1]) === 0){   // 本店指数不是0 就算出来，否则竞店写入指数
                        comp[key_uv] = source[2]==='-'?0:source[2];
                    } else {
                        let value_uv = (source[2]==='-'?0:parseInt(source[2])/parseInt(source[1])) * parseFloat(source[3]);
                        comp[key_uv] = value_uv.toFixed(2).toString() + '%';
                    }
                });
            }
        });
        productArr = compArr.concat(selfArr);
    }

    return productArr;
};

const getItemDetail = async(browser, value, product) => {
    //拼接url并访问
    const detail_url = 'https://'+ value.detail_url.split("//")[1];
    console.log(detail_url)
    const new_page = await setPage(browser);

    // 订阅 reponse 事件，参数是一个 reponse 实体
    await new_page.on('response', async (response) => {
        try {
            //获取taobao销量
            if (response.url().indexOf('item/detail/sib.htm') !== -1) {
                //获取产品销量等详情
                const data = await getDataFromJsonp(response);
                const sold_total_count = data['data']['soldQuantity']['soldTotalCount'];
                const coupon_list = data['data']['couponActivity']['coupon']['couponList'];
                let coupon_str = '';
                if(coupon_list){
                    await asyncForEach(coupon_list, async(coupon) => {
                        coupon_str += coupon.title + ';\n';
                    });
                }
                product['coupon'] = coupon_str;
                product['sold_total'] = sold_total_count;
            }
            //获取tmall销量
            if (response.url().indexOf('initItemDetail.htm') !== -1) {
                //获取产品销量等详情
                const data = await getDataFromJsonp(response);
                product['sold_total'] = data['defaultModel']['sellCountDO']['sellCount'];
            }
        }catch (e) {
            console.log(e);
            await addShopToShopList(product.f_wangwangid);
            await setBrowser();
            await assign();
            browser.close()
        }
    });

    await new_page.goto(detail_url, {waitUntil:'networkidle2'});
    await new_page.close();
};

/**
 * 获取 本店商品的生意参谋数据
 * @param page
 * @param product           mysql数据
 * @param browser
 * @returns {Promise<void>}
 */
const getSycmSelfData = async(page, product, browser) => {
    let token = '';
    await page.on('response', async (response) => {
        try {
            //获取token
            if (response.url().indexOf('sycm.taobao.com/custom/menu/getPersonalView.json') !== -1) {
                token = await getUrlParams(response.url(), 'token');
            }
        } catch (e) {
            console.log(e)
        }
    });
    const homeUrl = 'https://sycm.taobao.com/portal/home.htm';
    await page.goto(homeUrl);
    if(page.url().indexOf('login.htm')>-1){
        console.log('cookie失效');
        await addShopToShopList(product.f_wangwangid);
        await setBrowser();
        await assign();
        browser.close()
    } else {
        let yesterday = await getYesterday();
        let url = `https://sycm.taobao.com/cc/cockpit/marcro/item/top.json?dateRange=${yesterday}%7C${yesterday}&
        dateType=day&pageSize=100&page=1&order=desc&orderBy=payAmt&keyword=&follow=false&cateId=&cateLevel=&
        guideCateId=&device=0&indexCode=itmUv%2CitemCartCnt%2CpayItmCnt%2CpayAmt%2CpayRate&token=${token}`;
        let resp = await sendRequest(page, url);
        let item_data = resp['data']['data'];
        let item_dict = {};
        await asyncForEach(item_data, async(item) => {
            let item_id = item['itemId']['value'];
            item_dict[item_id] = item;
            if(item_id === product.f_itemId){
                product['payAmt'] = item['payAmt']['value'];
                product['pictUrl'] = 'https:' + item['item']['pictUrl'];
                product['itmUv'] = item['itmUv']['value'];
                product['itemCartCnt'] = item['itemCartCnt']['value'];
                product['payRate'] = item['payRate']['value'];
            }
        });
    }
};

/**
 * 获取 竞品的 生意参谋数据
 * @param page
 * @param product       mysql数据
 * @param item_self     本店商品的id
 * @param item_com      竞品id
 * @param browser
 * @returns {Promise<void>}
 */
const getSycmComData = async(page, product, item_self, item_com, browser) => {
    let yesterday = await getYesterday();
    let analysis_url = `https://sycm.taobao.com/mc/ci/item/analysis?dateRange=${yesterday}%7C${yesterday}&dateType=day`;
    await page.goto(analysis_url, {waitUntil: 'networkidle2'});
    if(page.url().indexOf('login.htm')>-1){
        console.log('cookie失效');
        await addShopToShopList(product.f_wangwangid);
        await setBrowser();
        await assign();
        browser.close()
    } else {
        try {
            let select_self = await page.$('.sycm-common-select-2');
            let select_com = await page.$('.sycm-common-select-3');
            if (select_self && select_com) {
                let dropdown_self = '';
                let dropdown_com = '';
                await select_self.click();
                let input_self = await page.$('.sycm-common-select-2 .ant-input');
                if(input_self){
                    await page.type('.sycm-common-select-2 .ant-input', item_self, {delay: 300});
                    await page.waitFor(2000);
                    dropdown_self = await page.$('.sycm-common-select-2 .oui-typeahead-dropdown-item');
                    if (dropdown_self) {
                        await dropdown_self.click();
                        await page.waitFor(1000)
                    } else {
                        console.log('本店无此商品ID: ' + item_self)
                    }
                }

                console.log(item_com);
                await select_com.click();
                let input_com = await page.$('.sycm-common-select-3 .ant-input');
                if(input_com){
                    await page.type('.sycm-common-select-3 .ant-input', item_com, {delay: 300});
                    await page.waitFor(2000)
                    dropdown_com = await page.$('.sycm-common-select-3 .oui-typeahead-dropdown-item');
                    if (dropdown_com) {
                        await dropdown_com.click();
                    } else {
                        console.log('无此竞品ID: ' + item_com)
                    }
                }
                if (dropdown_self && dropdown_com) {
                    await page.waitFor(1000);
                    let uv_indexes = await page.$eval('.alife-one-design-sycm-indexes-trend-index-item-uvIndex', el=>el.innerText);
                    uv_indexes = uv_indexes.replace('本店商品', '').replace('竞品1', '').replace(/,/ig, '').split(/\s+/);
                    let trade_indexes = await page.$eval('.alife-one-design-sycm-indexes-trend-index-item-tradeIndex', el=>el.innerText);
                    trade_indexes = trade_indexes.replace('本店商品', '').replace('竞品1', '').replace(/,/ig, '').split(/\s+/);
                    let cart_indexes = await page.$eval('.alife-one-design-sycm-indexes-trend-index-item-cartHits', el=>el.innerText);
                    cart_indexes = cart_indexes.replace('本店商品', '').replace('竞品1', '').replace(/,/ig, '').split(/\s+/);
                    await page.click('.alife-one-design-sycm-indexes-trend-index-page-arrow-container');
                    let payRate_indexes = await page.$eval('.alife-one-design-sycm-indexes-trend-index-item-payRateIndex', el=>el.innerText);
                    payRate_indexes = payRate_indexes.replace('本店商品', '').replace('竞品1', '').replace(/,/ig, '').split(/\s+/);
                    let com_pict = await page.$eval('.sycm-common-select-3 .sycm-common-select-selected-image-wrapper > img', el=>el.src);
                    console.log(cart_indexes);
                    product['pictUrl'] = com_pict;
                    product['payAmt'] = parseFloat(trade_indexes[2])/parseFloat(trade_indexes[1]);
                    product['itmUv'] = parseInt(uv_indexes[2])/parseInt(uv_indexes[1]);
                    product['itemCartCnt'] = parseInt(cart_indexes[2])/parseInt(cart_indexes[1]);
                    product['payRate'] = parseFloat(payRate_indexes[2])/parseFloat(payRate_indexes[1]);

                    // 入店来源数据
                    let uv_source = await getSourceData(page, 1);  // 访客数数据
                    // 支付转化指数
                    let radio_value = await page.$$eval('.ant-radio-input', el=>el.map(el=>el.value));
                    if(radio_value.indexOf('payRateIndex')>-1){
                        let radio = await page.$$('.ant-radio-input');
                        await radio[radio_value.indexOf('payRateIndex')].click();
                        await page.waitFor(1000);
                        let pay_source = await getSourceData(page, 0);
                        product['pay_handle'] = pay_source;
                    }
                    product['uv_handle'] = uv_source;
                } else {
                    product['payAmt'] = 0;
                    product['itmUv'] = 0;
                    product['itemCartCnt'] = 0;
                    product['payRate'] = 0;
                }
            }
            else {
                console.log('没有订购')
            }
        }catch (e) {
            console.log(e);
            await addShopToShopList(product.f_wangwangid);
            await setBrowser();
            await assign();
            browser.close();
        }
    }
    // process.exit()
};

/**
 * 获取入店来源数据
 * @param page
 * @param next          向上或向下翻页，1向下，0向上
 * @returns {Promise<Array>}
 */
const getSourceData = async(page, next) =>{
    let sourceArr = ['手淘搜索', '直通车', '手淘推荐', '超级推荐'];
    let ant_row = await page.$$eval('#sycm-mc-ci-flow-analysis .ant-table-row', el => el.map(el => el.innerText));
    let new_len = ant_row.length;
    for (let i = 0; i<10; i++) {
        let old_len = new_len;
        if(next === 1){
            await page.click('#sycm-mc-ci-flow-analysis .ant-pagination-next');
        } else {
            await page.click('#sycm-mc-ci-flow-analysis .ant-pagination-prev');
        }
        await page.waitFor(4000);
        let temp_ant_row = await page.$$eval('#sycm-mc-ci-flow-analysis .ant-table-row', el => el.map(el => el.innerText))
        if(temp_ant_row){
            if(ant_row.indexOf(temp_ant_row[0])>-1){
                break
            } else {
              ant_row = ant_row.concat(temp_ant_row);
            }
        }
        new_len = ant_row.length;
        if (new_len === old_len) {
            break
        }
    }
    let new_ant_row = [];
    await asyncForEach(sourceArr, async (source) => {
        await asyncForEach(ant_row, async (ant) => {
            ant = ant.replace('趋势', '').replace(/,/g, '').trim().split(/\s+/ig);
            if(ant.indexOf(source)>-1){
                new_ant_row.push(ant);
            }
        })
    });
    return new_ant_row;
}

/**
 * fetch请求
 * @param page
 * @param url
 * @returns {Promise<*>}
 */
const sendRequest = async (page,url)=>{
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
 * 存储mysql
 * @param product_array         获取到的竞品数据数组
 * @returns {Promise<void>}
 */
const saveMysql = async(product_array)=>{
    const date = await getYesterday();
    await asyncForEach(product_array, async (ele, index) => {
        // 先删除数据
        let sql_del = "delete from t_sycm_competitive_products_detail where f_date like'" + date + "%' and f_wangwangid='" + ele.f_wangwangid +"'and f_itemId='" + ele.f_itemId +"'";
        await mysqlCfgSql(config.mysql_zhizuan, sql_del);

        let detailObj = {};
        let now = moment().utcOffset("+00:00").format('YYYY-MM-DD HH:mm:ss')
        detailObj['f_wangwangid'] = ele.f_wangwangid;
        detailObj['f_itemId'] = ele.f_itemId;
        detailObj['f_foreign_products_id'] = ele.id;
        detailObj['f_keyword'] = ele.f_keyword;
        detailObj['f_type'] = ele.f_type;
        detailObj['f_date'] = date;
        detailObj['sales_ranking'] = ele.ranking;
        detailObj['price'] = ele.price;
        detailObj['pictUrl'] = ele.pictUrl;
        detailObj['sales_people'] = ele.sales_people;
        detailObj['preferential_activity'] = ele.coupon;
        detailObj['payAmt'] = ele.payAmt;
        detailObj['itmUv'] = ele.itmUv;
        detailObj['itemCartCnt'] = ele.itemCartCnt;
        detailObj['payRate'] = ele.payRate;
        detailObj['receiving_people'] = ele.sold_total;
        detailObj['stss_uv'] = ele.stss_uv;
        detailObj['ztc_uv'] = ele.ztc_uv;
        detailObj['sttj_uv'] = ele.sttj_uv;
        detailObj['cjtj_uv'] = ele.cjtj_uv;
        detailObj['stss_payRate'] = ele.stss_payRate;
        detailObj['ztc_payRate'] = ele.ztc_payRate;
        detailObj['sttj_payRate'] = ele.sttj_payRate;
        detailObj['cjtj_payRate'] = ele.cjtj_payRate;
        detailObj['created_at'] = now;
        detailObj['updated_at'] = now;

        // 插入数据
        const result = await competitiveProducts.create(detailObj);
        console.log(result)
    });
};

/**
 * 程序异常,将旺旺id重新写入数组
 * @param wangwang
 * @returns {Promise<void>}
 */
const addShopToShopList = async (wangwang)=>{
    const shop_array = {
        wangwang: wangwang,
        retry: 0
    };
    G_SHOP_LIST.push(shop_array);
};

/**
 * 分配请求再请求
 * @returns {Promise<void>}
 */
const assign  = async () => {
    const browserCount = G_BROWSER_LIST.length;
    for (let i = 0; i < browserCount; ++i) {
        startCrawl(
            G_BROWSER_LIST.pop()//从数组末尾取
        );
    }
};

/**
 * 获取特定店铺
 * @param wangwang              店铺旺旺id
 * @param new_shop_lists        需要爬取数据的店铺列表
 * @param shop_lists            服务中的店铺列表
 * @param type                  是单点还是多店(GET_ONE:1单店; GET_MANY:2多店)
 * @returns {Promise<void>}
 */
const setShopListByWangwang = async (wangwang, new_shop_lists, shop_lists, type)=> {
    const day = await getYesterday();
    //获取设置的竞品数据
    const competitive_products_sql = "select f_itemId from t_sycm_competitive_products where f_wangwangid='" + wangwang +"'";
    const competitive_products = await mysqlCfgSql(config.mysql_zhizuan, competitive_products_sql);

    //获取已写入竞品数据
    const competitive_products_detail_sql = "select f_itemId from t_sycm_competitive_products_detail where f_date like'" + day + "%' and f_wangwangid='" + wangwang +"' and pictUrl is not null";
    const competitive_products_detail = await mysqlCfgSql(config.mysql_zhizuan, competitive_products_detail_sql);

    //店铺在服务中并且设置了竞品数据,写入数据少于设置数据
    shop_lists.forEach(function (value) {
        if(
            value.f_copy_wangwangid === wangwang &&
            competitive_products !== null &&
            competitive_products_detail.length < competitive_products.length
          ){
            new_shop_lists.push({
                wangwang: wangwang,
                retry: 0
            });
        }
    });

    if(new_shop_lists.length > 0){
        G_SHOP_LIST = JSON.parse(JSON.stringify(new_shop_lists));
    }else{
        console.log(wangwang+'：暂无需要爬取的数据');
        if(type === GET_ONE){
            process.exit()
        }
    }
};

/**
 * 赋值cookie
 * @param browser
 * @param wangwang
 * @returns {Promise<void>}
 */
const setCookie = async (browser, wangwang)=>{
    let account = '';
    if(wangwang){
        account = await getCookiesByMongo(wangwang)
    } else {
        account = await getOneCookieByMongo();
    }

    let page = await setPage(browser);

    if(account && account.f_raw_cookies){
        // 赋予浏览器圣洁的cookie
        await asyncForEach(account.f_raw_cookies.sycmCookie, async (value, index) => {
            await page.setCookie(value);
        });
    }
    return page;
};

/**
 * 创建浏览器
 * @returns {Promise<void>}
 */
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
};

/**
 * 创建页面
 * @param browser
 * @returns {Promise<void>}
 */
const setPage = async(browser) => {
    let page = await setJs(await browser.newPage());
    page.setDefaultTimeout(50000);
    page.setDefaultNavigationTimeout(50000);
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
    return page
}

(async () => {
    const args = process.argv.splice(2);
    let new_shop_lists = [];
    const shop_lists = await getAllShopBoss();
    // 只传旺旺id
    if (args.length === 1) {
        await setShopListByWangwang(args[0], new_shop_lists, shop_lists, GET_ONE);
    }else{
        await asyncForEach(shop_lists, async (ele, index) => {
            await setShopListByWangwang(ele.f_copy_wangwangid, new_shop_lists, shop_lists, GET_MANY);
        });
    }

    if(G_SHOP_LIST.length === 0){
        console.log('爬取完毕');
        process.exit()
    }

    // 生成N个常驻的浏览器
    for (i = 0; i < G_NUM; i++) {
        await setBrowser();
    }

    await assign();
})();
