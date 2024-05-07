const {asyncForEach} = require('../../commons/func');

/**
 * 超级互动城 计划数据的爬虫逻辑类
 * */
class HudongCampaignDataSpider {
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
        if (request.url().indexOf('isProtocolSigned.json') > -1) {
          let params = request.url().match(/&timeStr=(\S+)/);
          if (params.length > 0) {
            token = params[0];       // 获取token 等字段
          }
        }
      });
      // 订阅 reponse 事件，参数是一个 reponse 实体
      await this._page.on('response', async (response) => {
        try {
          if (response.url().indexOf('https://chaojihudong.taobao.com/indexbp.html') !== -1) {
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
      await this._page.goto('https://chaojihudong.taobao.com/indexbp.html', {waitUntil: "networkidle0"});
      //若cookie 失效，或有滑块，或一直加载状态，开始下一个店铺
      if (this._page.url().indexOf('https://chaojihudong.taobao.com/index.html') >-1 || this._page.url().indexOf('punish?x5secdata') > -1 || suberr === 0) {
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
    let data = [];
    console.log(token);
    let shop_guarantee = await this.getShopGuaranteeCampaign(token);
    await asyncForEach(shop_guarantee, async (item) => {
      item['planType'] = '店铺流量保障';
      data.push(item);
    });

    let live_guarantee = await this.getLiveGuaranteeCampaign(token);
    await asyncForEach(live_guarantee, async (item) => {
      item['planType'] = '直播流量保障';
      data.push(item);
    });

    let shortvideo_guarantee = await this.getShortVideoGuaranteeCampaign(token);
    await asyncForEach(shortvideo_guarantee, async (item) => {
      item['planType'] = '短视频流量保障';
      data.push(item);
    });

    let shop_data = await this.getShopCampaign(token);
    await asyncForEach(shop_data, async (item) => {
      item['planType'] = '店铺推广';
      data.push(item);
    });

    let live_data = await this.getLiveCampaign(token);
    await asyncForEach(live_data, async (item) => {
      item['planType'] = '直播推广';
      data.push(item);
    });
    return data;
  };

  getShopGuaranteeCampaign = async (token) => {
    token += 'Guarantee';
    let url = 'https://chaojihudong.taobao.com/api/campaignGroup/findPage.json?statusList=%5B%22launch%22%2C%22terminate%22%5D&sourceChannel=' +
        '&offset=0&pageSize=100&needReport=true&reportQuery=%7B%22bizCode%22%3A%22interactiveGuarantee%22%2C%22logDateList%22%3A%5B%22'+this._crawlDate+'%22%5D%7D' + token;
    let resp = await this.sendReauest(url);
    return resp['data']['list'];
  };

  getLiveGuaranteeCampaign = async (token) => {
    token += 'LiveGuarantee';
    let url = 'https://chaojihudong.taobao.com/api/campaignGroup/findPage.json?statusList=%5B%22launch%22%2C%22terminate%22%5D&sourceChannel=' +
        '&offset=0&pageSize=100&needReport=true&reportQuery=%7B%22bizCode%22%3A%22interactiveLiveGuarantee%22%2C%22logDateList%22%3A%5B%22'+this._crawlDate+'%22%5D%7D' + token;
    let resp = await this.sendReauest(url);
    return resp['data']['list'];
  };

  getShortVideoGuaranteeCampaign = async (token) => {
    token += 'ShortVideoGuarantee';
    let url = 'https://chaojihudong.taobao.com/api/campaignGroup/findPage.json?statusList=%5B%22launch%22%2C%22terminate%22%5D&sourceChannel=' +
        '&offset=0&pageSize=100&needReport=true&reportQuery=%7B%22bizCode%22%3A%22interactiveShortVideoGuarantee%22%2C%22logDateList%22%3A%5B%22'+this._crawlDate+'%22%5D%7D' + token;
    let resp = await this.sendReauest(url);
    return resp['data']['list'];
  };

  getShopCampaign = async (token) => {
    token += 'Reward';
    let url = 'https://chaojihudong.taobao.com/api/campaign/findPage.json?statusList=%5B%22start%22%2C%22pause%22%2C%22' +
        'wait%22%5D&solutionTypeList=%5B%22white%22%2C%22black%22%5D&systemBidList=%5B%22manual%22%2C%22upper_budget%22%5D&' +
        'campaignTypeList=%5B%22cpm%22%2C%22cpc%22%2C%22cpa%22%5D&sourceChannel=&offset=0&pageSize=100&needReport=true&' +
        'reportQuery=%7B%22bizCode%22%3A%22interactiveReward%22%2C%22logDateList%22%3A%5B%22'+this._crawlDate+'%22%5D%7D&marketSceneList=%5B%5D' + token;
    let resp = await this.sendReauest(url);
    return resp['data']['list'];
  };

  getLiveCampaign = async (token) => {
    token += 'Live';
    let url = 'https://chaojihudong.taobao.com/api/campaign/findPage.json?statusList=%5B%22start%22%2C%22pause%22%2C%22wait%22%5D&' +
        'solutionTypeList=%5B%22white%22%2C%22black%22%5D&systemBidList=%5B%22manual%22%2C%22upper_budget%22%5D&' +
        'campaignTypeList=%5B%22cpm%22%2C%22cpc%22%2C%22cpa%22%5D&sourceChannel=&offset=0&pageSize=100&needReport=true&' +
        'reportQuery=%7B%22bizCode%22%3A%22interactiveLive%22%2C%22logDateList%22%3A%5B%22'+this._crawlDate+'%22%5D%7D&marketSceneList=%5B%5D' + token;
    let resp = await this.sendReauest(url);
    return resp['data']['list'];
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
    await this._mongo.db.collection('chaojihudong.cjhd_campaign_data').deleteMany({
      'crawl_date': this._crawlDate,
      'nick_name': this._wangwang
    });
    await this._mongo.db.collection('chaojihudong.cjhd_campaign_data').insertOne(data);
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

module.exports = { HudongCampaignDataSpider };