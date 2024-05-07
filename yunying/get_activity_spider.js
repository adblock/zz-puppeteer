const {asyncForEach,getAllShopBoss} = require('../commons/func');
const { getCookiesByMongo } = require("../commons/account");
const moment = require('moment');
const {mongoQuery} = require('../commons/db');
const { getBrowser, getPage, sendReauest, saveActivityData } = require('./yunying_commons');

let G_wangwang = '';
let G_save_data = {};
const startCrawl = async(page) => {
    G_save_data = {};
    await page.goto('https://sale.tmall.com/page/campaign/activity_manage.htm', {waitUntil:'networkidle2'});
    if(page.url().indexOf('sale.tmall.com/page/campaign/activity_manage.htm') > -1){
        let activity_data = [];

        // 官方大促 活动列表
        let activity_url = 'https://sale.tmall.com/list/campaignList/queryListData.do?currentPage=1';
        await activityFetchRec(page, activity_url, activity_data);

        // 营销活动 活动列表
        let market_url = 'https://sale.tmall.com/list/marketSiteList/queryListData.do?currentPage=1';
        await marketFetchRec(page, market_url, activity_data);

        // 行业活动 活动列表, 优先选择可参加，若无，则取出全部活动
        let daily_url = 'https://sale.tmall.com/list/applicableDailyActivityList/queryListData.do?currentPage=1';
        let resp = await sendReauest(page, daily_url);
        let activity_cansign = resp['data']['list'];
        if(activity_cansign.length===0){
            daily_url = 'https://sale.tmall.com/list/dailyActivityList/queryListData.do?currentPage=1';
        }
        await dailyFetchRec(page, daily_url, activity_data);

        await saveActivityData(G_save_data, G_wangwang)
    } else {
        console.log('cookie 失效');
    }
};

/**
 * 递归获取所有活动 -- 官方大促（此类活动超出页数 result返回空）
 * @param page
 * @param url
 * @param save_data
 * @returns {Promise<void>}
 */
const activityFetchRec = async(page, url, save_data) => {
    let resp = await sendReauest(page, url);
    let activity_list = resp['data']['list'];
    if(activity_list.length > 0){
        // 获取报名中的活动
        let online_activity = await onLineActivity(page, activity_list);
        if(online_activity.length > 0){
            // 判断 店铺类型（淘宝店/天猫店）
            let user_info = await page.evaluate(()=>window.userInfo);
            if(user_info['isTmallSeller'] === 'true') {
                online_activity = await tianmaoActivity(page, online_activity)
            } else {
                online_activity = await taobaoActivity(page, online_activity)
            }
        }
        save_data = save_data.concat(online_activity);
        let curr_page = url.match(/currentPage=(\d+)/)[1];
        let next_page = parseInt(curr_page) + 1;
        url = url.replace(/currentPage=(\d+)/, 'currentPage=' + next_page);
        await activityFetchRec(page, url, save_data)
    } else {
        let activity_type = url.match(/list\/(\S+)\/queryListData/)[1];
        G_save_data[activity_type] = save_data;
    }
};

/**
 * 天猫店铺 获取详细活动数据
 * @param page
 * @param activities
 * @returns {Promise<*>}
 */
const tianmaoActivity = async(page, activities) => {
    await asyncForEach(activities, async(value, index)=>{
        let activity_apply_list_url = 'https://sale.tmall.com/list/queryListData.do?code=activityApplyList&campaignId=' + value['id'];
        let activity_data = await getDetail(page, activity_apply_list_url);
        if(activity_data.length > 0){
            value['detail'] = activity_data;
            value['istmall'] = 1;
        } else {
            delete activities[index]
        }
    });
    activities = await filterNull(activities);
    return activities;
};

/**
 * 淘宝店铺 获取详细活动数据
 * @param page
 * @param activities
 * @returns {Promise<Array>}
 */
const taobaoActivity = async(page, activities) => {
    await asyncForEach(activities, async(value, index)=>{
        // 获取 planId(外围/会场招商id)
        let plan_url = 'https://sale.tmall.com/activity/detail/queryComponentData.do?scene=marketProgram&mainComponentId=stepList&componentId=spotItem&campaignId=' + value['id'];
        let resp = await sendReauest(page, plan_url);
        let rhythm_list = resp['data']['rhythmList'];
        value['detail'] = rhythm_list;
        value['istmall'] = 0;
        await asyncForEach(rhythm_list, async(rhythm)=>{
            let activity_group_url = 'https://sale.tmall.com/list/queryListData.do?code=activityGroupAvailableList&planId=' +
                rhythm['id'] + '&campaignId=' + value['id'] + '&campaignGroupId=&currentPage=1';
            let activity_group = await recGetResponse(page, activity_group_url, []);
            rhythm['detail'] = activity_group;
            await asyncForEach(activity_group, async(activity)=>{
                let activity_apply_url = 'https://sale.tmall.com/list/queryListData.do?activityGroupId=' +
                    activity['activityGroupId'] + '&code=activityApplyList&currentPage=1';
                let apply_activity = await recGetResponse(page, activity_apply_url, []);
                if(apply_activity.length > 0){
                    activity['detail'] = apply_activity;
                }
            });
        })
    });
    return activities;
};

