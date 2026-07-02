# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 启动流程（每次对话开始时执行）

**先读记忆文件：** 每次新对话开始时，必须先读取 `C:\Users\15001\.claude\projects\D--Visual-Studio-Project\memory\MEMORY.md` 和其中链接的所有记忆文件，了解项目状态和上一次工作的上下文。

## Build Commands

The project uses MSBuild via Visual Studio (v145 toolset, C++20).

```bash
# Build from project directory (Debug x64)
msbuild 2520109/2520109.vcxproj /p:Configuration=Debug /p:Platform=x64

# Build from solution
msbuild 2520109/2520109.slnx /p:Configuration=Debug /p:Platform=x64

# Release x64
msbuild 2520109/2520109.vcxproj /p:Configuration=Release /p:Platform=x64

# Run the built executable
2520109/x64/Debug/2520109.exe
```

Alternatively, open `2520109/2520109.slnx` in Visual Studio and use the IDE build/run commands.

## Architecture

This is an educational C++ data structures project implementing three classic data structures, each with its own entry-point `.cpp` file. **Only one `.cpp` is compiled at a time** — switch via the vcxproj's `<ClCompile>` element.

### Binary Tree (`bitree.h` and `2520109.cpp`)
- **Definition**: `BiTNode` with `data` (char), `lchild`, `rchild` pointers — `BiTree` is a pointer typedef.
- **Creation**: Preorder traversal from a serialized string (`AB#1##2#e##`), where `#` denotes NULL.
- **Operations**: Post-order traversal, case conversion on node data, left/right subtree swap.
- **Display**: Tree visualization rendered to a 2D character buffer and drawn in the console (`show_tree`, `printInBuf`, etc.).

### Linked List (`linklist.h`, exercised by `test_linklist.cpp`)
- **Definition**: Singly-linked list (`LinkNode`) storing `Student` records (id, name, height, gender).
- **Data source**: Reads from `records.txt` (whitespace-delimited fields).
- **Creation modes**: `CreateList_1` (head insertion), `CreateList_2` (tail insertion).
- **Operations**: `Sort_id` (insertion sort by student id), `ReverseList` (in-place reversal), `TraverseList` (print), `Save` (write to file).
- **Test harness**: `test_linklist.cpp` — runs all linked list operations end-to-end, saving intermediates to `output1.txt`–`output4.txt`.

### Hash Table (`hash_table.h`, exercised by `student_management.cpp`)
- **Definition**: Chain-addressed hash table (`HashTable`) with `TABLE_SIZE=13` buckets, storing a different `Student` struct (id, name, gender, age, score).
- **Hash function**: Division remainder method (`HashFunc`).
- **Operations**: `SearchById`, `SearchByName`, `Insert` (head-insert into bucket chain), `Delete`, `Update`, `TraverseTable`, `LoadFromFile`, `SaveToFile`.
- **SortAndExport**: Sorts all records (male first, then by descending score), exports a report with pass-rate statistics to file and console.
- **Interactive UI**: `student_management.cpp` — console menu system (add/delete/search/update/list/sort-export).

### Switching Entry Points
The vcxproj compiles exactly one source file. To change which program builds:
1. Open `2520109/2520109.vcxproj` and change the `<ClCompile Include="...">` line under `<ItemGroup>`:
   - `student_management.cpp` (current) — hash table management system
   - `2520109.cpp` — binary tree demo
   - `test_linklist.cpp` — linked list test harness

### Files
- `2520109/2520109.cpp` — Binary tree demo entry point.
- `2520109/bitree.h` — Binary tree definition + operations (header-only).
- `2520109/linklist.h` — Linked list + student record operations (header-only).
- `2520109/test_linklist.cpp` — Linked list test harness.
- `2520109/hash_table.h` — Hash table definition + operations (header-only).
- `2520109/student_management.cpp` — Hash table interactive management system.
- `2520109/records.txt` — Student data (consumed by both `linklist.h` and `hash_table.h`).
- `2520109/2520109.vcxproj` — MSBuild project file (Console Application, C++20, v145 toolset).
- `2520109/2520109.slnx` — Solution file (VS 2022+ format).
- `2520109/output1.txt`–`output4.txt`, `sorted_output.txt` — Program-generated output.
- `main.cpp` — Minimal "hello world" test program at project root (not in vcxproj).

### 交流约定
- **始终使用中文回复**，无论是对话、代码注释还是文档说明。

### Agent 三层架构

所有任务按职责自动分发到三层 Agent 体系，层级之间各司其职、并行优先。

