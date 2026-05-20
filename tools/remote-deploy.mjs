import { Client } from "ssh2";
import { createReadStream } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const cwd = process.cwd();
const host = process.env.DEPLOY_HOST;
const username = process.env.DEPLOY_USER || "root";
const password = process.env.DEPLOY_PASSWORD;
const mysqlRootPassword = process.env.MYSQL_ROOT_PASSWORD;
const target = "/www/wwwroot/ribao";
const archive = join(cwd, "ribao-deploy.tar.gz");
const dbPassword = process.env.RIBAO_DB_PASSWORD || randomBytes(18).toString("base64url");
const appPassword = process.env.RIBAO_APP_PASSWORD || randomBytes(10).toString("base64url");
const appSecret = randomBytes(32).toString("hex");

if (!host || !password || !mysqlRootPassword) {
  throw new Error("DEPLOY_HOST, DEPLOY_PASSWORD, and MYSQL_ROOT_PASSWORD are required");
}

const tar = spawnSync(
  "tar",
  [
    "-czf",
    archive,
    "--exclude=node_modules",
    "--exclude=.build-tools",
    "--exclude=android",
    "--exclude=android/.gradle",
    "--exclude=android/app/build",
    "--exclude=www",
    "--exclude=ribao-deploy.tar.gz",
    ".",
  ],
  { cwd, stdio: "inherit" },
);

if (tar.status !== 0) process.exit(tar.status || 1);

const conn = new Client();

conn
  .on("ready", async () => {
    try {
      console.log("SSH connected");
      await exec("mkdir -p /tmp/ribao-upload /var/www");
      await upload(archive, "/tmp/ribao-upload/ribao-deploy.tar.gz");
      const inspect = await exec(`
set -e
echo "== system =="
cat /etc/os-release | head -n 3 || true
echo "== bt =="
test -d /www/server/panel && echo "bt-panel-found" || echo "bt-panel-not-found"
echo "== nginx =="
command -v nginx || true
nginx -v 2>&1 || true
echo "== mysql =="
command -v mysql || true
mysql --version || true
echo "== node =="
command -v node || true
node -v || true
`);
      console.log(inspect);

      const script = `
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
mkdir -p /www/wwwroot
rm -rf ${target}
mkdir -p ${target}
tar -xzf /tmp/ribao-upload/ribao-deploy.tar.gz -C ${target}
cd ${target}
npm install --omit=dev
npm run prepare:www
mysql -uroot -p'${mysqlRootPassword.replaceAll("'", "'\\''")}' <<'SQL'
CREATE DATABASE IF NOT EXISTS ribao DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'ribao'@'localhost' IDENTIFIED BY '${dbPassword.replaceAll("'", "'\\''")}';
ALTER USER 'ribao'@'localhost' IDENTIFIED BY '${dbPassword.replaceAll("'", "'\\''")}';
GRANT ALL PRIVILEGES ON ribao.* TO 'ribao'@'localhost';
FLUSH PRIVILEGES;
USE ribao;
CREATE TABLE IF NOT EXISTS ops_records (
  id CHAR(36) NOT NULL PRIMARY KEY,
  record_date DATE NOT NULL,
  location VARCHAR(255) NOT NULL,
  fault TEXT NOT NULL,
  solution TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_record_date_created (record_date, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL
cat > ${target}/.env <<'ENV'
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=ribao
DB_PASSWORD=${dbPassword}
DB_NAME=ribao
APP_SECRET=${appSecret}
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${appPassword}
LATEST_ANDROID_VERSION=2.0.0
APK_DOWNLOAD_URL=https://xxx/downloads/hospital-ops.apk
ENV
mkdir -p ${target}/downloads
cat > /www/server/panel/vhost/nginx/ribao.conf <<'NGINX'
server {
    listen 80;
    server_name xxx;

    location /.well-known/acme-challenge/ {
        root /www/wwwroot/ribao/www;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name xxx;

    client_max_body_size 20m;
    access_log /www/wwwlogs/ribao.log;
    error_log /www/wwwlogs/ribao.error.log;

    ssl_certificate /etc/letsencrypt/live/xxx/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/xxx/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
pm2 delete hospital-ops-report >/dev/null 2>&1 || true
pm2 start ${target}/server/server.js --name hospital-ops-report --cwd ${target}
pm2 save
curl -fsS http://127.0.0.1:3000/api/health
`;
      console.log(await exec(script, { timeoutMs: 900000 }));
      console.log(`APP_PASSWORD=${appPassword}`);
    } finally {
      conn.end();
    }
  })
  .connect({ host, username, password, readyTimeout: 30000 });

function exec(command, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: false }, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`Remote command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      stream.on("data", (data) => {
        stdout += data.toString();
      });
      stream.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      stream.on("close", (code) => {
        clearTimeout(timer);
        const output = `${stdout}${stderr}`;
        if (code === 0) resolve(output);
        else reject(new Error(output || `Remote command failed: ${code}`));
      });
    });
  });
}

function upload(localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }
      const read = createReadStream(localPath);
      const write = sftp.createWriteStream(remotePath);
      write.on("close", resolve);
      write.on("error", reject);
      read.on("error", reject);
      read.pipe(write);
    });
  });
}
