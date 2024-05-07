/**
 *  淘宝商品 类目
 * */
const puppeteer = require('puppeteer');
const { mongoQuery } = require('../commons/db');
const moment = require('moment');
const config = require('../config');
const {asyncForEach,setJs} = require('../commons/func');

let G_ITEMARR = [];
let G_CATCH_URL = '';
// 爬取
const startCrawl = async(page) => {
    let today = moment(new Date()).format("YYYY-MM-DD");
    let db = await mongoQuery();
    try{
        // response 监听
        await page.on('response', async (response) => {
            try{
                if(response.url().indexOf('apitools/ajax_props.do') > -1){
                    G_CATCH_URL = response.url();
                    // console.log(response.url());
                    let data = await response.json();
                    console.log(data);
                    if(data.hasOwnProperty('error_response')){
                        console.log('error_response  wait 8s');
                        await page.waitFor(8000);
                        await page.evaluate((url) => {
                          fetch(new Request(url, {
                            headers: {
                                'referer': 'https://open.taobao.com/apitools/apiPropTools.htm',
                                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36'

                            }
                          }));
                        }, response.url());
                    }else {
                        if(data['itemcats_get_response'].hasOwnProperty('item_cats')){
                        let itemArr = data['itemcats_get_response']['item_cats']['item_cat'];
                        for(let item of itemArr){   // 存储这一层的数据
                            item.created_at = new Date();
                            item.updated_at = new Date();
                            item.date = today;
                            await saveData(db, item);
                            // await page.waitFor(1000);
                            if(item.is_parent === true){    // 有下一层的接着爬取
                                G_ITEMARR.push(item.cid)
                            }
                        }
                    }
                        let cid = G_ITEMARR.shift();
                        if(cid !== undefined){
                            await page.waitFor(1000);
                            let fetch_url = response.url().replace(/cid=(\d*)/, 'cid='+cid);
                            await page.evaluate((url) => {
                              fetch(new Request(url, {
                                headers: {
                                    'referer': 'https://open.taobao.com/apitools/apiPropTools.htm',
                                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36'

                                }
                              }));
                            }, fetch_url);
                        } else{
                            console.log(G_ITEMARR.length, 'GITEMARR  length')
                            process.exit()
                        }
                    }
                }
            }catch (e) {
                console.log(e)
                await page.evaluate((url) => {
                  fetch(new Request(url, {
                    headers: {
                        'referer': 'https://open.taobao.com/apitools/apiPropTools.htm',
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36'

                    }
                  }));
                }, G_CATCH_URL);
            }
        });


        let api_tb = 'https://open.taobao.com/apitools/apiPropTools.htm?spm=0.0.0.0.mlPbbQ';
        await page.goto(api_tb, {waitUntil: 'networkidle2'});

        let rest = await page.$$('input[name="restId"]');
        if(rest !== null){
            // console.log(rest);
            await rest[1].click();
            await page.waitFor('#cid_0');
            let firstSelect = await page.$$eval('#cid_0 option', el=>el.map(el=>el.outerHTML));
            firstSelect.shift();
            console.log(firstSelect.length);
            for(let select of firstSelect){     // 遍历顶层，存储
                let value = select.match(/value="(\d*)">(\S*)<\/option>/);
                let save_data = {
                    is_parent: true,
                    parent_cid: null,
                    status: "normal",
                    created_at:new Date(),
                    updated_at:new Date(),
                    date:today,
                    cid: parseInt(value[1]),
                    name: value[2]
                };
                await saveData(db, save_data);
                G_ITEMARR.push(value[1])
            }
            await page.select('#cid_0',G_ITEMARR.shift())
        }
    } catch (e) {
        console.log(e)
    }

};

// // 递归遍历所有的层级
// const getAllOption = async(page, cid) => {
//     // 第二层
//     await page.select('#cid_0',cid);//选择下拉框内容
//     await page.waitForResponse(response => !response.json()['itemcats_get_response'].hasOwnProperty('item_cats'))
//
// };

// 存储
const saveData = async(db, data) => {
    // let db = await mongoQuery();
    // 存入数据
    await db.collection('goods_category_data').deleteMany({'cid': data.cid});
    await db.collection('goods_category_data').insertOne(data);
};

// 设置page
const setPage = async(browser, cookies) => {
    let page = await setJs(await browser.newPage());

    page.setDefaultTimeout(50000);
    page.setDefaultNavigationTimeout(50000);
    page.setViewport({
        width: 1376,
        height: 1376
    });

    if(cookies && cookies.f_raw_cookies){
        // 赋予浏览器圣洁的cookie
        await asyncForEach(cookies.f_raw_cookies.sycmCookie, async (value, index) => {
            await page.setCookie(value);
        });
    }
    return page;
};

(async() => {
    let today = moment(new Date()).format("YYYY-MM-DD");
    // 用子账号登录
    let db = await mongoQuery();
    let cookies = await db.collection('sub_account_login').find({'f_date':today, 'f_valid_status': 1}).
    project({_id:0, f_raw_cookies:1}).limit(1).toArray();

    const browser = await puppeteer.launch({
        headless: config.headless,
        args: [
        ],
        // slowMo:1000,
        ignoreDefaultArgs: ["--enable-automation"]
    });

    let page = await setPage(browser, cookies[0]);

    await startCrawl(page);
})();