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
        "今天手感还行，试试",
        "打一把再睡"
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
        s.thinkingAbout = "今天瓦打得不错，收工";
      } else if (s.gaming.streak < 0) {
        s.thinkingAbout = "不打了不打了，今天没手感";
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
      s.thinkingAbout = "怎么又长痘了，烦";
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
      s.thinkingAbout = "头好痛，想躺着";
    },
    description: "头疼"
  },
  {
    id: "acne_heal",
    probability: 0.005,
    condition: (s) => s.physical.includes("长痘中"),
    apply(s) {
      s.physical = s.physical.filter(p => p !== "长痘中");
      s.thinkingAbout = "痘终于消了";
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
      s.thinkingAbout = "头不疼了，舒服";
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
        "怎么就是睡不着",
        "他在干嘛呢",
        "明天还要上课，烦"
      ]);
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
        "刷到一个好笑的视频想发给他",
        "这个视频好抽象",
        "笑死了分享给他"
      ]);
      s.wantToTalk = s.moodValue >= 5;
      if (s.wantToTalk) s.wantToTalkReason = "刷到好笑的东西想分享";
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
        "刷到有点难过的东西",
        "突然想到一些事"
      ]);
      s.wantToTalk = s.moodValue >= 6;
      s.wantToTalkReason = s.wantToTalk ? "心情不好想要安慰" : "心情不好不想说话";
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
        "好饿，想吃东西",
        "不知道吃什么",
        "想吃火锅"
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
        "想买衣服",
        "看到一条裙子好好看",
        "又要剁手了"
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
        "好想去海边",
        "想去看雪",
        "好想出去玩，不想上课了",
        "想去日本"
      ]);
      s.moodValue = Math.min(10, s.moodValue + 1);
      s.wantToTalk = true;
      s.wantToTalkReason = "突然想去旅行，想跟他说";
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
      s.thinkingAbout = "下雨了，不想出门";
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
    // 以下为元数据，不输出到状态文件
    _tickCount: 0
  };
}

// ═══════════════════════════════════════════════════════════════
// 核心：状态更新逻辑（每分钟执行一次）
// ═══════════════════════════════════════════════════════════════

