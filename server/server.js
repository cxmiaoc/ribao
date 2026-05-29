import compression from "compression";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import mysql from "mysql2/promise";
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "www");
const downloadsDir = path.join(rootDir, "downloads");
const port = Number(process.env.PORT || 3000);
const appSecret = process.env.APP_SECRET || randomBytes(32).toString("hex");
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "ribao",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ribao",
  timezone: "+08:00",
  waitForConnections: true,
  connectionLimit: 10,
});

const app = express();

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "80mb" }));

app.use(express.static(publicDir, {
  etag: false,
  maxAge: 0,
  setHeaders(response) {
    response.setHeader("Cache-Control", "no-store");
  },
}));

app.use("/downloads", express.static(downloadsDir, {
  etag: false,
  maxAge: 0,
  setHeaders(response) {
    response.setHeader("Cache-Control", "no-store");
  },
}));

app.get("/api/health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ ok: true, time: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/login", async (request, response, next) => {
  try {
    const username = normalizeUsername(request.body?.username);
    const password = String(request.body?.password || "");
    const user = await findUserByUsername(username);

    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      response.status(401).json({ error: "账号或密码不正确" });
      return;
    }

    response.json({
      token: signToken({
        type: "user",
        sub: user.id,
        username: user.username,
        exp: Date.now() + 365 * 24 * 60 * 60 * 1000,
      }),
      user: { id: user.id, username: user.username },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/login", (request, response) => {
  const username = String(request.body?.username || "");
  const password = String(request.body?.password || "");
  if (!safeEqual(username, adminUsername) || !safeEqual(password, adminPassword)) {
    response.status(401).json({ error: "管理员账号或密码不正确" });
    return;
  }
  response.json({
    token: signToken({
      type: "admin",
      exp: Date.now() + 2 * 60 * 60 * 1000,
    }),
  });
});

app.get("/api/admin/users", requireAdmin, async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, username, created_at AS createdAt FROM ops_users ORDER BY created_at ASC",
    );
    response.json({ users: rows.map(toUser) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users", requireAdmin, async (request, response, next) => {
  try {
    const username = normalizeUsername(request.body?.username);
    const password = normalizePassword(request.body?.password);
    const { salt, hash } = hashPassword(password);
    const id = randomUUID();
    await pool.execute(
      "INSERT INTO ops_users (id, username, password_salt, password_hash) VALUES (?, ?, ?, ?)",
      [id, username, salt, hash],
    );
    const user = await findUserByUsername(username);
    response.status(201).json({ user: toUser(user) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      response.status(409).json({ error: "账号已存在" });
      return;
    }
    next(error);
  }
});

app.delete("/api/admin/users/:id", requireAdmin, async (request, response, next) => {
  try {
    const [[countRow]] = await pool.execute("SELECT COUNT(*) AS count FROM ops_users");
    if (countRow.count <= 1) {
      response.status(400).json({ error: "至少保留一个登录账号" });
      return;
    }
    const [result] = await pool.execute("DELETE FROM ops_users WHERE id = ?", [request.params.id]);
    if (result.affectedRows === 0) {
      response.status(404).json({ error: "账号不存在" });
      return;
    }
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/app-version", (request, response) => {
  const current = String(request.query.current || "0");
  const latestVersion = process.env.LATEST_ANDROID_VERSION || "2.0.0";
  const downloadUrl = process.env.APK_DOWNLOAD_URL || "https://xxx/downloads/hospital-ops.apk";
  response.json({
    latestVersion,
    downloadUrl,
    hasUpdate: compareVersions(latestVersion, current) > 0,
  });
});

app.use("/api/guides", requireUser);

app.get("/api/guides", async (request, response, next) => {
  try {
    const search = String(request.query.search || "").trim();
    const like = `%${search}%`;
    const [rows] = await pool.execute(
      `SELECT id, keyword, fault, steps, images,
              created_at AS createdAt, updated_at AS updatedAt
         FROM ops_fault_guides
        WHERE user_id = ?
          AND (? = '' OR keyword LIKE ? OR fault LIKE ? OR steps LIKE ?)
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 100`,
      [request.user.sub, search, like, like, like],
    );
    response.json({ guides: rows.map(toGuide) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/guides", async (request, response, next) => {
  try {
    const guide = validateGuide(request.body);
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO ops_fault_guides (id, user_id, keyword, fault, steps, images)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, request.user.sub, guide.keyword, guide.fault, guide.steps, JSON.stringify(guide.images)],
    );
    response.status(201).json(await findGuide(id, request.user.sub));
  } catch (error) {
    next(error);
  }
});

app.put("/api/guides/:id", async (request, response, next) => {
  try {
    const guide = validateGuide(request.body);
    const [result] = await pool.execute(
      `UPDATE ops_fault_guides
          SET keyword = ?, fault = ?, steps = ?, images = ?
        WHERE id = ? AND user_id = ?`,
      [
        guide.keyword,
        guide.fault,
        guide.steps,
        JSON.stringify(guide.images),
        request.params.id,
        request.user.sub,
      ],
    );
    if (result.affectedRows === 0) {
      response.status(404).json({ error: "处理方法不存在" });
      return;
    }
    response.json(await findGuide(request.params.id, request.user.sub));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/guides/:id", async (request, response, next) => {
  try {
    const [result] = await pool.execute(
      "DELETE FROM ops_fault_guides WHERE id = ? AND user_id = ?",
      [request.params.id, request.user.sub],
    );
    if (result.affectedRows === 0) {
      response.status(404).json({ error: "处理方法不存在" });
      return;
    }
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/records/export.xls", requireExportUser, async (request, response, next) => {
  try {
    const rows = await findAllRecords(request.user.sub);
    const filename = `医院运维日报-${today()}.xls`;
    response.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    response.send(`\ufeff${buildRecordsExcel(rows)}`);
  } catch (error) {
    next(error);
  }
});

app.use("/api/records", requireUser);

app.get("/api/records", async (request, response, next) => {
  try {
    const scope = String(request.query.scope || "").trim();
    if (scope === "all") {
      const rows = await findAllRecords(request.user.sub);
      response.json({ records: rows.map(toRecord) });
      return;
    }

    const date = normalizeOptionalDate(request.query.date) || today();
    const [rows] = await pool.execute(
      `SELECT id, record_date AS date, location, fault, solution,
              created_at AS createdAt, updated_at AS updatedAt
         FROM ops_records
        WHERE record_date = ? AND user_id = ?
        ORDER BY created_at ASC, id ASC`,
      [date, request.user.sub],
    );

    const [[selectedCount]] = await pool.execute(
      "SELECT COUNT(*) AS count FROM ops_records WHERE record_date = ? AND user_id = ?",
      [date, request.user.sub],
    );
    const [[todayCount]] = await pool.execute(
      "SELECT COUNT(*) AS count FROM ops_records WHERE record_date = CURDATE() AND user_id = ?",
      [request.user.sub],
    );
    const [[totalCount]] = await pool.execute(
      "SELECT COUNT(*) AS count FROM ops_records WHERE user_id = ?",
      [request.user.sub],
    );

    response.json({
      records: rows.map(toRecord),
      stats: {
        selectedCount: selectedCount.count,
        todayCount: todayCount.count,
        totalCount: totalCount.count,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/records", async (request, response, next) => {
  try {
    const record = validateRecord(request.body);
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO ops_records (id, user_id, record_date, location, fault, solution)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, request.user.sub, record.date, record.location, record.fault, record.solution],
    );
    response.status(201).json(await findRecord(id, request.user.sub));
  } catch (error) {
    next(error);
  }
});

app.put("/api/records/:id", async (request, response, next) => {
  try {
    const record = validateRecord(request.body);
    const [result] = await pool.execute(
      `UPDATE ops_records
          SET record_date = ?, location = ?, fault = ?, solution = ?
        WHERE id = ? AND user_id = ?`,
      [record.date, record.location, record.fault, record.solution, request.params.id, request.user.sub],
    );

    if (result.affectedRows === 0) {
      response.status(404).json({ error: "记录不存在" });
      return;
    }

    const updated = await findRecord(request.params.id, request.user.sub);
    if (!updated) {
      response.status(404).json({ error: "记录不存在" });
      return;
    }
    response.json(updated);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/records/:id", async (request, response, next) => {
  try {
    const [result] = await pool.execute(
      "DELETE FROM ops_records WHERE id = ? AND user_id = ?",
      [request.params.id, request.user.sub],
    );
    if (result.affectedRows === 0) {
      response.status(404).json({ error: "记录不存在" });
      return;
    }
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _request, response, _next) => {
  const status = error.status || 500;
  response.status(status).json({ error: status === 500 ? "服务器错误" : error.message });
});

await ensureDatabase();

app.listen(port, () => {
  console.log(`医院运维日报服务已启动：http://127.0.0.1:${port}`);
});

async function ensureDatabase() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ops_fault_guides (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      keyword VARCHAR(255) NOT NULL,
      fault TEXT NOT NULL,
      steps MEDIUMTEXT NOT NULL,
      images LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_updated (user_id, updated_at),
      INDEX idx_user_keyword (user_id, keyword)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute("ALTER TABLE ops_fault_guides MODIFY images LONGTEXT NULL").catch(() => {});
}

async function findRecord(id, userId) {
  const [rows] = await pool.execute(
    `SELECT id, record_date AS date, location, fault, solution,
            created_at AS createdAt, updated_at AS updatedAt
       FROM ops_records
      WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

async function findAllRecords(userId) {
  const [rows] = await pool.execute(
    `SELECT id, record_date AS date, location, fault, solution,
            created_at AS createdAt, updated_at AS updatedAt
       FROM ops_records
      WHERE user_id = ?
      ORDER BY record_date ASC, created_at ASC, id ASC`,
    [userId],
  );
  return rows;
}

async function findGuide(id, userId) {
  const [rows] = await pool.execute(
    `SELECT id, keyword, fault, steps, images,
            created_at AS createdAt, updated_at AS updatedAt
       FROM ops_fault_guides
      WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return rows[0] ? toGuide(rows[0]) : null;
}

async function findUserByUsername(username) {
  const [rows] = await pool.execute(
    `SELECT id, username, password_salt AS passwordSalt, password_hash AS passwordHash,
            created_at AS createdAt
       FROM ops_users
      WHERE username = ?`,
    [username],
  );
  return rows[0] || null;
}

function validateRecord(input) {
  const date = normalizeDate(input?.date);
  const location = normalizeText(input?.location, "地点");
  const fault = normalizeText(input?.fault, "发生的故障");
  const solution = normalizeText(input?.solution, "如何解决");
  return { date, location, fault, solution };
}

function validateGuide(input) {
  const keyword = normalizeText(input?.keyword, "报错关键字", 120);
  const fault = normalizeOptionalText(input?.fault, 4000);
  const steps = normalizeText(input?.steps, "文章内容", 100000);
  const images = normalizeImages(input?.images);
  return { keyword, fault, steps, images };
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error("日期格式不正确");
    error.status = 400;
    throw error;
  }
  return text;
}

function normalizeOptionalDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return normalizeDate(text);
}

function normalizeText(value, fieldName, maxLength = 1000) {
  const text = String(value || "").trim();
  if (!text) {
    const error = new Error(`${fieldName}不能为空`);
    error.status = 400;
    throw error;
  }
  if (text.length > maxLength) {
    const error = new Error(`${fieldName}太长`);
    error.status = 400;
    throw error;
  }
  return text;
}

function normalizeOptionalText(value, maxLength = 1000) {
  const text = String(value || "").trim();
  if (text.length > maxLength) {
    const error = new Error("内容太长");
    error.status = 400;
    throw error;
  }
  return text;
}

function normalizeImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const id = String(item?.id || randomUUID()).slice(0, 80);
    const name = String(item?.name || "处理图片").slice(0, 120);
    const type = String(item?.type || "image/jpeg").slice(0, 40);
    const stage = item?.stage === "fault" ? "fault" : "process";
    const data = String(item?.data || "");
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(data)) {
      const error = new Error("图片格式不正确");
      error.status = 400;
      throw error;
    }
    if (data.length > 1500 * 1024) {
      const error = new Error("单张图片太大，请重新选择较小图片");
      error.status = 400;
      throw error;
    }
    return { id, name, type, stage, data };
  });
}

function normalizeUsername(value) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(text)) {
    const error = new Error("账号需为2到32位字母、数字、点、横线或下划线");
    error.status = 400;
    throw error;
  }
  return text;
}

function normalizePassword(value) {
  const text = String(value || "");
  if (text.length < 4 || text.length > 64) {
    const error = new Error("密码长度需为4到64位");
    error.status = 400;
    throw error;
  }
  return text;
}

function toRecord(row) {
  return {
    id: row.id,
    date: formatMysqlDate(row.date),
    location: row.location,
    fault: row.fault,
    solution: row.solution,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function buildRecordsExcel(rows) {
  const body = rows.map((row, index) => {
    const record = toRecord(row);
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(formatExcelDate(record.date))}</td>
        <td>${escapeHtml(record.location)}</td>
        <td>${escapeHtml(record.fault)}</td>
        <td>${escapeHtml(record.solution)}</td>
        <td>${escapeHtml(formatExcelTime(record.createdAt))}</td>
      </tr>`;
  }).join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #9fb8b2; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #dff0ec; font-weight: 700; }
    </style>
  </head>
  <body>
    <table>
      <thead>
        <tr>
          <th>序号</th>
          <th>日期</th>
          <th>地点</th>
          <th>发生的故障</th>
          <th>如何解决</th>
          <th>记录时间</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </body>
</html>`;
}

function formatExcelDate(value) {
  return String(value || "").replaceAll("-", "/");
}

function formatExcelTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toGuide(row) {
  return {
    id: row.id,
    keyword: row.keyword,
    fault: row.fault,
    steps: row.steps,
    images: parseImages(row.images),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function parseImages(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function formatMysqlDate(value) {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function requireUser(request, response, next) {
  const payload = readToken(request);
  if (!payload || payload.type !== "user") {
    response.status(401).json({ error: "请先登录" });
    return;
  }
  request.user = payload;
  next();
}

function requireExportUser(request, response, next) {
  const payload = readToken(request, { allowQuery: true });
  if (!payload || payload.type !== "user") {
    response.status(401).send("请先登录后再导出");
    return;
  }
  request.user = payload;
  next();
}

function requireAdmin(request, response, next) {
  const payload = readToken(request);
  if (!payload || payload.type !== "admin") {
    response.status(401).json({ error: "请先登录管理员" });
    return;
  }
  next();
}

function readToken(request, options = {}) {
  const header = String(request.headers.authorization || "");
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : options.allowQuery
      ? String(request.query.token || "")
      : "";
  return verifyToken(token);
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", appSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyToken(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", appSecret).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (Number(payload.exp || 0) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

function verifyPassword(password, salt, hash) {
  const left = Buffer.from(scryptSync(String(password || ""), salt, 64).toString("hex"));
  const right = Buffer.from(String(hash || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function compareVersions(a, b) {
  const left = String(a || "0").split(".").map(Number);
  const right = String(b || "0").split(".").map(Number);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
