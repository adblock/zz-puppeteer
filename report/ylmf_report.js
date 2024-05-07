/**
 * 引力魔方 报表数据爬取
 */
const { setPage, updateSpiderStatus, getCookies, getBrowser} = require('./report_common');
const {mongoQuery} = require('../commons/db');
const {getDynamicToken} = require('./dynamictoken');
const dateFormat = require('dateformat');
const {asyncForEach} = require('../commons/func');
const ObjectId = require('mongodb').ObjectId;

let G_START = '';       // 报表开始日期
let G_END = '';         // 报表结束日期
let G_WANGWANG = '';    // 店铺旺旺
let G_MONGO_ID = '';    // 爬虫状态表的mongoId
let G_USER = '';        // 爬虫状态表的user

/**
 *  开始爬取数据
 * @param page
 * @param retry   重试次数
 * @returns {Promise<void>}
 */
const startCrawl = async(page,retry= 0) => {
    let csrfID = '';
    let magic = false;
    try{
        page.on('response', async (response) => {
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
        await page.goto('https://tuijian.taobao.com/indexbp-display.html?#!/report/index?&effect=15', {waitUntil: "networkidle0"});
        // 未登录处理
        if (page.url().indexOf('https://tuijian.taobao.com/index.html?mxredirectUrl=') > -1) {
            console.log('登录失败');
            await updateSpiderStatus(G_MONGO_ID, '爬取失败');
            process.exit()
        }
        if(magic){
            let url_type = 'https://tuijian.taobao.com/api2/member/getInfo.json?&callback=jQuery&bizCode=display&invitationCode=&dynamicToken=&csrfID=&';
            let refer  = 'https://tuijian.taobao.com/indexbp.html';
            let pintoken = await getPinAndToken(page, url_type, refer);            // 获取info.json接口获取参数pin seedToken
            let timestamp =new Date().getTime();                                   //设置一个时间戳,获取DynamicToken的值
            let dynamic_token = await getDynamicToken(pintoken[0],pintoken[1], timestamp);
            console.log(dynamic_token);

            //引力魔方报表的数据
            await getSumData(page, timestamp, dynamic_token, csrfID);
             await updateSpiderStatus(G_MONGO_ID, '爬取完成');
            process.exit()
        } else {
            console.log('未开通引力魔方');
            await updateSpiderStatus(G_MONGO_ID, '爬取失败');
            process.exit()
        }
    }catch (e) {
        console.log(e);
        retry += 1;
        if(retry <= 3){
            await startCrawl(page,retry);
        } else {
            await updateSpiderStatus(G_MONGO_ID, '爬取失败');
            process.exit()
        }
    }
};

/**
 *  引力魔方-> 报表     转化周期 15天
 * @param page
 * @param timestamp       body参数: 时间戳
 * @param dynamic_token   body参数
 * @param csrfID          body参数
 * @returns {Promise<void>}
 */
const getSumData = async (page, timestamp, dynamic_token, csrfID) => {
    let effectType = ['impression', 'click'];            // 展现 or 点击效果
    let category = ['sum', 'table', 'plan','subject'];   //汇总数据，表格数据，计划名称，投放主体
    let url_list = {
        'sum': 'https://tuijian.taobao.com/api2/report/multiDimension/findSum.json?',
        'table': 'https://tuijian.taobao.com/api2/report/multiDimension/findSumList.json?',
        'plan': 'https://tuijian.taobao.com/api2/report/multiDimension/findPage.json?',
        'subject': 'https://tuijian.taobao.com/api2/report/multiDimension/findPage.json?'
    };

    await asyncForEach(effectType, async (effect) => {
        let result = {};
        console.log('引力魔方', effect);
        await asyncForEach(category, async (cate) => {
            let url = url_list[cate];
            console.log(url);
            await page.waitFor(300);
            let data = {};
            let resp;
            let body = {
                "bizCode": "displayDefault",
                "startTime": G_START,
                "endTime": G_END,
                "effect": 15,
                "effectType": effect,
                "rptDomainOption": JSON.stringify({"needCampaign": true, "needPromotion": true}),
                "timeStr": timestamp,
                "dynamicToken": dynamic_token,
                "csrfID": csrfID
            };

            //发送请求，获取数据     计划名称和投放主体，分别修改body 的值
            if (cate.includes('plan')) {
                body['pageSize'] = 200;                 //body 修改两个值
                body['rptDomainOption']=JSON.stringify({"needCampaign":true});
                resp = await sendReauest(page, body, url);
                if (resp['data']['rptList']) {
                    data = resp['data']['rptList'];
                }
            } else if(cate.includes('subject')){
                body['pageSize'] = 200;
                body['rptDomainOption']=JSON.stringify({"needPromotion":true});
                resp = await sendReauest(page, body, url);
                if (resp['data']['rptList']) {
                    data = resp['data']['rptList'];
                }
            } else {
                resp = await sendReauest(page, body, url);
                if (resp['data']['list']) {
                    data = resp['data']['list'];
                }
            }
            result[cate] = data;
        })
        //存储数据
        await saveData(result, effect);
    })
}

/**
 * 存储数据到mongo
 * @param result       存储的数据
 * @param effect       点击/展现效果
 * @returns {Promise<void>}
 */
const saveData  = async (result, effect) => {
    let data = {
        data:result,
        created_at:new Date(),
        updated_at:new Date(),
        crawl_date:dateFormat(new Date(), "yyyy-mm-dd HH:mm:ss"),
        start: G_START,
        end: G_END,
        effect: 15,
        user_id: G_USER,
        effect_type: effect,
        nick_name: G_WANGWANG,
    };
    // 存入数据
    let db = await mongoQuery();
    await db.collection('report.ylmf_report_data').deleteMany({'start': G_START, 'end': G_END, 'nick_name': G_WANGWANG,
        'effect_type':effect, 'user_id': G_USER});
    await db.collection('report.ylmf_report_data').insertOne(data);
    console.log('存入数据库okok');
};

/**
 * 获取参数pin seedToken
 * @param page
 * @param url_type     url链接
 * @param refer        headers的refer参数
 * @returns {Promise<(string|number)[]>}
 */
const getPinAndToken = async(page, url_type,refer)=>{
    //发送请求，从info.json接口获取参数pin seedToken
    let json = await sendReauest_jsonp(page, url_type, refer);
    let pin = 0;
    let seedToken = '';
    if (json['data']) {
        pin = json['data']['pin'];
        seedToken = json['data']['seedToken'];
    }
    return [seedToken,pin];
}
const sendReauest_jsonp = async (page,url,refer)=>{
    let reponse = await page.evaluate(async (url, refer) => {
        let headers = {
            'referer': refer,
            'sec-ch-ua-platform': 'Windows',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };
        const response = await fetch(url, {headers:headers});
        let text = await response.text();
        text=text.replace('jQuery',"")
        //转换格式
        let json = eval("("+text+")");
        return json;
    },url,refer);
    return reponse;
};
/**
 * 格式化数据得方法
 * @param {Object} data 数据
 * */
const parseDataToUrl = async (data) => {
    return Object.entries(data).map(([key, val]) => `${key}=${val}`).join('&');
};

//发送post请求
const sendReauest = async (page, body, url) => {
    body = await parseDataToUrl(body);
    return await page.evaluate(async (body, url) => {
        let headers = {
            'referer':'https://tuijian.taobao.com/indexbp-display.html',
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