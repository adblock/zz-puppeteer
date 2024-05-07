/**
 *  接受爬虫请求，根据 product_type 调取爬虫
 * */
const spawn  = require('child_process');
const ObjectId = require('mongodb').ObjectId;
const { mongoQuery } = require('../commons/db');
const {asyncForEach} = require('../commons/func');
const config = require('../config');
let G_WANGWANG = '';      //店铺名

// 根据mongo_id 调度 爬虫
const scheduleSpider = async (mongo_id) => {
  console.log(mongo_id);
  let workerStatus = [
    'yunying_compet_flow',
    'yunying_compet_detail',
    'yunying_market_data',
    'yunying_service_score'
  ];
  let status = '';
  try {
    let db = await mongoQuery();
    const shop_data = await db.collection('report_spider_status_list').find({_id: ObjectId(mongo_id)}).toArray();
    G_WANGWANG = shop_data[0].shop_name;
    //判断wangwang 的cookies
    const cookies = await getCookies(G_WANGWANG);
    console.log(G_WANGWANG);
    console.log(cookies.length);
    if (cookies.length === 0) {
      console.log('无可用cookie');
      await updateSpiderStatus(mongo_id, '爬取失败');
      process.exit()
    } else {
      //开始调用爬虫的子程序
      if (shop_data.length > 0) {
        await updateSpiderStatus(mongo_id, '等待中');
        let file_js = [
          'report\\yunying_compet_flow.js',
          'report\\yunying_market_data.js',
          'report\\yunying_service_score.js',
          'report\\yunying_compet_detail.js'
        ];
        await asyncForEach(file_js, async (item) => {
          console.log('node ' + config.report_exec_path + item + ' ' + mongo_id);
          let workerProcess = spawn.exec('node ' + config.report_exec_path + item + ' ' + mongo_id);
          let process_str = workerProcess.spawnargs.toString();
          workerProcess.stdout.on('data', function (data) {
            let out = 'stdout: ' + data;
            console.log(out);
            if (out.indexOf('status') > -1) {
              status = out.split(':').slice(-1)[0]
            }
          });
          workerProcess.stderr.on('data', function (data) {
            let error = 'stderr: ' + data;
            console.log(error);
            if (error.indexOf('status') > -1) {
              status = error.split(':').slice(-1)[0]
            }
            if (error.indexOf('退出进程') > -1) {
              console.log('error');
            }
          });
          workerProcess.on('exit', function (code) {
            console.log('子进程结束');
            subProcessEnd(workerStatus, process_str, mongo_id);
          });
        })
      } else {
        console.log('传入 无效的mongoID');
        return 'error'
      }
    }
  } catch (e) {
    console.log('aaaaaaaaaaaaaaaaaaaaaa');
    console.log(e);

  }
};
// 判断数据是否爬取成功  一条记录的属性个数
const subProcessCount = async (mongo_id) => {
  let db = await mongoQuery();
  let obj = await db.collection('report.yunying_report_data').find({mongo_id: mongo_id}).toArray();
  let count = Object.keys(obj[0]).length;
  console.log(count);
  if (count === 14) {
    await updateSpiderStatus(mongo_id, '爬取成功');
  } else {
    await updateSpiderStatus(mongo_id, '爬取失败');
  }
};
// 修改爬虫运行状态（MongoDB）
const updateSpiderStatus = async(mongo_id, status_mongo) => {
  let db = await mongoQuery();
  await db.collection('report_spider_status_list').updateOne({_id:ObjectId(mongo_id)}, {$set:{'spider_type': status_mongo}})
  console.log('修改爬取状态———',status_mongo);
};
/**
 * 判断子进程是否全部结束
 * @param workerStatus   未爬取的进程
 * @param process_str    单个子进程
 */
const subProcessEnd = async (workerStatus, process_str, mongo_id) => {
  await asyncForEach(workerStatus, async (item) => {
    if (process_str.indexOf(item) !== -1) {
      workerStatus.splice(workerStatus.indexOf(item), 1);    //从数组中删除已exit的子进程
      console.log('目前程序', workerStatus);
      if (workerStatus.length === 0) {
        await subProcessCount(mongo_id);
        process.exit();
      }
    }
  })
}
/**
 * 获取指定旺旺cookie
 * @param wangwang
 * @returns cookies
 */
const getCookies = async(wangwang) => {
  let db = await mongoQuery();
  // 获取店铺 cookie
  return await db.collection('sub_account_login').find({'wangwang_id': wangwang}).
  project({_id:0, f_raw_cookies:1, wangwang_id:1}).sort({'f_date':-1}).limit(1).toArray();
};

module.exports = { scheduleSpider };
