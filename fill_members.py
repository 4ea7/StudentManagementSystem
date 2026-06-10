"""Fill member content for 王逸轩 and 俞皓译 with proper names."""
from docx import Document

doc = Document('学生管理系统实验报告_完成版.docx')
t1 = doc.tables[1]

# ===== 组员1 王逸轩 - 详细设计 (Row 6, Col 2) =====
wang_design = """1、算法设计 —— 基础数据管理模块（Insert、TraverseTable）

【模块一：添加学生记录 Insert()】
算法流程：
(1) 接收 Student 结构体参数 stu（含学号、姓名、性别、年龄、成绩）
(2) 学号查重：调用 SearchById(H, stu.id) 在对应散列桶的链表中查找
(3) 若 SearchById 返回非NULL（学号已存在），输出"错误：学号 XX 已存在，插入失败！"，返回 ERROR
(4) 若学号不重复，计算散列地址 addr = HashFunc(stu.id)
(5) 使用 new 动态分配 HashNode 结点，若分配失败（返回NULL）则返回 OVERFLOW
(6) 将 stu 数据复制到新结点的 data 域
(7) 头插法插入：p->next = H[addr]; H[addr] = p（时间复杂度 O(1)）
(8) 输出成功提示信息，返回 OK

【模块二：浏览全部学生 TraverseTable()】
算法流程：
(1) 输出表头分隔线（57个减号）
(2) 使用 iomanip 操纵符输出列标题行：setw(10)学号、setw(12)姓名、setw(8)性别、setw(8)年龄、setw(10)成绩
(3) 再次输出分隔线
(4) 设置空表标志 empty = true
(5) 外循环遍历 TABLE_SIZE=13 个桶 (i: 0→12)
(6) 内循环遍历每个桶的链表（p = H[i]; p != NULL; p = p->next）
(7) 对每个结点输出一行格式化数据：
    - 学号/姓名/年龄用 setw 固定列宽
    - 性别用三目运算符转换：gender==0 ? "男" : "女"
    - 成绩用 fixed + setprecision(1) 显示一位小数
    - 设置 empty = false
(8) 若 empty 仍为 true（所有桶均无结点），输出"（当前无学生记录）"
(9) 输出表尾分隔线

2、代码设计

// 插入学生记录，含学号查重
Status Insert(HashTable& H, Student stu) {
    // 学号查重——必须先检查再插入
    if (SearchById(H, stu.id) != NULL) {
        cout << "错误：学号 " << stu.id << " 已存在，插入失败！" << endl;
        return ERROR;
    }
    int addr = HashFunc(stu.id);
    HashNode* p = new HashNode;
    if (p == NULL) return OVERFLOW;  // 内存分配失败
    p->data = stu;
    // 头插法：新结点直接插入桶首，O(1)时间
    p->next = H[addr];
    H[addr] = p;
    cout << "成功添加学生 " << stu.name << "（学号：" << stu.id << "）" << endl;
    return OK;
}

// 以规范表格形式输出所有学生信息
void TraverseTable(HashTable H) {
    cout << endl;
    cout << "---------------------------------------------------------" << endl;
    cout << left << setw(10) << "学号"
         << setw(12) << "姓名"
         << setw(8) << "性别"
         << setw(8) << "年龄"
         << setw(10) << "成绩" << endl;
    cout << "---------------------------------------------------------" << endl;
    bool empty = true;
    for (int i = 0; i < TABLE_SIZE; i++) {
        HashNode* p = H[i];
        while (p != NULL) {
            empty = false;
            cout << left << setw(10) << p->data.id
                 << setw(12) << p->data.name
                 << setw(8) << (p->data.gender == 0 ? "男" : "女")
                 << setw(8) << p->data.age
                 << setw(10) << fixed << setprecision(1) << p->data.score << endl;
            p = p->next;
        }
    }
    if (empty) {
        cout << "（当前无学生记录）" << endl;
    }
    cout << "---------------------------------------------------------" << endl;
}"""

