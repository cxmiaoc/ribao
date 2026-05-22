# 医院运维日报

一个给医院运维记录日常故障和处理经验的手机端系统。前端可以运行在浏览器和 Android App 中，记录数据统一保存到 MySQL，不再依赖手机本地存储。

## 功能

### 日报记录

每条日报只需要填写三项：

- 地点：科室、几号位、设备位置等。
- 发生的故障：当时遇到的问题。
- 如何解决：处理结果或解决方法。

一天可以记录多条内容，支持按日期查看当天记录，也支持查看今日记录和全部记录。

查询结果和复制格式为：

```text
1.地点-发生的故障-如何解决
2.地点-发生的故障-如何解决
3.地点-发生的故障-如何解决
```

### 故障处理库

日报页面右上角可以进入“故障处理库”。

- 按博客文章形式发布处理经验。
- 文章包含标题和富文本正文。
- 正文可以在光标位置插入图片，图片与文字可以穿插记录。
- 列表页显示文章，点击后查看完整详情。
- 支持按标题和正文做全文搜索，适合按报错关键字查处理步骤。

### 登录和用户

- 日报和故障处理库都需要登录后使用。
- 每个登录用户的数据相互隔离。
- 管理员可以在日报页连续点击三次标题，进入用户管理入口后添加登录用户。

## 数据存储

日报记录、用户和故障处理库文章都保存在服务端 MySQL 中。

- 本地测试需要先准备 MySQL 和 `.env`。
- 服务器部署后，手机 App 直接读取服务器页面和接口。
- `.env`、数据库密码、APK 包和部署压缩包不应提交到 Git。

## 本地运行

安装依赖：

```bash
npm install
```

准备环境变量：

```bash
cp .env.example .env
```

Windows PowerShell 可以改用：

```powershell
Copy-Item .env.example .env
```

把 `.env` 中的数据库配置改成当前 MySQL 实际配置，并先初始化数据库：

```bash
mysql -uroot -p < server/schema.sql
```

启动后端和正式页面：

```bash
npm start
```

打开：

```text
http://localhost:3000
```

需要单独测试前端页面时，可以另开一个终端执行：

```bash
npm run serve
```

再打开：

```text
http://localhost:4173
```

`4173` 本地页面会请求 `http://localhost:3000` 的后端接口，所以后端仍然需要保持运行。

## 服务器更新

普通前端和后端代码更新后，服务器上执行：

```bash
npm install
npm run prepare:www
pm2 restart hospital-ops-report
```

故障处理库文章可以带图片，Nginx 代理层需要保留足够的请求体限制，例如：

```nginx
client_max_body_size 100m;
```

更完整的 Debian 12 部署步骤见 [deploy-debian12.md](./deploy-debian12.md)。

## 打包 APK

Android App 通过 Capacitor 打包。安装 Android Studio、Java 和 Android SDK 后执行：

```bash
npm run cap:sync
npm run cap:open
```

Android Studio 打开后选择：

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

当前 App 加载服务器页面后，普通页面改动不需要重新安装 APK。只有原生配置、安装包版本或 Android 端能力变化时，才需要重新打包并下发新版 APK。
