/**
 * 钻展 历史数据爬取：最近7天的7天转化周期的环比 （暂定 爬取账户整体数据，过去7天 和环比7天）
 */

const {asyncForEach} = require('../../commons/func');
const moment = require('moment');

class ZuanzhanHistorySpider {
  constructor(option) {
    this._crawlDate = option.crawlDate; // 爬虫日期
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
   *开始爬数据
   * */
  startCrawl = async () => {
    try {
      let token = '';
      // 拦截请求, 获取fetch需要的token等字段
      await this._page.setRequestInterception(true);
      this._page.on('request',  async(request) => {
        if(request.url().indexOf('zuanshi.taobao.com/code/all.json') > -1) {
          let params = request.url().match(/&timeStr=(\S+)/);
          if(params.length > 0 && token === ''){
            token = params[0];       // 获取token 等字段
          }
        }
      });

      //  钻展 报表 数据
      const zz_url = 'https://zuanshi.taobao.com/index_poquan.jsp';
      await this._page.goto(zz_url, {waitUntil:'networkidle2'});
      // 钻展 未登录处理
      if(this._page.url().indexOf('zuanshi.taobao.com/index.html?mxredirectUrl=') > -1){
        await this._nextRound(this._wangwang);
      }
      else {
        await this.getHistoryData(token);
        await this._nextRound(this._wangwang);
      }
    }catch (e) {
      if(
              e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
              e.message.indexOf('Session closed. Most likely the page has been closed') === -1
      ) {
        console.log(e);
        await this._nextRound(this._wangwang);
      }
    }
  };

  /**
   * 获取历史数据
   *
   */
  getHistoryData = async(url_end) => {
    let date_arr = await this.getDateArr();
    await asyncForEach(date_arr, async(date) => {
      let data = {};
      let sum_url = 'https://zuanshi.taobao.com/api/report/account/findDaySum.json?r=mx_136&' +
              'startTime=' + date[0] + '&endTime=' + date[1] + url_end;
      let day_url = 'https://zuanshi.taobao.com/api/report/account/findDayList.json?r=mx_138&' +
              'startTime=' + date[0] + '&endTime=' + date[1] + url_end;
      data['findDaySum'] = await this.sendReauest(sum_url);
      data['findDayList'] = await this.sendReauest(day_url);
      await this.saveData(data, date[0], date[1], date[2])
    })
  };

  /**
   * 获取爬取的日期数组 [[7天], [环比7天], [15天], [环比15天]]
   * @returns {Promise<Array>}
   */
  getDateArr = async() => {
    let dateArr = [];
    let start_date7 = moment(new Date(new Date(this._crawlDate).getTime() - (6 * 24 * 60 * 60 * 1000))).format("YYYY-MM-DD");
    let start_date_hb7 = moment(new Date(new Date(this._crawlDate).getTime() - (13 * 24 * 60 * 60 * 1000))).format("YYYY-MM-DD");
    let end7 = moment(new Date(new Date(this._crawlDate).getTime()-(7*24*60*60*1000))).format("YYYY-MM-DD");

    let start_date15 = moment(new Date(new Date(this._crawlDate).getTime() - (14 * 24 * 60 * 60 * 1000))).format("YYYY-MM-DD");
    let start_date_hb15 = moment(new Date(new Date(this._crawlDate).getTime() - (29 * 24 * 60 * 60 * 1000))).format("YYYY-MM-DD");
    let end15 = moment(new Date(new Date(this._crawlDate).getTime()-(15*24*60*60*1000))).format("YYYY-MM-DD");

    dateArr.push([start_date7, this._crawlDate, 7], [start_date_hb7, end7, 7],
            [start_date15, this._crawlDate, 15], [start_date_hb15, end15, 15]);
    return dateArr;
  };


  /**
   * 存储数据
   * @param save_data
   */
  saveData  = async (save_data, start, end, period) => {
    let data = {
      data:save_data,
      created_at:new Date(),
      updated_at:new Date(),
      date:this._crawlDate,
      start: start,
      end: end,
      effect: 3,
      nick_name: this._wangwang,
      bizCode: 'zszw',
      period: period
    };
    //存入数据
    await this._mongo.db.collection('zuanzhan.zz_history_shop_data').deleteMany({'start': start, 'end': end, 'nick_name': this._wangwang});
    await this._mongo.db.collection('zuanzhan.zz_history_shop_data').insertOne(data);
    console.log(save_data);
  };

  /**
   * 发送请求的方法
   * @param {Object} page page类
   * @param {String} url  请求的url
   * */
  sendReauest = async (url)=>{
    return await this._page.evaluate(async (url) => {
      let headers = {
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

module.exports = { ZuanzhanHistorySpider };

