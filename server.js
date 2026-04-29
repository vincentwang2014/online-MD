const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const PROMPTS_FILE = path.join(DATA_DIR, "prompts.json");
const TOKEN_SECRET = process.env.ADMIN_PASSWORD || process.env.OPENAI_API_KEY || "local-dev-secret";

const DEFAULT_DOCTOR_PROMPTS = {
  openai: [
    "你是 OpenAI医生，面向老人和家属提供清楚、温和、谨慎的就医前建议。",
    "请先总结你理解到的症状，再给出可能方向、观察指标、就医建议和需要问医生的问题。",
    "回答尽量短句、少术语，默认使用简体中文。"
  ].join("\n"),
  gemini: [
    "你是 Gemini医生，擅长从另一个角度帮老人和家属梳理症状、风险和下一步行动。",
    "请补充 OpenAI医生可能遗漏的观察点，但不要制造恐慌。",
    "回答尽量实用、分点、默认使用简体中文。"
  ].join("\n")
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const MEDICAL_SYSTEM_PROMPT = [
  "You are a careful, warm medical information assistant for older adults and their family caregivers.",
  "You must not claim to diagnose or replace a licensed clinician.",
  "Answer in clear Simplified Chinese by default.",
  "Use large-picture, practical language: possible causes, what to watch, what questions to ask a doctor, and safe next steps.",
  "For emergencies such as chest pain, trouble breathing, stroke symptoms, severe allergic reaction, loss of consciousness, severe bleeding, or suicidal intent, tell the user to call local emergency services immediately.",
  "When image input is present, describe visible observations cautiously and say that image review alone cannot confirm a diagnosis."
].join(" ");

function buildDoctorPrompt(customPrompt) {
  const prompt = sanitizeMessage(customPrompt);
  if (!prompt) return MEDICAL_SYSTEM_PROMPT;

  return [
    prompt,
    "",
    "Non-negotiable medical safety rules:",
    MEDICAL_SYSTEM_PROMPT
  ].join("\n");
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) value = value.slice(1, -1);

    process.env[key] = value;
  }
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!password || !storedHash || !storedHash.includes(":")) return false;
  const [salt, expectedHash] = storedHash.split(":");
  const actualHash = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === actualHash.length && crypto.timingSafeEqual(expected, actualHash);
}

function loadUsers() {
  return readJsonFile(USERS_FILE, []);
}

function saveUsers(users) {
  writeJsonFile(USERS_FILE, users);
}

function loadDoctorPrompts() {
  return {
    ...DEFAULT_DOCTOR_PROMPTS,
    ...readJsonFile(PROMPTS_FILE, {})
  };
}

function saveDoctorPrompts(prompts) {
  writeJsonFile(PROMPTS_FILE, {
    openai: sanitizeMessage(prompts.openai) || DEFAULT_DOCTOR_PROMPTS.openai,
    gemini: sanitizeMessage(prompts.gemini) || DEFAULT_DOCTOR_PROMPTS.gemini
  });
}

