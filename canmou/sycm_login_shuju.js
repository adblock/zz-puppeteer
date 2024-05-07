const puppeteer = require('puppeteer');
const dateformat = require('dateformat');
const { mysqlQuery } = require('../commons/db');
const { getStrCookies } = require('../commons/cookies');
const { sendDingding, asyncForEach, setJs } = require('../commons/func');
const config = require('../config');

/**
 * 可以传mysql id(可以多进程) 传id只更新传入id的cookie，若不传则更新所有失效cookie
 * */


const startLogin = async (account, message, page, browser)=>{
    console.log(message);
    try {
        console.log(account.id, account.f_account, account.f_password, account.f_director);
        const frames = await page.frames();
        const loginFrame = frames.find(f => f.url().indexOf("//login.taobao.com/member/login.jhtml") > -1);

        let saveCookies = {
            loginCookie:await page.cookies('https://login.taobao.com'),
            passportCookie:await page.cookies('https://passport.taobao.com')
        }

        // await page.waitFor(1000000);
        // 输入账号密码 点击登录按钮
        await page.waitFor(Math.floor(Math.random() * 100) * Math.floor(Math.random() * 10));
        const opts = {
            delay: 2 + Math.floor(Math.random() * 2), //每个字母之间输入的间隔
        }
        const userName = await loginFrame.$('#TPL_username_1');
        await page.on('response', async (response) => {
            if (response.url().indexOf('getPersonalView.json') > -1) {
                const update_at = dateformat(new Date(), "yyyy-mm-dd HH:MM:ss");
                saveCookies.sycmCookie =  await page.cookies();
                const updateSql = 'update t_sycm_account_yunying set f_valid_status = 1 , f_raw_cookies = \''+ JSON.stringify(saveCookies) +'\' , f_use_status = 0, updated_at ="'+ update_at +'"  where id = '+ account.id;
                await mysqlQuery(updateSql)
            }
            if (response.url().indexOf('https://login.taobao.com/newlogin/login.do') > -1) {
                let data = await response.json();
                if(data.content.data.redirectUrl === undefined){
                    console.log(data);
                    message.push(account.id.toString() + ': 【' + account.f_account + '】 获取cookie失败'+ '\n')
                    await browser.close();
                }
                else{
                    console.log(data);
                }
            }
        })
        if (userName != null) {
            await loginFrame.tap('#TPL_username_1');
            await loginFrame.type('#TPL_username_1', account.f_account, opts);

            await page.waitFor(3000);

            await loginFrame.tap('#TPL_password_1');
            await loginFrame.type('#TPL_password_1', account.f_password, opts);
            let loginBtn = await loginFrame.$('#J_SubmitStatic');
            await loginBtn.click({
                delay: 200
            });
        } else {
            await loginFrame.type('#fm-login-id', account.f_account, opts);

            await page.waitFor(3000);

            await loginFrame.type('#fm-login-password', account.f_password, opts);

            // 滑块
            let hua = await loginFrame.$eval('#nocaptcha-password', el=>{
                return window.getComputedStyle(el).getPropertyValue('display') === 'block'
            });
            for(let i = 0; i<3; i++){
                if (hua){
                    const slide= await loginFrame.$('#nc_1_n1z');
                    const loc = await slide.boundingBox();
                    await page.mouse.move(loc.x, loc.y);
                    await page.mouse.down();
                    await page.mouse.move(loc.x+400, loc.y);
                    await page.mouse.up();

                    const err = await loginFrame.$('.errloading');
                    if(err){
                        await loginFrame.click('.errloading > span.nc-lang-cnt > a')
                    }
                    const huaText = await loginFrame.$('#nc_1__scale_text');
                    if(huaText){
                        const text = await loginFrame.$eval('#nc_1__scale_text > span.nc-lang-cnt', el=>el.innerHTML);
                        if(text.indexOf('验证通过') > -1){
                            break
                        }
                    }
                    hua = await loginFrame.$eval('#nocaptcha-password', el=>{
                        return window.getComputedStyle(el).getPropertyValue('display') === 'block'
                    });
                } else {
                    break
                }
            }

            let loginBtn = await loginFrame.$('[type="submit"]');
            await loginBtn.click({
                delay: 200
            });
        }

        await page.waitForNavigation({waitUntil: 'networkidle2'});
        await browser.close();
    } catch (e) {
        // console.log(e);
        // await browser.close();
        // const e_arr = e.toString().split('\n');
        // message.push(account.id.toString() + ': 【' + account.f_account + '】 获取cookie失败，错误信息：' + e_arr[0] + '\n')
    }

}


