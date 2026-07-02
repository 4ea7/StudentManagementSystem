#!/usr/bin/env node
/**
 * xaj 广度训练 — 大量随机场景，覆盖各种对话可能
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

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
const API_MODEL = process.env.API_MODEL || "qwen-plus";
const API_BASE_URL = process.env.API_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode";
const systemPrompt = fs.readFileSync(path.join(__dir, "system_prompt_xaj.md"), "utf-8");

// ── 大量多样化的状态 ──
const STATES = [
  { desc: "[现在时刻: 01:30] 宿舍。舍友睡了。躺床上刷手机。无聊。脑子里：他睡了没。", mood: 6 },
  { desc: "[现在时刻: 08:15] 宿舍。刚醒，被窝里不想起。第一节有课。脑子里：要不要翘掉。", mood: 4.5 },
  { desc: "[现在时刻: 10:00] 教室。上课中。走神了。脑子里：窗外那只鸟好肥。", mood: 5 },
  { desc: "[现在时刻: 12:00] 食堂。排队打饭。人好多。脑子里：今天的红烧肉看着不错。", mood: 6 },
  { desc: "[现在时刻: 14:00] 图书馆。写作业。安静。脑子里：快递应该到了。", mood: 5.5 },
  { desc: "[现在时刻: 16:30] 宿舍。刚下课回来。瘫在椅子上。脑子里：今天老师讲的啥来着。", mood: 5 },
  { desc: "[现在时刻: 18:00] 在家。刚吃完。打瓦。脑子里：这把能赢。", mood: 7 },
  { desc: "[现在时刻: 19:30] 在外面。吃完饭散步。看到路边有只猫。脑子里：好想养。", mood: 7.5 },
  { desc: "[现在时刻: 21:00] 宿舍。洗完澡。吹头发。脑子里：今天打瓦连跪了好烦。", mood: 4 },
  { desc: "[现在时刻: 22:30] 在家。躺着刷视频。不想动。脑子里：他什么时候找我。", mood: 5 },
  { desc: "[现在时刻: 23:00] 宿舍。关灯了。翻来覆去睡不着。脑子里：白天他说那句话什么意思。", mood: 4.5 },
  { desc: "[现在时刻: 03:00] 失眠。室友都在睡。偷偷刷手机。脑子里：有点想找他但又不想显得太主动。", mood: 5 },
  { desc: "[现在时刻: 17:30] 在外面。刚买完东西。拎着袋子。心里美。脑子里：回去试给他看。", mood: 8.5 },
  { desc: "[现在时刻: 15:00] 在咖啡店。一个人喝东西。外面下雨。脑子里：雨什么时候停。", mood: 5.5 },
  { desc: "[现在时刻: 20:00] 在家。打瓦连赢三把。亢奋。脑子里：我真猛。", mood: 9 },
  { desc: "[现在时刻: 13:00] 在教室。午休。趴桌上。脑子里：好困。", mood: 4 },
  { desc: "[现在时刻: 11:00] 宿舍。长痘了。照镜子。烦躁。脑子里：为什么偏偏今天长。", mood: 3 },
  { desc: "[现在时刻: 06:30] 在家。被噩梦惊醒。心跳好快。脑子里：幸好是梦。", mood: 3.5 },
];

// ── 大量多样化的 GSQ 消息模板 ──
// 每个场景是一条消息序列，模拟真实对话的各种可能
const SCENE_POOL = [
  // 日常闲聊
  { msgs: ["在吗"], cat: "开场" },
  { msgs: ["干嘛呢"], cat: "开场" },
  { msgs: ["我今天看到一只跟你微信头像一样的猫"], cat: "分享" },
  { msgs: ["好无聊啊"], cat: "情绪" },
  { msgs: ["你今天干嘛了"], cat: "关心" },
  { msgs: ["我刚睡醒"], cat: "状态" },
  { msgs: ["饿死了还没吃饭"], cat: "状态" },
  { msgs: ["外面下雨了我没带伞"], cat: "状态" },

  // 猫相关（她最喜欢的话题）
  { msgs: ["看看小猫", "猫呢", "它怎么又在沙发下面"], cat: "猫" },
  { msgs: ["猫今天把我键盘踩了"], cat: "猫" },
  { msgs: ["这只猫好像瘦了"], cat: "猫" },

  // 游戏相关
  { msgs: ["打瓦吗"], cat: "游戏" },
  { msgs: ["我今天连跪五把", "队友全是演员"], cat: "游戏" },
  { msgs: ["刚才那把翻盘了 爽"], cat: "游戏" },
  { msgs: ["被队友喷了 说我是演员"], cat: "游戏" },

  // 关心/认真问事
  { msgs: ["你上次说的那个快递到了没"], cat: "关心" },
  { msgs: ["你感冒好点没"], cat: "关心" },
  { msgs: ["明天几点上课 我叫你"], cat: "关心" },
  { msgs: ["你上次说想吃的那家店我路过了"], cat: "关心" },
  { msgs: ["你身份证号发我 帮你抢票"], cat: "帮忙" },

  // 暧昧/试探
  { msgs: ["我刚梦到你了"], cat: "暧昧" },
  { msgs: ["你今天发的照片挺好看的"], cat: "暧昧" },
  { msgs: ["我睡不着"], cat: "暧昧" },
  { msgs: ["你猜我刚才看到什么了"], cat: "悬念" },

  // 惹她
  { msgs: ["我今天碰到一个女生 长得好像你"], cat: "惹事" },
  { msgs: ["我好像把你上次说的那个事忘了"], cat: "惹事" },
  { msgs: ["我不小心把你的东西弄丢了"], cat: "惹事" },

  // 他心情不好
  { msgs: ["今天好烦", "被老板骂了"], cat: "低落" },
  { msgs: ["我感觉我什么都做不好"], cat: "低落" },
  { msgs: ["身体不舒服 躺了一天了"], cat: "低落" },

  // 计划/未来
  { msgs: ["周末有空吗"], cat: "计划" },
  { msgs: ["你寒假回不回家"], cat: "计划" },
  { msgs: ["我明天去你那边 要不要出来"], cat: "计划" },

  // 搞笑/轻松
  { msgs: ["我给你看个东西", "笑死了"], cat: "搞笑" },
  { msgs: ["你猜我今天吃了什么", "巨难吃"], cat: "搞笑" },
  { msgs: ["我刚发现一个巨离谱的事情"], cat: "悬念" },

  // 深夜专属
  { msgs: ["在吗", "睡不着"], cat: "深夜" },
  { msgs: ["你还不睡"], cat: "深夜" },
  { msgs: ["我在想一件事"], cat: "深夜" },

  // 有来有回的多轮
  { msgs: ["在吗", "我刚忙完", "你今天怎么样"], cat: "多轮" },
  { msgs: ["我去吃饭了", "吃完了", "好撑"], cat: "多轮" },
  { msgs: ["我手机快没电了", "到家了", "充上电了"], cat: "多轮" },
  { msgs: ["你好像心情不好", "跟我说说", "不想说就算了"], cat: "多轮" },
];

async function callXaj(msg, history, stateDesc) {
  const fullSystem = stateDesc + "\n\n" + systemPrompt;
  const messages = [{ role: "system", content: fullSystem }];

  // 自提醒
  const lastXaj = [...history].reverse().find(m => m.role === "assistant");
  let userMsg = msg;
  if (lastXaj) {
    userMsg = `[你上一句说的是: "${lastXaj.content.replace(/\n/g,' ').slice(0,60)}"] ${msg}`;
  }
  messages.push(...history);
  messages.push({ role: "user", content: userMsg });

  const resp = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: API_MODEL, messages, max_tokens: 200, temperature: 0.7 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

function analyze(reply) {
  const issues = [];
  if (/thinkingAbout|moodValue/i.test(reply)) issues.push("状态字段泄露");
  const longP = reply.match(/（[^）]{20,}/);
  if (longP) issues.push(`长括号`);
  const fcl = (reply.match(/发错了/g)||[]).length + (reply.match(/别管/g)||[]).length;
  if (fcl >= 2) issues.push(`发错了/别管x${fcl}`);
  return issues;
}

function shuffle(arr) { for (let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }

async function main() {
  console.log("🔬 xaj 广度训练\n");

  const startTime = Date.now();
  const TRAIN_UNTIL = startTime + 10 * 60 * 1000;
  let totalReplies = 0, totalIssues = 0;
  const issueStats = {};

  // 随机排列场景，每轮不同顺序
  let scenes = shuffle([...SCENE_POOL]);

  while (Date.now() < TRAIN_UNTIL) {
    for (const scene of scenes) {
      if (Date.now() >= TRAIN_UNTIL) break;

      const state = STATES[Math.floor(Math.random() * STATES.length)];
      const history = [];

      for (const msg of scene.msgs) {
        try {
          const reply = await callXaj(msg, history, state.desc);
          history.push({ role: "user", content: msg });
          history.push({ role: "assistant", content: reply });
          totalReplies++;

          const issues = analyze(reply);
          if (issues.length > 0) {
            totalIssues += issues.length;
            issues.forEach(i => issueStats[i] = (issueStats[i]||0)+1);
            const preview = reply.replace(/\n/g, '⏎').slice(0, 80);
            console.log(`[${scene.cat}] ${msg} → ${preview} ${issues.join(',')}`);
          }
        } catch(e) {
          // skip API errors
        }
      }
    }
    // 重新洗牌
    scenes = shuffle([...SCENE_POOL]);
  }

  const elapsed = Math.round((Date.now()-startTime)/1000);
  console.log(`\n${"=".repeat(55)}`);
  console.log(`✅ ${elapsed}s | ${totalReplies}轮 | ${totalIssues}问题`);
  console.log("问题分布:", JSON.stringify(issueStats, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
