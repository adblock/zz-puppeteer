const config = require('../../config');
const {asyncForEach,getUrlParams} = require('../../commons/func');
const dateFormat = require('dateformat');
const {mysqlCfgSql} = require('../../commons/db');
const {canmouJiaoyi} = require('../../model/canmouJiaoyi');
const moment = require('moment');

/**
 * 生意參謀类 交易数据爬虫的计划任务 （可以 传入某个店铺 和 日期 获取补抓）
 */
class CanmouJiaoyiCrontabNew {
  constructor(option) {
    this._crawlDateArray = option.crawlDateArray; // 店铺列表
  }

  /**
   * 初始化函数
   * @param option
   * */
  init = async (option) => {
    this._wangwang = option.wangwang; // 旺旺
    this._page = option.page; // 页面
    this._mongo = option.mongo; // mongo查询
    this._nextRound = option.nextRound; // 下一轮
    await this.startCrawl(0);
  };
  /**
   * 爬数据
   * */
  startCrawl = async (retry) => {
    try {
      let token = '';
      let mainUserName = '';
      let insert = 0;
      let crawlDateByWangwang = [];
      let crawlDateCount = 0;
      let insertData = [];
      let suberr = 0;    //标识进入下一个店铺
      //获取旺旺id对应应爬取日期及其个数
      await asyncForEach(this._crawlDateArray, async (ele, index) => {
        if (ele.wangwang === this._wangwang) {
          crawlDateByWangwang.push(ele)
          crawlDateCount += 1;
        }
      });
      // 订阅 reponse 事件，参数是一个 reponse 实体
      await this._page.on('response', async (response) => {
        try {
          // 出现滑块
          if (response.url().indexOf('_____tmd_____/punish') !== -1) {
            await this._page.waitFor(3000);
            suberr = 1;
          }

          //获取token
          if (response.url().indexOf('sycm.taobao.com/custom/menu/getPersonalView.json') !== -1) {
            token = await getUrlParams(response.url(), 'token');
            const personalView = await response.json();
            mainUserName = personalView.data.mainUserName.toLowerCase();
          }

          // 找接口获取数据
          if (response.url().indexOf('get_summary.json') > -1) {
            const date = await getUrlParams(response.url(), 'dateRange');
            const preDate = date.split("|")[1];
            const summary = await response.json();
            let data = summary['data'];
            data.crawlDate = preDate;
            insertData.push(data);
          }

          if (insertData && insertData.length === crawlDateCount && insert === 0) {
            insert = 1;
            const now = new Date();
            if (this._wangwang.toLowerCase() === mainUserName) {
              await asyncForEach(insertData, async (ele, index) => {
                let crawlDate = ele.crawlDate;
                let datas = {
                  data: ele,
                  created_at: now,
                  updated_at: now,
                  date: dateFormat(crawlDate, "yyyy-mm-dd"),
                  shop: this._wangwang,
                  mouth: dateFormat(crawlDate, 'm'),
                };
                //  console.log(datas);
                // 存入数据
                console.log('save data............')
                await this._mongo.db.collection('canmou.jiaoyi_data').deleteMany({
                  'shop': this._wangwang,
                  'date': dateFormat(crawlDate, "yyyy-mm-dd")
                });
                await this._mongo.db.collection('canmou.jiaoyi_data').insertOne(datas);
                await this.saveMysql(datas, dateFormat(crawlDate, "yyyy-mm-dd"))
              });
              //验证sql店铺的数据是否重复
              if(retry<3){
                retry = retry + 1;
                await this.checkMysqlDayCount(retry);
              }
            }

            // 重新启动
            await this._nextRound(this._wangwang);
          }
        } catch (e) {
          console.log(e);
          //写空数据到mysql
          await this.saveMysqlWithNull(crawlDateByWangwang)
          await this._nextRound(this._wangwang);
        }
      });

      const homeUrl = 'http://sycm.taobao.com/portal/home.htm';
      await this._page.goto(homeUrl, {waitUntil: 'networkidle2'});

      //如果跳登录页面则表示Cookie过期 或生意参谋未授权
      if (this._page.url().indexOf('custom/login.htm') !== -1 || this._page.url().indexOf('custom/no_permission') !== -1 ||suberr === 1) {
        console.error('Cookie过期或生意参谋未授权');
        //写空数据到mysql
        await this.saveMysqlWithNull(crawlDateByWangwang);
        await this._nextRound(this._wangwang);
      } else {
        console.error('登录正常')
        //循环更改并请求接口
        await this.fetchUrl(crawlDateByWangwang, token);
      }
    } catch (e) {
      // console.log(e);
    }
  };
  fetchUrl = async (crawlDateByWangwang, token) => {
    const crawl_date = crawlDateByWangwang.shift();
    const crawl_date_start = crawl_date.crawl_date_start;
    const crawl_date_end = crawl_date.crawl_date_end;

    let timestamp = Date.parse(new Date());//时间戳
    let url = 'https://sycm.taobao.com/bda/tradinganaly/overview/get_summary.json?dateRange=' + crawl_date_start + '%7C' + crawl_date_end + '&dateType=month&token=' + token + '&device=0&_=' + timestamp;
    console.log(url);
    await this._page.evaluate((url) => {
      fetch(new Request(url, {
        headers: {
          'referer': 'https://sycm.taobao.com/portal/home.htm',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36'
        }
      }))
    }, url);

    if (crawlDateByWangwang.length > 0) {
      return this.fetchUrl(crawlDateByWangwang, token)
    }
  }
  /***
   *  存储mysql
   */
  saveMysql = async (detail, crawl_date) => {
    const sql_column = "select COLUMN_NAME from information_schema.COLUMNS where table_name = 't_sycm_jiaoyi'"
    let column_list = await mysqlCfgSql(config.mysql_zhizuan, sql_column);
    // 先删除数据
    let sql_del = "delete from t_sycm_jiaoyi where f_date = '" + crawl_date + "' and f_shop = '" + this._wangwang + "'";
    await mysqlCfgSql(config.mysql_zhizuan, sql_del);
    let detailObj = {};
    try {
      let now = moment().format("YYYY-MM-DD HH:mm:ss")
      detailObj['created_at'] = crawl_date + ' 08:00:00';
      detailObj['updated_at'] = now;
      detailObj['f_insert_type'] = 1;
      const jiaoyi = detail['data'];
      column_list.forEach((ele, index) => {
        let column = ele['COLUMN_NAME'];
        if (column.indexOf('f_') > -1) {
          let col = column.substring(2);
          if (col in detail) {
            detailObj[column] = detail[col];
          }
          if (col in jiaoyi) {
            if (col.indexOf('Rate') > -1) {     // 率 的转成百分比 但不带百分号
              detailObj[column] = Number(jiaoyi[col] * 100).toFixed(2);
            } else {
              detailObj[column] = jiaoyi[col]
            }

          }
        }
      });
    } catch (e) {
      console.error(e)
    }
    // 插入数据
    const result = await canmouJiaoyi.create(detailObj);
    //  console.log(result)
  }

