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
let _xajGenerateImpulsePrompt = null;

async function ensureXajImports() {
  if (_xajGenerateStateDesc) return;
  try {
    const mod = await import("./xaj_life.js");
    _xajGenerateStateDesc = mod.generateStateDescription;
    _xajGenerateProactivePrompt = mod.generateProactivePrompt;
    _xajGenerateImpulsePrompt = mod.generateImpulsePrompt;
    log("✅", "xaj_life.js 已加载");
  } catch (e) {
    log("⚠️", `xaj_life.js 加载失败: ${e.message}，将跳过人生状态注入`);
    // 设置空函数避免后续 null 调用
    _xajGenerateStateDesc = () => null;
    _xajGenerateProactivePrompt = () => null;
    _xajGenerateImpulsePrompt = () => null;
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
const CONVERSATION_MEMORY_FILE = path.join(scriptDir, "xaj_conversation_memory.json");
const HISTORY_SUMMARY_THRESHOLD = 40;  // 超过此值触发压缩
const HISTORY_KEEP_RECENT = 20;        // 压缩后保留最近 N 条

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

// ── 回复延迟系统 ──
// 根据 xaj 当前状态决定回复速度、是否已读不回，让回复更像真人

function calculateReplyDelay(xajState) {
  if (!xajState) return { delay: 2000 + Math.random() * 3000 };

  const mood = xajState.moodValue ?? 6;
  const affection = xajState.affection ?? 55;
  const activity = xajState.activity || "";
  const socialBattery = xajState.socialBattery ?? 7;
  const location = xajState.location || "";
  const hour = new Date().getHours();

  // ── 已读不回 ──
  let skipChance = 0;
  if (mood < 2.5) skipChance = 0.5;
  else if (mood < 4 && affection < 40) skipChance = 0.35;
  else if (mood < 4) skipChance = 0.15;
  else if (socialBattery < 3) skipChance = 0.4;
  else if (affection < 25) skipChance = 0.3;

  if (Math.random() < skipChance) {
    const reasons = ["不想说话", "看了但不想回", "没意思", "烦", "先放放"];
    return { skip: true, reason: reasons[Math.floor(Math.random() * reasons.length)] };
  }

  // ── 延迟（秒）──
  let sec = 3 + Math.random() * 5; // 基础 3-8s

  // 心情
  if (mood >= 8) sec -= 2;
  else if (mood >= 6.5) sec -= 1;
  if (mood < 4) sec += 10 + Math.random() * 20;
  else if (mood < 5) sec += 5 + Math.random() * 10;

  // 好感度
  if (affection >= 80) sec -= 2;
  else if (affection >= 65) sec -= 1;
  if (affection < 35) sec += 8 + Math.random() * 15;

  // 活动：忙的时候慢回
  const busyActs = ["打瓦", "打游戏", "上课", "写作业", "吃饭", "洗澡", "在外面", "看直播"];
  if (busyActs.some(a => activity.includes(a))) sec += 5 + Math.random() * 15;
  if (activity.includes("睡觉") || activity.includes("睡了")) sec += 30 + Math.random() * 60;

  // 深夜主场 → 快
  if (hour >= 1 && hour <= 4) sec -= 3;

  // 在路上 → 打字慢
  if (location.includes("外面") || location.includes("路上") || location.includes("步行")) sec += 5 + Math.random() * 10;

  // 随机抖动 ±40%
  sec *= 1 + (Math.random() - 0.5) * 0.8;

  return { delay: Math.max(1000, Math.round(sec * 1000)) };
}

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

  const affection = typeof xajState?.affection === "number" ? xajState.affection : 55;

  return `你是情感分析器。你分析 GSQ 对奚艾佳说的话对她产生了什么情感影响。

当前她的状态：${stateDesc}
当前好感度：${affection}/100（这是长期积累的感情，不同于一时的心情波动）

GSQ 对她说：${userMessage}
她的回复：${assistantReply}

分析这句话对她内心造成的影响。只输出 JSON，不要有任何其他文字。JSON 格式：
{
  "moodDelta": 0,
  "affectionDelta": 0,
  "emotionalImpact": "没感觉",
  "lingeringThought": "这句话之后她在想什么",
  "wantsToSay": "她想说但没说出口的话",
  "agendaChange": "这会怎么影响她后续想不想理他"
}
moodDelta 范围 -5 到 +5。
affectionDelta 范围 -2 到 +5。好感度是她对 GSQ 长期积累的感情（简单模式）：
  - 他正常跟你聊天、陪你说话 → 0~+1（他在花时间陪你，本身就加分）
  - 他说到做到、真诚关心、记住你说过的话、让你笑 → +2~+5
  - 他敷衍、提别的女生、说"下次"、很久不理你 → 0~-2（好感不轻易掉）
  - 记住：你心里其实喜欢他。日常互动就会自然涨好感，不容易掉。
emotionalImpact 从以下选：温暖/刺痛/开心/烦躁/感动/失望/没感觉/想笑。`;
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
      affectionDelta: Math.max(-2, Math.min(5, Number(result.affectionDelta) || 0)),
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

    // 1.5. 好感度（长期积累，涨上去就定住——不跌回历史峰值以下）
    if (typeof state.affection !== "number") state.affection = 55;
    if (typeof state.affectionPeak !== "number") state.affectionPeak = state.affection;
    const oldAffection = state.affection;
    let newAffection = Math.round(state.affection + impact.affectionDelta);
    // 追踪峰值
    if (newAffection > state.affectionPeak) state.affectionPeak = newAffection;
    // 地下室：不能低于峰值的 90%（涨上去就基本不会掉回去）
    const floor = Math.max(55, Math.round(state.affectionPeak * 0.9));
    state.affection = Math.max(floor, Math.min(100, newAffection));
    const affectionChanged = state.affection !== oldAffection;

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
      affectionDelta: impact.affectionDelta ?? 0,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(XAJ_STATE_FILE, JSON.stringify(state, null, 2));

    // 6. 控制台日志：带情感标记 + 好感度变化的汇报
    logEmotionalImpact(impact, oldMoodValue, state.moodValue, displayName, oldAffection, state.affection);
  } catch (err) {
    log("⚠️", `情感状态更新失败: ${err.message}`);
  }
}

