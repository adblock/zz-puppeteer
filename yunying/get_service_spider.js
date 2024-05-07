const {asyncForEach, getAllShopBoss, getDataFromJsonp} = require('../commons/func');
const { getCookiesByMongo } = require("../commons/account");
const { getBrowser, getPage, saveServiceData } = require('./yunying_commons');

let G_wangwang = '';
let G_save_data = {};
const startCrawl = async(page) => {
    G_save_data = {};
    await page.goto('https://fuwu.taobao.com/ser/my_service.htm', {waitUntil:'networkidle0'});
    if(page.url().indexOf('uwu.taobao.com/ser/my_service.htm') > -1){
        const tabs = await page.$$('.btn-tabs .btn-tab');
        if(tabs.length > 0){
            await asyncForEach(tabs, async(tab, index)=>{
                await responseRec(page, tab);
            });
            if(Object.keys(G_save_data).length === 4){
                await saveServiceData(G_save_data, G_wangwang);
            }
        } else {
            console.log(tabs)
        }
    } else {
        console.log('cookie 失效')
    }
};

/**
 * 递归获取所有软件（监听response）
 * @param page
 * @param tab
 * @returns {Promise<void>}
 */
const responseRec = async(page, tab) => {
    let total = 0;      // 当前标签下的软件数量页数
    let save_data = [];
    //response 获取数据
    await page.on('response', async (response) => {
        try{
            if(response.url().indexOf('mtop.alibaba.topservice.myservice.list.query') > -1){
                const resp = await getDataFromJsonp(response);
                if(resp){
                    save_data = save_data.concat(resp['data']['list']);
                    if(total === 0){
                        total = parseInt(resp['data']['total'])
                    }
                }
            }
        }catch (e) {
            console.log(e)
        }
    });
    await tab.click();
    await page.waitFor(3000);
    if(total > 1) {
        for(; total>1; total--){
            let next = await page.$$('.btn-pagination > div > button:nth-child(2)');
            await next[1].click();
            await page.waitFor(3000)
        }
    }
    let type = await judgeType(await page.url());
    G_save_data[type] = save_data
};

/**
 * 根据url 判断当前软件标签
 * @param url
 * @returns {Promise<*>}
 */
const judgeType = async(url) => {
    let service_type = url.match(/tabIndex=(\d+)/)[1];
    // 软件标签：0：最常使用  1：未过期  2：已过期  3:最近购买
    let coupon_dict = {0: 'usual', 1:'valid', 2: 'invalid', 3: 'recent'};
    return coupon_dict[parseInt(service_type)]
};

(async() => {
    // 获取服务中运营店铺
    let shop_list = await getAllShopBoss();
    let browser = '';
    await asyncForEach(shop_list, async(value, index)=>{
        try{
            G_wangwang = value.f_copy_wangwangid;
            console.log(G_wangwang);
            let cookies = await getCookiesByMongo(G_wangwang);
            browser = await getBrowser();
            let page = await getPage(browser, cookies);     // 获取设置cookie的页面，如果cookie失效返回null
            if(page){
                await startCrawl(page);
                await browser.close();
            } else {
                console.log('cookie 失效');
                await browser.close();
            }
        } catch (e) {
            console.log(e);
            await browser.close();
        }
    });
    process.exit();
})();