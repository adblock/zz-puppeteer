/**
 * 超级推荐 历史数据爬取：最近7天和 15天 的7天转化周期的环比
 */
const {asyncForEach} = require('../../commons/func');
const moment = require('moment');

class TuijianHistorySpider {
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
      let url_end = '';
      // 拦截静态文件请求
      await this._page.setRequestInterception(true);
      this._page.on('request', request => {
        if (request.url().indexOf('isProtocolSigned.json') > -1) {
          url_end = request.url().match(/&timeStr=(\S+)/)[0];
        }
      });

      // 进入后台
      await this._page.goto('https://tuijian.taobao.com/indexbp-feedflow.html', {waitUntil: "networkidle2"});
      // 超级推荐 未登录处理
      if (this._page.url().indexOf('https://tuijian.taobao.com/index.html') > -1) {
        await this._nextRound(this._wangwang);
      } else {
        if (url_end) {
          await this.getHistoryData(url_end);
        }
        await this._nextRound(this._wangwang);
      }
    } catch (e) {
      if (
              e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
              e.message.indexOf('Session closed. Most likely the page has been closed') === -1
      ) {
        console.log(e.message);
        await this._nextRound(this._wangwang);
      }
    }
  };
  /**
   * 获取历史数据
   * @returns {Promise<Array>}
   */
  getHistoryData = async (url_end) => {
    let date_arr = await this.getDateArr();
    await asyncForEach(date_arr, async (date) => {
      let data = {};
      let sum_url = 'https://tuijian.taobao.com/api/account/report/findDaySum.json?r=mx_954&' +
              'startTime=' + date[0] + '&endTime=' + date[1] + '&effectType=click&effect=30' + url_end;
      let day_url = 'https://tuijian.taobao.com/api/account/report/findDayList.json?r=mx_954&' +
              'startTime=' + date[0] + '&endTime=' + date[1] + '&effectType=click&effect=30' + url_end;
      data['findDaySum'] = await this.sendReauest(sum_url);
      data['findDayList'] = await this.sendReauest(day_url);
      await this.saveData(data, date[0], date[1], date[2])
    })
  };

  /**
   * 获取爬取的日期数组 [[7天], [环比7天], [15天], [环比15天]]
   * @returns {Promise<Array>}
   */
  getDateArr = async () => {
    let dateArr = [];
    let start_date7 = moment(new Date(new Date(this._crawlDate).getTime() - (6 * 24 * 60 * 60 * 1000))).format("YYYY-MM-DD");
    let start_date_hb7 = moment(new Date(new Date(this._crawlDate).getTime() - (13 * 24 * 60 * 60 * 1000))).format("YYYY-MM-DD");
    let end7 = moment(new Date(new Date(this._crawlDate).getTime() - (7 * 24 * 60 * 60 * 1000))).format("YYYY-MM-DD");

    let start_date15 = moment(new Date(new Date(this._crawlDate).getTime() - (14 * 24 * 60 * 60 * 1000))).format("YYYY-MM-DD");
    let start_date_hb15 = moment(new Date(new Date(this._crawlDate).getTime() - (29 * 24 * 60 * 60 * 1000))).format("YYYY-MM-DD");
    let end15 = moment(new Date(new Date(this._crawlDate).getTime() - (15 * 24 * 60 * 60 * 1000))).format("YYYY-MM-DD");

    dateArr.push([start_date7, this._crawlDate, 7], [start_date_hb7, end7, 7],
            [start_date15, this._crawlDate, 15], [start_date_hb15, end15, 15]);
    return dateArr;
  };

  /**
   * 存储数据
   * @param save_data
   */
  saveData = async (save_data, start, end, period) => {
    let data = {
      data: save_data,
      created_at: new Date(),
      updated_at: new Date(),
      date: this._crawlDate,
      start_date: start,
      end_date: end,
      effect: 30,
      nick_name: this._wangwang,
      period: period
    };
    // 存入数据
    await this._mongo.db.collection('chaojituijian.cjtj_history_shop_data').deleteMany({
      'start_date': start,
      'end_date': end,
      'nick_name': this._wangwang
    });
    await this._mongo.db.collection('chaojituijian.cjtj_history_shop_data').insertOne(data);
    console.log(save_data)
  };

  /**
   * 发送请求的方法
   * @param {Object} page page类
   * @param {String} url  请求的url
   * */
  sendReauest = async (url) => {
    return await this._page.evaluate(async (url) => {
      let headers = {
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-dest': 'empty',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
      };
      const response = await fetch(url, {headers: headers});
      return await response.json();
    }, url);
  };
}

module.exports = { TuijianHistorySpider };
