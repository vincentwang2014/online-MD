const STORAGE_PREFIX = "elderCareDoctorApp";
const GUEST_USER = "guest";
const DEFAULT_OPENAI_PROMPT = [
  "你是 欧医生，面向老人和家属提供清楚、温和、谨慎的就医前建议。",
  "请先总结你理解到的症状，再给出可能方向、观察指标、就医建议和需要问医生的问题。",
  "回答尽量短句、少术语，默认使用简体中文。"
].join("\n");
const DEFAULT_GEMINI_PROMPT = [
  "你是 谷医生，擅长从另一个角度帮老人和家属梳理症状、风险和下一步行动。",
  "请补充 欧医生可能遗漏的观察点，但不要制造恐慌。",
  "回答尽量实用、分点、默认使用简体中文。"
].join("\n");
const WELCOME_MESSAGE = {
  type: "bot",
  name: "问医生助手",
  text: "您好。请说说哪里不舒服、持续多久、年龄和已有疾病。也可以拍照上传药盒、化验单或皮肤/伤口照片。",
  quickActions: true
};
const DOCTORS = {
  openai: { name: "欧医生", other: "gemini" },
  gemini: { name: "谷医生", other: "openai" }
};

const chatLog = document.querySelector("#chatLog");
const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const imageInput = document.querySelector("#imageInput");
const imagePreview = document.querySelector("#imagePreview");
const imagePreviewImg = imagePreview.querySelector("img");
const imageName = document.querySelector("#imageName");
const imageSize = document.querySelector("#imageSize");
const removeImage = document.querySelector("#removeImage");
const providerButtons = [...document.querySelectorAll(".provider-option")];
const loginButton = document.querySelector("#loginButton");
const loginDialog = document.querySelector("#loginDialog");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginError = document.querySelector("#loginError");
const loginSubmitButton = document.querySelector("#loginSubmitButton");
const logoutButton = document.querySelector("#logoutButton");
const accountName = document.querySelector("#accountName");
const accountHint = document.querySelector("#accountHint");
const newChatButton = document.querySelector("#newChatButton");
const historyPanel = document.querySelector("#historyPanel");
const historyList = document.querySelector("#historyList");
const clearHistoryButton = document.querySelector("#clearHistoryButton");
const settingsButton = document.querySelector("#settingsButton");
const settingsPanel = document.querySelector("#settingsPanel");
const closeSettingsButton = document.querySelector("#closeSettingsButton");
const openaiPrompt = document.querySelector("#openaiPrompt");
const geminiPrompt = document.querySelector("#geminiPrompt");
const savePromptsButton = document.querySelector("#savePromptsButton");
const resetPromptsButton = document.querySelector("#resetPromptsButton");
const addUserForm = document.querySelector("#addUserForm");
const newUsernameInput = document.querySelector("#newUsernameInput");
const newPasswordInput = document.querySelector("#newPasswordInput");
const newRoleInput = document.querySelector("#newRoleInput");
const userList = document.querySelector("#userList");

let selectedProvider = "both";
let selectedImage = null;
let auth = loadAuth();
let currentUser = auth?.user?.username || GUEST_USER;
let currentChatId = loadCurrentChatId();
let messages = [];

boot();

function boot() {
  hydrateChat();
  renderAccount();
  renderChat();
  renderHistory();
  bindEvents();
}

function bindEvents() {
  providerButtons.forEach(button => {
    button.addEventListener("click", () => {
      providerButtons.forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      selectedProvider = button.dataset.provider;
      maybeOfferProviderForLastQuestion(selectedProvider);
    });
  });

  loginButton.addEventListener("click", () => {
    usernameInput.value = currentUser === GUEST_USER ? "" : currentUser;
    passwordInput.value = "";
    loginError.textContent = "";
    loginDialog.showModal();
    usernameInput.focus();
  });

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (event.submitter?.value !== "login") {
      loginDialog.close();
      return;
    }
    await login();
  });

  logoutButton.addEventListener("click", () => {
    saveCurrentSession();
    auth = null;
    currentUser = GUEST_USER;
    currentChatId = null;
    localStorage.removeItem(authKey());
    saveCurrentChatId();
    hydrateChat();
    renderAccount();
    renderChat();
    renderHistory();
    loginDialog.close();
  });

  newChatButton.addEventListener("click", () => {
    saveCurrentSession();
    currentChatId = createChatId();
    messages = [WELCOME_MESSAGE];
    saveCurrentChatId();
    saveCurrentSession();
    renderChat();
    renderHistory();
    messageInput.focus();
  });

  clearHistoryButton.addEventListener("click", () => {
    if (currentUser === GUEST_USER) return;
    localStorage.removeItem(historyKey());
    currentChatId = null;
    saveCurrentChatId();
    hydrateChat();
    renderChat();
    renderHistory();
  });

  settingsButton.addEventListener("click", async () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    if (!settingsPanel.hidden) {
      await loadAdminSettings();
      openaiPrompt.focus();
    }
  });
  closeSettingsButton.addEventListener("click", () => {
    settingsPanel.hidden = true;
  });
  savePromptsButton.addEventListener("click", savePrompts);
  resetPromptsButton.addEventListener("click", () => {
    openaiPrompt.value = DEFAULT_OPENAI_PROMPT;
    geminiPrompt.value = DEFAULT_GEMINI_PROMPT;
  });
  addUserForm.addEventListener("submit", addUser);

  imageInput.addEventListener("change", handleImageSelect);
  removeImage.addEventListener("click", clearSelectedImage);
  messageInput.addEventListener("input", resizeTextarea);
  messageInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });
  chatForm.addEventListener("submit", handleSubmit);
}

