#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""图3：静电感应过程示意图 — 三步过程"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Polygon, Rectangle, FancyArrowPatch, FancyBboxPatch, Circle

plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False

fig, axes = plt.subplots(1, 3, figsize=(14, 5.5))
fig.subplots_adjust(wspace=0.25)

titles = ['① 云层靠近', '② 静电感应', '③ 尖端放电']
descriptions = [
    '雷雨云带负电荷\n靠近地面建筑\n大地呈电中性',
    '云层电场使大地\n感应出正电荷\n正电荷被吸引上升',
    '正电荷聚于尖端\n电场击穿空气\n形成导电通道'
]

for idx, (ax, title, desc) in enumerate(zip(axes, titles, descriptions)):
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title(title, fontsize=13, fontweight='bold', color='#1A237E', pad=8)

    # Ground
    ax.fill([0, 10, 10, 0], [0, 0, 1.5, 1.5], color='#D7CCC8', edgecolor='#5D4037', linewidth=2, zorder=1)
    ax.text(5, 0.7, '大地', fontsize=11, ha='center', va='center', color='#4E342E', fontweight='bold')

    # Building
    bldg = Rectangle((3.5, 1.5), 3, 3, facecolor='#BDBDBD', edgecolor='#424242', linewidth=1.5, zorder=2)
    ax.add_patch(bldg)

    # Lightning rod
    rod = Rectangle((4.85, 4.5), 0.3, 2, facecolor='#FFCC80', edgecolor='#E65100', linewidth=1.5, zorder=3)
    ax.add_patch(rod)
    tip = Polygon([(5, 7.5), (4.7, 6.5), (5.3, 6.5)], facecolor='#FFD54F', edgecolor='#F57F17', linewidth=1.5, zorder=4)
    ax.add_patch(tip)

    # Cloud
    cloud_y = 8.5
    cloud_x = [2, 3, 3.5, 4.5, 5.5, 6.5, 7.5, 8, 8.5]
    cloud_yt = [cloud_y, cloud_y+0.4, cloud_y+0.2, cloud_y+0.5, cloud_y+0.3, cloud_y+0.5, cloud_y+0.2, cloud_y+0.4, cloud_y]
    cloud_yb = [cloud_y-0.5, cloud_y-0.1, cloud_y-0.3, cloud_y, cloud_y-0.2, cloud_y, cloud_y-0.3, cloud_y-0.1, cloud_y-0.5]
    top_pts = list(zip(cloud_x, cloud_yt))
    bot_pts = list(zip(reversed(cloud_x), reversed(cloud_yb)))
    all_pts = top_pts + bot_pts
    poly = Polygon(all_pts, facecolor='#546E7A', edgecolor='#263238', linewidth=1.5, alpha=0.9, zorder=2)
    ax.add_patch(poly)

    # Cloud charges
    if idx == 0:
        # Neutral-ish (just negative)
        for cx, cy in [(3.5, cloud_y+0.1), (5, cloud_y+0.2), (6.5, cloud_y+0.1), (4, cloud_y-0.1), (6, cloud_y-0.1)]:
            ax.text(cx, cy, '-', fontsize=12, ha='center', va='center', color='#FFEB3B', fontweight='bold', zorder=5)
    else:
        for cx, cy in [(3.5, cloud_y+0.1), (5, cloud_y+0.2), (6.5, cloud_y+0.1), (4, cloud_y-0.1), (4.5, cloud_y+0.2), (5.5, cloud_y-0.1), (6, cloud_y-0.1)]:
            ax.text(cx, cy, '-', fontsize=11, ha='center', va='center', color='#FFEB3B', fontweight='bold', zorder=5)

    if idx >= 1:
        # Induced positive charges in ground
        for gx in [2.5, 3.5, 4.5, 5.5, 6.5, 7.5]:
            ax.text(gx, 2.0, '+', fontsize=10, ha='center', va='center', color='#D32F2F', fontweight='bold', zorder=5)
        # Positive charges moving up the rod
        for px, py in [(4.7,5.5), (5.3,5.5), (4.9,6.0), (5.1,6.0), (5,6.3)]:
            ax.text(px, py, '+', fontsize=9, ha='center', va='center', color='#D32F2F', fontweight='bold', zorder=5)

    if idx == 2:
        # Concentrated charges at tip
        for tx, ty in [(5,7.0), (4.8,6.8), (5.2,6.8), (4.9,7.2), (5.1,7.2)]:
            ax.text(tx, ty, '+', fontsize=13, ha='center', va='center', color='#D32F2F', fontweight='bold', zorder=6)

        # Lightning bolt
        ax.plot([5, 5.1, 4.9, 5.05], [7.3, 7.6, 7.9, 8.2], color='#FFEB3B', linewidth=2.5, zorder=6)
        ax.plot([5, 5.1, 4.9, 5.05], [7.3, 7.6, 7.9, 8.2], color='#FF6F00', linewidth=1, zorder=6)

        # Ionization zone
        circle = Circle((5, 7.5), 0.8, facecolor='#FFF9C4', alpha=0.5, edgecolor='#F57F17', linewidth=1.5, linestyle='--', zorder=5)
        ax.add_patch(circle)
        ax.text(6.5, 7.8, '电离区', fontsize=9, ha='left', color='#E65100', fontweight='bold')

    # Electric field arrows (only for idx >= 1)
    if idx >= 1:
        for fx in [3, 4, 5, 6, 7]:
            ax.annotate('', xy=(fx, 2.3), xytext=(fx, cloud_y-0.5),
                       arrowprops=dict(arrowstyle='->', color='#42A5F5', lw=1, alpha=0.5,
                                      linestyle='dashed'), zorder=1)
        ax.text(8.5, 6, 'E', fontsize=10, color='#1565C0', fontweight='bold', style='italic')

    # Description text
    ax.text(5, -0.5, desc, fontsize=10, ha='center', va='top', color='#424242',
            bbox=dict(facecolor='#FAFAFA', edgecolor='#BDBDBD', pad=5))

fig.suptitle('图1  静电感应与尖端放电过程', fontsize=16, fontweight='bold', color='#1A237E', y=0.99)

fig.savefig(r'D:\Visual Studio\Project\diagrams\fig3_静电感应过程.png', dpi=180, bbox_inches='tight',
            facecolor='white', edgecolor='none')
plt.close()
print('Fig3 saved')

from PIL import Image
img = Image.open(r'D:\Visual Studio\Project\diagrams\fig3_静电感应过程.png')
print(f'  Size: {img.size[0]}x{img.size[1]}')
