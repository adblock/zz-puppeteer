/**
 * 直通车的爬虫逻辑类
 * 直通车 历史数据爬取：最近7天和15天的15天累计数据的环比
 */
const {asyncForEach, getHeader} = require('../../commons/func');
const moment = require('moment');

class ZhitongcheHistorySpider {
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
      let body = ' ';
      // 拦截销售分析实时数据请求
      await this._page.on('request', async (request) => {
        if(request.url().indexOf('getGuideInfos') > -1 && request.method() === 'POST'){
            body = request.postData();
        } else if (request.url().indexOf('getNewbieStatus') > -1 && request.method() === 'GET') {
            body = request.url();
        }
      });
      // 直通车 报表 数据
      const ztc_index = 'https://subway.simba.taobao.com/';   // 第一次登陆必须先进到首页？
      await this._page.goto(ztc_index, {waitUntil: 'networkidle0'});
      try {   // 不重定向的店铺（正常店铺） 会timeout 5s
        await this._page.waitForResponse(response => response.url().indexOf('account/getRealBalance.json') > -1 || response.url().indexOf('getaccountwithcoupon$?sla=json') > -1, {timeout: 5000});
      } catch (e) {
        console.log('wait balance')
      }
      if (this._page.url().indexOf('indexnew.jsp') > -1 || this._page.$$('.error-page').length > 0) {
        await this._nextRound(this._wangwang);
      } else {
        if (body) {
          await this.getHistoryData(body);
        }
        await this._nextRound(this._wangwang);
      }
    } catch (e) {
      if (
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
   * @returns {Promise<Array>}
   */
  getHistoryData = async (body) => {
    let save_data = {};
    let common_url = this._page.url().match(/[a-zA-z]+:\/\/[^\s]*?\//)[0];
    const ztc_url = common_url + '#!/report/bpreport/index';
    await this._page.goto(ztc_url, {waitUntil: 'networkidle2'});
    const dateArr = await this.getDateArr();
    await asyncForEach(dateArr, async (date) => {
      let sum_url = common_url + 'report/rptBpp4pCustomSum.htm?startDate=' + date[0] + '&endDate=' + date[1] + '&effect=-1';
      console.log(sum_url);
      save_data['findDaySum'] = await this.getSumData(sum_url, body);
      let chart_url = common_url + 'report/rptBpp4pCustomLinechart.htm?startDate=' + date[0] + '&endDate=' + date[1] + '&effect=-1&field='
      save_data['findDayList'] = await this.getChartData(chart_url, body);
      await this.saveData(save_data, date[0], date[1], date[2])
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

  getSumData = async (url, body) => {
    const headerArr = await getHeader(body);    // 获取token(索引为0)， sessionId(索引为1)
    return await this.sendReauest({
      'sla': 'json',
      'isAjaxRequest': 'true',
      'token': headerArr,
      '_referer': '/report/bpreport/index',
    }, url)
  };
  getChartData = async (url, body) => {
    let G_TYPE = ['searchimpression',
      'searchtransaction',
      'impression',
      'avgpos',
      'carttotal',
      'click',
      'cost',
      'coverage',
      'cpc',
      'cpm',
      'ctr',
      'dirEprePayAmt',
      'dirEprePayCnt',
      'directcarttotal',
      'directtransaction',
      'directtransactionshipping',
      'eprePayAmt',
      'eprePayCnt',
      'favitemtotal',
      'favshoptotal',
      'favtotal',
      'indirEprePayAmt',
      'indirEprePayCnt',
      'indirectcarttotal',
      'indirecttransaction',
      'indirecttransactionshipping',
      'newuv',
      'newuvrate',
      'roi',
      'shopnewuv',
      'transactionshippingtotal',
      'transactiontotal'];
    let chart_data = [];
    const headerArr = await getHeader(body);    // 获取token(索引为0)， _h(索引为1) t(索引为2)
    await asyncForEach(G_TYPE, async (type) => {
      chart_data.push(await this.sendReauest({
        'sla': 'json',
        'isAjaxRequest': 'true',
        'token': headerArr,
        '_referer': '/report/bpreport/index',
      }, url + type))
    });
    return chart_data;
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
      start: start,
      end: end,
      effect: -1,
      nick_name: this._wangwang,
      period: period
    };
    await this._mongo.db.collection('zhitongche.ztc_history_shop_data').deleteMany({
      'start': start,
      'end': end,
      'nick_name': this._wangwang
    });
    await this._mongo.db.collection('zhitongche.ztc_history_shop_data').insertOne(data);
  };

  /**
   * 发送请求的方法
   * @param {Object} page page类
   * @param {Object} body 请求发送的数据
   * @param {String} url  请求的url
   * */
  sendReauest = async (body, url) => {
    body = await this.parseDataToUrl(body);
    return await this._page.evaluate(async (body, url) => {
      let headers = {
        'referer': 'https://subway.simba.taobao.com/',
        'origin': 'https://subway.simba.taobao.com',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-dest': 'empty',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
      };
      const response = await fetch(url,
              {
                body: body,
                credentials: 'include',
                method: 'POST',
                headers: headers,
              }
      );
      return await response.json();
    }, body, url);
  };

  /**
   * 格式化数据得方法
   * @param {Object} data 数据
   * */
  parseDataToUrl = async (data) => {
    return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
  };
}

module.exports = { ZhitongcheHistorySpider };
