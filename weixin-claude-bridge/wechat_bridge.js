#!/usr/bin/env node
/**
 * 微信 ↔ AI 桥接 v2 — 基于 wechat4u (微信网页协议)
 *
 * 普通个人微信号扫码登录，收消息 → DeepSeek → 回复
 * 支持文字、图片（需 vision 模型）、语音/视频（提示不支持）
 */

import Wechat from "wechat4u";
import { default as qrcode } from "qrcode-terminal";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── 加载 .env 文件（简单解析，不依赖第三方库）──
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const envPaths = [path.join(scriptDir, ".env"), path.join(process.cwd(), ".env")];
let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
    envLoaded = true;
    break;
  }
}
// 启动时输出调试信息
if (!envLoaded) {
  console.error("[env] 未找到 .env 文件，查找路径:", envPaths);
} else {
  console.error("[env] .env 已加载, API_KEY:", process.env.API_KEY ? "已设置 ✓" : "未找到 ✗");
}

// ── 配置 ──
const API_PROVIDER = process.env.API_PROVIDER || "deepseek";
const API_KEY = process.env.API_KEY;
const API_MODEL = process.env.API_MODEL || "deepseek-chat";
const API_BASE_URL = process.env.API_BASE_URL || "https://api.deepseek.com";
const SYSTEM_PROMPT_FILE = process.env.SYSTEM_PROMPT_FILE;

// 视觉配置（可选，默认跟主 API 一致）
const VISION_API_PROVIDER = process.env.VISION_API_PROVIDER || API_PROVIDER;
const VISION_API_KEY = process.env.VISION_API_KEY || API_KEY;
const VISION_API_MODEL = process.env.VISION_API_MODEL || API_MODEL;
const VISION_API_BASE_URL = process.env.VISION_API_BASE_URL || API_BASE_URL;

const SYNC_FILE = path.join(__dirname, "wechat_sync.json");

// ── 主动消息配置 ──
const PROACTIVE_ENABLED = process.env.PROACTIVE_ENABLED === "true";
const PROACTIVE_TARGET = process.env.PROACTIVE_TARGET || ""; // 对方的备注名或昵称
const PROACTIVE_MIN = parseInt(process.env.PROACTIVE_MIN) || 90;   // 最短间隔（分钟）
const PROACTIVE_MAX = parseInt(process.env.PROACTIVE_MAX) || 360;  // 最长间隔（分钟）
const PROACTIVE_COOLDOWN = parseInt(process.env.PROACTIVE_COOLDOWN) || 15; // 对方回消息后冷却（分钟）
const QUIET_START = parseInt(process.env.QUIET_START) || 23;  // 夜间免打扰开始（时）
const QUIET_END = parseInt(process.env.QUIET_END) || 8;       // 夜间免打扰结束（时）

if (!API_KEY) { console.error("❌ 请设置 API_KEY"); process.exit(1); }

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}][${tag}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadSystemPrompt() {
  if (SYSTEM_PROMPT_FILE && fs.existsSync(SYSTEM_PROMPT_FILE)) return fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
  return "你是一个友好、简洁的助手。用中文回复，像微信聊天一样自然。";
}

// ── AI 调用 (OpenAI 兼容 API) ──
// userContent: string（纯文本）或数组（多模态，含图片）
async function callAI(userContent, systemPrompt, history, opts = {}) {
  const { useVision = false } = opts;
  const baseUrl = useVision ? VISION_API_BASE_URL : API_BASE_URL;
  const model = useVision ? VISION_API_MODEL : API_MODEL;
  const apiKey = useVision ? VISION_API_KEY : API_KEY;

  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });

  if (typeof userContent === "string") {
    // 纯文本：带历史
    messages.push(...history);
    messages.push({ role: "user", content: userContent });
  } else {
    // 多模态（图片等）：不带历史，消息本身已经包含文本+图片
    messages.push({ role: "user", content: userContent });
  }

  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: 1024, temperature: 0.7 }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── 主程序 ──
const systemPrompt = loadSystemPrompt();
const sessions = new Map();
const MAX_HISTORY = 200;
const BRIDGE_START_TIME = Date.now();

console.log("=".repeat(50));
console.log("  微信 ↔ AI 桥接 v2 (wechat4u)");
console.log("=".repeat(50));
console.log(`  主模型: ${API_PROVIDER} / ${API_MODEL}`);
if (VISION_API_PROVIDER !== API_PROVIDER || VISION_API_MODEL !== API_MODEL) {
  console.log(`  视觉模型: ${VISION_API_PROVIDER} / ${VISION_API_MODEL}`);
}
if (PROACTIVE_ENABLED && PROACTIVE_TARGET) {
  console.log(`  💬 主动消息: 已启用 → ${PROACTIVE_TARGET}`);
  console.log(`     间隔 ${PROACTIVE_MIN}~${PROACTIVE_MAX} 分钟 | 免打扰 ${QUIET_START}:00~${QUIET_END}:00`);
}
console.log("");

