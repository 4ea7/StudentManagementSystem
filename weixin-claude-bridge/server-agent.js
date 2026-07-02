#!/usr/bin/env node
// 服务器端 AI Agent — 基于 DeepSeek function calling
// 用法:
//   node server-agent.js "你的任务描述"
//   echo "任务" | node server-agent.js --stdin
//   node server-agent.js --continue "继续上次会话"
//   node server-agent.js --cron "*/5 * * * *" "定时任务描述"
//   node server-agent.js --upgrade
//   node server-agent.js --snapshot
//   node server-agent.js --snapshot --diff snapshot_xxx.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, exec, spawn } from "node:child_process";

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

// ══════════════════════════════════════════════════════════════════
// 命令行参数解析（提前解析，确保 --help/--upgrade/--snapshot 无需 API_KEY）
// ══════════════════════════════════════════════════════════════════
function parseArgs() {
  const raw = process.argv.slice(2);
  const args = {
    task: "",
    stdin: false,
    continuing: false,
    cron: null,
    upgrade: false,
    snapshot: false,
    diffSnapshot: null,
    help: false
  };

  let i = 0;
  const taskParts = [];
  while (i < raw.length) {
    const a = raw[i];
    if (a === "--stdin" || a === "-i") {
      args.stdin = true;
    } else if (a === "--continue" || a === "-c") {
      args.continuing = true;
    } else if (a === "--cron") {
      args.cron = raw[++i] || null;
    } else if (a === "--upgrade") {
      args.upgrade = true;
    } else if (a === "--snapshot" || a === "-s") {
      args.snapshot = true;
    } else if (a === "--diff") {
      args.diffSnapshot = raw[++i] || null;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (!a.startsWith("--")) {
      taskParts.push(a);
    }
    i++;
  }

  args.task = taskParts.join(" ");
  return args;
}

const CLI_ARGS = parseArgs();

// --help（无需 API_KEY）
if (CLI_ARGS.help) {
  console.log(`
服务器端 AI Agent — 基于 DeepSeek function calling

用法:
  node server-agent.js "任务描述"              执行一次性任务
  echo "任务" | node server-agent.js           管道输入任务
  node server-agent.js --continue "任务"       继续上次会话
  node server-agent.js --cron "*/5 * * * *" "任务"  定时执行
  node server-agent.js --upgrade               git pull 并重启
  node server-agent.js --snapshot              保存系统状态快照
  node server-agent.js --snapshot --diff <file> 对比两个快照

选项:
  -c, --continue     继续上次保存的会话
  --cron <expr>      按 cron 表达式定时执行（5 字段）
  --upgrade          git pull + npm install + 重启
  -s, --snapshot     保存系统状态快照（pm2、磁盘、内存）
  --diff <file>      与指定快照文件对比（需配合 --snapshot）
  -h, --help         显示此帮助
`);
  process.exit(0);
}

// --upgrade（无需 API_KEY）
if (CLI_ARGS.upgrade) {
  console.log("🔄 开始自我更新…");
  console.log(`   工作目录: ${__dir}`);
  try {
    const gitOutput = execSync("git pull", { encoding: "utf-8", timeout: 30000, cwd: __dir });
    console.log(`   git pull: ${gitOutput.trim()}`);
  } catch (err) {
    console.error(`❌ git pull 失败: ${err.message}`);
    process.exit(1);
  }
  const pkgPath = path.join(__dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      execSync("npm install --no-audit --no-fund", { encoding: "utf-8", timeout: 60000, cwd: __dir, stdio: "inherit" });
    } catch { /* ignore */ }
  }
  console.log("♻️  重启 agent…");
  try {
    execSync("pm2 restart wechat-bridge 2>/dev/null || true", { encoding: "utf-8", timeout: 10000, cwd: __dir });
    console.log("✅ pm2 restart wechat-bridge 已发送");
  } catch {
    const childArgs = process.argv.slice(1);
    console.log(`⚠️ pm2 不可用，fork 重启: node ${childArgs.join(" ")}`);
    const child = spawn("node", childArgs, { cwd: __dir, detached: true, stdio: "ignore" });
    child.unref();
    console.log("✅ 新进程已启动");
  }
  process.exit(0);
}

