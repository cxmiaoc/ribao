const API_BASE = window.RIBAO_API_BASE || (window.location.port === "4173" ? "http://localhost:3000" : "");
const TOKEN_KEY = "hospital.ops.authToken.v1";

let authToken = localStorage.getItem(TOKEN_KEY) || "";
let guides = [];
let selectedGuide = null;
let editingGuideId = null;
let guideImages = [];
let savedEditorRange = null;

const refs = {
  loginOverlay: document.querySelector("#loginOverlay"),
  loginForm: document.querySelector("#loginForm"),
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#loginPassword"),
  loginError: document.querySelector("#loginError"),
  newGuideBtn: document.querySelector("#newGuideBtn"),
  listView: document.querySelector("#listView"),
  detailView: document.querySelector("#detailView"),
  editorView: document.querySelector("#editorView"),
  guideSearchForm: document.querySelector("#guideSearchForm"),
  guideSearchText: document.querySelector("#guideSearchText"),
  clearGuideSearchBtn: document.querySelector("#clearGuideSearchBtn"),
  guideListTitle: document.querySelector("#guideListTitle"),
  guideCount: document.querySelector("#guideCount"),
  guideList: document.querySelector("#guideList"),
  guideEmptyState: document.querySelector("#guideEmptyState"),
  backToListBtn: document.querySelector("#backToListBtn"),
  editGuideBtn: document.querySelector("#editGuideBtn"),
  deleteGuideBtn: document.querySelector("#deleteGuideBtn"),
  guideArticle: document.querySelector("#guideArticle"),
  cancelEditBtn: document.querySelector("#cancelEditBtn"),
  guideState: document.querySelector("#guideState"),
  guideForm: document.querySelector("#guideForm"),
  guideFormTitle: document.querySelector("#guideFormTitle"),
  guideKeyword: document.querySelector("#guideKeyword"),
  guideEditor: document.querySelector("#guideEditor"),
  insertImageBtn: document.querySelector("#insertImageBtn"),
  guideImageInput: document.querySelector("#guideImageInput"),
  saveGuideBtn: document.querySelector("#saveGuideBtn"),
  clearGuideBtn: document.querySelector("#clearGuideBtn"),
  toolbarButtons: document.querySelectorAll("[data-command]"),
};

init();

async function init() {
  bindEvents();
  setupBackButton();
  await loadGuides();
}

function bindEvents() {
  refs.loginForm.addEventListener("submit", handleLogin);
  refs.newGuideBtn.addEventListener("click", () => openEditor());
  refs.guideSearchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadGuides();
    showList();
  });
  refs.clearGuideSearchBtn.addEventListener("click", async () => {
    refs.guideSearchText.value = "";
    await loadGuides();
    showList();
  });
  refs.backToListBtn.addEventListener("click", showList);
  refs.cancelEditBtn.addEventListener("click", showList);
  refs.editGuideBtn.addEventListener("click", () => {
    if (selectedGuide) openEditor(selectedGuide);
  });
  refs.deleteGuideBtn.addEventListener("click", deleteSelectedGuide);
  refs.guideForm.addEventListener("submit", saveGuide);
  refs.clearGuideBtn.addEventListener("click", () => openEditor());
  refs.insertImageBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    saveEditorSelection();
  });
  refs.insertImageBtn.addEventListener("click", () => {
    restoreEditorSelection();
    refs.guideImageInput.click();
  });
  refs.guideImageInput.addEventListener("change", handleImages);
  refs.toolbarButtons.forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      restoreEditorSelection();
    });
    button.addEventListener("click", () => runEditorCommand(button.dataset.command));
  });
  ["keyup", "mouseup", "focus", "input"].forEach((eventName) => {
    refs.guideEditor.addEventListener(eventName, saveEditorSelection);
  });
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === refs.guideEditor || refs.guideEditor.contains(document.getSelection()?.anchorNode)) {
      saveEditorSelection();
    }
  });
  refs.guideEditor.addEventListener("paste", handlePaste);
}

function setupBackButton() {
  const appPlugin = window.Capacitor?.Plugins?.App;
  if (!appPlugin?.addListener) return;

  appPlugin.addListener("backButton", () => {
    if (!refs.loginOverlay.hidden) {
      appPlugin.exitApp();
      return;
    }
    if (!refs.listView.hidden) {
      appPlugin.exitApp();
      return;
    }
    showList();
  });
}

async function loadGuides() {
  const search = refs.guideSearchText.value.trim();
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  try {
    const data = await apiRequest(`/api/guides${query}`);
    guides = data.guides || [];
    refs.guideEmptyState.textContent = "";
    renderGuideList(search);
  } catch (error) {
    guides = [];
    refs.guideEmptyState.textContent = `无法读取处理库：${error.message}`;
    renderGuideList(search);
  }
}

