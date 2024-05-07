const config = {
    headless: false,
    serverName:'dev',
    tuijian_spider_concurrency: 3,
    canmou_index_concurrency: 3,
    canmou_login_user_data:'/home/penpen/Projects/zz-puppeteer-shuju/canmou',
    report_exec_path: 'C:\\Users\\penpen\\projects\\zz-puppeteer\\', // 文件执行的路径，不包含文件名
    auto_operation_path: 'G:\\data\\workspace\\zz-puppeteer\\chaojizhibo\\',    // 自动操作爬虫的路径
    // 未操作邮件 php脚本
    php_url: 'http://192.168.1.98:8000/api/noOperationRemind/',
    yunying_mail_url:'http://test.joss.jupin.net.cn:8080/api/yunYingNoOperationRemind/',
    mysql:{
        host     : '',
        user     : '',
        password : '',
        database : 'jupin_spider_config'
      },
    mysql_zhizuan:{
        host     : '',
        user     : '',
        password : '',
        database : 'jupin_zhizuan'
      },
    mongo:{
        url : 'mongodb:///zz_web',
      },

    mail:{
        user: 'group_itmonitor@jupin.net.cn',
        password: '',
        server: 'smtp.jupin.net.cn',
        to:'@jupin.net.cn'
    }
    }

module.exports = config
