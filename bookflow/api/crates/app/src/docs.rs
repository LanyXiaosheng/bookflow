use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DocItem {
    /// 文件名（不含 .md）
    pub slug: String,
    /// h1 / 文件名作为标题
    pub title: String,
    /// 前 80 字摘要
    pub summary: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocFull {
    pub slug: String,
    pub title: String,
    pub body: String,
}

#[derive(Clone)]
pub struct DocRoot {
    root: PathBuf,
}

impl DocRoot {
    /// 从 cwd 往上找直到找到 candidate 目录（如 "tracks"）；找不到则用 candidate 字面量
    pub fn discover(candidate: &str) -> Self {
        let mut cur = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        for _ in 0..6 {
            let p = cur.join(candidate);
            if p.is_dir() {
                return Self { root: p };
            }
            if !cur.pop() {
                break;
            }
        }
        Self {
            root: PathBuf::from(candidate),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn list(&self) -> Result<Vec<DocItem>> {
        if !self.root.is_dir() {
            return Ok(vec![]);
        }
        let mut items = Vec::new();
        for entry in std::fs::read_dir(&self.root)
            .with_context(|| format!("读目录失败：{}", self.root.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let slug = path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or_else(|| anyhow!("非法文件名 {:?}", path))?
                .to_string();
            let body = std::fs::read_to_string(&path)
                .with_context(|| format!("读文件失败：{}", path.display()))?;
            let title = extract_title(&body).unwrap_or_else(|| slug.clone());
            let summary = extract_summary(&body);
            let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            items.push(DocItem {
                slug,
                title,
                summary,
                bytes,
            });
        }
        items.sort_by(|a, b| a.slug.cmp(&b.slug));
        Ok(items)
    }

    pub fn read_one(&self, slug: &str) -> Result<DocFull> {
        // 防路径穿越
        if slug.contains('/') || slug.contains('\\') || slug.contains("..") || slug.is_empty() {
            return Err(anyhow!("非法 slug：{slug}"));
        }
        let path = self.root.join(format!("{slug}.md"));
        if !path.is_file() {
            return Err(anyhow!("找不到文档：{slug}"));
        }
        let body = std::fs::read_to_string(&path)
            .with_context(|| format!("读文件失败：{}", path.display()))?;
        let title = extract_title(&body).unwrap_or_else(|| slug.to_string());
        Ok(DocFull {
            slug: slug.to_string(),
            title,
            body,
        })
    }
}

fn extract_title(body: &str) -> Option<String> {
    for line in body.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("# ") {
            return Some(rest.trim().to_string());
        }
    }
    None
}

fn extract_summary(body: &str) -> String {
    let mut chars = String::new();
    for line in body.lines() {
        let l = line.trim();
        if l.is_empty() || l.starts_with('#') || l.starts_with("```") {
            continue;
        }
        for c in l.chars() {
            if chars.chars().count() >= 80 {
                break;
            }
            chars.push(c);
        }
        if chars.chars().count() >= 80 {
            break;
        }
        chars.push(' ');
    }
    chars.trim().to_string()
}
