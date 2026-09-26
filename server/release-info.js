import packageInfo from "../package.json" with { type: "json" };

// Bundled notes remain available offline, including upgrades from an older
// launcher that did not save the downloaded release text.
export const releaseInfo = {
  version: packageInfo.version,
  title: "全题库结构化与专题连续练习",
  notes:
    "• 配套题库r4启用全部250组／469条结构化题面，公式与SVG图形离线显示，原图仍可展开对照。\n• 做题页不再常驻复核备注；原题疑点收进折叠的原题说明，既有疑点记录保留。\n• 专题最后一题可直接选择下一专题或其他专题；整卷末题可直接查看本轮总结，不自动结束练习。\n• 修复目录悬停仅局部高亮、夜间配色不一致，以及首页残留白色分隔线。\n• 原题号、答案、视频和个人学习记录保持关联；结构化显示异常仍可回退原图。题库r4需程序0.5.8或更新版本。",
};
