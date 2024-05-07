
/**
 * 引力魔方 计划数据的爬虫逻辑类
 * */
class YinlimofangCampaignDataSpider {
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
            let timeStr = '';
            let mofang = false;
            await this._page.on('response', async (response) => {
                //获取参数timeStr
                if (response.url().indexOf('tuijian.taobao.com/api2/component/findList/bp-permissions.json?') > -1) {
                    timeStr = response.url().match(/&timeStr=\S+/) + '';
                }
                //判断是否开通引力魔方
                if (response.url().indexOf('tuijian.taobao.com/api2/member/getInfo.json?') > -1) {
                    mofang = true;
                }

            })
            // 进入后台
            await this._page.waitFor(1000 + Math.round(Math.random()) * 100);
            await this._page.goto('https://tuijian.taobao.com/indexbp.html#!/manage/index?tab=campaign', {waitUntil: "networkidle0"});
            //若cookie 失效，或有滑块，开始下一个店铺
            if (this._page.url().indexOf('https://tuijian.taobao.com/index.html') > -1 || this._page.url().indexOf('punish?x5secdata') > -1) {
                console.log('页面加载未完成');
            } else {
                if (mofang) {
                    let save_data = await this.getPlanData(timeStr);
                    await this.saveData(save_data);
                } else {
                    console.log('未开通引力魔方');
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
    getPlanData = async (timeStr) => {
        let url = 'https://tuijian.taobao.com/api2/campaign/horizontal/findPage.json?&bizCode=displayDefault&statusList=%5B%22start%22%2C%22pause%22%2C%22wait%22%2C%22terminate%22%2C%22abnormal%22%5D&offset=0&pageSize=500' +
            '&rptQuery=%7B%22startTime%22%3A%22' + this._crawlDate + '%22%2C%22endTime%22%3A%22' + this._crawlDate + '%22%7D' + timeStr;
        let resp = await this.sendReauest(url);
        let data = resp['data']['list'];
        console.log('计划的个数',data.length);
        return data;
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
        await this._mongo.db.collection('yinlimofang.ylmf_campaign_data').deleteMany({
            'crawl_date': this._crawlDate,
            'nick_name': this._wangwang
        });
        await this._mongo.db.collection('yinlimofang.ylmf_campaign_data').insertOne(data);
    };
    /**
     * 发送请求的方法
     * @param {Object} page page类
     * @param {String} url  请求的url
     * */
    sendReauest = async (url) => {
        return await this._page.evaluate(async (url) => {
            let headers = {
                'referer': 'https://tuijian.taobao.com/indexbp.html',
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

module.exports = { YinlimofangCampaignDataSpider };