  //再次验证sql 店铺 存储数据的准确性
  checkMysqlDayCount = async (retry) => {
    let sycm_date = [];
    let day = dateFormat(new Date(new Date().getTime() - 24 * 60 * 60 * 1000), 'dd');
    let mouth = dateFormat(new Date(new Date().getTime() - 24 * 60 * 60 * 1000), 'yyyy-mm');    // 本月

    //获取已插入生意参谋日数据
    const sycm_index_sql = "select f_date from t_sycm_jiaoyi where f_insert_type = 1 and f_date like'" + mouth + "%' and f_shop='" + this._wangwang + "'";
    const sycm_index = await mysqlCfgSql(config.mysql_zhizuan, sycm_index_sql);
    sycm_index.forEach((element, index) => {
      sycm_date.push(element.f_date.slice(-2));
    });
    //判断店铺数据的准确性：是否存在重复
    sycm_date = Array.from(new Set(sycm_date));
    console.log(sycm_date.length,'-->',parseInt(day));
    if(sycm_date.length !== parseInt(day)){
      console.log('重试次数',retry);
      //重新爬取
      await this.startCrawl(retry);
    }else{
      console.log(this._wangwang,'存储okok');
    }
  }

  /***
   *  存储空数据到mysql
   */
  saveMysqlWithNull = async (crawl_date) => {
    await asyncForEach(crawl_date, async (ele, index) => {
      const sql_column = "select COLUMN_NAME from information_schema.COLUMNS where table_name = 't_sycm_jiaoyi'";
      let column_list = await mysqlCfgSql(config.mysql_zhizuan, sql_column);
      let sql_del = "delete from t_sycm_jiaoyi where f_date = '" + ele.crawl_date_end + "' and f_shop = '" + this._wangwang + "'";
      // 先删除数据
      await mysqlCfgSql(config.mysql_zhizuan, sql_del);
      let detailObj = {};
      try {
        let now = moment().format("YYYY-MM-DD HH:mm:ss");
        await asyncForEach(column_list, async (ele, index) => {
          let column = ele['COLUMN_NAME'];
          if (column.indexOf('f_') > -1) {
            detailObj[column] = 0;
          }
        });
        detailObj['created_at'] = ele.crawl_date_end + ' 08:00:00';
        detailObj['updated_at'] = now;
        detailObj['f_insert_type'] = 2;
        detailObj['f_shop'] = this._wangwang;
        detailObj['f_date'] = ele.crawl_date_end;
        detailObj['f_mouth'] = dateFormat(ele.crawl_date_end, 'm');
      } catch (e) {
        console.error(e)
      }
      // console.log(detailObj)
      // 插入多条数据
      const result = await canmouJiaoyi.create(detailObj);
      // console.log(result)
    });
  };

}

module.exports = { CanmouJiaoyiCrontabNew };
