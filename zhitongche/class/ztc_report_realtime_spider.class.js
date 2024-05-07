const {asyncForEach, getHeader} = require('../../commons/func');
const dateFormat = require('dateformat');
const { getYesterday } = require('../../commons/dateFunc');

/**
 * 直通车实时数据的爬虫逻辑类
 * */
class ZhitongcheRealTimeSpider {
    constructor (option) {
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
        // 设置超时时间，超时爬取下一家
        this._page.setDefaultTimeout(60000);
        this._page.setDefaultNavigationTimeout(60000);
        // 最终存储数据对象
        let save_data = {};
        let body = '';
        // 订阅 reponse 事件，参数是一个 reponse 实体
        await this._page.on('request', async (request) => {
            if(request.url().indexOf('getGuideInfos') > -1 && request.method() === 'POST'){
                body = request.postData();
            } else if (request.url().indexOf('getNewbieStatus') > -1 && request.method() === 'GET') {
                body = request.url();
            }
        });
        // 订阅 reponse 事件，参数是一个 reponse 实体
        await this._page.on('response',
            async (response) => {
                if (
                    response.url().indexOf('account/getRealBalance.json') > -1 ||
                    response.url().indexOf('getaccountwithcoupon$?sla=json') > -1
                ){
                    console.log(response.url());
                    save_data['account'] = await response.json();
                }
            });
        // 进直通车页面
        try {
            await this._page.goto('https://subway.simba.taobao.com', {waitUntil:'networkidle0'});
            await this._page.waitForSelector('body');
            // 假如cookie有效 根据页面的url 判断登录状态
            const location = await this._page.evaluate(() => window.location);
            console.log(location.href);
            if(location.href.indexOf('error') === -1){      // 如果不是错误页面继续执行
                if(location.href  !== 'https://subway.simba.taobao.com/indexnew.jsp'){
                    if(location.href === 'https://subway.simba.tmall.hk/index.jsp#!/home'){
                        await this._page.reload({waitUntil:'networkidle0'});
                    }
                    // 是否有登录框（有说明未登录）
                    let baxia = await this._page.$('#baxia-dialog-content');
                    // 是否有滑块
                    let hua = await this._page.$('#baxia-punish');
                    if(!baxia && !hua){
                        if(body){
                            // 获取更多数据
                            save_data = await this.getMoreData(save_data, body);
                            console.log(Object.keys(save_data).length);
                            if (Object.keys(save_data).length === 6){
                                await this.saveData(save_data);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.log(e)
        }
        // 进行下一轮
        await this._nextRound(this._wangwang);
    };

    /**
     * 获取更多数据
     * @param save_data 存储的数据
     * @param body 请求body
     * */
    getMoreData = async (save_data, body) => {
        let common_url = this._page.url().match(/[a-zA-z]+:\/\/[^\s]*?\//)[0];
        let token = await getHeader(body);
        if(token){
            token = {'result': {'token': token}};
            save_data['hour_data'] = await this.getHourData(token, common_url);
            save_data['hour_compare'] = await this.getHourCompare(token, common_url);
            save_data['zhe_data'] = await this.getZheData(token, common_url);
            save_data['zhe_compare'] = await this.getZheComapre(token, common_url);
            save_data['budget'] = await this.getBudget(token, common_url);
            return save_data;
        }else {
            return {};
        }
    };

    /**
     * 获取今日实时数据
     * @param token
     * @param common_url
     * @returns {Promise<*>}
     */
    getHourData = async (token, common_url) => {
        const hour = new Date().getHours();
        const today = dateFormat(new Date(), "yyyy-mm-dd");
        return await this.sendReauest(
            {
                'templateId': 'rtRptCustomer',
                'theDate': today,
                'group': 'custid',
                'hour': hour,
                'sla': 'json',
                'isAjaxRequest': 'true',
                'token': token.result.token,
                '_referer': ''
            },
            common_url + 'openapi/param2/1/gateway.subway/common/rtreport/data/get$')

    };

    /**
     * 获取昨日对比数据
     * @param token
     * @param common_url
     * @returns {Promise<*>}
     */
    getHourCompare = async(token, common_url) => {
        const yesterday = await getYesterday();
        const hour = new Date().getHours();
        return await this.sendReauest(
            {
                'templateId': 'rtRptCustomer',
                'theDate': yesterday,
                'group': 'custid',
                'hour': hour,
                'sla': 'json',
                'isAjaxRequest': 'true',
                'token': token.result.token,
                '_referer': ''
            },
            common_url+'/openapi/param2/1/gateway.subway/common/rtreport/data/get$')
    };

    /**
     * 获取折线图今日数据
     * @param token
     * @param common_url
     * @returns {Promise<*>}
     */
    getZheData = async(token, common_url) => {
        const today = dateFormat(new Date(), "yyyy-mm-dd");
        return await this.sendReauest(
            {
                'templateId': 'rtRptCustomer',
                'theDate': today,
                'trafficType': '[1,2,4,5]',
                'group': 'hour',
                'sort': 'hour',
                'sortType': 'asc',
                'sla': 'json',
                'isAjaxRequest': 'true',
                'token': token.result.token,
                '_referer': ''
            },
            common_url+'/openapi/param2/1/gateway.subway/common/rtreport/data/get$')
    };

    /**
     * 获取昨日对比数据
     * @param token
     * @param common_url
     * @returns {Promise<*>}
     */
    getZheComapre = async(token, common_url) => {
        const yesterday = await getYesterday();
        return await this.sendReauest(
            {
                'templateId': 'rtRptCustomer',
                'theDate': yesterday,
                'trafficType': '[1,2,4,5]',
                'group': 'hour',
                'sort': 'hour',
                'sortType': 'asc',
                'sla': 'json',
                'isAjaxRequest': 'true',
                'token': token.result.token,
                '_referer': ''
            },
            common_url+'/openapi/param2/1/gateway.subway/common/rtreport/data/get$')
    };

    /**
     * 获取预算
     * @param token
     * @param common_url
     * @returns {Promise<{budget: number, data}>}
     */
    getBudget = async(token, common_url) => {
        let typeArr = ['16', '0', '8'];     // 计划类型（16：销量明星， 0：标准推广  8：智能推广）
        let budget = 0;                     // 预算
        let result = [];                    // data里的result数据
        let data = {};                      // response的data
        await asyncForEach(typeArr, async(type)=>{
            data =  await this.sendReauest(
                {
                    'type': type,
                    'sla': 'json',
                    'isAjaxRequest': 'true',
                    'token': token.result.token,
                    '_referer': '/manage/campaign/index'
                },
                common_url + 'openapi/param2/1/gateway.subway/common/campaign/list$');
            result = result.concat(data['result']);
            for(let result of data['result']){
                budget = budget + parseInt(result['budget'])
            }
            data['result'] = result;
        });
        return {'budget': budget, data}
    };


    /**
     * 获取token
     * @param common_url
     * @returns token
     * */
    getToken = async (common_url) => {
        // 获取token
        const token = await this.sendReauest({}, common_url + '/bpenv/getLoginUserInfo.htm');
        return token;
    };

    /**
     * 发送请求的方法
     * @param {Object} page page类
     * @param {Object} body 请求发送的数据
     * @param {String} url  请求的url
     * @returns response
     * */
    sendReauest = async (body,url)=>{
        body = await this.parseDataToUrl(body);
        let response = await this._page.evaluate(async (body,url) => {
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
        return response;
    };

    /**
     * 格式化数据得方法
     * @param {Object} data 数据
     * @returns
     * */
    parseDataToUrl = async (data)=>{
        return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
    };

    /**
     * 存储数据
     * @param save_data
     */
    saveData = async (save_data)=>{
        let data = {
            data:save_data,
            created_at:new Date(),
            updated_at:new Date(),
            crawl_date:this._crawlDate,
            nick_name: this._wangwang,
            hour: new Date().getHours()
        };
        // 存入数据
        await this._mongo.db.collection('zhitongche.ztc_realtime_shop_data').deleteMany({
            'crawl_date': this._crawlDate,
            'nick_name': this._wangwang
        });
        await this._mongo.db.collection('zhitongche.ztc_realtime_shop_data').insertOne(data);
       console.log("存入数据成功");

    };
}

module.exports = { ZhitongcheRealTimeSpider };
