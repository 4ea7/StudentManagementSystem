#pragma once

#include <iostream>
#include <fstream>
#include <cstdlib>
using namespace std;

typedef int Status;
#define OK 1

typedef struct
{
    int id;     /*学号*/
    char name[20];  /*姓名*/
    float height;   /*身高*/
    int gender;     /*性别，0为男生，1为女生*/
} Student;

typedef struct node
{
    Student data;
    struct node* next;
} LinkNode, * LinkList;

// 函数声明 + 实现全部写在头文件里
Status InitList(LinkList& L) {
    L = new LinkNode;
    L->next = NULL;
    return OK;
}

void CreateList_1(LinkList& L)
{
    Student stu;
    LinkNode* p;
    ifstream infile("records.txt");
    if (!infile.is_open())
    {
        cout << "error open file." << endl;
        exit(-1);
    }
    while (infile >> stu.id >> stu.name >> stu.height >> stu.gender)
    {
        p = new LinkNode;
        p->data = stu;
        p->next = L->next;
        L->next = p;
    }
    infile.close();
}

void CreateList_2(LinkList& L)
{
    Student stu;
    LinkNode* p, * rear = L;
    ifstream infile("records.txt");
    if (!infile.is_open())
    {
        cout << "error open file." << endl;
        exit(-1);
    }
    while (infile >> stu.id >> stu.name >> stu.height >> stu.gender)
    {
        p = new LinkNode;
        p->data = stu;
        p->next = NULL;
        rear->next = p;
        rear = p;
    }
    infile.close();
}

void Sort_id(LinkList& L)
{
    LinkNode* q, * p, * u;
    p = L->next;
    L->next = NULL;
    while (p != NULL)
    {
        q = p;
        p = p->next;
        u = L;
        while (u->next != NULL && u->next->data.id < q->data.id)
        {
            u = u->next;
        }
        q->next = u->next;
        u->next = q;
    }
}

void ReverseList(LinkList& L)
{
    LinkNode* p, * r;
    p = L->next;
    L->next = NULL;
    while (p != NULL)
    {
        r = p;
        p = p->next;
        r->next = L->next;
        L->next = r;
    }
}

void TraverseList(LinkList L)
{
    LinkNode* p = L->next;
    while (p != NULL)
    {
        cout << p->data.id << " "
            << p->data.name << " "
            << p->data.height << " "
            << p->data.gender << endl;
        p = p->next;
    }
}

void Save(LinkList L, char strname[])
{
    ofstream outfile(strname);
    if (!outfile.is_open())
    {
        cout << "cannot save file." << endl;
        exit(-1);
    }
    LinkNode* p = L->next;
    while (p != NULL)
    {
        outfile << p->data.id << " "
            << p->data.name << " "
            << p->data.height << " "
            << p->data.gender << endl;
        p = p->next;
    }
    outfile.close();
}
