/**
 * 爬取订单的sku
 * taobao-> 千牛平台 -> 已卖出的宝贝
 * */

const puppeteer = require('puppeteer');
const dateFormat = require('dateformat');
const {setJs, asyncForEach} = require('../commons/func');
const config = require('../config');
const {mongoInit, mongoQuery} = require('../commons/db');
const node_xlsx = require('node-xlsx');
const Excel = require("exceljs");

let checkarry = [];  //获取验证码列表
let send_time = '';
let G_MONGO = '';

/**
 *   保存excel的数据
 * @returns {Promise<void>}
 */
const saveExcel = async (obj) => {
    let excelObj = obj[0].data;//取得excel表的数据,0or1，经常变
    console.log(excelObj.length);

    let order_list = [];
    //循环遍历表每一行的数据
    //设置每一条数据的属性名称
    let excel_title = ['sold','mai','mai1','pay','yan','name','address','phone','time1'];
    for (let i = 1; i < excelObj.length; i++) {
        let rdata = excelObj[i];
        let insertData = {};
        //属性，与单个值对应
        for (let j = 0; j < rdata.length; j++) {
            insertData[excel_title[j]] = rdata[j];
        }
        order_list.push(insertData);
    }
    return order_list;
}

//登录平台，获取sku数据
const startLogin = async (account, password, order_list, order_xlsx) => {
    const page = await setPage();
    try {
        let homeUrl = 'https://login.taobao.com/member/login.jhtml?';
        await page.goto(homeUrl, {waitUntil: 'networkidle2'});
        //自动登录
        await login(page, account, password);
        await page.waitFor(2000);

        //判断出现手机验证码
        let check_url = await page.url();
        if (check_url.toString().includes('member/login_unusual.htm?')) {
            await page.waitFor(5000);
            let frames = await page.frames();
            const checkFrames = frames.find(f => f.url().indexOf("identity_verify.htm?") > -1);
            await checkCode(checkFrames);
            await sleep(3 * 1000);

        } else {
            console.log('please enter');
        }
        await sleep(10 * 1000);
        // 又，出现手机验证
        await page.on('response', async (response) => {
            if (response.url().indexOf('aq.taobao.com/durex/middle?') > -1) {
                await page.waitFor(5000);
                let frames = await page.frames();
                let checkFrames = frames.find(f => f.url().indexOf("durex/validate?") > -1);
                await checkCode(checkFrames);
                await sleep(3 * 1000);
            }
        });

        let url = 'https://trade.taobao.com/trade/itemlist/list_sold_items.htm?mytmenu=ymbb&spm=a217wi.openworkbeachtb_web';
        await page.goto(url, {waitUntil: 'networkidle0'});
        //首页获取cookie 和token;
        const cookie = await page.cookies();
        await asyncForEach(cookie, async (cookie_item) => {
            await page.setCookie(cookie_item);
        })

        //获取sku,
        let detail_list = await getProductsSku(page, order_list);
        console.log('sku添加okok');
        await compet_excel(detail_list, order_xlsx);
        console.log('生成订单excelokok');


    } catch (e) {
        console.log('error----');
        console.log(e.message);
    }
};

/**
 * 从网页获取sku的数据           取出每个订单编号，进行搜索 tips:接口存在编码转换
 * @param page
 * @returns {Promise<void>}
 */