// 尝试恢复登录
let bot;
try {
  const syncData = JSON.parse(fs.readFileSync(SYNC_FILE, "utf-8"));
  bot = new Wechat(syncData);
  log("♻️", "恢复登录…");
  bot.restart();
} catch {
  bot = new Wechat();
  bot.start();
}

// QR 码
bot.on("uuid", (uuid) => {
  const qrUrl = `https://login.weixin.qq.com/l/${uuid}`;
  console.log("\n📱 请用微信扫一扫扫描下面的二维码:\n");
  qrcode.generate(qrUrl, { small: true });
  console.log(`\n备用链接: ${qrUrl}\n`);
});

// 登录成功
bot.on("login", () => {
  log("✅", "登录成功！");
  fs.writeFileSync(SYNC_FILE, JSON.stringify(bot.botData));
  log("💾", "登录凭证已保存，下次启动免扫码");
  console.log("\n🎧 开始监听消息…\n");
  startProactive();
});

// 登出
bot.on("logout", () => {
  log("⚠️", "已登出");
  try { fs.unlinkSync(SYNC_FILE); } catch {}
  process.exit(0);
});

// 错误
bot.on("error", (err) => {
  log("❌", `错误: ${err.message || err}`);
});

// ── 发送回复（拆分多条）──
async function sendReply(reply, to) {
  // 调试：打印原始回复的前200字符
  log("🔍", `原始回复: ${JSON.stringify(reply.slice(0, 200))}`);

  let parts = [];

  // 方法1：用 --- 拆分（支持两种格式：独立一行、或粘在句末）
  if (reply.includes("---")) {
    // 先试独立一行：\n---\n
    parts = reply.split(/\r?\n\s*---\s*\r?\n/).filter(p => p.trim());
    // 再试粘在句末：text---\n
    if (parts.length <= 1) {
      parts = reply.split(/---\s*\r?\n\s*/).filter(p => p.trim());
      log("🔍", `句末 --- 拆分: ${parts.length} 段`);
    }
    // 最后试 --- 出现就拆
    if (parts.length <= 1) {
      parts = reply.split(/\s*---\s*/).filter(p => p.trim());
      log("🔍", `宽松 --- 拆分: ${parts.length} 段`);
    }
  }

  // 方法2：按双换行拆
  if (parts.length <= 1) {
    parts = reply.split(/\r?\n\r?\n/).filter(p => p.trim());
    log("🔍", `双换行拆分: ${parts.length} 段`);
  }

  // 方法3：按句子拆（长回复兜底）
  if (parts.length <= 1) {
    parts = reply.split(/(?<=[。！？\n])\s*/).filter(p => p.trim() && p.length > 3);
    log("🔍", `句子拆分: ${parts.length} 段`);
  }

  const messages = parts.length > 0 ? parts : [reply];
  for (const part of messages) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    await bot.sendMsg(trimmed, to);
    await sleep(800);
  }
  log("✅", `已发送 ${messages.length} 条`);
}

// ── 主动消息 ──
let proactiveTargetName = null;  // 解析后的 UserName
let proactiveTimer = null;
let lastInteractionTime = Date.now();

// 在联系人中查找目标 UserName
function resolveTarget(contacts) {
  if (!PROACTIVE_TARGET) return null;
  for (const [userName, contact] of Object.entries(contacts)) {
    const name = contact.RemarkName || contact.NickName || "";
    if (name === PROACTIVE_TARGET) return userName;
  }
  return null;
}

// 随机间隔（偏自然：大部分在中段，偶尔很短或很长）
function randomInterval() {
  // 用两个随机数相乘，产生偏态分布——大部分在中间，偶尔很短偶尔很长
  const r1 = Math.random();
  const r2 = Math.random();
  const factor = (r1 + r2) / 2; // 三角分布：峰值在中段
  return (PROACTIVE_MIN + factor * (PROACTIVE_MAX - PROACTIVE_MIN)) * 60 * 1000;
}

// 检查是否在夜间免打扰时段
function isQuietHours() {
  const hour = new Date().getHours();
  if (QUIET_START < QUIET_END) {
    // 例如 8-23 是活跃时段
    return hour < QUIET_START || hour >= QUIET_END;
  } else {
    // 例如 23-8 是免打扰（QUIET_START=23, QUIET_END=8）
    return hour >= QUIET_START || hour < QUIET_END;
  }
}

