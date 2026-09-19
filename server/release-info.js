import packageInfo from "../package.json" with { type: "json" };

// Bundled notes remain available offline, including upgrades from an older
// launcher that did not save the downloaded release text.
export const releaseInfo = {
  version: packageInfo.version,
  title: "单题视频、更新完成说明与完整看图",
  notes:
    "• 做题页和整卷新增本题视频入口；支持作者分批导入、分P和时间跳转。\n• 更新完成后显示变更摘要，更新中心可随时回看。\n• 移除图片二次放大/缩小，点图后按窗口完整显示，不再左右拖动。\n• 题库r2、公共答案r0及原题号不变；样例视频不进入正式题库。",
};
