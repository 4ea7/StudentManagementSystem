#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""图6：公式汇总与计算示例 — 重绘版，清晰布局"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyBboxPatch, Rectangle

plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False

fig, ax = plt.subplots(1, 1, figsize=(9, 11))
ax.set_xlim(0, 10)
ax.set_ylim(0, 20)
ax.axis('off')

# ============================================================
# 标题
# ============================================================
ax.text(5, 19.3, '图5  避雷针静电防护核心公式与计算示例',
        fontsize=16, fontweight='bold', ha='center', va='center', color='#1A237E')

# ============================================================
# 5 个核心公式：左右两列排列
# ============================================================

# 每行一个公式框
formulas = [
    {
        'num': '(1)',
        'name': '导体表面电场强度',
        'formula': r'$\mathbf{E = \frac{\sigma}{\varepsilon_0}}$',
        'desc': r'$\sigma$: 面电荷密度(C/m$^2$)    $\varepsilon_0 \approx 8.85\times 10^{-12}$ F/m'
    },
    {
        'num': '(2)',
        'name': '面电荷密度',
        'formula': r'$\mathbf{\sigma = \frac{q}{S}}$',
        'desc': r'$q$: 导体带电量(C)    $S$: 导体表面积(m$^2$)'
    },
    {
        'num': '(3)',
        'name': '曲率半径与电荷密度关系',
        'formula': r'$\mathbf{\sigma \propto \frac{1}{r}}$',
        'desc': r'$r$: 表面曲率半径(m) — 尖端 r 极小，故 $\sigma$ 极大，电场极强'
    },
    {
        'num': '(4)',
        'name': '空气击穿场强',
        'formula': r'$\mathbf{E_b \approx 3 \times 10^6\ \mathrm{V/m}}$',
        'desc': r'尖端附近 E 超过此值时空气电离击穿，形成导电等离子体通道'
    },
    {
        'num': '(5)',
        'name': '滚球法保护半径',
        'formula': r'$\mathbf{r = \sqrt{2Rh - h^2}}$',
        'desc': r'$R$: 滚球半径(一类20/二类45/三类60m)    $h$: 避雷针有效高度(m)'
    },
]

for i, f in enumerate(formulas):
    y_top = 17.5 - i * 2.8

    # Formula box background
    box = FancyBboxPatch((0.3, y_top - 1.8), 9.4, 2.3,
                         boxstyle='round,pad=0.2', facecolor='#F5F5F5',
                         edgecolor='#BDBDBD', linewidth=1.5, zorder=0)
    ax.add_patch(box)

    # Number + Name
    ax.text(0.8, y_top + 0.1, f'{f["num"]}  {f["name"]}',
            fontsize=13, fontweight='bold', color='#1565C0', va='center')

    # Formula (large, centered)
    ax.text(5, y_top - 0.6, f['formula'], fontsize=20, ha='center', va='center',
            color='#212121')

    # Description
    ax.text(0.8, y_top - 1.4, f['desc'], fontsize=9.5, color='#616161', va='center')

# ============================================================
# 分隔线
# ============================================================
sep_y = 17.5 - len(formulas) * 2.8 - 0.6
ax.plot([1, 9], [sep_y, sep_y], 'k-', linewidth=1.2, alpha=0.4)
ax.plot([1, 9], [sep_y, sep_y], 'k-', linewidth=0.5, alpha=0.2)  # shadow

# ============================================================
# 计算示例
# ============================================================
calc_title_y = sep_y - 0.6
ax.text(5, calc_title_y, '计算示例：滚球法保护半径',
        fontsize=14, fontweight='bold', ha='center', va='center', color='#E65100')

# 已知条件
given_y = calc_title_y - 0.7
ax.text(0.8, given_y,
        r'已知：避雷针有效高度 $\mathbf{h = 20\ \mathrm{m}}$，'
        r'按二类防雷建筑取滚球半径 $\mathbf{R = 45\ \mathrm{m}}$',
        fontsize=11, va='center', color='#424242')

# 计算步骤 — 放在带有箭头的流程框里
calc_steps = [
    r'$r = \sqrt{2Rh - h^2}$',
    r'$\ \, = \sqrt{2 \times 45 \times 20 - 20^2}$',
    r'$\ \, = \sqrt{1800 - 400}$',
    r'$\ \, = \sqrt{1400}$',
    r'$\mathbf{\ \, \approx 37.4\ \mathrm{m}}$',
]

step_y = given_y - 0.7
for i, step in enumerate(calc_steps):
    y = step_y - i * 0.6
    is_result = (i == len(calc_steps) - 1)
    fontsize = 15 if is_result else 13
    color = '#D32F2F' if is_result else '#37474F'
    weight = 'bold' if is_result else 'normal'
    ax.text(5, y, step, fontsize=fontsize, ha='center', va='center', color=color, fontweight=weight)

# 结论框
result_y = step_y - len(calc_steps) * 0.6 - 0.3
conclusion = ('结论：该避雷针在地面处最大保护半径约 37.4 m，'
              '即距避雷针 37.4 m 范围内的地面物体处于保护区域之内。')
ax.text(0.8, result_y, conclusion, fontsize=11, color='#2E7D32', fontweight='bold')

# 补充说明
ax.text(0.8, result_y - 0.6,
        '注：实际防雷工程还需控制接地电阻 Rg <= 10 Ohm、配合浪涌保护器(SPD)及等电位连接。',
        fontsize=9, color='#9E9E9E', style='italic')

# 底部装饰线
ax.plot([1, 9], [result_y - 1.0, result_y - 1.0], 'k-', linewidth=0.5, alpha=0.2)

plt.tight_layout()
fig.savefig(r'D:\Visual Studio\Project\diagrams\fig6_公式汇总.png', dpi=180, bbox_inches='tight',
            facecolor='white', edgecolor='none')
plt.close()
print('Fig6 saved')

from PIL import Image
img = Image.open(r'D:\Visual Studio\Project\diagrams\fig6_公式汇总.png')
print(f'  Size: {img.size[0]}x{img.size[1]}')
