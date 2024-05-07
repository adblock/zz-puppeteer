/*
@File     ：analysis_report.py
@Author   ：qingyang
@Date     ：2021/8/28 17:15 
@describe ：7天分析报表的调度爬虫
*/
const puppeteer = require('puppeteer');
const config = require('../config');
const {asyncForEach,setJs,getHeader} = require('../commons/func');
const { ZtcReportAnalysisData } = require('../zhitongche/class/ztc_report_analysis_data');
const { ZzReportAnalysisData } = require('../zuanzhan/class/zz_report_analysis_data');
const { TuijianReportAnalysisData } = require('../tuijian/class/tuijian_report_analysis_data');
const { YinlimofangReportAnalysisData } = require('../yinlimofang/class/yinlimofang_report_analysis_data');
const { JupinSpider } = require('../jupin_spider/jupin_spider.class');
const { getCZZShopBoss } = require('../commons/func');
const {mongoQuery} = require('../commons/db');
const moment = require('moment');
const ObjectId = require('mongodb').ObjectId;

let G_MONGO_ID = '';
// 修改爬虫运行状态（MongoDB）
const updateSpiderStatus = async(status) => {
    let db = await mongoQuery();
    await db.collection('report_spider_status_list').updateOne({_id:ObjectId(G_MONGO_ID)}, {$set:{'spider_type': status}})
};

(async() => {
    console.log('begin');
    try{
        const args = process.argv.splice(2);
        G_MONGO_ID = args[0];
        console.log(G_MONGO_ID);
        // 根据mongo id 查询 要爬取的店铺信息
        let db = await mongoQuery();
        const shop_data = await db.collection('report_spider_status_list').find({_id:ObjectId(G_MONGO_ID)}).toArray();

        let wangwang = shop_data[0].shop_name;
        console.log(wangwang);

        // 爬虫的抓取数据的时间
        let crawlDate = await moment().format('YYYY-MM-DD');
        let shop_list = [{ f_copy_wangwangid: wangwang }];
        // 爬虫逻辑的实例
        const ztcReportSpider = new ZtcReportAnalysisData({
            'crawlDate':crawlDate,
            'start':shop_data[0].start_time,
            'end':shop_data[0].end_time,
            'user_id': shop_data[0].user_id
        });
        // 爬虫逻辑的实例
        const zzReportSpider = new ZzReportAnalysisData({
            'crawlDate':crawlDate,
            'start':shop_data[0].start_time,
            'end':shop_data[0].end_time,
            'user_id': shop_data[0].user_id
        });
        // 爬虫逻辑的实例
        const tjReportSpider = new TuijianReportAnalysisData({
            'crawlDate':crawlDate,
            'start':shop_data[0].start_time,
            'end':shop_data[0].end_time,
            'user_id': shop_data[0].user_id
        });
        // 爬虫逻辑的实例
        const ylmfReportSpider = new YinlimofangReportAnalysisData({
            'crawlDate':crawlDate,
            'start':shop_data[0].start_time,
            'end':shop_data[0].end_time,
            'user_id': shop_data[0].user_id
        });
        let reportSpider = [tjReportSpider, ztcReportSpider, zzReportSpider, ylmfReportSpider];

        // 爬虫公用逻辑实例
        let jupinSpiderList = [];
        await asyncForEach(reportSpider, async(spider) => {
            jupinSpiderList.push(new JupinSpider({
                'shopList':shop_list,
                'spider': spider
            }))
        });

        let success = 1;    // 是否爬取成功, 默认成功
        // 顺序启动爬虫
        await updateSpiderStatus('爬取中');
        await asyncForEach(jupinSpiderList, async(jupinSpider) => {
            await jupinSpider.init();
        });
        // 检查数据是否完成
        let spider_data = await db.collection('report.report_analysis_data').find({
            'start': shop_data[0].start_time,
            'end': shop_data[0].end_time,
            'nick_name': wangwang,
        }).toArray();
        if(spider_data.length === 0){
            success = 0;
            console.log('数据不全，爬取失败');
            console.log('status:error');
        } else {
            console.log('status:ok');
        }
        if(success){
           console.log('爬取完成');
           console.log('status:ok');
           await updateSpiderStatus('爬取完成')
        } else {
            console.log('爬取失败');
            console.log('status:error');
            await updateSpiderStatus('爬取失败')
        }
        process.exit();
    } catch (e) {
        console.log(e);
        await updateSpiderStatus('爬取失败');
        console.log('status:error');
        process.exit()
    }
})();
