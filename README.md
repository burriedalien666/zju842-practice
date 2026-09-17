# 面对浙大842考生的专业课做题网

本地运行的842题库：Windows和macOS下载后解压启动，在自己的浏览器中刷题。已有题目、答案、收藏、题单和复习记录均可离线使用，不要求云端账号，不产生网站托管费用。

[下载发布包](https://github.com/burriedalien666/zju842-practice/releases) · [使用说明](docs/local-guide.md) · [纠错与问答](https://github.com/burriedalien666/zju842-practice/discussions/categories/q-a)

## 开始使用

选择与你电脑匹配的发布包：Windows x64、Mac Apple芯片 arm64 或 Mac Intel x64。解压后双击“启动题库.cmd”（Windows）或“启动题库.command”（Mac）。系统浏览器自动打开，启动窗口关闭后服务停止。

不要下载GitHub自动生成的Source code压缩包当作免安装成品。发布包包含运行环境，无需自行安装Node.js或Docker。

## 功能

- 按科目、题型、题源、年份搜索与筛选，支持原题放大、收藏、题单和顺序/随机练习。
- 自评“做错／吃力／独立答对”，自动安排到期复习。默认间隔可调整，错题独立成组，重做答对后移出未解决错题。
- 题库答案与“我的答案”分开；支持多图导入、旋转、排序、替换和定稿。个人答案不自动上传。
- 学习记录和个人照片存入程序旁的 `userdata`，不依赖浏览器缓存。提供个人备份与恢复。
- 官方题库通过 `.842pack` 资料包更新，不覆盖个人答案、收藏、题单或复习记录。用户主动检查GitHub更新，不静默替换可执行程序。
- 作者可以导出题库包，并明确选择需要公开的个人定稿答案；私人草稿、密码和学习记录不会导出。
- 纠错前往GitHub Discussions Q&A，需要网络及GitHub账号。

现有题库含2009—2025年469条题目、287张裁切图。后续期末题可使用同一题库结构，见[题库维护](docs/questions.md)。不分发原PDF、整页扫描或历史AI答案草稿。

## 从源码运行

安装Node.js 24.14或更新的24.x版本：

```sh
npm ci
npm run build
npm run desktop
```

本地启动器只监听 `127.0.0.1`，不会读取 `.env` 或连接Turso。每次启动会生成临时本机会话，浏览器由启动器打开。个人数据默认位于 `userdata`；如需指定位置，使用 `ZJU842_DATA_DIR`。

```sh
npm test
npm run test:desktop
npm run package:desktop
```

各系统需要在相应系统上打包并测试，不能把Windows生成的依赖复制成Mac包。构建工作流会分别验证Windows、Mac Intel和Mac Apple芯片。包不附带商业代码签名；首次打开可能出现系统来源提示，应检查下载来源，不要关闭整体安全保护。

复习间隔是可调整的练习建议，不是对记忆力或考试成绩的预测。没有自动判卷，结果以使用者自评为准。

## 在线部署与许可证

此前的服务器运行模式保留给有自托管需要的开发者，见[部署说明](docs/deployment.md)。它不是本地版的必需条件；本地包不含任何云端密钥。

程序代码及技术文档采用[MIT](LICENSE)；题目内容、题图和答案素材不纳入MIT，详见[素材授权范围](CONTENT-NOTICE.md)。