function tick(state, now) {
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

  // 7. 随机事件抽选
  rollRandomEvents(state);

  // 8. 确保状态一致性
  ensureConsistency(state);

  // 9. 计算最终的 wantToTalk
  calculateWantToTalk(state, period);

  // 10. 处理未读消息的衰减
  decayUnread(state);

  // 11. 生成默认想法
  if (!state.thinkingAbout) {
    state.thinkingAbout = generateDefaultThought(state);
  }

  // 12. 社交电池自然恢复
  if (state.socialBattery < 10) {
    state.socialBattery = Math.min(10, +(state.socialBattery + 0.02).toFixed(2));
  }

  // 13. 睡觉时清空 thinkingAbout
  if (state.activity === "睡觉") {
    state.thinkingAbout = null;
  }

  // 14. 数字精度修复
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
    eventsTriggered++;
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

  // 如果 wantToTalk 发生变化，重置原因
  if (newWantToTalk !== state.wantToTalk) {
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

  // 根据时间段
  if (hour < 2) thoughts.push("明天还要早起", "睡不着", "再刷一会儿就睡");
  if (hour >= 9 && hour < 12) thoughts.push("好困", "不想上课", "今天吃什么");
  if (hour >= 12 && hour < 14) thoughts.push("吃饱了想睡", "下午干嘛呢");
  if (hour >= 14 && hour < 18) thoughts.push("好无聊", "想出去玩", "不想写作业");
  if (hour >= 18 && hour < 21) thoughts.push("晚上打两把", "晚饭吃啥");
  if (hour >= 21 && hour < 24) thoughts.push("今天过得还行", "想打瓦");

  // 根据状态
  if (state.gaming.playing && state.gaming.recentResult) {
    thoughts.push(state.gaming.recentResult);
  }
  if (state.physical.includes("长痘中")) thoughts.push("这痘什么时候消");
  if (state.physical.includes("轻微头疼")) thoughts.push("头还是有点疼");

  if (thoughts.length === 0) return null;
  return pickRandom(thoughts);
}

// ═══════════════════════════════════════════════════════════════
// 生成给 wechat_bridge.js 用的自然语言状态描述
// 要求：简短自然，不超过 3 行
// ═══════════════════════════════════════════════════════════════

/**
 * 从状态对象生成一段中文描述，注入到 system prompt 前面。
 * wechat_bridge.js 可以直接调用这个函数，也可以直接读 JSON 自行拼接。
 */
export function generateStateDescription(state) {
  const lines = [];

  // 第一行：时刻 + 位置 + 活动 + 心情
  const timeStr = formatTime(state.time);
  let line1 = `[现在时刻: ${timeStr}] `;
  // 避免"在在家"等重复：如果 location 已含"在"则不加
  const loc = state.location || "未知";
  if (loc.startsWith("在")) {
    line1 += `你${loc}，${state.activity || "待着"}。`;
  } else {
    line1 += `你在${loc}，${state.activity || "待着"}。`;
  }
  if (state.mood) {
    line1 += `心情${state.mood}。`;
  }
  lines.push(line1);

  // 第二行：特殊情况（身体不适、打瓦结果、社交电池低等）
  const extras = [];
  if (state.physical && state.physical.length > 0) {
    extras.push(state.physical.join("、"));
  }
  if (state.gaming && state.gaming.recentResult) {
    extras.push(state.gaming.recentResult);
  }
  if (state.socialBattery <= 3) {
    extras.push("你今天社交能量很低，不想多说话");
  }
  if (extras.length > 0) {
    lines.push(extras.join("。") + "。");
  }

  // 第三行：在想的事情 + 对他的态度
  const attitude = [];
  if (state.thinkingAbout) {
    attitude.push(`正在想：${state.thinkingAbout}`);
  }
  if (state.wantToTalk === false && state.wantToTalkReason && state.activity !== "睡觉") {
    attitude.push(state.wantToTalkReason);
  }
  if (state.unreadMessages > 0) {
    attitude.push(`他有${state.unreadMessages}条消息你没回`);
  }
  if (attitude.length > 0) {
    lines.push(attitude.join("。") + "。");
  }

  // 最后一句：他发消息来了
  if (state.activity === "睡觉") {
    lines.push("他发消息来了，但你在睡觉，没看到。");
  } else if (state.wantToTalk) {
    lines.push("他发消息来了。");
  } else {
    lines.push("他发消息来了，但你现在不太想多聊。");
  }

  const full = lines.join("\n");
  // 如果太长（超过 3 行），精简
  const lineCount = full.split("\n").length;
  if (lineCount > 4) {
    return lines.slice(0, 3).join("\n");
  }

  return full;
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

function runOnce() {
  const now = new Date();
  if (!state) state = loadState();
  tick(state, now);
  saveState(state);
  return state;
}

function startLoop(intervalMs = 60_000) {
  console.log("[xaj_life] 奚艾佳人生模拟引擎启动");
  console.log(`[xaj_life] 更新间隔: ${intervalMs / 1000}秒`);
  console.log(`[xaj_life] 状态文件: ${STATE_FILE}`);
  console.log(`[xaj_life] 记忆文件: ${MEMORY_FILE}`);

  // 首次立即更新
  state = loadState();
  runOnce();
  console.log(`[xaj_life] 初始状态: ${state.activity} @ ${state.location} | 心情 ${state.mood}(${state.moodValue}) | ${state.wantToTalk ? "想" : "不想"}聊天`);

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
  const result = runOnce();
  const publicState = {};
  for (const key of Object.keys(result)) {
    if (!key.startsWith("_")) publicState[key] = result[key];
  }
  console.log(JSON.stringify(publicState, null, 2));
  // 同时输出自然语言描述
  console.log("\n--- 自然语言描述 ---");
  console.log(generateStateDescription(result));
  process.exit(0);
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
