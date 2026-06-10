#include <iostream>
#include <cstdlib>
#include <cstring>
#include <limits>
using namespace std;

#include "seqlist.h"

// ========== 函数声明 ==========
void clearScreen();
void pauseScreen();
void clearInput();
int readInt(const char* prompt);
float readFloat(const char* prompt);
void readString(const char* prompt, char* buffer, int maxLen);
void showMenu();
void searchMenu(SeqList& L);
void addStudent(SeqList& L);
void deleteStudent(SeqList& L);
void updateStudent(SeqList& L);

// ========== 主函数 ==========
int main() {
    SeqList L;
    InitList(L);

    // 启动时从文件加载数据
    LoadFromFile(L, "records.txt");

    int choice;
    while (true) {
        showMenu();
        cin >> choice;
        if (cin.eof() || cin.fail()) {
            cout << endl << "输入结束，系统退出。" << endl;
            break;
        }
        clearInput();

        switch (choice) {
            case 1: addStudent(L);      break;
            case 2: deleteStudent(L);   break;
            case 3: searchMenu(L);      break;
            case 4: updateStudent(L);   break;
            case 5: TraverseTable(L);   break;
            case 6: SortAndExport(L, "sorted_output_seq.txt"); break;
            case 0:
                SaveToFile(L, "records.txt");
                cout << "数据已保存，感谢使用！" << endl;
                DestroyList(L);
                return 0;
            default:
                cout << "无效选项，请重新输入（0-6）！" << endl;
                break;
        }
    }
    DestroyList(L);
    return 0;
}

// ========== 函数定义 ==========

void clearScreen() {
#ifdef _WIN32
    system("cls");
#else
    system("clear");
#endif
}

void pauseScreen() {
    cout << "\n按回车键继续...";
    cin.ignore(numeric_limits<streamsize>::max(), '\n');
    cin.get();
}

void clearInput() {
    cin.clear();
    cin.ignore(numeric_limits<streamsize>::max(), '\n');
}

int readInt(const char* prompt) {
    int value;
    while (true) {
        cout << prompt;
        cin >> value;
        if (cin.fail()) {
            clearInput();
            cout << "输入无效，请输入整数！" << endl;
        } else {
            clearInput();
            return value;
        }
    }
}

float readFloat(const char* prompt) {
    float value;
    while (true) {
        cout << prompt;
        cin >> value;
        if (cin.fail()) {
            clearInput();
            cout << "输入无效，请输入数字！" << endl;
        } else {
            clearInput();
            return value;
        }
    }
}

void readString(const char* prompt, char* buffer, int maxLen) {
    cout << prompt;
    cin.getline(buffer, maxLen);
    if (strlen(buffer) == 0) {
        cin.getline(buffer, maxLen);
    }
}

void showMenu() {
    cout << endl;
    cout << "========================================" << endl;
    cout << "    学生信息管理系统（顺序表）" << endl;
    cout << "========================================" << endl;
    cout << "  1. 添加学生记录" << endl;
    cout << "  2. 删除学生记录" << endl;
    cout << "  3. 查找学生记录" << endl;
    cout << "  4. 修改学生记录" << endl;
    cout << "  5. 浏览全部学生" << endl;
    cout << "  6. 排序统计与导出" << endl;
    cout << "  0. 退出系统" << endl;
    cout << "========================================" << endl;
    cout << "请输入选项（0-6）：";
}

void searchMenu(SeqList& L) {
    int choice;
    cout << endl;
    cout << "---------- 查找学生 ----------" << endl;
    cout << "  1. 按学号查找" << endl;
    cout << "  2. 按姓名查找" << endl;
    cout << "  0. 返回主菜单" << endl;
    cout << "请选择（0-2）：";
    cin >> choice;
    clearInput();

    Student* result = NULL;
    if (choice == 1) {
        int id = readInt("请输入要查找的学号：");
        result = SearchById(L, id);
    } else if (choice == 2) {
        char name[20];
        readString("请输入要查找的姓名：", name, 20);
        result = SearchByName(L, name);
    } else if (choice == 0) {
        return;
    } else {
        cout << "无效选项！" << endl;
        return;
    }

    if (result != NULL) {
        cout << endl;
        cout << "---------- 查找结果 ----------" << endl;
        cout << "学号：" << result->id << endl;
        cout << "姓名：" << result->name << endl;
        cout << "性别：" << (result->gender == 0 ? "男" : "女") << endl;
        cout << "年龄：" << result->age << endl;
        cout << "成绩：" << result->score << endl;
        cout << "------------------------------" << endl;
    } else {
        cout << "未找到匹配的学生记录！" << endl;
    }
}

void addStudent(SeqList& L) {
    Student stu;
    cout << endl;
    cout << "---------- 添加学生 ----------" << endl;
    stu.id = readInt("请输入学号：");
    readString("请输入姓名：", stu.name, 20);
    stu.gender = readInt("请输入性别（0=男生，1=女生）：");
    while (stu.gender != 0 && stu.gender != 1) {
        stu.gender = readInt("性别只能输入0或1，请重新输入：");
    }
    stu.age = readInt("请输入年龄：");
    stu.score = readFloat("请输入成绩：");
    Insert(L, stu);
}

void deleteStudent(SeqList& L) {
    cout << endl;
    cout << "---------- 删除学生 ----------" << endl;
    int id = readInt("请输入要删除的学生学号：");
    Delete(L, id);
}

void updateStudent(SeqList& L) {
    cout << endl;
    cout << "---------- 修改学生 ----------" << endl;
    int id = readInt("请输入要修改的学生学号：");

    Student* old = SearchById(L, id);
    if (old == NULL) {
        cout << "错误：未找到学号为 " << id << " 的学生！" << endl;
        return;
    }

    cout << "当前信息：" << endl;
    cout << "  姓名：" << old->name << endl;
    cout << "  性别：" << (old->gender == 0 ? "男" : "女") << endl;
    cout << "  年龄：" << old->age << endl;
    cout << "  成绩：" << old->score << endl;
    cout << endl;
    cout << "请输入新信息（直接回车保留原值）：" << endl;

    Student newStu;
    newStu.id = id;
    char input[50];

    cout << "新姓名（原：" << old->name << "）：";
    cin.getline(input, 50);
    if (strlen(input) > 0) strcpy(newStu.name, input);
    else strcpy(newStu.name, old->name);

    cout << "新性别（原：" << (old->gender == 0 ? "男" : "女") << "，输入0或1）：";
    cin.getline(input, 50);
    if (strlen(input) > 0) {
        newStu.gender = atoi(input);
        while (newStu.gender != 0 && newStu.gender != 1) {
            cout << "性别只能为0或1，请重新输入：";
            cin.getline(input, 50);
            newStu.gender = atoi(input);
        }
    } else newStu.gender = old->gender;

    cout << "新年龄（原：" << old->age << "）：";
    cin.getline(input, 50);
    if (strlen(input) > 0) newStu.age = atoi(input);
    else newStu.age = old->age;

    cout << "新成绩（原：" << old->score << "）：";
    cin.getline(input, 50);
    if (strlen(input) > 0) newStu.score = (float)atof(input);
    else newStu.score = old->score;

    cout << "是否同时修改学号？（原：" << id << "，输入新学号或直接回车跳过）：";
    cin.getline(input, 50);
    if (strlen(input) > 0) newStu.id = atoi(input);

    Update(L, id, newStu);
}
