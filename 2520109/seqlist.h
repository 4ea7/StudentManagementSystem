#pragma once

#include <iostream>
#include <fstream>
#include <cstdlib>
#include <cstring>
#include <iomanip>
using namespace std;

// 函数结果状态代码
#define   OK    1
#define   ERROR 0
#define   OVERFLOW -2
typedef int Status;

#define INIT_CAPACITY 10   // 初始容量
#define INCREMENT    5     // 扩容增量

// 学生记录结构体（与散列表版本完全一致）
typedef struct {
    int id;           // 学号
    char name[20];    // 姓名
    int gender;       // 性别，0为男生，1为女生
    int age;          // 年龄
    float score;      // 成绩
} Student;

// 顺序表结构体
typedef struct {
    Student* data;    // 动态数组指针
    int length;       // 当前元素个数
    int capacity;     // 当前分配容量
} SeqList;

// ========== 基本操作 ==========

// 初始化顺序表
Status InitList(SeqList& L) {
    L.data = new Student[INIT_CAPACITY];
    if (L.data == NULL) return OVERFLOW;
    L.length = 0;
    L.capacity = INIT_CAPACITY;
    return OK;
}

// 扩容
Status ExpandList(SeqList& L) {
    int newCapacity = L.capacity + INCREMENT;
    Student* newData = new Student[newCapacity];
    if (newData == NULL) return OVERFLOW;
    for (int i = 0; i < L.length; i++) {
        newData[i] = L.data[i];
    }
    delete[] L.data;
    L.data = newData;
    L.capacity = newCapacity;
    return OK;
}

// 销毁顺序表
void DestroyList(SeqList& L) {
    delete[] L.data;
    L.data = NULL;
    L.length = 0;
    L.capacity = 0;
}

// ========== 查找操作 ==========

// 按学号查找 —— O(n) 顺序查找
// 散列表为 O(1) 散列定位 + O(k) 桶内遍历
Student* SearchById(SeqList L, int id) {
    for (int i = 0; i < L.length; i++) {
        if (L.data[i].id == id) {
            return &(L.data[i]);
        }
    }
    return NULL;
}

// 按姓名查找 —— O(n) 顺序查找
// 散列表同为 O(n) 全表扫描（姓名非关键字）
Student* SearchByName(SeqList L, const char* name) {
    for (int i = 0; i < L.length; i++) {
        if (strcmp(L.data[i].name, name) == 0) {
            return &(L.data[i]);
        }
    }
    return NULL;
}

// ========== 增删改操作 ==========

// 插入学生记录 —— 尾部追加 O(1) 均摊，含学号查重 O(n)
// 散列表为 O(1) 均摊（头插法 + 查重 O(k)）
Status Insert(SeqList& L, Student stu) {
    // 学号查重 —— O(n) 遍历
    if (SearchById(L, stu.id) != NULL) {
        cout << "错误：学号 " << stu.id << " 已存在，插入失败！" << endl;
        return ERROR;
    }
    // 容量不足则扩容
    if (L.length >= L.capacity) {
        if (ExpandList(L) == OVERFLOW)
            return OVERFLOW;
    }
    L.data[L.length] = stu;   // 尾部追加
    L.length++;
    cout << "成功添加学生 " << stu.name << "（学号：" << stu.id << "）" << endl;
    return OK;
}

// 根据学号删除学生记录 —— O(n) 查找 + O(n) 移动
// 散列表为 O(k) 查找 + O(1) 链表删除
Status Delete(SeqList& L, int id) {
    int pos = -1;
    for (int i = 0; i < L.length; i++) {
        if (L.data[i].id == id) {
            pos = i;
            break;
        }
    }
    if (pos == -1) {
        cout << "错误：未找到学号为 " << id << " 的学生！" << endl;
        return ERROR;
    }
    cout << "成功删除学生 " << L.data[pos].name << "（学号：" << id << "）" << endl;
    // 元素前移 —— O(n)
    for (int i = pos; i < L.length - 1; i++) {
        L.data[i] = L.data[i + 1];
    }
    L.length--;
    return OK;
}

