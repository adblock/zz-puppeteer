/**
 * 钻展 报表数据爬取
 */
const { setPage, updateSpiderStatus, getCookies, getBrowser, shopChart, shopSum, campaignChart, campaignSum } = require('./report_common');
const {mongoQuery} = require('../commons/db');
const moment = require('moment');
const ObjectId = require('mongodb').ObjectId;

let G_START = '';       // 报表开始日期
let G_END = '';         // 报表结束日期
let G_WANGWANG = '';    // 店铺旺旺
let G_MONGO_ID = '';    // 爬虫状态表的mongoId
let G_USER = '';        // 爬虫状态表的user

/**
 *
 * @param page                  page实例
 * @returns {Promise<void>}
 */
const startCrawl = async(page) => {
    let token = '';
    try{
        // 拦截请求, 获取fetch需要的token等字段
        await page.setRequestInterception(true);
        page.on('request',  async(request) => {
            if(request.url().indexOf('zuanshi.taobao.com/code/all.json') > -1) {
                let params = request.url().match(/&timeStr=(\S+)/);
                if(params.length > 0 && token === ''){
                    token = params[0];       // 获取token 等字段
                }
                return request.continue();
            } else {
                return request.continue();
            }
        });

        // 进入后台
        await page.goto('https://zuanshi.taobao.com/index_poquan.jsp', {waitUntil: "networkidle0"});
        // 钻展 未登录处理
        if(page.url().indexOf('zuanshi.taobao.com/index.html?mxredirectUrl=') > -1){
            console.log('登录失败');
            await updateSpiderStatus(G_MONGO_ID, '爬取失败');
            process.exit()
        }
        if(token){
            // 报表类型
            let type_list = ['', 'PoquanWeizhi', 'PoquanFanxingqu', 'PoquanXingqu', 'PoquanZidingyi'];
            let save_flag = 0;
            for(let type of type_list){
                for(let eff_type of ['impression', 'click']){
                    let retry = 0;              // 重试次数
                    let save_data = null;       // 存储的数据
                    try{
                        if(type === ''){
                            save_data = await getShopData(page, token, retry, eff_type)
                        } else {
                            // token的bizCode 修改
                            token = token.replace(/bizCode=(\S+)/, 'bizCode=zszw' + type);
                            save_data = await getData(page, token, retry, eff_type)
                        }
                    }catch (e) {
                        retry += 1;
                        if(retry <= 3){
                            if(type === ''){
                                save_data = await getShopData(page, token, retry, eff_type)
                            } else {
                                save_data = await getData(page, token, retry, eff_type)
                            }
                        }
                    }
                    if(save_data){
                        console.log('save data ........');
                        save_flag += 1;
                        await saveData(save_data, type, eff_type);
                    } else {
                        await updateSpiderStatus(G_MONGO_ID, '爬取失败');
                        console.log('获取数据失败')
                    }
                }
            }
            if(save_flag === 10){
                await updateSpiderStatus(G_MONGO_ID, '爬取完成');
            }else {
                await updateSpiderStatus(G_MONGO_ID, '爬取失败');
            }
            process.exit()
        } else {
            console.log('token 为空，爬取失败');
            await updateSpiderStatus(G_MONGO_ID, '爬取失败');
            process.exit()
        }
    }catch (e) {
        console.log(e);
    }
};


/**
 * 获取店铺概览数据
 * @param page
 * @param token
 * @param retry
 * @param eff_type  点击或者展现效果
 * @returns {Promise<null>}
 */
const getShopData = async(page, token, retry, eff_type) => {
    let save_data = {};         // 存储数据 对象
    // 店铺概览数据
    let shop_sum_url = 'https://zuanshi.taobao.com/api/report/account/findDaySum.json?startTime='+ G_START+
                   '&endTime='+G_END+'&effectType=' + eff_type + '&effectPeriod=30' + token;
    save_data.shop_data = await shopSum(page, shop_sum_url);
    // 店铺图表数据
    let chart_url = 'https://zuanshi.taobao.com/api/report/account/findDayList.json?startTime='+ G_START+
                   '&endTime='+G_END+'&effectType=' + eff_type + '&effectPeriod=30' + token;
    save_data.shop_chart = await shopChart(page, chart_url);

     // 如果爬取全部结束就存储数据
    if(Object.keys(save_data).length === 2){
        return save_data
    } else {
        retry += 1;
        if(retry <= 3){
            await getShopData(page, token, retry, eff_type)
        } else {
            return null
        }
    }
};

/**
 * 获取 除概览数据 所有数据（商品、图文、直播）方法， 失败递归共重试三次
 * @param page
 * @param token     超级推荐token
 * @param retry     重试次数
 * @param eff_type  点击或者展现效果
 * @returns {Promise<null>}
 */
