/*
@File     ：campaign_data_spider.py
@Author   ：qingyang
@Date     ：2021/5/26 15:28 
@describe ：
*/

const { JupinSpider } = require('../jupin_spider/jupin_spider.class');
const { HudongCampaignDataSpider } = require('./class/campaign_data_spider.class');
const { getCZZShopBoss } = require('../commons/func');
const dateFormat = require('dateformat');
process.setMaxListeners(999999999);

(async ()=>{
  //page分页
  const args = process.argv.splice(2);
  // 爬虫的抓取数据的时间
  const crawlDate = dateFormat(new Date(), "yyyy-mm-dd");
  // 店铺列表
  const shopList = await getCZZShopBoss('超级互动城',[args[0],args[1]]);
  // 爬虫逻辑的实例
  const hudongCampaignDataSpider = new HudongCampaignDataSpider({
    'crawlDate':crawlDate
  });
  // 爬虫公用逻辑实例
  const jupinSpider = new JupinSpider({
    'shopList':shopList,
    'spider': hudongCampaignDataSpider
  });
  // 启动吧
  await jupinSpider.init();
})();
