/**
 * 生意參謀 竞品数据爬虫的计划任务（可以 传入某个店铺 和 日期 获取补抓）
 * 生意参谋->竞争->竞品分析 /关键指标对比   time：昨天
 * 淘宝商品数据    排名，价格，图片链接，付款人数，优惠券
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getAllShopBoss,getUrlParams,getDataFromJsonp} = require('../commons/func');
const { getCookiesByMongo } = require("../commons/account");
const { getYesterday } = require("../commons/dateFunc");
const { mysqlCfgSql } = require('../commons/db');
const moment = require('moment');
const CryptoJS = require('crypto-js');
const JSEncrypt = require('node-jsencrypt');
const { competitiveProducts } = require('../model/competitiveProducts');

process.setMaxListeners(999999999);

const G_NUM = config.tuijian_spider_concurrency; // 浏览器的启动数量
let G_BROWSER_LIST = []; // 浏览器列表
let G_SHOP_LIST = []; // 店铺列表
let GET_ONE = 1;//获取单店数据
let GET_MANY = 2;//获取多店数据
let G_SELF_TYPE = [0, 4];// 本店商品类型（mysql）
let miss_sycm = 0;   //未开通竞品分析

/**
 * 开始运行爬虫
 * @param orgBrowser
 * @returns {Promise<void>}
 */
const startCrawl = async (shop, orgBrowser) => {
    let browser = null;
    let wangwang = shop.wangwang;
    console.log('wangwang', wangwang);
    try {
        let browserWSEndpoint = orgBrowser.ws;
        browser = await puppeteer.connect({browserWSEndpoint});
        const page = await setCookie(browser, wangwang);
        let data_ids = await getSqlData(wangwang);      //从sql中取出商品和竞品的id

        let suberr = 0;
        let token = '';
        let cateid = '';             //商品类目
        await page.on('response', async (response) => {
            if (response.url().indexOf('_____tmd_____/punish') !== -1) {
                await page.waitFor(2000);
                console.log('出现滑块');
                suberr = 1;
            }
            //获取token
            if (response.url().indexOf('getPersonalView.json?') !== -1) {
                token = await getUrlParams(response.url(), 'token');
                console.log('token', token);
            }
            //获取cateid
            if (response.url().indexOf('getMonitoredListExcludeGreatShop.json?') !== -1) {
                cateid = await getUrlParams(response.url(), 'firstCateId');
                console.log('cateid', cateid);
            }
            //未开通
            if (response.url().indexOf('getUpgradeList.json?') !== -1) {
                miss_sycm = 1;
                console.log('未开通竞品分析');
            }
        });

        const homeUrl = 'https://sycm.taobao.com/mc/ci/item/analysis?';
        await page.goto(homeUrl, {waitUntil: 'networkidle0'});
        let enter = await page.$('.image-guide-tips-footer>div:nth-child(2)>button:nth-child(2)');
        if(enter){   //存在广告弹窗，则点击跳过
            await enter.click();
            await page.waitFor(1000)
        }
        console.log('next---');
        if (page.url().indexOf('custom/login.htm') !== -1 || page.url().indexOf('custom/no_permission') !== -1 || suberr === 1) {
            console.log('cookies失效或生意参谋未授权');
            shop.retry = shop.retry + 1;
            if (shop.retry < 3) {
                await addShopToShopList(wangwang, shop.retry);
            }
            await setBrowser();
            await assign();
            await browser.close()
        }else {
            if (miss_sycm === 1) {
                //未开通竞品分析模块，直接进入淘宝页搜索
                await getCompetitiveProducts(browser, data_ids[0], data_ids[1], data_ids[2], wangwang);
                console.log('本店商品数据存储ok')
            } else {
                //生意参谋的数据
                let compet_product = await getSycmComData(page, data_ids[2], data_ids[3], token, cateid);
                let compet_product_core = await getCoreData(page, compet_product, data_ids[3], token, cateid);
                // //获取淘宝页的数据
                await getCompetitiveProducts(browser, data_ids[0], data_ids[1], compet_product_core, wangwang);
                console.log('本店商品数据存储ok')
            }
            //爬取下一家店铺
            await setBrowser();
            await assign();
            await browser.close()
        }
    } catch (e) {
        if (
            e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
            e.message.indexOf('Session closed. Most likely the page has been closed') === -1
        ) {
            console.log(e.message,'\n','22222222222');
            shop.retry =shop.retry + 1;  //重试三次
            if (shop.retry < 3) {
                await addShopToShopList(wangwang,shop.retry);
            }
            await setBrowser();
            await assign();
            await browser.close();
        }
    }
};

