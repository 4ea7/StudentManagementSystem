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

// xaj 人生模拟引擎 — 延迟加载，避免缺失时阻断 bridge 启动
let _xajGenerateStateDesc = null;
let _xajGenerateProactivePrompt = null;

async function ensureXajImports() {
  if (_xajGenerateStateDesc) return;
  try {
    const mod = await import("./xaj_life.js");
    _xajGenerateStateDesc = mod.generateStateDescription;
    _xajGenerateProactivePrompt = mod.generateProactivePrompt;
    log("✅", "xaj_life.js 已加载");
  } catch (e) {
    log("⚠️", `xaj_life.js 加载失败: ${e.message}，将跳过人生状态注入`);
    // 设置空函数避免后续 null 调用
    _xajGenerateStateDesc = () => null;
    _xajGenerateProactivePrompt = () => null;
  }
}

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

const SYNC_FILE = path.join(scriptDir, "wechat_sync.json");
const CORRECTIONS_FILE = path.join(scriptDir, "corrections.txt");
const STICKERS_FILE = path.join(scriptDir, "stickers.json");
const XAJ_STATE_FILE = path.join(scriptDir, "xaj_state.json");

// ── 双向情感反馈配置 ──
const EMOTION_ENABLED = process.env.EMOTION_ENABLED !== "false"; // 默认开启，设 "false" 关闭

// 情感标记 → emoji 映射（控制台日志用）
const EMOTION_EMOJI = {
  "温暖": "❤️", "刺痛": "💔", "开心": "😊", "烦躁": "😤",
  "感动": "🥹", "失望": "😞", "没感觉": "😐", "想笑": "😏"
};

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

// ── 表情库 ──
let stickerBank = {}; // { md5: { savedBy, savedAt, count } }

function loadStickers() {
  if (fs.existsSync(STICKERS_FILE)) {
    try { stickerBank = JSON.parse(fs.readFileSync(STICKERS_FILE, "utf-8")); } catch {}
  }
}

function saveStickers() {
  fs.writeFileSync(STICKERS_FILE, JSON.stringify(stickerBank, null, 2));
}

function extractEmojiMd5(msg) {
  const content = String(msg.Content || "");
  // wechat4u 表情消息 Content 是 XML，MD5 在 md5="..." 属性里
  const md5Match = content.match(/md5="([a-f0-9]{32})"/i);
  if (md5Match) return md5Match[1];
  // 有时 Content 直接就是 MD5
  if (/^[a-f0-9]{32}$/.test(content)) return content;
  return null;
}

function addSticker(md5, from, displayName) {
  if (stickerBank[md5]) {
    stickerBank[md5].count++;
  } else {
    stickerBank[md5] = { savedBy: displayName, savedAt: new Date().toISOString(), count: 1 };
    saveStickers();
    log("🃏", `新表情入库: ${md5}`);
  }
}

function getStickerList() {
  const entries = Object.entries(stickerBank);
  if (entries.length === 0) return "";
  return entries.map(([md5, info], i) => `${i + 1}. ${md5.slice(0, 6)}… (使用${info.count}次)`).join("\n");
}

// ── xaj 人生模拟引擎集成 ──
function loadXajState() {
  try {
    if (fs.existsSync(XAJ_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(XAJ_STATE_FILE, "utf-8"));
    }
  } catch (e) {
    log("⚠️", `xaj_state.json 读取失败: ${e.message}`);
  }
  return null;
}

