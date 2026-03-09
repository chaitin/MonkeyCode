#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sitemap 生成脚本
从 API 读取广场内容，生成 sitemap.xml

运行方式: python scripts/generate-sitemap.py
"""

import requests
import os
from datetime import datetime

# 配置
SITE_URL = 'https://monkeycode-ai.com'
API_URL = f'{SITE_URL}/api/v1/playground-posts'
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '../public/sitemap.xml')

# 静态页面配置
STATIC_PAGES = [
    {'path': '/', 'changefreq': 'weekly', 'priority': '1.0'},
    {'path': '/playground', 'changefreq': 'daily', 'priority': '0.8'},
]


def get_today():
    """获取今天的日期"""
    return datetime.now().strftime('%Y-%m-%d')


def fetch_playground_posts():
    """从 API 获取广场帖子列表"""
    try:
        response = requests.get(API_URL, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data.get('code') == 0:
            return data.get('data', {}).get('playground_posts', [])
        else:
            print(f'❌ API 返回错误: {data.get("message")}')
            return []
    except requests.RequestException as e:
        print(f'❌ 请求 API 失败: {e}')
        return []


def generate_url_entry(loc, lastmod, changefreq, priority):
    """生成单个 URL 条目"""
    return f'''  <url>
    <loc>{loc}</loc>
    <lastmod>{lastmod}</lastmod>
    <changefreq>{changefreq}</changefreq>
    <priority>{priority}</priority>
  </url>'''


def generate_sitemap():
    """生成完整的 sitemap"""
    today = get_today()
    url_entries = []
    
    # 添加静态页面
    for page in STATIC_PAGES:
        entry = generate_url_entry(
            loc=f"{SITE_URL}{page['path']}",
            lastmod=today,
            changefreq=page['changefreq'],
            priority=page['priority']
        )
        url_entries.append(entry)
    
    # 从 API 获取广场帖子
    posts = fetch_playground_posts()
    print(f'📥 获取到 {len(posts)} 个广场帖子')
    
    for post in posts:
        post_id = post.get('id')
        if not post_id:
            continue
        
        # 使用帖子的更新时间，如果没有则用今天
        updated_at = post.get('updated_at')
        if updated_at:
            lastmod = datetime.fromtimestamp(updated_at).strftime('%Y-%m-%d')
        else:
            lastmod = today
        
        entry = generate_url_entry(
            loc=f"{SITE_URL}/playground/detail?id={post_id}",
            lastmod=lastmod,
            changefreq='weekly',
            priority='0.6'
        )
        url_entries.append(entry)
    
    # 组装 sitemap
    sitemap = f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(url_entries)}
</urlset>
'''
    return sitemap


def main():
    print('🚀 开始生成 sitemap...')
    
    sitemap = generate_sitemap()
    
    # 确保输出目录存在
    output_dir = os.path.dirname(OUTPUT_PATH)
    os.makedirs(output_dir, exist_ok=True)
    
    # 写入文件
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        f.write(sitemap)
    
    print(f'✅ sitemap.xml 生成成功！')
    print(f'📍 输出路径: {os.path.abspath(OUTPUT_PATH)}')


if __name__ == '__main__':
    main()

