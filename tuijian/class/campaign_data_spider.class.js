const {asyncForEach} = require('../../commons/func');

/**
 * 超级推荐 计划数据的爬虫逻辑类
 * */
class TuijianCampaignDataSpider {
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
          if (response.url().indexOf('https://tuijian.taobao.com/indexbp-feedflow.html') !== -1) {
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
      await this._page.goto('https://tuijian.taobao.com/indexbp-feedflow.html', {waitUntil: "networkidle0"});
      //若cookie 失效，或有滑块，或一直加载状态，开始下一个店铺
      if (this._page.url().indexOf('https://tuijian.taobao.com/index.html') > -1 || this._page.url().indexOf('punish?x5secdata') > -1 || suberr === 0) {
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
    let item_data = await this.getItemCampaign(token);
    await asyncForEach(item_data['manageNewCrowd'], async (item) => {
      item['planType'] = '商品推广-营销场景计划';
      data.push(item);
    });
    await asyncForEach(item_data['manageUserDefine'], async (item) => {
      item['planType'] = '商品推广-自定义计划';
      data.push(item);
    });
    let picture_data = await this.getPictureCampaign(token);
    await asyncForEach(picture_data, async (item) => {
      item['planType'] = '图文推广';
      data.push(item);
    });
    let live_data = await this.getLiveCampaign(token);
    await asyncForEach(live_data, async (item) => {
      item['planType'] = '直播推广';
      data.push(item);
    });
    return data;
  };

  getItemCampaign = async (token) => {
    let save_data = {};
    token += 'Item';
    let campaign_type = ['manageNewCrowd', 'manageUserDefine'];
    await asyncForEach(campaign_type, async (type) => {
      let url = 'https://tuijian.taobao.com/api/campaign/findPage.json?systemBidList=%5B%22manual%22%2C%22quantity%22%2C%22mcb%22%5D&' +
              'module=' + type + '&statusList=%5B%22start%22%2C%22pause%22%2C%22wait%22%5D&solutionTypeList=%5B%22white%22%2C%22black%22%5D&' +
              'campaignTypeList=%5B%22cpm%22%2C%22cpc%22%5D&sourceChannel=&offset=0&pageSize=100&needReport=true&reportQuery=%7B%22bizCode%22%3A%22' +
              'feedFlowItem%22%2C%22logDateList%22%3A%5B%22' + this._crawlDate + '%22%5D%7D&marketSceneList=%5B%5D&activityIdList=%5B%5D' + token;
      let resp = await this.sendReauest(url);
      save_data[type] = resp['data']['list'];
    });
    return save_data;
  };

  getPictureCampaign = async (token) => {
    token += 'Picture';
    let url = 'https://tuijian.taobao.com/api/campaign/findPage.json?statusList=%5B%22start%22%2C%22pause%22%2C%22wait%22%5D&' +
            'solutionTypeList=%5B%22white%22%2C%22black%22%5D&campaignTypeList=%5B%22cpm%22%2C%22cpc%22%5D&offset=0&pageSize=100&' +
            'needReport=true&reportQuery=%7B%22bizCode%22%3A%22feedFlowPicture%22%2C%22logDateList%22%3A%5B%22' + this._crawlDate + '%22%5D%7D' + token;
    let resp = await this.sendReauest(url);
    return resp['data']['list'];
  };

  getLiveCampaign = async (token) => {
    token += 'Live';
    let url = 'https://tuijian.taobao.com/api/campaign/findPage.json?statusList=%5B%22start%22%2C%22pause%22%2C%22wait%22%5D&' +
            'solutionTypeList=%5B%22white%22%2C%22black%22%5D&campaignTypeList=%5B%22cpm%22%2C%22cpc%22%5D&offset=0&pageSize=100&' +
            'needReport=true&reportQuery=%7B%22bizCode%22%3A%22feedFlowLive%22%2C%22logDateList%22%3A%5B%22' + this._crawlDate + '%22%5D%7D' + token;
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
    await this._mongo.db.collection('chaojituijian.cjtj_campaign_data').deleteMany({
      'crawl_date': this._crawlDate,
      'nick_name': this._wangwang
    });
    await this._mongo.db.collection('chaojituijian.cjtj_campaign_data').insertOne(data);
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

module.exports = { TuijianCampaignDataSpider };