// 遍历数据库店铺登录，返回失效的店铺
async function getSycmAccount(fId) {
    if(fId){
        let sql = 'select * from t_sycm_account_yunying where id=' + fId;
        const account = await mysqlQuery(sql);
        await checkCookie(account);
    }else{
        let sql = 'select * from t_sycm_account_yunying  where f_is_used = 1';
        const accountList = await mysqlQuery(sql);
        await checkCookie(accountList);
    }
}


// 检查cookie 是否有效
async function checkCookie(accountList) {
    try {
        const message = [];
        for (const account of accountList) {
            const browser = await puppeteer.launch({
                headless: config.headless,
                userDataDir: './user/user'+account.id,
                args: [
                    '--no-sandbox',
                ],
                ignoreDefaultArgs: ["--enable-automation"]
            });
            const page = await setJs(await browser.newPage());

            page.setViewport({
                width: 1376,
                height: 1376
            });
            page.setDefaultTimeout(300000);
            page.setDefaultNavigationTimeout(300000);
            console.log(account.id, account.f_account, account.f_password, account.f_director);
            // const f_raw_cookies = JSON.parse(account.f_raw_cookies);
            // if(f_raw_cookies !== null || f_raw_cookies!==[]){
            //     if (f_raw_cookies.hasOwnProperty('loginCookie')) {
            //         await asyncForEach(f_raw_cookies.loginCookie, async (value, index) => {
            //             await page.setCookie(value);
            //         });
            //     }
            //     if (f_raw_cookies.hasOwnProperty('passportCookie')) {
            //         await asyncForEach(f_raw_cookies.passportCookie, async (value, index) => {
            //             await page.setCookie(value);
            //         });
            //     }
            //     if(f_raw_cookies.hasOwnProperty('sycmCookie')) {
            //         await asyncForEach(f_raw_cookies.sycmCookie, async (value, index) => {
            //             await page.setCookie(value);
            //         });
            //     }
            // }
            // 打开生意参谋首页
            const homeUrl = 'https://sycm.taobao.com/portal/home.htm';
            await page.goto(homeUrl, {
                waitUntil: 'networkidle2',
            });

            if (page.url() === homeUrl) {  // cookie有效，将有效状态保证为 1
                const cookie = await page.cookies();
                let saveCookies = {
                    loginCookie:await page.cookies('https://login.taobao.com'),
                    passportCookie:await page.cookies('https://passport.taobao.com'),
                    sycmCookie:await page.cookies()
                }
                const update_at = dateformat(new Date(), "yyyy-mm-dd HH:MM:ss");
                const updateSql = 'update t_sycm_account_yunying set  f_valid_status = 1 , f_raw_cookies = \''+ JSON.stringify(saveCookies) +'\' , f_use_status = 0, updated_at ="'+ update_at +'"  where id = '+ account.id;
                await mysqlQuery(updateSql);
            } else{
                // 将cookie有效状态改为0
                const updateSql = 'update t_sycm_account_yunying set f_valid_status = 0, f_use_status = 0 where id = '+ account.id;
                await mysqlQuery(updateSql);
                await startLogin(account, message, page, browser);
            }
            await browser.close();
        }
        // 发送 本次更新信息
        let content = '生意参谋cookie库更新： 本次共更新 ' + accountList.length + ' 条数据，成功 ' + (accountList.length - message.length) + ' 条， 失败 ' + message.length + ' 条 \n';
        if(message.length > 0){
            content += '失败信息：\n' + message.toString().replace(/,/g, '')
        }
        console.log(content);
        await sendDingding(content);
    } catch (e) {
        console.log(e);
        browser.close();
    }
}


(async () => {
    // 第一个参数是账号id
    const args = process.argv.splice(2);
    await getSycmAccount(args[0]).catch(async (err) => {
        console.error(err);
        process.exit();
        const { sendDingding, asyncForEach, setJs } = require('../commons/func');
    });
})();
