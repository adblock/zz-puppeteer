const {asyncForEach, getHeader} = require('../../commons/func');
const dateFormat = require('dateformat');
/**
 * 直通车 计划数据的爬虫逻辑类
 */
class ZtcCampaignDataSpider {
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
   * 爬数据
   * */
  startCrawl = async () => {
    try {
      let suberr = 1;
      let body = '';
      // 订阅 reponse 事件，参数是一个 reponse 实体
      await this._page.on('request', async (request) => {
        if(request.url().indexOf('getGuideInfos') > -1 && request.method() === 'POST'){
            body = request.postData();
        } else if (request.url().indexOf('getNewbieStatus') > -1 && request.method() === 'GET') {
            body = request.url();
        }
        if (request.url().indexOf('suberror') > -1){
          suberr = 0;
        }
      });
      // 直通车首页 实时数据
      const ztc_url = 'https://subway.simba.taobao.com';
      await this._page.goto(ztc_url, {waitUntil: 'networkidle0'});
      //若cookie失效，或error-page，或有滑块，，开始下一个店铺
      if (this._page.url().indexOf('indexnew.jsp') > -1 || this._page.url().indexOf('error') > -1 || suberr === 0) {
        console.log("页面加载未完成");
      } else {
        try {   // 不重定向的店铺（正常店铺） 会timeout 5s
          await this._page.waitForResponse(response => response.url().indexOf('account/getRealBalance.json') > -1 || response.url().indexOf('getaccountwithcoupon$?sla=json') > -1, {timeout: 5000});
        } catch (e) {
          console.log('wait balance');
        }
        if(body){
          let save_data = await this.getData(body);
          await this.saveData(save_data);
        }
      }
      // 重新启动
      await this._nextRound(this._wangwang);
    } catch (e) {
      if (
              e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
              e.message.indexOf('Session closed. Most likely the page has been closed') === -1
      ) {
        console.log(e);
      }
      await this._nextRound(this._wangwang);
    }
  };
  getData = async (body) => {
    let common_url = this._page.url().match(/[a-zA-z]+:\/\/[^\s]*?\//)[0];
    const token = await getHeader(body);
    console.log(token);
    return await this.getCampaignData(token, common_url);
  };

  /**
   * 获取计划列表
   * @param token
   * @param common_url    url前部公用
   * @returns {Promise<Array>}
   */
  getCampaignList = async(token, common_url) => {
    let list_url = common_url + 'openapi/param2/1/gateway.subway/common/campaign/list$';
    console.log(list_url);
    let cam_list = await this.sendReauest(
            {
              'sla': 'json',
              'isAjaxRequest': 'true',
              'token': token,
              '_referer': '/manage/campaign/index'
            }, list_url);
    let campaign_list = cam_list['result'];
    let campaign_obj = {};
    await asyncForEach(campaign_list, async(campaign) => {
      campaign_obj[campaign.id] = campaign;
    });
    return campaign_obj;
  };

  /**
   * 获取计划数据
   * @param token
   * @param common_url
   * @returns {Promise<*>}
   */
  getCampaignData = async (token, common_url) => {
    let campaign_list = await this.getCampaignList(token, common_url);
    let campaign_ids = Object.keys(campaign_list);
    let return_data = Object.values(campaign_list);
    const today = dateFormat(new Date(), "yyyy-mm-dd");
    let data_url = common_url + 'openapi/param2/1/gateway.subway/common/rtreport/data/get$';
    let form_data = {
      'templateId': 'rtRptCampaign',
      'campaignIds': '['+campaign_ids+']',
      'trafficType': '[1,2,4,5]',   // [1, 2]: 计算机  [4,5]:移动 [1245]:汇总
      'mechanism': '[0,2]',         // 投放方式： 0：关键词  2：定向 [02]汇总
      'theDate': today,
      'group': 'campaignId',
      'sla': 'json',
      'isAjaxRequest': 'true',
      'token': token,
      '_referer': '/manage/campaign/index'
    };
    console.log(form_data);
    let campaign_data = await this.sendReauest(form_data, data_url);
    campaign_data = campaign_data['result'];
    let campaign_obj = {};
    await asyncForEach(campaign_data, async(campaign) => {
      campaign_obj[campaign.campaignId] = campaign;
    });

    await asyncForEach(return_data, async(campaign)=>{
      campaign['reportInfoList'] = [campaign_obj[campaign.campaignId]];
    });
    return return_data;
  };
  /**
   * 存储数据
   * @param save_data
   */
  saveData  = async (save_data) => {
    let data = {
      data:save_data,
      created_at:new Date(),
      updated_at:new Date(),
      crawl_date:this._crawlDate,
      nick_name: this._wangwang,
    };
    // 存入数据
    await this._mongo.db.collection('zhitongche.ztc_campaign_data').deleteMany({'crawl_date': this._crawlDate, 'nick_name': this._wangwang});
    await this._mongo.db.collection('zhitongche.ztc_campaign_data').insertOne(data);
  };

  /**
   * 获取token
   * @param {Object} page 浏览器page对象
   * @param common_url    url前部公用
   * */
  getToken = async (common_url) => {
    // 获取token
    const token = await this.sendReauest({}, common_url + '/bpenv/getLoginUserInfo.htm');
    return token;
  };

  /**
   * 格式化数据得方法
   * @param {Object} data 数据
   * */
  parseDataToUrl = async (data)=>{
    return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
  };

  /**
   * 发送请求的方法
   * @param {Object} body 请求发送的数据
   * @param {String} url  请求的url
   * */
   sendReauest = async (body,url)=>{
    body = await this.parseDataToUrl(body);
    return await this._page.evaluate(async (body,url) => {
      let headers = {
        'referer':'https://subway.simba.taobao.com/',
        'origin':'https://subway.simba.taobao.com',
        'sec-fetch-mode':'cors',
        'sec-fetch-site':'same-origin',
        'sec-fetch-dest':'empty',
        'content-type':'application/x-www-form-urlencoded; charset=UTF-8'
      };
      const response = await fetch(url,
              {
                body:body,
                credentials: 'include',
                method: 'POST',
                headers:headers,
              }
      );
      return await response.json();
    },body,url);
  };
}

module.exports = { ZtcCampaignDataSpider };