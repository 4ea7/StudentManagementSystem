#!/usr/bin/env node
/**
 * 奚艾佳人生模拟引擎 (xaj_life.js)
 *
 * 独立进程，每分钟更新一次她的状态，写入 xaj_state.json。
 * wechat_bridge.js 收到消息时读取这个文件，把她的当前状态注入 system prompt。
 *
 * 用法:
 *   node xaj_life.js            # 守护进程模式，每分钟更新
 *   node xaj_life.js --once     # 单次更新后退出（测试用）
 *   node xaj_life.js --show     # 打印当前状态并退出
 *
 * 依赖: 仅 Node.js 内置模块，无外部 API。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ═══════════════════════════════════════════════════════════════
// 文件路径
// ═══════════════════════════════════════════════════════════════

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(scriptDir, "xaj_state.json");
const MEMORY_FILE = path.join(scriptDir, "xaj_memory.json");

// ═══════════════════════════════════════════════════════════════
// 加载 .env 配置（API 相关）
// ═══════════════════════════════════════════════════════════════

/** 手动读取 .env 文件，不依赖 dotenv 包 */
function loadEnvForAI() {
  const envPath = path.join(scriptDir, ".env");
  if (!fs.existsSync(envPath)) {
    console.log("[xaj_life] 未找到 .env 文件，AI 生活事件生成器将禁用。");
    return;
  }
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

// ═══════════════════════════════════════════════════════════════
// AI 生活事件生成器配置
// ═══════════════════════════════════════════════════════════════

/** AI 事件最小间隔（毫秒），默认 10 分钟，加 ±5 分钟随机抖动避免机械感 */
const AI_EVENT_INTERVAL = 600_000;
/** 每小时最多调用几次 AI，防止 API 费用失控 */
const AI_EVENT_MAX_PER_HOUR = 6;
/** 是否启用 AI 事件生成器，可通过环境变量 AI_EVENT_ENABLED 控制 */
const AI_EVENT_ENABLED = process.env.AI_EVENT_ENABLED !== "false";

/** 从环境变量读取 API 配置 */
function getAIConfig() {
  const apiKey = process.env.API_KEY;
  const apiBaseUrl = process.env.API_BASE_URL || "https://api.deepseek.com";
  const apiModel = process.env.API_MODEL || "deepseek-chat";
  return { apiKey, apiBaseUrl, apiModel };
}

// ═══════════════════════════════════════════════════════════════
// 时间段定义 — 驱动她的日常节奏
// ═══════════════════════════════════════════════════════════════

/**
 * 每个时间段定义了:
 *   hourRange: [开始小时, 结束小时)，左闭右开
 *   locations:  可能的去处（权重在后面的函数里分配）
 *   activities: 可能在做的事
 *   baseMood:   基础心情值 1-10
 *   wantToTalkBase: 基础想聊天程度 1-10
 *   weekendModifier: 周末是否变化
 */
const TIME_PERIODS = [
  {
    name: "深夜刷手机",
    hourRange: [0, 2],
    locations: ["在家床上"],
    activities: ["刷手机", "看视频", "刷小红书", "跟闺蜜微信聊天", "发呆"],
    baseMood: 5.5,
    wantToTalkBase: 8,
    note: "深夜最容易想找人聊天"
  },
  {
    name: "睡觉",
    hourRange: [2, 9],
    locations: ["在家睡觉"],
    activities: ["睡觉"],
    baseMood: 5,
    wantToTalkBase: 2,
    note: "睡觉中，除非失眠否则不想聊天"
  },
  {
    name: "早上",
    hourRange: [9, 12],
    locations: ["在家", "在学校"],
    activities: ["赖床", "洗漱", "上课", "吃早饭", "赶作业"],
    baseMood: 4.5,
    wantToTalkBase: 5,
    note: "早上比较困，脾气一般"
  },
  {
    name: "中午",
    hourRange: [12, 14],
    locations: ["在学校", "在外面", "在家"],
    activities: ["吃午饭", "跟朋友一起", "刷手机", "午休"],
    baseMood: 6,
    wantToTalkBase: 6,
    note: "午休时间比较放松"
  },
  {
    name: "下午",
    hourRange: [14, 18],
    locations: ["在学校", "在外面", "在家"],
    activities: ["上课", "跟朋友出去玩", "逛街", "在图书馆", "摸鱼刷手机"],
    baseMood: 5.5,
    wantToTalkBase: 5,
    note: "下午波动大，取决于有没有好玩的事"
  },
  {
    name: "傍晚",
    hourRange: [18, 21],
    locations: ["在家", "在外面", "在学校"],
    activities: ["吃晚饭", "打瓦", "跟朋友玩", "看直播", "刷视频"],
    baseMood: 6,
    wantToTalkBase: 7,
    note: "晚上比较活跃，打瓦输赢影响很大"
  },
  {
    name: "晚上",
    hourRange: [21, 24],
    locations: ["在家", "在家床上"],
    activities: ["打瓦", "刷手机", "跟闺蜜聊天", "看剧", "听歌"],
    baseMood: 5.5,
    wantToTalkBase: 8,
    note: "睡前最容易找人聊天"
  }
];

// ═══════════════════════════════════════════════════════════════
// 周末覆盖 — 周末她起得更晚、更爱出去玩、更爱打瓦
// ═══════════════════════════════════════════════════════════════

const WEEKEND_OVERRIDES = {
  // 周末睡觉时间段延长到 11 点
  sleepUntil: 11,
  // 周末更可能在外面
  outdoorBias: 0.3,
  // 周末心情基准 +1
  moodBonus: 1,
  // 周末更想打瓦
  gamingBias: 0.25
};

// ═══════════════════════════════════════════════════════════════
// 随机事件池 — 每分钟滚动一次命运骰子
// ═══════════════════════════════════════════════════════════════

/**
 * 每个事件:
 *   id:           唯一标识
 *   probability:  每分钟触发概率 (0~1)
 *   condition:    触发条件函数 (state) => boolean
 *   apply:        效果函数 (state) => void，直接修改 state
 *   description:  说明
 */
const RANDOM_EVENTS = [
  // ── 瓦洛兰特相关 ──
  {
    id: "valorant_win_streak",
    probability: 0.008,  // 打瓦时大约每 2 小时触发一次连胜
    condition: (s) => s.activity === "打瓦" && s.gaming.playing,
    apply(s) {
      s.gaming.streak = Math.max(0, s.gaming.streak) + 3;
      s.gaming.recentResult = `连赢${s.gaming.streak}把，手感火热`;
      s.moodValue = Math.min(10, s.moodValue + 3);
      s.mood = resolveMoodLabel(s.moodValue);
      s.thinkingAbout = pickRandom([
        "要不要趁手感好多打几把",
        "他要是看到我这么猛肯定惊了",
        "队友终于不坑了"
      ]);
      // 打瓦连胜 → 想炫耀
      setImpulse(s,
        `打瓦连赢${s.gaming.streak}把，手感火热`,
        "medium",
        pickRandom(["跟你说个事", "我今天好猛", "猜猜我打瓦怎么了"])
      );
    },
    description: "打瓦连赢三把，心情大好"
  },
  {
    id: "valorant_lose_streak",
    probability: 0.01,  // 跪的概率比赢略高（真实）
    condition: (s) => s.activity === "打瓦" && s.gaming.playing,
    apply(s) {
      s.gaming.streak = Math.min(0, s.gaming.streak) - 3;
      s.gaming.recentResult = `连跪${Math.abs(s.gaming.streak)}把，烦死了`;
      s.moodValue = Math.max(1, s.moodValue - 3);
      s.mood = resolveMoodLabel(s.moodValue);
      s.wantToTalk = false;
      s.wantToTalkReason = "打瓦连跪，谁都不想理";
      s.thinkingAbout = pickRandom([
        "队友是人机吧",
        "这个段位有毒",
        "不想打了但又不想认输"
      ]);
      // 打瓦连跪 → 可能想吐槽也可能不想说话
      setImpulse(s,
        `打瓦连跪${Math.abs(s.gaming.streak)}把，队友不是人`,
        "low",
        pickRandom(["烦死了", "不想说话", "队友是人机吧"])
      );
    },
    description: "打瓦连跪，心情烂，谁都不想理"
  },
  {
    id: "valorant_carry",
    probability: 0.003,
    condition: (s) => s.activity === "打瓦" && s.gaming.playing,
    apply(s) {
      s.gaming.streak = Math.max(0, s.gaming.streak) + 1;
      s.gaming.recentResult = "刚C了一把，MVP";
      s.moodValue = Math.min(10, s.moodValue + 2);
      s.mood = resolveMoodLabel(s.moodValue);
      s.wantToTalk = true;
      s.wantToTalkReason = "C了想炫耀";
      s.thinkingAbout = "这把我真猛，想截图发给他";
      // C 了 MVP → 特别想炫
      setImpulse(s,
        "刚C了一把MVP，这把我真猛",
        "high",
        pickRandom(["你猜我打瓦怎么了", "给你看个东西", "我今天好猛", "MVP 懂吗"])
      );
    },
    description: "C了一把拿了MVP，想炫耀"
  },
  {
    id: "valorant_start",
    probability: 0.02,
    condition: (s) => {
      const hour = s._hour;
      return (hour >= 17 || hour < 2) && !s.gaming.playing && s.activity !== "睡觉";
    },
    apply(s) {
      s.activity = "打瓦";
      s.gaming.playing = true;
      s.gaming.streak = 0;
      s.gaming.recentResult = null;
      s.location = "在家";
      s.thinkingAbout = pickRandom([
        "排一把，这把必赢",
        "今天手感还行，试试看",
        "就打一把，打完就睡",
        "上线看看有没有人在"
      ]);
    },
    description: "开始打瓦"
  },
  {
    id: "valorant_stop",
    probability: 0.015,
    condition: (s) => s.gaming.playing,
    apply(s) {
      s.gaming.playing = false;
      s.activity = pickRandom(["刷手机", "看视频", "躺着"]);
      if (s.gaming.streak > 0) {
        s.moodValue = Math.min(10, s.moodValue + 1);
        s.thinkingAbout = pickRandom([
          "今天打得不错，收工",
          "最后一局赢了，完美收官"
        ]);
      } else if (s.gaming.streak < 0) {
        s.thinkingAbout = pickRandom([
          "不打了不打了，今天没手感",
          "再打下去要掉段了，溜了"
        ]);
      }
    },
    description: "打完收工"
  },

  // ── 身体状况 ──
  {
    id: "acne",
    probability: 0.0003,  // 大约每 2-3 天一次
    condition: (s) => !s.physical.includes("长痘中"),
    apply(s) {
      s.physical.push("长痘中");
      s.moodValue = Math.max(1, s.moodValue - 1);
      s.mood = resolveMoodLabel(s.moodValue);
      s.thinkingAbout = pickRandom([
        "照镜子发现一颗新的，又是额头。烦。",
        "又长痘了，挤也不是不挤也不是",
        "明天还要见人，这痘长得真是时候"
      ]);
    },
    description: "长了一颗痘"
  },
  {
    id: "headache",
    probability: 0.0002,
    condition: (s) => !s.physical.includes("轻微头疼"),
    apply(s) {
      s.physical.push("轻微头疼");
      s.moodValue = Math.max(1, s.moodValue - 2);
      s.mood = resolveMoodLabel(s.moodValue);
      s.wantToTalk = s.moodValue >= 4;
      s.wantToTalkReason = s.wantToTalk ? "头疼但想被关心" : "头疼不想说话";
      s.thinkingAbout = pickRandom([
        "头一跳一跳地疼，想躺着什么都不想",
        "太阳穴好胀，是不是昨晚睡太晚了",
        "头好痛，想关机"
      ]);
      // 头疼 → 想被关心但不直说
      setImpulse(s,
        "头疼，太阳穴一跳一跳的",
        "medium",
        pickRandom(["头好痛", "不舒服", "难受"])
      );
    },
    description: "头疼"
  },
  {
    id: "acne_heal",
    probability: 0.005,
    condition: (s) => s.physical.includes("长痘中"),
    apply(s) {
      s.physical = s.physical.filter(p => p !== "长痘中");
      s.thinkingAbout = pickRandom([
        "摸了一下脸，那颗痘终于平了",
        "痘痘消了，心情都好了"
      ]);
    },
    description: "痘痘消了"
  },
  {
    id: "headache_heal",
    probability: 0.008,
    condition: (s) => s.physical.includes("轻微头疼"),
    apply(s) {
      s.physical = s.physical.filter(p => p !== "轻微头疼");
      s.moodValue = Math.min(10, s.moodValue + 1);
      s.mood = resolveMoodLabel(s.moodValue);
      s.thinkingAbout = pickRandom([
        "头不疼了，整个人轻快了",
        "头终于不疼了，舒服"
      ]);
    },
    description: "头疼好了"
  },

  // ── 社交/情绪 ──
  {
    id: "bestie_gossip",
    probability: 0.006,
    condition: (s) => s.activity !== "睡觉" && s._hour >= 10 && s._hour < 24,
    apply(s) {
      s.moodValue = Math.min(10, s.moodValue + 1);
      s.mood = resolveMoodLabel(s.moodValue);
      s.socialBattery = Math.max(1, s.socialBattery - 1);
      s.thinkingAbout = pickRandom([
        "闺蜜刚发了个八卦笑死我了",
        "想找他分享一下这个瓜",
        "原来还有这种事，离谱"
      ]);
      s.wantToTalk = true;
      s.wantToTalkReason = "有八卦想分享";
      // 闺蜜发来八卦 → 想分享
      setImpulse(s,
        "闺蜜刚发了个八卦笑死我了",
        "medium",
        pickRandom(["跟你说个事", "你猜我闺蜜跟我说了什么", "笑死我了"])
      );
    },
    description: "闺蜜发来八卦，想找人分享"
  },
  {
    id: "see_cat",
    probability: 0.004,
    condition: (s) => ["在外面", "在学校"].includes(s.location) && s.activity !== "睡觉",
    apply(s) {
      s.moodValue = Math.min(10, s.moodValue + 2);
      s.mood = resolveMoodLabel(s.moodValue);
      s.thinkingAbout = pickRandom([
        "刚才看到一只猫，好可爱",
        "想拍猫给他看",
        "那只流浪猫又出现了"
      ]);
      s.wantToTalk = true;
      s.wantToTalkReason = "看到猫想分享";
      // 看到猫 → 几乎必发
      setImpulse(s,
        pickRandom(["在图书馆门口看到一只橘猫，蹲下来拍了照", "路上看到一只猫，好可爱想发给他", "小区那只流浪猫又出现了，想拍给他看"]),
        "high",
        pickRandom(["给你看个东西", "你看这个", "猫", "好可爱啊啊啊"])
      );
    },
    description: "看到一只猫，心情大好"
  },
  {
    id: "feed_cat",
    probability: 0.003,
    condition: (s) => ["在外面", "在家"].includes(s.location) && s._hour >= 17 && s._hour < 21,
    apply(s) {
      s.activity = "喂流浪猫";
      s.location = "在外面";
      s.moodValue = Math.min(10, s.moodValue + 2);
      s.mood = resolveMoodLabel(s.moodValue);
      s.thinkingAbout = "小区那只橘猫又胖了";
      // 喂猫 → 想分享
      setImpulse(s,
        "去喂小区流浪猫了，那只橘猫又胖了",
        "medium",
        pickRandom(["给你看猫", "猫又胖了", "你看"])
      );
    },
    description: "去喂小区流浪猫"
  },
  {
    id: "insomnia",
    probability: 0.005,
    condition: (s) => s._hour >= 1 && s._hour < 5 && s.activity === "睡觉",
    apply(s) {
      s.activity = "失眠翻来覆去";
      s.location = "在家床上";
      s.moodValue = Math.max(1, s.moodValue - 1);
      s.mood = resolveMoodLabel(s.moodValue);
      s.wantToTalk = true;
      s.wantToTalkReason = "失眠了想找人聊天";
      s.thinkingAbout = pickRandom([
        "翻了个身，又翻了个身。怎么就是睡不着。",
        "脑子里乱七八糟的，不知道在想什么",
        "他在干嘛呢…算了不想了",
        "明天还要上课，现在都几点了"
      ]);
      // 失眠 → 想找人
      setImpulse(s,
        "失眠了翻来覆去睡不着",
        "medium",
        pickRandom(["睡不着", "在吗", "你睡了吗"])
      );
    },
    description: "失眠了"
  },
  {
    id: "fall_asleep",
    probability: 0.02,
    condition: (s) => s.activity === "失眠翻来覆去" || (s.activity === "刷手机" && s._hour >= 2 && s._hour < 6),
    apply(s) {
      s.activity = "睡觉";
      s.location = "在家睡觉";
      s.wantToTalk = false;
      s.wantToTalkReason = "终于睡着了";
      s.thinkingAbout = null;
    },
    description: "终于睡着了"
  },
  {
    id: "funny_video",
    probability: 0.01,
    condition: (s) => ["刷手机", "看视频", "刷小红书"].includes(s.activity),
    apply(s) {
      s.moodValue = Math.min(10, s.moodValue + 1);
      s.mood = resolveMoodLabel(s.moodValue);
      s.thinkingAbout = pickRandom([
        "刷到一个好笑的，差点在课堂上笑出声",
        "这个视频好抽象，想分享给他",
        "笑死了，截图发给闺蜜了"
      ]);
      s.wantToTalk = s.moodValue >= 5;
      if (s.wantToTalk) s.wantToTalkReason = "刷到好笑的东西想分享";
      // 刷到好笑的 → 想分享
      setImpulse(s,
        pickRandom(["刷到一个好笑的视频，差点在课堂上笑出声", "刷到一个好抽象的东西", "看到一个笑死的评论"]),
        "medium",
        pickRandom(["你看这个", "笑死我了", "给你看个好笑的"])
      );
    },
    description: "刷到好笑的视频"
  },
  {
    id: "sad_thing",
    probability: 0.003,
    condition: (s) => ["刷手机", "看视频", "刷小红书"].includes(s.activity),
    apply(s) {
      s.moodValue = Math.max(1, s.moodValue - 2);
      s.mood = resolveMoodLabel(s.moodValue);
      s.thinkingAbout = pickRandom([
        "刷到一条有点难过的内容，不知道为什么看了好久",
        "突然想到一些以前的事，说不上是什么感觉"
      ]);
      s.wantToTalk = s.moodValue >= 6;
      s.wantToTalkReason = s.wantToTalk ? "心情不好想要安慰" : "心情不好不想说话";
      // 心情突然低落 → 可能想找他，也可能不想
      setImpulse(s,
        "刷到一条让人难过的内容，心里闷闷的",
        "low",
        pickRandom(["唉", "心情不好", "算了"])
      );
    },
    description: "刷到让人难过的内容"
  },
  {
    id: "hungry",
    probability: 0.008,
    condition: (s) => {
      const hour = s._hour;
      return (hour >= 11 && hour < 13) || (hour >= 17 && hour < 19) || (hour >= 22 && hour < 24);
    },
    apply(s) {
      s.thinkingAbout = pickRandom([
        "中午没吃饱，现在又不想下楼，翻翻外卖吧",
        "好饿，但是不知道吃什么",
        "想吃火锅，一个人又懒得去",
        "肚子在叫，这节课怎么还没下课"
      ]);
      s.moodValue = Math.max(1, s.moodValue - 0.5);
      s.mood = resolveMoodLabel(s.moodValue);
    },
    description: "饿了"
  },
  {
    id: "eat",
    probability: 0.01,
    condition: (s) => s.thinkingAbout && s.thinkingAbout.includes("饿"),
    apply(s) {
      const hour = s._hour;
      let meal;
      if (hour >= 6 && hour < 11) meal = "早饭";
      else if (hour >= 11 && hour < 14) meal = "午饭";
      else if (hour >= 17 && hour < 20) meal = "晚饭";
      else meal = "夜宵";
      s.activity = `吃${meal}`;
      s.lastMeal = `${String(s._hour).padStart(2, "0")}:${String(s._minute).padStart(2, "0")}`;
      s.moodValue = Math.min(10, s.moodValue + 1);
      s.mood = resolveMoodLabel(s.moodValue);
      s.thinkingAbout = null;
    },
    description: "去吃东西了"
  },

  // ── 跟他有关 ──
  {
    id: "dream_of_him",
    probability: 0.002,  // 偶尔梦到
    condition: (s) => s.activity === "睡觉" && s._hour >= 2 && s._hour < 9,
    apply(s) {
      // 梦到他了——在睡觉中短暂醒来意识到
      s.activity = "失眠翻来覆去";
      s.location = "在家床上";
      s.moodValue = Math.min(10, s.moodValue + 1);
      s.mood = resolveMoodLabel(s.moodValue);
      s.wantToTalk = true;
      s.wantToTalkReason = "梦到他了想说但又不好意思";
      s.thinkingAbout = pickRandom([
        "刚梦到他了…梦到什么记不太清了，但是感觉怪怪的",
        "居然梦到他了，什么意思啊这是",
        "梦到他了，醒来以后心跳好快"
      ]);
      // 梦到他 → high 但可能不好意思说
      setImpulse(s,
        pickRandom(["梦到他了，醒来心脏跳好快", "居然梦到他了，梦到什么记不太清", "梦到他了…什么意思啊这是"]),
        "high",
        pickRandom(["我跟你说个事", "你猜我梦到什么了", "算了不说了", "刚刚…"])
      );
    },
    description: "梦到他了，醒来恍惚"
  },
  {
    id: "miss_him",
    probability: 0.005,
    condition: (s) => {
      const hoursSince = s._hoursSinceInteraction;
      return hoursSince !== null && hoursSince > 2 && s.activity !== "睡觉";
    },
    apply(s) {
      s.wantToTalk = true;
      s.wantToTalkReason = "想他了";
      s.thinkingAbout = pickRandom([
        "他在干嘛呢",
        "怎么不找我",
        "有点想找他但又不想主动"
      ]);
      // 想他了 → 想找他但可能不好意思，归为 medium
      setImpulse(s,
        "在想他在干嘛，有点想找他",
        "medium",
        pickRandom(["在干嘛", "在吗", "干嘛呢"])
      );
    },
    description: "想他了"
  },
  {
    id: "recall_memory",
    probability: 0.003,
    condition: (s) => s._memories && s._memories.length > 0 && s.activity !== "睡觉",
    apply(s) {
      const mem = pickRandom(s._memories);
      s.thinkingAbout = mem.content;
      // 增加回忆次数
      mem.timesRecalled = (mem.timesRecalled || 0) + 1;
      // 重要的记忆会微微影响心情
      if (mem.importance >= 7) {
        if (mem.type === "promise") {
          s.moodValue = Math.min(10, s.moodValue + 0.5);
          s.wantToTalk = true;
          s.wantToTalkReason = "想起他说过的话";
          // 想起他答应过的事 → 想追问
          setImpulse(s,
            `突然想起他答应过的: ${mem.content.slice(0, 40)}`,
            "medium",
            pickRandom(["你之前是不是说过", "你是不是忘了", "我问你件事"])
          );
        }
      }
    },
    description: "突然想起他说过的某句话"
  },
  {
    id: "read_not_reply",
    probability: 0.01,
    condition: (s) => s.unreadMessages > 0 && s.activity !== "睡觉",
    apply(s) {
      // 看到了但故意不回——心情其实有波动但不想立刻回
      s.thinkingAbout = pickRandom([
        "看到了，等会儿再回",
        "哼，让他等等",
        "先不回，看他急不急"
      ]);
      s.moodValue = Math.min(10, s.moodValue + 0.3);
      s.wantToTalk = false;
      s.wantToTalkReason = "看到了但想晾他一会儿";
    },
    description: "收到他的消息，看到了但故意不回"
  },
  {
    id: "mad_at_him",
    probability: 0.0008,
    condition: (s) => {
      const hoursSince = s._hoursSinceInteraction;
      return hoursSince !== null && hoursSince > 12 && s.activity !== "睡觉" && s.moodValue >= 3;
    },
    apply(s) {
      s.moodValue = Math.max(1, s.moodValue - 3);
      s.mood = resolveMoodLabel(s.moodValue);
      s.wantToTalk = false;
      s.wantToTalkReason = "生气了，不想理他";
      s.thinkingAbout = pickRandom([
        "他怎么还不来找我",
        "是不是又打瓦打忘了",
        "行，不理就不理"
      ]);
    },
    description: "他太久没找，生气了"
  },
  {
    id: "forgive_him",
    probability: 0.004,
    condition: (s) => {
      const hoursSince = s._hoursSinceInteraction;
      return hoursSince !== null && hoursSince > 24 && s.moodValue < 5 && s.wantToTalk === false;
    },
    apply(s) {
      // 气消了一点但嘴还是硬
      s.moodValue = Math.min(10, s.moodValue + 2);
      s.mood = resolveMoodLabel(s.moodValue);
      s.wantToTalk = s.moodValue >= 7;
      s.wantToTalkReason = s.wantToTalk ? "其实也没那么生气了" : "还没完全消气";
      s.thinkingAbout = pickRandom([
        "其实好像也没那么严重",
        "算了，看他什么时候来找我"
      ]);
    },
    description: "气消了一些"
  },

  // ── 随机日常 ──
  {
    id: "want_shopping",
    probability: 0.002,
    condition: (s) => s.activity !== "睡觉" && s._hour >= 10 && s._hour < 22,
    apply(s) {
      s.thinkingAbout = pickRandom([
        "想买衣服，上次看到的那件不知道还在不在",
        "刷到一条裙子好好看，纠结要不要买",
        "购物车又满了，但一个都不想删",
        "又要剁手了…算了再看一眼"
      ]);
      s.moodValue = Math.min(10, s.moodValue + 0.5);
    },
    description: "想买东西"
  },
  {
    id: "want_travel",
    probability: 0.0003,  // 非常罕见
    condition: (s) => s.activity !== "睡觉" && s.moodValue >= 5,
    apply(s) {
      s.thinkingAbout = pickRandom([
        "好想去海边，好久没看见海了",
        "想去看雪，朋友圈有人发了雪景好好看",
        "好想出去玩。课表排得这么满，烦。",
        "想去日本，存的钱应该够了吧"
      ]);
      s.moodValue = Math.min(10, s.moodValue + 1);
      s.wantToTalk = true;
      s.wantToTalkReason = "突然想去旅行，想跟他说";
      // 突然想去旅行 → 想分享这个念头
      setImpulse(s,
        pickRandom(["突然好想去海边", "想去日本，存的钱应该够了吧", "好想出去玩"]),
        "medium",
        pickRandom(["好想出去玩", "想去海边", "什么时候出去玩"])
      );
    },
    description: "突然想去旅行"
  },
  {
    id: "weather_rain",
    probability: 0.001,
    condition: (s) => s.activity !== "睡觉",
    apply(s) {
      s.moodValue = Math.max(1, s.moodValue - 1);
      s.mood = resolveMoodLabel(s.moodValue);
      s.thinkingAbout = pickRandom([
        "窗外开始下雨了，本来想出去的，算了",
        "下雨了，空气湿湿的，不想动",
        "又下雨，晾的衣服又白洗了"
      ]);
      if (s.location === "在外面") s.location = "在家";
    },
    description: "下雨了，心情变差"
  },
  {
    id: "going_out",
    probability: 0.008,
    condition: (s) => {
      const hour = s._hour;
      return s._isWeekend && hour >= 11 && hour < 20 && s.location === "在家" && s.activity !== "打瓦" && s.activity !== "睡觉";
    },
    apply(s) {
      s.location = "在外面";
      s.activity = pickRandom(["逛街", "跟闺蜜出去玩", "在外面吃饭", "逛商场"]);
      s.moodValue = Math.min(10, s.moodValue + 1);
      s.mood = resolveMoodLabel(s.moodValue);
      s.socialBattery = Math.max(1, s.socialBattery - 2);
      s.thinkingAbout = "出去玩喽";
    },
    description: "出门玩"
  },
  {
    id: "back_home",
    probability: 0.01,
    condition: (s) => s.location === "在外面" && s._hour >= 20,
    apply(s) {
      s.location = "在家";
      s.activity = pickRandom(["躺着", "刷手机", "打瓦"]);
      s.socialBattery = Math.min(10, s.socialBattery + 2);
      s.thinkingAbout = "到家了，好累";
    },
    description: "回到家"
  }
];

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/** 从数组中随机选一个 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 记录事件到 recentEvents，保留最近 5 条。
 * 所有事件（硬编码和 AI 生成的）都应通过此函数记录，
 * 以便 AI 事件生成器有足够的上下文。
 * @param {object} state - 当前状态
 * @param {string} description - 事件的简短描述
 */
function recordEvent(state, description) {
  if (!description) return;
  state.recentEvents.push(description);
  // 只保留最近 5 条
  if (state.recentEvents.length > 5) {
    state.recentEvents = state.recentEvents.slice(-5);
  }
}

/** 范围随机整数 [min, max] */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 范围随机浮点数 */
function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/** 带权重随机选一个 */
function weightedPick(items, weightFn) {
  const total = items.reduce((sum, item) => sum + weightFn(item), 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= weightFn(item);
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

/** 根据 moodValue 返回中文标签 */
function resolveMoodLabel(value) {
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
 * 在事件 apply() 中便捷设置主动消息冲动。
 * @param {object} state - 当前状态
 * @param {string} reason - 触发原因描述
 * @param {string} intensity - "high" | "medium" | "low"
 * @param {string} whatToSay - 她想说的话的大意
 */
function setImpulse(state, reason, intensity, whatToSay) {
  state.impulseToMessage = {
    triggered: true,
    reason,
    intensity,
    whatToSay,
    timestamp: new Date().toISOString()
  };
}

/**
 * 根据 moodValue 返回情绪质感——身体感受 + 行为倾向。
 * 不是标签，是让 AI 能"感受"到她此刻状态的描述。
 */
function resolveMoodTexture(value) {
  if (value >= 9) {
    return pickRandom([
      "脚步轻得想跳着走。看到好玩的就想发给他。想连发好几条。",
      "整个人轻飘飘的，嘴角压不住。想逗他，想发[呲牙][呲牙][呲牙]。",
      "嗨了，心情好到觉得世界都可爱。想拉他一起开心。"
    ]);
  }
  if (value >= 7) {
    return pickRandom([
      "心情不错，脚步轻快。看到好玩的会想发给他。会多说几个字。",
      "状态挺好，说话会带点笑意。他找你你会好好回。",
      "今天还行，没那么容易烦。甚至想主动找他一下。"
    ]);
  }
  if (value >= 5.5) {
    return pickRandom([
      "正常。该干嘛干嘛。他找你你会回，但不会特别主动。",
      "不咸不淡的一天。没什么特别想说的，也没什么特别不想说的。",
      "平平常常。手机响了会看一眼，是他的话就回一下。"
    ]);
  }
  if (value >= 4.5) {
    return pickRandom([
      "说不上来哪里不对，就是提不起劲。回消息会有点敷衍。",
      "有一点点烦，但还能忍。他找你你会回，不过话不多。",
      "心里有点闷，想自己待着。不是针对谁。"
    ]);
  }
  if (value >= 3.5) {
    return pickRandom([
      "有点烦。说不上来为什么。回消息会很短，可能就一个'嗯'。",
      "不太想说话。不是生气，就是没那个心情。他发消息可能会已读不回。",
      "心里堵堵的。想一个人待着，谁都不想理。"
    ]);
  }
  if (value >= 2.5) {
    return pickRandom([
      "烦。看什么都不顺眼。消息都不想回。谁惹你跟谁急。",
      "心情很差。如果有人这时候找你聊天你会想打人。",
      "什么都不想干。胸口堵，话也不想说。最好谁都别来烦你。"
    ]);
  }
  // 1-2.5
  return pickRandom([
    "什么都不想干。消息都不想回。胸口堵。就想躺着。",
    "烦死了。别找。现在说话会很冲。",
    "整个人down到谷底。不是生气，就是没力气。连敷衍都懒得敷衍。"
  ]);
}

/** 获取北京时间（UTC+8）的 Date 对象中各字段 */
function getChinaTime(now) {
  // 用 UTC 方法加 8 小时偏移来模拟北京时间
  const utc = new Date(now.getTime() + now.getTimezoneOffset() * 60_000 + 8 * 3600_000);
  return utc;
}

/** 判断是否是周末（北京时间） */
function isWeekend(date) {
  const cn = getChinaTime(date);
  const day = cn.getUTCDay(); // 0=周日, 6=周六
  return day === 0 || day === 6;
}

/** 获取中文星期（北京时间） */
function getDayOfWeek(date) {
  const cn = getChinaTime(date);
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return days[cn.getUTCDay()];
}

/** 生成北京时间的 ISO 字符串 */
function toChinaISOString(date) {
  const cn = getChinaTime(date);
  const y = cn.getUTCFullYear();
  const mo = String(cn.getUTCMonth() + 1).padStart(2, "0");
  const d = String(cn.getUTCDate()).padStart(2, "0");
  const h = String(cn.getUTCHours()).padStart(2, "0");
  const mi = String(cn.getUTCMinutes()).padStart(2, "0");
  const s = String(cn.getUTCSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`;
}

// ═══════════════════════════════════════════════════════════════
// 记忆系统
// ═══════════════════════════════════════════════════════════════

function loadMemories() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("[xaj_life] 记忆文件读取失败:", e.message);
  }
  return [];
}

function saveMemories(memories) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2));
  } catch (e) {
    console.error("[xaj_life] 记忆保存失败:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 状态加载与初始化
// ═══════════════════════════════════════════════════════════════

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const state = JSON.parse(raw);
      // 修复可能缺失的字段
      return normalizeState(state);
    }
  } catch (e) {
    console.error("[xaj_life] 状态文件读取失败，创建新状态:", e.message);
  }
  return createInitialState();
}

/** 需要从保存的 JSON 中剔除的内部字段 */
const INTERNAL_KEYS = [
  "_hour", "_minute", "_date", "_isWeekend",
  "_hoursSinceInteraction", "_memories", "_lastTick",
  "_tickCount", "_lastPeriodName", "_activityLocked",
  "_wantToTalkSetByEvent"
];

function saveState(state) {
  const toSave = {};
  for (const key of Object.keys(state)) {
    if (!key.startsWith("_")) {
      toSave[key] = state[key];
    }
  }
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
  } catch (e) {
    console.error("[xaj_life] 状态保存失败:", e.message);
  }
}

function normalizeState(state) {
  const defaults = createInitialState();
  for (const key of Object.keys(defaults)) {
    if (state[key] === undefined) {
      state[key] = defaults[key];
    }
  }
  // 确保嵌套对象完整
  if (!state.gaming || typeof state.gaming !== "object") {
    state.gaming = { playing: false, recentResult: null, streak: 0 };
  }
  if (!Array.isArray(state.physical)) {
    state.physical = [];
  }
  // 确保 impulseToMessage 字段完整
  if (!state.impulseToMessage || typeof state.impulseToMessage !== "object") {
    state.impulseToMessage = { triggered: false, reason: null, intensity: null, whatToSay: null, timestamp: null };
  }
  // 确保 recentEvents 是数组
  if (!Array.isArray(state.recentEvents)) {
    state.recentEvents = [];
  }
  return state;
}

function createInitialState() {
  return {
    time: null,                // ISO 时间戳，每 tick 更新
    dayOfWeek: "周一",
    location: "在家",
    activity: "刷手机",
    mood: "一般",
    moodValue: 6,
    physical: [],              // 如 ["长痘中", "轻微头疼"]
    lastMeal: "12:00",
    socialBattery: 7,         // 1-10, 越低越不想社交
    gaming: {
      playing: false,
      recentResult: null,
      streak: 0               // 正数=连胜, 负数=连跪
    },
    thinkingAbout: null,      // 当前在想的事
    lastInteraction: null,    // 最后一次跟 GSQ 聊天的时间 (ISO)
    unreadMessages: 0,
    wantToTalk: true,
    wantToTalkReason: null,
    // 事件驱动的主动消息冲动 — wechat_bridge.js 轮询此字段决定是否发送主动消息
    impulseToMessage: {
      triggered: false,
      reason: null,           // 触发原因描述，如 "在图书馆门口看到一只橘猫"
      intensity: null,        // "high" | "medium" | "low"
      whatToSay: null,        // 她想说的话的大意
      timestamp: null         // 触发时间 ISO
    },
    // 最近发生的事（最多保留 5 条），供 AI 事件生成器参考
    recentEvents: [],
    // 以下为元数据，不输出到状态文件
    _tickCount: 0
  };
}

// ═══════════════════════════════════════════════════════════════
// 核心：状态更新逻辑（每分钟执行一次）
// ═══════════════════════════════════════════════════════════════

async function tick(state, now) {
  // 1. 解析当前时间（北京时间）
  const date = now || new Date();
  const cn = getChinaTime(date);
  state.time = toChinaISOString(date);
  state._date = date;
  state._hour = cn.getUTCHours();
  state._minute = cn.getUTCMinutes();
  state._isWeekend = isWeekend(date);
  state.dayOfWeek = getDayOfWeek(date);

  // 2. 计算距上次交互的时间
  if (state.lastInteraction) {
    const last = new Date(state.lastInteraction);
    state._hoursSinceInteraction = (date - last) / (1000 * 60 * 60);
  } else {
    state._hoursSinceInteraction = null;
  }

  // 3. 加载记忆
  if (!state._memories) {
    state._memories = loadMemories();
  }

  // 4. 确定当前时间段
  const period = getCurrentPeriod(state);

  // 5. 如果活动未人为设置，按时间段更新基础状态
  updateBaseState(state, period);

  // 6. 应用自然衰减（长时间未交互的影响）
  applyNaturalDecay(state);

  // 7. 重置主动消息冲动（本 tick 的事件将重新设置）
  state.impulseToMessage = { triggered: false, reason: null, intensity: null, whatToSay: null, timestamp: null };

  // 8. 随机事件抽选
  rollRandomEvents(state);

  // 8.5 AI 生活事件生成器（与硬编码事件共存，增加细腻度）
  await rollAIEvent(state);

  // 9. 确保状态一致性
  ensureConsistency(state);

  // 10. 计算最终的 wantToTalk
  calculateWantToTalk(state, period);

  // 11. 处理未读消息的衰减
  decayUnread(state);

  // 12. 生成默认想法
  if (!state.thinkingAbout) {
    state.thinkingAbout = generateDefaultThought(state);
  }

  // 12.5 环境情绪注入（~10% 概率）——跟 GSQ 无关的日常
  if (Math.random() < 0.10) {
    state.thinkingAbout = generateEnvironmentalThought(state);
  }

  // 12.6 情感张力注入（~5% 概率）——没说破的东西偶尔冒出来
  if (Math.random() < 0.05) {
    state.thinkingAbout = generateEmotionalTensionThought(state);
  }

  // 13. 社交电池自然恢复
  if (state.socialBattery < 10) {
    state.socialBattery = Math.min(10, +(state.socialBattery + 0.02).toFixed(2));
  }

  // 14. 睡觉时清空 thinkingAbout
  if (state.activity === "睡觉") {
    state.thinkingAbout = null;
  }

  // 15. 数字精度修复
  state.moodValue = +state.moodValue.toFixed(2);
  state.socialBattery = +state.socialBattery.toFixed(2);

  state._tickCount = (state._tickCount || 0) + 1;
  state._lastTick = date.toISOString();
}

/**
 * 确定当前时间段
 */
function getCurrentPeriod(state) {
  const hour = state._hour;
  for (const period of TIME_PERIODS) {
    const [start, end] = period.hourRange;
    if (hour >= start && hour < end) return period;
  }
  // 兜底（不应到达）
  return TIME_PERIODS[0];
}

/**
 * 根据时间段更新基础状态
 */
function updateBaseState(state, period) {
  const hour = state._hour;
  const isWeekend = state._isWeekend;

  // 周末赖床：睡觉时间段延长
  if (isWeekend && hour >= 9 && hour < WEEKEND_OVERRIDES.sleepUntil && state.activity === "睡觉") {
    // 继续睡，不改变
    state.location = "在家睡觉";
    return;
  }

  // 如果她在做一件持续的事情（打瓦、跟朋友玩等），不随意打断
  if (state._activityLocked) return;

  // 睡觉时段不做大改
  if (period.name === "睡觉") {
    state.location = "在家睡觉";
    state.activity = "睡觉";
    state.gaming.playing = false;
    return;
  }

  // 根据时间段设置位置和活动
  // 位置选择
  if (isWeekend && Math.random() < WEEKEND_OVERRIDES.outdoorBias) {
    state.location = pickRandom(["在外面", "在外面", "在家"]);
  } else {
    state.location = pickRandom(period.locations);
  }

  // 活动选择
  state.activity = pickRandom(period.activities);

  // 如果刚切换时间段，重置 gaming 状态（除非刚进入打瓦时段）
  if (state._lastPeriodName !== period.name) {
    if (period.name !== "傍晚" && period.name !== "晚上" && period.name !== "深夜刷手机") {
      state.gaming.playing = false;
    }
  }
  state._lastPeriodName = period.name;

  // mood 朝基准值缓慢回归（每次 tick 移动 0.1）
  const targetMood = isWeekend ? period.baseMood + WEEKEND_OVERRIDES.moodBonus : period.baseMood;
  if (Math.abs(state.moodValue - targetMood) > 0.1) {
    state.moodValue += (targetMood > state.moodValue ? 0.1 : -0.1);
  }
  state.mood = resolveMoodLabel(state.moodValue);
}

/**
 * 自然衰减——GSQ 很久没发消息的影响
 */
function applyNaturalDecay(state) {
  const hours = state._hoursSinceInteraction;
  if (hours === null) return; // 从未交互过

  // 分级衰减逻辑
  if (hours <= 1) {
    // 刚聊完不久，正常
    return;
  }

  if (hours <= 3) {
    // 2-3 小时：正常，偶尔想他在干嘛
    if (Math.random() < 0.05 && !state.thinkingAbout) {
      state.thinkingAbout = "他在干嘛呢";
    }
    return;
  }

  if (hours <= 6) {
    // 3-6 小时：开始有点在意
    if (Math.random() < 0.08 && !state.thinkingAbout) {
      state.thinkingAbout = pickRandom([
        "他怎么还不找我",
        "是不是又在打瓦"
      ]);
    }
    // mood 微微下降
    if (state.moodValue > 5) {
      state.moodValue -= 0.05;
    }
    return;
  }

  if (hours <= 12) {
    // 6-12 小时：轻微不满
    if (Math.random() < 0.1 && !state.thinkingAbout) {
      state.thinkingAbout = pickRandom([
        "他是不是忘了",
        "行吧，看谁先找谁"
      ]);
    }
    state.moodValue = Math.max(3, state.moodValue - 0.1);
    return;
  }

  if (hours <= 24) {
    // 12-24 小时：不满增加
    if (Math.random() < 0.08 && !state.thinkingAbout) {
      state.thinkingAbout = pickRandom([
        "一天没找我了",
        "他最好是有事"
      ]);
    }
    state.moodValue = Math.max(2, state.moodValue - 0.15);
    state.wantToTalk = state.moodValue >= 7; // 心情还行就还想聊，否则不想
    return;
  }

  if (hours <= 48) {
    // 24-48 小时：生气了
    if (Math.random() < 0.05 && !state.thinkingAbout) {
      state.thinkingAbout = pickRandom([
        "两天了，真有他的",
        "我倒要看看他什么时候找我"
      ]);
    }
    state.moodValue = Math.max(2, state.moodValue - 0.2);
    state.wantToTalk = state.moodValue >= 8; // 除非心情很好，否则不想理
    return;
  }

  if (hours <= 72) {
    // 48-72 小时：非常生气，但开始习惯
    state.moodValue = Math.max(3, state.moodValue - 0.1);
    state.wantToTalk = false;
    state.wantToTalkReason = "他都不找我，我也不找他了";
    if (Math.random() < 0.03 && !state.thinkingAbout) {
      state.thinkingAbout = pickRandom([
        "算了，爱找不找",
        "我自己玩也挺好"
      ]);
    }
    return;
  }

  // 72 小时以上：开始淡忘，mood 回升但不想主动
  state.moodValue = Math.min(7, state.moodValue + 0.05);
  state.wantToTalk = false;
  state.wantToTalkReason = "习惯了，无所谓了";
  if (Math.random() < 0.02 && !state.thinkingAbout) {
    state.thinkingAbout = pickRandom([
      "最近好像少了点什么",
      "好像好久没跟他说话了"
    ]);
  }
}

/**
 * 随机事件抽选
 */
function rollRandomEvents(state) {
  // 打乱事件顺序，避免前面的优先触发
  const shuffled = [...RANDOM_EVENTS].sort(() => Math.random() - 0.5);

  let eventsTriggered = 0;
  const MAX_EVENTS_PER_TICK = 2; // 每个 tick 最多触发两个事件

  for (const event of shuffled) {
    if (eventsTriggered >= MAX_EVENTS_PER_TICK) break;

    // 检查条件
    if (!event.condition(state)) continue;

    // 概率抽选
    if (Math.random() >= event.probability) continue;

    // 触发！
    event.apply(state);
    // 记录到最近事件列表，供 AI 事件生成器提供上下文
    recordEvent(state, event.description);
    eventsTriggered++;
  }
}

/**
 * AI 生活事件抽选——检查间隔和频率限制后，调用 DeepSeek API 生成自然事件。
 * 与硬编码事件共存，AI 事件更"细腻"，比如"在食堂排队被人插队"这种难以穷举的日常。
 * @param {object} state - 当前状态
 */
async function rollAIEvent(state) {
  // 检查环境变量开关
  if (!AI_EVENT_ENABLED) return;

  const now = (state._date || new Date()).getTime();
  const lastAIEvent = state._lastAIEventTime || 0;

  // 随机抖动 ±5 分钟，避免固定间隔的机械感
  const jitter = randInt(-300_000, 300_000);
  const effectiveInterval = Math.max(60_000, AI_EVENT_INTERVAL + jitter);

  if (now - lastAIEvent < effectiveInterval) return;

  // 调用 AI 事件生成器（异步，失败静默）
  await aiLifeEvent(state);
}

/**
 * AI 生活事件生成器——通过 DeepSeek API 生成自然的生活事件。
 *
 * 发送一个简洁的 prompt（~300 token），让 AI 以奚艾佳的身份
 * 生成一句自然的生活描述，代替穷举所有可能的生活事件。
 *
 * 成功后直接修改 state（活动、位置、心情、想法、impulse）。
 * 失败静默，不影响主循环和硬编码事件。
 *
 * @param {object} state - 当前状态
 */
async function aiLifeEvent(state) {
  // 检查 API 密钥
  const { apiKey, apiBaseUrl, apiModel } = getAIConfig();
  if (!apiKey) return;

  // 频率控制：每小时最多 AI_EVENT_MAX_PER_HOUR 次
  const currentHour = state._hour;
  if (state._aiEventHour !== currentHour) {
    state._aiEventHour = currentHour;
    state._aiEventsThisHour = 0;
  }
  if ((state._aiEventsThisHour || 0) >= AI_EVENT_MAX_PER_HOUR) return;

  // ── 构建 prompt ──
  const timeStr = `${String(state._hour).padStart(2, "0")}:${String(state._minute).padStart(2, "0")}`;

  // 最近事件文本
  const recentEventsText = state.recentEvents && state.recentEvents.length > 0
    ? state.recentEvents.slice(-5).join("；")
    : "无";

  // 跟 GSQ 的交互状态
  let lastInteractionText = "还没说过话";
  if (state.lastInteraction && state._hoursSinceInteraction !== null) {
    const hoursSince = state._hoursSinceInteraction;
    if (hoursSince < 1) lastInteractionText = `${Math.round(hoursSince * 60)}分钟前刚聊过`;
    else if (hoursSince < 24) lastInteractionText = `${Math.round(hoursSince)}小时前聊过`;
    else lastInteractionText = `${Math.round(hoursSince / 24)}天前聊过`;
  }

  // 最近一条记忆
  let recentMemoryText = "无";
  if (state._memories && state._memories.length > 0) {
    const mem = state._memories[state._memories.length - 1];
    recentMemoryText = (mem.content || "无").slice(0, 80);
  }

  const prompt = `你是奚艾佳，中侨职业技术大学的学生，在上海金山。

现在的时间：${timeStr}，${state.dayOfWeek}
你正在：${state.location}，${state.activity}
你的心情：${state.mood}(${state.moodValue}/10)
最近发生的事：${recentEventsText}
你跟GSQ的关系状态：${lastInteractionText}，他说过：${recentMemoryText}

用一句话描述现在你的生活中正在发生什么。不要离谱。要像一个普通女大学生真实的一天。
然后输出 JSON：
{"event": "简短的事件描述", "activity": "你现在的活动", "location": "你在哪", "moodDelta": -1到2的整数, "thinkingAbout": "你脑子里在想什么", "impulse": "你想跟GSQ说的话（如果没有想说的就留空）"}`;

  // ── 调用 API ──
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(`${apiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.9,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[xaj_life] AI 事件 API 错误 ${resp.status}: ${errText.slice(0, 200)}`);
      return;
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "";

    // ── 解析 JSON 响应 ──
    let parsed;
    try {
      // 提取 JSON（可能被 markdown 代码块包裹）
      let jsonStr = content.trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error(`[xaj_life] AI 事件 JSON 解析失败: ${parseErr.message}，原始响应: ${content.slice(0, 200)}`);
      return;
    }

    // ── 应用 AI 生成的事件到状态 ──
    if (parsed.event) {
      recordEvent(state, parsed.event);
      console.log(`[xaj_life] AI 事件: ${parsed.event}`);
    }

    // 更新活动
    if (parsed.activity && typeof parsed.activity === "string") {
      state.activity = parsed.activity;
    }

    // 更新位置
    if (parsed.location && typeof parsed.location === "string") {
      state.location = parsed.location;
    }

    // 更新心情（限制波动范围）
    if (typeof parsed.moodDelta === "number") {
      const delta = Math.max(-1, Math.min(2, Math.round(parsed.moodDelta)));
      state.moodValue = Math.max(1, Math.min(10, state.moodValue + delta));
      state.mood = resolveMoodLabel(state.moodValue);
    }

    // 更新想法
    if (parsed.thinkingAbout && typeof parsed.thinkingAbout === "string") {
      state.thinkingAbout = parsed.thinkingAbout;
    }

    // 如果 AI 生成了想对 GSQ 说的话 → 设置主动消息冲动
    if (parsed.impulse && typeof parsed.impulse === "string" && parsed.impulse.trim()) {
      const intensity = state.moodValue >= 8 ? "high" : state.moodValue >= 5 ? "medium" : "low";
      setImpulse(state, parsed.event || parsed.impulse, intensity, parsed.impulse.trim());
    }

    // 更新频率计数器
    state._aiEventsThisHour = (state._aiEventsThisHour || 0) + 1;
    state._lastAIEventTime = (state._date || new Date()).getTime();

  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[xaj_life] AI 事件 API 请求超时（10秒）");
    } else {
      console.error(`[xaj_life] AI 事件生成失败: ${err.message}`);
    }
    // 静默失败，不影响主循环和硬编码事件
  }
}

/**
 * 确保状态一致性
 */
function ensureConsistency(state) {
  // 如果正在睡觉，不能打瓦
  if (state.activity === "睡觉") {
    state.gaming.playing = false;
  }

  // 如果 location 是在家睡觉但 activity 不是睡觉
  if (state.location === "在家睡觉" && state.activity !== "睡觉" && state.activity !== "失眠翻来覆去") {
    state.location = "在家床上";
  }

  // 如果在外面/在学校，不能打瓦
  if ((state.location === "在外面" || state.location === "在学校") && state.gaming.playing) {
    state.gaming.playing = false;
    state.activity = pickRandom(TIME_PERIODS.find(p => {
      const [s, e] = p.hourRange;
      return state._hour >= s && state._hour < e;
    })?.activities || ["刷手机"]);
  }

  // moodValue 边界
  state.moodValue = Math.max(1, Math.min(10, state.moodValue));
  state.mood = resolveMoodLabel(state.moodValue);

  // socialBattery 边界
  state.socialBattery = Math.max(1, Math.min(10, state.socialBattery));

  // physical 去重
  state.physical = [...new Set(state.physical)];
}

/**
 * 计算最终的 wantToTalk
 */
function calculateWantToTalk(state, period) {
  const hour = state._hour;

  // 睡觉时不想聊天（除非失眠）
  if (state.activity === "睡觉") {
    state.wantToTalk = false;
    state.wantToTalkReason = "在睡觉";
    return;
  }

  if (state.activity === "失眠翻来覆去") {
    state.wantToTalk = true;
    state.wantToTalkReason = "失眠了想找人";
    return;
  }

  // 活动中的特殊状态已被事件设置，尊重它
  // 例如：打瓦连跪时事件设置了 wantToTalk = false，这里保留
  // 但通过 moodValue 的偏移，分数计算也会趋近于事件意图

  // 综合计算：时间段基础 + 心情 + 社交电池 + 距上次交互 + gaming 状态
  let score = period.wantToTalkBase;

  // 心情好更想聊，心情差更不想聊
  score += (state.moodValue - 5) * 0.5;

  // 社交电池低 → 不想聊
  score += (state.socialBattery - 5) * 0.3;

  // 很久没交互 → 想聊程度下降（除了某些时段）
  const hoursSince = state._hoursSinceInteraction;
  if (hoursSince !== null && hoursSince > 6) {
    score -= Math.min(5, hoursSince / 10);
  }

  // 打瓦连跪 → 不想聊
  if (state.gaming.playing && state.gaming.streak < 0) {
    score -= 3;
  }

  // 打瓦连胜 → 想聊（炫耀）
  if (state.gaming.playing && state.gaming.streak > 2) {
    score += 2;
  }

  // 未读消息多 → 有一点点想回
  if (state.unreadMessages > 0 && state.unreadMessages <= 5) {
    score += 0.5;
  } else if (state.unreadMessages > 5) {
    score -= 1; // 太多了反而有点烦
  }

  // 身体不适 → 不想聊
  if (state.physical.length > 0) {
    score -= 1;
  }

  // 最终判断
  const threshold = 5.5 + (Math.random() - 0.5) * 2; // 加一点随机波动
  const newWantToTalk = score >= threshold;

  // 如果 wantToTalk 发生变化，或原因与当前状态矛盾，重置原因
  const sleepReasons = ["在睡觉", "失眠了想找人", "终于睡着了"];
  if (newWantToTalk !== state.wantToTalk ||
      (sleepReasons.includes(state.wantToTalkReason) && state.activity !== "睡觉" && state.activity !== "失眠中")) {
    state.wantToTalkReason = null;
  }
  state.wantToTalk = newWantToTalk;

  if (!state.wantToTalkReason) {
    if (state.wantToTalk) {
      state.wantToTalkReason = pickRandom([
        "心情不错想聊天",
        "有点无聊想找人",
        "刚好有空"
      ]);
    } else {
      state.wantToTalkReason = pickRandom([
        "想自己待一会儿",
        "没什么想说的",
        "累了"
      ]);
    }
  }
}

/**
 * 未读消息衰减——太久了就无所谓了
 */
function decayUnread(state) {
  // 如果有未读消息且超过 12 小时
  const hoursSince = state._hoursSinceInteraction;
  if (state.unreadMessages > 0 && hoursSince !== null && hoursSince > 12) {
    if (Math.random() < 0.01) {
      state.unreadMessages = Math.max(0, state.unreadMessages - 1);
    }
  }
}

/**
 * 生成默认想法
 */
function generateDefaultThought(state) {
  const hour = state._hour;

  if (state.activity === "睡觉") return null;

  const thoughts = [];

  // 时间段 → 自然思绪片段
  if (hour < 2) {
    thoughts.push(
      "盯着天花板看了一会儿，也不知道自己在想什么",
      "刷到一个视频，看完忘了讲什么",
      "明明很困就是不想睡",
      "明天第一节有课，但不想管了"
    );
  }
  if (hour >= 7 && hour < 9) {
    thoughts.push(
      "闹钟响了三次才醒",
      "不想起来，被窝里好暖和",
      "今天穿什么好呢"
    );
  }
  if (hour >= 9 && hour < 12) {
    thoughts.push(
      "老师讲到哪里了，没跟上",
      "中午吃什么好呢",
      "好困，昨晚不该熬夜的",
      "这节课怎么还没下课"
    );
  }
  if (hour >= 12 && hour < 14) {
    thoughts.push(
      "中午没吃饱，现在又不想下楼，翻翻外卖",
      "吃饱了想睡觉",
      "下午的课能不能不去"
    );
  }
  if (hour >= 14 && hour < 18) {
    thoughts.push(
      "盯着窗外看了一会儿，树在晃",
      "这个作业明天交，但不想写",
      "好无聊啊，有没有什么好玩的",
      "想出去走走但又懒得动"
    );
  }
  if (hour >= 18 && hour < 21) {
    thoughts.push(
      "晚上打两把瓦",
      "晚饭吃啥呢，不想再吃食堂了",
      "今天好像什么都没干"
    );
  }
  if (hour >= 21 && hour < 24) {
    thoughts.push(
      "今天过得还行",
      "想打一把再睡",
      "明天又是满课，烦"
    );
  }

  // 状态相关的思绪
  if (state.gaming.playing && state.gaming.streak > 2) {
    thoughts.push("手感正热，这把还能赢");
  }
  if (state.gaming.playing && state.gaming.streak < -2) {
    thoughts.push("队友到底会不会玩");
  }
  if (state.physical.includes("长痘中")) {
    thoughts.push("这颗痘怎么还不消，烦死了");
  }
  if (state.physical.includes("轻微头疼")) {
    thoughts.push("头有点疼，想躺着");
  }

  if (thoughts.length === 0) return null;
  return pickRandom(thoughts);
}

// ═══════════════════════════════════════════════════════════════
// 环境情绪 & 情感张力 — 跟 GSQ 无关的日常 + 没说破的关系
// ═══════════════════════════════════════════════════════════════

/**
 * 生成环境情绪——跟 GSQ 完全无关的日常烦恼和开心。
 * 让她有"自己的生活"，不只是围绕一个人转。
 */
function generateEnvironmentalThought(state) {
  const hour = state._hour;
  const atHome = state.location === "在家" || state.location === "在家床上" || state.location === "在家睡觉";
  const atSchool = state.location === "在学校";
  const thoughts = [];

  // 通用
  thoughts.push(
    "快递到了，是新买的那件衣服",
    "手机快没电了，充电器又不在身边",
    "突然想喝奶茶",
    "看到一个好好笑的评论，截图了"
  );

  if (atHome) {
    thoughts.push(
      "室友在公放抖音，烦得要死",
      "隔壁又在装修，吵死了",
      "家里没零食了，该去买了",
      "空调温度开太低了，有点冷"
    );
  }

  if (atSchool) {
    thoughts.push(
      "老师今天点名了，还好你去了",
      "旁边的人在吃零食，好香",
      "黑板上写的什么根本看不清",
      "后排有人在打游戏，你也想打"
    );
  }

  return pickRandom(thoughts);
}

/**
 * 生成情感张力——和 GSQ 关系里那些没说破的东西。
 * 概率很低（~5%），偶尔冒出来一下就沉下去。
 */
function generateEmotionalTensionThought(state) {
  const hoursSince = state._hoursSinceInteraction;
  const thoughts = [];

  if (hoursSince !== null && hoursSince <= 3) {
    thoughts.push(
      "他好像真的挺在乎我的",
      "跟他聊天的时候其实挺开心的，虽然不想让他知道",
      "他今天说话好像有点不一样"
    );
  } else if (hoursSince !== null && hoursSince <= 12) {
    thoughts.push(
      "他是不是也在等我先找他",
      "算了不想了，想了也没用",
      "其实也不是非他不可…吧"
    );
  } else if (hoursSince !== null && hoursSince > 12) {
    thoughts.push(
      "我今天是不是对他太凶了",
      "他怎么还不找我…算了不想了",
      "其实有点想他，但打死也不说"
    );
  } else {
    thoughts.push(
      "不知道他现在在干嘛",
      "有时候觉得自己对他太凶了"
    );
  }

  if (state.moodValue >= 7) {
    thoughts.push(
      "今天天气好好，要是他在就好了",
      "想到他说的某句话，偷偷笑了一下"
    );
  }

  return pickRandom(thoughts);
}

// ═══════════════════════════════════════════════════════════════
// 生成给 wechat_bridge.js 用的自然语言状态描述
// 微小说体：2-4 句有画面感的描述，不罗列信息
// ═══════════════════════════════════════════════════════════════

/**
 * 从状态对象生成一段中文描述，注入到 system prompt 前面。
 * wechat_bridge.js 可以直接调用这个函数，也可以直接读 JSON 自行拼接。
 */
export function generateStateDescription(state) {
  const lines = [];
  const hour = state._hour ?? new Date().getHours();
  const loc = state.location || "在家";
  const act = state.activity || "待着";
  const moodTexture = resolveMoodTexture(state.moodValue);

  // ===== 第一行：场景画面（微小说体）=====
  const sceneLine = buildSceneLine(state, hour, loc, act, moodTexture);
  lines.push(sceneLine);

  // ===== 第二行（可选）：身体状况 / 打瓦 / 在想的事 =====
  const detailLine = buildDetailLine(state);
  if (detailLine) lines.push(detailLine);

  // ===== 第三行：对他消息的态度 =====
  const attitudeLine = buildAttitudeLine(state);
  lines.push(attitudeLine);

  // 最多 4 行
  if (lines.length > 4) {
    return lines.slice(0, 4).join("\n");
  }
  return lines.join("\n");
}

/**
 * 构建场景画面行——用有画面感的描述替代信息清单。
 */
function buildSceneLine(state, hour, loc, act, moodTexture) {
  const locIn = loc.startsWith("在") ? loc : "在" + loc;

  // 按时间段 + 活动类型选用不同的画面模板
  let scene;

  if (state.activity === "睡觉") {
    if (hour >= 2 && hour < 7) {
      scene = `凌晨${hour}点，你在${loc}，睡得很沉。`;
    } else if (hour >= 7 && hour < 9) {
      scene = `早上${hour}点，你还在${loc}，闹钟还没响。`;
    } else {
      scene = `你在${loc}，睡着了。`;
    }
  } else if (state.activity === "失眠翻来覆去") {
    scene = pickRandom([
      `凌晨${hour}点，你躺在${loc.includes("床") ? "床上" : loc}翻来覆去，怎么都睡不着。`,
      `夜深了，你窝在${loc.includes("床") ? "床上" : loc}，眼睛盯着天花板，脑子很清醒。`
    ]);
  } else if (state.activity === "打瓦") {
    scene = pickRandom([
      `你窝在${loc.includes("在家") ? "电脑前" : loc}打瓦，屏幕的光映在脸上。${state.gaming?.streak > 0 ? "手感正热。" : state.gaming?.streak < 0 ? "队友已经开始送了。" : ""}`,
      `${hour >= 22 || hour < 2 ? "夜深了，" : ""}你在打瓦。耳机里是枪声和队友的报点。${state.gaming?.streak > 2 ? "这把稳了。" : state.gaming?.streak < -2 ? "心态快崩了。" : ""}`
    ]);
  } else if (hour >= 0 && hour < 2) {
    scene = pickRandom([
      `已经过了零点，外面很安静。你${locIn}${act}，屏幕是房间里唯一的光。`,
      `夜深了，你还没睡。${locIn}${act}，也不知道在等什么。`
    ]);
  } else if (hour >= 2 && hour < 7) {
    scene = `凌晨${hour}点，你${locIn}，${act}。`;
  } else if (hour >= 7 && hour < 9) {
    scene = pickRandom([
      `清晨的光还没完全亮，你${locIn}，${act}。`,
      `闹钟响过了，你${locIn}，${act}。`
    ]);
  } else if (hour >= 9 && hour < 12) {
    if (state.location === "在学校" && act === "上课") {
      scene = pickRandom([
        `上午的课还在上，你坐在教室里。老师在讲台上说着什么，你有一搭没一搭地听着。`,
        `讲台上老师的声音像背景白噪音。你坐在教室里，${act}。`
      ]);
    } else {
      scene = pickRandom([
        `上午了，你${locIn}，${act}。阳光从窗户斜进来。`,
        `早上的时间慢悠悠的，你${locIn}，${act}。`
      ]);
    }
  } else if (hour >= 12 && hour < 14) {
    scene = pickRandom([
      `中午，你${locIn}，${act}。`,
      `正午的阳光有点晃眼，你${locIn}，${act}。`
    ]);
  } else if (hour >= 14 && hour < 18) {
    if (state.location === "在学校" && act === "上课") {
      scene = pickRandom([
        `下午的课还在继续。你坐在教室里，窗外的光慢慢变黄。`,
        `教室里有点闷，你${act}，等着下课。`
      ]);
    } else if (act === "摸鱼刷手机") {
      scene = pickRandom([
        `下午的课结束了，你${locIn}，刷着手机。不是有什么想看的——就是不想动。`,
        `你${locIn}，手里划着屏幕。下午的时间好像特别长。`
      ]);
    } else {
      scene = pickRandom([
        `下午了，你${locIn}，${act}。`,
        `太阳开始偏西，你${locIn}，${act}。`
      ]);
    }
  } else if (hour >= 18 && hour < 21) {
    scene = pickRandom([
      `天暗下来了。你${locIn}，${act}。`,
      `傍晚，窗外天的颜色在变。你${locIn}，${act}。`
    ]);
  } else if (hour >= 21 && hour < 24) {
    scene = pickRandom([
      `晚上${hour}点，外面安静下来。你${locIn}，${act}。`,
      `夜深了，你${locIn}，${act}。明天还有课，但你暂时不想管。`
    ]);
  } else {
    scene = `你${locIn}，${act}。`;
  }

  // 拼接 mood 质感作为第二句（如果场景本身还没包含情绪）
  return `${scene} ${moodTexture}`;
}

/**
 * 构建细节行：身体不适、打瓦战果、在想的事、未读消息等。
 */
function buildDetailLine(state) {
  const parts = [];

  if (state.physical && state.physical.length > 0) {
    parts.push(state.physical.join("、"));
  }

  if (state.gaming && state.gaming.recentResult) {
    parts.push(state.gaming.recentResult);
  }

  if (state.thinkingAbout) {
    // 思绪用更自然的引述
    parts.push(`在想：${state.thinkingAbout}`);
  }

  if (state.unreadMessages > 0) {
    parts.push(`他有${state.unreadMessages}条消息你没回`);
  }

  if (state.socialBattery <= 3) {
    parts.push("社交能量很低，不想多说话");
  }

  if (parts.length === 0) return null;
  return parts.join("。") + "。";
}

/**
 * 构建对 GSQ 消息的态度行——具有画面感，不干瘪。
 */
function buildAttitudeLine(state) {
  if (state.activity === "睡觉") {
    return "他发消息来了，但你在睡觉，没看到。";
  }

  if (state.wantToTalk) {
    if (state.moodValue >= 8) {
      return pickRandom([
        "他发消息来了。你看到提示，嘴角弯了一下。",
        "他发消息来了。正好，你也有话想说。"
      ]);
    }
    return "他发消息来了。";
  }

  // 不想聊——根据心情给不同的画面
  if (state.moodValue <= 3) {
    return pickRandom([
      "他发消息来了。你看了眼手机，把屏幕扣在桌上。",
      "他发消息来了。但你不想回，现在谁都不想理。"
    ]);
  }

  if (state.gaming && state.gaming.playing && state.gaming.streak < 0) {
    return "他发消息来了。你正输得上头，看了一眼没回。";
  }

  if (state.socialBattery <= 3) {
    return pickRandom([
      "他发消息来了。你看到了，但今天社交能量用完了。",
      "他发消息来了。等会儿再回吧，现在不想说话。"
    ]);
  }

  return pickRandom([
    "他发消息来了，但你现在不太想多聊。",
    "他发消息来了。你看到了，等会儿再说。"
  ]);
}

/**
 * 生成主动消息的提示词——根据她当前状态
 * wechat_bridge.js 在发送主动消息时调用这个函数获取更贴切的 prompt
 */
export function generateProactivePrompt(state, targetName) {
  const hour = state._hour;

  // 根据她当前的状态决定发起方式
  let mood;

  if (state.gaming && state.gaming.playing && state.gaming.streak > 2) {
    // 打瓦连胜 → 炫耀
    mood = `你刚打瓦${state.gaming.recentResult}，特别开心，想跟${targetName}炫耀一下。`;
  } else if (state.gaming && state.gaming.recentResult && state.gaming.streak < 0) {
    // 打瓦连跪 → 求安慰或吐槽
    mood = `你打瓦${state.gaming.recentResult}，想跟${targetName}吐槽队友。`;
  } else if (state.activity === "失眠翻来覆去") {
    mood = `你失眠了睡不着，想找${targetName}聊天。`;
  } else if (state.thinkingAbout && state.thinkingAbout.includes("猫")) {
    mood = `你刚看到一只可爱的猫，想发给${targetName}看。`;
  } else if (state.physical && state.physical.length > 0) {
    mood = `你${state.physical.join("、")}，想跟${targetName}说一下（求关心）。`;
  } else if (state._hoursSinceInteraction !== null && state._hoursSinceInteraction > 12) {
    mood = `你好久没找${targetName}了，他也没找你。你想试探一下他在干嘛。`;
  } else if (state.socialBattery <= 3) {
    // 社交电池低→简短随意
    mood = `你不太想多聊，但有一件小事想跟${targetName}说一下。`;
  } else if (state.moodValue >= 8) {
    mood = `你心情特别好，想跟${targetName}分享一件好玩的事。`;
  } else if (state.moodValue <= 3) {
    mood = `你心情不太好，想跟${targetName}说一下（不一定要他解决，就是想说说）。`;
  } else {
    // 默认
    const defaults = [
      `你刚看到一个东西/发生了一件小事，想跟${targetName}分享。直接说事，不要铺垫。`,
      `你想起之前他说过的一句话/答应你的一件事，追问一下。`,
      `你突然想到他就找他。不要问在干嘛，直接说你想说的。`,
      `你有点无聊，想看他猫。直接要。`,
      `你在打游戏/看视频/刷到有意思的东西，发给${targetName}看。`,
    ];
    mood = pickRandom(defaults);
  }

  return `你现在想主动找 ${targetName} 聊天。${mood}
规则：
- 1-3句，极短，发微信不是写小作文
- 不要打招呼（不说"在吗""hi"之类）
- 不要用 --- 分隔符，就发一条
- 用你的自然语气
- 不要和最近聊天记录重复`;
}

/**
 * 生成事件驱动的主动消息提示词——基于 impulseToMessage + 当前状态。
 * 与 generateProactivePrompt 不同，这个函数使用事件的具体原因和意图，
 * 让 AI 生成的主动消息跟她生活中刚刚发生的事情一致。
 *
 * @param {object} state - 完整状态对象（包含 impulseToMessage）
 * @param {string} targetName - 目标用户名
 * @returns {string} 主动消息的 system prompt
 */
export function generateImpulsePrompt(state, targetName) {
  const impulse = state.impulseToMessage;
  if (!impulse || !impulse.triggered) return null;

  const reason = impulse.reason || "发生了一件事";
  const whatToSay = impulse.whatToSay || "想跟你说个事";
  const intensity = impulse.intensity || "medium";

  // 当前状态的一句描述，帮助 AI 保持语气一致
  let stateLine = "";
  if (state.moodValue >= 8) {
    stateLine = "你现在心情很好，说话会比较轻快。";
  } else if (state.moodValue <= 3) {
    stateLine = "你现在心情不太好，说话会比较冲或者很短。";
  } else if (state.activity === "失眠翻来覆去") {
    stateLine = "你失眠了，脑子半睡半醒，说话会比较碎。";
  } else if (state.gaming && state.gaming.playing) {
    stateLine = "你正在打瓦，一边打一边发消息。";
  } else if (state.socialBattery <= 3) {
    stateLine = "你今天社交能量用完了，话很短。";
  }

  // 根据 intensity 调整语气
  let intensityHint = "";
  if (intensity === "high") {
    intensityHint = "你特别想说这件事，不用铺垫，直接说。";
  } else if (intensity === "low") {
    intensityHint = "你不太确定要不要说，可能会说一半又撤回或者突然不想说了。";
  }

  return `你现在想主动找 ${targetName} 说话。

**你为什么找他：** ${reason}
**你想说的：** ${whatToSay}
${stateLine ? `**你现在的状态：** ${stateLine}` : ""}${intensityHint ? `**说话冲动程度：** ${intensityHint}` : ""}

规则：
- 1-3句，极短，发微信不是写小作文
- 不要打招呼（不说"在吗""hi"之类）
- 不要用 --- 分隔符，就发一条
- 用你的自然语气，跟你平时的风格一致
- 不要和最近聊天记录重复
- 你的话跟你现在的心情和状态一致`;
}

/**
 * 格式化时间：从 +08:00 ISO 字符串提取 HH:MM（北京时间）
 */
function formatTime(isoString) {
  if (!isoString) return "??:??";
  try {
    // 直接从字符串中提取北京时间部分：YYYY-MM-DDTHH:MM:SS+08:00
    const match = isoString.match(/T(\d{2}):(\d{2})/);
    if (match) return `${match[1]}:${match[2]}`;
    return "??:??";
  } catch {
    return "??:??";
  }
}

// ═══════════════════════════════════════════════════════════════
// 主循环
// ═══════════════════════════════════════════════════════════════

let state = null;
let intervalId = null;

async function runOnce() {
  const now = new Date();
  if (!state) state = loadState();
  await tick(state, now);
  saveState(state);
  return state;
}

function startLoop(intervalMs = 60_000) {
  // 加载 .env 配置（AI 事件生成器依赖）
  loadEnvForAI();

  console.log("[xaj_life] 奚艾佳人生模拟引擎启动");
  console.log(`[xaj_life] 更新间隔: ${intervalMs / 1000}秒`);
  console.log(`[xaj_life] 状态文件: ${STATE_FILE}`);
  console.log(`[xaj_life] 记忆文件: ${MEMORY_FILE}`);
  if (!AI_EVENT_ENABLED) {
    console.log("[xaj_life] AI 生活事件生成器: 已禁用（AI_EVENT_ENABLED=false）");
  } else if (!process.env.API_KEY) {
    console.log("[xaj_life] AI 生活事件生成器: 未配置 API_KEY，跳过");
  } else {
    console.log("[xaj_life] AI 生活事件生成器: 已启用（间隔约10分钟）");
  }

  // 首次立即更新
  state = loadState();
  runOnce().then(() => {
    console.log(`[xaj_life] 初始状态: ${state.activity} @ ${state.location} | 心情 ${state.mood}(${state.moodValue}) | ${state.wantToTalk ? "想" : "不想"}聊天`);
  });

  // 每分钟更新一次
  intervalId = setInterval(() => {
    try {
      runOnce();
    } catch (err) {
      console.error("[xaj_life] tick 错误:", err.message);
    }
  }, intervalMs);

  // 优雅退出
  process.on("SIGINT", () => {
    console.log("\n[xaj_life] 收到退出信号，保存最终状态…");
    if (intervalId) clearInterval(intervalId);
    saveState(state);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    if (intervalId) clearInterval(intervalId);
    saveState(state);
    process.exit(0);
  });
}

// ═══════════════════════════════════════════════════════════════
// CLI 入口 — 仅在直接运行时执行，import 时不触发
// ═══════════════════════════════════════════════════════════════

function isMainModule() {
  // 在 ESM 中，直接运行时 process.argv[1] 指向本文件
  if (!process.argv[1]) return false;
  const argv1 = path.resolve(process.argv[1]);
  const self = path.resolve(fileURLToPath(import.meta.url));
  return argv1 === self;
}

if (isMainModule()) {
  main(process.argv.slice(2));
}

function main(args) {
if (args.includes("--once") || args.includes("-1")) {
  // 单次模式
  loadEnvForAI();
  const result = runOnce().then(result => {
    const publicState = {};
    for (const key of Object.keys(result)) {
      if (!key.startsWith("_")) publicState[key] = result[key];
    }
    console.log(JSON.stringify(publicState, null, 2));
    // 同时输出自然语言描述
    console.log("\n--- 自然语言描述 ---");
    console.log(generateStateDescription(result));
    process.exit(0);
  });
} else if (args.includes("--show") || args.includes("-s")) {
  // 显示当前状态
  const current = loadState();
  console.log(JSON.stringify(current, null, 2));
  console.log("\n--- 自然语言描述 ---");
  console.log(generateStateDescription(current));
  process.exit(0);
} else if (args.includes("--help") || args.includes("-h")) {
  console.log(`
奚艾佳人生模拟引擎 (xaj_life.js)

用法:
  node xaj_life.js              守护进程模式，每分钟更新一次
  node xaj_life.js --once       单次更新状态并退出
  node xaj_life.js --show       打印当前状态并退出
  node xaj_life.js --help       显示此帮助

输出文件:
  xaj_state.json                当前状态的 JSON 文件
  xaj_memory.json               记忆库（需手动创建或由 bridge 写入）

集成:
  wechat_bridge.js 读取 xaj_state.json，
  调用 generateStateDescription() 注入 system prompt。
`);
  process.exit(0);
} else {
  // 默认：守护进程模式
  startLoop();
}
} // end main()
