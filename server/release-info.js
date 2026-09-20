import packageInfo from "../package.json" with { type: "json" };

// Bundled notes remain available offline, including upgrades from an older
// launcher that did not save the downloaded release text.
export const releaseInfo = {
  version: packageInfo.version,
  title: "单题界面、逐轮练习记录与进度口径修正",
  notes:
    "• 章节与整卷统一单题界面，支持左右切题、顶部选题网格、星形收藏与自评撤销。\n• 完成进度统一为已做/总题数：3/23显示13%，不再混用已做题中的掌握比例；未全部完成不显示100%。\n• 新增日夜模式、暂停与一键重置计时、逐轮真题记录；新轮不覆盖旧轮自评。\n• 题图自动收起明显边缘留白，保留原图和正文比例；视频入口常驻，未关联时提示待发布。\n• 修复题单操作入口、收藏列表返回、答案编辑后折叠及计时刷新/备份恢复问题。\n• 题库r2、公共答案r0及原题号不变；个人资料和正式视频内容保持原样。",
};