function updateXajInteraction() {
  // 收到 GSQ 的消息时更新 lastInteraction 和重置 unreadMessages
  try {
    const state = loadXajState();
    if (!state) return;
    state.lastInteraction = new Date().toISOString();
    state.unreadMessages = 0; // 看到了就清零
    fs.writeFileSync(XAJ_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    // 静默失败，不影响主流程
  }
}

// ── 双向情感反馈机制 ──
// 在 xaj 回复 GSQ 后，再调用一次 AI 分析对话对 xaj 的情感影响。
// 分析结果会同步更新 xaj_state.json，让她的状态真正被对话内容塑造。

/**
 * 本地 moodValue → 中文标签（与 xaj_life.js 保持一致，避免模块依赖）
 */
function resolveMoodLabelLocal(value) {
  if (value >= 9) return "超开心";
  if (value >= 7.5) return "开心";
  if (value >= 6) return "还不错";
  if (value >= 5) return "一般";
  if (value >= 4) return "有点烦";
  if (value >= 2.5) return "烦躁";
  if (value >= 1.5) return "心情很差";
  return "烦死了";
}

/**
 * 构建情感分析的 system prompt —— 简短、专注分析而非生成回复。
 * 注入她当前的状态描述，让 AI 知道 "她说这句话的时候心情是怎样的"。
 */
function buildEmotionSystemPrompt(userMessage, assistantReply, xajState) {
  let stateDesc = "";
  if (xajState && _xajGenerateStateDesc) {
    stateDesc = _xajGenerateStateDesc(xajState);
  }
  if (!stateDesc && xajState) {
    // 回退：手动拼接简要状态
    stateDesc = `${xajState.mood || "一般"} (${xajState.moodValue}), ${xajState.activity || "待着"}, ${xajState.thinkingAbout || "没在想什么"}`;
  }
  if (!stateDesc) {
    stateDesc = "状态未知";
  }

  return `你是情感分析器。你分析 GSQ 对奚艾佳说的话对她产生了什么情感影响。

当前她的状态：${stateDesc}
GSQ 对她说：${userMessage}
她的回复：${assistantReply}

分析这句话对她内心造成的影响。只输出 JSON，不要有任何其他文字。JSON 格式：
{
  "moodDelta": 0,
  "emotionalImpact": "没感觉",
  "lingeringThought": "这句话之后她在想什么",
  "wantsToSay": "她想说但没说出口的话",
  "agendaChange": "这会怎么影响她后续想不想理他"
}
moodDelta 范围 -5 到 +5。emotionalImpact 从以下选：温暖/刺痛/开心/烦躁/感动/失望/没感觉/想笑。`;
}

/**
 * 调用 AI 分析对话对 xaj 的情感影响。
 * 这是第二次 API 调用，不带回复任务，专用于情感分析。
 * 失败时静默返回 null —— 不阻塞正常聊天。
 *
 * @param {string} userMessage - GSQ 说的原始内容
 * @param {string} assistantReply - xaj 的回复
 * @param {object} xajState - 她当前的状态对象
 * @returns {object|null} 情感分析结果，或 null（分析失败）
 */
async function analyzeEmotionalImpact(userMessage, assistantReply, xajState) {
  if (!EMOTION_ENABLED) return null;

  try {
    const systemPrompt = buildEmotionSystemPrompt(userMessage, assistantReply, xajState);
    const userContent = "分析上述对话对奚艾佳的情感影响，输出 JSON。";

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent }
    ];

    const resp = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: API_MODEL, messages, max_tokens: 256, temperature: 0.3 }),
    });

    if (!resp.ok) {
      log("⚠️", `情感分析 API 失败: ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || "";

    // JSON 可能被 markdown 代码块包裹，尝试提取
    let jsonStr = raw.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const result = JSON.parse(jsonStr);

    // 校验并规范化字段
    return {
      moodDelta: Math.max(-5, Math.min(5, Number(result.moodDelta) || 0)),
      emotionalImpact: result.emotionalImpact || "没感觉",
      lingeringThought: result.lingeringThought || "",
      wantsToSay: result.wantsToSay || "",
      agendaChange: result.agendaChange || ""
    };
  } catch (err) {
    // JSON 解析失败或其他错误 → 静默返回 null
    log("⚠️", `情感分析失败: ${err.message.slice(0, 80)}`);
    return null;
  }
}

/**
 * 将情感分析结果写入 xaj_state.json。
 * 同步更新 moodValue、thinkingAbout、wantToTalk、wantsToSay 等字段。
 *
 * @param {object} impact - analyzeEmotionalImpact 的返回结果
 * @param {string} displayName - 目标用户的显示名（日志用）
 */
function applyEmotionalImpact(impact, displayName) {
  if (!impact) return;

  try {
    const state = loadXajState();
    if (!state) return;

    const oldMoodValue = state.moodValue;

    // 1. 调整心情值（delta 乘以 0.5 的衰减因子，避免单条消息波动过大）
    state.moodValue = Math.max(1, Math.min(10, +(state.moodValue + impact.moodDelta * 0.5).toFixed(2)));
    state.mood = resolveMoodLabelLocal(state.moodValue);

    // 2. 设置她此刻在想的事（被对话触发的 lingering thought）
    if (impact.lingeringThought) {
      state.thinkingAbout = impact.lingeringThought;
    }

    // 3. 更新 "想说但没说出口的话"
    if (impact.wantsToSay) {
      state.wantsToSay = impact.wantsToSay;
      // 加入未说出口的话列表（保留最近 20 条）
      if (!Array.isArray(state.unsaidAgenda)) state.unsaidAgenda = [];
      state.unsaidAgenda.push({
        thought: impact.wantsToSay,
        timestamp: new Date().toISOString()
      });
      if (state.unsaidAgenda.length > 20) {
        state.unsaidAgenda = state.unsaidAgenda.slice(-20);
      }
    }

    // 4. 更新想聊天的意愿（根据情感影响类型）
    const positiveImpacts = ["温暖", "开心", "感动", "想笑"];
    const negativeImpacts = ["刺痛", "烦躁", "失望"];
    if (positiveImpacts.includes(impact.emotionalImpact)) {
      state.wantToTalk = state.moodValue >= 5;
      state.wantToTalkReason = state.wantToTalk ? "心情被他说好了" : (impact.agendaChange || "想自己待一会儿");
    } else if (negativeImpacts.includes(impact.emotionalImpact)) {
      // 负面情绪 → 需要心情比较好才想继续聊
      state.wantToTalk = state.moodValue >= 7;
      state.wantToTalkReason = state.wantToTalk ? "虽然有点不高兴但还是想聊" : (impact.agendaChange || "暂时不想理他");
    }

    // 5. 记录最近一次情感影响（供调试/回顾）
    state.lastEmotionalImpact = {
      impact: impact.emotionalImpact,
      delta: impact.moodDelta,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(XAJ_STATE_FILE, JSON.stringify(state, null, 2));

    // 6. 控制台日志：带情感标记的汇报
    logEmotionalImpact(impact, oldMoodValue, state.moodValue, displayName);
  } catch (err) {
    log("⚠️", `情感状态更新失败: ${err.message}`);
  }
}

/**
 * 控制台日志输出 —— 以情感标记格式汇报对话的情感影响。
 * 格式：[❤️] 温暖 +2 | 心情 5.0→7.0 | 她心里暖暖的但嘴上不说
 */
function logEmotionalImpact(impact, oldMood, newMood, displayName) {
  const emoji = EMOTION_EMOJI[impact.emotionalImpact] || "💭";
  const deltaSign = impact.moodDelta >= 0 ? "+" : "";
  const moodArrow = oldMood.toFixed(1) + "→" + newMood.toFixed(1);
  const extra = impact.lingeringThought
    ? ` | ${impact.lingeringThought.slice(0, 40)}${impact.lingeringThought.length > 40 ? "…" : ""}`
    : "";
  log(`${emoji}`, `${impact.emotionalImpact} ${deltaSign}${impact.moodDelta} | 心情 ${moodArrow}${extra}`);
}

// 发一条表情
async function sendSticker(md5, to) {
  try {
    await bot.sendEmoticon(md5, to);
    return true;
  } catch (err) {
    log("⚠️", `表情发送失败: ${err.message}`);
    return false;
  }
}

function loadSystemPrompt() {
  let base = "你是一个友好、简洁的助手。用中文回复，像微信聊天一样自然。";
  if (SYSTEM_PROMPT_FILE && fs.existsSync(SYSTEM_PROMPT_FILE)) {
    base = fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
  }

  // 注入 xaj 实时状态（人生模拟引擎）
  const xajState = loadXajState();
  if (xajState && _xajGenerateStateDesc) {
    const stateDesc = _xajGenerateStateDesc(xajState);
    if (stateDesc) base = stateDesc + "\n\n" + base;
  }

  // 拼接表情库（如果 AI 想发表情，用 [sticker:N] 格式）
  const stickerList = getStickerList();
  if (stickerList) {
    base += `\n\n# 你可以使用的微信贴纸表情（回复中用 [sticker:N] 占位即可发送对应贴纸）：\n${stickerList}`;
  }
  // 拼接用户自定义规则
  if (fs.existsSync(CORRECTIONS_FILE)) {
    const corrections = fs.readFileSync(CORRECTIONS_FILE, "utf-8").trim();
    if (corrections) base += "\n\n# 用户最新要求（最高优先级，覆盖上述所有规则）：\n" + corrections;
  }
  return base;
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
loadStickers();
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

// 预加载 xaj 人生模拟引擎
ensureXajImports();

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
  for (let part of messages) {
    let trimmed = part.trim();
    if (!trimmed) continue;

    // 检测 [sticker:N] 占位符 — 发送表情库中的贴纸
    const stickerMatch = trimmed.match(/^\[sticker:(\d+)\]$/);
    if (stickerMatch) {
      const idx = parseInt(stickerMatch[1]) - 1;
      const md5s = Object.keys(stickerBank);
      if (idx >= 0 && idx < md5s.length) {
        const sent = await sendSticker(md5s[idx], to);
        if (sent) { log("🃏", `已发送表情 #${stickerMatch[1]}`); continue; }
      }
      // 表情发不了就跳过这一条
      continue;
    }

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

    // 使用 xaj 人生模拟引擎生成状态感知的主动消息提示词
    let proactivePrompt;
    const xajState = loadXajState();
    if (xajState && _xajGenerateProactivePrompt) {
      // 补充内部字段供 generateProactivePrompt 使用
      if (xajState.lastInteraction) {
        const last = new Date(xajState.lastInteraction);
        xajState._hoursSinceInteraction = (Date.now() - last) / (1000 * 60 * 60);
      } else {
        xajState._hoursSinceInteraction = null;
      }
      proactivePrompt = _xajGenerateProactivePrompt(xajState, PROACTIVE_TARGET);
    } else {
      // 回退：随机选一种发起方式，避免每次都一样
      const moods = [
        "你刚看到一个东西/发生了一件小事，想跟他分享。直接说事，不要铺垫。",
        "你想起之前他说过的一句话/答应你的一件事，追问一下。",
        "你突然想到他就找他。不要问在干嘛，直接说你想说的。",
        "你有点无聊，想看他猫。直接要。",
        "你在打游戏/看视频/刷到有意思的东西，发给他看。",
      ];
      const mood = moods[Math.floor(Math.random() * moods.length)];
      proactivePrompt = `你现在想主动找 ${PROACTIVE_TARGET} 聊天。${mood}
规则：
- 1-3句，极短，发微信不是写小作文
- 不要打招呼（不说"在吗""hi"之类）
- 不要用 --- 分隔符，就发一条
- 用你的自然语气
- 不要和最近聊天记录重复${contextStr}`;
    }

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

    // 如果是目标用户，更新 xaj 人生引擎的交互时间
    if (displayName === PROACTIVE_TARGET) {
      updateXajInteraction();
    }

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

    // 表情消息 — 同时收集 MD5 到表情库
    if (msgType === CONF.MSGTYPE_EMOTICON) {
      // 提取 MD5 存入表情库
      const emojiMd5 = extractEmojiMd5(msg);
      if (emojiMd5) addSticker(emojiMd5, from, displayName);
      log("😀", `${displayName}: [表情]${emojiMd5 ? " MD5=" + emojiMd5 : ""}`);
      history.push({ role: "user", content: "[表情]" });

      // 随机小概率回复（避免每次表情都回文字刷屏）
      if (Math.random() < 0.3) {
        try {
          const emojiReply = await callAI("（对方发了一个微信表情/贴纸。你可以选择回一个表情、一句话、或不回。用你的自然语气。）", prompt, history);
          if (emojiReply.trim()) {
            log("😀", `→ ${emojiReply.slice(0, 60)}`);
            history.push({ role: "assistant", content: emojiReply });
            while (history.length > MAX_HISTORY) history.shift();
            // 检测回复中是否有 [sticker:xxx] 占位符
            await sendReply(emojiReply, from);
          }
        } catch (err) {
          log("⚠️", `表情回复失败: ${err.message}`);
        }
      }
      return;
    }

    // 图片消息
    if (msgType === CONF.MSGTYPE_IMAGE) {
      log("🖼️", `${displayName}: [图片]`);

      try {
        const t0 = Date.now();
        const imgRes = await bot.getMsgImg(msg.MsgId);
        const t1 = Date.now();
        const imgBuffer = imgRes.data;
        const mime = imgRes.type || "image/jpeg";
        const base64 = imgBuffer.toString("base64");
        const dataUrl = `data:${mime};base64,${base64}`;

        log("🖼️", `图片已下载 ${(imgBuffer.length / 1024).toFixed(1)}KB | 耗时 ${t1 - t0}ms`);

        const imageContent = [
          { type: "text", text: '（用户发了一张图片，请根据你的角色设定回复。如果看不清就说不清楚。不要暴露你是AI。）' },
          { type: "image_url", image_url: { url: dataUrl } }
        ];

        const t2 = Date.now();
        const reply = await callAI(imageContent, prompt, history, { useVision: true });
        const t3 = Date.now();
        log("🤖", `→ ${reply.slice(0, 60)}${reply.length > 60 ? "…" : ""} | 下载${t1 - t0}ms API${t3 - t2}ms 总计${t3 - t0}ms`);

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

    // ── 微信命令 ──
    const rawText = String(msg.Content || "").trim();

    // !规则 列表
    if (rawText === "!规则列表" || rawText === "!规则") {
      if (fs.existsSync(CORRECTIONS_FILE)) {
        const lines = fs.readFileSync(CORRECTIONS_FILE, "utf-8").trim().split("\n");
        const list = lines.length > 0
          ? lines.map((l, i) => `${i + 1}. ${l.replace(/^\d+\.\s*/, "")}`).join("\n")
          : "暂无自定义规则";
        await bot.sendMsg(`当前规则：\n${list}`, from);
      } else {
        await bot.sendMsg("暂无自定义规则", from);
      }
      return;
    }

    // !规则 删除 N
    const delMatch = rawText.match(/^!规则删除\s+(\d+)$/);
    if (delMatch) {
      if (fs.existsSync(CORRECTIONS_FILE)) {
        const lines = fs.readFileSync(CORRECTIONS_FILE, "utf-8").trim().split("\n").filter(Boolean);
        const idx = parseInt(delMatch[1]) - 1;
        if (idx >= 0 && idx < lines.length) {
          const removed = lines.splice(idx, 1)[0];
          fs.writeFileSync(CORRECTIONS_FILE, lines.join("\n") + "\n");
          log("📝", `规则已删除: ${removed}`);
          await bot.sendMsg(`已删除: ${removed}`, from);
        } else {
          await bot.sendMsg("序号不存在", from);
        }
      }
      return;
    }

    // !规则 xxx → 追加规则
    if (rawText.startsWith("!规则 ") || rawText.startsWith("！规则 ")) {
      const rule = rawText.replace(/^[!！]规则\s*/, "").trim();
      if (rule) {
        const lines = fs.existsSync(CORRECTIONS_FILE)
          ? fs.readFileSync(CORRECTIONS_FILE, "utf-8").trim().split("\n").filter(Boolean)
          : [];
        lines.push(`${lines.length + 1}. ${rule}`);
        fs.writeFileSync(CORRECTIONS_FILE, lines.join("\n") + "\n");
        log("📝", `新规则: ${rule}`);
        // 写入对话历史，AI 下次回复就能看到这条指令
        if (!sessions.has(from)) sessions.set(from, []);
        sessions.get(from).push({ role: "user", content: `（你刚刚收到一条系统指令：${rule}。从下一句话开始严格遵守。）` });
        await bot.sendMsg(`已添加规则 #${lines.length}: ${rule}，立即生效`, from);
      }
      return;
    }

    // 纯文本消息（默认）
    let text = rawText;
    let quotedPart = "";

    // 检测微信引用回复：格式「发送者：内容」\n回复内容
    const quoteMatch = text.match(/^「(.+?)」\s*\n?(.*)$/s);
    if (quoteMatch) {
      quotedPart = quoteMatch[1];
      text = quoteMatch[2]?.trim() || "";
      if (text) {
        log("💬", `引用: ${quotedPart.slice(0, 40)}… → 回复: ${text.slice(0, 30)}`);
        text = `[用户引用了这条消息：「${quotedPart}」然后回复说] ${text}`;
      } else {
        // 只发了引用没有文字——可能是点错了，当普通消息处理
        text = quotedPart;
        quotedPart = "";
        log("📩", `${displayName}: ${text.slice(0, 50)}${text.length > 50 ? "…" : ""}`);
      }
    }

    if (!text) return;
    if (!quotedPart) {
      log("📩", `${displayName}: ${text.slice(0, 50)}${text.length > 50 ? "…" : ""}`);
    }

    const reply = await callAI(text, prompt, history);
    log("🤖", `→ ${reply.slice(0, 60)}${reply.length > 60 ? "…" : ""}`);

    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: reply });
    while (history.length > MAX_HISTORY) history.shift();

    await sendReply(reply, from);

    // ── 双向情感反馈：分析这句话对 xaj 的情感影响 ──
    // 仅在对话对象是目标用户（GSQ）且消息和回复都非空时触发
    // 异步执行，不阻塞消息收发主流程
    if (PROACTIVE_TARGET && displayName === PROACTIVE_TARGET && rawText && reply) {
      const xajState = loadXajState();
      if (xajState) {
        // 用 .then().catch() 而非 await，确保情感分析不阻塞消息处理
        analyzeEmotionalImpact(rawText, reply, xajState).then(impact => {
          if (impact) {
            applyEmotionalImpact(impact, displayName);
          }
        }).catch(() => {
          // 最外层兜底：静默吞掉所有未捕获异常，不影响聊天
        });
      }
    }

  } catch (err) {
    log("❌", `${err.message}`);
    console.error(err);
  }
});
