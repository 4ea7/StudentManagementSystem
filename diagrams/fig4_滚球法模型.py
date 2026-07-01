#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""图4：滚球法保护范围几何模型 — 重绘版"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Circle, Rectangle, Polygon, Arc, Wedge, FancyArrowPatch

plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False

fig, ax = plt.subplots(1, 1, figsize=(11, 9))
ax.set_xlim(-2, 16)
ax.set_ylim(-2, 12)
ax.set_aspect('equal')
ax.axis('off')

# ============================================================
# 几何参数 (h < R 使图更清晰)
# ============================================================
tip_x = 3.0
h = 5.0       # 避雷针有效高度（含建筑物）
R = 7.0       # 滚球半径（二类防雷45m按比例缩放）
r0 = np.sqrt(2 * R * h - h**2)   # 地面保护半径
x_c = tip_x + r0                  # 滚球球心 x 坐标
y_c = R                           # 滚球球心 y 坐标

print(f'h={h:.1f}, R={R:.1f}, r0={r0:.2f}, x_c={x_c:.2f}')

# ============================================================
# 地面
# ============================================================
ax.fill([-2, 16, 16, -2], [-2, -2, 0, 0], color='#D7CCC8', edgecolor='#5D4037', linewidth=2, zorder=1)
ax.text(7, -1.5, '大  地', fontsize=15, ha='center', va='center', color='#4E342E', fontweight='bold')

# ============================================================
# 建筑物
# ============================================================
bldg = Rectangle((tip_x - 0.8, 0), 1.6, 3.2, facecolor='#BDBDBD', edgecolor='#424242', linewidth=2, zorder=2)
ax.add_patch(bldg)
ax.text(tip_x, 1.6, '建筑物', fontsize=11, ha='center', va='center', color='#212121', fontweight='bold')

# ============================================================
# 避雷针杆体
# ============================================================
rod_base = 3.2
rod_top = h - 0.4
rod = Rectangle((tip_x - 0.12, rod_base), 0.24, rod_top - rod_base,
                facecolor='#FFCC80', edgecolor='#E65100', linewidth=2, zorder=3)
ax.add_patch(rod)

# 尖端
tip_pts = [(tip_x, h + 0.3), (tip_x - 0.25, h - 0.2), (tip_x + 0.25, h - 0.2)]
tip = Polygon(tip_pts, facecolor='#FFD54F', edgecolor='#F57F17', linewidth=2, zorder=4)
ax.add_patch(tip)
tip_y = h + 0.3   # 实际尖端顶点

# ============================================================
# 滚球 (虚线)
# ============================================================
sphere = Circle((x_c, y_c), R, facecolor='#BBDEFB', alpha=0.2,
                edgecolor='#1565C0', linewidth=2, linestyle='--', zorder=2)
ax.add_patch(sphere)
ax.plot(x_c, y_c, 'o', color='#1565C0', markersize=7, zorder=5)
ax.text(x_c + 0.4, y_c + 0.15, '滚球球心 O', fontsize=11, color='#1565C0', fontweight='bold')

# ============================================================
# 保护区域 (球面下方、地面上方的弓形区域)
# ============================================================

# 球面与地面切点: (x_c, 0)
# 球面与尖端交点: (tip_x, tip_y)

# 参数: 从球心出发，角度从地面切点(正下方, φ=3π/2)逆时针到尖端
tip_angle = np.arctan2(tip_y - y_c, tip_x - x_c)  # 尖端相对球心的角度
ground_angle = -np.pi/2   # 地面切点，球心正下方

# 保护弧线：从地面切点到尖端，沿球面
arc_angles = np.linspace(ground_angle, tip_angle, 100)
arc_x = x_c + R * np.cos(arc_angles)
arc_y = y_c + R * np.sin(arc_angles)

# 填充保护区域：弧线 + 地面线 + 建筑物/避雷针轮廓
# 地面从 x_c 到 tip_x
fill_x = np.concatenate([[tip_x], arc_x, [x_c]])
fill_y = np.concatenate([[tip_y], arc_y, [0]])
ax.fill(fill_x, fill_y, facecolor='#C8E6C9', alpha=0.35,
        edgecolor='none', zorder=1)

# 保护弧线描边
ax.plot(arc_x, arc_y, color='#2E7D32', linewidth=2.5, zorder=3)
ax.text(8.5, 2.8, '保护区域', fontsize=13, color='#2E7D32', fontweight='bold')

# ============================================================
# 标注关键点
# ============================================================
# 尖端触点
ax.plot(tip_x, tip_y, 'o', color='#D32F2F', markersize=8, zorder=6)
ax.annotate('尖端触点', xy=(tip_x, tip_y), xytext=(tip_x - 1.8, tip_y + 0.8),
            fontsize=10, color='#D32F2F', fontweight='bold',
            arrowprops=dict(arrowstyle='->', color='#D32F2F', lw=1.5),
            bbox=dict(facecolor='white', edgecolor='none', alpha=0.7))

