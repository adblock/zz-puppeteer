/*
@File     ：ztc_report_analysis_data.py
@Author   ：qingyang
@Date     ：2021/8/23 15:35 
@describe ：直通车7天数据分析报表
*/

const {asyncForEach, getHeader} = require('../../commons/func');
const moment = require('moment');

class ZtcReportAnalysisData {
    constructor(option) {
        let date_arr = {};
        date_arr['start'] = option.start; // 报表开始日期
        date_arr['end'] = option.end;   // 报表结束日期
        this.dateArr = date_arr;
        this._crawlDate = option.crawlDate; // 爬虫日期
        this.spiderName = ZtcReportAnalysisData.name;
        this.userId = option.user_id;
    }
  /**
   * 初始化函数
   * @param option
   * */
  init = async (option) => {
    this._wangwang = option.wangwang; // 旺旺
    this._page = option.page; // 页面
    this._mongo = option.mongo; // mongo查询
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
        console.log('直通车登录失败');
      } else {
        if (body) {
          await this.getData(body);
        }
      }
    } catch (e) {
      if (
              e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
              e.message.indexOf('Session closed. Most likely the page has been closed') === -1
      ) {
        console.log(e);
      }
    }
  };

    /**
     * 获取数据
     * @returns {Promise<Array>}
     */
    getData = async (body) => {
        let save_data = {};
        let common_url = this._page.url().match(/[a-zA-z]+:\/\/[^\s]*?\//)[0];
        const ztc_url = common_url + '#!/report/bpreport/index';
        await this._page.goto(ztc_url, {waitUntil: 'networkidle2'});

        // 汇总数据
        save_data['total'] = await this.getTotalData(body);

        // 每日数据
        save_data['day'] = await this.getEverydayData(body);

        // 获取计划趋势图（计划分日数据）
        save_data['campaign_day'] = await this.getCampaignDayData(body);

        await this.saveData(save_data);
    };

    /**
     * 计划每日数据
     * @param body
     * @returns {Promise<void>}
     */
    getCampaignDayData = async(body) => {
        let effect = 30;  // 转化率等各指标数据最高，默认转化周期：30天累计数据
        let token = await getHeader(body);
        // 获取计划列表
        let campaign_url = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/rpt/rptCampaignList$';
        let campaign_body = {
            'queryParam': JSON.stringify({"page":"1","pageSize":100,"startDate":this.dateArr.start,"endDate":this.dateArr.end,"effectEqual":"30","pvType":["1","4","2","5","6"]}),
            'sla': 'json',
            'isAjaxRequest': true,
            'token': token,
            '_referer': `/report/bpreport/campaign/index?page=1&start=${this.dateArr.start}&end=${this.dateArr.end}`,
        };
        let campaign_resp = await this.sendRequest(campaign_body, campaign_url);
        let campaigns = campaign_resp['result']['data'];


        let url = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/rpt/rptCampaignByDay$';
        let save_data = {};
        await asyncForEach(campaigns, async(campaign) => {
            let form_data = {
                'queryParam': JSON.stringify({"startDate":this.dateArr.start,"endDate":this.dateArr.end,"effectEqual":"30",
                "pvType":["1","4","2","5","6"],"sortField":"","sortType":"","campaignId":campaign.campaignId,"campaignIds":[campaign.campaignId]}),
                'sla': 'json',
                'isAjaxRequest': true,
                'token': token,
                '_referer': `/report/bpreport/campaign/index?page=1&start=${this.dateArr.start}&end=${this.dateArr.end}&effect=${effect}`,
            };
            let resp = await this.sendRequest(form_data, url);
            resp = resp['result'];
            let campaign_day = {'campaignTitle': campaign.campaignTitle};
            await asyncForEach(resp, async(result) =>{
                campaign_day[result['thedate']] = result;
            });
            save_data[campaign.campaignId] = campaign_day;
        });
        return save_data;
    };

    /**
     * 汇总数据
     * @param body
     * @returns {Promise<*>}
     */
    getTotalData = async(body) => {
        let effect = 30;  // 转化率等各指标数据最高，默认转化周期：30天累计数据
        let token = await getHeader(body);
        // 计划列表
        let campaign_url = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/rpt/rptCampaignList$';
        let form_data = {
            'queryParam': JSON.stringify({"page":"1","pageSize":100,"startDate":this.dateArr.start,"endDate":this.dateArr.end,"effectEqual":effect,"pvType":["1","4","2","5","6"]}),
            'sla': 'json',
            'isAjaxRequest': true,
            'token': token,
            '_referer': `/report/bpreport/campaign/index?page=1&start=${this.dateArr.start}&end=${this.dateArr.end}&effect=${effect}`,
        };
        let campaign_resp = await this.sendRequest(form_data, campaign_url);
        let campaign_list = campaign_resp['result']['data'];

        // 总计数据
        let sum_url = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/rpt/rptCampaignTotal$';
        let sum_resp = await this.sendRequest(form_data, sum_url);
        let return_resp = sum_resp['result'];
        return_resp['campaign'] = campaign_list;
        return return_resp;
    };

    /**
     * 每日数据
     * @param body
     * @returns {Promise<void>}
     */
    getEverydayData = async(body) => {
        let effect = 30;  // 转化率等各指标数据最高，默认转化周期：30天累计数据
        let token = await getHeader(body);
        let url = 'https://subway.simba.taobao.com/openapi/param2/1/gateway.subway/rpt/rptCampaignTotal$';
        let day = this.dateArr.start;
        let save_data = {};
        while (day <= this.dateArr.end){
            let form_data = {
                'queryParam': JSON.stringify({"page":"1","pageSize":100,"startDate":day,"endDate":day,"effectEqual":effect,"pvType":["1","4","2","5","6"]}),
                'sla': 'json',
                'isAjaxRequest': true,
                'token': token,
                '_referer': `/report/bpreport/campaign/index?page=1&start=${day}&end=${day}&effect=${effect}`,
            };
            let resp = await this.sendRequest(form_data, url);
            save_data[day] = resp['result'];
            save_data[day]['date'] = day;
            day = moment(day).add(1, 'd').format('YYYY-MM-DD')
        }
        return save_data;
    };

  /**
   * 存储数据
   * @param save_data
   */
  saveData = async (save_data) => {
    let data = {
      data: save_data,
      created_at: new Date(),
      updated_at: new Date(),
      date: this._crawlDate,
      start: this.dateArr.start,
      end: this.dateArr.end,
      effect: 30,
      product: this.spiderName,
      nick_name: this._wangwang,
      user_id: this.userId
    };
    await this._mongo.db.collection('report.report_analysis_data').deleteMany({
        'start': this.dateArr.start,
        'end': this.dateArr.end,
        'nick_name': this._wangwang,
        'product': this.spiderName,
        'user_id':this.userId
    });
    await this._mongo.db.collection('report.report_analysis_data').insertOne(data);
  };

  /**
   * 发送请求的方法
   * @param {Object} body 请求发送的数据
   * @param {String} url  请求的url
   * */
  sendRequest = async (body, url) => {
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

module.exports = { ZtcReportAnalysisData };
