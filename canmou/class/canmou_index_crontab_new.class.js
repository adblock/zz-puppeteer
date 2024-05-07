/**
 * 生意參謀 首页数据爬虫的计划任务（可以 传入某个店铺 和 日期 获取补抓）
 */
const config = require('../../config');
const {asyncForEach, getUrlParams} = require('../../commons/func');
const dateFormat = require('dateformat');
const {timestampToTime} = require('../../commons/dateFunc')
const {mysqlCfgSql} = require('../../commons/db');
const {canmouIndex} = require('../../model/canmouIndex');
const moment = require('moment');

class CanmouIndexCrontabNew {
  constructor(option) {
    this._crawlDateArray = option.crawlDateArray; // 抓取数据的时间数组
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
    await this.startCrawl();
  };
  /**
   * 爬数据
   * */
  startCrawl = async (retry = 0) => {
    try {
      let token = '';
      let mainUserName = '';
      let shopSurvey = null;
      let crawlDateCount = 0;
      let crawlDateByWangwang = [];
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

          if (response.url().indexOf('https://sycm.taobao.com/portal/month/overview.json') > -1) {
            shopSurvey = await response.json();
          }

        } catch (e) {
          console.log(e);
          //写空数据到mysql
          await this.saveMysqlWithNull(crawlDateByWangwang);
          await this._nextRound(this._wangwang);
        }
      });
      const homeUrl = 'http://sycm.taobao.com/portal/home.htm';
      await this._page.goto(homeUrl, {waitUntil: 'networkidle2'});

      //如果跳登录页面则表示Cookie过期 或生意参谋未授权,或出现滑块
      if (this._page.url().indexOf('custom/login.htm') !== -1 || this._page.url().indexOf('custom/no_permission') !== -1 || suberr === 1) {
        console.error('Cookie过期或生意参谋未授权');
        //写空数据到mysql
        await this.saveMysqlWithNull(crawlDateByWangwang);
        await this._nextRound(this._wangwang);
      } else {
        console.log('登录正常');
        //循环更改日期,获取数据
        let yunYing = await this.getYunyingDayData(crawlDateByWangwang, token);

        if (shopSurvey && yunYing.length === crawlDateCount) {
          if (this._wangwang.toLowerCase() === mainUserName) {
            //存储数据的格式
            await this.saveYunyingData(yunYing, shopSurvey);
            if (retry < 3) {
              await this.checkMysqlDayCount(retry);    //验证sql店铺的数据是否重复
            }
          }
        } else{
          console.log(yunYing.length, '  !==  ', crawlDateCount);
        }
        // 重新启动
        await this._nextRound(this._wangwang);
      }
    } catch (e) {
      console.log(e.message);
    }
  };

  /**
   * 发送请求，获取数据
   * @param crawlDateByWangwang  需要爬取的日期
   * @param token                token
   * @returns {Promise<[]>}      获取的数据列表
   */
  getYunyingDayData = async (crawlDateByWangwang, token) => {
    let yunying_list = [];
    //遍历日期列表，请求接口的数据
    while (crawlDateByWangwang.length > 0) {
      const crawl_date = crawlDateByWangwang.shift().crawl_date;
      let url = 'https://sycm.taobao.com/portal/coreIndex/getShopMainIndexes.json?device=0&dateType=day&dateRange=' + crawl_date + '%7C' + crawl_date + '&device=0&token=' + token;
      console.log(url);
      await this._page.waitFor(200);
      let resp = await this.sendReauest(url);
      if(resp['content'].hasOwnProperty('data')){
        yunying_list.push(resp);
      }
      if(resp['content']['message'].includes('系统出错')){
        yunying_list.push({'content':{'data':{'statDate':crawl_date}},'hasError':true});
      }
    }
    return yunying_list;
  }

  /**
   * 设置保存数据的格式
   * @param yunYing           数据列表
   * @param shopSurvey        shopSurvey
   * @returns {Promise<void>}
   */
  saveYunyingData = async(yunYing, shopSurvey)=>{
    await asyncForEach(yunYing, async (ele, index) => {
      const data = {
        'shopSurvey': shopSurvey['content']['data'],
        'yunYing': ele['content']['data']
      };
      let crawl_date;
      if(ele['content']['data']['statDate'] == undefined){
        return  true;
      }
      if(ele['hasError']){
        crawl_date = ele['content']['data']['statDate'];
      }else{
        crawl_date = await timestampToTime(ele['content']['data']['statDate']);
      }

      // 获取 星期几
      const weekArr = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
      const week = weekArr[dateFormat(crawl_date, 'N') - 1];
      let datas = {
        data: data,
        created_at: new Date(),
        updated_at: new Date(),
        date: dateFormat(crawl_date, "yyyy-mm-dd"),
        shop: this._wangwang,
        week: week,
      };
      // 存入数据
      console.log('save shop index data............')
      await this._mongo.db.collection('canmou.index_data').deleteMany({
        'shop': this._wangwang,
        'date': dateFormat(crawl_date, "yyyy-mm-dd")
      });
      await this._mongo.db.collection('canmou.index_data').insertOne(datas);

      await this.saveMysql(datas, dateFormat(crawl_date, "yyyy-mm-dd"))
    });
  }

  /***
   *  存储mysql
   */
  saveMysql = async (detail, crawl_date) => {
    const sql_column = "select COLUMN_NAME from information_schema.COLUMNS where table_name = 't_sycm_index'";
    let column_list = await mysqlCfgSql(config.mysql_zhizuan, sql_column);
    let sql_del = "delete from t_sycm_index where f_date = '" + crawl_date + "' and f_shop = '" + this._wangwang + "'";
    // 先删除数据
    await mysqlCfgSql(config.mysql_zhizuan, sql_del);
    let detailObj = {};
    try {
      let now = moment().format("YYYY-MM-DD HH:mm:ss");
      detailObj['created_at'] = crawl_date + ' 08:00:00';

      detailObj['updated_at'] = now;
      detailObj['f_insert_type'] = 1;
      const shopSurvey = detail['data']['shopSurvey'];
      const yunYing = detail['data']['yunYing'];
      await asyncForEach(column_list, async (ele, index) => {
        let column = ele['COLUMN_NAME'];
        if (column.indexOf('f_') > -1) {
          let col = column.substring(2);
          if (col in detail) {
            detailObj[column] = detail[col];
          }
          if (col in yunYing) {         // 运营视窗数据
            let col_value = yunYing[col]['value'];      // 数值
            if (!col_value) {                            // 数据为null时
              col_value = null;
            }
            if (col.indexOf('Rate') > -1) {     // 率 的转成百分比 但不带百分号
              detailObj[column] = Number(col_value * 100).toFixed(2);
            } else {                            // value
              detailObj[column] = col_value;
            }
            let columnCyc = column + '_cycle';     // 上升下降 转成百分比但不带百分号
            let point = yunYing[col]['cycleCrc'];
            if (!point) {
              detailObj[columnCyc] = point;
            } else {
              detailObj[columnCyc] = Number(point * 100).toFixed(2);
            }

          } else if (col in shopSurvey) {         // 店铺概况 数据字段
            const yesterday = dateFormat(new Date(new Date().getTime() - 24 * 60 * 60 * 1000), "yyyy-mm-dd");
            if (crawl_date === yesterday) {
              let surveyData = shopSurvey[col];
              if ('rankCycleCqc' === col) {        // 店铺排名变化，需要判断上升下降
                if (surveyData > 0) {
                  surveyData = '-' + surveyData.toString()
                } else {
                  surveyData = surveyData.toString().replace('-', '')
                }
              }
              detailObj[column] = surveyData
            } else {
              detailObj[column] = 0
            }
          } else {
            if (col === 'chargeRate') {
              let chargeRate = 0;
              if ('value' in yunYing['zzExpendAmt'] && 'value' in yunYing['feedCharge'] && 'value' in yunYing['p4pExpendAmt'] && 'value' in yunYing['payAmt'] && yunYing['payAmt']['value'] !== 0) {
                chargeRate = (yunYing['zzExpendAmt']['value'] + yunYing['feedCharge']['value'] + yunYing['p4pExpendAmt']['value']) / yunYing['payAmt']['value'];
                chargeRate = Number(chargeRate * 100).toFixed(2);
              }
              detailObj[column] = chargeRate
            }
            if (col === 'tkExpendAmtRate') {
              let tkRate = 0;
              if ('value' in yunYing['tkExpendAmt'] && 'value' in yunYing['payAmt'] && yunYing['payAmt']['value'] !== 0) {
                tkRate = yunYing['tkExpendAmt']['value'] / yunYing['payAmt']['value'];
                tkRate = Number(tkRate * 100).toFixed(2);
              }
              detailObj[column] = tkRate
            }
            if (col === 'without_false_sales') {  // 销售额去水后的金额 默认值是 日销售额，如果有去水值，把去水后金额写入
              const sql_sales = "select * from t_sycm_sales_without_false where f_wangwangid='" +
                      detail['shop'] + "' and f_date='" + detail['date'] + "'";
              const sales = await mysqlCfgSql(config.mysql_zhizuan, sql_sales);
              if (sales.length === 0) {
                detailObj[column] = yunYing['payAmt']['value']
              } else {
                detailObj[column] = Number(yunYing['payAmt']['value']) - Number(sales[0]['f_sales_without_false'])
              }
            }
          }
        }
      });
    } catch (e) {
      console.error(e)
    }
    // 插入多条数据
    const result = await canmouIndex.create(detailObj);
    // console.log(result)
  };

  //再次验证sql 店铺 存储数据的准确性
  checkMysqlDayCount = async (retry) => {
    let sycm_date = [];
    let day = dateFormat(new Date(new Date().getTime() - 24 * 60 * 60 * 1000), 'dd');
    let mouth = dateFormat(new Date(new Date().getTime() - 24 * 60 * 60 * 1000), 'yyyy-mm');    // 本月

    //获取已插入生意参谋日数据
    let sycm_index_sql = "select f_date from t_sycm_index where f_insert_type = 1 and f_date like'" + mouth + "%' and f_shop='" + this._wangwang + "'";
    let sycm_index = await mysqlCfgSql(config.mysql_zhizuan, sycm_index_sql);
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
    // 获取 星期几
    const weekArr = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

    await asyncForEach(crawl_date, async (ele, index) => {
      const sql_column = "select COLUMN_NAME from information_schema.COLUMNS where table_name = 't_sycm_index'";
      let column_list = await mysqlCfgSql(config.mysql_zhizuan, sql_column);
      let sql_del = "delete from t_sycm_index where f_date = '" + ele.crawl_date + "' and f_shop = '" + this._wangwang + "'";
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
        detailObj['created_at'] = ele.crawl_date + ' 08:00:00';
        detailObj['updated_at'] = now;
        detailObj['f_insert_type'] = 2;
        detailObj['f_shop'] = this._wangwang;
        detailObj['f_date'] = ele.crawl_date;
        detailObj['f_week'] = weekArr[dateFormat(ele.crawl_date, 'N') - 1];
      } catch (e) {
        console.error(e)
      }
      // 插入多条数据
      const result = await canmouIndex.create(detailObj);
      console.log(result)
    });
  };

  /**
   * 发送请求的方法
   * @param {Object} page page类
   * @param {String} url  请求的url
   * */
  sendReauest = async (url)=>{
    return await this._page.evaluate(async (url) => {
      let headers = {
        'referer': 'https://sycm.taobao.com/portal/home.htm?',
        'sec-fetch-mode':'cors',
        'sec-fetch-site':'same-origin',
        'sec-fetch-dest':'empty',
        'content-type':'application/x-www-form-urlencoded; charset=UTF-8'
      };
      const response = await fetch(url, {headers:headers});
      return await response.json();
    },url);
  };

}
module.exports = { CanmouIndexCrontabNew };
