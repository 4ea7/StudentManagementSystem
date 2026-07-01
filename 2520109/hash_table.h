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

#define TABLE_SIZE 13

// 学生记录结构体
typedef struct {
    int id;           // 学号
    char name[20];    // 姓名
    int gender;       // 性别，0为男生，1为女生
    int age;          // 年龄
    float score;      // 成绩
} Student;

// 散列表结点（链地址法）
typedef struct HashNode {
    Student data;
    struct HashNode* next;
} HashNode;


typedef HashNode* HashTable[TABLE_SIZE];

// 散列函数：除留余数法
int HashFunc(int id) {
    return id % TABLE_SIZE;
}

// 初始化散列表：所有桶置空
Status InitTable(HashTable& H) {
    for (int i = 0; i < TABLE_SIZE; i++) {
        H[i] = NULL;
    }
    return OK;
}

// 按学号查找，返回指向学生数据的指针，未找到返回NULL
Student* SearchById(HashTable H, int id) {
    int addr = HashFunc(id);
    HashNode* p = H[addr];
    while (p != NULL) {
        if (p->data.id == id) {
            return &(p->data);
        }
        p = p->next;
    }
    return NULL;
}

// 按姓名查找，返回指向学生数据的指针，未找到返回NULL（返回第一个匹配）
Student* SearchByName(HashTable H, const char* name) {
    for (int i = 0; i < TABLE_SIZE; i++) {
        HashNode* p = H[i];
        while (p != NULL) {
            if (strcmp(p->data.name, name) == 0) {
                return &(p->data);
            }
            p = p->next;
        }
    }
    return NULL;
}

// 插入学生记录，学号重复则返回ERROR
Status Insert(HashTable& H, Student stu) {
    // 学号查重
    if (SearchById(H, stu.id) != NULL) {
        cout << "错误：学号 " << stu.id << " 已存在，插入失败！" << endl;
        return ERROR;
    }
    int addr = HashFunc(stu.id);
    HashNode* p = new HashNode;
    if (p == NULL) return OVERFLOW;
    p->data = stu;
    // 头插法插入对应桶的链表
    p->next = H[addr];
    H[addr] = p;
    cout << "成功添加学生 " << stu.name << "（学号：" << stu.id << "）" << endl;
    return OK;
}

// 根据学号删除学生记录
Status Delete(HashTable& H, int id) {
    int addr = HashFunc(id);
    HashNode* p = H[addr];
    HashNode* prev = NULL;
    while (p != NULL) {
        if (p->data.id == id) {
            if (prev == NULL) {
                H[addr] = p->next;  // 删除桶首结点
            } else {
                prev->next = p->next;
            }
            cout << "成功删除学生 " << p->data.name << "（学号：" << id << "）" << endl;
            delete p;
            return OK;
        }
        prev = p;
        p = p->next;
    }
    cout << "错误：未找到学号为 " << id << " 的学生！" << endl;
    return ERROR;
}

// 根据学号修改学生信息
Status Update(HashTable& H, int id, Student newStu) {
    Student* p = SearchById(H, id);
    if (p == NULL) {
        cout << "错误：未找到学号为 " << id << " 的学生！" << endl;
        return ERROR;
    }
    // 如果修改了学号且新学号与原学号不同，需要检查新学号是否重复
    if (newStu.id != id && SearchById(H, newStu.id) != NULL) {
        cout << "错误：新学号 " << newStu.id << " 已存在！" << endl;
        return ERROR;
    }
    // 如果学号变了，需要删除旧结点再重新插入
    if (newStu.id != id) {
        Delete(H, id);
        Insert(H, newStu);
    } else {
        // 学号不变，直接修改数据
        strcpy(p->name, newStu.name);
        p->gender = newStu.gender;
        p->age = newStu.age;
        p->score = newStu.score;
        cout << "成功修改学生信息（学号：" << id << "）" << endl;
    }
    return OK;
}

