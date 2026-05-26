"""把抓到的番茄小说数据渲染成 Markdown。"""
from __future__ import annotations

import datetime as dt
from pathlib import Path


def _fmt_time(ts: int) -> str:
    if not ts:
        return "未知"
    return dt.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


def _fmt_num(n: int | None) -> str:
    if n is None or n == 0:
        return "-"
    if n >= 10000:
        return f"{n/10000:.1f}w"
    return f"{n:,}"


def _pct(num: int, denom: int, decimals: int = 2) -> str:
    if not denom:
        return "-"
    return f"{num/denom*100:.{decimals}f}%"


def render_report(
    work: dict,
    script: str,
    comments: list[dict],
    detail_captured: list[dict] | None = None,
    stats: dict | None = None,
    daily_data: list[dict] | None = None,
) -> str:
    lines: list[str] = []
    title = work.get("title") or "(无标题)"
    work_id = work["work_id"]

    lines.append(f"# {title}")
    lines.append("")
    item_id = work.get("item_id") or work_id
    lines.append(f"- 作品 ID：`{work_id}`")
    lines.append(f"- 内容 ID：`{item_id}`")
    lines.append(f"- 发布时间：{_fmt_time(work.get('create_time', 0))}")
    lines.append(f"- 最近更新：{_fmt_time(work.get('update_time', 0))}")
    lines.append(f"- 字数：{_fmt_num(work.get('word_count'))}")
    lines.append(f"- 分类：{work.get('category') or '-'}")
    sign_text = work.get("sign_status_text") or ""
    if sign_text:
        lines.append(f"- 签约状态：{sign_text}")
    lines.append(f"- 链接：https://fanqienovel.com/page/{item_id}")
    lines.append(f"- 抓取时间：{dt.datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")

    # --- 核心数据 ---
    read = 0
    show = 0
    digg = 0
    comment = 0
    collect = 0
    click_rate_str = "-"

    if stats:
        read = stats.get("read_count") or work.get("read_count") or 0
        show = stats.get("show_count") or 0
        digg = stats.get("digg_count") or 0
        comment = stats.get("comment_count") or 0
        collect = stats.get("shelf_count") or 0
        cr = stats.get("click_rate") or ""
        click_rate_str = f"{float(cr)*100:.1f}%" if cr else "-"
    else:
        read = work.get("read_count") or 0
        digg = work.get("like_count") or work.get("digg_count") or 0
        comment = work.get("comment_count") or 0
        collect = work.get("collect_count") or 0

    lines.append("## 核心数据")
    lines.append("")
    lines.append(f"| 指标 | 数值 | 派生比率 |")
    lines.append(f"|---|---|---|")
    lines.append(f"| 曝光 | {_fmt_num(show)} | - |")
    lines.append(f"| 阅读 | {_fmt_num(read)} | 点击率 {click_rate_str} |")
    lines.append(f"| 点赞 | {_fmt_num(digg)} | 赞/读 {_pct(digg, read)} |")
    lines.append(f"| 评论 | {_fmt_num(comment)} | 评/读 {_pct(comment, read, 3)} |")
    lines.append(f"| 收藏 | {_fmt_num(collect)} | 藏/读 {_pct(collect, read)} |")
    lines.append("")

    # --- 日增长曲线 ---
    if daily_data:
        lines.append("## 日增长曲线")
        lines.append("")
        lines.append("| 日期 | 曝光 | 阅读 | 完读 | 完读率 | 15s留存 |")
        lines.append("|---|---|---|---|---|---|")
        for d in daily_data:
            date_str = d.get("date", "")
            day_show = d.get("show_count", 0)
            day_read = d.get("read_count", 0)
            day_100 = d.get("read_100_percent", 0)
            comp_rate = _pct(day_100, day_read, 1) if day_read else "-"
            ret_15s = d.get("retention_15s", "-")
            lines.append(f"| {date_str} | {_fmt_num(day_show)} | {_fmt_num(day_read)} | {_fmt_num(day_100)} | {comp_rate} | {ret_15s} |")
        lines.append("")

        # 累计数据
        total_show = sum(d.get("show_count", 0) for d in daily_data)
        total_read = sum(d.get("read_count", 0) for d in daily_data)
        if len(daily_data) >= 2:
            peak_day = max(daily_data, key=lambda d: d.get("read_count", 0))
            lines.append(f"- 峰值日：{peak_day.get('date', '?')}（阅读 {_fmt_num(peak_day.get('read_count', 0))}）")
            # 推荐衰减
            if daily_data[0].get("read_count", 0) > 0:
                last_read = daily_data[-1].get("read_count", 0)
                first_read = daily_data[0].get("read_count", 0)
                if first_read > last_read:
                    lines.append(f"- 衰减：首日 {_fmt_num(first_read)} → 末日 {_fmt_num(last_read)}（{_pct(last_read, first_read, 0)} 残留）")
            lines.append("")

    # --- 详细指标 ---
    if stats and stats.get("raw"):
        raw = stats["raw"]
        extras = []
        pay_rate = raw.get("douyin_pay_rate") or ""
        if pay_rate and pay_rate != "0":
            extras.append(f"- 付费率：{float(pay_rate)*100:.1f}%")
        pop_score = raw.get("douyin_read_popularity_score") or ""
        if pop_score and pop_score != "0":
            extras.append(f"- 阅读热度分：{pop_score}")
        if extras:
            lines.append("## 平台指标")
            lines.append("")
            lines.extend(extras)
            lines.append("")

    # --- 稿子 ---
    lines.append("## 原始稿子")
    lines.append("")
    lines.append(script.strip() if script.strip() else "（未提供）")
    lines.append("")

    # --- 评论 ---
    lines.append(f"## 评论（按点赞降序，共 {len(comments)} 条）")
    lines.append("")
    if not comments:
        lines.append("（未抓到评论）")
    else:
        for c in comments:
            text = c["text"].replace("\n", " ").strip()
            reply = f" 💬{c['reply_count']}" if c.get("reply_count") else ""
            lines.append(f"- [👍{c['like_count']}{reply}] {text}")
    lines.append("")

    return "\n".join(lines)


def slugify(text: str, max_len: int = 30) -> str:
    bad = '<>:"/\\|?*\n\r\t'
    out = "".join("_" if ch in bad else ch for ch in text).strip()
    return out[:max_len] or "untitled"


def output_dir_for(work: dict, root: Path) -> Path:
    date = _fmt_time(work.get("create_time", 0))[:10].replace("未知", "nodate")
    slug = slugify(work.get("title") or work["work_id"])
    return root / f"{date}_{slug}"