/**
 * 从sql中取出店铺的数据， 并筛选
 * @param wangwang
 */
const getSqlData = async (wangwang) => {
    let competitive_products = {};//对应旺旺id的竞品数据
    let item_ids = [];         //存放所有的商品ids
    let keywords = [];          //关键词
    let ids_keyword = {};      //关键词分组的ids
    //获取 竞品数据
    const wangwang_sql = "select * from t_sycm_competitive_products where f_wangwangid='" + wangwang + "' order by f_type;";
    let sql_data = await mysqlCfgSql(config.mysql_zhizuan, wangwang_sql);
    //筛选数据
    sql_data.forEach(function (value) {
        item_ids.push(value.f_itemId);
        competitive_products[value.f_itemId] = value;
        keywords.push(value.f_keyword);
    });
    //取出该店铺同一个关键词下的所有商品id
    let word_list = Array.from(new Set(keywords));          //同一家店铺取出关键词,去重
    while (word_list.length > 0) {
        let word = word_list.shift().toString();
        ids_keyword[word] = [];
        sql_data.forEach(function (item) {
            if (word.indexOf(item.f_keyword) > -1 && item.f_itemId!=='') {
                ids_keyword[word].push(item.f_itemId);
            }
        })
    }
    let word_temp = Array.from(new Set(keywords));
    return [word_temp, ids_keyword, competitive_products, item_ids];
}


/**
 * 生意参谋->竞争->竞品分析->入店来源      访客数，支付转化指数   time:昨天
 * @param page
 * @param competitive_products    sql存储的数据
 * @param item_ids                所有商品的ids
 * @param token
 * @param cateid                  默认类目
 * @returns {Promise<*>}
 */
const getSycmComData = async (page, competitive_products, item_ids, token, cateid) => {
    let compare = ['uv', 'payRateIndex'];               //对比指标
    let yesterday = await getYesterday();
    await asyncForEach(item_ids, async (id) => {
        let self = '';                 //拼接url的参数
        let upper_word = '';         //筛选数据时词
        //初始化需要的指标数据为0 ，有的指标为空
        let data = {
            'stss_uv': 0,
            'ztc_uv': 0,
            'sttj_uv': 0,
            'cjtj_uv': 0,
            'stss_payRate': 0,
            'ztc_payRate': 0,
            'sttj_payRate': 0,
            'cjtj_payRate': 0
        };
        //取出数据库存的数据type,判断本店商品 or 竞品
        let product = competitive_products[id];
        if (G_SELF_TYPE.indexOf(product.f_type) > -1) {
            console.log('本店商品');
            self = '&selfItemId=' + id;    //本店商品的iD
            upper_word = 'selfItem';
        } else {
            console.log('竞品');
            self = '&rivalItem1Id=' + id;    //竞品的iD
            upper_word = 'rivalItem1';
        }
        //发送请求
        await asyncForEach(compare, async (item_self) => {
            let result = '';
            let url_self = 'https://sycm.taobao.com/mc/rivalItem/analysis/getFlowSource.json?device=2&cateId=' + cateid +
                self + '&dateType=day&dateRange=' + yesterday + '%7C' + yesterday + '&indexCode='
                + item_self + '&order=desc&token=' + token;
            let respon_self = await sendReauest_Compet(page, url_self);
            if (respon_self['data']) {           //判断商品是否存在
                let code_self = respon_self['data'];
                result = sycmEnc(code_self);       //data解密
                let obj = {};
                await asyncForEach(result, async (item_cate) => {
                    obj[item_cate['pageName']['value']] = item_cate[upper_word + firstUpperCase(item_self)]['value'];
                });
                //取出需要的数据
                data = await competNeedData(obj, item_self, data);
            } else {
                console.log('商品不存在');
                data = '';
            }
        })
        competitive_products[id]['uv'] = data;
    })
    console.log('入店来源数据ok');
    return competitive_products;
};

