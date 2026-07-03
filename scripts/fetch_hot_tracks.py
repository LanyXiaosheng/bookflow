#!/usr/bin/env python3
"""
番茄短篇热词爬虫 — 抓原创榜页面，提取标题关键词，输出 hot_tracks.md
用法：python3 scripts/fetch_hot_tracks.py
"""
import urllib.request, re, sys
from datetime import datetime
from pathlib import Path

OUT = Path(__file__).parent.parent / "hot_tracks.md"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

URLS = [
    ("短故事榜", "https://fanqienovel.com/short_story"),
    ("原创榜",   "https://fanqienovel.com/ranking/origin"),
]

def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read().decode("utf-8", errors="ignore")

def extract_titles(html: str) -> list[str]:
    # 匹配各种书名格式
    patterns = [
        r'"book_name"\s*:\s*"([^"]{4,30})"',
        r'<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]{4,30})</span>',
        r'title="([^"]{4,30})"',
    ]
    seen, titles = set(), []
    for p in patterns:
        for t in re.findall(p, html):
            t = t.strip()
            if t and t not in seen and re.search(r'[\u4e00-\u9fff]', t):
                seen.add(t)
                titles.append(t)
    return titles[:30]

def extract_keywords(titles: list[str]) -> list[str]:
    stop = {"的", "了", "在", "是", "我", "他", "她", "你", "们", "和", "与",
            "一个", "这个", "那个", "什么", "怎么", "但", "却", "也", "都",
            "后", "前", "上", "下", "中", "里", "时", "然后", "于是"}
    freq: dict[str, int] = {}
    for t in titles:
        for w in re.findall(r'[\u4e00-\u9fff]{2,6}', t):
            if w not in stop:
                freq[w] = freq.get(w, 0) + 1
    return [w for w, c in sorted(freq.items(), key=lambda x: -x[1])[:25] if c >= 1]

def main():
    all_titles: list[str] = []
    sources: list[str] = []

    for name, url in URLS:
        try:
            print(f"抓取 {name}...", flush=True)
            html = fetch_html(url)
            titles = extract_titles(html)
            if titles:
                all_titles.extend(titles)
                sources.append(f"{name}({len(titles)}条)")
                print(f"  ✓ {len(titles)} 条")
        except Exception as e:
            print(f"  ⚠ {name} 失败: {e}", file=sys.stderr)

    if not all_titles:
        print("⚠️  所有源均失败，保留旧文件", file=sys.stderr)
        sys.exit(0)

    # 去重
    seen: set[str] = set()
    unique = [t for t in all_titles if not (t in seen or seen.add(t))]  # type: ignore

    keywords = extract_keywords(unique)
    today = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines = [
        f"# 番茄短篇热词榜（{today} 自动更新，来源：{', '.join(sources)}）",
        "",
        "## 今日上榜标题",
    ]
    for i, t in enumerate(unique[:20], 1):
        lines.append(f"{i}. {t}")

    if keywords:
        lines += ["", "## 高频情节热词（按出现频率）",
                  "、".join(keywords)]

    lines += ["", "---",
              "选题时优先参考以上热词和赛道，结合自身赛道灵活运用，不要机械套用。"]

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"✅ 已写入 {OUT}（{len(unique)} 条标题，{len(keywords)} 个热词）")

if __name__ == "__main__":
    main()