wang_summary = """实践总结（王逸轩——组员1）：

在本课题中我负责基础数据管理模块的开发，主要包括学生信息的添加功能（Insert函数，含学号查重逻辑）和数据浏览功能（TraverseTable函数）。

Insert 函数的实现关键在于学号唯一性保障。在插入新记录之前，必须先调用 SearchById 遍历对应散列桶的链表进行查重——如果发现已有相同学号的记录则拒绝插入，并明确向用户提示冲突的学号，以便用户核实或更换。查重通过后，采用头插法将新结点插入桶首，时间复杂度为 O(1)，无需遍历到链表末尾，效率远高于尾插法。此外还需要考虑内存分配失败（new 返回 NULL）的极端情况，此时返回 OVERFLOW 状态码。

TraverseTable 函数需要以规范表格形式完整呈现所有学生信息。我使用 <iomanip> 中的流操纵算子 left（左对齐）、setw（固定列宽）、fixed（定点小数）、setprecision(1)（一位小数）来控制输出格式，确保各列严格对齐。性别字段在内部存储为整数（0=男，1=女），输出时通过三目运算符转换为中文显示。空表检测通过 bool 标志实现——遍历全部13个桶后若标志仍为 true，则输出"（当前无学生记录）"的友好提示。

调试中遇到的问题：
（1）初期版本未使用 setw 固定列宽，当学生姓名长度不同（如"Zhao"4字符 vs "Zheng"5字符）时表格会发生错位。通过统一使用 setw 设定各列最小宽度解决了此问题。
（2）setprecision 设置后会影响后续所有浮点数输出，需每次输出前重新设定。通过在每行成绩输出时都加 setprecision(1) 确保显示一致性。

此外我还参与了 addStudent() 交互子程序的编写，该函数调用 readInt、readString、readFloat 等输入验证辅助函数收集用户输入，并对性别字段做范围校验（只允许0或1）后再调用 Insert 执行实际插入。"""

# ===== 组员2 俞皓译 - 详细设计 (Row 9, Col 1) =====
yu_design = """1、算法设计 —— 数据维护与检索模块（Delete、SearchById、SearchByName、Update）

【模块一：按学号删除 Delete()】
算法流程：
(1) 计算散列地址 addr = HashFunc(id)，直接定位目标桶
(2) 初始化两个指针：p = H[addr]（当前结点），prev = NULL（前驱结点）
(3) 在链表中遍历 while(p != NULL)：
    a. 若 p->data.id == id（找到目标）：
       - 若 prev == NULL（桶首结点）：H[addr] = p->next（更新桶指针）
       - 否则（链表中间/末尾）：prev->next = p->next（跳过被删结点）
       - 输出被删学生姓名和学号
       - delete p 释放内存
       - return OK
    b. 未找到则 prev = p; p = p->next 继续向后遍历
(4) 遍历完毕未找到：输出错误提示，返回 ERROR

【模块二：双向查询 SearchById / SearchByName】
SearchById 算法（散列定位，高效）：
(1) 计算 addr = HashFunc(id)，O(1) 定位到桶
(2) 仅遍历该桶的短链表，逐一比对 p->data.id
(3) 找到则返回 &(p->data)，未找到返回 NULL
(4) 平均时间复杂度 O(1)，最坏 O(n)（所有记录散列到同一桶）

SearchByName 算法（全表扫描）：
(1) 姓名非散列关键字，需遍历全部 TABLE_SIZE 个桶
(2) 外循环遍历桶，内循环用 strcmp 比对 p->data.name
(3) 返回第一个匹配项的指针，未找到返回 NULL
(4) 时间复杂度 O(n)

【模块三：按学号修改 Update()】
算法流程：
(1) 调用 SearchById(H, id) 定位目标学生，未找到则返回ERROR
(2) 记录找到的 Student* 指针 p
(3) 若 newStu.id != id（用户修改了学号）：
    a. 调用 SearchById(H, newStu.id) 检查新学号是否已存在
    b. 若新学号冲突 → 输出错误提示，返回 ERROR
    c. 若不冲突 → 调用 Delete(H, id) 删除旧记录
    d. 调用 Insert(H, newStu) 以新学号插入（散列地址可能变化）
(4) 若 newStu.id == id（学号不变）：
    a. 通过指针 p 直接原地修改：strcpy 更新姓名，赋值更新 gender/age/score
    b. 输出成功提示，返回 OK

2、代码设计

// 根据学号删除学生记录（带头结点前驱追踪）
Status Delete(HashTable& H, int id) {
    int addr = HashFunc(id);
    HashNode* p = H[addr];
    HashNode* prev = NULL;
    while (p != NULL) {
        if (p->data.id == id) {
            if (prev == NULL)
                H[addr] = p->next;   // 删除桶首结点
            else
                prev->next = p->next; // 删除中间/末尾结点
            cout << "成功删除学生 " << p->data.name
                 << "（学号：" << id << "）" << endl;
            delete p;                 // 释放内存
            return OK;
        }
        prev = p;
        p = p->next;
    }
    cout << "错误：未找到学号为 " << id << " 的学生！" << endl;
    return ERROR;
}

// 按学号查找（O(1)散列定位 + 短链表遍历）
Student* SearchById(HashTable H, int id) {
    int addr = HashFunc(id);
    HashNode* p = H[addr];
    while (p != NULL) {
        if (p->data.id == id)
            return &(p->data);
        p = p->next;
    }
    return NULL;
}

// 按姓名查找（全表扫描，返回第一个匹配项）
Student* SearchByName(HashTable H, const char* name) {
    for (int i = 0; i < TABLE_SIZE; i++) {
        HashNode* p = H[i];
        while (p != NULL) {
            if (strcmp(p->data.name, name) == 0)
                return &(p->data);
            p = p->next;
        }
    }
    return NULL;
}

// 根据学号修改学生信息（支持学号变更）
Status Update(HashTable& H, int id, Student newStu) {
    Student* p = SearchById(H, id);
    if (p == NULL) {
        cout << "错误：未找到学号为 " << id << " 的学生！" << endl;
        return ERROR;
    }
    // 若修改了学号，检查新学号是否重复
    if (newStu.id != id && SearchById(H, newStu.id) != NULL) {
        cout << "错误：新学号 " << newStu.id << " 已存在！" << endl;
        return ERROR;
    }
    // 学号改变→先删后插（散列地址可能变化）
    if (newStu.id != id) {
        Delete(H, id);
        Insert(H, newStu);
    } else {
        // 学号不变→原地修改，效率高
        strcpy(p->name, newStu.name);
        p->gender = newStu.gender;
        p->age = newStu.age;
        p->score = newStu.score;
        cout << "成功修改学生信息（学号：" << id << "）" << endl;
    }
    return OK;
}"""