/***
 * 筛选指标 访客数，支付转化指数 ->四条数据
 * @param obj          所有数据
 * @param item_self    uv,payRateIndex 对比指标
 * @param data
 */
const competNeedData = async (obj, item_self, data) => {
    if (item_self.indexOf('payRateIndex') !== -1) {
        //支付转化指数需要转化
        for (let item in obj) {
            if (item.indexOf('手淘搜索') !== -1) {
                let value = await transValue(obj[item], 'zfzh')
                data['stss_payRate'] = value + '%';
            }
            if (item.indexOf('直通车') !== -1) {
                let value = await transValue(obj[item], 'zfzh')
                data['ztc_payRate'] = value + '%';
            }
            if (item.indexOf('手淘推荐') !== -1) {
                let value = await transValue(obj[item], 'zfzh')
                data['sttj_payRate'] = value + '%';
            }
            if (item.indexOf('超级推荐') !== -1) {
                let value = await transValue(obj[item], 'zfzh')
                data['cjtj_payRate'] = value + '%';
            }
        }
    } else {
        for (let item in obj) {
            if (item.indexOf('手淘搜索') !== -1) {
                data['stss_uv'] = obj[item];
            }
            if (item.indexOf('直通车') !== -1) {
                data['ztc_uv'] = obj[item];
            }
            if (item.indexOf('手淘推荐') !== -1) {
                data['sttj_uv'] = obj[item];
            }
            if (item.indexOf('超级推荐') !== -1) {
                data['cjtj_uv'] = obj[item];
            }
        }
    }

    return data;
}
//指数 查询数据库找到对应的真实数据
const transValue = async (number, type) => {
    let value = 0;
    if (number === 0) {
        value = 0;
    } else {
        number = number.toFixed(0);   //保留整数,并查询sql,寻找对应值
        let sql_value = "select f_transform_value from t_sycm_index_transform where f_type='" + type + "' and f_index_value = " + number;
        value = await mysqlCfgSql(config.mysql_zhizuan, sql_value);
        if (value.length > 0) {
            value = value[0]['f_transform_value'];
        } else {
            console.log('转化error');
            value = 0;
        }

    }
    return value;
}


/**
 * 生意参谋->竞争 ->竞品分析-> 关键指标对比   time 昨天
 * @param page
 * @param competitive_products     存储的数据
 * @param item_ids                 所有商品的ids
 * @param token
 * @param cateid                   默认类目
 * @returns {Promise<*>}
 */
const getCoreData = async (page, competitive_products, item_ids, token, cateid) => {
    let yesterday = await getYesterday();
    await asyncForEach(item_ids, async (id) => {
        let core_data;
        let self = '';                 //拼接url的参数
        let upper_word = '';         //筛选数据时词
        //取出数据库存的数据type,判断本店商品 or 竞品
        let product = competitive_products[id];
        //判断竞品id存在
        if(product.f_itemId!==''){
            if (G_SELF_TYPE.indexOf(product.f_type) > -1) {
                console.log('本店商品');
                self = '&selfItemId=' + id;    //本店商品的iD
                upper_word = 'selfItem';
            } else {
                console.log('竞品');
                self = '&rivalItem1Id=' + id;    //竞品的iD
                upper_word = 'rivalItem1';
            }
            //发送请求
            let result = '';
            let url_self = 'https://sycm.taobao.com/mc/rivalItem/analysis/getCoreIndexes.json?' +
                'dateType=day&dateRange=' + yesterday + '%7C' + yesterday + '&device=0&cateId=' + cateid + self + '&token=' + token;
            let respon_self = await sendReauest_Compet(page, url_self);
            if (respon_self['data']) {           //判断商品是否存在
                let code_self = respon_self['data'];
                result = sycmEnc(code_self);       //data解密
                //取出需要的数据
                if(Object.keys(result[upper_word]).length === 0){
                    core_data = '';
                }else {
                    core_data = await selectData(result[upper_word]);
                }
            } else {
                core_data = '';
            }

        }else{
            console.log('id 为空，无法找到该商品');
            core_data = '';
        }
        competitive_products[id]['core'] = core_data;
    })
    console.log('关键指标ok');
    return competitive_products;
}