async function login() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    loginError.textContent = "请输入用户名和密码。";
    passwordInput.focus();
    return;
  }

  loginError.textContent = "";
  loginSubmitButton.disabled = true;
  loginSubmitButton.textContent = "登录中...";

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json();
  if (!response.ok) {
    loginError.textContent = data.error || "登录失败。";
    loginSubmitButton.disabled = false;
    loginSubmitButton.textContent = "登录";
    return;
  }

  saveCurrentSession();
  auth = data;
  currentUser = data.user.username;
  currentChatId = loadCurrentChatId();
  localStorage.setItem(authKey(), JSON.stringify(auth));
  hydrateChat();
  renderAccount();
  renderChat();
  renderHistory();
  loginDialog.close();
  loginSubmitButton.disabled = false;
  loginSubmitButton.textContent = "登录";
}

async function loadAdminSettings() {
  if (!isAdmin()) return;
  const [promptsResponse, usersResponse] = await Promise.all([
    fetch("/api/prompts", { headers: authHeaders() }),
    fetch("/api/users", { headers: authHeaders() })
  ]);
  const promptsData = await promptsResponse.json();
  const usersData = await usersResponse.json();

  if (promptsResponse.ok) {
    openaiPrompt.value = promptsData.prompts.openai;
    geminiPrompt.value = promptsData.prompts.gemini;
  }
  if (usersResponse.ok) renderUsers(usersData.users || []);
}

async function savePrompts() {
  if (!isAdmin()) return;
  const response = await fetch("/api/prompts", {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({
      prompts: {
        openai: openaiPrompt.value,
        gemini: geminiPrompt.value
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    addBotMessage("问医生助手", data.error || "保存失败。");
    return;
  }
  addBotMessage("问医生助手", "医生提示词已保存，下一条问题会使用新的设置。");
  settingsPanel.hidden = true;
}

async function addUser(event) {
  event.preventDefault();
  if (!isAdmin()) return;

  const response = await fetch("/api/users", {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({
      username: newUsernameInput.value.trim(),
      password: newPasswordInput.value,
      role: newRoleInput.value
    })
  });
  const data = await response.json();
  if (!response.ok) {
    addBotMessage("问医生助手", data.error || "添加用户失败。");
    return;
  }

  newUsernameInput.value = "";
  newPasswordInput.value = "";
  newRoleInput.value = "user";
  await loadAdminSettings();
  addBotMessage("问医生助手", `已添加用户：${data.user.username}`);
}

async function handleSubmit(event) {
  event.preventDefault();

  const message = messageInput.value.trim();
  if (!message && !selectedImage) {
    messageInput.focus();
    return;
  }

  const imageForRequest = selectedImage;
  const questionText = message || "请帮我看看这张图片。";
  addUserMessage(questionText, imageForRequest?.dataUrl);
  messageInput.value = "";
  clearSelectedImage();
  resizeTextarea();

  await sendQuestionToDoctors({
    message: questionText,
    image: imageForRequest,
    provider: selectedProvider,
    offerOtherDoctor: true
  });
}

async function sendQuestionToDoctors({ message, image, provider, offerOtherDoctor = false }) {
  const typing = addTypingMessage();
  setBusy(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider,
        message,
        image
      })
    });
    const data = await response.json();
    typing.remove();

    if (!response.ok && !data.results?.length) {
      addBotMessage("问医生助手", data.error || "请求失败，请稍后再试。");
      return;
    }

    data.results.forEach(result => addBotMessage(result.name, result.text, result.id));
    if (data.failures?.length) {
      addBotMessage("问医生助手", "有一位医生暂时没有连上，已先显示可用医生的回复。");
    }

    if (offerOtherDoctor && provider !== "both") {
      const otherProvider = DOCTORS[provider]?.other;
      if (otherProvider && !questionHasDoctorAnswer(getLastUserMessage(), otherProvider)) {
        addAskDoctorMessage(otherProvider, message, image?.dataUrl);
      }
    }
  } catch (error) {
    typing.remove();
    addBotMessage("问医生助手", "网络连接不稳定，请稍后再试。");
  } finally {
    setBusy(false);
    saveCurrentSession();
    renderHistory();
  }
}

