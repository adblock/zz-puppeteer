const { JupinSpiderYunying } = require('../jupin_spider/jupin_spider_yunying.class');
const { ShopCouponsDataSpider } = require('./class/qianniu_shop_coupons.class');
const { getAllShopBoss } = require('../commons/func');
const dateFormat = require('dateformat');

process.setMaxListeners(999999999);

(async ()=>{
    const args = process.argv.splice(2);
    // 爬虫的抓取数据的时间
    const crawlDate = dateFormat(new Date(), "yyyy-mm-dd");
    // 店铺列表
    const shopList = await getAllShopBoss();
    // 爬虫逻辑的实例
    const qianniuShopCouponsDataSpider = new ShopCouponsDataSpider({
        'crawlDate':crawlDate
    });
    // 爬虫公用逻辑实例
    const jupinSpider = new JupinSpiderYunying({
        'shopList':shopList,
        'spider': qianniuShopCouponsDataSpider
    });
    // 启动吧
    await jupinSpider.init();
})();
