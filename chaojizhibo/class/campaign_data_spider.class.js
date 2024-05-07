const {asyncForEach} = require('../../commons/func');

/**
 * 超级直播 计划数据的爬虫逻辑类
 * */
class ZhiboCampaignDataSpider {
  constructor(option) {
    this._crawlDate = option.crawlDate; // 爬虫日期
  }

  /**
   * 初始化函数
   * @param option
   * */
  init = async (option) => {
    this._wangwang = option.wangwang; // 旺旺
    this._page = option.page;         // 页面
    this._mongo = option.mongo;        // mongo查询
    this._nextRound = option.nextRound; // 下一轮
    await this.startCrawl();
  }
  /**
   * 爬数据
   * */
  startCrawl = async () => {
    try {
      let suberr = 1;
      let token = '';
      // 拦截请求, 获取fetch需要的token等字段
      await this._page.setRequestInterception(true);
      this._page.on('request', async (request) => {
        if (request.url().indexOf('api/common/findCodeList.json') > -1) {
          let params = request.url().match(/&timeStr=(\S+)/);
          if (params.length > 0) {
            token = params[0];       // 获取token 等字段
          }
        }
      });
      // 订阅 reponse 事件，参数是一个 reponse 实体
      await this._page.on('response', async (response) => {
        try {
          if (response.url().indexOf('https://adbrain.taobao.com/index-live.html') > -1) {
            let text = await response.text();
            if (text.indexOf('_____tmd_____/punish') !== -1) {
              await this._page.waitFor(30000);
              suberr = 0;
            }
          }
        } catch (e) {
          if (
                  e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
                  e.message.indexOf('Session closed. Most likely the page has been closed') === -1
          ) {
            console.log(111111111);
            console.log(e.message);
            await this._nextRound(this._wangwang);
          }
        }
      });
      // 进入后台
      await this._page.waitFor(1000 + Math.round(Math.random()) * 100);
      await this._page.goto('https://adbrain.taobao.com/indexbp-live.html', {waitUntil: "networkidle0"});
      //若cookie 失效，或有滑块，或一直加载状态，开始下一个店铺
      if (this._page.url().indexOf('punish?x5secdata') > -1 || suberr === 0 || this._page.url().indexOf('index-live.html') > -1) {
        console.log('页面加载未完成');
      } else {
        if (token) {
          let save_data = await this.getData(token);
          await this.saveData(save_data);
        }
      }
      await this._nextRound(this._wangwang);
    } catch (e) {
      if (
              e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
              e.message.indexOf('Session closed. Most likely the page has been closed') === -1
      ) {
        console.log(222222222);
        console.log(e.message);
        await this._nextRound(this._wangwang);
      }
    }
  };

  /**
   * 获取计划数据
   * @param token
   */
  getData = async (token) => {
    token = token.replace('fastLive', 'adStrategyDuration');
    console.log(token);
    // 获取所有计划
    let url = 'https://adbrain.taobao.com/api/campaign/findPageWithNoReport.json?offset=0&pageSize=100&statusList=' +
        '%5B%22wait_pay%22%2C%22wait%22%2C%22pending%22%2C%22start%22%2C%22pause%22%5D&campaignName=&marketScene=' +
        'fast_live_duration' + token;
    console.log(url);
    let resp = await this.sendReauest(url);
    let campaign_list = resp['data']['list'];
    let campaign_id_list = [];
    if(resp.data.count > 0){
      await asyncForEach(campaign_list, async(campaign) => {
        campaign_id_list.push(campaign.campaignId);
      })
    }

    // 获取正在投放中的计划的详细数据
    let campaign_url = 'https://adbrain.taobao.com/api/campaign/report/findOverProductCampaignSplit.json?campaignIdList=%5B' +
        campaign_id_list + '%5D&effect=15&offset=0&logDateList=%5B%22'+ this._crawlDate +'%22%5D' + token;
    console.log(campaign_url);
    let campaign_resp = await this.sendReauest(campaign_url);

    await asyncForEach(campaign_resp.data.list, async(campaign) => {
      let index = campaign_id_list.indexOf(campaign.campaignId);
      if(campaign_id_list.indexOf(campaign.campaignId) > -1){
        campaign_list[index].reportInfoList = [campaign];
      }
    });
    return campaign_list;
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
      crawl_date: this._crawlDate,
      nick_name: this._wangwang,
    };
    // 存入数据
    await this._mongo.db.collection('chaojizhibo.cjzb_campaign_data').deleteMany({
      'crawl_date': this._crawlDate,
      'nick_name': this._wangwang
    });
    await this._mongo.db.collection('chaojizhibo.cjzb_campaign_data').insertOne(data);
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
        'content-type': 'application/json'
      };
      const response = await fetch(url, {headers: headers});
      return await response.json();
    }, url);
  };
}

module.exports = { ZhiboCampaignDataSpider };