// 根据学号修改学生信息
// 散列表：学号变化需先删后插（O(k)+O(1)），学号不变 O(1) 原地改
Status Update(SeqList& L, int id, Student newStu) {
    Student* p = SearchById(L, id);   // O(n)
    if (p == NULL) {
        cout << "错误：未找到学号为 " << id << " 的学生！" << endl;
        return ERROR;
    }
    // 若修改了学号，检查新学号是否重复 —— O(n)
    if (newStu.id != id && SearchById(L, newStu.id) != NULL) {
        cout << "错误：新学号 " << newStu.id << " 已存在！" << endl;
        return ERROR;
    }
    // 学号不变，原地修改 —— O(1)
    // 学号改变，顺序表中也是原地修改（地址不变），但需检查新学号冲突
    strcpy(p->name, newStu.name);
    p->gender = newStu.gender;
    p->age = newStu.age;
    p->score = newStu.score;
    p->id = newStu.id;              // 顺序表无需维护散列关系
    cout << "成功修改学生信息（学号：" << id;
    if (newStu.id != id) cout << " → " << newStu.id;
    cout << "）" << endl;
    return OK;
}

// ========== 遍历与统计 ==========

// 以表格形式输出所有学生信息
void TraverseTable(SeqList L) {
    cout << endl;
    cout << "---------------------------------------------------------" << endl;
    cout << left << setw(10) << "学号"
         << setw(12) << "姓名"
         << setw(8) << "性别"
         << setw(8) << "年龄"
         << setw(10) << "成绩" << endl;
    cout << "---------------------------------------------------------" << endl;

    if (L.length == 0) {
        cout << "（当前无学生记录）" << endl;
    } else {
        for (int i = 0; i < L.length; i++) {
            cout << left << setw(10) << L.data[i].id
                 << setw(12) << L.data[i].name
                 << setw(8) << (L.data[i].gender == 0 ? "男" : "女")
                 << setw(8) << L.data[i].age
                 << setw(10) << fixed << setprecision(1) << L.data[i].score << endl;
        }
    }
    cout << "---------------------------------------------------------" << endl;
}

// 统计记录总数 —— O(1)
// 散列表为 O(TABLE_SIZE + n) 需遍历所有桶
int CountStudents(SeqList L) {
    return L.length;
}

// ========== 文件 I/O ==========

// 从文件加载数据
Status LoadFromFile(SeqList& L, const char* filename) {
    ifstream infile(filename);
    if (!infile.is_open()) {
        cout << "提示：数据文件 " << filename << " 不存在，将从空表开始。" << endl;
        return ERROR;
    }
    Student stu;
    int count = 0;
    while (infile >> stu.id >> stu.name >> stu.gender >> stu.age >> stu.score) {
        Insert(L, stu);
        count++;
    }
    infile.close();
    cout << "已从 " << filename << " 加载 " << count << " 条学生记录。" << endl;
    return OK;
}

// 保存到文件
Status SaveToFile(SeqList L, const char* filename) {
    ofstream outfile(filename);
    if (!outfile.is_open()) {
        cout << "错误：无法打开文件 " << filename << " 进行写入！" << endl;
        return ERROR;
    }
    for (int i = 0; i < L.length; i++) {
        outfile << L.data[i].id << " "
                << L.data[i].name << " "
                << L.data[i].gender << " "
                << L.data[i].age << " "
                << L.data[i].score << endl;
    }
    outfile.close();
    return OK;
}

