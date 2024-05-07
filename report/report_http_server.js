/**
 *  关于报表的 http服务，通过参数调用不同的爬虫（生成报表和爬取报表）
 * */

const http = require('http');
const {scheduleSpider} = require('./report_schedule');
const {createImg} = require('./create_report_img');


(async() =>{
    try{
        let mongo_id = '';
        // 创建服务器
        http.createServer( async function (request, response) {
           // 解析请求，包括文件名
            let url = request.url;
            if(url.indexOf('mongo_id') > -1){       // 爬取报表
                console.log(url);
                let url_match = url.match(/\/mongo_id=(.*)/);
                mongo_id = url_match[1];
                if(mongo_id){
                    let resp = await scheduleSpider(mongo_id);
                    response.writeHead(200, {'Content-Type': 'application/json'});
                    // 响应文件内容
                    response.write(JSON.stringify({'status':resp.trim()}));
                    //  发送响应数据
                    response.end();
                }
            }
            if(url.indexOf('report_url') > -1){     // 生成报表
                console.log(url);
                let url_match = url.match(/\/report_url=(.*)/);
                let report_url = url_match[1];
                console.log(report_url);
                let base_img = await createImg(report_url);
                response.writeHead(200, {'Content-Type': 'text/html'});
                // 响应文件内容
                if(base_img){
                    response.write(JSON.stringify({'report_img':base_img}));
                } else {
                    response.write('');
                }

                //  发送响应数据
                response.end();
            }
        }).listen(6100);
        console.log('server running...')
    } catch (e) {
        console.log(e)
    }
})();
