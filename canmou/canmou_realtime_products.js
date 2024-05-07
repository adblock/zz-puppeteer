/**
 * 生意参谋 -> 实时数据 :  实时->实时榜单 /首页 -> 实时概况
 */
const { JupinSpiderYunying } = require('../jupin_spider/jupin_spider_yunying.class');
const { CanmouRealtimeProductsSpider } = require('./class/canmou_realtime_products.class');
const { getAllShopBossNew } = require('../commons/func');
const dateFormat = require('dateformat');
process.setMaxListeners(999999999);

(async ()=>{
    const args = process.argv.splice(2);
    // 爬虫的抓取数据的时间
    const crawlDate = dateFormat(new Date(), "yyyy-mm-dd");
    // 店铺列表
    const shopList = await getAllShopBossNew([args[0],args[1]]);
    // 爬虫逻辑的实例
    const canmouRealtimeProductsSpider = new CanmouRealtimeProductsSpider({
        'crawlDate':crawlDate
    });
    // 爬虫公用逻辑实例
    const jupinSpider = new JupinSpiderYunying({
        'shopList':shopList,
        'spider': canmouRealtimeProductsSpider
    });
    // 启动吧
    await jupinSpider.init();
})();