yu_summary = """实践总结（俞皓译——组员2）：

在本课题中我负责数据维护与检索模块的开发，包括按学号删除（Delete）、按学号/姓名双向查询（SearchById/SearchByName）以及按学号修改（Update）四项核心功能。

Delete 函数的关键在于正确处理链表删除的两种情形。被删结点可能是桶的首结点（需更新桶指针 H[addr] = p->next），也可能是链表中间或末尾结点（需修改前驱结点的next指针 prev->next = p->next）。通过维护 prev 前驱指针，可以统一处理这两种情况。删除后务必调用 delete 释放堆内存，避免内存泄漏。测试表明，删除后再次浏览表格，该记录已完全消失。

SearchById 充分利用了散列表的核心优势——通过 HashFunc(id) 将查找范围从全表缩小到单个桶的短链表，平均查找长度远小于全表扫描，体现了散列存储相比顺序存储的性能提升。SearchByName 则因姓名不是散列关键字，必须遍历全部13个桶的全部结点，属于顺序查找，效率较低，但满足了课题"支持双向查询（按学号或按姓名）"的功能需求。若系统需要频繁按姓名查找，可考虑建立姓名到学号的辅助散列索引。

Update 函数的难点在于学号可变性处理。若用户仅修改姓名/性别/年龄/成绩，通过 SearchById 返回的指针直接原地修改即可，效率很高。但若用户同时修改了学号，散列地址 HashFunc(newId) 可能与原地址不同——此时不能简单修改 data.id，必须采用"先删除旧结点再插入新结点"的策略来维护散列表结构的正确性，同时检查新学号是否已存在以避免冲突。

此外我还编写了交互子程序 searchMenu()、deleteStudent() 和 updateStudent()。searchMenu 提供二级子菜单让用户选择按学号还是按姓名查找，并格式化显示查找结果（含全部字段）。updateStudent 先显示当前信息作为参考，然后逐项提示输入新值，支持直接回车保留原值，提升了用户体验。

调试中遇到的主要问题：
（1）strcmp 函数在 <cstring> 头文件中声明于 std 命名空间，配合 using namespace std 后调用正常，但不同编译器对 C 标准库函数是否放入全局命名空间的处理不同，最终确认 MSVC 和 GCC 在此处的行为一致。
（2）在 searchMenu 中，先用 cin >> choice 读取菜单选项，再用 cin.getline 读取姓名字符串——由于 >> 会在缓冲区残留换行符，必须先调用 clearInput() 清除之，否则 getline 会读到空字符串。解决方案是在 readInt 和其他 >> 操作后统一调用 clearInput()。

通过本模块的开发，我对散列表环境下链表结点的增删改查操作有了扎实的理解：插入用头插法 O(1)，删除需遍历链表 O(k)（k为桶深度），按学号查找 O(k) 但 k 通常很小，按姓名查找 O(n)，修改分学号不变 O(1) 和学号变化 O(k) 两种情况。这些复杂度分析与实际测试结果一致。"""

# Write all content to cells
t1.cell(6, 2).text = wang_design
t1.cell(7, 2).text = wang_summary
t1.cell(9, 1).text = yu_design
t1.cell(10, 1).text = yu_summary

doc.save('学生管理系统实验报告_更新版.docx')
print('Saved! All member content filled.')
