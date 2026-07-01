#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""图1：避雷针系统结构与工作原理图"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyBboxPatch, Arc, FancyArrowPatch, Circle, Wedge, Polygon, Rectangle
from matplotlib.lines import Line2D

plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False

fig, ax = plt.subplots(1, 1, figsize=(8, 10))
ax.set_xlim(0, 10)
ax.set_ylim(0, 14)
ax.set_aspect('equal')
ax.axis('off')

# === 天空背景 ===
sky = Rectangle((0, 8), 10, 6, facecolor='#E3F2FD', edgecolor='none', zorder=0)
ax.add_patch(sky)

# === 地面 ===
ground = Rectangle((0, 0), 10, 2.5, facecolor='#D7CCC8', edgecolor='#5D4037', linewidth=2, zorder=1)
ax.add_patch(ground)
ax.text(5, 1.2, '大  地', fontsize=16, ha='center', va='center', color='#4E342E', fontweight='bold')

# === 雷雨云 ===
cloud_x = [1, 2, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8, 9, 9.5]
cloud_y_top = [11, 11.5, 11.2, 11.8, 11.3, 11.6, 11.2, 11.7, 11.3, 11.5, 11]
cloud_y_bot = [9.5, 10, 9.7, 10.3, 9.8, 10.1, 9.7, 10.2, 9.8, 10, 9.5]

# Cloud body
for i in range(len(cloud_x)-1):
    pts = [(cloud_x[i], cloud_y_top[i]), (cloud_x[i+1], cloud_y_top[i+1]),
           (cloud_x[i+1], cloud_y_bot[i+1]), (cloud_x[i], cloud_y_bot[i])]
    ax.fill(*zip(*pts), color='#546E7A', alpha=0.85, edgecolor='#37474F', linewidth=1)

# Cloud outline
top_pts = list(zip(cloud_x, cloud_y_top))
bot_pts = list(zip(reversed(cloud_x), reversed(cloud_y_bot)))
all_pts = top_pts + bot_pts
poly = Polygon(all_pts, facecolor='#546E7A', edgecolor='#263238', linewidth=2, alpha=0.9, zorder=2)
ax.add_patch(poly)

# Negative charges in cloud
for cx, cy in [(2.5,10.5), (3.5,11.0), (4.5,10.7), (5.5,11.1), (6.5,10.6), (7.5,10.9), (3.0,10.0), (5.0,10.3), (7.0,10.1)]:
    ax.text(cx, cy, '-', fontsize=18, ha='center', va='center', color='#FFEB3B', fontweight='bold', zorder=3)

ax.text(5, 12.2, '雷雨云（带负电荷）', fontsize=14, ha='center', va='center', fontweight='bold', color='#1A237E',
        bbox=dict(facecolor='#BBDEFB', edgecolor='#1565C0', pad=5), zorder=4)

# === 建筑物 ===
# Main building body
bldg = Rectangle((3.5, 2.5), 3, 4.5, facecolor='#BDBDBD', edgecolor='#424242', linewidth=2, zorder=3)
ax.add_patch(bldg)
# Windows
for wx, wy in [(4,3.5), (5.5,3.5), (4,5), (5.5,5)]:
    win = Rectangle((wx, wy), 0.7, 0.8, facecolor='#E3F2FD', edgecolor='#1565C0', linewidth=1, zorder=4)
    ax.add_patch(win)

ax.text(5, 5.6, '建筑物', fontsize=12, ha='center', va='center', color='#212121', fontweight='bold')

# === 避雷针 ===
# Air terminal (尖端)
tip_x, tip_y = 5, 7.0
# Triangle tip
tip = Polygon([(5, 8.8), (4.7, 7.0), (5.3, 7.0)], facecolor='#FFD54F', edgecolor='#F57F17', linewidth=2, zorder=5)
ax.add_patch(tip)
ax.text(5.8, 8.5, '接闪器（尖端）', fontsize=11, color='#E65100', fontweight='bold', ha='left')

# Down conductor
cond = Rectangle((4.85, 2.5), 0.3, 4.5, facecolor='#FFCC80', edgecolor='#E65100', linewidth=2, zorder=4)
ax.add_patch(cond)
ax.text(6, 4.5, '接地\n引下线', fontsize=11, color='#E65100', fontweight='bold', ha='left', va='center')

# Grounding device
for gx in [3.8, 4.5, 5.5, 6.2]:
    ax.plot([gx, gx], [2.5, 1.8], color='#E65100', linewidth=3, zorder=5)
