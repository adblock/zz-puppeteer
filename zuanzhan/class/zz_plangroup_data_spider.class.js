/**
 * 钻展计划组的爬虫逻辑类
 *
 * reportInfoList:详细数据
 *  campaignList:存放计划数据
 * */
const {asyncForEach} = require('../../commons/func');

class ZuanzhanPlangroupDataSpider {
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
    this.startCrawl();
  };

  /**
   *开始爬数据
   * */
  startCrawl = async () => {
    try {
      let token = '';
      // 拦截请求, 获取fetch需要的token等字段
      this._page.on('response', async (response) => {
        if (response.url().indexOf('zuanshi.taobao.com/code/all.json') > -1) {
          let params = response.url().match(/&timeStr=(\S+)/);
          if (params.length > 0 && token === '') {
            token = params[0];       // 获取token 等字段
          }
        }
      });

      // 进入后台
      await this._page.goto('https://zuanshi.taobao.com/index_poquan.jsp', {waitUntil: "networkidle0"});
      // 钻展 未登录处理
      if (this._page.url().indexOf('zuanshi.taobao.com/index.html?mxredirectUrl=') > -1) {
        console.log('登录失败');
        await this._nextRound(this._wangwang);
      }
      if (token !== '') {
        //调用获取数据的方法
        let saveDataGroup = await this.getDataGroup(token);
        let saveDataPlan = await this.getDataPlan(token, saveDataGroup[1]);
        let save_data = await this.getDataGroupAdd(saveDataPlan, saveDataGroup[0]);
        await this.saveData(save_data);
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
   * 获取计划组数据
   * @param page
   * @param token
   * @returns {Promise<Array>}
   */
  getDataGroup = async (token) => {
    let quanceArr = ['PoquanWeizhi', 'PoquanFanxingqu', 'PoquanXingqu', 'PoquanZidingyi'];
    let camp_id = [];               //存放url中所有campaignGroupId属性值
    let encodelist, encode;         //对url中campaignGroupId参数,进行编码显示
    let camp_groupid = 0;
    let return_data = [];           //所有计划 组数据
    await asyncForEach(quanceArr, async (type) => {
      let url_end = token + type;
      let campaign_group_url = 'https://zuanshi.taobao.com/poquan/api/campaignGroup/findPage.json?&' +
              'currentPage=1&pageSize=40' + url_end;
      //获取计划组的列表
      let resp = await this.sendReauest(campaign_group_url);
      await asyncForEach(resp['data']['list'], async (campaign) => {
        campaign.campaignType = type;
        return_data.push(campaign);
        //字典形式构造campaignGroupId参数,并且编码
        camp_groupid = campaign.campaignGroupId;
        camp_id.push(camp_groupid);
        let json = []
        for (let i = 0; i < camp_id.length; i++) {
          let j = {}
          j.campaignGroupId = camp_id[i];
          json.push(j)
        }
        encodelist = JSON.stringify(json);
      })
    });
    encode = encodeURIComponent(encodelist);
    //获取计划组的详细数据，存到reportInfoList属性中
    let campaign_url = 'https://zuanshi.taobao.com/api/report/component/findList.json?&componentType=campaignGroup&componentIdList=' +
            encode + "&logDateList=%5B%22" + this._crawlDate + '%22%5D' + token + "PoquanWeizhi";
    let resp = await this.sendReauest(campaign_url);
    let result = resp['data']['list'];
    let campaign_obj = {};
    await asyncForEach(result, async (data) => {
      campaign_obj[data.campaignGroupId] = data;
    });
    await asyncForEach(return_data, async (data) => {
      data['reportInfoList'] = [campaign_obj[data.campaignGroupId]]
    });
    return [return_data, encode]
  };

  /**
   * 获取计划组内的  计划数据
   * @param page
   * @param token
   * @param encode
   */
  getDataPlan = async (token, encode) => {
    let quanceArr = ['PoquanWeizhi', 'PoquanFanxingqu', 'PoquanXingqu', 'PoquanZidingyi'];
    let return_plandata = [];          //所有计划的数据
    await asyncForEach(quanceArr, async (type) => {
      let url_end = token + type;
      let campaign_group_url = 'https://zuanshi.taobao.com/poquan/api/campaign/page.json?' +
              encode + '&currentPage=1&pageSize=40' + url_end;
      let resp1 = await this.sendReauest(campaign_group_url);
      await asyncForEach(resp1['data']['campaigns'], async (campaign) => {
        campaign.campaignType = type;
        return_plandata.push(campaign);
      })
    });
    //获取计划 的详细数据，存到reportInfoList键中
    let campaign_urlitem = 'https://zuanshi.taobao.com/api/report/component/findList.json?&componentType=campaign&componentIdList=&logDateList=%5B%22' +
            this._crawlDate + '%22%5D' + token;
    let respitem = await this.sendReauest(campaign_urlitem);
    let resultitem = respitem['data']['list'];
    let campaign_objitem = {};
    await asyncForEach(resultitem, async (data) => {
      campaign_objitem[data.campaignId] = data;
    });
    await asyncForEach(return_plandata, async (data) => {
      data['reportInfoList'] = [campaign_objitem[data.campaignId]]
    });
    return return_plandata
  };

  /**
   * 将计划设为计划组campaignList的对象
   * @param return_plandata
   * @param return_data
   *
   */
  getDataGroupAdd = async (return_plandata, return_data) => {
    let campaign_groupitem = {};            //计划组里 包含对应计划
    let groupId = "campaignGroupId";
    // 所有计划按照campaignGroupId进行分组，groupBy（）方法
    let sort_plan = groupBy(return_plandata, groupId);

    function groupBy(arry, groupId) {
      let groups = {};
      arry.forEach(function (o) {
        let group = JSON.stringify(o[groupId]);
        groups[group] = groups[group] || [];
        groups[group].push(o);
      });
      return Object.values(groups);
    }

    //获取计划的组标识id
    await asyncForEach(sort_plan, async (data) => {
      campaign_groupitem[data[0].campaignGroupId] = data;
    });
    //将计划，存到计划组的campaignList键中
    await asyncForEach(return_data, async (data) => {
      data['campaignList'] = campaign_groupitem[data.campaignGroupId]
    });
    return return_data
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
    //存入数据
    await this._mongo.db.collection('zuanzhan.zz_plangroup_data').deleteMany({
      'crawl_date': this._crawlDate,
      'nick_name': this._wangwang
    });
    await this._mongo.db.collection('zuanzhan.zz_plangroup_data').insertOne(data);
    console.log("存入数据库ok");
  };


}

module.exports = { ZuanzhanPlangroupDataSpider };

