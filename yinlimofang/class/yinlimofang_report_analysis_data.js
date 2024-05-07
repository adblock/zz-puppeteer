/*
@File     ：yinlimofang_report_analysis_data.py
@Date     ：2021/11/13
@describe ：引力魔方7天分析报表
*/
const {asyncForEach} = require('../../commons/func');
const {getDynamicToken} = require('../../report/dynamictoken');

class  YinlimofangReportAnalysisData {
    constructor(option) {
        let date_arr = {};
        date_arr['start'] = option.start; // 报表开始日期
        date_arr['end'] = option.end;   // 报表结束日期
        this.dateArr = date_arr;
        this._crawlDate = option.crawlDate; // 爬虫日期
        this.spiderName = YinlimofangReportAnalysisData.name;
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
        let csrfID = '';
        let magic = false;
        try {
            this._page.on('response', async (response) => {
                //获取参数 csrfID
                if (response.url().indexOf('tuijian.taobao.com/api2/component/findList/bp-permissions.json?') > -1) {
                    csrfID = response.url().match(/(?<=&csrfID=)\S+/) + '';
                }
                //判断是否开通引力魔方
                if (response.url().indexOf('tuijian.taobao.com/api2/member/getInfo.json?') > -1) {
                    magic = true;
                }
            });
            // 进入后台
            await this._page.goto('https://tuijian.taobao.com/indexbp-display.html?#!/report/index?&effect=30', {waitUntil: "networkidle0"});
            if (this._page.url().indexOf('https://tuijian.taobao.com/index.html?mxredirectUrl=') > -1) {
                console.log('cookie失效');
                process.exit()
            }
            if(magic){
                let url_type = 'https://tuijian.taobao.com/api2/member/getInfo.json?&callback=jQuery&bizCode=display&invitationCode=&dynamicToken=&csrfID=&';
                let refer  = 'https://tuijian.taobao.com/indexbp.html';
                let pintoken = await this.getPinAndToken(url_type, refer);            // 获取info.json接口获取参数pin seedToken
                let timestamp =new Date().getTime();                                   //设置一个时间戳,获取DynamicToken的值
                let dynamic_token = await getDynamicToken(pintoken[0],pintoken[1], timestamp);
                console.log(dynamic_token);
                 //获取数据
                await this.getData(timestamp, dynamic_token, csrfID);
                console.log('----over');

            }else{
                console.log('店铺未开通引力魔方');
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
     * 店铺汇总数据, 每日数据, 计划分日数据
     * 引力魔方-> 报表 ->计划名称
     * @param timestamp               时间戳
     * @param dynamic_token           body参数
     * @param csrfID                  body参数
     */
    getData = async (timestamp, dynamic_token, csrfID) => {
        try {
            //展现/点击效果
            let effect_type = ['impression', 'click'];
            await asyncForEach(effect_type, async (effect) => {
                let save_data = {};
                let body = {
                    "bizCode": "displayDefault",
                    "startTime": this.dateArr.start,
                    "endTime": this.dateArr.end,
                    "effect": 30,
                    "effectType": effect,
                    "rptDomainOption": JSON.stringify({"needCampaign": true, "needPromotion": true}),
                    "timeStr": timestamp,
                    "dynamicToken": dynamic_token,
                    "csrfID": csrfID
                };

                //店铺分日数据
                save_data['day'] = await this.getDayData(effect, body);
                //店铺汇总数据，
                save_data['total'] = await this.getTotalData(effect, body);
                //计划汇总数据
                let campaign_list = await this.getCampaign_TotalData(effect, body, save_data);
                //计划分日数据
                save_data['campaign_day'] = await this.getCampaign_DayData(effect, body, campaign_list[0],campaign_list[1]);
                //保存数据
                await this.saveData(save_data, effect);
            });
        } catch (e) {
            console.log('Error: ',e.message);

        }
    };

    //店铺每天的数据
    getDayData = async(effect, body)=>{
        let url = 'https://tuijian.taobao.com/api2/report/multiDimension/findSumList.json?';
        let result = {};
        //发送请求，获取数据
        let resp = await this.sendReauest_Post(body, url);
        let data_list = resp['data']['list']
        if (data_list) {
           await asyncForEach(data_list, async(item)=>{
               result[item['logDate']] = item;
           })
        }
        return result;
    }

    /**
     *   店铺汇总
     * @param effect       点击/展现效果
     * @param body         post请求参数 body
     */
    getTotalData = async (effect, body) => {
        console.log('引力魔方', effect);
        let url = 'https://tuijian.taobao.com/api2/report/multiDimension/findSum.json?'
        let data = {};
        //发送请求，获取数据
        let resp = await this.sendReauest_Post(body, url);
        if (resp['data']['list']) {
            data = resp['data']['list'][0];
        }
        return data;
    };

    /**
     * 获取计划汇总数据 和 计划Id    引力魔方 -> 报表
     */
    getCampaign_TotalData = async(effect, body, save_data)=>{
        let campaignIdList = [];    //计划id列表
        let campaign_item = {};     //计划id和名称
        let campaign_url = 'https://tuijian.taobao.com/api2/report/multiDimension/findPage.json?';
        body['pageSize'] = 200;
        let resp = await this.sendReauest_Post(body, campaign_url);
        let data = resp['data']['rptList'];

        //存储所有计划的汇总数据
        save_data['total']['campaign'] = data;
        //获取计划id和名称
        await asyncForEach(data, async(item)=>{
            let campaign_id = item['campaignId'];
            campaignIdList.push(campaign_id);
            campaign_item[campaign_id] = item['campaignName']; //计划id:计划名称
        })
        return [campaignIdList, campaign_item];
    }

    /**
     * 计划每日数据
     * @param effect                点击/展现效果
     * @param body                  post请求参数:  循环添加单个计划id
     * @param campaignIdList        计划id列表
     * @param campaign_item         计划名称
     * @returns {Promise<{}>}
     */
    getCampaign_DayData = async(effect, body, campaignIdList, campaign_item) => {
        delete body['pageSize'];
        let result = {};               //result {计划id{{campaignName:计划名称}，{日期：每天的数据}}}
        let campaign_url = 'https://tuijian.taobao.com/api2/report/multiDimension/findSumList.json?';

        //遍历计划id列表， 获取计划分日数据
        await asyncForEach(campaignIdList, async(campaignId)=>{
            result[campaignId] = {};
            result[campaignId]['campaignName'] = campaign_item[campaignId];   //添加计划名称

            body['campaignIdList'] = [campaignId.toString()];                 //每次查询一个计划的分日数据
            await this._page.waitFor(100);                                    //等待时间
            let resp = await this.sendReauest_Post(body, campaign_url);
            let campaign_data = resp['data']['list'];
            if(campaign_data){
                await asyncForEach(campaign_data, async(item)=>{
                    result[campaignId][item['logDate']] = item;
                })
            }
        })
        return result;
    };

    /**
     * 存储数据
     * @param save_data     引力魔方的数据
     * @param eff_type      展现/点击效果
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
        console.log('数据存储okok');
    };


    /**
     * 获取参数pin seedToken
     * @param page
     * @param url_type     url链接
     * @param refer        headers的refer参数
     * @returns {Promise<(string|number)[]>}
     */

    getPinAndToken = async (url_type, refer) => {
        //发送请求，从info.json接口获取参数pin seedToken
        let json = await this.sendReauest_jsonp(url_type, refer);
        let pin = 0;
        let seedToken = '';
        if (json['data']) {
            pin = json['data']['pin'];
            seedToken = json['data']['seedToken'];
        }
        return [seedToken, pin];
    }
    sendReauest_jsonp = async (url, refer) => {
        let reponse = await this._page.evaluate(async (url, refer) => {
            let headers = {
                'referer': refer,
                'sec-ch-ua-platform': 'Windows',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
            };
            const response = await fetch(url, {headers: headers});
            let text = await response.text();
            text = text.replace('jQuery', "")
            //转换格式
            let json = eval("(" + text + ")");
            return json;
        }, url, refer);
        return reponse;
    };
    /**
     * 格式化数据得方法
     * @param {Object} data 数据
     * */
    parseDataToUrl = async (data) => {
        return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
    };

    //发送post请求
    sendReauest_Post = async (body, url) => {
        body = await this.parseDataToUrl(body);
        return await this._page.evaluate(async (body, url) => {
            let headers = {
                'referer': 'https://tuijian.taobao.com/indexbp-display.html',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'user-agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36'

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


}

module.exports = { YinlimofangReportAnalysisData };
