# 题库维护

题目编号是分享链接、学习记录和照片答案的关联依据，已发布后保持不变。新增期末题建议使用 `final-课程简称-年份-卷别-题号`，与现有考研题编号区分。

整理流程：核对整份 PDF → 按题裁切 → 标注科目、题型和来源 → 生成题包 → 本地导入并检查题图 → 构建部署。原 PDF 和整页扫描不进入题包。

题包目录：

```text
prepared-package/
  catalog.json
  questions/
    final-signals-2025-a-1.webp
```

`catalog.json` 示例（替换示例标题、尺寸和图片为实际内容）：

```json
{
  "version": 1,
  "types": [
    {
      "id": "final-signals-example",
      "title": "系统性质判断",
      "group": "final-signals",
      "groupTitle": "信号与系统",
      "subject": "signals"
    }
  ],
  "questions": [
    {
      "id": "final-signals-2025-a-1",
      "subject": "signals",
      "sourceKind": "final",
      "year": 2025,
      "number": "一、1",
      "title": "判断系统的线性与时不变性",
      "typeId": "final-signals-example",
      "sourceTitle": "课程名称 · 2025年期末A卷",
      "tags": ["线性", "时不变"],
      "note": "",
      "shared": false,
      "images": [
        {
          "src": "questions/final-signals-2025-a-1.webp",
          "width": 1200,
          "height": 450,
          "caption": ""
        }
      ]
    }
  ]
}
```

`subject` 使用 `signals` 或 `digital`；`sourceKind` 使用 `entrance` 或 `final`。可以直接复用 `public/catalog.json` 中的已有题型编号，不必创建新题型；同一编号的名称、分组和科目不能互相矛盾。

导入器校验重复编号、题型关联、路径、尺寸和图片存在性；不会覆盖不同内容的同名图片，也不会复制题包中未引用的文件。路径检查不能判断图片视觉上是不是整页，裁切范围仍需逐题检查。

修改已发布题目文字时直接维护已有索引并保持编号不变；替换题图使用新文件名，检查后重新构建。若确需重编号，先迁移数据库中的答案关联，再处理用户学习记录兼容；不要直接删除重建。