//生意参谋->竞争 ->竞品分析-> 关键指标对比  筛选出流量指数 ，交易指数，加购人气 ，支付转化指数
const selectData = async (data) => {
    let data_new = {};
    let uv = await transValue(data['uvIndex']['value'],'uvHits');
    console.log(uv);
    data_new['itmUv'] = uv;
    let trade = await transValue(data['tradeIndex']['value'],'tradeIndex');
    console.log(trade);
    data_new['payAmt'] = trade;
    let cart = await transValue(data['cartHits']['value'],'cartHits');
    console.log(cart);
    data_new['itemCartCnt'] = cart;
    let rate = await transValue(data['payRateIndex']['value'],'zfzh');
    console.log(rate);
    data_new['payRate'] = (rate/100).toFixed(4);
    return data_new;
}

/**
 * 获取竞品淘宝页面数据        排名，价格，图片链接，付款人数
 * @param browser
 * @param keywords              关键词列表
 * @param ids_keyword           关键词分组的商品ids
 * @param competitive_products   sql所有商品信息
 * @param wangwang               旺旺
 * @returns {Promise<void>}
 */
const getCompetitiveProducts = async (browser, keywords, ids_keyword, competitive_products, wangwang) => {
    console.log(keywords);
    console.log(ids_keyword);
    let product_array_not_matched = [];         //销量前5页找不到的商品

    //遍历每个关键词
    while (keywords.length > 0) {
        let insert_products_count = 0;//已写入的竞品数据个数
        let current_page = 1;         //当前页码
        let MAX_PAGE_SIZE = 5;        //最大爬取页码
        let tbaoDetail;               //记录已爬取的商品个数
        let product_array = [];                  //存放淘宝详情页的数据
        insert_products_count = product_array.length;

        let keyword = keywords.shift();              //取出店铺某个关键词
        let products_ids = ids_keyword[keyword];    //取出店铺某个关键词的所有产品ids
        const page_enter = await setCookie(browser, wangwang);    //每个关键词新开一个页面
        //拼接关键词查询宝贝
        const searchUrl = 'https://s.taobao.com/search?q=' + keyword + '&sort=sale-desc';
        await page_enter.goto(searchUrl, {waitUntil: 'networkidle2'});

        let page_data = [];
        const page_size = (current_page - 1) * 44;
        // 出现滑块
        let slider = false;
        const slider_page = await page_enter.$('#nocaptcha');
        if (slider_page != null) {
            slider = await page_enter.$eval('#nocaptcha', (elem) => {
                return window.getComputedStyle(elem).getPropertyValue('display') !== 'none' && elem.offsetHeight
            });
            if (slider !== false) {
                console.log('滑块块块块块块块块块块块块');
                throw new Error('huakuai-')
                // await addShopToShopList(wangwang);
                // await setBrowser();
                // await assign();
                // await browser.close()
            }
        }

        //页面随机滚动
        await page_enter.evaluate(function () {
            for (var y = 0; y <= Math.floor(Math.random() * 5000); y += 100) {
                window.scrollTo(0, y)
            }
        });

        // 订阅 reponse 事件，参数是一个 reponse 实体
        await page_enter.on('response',
            async (response) => {
                try {
                    //弹框滑块及全屏滑块
                    if (response.url().indexOf('punish?x5secdata') > -1 || response.url().indexOf('_____tmd_____/punish') !== -1) {
                        console.log('滑块块块块块块块块块块块块');
                        await page_enter.waitFor(3000);
                    }
                } catch (e) {
                    console.log(e);
                    throw new Error('error-')
                    // await addShopToShopList(wangwang);
                    // await setBrowser();
                    // await assign();
                    // await browser.close()
                }
            });

        //当商品未搜到，少于5页，爬取下一页
        while (insert_products_count < products_ids.length && current_page <= MAX_PAGE_SIZE) {
            console.log(insert_products_count);
            console.log(current_page);

            //如果是第一页则从js获取数据否则从接口获取数据
            if (current_page === 1) {
                page_data = await page_enter.evaluate(() => window.Search.get('app').userConfig.data.mods.itemlist.data.auctions);
                //取数据
                tbaoDetail = await getTaoDetail(page_enter, browser, wangwang, products_ids, page_data, competitive_products, product_array, page_size);
            } else {
                let tba_page = await setCookie(browser, wangwang);
                let s = (current_page - 2) * 44;
                let data_value = (current_page - 1) * 44;
                let list_url = 'https://s.taobao.com/search?data-key=s&data-value=' + data_value + '&ajax=true&callback=jsonp1535&q=' + keyword + '&sort=sale-desc&bcoffset=0&p4ppushleft=%2C44&s=' + s;
                const raw_data = await sendReauest(tba_page, list_url);
                try {
                    console.log(raw_data['mainInfo']['currentUrl'])
                    if (raw_data['mainInfo']['currentUrl']) {
                        if (raw_data['mods']['itemlist']['status'] === 'show') {
                            page_data = raw_data['mods']['itemlist']['data']['auctions'];
                            //取数据
                            tbaoDetail = await getTaoDetail(tba_page, browser, wangwang, products_ids, page_data, competitive_products, product_array, page_size);
                        } else {
                            console.log('数据获取有误')
                        }
                    } else {
                        console.log('数据获取有误')
                    }
                } catch (e) {
                    console.error(e);
                    console.error(raw_data);
                    throw new Error('error22222-')
                    // await addShopToShopList(wangwang);
                    // await setBrowser();
                    // await assign();
                    // await browser.close()
                }
            }
            current_page += 1;
            insert_products_count = tbaoDetail.length;
            console.log('进入下一页--')
        }
        console.log('matchData', product_array);
        //存数据   1: tbao搜索页匹配到 2：未匹配到
        await saveMysql(product_array);
    }

    //如果top5页未搜索到商品，进入详情页获取优惠券，产品销量
    if (Object.keys(competitive_products).length > 0) {
        for (let key in competitive_products) {
            const product_not_matched = competitive_products[key];
            //进入商品详情页
            await getItemDetail(browser, product_not_matched);
            product_array_not_matched.push(product_not_matched);
        }
    }
    console.log('no_matchData', product_array_not_matched);
    //存数据
    await saveMysql(product_array_not_matched);
};

