const { JupinSpider } = require('../jupin_spider/jupin_spider.class');
const { TuijianRealTimeSpider } = require('./class/tuijian_report_realtime_spider.class');
const { getCZZShopBoss } = require('../commons/func');
const dateFormat = require('dateformat');
process.setMaxListeners(999999999);

(async ()=>{
  const args = process.argv.splice(2);
  let page = null;
  // 爬虫的抓取数据的时间
  const crawlDate = dateFormat(new Date(), "yyyy-mm-dd");
  // 店铺列表
  const shopList = await getCZZShopBoss('超级推荐',[args[0],args[1]]);
  // 爬虫逻辑的实例
  const tuijianRealTimeSpider = new TuijianRealTimeSpider({
    'crawlDate':crawlDate
  });
  // 爬虫公用逻辑实例
  const jupinSpider = new JupinSpider({
    'shopList':shopList,
    'spider': tuijianRealTimeSpider
  });
  // 启动吧
  await jupinSpider.init();
})();
