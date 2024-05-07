const { JupinSpider } = require('../jupin_spider/jupin_spider.class');
const { ZtcCampaignDataSpider } = require('./class/campaign_data_spider.class');
const { getNewShopBossByPPro } = require('../commons/func');
const dateFormat = require('dateformat');
process.setMaxListeners(999999999);

(async ()=>{
  //page分页
  const args = process.argv.splice(2);
  // 爬虫的抓取数据的时间
  const crawlDate = dateFormat(new Date(), "yyyy-mm-dd");
  // 店铺列表 产品平台
  const shopList = await getNewShopBossByPPro('淘宝/天猫',[args[0],args[1]]);
  // 爬虫逻辑的实例
  const ztcCampaignDataSpider = new ZtcCampaignDataSpider({
    'crawlDate':crawlDate
  });
  // 爬虫公用逻辑实例
  const jupinSpider = new JupinSpider({
    'shopList':shopList,
    'spider': ztcCampaignDataSpider
  });
  // 启动吧
  await jupinSpider.init();
})();
