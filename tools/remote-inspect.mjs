import { Client } from "ssh2";

const host = process.env.DEPLOY_HOST;
const username = process.env.DEPLOY_USER || "root";
const password = process.env.DEPLOY_PASSWORD;

if (!host || !password) {
  throw new Error("DEPLOY_HOST and DEPLOY_PASSWORD are required");
}

const command = `
set -e
echo "== os =="
cat /etc/os-release | head -n 5 || true
echo "== bt panel =="
test -d /www/server/panel && echo "found:/www/server/panel" || echo "not-found"
echo "== ports =="
ss -lntp | grep -E ':(80|443|3000|3306) ' || true
echo "== nginx =="
command -v nginx || true
test -x /www/server/nginx/sbin/nginx && /www/server/nginx/sbin/nginx -v 2>&1 || true
nginx -v 2>&1 || true
echo "== mysql =="
command -v mysql || true
test -x /www/server/mysql/bin/mysql && /www/server/mysql/bin/mysql --version || true
mysql --version || true
echo "== node =="
command -v node || true
node -v || true
echo "== pm2 =="
command -v pm2 || true
pm2 -v || true
echo "== bt site dirs =="
ls -la /www/wwwroot 2>/dev/null || true
`;

const conn = new Client();
conn
  .on("ready", () => {
    conn.exec(command, (error, stream) => {
      if (error) throw error;
      stream.on("data", (data) => process.stdout.write(data));
      stream.stderr.on("data", (data) => process.stderr.write(data));
      stream.on("close", (code) => {
        conn.end();
        process.exit(code || 0);
      });
    });
  })
  .connect({ host, username, password, readyTimeout: 30000 });
