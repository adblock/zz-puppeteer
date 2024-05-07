const puppeteer = require('puppeteer');
const config = require('../config');
const createImg = async(report_url) => {
    const browser = await puppeteer.launch({
        headless: config.headless,
        args: [
            "--disable-gpu",
            "--disable-setuid-sandbox",
            "--force-device-scale-factor",
            "--ignore-certificate-errors",
            "--no-sandbox",
            "--start-maximized"
        ],
        ignoreDefaultArgs: ["--enable-automation"],
        defaultViewport:{
            width: 1920,
            height: 1080
        }
    });
    try{
        let page = await browser.newPage();
        await page.goto(report_url, {waitUntil:'networkidle0'});
        await page.waitForSelector('.ant-spin-spinning',{hidden:true});
        await page.waitFor(2000);
        let img_base64 = await page.screenshot({
            fullPage:true,
            encoding: 'base64',
        });
        await browser.close();
        return img_base64
    }catch (e) {
        console.log(e);
        await browser.close();
        return null
    }

};
module.exports = { createImg };
