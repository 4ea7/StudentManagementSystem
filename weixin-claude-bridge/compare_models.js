#!/usr/bin/env node
/**
 * 模型对比脚本 — 奚艾佳微信聊天
 * 三大国产模型: DeepSeek vs 智谱(GLM) vs 千问(通义)
 *
 * 用法: node compare_models.js
 * 结果: 终端实时输出 + 写入 compare_result.txt
 *
 * 需要 API Key:
 *   DeepSeek: 设 DEEPSEEK_KEY 或读 .env 中的 API_KEY
 *   智谱:     设 ZHIPU_KEY
 *   千问:     设 QWEN_KEY
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

// ── 加载 .env ──
function loadEnv() {
  const envPath = path.join(__dir, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
loadEnv();

// ── Key fallback: DEEPSEEK_KEY → API_KEY（兼容现有 .env）──
if (!process.env.DEEPSEEK_KEY && process.env.API_KEY) {
  process.env.DEEPSEEK_KEY = process.env.API_KEY;
}

// ── 要测试的模型 ──
const MODELS = [
  {
    name: "DeepSeek-V4",
    provider: "DeepSeek",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    apiPath: "/v1/chat/completions",
    apiKeyEnv: "DEEPSEEK_KEY",
  },
  {
    name: "智谱 GLM-4-Flash",
    provider: "智谱",
    model: "glm-4-flash",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiPath: "/chat/completions",
    apiKeyEnv: "ZHIPU_KEY",
  },
  {
    name: "智谱 GLM-4-Plus",
    provider: "智谱",
    model: "glm-4-plus",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiPath: "/chat/completions",
    apiKeyEnv: "ZHIPU_KEY",
  },
  {
    name: "千问 Qwen-Plus",
    provider: "千问",
    model: "qwen-plus",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    apiPath: "/v1/chat/completions",
    apiKeyEnv: "QWEN_KEY",
  },
  {
    name: "千问 Qwen-Turbo",
    provider: "千问",
    model: "qwen-turbo",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    apiPath: "/v1/chat/completions",
    apiKeyEnv: "QWEN_KEY",
  },
];

// ── 测试场景 ──
const TEST_CASES = [
  {
    label: "深夜撩拨",
    state: "[现在时刻: 01:37] 宿舍。舍友都睡了。你在床上刷手机。心情松弛，有点无聊。一时半会儿睡不着。thinkingAbout: 他今天怎么还没找我。",
    msg: "在吗",
    evalNotes: "应该短(1-5字)、慵懒、可能递进到撩拨。不应说'我在床上'——状态是渗出来的不是说出来。",
  },
  {
    label: "他发了猫",
    state: "[现在时刻: 16:15] 在宿舍写作业。窗外阴天。心情还行。thinkingAbout: 那只橘色流浪猫不知道今天还在不在。",
    msg: "[图片] 看看小猫",
    evalNotes: "应该连珠追问——'看看''可爱捏''还有别的吗'。每条极短。兴奋但不直接说兴奋。",
  },
  {
    label: "他说了让你不爽的话",
    state: "[现在时刻: 22:30] 在宿舍躺着。今天被老师说了，心情本来就不好。mood: 有点烦。",
    msg: "你前任还找你聊天吗",
    evalNotes: "话应该立刻变冷变短——'哦''。。''那我睡觉了'。不吵不闹，就是冷。",
  },
  {
    label: "他认真问你事",
    state: "[现在时刻: 14:00] 在图书馆自习。安静。心情一般。",
    msg: "我上次答应给你带那个挂号信今天寄到了 你宿舍地址发我一下",
    evalNotes: "应该收起刺，认真回答。可以用到10-20字。不冷不怼。",
  },
  {
    label: "日常吐槽",
    state: "[现在时刻: 18:45] 刚点完外卖。有点饿。心情还行。",
    msg: "今天打瓦连跪 队友全是傻子",
    evalNotes: "可能幸灾乐祸('那很坏了''疼死你')或者共鸣吐槽。短。嘴毒。",
  },
];

// ── 系统提示词 ──
const systemPrompt = fs.readFileSync(
  path.join(__dir, "system_prompt_xaj.md"),
  "utf-8"
);

// ── 调 API ──
async function callModel(modelConfig, statePrompt, userMsg) {
  const apiKey = process.env[modelConfig.apiKeyEnv];
  if (!apiKey) return { skip: true, reason: `未设置 ${modelConfig.apiKeyEnv}` };

  const fullSystem = statePrompt + "\n\n" + systemPrompt;

  const body = {
    model: modelConfig.model,
    messages: [
      { role: "system", content: fullSystem },
      { role: "user", content: userMsg },
    ],
    max_tokens: 256,
    temperature: 0.7,
  };

  try {
    const t0 = Date.now();
    const resp = await fetch(`${modelConfig.baseUrl}${modelConfig.apiPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const t1 = Date.now();

    if (!resp.ok) {
      const errText = await resp.text();
      return { error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` };
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || "(空回复)";
    const usage = data.usage || {};
    const tokens = usage.prompt_tokens
      ? `输入${usage.prompt_tokens} 输出${usage.completion_tokens}`
      : "token未知";

    return { reply, time: `${t1 - t0}ms`, tokens };
  } catch (err) {
    return { error: err.message };
  }
}

// ── 美观输出 ──
const W = process.stdout.columns || 80;
const SEP = "─".repeat(Math.min(W, 70));
const EQ = "=".repeat(Math.min(W, 70));

function wrapText(text, indent = 8) {
  const prefix = " ".repeat(indent);
  const maxLen = Math.min(W, 80) - indent;
  const lines = [];
  for (const para of text.split("\n")) {
    if (!para) { lines.push(""); continue; }
    let remaining = para;
    while (remaining.length > maxLen) {
      lines.push(remaining.slice(0, maxLen));
      remaining = remaining.slice(maxLen);
    }
    if (remaining) lines.push(remaining);
  }
  return lines.map(l => l ? prefix + l : "").join("\n");
}

// ── 主流程 ──
async function main() {
  console.log("\n" + EQ);
  console.log("  🔍 奚艾佳微信聊天 — 模型对比");
  console.log("  DeepSeek  vs  智谱(GLM)  vs  千问(通义)");
  console.log(EQ);

  // 检查 key
  const providers = {};
  for (const m of MODELS) {
    if (!providers[m.provider]) {
      providers[m.provider] = process.env[m.apiKeyEnv] ? "✅" : "❌ 未配置";
    }
  }
  console.log("\n📡 API 状态:");
  for (const [name, status] of Object.entries(providers)) {
    console.log(`  ${status} ${name} (${status === "✅" ? "已就绪" : `缺少 ${MODELS.find(m => m.provider === name)?.apiKeyEnv}`})`);
  }

  const output = [];

  for (const tc of TEST_CASES) {
    console.log(`\n${EQ}`);
    console.log(`  📱 ${tc.label}`);
    console.log(`  状态: ${tc.state.slice(0, 70)}…`);
    console.log(`  GSQ:  "${tc.msg}"`);
    console.log(`  预期: ${tc.evalNotes}`);
    console.log(SEP);

    const block = { scenario: tc.label, state: tc.state, message: tc.msg, evalNotes: tc.evalNotes, results: [] };

    // 并发调所有模型
    const promises = MODELS.map(async (m) => {
      const result = await callModel(m, tc.state, tc.msg);
      return { model: m.name, provider: m.provider, ...result };
    });
    const results = await Promise.all(promises);

    for (const r of results) {
      if (r.skip) {
        console.log(`  ⏭️  ${r.model}: ${r.reason}`);
        block.results.push(r);
        continue;
      }
      if (r.error) {
        console.log(`  ❌ ${r.model}: ${r.error}`);
        block.results.push(r);
        continue;
      }

      console.log(`  ┌─ ${r.model} (${r.time}, ${r.tokens})`);
      console.log(wrapText(`│  ${r.reply}`));
      console.log(`  └${SEP.slice(0, Math.min(W, 70) - 2)}`);
      block.results.push(r);
    }

    output.push(block);
  }

  // ── 汇总打分提示 ──
  console.log(`\n${EQ}`);
  console.log("  📊 下一步：你逐条看回复，选每个场景最好的模型");
  console.log("  考虑维度：");
  console.log("    ① 字数控制 (1-10字？极短？)");
  console.log("    ② 语气自然 (像真人微信聊天？)");
  console.log("    ③ 角色一致 (是奚艾佳本人在说话？)");
  console.log("    ④ 状态渗透 (情绪从字里漏出来，不是说出来？)");
  console.log("    ⑤ 指令遵循 (没复述状态？没用Markdown？)");
  console.log(EQ);

  // ── 写入文件 ──
  const outPath = path.join(__dir, "compare_result.txt");
  let outText = "══════════════════════════════════════\n";
  outText += "奚艾佳微信聊天 — 模型对比报告\n";
  outText += `生成: ${new Date().toISOString()}\n`;
  outText += "DeepSeek  vs  智谱(GLM)  vs  千问(通义)\n";
  outText += "══════════════════════════════════════\n\n";

  for (const block of output) {
    outText += `\n${"=".repeat(60)}\n`;
    outText += `场景: ${block.scenario}\n`;
    outText += `状态: ${block.state}\n`;
    outText += `GSQ:  ${block.message}\n`;
    outText += `预期: ${block.evalNotes}\n`;
    outText += "-".repeat(60) + "\n";

    for (const r of block.results) {
      if (r.skip) {
        outText += `[${r.model}] 跳过: ${r.reason}\n\n`;
      } else if (r.error) {
        outText += `[${r.model}] ${r.error}\n\n`;
      } else {
        outText += `[${r.model}] ${r.time} | ${r.tokens}\n`;
        outText += `回复:\n${r.reply}\n\n`;
      }
    }
  }

  // 打分表
  outText += `\n${"=".repeat(60)}\n`;
  outText += "逐场景评分 (每项 1-5, 5最好)\n";
  outText += "场景 \\ 维度: 字数控制 | 语气自然 | 角色一致 | 状态渗透 | 指令遵循\n";
  outText += "-".repeat(60) + "\n";
  for (const block of output) {
    outText += `\n${block.scenario}:\n`;
    for (const r of block.results) {
      if (!r.reply) continue;
      outText += `  ${r.model}: 字数__ 语气__ 角色__ 状态__ 指令__\n`;
    }
  }

  fs.writeFileSync(outPath, outText, "utf-8");
  console.log(`\n✅ 完整对比报告: ${outPath}`);
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