/**
 * 返回活动列表 -- 营销活动（此类活动只请求一次，超出页数也有数据 TODO）
 * @param page
 * @param url
 * @param save_data
 * @returns {Promise<void>}
 */
const marketFetchRec = async(page, url, save_data) => {
    let resp = await sendReauest(page, url);
    if(resp['data']['list']){
        let marker_data = resp['data']['list'].filter((data)=>{return data.hasOwnProperty('activityNum')});
        save_data = save_data.concat(marker_data);
    }
    await asyncForEach(save_data, async(value, index)=>{
        let detail_dict = {};
        let site_id = value['link'].match(/siteId=(\d+)/)[1];
        // 官方直播间特殊处理
        if(site_id === '188'){
            let live_url = 'https://sale.tmall.com/list/liveRoomSupplyList/queryListData.do?currentPage=1';
            detail_dict['special'] = await recGetResponse(page, live_url, []);
            value['detail'] = detail_dict
        } else {
            // 大促活动
            let promote_url = 'https://sale.tmall.com/list/marketSiteCampaignList/queryListData.do?name=&siteId=' + site_id + '&currentPage=1';
            let promote_data = await getDetail(page, promote_url);
            // 过滤已结束的活动
            promote_data = promote_data.filter((promote)=>{return promote.statusName !== '已结束'});
            detail_dict['promote'] = await marketActivityDetail(page, site_id, promote_data);

            // 日常活动
            let daily_url = 'https://sale.tmall.com/list/activityAllList/queryListData.do?channelId=0&activityType=2&name=&siteId=' + site_id + '&currentPage=1';
            detail_dict['daily'] = await isPassActivity(await getDetail(page, daily_url));

            if(detail_dict['promote'].length > 0 || detail_dict['daily'].length > 0){   // 如果日常 和 大促 活动都没数据，就不存了
                value['detail'] = detail_dict;
            } else {
                delete save_data[index]
            }
        }
    });
    save_data = await filterNull(save_data);
    let activity_type = url.match(/list\/(\S+)\/queryListData/)[1];
    G_save_data[activity_type] = save_data;
};

/**
 * 营销活动的大促活动 获取详细活动数据
 * @param page
 * @param site_id
 * @param promote_data
 * @returns {Promise<Array>}
 */
const marketActivityDetail = async(page, site_id, promote_data) => {
    await asyncForEach(promote_data, async(promote, promote_index)=>{
        // 获取 unitedActivityId (tab?)
        let united_url = 'https://sale.tmall.com/component/marketSiteCampaignActivity/default/buildComponent.do?siteId=' + site_id + '&campaignId=' + promote['id'];
        let resp = await sendReauest(page, united_url);
        let unitedActivityList = resp['data']['data']['unitedActivityList'];
        await asyncForEach(unitedActivityList, async(unitedActivity, united_index)=>{
            let activity_group_url = 'https://sale.tmall.com/list/activityApplyList/queryListData.do?siteId=' + site_id +
                                     '&channelId=0&campaignId=' + promote['id'] + '&unitedActivityId=' +
                                      unitedActivity['unitedActivityId'] + '&activityType=1&name=&currentPage=1';
            // activity_list：最终的可报名活动列表
            let activity_list = await recGetResponse(page, activity_group_url, []);
            // 如果最终 tab下 没有可报名活动，不存数据
            if(activity_list.length > 0){
                unitedActivity['detail'] = activity_list;
            } else {
                delete unitedActivityList[united_index];
            }
        });
        unitedActivityList = await filterNull(unitedActivityList);      // tab下 没有可报名活动，不存数据
        if(unitedActivityList.length > 0){
            promote['detail'] = unitedActivityList;
        } else {
            delete promote_data[promote_index]
        }
    });
    promote_data = await filterNull(promote_data);
    return promote_data;
};

/**
 * 递归获取所有活动 -- 行业活动（此类活动超出页数 result返回空）
 * @param page
 * @param url
 * @param save_data
 * @returns {Promise<void>}
 */
const dailyFetchRec = async(page, url, save_data) => {
    let resp = await sendReauest(page, url);
    let activity_list = resp['data']['list'];
    if(activity_list.length > 0){
        // 获取报名中的活动
        let online_activity = await onLineActivity(page, activity_list);
        online_activity = await dailyActivityDetail(page, online_activity);
        save_data = save_data.concat(online_activity);
        let curr_page = url.match(/currentPage=(\d+)/)[1];
        let next_page = parseInt(curr_page) + 1;
        url = url.replace(/currentPage=(\d+)/, 'currentPage=' + next_page);
        await dailyFetchRec(page, url, save_data)
    } else {
        let activity_type = url.match(/list\/(\S+)\/queryListData/)[1];
        G_save_data[activity_type] = save_data;
    }
};