function renderGuideList(search = refs.guideSearchText.value.trim()) {
  refs.guideList.innerHTML = "";
  refs.guideListTitle.textContent = search ? `全文搜索：${search}` : "全部文章";
  refs.guideCount.textContent = `${guides.length} 篇`;
  refs.guideEmptyState.classList.toggle("show", guides.length === 0);
  if (guides.length === 0 && !refs.guideEmptyState.textContent.startsWith("无法读取处理库")) {
    refs.guideEmptyState.textContent = search ? "没有找到匹配的文章。" : "还没有发布文章。";
  }

  guides.forEach((guide) => {
    const images = normalizeImages(guide.images);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "blog-post-card";
    button.addEventListener("click", () => openDetail(guide));
    button.innerHTML = `
      <div class="post-card-main">
        <p class="post-date">${escapeHtml(formatDateTime(guide.updatedAt || guide.createdAt))}</p>
        <h2>${escapeHtml(guide.keyword)}</h2>
        <p class="post-excerpt">${escapeHtml(makeExcerpt(extractText(guide.steps || guide.fault)))}</p>
        <div class="post-tags">
          <span>博客文章</span>
          ${images.length ? `<span>${images.length} 张图片</span>` : ""}
        </div>
      </div>
      ${renderPostThumb(images)}
    `;
    refs.guideList.appendChild(button);
  });
}

function openDetail(guide) {
  selectedGuide = guide;
  const images = normalizeImages(guide.images);
  refs.guideArticle.innerHTML = `
    <header class="article-header">
      <p class="post-date">${escapeHtml(formatDateTime(guide.updatedAt || guide.createdAt))}</p>
      <h2>${escapeHtml(guide.keyword)}</h2>
    </header>
    <section class="article-content">
      ${hydrateArticleHtml(guide.steps || guide.fault || "", images)}
    </section>
  `;
  showDetail();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openEditor(guide = null) {
  editingGuideId = guide?.id || null;
  guideImages = normalizeImages(guide?.images);
  refs.guideForm.reset();
  refs.guideKeyword.value = guide?.keyword || "";
  refs.guideEditor.innerHTML = guide ? hydrateEditorHtml(guide.steps || guide.fault || "", guideImages) : "<p><br></p>";
  refs.guideFormTitle.textContent = guide ? "编辑文章" : "发布文章";
  refs.saveGuideBtn.textContent = guide ? "更新文章" : "发布文章";
  refs.guideState.textContent = guide ? "编辑中" : "新文章";
  showEditor();
  window.scrollTo({ top: 0, behavior: "smooth" });
  refs.guideEditor.focus();
  saveEditorSelection();
}

async function saveGuide(event) {
  event.preventDefault();
  const html = serializeEditorHtml();
  if (!extractText(html) && guideImages.length === 0) {
    window.alert("请先填写文章内容或插入图片。");
    return;
  }

  const usedImageIds = findImageIds(html);
  const payload = {
    keyword: refs.guideKeyword.value.trim(),
    fault: "",
    steps: html,
    images: guideImages.filter((image) => usedImageIds.has(image.id)),
  };

  try {
    const saved = editingGuideId
      ? await apiRequest(`/api/guides/${editingGuideId}`, { method: "PUT", body: payload })
      : await apiRequest("/api/guides", { method: "POST", body: payload });

    pulseGuideState("已保存");
    refs.guideSearchText.value = "";
    await loadGuides();
    selectedGuide = guides.find((guide) => guide.id === saved.id) || saved;
    openDetail(selectedGuide);
  } catch (error) {
    pulseGuideState("保存失败");
    window.alert(`发布失败：${error.message}`);
  }
}

async function deleteSelectedGuide() {
  if (!selectedGuide) return;
  if (!window.confirm(`确定删除“${selectedGuide.keyword}”吗？`)) return;
  await apiRequest(`/api/guides/${selectedGuide.id}`, { method: "DELETE" });
  selectedGuide = null;
  await loadGuides();
  showList();
}

function runEditorCommand(command) {
  refs.guideEditor.focus();
  if (command === "h2") {
    document.execCommand("formatBlock", false, "h2");
  } else if (command === "bold") {
    document.execCommand("bold");
  } else if (command === "ul") {
    document.execCommand("insertUnorderedList");
  } else if (command === "ol") {
    document.execCommand("insertOrderedList");
  }
}

async function handleImages(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;
  restoreEditorSelection();

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const image = await compressImage(file);
    guideImages.push(image);
    insertHtmlAtCursor(renderEditableImage(image));
  }
  event.target.value = "";
}

function handlePaste(event) {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return;
  event.preventDefault();
  document.execCommand("insertText", false, text);
}

function serializeEditorHtml() {
  const clone = refs.guideEditor.cloneNode(true);
  clone.querySelectorAll("img").forEach((img) => {
    const id = img.dataset.imageId;
    if (!id) {
      img.remove();
      return;
    }
    img.removeAttribute("src");
    img.setAttribute("data-image-id", id);
  });
  clone.querySelectorAll("[style]").forEach((node) => node.removeAttribute("style"));
  return sanitizeArticleHtml(clone.innerHTML);
}

