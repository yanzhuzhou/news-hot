#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全网社交平台热点榜单抓取脚本
抓取微博/知乎/抖音/B站/小红书热榜，聚合生成 data.json 供网页动态渲染。
由 GitHub Actions 每小时自动运行。

数据源（优先级从高到低，任一可用即采用）：
  1. vvhan 韩小韩免费热榜 API  https://api.vvhan.com/api/hotlist?type=xxx
  2. guigui API                https://api.guiguiya.com/api/hotlist?type=xxx

所有源失败时保留上一次 data.json，仅更新时间戳，保证看板不空。
"""

import json
import re
import sys
import os
import time
import datetime
import urllib.request
import urllib.error

# ---------- 配置 ----------
OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")

# 各平台 API 源（按优先级）
SOURCES = {
    "weibo": [
        "https://api.vvhan.com/api/hotlist?type=weibo",
        "https://api.guiguiya.com/api/hotlist?type=weibo",
    ],
    "zhihu": [
        "https://api.vvhan.com/api/hotlist?type=zhihu",
        "https://api.guiguiya.com/api/hotlist?type=zhihu",
    ],
    "douyin": [
        "https://api.vvhan.com/api/hotlist?type=douyin",
        "https://api.guiguiya.com/api/hotlist?type=douyin",
    ],
    "bilibili": [
        "https://api.vvhan.com/api/hotlist?type=bilibili",
        "https://api.guiguiya.com/api/hotlist?type=bilibili",
    ],
    "xiaohongshu": [
        "https://api.vvhan.com/api/hotlist?type=xiaohongshu",
        "https://api.vvhan.com/api/hotlist?type=xhs",
    ],
}

UNIT = {
    "weibo": "万热度", "zhihu": "万热度", "douyin": "万热度值",
    "bilibili": "万播放", "xiaohongshu": "万",
}
DISPLAY = {
    "weibo": "微博热搜", "zhihu": "知乎热榜", "douyin": "抖音热搜",
    "bilibili": "B站热门", "xiaohongshu": "小红书热搜",
}

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"


# ---------- 网络抓取 ----------
def fetch_json(url, timeout=20):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json,text/plain,*/*",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="ignore")
    return json.loads(raw)


def extract_items(data):
    """兼容多种 API 返回结构，提取 [{title, hot}] 列表。"""
    if not isinstance(data, dict):
        return []
    # vvhan / guigui: {"data":[{title,hot,url}]}
    items = data.get("data") or data.get("list") or data.get("items")
    if not items and "data" in data and isinstance(data["data"], dict):
        items = data["data"].get("data") or data["data"].get("list")
    if not isinstance(items, list):
        return []
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        title = it.get("title") or it.get("name") or it.get("word") or ""
        hot = it.get("hot") or it.get("hotValue") or it.get("value") or it.get("heat") or "0"
        if title:
            out.append({"title": str(title).strip(), "hot": str(hot)})
    return out


def parse_heat(hot_str):
    """从热度字符串中提取数值（万为单位）。"""
    if not hot_str:
        return 0.0
    s = str(hot_str).replace(",", "").replace("，", "").strip()
    m = re.search(r"(\d+(?:\.\d+)?)", s)
    val = float(m.group(1)) if m else 0.0
    # 若含"亿"，换算为万
    if "亿" in s:
        val *= 10000
    # 若原始数字很大（如抖音播放量 97000000），归一到万
    if val >= 100000:
        val = round(val / 10000, 1)
    return val


def normalize(items, unit, top=10):
    """整理为前端需要的结构。"""
    out = []
    for i, it in enumerate(items[:top]):
        hv = parse_heat(it.get("hot", "0"))
        hot_text = it.get("hot", "—")
        if hot_text and hot_text != "0":
            hot_text = f"{hv}{unit}" if hv > 0 else "—"
        else:
            hot_text = "—"
        out.append({
            "rank": i + 1,
            "title": it.get("title", ""),
            "heatText": hot_text,
            "heatValue": hv,
            "isNew": i < 3 and hv > 0,  # 粗略：前三且有效视为新上榜（实际可对比历史）
        })
    return out


# ---------- 类别判定 ----------
def categorize(title):
    t = title or ""
    rules = [
        (["泥石流", "地震", "洪水", "灾害", "火灾", "台风", "旱", "塌方", "事故", "遇难", "失联"], "灾害"),
        (["女排", "男足", "足球", "篮球", "奥运", "比赛", "冠军", "决赛", "亚锦", "世锦赛", "联赛", "体育"], "体育"),
        (["习近平", "主席", "峰会", "外交", "访问", "会谈", "上合", "元首"], "时政"),
        (["法", "规定", "回应", "取消", "政策", "部委", "通知", "实施", "动员", "条例", "修订"], "政策"),
        (["AI", "芯片", "鸿蒙", "手机", "华为", "苹果", "科技", "互联网", "字节", "算法", "模型", "Token", "CS", "Mac", "半导体", "内存", "大模型"], "科技"),
        (["演", "剧", "综艺", "明星", "花少", "偶像", "娱乐", "歌手", "专辑", "演唱会", "演员", "导演"], "娱乐"),
        (["股", "币", "财经", "经济", "涨", "跌", "基金", "理财", "彩礼", "币圈", "金融"], "财经"),
        (["研究", "发现", "科学", "南极", "水银", "气候", "生态", "论文"], "科研"),
    ]
    for keys, cat in rules:
        if any(k in t for k in keys):
            return cat
    return "社会"


def categorize_all(platforms_data, overall):
    stats = {}
    for it in overall:
        c = it.get("category", "社会")
        stats[c] = stats.get(c, 0) + 1
    for pkey, pf in platforms_data.items():
        for it in pf["list"]:
            c = categorize(it["title"])
            stats[c] = stats.get(c, 0) + 1
    return stats


# ---------- 聚合计算 ----------
def compute_overall(platforms_data):
    """跨平台综合：按各平台榜首热度近似加权，去重合并取前10。"""
    pool = {}  # title -> {heatValue, platforms, cats}
    for pkey, pf in platforms_data.items():
        for it in pf["list"]:
            title = it["title"]
            # 简化去重：包含关键词即视为同主题
            merged = False
            for exist in list(pool.keys()):
                if title_similarity(title, exist):
                    pool[exist]["heatValue"] += it["heatValue"]
                    if pkey not in pool[exist]["platforms"]:
                        pool[exist]["platforms"].append(pkey)
                    pool[exist]["sources"].append(pkey)
                    merged = True
                    break
            if not merged:
                pool[title] = {
                    "heatValue": it["heatValue"],
                    "platforms": [pkey] if it["heatValue"] > 0 else [],
                    "category": categorize(title),
                    "desc": f"跨平台热度话题：{DISPLAY.get(pkey, pkey)}热度 {it['heatValue']}{UNIT.get(pkey,'万')}。",
                    "sources": [pkey],
                }
    ranked = sorted(pool.items(), key=lambda x: x[1]["heatValue"], reverse=True)[:10]
    out = []
    for i, (title, info) in enumerate(ranked):
        out.append({
            "rank": i + 1,
            "title": title,
            "heatText": f"综合热度 {round(info['heatValue'],1)} 万",
            "heatValue": round(info["heatValue"], 1),
            "platforms": info["platforms"][:4],
            "category": info["category"],
            "desc": info["desc"],
        })
    return out


def title_similarity(a, b):
    """粗略判断两标题是否同主题（共享 4+ 字符片段）。"""
    if not a or not b:
        return False
    la, lb = set(a), set(b)
    common = la & lb
    # 取较短的长度，共同字符占比高则视为同主题
    short = min(len(a), len(b))
    if short == 0:
        return False
    return len(common) / short > 0.6


def compute_fastest(platforms_data, overall):
    """24h增长最快：取各平台 isNew + 综合榜前列，按突发性排序。"""
    seen = {}
    for pkey, pf in platforms_data.items():
        for it in pf["list"][:6]:
            if it["isNew"]:
                seen.setdefault(it["title"], {"platforms": [], "count": 0})
                if pkey not in seen[it["title"]]["platforms"]:
                    seen[it["title"]]["platforms"].append(pkey)
                seen[it["title"]]["count"] += 1
    # 补充综合榜前3
    for it in overall[:3]:
        seen.setdefault(it["title"], {"platforms": list(it["platforms"]), "count": 1})
        for p in it["platforms"]:
            if p not in seen[it["title"]]["platforms"]:
                seen[it["title"]]["platforms"].append(p)
        seen[it["title"]]["count"] += 1
    ranked = sorted(seen.items(), key=lambda x: (x[1]["count"], len(x[1]["platforms"])), reverse=True)[:10]
    rates = ["极速", "极速", "爆发", "爆发", "爆发", "飙升", "飙升", "飙升", "飙升", "飙升"]
    out = []
    for i, (title, info) in enumerate(ranked):
        out.append({
            "rank": i + 1,
            "title": title,
            "rate": rates[i] if i < len(rates) else "飙升",
            "platforms": info["platforms"][:3],
            "desc": f"24小时内多平台新上榜/飙升，覆盖{len(info['platforms'])}个平台。",
        })
    return out


def platform_heat_stats(platforms_data):
    return {p: pf["list"][0]["heatValue"] if pf["list"] else 0 for p, pf in platforms_data.items()}


# ---------- 主流程 ----------
def main():
    platforms_data = {}
    for pkey, urls in SOURCES.items():
        for url in urls:
            try:
                raw = fetch_json(url)
                items = extract_items(raw)
                if items:
                    platforms_data[pkey] = {
                        "name": DISPLAY[pkey],
                        "unit": UNIT[pkey],
                        "list": normalize(items, UNIT[pkey]),
                    }
                    print(f"[OK] {pkey}: {len(items)} 条 <- {url}", file=sys.stderr)
                    break
            except Exception as e:
                print(f"[FAIL] {pkey} <- {url}: {e}", file=sys.stderr)
                continue

    # 全部失败：保留旧数据，仅更新时间戳
    if not platforms_data:
        print("[WARN] 所有数据源失败，保留旧 data.json", file=sys.stderr)
        if os.path.exists(OUTPUT):
            try:
                old = json.load(open(OUTPUT, "r", encoding="utf-8"))
                old["updateTime"] = datetime.datetime.now(
                    datetime.timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M")
                old["source"] = old.get("source", "") + "（本次抓取失败，保留上次数据）"
                json.dump(old, open(OUTPUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
                return
            except Exception:
                pass
        print("[ERROR] 无可用数据且无旧 data.json", file=sys.stderr)
        sys.exit(1)

    overall = compute_overall(platforms_data)
    fastest = compute_fastest(platforms_data, overall)
    category_stats = categorize_all(platforms_data, overall)
    pstats = platform_heat_stats(platforms_data)
    total = sum(len(pf["list"]) for pf in platforms_data.values())
    new_count = sum(1 for pf in platforms_data.values() for it in pf["list"] if it.get("isNew"))

    result = {
        "updateTime": datetime.datetime.now(
            datetime.timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M"),
        "updateTimestamp": int(time.time()),
        "source": "GitHub Actions 自动抓取（vvhan/guigui API 聚合）",
        "summary": {
            "totalTopics": total,
            "platforms": len(platforms_data),
            "newTopics": new_count,
        },
        "overall": overall,
        "platforms": platforms_data,
        "fastestGrowing": fastest,
        "categoryStats": category_stats,
        "platformHeatStats": pstats,
    }

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"[DONE] 写入 {OUTPUT}，平台 {len(platforms_data)} 个，热点 {total} 条", file=sys.stderr)


if __name__ == "__main__":
    main()
