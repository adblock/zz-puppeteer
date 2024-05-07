
/**
 * 钻展实时数据的爬虫逻辑类
 * */
class ZuanzhanRealTimeSpider {
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
      // 订阅 reponse 事件，参数是一个 reponse 实体
      await this._page.on('response', async (response) => {
        try {
          //如果有滑块，网页加载后判断punish的值，进入下一个店铺
          if (response.url().indexOf('punish?x5secdata') > -1) {
            punish = true;
          }
          // 超级钻展 nickname 得到text数据，校验店铺名
          if (response.url().indexOf('zuanshi.taobao.com/loginUser/info.json') > -1) {
            getInfo =  await response.text();
          }
          // 钻展实时数据接口
          if (response.url().indexOf('zuanshi.taobao.com/api/report/account/findHourSum.json') > -1) {
            console.log(response.url());
            save_data.hourSum = await response.json();
          }
          // 钻展折线图数据
          if (response.url().indexOf('zuanshi.taobao.com/api/report/account/findHourList.json') > -1) {
            console.log(response.url());
            save_data.hourList = await response.json();
          }
          // 账户余额
          if (response.url().indexOf('zuanshi.taobao.com/index/account.json') > -1 || response.url().indexOf('account/getRealBalance.json') > -1) {
            console.log(response.url());
            save_data.account = await response.json();
          }
          // 今日预算
          if (response.url().indexOf('zuanshi.taobao.com/mooncampaign/findCampaignDayBudgetSum.json') > -1) {
            console.log(response.url());
            save_data.budget = await response.json();
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
      // 登录钻展
      await this._page.goto('https://zuanshi.taobao.com/index_poquan.jsp', {waitUntil: 'networkidle2'});
      //getInfo.json页面，getinfo所存text中 匹配店铺名字,有误则shop_name = 0
      if(getInfo.indexOf(this._wangwang) === -1){
        shop_name = 0;
      }
      //判断不符合条件，未登录成功，或者有滑块punish的值为true. 或者店铺名不存在  开始下一家店铺
      if (this._page.url().indexOf('zuanshi.taobao.com/index.html?mxredirectUrl=') > -1 || punish === true || shop_name === 0) {
        await this._nextRound(this._wangwang);
      } else {
        // 存数据
        console.log(Object.keys(save_data).length, insert, shop_name)
        if (Object.keys(save_data).length === 4 && insert === 0 && shop_name === 1) {
          insert = 1;
          console.log('insert ----' + this._wangwang);
          await this.saveData(save_data);
        }
        // 重新启动
        await this._nextRound(this._wangwang);
      }
    } catch (e) {
      if (
              e.message.indexOf('Navigation failed because browser has disconnected!') === -1 &&
              e.message.indexOf('Session closed. Most likely the page has been closed') === -1
      ) {
        console.log(e);
        await this._nextRound(this._wangwang);
      }
    }
  };

  // 存储数据到mongo
  saveData = async (save_data) => {
    let data = {
      data: save_data,
      created_at: new Date(),
      updated_at: new Date(),
      crawl_date: this._crawlDate,
      nick_name: this._wangwang,
      hour: new Date().getHours()
    };
    await this._mongo.db.collection('zuanzhan.zz_realtime_shop_data').deleteMany({
      'crawl_date': this._crawlDate,
      'nick_name': this._wangwang
    });
    await this._mongo.db.collection('zuanzhan.zz_realtime_shop_data').insertOne(data);
    console.log("存入数据okokok");

  };



}


module.exports = { ZuanzhanRealTimeSpider };



