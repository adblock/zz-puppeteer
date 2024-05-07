const { JupinSpiderYunying } = require('../jupin_spider/jupin_spider_yunying.class');
const {CanmouJiaoyiCrontabNew} = require('./class/canmou_jiaoyi_crontab_new.class');
const config = require('../config');
const {asyncForEach, getAllShopBossNew} = require('../commons/func');
const dateFormat = require('dateformat');
const {mysqlCfgSql} = require('../commons/db');


process.setMaxListeners(999999999);
let shopList = [];      // 店铺列表
let shopListOrg = [];   // 原始的店铺列表
let crawlDateArray = []; // 抓取数据的时间数组
let getOne = 1;//获取单店数据
let getMany = 2;//获取多店数据
let shop_lists = [];
(async () => {
  shop_lists = await getAllShopBossNew(); //流量运营的店铺
  const args = process.argv.splice(2);
  if (args.length === 2) {
    // 店铺和日期都输入
    shopList.push({
      wangwang: args[0],
      f_copy_wangwangid : args[0],
      retry: 0
    });
    shopListOrg.push({
      wangwang: args[0],
      f_copy_wangwangid : args[0],
      retry: 0
    });
    crawlDateArray.push({
      wangwang: args[0],
      f_copy_wangwangid : args[0],
      crawl_date_start: dateFormat(args[1], "yyyy-mm") + '-01',
      crawl_date_end: args[1]
    })
  } else if (args.length === 1) {   // 只传一个参数
                                    // 判断传入的是日期还是店铺
    if (args[0].match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
      await setShopListByDate(args[0]);
    } else {
      let new_shop_lists = [];
      await setShopListByWangwang(args[0], new_shop_lists, shop_lists, getOne);
    }
  } else {
    let new_shop_lists = [];
    const copy_shop_lists = shop_lists;
    await asyncForEach(shop_lists, async (ele, index) => {
      await setShopListByWangwang(ele.f_copy_wangwangid, new_shop_lists, copy_shop_lists, getMany);
    });
  }
  // 爬虫逻辑的实例
  const canmouJiaoyiCrontabNew = new CanmouJiaoyiCrontabNew({
    'crawlDateArray': crawlDateArray
  });
  // 爬虫公用逻辑实例
  const jupinSpider = new JupinSpiderYunying({
    'shopList': shopList,
    'spider': canmouJiaoyiCrontabNew
  });
  // 启动吧
  await jupinSpider.init();
})();

/***
 *   获取特定日期店铺列表
 */
const setShopListByDate = async (crawl_date) => {
  let new_sycm_index = [];
  let new_shop_lists = [];

  //获取已插入生意参谋日数据
  const sycm_index_sql = "select f_shop from t_sycm_jiaoyi where f_insert_type = 1 and f_date='" + crawl_date + "'";
  const sycm_index = await mysqlCfgSql(config.mysql_zhizuan, sycm_index_sql);
  sycm_index.forEach((element, index) => {
    new_sycm_index.push(element.f_shop)
  });

  let shop_lists = await getAllShopBossNew();
  shop_lists.forEach(function (value) {
    if (new_sycm_index.includes(value.f_copy_wangwangid) === false) {
      new_shop_lists.push({
        wangwang: value.f_copy_wangwangid,
        f_copy_wangwangid : value.f_copy_wangwangid,
        retry: 0
      });
      crawlDateArray.push({
        wangwang: value.f_copy_wangwangid,
        f_copy_wangwangid : value.f_copy_wangwangid,
        crawl_date_start: dateFormat(crawl_date, "yyyy-mm") + '-01',
        crawl_date_end: crawl_date
      })
    }
  });

  if (new_shop_lists.length > 0) {
    shopList = JSON.parse(JSON.stringify(new_shop_lists));
    shopListOrg = JSON.parse(JSON.stringify(new_shop_lists));
  } else {
    console.log('暂无需要爬取数据的店铺');
    process.exit()
  }
};

/***
 *    获取特定店铺
 */
const setShopListByWangwang = async (wangwang, new_shop_lists, shop_lists, type) => {
  let new_sycm_index = [];

  const day = dateFormat(new Date(new Date().getTime() - 24 * 60 * 60 * 1000), 'dd');
  const mouth = dateFormat(new Date(new Date().getTime() - 24 * 60 * 60 * 1000), 'yyyy-mm');    // 本月

  //获取已插入生意参谋日数据
  const sycm_index_sql = "select f_date from t_sycm_jiaoyi where f_insert_type = 1 and f_date like'" + mouth + "%' and f_shop='" + wangwang + "'";
  const sycm_index = await mysqlCfgSql(config.mysql_zhizuan, sycm_index_sql);
  sycm_index.forEach((element, index) => {
    new_sycm_index.push(element.f_date)
  });

  //获取待写入店铺
  shop_lists.forEach(function (value) {
    if (value.f_copy_wangwangid === wangwang && sycm_index.length !== parseInt(day)) {
      new_shop_lists.push({
        wangwang: wangwang,
        f_copy_wangwangid : wangwang,
        retry: 0
      });
    }
  });
  //获取店铺对应的应爬取日期
  for (let i = 1; i <= day; i++) {
    const crawl_date = mouth + '-' + ('0' + i).slice(-2);
    if (new_sycm_index.includes(crawl_date) === false) {
      crawlDateArray.push({
        wangwang: wangwang,
        f_copy_wangwangid : wangwang,
        crawl_date_start: dateFormat(crawl_date, "yyyy-mm") + '-01',
        crawl_date_end: crawl_date
      })
    }
  }

  if (crawlDateArray.length > 0) {
    shopList = JSON.parse(JSON.stringify(new_shop_lists));
    shopListOrg = JSON.parse(JSON.stringify(new_shop_lists));
  } else {
    console.log(wangwang + '：暂无需要爬取的数据');
    if (type === 1) {
      process.exit()
    }
  }
};