async function handleImageSelect() {
  const file = imageInput.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    addBotMessage("问医生助手", "请上传 PNG、JPG 或 WebP 图片。");
    imageInput.value = "";
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    addBotMessage("问医生助手", "图片有点大，请选择 8MB 以下的图片。");
    imageInput.value = "";
    return;
  }

  selectedImage = {
    name: file.name,
    size: file.size,
    type: file.type,
    dataUrl: await readAsDataUrl(file)
  };
  renderImagePreview();
}

function hydrateChat() {
  const sessions = loadHistory();
  if (!currentChatId || !sessions.some(session => session.id === currentChatId)) {
    currentChatId = sessions[0]?.id || createChatId();
    saveCurrentChatId();
  }

  const session = sessions.find(item => item.id === currentChatId);
  messages = session?.messages?.length ? session.messages : [WELCOME_MESSAGE];
  if (!session) saveCurrentSession();
}

function renderChat() {
  chatLog.innerHTML = "";
  messages.forEach(message => {
    chatLog.append(createMessage(message.type, message.name, message.text, message.imageUrl, {
      quickActions: message.quickActions,
      action: message.action
    }));
  });
  scrollToBottom();
}

function renderAccount() {
  const isGuest = currentUser === GUEST_USER;
  accountName.textContent = isGuest ? "访客模式" : `${currentUser} 已登录`;
  accountHint.textContent = isGuest
    ? "请用管理员创建的账号登录；登录后，对话历史会保存在本机浏览器。"
    : isAdmin()
      ? "管理员可以添加用户和修改两个医生的系统提示词。"
      : "历史只保存在这台设备的浏览器里，清除浏览器数据后会消失。";
  loginButton.textContent = isGuest ? "登录" : "账号";
  settingsButton.hidden = !isAdmin();
  if (!isAdmin()) settingsPanel.hidden = true;
  historyPanel.hidden = isGuest;
}

function renderHistory() {
  const sessions = loadHistory();
  historyList.innerHTML = "";
  historyPanel.hidden = currentUser === GUEST_USER;
  if (currentUser === GUEST_USER) return;

  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "还没有历史对话。";
    historyList.append(empty);
    return;
  }

  sessions.forEach(session => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = session.id === currentChatId ? "history-item active" : "history-item";
    button.innerHTML = `<strong>${escapeHtml(session.title || "新对话")}</strong><span>${formatDate(session.updatedAt)}</span>`;
    button.addEventListener("click", () => {
      saveCurrentSession();
      currentChatId = session.id;
      saveCurrentChatId();
      hydrateChat();
      renderChat();
      renderHistory();
    });
    historyList.append(button);
  });
}

function renderUsers(users) {
  userList.innerHTML = "";
  if (!users.length) {
    userList.textContent = "还没有普通用户。";
    return;
  }
  users.forEach(user => {
    const item = document.createElement("div");
    item.className = "user-list-item";
    item.innerHTML = `<strong>${escapeHtml(user.username)}</strong><span>${user.role === "admin" ? "管理员" : "普通用户"}</span>`;
    userList.append(item);
  });
}

function addUserMessage(text, imageUrl) {
  const message = { type: "user", name: "我", text, imageUrl };
  messages.push(message);
  chatLog.append(createMessage(message.type, message.name, message.text, message.imageUrl));
  scrollToBottom();
}

function addBotMessage(name, text, provider) {
  const message = { type: "bot", name, text, provider };
  messages.push(message);
  chatLog.append(createMessage(message.type, message.name, message.text));
  scrollToBottom();
}

function addTypingMessage() {
  const article = createMessage("bot typing", "医生", "正在查看您的问题...");
  chatLog.append(article);
  scrollToBottom();
  return article;
}

function addAskDoctorMessage(provider, questionText, imageUrl) {
  const doctorName = DOCTORS[provider]?.name;
  if (!doctorName) return;

  const message = {
    type: "bot",
    name: "问医生助手",
    text: `要不要也请${doctorName}回答刚才的问题？`,
    action: {
      label: `请${doctorName}也回答`,
      provider,
      questionText,
      imageUrl
    }
  };
  messages.push(message);
  chatLog.append(createMessage(message.type, message.name, message.text, null, { action: message.action }));
  scrollToBottom();
}

