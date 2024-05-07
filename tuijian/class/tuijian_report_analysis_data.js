/*
@File     ：tuijian_report_analysis_data.py
@Author   ：qingyang
@Date     ：2021/8/25 11:15 
@describe ：超级推荐7天分析报表
*/
const {asyncForEach} = require('../../commons/func');
const moment = require('moment');

class TuijianReportAnalysisData {
    constructor(option) {
        let date_arr = {};
        date_arr['start'] = option.start; // 报表开始日期
        date_arr['end'] = option.end;   // 报表结束日期
        this.dateArr = date_arr;
        this._crawlDate = option.crawlDate; // 爬虫日期
        this.spiderName = TuijianReportAnalysisData.name;
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
                console.log('超级推荐登录失败');
            } else {
                if (url_end) {
                  await this.getData(url_end);
                }
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
    getData = async (url_end) => {
        // 汇总数据
        let effect_type = ['impression', 'click'];
        await asyncForEach(effect_type, async(eff_type) => {
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
     * 计划每日数据数据
     * @param url_end
     * @param eff_type
     * @returns {Promise<*>}
     */
    getCampaignDayData = async(url_end, eff_type) => {
        let effect = 30;  // 转化率等各指标数据最高，默认转化周期：30天累计数据

        // 计划类型
        let type_list = ['Item', 'Picture', 'Live', 'ShortVideo', 'LiveGuarantee'];
        let campaign_save = {};
        await asyncForEach(type_list, async(type) => {
            // 获取计划列表
            let campaigns_url = `https://tuijian.taobao.com/api/campaign/report/findPage.json?&startTime=${this.dateArr.start}&endTime=${this.dateArr.end}&effect=${effect}&effectType=${eff_type}&offset=0&pageSize=100&orderField=&orderBy=` + url_end + type;
            let campaigns_resp = await this.sendRequest(campaigns_url);
            campaigns_resp = campaigns_resp['data']['list'];
            await asyncForEach(campaigns_resp, async(campaign) => {
                let campaign_url = `https://tuijian.taobao.com/api/campaign/report/findList.json?&startTime=${this.dateArr.start}&endTime=${this.dateArr.end}&effect=${effect}&effectType=${eff_type}&campaignId=${campaign.campaignId}` + url_end + type;
                let campaign_resp = await this.sendRequest(campaign_url);
                campaign_resp = campaign_resp['data']['list'];
                let campaign_day = {'campaignName': campaign.campaignName};
                await asyncForEach(campaign_resp, async(day_campaign) => {
                    campaign_day[day_campaign.logDate] = day_campaign;
                });
                campaign_save[campaign.campaignId] = campaign_day;
            });
        });
        return campaign_save;
    };

      /**
     * 汇总数据
     * @param url_end
     * @param eff_type  效果类型（点击，展现）
     * @returns {Promise<*>}
     */
    getTotalData = async(url_end, eff_type) => {
        let effect = 30;  // 转化率等各指标数据最高，默认转化周期：30天累计数据
        // 计划列表
        // 计划类型
        let type_list = ['Item', 'Picture', 'Live', 'ShortVideo', 'LiveGuarantee'];
        let campaign_list = [];
        await asyncForEach(type_list, async(type) => {
            let campaign_url = `https://tuijian.taobao.com/api/campaign/report/findPage.json?&startTime=${this.dateArr.start}&endTime=${this.dateArr.end}&effect=${effect}&effectType=${eff_type}&offset=0&pageSize=100&orderField=&orderBy=` + url_end + type;
            let campaign_resp = await this.sendRequest(campaign_url);
            campaign_list = campaign_list.concat(campaign_resp['data']['list']);
        });

        // 总计数据
        let sum_url = `https://tuijian.taobao.com/api/account/report/findDaySum.json?&startTime=${this.dateArr.start}&endTime=${this.dateArr.end}&effectType=${eff_type}&effect=${effect}` + url_end;
        let sum_resp = await this.sendRequest(sum_url);
        let return_resp = sum_resp['data']['list'];
        if(return_resp.length > 0){
            return_resp = return_resp[0];
            return_resp['campaign'] = campaign_list;
            return return_resp;
        } else {
            return {}
        }
    };

    /**
     * 每日数据
     * @param url_end
     * @param eff_type
     * @returns {Promise<void>}
     */
    getEverydayData = async(url_end, eff_type) => {
        let effect = 30;  // 转化率等各指标数据最高，默认转化周期：30天累计数据
        let day = this.dateArr.start;
        let save_data = {};
        while (day <= this.dateArr.end){
            let url = `https://tuijian.taobao.com/api/account/report/findDaySum.json?&startTime=${day}&endTime=${day}&effectType=${eff_type}&effect=${effect}` + url_end;
            console.log(url);
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
  saveData = async (save_data, eff_type) => {
    let data = {
      data: save_data,
      created_at: new Date(),
      updated_at: new Date(),
      date: this._crawlDate,
      start: this.dateArr.start,
      end: this.dateArr.end,
      effect: 30,
      effect_type: eff_type,
      product: this.spiderName,
      nick_name: this._wangwang,
      user_id: this.userId
    };
    // 存入数据
    await this._mongo.db.collection('report.report_analysis_data').deleteMany({
      'start': this.dateArr.start,
      'end': this.dateArr.end,
      'nick_name': this._wangwang,
      'product': this.spiderName,
      'effect_type': eff_type,
      'user_id':this.userId
    });
    await this._mongo.db.collection('report.report_analysis_data').insertOne(data);
  };

  /**
   * 发送请求的方法
   * @param {String} url  请求的url
   * */
  sendRequest = async (url) => {
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

module.exports = { TuijianReportAnalysisData };
