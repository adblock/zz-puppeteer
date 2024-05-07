/**
 *  接受爬虫请求，根据 product_type 调取爬虫
 * */
const { spawn } = require('child_process');
const ObjectId = require('mongodb').ObjectId;
const { mongoQuery } = require('../commons/db');
const config = require('../config');

// sleep
const sleep = async(time=0) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
            }, time);
        })
    };

// 根据mongo_id 调度 爬虫
const scheduleSpider = async(mongo_id) => {
    console.log(mongo_id);
    let status = '';
    try{
        let db = await mongoQuery();
        const shop_data = await db.collection('report_spider_status_list').find({_id:ObjectId(mongo_id)}).toArray();
        if(shop_data.length > 0){
            let workerProcess = '';
            // product_type:zuanzhan zhitongche chaojituijian yinlimofang
            if(shop_data[0].product_type === 'zuanzhan'){
                workerProcess = spawn('node', [config.report_exec_path + 'zz_report.js', mongo_id]);
            } else if(shop_data[0].product_type === 'zhitongche'){
                workerProcess = spawn('node', [config.report_exec_path + 'ztc_report.js', mongo_id]);
            } else if(shop_data[0].product_type === 'chaojituijian'){
                workerProcess = spawn('node', [config.report_exec_path + 'cjtj_report.js', mongo_id]);
            } else if(shop_data[0].product_type === 'analysis_report'){
                workerProcess = spawn('node', [config.report_exec_path + 'analysis_report.js', mongo_id]);
            } else if(shop_data[0].product_type === 'mofang'){
                workerProcess = spawn('node', [config.report_exec_path + 'ylmf_report.js', mongo_id]);
            }
            workerProcess.stdout.on('data', function (data) {
                let out = 'stdout: ' + data;
                console.log(out);
                if(out.indexOf('status')>-1){
                    status = out.split(':').slice(-1)[0]
                }
            });
            workerProcess.stderr.on('data', function (data) {
                let error = 'stderr: ' + data;
                console.log(error);
                if(error.indexOf('status')>-1){
                    status = error.split(':').slice(-1)[0]
                }
            });
            workerProcess.on('close', function (code) {
              console.log('当前报表爬取完毕');
              // process.exit()
            });

            await sleep(5000);
            let wait = 0;
            while (true){
              if(status === ''){          // 等待status 返回
                    await sleep(5000);
                    wait += 1;
               } else {
                  break
              }
              if(wait === 6){
                  break
              }
            }
            return status

        } else {
            console.log('传入 无效的mongoID');
            return 'error'
        }
    } catch (e) {
        console.log(e);
        return 'error'
    }


};

module.exports = { scheduleSpider };
