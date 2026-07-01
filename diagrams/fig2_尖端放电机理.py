#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""图2：尖端放电机理详图 — 尖端 vs 钝面对比"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Polygon, Rectangle, Arc, FancyArrowPatch, Ellipse

plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 6))
fig.subplots_adjust(wspace=0.3)

for ax, title, is_sharp in [(ax1, '尖端导体（曲率半径极小）', True),
                              (ax2, '钝面导体（曲率半径较大）', False)]:
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title(title, fontsize=14, fontweight='bold', color='#1A237E', pad=10)

    # Ground plane
    ax.fill([0, 10, 10, 0], [0, 0, 1, 1], color='#D7CCC8', edgecolor='#5D4037', linewidth=2, zorder=1)

    if is_sharp:
        # Sharp tip conductor
        tip = Polygon([(4.2, 1), (5, 8.5), (5.8, 1)],
                      facecolor='#90CAF9', edgecolor='#1565C0', linewidth=2.5, zorder=3)
        ax.add_patch(tip)
        ax.text(5, 8.9, '曲率半径 r1 -> 0', fontsize=11, ha='center', color='#D32F2F', fontweight='bold')

        # Charges concentrated at tip
        charges = [(5,8.0), (4.7,7.5), (5.3,7.5), (4.8,7.0), (5.2,7.0), (4.9,6.5), (5.1,6.5)]
        for cx, cy in charges:
            ax.text(cx, cy, '+', fontsize=16, ha='center', va='center', color='#D32F2F', fontweight='bold', zorder=4)

        # Dense field lines radiating from tip
        for angle in np.linspace(-70, 70, 15):
            rad = np.radians(angle + 90)
            end_x = 5 + 4.5 * np.cos(rad)
            end_y = 8.5 + 4.5 * np.sin(rad)
            ax.annotate('', xy=(end_x, end_y), xytext=(5, 8.3),
                       arrowprops=dict(arrowstyle='->', color='#1565C0', lw=1.3, alpha=0.8), zorder=2)

        # High E annotation
        ax.text(8, 8.5, '电场极强\nE ~ 3x10^6 V/m\n空气击穿！', fontsize=12, ha='center', color='#D32F2F',
                fontweight='bold', bbox=dict(facecolor='#FFEBEE', edgecolor='#D32F2F', pad=5))

        # Small area label
        ax.annotate('表面积 S 极小\nσ = q/S 极大', xy=(5, 7.5), xytext=(1.5, 9.0),
                   fontsize=11, color='#E65100', fontweight='bold', ha='center',
                   arrowprops=dict(arrowstyle='->', color='#E65100', lw=2),
                   bbox=dict(facecolor='#FFF3E0', edgecolor='#E65100', pad=3))

    else:
        # Blunt conductor
        blunt = Ellipse((5, 2.2), 5, 2.8, facecolor='#90CAF9', edgecolor='#1565C0', linewidth=2.5, zorder=3)
        ax.add_patch(blunt)
        ax.text(5, 0.2, '曲率半径 r2 较大', fontsize=11, ha='center', color='#1565C0', fontweight='bold')

        # Charges spread out
        for cx in np.linspace(2.8, 7.2, 7):
            # Find y on ellipse: (x-5)²/2.5² + (y-2.2)²/1.4² = 1
            dy = 1.4 * np.sqrt(max(0, 1 - ((cx-5)/2.5)**2))
            cy = 2.2 + dy - 0.1
            ax.text(cx, cy, '+', fontsize=14, ha='center', va='center', color='#D32F2F', fontweight='bold', zorder=4)

        # Sparse field lines
        for angle in np.linspace(-50, 50, 5):
            rad = np.radians(angle + 90)
            top_y = 2.2 + 1.4
            start_x = 5
            start_y = top_y
            end_x = start_x + 4 * np.cos(rad)
            end_y = start_y + 4 * np.sin(rad)
            ax.annotate('', xy=(end_x, end_y), xytext=(start_x, start_y),
                       arrowprops=dict(arrowstyle='->', color='#1565C0', lw=1, alpha=0.5), zorder=2)

        # Low E annotation
        ax.text(8.2, 5, '电场较弱\n不足以击穿空气', fontsize=12, ha='center', color='#1565C0',
                fontweight='bold', bbox=dict(facecolor='#E3F2FD', edgecolor='#1565C0', pad=5))

        # Large area label
        ax.annotate('表面积 S 大\nσ 较小', xy=(3, 3.6), xytext=(1, 6),
                   fontsize=11, color='#1565C0', fontweight='bold', ha='center',
                   arrowprops=dict(arrowstyle='->', color='#1565C0', lw=2),
                   bbox=dict(facecolor='#E8EAF6', edgecolor='#1565C0', pad=3))

# Central formula
fig.text(0.5, 0.04, r'$\mathbf{E = \frac{\sigma}{\varepsilon_0} \qquad \sigma = \frac{q}{S} \qquad \sigma \propto \frac{1}{r}}$',
         fontsize=15, ha='center', fontweight='bold', color='#1A237E',
         bbox=dict(facecolor='#F5F5F5', edgecolor='#9E9E9E', pad=8))

fig.suptitle('图2  尖端放电机理：尖端 vs 钝面对比', fontsize=16, fontweight='bold', color='#1A237E', y=0.97)

fig.savefig(r'D:\Visual Studio\Project\diagrams\fig2_尖端放电机理.png', dpi=180, bbox_inches='tight',
            facecolor='white', edgecolor='none')
plt.close()
print('Fig2 saved')

from PIL import Image
img = Image.open(r'D:\Visual Studio\Project\diagrams\fig2_尖端放电机理.png')
print(f'  Size: {img.size[0]}x{img.size[1]}')