function signToken(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [encodedPayload, signature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(encodedPayload)
    .digest("base64url");
  if (signature.length !== expectedSignature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (payload.expiresAt && Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

function authFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return verifyToken(token);
}

function requireAdmin(req, res) {
  const auth = authFromRequest(req);
  if (!auth || auth.role !== "admin") {
    sendJson(res, 403, { error: "需要管理员权限。" });
    return null;
  }
  return auth;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sanitizeMessage(value) {
  return String(value || "").trim().slice(0, 6000);
}

function safeDataUrl(image) {
  if (!image || typeof image.dataUrl !== "string") return null;
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(image.dataUrl)) return null;
  return image.dataUrl;
}

function extractOpenAIText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

async function callOpenAI({ message, image, systemPrompt }) {
  if (!process.env.OPENAI_API_KEY) {
    return demoReply("OpenAI医生", message, image);
  }

  const content = [{ type: "input_text", text: message }];
  const imageUrl = safeDataUrl(image);
  if (imageUrl) {
    content.push({ type: "input_image", image_url: imageUrl, detail: "auto" });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: buildDoctorPrompt(systemPrompt),
      input: [{ role: "user", content }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return extractOpenAIText(data) || "我暂时没有生成有效回复，请稍后再试。";
}

async function callGemini({ message, image, systemPrompt }) {
  if (!process.env.GEMINI_API_KEY) {
    return demoReply("Gemini医生", message, image);
  }

  const parts = [{ text: message }];
  const imageUrl = safeDataUrl(image);
  if (imageUrl) {
    const [meta, base64Data] = imageUrl.split(",");
    const mimeType = meta.match(/^data:(.*);base64$/i)?.[1] || "image/jpeg";
    parts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildDoctorPrompt(systemPrompt) }] },
      contents: [{ role: "user", parts }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("\n").trim()
    || "我暂时没有生成有效回复，请稍后再试。";
}

function demoReply(doctorName, message, image) {
  const hasImage = Boolean(image?.dataUrl);
  return [
    `我是${doctorName}。目前后端还没有配置 API 密钥，所以这是演示回复。`,
    "",
    `我理解您的问题是：“${message || "请根据上传内容给出建议"}”。`,
    hasImage ? "我也收到了您上传的图片。正式接入模型后，我会把图片一起交给模型分析。" : "",
    "",
    "一般建议：先记录症状出现时间、严重程度、体温/血压/血糖等数据，以及最近用药变化。若出现胸痛、呼吸困难、口角歪斜、单侧无力、意识不清、严重出血等情况，请立即拨打急救电话。",
    "",
    "这个工具只能提供就医前的信息整理，不能替代医生面诊。"
  ].filter(Boolean).join("\n");
}

async function handleApiChat(req, res) {
  try {
    const body = await collectBody(req);
    const payload = JSON.parse(body || "{}");
    const message = sanitizeMessage(payload.message);
    const image = payload.image && typeof payload.image === "object" ? payload.image : null;
    const provider = payload.provider === "gemini" ? "gemini" : payload.provider === "both" ? "both" : "openai";
    const prompts = loadDoctorPrompts();

    if (!message && !safeDataUrl(image)) {
      sendJson(res, 400, { error: "请输入问题或上传图片。" });
      return;
    }

    const calls = [];
    if (provider === "openai" || provider === "both") {
      calls.push(callOpenAI({ message, image, systemPrompt: prompts.openai }).then(text => ({ id: "openai", name: "OpenAI医生", text })));
    }
    if (provider === "gemini" || provider === "both") {
      calls.push(callGemini({ message, image, systemPrompt: prompts.gemini }).then(text => ({ id: "gemini", name: "Gemini医生", text })));
    }

    const settledResults = await Promise.allSettled(calls);
    const results = settledResults
      .filter(result => result.status === "fulfilled")
      .map(result => result.value);
    const failures = settledResults
      .filter(result => result.status === "rejected")
      .map(result => ({
        error: result.reason instanceof Error ? result.reason.message : "Provider request failed"
      }));

    sendJson(res, results.length ? 200 : 500, { results, failures });
  } catch (error) {
    sendJson(res, 500, {
      error: "服务器暂时无法处理请求。",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message
    });
  }
}

async function handleLogin(req, res) {
  try {
    const body = await collectBody(req);
    const payload = JSON.parse(body || "{}");
    const username = String(payload.username || "").trim().slice(0, 24);
    const password = String(payload.password || "");

    if (!username || !password) {
      sendJson(res, 400, { error: "请输入用户名和密码。" });
      return;
    }

    const isAdminLogin = username.toLowerCase() === "admin"
      && process.env.ADMIN_PASSWORD
      && password === process.env.ADMIN_PASSWORD;
    const users = loadUsers();
    const user = users.find(item => item.username.toLowerCase() === username.toLowerCase());
    const isStoredUser = user && verifyPassword(password, user.passwordHash);

    if (!isAdminLogin && !isStoredUser) {
      sendJson(res, 401, { error: "用户名或密码不正确。" });
      return;
    }

    const role = isAdminLogin ? "admin" : user.role || "user";
    const normalizedUsername = isAdminLogin ? "admin" : user.username;
    const token = signToken({
      username: normalizedUsername,
      role,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    });

    sendJson(res, 200, { user: { username: normalizedUsername, role }, token });
  } catch (error) {
    sendJson(res, 500, { error: "登录失败。" });
  }
}

async function handleUsers(req, res) {
  const auth = requireAdmin(req, res);
  if (!auth) return;

  if (req.method === "GET") {
    const users = loadUsers().map(user => ({
      username: user.username,
      role: user.role || "user",
      createdAt: user.createdAt
    }));
    sendJson(res, 200, { users });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await collectBody(req);
    const payload = JSON.parse(body || "{}");
    const username = String(payload.username || "").trim().slice(0, 24);
    const password = String(payload.password || "");
    const role = payload.role === "admin" ? "admin" : "user";

    if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,24}$/.test(username)) {
      sendJson(res, 400, { error: "用户名需为 2-24 个中文、字母、数字、下划线或短横线。" });
      return;
    }
    if (password.length < 4) {
      sendJson(res, 400, { error: "临时密码至少 4 位。" });
      return;
    }

    const users = loadUsers();
    if (username.toLowerCase() === "admin" || users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
      sendJson(res, 409, { error: "这个用户名已经存在。" });
      return;
    }

    users.push({
      username,
      role,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    });
    saveUsers(users);
    sendJson(res, 201, { user: { username, role } });
  } catch (error) {
    sendJson(res, 500, { error: "添加用户失败。" });
  }
}

async function handlePrompts(req, res) {
  const auth = requireAdmin(req, res);
  if (!auth) return;

  if (req.method === "GET") {
    sendJson(res, 200, { prompts: loadDoctorPrompts() });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await collectBody(req);
    const payload = JSON.parse(body || "{}");
    saveDoctorPrompts(payload.prompts || {});
    sendJson(res, 200, { prompts: loadDoctorPrompts() });
  } catch (error) {
    sendJson(res, 500, { error: "保存医生提示词失败。" });
  }
}

function serveStatic(req, res) {
  const rawPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = rawPath === "/" ? "/index.html" : rawPath;
  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));

  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallbackData) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "content-type": MIME_TYPES[".html"] });
        res.end(fallbackData);
      });
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { "content-type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/health")) {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/login")) {
    handleLogin(req, res);
    return;
  }

  if (req.url.startsWith("/api/users")) {
    handleUsers(req, res);
    return;
  }

  if (req.url.startsWith("/api/prompts")) {
    handlePrompts(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/chat")) {
    handleApiChat(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Elder care AI chat is running on port ${PORT}`);
});
