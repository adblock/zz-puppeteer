/*
@File     ：zz_report_analysis_data.py
@Author   ：qingyang
@Date     ：2021/8/24 13:38 
@describe ：钻展7天分析报表
*/

const {asyncForEach} = require('../../commons/func');
const moment = require('moment');

class ZzReportAnalysisData {
    constructor(option) {
        this._crawlDate = option.crawlDate; // 爬虫日期
        let date_arr = {};
        date_arr['start'] = option.start; // 报表开始日期
        date_arr['end'] = option.end;   // 报表结束日期
        this.dateArr = date_arr;
        this.spiderName = ZzReportAnalysisData.name;
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
        console.log('钻展登录失败');
      }
      else {
        await this.getData(token);
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
    getData = async(url_end) => {
        let effect_type = ['impression', 'click'];
        await asyncForEach(effect_type, async(eff_type) => {
            // 汇总数据
            let save_data = {};
            save_data['total'] = await this.getTotalData(url_end, eff_type);

            // 每日数据
            save_data['day'] = await this.getEverydayData(url_end, eff_type);

            // 计划每日数据
            save_data['campaign_day'] = await this.getCampaignDayData(url_end, eff_type);
            await this.saveData(save_data, eff_type);
        });
      };

     /**
     * 每日数据
     * @param url_end
     * @param eff_type
     * @returns {Promise<void>}
     */
    getCampaignDayData = async(url_end, eff_type) => {
        let bizCode_list = ['PoquanWeizhi', 'PoquanFanxingqu', 'PoquanWeizhi', 'PoquanFanxingqu', 'PoquanXingqu', 'PoquanZidingyi'];
        let type = '';
        let campaign_dict = {};
        await asyncForEach(bizCode_list, async(bizcode, index) => {
            if(index === 0 || index === 1){
                type = 'quanceng';
            } else {
                type = eff_type;
            }
            // 转化率等各指标数据最高，默认转化周期：30天累计数据
            let campaign_group_url = 'https://zuanshi.taobao.com/api/report/component/findPage.json?&componentType=campaignGroup&' +
                'startTime='+this.dateArr.start+'&endTime='+this.dateArr.end+'&effectType=' + type + '&effectPeriod=30&' +
                'currentPage=1&pageSize=100&searchKey=&searchValue=&orderField=&orderBy=' + url_end + bizcode;
            let resp = await this.sendRequest(campaign_group_url);
            let campaign_group = resp['data']['list'];
            await asyncForEach(campaign_group, async(group) => {      // 遍历所有计划组
                let campaign_url = 'https://zuanshi.taobao.com/api/report/component/findPage.json?&componentType=campaign&' +
                'startTime='+this.dateArr.start+'&endTime='+this.dateArr.end+'&effectType=' + type + '&effectPeriod=30&' +
                'currentPage=1&pageSize=100&searchKey=&searchValue=&orderField=&orderBy=&campaignGroupId=' + group.campaignGroupId + url_end + bizcode;
                let resp = await this.sendRequest(campaign_url);
                let campaign_list = resp['data']['list'];
                await asyncForEach(campaign_list, async(campaign) => {          // 遍历该计划组的所有计划
                    let url = `https://zuanshi.taobao.com/api/report/component/findDayList.json?&shopMainCatId=&vs=false&startTime=${this.dateArr.start}&endTime=${this.dateArr.end}&effectType=${type}&effectPeriod=30&componentType=campaign&componentIdList=%5B%7B%22campaignGroupId%22%3A%22${group.campaignGroupId}%22%2C%22campaignId%22%3A%22${campaign.campaignId}%22%7D%5D` + url_end + bizcode;
                    console.log(url);
                    let resp = await this.sendRequest(url);
                    resp = resp['data']['list'];
                    let campaign_day = {'campaignName': campaign.campaignName};  // 计划每日数据
                    await asyncForEach(resp, async(day_campaign) => {       // 计划的每日数据
                        campaign_day[day_campaign.logDate] = day_campaign;
                    });
                    campaign_dict[campaign.campaignId] = campaign_day;
                })
            });
        });

        return campaign_dict;
    };

  getTotalData = async(url_end, eff_type) => {
      // 计划列表
      // 未知人群和泛兴趣人群有两种类型
      let bizCode_list = ['PoquanWeizhi', 'PoquanFanxingqu', 'PoquanWeizhi', 'PoquanFanxingqu', 'PoquanXingqu', 'PoquanZidingyi'];
      let type = '';
      let campaign_list = [];
      await asyncForEach(bizCode_list, async(bizcode, index) => {
          if(index === 0 || index === 1){
              type = 'quanceng';
          } else {
              type = eff_type;
          }
          let campaign_url = 'https://zuanshi.taobao.com/api/report/component/findPage.json?&componentType=campaign&' +
              'startTime='+this.dateArr.start+'&endTime='+this.dateArr.end+'&effectType=' + type + '&effectPeriod=30&' +
              'currentPage=1&pageSize=100&searchKey=&searchValue=&orderField=&orderBy=' + url_end + bizcode;
          console.log(campaign_url);
          let resp = await this.sendRequest(campaign_url);
          campaign_list = campaign_list.concat(resp['data']['list']);
      });

      // 转化率等数据好的转化周期：30天
      let url = `https://zuanshi.taobao.com/api/report/account/findDaySum.json?&startTime=${this.dateArr.start}&endTime=${this.dateArr.end}&effectType=${eff_type}&effectPeriod=30` + url_end;
      let resp = await this.sendRequest(url);
      resp = resp['data']['list'];
      if(resp.length > 0){
          let return_resp = resp[0];
          return_resp['campaign'] = campaign_list;
          return return_resp;
      } else {
          return {};
      }
  };

    /**
     * 每日数据
     * @param url_end
     * @param eff_type
     * @returns {Promise<void>}
     */
    getEverydayData = async(url_end, eff_type) => {
        let day = this.dateArr.start;
        let save_data = {};
        while (day <= this.dateArr.end){
            // 转化率等各指标数据最高，默认转化周期：30天累计数据
            let url = `https://zuanshi.taobao.com/api/report/account/findDaySum.json?&startTime=${day}&endTime=${day}&effectType=${eff_type}&effectPeriod=30` + url_end;
            let resp = await this.sendRequest(url);
            resp = resp['data']['list'];
            if(resp.length > 0){
                save_data[day] = resp[0];
            } else {
                save_data[day] = {};
            }
            save_data[day]['date'] = day;
            day = moment(day).add(1, 'd').format('YYYY-MM-DD')
        }
        return save_data;
    };




  /**
   * 存储数据
   * @param save_data
   * @param eff_type
   */
  saveData  = async (save_data, eff_type) => {
    let data = {
      data:save_data,
      created_at:new Date(),
      updated_at:new Date(),
      date:this._crawlDate,
      start: this.dateArr.start,
      end: this.dateArr.end,
      product: this.spiderName,
      effect: 30,
      effect_type: eff_type,
      nick_name: this._wangwang,
      user_id: this.userId
    };
    //存入数据
    await this._mongo.db.collection('report.report_analysis_data').deleteMany({
        'start': this.dateArr.start,
        'end': this.dateArr.end,
        'nick_name': this._wangwang,
        'product':this.spiderName,
        'effect_type':eff_type,
        'user_id':this.userId
    });
    await this._mongo.db.collection('report.report_analysis_data').insertOne(data);
  };

  /**
   * 发送请求的方法
   * @param {String} url  请求的url
   * */
  sendRequest = async (url)=>{
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

module.exports = { ZzReportAnalysisData };
