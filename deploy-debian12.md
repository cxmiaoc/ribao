# Debian 12 部署步骤

服务器：`xxx`

域名：`xxx`

## 1. 安装基础环境

```bash
apt update
apt install -y curl git nginx default-mysql-server
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm i -g pm2
```

## 2. 准备项目目录

```bash
mkdir -p /var/www/ribao
cd /var/www/ribao
```

把本项目文件上传到 `/var/www/ribao`。

## 3. 安装依赖并准备前端

```bash
cd /var/www/ribao
npm install
npm run prepare:www
cp .env.example .env
nano .env
```

把 `.env` 里的数据库配置、应用密钥和 Android 更新地址改成真实配置。不要把 `.env` 提交到 Git。

## 4. 初始化 MySQL

先编辑 `server/schema.sql`，把示例数据库密码改成和 `.env` 一致的密码。

```bash
mysql -uroot -p < server/schema.sql
```

Schema 中包含日报记录、登录用户和故障处理库文章表。后续代码更新时，服务启动也会补齐故障处理库需要的表结构。

## 5. 启动后端

```bash
pm2 start server/ecosystem.config.cjs
pm2 save
pm2 startup
```

检查：

```bash
curl http://127.0.0.1:3000/api/health
```

## 6. 配置 Nginx

新建：

```bash
nano /etc/nginx/sites-available/ribao
```

写入：

```nginx
server {
    listen 80;
    server_name xxx;
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`client_max_body_size` 用于支持故障处理库里的图文文章上传。

启用：

```bash
ln -s /etc/nginx/sites-available/ribao /etc/nginx/sites-enabled/ribao
nginx -t
systemctl reload nginx
```

## 7. 配置 HTTPS

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d xxx
```

完成后访问：

```text
https://xxx
```

## 8. 后续更新

以后只需要把新代码上传到 `/var/www/ribao`，然后执行：

```bash
cd /var/www/ribao
npm install
npm run prepare:www
pm2 restart hospital-ops-report
```

手机 App 会加载服务器页面，所以普通前端修改不需要重新安装 APK。

如果需要下发新的 APK：

```bash
mkdir -p /var/www/ribao/downloads
cp 新版.apk /var/www/ribao/downloads/hospital-ops.apk
nano /var/www/ribao/.env
pm2 restart hospital-ops-report
```

把 `.env` 里的 `LATEST_ANDROID_VERSION` 改成比旧版本更高的版本号。手机端会自动检查，也可以点击页面里的“检查更新”按钮。

普通 Android 手机不能静默安装 APK，用户仍然需要确认安装，这是 Android 系统限制。