function createMessage(type, name, text, imageUrl, options = {}) {
  const quickActions = Boolean(options.quickActions);
  const action = options.action;
  const article = document.createElement("article");
  article.className = `message ${type}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = type.includes("user") ? "我" : "医";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (!type.includes("user")) {
    const doctorName = document.createElement("div");
    doctorName.className = "doctor-name";
    doctorName.textContent = name;
    bubble.append(doctorName);
  }

  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "uploaded-thumb";
    image.src = imageUrl;
    image.alt = "用户上传的图片";
    bubble.append(image);
  }

  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  bubble.append(paragraph);

  if (quickActions) {
    const quick = document.createElement("div");
    quick.className = "quick-actions";
    [
      ["头晕血压高", "我最近头晕，血压有点高，应该注意什么？"],
      ["咳嗽没精神", "老人夜里咳嗽厉害，白天也没精神，怎么办？"],
      ["用药咨询", "帮我看看这个药应该问医生哪些问题。"]
    ].forEach(([label, prompt]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        messageInput.value = prompt;
        resizeTextarea();
        messageInput.focus();
      });
      quick.append(button);
    });
    bubble.append(quick);
  }

  if (action) {
    const actionBar = document.createElement("div");
    actionBar.className = "message-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "正在询问...";
      await sendQuestionToDoctors({
        message: action.questionText,
        image: action.imageUrl ? { dataUrl: action.imageUrl } : null,
        provider: action.provider,
        offerOtherDoctor: false
      });
    });
    actionBar.append(button);
    bubble.append(actionBar);
  }

  article.append(avatar, bubble);
  return article;
}

function maybeOfferProviderForLastQuestion(provider) {
  if (provider === "both") return;
  if (messageInput.value.trim()) return;

  const lastUserMessage = getLastUserMessage();
  if (!lastUserMessage || questionHasDoctorAnswer(lastUserMessage, provider)) return;

  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.action?.provider === provider) return;

  addAskDoctorMessage(provider, lastUserMessage.text, lastUserMessage.imageUrl);
  saveCurrentSession();
}

function getLastUserMessage() {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].type === "user") return messages[index];
  }
  return null;
}

function questionHasDoctorAnswer(userMessage, provider) {
  const userIndex = messages.indexOf(userMessage);
  if (userIndex === -1) return false;

  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type === "user") break;
    if (message.provider === provider) return true;
  }
  return false;
}

function saveCurrentSession() {
  if (currentUser === GUEST_USER) return;
  const sessions = loadHistory();
  const existingIndex = sessions.findIndex(session => session.id === currentChatId);
  const session = {
    id: currentChatId || createChatId(),
    title: buildSessionTitle(messages),
    updatedAt: new Date().toISOString(),
    messages: trimMessagesForStorage(messages)
  };
  currentChatId = session.id;

  if (existingIndex >= 0) sessions.splice(existingIndex, 1);
  sessions.unshift(session);
  localStorage.setItem(historyKey(), JSON.stringify(sessions.slice(0, 20)));
  saveCurrentChatId();
}

function trimMessagesForStorage(items) {
  return items.slice(-80).map(item => ({
    type: item.type,
    name: item.name,
    text: item.text,
    provider: item.provider,
    imageUrl: item.imageUrl,
    action: item.action,
    quickActions: item.quickActions
  }));
}

function buildSessionTitle(items) {
  const userMessage = items.find(item => item.type === "user" && item.text);
  if (!userMessage) return "新对话";
  return userMessage.text.slice(0, 22);
}

function isAdmin() {
  return auth?.user?.role === "admin" && Boolean(auth?.token);
}

function authHeaders() {
  return { authorization: `Bearer ${auth?.token || ""}` };
}

function loadHistory() {
  if (currentUser === GUEST_USER) return [];
  return readJson(historyKey(), []);
}

function loadAuth() {
  return readJson(authKey(), null);
}

function loadCurrentChatId() {
  return localStorage.getItem(`${STORAGE_PREFIX}:currentChatId:${currentUser}`) || null;
}

function saveCurrentChatId() {
  localStorage.setItem(`${STORAGE_PREFIX}:currentChatId:${currentUser}`, currentChatId || "");
}

function authKey() {
  return `${STORAGE_PREFIX}:auth`;
}

function historyKey() {
  return `${STORAGE_PREFIX}:history:${currentUser}`;
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function createChatId() {
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderImagePreview() {
  if (!selectedImage) return;
  imagePreview.hidden = false;
  imagePreviewImg.src = selectedImage.dataUrl;
  imageName.textContent = selectedImage.name || "已选择图片";
  imageSize.textContent = formatBytes(selectedImage.size);
}

function clearSelectedImage() {
  selectedImage = null;
  imageInput.value = "";
  imagePreview.hidden = true;
  imagePreviewImg.removeAttribute("src");
  imageName.textContent = "";
  imageSize.textContent = "";
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function resizeTextarea() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 150)}px`;
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  messageInput.disabled = isBusy;
  providerButtons.forEach(button => {
    button.disabled = isBusy;
  });
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatLog.scrollTop = chatLog.scrollHeight;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