const getProductsSku = async (page, order_list) => {
    let detail_list =  [];
    try {
        await asyncForEach(order_list, async (item, index) => {
            let detail = item;
            if (index % 50 === 0) {
                await sleep(5 * 1000);  //休息5s
            }
            let orderid = detail['sold'];      //订单编号
            //出现滑块，退出，重新打开页面
            await page.on('response', async (response) => {
                if (response.url().indexOf('asyncSold.htm/_____tmd_____/punish?') > -1) {
                    console.log('-----------出现滑块--------');
                    await page.waitFor(30 * 60 * 1000);

                }
            });
            await page.waitFor('#bizOrderId');
            //清空订单编号框的内容
            await page.$eval('#bizOrderId', input => input.value = '');
            await page.type('#bizOrderId', orderid, {delay: 20});
            await page.waitFor(1000);
            await page.click('.button-mod__primary___TqWy8');
            await page.waitFor(5000);
            //  取出sku元素的值
            let exist = await page.$('.production-mod__sku-item___3tZQ_');
            if (exist) {
                let sku = await page.$$eval('.production-mod__sku-item___3tZQ_', eles => eles.map(ele => ele.innerText));
                let number = await page.$$eval('.sol-mod__no-br___1FsWT:nth-child(3) > div> p', eles => eles.map(ele => ele.innerText));
                console.log(number);
                console.log(sku);
                await asyncForEach(sku, async (item_sku, index_sku) => {
                    if (index_sku > 0) {    //多个sku
                        let order_other ={"sold":orderid};
                        order_other['sku'] = item_sku;
                        order_other['number'] = number[index_sku];
                        detail_list.push(order_other);
                    }else{           //一个sku
                        detail['sku'] = item_sku;
                        detail['number'] = number[index_sku];
                        detail_list.push(detail);
                    }
                })
            } else {
                console.log('222222222222222', orderid);
            }
        })
        return detail_list;

    } catch (e) {
        console.log(e.message);
    }
}

/**
 * 生成excel表格
 * @returns {Promise<void>}
 */
const compet_excel = async(detail_list, order_xlsx)=>{
    const workbook = new Excel.Workbook();
    const worksheet = workbook.addWorksheet("add");
    // 设置列及长度
    worksheet.columns = [
        {
            header: '订单编号', key: 'sold', width: 25
        },
        {
            header: '买家会员名', key: 'mai', width: 25
        },
        {
            header: '买家会员昵称', key: 'mai1', width: 25
        },
        {
            header: '买家实际支付金额', key: 'pay', width: 25
        },
        {
            header: '买家留言', key: 'yan', width: 25
        },
        {
            header: '收货人姓名', key: 'name', width: 12
        },
        {
            header: '收货地址', key: 'address', width: 50
        },
        {
            header: '联系手机', key: 'phone', width: 25
        },
        {
            header: '订单创建时间', key: 'time1', width: 25
        },
        {
            header: '味道', key: 'sku', width: 30
        },
        {
            header: '数量', key: 'number', width: 10
        }

    ];
    await asyncForEach(detail_list, async(data)=>{
        worksheet.addRow({
            sold: data['sold']||'',
            mai: data['mai']||'',
            mai1: data['mai1']||'',
            pay: data['pay']||'',
            yan:data['yan']||'',
            name: data['name']||'',
            address: data['address']||'',
            phone: data['phone']||'',
            time1: data['time1']||'',
            sku: data['sku']||'',
            number: data['number']||'',
        });

    })
    //创建excel表
    workbook.xlsx.writeFile(order_xlsx).then(function () {
        console.log('saved');
    })
};

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
    const getCheck = await checkFrames.$('[id="J_GetCode"]');
    if (getCheck) {
        await getCheck.click();
    }
    if (send_time === '') {
        send_time = await dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
    }
    console.log(send_time)
    await checkFrames.waitFor(20000);     // 等待20s 验证码发送
    G_MONGO = await mongoInit();
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
                // await checkFrames.$eval('.checkcode-warp>#J_Phone_Checkcode', input => input.value = '');
                // await checkFrames.type('.checkcode-warp>#J_Phone_Checkcode', yanCode.toString(), {delay: 100});
                // await checkFrames.waitFor(1500);
                // await checkFrames.click('#submitBtn');
                // await checkFrames.waitFor(5000);
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
// sleep
const sleep = async(time=0) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, time);
    })
};
(async () => {
    const args = process.argv.splice(2);
    let order_xlsx = args[0];
    if(args.length){
        const account = '美好生活品质严选:小美';
        const password = '2012j0518p';
        //(STEP 1)获取excel订单编号
        let obj = node_xlsx.parse(order_xlsx);
        let order_list = await saveExcel(obj);

        //(STEP 2)从网页上爬取 sku 和订单编号 ，并更新sku字段
        await startLogin(account, password, order_list,order_xlsx);
    }else{
        console.log('请输入.excel的文件名');
        process.exit();
    }

})();
