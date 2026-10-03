# 浙大 842 刷题

把 **2009—2025年浙大842真题** 整理成一个本地刷题工具，涵盖信号与系统、数字电路。支持安卓、Windows 和 macOS，无需注册，平时刷题可以离线。

## 下载使用

**安卓：** [下载842刷题 1.0.3 APK](https://github.com/burriedalien666/zju842-practice/releases/download/android-v1.0.3/842-tablet-1.0.3.apk) · [安装与备份说明](docs/android.md) · [安卓发布页](https://github.com/burriedalien666/zju842-practice/releases/tag/android-v1.0.3)

在安卓设备中打开APK安装即可独立使用。已有版本先备份再覆盖，**不要卸载或清除数据**；从0.4.x测试版首次迁入时，请通过文件管理器打开APK，详见安装说明。

**电脑：**

[Windows x64](https://github.com/burriedalien666/zju842-practice/releases/download/v0.5.9/zju842-0.5.9-windows-x64.zip) · [Mac Apple芯片](https://github.com/burriedalien666/zju842-practice/releases/download/v0.5.9/zju842-0.5.9-macos-arm64.zip) · [Mac Intel芯片](https://github.com/burriedalien666/zju842-practice/releases/download/v0.5.9/zju842-0.5.9-macos-x64.zip)

完整解压后，Windows双击 `启动题库.cmd`，Mac双击 `启动题库.command`。浏览器会自动打开，使用期间请保留启动窗口。日常使用下载上面的完整包，不选 GitHub 的 Source code。

已有用户可在“更新中心”升级。[启动与备份说明](docs/local-guide.md) · [更新日志](CHANGELOG.md)

## 可以怎么用

- **分专题刷，或按年份做整卷**：支持筛选、计时和左右切题，专题末题可直接接着练下一专题。
- **看清题目**：250组／469条题面已转为文字、公式和矢量图，原图随时可查，支持日夜模式。
- **留下复习记录**：收藏重点题、自评掌握程度、导入自己的答案照片；每轮整卷记录分别保存，也能查看历年考点分布。

目前**暂未附公共答案和正式视频讲解**，也不自动判卷。安卓资料保存在App本机数据库，电脑版保存在 `userdata` 文件夹；升级或换设备前请备份。安卓与电脑版的个人备份格式不同，暂不能互相恢复。

发现题面或操作问题，欢迎[带题号和截图反馈](https://github.com/burriedalien666/zju842-practice/issues)，请勿上传私人备份。[后续计划](docs/roadmap.md)

<details>
<summary>开发与维护</summary>

需要 Node.js 24.14 或更新的24.x版本：

```sh
npm ci
npm run build
npm run desktop
```

[更新发布](docs/updates-maintenance.md) · [公共答案](docs/publishing-answers.md) · [题库维护](docs/questions.md) · [视频链接](docs/video-guide.md) · [自托管](docs/deployment.md)

安卓完整工程请下载发布附件 [842-tablet-1.0.3-source.zip](https://github.com/burriedalien666/zju842-practice/releases/download/android-v1.0.3/842-tablet-1.0.3-source.zip)，解压后按其中 `output/平板离线验证-20260927/ANDROID_SOURCE_README.md` 构建。仓库主目录与GitHub自动生成的 Source code 归档仍对应电脑版源码。

</details>

代码采用 [MIT许可证](LICENSE)；试题、题图和答案素材的权利归各自权利人，见[素材说明](CONTENT-NOTICE.md)。
