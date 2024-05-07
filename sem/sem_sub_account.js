const puppeteer = require('puppeteer');
const dateFormat = require('dateformat');
const {setJs, asyncForEach} = require('../commons/func');
const config = require('../config');
const {mongoInit, mongoQuery} = require('../commons/db');

/**
 * 营销生态平台 爬取客户列表
 * */
let checkarry = [];  //获取验证码列表
let crawl_date = ''; // 抓取数据的时间
let send_time = '';
let G_MONGO = '';
let mongo_zz = 0;
let mongo_tj = 0;
let mongo_ztc = 0;
const startLogin = async (account, password) => {
  let flag =0;
  const page = await setPage();
  try {
    let retry = 0;
    // 打开营销生态平台首页
    const homeUrl = 'https://sem.taobao.com/';
    await page.goto(homeUrl, {waitUntil: 'networkidle2'});
    //自动登录
    await login(page, account, password);
    await page.on('response', async (response) => {
      //需要手机验证码
      if (response.url().indexOf('newlogin/login.do') > -1) {
        let data = await response.json();
        if (data.content.data.iframeRedirectUrl) {
          if (data.content.data.iframeRedirectUrl.indexOf('member/login_unusual.htm') > -1) {
            await page.waitFor(5000);
            const frames = await page.frames();
            const checkFrames = frames.find(f => f.url().indexOf("iv/mini/identity_verify.htm") > -1);
            await checkCode(checkFrames);
            flag = 0;
          }
        }
      }
      //判断用户是否登陆成功
      if (response.url().indexOf("login/userInfo.json") > -1) {
        let data = await response.json();
        if (data['success'] === false) {
          flag = 1;
        }
      }
      if (response.url().indexOf('durex/checkcode') > -1) {
        let data = await response.json();
        const frames = await page.frames();
        const checkFrames = frames.find(f => f.url().indexOf("iv/mini/identity_verify.htm") > -1);
        if (checkarry.length > 0) {
          await writeCheck(checkFrames)
        } else {
          if (retry < 3) {     // 重试三次
            retry += 1;
            await checkCode(checkFrames)
          }
        }
      }
    });
  } catch (e) {
    console.log('error----');
  }
  await page.goto("https://sem.taobao.com/index/", {waitUntil: 'networkidle2'});
  if (flag === 1) {
    console.log('请重新登录');
    page.waitFor(2000);
    await login(page, account, password);
  }
  //首页获取cookie 和token;
  const cookie = await page.cookies();
  let token = await getToken(cookie);
  asyncForEach(cookie, async (cookie_item) => {
    await page.setCookie(cookie_item);
  })
  //钻展
  if (mongo_zz === 0) {
    let shoplist_zz = await getZuanZhanCustomer(page, token);
    let table_zz = 'zuanzhan.shop_list';
    await saveCustomer(shoplist_zz, table_zz);
  }
  //超级推荐
  if (mongo_tj === 0) {
    let shoplist_tj = await getTuiJianCustomer(page, token);
    let table_tj = 'chaojituijian.shop_list';
    await saveCustomer(shoplist_tj, table_tj);
  }
  //直通车
  if (mongo_ztc === 0) {
    let shoplist_ztc = await getZtcCustomer(page, token);
    let table_ztc = 'zhitongche.shop_list';
    await saveCustomer(shoplist_ztc, table_ztc);
  }
  await findMongo();
};

/**
 * 获取钻展店铺列表
 * @param page
 * @param token
 * @returns {Promise<Array>}
 */
const getZuanZhanCustomer = async (page, token) => {
  let customer_url = 'https://sem.taobao.com/customer/findCustomerList.json?' +
          '&token=' + token + '&query=%7B%22toPage%22%3A%221%22%2C%22perPageSize%22%3A%22100000%22%2C%22product%22%3A%223%22%2C%22source%22%3A1%7D';
  let resp = await sendReauest(page, customer_url);
  //取出服务中的店铺
  let shop_list = {};
  await asyncForEach(resp['data']['result'], async (shop) => {
    if (shop['status'] === 'SERVICED' && shop['memberId']) {
      shop_list[shop['wangwang']] = shop;
    }
  })
  return shop_list;
}

/**
 * 获取超级推荐列表
 * @param page
 * @param token
 * @returns {Promise<Array>}
 */
