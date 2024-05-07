/*
@File     ：report_analysis_spider.py
@Author   ：qingyang
@Date     ：2021/8/24 13:43 
@describe ：
*/
const { JupinSpider } = require('../jupin_spider/jupin_spider.class');
const { ZzReportAnalysisData } = require('./class/zz_report_analysis_data');
const { getCZZShopBoss } = require('../commons/func');
const dateFormat = require('dateformat');
process.setMaxListeners(999999999);

(async ()=>{
  const args = process.argv.splice(2);
  // 爬虫的抓取数据的时间
  const crawlDate = dateFormat(new Date(), "yyyy-mm-dd");
  // 店铺列表
  const shopList = await getCZZShopBoss('钻展');
  // 爬虫逻辑的实例
  const zzReportSpider = new ZzReportAnalysisData({
    'crawlDate':crawlDate,
    'start':args[0],
    'end':args[1]
  });
  // 爬虫公用逻辑实例
  const jupinSpider = new JupinSpider({
    'shopList':shopList,
    'spider': zzReportSpider
  });
  // 启动吧
  await jupinSpider.init();
})();