// --snapshot（无需 API_KEY）
if (CLI_ARGS.snapshot) {
  const { filepath } = takeSnapshot();
  if (CLI_ARGS.diffSnapshot) {
    diffSnapshots(filepath, CLI_ARGS.diffSnapshot);
  } else {
    const files = listSnapshots().filter(f => f !== path.basename(filepath));
    if (files.length > 0) {
      const latest = path.join(__dir, files[files.length - 1]);
      console.log(`\n🔍 与最近快照对比: ${files[files.length - 1]}`);
      diffSnapshots(filepath, latest);
    }
  }
  process.exit(0);
}

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

// ══════════════════════════════════════════════════════════════════
// 新增：会话持久化
// ══════════════════════════════════════════════════════════════════
const SESSIONS_FILE = path.join(__dir, "agent_sessions.jsonl");

function saveSession(sessionId, task, messages, turns, status) {
  const record = {
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    task,
    turns,
    status,
    messages: messages.map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content.slice(0, 2000) : m.content,
      ...(m.tool_calls ? {
        tool_calls: m.tool_calls.map(tc => ({
          name: tc.function.name,
          arguments: tc.function.arguments?.slice(0, 500)
        }))
      } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {})
    }))
  };
  try {
    fs.appendFileSync(SESSIONS_FILE, JSON.stringify(record) + "\n", "utf-8");
  } catch (err) {
    console.error(`⚠️ 保存会话失败: ${err.message}`);
  }
}

function loadLastSession() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    console.error("⚠️ 没有历史会话记录");
    return null;
  }
  try {
    const text = fs.readFileSync(SESSIONS_FILE, "utf-8").trim();
    if (!text) return null;
    const lines = text.split("\n").filter(l => l.trim());
    const last = JSON.parse(lines[lines.length - 1]);
    console.log(`📂 加载上次会话: ${last.session_id}`);
    console.log(`   任务: ${last.task?.slice(0, 100)}`);
    console.log(`   轮次: ${last.turns}, 状态: ${last.status}`);
    // 返回精简的 messages（system + 摘要过的历史）
    const summaryMsg = `[历史会话摘要] 上次任务: "${last.task?.slice(0, 300)}", 共 ${last.turns} 轮, 状态: ${last.status}`;
    return { sessionId: last.session_id, summary: summaryMsg, lastTask: last.task };
  } catch (err) {
    console.error(`⚠️ 加载会话失败: ${err.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// 新增：简单 Cron 解析器（无外部依赖）
// ══════════════════════════════════════════════════════════════════
function parseCronExpr(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron 表达式需要 5 个字段，收到 ${parts.length} 个: ${expr}`);
  }

  function parseField(field, min, max) {
    if (field === "*") return { type: "all" };
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2), 10);
      if (isNaN(step) || step < 1 || step > max) throw new Error(`无效步长: ${field}`);
      return { type: "step", step };
    }
    // 具体值或逗号分隔
    const vals = field.split(",").map(v => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < min || n > max) throw new Error(`无效值: ${v} (范围 ${min}-${max})`);
      return n;
    });
    return { type: "values", values: vals };
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6)
  };
}

function cronMatches(parsed, date = new Date()) {
  function match(field, actual) {
    if (field.type === "all") return true;
    if (field.type === "step") return actual % field.step === 0;
    if (field.type === "values") return field.values.includes(actual);
    return false;
  }
  return (
    match(parsed.minute, date.getMinutes()) &&
    match(parsed.hour, date.getHours()) &&
    match(parsed.dayOfMonth, date.getDate()) &&
    match(parsed.month, date.getMonth() + 1) &&
    match(parsed.dayOfWeek, date.getDay())
  );
}