const getData = async(page, token, retry, eff_type) => {
    let save_data = {};         // 存储数据 对象
    // 概览数据
    let shop_sum_url = 'https://zuanshi.taobao.com/api/report/account/findDaySum.json?startTime='+ G_START+
                   '&endTime='+G_END+'&effectType=' + eff_type + '&effectPeriod=30' + token;
    save_data.shop_data = await shopSum(page, shop_sum_url);
    // 图表数据
    let chart_url = 'https://zuanshi.taobao.com/api/report/account/findDayList.json?startTime='+ G_START+
                   '&endTime='+G_END+'&effectType=' + eff_type + '&effectPeriod=30' + token;
    save_data.shop_chart = await shopChart(page, chart_url);
    // 获取 计划id列表 和 计划概览数据
    let campaign_group_url = 'https://zuanshi.taobao.com/api/report/component/findPage.json?componentType=campaignGroup' +
                             '&startTime=' + G_START + '&endTime=' + G_END + '&effectType=' + eff_type + '&effectPeriod=30' +
                             '&currentPage=1&pageSize=100&searchKey=&searchValue=&orderField=&orderBy=' + token;
    let campaign_data = await campaignSum(page, campaign_group_url);
    // 计划组概览数据
    save_data.campaign_data = campaign_data[1];
    // 计划组图表数据
    let campaign_url_dict = {};
    for(let campaign_id of campaign_data[0]) {
        campaign_url_dict[campaign_id] = 'https://zuanshi.taobao.com/api/report/component/findDayList.json?startTime=' +
            G_START + '&endTime=' + G_END + '&effectType=impression&effectPeriod=3&componentType=campaignGroup&' +
            'componentIdList=%5B%7B%22campaignGroupId%22%3A%22' + campaign_id + '%22%7D%5D' + token;
    }
    save_data.campaign_chart = await campaignChart(page, campaign_url_dict);

     // 如果爬取全部结束就存储数据
    if(Object.keys(save_data).length === 4){
        return save_data
    } else {
        retry += 1;
        if(retry <= 3){
            await getData(page, token, retry, eff_type)
        } else {
            return null
        }
    }
};

/**
 * 存储数据到mongo
 * @param save_data             存储的数据
 * @param type                  推广类型
 * @param eff_type              点击/展现效果
 * @returns {Promise<void>}
 */
const saveData  = async (save_data, type, eff_type) => {
    if(type === ''){
        type = 'Shop'
    }
    let data = {
        data:save_data,
        created_at:new Date(),
        updated_at:new Date(),
        crawl_date:moment(new Date()).format("YYYY-MM-DD"),
        start: G_START,
        end: G_END,
        effect: 30,
        user_id: G_USER,
        type: type,
        effect_type: eff_type,
        nick_name: G_WANGWANG,
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('report.zz_report_data').deleteMany({'start': G_START, 'end': G_END, 'nick_name': G_WANGWANG,
                                                                'type': type, 'effect_type': eff_type});
    await db.collection('report.zz_report_data').insertOne(data);
};

/**
 * 根据传入的mongo_id 获取爬虫状态，初始化爬虫
 * @param mongo_id
 */
const initSpiderStatus = async(mongo_id) => {
    // 根据mongo id 查询 要爬取的店铺信息
    let db = await mongoQuery();
    const shop_data = await db.collection('report_spider_status_list').find({_id:ObjectId(mongo_id)}).toArray();
    G_MONGO_ID = mongo_id;
    G_START = shop_data[0].start_time;
    G_END = shop_data[0].end_time;
    G_USER = shop_data[0].user_id;
    G_WANGWANG = shop_data[0].shop_name;
};

(async() => {
    console.log('begin');
    try{
        const args = process.argv.splice(2);
        await initSpiderStatus(args[0]);
        console.log(G_MONGO_ID);
        console.log(G_WANGWANG);

        const cookies = await getCookies(G_WANGWANG);
        if(cookies.length > 0){
            const browser = await getBrowser();
            let page = await setPage(browser, cookies[0]);

            await updateSpiderStatus(G_MONGO_ID, '爬取中');
            console.log('status:ok');
            await startCrawl(page);
        } else {
            console.log('无 可用cookie');
            await updateSpiderStatus(G_MONGO_ID, '爬取失败');
            console.log('status:error');
            process.exit()
        }
    } catch (e) {
        console.log(e);
        await updateSpiderStatus(G_MONGO_ID, '爬取失败');
        console.log('status:error');
        process.exit()
    }
})();