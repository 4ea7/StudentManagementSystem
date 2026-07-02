#!/usr/bin/env node
// 服务器端 AI Agent — 基于 DeepSeek function calling
// 用法: node server-agent.js "你的任务描述"
//       echo "任务" | node server-agent.js --stdin

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, exec } from "node:child_process";

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

const API_KEY = process.env.API_KEY;
const API_MODEL = process.env.API_MODEL || "deepseek-chat";
const API_BASE_URL = process.env.API_BASE_URL || "https://api.deepseek.com";

if (!API_KEY) {
  console.error("❌ API_KEY 未设置");
  process.exit(1);
}

// ── 工具定义 ──
const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_command",
      description: "在服务器上执行一条 bash 命令，返回 stdout/stderr。超时 30 秒。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" },
          reason: { type: "string", description: "为什么执行这条命令，一句话说明" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取服务器上的文件内容",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "文件绝对路径" },
          max_lines: { type: "integer", description: "最多读取行数，默认 200" }
        },
        required: ["filepath"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "写入/覆盖服务器上的文件。会先备份原文件（如有）到 .bak",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "文件绝对路径" },
          content: { type: "string", description: "要写入的内容" }
        },
        required: ["filepath", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "task_done",
      description: "任务完成，汇报结果。调用此工具结束 agent 循环。",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "任务完成总结" },
          details: { type: "string", description: "详细信息（可选）" }
        },
        required: ["summary"]
      }
    }
  }
];

// ── 工具实现 ──
function runCommand(cmd) {
  try {
    const stdout = execSync(cmd, {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 5,
      encoding: "utf-8",
      shell: "/bin/bash"
    });
    return { success: true, stdout: stdout.slice(0, 5000), stderr: "" };
  } catch (err) {
    return {
      success: false,
      stdout: err.stdout?.slice(0, 2000) || "",
      stderr: err.stderr?.slice(0, 2000) || err.message
    };
  }
}

function readFile(filepath, maxLines = 200) {
  try {
    if (!fs.existsSync(filepath)) return { error: `文件不存在: ${filepath}` };
    const content = fs.readFileSync(filepath, "utf-8");
    const lines = content.split("\n");
    if (lines.length <= maxLines) return { filepath, lines: lines.length, content };
    return {
      filepath,
      lines: lines.length,
      truncated: true,
      content: lines.slice(0, maxLines).join("\n"),
      hint: `... 文件共 ${lines.length} 行，仅显示前 ${maxLines} 行`
    };
  } catch (err) {
    return { error: err.message };
  }
}

function writeFile(filepath, content) {
  try {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 备份
    if (fs.existsSync(filepath)) {
      fs.copyFileSync(filepath, filepath + ".bak");
    }
    fs.writeFileSync(filepath, content, "utf-8");
    return { success: true, filepath, size: content.length, backedUp: fs.existsSync(filepath + ".bak") };
  } catch (err) {
    return { error: err.message };
  }
}

// ── API 调用 ──
async function callAPI(messages) {
  const res = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: API_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 4096
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

// ── 系统提示词 ──
const SYSTEM_PROMPT = `你是服务器管理 Agent，运行在 Ubuntu 24.04 上。
你的工作目录是 ${__dir}（wechat-bridge 项目）。

规则：
1. 收到任务后，用 run_command / read_file / write_file 逐步完成
2. 每次只调一个工具，不要批量
3. 命令要精确、安全，不要交互式命令
4. 修改文件前先 read_file 确认内容
5. 修改后验证（再 read_file 或 run_command 测试）
6. 完成后调 task_done 汇报
7. pm2 进程名: wechat-bridge
8. 项目主文件: wechat_bridge.js
9. 启动脚本: bash start.sh

用中文回复。`;

// ── 主循环 ──
async function main() {
  let task = process.argv.slice(2).join(" ");

  // 支持 stdin 管道
  if (!task && !process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    task = Buffer.concat(chunks).toString("utf-8").trim();
  }

  if (!task) {
    console.error("用法: node server-agent.js \"任务描述\"");
    console.error("      echo \"任务\" | node server-agent.js");
    process.exit(1);
  }

  console.log(`\n🤖 Agent 启动 | 模型: ${API_MODEL}`);
  console.log(`📋 任务: ${task.slice(0, 200)}${task.length > 200 ? "…" : ""}\n`);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task }
  ];

  let turn = 0;
  const MAX_TURNS = 15;

  while (turn < MAX_TURNS) {
    turn++;
    process.stdout.write(`[第 ${turn} 轮] 思考中… `);

    try {
      const data = await callAPI(messages);
      const choice = data.choices?.[0];
      const msg = choice?.message;

      if (!msg) {
        console.log("❌ 无响应");
        break;
      }

      // 有 tool_calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg); // assistant message with tool_calls

        for (const tc of msg.tool_calls) {
          const fn = tc.function;
          const args = JSON.parse(fn.arguments || "{}");

          let result;
          switch (fn.name) {
            case "run_command":
              console.log(`\n  🔧 执行: ${args.command.slice(0, 80)}`);
              console.log(`    原因: ${args.reason || "未说明"}`);
              result = runCommand(args.command);
              break;
            case "read_file":
              console.log(`\n  📖 读取: ${args.filepath}`);
              result = readFile(args.filepath, args.max_lines);
              break;
            case "write_file":
              console.log(`\n  ✏️  写入: ${args.filepath} (${args.content.length} 字符)`);
              result = writeFile(args.filepath, args.content);
              break;
            case "task_done":
              console.log(`\n✅ 完成: ${args.summary}`);
              if (args.details) console.log(`   ${args.details}`);
              console.log(`   共 ${turn} 轮`);
              return;
            default:
              result = { error: `未知工具: ${fn.name}` };
          }

          // 截断过长结果
          const resultStr = JSON.stringify(result, null, 2);
          const truncated = resultStr.length > 6000
            ? resultStr.slice(0, 6000) + `\n... (截断，原长 ${resultStr.length})`
            : resultStr;

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: truncated
          });

          // 打印结果摘要
          if (result.success !== undefined) {
            const icon = result.success ? "✅" : "❌";
            const preview = (result.stdout || result.stderr || "").slice(0, 200);
            console.log(`  ${icon} ${preview.replace(/\n/g, "\\n")}`);
          } else if (result.error) {
            console.log(`  ❌ ${result.error}`);
          } else if (result.content) {
            console.log(`  📄 ${result.lines || 0} 行`);
          }
        }
        console.log(""); // 空行
      }
      // 纯文本回复
      else if (msg.content) {
        console.log(`\n💬 ${msg.content.slice(0, 500)}`);
        messages.push(msg);
        // 如果模型没调 tool，可能是它在问问题或给建议，再给它一轮
        if (turn >= 3) {
          console.log("\n⚠️ 模型连续文本回复，可能不需要工具。结束。");
          break;
        }
      } else if (choice?.finish_reason === "stop") {
        console.log("⏹️ 模型结束");
        break;
      }
    } catch (err) {
      console.log(`\n❌ 错误: ${err.message}`);
      break;
    }
  }

  if (turn >= MAX_TURNS) {
    console.log(`\n⚠️ 达到最大轮次 (${MAX_TURNS})，结束`);
  }
}

main().catch(err => {
  console.error("Agent 异常:", err.message);
  process.exit(1);
});
