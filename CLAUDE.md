# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Agent Teams（智能团队模式）— 默认开启

**核心规则**：收到任务后自动拆分为无依赖子任务，分配独立 Agent 并行执行，全部完成后汇总合并。

#### 拆分原则
1. 识别任务中的独立维度（文件搜索 vs 服务器检查 vs 代码审计 vs 版本控制）
2. 每个维度一个 Agent，同时启动
3. 读操作（搜索/检查/审计）永不阻塞彼此
4. 写操作在所有相关读操作完成后执行
5. 汇总结果时去重、合并、优先级排序

#### 模型选择
- **Haiku** (`model: "haiku"`)：简单搜索、单文件读取、日志查看、git status、状态检查
- **Sonnet** (`model: "sonnet"`)：代码分析、安全审计、复杂逻辑、代码生成、重构
- **默认** (不设 model)：通用任务、文件编辑、SSH 操作

#### 典型并行组合
```
用户请求 → 自动拆分 →
  ├─ Agent(搜索代码, haiku)     ← 轻量搜索
  ├─ Agent(安全审计, sonnet)    ← 复杂分析
  ├─ Agent(服务器诊断, haiku)   ← 日志状态
  └─ Agent(git 操作)           ← 版本控制
→ 汇总 → 执行写操作 → 验证
```

#### 示例
- "检查服务器状态并推送代码" → `Agent(SSH诊断, haiku)` + `Agent(git push)` 并行
- "审计 API key 泄露并修复" → `Agent(搜索泄露点, haiku)` + `Agent(检查git历史, sonnet)` 并行，汇总后统一修复
- "重构某个模块" → `Agent(分析现有代码, sonnet)` → `Agent(生成新代码, sonnet)` → `Agent(审查差异, sonnet)`

### Key Conventions
- Header-only implementation: `bitree.h`, `linklist.h`, and `hash_table.h` contain full function definitions.
- `using namespace std;` is used globally in all source and header files.
- Chinese-language console output throughout.
- `Status` / `OK` / `ERROR` / `OVERFLOW` pattern for function return codes (from classic C data structures textbooks).
