const { mysqlQuery }  = require('./db');

// 获取一个可用的有效cookies
const getValidCookies = async(limit) => {
    let cookies_id = null;
    cookies = await mysqlQuery('select id from t_account where f_valid_status = 1 and f_use_status = 0 order by cookies_updated_at desc limit '+limit);
    if(cookies.length>0){
        return cookies;
    }else{
        return undefined;
    }
}


// 获取一个可用的有效cookies
const getOneValidCookiesByid = async(cookies_id) => {
    cookies = await mysqlQuery('select * from t_account where  id = '+cookies_id);
    if(cookies.length>0){
        updete = await mysqlQuery('update t_account set f_use_status = 1 where id = ' + cookies_id);
        return {
            cookies:cookies[0],
            // 一个闭包的方法，爬虫运行结束后重置cookies状态为不在使用中
            setUnused:async() => {
                updete = await mysqlQuery('update t_account set f_use_status = 0 where id = ' + cookies_id);
            }
        };
    }else{
        return undefined;
    }
}
// 获取几个可用的有效cookies
const getValidCookiesByLimit = async(limit) => {
    cookies = await mysqlQuery('select * from t_account where f_valid_status = 1 and f_use_status = 0 limit '+limit);
    return cookies;
}

// 格式化cookies
const getStrCookies = (cookiesObject) => {
    let strCookies = '';
    cookiesObject.forEach(ele=> {
      strCookies = strCookies + ele.name + "=" + ele.value + '; '
    });

    strCookies = strCookies.slice(0, strCookies.length-2)
    return strCookies;
  }

module.exports = { getOneValidCookiesByid, getValidCookies, getValidCookiesByLimit, getStrCookies}