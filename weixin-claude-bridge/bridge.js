#!/usr/bin/env node
/**
 * 微信 ↔ AI 桥接 (MVP)
 *
 * 协议层直接基于 iLink HTTP API（参考 @tencent-weixin/openclaw-weixin 源码）。
 * 不依赖 OpenClaw——本地扫码登录微信，长轮询收消息，AI API 回复。
 *
 * 用法:
 *   node bridge.js
 *
 * 环境变量:
 *   API_PROVIDER         - API 提供商: "deepseek" (默认) / "anthropic" / "openai"
 *   API_KEY              - API key（必需）
 *   API_MODEL            - 模型 ID（默认: deepseek-chat）
 *   API_BASE_URL         - API 地址
 *   SYSTEM_PROMPT_FILE   - 系统提示词文件路径（可选）
 *   STATE_DIR            - 登录凭证/游标存储目录（默认: ./.weixin-state）
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── 动态导入（仅 qrcode-terminal 需要） ──
let qrcode;
try {
  qrcode = (await import("qrcode-terminal")).default;
} catch {
  console.warn("[warn] qrcode-terminal 未安装，QR 码将以 URL 形式显示");
}

// ── 配置 ──
const API_BASE = "https://ilinkai.weixin.qq.com";
const ILINK_APP_ID = "bot";
// iLink-App-ClientVersion: major<<16 | minor<<8 | patch (当前 openclaw-weixin v2.4.6)
const ILINK_APP_CLIENT_VERSION = String((2 << 16) | (4 << 8) | 6); // 132102
const BOT_TYPE = "3"; // ilink bot_type
const LONG_POLL_TIMEOUT = 35_000; // getUpdates 长轮询超时 (ms)

const STATE_DIR = process.env.STATE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), ".weixin-state");
const TOKEN_FILE = path.join(STATE_DIR, "token.json");
const CURSOR_FILE = path.join(STATE_DIR, "cursor.json");

const API_PROVIDER = process.env.API_PROVIDER || "deepseek";
const API_KEY = process.env.API_KEY;
const API_MODEL = process.env.API_MODEL || (API_PROVIDER === "deepseek" ? "deepseek-chat" : API_PROVIDER === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o");
const API_BASE_URL = process.env.API_BASE_URL || (API_PROVIDER === "deepseek" ? "https://api.deepseek.com" : API_PROVIDER === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1");

// ── 工具函数 ──
function randomHex(bytes) { return crypto.randomBytes(bytes).toString("hex"); }
function base64Encode(s) { return Buffer.from(s).toString("base64"); }
function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}][${tag}] ${msg}`); }

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function safeJsonParse(text) { try { return JSON.parse(text); } catch { return null; } }

// ── 持久化 ──
function loadToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  const data = safeJsonParse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  if (data?.bot_token && data?.base_url) return data;
  return null;
}
function saveToken(botToken, baseUrl) {
  ensureDir(STATE_DIR);
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ bot_token: botToken, base_url: baseUrl, saved_at: new Date().toISOString() }));
}

function loadCursor(accountId) {
  const f = path.join(STATE_DIR, `cursor_${accountId}.json`);
  if (!fs.existsSync(f)) return "";
  return safeJsonParse(fs.readFileSync(f, "utf-8"))?.buf || "";
}
function saveCursor(accountId, buf) {
  ensureDir(STATE_DIR);
  fs.writeFileSync(path.join(STATE_DIR, `cursor_${accountId}.json`), JSON.stringify({ buf, updated: new Date().toISOString() }));
}

// ── HTTP fetch 封装 ──
function buildCommonHeaders() {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": ILINK_APP_CLIENT_VERSION,
  };
}

async function apiFetch(method, endpoint, body, opts = {}) {
  const { token, baseUrl = API_BASE, timeoutMs } = opts;
  const headers = {
    "Content-Type": "application/json",
    ...buildCommonHeaders(),
  };
  if (token) {
    headers["AuthorizationType"] = "ilink_bot_token";
    headers["Authorization"] = `Bearer ${token}`;
    headers["X-WECHAT-UIN"] = base64Encode(randomHex(4));
  }

  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(endpoint, base);

  const resp = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs || LONG_POLL_TIMEOUT + 10_000),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${endpoint}: HTTP ${resp.status}: ${text.slice(0, 200)}`);
  const json = safeJsonParse(text);
  if (!json) throw new Error(`Invalid JSON from ${endpoint}: ${text.slice(0, 200)}`);
  return json;
}

function apiPost(endpoint, body, opts = {}) {
  return apiFetch("POST", endpoint, body, opts);
}

function apiGet(endpoint, opts = {}) {
  return apiFetch("GET", endpoint, null, opts);
}

// ── 1. QR 扫码登录 ──
async function startQrLogin() {
  log("login", "正在请求 QR 码…");
  // 正确的 endpoint: POST ilink/bot/get_bot_qrcode?bot_type=3, body 含 local_token_list
  const body = { local_token_list: [] };
  const endpoint = `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`;
  const resp = await apiPost(endpoint, body);
  const qrcodeUrl = resp.qrcode;
  if (!qrcodeUrl) throw new Error("QR 码请求失败: " + JSON.stringify(resp));

  // 生成微信可识别的 QR 码内容
  // 尝试多种格式：原始 hex（WeChat 内部识别）
  const qrContent = qrcodeUrl;  // 原始 hex，WeChat 扫一扫应能识别

  log("login", "请用微信扫描以下二维码:");
  console.log(`\n  📱 二维码内容: ${qrContent}`);
  console.log(`  🔗 备用链接: https://ilinkai.weixin.qq.com/ilink/bot/login?qrcode=${encodeURIComponent(qrcodeUrl)}\n`);

  // 生成 PNG
  try {
    const QRCode = (await import("qrcode")).default;
    const imgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "qr_code.png");
    await QRCode.toFile(imgPath, qrContent, { type: "png", width: 400 });
    console.log(`  🖼️  图片: ${imgPath}\n`);
  } catch (e) {
    console.log(`  ⚠️  图片失败: ${e.message}\n`);
  }

  // 终端 ASCII
  if (qrcode) {
    qrcode.generate(qrContent, { small: true });
  }

  // 轮询等待扫码确认 — GET 请求
  const pollInterval = 2000;
  const maxWait = 5 * 60_000;
  const start = Date.now();
  const statusEndpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeUrl)}`;

  while (Date.now() - start < maxWait) {
    await sleep(pollInterval);
    const statusResp = await apiGet(statusEndpoint, { timeoutMs: QR_LONG_POLL_TIMEOUT_MS });
    const status = statusResp.status;

    if (status === "confirmed") {
      const botToken = statusResp.bot_token;
      const baseUrl = statusResp.baseurl || API_BASE;
      log("login", `✅ 登录成功! ilink_user_id=${statusResp.ilink_user_id}`);
      return { botToken, baseUrl, ilinkUserId: statusResp.ilink_user_id };
    }
    if (status === "expired") throw new Error("QR 码已过期，请重新启动");
    if (status === "scaned") log("login", "📱 已扫描，请在手机上确认…");
    if (status === "scaned_but_redirect") log("login", "🔄 重定向中…");
    if (status === "need_verifycode") log("login", "⚠️ 需要验证码（暂不支持）");
  }
  throw new Error("登录超时");
}

const QR_LONG_POLL_TIMEOUT_MS = 35_000;

// ── 2. 长轮询收消息 ──
async function getUpdates(token, baseUrl, cursor) {
  const body = {
    get_updates_buf: cursor || "",
    base_info: { channel_version: "2.4.6", bot_agent: "ClaudeBridge" },
  };
  const resp = await apiPost("ilink/bot/getupdates", body, {
    token,
    baseUrl,
    timeoutMs: LONG_POLL_TIMEOUT + 15_000,
  });

  if (resp.errcode === -14) {
    throw new Error("SESSION_EXPIRED");
  }
  if (resp.ret !== 0 && resp.ret !== undefined) {
    throw new Error(`getUpdates ret=${resp.ret} errmsg=${resp.errmsg}`);
  }

  return {
    messages: resp.msgs || [],
    newCursor: resp.get_updates_buf || cursor || "",
  };
}

// ── 3. 发送消息 ──
async function sendMessage(token, baseUrl, toUserId, text, contextToken) {
  const msg = {
    from_user_id: "",
    to_user_id: toUserId,
    client_id: `claude-bridge-${randomHex(6)}`,
    message_type: 2, // BOT
    message_state: 2, // FINISH
    item_list: [],
  };
  if (text) {
    msg.item_list.push({ type: 1, text_item: { text } });
  }
  if (contextToken) msg.context_token = contextToken;

  const resp = await apiPost("ilink/bot/sendmessage", { msg }, { token, baseUrl });
  if (resp.ret !== 0 && resp.ret !== undefined) {
    throw new Error(`sendMessage ret=${resp.ret} errmsg=${resp.errmsg}`);
  }
  return resp;
}

// ── 4. AI API 调用（支持 DeepSeek / Anthropic / OpenAI） ──
async function callAI(userMessage, systemPrompt, conversationHistory) {
  if (!API_KEY) {
    throw new Error("请设置 API_KEY 环境变量");
  }

  if (API_PROVIDER === "anthropic") {
    // Anthropic SDK
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: API_KEY, baseURL: API_BASE_URL });
    const messages = [...conversationHistory, { role: "user", content: userMessage }];
    const resp = await client.messages.create({
      model: API_MODEL,
      max_tokens: 1024,
      system: systemPrompt || undefined,
      messages,
    });
    return resp.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  // OpenAI 兼容 API（DeepSeek / OpenAI / 其他）
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push(...conversationHistory);
  messages.push({ role: "user", content: userMessage });

  const resp = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: API_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`API error ${resp.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── 5. 提取消息文本 ──
function extractText(msg) {
  if (!msg?.item_list?.length) return "";
  for (const item of msg.item_list) {
    if (item.type === 1 && item.text_item?.text) {
      return item.text_item.text;
    }
  }
  return "";
}

function isUserMessage(msg) {
  return msg?.message_type === 1; // USER
}

// ── 辅助 ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 加载系统提示词 ──
function loadSystemPrompt() {
  const file = process.env.SYSTEM_PROMPT_FILE;
  if (file && fs.existsSync(file)) {
    return fs.readFileSync(file, "utf-8");
  }
  // 默认提示词
  return "你是一个友好、简洁的助手。用中文回复。回答尽量简短，像微信聊天一样自然。";
}

// ── 主循环 ──
async function main() {
  console.log("=".repeat(50));
  console.log("  微信 ↔ AI 桥接 (MVP)");
  console.log("=".repeat(50));

  if (!API_KEY) {
    console.error("\n❌ 请设置 API_KEY 环境变量");
    console.error('   export API_KEY="sk-..."\n');
    process.exit(1);
  }

  const systemPrompt = loadSystemPrompt();
  console.log(`\n提供商: ${API_PROVIDER}  模型: ${API_MODEL}`);

  // ── 登录 ──
  let tokenInfo = loadToken();
  if (!tokenInfo) {
    console.log("\n未找到登录凭证，开始扫码登录…\n");
    const result = await startQrLogin();
    tokenInfo = { bot_token: result.botToken, base_url: result.baseUrl };
    saveToken(result.botToken, result.baseUrl);
    console.log(`\nilink_user_id: ${result.ilinkUserId}\n`);
  } else {
    console.log("\n✅ 使用已保存的登录凭证");
  }

  const token = tokenInfo.bot_token;
  const baseUrl = tokenInfo.base_url;
  // 用 token 的前 8 字节做简单 accountId
  const accountId = crypto.createHash("md5").update(token).digest("hex").slice(0, 8);

  // ── 会话记录（内存，进程重启后丢失） ──
  const sessions = new Map(); // toUserId → [{role, content}, ...]
  const MAX_HISTORY = 20;

  console.log("\n🎧 开始监听微信消息…\n");

  let retryCount = 0;

  while (true) {
    try {
      const cursor = loadCursor(accountId);
      const { messages, newCursor } = await getUpdates(token, baseUrl, cursor);
      saveCursor(accountId, newCursor);

      for (const msg of messages) {
        if (!isUserMessage(msg)) continue;
        const text = extractText(msg);
        if (!text.trim()) continue;

        const from = msg.from_user_id || "unknown";
        const contextToken = msg.context_token || "";
        log("📩", `来自 ${from.slice(0, 12)}… : ${text.slice(0, 50)}${text.length > 50 ? "…" : ""}`);

        // 维护会话历史
        if (!sessions.has(from)) sessions.set(from, []);
        const history = sessions.get(from);

        // 调用 AI
        try {
          const reply = await callAI(text, systemPrompt, history);
          log("🤖", `回复: ${reply.slice(0, 50)}${reply.length > 50 ? "…" : ""}`);

          // 更新历史
          history.push({ role: "user", content: text });
          history.push({ role: "assistant", content: reply });
          // 限制长度
          while (history.length > MAX_HISTORY) history.shift();

          // 发送回复
          await sendMessage(token, baseUrl, from, reply, contextToken);
          log("✅", "已发送");
        } catch (err) {
          log("❌", `AI 调用失败: ${err.message}`);
          await sendMessage(token, baseUrl, from, "抱歉，处理消息时出错了，稍后重试～", contextToken);
        }
      }

      retryCount = 0; // 成功后重置
    } catch (err) {
      if (err.message === "SESSION_EXPIRED") {
        log("⚠️", "会话过期，需要重新登录");
        try { fs.unlinkSync(TOKEN_FILE); } catch {}
        tokenInfo = null;
        const result = await startQrLogin();
        tokenInfo = { bot_token: result.botToken, base_url: result.baseUrl };
        saveToken(result.botToken, result.baseUrl);
        continue;
      }

      retryCount++;
      log("⚠️", `轮询错误: ${err.message}`);
      if (retryCount > 10) {
        log("❌", "连续错误过多，退出");
        process.exit(1);
      }
      await sleep(5000);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