// ========== 排序统计与导出 ==========
// 使用临时数组排序（不破坏原数据顺序）
// 散列表：必须 O(n) 提取到临时数组（散列表本身无序、无法就地排序）
// 顺序表：也可就地排序，但为保持与散列表行为一致（不影响后续SaveToFile），
//         同样使用临时数组拷贝
Status SortAndExport(SeqList L, const char* filename) {
    if (L.length == 0) {
        cout << "当前无学生记录，无法导出！" << endl;
        return ERROR;
    }

    // 1. 拷贝到临时数组（避免破坏原数据）
    Student* arr = new Student[L.length];
    for (int i = 0; i < L.length; i++) {
        arr[i] = L.data[i];
    }

    // 2. 冒泡排序
    for (int i = 0; i < L.length - 1; i++) {
        for (int j = 0; j < L.length - 1 - i; j++) {
            bool needSwap = false;
            if (arr[j].gender > arr[j + 1].gender) {
                needSwap = true;  // 性别升序（男0在前，女1在后）
            } else if (arr[j].gender == arr[j + 1].gender
                       && arr[j].score < arr[j + 1].score) {
                needSwap = true;  // 同性别成绩降序
            }
            if (needSwap) {
                Student temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }

    // 3. 统计数据
    int maleCount = 0, malePass = 0;
    int femaleCount = 0, femalePass = 0;
    float sumScore = 0.0;

    for (int i = 0; i < L.length; i++) {
        sumScore += arr[i].score;
        if (arr[i].gender == 0) {
            maleCount++;
            if (arr[i].score >= 60.0) malePass++;
        } else {
            femaleCount++;
            if (arr[i].score >= 60.0) femalePass++;
        }
    }

    float avgScore = sumScore / L.length;
    float maleRate = (maleCount > 0) ? (float)malePass / maleCount * 100 : 0;
    float femaleRate = (femaleCount > 0) ? (float)femalePass / femaleCount * 100 : 0;

    // 4. 写入文件（使用临时数组 arr，不破坏原数据）
    ofstream outfile(filename);
    if (!outfile.is_open()) {
        cout << "错误：无法打开文件 " << filename << " 进行写入！" << endl;
        delete[] arr;
        return ERROR;
    }

    outfile << "==========================" << endl;
    outfile << "   排序后学生信息报表（顺序表）" << endl;
    outfile << "==========================" << endl;
    outfile << left << setw(8) << "学号"
            << setw(10) << "姓名"
            << setw(6) << "性别"
            << setw(6) << "年龄"
            << setw(8) << "成绩" << endl;
    outfile << "--------------------------------------" << endl;

    for (int i = 0; i < L.length; i++) {
        outfile << left << setw(8) << arr[i].id
                << setw(10) << arr[i].name
                << setw(6) << (arr[i].gender == 0 ? "男" : "女")
                << setw(6) << arr[i].age
                << setw(8) << fixed << setprecision(1) << arr[i].score << endl;
    }

    outfile << endl;
    outfile << "==========================" << endl;
    outfile << "       统计结果" << endl;
    outfile << "==========================" << endl;
    outfile << "男生合格率（>=60分）：" << fixed << setprecision(1) << maleRate << "%" << endl;
    outfile << "女生合格率（>=60分）：" << fixed << setprecision(1) << femaleRate << "%" << endl;
    outfile << "全班平均分：" << fixed << setprecision(2) << avgScore << endl;

    outfile.close();
    delete[] arr;  // 释放临时数组

    // 同时输出到控制台
    cout << endl;
    cout << "========== 统计结果 ==========" << endl;
    cout << "男生人数：" << maleCount << "，合格人数：" << malePass
         << "，合格率：" << fixed << setprecision(1) << maleRate << "%" << endl;
    cout << "女生人数：" << femaleCount << "，合格人数：" << femalePass
         << "，合格率：" << fixed << setprecision(1) << femaleRate << "%" << endl;
    cout << "全班平均分：" << fixed << setprecision(2) << avgScore << endl;
    cout << "==============================" << endl;
    cout << "排序后的完整报表已保存至 " << filename << endl;

    return OK;
}
