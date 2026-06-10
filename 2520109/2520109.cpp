#include <iostream>
#include <cstdlib>
using namespace std;

#include "bitree.h"

const char* str = "AB#1##2#e##";
int si = 0;

void CreateBiTree(BiTree& T);
void postOrder(BiTree T);
void fun(BiTree T);
void exchange(BiTree &T);

int main() {
    BiTree root;
    CreateBiTree(root);
    cout << "原始二叉树" << endl;
    show_tree(root);

    cout << "\n后序遍历输出" << endl;
    postOrder(root);
    cout << endl;

    fun(root);
    cout << "\n大写全部转小写" << endl;
    show_tree(root);

    exchange(root);
    cout << "\n所有结点左右子树交换后" << endl;
    show_tree(root);

    return 0;
}

void CreateBiTree(BiTree& T) {
    char ch;
    ch = str[si++];
    if (ch == '#')
        T = NULL;
    else {
        T = new BiTNode;
        T->data = ch;
        CreateBiTree(T->lchild);
        CreateBiTree(T->rchild);
    }
}

void postOrder(BiTree T) {
    if (T == NULL) return;
    postOrder(T->lchild);   
    postOrder(T->rchild);   
    cout << T->data << " "; 
}

void fun(BiTree T) {
    if (T == NULL) return;
    if (T->data >= 'A' && T->data <= 'Z') {
        T->data = T->data + 'a' - 'A';
    }
    fun(T->lchild);
    fun(T->rchild);
}

void exchange(BiTree &T) {
    if (T == NULL) return;
    BiTNode* temp = T->lchild;
    T->lchild = T->rchild;
    T->rchild = temp;
    exchange(T->lchild);
    exchange(T->rchild);
}