/**
 * 淘宝->关键词 ->销量top5页  获取商品的排名，价格，销量，url
 * @param tba_page
 * @param browser
 * @param wangwang
 * @param products_ids      sql店铺所有商品id
 * @param page_data         淘宝页面的数据
 * @param competitive_products  需要存储的数据
 * @param product_array         记录搜索到的商品
 * @param page_size             页数
 * @returns {Promise<*>}
 */
const getTaoDetail = async (tba_page, browser, wangwang, products_ids, page_data, competitive_products, product_array, page_size) => {
    if (page_data.length > 0) {
        await asyncForEach(page_data, async (value, index) => {
            //能匹配到则写入对应数据,否则写入0
            if (products_ids.includes(value.nid) === true) {
                console.log('我是对比的数据', value.nid);
                //获取排名
                const product = competitive_products[value.nid];
                product['ranking'] = page_size + index + 1;
                product['price'] = parseFloat(value.view_price);
                product['sales_people'] = parseInt(value.view_sales);
                product['pictUrl'] = value.pic_url;

                //详情页的数据
                await getItemDetail(browser, product);
                // 删除已爬取数据（统计top5未搜到的商品）
                delete competitive_products[value.nid];
                product_array.push(product);
            }
        });
    } else {
        console.log('暂无数据');
    }
    return product_array;
}

