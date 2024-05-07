
/**
 * 超级推荐实时数据的爬虫逻辑类
 * */
class TuijianRealTimeSpider {
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
      // 订阅 reponse 事件，参数是一个 reponse 实体
      await this._page.on('response', async (response) => {
        try {
          if (response.url().indexOf('https://tuijian.taobao.com/indexbp-feedflow.html') !== -1) {
            let text = await response.text();
            if (text.indexOf('_____tmd_____/punish') !== -1) {
              punish = true;                //在打开页面后判断true，执行进入下一个店铺命令，防止浏览器关闭报错
            }
          }
          // 超级推荐 nickname 得到text数据，校验店铺名
          if (response.url().indexOf('tuijian.taobao.com/api/member/getInfo.json') > -1) {
              getInfo = await response.text();
          }
          // 获取接口数据
          if (response.url().indexOf('report/findHourSum') !== -1 && response.url().split("bizCode=")[1] === 'feedFlow') {
            console.log(response.url());
            save_data.hourSum = await response.json();
          }
          if (response.url().indexOf('report/findHourList') !== -1) {
            console.log(response.url());
            save_data.hourList = await response.json();
          }
          if (response.url().indexOf('account/getInfo') !== -1 || response.url().indexOf('account/getRealBalance') !== -1) {
            console.log(response.url());
            save_data.availableBalance = await response.json();
          }
          if (response.url().indexOf('campaign/findDayBudgetSum') !== -1) {
            console.log(response.url());
            save_data.todayAvailable = await response.json();
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
      await this._page.goto('https://tuijian.taobao.com/indexbp-feedflow.html', {waitUntil: "networkidle0"});
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
        console.log(Object.keys(save_data).length, insert, shop_name)
        //存入sava_data的5个属性长度+getinfo
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
    await this._mongo.db.collection('chaojituijian.cjtj_realtime_shop_data').deleteMany({
      'crawl_date': this._crawlDate,
      'nick_name': this._wangwang
    });
    await this._mongo.db.collection('chaojituijian.cjtj_realtime_shop_data').insertOne(data);
  };


}
module.exports = { TuijianRealTimeSpider };