const getTuiJianCustomer = async (page, token) => {
  let customer_url = 'https://sem.taobao.com/customer/findCustomerList.json?&token=' + token +
          '&query=%7B%22toPage%22%3A%221%22%2C%22perPageSize%22%3A%22100000%22%2C%22product%22%3A%224%22%2C%22source%22%3A1%7D';
  let resp = await sendReauest(page, customer_url);
  //取出服务中的店铺
  let shop_list = {};
  await asyncForEach(resp['data']['result'], async (shop) => {
    if (shop['status'] === 'SERVICED' && shop['memberId']) {
      shop_list[shop['wangwang']] = shop;
    }
  })
  return shop_list;
}

/**
 * 获取直通车店铺列表
 * @param page
 * @param token
 * @returns {Promise<Array>}
 */
const getZtcCustomer = async (page, token) => {
  let shop_list = {};
  let customer_url = 'https://sem.taobao.com/customer/findCustomerList.json?r=mx_65&token=' + token +
          '&query=%7B%22toPage%22%3A%221%22%2C%22perPageSize%22%3A%2240%22%2C%22product%22%3A%221%22%2C%22source%22%3A1%7D';
  let res = await sendReauest(page, customer_url);
  let number = parseInt(res['data']['pageInfo']['itemTotal'] / 1000 + 1);

  //每页最多显示1000个数据
  for (let i = 1; i <= number; i++) {
    let customer_url = 'https://sem.taobao.com/customer/findCustomerList.json?r=mx_65&token=' + token +
            '&query=%7B%22toPage%22%3A%22' + i + '%22%2C%22perPageSize%22%3A%221000%22%2C%22product%22%3A%221%22%2C%22source%22%3A1%7D';
    console.log(customer_url);
    let resp = await sendReauest(page, customer_url);
    await asyncForEach(resp['data']['result'], async (shop) => {
      if (shop['status'] === 'SERVICED') {
        shop_list[shop['wangwang']] = shop;
      }
    })
  }
  return shop_list;
}

// 存入数据
const saveCustomer = async (shop_list, table_name) => {
  let time = dateFormat(new Date(), "yyyy-mm-dd HH:mm:ss");
  let data = {
    created_at_time: time,
    updated_at: time,
    data: shop_list,
    flag: 'operation_record',
    crawl_date: crawl_date,
  };
  let db = await mongoQuery();
  await db.collection(table_name).deleteMany({'crawl_date': crawl_date, 'flag': 'operation_record'});
  await db.collection(table_name).insertOne(data);
  console.log(table_name.match(/^[a-z]+./)[0]);
  console.log('存入数据库ok');
};
/**
 *  获取token
 *   @returns
 *   token :作为url地址的参数
 * */
const getToken = async (cookie) => {
  let token = '';
  for (let i = 0; i < cookie.length; i++) {
    if (cookie[i].name === 'XSRF-TOKEN') {
      token = cookie[i].value;
    }
  }
  return token;
}
/**
 *  实现自动登录
 * */
const login = async (page, account, password) => {
  const frames = await page.frames();
  const loginFrame = frames.find(f => f.url().indexOf("//login.taobao.com/member/login.jhtml") > -1);
  // 输入账号密码 点击登录按钮
  await page.waitFor(Math.floor(Math.random() * 100) * Math.floor(Math.random() * 10));
  const opts = {
    delay: 2 + Math.floor(Math.random() * 2), //每个字母之间输入的间隔
  };

  await loginFrame.type('#fm-login-id', account, opts);
  await page.waitFor(1500);

  await loginFrame.type('#fm-login-password', password, opts);
  await page.waitFor(1500);

  // 如果存在滑块
  let hua = await loginFrame.$eval('#nocaptcha-password', el => {
    return window.getComputedStyle(el).getPropertyValue('display') === 'block'
  });
  for (let i = 0; i < 3; i++) {
    if (hua) {
      let rad_num = 400;
      const slide = await loginFrame.$('#nc_1_n1z');
      await page.waitFor(1500);
      const loc = await slide.boundingBox();
      await page.mouse.move(loc.x, loc.y);
      await page.mouse.down();
      rad_num = Math.ceil(Math.random() * 10) * 10 + 400;
      await page.mouse.move(loc.x + rad_num, loc.y);
      rad_num = Math.ceil(Math.random() * 10) * 10 + 400;
      await page.waitFor(1000 + rad_num);
      await page.mouse.up();
      await page.waitFor(1500);

      const err = await loginFrame.$('.errloading');
      if (err) {
        await loginFrame.click('.errloading > span.nc-lang-cnt > a')
      }
      const huaText = await loginFrame.$('#nc_1__scale_text');
      if (huaText) {
        const text = await loginFrame.$eval('#nc_1__scale_text > span.nc-lang-cnt', el => el.innerHTML);
        console.log(text)
        if (text.indexOf('验证通过') > -1) {
          break
        }
      }
      hua = await loginFrame.$eval('#nocaptcha-password', el => {
        return window.getComputedStyle(el).getPropertyValue('display') === 'block'
      });
    } else {
      break
    }
  }
  if (hua) {
    const huaText = await loginFrame.$('#nc_1__scale_text');
    if (huaText) {
      const text = await loginFrame.$eval('#nc_1__scale_text > span.nc-lang-cnt', el => el.innerHTML);
      console.log(text)
      if (text.indexOf('验证通过') === -1) {
        console.log('验证失败');
      }
    }
  }
  let loginBtn = await loginFrame.$('[type="submit"]');
  await loginBtn.click({
    delay: 200
  });
}
// 获取验证码方法
const checkCode = async (checkFrames) => {
  console.log('获取验证码');
  const phone_end = '6912';
  const getCheck = await checkFrames.$('#J_GetCode');
  if (getCheck) {
    await getCheck.click();
  }
  if (send_time === '') {
    send_time = await dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
  }
  console.log(send_time)
  await checkFrames.waitFor(20000);     // 等待20s 验证码发送
  checkarry = await G_MONGO.db.collection('zz_sms').find({'phone_num': phone_end}).sort({"time": -1}).limit(3).toArray();
  send_time = await dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
  // 循环填入
  await writeCheck(checkFrames)
};

