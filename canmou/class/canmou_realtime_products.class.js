/**
 * 生意参谋 -> 实时 -> 实时榜单 ->访客数,支付金额,加购件数 top20
 * 生意参谋 -> 首页 -> 实时概况 ->支付金额+趋势图
 */
const {asyncForEach} = require('../../commons/func');

class CanmouRealtimeProductsSpider {
    constructor(option) {
        this._crawlDate = option.crawlDate; // 爬虫日期
    }
    //初始化函数
    init = async (option) => {
        this._wangwang = option.wangwang; // 旺旺
        this._page = option.page; // 页面
        this._mongo = option.mongo; // mongo查询
        this._nextRound = option.nextRound; // 下一轮
        await this.startCrawl();
    };
    //开始爬取
    startCrawl = async () => {
        try {
            let token = '';
            let suberr = false;  //标识是否出现滑块
            this._page.on('response', async (response) => {
                //出现滑块
                if (response.url().indexOf('_____tmd_____/punish') !== -1) {
                    await this._page.waitFor(3000);
                    suberr = true;  //出现滑块
                }
                //获取token
                if (response.url().indexOf('getPersonalView.json?') > -1) {
                    token = response.url().match(/token=\S+/);
                }
            });

            // 进入后台
            await this._page.goto('https://sycm.taobao.com/ipoll/rank.htm?', {waitUntil: "networkidle0"});
            // 钻展 未登录处理
            if (this._page.url().indexOf('custom/login.htm') !== -1 || this._page.url().indexOf('custom/no_permission') !== -1 || suberr) {
                console.error('Cookie过期或生意参谋未授权');
                await this._nextRound(this._wangwang);
            } else {
                //开始爬取数据
                let save_uv = await this.getUvData(token);
                await this._page.waitFor(3 * 1000);
                let save_pay = await this.getPayData(token);
                let save_trend = await this.getTrendData(token);
                await this.saveData(save_uv, save_pay, save_trend);
                console.log(this._wangwang, 'ok');
                await this._nextRound(this._wangwang);
            }
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
     * 生意参谋 -> 实时 -> 实时榜单 获取访客数, 支付金额,加购件数
     * @param token
     * @returns {Promise<{}>}
     */
    getUvData = async (token) => {
        let types = ['uv', 'payAmt', 'cartItmCnt'];
        let page_num = 3;
        let data = {};
        await asyncForEach(types, async (type) => {
            let result = [];   //返回的数据
            let url = ''
            for (let i = 1; i < page_num; i++) {
                //加购件数 的链接不同
                if (type.includes('cartItmCnt')) {
                    url = 'https://sycm.taobao.com/ipoll/live/rank/item/purchase/add.json?device=0&index=' + type + '&keyword=&page=' + i + '&limit=10&' + token;
                } else {
                    url = 'https://sycm.taobao.com/ipoll/live/rank/item.json?device=0&index=' + type + '&keyword=&page=' + i + '&limit=10&' + token;
                }
                let resp =await this.sendReauest(url);
                if (resp['data']) {
                    let resp_list = resp['data']['data']['list'];
                    await asyncForEach(resp_list, async (item) => {
                        result.push(item);
                    })
                    //一页数据少于10条，则本关键词爬取完毕,否则，则继续
                    if (resp_list.length < 10) {
                        break;
                    }
                } else {
                    console.log('无数据');
                    break;
                }
            }
            console.log(type, result.length);
            data[type] = result;
        })
        return data;
    }

    /**
     * 生意参谋 -> 首页 -> 实时概况    获取支付金额
     * @param token
     * @returns {Promise<string>}
     */
    getPayData = async (token) => {
        let result = '';
        let url = 'https://sycm.taobao.com/portal/live/index/overview.json?sellerType=online&' + token;
        console.log(url);
        let resp =await this.sendReauest(url);
        if (resp['content']['data']) {
            result = resp['content']['data']['data'];
        }
        return result;
    }

    /**
     * 生意参谋 -> 首页 -> 实时概况   获取趋势图
     * @param token
     * @returns {Promise<string>}
     */
    getTrendData = async (token) => {
        let result = '';
        let url = 'https://sycm.taobao.com/portal/live/index/trend.json?sellerType=online&' + token;
        console.log(url);
        let resp =await this.sendReauest(url);
        if (resp['content']['data']) {
            result = resp['content']['data']['data'];
        }
        return result;
    }

    /**
     * 发送请求的方法
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

    // 存储数据到mongo
    saveData = async (save_uv, save_pay, save_trend) => {
        let data = {
            uv: save_uv,
            pay: save_pay,
            trend: save_trend,
            created_at: new Date(),
            updated_at: new Date(),
            crawl_date: this._crawlDate,
            nick_name: this._wangwang,
        };
        // 存入数据
        await this._mongo.db.collection('canmou.realtime_products').deleteMany({
            'crawl_date': this._crawlDate,
            'nick_name': this._wangwang
        });
        await this._mongo.db.collection('canmou.realtime_products').insertOne(data);
    };

}
module.exports = { CanmouRealtimeProductsSpider };