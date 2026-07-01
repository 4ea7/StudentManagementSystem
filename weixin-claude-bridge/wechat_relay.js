#!/usr/bin/env node
/**
 * 微信 ↔ Claude 消息中转
 *
 * 微信消息 → inbox.jsonl → Claude Code 读取 → outbox.jsonl → 微信回复
 *
 * 用法:
 *   node wechat_relay.js [--self]    --self: 同时监听自己发给文件传输助手的消息
 */

import Wechat from "wechat4u";
import { default as qrcode } from "qrcode-terminal";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_FILE = path.join(__dirname, "wechat_sync.json");
const INBOX_FILE = path.join(__dirname, "wechat_inbox.jsonl");
const OUTBOX_FILE = path.join(__dirname, "wechat_outbox.jsonl");
const LISTEN_SELF = process.argv.includes("--self");

function log(tag, msg) { console.log(`[${new Date().toLocaleTimeString()}][${tag}] ${msg}`); }

// ── 初始化 ──
let bot;
try {
  bot = new Wechat(JSON.parse(fs.readFileSync(SYNC_FILE, "utf-8")));
  log("♻️", "恢复登录…");
  bot.restart();
} catch {
  bot = new Wechat();
  bot.start();
}

bot.on("uuid", (uuid) => {
  const qrUrl = `https://login.weixin.qq.com/l/${uuid}`;
  console.log("\n📱 扫码:\n");
  qrcode.generate(qrUrl, { small: true });
  console.log(`\n${qrUrl}\n`);
});

bot.on("login", () => {
  fs.writeFileSync(SYNC_FILE, JSON.stringify(bot.botData));
  log("✅", "登录成功，凭证已保存");
  console.log("\n🎧 等待消息…\n");
  console.log("  发送消息给你的微信 → 我(Claude)会在本地处理 → 回复回到微信\n");
});

bot.on("logout", () => { log("⚠️", "登出"); try { fs.unlinkSync(SYNC_FILE); } catch {} process.exit(0); });
bot.on("error", (err) => log("❌", err.message));

// ── 消息中转 ──
bot.on("message", async (msg) => {
  try {
    const text = String(msg.Content || "").trim();
    if (!text) return;

    const from = msg.FromUserName;
    const to = msg.ToUserName;
    const myName = (bot.user || {}).UserName;

    // 判断消息来源
    const isFromSelf = from === myName;
    const isToMe = to === myName;
    const isFromOther = !isFromSelf;

    // 策略：别人发给我的消息 → 转发给 Claude；自己发给文件传输助手的也转发（可选）
    if (!isFromOther && !(LISTEN_SELF && isFromSelf)) return;

    // 解析发送人名字
    const contacts = bot.contacts || {};
    const contact = contacts[from] || {};
    const displayName = contact.RemarkName || contact.NickName || from;

    // 对方发给我时，回复地址就是对方；自己发给自己时，回复到文件助手
    const replyTo = isFromOther ? from : "filehelper";

    // 写入收件箱
    const inboxEntry = {
      id: Date.now(),
      from: from,
      fromName: displayName,
      to: to,
      replyTo: replyTo,
      text: text,
      time: new Date().toISOString(),
    };
    fs.appendFileSync(INBOX_FILE, JSON.stringify(inboxEntry) + "\n");
    log("📩", `${displayName}: ${text.slice(0, 40)}${text.length > 40 ? "…" : ""}`);
    log("📥", `已写入 inbox`);

    // 等待 Claude 回复（轮询 outbox）
    const startTime = Date.now();
    const entryId = inboxEntry.id;
    while (Date.now() - startTime < 120_000) {
      await sleep(1500);
      const reply = checkOutbox(entryId);
      if (reply) {
        await bot.sendMsg(reply, replyTo);
        log("✅", `已回复: ${reply.slice(0, 40)}${reply.length > 40 ? "…" : ""}`);
        return;
      }
    }
    log("⏰", "等待超时（2分钟），未收到 Claude 回复");

  } catch (err) {
    log("❌", err.message);
  }
});

function checkOutbox(msgId) {
  if (!fs.existsSync(OUTBOX_FILE)) return null;
  const lines = fs.readFileSync(OUTBOX_FILE, "utf-8").trim().split("\n");
  const remaining = [];
  let found = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.id === msgId && !found) {
        found = entry.reply;
      } else {
        remaining.push(line);
      }
    } catch { remaining.push(line); }
  }
  if (found) fs.writeFileSync(OUTBOX_FILE, remaining.join("\n") + (remaining.length ? "\n" : ""));
  return found;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