// 填写验证码
const writeCheck = async (checkFrames) => {
  try {
    console.log('用户验证码', checkarry);
    let check = checkarry.shift();
    if (checkarry.length > 0) {
      console.log(check['message']);
      const code = check['message'].match(/验证码(\S*)，/)[1]
      if (code) {
        const yanCode = code.slice(0, 6);
        console.log(yanCode);
        //清空输入框的值
        await checkFrames.$eval('#J_Checkcode', input => input.value = '');
        await checkFrames.type('#J_Checkcode', yanCode.toString(), {delay: 100});
        await checkFrames.waitFor(1500);
        await checkFrames.click('#btn-submit');
        await checkFrames.waitFor(5000);
      }
    } else {
      console.log(checkarry);
      console.log('获取验证码失败');
    }
  } catch (e) {
    console.log(e);
  }
};

/**
 * 发送请求的方法
 * @param {Object} page page类
 * @param {String} url  请求的url
 * */
const sendReauest = async (page, url) => {
  return await page.evaluate(async (url) => {
    let headers = {
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-dest': 'empty',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'user-agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.114 Safari/537.36',
      'referer': 'https://sem.taobao.com/customManage'
    };
    const response = await fetch(url, {headers: headers});
    return await response.json();
  }, url);
};

/**
 *  创建浏览器
 * */
const setBroswer = async () => {
  let browsers = await puppeteer.launch({
    headless: config.headless,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-sandbox',
      '--no-zygote',
      '--single-process',
      '--disable-setuid-sandbox',
    ],
    ignoreDefaultArgs: ["--enable-automation"]
  });
  return browsers;

}
const setPage = async () => {
  const browser = await setBroswer();
  let thispage = await browser.pages();
  let page = await setJs(thispage[0]);
  await page.bringToFront();
  await page.setViewport({
    width: 1024,
    height: 768
  });
  await page.setDefaultTimeout(60000);
  await page.setDefaultNavigationTimeout(60000);
  return page;
}
//判断数据库中是否存在
const findMongo = async ()=> {
  G_MONGO = await mongoInit();
  mongo_zz = await G_MONGO.db.collection('zuanzhan.shop_list').find({'crawl_date': crawl_date}).count();
  mongo_tj = await G_MONGO.db.collection('chaojituijian.shop_list').find({'crawl_date': crawl_date}).count();
  mongo_ztc = await G_MONGO.db.collection('zhitongche.shop_list').find({'crawl_date': crawl_date}).count();
  console.log('钻展 ' + mongo_zz + '; 超级推荐 ' + mongo_tj + '; 直通车 ' + mongo_ztc);
  let num = mongo_zz+mongo_tj+mongo_ztc;
  if (num ===3){
    process.exit();
  }
}

(async () => {
  const args = process.argv.splice(2);
  crawl_date = dateFormat(new Date(), "yyyy-mm-dd");
  await findMongo();
  const account = 'tp_聚品:技术大神9';
  const password = 'dashen97292648';
  await startLogin(account, password);
})();
