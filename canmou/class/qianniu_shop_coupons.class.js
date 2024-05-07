/**
 * 千牛平台 ->我是卖家 ->营销工作台-> 优惠券
 */
const {asyncForEach} = require('../../commons/func');
const crypto = require('crypto');
const rpn = require('request-promise-native');

class ShopCouponsDataSpider {
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
        await this.startCrawl();
    };
    //开始爬取
     startCrawl = async () => {
        try {
            let token = '';
            let cookies = '';
            // 进入后台
            await this._page.goto('https://shell.mkt.taobao.com/coupon/index#/?couponType=3', {waitUntil: "networkidle0"});
            if (this._page.url().indexOf('login.tmall.com/?redirectURL=') !== -1|| this._page.url().indexOf('shell.mkt.taobao.com/coupon/subNoPermission')!== -1) {
                console.error('Cookie过期 或 服务未开通');
                await this._nextRound(this._wangwang);
            } else {
                // 获取token，cookies
                let cooki = await this._page.cookies();
                await asyncForEach(cooki, async (cookie) => {
                    cookies = cookies + cookie['name'] + '=' + cookie['value'] + '; ';
                    if (cookie['name'] === '_m_h5_tk') {
                        token = cookie['value'].match(/\S+(?=_)/) + '';
                        console.log('token= ', token);
                    }
                })

                //开始爬取数据
                //裂变商品
                let fission_coupons = await this.getFissionProducts(token, cookies);
                //店铺，商品，裂变优惠券
                let shop_coupons = await this.getShopCoupons();
                //保存数据
                await this.saveData(shop_coupons, fission_coupons);
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
     * 获取店铺，商品，裂变优惠券             千牛平台 ->我是卖家 ->营销工作台-> 优惠券
     * 每页最多取出256个
     * @param page
     * @returns {Promise<{}>}
     */
     getShopCoupons = async()=>{
        let result = {};
        let type = {0: 'shop', 1: 'product', 9999: 'fission'};  //值 ：存入数据库的字段
        let coupon_type = [0, 1, 9999];
        await asyncForEach(coupon_type, async(item)=>{
            await this._page.waitFor(2000);
            let data_coup = [];             //存放每个类型优惠券的数据
            let url = '';
            if(item===9999){
                url='https://shell.mkt.taobao.com/fissionCoupon/getList?pageSize=256&pageNo=1&couponType='+item+'&status=-1';
            }else{
                url ='https://shell.mkt.taobao.com/coupon/getList?pageSize=256&pageNo=1&couponType='+item+'&status=-1&amount=-1';
            }
            let resp = await this.sendReauest(url);
            data_coup.push(resp['data']['data']);

            //获取商品总数量
            let total = resp['data']['totalCount'];
            console.log(type[item],'总个数',total);
            if(total && total>256){                    //超过500个，则请求下一页的数据
                let url_next = '';                     //下一页的链接
                let count = Math.ceil(total / 256); //向上取整
                for(let i =1;i<count;i++){
                    let pageno = i+1;

                    if(item===9999){
                        url_next='https://shell.mkt.taobao.com/fissionCoupon/getList?pageSize=256&pageNo='+pageno+'&couponType='+item+'&status=-1';
                    }else{
                        url_next ='https://shell.mkt.taobao.com/coupon/getList?pageSize=256&pageNo='+pageno+'&couponType='+item+'&status=-1&amount=-1';
                    }
                    let resp_temp = await this.sendReauest(url_next);
                    let resp_next = resp_temp['data']['data'];
                    if(resp_next){
                        data_coup.push(resp_next);
                    }
                }
            }
            console.log('存储页数',data_coup.length);
            result[type[item]] = data_coup;
        })
        return result;
    }

    /**
     * 获取参数sign
     * @param token           _m_h5_tk的值
     * @param page_number      页数
     * @returns {Promise<string[]>}
     */
     getSign = async (token, page_number) => {
        let t = new Date().getTime().toString();
        let appKey = "12574478";       //("waptest" === o.subDomain ? "4272" : "12574478")
        let data = JSON.stringify({"isItemFission": false, "pageSize": 500, "itemId": null, "title": "", "pageNumber": page_number});
        let str = "";
        str = str.concat(token, "&", t, "&", appKey, "&", data);
        let sign = crypto.createHash('md5').update(str).digest('hex');    //md5加密 十六进制
        return [sign, t];
    }


    /**
     * 裂变商品,发送request请求api，每次500个                 千牛平台 ->我是卖家 ->营销工作台-> 优惠券
     * @param page
     * @param token
     * @param cookies
     * @returns {Promise<*>}
     */
     getFissionProducts = async (token, cookies,retry=0) => {
        let result = [];      //存放优惠券数据
        let sign = await this.getSign(token, 1);
        let headers = {
            'referer': 'https://shell.mkt.taobao.com/',
            'sec-fetch-dest': 'script',
            'sec-fetch-mode': 'no-cors',
            'sec-fetch-site': 'same-site',
            'cookie': cookies
        };
        let url = 'https://h5api.m.taobao.com/h5/mtop.alibaba.marketing.fission.item.fission.list/1.0/?jsv=2.6.1&appKey=12574478' +
            '&t=' + sign[1] + '&sign=' + sign[0] + '&api=mtop.alibaba.marketing.fission.item.fission.list&v=1.0&ecode=1&AntiFlood=true&timeout=20000&data=%7B%22isItemFission%22%3Afalse%2C%22pageSize%22%3A500%2C%22itemId%22%3Anull%2C%22title%22%3A%22%22%2C%22pageNumber%22%3A1%7D';
        let opts = {
            uri:url,
            method: "GET",
            headers: headers,
            json: true
        }
        let body = await rpn(opts);        //同步发送请求
        console.log(body['ret']);
        //请求接口失败，则重试
        if(body['ret'].includes('SUCCESS::调用成功')===false){
            if(retry<3){
                retry = retry+1;
                await this.getFissionProducts(token, cookies, retry);
            }
        }
        //请求第一页的数据
        result.push(body['data']['module']['model']);

        //获取商品总数量
        let total = body['data']['module']['totalNumber'];
        console.log('裂变商品总数', total);
        if (total && total > 500) {                     //超过500个，则请求下一页的数据
            let count = Math.ceil(total / 500);      //向上取整
            for (let i = 1; i < count; i++) {
                let page_number = i + 1;
                console.log('------------------------------', page_number);
                await this._page.waitFor(2000);

                //获取参数sign
                let sign_next = await this.getSign(token, page_number);
                let url_next = 'https://h5api.m.taobao.com/h5/mtop.alibaba.marketing.fission.item.fission.list/1.0/?jsv=2.6.1&appKey=12574478' +
                    '&t=' + sign_next[1] + '&sign=' + sign_next[0] + '&api=mtop.alibaba.marketing.fission.item.fission.list&v=1.0&ecode=1&AntiFlood=true&data=%7B%22isItemFission%22%3Afalse%2C%22pageSize%22%3A500%2C%22itemId%22%3Anull%2C%22title%22%3A%22%22%2C%22pageNumber%22%3A' + page_number + '%7D';
                let opts = {
                    uri:url_next,
                    method: "GET",
                    headers: headers,
                    json: true
                }
                let resp = await rpn(opts);        //同步发送请求
                console.log(resp['ret']);
                let result_list = resp['data']['module']['model'];
                if (result_list) {
                    result.push(result_list);
                }
            }
        }
        console.log('总页数', result.length);
        return result;
    }

    /**
     * 发送请求的方法
     * @param {Object} page page类
     * @param {String} url  请求的url
     * */
     sendReauest = async (url) => {
        return await this._page.evaluate(async (url) => {
            let headers = {
                'referer': 'https://shell.mkt.taobao.com/coupon/index',
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
     saveData = async (shop_coupons, fission_coupons) => {
        let data = {
            coupon: shop_coupons,
            fission_products: fission_coupons,
            created_at: new Date(),
            crawl_date: this._crawlDate,
            nick_name: this._wangwang,
        };
        // 存入数据
         await this._mongo.db.collection('qianniu_shop_coupons').deleteMany({'crawl_date': this._crawlDate, 'nick_name': this._wangwang});
         await this._mongo.db.collection('qianniu_shop_coupons').insertOne(data);
    };
}
module.exports = { ShopCouponsDataSpider };