function nextCronTick(parsed) {
  // 从下一秒开始找，最多找 366 天
  const now = new Date();
  const candidate = new Date(now.getTime() + 60000); // 至少 1 分钟后
  candidate.setSeconds(0, 0);
  const limit = new Date(now.getTime() + 366 * 24 * 3600 * 1000);
  while (candidate <= limit) {
    if (cronMatches(parsed, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 新增：错误自愈 —— 过滤已知无害错误
// ══════════════════════════════════════════════════════════════════
const HARMLESS_PATTERNS = [
  /1205\s*==\s*0/i,                         // pm2 1205==0 状态码
  /SyntaxError.*旧日志/i,                    // 旧日志残留 JSON 解析错误
  /SyntaxError.*\.log/i,                     // 日志文件的 JSON 解析错误
  /ECONNRESET/i,                              // 连接重置（网络波动）
  /ETIMEDOUT/i,                               // 超时（临时网络问题）
  /EPIPE/i,                                   // 管道断开
  /Cannot find module.*\.log/i,              // 误把 .log 当模块加载
  /Unexpected token.*in JSON.*\.log/i,       // .log 文件 JSON 解析失败
  /pm2.*\[PM2\]\[ERROR\].*1205/i,            // pm2 1205 错误
];

function isHarmlessError(errMsg) {
  return HARMLESS_PATTERNS.some(p => p.test(errMsg));
}

function filterError(err) {
  const msg = typeof err === "string" ? err : (err?.message || err?.stderr || err?.stdout || String(err));
  if (isHarmlessError(msg)) {
    console.log(`🔇 已知无害错误，已过滤: ${msg.slice(0, 100)}`);
    return { filtered: true, original: msg };
  }
  return { filtered: false, original: msg };
}

// ══════════════════════════════════════════════════════════════════
// 新增：状态快照
// ══════════════════════════════════════════════════════════════════
function takeSnapshot() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const snap = {
    timestamp: new Date().toISOString(),
    hostname: (() => { try { return execSync("hostname", { encoding: "utf-8" }).trim(); } catch { return "unknown"; } })(),
    pm2: (() => { try { return execSync("pm2 jlist 2>/dev/null || echo '[]'", { encoding: "utf-8", timeout: 10000 }).trim(); } catch { return "[]"; } })(),
    disk: (() => { try { return execSync("df -h / 2>/dev/null || echo ''", { encoding: "utf-8", timeout: 10000 }).trim(); } catch { return ""; } })(),
    memory: (() => { try { return execSync("free -m 2>/dev/null || echo ''", { encoding: "utf-8", timeout: 10000 }).trim(); } catch { return ""; } })(),
    uptime: (() => { try { return execSync("uptime 2>/dev/null || echo ''", { encoding: "utf-8", timeout: 5000 }).trim(); } catch { return ""; } })(),
    nodeVersion: process.version,
    cwd: process.cwd()
  };
  const filename = `snapshot_${ts}.json`;
  const filepath = path.join(__dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(snap, null, 2), "utf-8");
  console.log(`📸 快照已保存: ${filepath}`);
  return { filepath, snap };
}

function diffSnapshots(newSnapPath, oldSnapPath) {
  if (!fs.existsSync(oldSnapPath)) {
    console.error(`❌ 旧快照不存在: ${oldSnapPath}`);
    return;
  }
  try {
    const oldSnap = JSON.parse(fs.readFileSync(oldSnapPath, "utf-8"));
    const newSnap = JSON.parse(fs.readFileSync(newSnapPath, "utf-8"));
    console.log("\n📊 快照对比:");
    console.log(`   时间: ${oldSnap.timestamp} → ${newSnap.timestamp}`);

    // PM2 对比
    let oldPm2, newPm2;
    try { oldPm2 = JSON.parse(oldSnap.pm2); } catch { oldPm2 = []; }
    try { newPm2 = JSON.parse(newSnap.pm2); } catch { newPm2 = []; }
    if (Array.isArray(oldPm2) && Array.isArray(newPm2)) {
      const oldNames = oldPm2.map(p => `${p.name}(${p.pm2_env?.status || "?"})`).join(", ");
      const newNames = newPm2.map(p => `${p.name}(${p.pm2_env?.status || "?"})`).join(", ");
      console.log(`   PM2 进程: [${oldNames}] → [${newNames}]`);
    }

    // 内存对比
    console.log(`   旧内存:\n${oldSnap.memory.split("\n").map(l => "     " + l).join("\n")}`);
    console.log(`   新内存:\n${newSnap.memory.split("\n").map(l => "     " + l).join("\n")}`);

    // 磁盘对比
    console.log(`   旧磁盘:\n${oldSnap.disk.split("\n").map(l => "     " + l).join("\n")}`);
    console.log(`   新磁盘:\n${newSnap.disk.split("\n").map(l => "     " + l).join("\n")}`);
  } catch (err) {
    console.error(`❌ 快照对比失败: ${err.message}`);
  }
}

function listSnapshots() {
  try {
    const files = fs.readdirSync(__dir).filter(f => f.startsWith("snapshot_") && f.endsWith(".json")).sort();
    if (files.length === 0) {
      console.log("📸 没有找到快照");
      return [];
    }
    console.log("📸 已有快照:");
    files.forEach((f, i) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(__dir, f), "utf-8"));
        console.log(`   ${i + 1}. ${f} — ${s.timestamp}`);
      } catch {
        console.log(`   ${i + 1}. ${f}`);
      }
    });
    return files;
  } catch (err) {
    console.error(`❌ 列出快照失败: ${err.message}`);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════
// 主循环（增强版，含会话持久化和错误自愈）
// ══════════════════════════════════════════════════════════════════
async function main(task, options = {}) {
  const {
    continuing = false,
    sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  } = options;

  console.log(`\n🤖 Agent 启动 | 模型: ${API_MODEL} | 会话: ${sessionId}`);
  console.log(`📋 任务: ${task.slice(0, 200)}${task.length > 200 ? "…" : ""}\n`);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT }
  ];

  // 如果有历史摘要（--continue），注入为上下文
  if (continuing && options.historySummary) {
    messages.push({ role: "system", content: options.historySummary });
  }

  messages.push({ role: "user", content: task });

  let turn = 0;
  const MAX_TURNS = 15;
  let finalStatus = "running";

  while (turn < MAX_TURNS) {
    turn++;
    process.stdout.write(`[第 ${turn} 轮] 思考中… `);

    try {
      const data = await callAPI(messages);
      const choice = data.choices?.[0];
      const msg = choice?.message;

      if (!msg) {
        console.log("❌ 无响应");
        finalStatus = "no_response";
        break;
      }

      // 有 tool_calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg); // assistant message with tool_calls

        for (const tc of msg.tool_calls) {
          const fn = tc.function;
          let args = {};
          try {
            args = JSON.parse(fn.arguments || "{}");
          } catch (parseErr) {
            const filtered = filterError(parseErr);
            if (filtered.filtered) {
              args = {};
            } else {
              throw parseErr;
            }
          }

          let result;
          switch (fn.name) {
            case "run_command": {
              console.log(`\n  🔧 执行: ${args.command?.slice(0, 80)}`);
              console.log(`    原因: ${args.reason || "未说明"}`);
              result = runCommand(args.command);
              // 错误自愈：过滤无害的命令输出
              if (!result.success) {
                const filtered = filterError(result.stderr || result.stdout || "");
                if (filtered.filtered) {
                  result.success = true;
                  result._filtered = true;
                  result.stdout = `[已知无害错误已过滤] ${filtered.original}`;
                  result.stderr = "";
                }
              }
              break;
            }
            case "read_file":
              console.log(`\n  📖 读取: ${args.filepath}`);
              result = readFile(args.filepath, args.max_lines);
              break;
            case "write_file":
              console.log(`\n  ✏️  写入: ${args.filepath} (${args.content?.length || 0} 字符)`);
              result = writeFile(args.filepath, args.content);
              break;
            case "task_done":
              console.log(`\n✅ 完成: ${args.summary}`);
              if (args.details) console.log(`   ${args.details}`);
              console.log(`   共 ${turn} 轮`);
              finalStatus = "done";
              // 保存会话
              saveSession(sessionId, task, messages, turn, "done");
              return { success: true, summary: args.summary, turns: turn, sessionId };
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
            const filtered = filterError(result.error);
            if (filtered.filtered) {
              console.log(`  🔇 已知无害错误已过滤`);
            } else {
              console.log(`  ❌ ${result.error}`);
            }
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
          finalStatus = "text_only";
          break;
        }
      } else if (choice?.finish_reason === "stop") {
        console.log("⏹️ 模型结束");
        finalStatus = "stopped";
        break;
      }
    } catch (err) {
      const filtered = filterError(err);
      if (filtered.filtered) {
        console.log(`🔇 已知无害错误: ${filtered.original.slice(0, 100)}`);
        // 不 break，继续下一轮
        messages.push({
          role: "user",
          content: `[系统] 上次操作遇到一个已知无害错误，已自动处理。请继续完成任务。`
        });
        continue;
      }
      console.log(`\n❌ 错误: ${err.message}`);
      finalStatus = "error";
      break;
    }
  }

  if (turn >= MAX_TURNS) {
    console.log(`\n⚠️ 达到最大轮次 (${MAX_TURNS})，结束`);
    finalStatus = "max_turns";
  }

  // 保存会话
  saveSession(sessionId, task, messages, turn, finalStatus);
  return { success: false, status: finalStatus, turns: turn, sessionId };
}

