import packageInfo from "../package.json" with { type: "json" };

// Bundled notes remain available offline, including upgrades from an older
// launcher that did not save the downloaded release text.
export const releaseInfo = {
  version: packageInfo.version,
  title: "全题库结构化与简洁练习界面",
  notes:
    "• 全部250组／469条题面使用文字、离线公式和SVG图形，支持查看原图；原题编号不变。\n• 删除章节卡片装饰图标和标题旁已做/掌握汇总块，保留侧栏进度；移除做题页原题说明。\n• 专题最后一题可直接选择下一专题或其他专题；整卷末题打开总结，不自动结束或评分。\n• 修复目录悬停高亮不完整、夜间配色和首页分隔线。\n• 个人答案、收藏、自评、题单、计时、轮次和视频关联保留；程序、题库及公共答案继续独立更新。",
};
