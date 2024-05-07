const dateFormat = require('dateformat');
const moment = require('moment');

const getYesterday = async(isStr=1)=>{
  let yesterday = new Date(new Date().getTime()-(24*60*60*1000));
  if(isStr){
      yesterday = dateFormat(yesterday, "yyyy-mm-dd");
  }
  return yesterday
};

//时间戳转换为日期
function timestampToTime(timestamp) {
    var date = new Date(timestamp);
    var Y = date.getFullYear() + '-';
    var M = (date.getMonth()+1 < 10 ? '0'+(date.getMonth()+1) : date.getMonth()+1) + '-';
    var D = (date.getDate() < 10 ? '0'+date.getDate() : date.getDate()) + ' ';
    return Y+M+D;
}

module.exports = { getYesterday, timestampToTime }