function hydrateEditorHtml(html, images) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = sanitizeArticleHtml(html);
  let fallbackIndex = 0;
  wrapper.querySelectorAll("img[data-image-id]").forEach((img) => {
    const image = images.find((item) => item.id === img.dataset.imageId) || images[fallbackIndex];
    fallbackIndex += 1;
    if (image) {
      img.dataset.imageId = image.id;
      img.src = image.data;
    }
  });
  return wrapper.innerHTML || "<p><br></p>";
}

function hydrateArticleHtml(html, images) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = sanitizeArticleHtml(html);
  let fallbackIndex = 0;
  wrapper.querySelectorAll("img[data-image-id]").forEach((img) => {
    const image = images.find((item) => item.id === img.dataset.imageId) || images[fallbackIndex];
    fallbackIndex += 1;
    if (image) {
      img.dataset.imageId = image.id;
      img.src = image.data;
      img.alt = image.name || "文章图片";
    } else {
      img.remove();
    }
  });
  return wrapper.innerHTML || "<p></p>";
}

function sanitizeArticleHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const allowedTags = new Set(["P", "BR", "H2", "H3", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "PRE", "CODE", "IMG"]);

  template.content.querySelectorAll("*").forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }

    [...node.attributes].forEach((attribute) => {
      if (node.tagName === "IMG" && attribute.name === "data-image-id") return;
      if (node.tagName === "IMG" && attribute.name === "alt") return;
      node.removeAttribute(attribute.name);
    });
  });

  return template.innerHTML.trim();
}

function renderEditableImage(image) {
  return `<p><img data-image-id="${escapeAttribute(image.id)}" src="${escapeAttribute(image.data)}" alt="${escapeAttribute(image.name || "文章图片")}" /></p><p><br></p>`;
}

function renderPostThumb(images) {
  const image = images[0];
  if (!image) return "";
  return `<div class="post-thumb"><img src="${escapeAttribute(image.data)}" alt="${escapeAttribute(image.name || "文章图片")}" /></div>`;
}

function insertHtmlAtCursor(html) {
  const range = getEditorRange();
  range.deleteContents();
  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    const nextRange = document.createRange();
    nextRange.setStartAfter(lastNode);
    nextRange.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(nextRange);
    savedEditorRange = nextRange.cloneRange();
  }
  saveEditorSelection();
}

function saveEditorSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!refs.guideEditor.contains(range.commonAncestorContainer)) return;
  savedEditorRange = range.cloneRange();
}

function restoreEditorSelection() {
  refs.guideEditor.focus();
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  if (savedEditorRange && refs.guideEditor.contains(savedEditorRange.commonAncestorContainer)) {
    selection.addRange(savedEditorRange);
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(refs.guideEditor);
  range.collapse(false);
  selection.addRange(range);
  savedEditorRange = range.cloneRange();
}

function getEditorRange() {
  refs.guideEditor.focus();
  if (savedEditorRange && refs.guideEditor.contains(savedEditorRange.commonAncestorContainer)) {
    return savedEditorRange.cloneRange();
  }
  const range = document.createRange();
  range.selectNodeContents(refs.guideEditor);
  range.collapse(false);
  savedEditorRange = range.cloneRange();
  return range;
}

function findImageIds(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  return new Set([...wrapper.querySelectorAll("img[data-image-id]")].map((img) => img.dataset.imageId));
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("图片处理失败"));
      image.onload = () => {
        const maxSize = 1280;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({
          id: createImageId(),
          name: file.name,
          type: "image/jpeg",
          data: canvas.toDataURL("image/jpeg", 0.78),
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images.map((image, index) => ({
    id: image?.id || `legacy-${index}`,
    name: image?.name || "文章图片",
    type: image?.type || "image/jpeg",
    data: image?.data || "",
  }));
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

async function handleLogin(event) {
  event.preventDefault();
  refs.loginError.textContent = "";
  const loggedIn = await loginWithPassword(refs.loginUsername.value.trim(), refs.loginPassword.value);
  if (loggedIn) {
    hideLogin();
    await loadGuides();
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

function showList() {
  refs.listView.hidden = false;
  refs.detailView.hidden = true;
  refs.editorView.hidden = true;
}

function showDetail() {
  refs.listView.hidden = true;
  refs.detailView.hidden = false;
  refs.editorView.hidden = true;
}

function showEditor() {
  refs.listView.hidden = true;
  refs.detailView.hidden = true;
  refs.editorView.hidden = false;
}

function pulseGuideState(text) {
  refs.guideState.textContent = text;
  window.clearTimeout(pulseGuideState.timer);
  pulseGuideState.timer = window.setTimeout(() => {
    refs.guideState.textContent = editingGuideId ? "编辑中" : "新文章";
  }, 1300);
}

function makeExcerpt(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function extractText(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = sanitizeArticleHtml(html);
  return wrapper.textContent.trim();
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createImageId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