ax.plot([3.8, 6.2], [2.1, 2.1], color='#E65100', linewidth=3, zorder=5)
ax.text(7.2, 2.1, '接地装置', fontsize=11, color='#E65100', fontweight='bold', ha='left', va='center')

# === 感应正电荷 ===
for px, py in [(4.4,6.8), (5.0,6.5), (5.6,6.8), (4.7,6.2), (5.3,6.2)]:
    ax.text(px, py, '+', fontsize=16, ha='center', va='center', color='#D32F2F', fontweight='bold', zorder=6)

# Surface charges on ground
for gx in [2, 3, 4, 6, 7, 8]:
    ax.text(gx, 3.0, '+', fontsize=14, ha='center', va='center', color='#D32F2F', fontweight='bold', zorder=4)

# === 电场线（云到地）===
for fx in [2.5, 3.5, 4.5, 5.5, 6.5, 7.5]:
    fy = np.linspace(9, 3.5, 6)
    for i in range(len(fy)-1):
        ax.annotate('', xy=(fx, fy[i+1]), xytext=(fx, fy[i]),
                    arrowprops=dict(arrowstyle='->', color='#42A5F5', lw=1.2, alpha=0.6,
                                   linestyle='dashed'), zorder=2)

# 电场线标注
ax.text(8.8, 6, '电场线', fontsize=10, color='#1565C0', ha='center')
ax.annotate('', xy=(8.3, 6), xytext=(8.8, 6),
            arrowprops=dict(arrowstyle='->', color='#1565C0', lw=1, linestyle='dashed'))

# === 电离放电通道 ===
# Zigzag lightning near tip
zig_x = [5, 5.15, 4.85, 5.1, 4.9, 5.05]
zig_y = [8.8, 9.2, 9.5, 9.8, 10.0, 10.2]
ax.plot(zig_x, zig_y, color='#FFEB3B', linewidth=3, zorder=6)
ax.plot(zig_x, zig_y, color='#FF6F00', linewidth=1.5, zorder=6)
# Lightning bolt icon
# Lightning bolt icon - drawn manually
l_x = [3.8, 4.2, 4.0, 4.4, 3.9, 4.3, 3.7]
l_y = [10.0, 9.7, 9.8, 9.4, 9.6, 9.2, 9.8]
ax.fill(l_x, l_y, color='#FFEB3B', edgecolor='#FF6F00', linewidth=1, zorder=7)
ax.text(3.5, 9.0, '空气电离\n形成导电通道', fontsize=10, ha='center', color='#E65100', fontweight='bold')

# === 电流入地方向 ===
ax.annotate('', xy=(5, 2.0), xytext=(5, 4.5),
            arrowprops=dict(arrowstyle='->', color='#FF6F00', lw=3, connectionstyle='arc3,rad=0'), zorder=6)
ax.text(6.2, 3.2, '雷电流\n入地', fontsize=10, ha='left', color='#E65100', fontweight='bold')

# === 保护范围示意 ===
# Protection cone
prot_left = np.array([[3, 2.5], [4.2, 7.5], [5, 8.8]])
prot_right = np.array([[7, 2.5], [5.8, 7.5], [5, 8.8]])
ax.fill([3, 4.2, 5, 5.8, 7], [2.5, 7.5, 8.8, 7.5, 2.5],
        facecolor='#C8E6C9', alpha=0.25, edgecolor='#2E7D32', linewidth=1.5, linestyle='--', zorder=2)
ax.text(7.8, 6.0, '保护区域', fontsize=11, color='#2E7D32', fontweight='bold', rotation=25)

# === 尺寸标注 ===
# Height markers
ax.plot([2.5, 2.5], [2.5, 8.8], 'k-', linewidth=1, zorder=7)
ax.plot([2.3, 2.7], [2.5, 2.5], 'k-', linewidth=1, zorder=7)
ax.plot([2.3, 2.7], [8.8, 8.8], 'k-', linewidth=1, zorder=7)
ax.text(2.0, 5.65, 'h', fontsize=13, ha='right', va='center', fontweight='bold')

# === 标题 ===
ax.set_title('图3  避雷针系统结构与工作原理', fontsize=16, fontweight='bold', pad=15, color='#1A237E')

plt.tight_layout()
fig.savefig(r'D:\Visual Studio\Project\diagrams\fig1_避雷针结构图.png', dpi=180, bbox_inches='tight',
            facecolor='white', edgecolor='none')
plt.close()
print('Fig1 saved')

from PIL import Image
img = Image.open(r'D:\Visual Studio\Project\diagrams\fig1_避雷针结构图.png')
print(f'  Size: {img.size[0]}x{img.size[1]}')