```
用户请求
  │
  ├─ Tier 1: 本地执行层 ─────────────────────┐
  │  多 Agent 并行：文件搜索、代码编辑、git 操作   │  并行
  │  模型：读操作用 Haiku，分析/编辑用 Sonnet     │
  │                                              ├─── Tier 1 + Tier 2 可同时跑
  ├─ Tier 2: 信息搜索层 ─────────────────────┘
  │  单专用 Agent：Web Search Agent（Haiku）
  │  职责：搜索文档、API 参考、Skill/插件、
  │        npm 包、技术方案
  │  规则：Tier 1 Agent 遇到不确定的 API/库/配置，
  │        禁止猜测，必须委托 Web Agent 搜索后再行动
  │
  └─ Tier 3: 服务器执行层（独立，不阻塞本地）
     server-agent.js（日本服务器），通过 SSH 调用
     职责：服务管理（nginx/pm2/systemd）、日志检查、
           代码部署（git pull/build/restart）
     模型：默认
```

#### 层级规则

| 层级 | 最大并发 | 模型 | 职责 |
|------|---------|------|------|
| Tier 1 本地执行 | 4~6 个 | Haiku（读）/ Sonnet（分析+写） | 文件搜索、代码编辑、git 操作、构建 |
| Tier 2 信息搜索 | 1~2 个 | Haiku（轻量搜索） | Web 搜索文档、API、包、方案 |
| Tier 3 服务器 | 2~3 个 | 默认 | SSH 管理服务器、部署、日志 |
| **全局上限** | **≤10 个** | — | 超出排队等待，防止 API 限流 |

#### 并发约束

1. **写操作串行**：多个 Agent 可同时读文件/搜索，但同时只能有一个 Agent 执行 Edit/Write，防止文件冲突
2. **Tier 2 限制**：WebSearch 接口限流严重，同时最多 2 个搜索 Agent，多开只会排队
3. **Tier 3 限制**：SSH 连接受服务器 MaxStartups 限制，同时最多 3 个连接
4. **读优先**：Grep/Glob/Read 不限并发，越多越快

#### 核心约束

1. **写前必查**：任何写操作（代码编辑、git push、部署）前，必须先完成相关搜索
   - 写代码前 → Tier 2 搜文档/API 确认方案
   - 部署前 → Tier 3 查服务器状态确认可部署
2. **不猜原则**：Tier 1 Agent 遇到不确定的 API、库用法、配置项时，禁止自行推测，必须委托 Tier 2 Web Agent 搜索确认
3. **Tier 3 不阻塞本地**：服务器操作完全独立运行，Tier 1/2 不需要等待 Tier 3
4. **Tier 1 + Tier 2 可并行**：两个层级同时启动，搜索结果返回后 Tier 1 继续执行
5. **中断不丢弃**：用户发出新指令时，如果之前有未完成的任务，必须同时处理——启动新 Agent 执行新任务，旧 Agent 继续完成旧任务。两者并行，互不阻塞。不得丢弃未完成的工作

#### 中断处理模式

```
用户: "重构 hash_table.h"    ← 正在执行中…
  │
  ├─ Agent(Sonnet): 审查 hash_table.h ──继续──▶ 生成重构方案
  │
  └─ 用户插入新指令: "检查服务器状态"
       │
       └─ Agent(Haiku): SSH 检查服务器 ──并行──▶ 报告结果
       
  旧 Agent 不中断，新 Agent 立即启动。
  两个结果都返回后逐一汇报。
```

#### 典型流程

```
"给项目加一个 Redis 缓存层"
  │
  ├─ Tier 2: Web Agent(Haiku)
  │   → 搜索 C++ Redis 客户端库（hiredis/cpp_redis）
  │   → 搜索 Redis 连接池最佳实践
  │   → 返回推荐方案 + API 文档链接
  │
  ├─ Tier 1: 代码分析 Agent(Sonnet) ── 收到 Tier 2 结果后 ──→
  │   → 分析现有代码，设计缓存插入点
  │
  ├─ Tier 1: 文件搜索 Agent(Haiku) ── 并行 ──→
  │   → 搜索项目中所有适合加缓存的热点路径
  │
  └─ Tier 3: 服务器 Agent
      → SSH 检查 Redis 是否已安装运行
      → 确认后可部署
```

```
"重构 hash_table.h 并部署到服务器"
  │
  ├─ Tier 2: Web Agent(Haiku)
  │   → 搜索 C++20 哈希表最新特性（std::flat_hash_map 等）
  │   → 搜索开链哈希 vs 开放寻址的取舍
  │
  ├─ Tier 1: 代码审计 Agent(Sonnet) ── 收到 Tier 2 结果后 ──→
  │   → 审查 hash_table.h，生成重构方案
  │
  ├─ Tier 1: 编辑 Agent(Sonnet) ── 收到方案后 ──→
  │   → 执行代码修改
  │
  └─ Tier 3: 服务器 Agent ── 编辑完成后 ──→
      → SSH 检查服务器状态 → git pull → build → restart
```

### Key Conventions
- Header-only implementation: `bitree.h`, `linklist.h`, and `hash_table.h` contain full function definitions.
- `using namespace std;` is used globally in all source and header files.
- Chinese-language console output throughout.
- `Status` / `OK` / `ERROR` / `OVERFLOW` pattern for function return codes (from classic C data structures textbooks).
