const {asyncForEach,getAllShopBoss} = require('../commons/func');
const { getCookiesByMongo } = require("../commons/account");
const { getBrowser, getPage, sendReauest, saveCouponData } = require('./yunying_commons');

let G_wangwang = '';
let G_save_data = {};
const startCrawl = async(page) => {
    G_save_data = {};
    // await page.goto('https://myseller.taobao.com/home.htm#/index', {waitUntil:'networkidle0'});
    await page.goto('https://aliyx.taobao.com/coupon', {waitUntil:'networkidle0'});
    if(page.url().indexOf('aliyx.taobao.com/coupon') > -1){
        let coupon_data = [];
        // 店铺优惠券
        let shop_coupon_url = 'https://aliyx.taobao.com/coupon/getCouponList?couponType=0&pageSize=1000&currentPage=1';
        await fetchRec(page, shop_coupon_url, coupon_data);

        // 商品优惠券
        let item_coupon_url = 'https://aliyx.taobao.com/coupon/getCouponList?couponType=1&pageSize=100&currentPage=1';
        await fetchRec(page, item_coupon_url, coupon_data);

        // 裂变优惠券
        let fission_coupon_url = 'https://aliyx.taobao.com/coupon/getFissionCouponList?couponType=2&pageSize=100&currentPage=1';
        await fetchRec(page, fission_coupon_url, coupon_data);

        await saveCouponData(G_save_data, G_wangwang)
    } else {
        console.log('cookie 失效')
    }
};

/**
 * 递归获取所有优惠券
 * @param page
 * @param url
 * @param save_data
 * @returns {Promise<void>}
 */
const fetchRec = async(page, url, save_data) => {
    let resp = await sendReauest(page, url);
    if(resp['module']['list'].length > 0){
        save_data = save_data.concat(resp['module']['list']);
        let curr_page = url.match(/currentPage=(\d+)/)[1];
        let next_page = parseInt(curr_page) + 1;
        url = url.replace(/currentPage=(\d+)/, 'currentPage=' + next_page);
        await fetchRec(page, url, save_data)
    } else {
        let type = await judgeType(url);
        G_save_data[type] = save_data;
    }
};

/**
 * 根据url 判断当前优惠券类型
 * @param url
 * @returns {Promise<*>}
 */
const judgeType = async(url) => {
    let coupon_type = url.match(/couponType=(\d+)/)[1];
    console.log(coupon_type);
    // 优惠券类型：0：店铺优惠券  1：商品优惠券  2：裂变优惠券
    let coupon_dict = {0: 'shop', 1:'item', 2: 'fission'};
    return coupon_dict[parseInt(coupon_type)]
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