// 计算距离免打扰结束还有多久
function msUntilActive() {
  const now = new Date();
  const activeTime = new Date(now);
  activeTime.setHours(QUIET_END, 0, 0, 0);
  if (activeTime <= now) activeTime.setDate(activeTime.getDate() + 1);
  return activeTime - now;
}

// 生成并发送主动消息
async function sendProactive() {
  try {
    if (!proactiveTargetName || !bot?.CONF) return;

    const history = sessions.get(proactiveTargetName) || [];
    const prompt = loadSystemPrompt();

    // 检查冷却：对方刚聊完不久，不打扰
    const quietTime = (Date.now() - lastInteractionTime) / 1000 / 60;
    if (quietTime < PROACTIVE_COOLDOWN) {
      log("⏸️", `冷却中 (${quietTime.toFixed(0)}/${PROACTIVE_COOLDOWN}min)`);
      scheduleNext();
      return;
    }

    // 最近一条是 AI 发的且对方没回 → 不要连发骚扰
    const lastMsg = history[history.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && quietTime < PROACTIVE_COOLDOWN * 2) {
      log("⏸️", `上次消息未回复，延长等待`);
      scheduleNext();
      return;
    }

    // 拿最近历史作为上下文（避免复读）
    const recentHistory = history.slice(-6);
    const contextStr = recentHistory.length > 0
      ? `\n\n最近聊天（参考，别复读）：\n${recentHistory.map(m => `[${m.role === "user" ? PROACTIVE_TARGET : "你"}]: ${typeof m.content === "string" ? m.content.slice(0, 80) : "[非文字]"}`).join("\n")}`
      : "";

    // 随机选一种发起方式，避免每次都一样
    const moods = [
      "你刚看到一个东西/发生了一件小事，想跟他分享。直接说事，不要铺垫。",
      "你想起之前他说过的一句话/答应你的一件事，追问一下。",
      "你突然想到他就找他。不要问在干嘛，直接说你想说的。",
      "你有点无聊，想看他猫。直接要。",
      "你在打游戏/看视频/刷到有意思的东西，发给他看。",
    ];
    const mood = moods[Math.floor(Math.random() * moods.length)];

    const proactivePrompt = `你现在想主动找 ${PROACTIVE_TARGET} 聊天。${mood}
规则：
- 1-3句，极短，发微信不是写小作文
- 不要打招呼（不说"在吗""hi"之类）
- 不要用 --- 分隔符，就发一条
- 用你的自然语气
- 不要和最近聊天记录重复${contextStr}`;

    const reply = await callAI(proactivePrompt, prompt, []);
    const text = reply.replace(/---.*/s, "").trim();
    if (!text) return;

    log("💬", `主动 → ${PROACTIVE_TARGET}: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);

    history.push({ role: "assistant", content: text });
    while (history.length > MAX_HISTORY) history.shift();

    await bot.sendMsg(text, proactiveTargetName);
    log("✅", "主动消息已发送");
  } catch (err) {
    log("⚠️", `主动消息失败: ${err.message}`);
  }
  scheduleNext();
}

function scheduleNext() {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  if (!PROACTIVE_ENABLED || !proactiveTargetName) return;

  let delay = randomInterval();

  // 如果下次落在免打扰时段，推迟到免打扰结束后
  const nextAt = Date.now() + delay;
  const nextHour = new Date(nextAt).getHours();
  if (QUIET_START < QUIET_END) {
    // 活跃时段 8-23，超出即免打扰
    if (nextHour < QUIET_START || nextHour >= QUIET_END) {
      delay = msUntilActive() + Math.random() * 60 * 60 * 1000; // 免打扰结束 + 0~1h 随机
      log("🌙", `延迟至免打扰结束后`);
    }
  } else {
    if (nextHour >= QUIET_START || nextHour < QUIET_END) {
      delay = msUntilActive() + Math.random() * 60 * 60 * 1000;
      log("🌙", `延迟至免打扰结束后`);
    }
  }

  const nextTime = new Date(Date.now() + delay).toLocaleTimeString();
  log("⏰", `下次主动消息: ${nextTime} (${(delay / 3600000).toFixed(1)}小时后)`);
  proactiveTimer = setTimeout(sendProactive, delay);
}

function startProactive() {
  if (!PROACTIVE_ENABLED) return;
  if (!PROACTIVE_TARGET) {
    log("⚠️", "PROACTIVE_TARGET 未设置，跳过主动消息");
    return;
  }
  const contacts = bot.contacts || {};
  proactiveTargetName = resolveTarget(contacts);
  if (!proactiveTargetName) {
    log("⚠️", `未找到联系人 "${PROACTIVE_TARGET}"，请在微信中确认备注名或昵称`);
    log("💡", `已知联系人: ${Object.values(contacts).slice(0, 20).map(c => c.RemarkName || c.NickName).filter(Boolean).join(", ")}`);
    return;
  }
  log("🎯", `主动消息目标: ${PROACTIVE_TARGET} → ${proactiveTargetName}`);
  // 启动后等 5 分钟再发首条，给人缓冲
  const firstDelay = 5 * 60 * 1000;
  log("⏰", `首条主动消息: ${new Date(Date.now() + firstDelay).toLocaleTimeString()} (5分钟后)`);
  proactiveTimer = setTimeout(sendProactive, firstDelay);
}

// ── 收到消息 ──
bot.on("message", async (msg) => {
  try {
    const from = msg.FromUserName;

    // 忽略群消息
    if (from.startsWith("@@")) return;

    // 忽略自己发出的消息
    const myName = (bot.user || {}).UserName;
    if (from === myName) return;

    // 忽略启动前的旧消息
    const msgTime = (msg.CreateTime || 0) * 1000;
    if (msgTime > 0 && msgTime < BRIDGE_START_TIME) return;

    const contacts = bot.contacts || {};
    const contact = contacts[from] || {};
    const displayName = contact.RemarkName || contact.NickName || from;

    // 重置主动消息的冷却计时
    lastInteractionTime = Date.now();

    if (!sessions.has(from)) sessions.set(from, []);
    const history = sessions.get(from);
    const prompt = loadSystemPrompt();

    // ── 判断消息类型 ──
    const msgType = msg.MsgType;
    const CONF = bot.CONF || {};

    // 系统消息（状态通知等），直接跳过
    if (msgType === CONF.MSGTYPE_STATUSNOTIFY || msgType === CONF.MSGTYPE_SYSNOTICE) {
      return;
    }

    // 表情消息 — 不回复，避免刷屏
    if (msgType === CONF.MSGTYPE_EMOTICON) {
      log("😀", `${displayName}: [表情]`);
      history.push({ role: "user", content: "[表情]" });
      return;
    }

    // 图片消息
    if (msgType === CONF.MSGTYPE_IMAGE) {
      log("🖼️", `${displayName}: [图片]`);

      try {
        const imgRes = await bot.getMsgImg(msg.MsgId);
        const imgBuffer = imgRes.data;
        const mime = imgRes.type || "image/jpeg";
        const base64 = imgBuffer.toString("base64");
        const dataUrl = `data:${mime};base64,${base64}`;

        log("🖼️", `图片已下载 (${(imgBuffer.length / 1024).toFixed(1)}KB)`);

        const imageContent = [
          { type: "text", text: "（用户发了一张图片，请根据你的角色设定回复。如果图片内容看不清或无法识别，就自然地说看不清。不要暴露你是AI。）" },
          { type: "image_url", image_url: { url: dataUrl } }
        ];

        const reply = await callAI(imageContent, prompt, history, { useVision: true });
        log("🤖", `→ ${reply.slice(0, 60)}${reply.length > 60 ? "…" : ""}`);

        history.push({ role: "user", content: "[图片]" });
        history.push({ role: "assistant", content: reply });
        while (history.length > MAX_HISTORY) history.shift();

        await sendReply(reply, from);
      } catch (err) {
        log("⚠️", `图片处理失败: ${err.message}`);
        // 模型不支持 vision 时会走到这里
        await bot.sendMsg("收到图片了，但当前模型不支持识别图片内容 😢", from);
      }
      return;
    }

    // 语音消息
    if (msgType === CONF.MSGTYPE_VOICE) {
      log("🎤", `${displayName}: [语音]`);
      history.push({ role: "user", content: "[语音]" });
      await bot.sendMsg("收到语音～不过我现在还听不懂语音消息，打字说吧", from);
      return;
    }

    // 视频/小视频消息
    if (msgType === CONF.MSGTYPE_VIDEO || msgType === CONF.MSGTYPE_MICROVIDEO) {
      log("🎬", `${displayName}: [视频]`);
      history.push({ role: "user", content: "[视频]" });
      await bot.sendMsg("收到视频～不过我现在还看不了视频，发文字或图片吧", from);
      return;
    }

    // 纯文本消息（默认）
    const text = String(msg.Content || "").trim();
    if (!text) return;
    log("📩", `${displayName}: ${text.slice(0, 50)}${text.length > 50 ? "…" : ""}`);

    const reply = await callAI(text, prompt, history);
    log("🤖", `→ ${reply.slice(0, 60)}${reply.length > 60 ? "…" : ""}`);

    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: reply });
    while (history.length > MAX_HISTORY) history.shift();

    await sendReply(reply, from);

  } catch (err) {
    log("❌", `${err.message}`);
    console.error(err);
  }
});
