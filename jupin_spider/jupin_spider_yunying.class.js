const {JupinSpider} = require('./jupin_spider.class');
const {getYunyingAccount} = require('../commons/account');
const {asyncForEach, setJs} = require('../commons/func');


 class JupinSpiderYunying extends JupinSpider{

     /**
     * 获取运营账号的cookies
     * */
     setPageCookie = async (browser, wangwang)=>{
         let account = await getYunyingAccount(wangwang);
         // 关闭无用的page
         let pages = await browser.pages();
         await asyncForEach(pages,async function(page,index) {
             if(index>0){
                 await page.close();
             }
         });
         await browser.newPage();
         pages = await browser.pages();
         // page配置js
         const page = await setJs(pages[1]);
         page.setDefaultTimeout(600000);
         page.setDefaultNavigationTimeout(600000);
         page.setViewport({
             width: 1376,
             height: 1376
         });
         // 拦截静态文件请求
         await page.setRequestInterception(true);
         page.on('request',  request => {
             if(['image', 'font'].includes(request.resourceType())) {
                 return request.abort();
             }
             return request.continue();
         });
         if(account && account.f_raw_cookies){
             // 赋予浏览器圣洁的cookie
             await asyncForEach(account.f_raw_cookies.sycmCookie, async (value, index) => {
                 await page.deleteCookie(value);
                 await page.setCookie(value);
             });
         }
         return page;
     };
}
module.exports = { JupinSpiderYunying };