/**
 * 获取淘宝商品详情页的产品销量 和优惠券信息
 * @param browser
 * @param product           sql中的单个商品
 * @returns {Promise<void>}
 */
const getItemDetail = async (browser, product) => {
    if(product['f_itemId']!==''){
        //拼接url并访问
        const detail_url = 'https://item.taobao.com/item.htm?&id=' + product['f_itemId'];
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
                    if (coupon_list) {
                        await asyncForEach(coupon_list, async (coupon) => {
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
            } catch (e) {
                console.log(e);
                throw new Error('error33333-')
                // await addShopToShopList(product.f_wangwangid);
                // await setBrowser();
                // await assign();
                // await browser.close()
            }
        });
        await new_page.goto(detail_url, {waitUntil: 'networkidle2'});
        await new_page.close();
    }
};

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest_Compet = async (page, url) => {
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
/**
 * 发送请求的方法并解析jsonp数据
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest = async (page, url) => {
    let reponse = await page.evaluate(async (url) => {
        let headers = {
            'referer': 'https://s.taobao.com/search?',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-dest': 'empty',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url, {headers: headers});
        let data = await response.text();
        var startWith = data.split("(")[0];
        var dataStart = data.split(startWith)[1];
        var dataEnd = dataStart.replace(/;/g, "");
        var str = eval("(" + dataEnd + ")");
        return str;
    }, url);
    return reponse;
};

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

//将字符串的首字母大写
function firstUpperCase(str) {
    let string = str.substring(0, 1).toUpperCase() + str.substring(1);
    return string;
}

/**
 * 存储mysql
 * @param product_array         获取到的竞品数据数组
 * @returns {Promise<void>}
 */
const saveMysql = async (product_array) => {
    const date = await getYesterday();
    await asyncForEach(product_array, async (ele, index) => {
        // 先删除数据
        let sql_del = "delete from t_sycm_competitive_products_detail where f_date like'" + date + "%' and f_wangwangid='" + ele.f_wangwangid + "'and f_itemId='" + ele.f_itemId + "'";
        await mysqlCfgSql(config.mysql_zhizuan, sql_del);

        let detailObj = {};
        let now = moment().utcOffset("+00:00").format('YYYY-MM-DD HH:mm:ss')
        detailObj['f_wangwangid'] = ele['f_wangwangid'];
        detailObj['f_itemId'] = ele['f_itemId'];
        detailObj['f_foreign_products_id'] = ele['id'];
        detailObj['f_keyword'] = ele['f_keyword'];
        detailObj['f_type'] = ele['f_type'];
        detailObj['f_date'] = date;
        detailObj['sales_ranking'] = ele['ranking'] || 0;
        detailObj['price'] = ele['price'] || 0;
        detailObj['pictUrl'] = ele['pictUrl'] || '';
        detailObj['sales_people'] = ele['sales_people'] || 0;
        detailObj['preferential_activity'] = ele['coupon'] || 0;
        detailObj['receiving_people'] = ele['sold_total'] || 0;
        if(miss_sycm!==1){
            detailObj['payAmt'] = ele['core']['payAmt'] || 0;
            detailObj['itmUv'] = ele['core']['itmUv'] || 0;
            detailObj['itemCartCnt'] = ele['core']['itemCartCnt'] || 0;
            detailObj['payRate'] = ele['core']['payRate'] || 0;
            detailObj['stss_uv'] = ele['uv']['stss_uv'] || 0;
            detailObj['ztc_uv'] = ele['uv']['ztc_uv'] || 0;
            detailObj['sttj_uv'] = ele['uv']['sttj_uv'] || 0;
            detailObj['cjtj_uv'] = ele['uv']['cjtj_uv'] || 0;
            detailObj['stss_payRate'] = ele['uv']['stss_payRate'] || 0;
            detailObj['ztc_payRate'] = ele['uv']['ztc_payRate'] || 0;
            detailObj['sttj_payRate'] = ele['uv']['sttj_payRate'] || 0;
            detailObj['cjtj_payRate'] = ele['uv']['cjtj_payRate'] || 0;
        }
        detailObj['created_at'] = now;
        detailObj['updated_at'] = now;

        // 插入数据
        const result = await competitiveProducts.create(detailObj);
    });
};

/**
 * 程序异常,将旺旺id重新写入数组
 * @param wangwang
 * @returns {Promise<void>}
 */
const addShopToShopList = async (wangwang, retry) => {
    const shop_array = {
        wangwang: wangwang,
        retry: retry
    };
    G_SHOP_LIST.push(shop_array);
};

// 分配请求再请求
const assign = async () => {
    if(G_SHOP_LIST.length === 0){
        console.log('爬取完毕');
        process.exit()
    }else{
        const browserCount = G_BROWSER_LIST.length;
        console.log(browserCount);
        for (let i = 0; i < browserCount; i++) {
            // 从列表获取一个店铺
            const shop = G_SHOP_LIST.shift();
            startCrawl(
                shop,
                G_BROWSER_LIST.pop()
            );
        }

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
const setShopListByWangwang = async (wangwang, new_shop_lists, shop_lists, type) => {
    const day = await getYesterday();
    //获取设置的竞品数据
    const competitive_products_sql = "select f_itemId from t_sycm_competitive_products where f_wangwangid='" + wangwang + "'";
    let competitive_products = await mysqlCfgSql(config.mysql_zhizuan, competitive_products_sql);

    //获取已写入竞品数据
    const competitive_products_detail_sql = "select f_itemId from t_sycm_competitive_products_detail where f_date like'" + day + "%' and f_wangwangid='" + wangwang + "' and pictUrl is not null";
    let competitive_products_detail = await mysqlCfgSql(config.mysql_zhizuan, competitive_products_detail_sql);

    //店铺在服务中并且设置了竞品数据,写入数据少于设置数据
    shop_lists.forEach(function (value) {
        if (
            value.f_copy_wangwangid === wangwang &&
            competitive_products !== null &&
            competitive_products_detail.length < competitive_products.length
        ) {
            new_shop_lists.push({
                wangwang: wangwang,
                retry: 0
            });
        }
    });

    if (new_shop_lists.length > 0) {
        G_SHOP_LIST = JSON.parse(JSON.stringify(new_shop_lists));
    } else {
        console.log(wangwang + '：暂无需要爬取的数据');
        if (type === GET_ONE) {
            process.exit()
        }
    }
};

/**
 * 创建页面
 * @param browser
 * @returns {Promise<void>}
 */
const setPage = async (browser) => {
    let page = await setJs(await browser.newPage());
    page.setDefaultTimeout(50000);
    page.setDefaultNavigationTimeout(50000);
    page.setViewport({
        width: 1376,
        height: 1376
    });

    // 拦截静态文件请求
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (['image', 'font'].includes(request.resourceType())) {
            return request.abort();
        }
        return request.continue();
    });
    return page
}

/**
 * 创建浏览器
 * @returns {Promise<void>}
 */
const setBrowser = async () => {
    const browser = await puppeteer.launch({
        headless: config.headless,
        args: [
            "--disable-gpu",
            "--disable-setuid-sandbox",
            "--force-device-scale-factor",
            "--ignore-certificate-errors",
            "--no-sandbox",
            '--disable-dev-shm-usage'
        ],
        ignoreDefaultArgs: ["--enable-automation"]
    });

    G_BROWSER_LIST.push({
        ws: browser.wsEndpoint()
    });
};


// 赋值cookie
const setCookie = async (browser, wangwang) => {
    let account = await getCookiesByMongo(wangwang);
    await browser.newPage();
    // 关闭无用的page
    let pages = await browser.pages();
    for (let i = 1; i < pages.length; ++i) {
        if(i>1){
            await pages[i].close();
        }
    }

    // page配置js
    let page = await setJs(pages[1]);
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
    console.log('需要爬取店铺列表',G_SHOP_LIST);

    // 生成N个常驻的浏览器
    for (i = 0; i < G_NUM; i++) {
        await setBrowser();
    }
    await assign();
})();