# 地面切点
ax.plot(x_c, 0, 'o', color='#2E7D32', markersize=8, zorder=6)
ax.annotate('地面切点', xy=(x_c, 0), xytext=(x_c + 0.8, -0.8),
            fontsize=10, color='#2E7D32', fontweight='bold',
            arrowprops=dict(arrowstyle='->', color='#2E7D32', lw=1.5),
            bbox=dict(facecolor='white', edgecolor='none', alpha=0.7))

# ============================================================
# 尺寸标注
# ============================================================

# h: 从地面到尖端顶点的垂直高度
ax.annotate('', xy=(0.3, 0), xytext=(0.3, tip_y),
            arrowprops=dict(arrowstyle='<->', color='#D32F2F', lw=2.5))
ax.text(0.55, tip_y/2, 'h', fontsize=14, color='#D32F2F', fontweight='bold', va='center')
ax.text(0.9, tip_y/2, '有效高度', fontsize=10, color='#D32F2F', va='center')

# R: 从球心到尖端触点（或到地面切点）
# 画一条从球心到尖端触点的线
ax.plot([x_c, tip_x], [y_c, tip_y], '--', color='#1565C0', linewidth=1, alpha=0.5)
mid_x, mid_y = (x_c + tip_x)/2, (y_c + tip_y)/2
ax.text(mid_x + 0.3, mid_y + 0.3, 'R', fontsize=14, color='#1565C0', fontweight='bold')

# 从球心到地面的线
ax.plot([x_c, x_c], [0, y_c], '--', color='#1565C0', linewidth=1, alpha=0.5)
ax.text(x_c + 0.15, y_c/2, 'R', fontsize=14, color='#1565C0', fontweight='bold', va='center')

# r: 地面保护半径
ax.annotate('', xy=(tip_x, -0.5), xytext=(x_c, -0.5),
            arrowprops=dict(arrowstyle='<->', color='#2E7D32', lw=2.5))
ax.text(tip_x + r0/2, -0.9, 'r (地面保护半径)', fontsize=11, color='#2E7D32',
        fontweight='bold', ha='center')

# ============================================================
# 直角三角形辅助线 (证明 r = sqrt(2Rh-h²))
# ============================================================
# 球心到尖端触点的直角三角形：
# 水平直角边：x_c - tip_x = r
# 垂直直角边：|y_c - tip_y| = |R - h| (注意这里 h < R, 所以 R-h > 0)
# 斜边：R

# 水平虚线
ax.plot([tip_x, x_c], [tip_y, tip_y], ':', color='#757575', linewidth=1, zorder=1)
# 垂直虚线
ax.plot([x_c, x_c], [tip_y, y_c], ':', color='#757575', linewidth=1, zorder=1)

# 直角标记
sq_size = 0.4
ax.plot([x_c - sq_size, x_c - sq_size, x_c], [tip_y, tip_y + sq_size, tip_y + sq_size],
        'k-', linewidth=1, zorder=5)

# 标注直角边
ax.text(x_c - r0/2, tip_y - 0.4, 'r', fontsize=12, color='#757575', ha='center', fontweight='bold')
ax.text(x_c + 0.4, tip_y + (y_c - tip_y)/2, 'R-h', fontsize=12, color='#757575', ha='left', va='center')

# ============================================================
# 公式框
# ============================================================
formula_box = (
    r'$\mathbf{r = \sqrt{R^2 - (R-h)^2} = \sqrt{2Rh - h^2}}$' + '\n\n'
    r'$R$ — 滚球半径：一类 20m / 二类 45m / 三类 60m' + '\n'
    r'$h$ — 避雷针有效高度 (m)' + '\n'
    r'$r$ — 地面最大保护半径 (m)'
)
ax.text(12.5, 8, formula_box, fontsize=11, ha='center', va='center',
        bbox=dict(facecolor='#FFF8E1', edgecolor='#F57F17', pad=12, boxstyle='round'),
        linespacing=2.0)

# ============================================================
# 标题
# ============================================================
ax.set_title('图6  滚球法保护范围几何模型', fontsize=17, fontweight='bold', color='#1A237E', pad=15)

plt.tight_layout()
fig.savefig(r'D:\Visual Studio\Project\diagrams\fig4_滚球法模型.png', dpi=180, bbox_inches='tight',
            facecolor='white', edgecolor='none')
plt.close()
print('Fig4 saved')

from PIL import Image
img = Image.open(r'D:\Visual Studio\Project\diagrams\fig4_滚球法模型.png')
print(f'  Size: {img.size[0]}x{img.size[1]}')
