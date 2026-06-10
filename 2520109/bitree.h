#ifndef BITREE_H
#define BITREE_H
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
//函数结构状态代码
#define   OK    1
#define   ERROR     0
#define    OVERFLOW      -2
//Status  是函数的类型，其值是函数结果状态代码
typedef   int   Status;

typedef char TElemType;
typedef struct BiTNode {
    TElemType data;                 //结点数据域 
    struct BiTNode* lchild, * rchild; //左右孩子指针
}BiTNode, * BiTree;

//以下函数声明为二叉树显示，不要求掌握
#define NODE_WIDTH 5
#define NODE_HEIGHT 3
void show_tree(BiTree bt);
void showBuf(char x[][50], int m, int n);
void printInBuf(BiTree bt, char buf[][50], int x, int y);
int getWidth(BiTree bt);
int getHeight(BiTree bt);

//以下为二叉树显示，不要求掌握
void show_tree(BiTree bt)
{
    char buf[50][50];
    int m = 50, n = 50, i, j; //以二维数组的方式存储二叉树，行m，列n
    for (i = 0; i < m; i++)
        for (j = 0; j < n; j++)
            buf[i][j] = 0;
    m = getHeight(bt) * NODE_HEIGHT;
    n = getWidth(bt) * NODE_WIDTH;
    printInBuf(bt, buf, 0, 0);
    showBuf(buf, m, n);
    printf("\n");
}

void showBuf(char x[][50], int m, int n)
{
    int i, j;
    for (i = 0; i < m; i++)
    {
        for (j = 0; j < n; j++)
            printf("%c", x[i][j] == 0 ? ' ' : x[i][j]);
        printf("\n");
    }
}

void printInBuf(BiTree bt, char buf[][50], int x, int y)
{
    int pl, pr, rootpos, i;
    char sv[50];
    sv[0] = bt->data; sv[1] = '\0';

    if (bt->lchild == NULL)
        pl = 0;
    else
    {
        pl = NODE_WIDTH;
        if (bt->lchild->rchild != NULL)
            pl += getWidth(bt->lchild->rchild) * NODE_WIDTH;
    }

    if (bt->rchild == NULL)
        pr = 0;
    else
    {
        pr = NODE_WIDTH;
        if (bt->rchild->lchild != NULL)
            pr += getWidth(bt->rchild->lchild) * NODE_WIDTH;
    }

    rootpos = x;
    if (bt->lchild != NULL)
        rootpos += getWidth(bt->lchild) * NODE_WIDTH;

    for (i = 0; i < NODE_HEIGHT; i++)
        buf[y + i][rootpos] = '|';
    for (i = rootpos - pl; i <= rootpos + pr; i++)
        buf[y + NODE_HEIGHT - 1][i] = '-';
    for (i = rootpos; i < rootpos + strlen(sv); i++)
        buf[y + NODE_HEIGHT - 1][i] = sv[i - rootpos];
    if (pl > 0)
        buf[y + NODE_HEIGHT - 1][rootpos - pl] = '/';
    if (pr > 0)
        buf[y + NODE_HEIGHT - 1][rootpos + pr] = '\\';

    if (bt->lchild != NULL)
        printInBuf(bt->lchild, buf, x, y + NODE_HEIGHT);
    if (bt->rchild != NULL)
        printInBuf(bt->rchild, buf, rootpos + NODE_WIDTH, y + NODE_HEIGHT);
}

int getWidth(BiTree bt)
{
    int w = 1;
    if (bt == NULL)
        return 0;
    w += getWidth(bt->lchild);
    w += getWidth(bt->rchild);
    return w;
}
int getHeight(BiTree bt)
{
    int h = 1, l, r;
    if (bt == NULL)
        return 0;
    l = getHeight(bt->lchild);
    r = getHeight(bt->rchild);
    h += l > r ? l : r;
    return h;
}
#endif