/**
 *  淘宝 根据旺旺搜索  第一个产品 类目
 * */
const puppeteer = require('puppeteer');
const { mongoQuery, mysqlCfgSql } = require('../commons/db');
const moment = require('moment');
const config = require('../config');
const {asyncForEach,setJs} = require('../commons/func');

const startCrawl = async(page) => {
    const shop_list = await getShopAll();
    for(let shop of shop_list){
        let data = {};
        let wangwang = shop.f_copy_wangwangid;
        data['wangwang'] = wangwang;
        data['created_at'] = new Date();
        data['updated_at'] = new Date();
        let search_url = 'https://shopsearch.taobao.com/search?initiative_id=staobaoz_20120515&q=' + wangwang;
        console.log(search_url)
        await page.goto(search_url, {waitUntil: 'networkidle2'});
        let title = await page.title();
        if(title.indexOf('X5')>-1){
            // 滑块
            for(let i = 0; i<3; i++){
                const slide= await page.$('#nc_1_n1z');
                if(slide === null){
                    break
                }
                const loc = await slide.boundingBox();
                await page.mouse.move(loc.x, loc.y);
                await page.mouse.down();
                await page.mouse.move(loc.x+400, loc.y);
                await page.mouse.up();
                await page.waitFor(3000);
                const err = await page.$('.errloading');
                if(err){
                    await page.click('.errloading > span.nc-lang-cnt > a')
                }
                await page.waitFor(2000);
                const huaText = await page.$('#nc_1__scale_text');
                if(huaText){
                    const text = await page.$eval('#nc_1__scale_text > span.nc-lang-cnt', el=>el.innerHTML);
                    if(text.indexOf('验证通过') > -1){
                        break
                    }
                }
            }
        }
        const count = await page.$eval('.shop-count b', el=>el.innerText);
        if(parseInt(count) === 0){      // 先存上，防止重复爬取
            data['wangwang'] = wangwang;
            data['error'] = 1;
            await saveData(data);
            console.log('查询到 0 家店铺');
            continue
        }

        let li = await page.$$('#list-container li');
        if(li === null){
            await page.waitFor(3000);
            li = await page.$$('#list-container li');
        }
        // // 比较前5个 旺旺，防止第一个不是 根据旺旺的 搜索结果
        // let index = 0;
        // for(let i=0; i<5; i++){
        //     const inner = await li[i].$eval('ul span.H', el=>el.innerText);
        //     if(inner === wangwang){
        //         index = i;
        //         break
        //     }
        // }
        // await page.waitFor(2000);
        const isNone = await li[0].$('ul div.shop-products-none');
        if(isNone !== null){
            console.log('店铺无 商品 或下架');  // 先存上，防止重复爬取
            data['wangwang'] = wangwang;
            data['error'] = 1;
            await saveData(data);
            continue
        }
        // 比较第一个是否为 搜索的结果
        // const inner = await li[0].$eval('ul span.H', el=>el.innerText);
        const inner = await li[0].$eval('ul .shop-info-list a', el=>el.innerText);
        console.log(inner);
        if(inner.toString().trim() !== wangwang.toString().trim()){
            console.log('搜索结果不匹配');  // 先存上，防止重复爬取
            data['wangwang'] = wangwang;
            data['error'] = 1;
            await saveData(data);
            continue
        }
        const product = await li[0].$eval('ul div.one-product:nth-child(1) a', el=>el.href);
        await page.goto(product, {waitUntil: 'domcontentloaded'});
        // await product.click();
        // await page.waitFor(8000);
        const shop_config = await page.evaluate(()=> window.g_config);
        // console.log(shop_config)
        if(shop_config.hasOwnProperty('categoryId')){       // 天猫店
            data['cid'] = shop_config['categoryId'];
            data['rcid'] = shop_config['rootCategoryId'];
        }else {
            data['cid'] = shop_config['idata']['item']['cid'];
            data['rcid'] = shop_config['idata']['item']['rcid'];
        }
        console.log(data);
        await page.waitFor(2000);
        await saveData(data);
    }
    console.log('爬取完成');
    process.exit();
};

// 存储数据
const saveData = async(data) =>{
    let db = await mongoQuery();
    // 存入数据
    await db.collection('shop_wangwang_category').deleteMany({'wangwang': data.wangwang});
    await db.collection('shop_wangwang_category').insertOne(data);
};

// 获取 运营 超直钻 投放和暂停的店铺( 已过滤 )
const getShopAll = async() => {
    const sqls = 'select\n' +
    '       distinct t_order.f_copy_wangwangid\n' +
    'from t_order\n' +
    '         left join t_product on t_order.f_foreign_product_id = t_product.id\n' +
    'left join t_task on t_order.id = t_task.f_foreign_order_id ' +
    'where t_product.f_foreign_sku_kind in (\'淘宝/天猫代运营\', \'钻展\', \'超级推荐\', \'直通车\')' +
        ' and t_task.f_agreement_due_date >= \'2019-01-01 00:00:00\';';
        // ' and t_task.created_at >= \'2019-01-01 00:00:00\';';
    // '  and t_order.f_foreign_order_state_id in (2, 3);';
    // console.log(sqls)
    let shop_lists = await mysqlCfgSql(config.mysql_boss, sqls);
    shop_lists = Object.values(shop_lists);
    console.log(shop_lists.length);

    // 去重
    let db = await mongoQuery();
    const data = await db.collection('shop_wangwang_category').find().project({_id:0, wangwang:1}).toArray();
    let del_index_arr = [];
    if(data){
        shop_lists.forEach((shop, index, array)=>{
            let shop_num = 0;
            data.forEach((d, i, a)=>{
                // console.log(shop['wangwang']);
                // console.log(d);
                if (shop['f_copy_wangwangid'] === d['wangwang']){
                    del_index_arr.push(index)

                }
            });
        });
        // 删除数组
        del_index_arr.sort(function(a,b){
            return b - a
        });
        del_index_arr.forEach(function(index) { shop_lists.splice(index, 1)})
    }

    if (shop_lists.length>0){
        console.log(shop_lists.length);
        return shop_lists;
    } else{
        console.log(' 没有需要爬取的wangwang');
        process.exit()
    }
};

// 设置page
const setPage = async(browser, cookies) => {
    let page = await setJs(await browser.newPage());

    page.setDefaultTimeout(50000);
    page.setDefaultNavigationTimeout(50000);
    page.setViewport({
        width: 1376,
        height: 1376
    });

    if(cookies && cookies.f_raw_cookies){
        // 赋予浏览器圣洁的cookie
        await asyncForEach(cookies.f_raw_cookies.sycmCookie, async (value, index) => {
            await page.setCookie(value);
        });
    }
    return page;
};

(async() => {
    let today = moment(new Date()).format("YYYY-MM-DD");
    // 用子账号登录
    let db = await mongoQuery();
    let cookies = await db.collection('sub_account_login').find({'f_date':today, 'f_valid_status': 1}).
    project({_id:0, f_raw_cookies:1}).toArray();
    // project({_id:0, f_raw_cookies:1}).limit(19).toArray();

    const browser = await puppeteer.launch({
        headless: config.headless,
        args: [
        ],
        // slowMo:1000,
        ignoreDefaultArgs: ["--enable-automation"]
    });

    let page = await setPage(browser, cookies[1]);

    await startCrawl(page);
})();