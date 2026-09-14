# Render Free + Turso

Render 运行网站，Turso 保存管理员、会话、照片答案和文字纠错。学习记录仍保存在访客自己的浏览器中。本地运行不配置 Turso 时使用原有 SQLite 文件；Render 部署必须配置 Turso，缺少配置会停止启动，避免误把答案写入临时磁盘。

## 准备数据库

在 Turso Free 账号下创建独立数据库，建议名称 `zju842-practice`。本项目使用官方 `@libsql/client`，创建页面若要求选择引擎，选择兼容 libSQL 的数据库。位置尽量靠近 Render 服务所在区域；大陆访问速度需在实际站点验证。

复制数据库连接地址（通常以 `libsql://` 开头）。为这一个数据库生成读写访问密钥，不使用可管理整个组织的令牌。密钥只放在本地私有配置和 Render 的私有环境变量中，不发送到聊天、截图或 GitHub。

## 设置管理员

在本项目目录的 `.env` 中私下填写：

```text
TURSO_DATABASE_URL=数据库连接地址
TURSO_AUTH_TOKEN=数据库访问密钥
```

在自己的终端执行：

```sh
npm ci
npm run admin:setup
```

命令会初始化数据库表并让你输入管理员密码，输入不回显。密码保存为加盐验证值，原始密码不写入数据库。此命令连接云数据库，因此不需要 Render 免费服务的远程终端。再次运行会重置密码并退出所有已有登录。

配置云端不会自动上传本机已有照片或纠错。如果已有需要迁移的本地数据，先备份并单独安排迁移，不要直接切换后误以为数据已转移。

## 创建 Render 服务

选择 **Web Service**，连接 `burriedalien666/zju842-practice`，分支 `main`，运行环境 **Docker**，套餐 **Free**。不要选择 Static Site，也不要创建30天后过期的免费 Render Postgres。

填写 `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN` 两个环境变量。数据库密钥只供后端使用。站点会读取 Render 自动提供的 HTTPS 网址作为允许的请求来源，无需提前猜测网址；未来绑定域名时设置 `PUBLIC_ORIGIN` 为实际地址。

也可以使用本仓库的 `render.yaml` Blueprint，它预设 Free 套餐并要求私下填写这两个变量。确认页面若出现付费要求，先停止，不自动升级或绑定付款方式。

## 检查上线效果

部署完成后，打开 Render 提供的 HTTPS 网址，检查题图、登录、纠错与答案照片。使用新照片验证保存草稿、发布、退出登录后查看、撤下，再重启服务确认数据仍存在。勿用正式答案做删除测试。

反向代理默认不被盲目信任。上线前需核实该服务的代理链，将可信代理的IP/CIDR填入 `TRUST_PROXY_CIDRS`（多个用逗号分隔），并用两种网络检查纠错/登录限流，避免多人被合并限流。不能直接填写通配符或信任所有地址。还需用红米实机测试相机与相册上传、在大陆普通网络访问，并验证关闭维护者电脑后网站仍可使用。

Render Free 闲置后会休眠，唤醒需要时间；服务有额度上限。Turso 也有存储与读写额度。不要开启付费超额使用；定期在后台查看额度并备份数据库。免费数据库不等于无需备份。

参考：[Render 免费服务](https://render.com/docs/free)、[Render 自动环境变量](https://render.com/docs/environment-variables)、[Turso 客户端](https://docs.turso.tech/sdk/ts/reference)、[Turso 价格](https://turso.tech/pricing)。
