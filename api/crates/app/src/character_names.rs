use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterNameCandidate {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterReplacementPreviewItem {
    pub scope: String,
    pub label: String,
    pub hits: usize,
    pub before_excerpt: String,
    pub after_excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterReplacementPreview {
    pub old_name: String,
    pub new_name: String,
    pub items: Vec<CharacterReplacementPreviewItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalCharacterRenameRecommendation {
    pub old_name: String,
    pub recommended_name: String,
    pub reason: String,
}

pub fn extract_candidate_names(markdown: &str) -> Vec<CharacterNameCandidate> {
    let mut out = BTreeSet::new();
    for line in markdown.lines() {
        let clean = clean_markdown_line(line);
        if let Some(name) = extract_name_from_heading(&clean) {
            out.insert(name);
        }
        if let Some(name) = extract_name_from_labeled_line(&clean) {
            out.insert(name);
        }
        for name in extract_relation_names(&clean) {
            out.insert(name);
        }
    }
    out.into_iter()
        .map(|name| CharacterNameCandidate { name })
        .collect()
}

pub fn apply_exact_replacement(content: &str, old_name: &str, new_name: &str) -> Option<String> {
    if old_name.trim().is_empty() || new_name.trim().is_empty() || old_name == new_name {
        return None;
    }
    if !content.contains(old_name) {
        return None;
    }
    Some(content.replace(old_name, new_name))
}

pub fn build_preview_item(
    scope: &str,
    label: &str,
    content: &str,
    old_name: &str,
    new_name: &str,
) -> Option<CharacterReplacementPreviewItem> {
    let replaced = apply_exact_replacement(content, old_name, new_name)?;
    let hits = content.matches(old_name).count();
    let before_excerpt = content
        .lines()
        .find(|line| line.contains(old_name))
        .unwrap_or(content)
        .trim()
        .to_string();
    let after_excerpt = replaced
        .lines()
        .find(|line| line.contains(new_name))
        .unwrap_or(&replaced)
        .trim()
        .to_string();
    Some(CharacterReplacementPreviewItem {
        scope: scope.to_string(),
        label: label.to_string(),
        hits,
        before_excerpt,
        after_excerpt,
    })
}

pub fn fallback_recommended_name(track: &str, old_name: &str) -> String {
    let options = if track.contains("古言") {
        ["姜栖月", "谢听岚", "温照雪", "宋挽禾", "陆惊棠"]
    } else if track.contains("悬疑") || track.contains("规则") {
        ["林折夏", "周既安", "程见鹿", "许照微", "苏闻星"]
    } else {
        ["林晚晴", "周既白", "许昭宁", "江听禾", "陈砚秋"]
    };
    options
        .into_iter()
        .find(|candidate| *candidate != old_name)
        .unwrap_or("林晚晴")
        .to_string()
}

pub fn local_recommended_name(track: &str, old_name: &str) -> LocalCharacterRenameRecommendation {
    let primary = track_primary(track);
    let plots = track_plots(track);
    let family = track_name_family(&primary, &plots);
    let recommended_name = deterministic_name(track, old_name, family);
    let plot_label = if plots.is_empty() {
        "默认情节".to_string()
    } else {
        plots.join(" / ")
    };
    LocalCharacterRenameRecommendation {
        old_name: old_name.to_string(),
        recommended_name,
        reason: format!("按主分类“{primary}”和情节分类“{plot_label}”本地生成，无需远程 AI。"),
    }
}

fn clean_markdown_line(line: &str) -> String {
    line.trim()
        .trim_start_matches('#')
        .trim_start_matches('-')
        .trim_start_matches('*')
        .trim()
        .replace("**", "")
}

fn track_primary(track: &str) -> String {
    let normalized = track.trim();
    if normalized.is_empty() {
        return "婚姻家庭".to_string();
    }
    let pair_separators = ["·", " / ", "/", "-", "｜", "|"];
    for separator in pair_separators {
        if let Some(idx) = normalized.find(separator) {
            if idx > 0 {
                let primary = normalized[..idx].trim();
                if !primary.is_empty() {
                    return primary.to_string();
                }
            }
        }
    }
    match normalized {
        "现言婚恋火葬场" => "婚姻家庭".to_string(),
        "古言重生打脸" => "历史古代".to_string(),
        "古言替嫁冲喜" => "古言甜宠".to_string(),
        "悬疑规则怪谈" => "悬疑惊悚".to_string(),
        _ => normalized.to_string(),
    }
}

fn track_plots(track: &str) -> Vec<String> {
    let normalized = track.trim();
    if normalized.is_empty() {
        return vec!["追妻火葬场".to_string()];
    }
    let pair_separators = ["·", " / ", "/", "-", "｜", "|"];
    for separator in pair_separators {
        if let Some(idx) = normalized.find(separator) {
            if idx > 0 {
                let plots = normalized[idx + separator.len()..]
                    .split('/')
                    .map(|item| item.trim())
                    .filter(|item| !item.is_empty())
                    .map(|item| item.to_string())
                    .collect::<Vec<_>>();
                if !plots.is_empty() {
                    return plots;
                }
            }
        }
    }
    match normalized {
        "现言婚恋火葬场" => vec!["追妻火葬场".to_string()],
        "古言重生打脸" => vec!["重生".to_string()],
        "古言替嫁冲喜" => vec!["先婚后爱".to_string()],
        "悬疑规则怪谈" => vec!["规则怪谈".to_string()],
        _ => vec!["追妻火葬场".to_string()],
    }
}

type NameFamily = (&'static [&'static str], &'static [&'static str]);

fn track_name_family(primary: &str, plots: &[String]) -> NameFamily {
    let plot_text = plots.join("/");
    if primary.contains("悬疑")
        || plot_text.contains("规则怪谈")
        || plot_text.contains("推理")
        || plot_text.contains("无限流")
    {
        return (
            &["林", "周", "程", "许", "苏", "沈"],
            &["折夏", "既安", "见鹿", "照微", "闻星", "知序"],
        );
    }
    if primary.contains("古")
        || primary.contains("宫斗")
        || primary.contains("历史")
        || plot_text.contains("权谋")
        || plot_text.contains("重生")
    {
        return (
            &["姜", "谢", "温", "宋", "陆", "顾"],
            &["栖月", "听岚", "照雪", "挽禾", "惊棠", "书意"],
        );
    }
    if primary.contains("女性成长") || primary.contains("女生生活") || plot_text.contains("大女主") {
        return (
            &["江", "许", "乔", "沈", "陈", "林"],
            &["听禾", "昭宁", "予安", "知意", "砚秋", "晚晴"],
        );
    }
    (
        &["林", "周", "许", "江", "陈", "沈"],
        &["晚晴", "既白", "昭宁", "听禾", "砚秋", "知微"],
    )
}

fn deterministic_name(track: &str, old_name: &str, family: NameFamily) -> String {
    let (surnames, givens) = family;
    let mut seed: usize = 0;
    for ch in track.chars().chain(old_name.chars()) {
        seed = seed.wrapping_mul(131).wrapping_add(ch as usize);
    }
    for offset in 0..(surnames.len() * givens.len()).max(1) {
        let surname = surnames[(seed + offset) % surnames.len()];
        let given = givens[((seed / surnames.len()).wrapping_add(offset)) % givens.len()];
        let candidate = format!("{surname}{given}");
        if candidate != old_name {
            return candidate;
        }
    }
    fallback_recommended_name(track, old_name)
}

fn extract_name_from_labeled_line(line: &str) -> Option<String> {
    let (label, value) = line.split_once('：').or_else(|| line.split_once(':'))?;
    if !looks_like_role_label(label) {
        return None;
    }
    first_cjk_name_token(value)
}

fn extract_name_from_heading(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let rest = trimmed
        .trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.' || ch.is_whitespace())
        .trim();
    let name = first_cjk_name_token(rest)?;
    if looks_like_name(&name) {
        Some(name)
    } else {
        None
    }
}

fn extract_relation_names(line: &str) -> Vec<String> {
    collect_cjk_name_runs(line)
}

fn looks_like_role_label(label: &str) -> bool {
    [
        "角色名",
        "姓名",
        "主视角人物",
        "主视角角色",
        "女主",
        "男主",
        "反派",
        "白月光",
        "前夫",
        "前妻",
        "丈夫",
        "妻子",
        "闺蜜",
        "朋友",
        "母亲",
        "父亲",
        "兄长",
        "姐姐",
        "妹妹",
        "女配",
        "男配",
    ]
    .iter()
    .any(|keyword| label.contains(keyword))
}

fn first_cjk_name_token(value: &str) -> Option<String> {
    collect_cjk_name_runs(value).into_iter().next()
}

fn collect_cjk_name_runs(value: &str) -> Vec<String> {
    let mut current = String::new();
    let mut out = Vec::new();
    for ch in value.chars() {
        if is_cjk(ch) {
            current.push(ch);
            continue;
        }
        if looks_like_name(&current) {
            out.push(current.clone());
        }
        current.clear();
    }
    if looks_like_name(&current) {
        out.push(current);
    }
    out.into_iter().fold(Vec::<String>::new(), |mut acc, name| {
        if !acc.contains(&name) {
            acc.push(name);
        }
        acc
    })
}

fn looks_like_name(value: &str) -> bool {
    let len = value.chars().count();
    (2..=4).contains(&len)
        && ![
            "女主",
            "男主",
            "反派",
            "闺蜜",
            "丈夫",
            "妻子",
            "母亲",
            "父亲",
            "兄长",
            "姐姐",
            "妹妹",
            "女配",
            "男配",
            "角色总表",
            "关系图",
            "故事主视角",
            "感情线",
            "成长弧线",
            "命名约束",
            "正文硬约束",
            "外形记忆点",
            "人设标签",
            "核心欲望",
            "最大恐惧",
            "说话方式",
            "初始立场",
            "后期变化",
            "利益关系",
            "情感关系",
            "冲突关系",
            "依赖关系",
            "白月光",
            "前任",
            "家庭",
            "主视角",
            "叙事重心",
            "视角类型",
            "视角使用原则",
        ]
        .contains(&value)
}

fn is_cjk(ch: char) -> bool {
    matches!(ch as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_candidate_names_from_role_lines_and_relation_lines() {
        let text = r#"
## 角色总表
- 女主：林晚晴（律师）
- 男主：周既白，冷面总裁
- 闺蜜：许昭宁

## 关系图
林晚晴 ↔ 周既白：利益拉扯
"#;
        let names = extract_candidate_names(text)
            .into_iter()
            .map(|item| item.name)
            .collect::<Vec<_>>();
        assert!(names.contains(&"林晚晴".to_string()));
        assert!(names.contains(&"周既白".to_string()));
        assert!(names.contains(&"许昭宁".to_string()));
    }

    #[test]
    fn preview_item_replaces_name_and_counts_hits() {
        let item = build_preview_item(
            "artifact",
            "发布稿",
            "# 第一章\n沈知微推门进来。\n---\n沈知微没有回头。",
            "沈知微",
            "林晚晴",
        )
        .unwrap();
        assert_eq!(item.hits, 2);
        assert!(item.before_excerpt.contains("沈知微"));
        assert!(item.after_excerpt.contains("林晚晴"));
    }

    #[test]
    fn extracts_names_from_richer_character_setup_layouts() {
        let text = r#"
### 二、角色总表
- 角色名：沈知微
- 身份 / 年龄段：28 岁律师
- 角色名：顾承砚

### 三、关系图
- 沈知微 ↔ 顾承砚：先婚后爱 / 互相试探
- 沈知微 ↔ 林晚棠：旧怨未了
"#;
        let names = extract_candidate_names(text)
            .into_iter()
            .map(|item| item.name)
            .collect::<Vec<_>>();
        assert!(names.contains(&"沈知微".to_string()));
        assert!(names.contains(&"顾承砚".to_string()));
        assert!(names.contains(&"林晚棠".to_string()));
    }

    #[test]
    fn extracts_names_from_real_heading_and_viewpoint_patterns() {
        let text = r#"
### 1. 沈知微
- **主视角人物：沈知微**
- 顾承泽视角仅用于：
- 林晚意不作为核心主视角人物
### 2. 顾承泽
"#;
        let names = extract_candidate_names(text)
            .into_iter()
            .map(|item| item.name)
            .collect::<Vec<_>>();
        assert!(names.contains(&"沈知微".to_string()));
        assert!(names.contains(&"顾承泽".to_string()));
        assert!(!names.contains(&"主视角".to_string()));
        assert!(!names.contains(&"女主".to_string()));
    }

    #[test]
    fn fallback_recommendation_never_returns_same_name() {
        let recommended = fallback_recommended_name("现言婚恋火葬场", "林晚晴");
        assert_ne!(recommended, "林晚晴");
    }

    #[test]
    fn local_recommendation_uses_track_categories_without_ai() {
        let recommendation = local_recommended_name("悬疑惊悚·规则怪谈/推理", "陆承川");
        assert_eq!(recommendation.old_name, "陆承川");
        assert_ne!(recommendation.recommended_name, "陆承川");
        assert!(recommendation.reason.contains("悬疑惊悚"));
        assert!(recommendation.reason.contains("规则怪谈 / 推理"));
    }

    #[test]
    fn local_recommendation_handles_legacy_track_aliases() {
        let recommendation = local_recommended_name("古言重生打脸", "沈栀宁");
        assert_ne!(recommendation.recommended_name, "沈栀宁");
        assert!(recommendation.reason.contains("历史古代"));
        assert!(recommendation.reason.contains("重生"));
    }
}