/**
 * 行业活动的 详细活动数据
 * @param page
 * @param activities
 * @returns {Promise<*>}
 */
const dailyActivityDetail = async(page, activities) => {
    await asyncForEach(activities, async(activity, index)=>{
        let apply_url = 'https://sale.tmall.com/list/queryListData.do?activityGroupId='+ activity['activityGroupId'] +'&code=activityAllList&currentPage=1';
        let apply_data = await recGetResponse(page, apply_url, []);
        if(apply_data.length > 0){
            activity['detail'] = apply_data;
        } else {
            delete activities[index];
        }
    });
    activities = await filterNull(activities);
    return activities
};

/**
 * 获取详细计划
 * @param page
 * @param url
 * @returns {Promise<*[] | T[] | Array>}
 */
const getDetail = async(page, url) => {
    let save_data = [];
    let resp = await sendReauest(page, url);
    if (resp['data']) {
        save_data = save_data.concat(resp['data']['list']);
    }
    let total_page = Math.ceil(parseInt(resp['data']['total']) / parseInt(resp['data']['pageSize']));

    for(let curr_page=2; curr_page<=total_page; curr_page++){
        url = url.replace(/currentPage=(\d+)/, 'currentPage=' + curr_page);
        let resp = await sendReauest(page, url);
        if (resp['data']) {
            save_data = save_data.concat(resp['data']['list']);
        }
    }
    return save_data
};

/**
 * 获取报名中的计划
 * @param page
 * @param activities
 * @returns {Promise<Array>}
 */
const onLineActivity = async(page, activities) => {
    // 过滤已结束
    activities = activities.filter((activity)=> {
        return activity['statusName'].indexOf('已结束') === -1
    });
    return activities
};

/**
 * 递归获取活动列表（递归获取下一页直到没有数据）
 * @param page
 * @param url
 * @param recData
 * @returns {Promise<void>}
 */
const recGetResponse = async(page, url, recData) => {
    let resp = await sendReauest(page, url);
    let activity_list = [];
    if(resp['data']){
        activity_list = resp['data']['list'];
    }
    if(activity_list.length > 0){
        recData = recData.concat(activity_list);
        let curr_page = url.match(/currentPage=(\d+)/)[1];
        let next_page = parseInt(curr_page) + 1;
        url = url.replace(/currentPage=(\d+)/, 'currentPage=' + next_page);
        return await recGetResponse(page, url, recData);
    } else {
        return recData;
    }
};

/**
 * 获取可报名活动（究极体）
 * @param activity_list
 * @returns {Promise<*>}
 */
const isPassActivity = async(activity_list) => {
    activity_list = activity_list.filter((activity)=>{return activity.isPass});
    return activity_list
};

/**
 * 过滤数组为null 的数据
 * @param activities
 * @returns {Promise<*>}
 */
const filterNull = async(activities) => {
    activities = activities.filter(activity => activity);
    return activities
};

//过滤今天已经爬取的店铺
async function dropHistoryShopList(shop_list, table_name, crawldate) {
    let db = await mongoQuery();
    const data = await db.collection(table_name).find({'crawl_date': crawldate}).project({_id: 0, nick_name: 1}).toArray();
    let del_index_arr = [];
    if (data) {
        shop_list.forEach((shop, index) => {
            data.forEach((d) => {
                if (shop['f_copy_wangwangid'] === d['nick_name']) {
                    del_index_arr.push(index);
                }
            });
        });
        // 删除数组
        del_index_arr.sort(function (a, b) {
            return b - a
        });
        del_index_arr.forEach(function (index) {
            shop_list.splice(index, 1)
        })
    }
    return shop_list;
}


(async() => {
    // 获取服务中运营店铺
    let shopList = await getAllShopBoss();
    let today = moment(new Date()).format("YYYY-MM-DD");
    //店铺去重 过滤已经爬取的今天的店铺
    let shop_list =  await dropHistoryShopList(shopList,'yunying.activity_data',today);

    let browser = '';
    await asyncForEach(shop_list, async(value, index)=>{
        try{
            G_wangwang = value.f_copy_wangwangid;
            console.log(G_wangwang);
            let cookies = await getCookiesByMongo(G_wangwang);
            browser = await getBrowser();
            let page = await getPage(browser, cookies);     // 获取设置cookie的页面，如果cookie失效返回null
            if(page){
                await startCrawl(page);
                await browser.close();
            } else {
                console.log('cookie 失效');
                await browser.close();
            }
        } catch (e) {
            if (e.message.indexOf('Error: Page crashed!') === -1) {
                console.log(e.message);
            }
            await browser.close();
        }
    });
    process.exit();
})();