// 以表格形式输出所有学生信息
void TraverseTable(HashTable H) {
    cout << endl;
    cout << "-------------------------------------------------------------------" << endl;
    cout << left << setw(6) << "桶号"
         << setw(10) << "学号"
         << setw(12) << "姓名"
         << setw(8) << "性别"
         << setw(8) << "年龄"
         << setw(10) << "成绩" << endl;
    cout << "-------------------------------------------------------------------" << endl;

    bool empty = true;
    for (int i = 0; i < TABLE_SIZE; i++) {
        HashNode* p = H[i];
        while (p != NULL) {
            empty = false;
            cout << left << setw(6) << i
                 << setw(10) << p->data.id
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
    cout << "-------------------------------------------------------------------" << endl;
}

// 从文件中读取学生数据到散列表
Status LoadFromFile(HashTable& H, const char* filename) {
    ifstream infile(filename);
    if (!infile.is_open()) {
        cout << "提示：数据文件 " << filename << " 不存在，将从空表开始。" << endl;
        return ERROR;
    }
    Student stu;
    int count = 0;
    while (infile >> stu.id >> stu.name >> stu.gender >> stu.age >> stu.score) {
        Insert(H, stu);
        count++;
    }
    infile.close();
    cout << "已从 " << filename << " 加载 " << count << " 条学生记录。" << endl;
    return OK;
}

// 将所有学生记录保存到文件
Status SaveToFile(HashTable H, const char* filename) {
    ofstream outfile(filename);
    if (!outfile.is_open()) {
        cout << "错误：无法打开文件 " << filename << " 进行写入！" << endl;
        return ERROR;
    }
    for (int i = 0; i < TABLE_SIZE; i++) {
        HashNode* p = H[i];
        while (p != NULL) {
            outfile << p->data.id << " "
                    << p->data.name << " "
                    << p->data.gender << " "
                    << p->data.age << " "
                    << p->data.score << endl;
            p = p->next;
        }
    }
    outfile.close();
    return OK;
}

// 统计散列表中记录总数
int CountStudents(HashTable H) {
    int count = 0;
    for (int i = 0; i < TABLE_SIZE; i++) {
        HashNode* p = H[i];
        while (p != NULL) {
            count++;
            p = p->next;
        }
    }
    return count;
}

// 排序、统计并导出到文件
// 排序规则：前半部分为男同学，后半部分为女同学（性别升序）
//          同性别内部按成绩递减（降序）
Status SortAndExport(HashTable H, const char* filename) {
    int total = CountStudents(H);
    if (total == 0) {
        cout << "当前无学生记录，无法导出！" << endl;
        return ERROR;
    }

    // 1. 提取所有学生到动态数组
    Student* arr = new Student[total];
    int idx = 0;
    for (int i = 0; i < TABLE_SIZE; i++) {
        HashNode* p = H[i];
        while (p != NULL) {
            arr[idx++] = p->data;
            p = p->next;
        }
    }

    // 2. 排序：性别升序（男0在前，女1在后），同性别内成绩降序
    for (int i = 0; i < total - 1; i++) {
        for (int j = 0; j < total - 1 - i; j++) {
            bool needSwap = false;
            if (arr[j].gender > arr[j + 1].gender) {
                needSwap = true;  // 性别升序
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

    for (int i = 0; i < total; i++) {
        sumScore += arr[i].score;
        if (arr[i].gender == 0) {
            maleCount++;
            if (arr[i].score >= 60.0) malePass++;
        } else {
            femaleCount++;
            if (arr[i].score >= 60.0) femalePass++;
        }
    }

    float avgScore = sumScore / total;
    float maleRate = (maleCount > 0) ? (float)malePass / maleCount * 100 : 0;
    float femaleRate = (femaleCount > 0) ? (float)femalePass / femaleCount * 100 : 0;

    // 4. 写入文件
    ofstream outfile(filename);
    if (!outfile.is_open()) {
        cout << "错误：无法打开文件 " << filename << " 进行写入！" << endl;
        delete[] arr;
        return ERROR;
    }

    outfile << "==========================" << endl;
    outfile << "   排序后学生信息报表" << endl;
    outfile << "==========================" << endl;
    outfile << left << setw(8) << "学号"
            << setw(10) << "姓名"
            << setw(6) << "性别"
            << setw(6) << "年龄"
            << setw(8) << "成绩" << endl;
    outfile << "--------------------------------------" << endl;

    for (int i = 0; i < total; i++) {
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
    delete[] arr;

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
