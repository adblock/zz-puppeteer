const { ZhitongcheHistorySpider } = require('./class/ztc_report_history_spider.class');
const { JupinSpider } = require('../jupin_spider/jupin_spider.class');
const { getCZZShopBoss, dropHistoryShopList } = require('../commons/func');
const { getYesterday } = require('../commons/dateFunc');
process.setMaxListeners(999999999);

(async ()=>{
  //page分页
  const args = process.argv.splice(2);
  // 爬虫的抓取数据的时间
  let crawlDate = args[2];
  if (crawlDate === undefined) {
    crawlDate = await getYesterday()
  }
  let table_name = 'zhitongche.ztc_history_shop_data';
  let shop_list = await getCZZShopBoss('直通车', [args[0],args[1]]);
  // 新的的店铺列表
  const shopList = await dropHistoryShopList(shop_list, table_name, crawlDate);
  // 爬虫逻辑的实例
  const zhitongcheHistorySpider = new ZhitongcheHistorySpider({
    'crawlDate':crawlDate
  });
  // 爬虫公用逻辑实例
  const jupinSpider = new JupinSpider({
    'shopList':shopList,
    'spider': zhitongcheHistorySpider
  });
  // 启动吧
  await jupinSpider.init();
})();
