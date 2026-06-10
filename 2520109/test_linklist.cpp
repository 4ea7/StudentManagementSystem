#include <iostream>
#include "linklist.h"
using namespace std;

int main() {
    LinkList L;

    // ========== 1. 初始化链表 ==========
    cout << "========== 1. InitList: 初始化链表 ==========" << endl;
    InitList(L);
    cout << "初始化成功！" << endl;

    // ========== 2. CreateList_2: 尾插法创建 ==========
    cout << "\n========== 2. CreateList_2: 尾插法读取 records.txt ==========" << endl;
    CreateList_2(L);
    cout << "尾插法创建完成，链表内容：" << endl;
    TraverseList(L);

    // ========== 3. Save: 保存到文件 ==========
    cout << "\n========== 3. Save: 保存链表到 output1.txt ==========" << endl;
    Save(L, (char*)"output1.txt");
    cout << "保存成功！（尾插法顺序）" << endl;

    // ========== 4. InitList + CreateList_1: 头插法创建 ==========
    cout << "\n========== 4. CreateList_1: 头插法读取 records.txt ==========" << endl;
    InitList(L);  // 重新初始化
    CreateList_1(L);
    cout << "头插法创建完成，链表内容（注意：顺序与文件相反）：" << endl;
    TraverseList(L);

    // ========== 5. Save: 保存头插法结果 ==========
    cout << "\n========== 5. Save: 保存链表到 output2.txt ==========" << endl;
    Save(L, (char*)"output2.txt");
    cout << "保存成功！（头插法顺序，与文件相反）" << endl;

    // ========== 6. Sort_id: 按学号排序 ==========
    cout << "\n========== 6. Sort_id: 按学号插入排序 ==========" << endl;
    Sort_id(L);
    cout << "排序完成，链表内容：" << endl;
    TraverseList(L);

    // ========== 7. Save: 保存排序结果 ==========
    cout << "\n========== 7. Save: 保存链表到 output3.txt ==========" << endl;
    Save(L, (char*)"output3.txt");
    cout << "保存成功！（按学号升序）" << endl;

    // ========== 8. ReverseList: 原地反转 ==========
    cout << "\n========== 8. ReverseList: 原地反转链表 ==========" << endl;
    ReverseList(L);
    cout << "反转完成，链表内容（按学号降序）：" << endl;
    TraverseList(L);

    // ========== 9. Save: 保存反转结果 ==========
    cout << "\n========== 9. Save: 保存链表到 output4.txt ==========" << endl;
    Save(L, (char*)"output4.txt");
    cout << "保存成功！（按学号降序）" << endl;

    // ========== 10. 再次反转 ==========
    cout << "\n========== 10. 再次 ReverseList: 再次反转 ==========" << endl;
    ReverseList(L);
    cout << "再次反转完成，链表内容（恢复学号升序）：" << endl;
    TraverseList(L);

    cout << "\n========== 全部函数测试完毕！==========" << endl;
    return 0;
}