// ══════════════════════════════════════════════════════════════════
// 入口（--help/--upgrade/--snapshot 已在文件顶部提前处理）
// ══════════════════════════════════════════════════════════════════

// --cron
if (CLI_ARGS.cron) {
  if (!CLI_ARGS.task) {
    console.error("❌ --cron 需要指定任务描述");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = parseCronExpr(CLI_ARGS.cron);
  } catch (err) {
    console.error(`❌ Cron 表达式无效: ${err.message}`);
    process.exit(1);
  }

  const nextTick = nextCronTick(parsed);
  if (!nextTick) {
    console.error("❌ 无法找到下一个触发时间");
    process.exit(1);
  }

  console.log(`⏰ 定时任务已注册: ${CLI_ARGS.cron}`);
  console.log(`📋 任务: ${CLI_ARGS.task.slice(0, 200)}`);
  console.log(`⏭️  下次执行: ${nextTick.toLocaleString()}`);
  console.log("（等待触发…Ctrl+C 退出）\n");

  let runCount = 0;
  const MAX_CRON_RUNS = parseInt(process.env.MAX_CRON_RUNS, 10) || 0;

  async function cronRun() {
    if (MAX_CRON_RUNS > 0 && runCount >= MAX_CRON_RUNS) {
      console.log(`⏹️ 达到最大执行次数 (${MAX_CRON_RUNS})，退出`);
      process.exit(0);
    }
    runCount++;
    const ts = new Date().toISOString();
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔔 [${ts}] 定时触发 #${runCount}`);
    console.log(`${"=".repeat(60)}`);
    try {
      const result = await main(`${CLI_ARGS.task} (第 ${runCount} 次执行)`, {
        sessionId: `cron_${Date.now()}_${runCount}`
      });
      console.log(`📊 执行结果: ${result.success ? "成功" : result.status}, ${result.turns} 轮`);
    } catch (err) {
      const filtered = filterError(err);
      if (!filtered.filtered) {
        console.error(`❌ 定时任务异常: ${err.message}`);
      }
    }
  }

  // 立即执行第一次
  await cronRun();

  // 然后按 cron 调度
  const now = new Date();
  const nextAfterFirst = nextCronTick(parsed);
  if (nextAfterFirst) {
    const delay = Math.max(1000, nextAfterFirst.getTime() - now.getTime());
    setTimeout(async function scheduleNext() {
      await cronRun();
      const nxt = nextCronTick(parsed);
      if (nxt) {
        const d = Math.max(1000, nxt.getTime() - Date.now());
        console.log(`⏭️  下次执行: ${nxt.toLocaleString()} (${Math.round(d / 1000)}s 后)`);
        setTimeout(scheduleNext, d);
      }
    }, delay);
  }

  // 保活
  process.stdin.resume();
}

// 普通任务 / --continue
else {
  // 支持 stdin 管道
  let task = CLI_ARGS.task;
  if (!task && (CLI_ARGS.stdin || !process.stdin.isTTY)) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    task = Buffer.concat(chunks).toString("utf-8").trim();
  }

  if (!task) {
    console.error("用法: node server-agent.js \"任务描述\"");
    console.error("      echo \"任务\" | node server-agent.js");
    console.error("      node server-agent.js --help 查看更多选项");
    process.exit(1);
  }

  const options = {};
  if (CLI_ARGS.continuing) {
    const lastSession = loadLastSession();
    if (lastSession) {
      options.continuing = true;
      options.historySummary = lastSession.summary;
      task = `${task}\n\n[上下文: 继续上次会话 ${lastSession.sessionId}]`;
    }
  }

  const result = await main(task, options);

  if (!result.success) {
    console.error(`\n⚠️ 任务未成功完成 (${result.status})`);
    process.exit(1);
  }
}
