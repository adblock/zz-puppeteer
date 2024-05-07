/**
 * 引力魔方实时数据的爬虫逻辑类
 * */
const {asyncForEach} = require('../../commons/func');
const dateFormat = require('dateformat');
class YinlimofangRealTimeSpider {
  constructor(option) {
    this._crawlDate = option.crawlDate; // 爬虫日期
  }
  /**
   * 初始化函数
   * @param option
   * */
  init = async (option) =>{
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
      let getInfo = ''; // 获取接口的用户名
      let punish = false; // 检测是否有滑块
      let shop_name = 1;
      let save_data = {};
      let insert = 0;
      let timeStr = '';
      // 订阅 reponse 事件，参数是一个 reponse 实体
      await this._page.on('response', async (response) => {
        try {
          if (response.url().indexOf('https://tuijian.taobao.com/indexbp-display.html') !== -1) {
            let text = await response.text();
            if (text.indexOf('_____tmd_____/punish') !== -1) {
              punish = true;                //在打开页面后判断true，执行进入下一个店铺命令，防止浏览器关闭报错
            }
          }
          // 引力魔方 nickname 得到text数据，校验店铺名
          if (response.url().indexOf('tuijian.taobao.com/api2/member/getInfo.json') > -1) {
              getInfo = await response.text();
          }
          // 获取接口数据
          if (response.url().indexOf('report/promote/findSumList.json') !== -1) {
            console.log(response.url());
            if(response.request().postData().indexOf(this._crawlDate) >-1){   // 整理成和超级推荐格式一样的数据。今天的数据在前
              let resp = await response.json();
              if(save_data.hasOwnProperty('hourList')){
                resp['data']['list'] = resp['data']['list'].concat(save_data.hourList['data']['list']);
              }
              save_data.hourList = resp;
            } else {
              let resp = await response.json();
              if(save_data.hasOwnProperty('hourList')){
                resp['data']['list'] = save_data.hourList['data']['list'].concat(resp['data']['list']);
              }
              save_data.hourList = resp;
            }
          }
          if (response.url().indexOf('account/getRealBalance.json') !== -1) {
            console.log(response.url());
            save_data.availableBalance = await response.json();
          }

          //计划的预算， 获取参数
          if (response.url().indexOf('tuijian.taobao.com/api2/component/findList/bp-permissions.json?') > -1) {
            timeStr = response.url().match(/&timeStr=\S+/) + '';
            console.log(timeStr);
          }

        } catch (e) {
          if (
                  e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
                  e.message.indexOf('Session closed. Most likely the page has been closed') === -1
          ) {
            console.log(111111111);
            console.log(e.message);
            await this._nextRound(this._wangwang);
          }
        }
      });
      // 进入后台
      await this._page.waitFor(1000 + Math.round(Math.random()) * 100);
      await this._page.goto('https://tuijian.taobao.com/indexbp-display.html', {waitUntil: "networkidle0"});
      //getInfo.json页面，getinfo所存text中 匹配店铺名字,有误则shop_name = 0
      if(getInfo.indexOf(this._wangwang) === -1){
        shop_name = 0;
      }
      //判断不符合条件，index.html未登录成功，或者punish存在滑块 ，或者punish的值为true.开始下一家店铺
      if (
          this._page.url().indexOf('https://tuijian.taobao.com/index.html') > -1 ||
          this._page.url().indexOf('punish?x5secdata') > -1 ||
          punish === true ||
          shop_name === 0
      ) {
        await this._nextRound(this._wangwang);
      } else {
        //计划的预算
        save_data['todayAvailable'] = await this.getTodayBudget(timeStr);
        //计划，数据汇总
        save_data['hourSum'] = await this.getPlanSumData(timeStr);

        console.log(Object.keys(save_data).length, insert, shop_name)
        //存入sava_data
        if (Object.keys(save_data).length === 4 && insert === 0 && shop_name === 1) {
          console.log('insert ----' + this._wangwang);
          insert = 1;
          await this.saveData(save_data);
        }
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

  //获取正在投放中计划的 今日预算  引力魔方-> 计划  -> 计划
  getTodayBudget = async (timeStr) => {
    let budget = 0;
    let url = 'https://tuijian.taobao.com/api2/campaign/horizontal/findPage.json?&bizCode=displayDefault&statusList=%5B%22start%22%2C%22pause%22%2C%22wait%22%5D&&offset=0&pageSize=500' +
        '&rptQuery=%7B%22startTime%22%3A%22' + this._crawlDate + '%22%2C%22endTime%22%3A%22' + this._crawlDate + '%22%7D' + timeStr;
    let resp = await this.sendReauest(url);
    let data = resp['data']['list'];
    if (data) {
      await asyncForEach(data, async (item) => {
        if(item['status'].includes('start')){          //正在投放中的计划
          budget = budget + item['dayBudget'];
        }
      })
    }
    return {'data': {'feedFlowItem': budget}};   //数据格式与超级推荐的一致
  }

  //获取计划的汇总数据  引力魔方-> 计划 -> 数据汇总
  getPlanSumData = async (timeStr) => {
    let csrfID = timeStr.match(/(?<=&csrfID=)\S+/) + '';
    let timestr = timeStr.match(/(?<=&timeStr=).*?(?=&)/) + '';
    let dynamicToken = timeStr.match(/(?<=&dynamicToken=).*?(?=&)/) + '';
    let yesterday = dateFormat(new Date().getTime() - 24 * 60 * 60 * 1000, 'yyyy-mm-dd');
    let url = 'https://tuijian.taobao.com/api2/report/promote/findSum.json?';

    //遍历今日，昨天的日期，获取数据
    let day_list = [this._crawlDate, yesterday];
    let list = [];
    await asyncForEach(day_list, async (date) => {
      let from_data = {
        "bizCode": "displayDefault",
        "startTime": date,
        "endTime": date,
        "today": this._crawlDate,
        "perspective": "manage",
        "queryTimeDim": "hour",
        "queryDomain": "account",
        "tab": "campaign",
        "timeStr": timestr,
        "dynamicToken": dynamicToken,
        "csrfID": csrfID
      }

      let respon = await this.sendReauest_Post(from_data, url);
      let data = respon['data']['list'];
      if(data.length){
        list.push(data[0]);
      }
    })
    console.log('获取的计划汇总数据', list.length);
    return {'data': {'list': list}};       //数据格式与超级推荐的一致
  }

  // 存储数据到mongo
  saveData  = async (save_data) => {
    let data = {
      data:save_data,
      created_at:new Date(),
      updated_at:new Date(),
      crawl_date:this._crawlDate,
      nick_name: this._wangwang
    };
    // 存入数据
    console.log("存入数据okokok");
    await this._mongo.db.collection('yinlimofang.ylmf_realtime_shop_data').deleteMany({
      'crawl_date': this._crawlDate,
      'nick_name': this._wangwang
    });
    await this._mongo.db.collection('yinlimofang.ylmf_realtime_shop_data').insertOne(data);
  };

  /**
   * 发送请求的方法
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

}
module.exports = { YinlimofangRealTimeSpider };
