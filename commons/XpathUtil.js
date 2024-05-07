///* xpath 语法相关工具类
// * /
/**
 * 获取 xpath语法选中的第一个元素
 * @param page
 * @param xpath
 * @returns {Promise<*>}
 */
async function $x0(page,xpath) {
    let arrayElementHandle = await  page.$x(xpath);
    if(arrayElementHandle&&arrayElementHandle.length>0){
        return arrayElementHandle[0];
    }
    return null;
}
async function $xClick(page,xpath) {
   let elementHandle  = await  $x0(page,xpath);
    await elementHandle.click();
}
module.exports = {
    $x0,
    $xClick
}