const { JupinSpider } = require('../jupin_spider/jupin_spider.class');
const { ZuanzhanRealTimeSpider } = require('./class/zuanzhan_report_realtime_spider.class');
const { getCZZShopBoss } = require('../commons/func');
const dateFormat = require('dateformat');
process.setMaxListeners(999999999);

(async ()=>{
  const args = process.argv.splice(2);
  // 爬虫的抓取数据的时间
  const crawlDate = dateFormat(new Date(), "yyyy-mm-dd");
  // 店铺列表
  const shopList = await getCZZShopBoss('钻展',[args[0],args[1]]);
  // 爬虫逻辑的实例
  const zuanzhanRealTimeSpider = new ZuanzhanRealTimeSpider({
    'crawlDate':crawlDate
  });
  // 爬虫公用逻辑实例
  const jupinSpider = new JupinSpider({
    'shopList':shopList,
    'spider': zuanzhanRealTimeSpider
  });
  // 启动吧
  await jupinSpider.init();
})();
