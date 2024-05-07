const { YinlimofangReportAnalysisData } = require('./class/yinlimofang_report_analysis_data');
const { JupinSpider } = require('../jupin_spider/jupin_spider.class');
const { getCZZShopBoss } = require('../commons/func');
const dateFormat = require('dateformat');
process.setMaxListeners(999999999);

(async ()=>{
    //page分页
    const args = process.argv.splice(2);
    // 爬虫的抓取数据的时间
    const crawlDate = dateFormat(new Date(), "yyyy-mm-dd");

    let shop_list = await getCZZShopBoss();
    // 爬虫逻辑的实例
    const yinlimofangSpider = new YinlimofangReportAnalysisData({
        'crawlDate':crawlDate,
        'start':args[0],
        'end':args[1]
    })
    // 爬虫公用逻辑实例
    const jupinSpider = new JupinSpider({
        'shopList':shop_list,
        'spider': yinlimofangSpider
    });
    // 启动吧
    await jupinSpider.init();
})();