/**
 * 控制台日志输出 —— 以情感标记格式汇报对话的情感影响。
 * 格式：[❤️] 温暖 +2 | 心情 5.0→7.0 | 她心里暖暖的但嘴上不说
 */
function logEmotionalImpact(impact, oldMood, newMood, displayName, oldAffection, newAffection) {
  const emoji = EMOTION_EMOJI[impact.emotionalImpact] || "💭";
  const deltaSign = impact.moodDelta >= 0 ? "+" : "";
  const moodArrow = oldMood.toFixed(1) + "→" + newMood.toFixed(1);
  const extra = impact.lingeringThought
    ? ` | ${impact.lingeringThought.slice(0, 40)}${impact.lingeringThought.length > 40 ? "…" : ""}`
    : "";
  const affStr = (oldAffection !== undefined && newAffection !== undefined && oldAffection !== newAffection)
    ? ` | 好感 ${oldAffection}→${newAffection}`
    : "";
  log(`${emoji}`, `${impact.emotionalImpact} ${deltaSign}${impact.moodDelta} | 心情 ${moodArrow}${extra}${affStr}`);
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

// ── 对话记忆系统 ──
// 聊多了自动总结归档，避免上下文窗口溢出导致遗忘

function loadConversationMemory() {
  try {
    if (fs.existsSync(CONVERSATION_MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(CONVERSATION_MEMORY_FILE, "utf-8"));
    }
  } catch (e) {}
  return { summaries: [], lastUpdated: null };
}

function saveConversationMemory(mem) {
  mem.lastUpdated = new Date().toISOString();
  if (mem.summaries.length > 15) mem.summaries = mem.summaries.slice(-15);
  fs.writeFileSync(CONVERSATION_MEMORY_FILE, JSON.stringify(mem, null, 2));
}

/** 异步压缩历史——把旧消息总结后归档，精简上下文窗口 */
async function summarizeAndArchive(history) {
  const toSummarize = history.slice(0, -HISTORY_KEEP_RECENT);
  if (toSummarize.length < 8) return;

  const convo = toSummarize
    .map(m => `[${m.role === "user" ? "GSQ" : "xaj"}]: ${typeof m.content === "string" ? m.content.slice(0, 100) : "[非文字]"}`)
    .join("\n");

  const prompt = `总结以下微信对话，用2-3句中文概括聊了什么、有什么重点、有没有约定/承诺。只输出总结文字。

${convo}`;

  try {
    const summary = await callAI(prompt, "你是对话总结器。用中文输出2-3句总结。", [], {});
    if (summary && summary.trim()) {
      const mem = loadConversationMemory();
      mem.summaries.push({
        date: new Date().toISOString(),
        summary: summary.trim(),
        messageCount: toSummarize.length
      });
      saveConversationMemory(mem);
      history.splice(0, toSummarize.length);
      log("🧠", `对话压缩: ${summary.trim().slice(0, 50)}… (${toSummarize.length}条→${history.length}条)`);
    }
  } catch (e) {
    // 压缩失败不阻塞
  }
}

function loadSystemPrompt() {
  let base = "你是一个友好、简洁的助手。用中文回复，像微信聊天一样自然。";
  if (SYSTEM_PROMPT_FILE && fs.existsSync(SYSTEM_PROMPT_FILE)) {
    base = fs.readFileSync(SYSTEM_PROMPT_FILE, "utf-8");
  }

  // 注入 xaj 实时状态（人生模拟引擎）
  const xajState = loadXajState();
  let stateDesc = "";
  if (xajState && _xajGenerateStateDesc) {
    stateDesc = _xajGenerateStateDesc(xajState);
    if (stateDesc) {
      base = `【以下是你此刻的内部状态——它影响你的情绪和语气，但不要逐字输出这些内容】\n${stateDesc}\n【内部状态结束——以下是你的人格设定】\n\n` + base;
    }
  }

  // 注入好感度行为规则（最高优先级，覆盖性格中的默认行为）
  if (xajState && typeof xajState.affection === "number") {
    const aff = xajState.affection;
    let affRule = "";
    if (aff >= 85) {
      affRule = `\n## 好感度: ${aff}/100（很高）\n你已经不太想怼他了。骂也是笑着骂——"疼死你"但语气是软的。冷暴力几乎不用了。他很久没回你也不会轰炸——最多发一条"还活着吗"。\n你会主动跟他分享你今天在干什么——看到好玩的、吃到好吃的、路边碰到的事——不是因为有话要说，是因为想让他知道你在干嘛。说话会腻——不是恶心的腻，是语气自己就软了、话变多了、偶尔发个表情然后等他回。你会比平时更在意他回没回。偶尔会说漏嘴的真心话，说了也不撤回。`;
    } else if (aff >= 70) {
      affRule = `\n## 好感度: ${aff}/100（偏高）\n比平时多一点耐心。怼还是会怼，但哄一下就过去了。冷暴力缩短——以前冷半小时，现在十分钟。他认真跟你说话的时候，你不会刺他。\n你会时不时跟他分享一下你的事——今天吃了什么、看到了什么——不是刻意的，就是想到了就跟他说一声。语气比平时软一点，但你自己不一定注意到。`;
    } else if (aff >= 50) {
      affRule = `\n## 好感度: ${aff}/100（正常偏高）\n你基本保持本色。嘴毒心软。偶尔会因为他做了什么而稍微温柔一点，但他要是飘了你就收回。`;
    } else if (aff >= 35) {
      affRule = `\n## 好感度: ${aff}/100（正常偏低）\n你该怎么样就怎么样。他没什么特别值得你温柔的。`;
    } else if (aff >= 20) {
      affRule = `\n## 好感度: ${aff}/100（偏低）\n你对他没什么耐心。他说什么你都觉得烦。容易冷。不想回的时候就不回。`;
    } else {
      affRule = `\n## 好感度: ${aff}/100（很低）\n你不太想搭理他。回消息是给面子。随时可能已读不回。他认真问你事你都不一定好好答。`;
    }
    // 好感度规则插入到状态描述之后、系统提示词之前
    base = affRule + "\n" + base;
  }

  // 注入对话记忆（最近几段对话的概括）
  const mem = loadConversationMemory();
  if (mem.summaries.length > 0) {
    const recent = mem.summaries.slice(-5);
    const summaryText = recent.map(s => `[${s.date?.slice(0,16)?.replace("T"," ")}] ${s.summary}`).join("\n");
    base += `\n\n# 你们之前聊过的事（概括，用于保持上下文连贯）：\n${summaryText}\n（以上是你们聊过的内容概括——你不是在"回忆"，你只是自然地在对话中体现你们聊过这些事。）`;
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

// ── 消息归集窗口 ──
// GSQ 喜欢一句话拆开多条发（连珠炮），不能他发半句就回。
// 收到一条后等 GATHERING_WINDOW 秒，如果他接着发就合并到一起再回。
const GATHERING_WINDOW = 5000; // 归集窗口 5 秒（再 ±3s 随机）
const pendingReplies = new Map(); // from → { timer, reply }

/** 安排回复：取消旧定时器，设新的归集窗口，到期后延迟发送。
 *  只有在真正发送时才写入历史，避免被取消的回复污染上下文。 */
function scheduleReply(from, reply, history, userText, xajState) {
  // 取消旧的待发回复（被归集覆盖的那条不会进历史）
  const existing = pendingReplies.get(from);
  if (existing) {
    clearTimeout(existing.timer);
    log("📥", "归集窗口重置（对方连发中，等发完再回）");
  }

  // 设新的归集窗口
  const windowMs = GATHERING_WINDOW + Math.random() * 3000; // 5-8s 随机
  const timer = setTimeout(async () => {
    pendingReplies.delete(from);

    // 归集完成 → 延迟发送
    const decision = calculateReplyDelay(xajState || loadXajState());
    if (decision.skip) {
      log("👻", `已读不回: ${decision.reason}`);
      // 已读不回也要写历史（下次 AI 知道她看到了但没回）
      history.push({ role: "assistant", content: "[已读不回]" });
      while (history.length > MAX_HISTORY) history.shift();
      return;
    }
    log("⏱️", `延迟 ${(decision.delay/1000).toFixed(1)}s 后回复`);
    await sleep(decision.delay);
    // 真正发送时才写入 assistant 回复到历史
    history.push({ role: "assistant", content: reply });
    while (history.length > MAX_HISTORY) history.shift();
    await sendReply(reply, from);
  }, windowMs);

  pendingReplies.set(from, { timer, reply });
}

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

  // 进一步拆分：用单换行分隔的短句也各自独立发送
  const messages = [];
  for (const part of (parts.length > 0 ? parts : [reply])) {
    if (part.includes("\n")) {
      const lines = part.split(/\r?\n/).filter(p => p.trim());
      messages.push(...lines);
    } else {
      messages.push(part);
    }
  }

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
    // 模拟打字时间：每条消息根据长度 + 随机思考间隔
    const charCount = trimmed.length;
    const typingSec = Math.max(1.5, charCount * 0.3 + Math.random() * 2); // 每字0.3秒 + 0-2秒思考
    await sleep(Math.round(typingSec * 1000));
  }
  log("✅", `已发送 ${messages.length} 条`);
}

// ── 主动消息（事件驱动）──
//  不再使用随机间隔定时器。改为定期检查 xaj_state.json 的 impulseToMessage，
//  当 xaj 的生活中发生"值得告诉 GSQ"的事件时，才触发主动消息。
//  intensity → 发送策略：high 立即发、medium 延迟发、low 可能不发。

let proactiveTargetName = null;  // 解析后的 UserName
let proactiveTimer = null;       // 轮询定时器 / 延迟发送定时器
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

/**
 * 清除 xaj_state.json 中的 impulseToMessage，标记为已处理。
 * 防止同一条冲动被重复发送。
 */
function clearImpulseToMessage() {
  try {
    const state = loadXajState();
    if (!state || !state.impulseToMessage) return;
    state.impulseToMessage = { triggered: false, reason: null, intensity: null, whatToSay: null, timestamp: null };
    fs.writeFileSync(XAJ_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    // 静默失败
  }
}

/**
 * 事件驱动的主动消息检查与发送。
 * 由轮询定时器调用（每 30-60 秒一次）。
 * 检查 xaj_state.json → 如果有 impulseToMessage → 按 intensity 决定是否发/何时发。
 */
async function checkAndSendProactive() {
  try {
    if (!proactiveTargetName || !bot?.CONF) {
      scheduleNextPoll();
      return;
    }

    // 夜间免打扰：不检查，等天亮再说
    if (isQuietHours()) {
      const delay = msUntilActive() + Math.random() * 30 * 60 * 1000; // 天亮后 + 0~30min 随机
      const nextTime = new Date(Date.now() + delay).toLocaleTimeString();
      log("🌙", `免打扰时段，下次检查: ${nextTime}`);
      proactiveTimer = setTimeout(checkAndSendProactive, delay);
      return;
    }

    // 读取 xaj 状态，检查是否有冲动
    const xajState = loadXajState();
    if (!xajState || !xajState.impulseToMessage || !xajState.impulseToMessage.triggered) {
      // 没有冲动，继续轮询
      scheduleNextPoll();
      return;
    }

    const impulse = xajState.impulseToMessage;
    const intensity = impulse.intensity || "medium";

    // ── 好感度感知的主动消息逻辑 ──
    // 好感度越高 → 冷却越短、越容易发、越主动
    const affection = typeof xajState?.affection === "number" ? xajState.affection : 55;

    // 动态冷却时间（分钟）
    const effectiveCooldown = affection >= 85 ? Math.max(2, Math.floor(PROACTIVE_COOLDOWN * 0.15)) :
                              affection >= 70 ? Math.max(5, Math.floor(PROACTIVE_COOLDOWN * 0.35)) :
                              affection >= 55 ? PROACTIVE_COOLDOWN :
                              Math.floor(PROACTIVE_COOLDOWN * 1.5); // 好感度低 → 冷却更长

    // 检查冷却：对方刚聊完 effectiveCooldown 分钟内，low 不打扰；medium 看好感度
    const quietTime = (Date.now() - lastInteractionTime) / 1000 / 60;
    if (quietTime < effectiveCooldown && intensity !== "high") {
      // 好感度 >= 80 时 medium 也不管冷却，照发
      if (intensity === "medium" && affection >= 80) {
        log("💕", `好感度 ${affection}，medium 冲动无视冷却 (${quietTime.toFixed(0)}/${effectiveCooldown}min)`);
        // 继续执行，不跳过
      } else if (intensity === "low" && affection >= 85) {
        log("💕", `好感度 ${affection}，low 冲动无视冷却`);
        // 继续执行
      } else {
        log("⏸️", `冷却中 (${quietTime.toFixed(0)}/${effectiveCooldown}min)，跳过 ${intensity} 冲动`);
        clearImpulseToMessage();
        scheduleNextPoll();
        return;
      }
    }

    // 最近一条是 AI 发的且对方没回 → 好感度高就允许连发
    const history = sessions.get(proactiveTargetName) || [];
    const lastMsg = history[history.length - 1];
    const noReplyThreshold = affection >= 80 ? effectiveCooldown * 0.5 :
                              affection >= 65 ? effectiveCooldown * 1 :
                              effectiveCooldown * 2;
    if (lastMsg && lastMsg.role === "assistant" && quietTime < noReplyThreshold && intensity !== "high") {
      if (affection >= 80) {
        log("💕", `好感度 ${affection}，允许连发 (上次未回复)`);
        // 继续执行
      } else {
        log("⏸️", `上次消息未回复，跳过 ${intensity} 冲动`);
        clearImpulseToMessage();
        scheduleNextPoll();
        return;
      }
    }

    // 按 intensity + 好感度 决定发送策略
    if (intensity === "high") {
      // high 也不是无限连发——至少间隔 5 分钟
      const lastHighSent = pendingReplies.get("__last_high_sent__") || 0;
      const highGap = (Date.now() - lastHighSent) / 60000;
      if (highGap < 5) {
        log("⏸️", `high 冲动间隔过短 (${highGap.toFixed(1)}/5min)，跳过`);
        clearImpulseToMessage();
        scheduleNextPoll();
        return;
      }
      pendingReplies.set("__last_high_sent__", Date.now());
      log("💡", `检测到 high 冲动: ${impulse.reason?.slice(0, 40)}`);
      await sendImpulseMessage(xajState, impulse);
    } else if (intensity === "medium") {
      // 好感度 >= 80: medium → 立即发（不延迟）
      const delay = affection >= 80 ? 0 :
                    (1 + Math.random() * 9) * 60 * 1000; // 1~10 min
      if (delay === 0) {
        log("💡", `检测到 medium 冲动: ${impulse.reason?.slice(0, 40)} — 好感度${affection}，立即发送`);
        await sendImpulseMessage(xajState, impulse);
        scheduleNextPoll();
        return;
      }
      log("💡", `检测到 medium 冲动: ${impulse.reason?.slice(0, 40)} — ${(delay / 60000).toFixed(0)}分钟后发送`);
      proactiveTimer = setTimeout(async () => {
        // 延迟后再次检查免打扰和冷却
        if (isQuietHours()) {
          log("🌙", `延迟到发送时已进入免打扰，取消`);
          clearImpulseToMessage();
          scheduleNextPoll();
          return;
        }
        const freshState = loadXajState();
        if (freshState && freshState.impulseToMessage && freshState.impulseToMessage.triggered) {
          await sendImpulseMessage(freshState, freshState.impulseToMessage);
        }
        scheduleNextPoll();
      }, delay);
      return; // 不 scheduleNextPoll，等延迟回调
    } else {
      // low: 好感度越高发送概率越大
      const lowChance = affection >= 85 ? 0.9 :
                         affection >= 70 ? 0.75 :
                         affection >= 55 ? 0.5 :
                         0.25; // 好感度低 → 懒得主动
      if (Math.random() < lowChance) {
        // 好感度 >= 75: low 不延迟，直接发
        const delay = affection >= 75 ? 0 : Math.random() * 5 * 60 * 1000;
        if (delay === 0) {
          log("💡", `检测到 low 冲动 (好感度${affection}, 概率${(lowChance*100).toFixed(0)}%): ${impulse.reason?.slice(0, 40)} — 立即发送`);
          await sendImpulseMessage(xajState, impulse);
          scheduleNextPoll();
          return;
        }
        log("💡", `检测到 low 冲动 (好感度${affection}, 概率${(lowChance*100).toFixed(0)}%): ${impulse.reason?.slice(0, 40)} — 抽中发送`);
        proactiveTimer = setTimeout(async () => {
          if (isQuietHours()) {
            clearImpulseToMessage();
            scheduleNextPoll();
            return;
          }
          const freshState = loadXajState();
          if (freshState && freshState.impulseToMessage && freshState.impulseToMessage.triggered) {
            await sendImpulseMessage(freshState, freshState.impulseToMessage);
          }
          scheduleNextPoll();
        }, delay);
        return;
      } else {
        log("💤", `检测到 low 冲动 (好感度${affection}, 概率${(lowChance*100).toFixed(0)}%): ${impulse.reason?.slice(0, 40)} — 抽空，不发`);
        clearImpulseToMessage();
      }
    }

    scheduleNextPoll();
  } catch (err) {
    log("⚠️", `主动消息检查失败: ${err.message}`);
    scheduleNextPoll();
  }
}

/**
 * 发送一条事件驱动的主动消息。
 * 使用 impulseToMessage + 当前状态来构建 prompt，确保消息跟她此刻的状态一致。
 */
async function sendImpulseMessage(xajState, impulse) {
  try {
    const history = sessions.get(proactiveTargetName) || [];
    const prompt = loadSystemPrompt();

    // 拿最近历史作为上下文（避免复读）
    const recentHistory = history.slice(-6);
    const contextStr = recentHistory.length > 0
      ? `\n\n最近聊天（参考，别复读）：\n${recentHistory.map(m => `[${m.role === "user" ? PROACTIVE_TARGET : "你"}]: ${typeof m.content === "string" ? m.content.slice(0, 80) : "[非文字]"}`).join("\n")}`
      : "";

    // 使用 impulse 数据构建提示词
    let proactivePrompt;
    if (xajState && _xajGenerateImpulsePrompt) {
      // 补充内部字段
      if (xajState.lastInteraction) {
        const last = new Date(xajState.lastInteraction);
        xajState._hoursSinceInteraction = (Date.now() - last) / (1000 * 60 * 60);
      } else {
        xajState._hoursSinceInteraction = null;
      }
      proactivePrompt = _xajGenerateImpulsePrompt(xajState, PROACTIVE_TARGET);
    }

    // 如果 impulse prompt 生成失败，回退到旧的 generateProactivePrompt
    if (!proactivePrompt && _xajGenerateProactivePrompt) {
      if (xajState.lastInteraction) {
        const last = new Date(xajState.lastInteraction);
        xajState._hoursSinceInteraction = (Date.now() - last) / (1000 * 60 * 60);
      }
      proactivePrompt = _xajGenerateProactivePrompt(xajState, PROACTIVE_TARGET);
    }

    // 最终回退：直接用 impulse 数据构建简单 prompt（含好感度感知）
    if (!proactivePrompt) {
      const reason = impulse.reason || "发生了一件小事";
      const whatToSay = impulse.whatToSay || "想跟你说个事";
      const affection = typeof xajState?.affection === "number" ? xajState.affection : 55;
      const affTone = affection >= 80 ? "\n你现在很喜欢跟他说话。分享欲很强——你会把你看到的、想到的、感受到的自然告诉他。语气是软的、带一点腻歪，但不是刻意的——是你自己都没注意到自己变甜了。" :
                       affection >= 65 ? "\n你对他有一点好感。分享的时候会比平时多说几句，语气比平时轻一点。" :
                       "";
      proactivePrompt = `你现在想主动找 ${PROACTIVE_TARGET} 聊天。
为什么找他：${reason}
你想说的：${whatToSay}${affTone}

规则：
- 1-3句。直接说你想说的——像脑子里蹦出来的，像发朋友圈。
- 不要"在吗""hi""干嘛呢"这种开场。
- 多句话用 --- 分隔（每条自己独立成行）
- 风格随机：可以兴奋、懒散、碎碎念、突然、钓鱼——不要每次都一样${contextStr}`;
    }

    const reply = await callAI(proactivePrompt, prompt, []);
    if (!reply || !reply.trim()) {
      clearImpulseToMessage();
      return;
    }

    log("💬", `主动 → ${PROACTIVE_TARGET}: ${reply.slice(0, 60).replace(/\n/g, '\\n')}${reply.length > 60 ? "…" : ""}`);

    history.push({ role: "assistant", content: reply.trim() });
    while (history.length > MAX_HISTORY) history.shift();

    // 使用 sendReply 而不是 bot.sendMsg —— 让消息拆分逻辑统一处理
    await sendReply(reply, proactiveTargetName);
    log("✅", "主动消息已发送");
  } catch (err) {
    log("⚠️", `主动消息发送失败: ${err.message}`);
  }

  // 无论成功失败，清除冲动（避免死循环重试）
  clearImpulseToMessage();
}

/**
 * 安排下一次轮询（30-60 秒后）。
 * 轮询间隔加入少量随机，避免与 xaj_life tick 严格同步。
 */
function scheduleNextPoll() {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  if (!PROACTIVE_ENABLED || !proactiveTargetName) return;

  const delay = (30 + Math.random() * 30) * 1000; // 30~60 秒
  proactiveTimer = setTimeout(checkAndSendProactive, delay);
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
  log("💡", `事件驱动模式: 每 30-60s 检查 xaj 的冲动信号`);

  // 启动后等 30 秒开始首次检查（让 xaj_life 有机会产生初始状态）
  proactiveTimer = setTimeout(checkAndSendProactive, 30 * 1000);
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

        const imgDelay = calculateReplyDelay(loadXajState());
        if (imgDelay.skip) {
          log("👻", `图片已读不回: ${imgDelay.reason}`);
        } else {
          await sleep(imgDelay.delay);
          await sendReply(reply, from);
        }
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

    // 检测微信引用回复：格式「发送者：内容」\n---分隔线---\n回复内容
    const quoteMatch = text.match(/^「(.+?)」\s*\n?(.*)$/s);
    if (quoteMatch) {
      quotedPart = quoteMatch[1];
      let rawReply = quoteMatch[2]?.trim() || "";

      // 去掉微信自动生成的引用分隔线（- - - - - 或 ————— 等）
      rawReply = rawReply.replace(/^[-—]+\s*[-—\s]*\n?/gm, "").trim();

      text = rawReply || "";
      if (text) {
        log("💬", `引用: ${quotedPart.slice(0, 40)}… → 回复: ${text.slice(0, 30)}`);
        text = `[用户引用了这条消息：「${quotedPart}」然后回复说] ${text}`;
      } else {
        // 只发了引用没有文字——当普通消息，只传引用内容
        text = quotedPart;
        quotedPart = "";
        log("📩", `${displayName}: [引用] ${text.slice(0, 50)}${text.length > 50 ? "…" : ""}`);
      }
    }

    if (!text) return;
    if (!quotedPart) {
      log("📩", `${displayName}: ${text.slice(0, 50)}${text.length > 50 ? "…" : ""}`);
    }

    // 注入上一句自己的回复——防止她说出矛盾的状态（"在拍衣服"→"刚洗完澡"）
    const lastXajMsg = [...history].reverse().find(m => m.role === "assistant");
    const selfReminder = lastXajMsg && typeof lastXajMsg.content === "string" && lastXajMsg.content.trim()
      ? `[你上一句说的是: "${lastXajMsg.content.replace(/\n/g, ' ').slice(0, 80)}"。你此刻的状态要跟你刚说过的一致。] ${text}`
      : text;

    const reply = await callAI(selfReminder, prompt, history);
    log("🤖", `→ ${reply.slice(0, 60)}${reply.length > 60 ? "…" : ""}`);

    // 用户消息立即写入历史
    history.push({ role: "user", content: text });
    while (history.length > MAX_HISTORY) history.shift();

    // 消息归集 + 延迟发送（AI 回复只有真正发出时才写历史）
    scheduleReply(from, reply, history, text, loadXajState());

    // 定期压缩旧对话（异步，不阻塞）
    if (history.length > HISTORY_SUMMARY_THRESHOLD) {
      summarizeAndArchive(history).catch(() => {});
    }

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
