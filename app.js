const API_BASE = window.RIBAO_API_BASE || (window.location.port === "4173" ? "http://localhost:3000" : "");
const TOKEN_KEY = "hospital.ops.authToken.v1";

let records = [];
let stats = { selectedCount: 0, todayCount: 0, totalCount: 0 };
let editingId = null;
let authToken = localStorage.getItem(TOKEN_KEY) || "";
let adminToken = "";
let titleClickCount = 0;
let titleClickTimer = null;

const refs = {
  form: document.querySelector("#recordForm"),
  appTitle: document.querySelector("#appTitle"),
  loginOverlay: document.querySelector("#loginOverlay"),
  loginForm: document.querySelector("#loginForm"),
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#loginPassword"),
  loginError: document.querySelector("#loginError"),
  adminOverlay: document.querySelector("#adminOverlay"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminUsername: document.querySelector("#adminUsername"),
  adminPassword: document.querySelector("#adminPassword"),
  adminLoginError: document.querySelector("#adminLoginError"),
  adminPanel: document.querySelector("#adminPanel"),
  adminCloseBtn: document.querySelector("#adminCloseBtn"),
  addUserForm: document.querySelector("#addUserForm"),
  newUsername: document.querySelector("#newUsername"),
  newPassword: document.querySelector("#newPassword"),
  addUserError: document.querySelector("#addUserError"),
  userList: document.querySelector("#userList"),
  formTitle: document.querySelector("#formTitle"),
  recordDate: document.querySelector("#recordDate"),
  locationText: document.querySelector("#locationText"),
  faultText: document.querySelector("#faultText"),
  solutionText: document.querySelector("#solutionText"),
  saveBtn: document.querySelector("#saveBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  deleteBtn: document.querySelector("#deleteBtn"),
  newRecordBtn: document.querySelector("#newRecordBtn"),
  queryDate: document.querySelector("#queryDate"),
  todayBtn: document.querySelector("#todayBtn"),
  saveState: document.querySelector("#saveState"),
  selectedCount: document.querySelector("#selectedCount"),
  todayCount: document.querySelector("#todayCount"),
  totalCount: document.querySelector("#totalCount"),
  dayTitle: document.querySelector("#dayTitle"),
  dayCount: document.querySelector("#dayCount"),
  recordList: document.querySelector("#recordList"),
  emptyState: document.querySelector("#emptyState"),
  copyDayBtn: document.querySelector("#copyDayBtn"),
  checkUpdateBtn: document.querySelector("#checkUpdateBtn"),
};

init();

async function init() {
  refs.recordDate.value = today();
  refs.queryDate.value = today();
  bindEvents();
  setupBackButton();
  await render();
  checkAppUpdate(false);
}

function bindEvents() {
  refs.loginForm.addEventListener("submit", handleLogin);
  refs.adminLoginForm.addEventListener("submit", handleAdminLogin);
  refs.addUserForm.addEventListener("submit", handleAddUser);
  refs.adminCloseBtn.addEventListener("click", hideAdmin);
  refs.appTitle.addEventListener("click", handleTitleClick);
  refs.form.addEventListener("submit", saveRecord);
  refs.clearBtn.addEventListener("click", resetForm);
  refs.deleteBtn.addEventListener("click", deleteCurrentRecord);
  refs.newRecordBtn.addEventListener("click", () => {
    resetForm();
    refs.locationText.focus();
  });
  refs.queryDate.addEventListener("change", async () => {
    if (!editingId) refs.recordDate.value = refs.queryDate.value || today();
    await render();
  });
  refs.todayBtn.addEventListener("click", async () => {
    refs.queryDate.value = today();
    if (!editingId) refs.recordDate.value = today();
    await render();
  });
  refs.copyDayBtn.addEventListener("click", copyDayRecords);
  refs.checkUpdateBtn.addEventListener("click", () => checkAppUpdate(true));
}

function setupBackButton() {
  const appPlugin = window.Capacitor?.Plugins?.App;
  if (!appPlugin?.addListener) return;

  appPlugin.addListener("backButton", () => {
    if (!refs.adminOverlay.hidden) {
      hideAdmin();
      return;
    }
    if (!refs.loginOverlay.hidden) {
      appPlugin.exitApp();
      return;
    }
    appPlugin.exitApp();
  });
}

async function saveRecord(event) {
  event.preventDefault();
  const payload = {
    date: refs.recordDate.value || today(),
    location: refs.locationText.value.trim(),
    fault: refs.faultText.value.trim(),
    solution: refs.solutionText.value.trim(),
  };

  const saved = editingId
    ? await apiRequest(`/api/records/${editingId}`, { method: "PUT", body: payload })
    : await apiRequest("/api/records", { method: "POST", body: payload });

  editingId = saved.id;
  refs.queryDate.value = saved.date;
  pulseSaveState("已保存");
  loadRecordIntoForm(saved);
  await render();
}

async function deleteCurrentRecord() {
  if (!editingId) return;
  const record = findRecord(editingId);
  if (!record) return;
  if (!window.confirm(`确定删除 ${formatDate(record.date)} 的这条记录吗？`)) return;
  await apiRequest(`/api/records/${editingId}`, { method: "DELETE" });
  pulseSaveState("已删除");
  resetForm(false);
  await render();
}

function resetForm(shouldRender = true) {
  editingId = null;
  refs.form.reset();
  refs.recordDate.value = refs.queryDate.value || today();
  refs.formTitle.textContent = "新增记录";
  refs.saveBtn.textContent = "保存记录";
  refs.deleteBtn.hidden = true;
  if (shouldRender) renderList();
}

function loadRecordIntoForm(record) {
  editingId = record.id;
  refs.recordDate.value = record.date;
  refs.locationText.value = record.location;
  refs.faultText.value = record.fault;
  refs.solutionText.value = record.solution;
  refs.formTitle.textContent = "编辑记录";
  refs.saveBtn.textContent = "更新记录";
  refs.deleteBtn.hidden = false;
  renderList();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function render() {
  await loadDayData();
  renderStats();
  renderList();
}

async function loadDayData() {
  const date = refs.queryDate.value || today();
  try {
    const data = await apiRequest(`/api/records?date=${encodeURIComponent(date)}`);
    records = data.records || [];
    stats = data.stats || { selectedCount: records.length, todayCount: 0, totalCount: 0 };
    pulseSaveState("服务器同步");
  } catch (error) {
    records = [];
    stats = { selectedCount: 0, todayCount: 0, totalCount: 0 };
    refs.emptyState.textContent = `无法连接服务器：${error.message}`;
    pulseSaveState("连接失败");
  }
}

function renderStats() {
  const date = refs.queryDate.value || today();
  refs.selectedCount.textContent = stats.selectedCount ?? records.length;
  refs.todayCount.textContent = stats.todayCount ?? 0;
  refs.totalCount.textContent = stats.totalCount ?? 0;
  refs.dayTitle.textContent = date === today() ? "今天" : formatDate(date);
  refs.dayCount.textContent = `${records.length} 条`;
}

function renderList() {
  const dayRecords = [...records].sort((a, b) => {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  refs.recordList.innerHTML = "";
  refs.emptyState.classList.toggle("show", dayRecords.length === 0);
  if (dayRecords.length === 0 && !refs.emptyState.textContent.startsWith("无法连接服务器")) {
    refs.emptyState.textContent = "这个日期还没有记录。";
  }

  dayRecords.forEach((record, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `record-card${record.id === editingId ? " active" : ""}`;
    button.addEventListener("click", () => loadRecordIntoForm(record));
    button.innerHTML = `
      <div class="record-head">
        <span class="record-index">${index + 1}</span>
        <span class="record-time">${escapeHtml(formatTime(record.createdAt))}</span>
      </div>
      <p class="record-line">${escapeHtml(formatRecordLine(record, index))}</p>
    `;
    refs.recordList.appendChild(button);
  });
}

function findRecord(id) {
  return records.find((record) => String(record.id) === String(id));
}

async function copyDayRecords() {
  const dayRecords = [...records].sort((a, b) => {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  if (dayRecords.length === 0) {
    window.alert("这个日期还没有记录，暂时没有内容可复制。");
    return;
  }
  const text = dayRecords.map((record, index) => formatRecordLine(record, index)).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    pulseSaveState("已复制");
  } catch {
    copyWithFallback(text);
    pulseSaveState("已复制");
  }
}

function copyWithFallback(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function checkAppUpdate(manual = false) {
  try {
    const info = await getNativeAppInfo();
    const currentVersion = info?.version || null;
    if (!currentVersion) {
      if (manual) window.alert("当前是服务器网页版本，刷新页面即可获取最新功能。");
      return;
    }
    const update = await apiRequest(
      `/api/app-version${currentVersion ? `?current=${encodeURIComponent(currentVersion)}` : ""}`,
    );
    if (!update.hasUpdate) {
      if (manual) window.alert("当前已经是最新版本。");
      return;
    }
    if (window.confirm(`发现新版本 ${update.latestVersion}，是否下载更新？`)) {
      window.location.href = update.downloadUrl;
    }
  } catch (error) {
    if (manual) window.alert(`检查更新失败：${error.message}`);
  }
}

async function getNativeAppInfo() {
  const appPlugin = window.Capacitor?.Plugins?.App;
  if (!appPlugin?.getInfo) return null;
  return appPlugin.getInfo();
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("接口没有返回数据，请确认后端 http://localhost:3000 已启动");
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    authToken = "";
    localStorage.removeItem(TOKEN_KEY);
    const loggedIn = await promptLogin();
    if (loggedIn) return apiRequest(path, options);
  }
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function adminRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function handleLogin(event) {
  event.preventDefault();
  refs.loginError.textContent = "";
  const loggedIn = await loginWithPassword(refs.loginUsername.value.trim(), refs.loginPassword.value);
  if (loggedIn) {
    hideLogin();
    await render();
  }
}

function promptLogin() {
  showLogin();
  return new Promise((resolve) => {
    promptLogin.waiters = promptLogin.waiters || [];
    promptLogin.waiters.push(resolve);
  });
}

async function loginWithPassword(username, password) {
  const response = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    refs.loginError.textContent = data.error || "登录失败";
    return false;
  }
  authToken = data.token;
  localStorage.setItem(TOKEN_KEY, authToken);
  resolveLoginWaiters(true);
  return true;
}

function showLogin() {
  refs.loginOverlay.hidden = false;
  refs.loginUsername.value = refs.loginUsername.value || "admin";
  refs.loginPassword.value = "";
  refs.loginError.textContent = "";
  window.setTimeout(() => refs.loginPassword.focus(), 50);
}

function hideLogin() {
  refs.loginOverlay.hidden = true;
}

function resolveLoginWaiters(value) {
  const waiters = promptLogin.waiters || [];
  promptLogin.waiters = [];
  waiters.forEach((resolve) => resolve(value));
}

function handleTitleClick() {
  titleClickCount += 1;
  window.clearTimeout(titleClickTimer);
  titleClickTimer = window.setTimeout(() => {
    titleClickCount = 0;
  }, 900);
  if (titleClickCount >= 3) {
    titleClickCount = 0;
    showAdmin();
  }
}

function showAdmin() {
  refs.adminOverlay.hidden = false;
  refs.adminLoginForm.hidden = Boolean(adminToken);
  refs.adminPanel.hidden = !adminToken;
  refs.adminLoginError.textContent = "";
  refs.addUserError.textContent = "";
  if (adminToken) {
    loadUsers();
  } else {
    refs.adminUsername.value = "admin";
    refs.adminPassword.value = "";
    window.setTimeout(() => refs.adminPassword.focus(), 50);
  }
}

function hideAdmin() {
  refs.adminOverlay.hidden = true;
}

async function handleAdminLogin(event) {
  event.preventDefault();
  refs.adminLoginError.textContent = "";
  try {
    const response = await fetch(`${API_BASE}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        username: refs.adminUsername.value.trim(),
        password: refs.adminPassword.value,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "管理员登录失败");
    adminToken = data.token;
    refs.adminLoginForm.hidden = true;
    refs.adminPanel.hidden = false;
    await loadUsers();
  } catch (error) {
    refs.adminLoginError.textContent = error.message;
  }
}

async function handleAddUser(event) {
  event.preventDefault();
  refs.addUserError.textContent = "";
  try {
    await adminRequest("/api/admin/users", {
      method: "POST",
      body: {
        username: refs.newUsername.value.trim(),
        password: refs.newPassword.value,
      },
    });
    refs.addUserForm.reset();
    await loadUsers();
  } catch (error) {
    refs.addUserError.textContent = error.message;
  }
}

async function loadUsers() {
  const data = await adminRequest("/api/admin/users");
  refs.userList.innerHTML = "";
  data.users.forEach((user) => {
    const row = document.createElement("div");
    row.className = "user-row";
    row.innerHTML = `
      <span>${escapeHtml(user.username)}</span>
      <button type="button" class="danger-button small-button">删除</button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      if (!window.confirm(`确定删除账号 ${user.username} 吗？`)) return;
      try {
        await adminRequest(`/api/admin/users/${user.id}`, { method: "DELETE" });
        await loadUsers();
      } catch (error) {
        refs.addUserError.textContent = error.message;
      }
    });
    refs.userList.appendChild(row);
  });
}

function pulseSaveState(text) {
  refs.saveState.textContent = text;
  window.clearTimeout(pulseSaveState.timer);
  pulseSaveState.timer = window.setTimeout(() => {
    refs.saveState.textContent = "服务器保存";
  }, 1300);
}

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return "未选择日期";
  const [year, month, day] = value.split("-");
  return `${year}/${month}/${day}`;
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cleanCopyText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[，,]+/g, "，")
    .replace(/^-+|-+$/g, "")
    .trim();
}

function formatRecordLine(record, index) {
  const location = cleanCopyText(record.location);
  const fault = cleanCopyText(record.fault);
  const solution = cleanCopyText(record.solution);
  return `${index + 1}.${location}-${fault}-${solution}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
