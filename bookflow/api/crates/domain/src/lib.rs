use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// 评分维度，对齐 bookflow-prototype/seed-scorecard.html 的 7 个 slider
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Dimension {
    Title,    // 标题张力
    Opening,  // 开篇钩子
    Slap,     // 打脸力度
    Emotion,  // 情绪饱和度
    Twist,    // 反转锐度
    Hook,     // 章末钩子
    Finish,   // 结局解恨度
}

/// 立项段位（≥28 立项 / 23-27 备选 / <23 不做），对齐 SOP.md
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Greenlight, // ≥ 28
    Backlog,    // 23-27
    Reject,     // < 23
}

impl Tier {
    pub const GREENLIGHT_THRESHOLD: i32 = 28;
    pub const BACKLOG_THRESHOLD: i32 = 23;

    pub fn from_total(total: i32) -> Self {
        if total >= Self::GREENLIGHT_THRESHOLD {
            Tier::Greenlight
        } else if total >= Self::BACKLOG_THRESHOLD {
            Tier::Backlog
        } else {
            Tier::Reject
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Score {
    pub title: i16,
    pub opening: i16,
    pub slap: i16,
    pub emotion: i16,
    pub twist: i16,
    pub hook: i16,
    pub finish: i16,
}

impl Score {
    pub fn total(&self) -> i32 {
        self.title as i32
            + self.opening as i32
            + self.slap as i32
            + self.emotion as i32
            + self.twist as i32
            + self.hook as i32
            + self.finish as i32
    }

    /// 每维 1-5，超出范围拒收
    pub fn validate(&self) -> Result<(), DomainError> {
        let dims = [
            ("title", self.title),
            ("opening", self.opening),
            ("slap", self.slap),
            ("emotion", self.emotion),
            ("twist", self.twist),
            ("hook", self.hook),
            ("finish", self.finish),
        ];
        for (name, v) in dims {
            if !(1..=5).contains(&v) {
                return Err(DomainError::ScoreOutOfRange {
                    dim: name.into(),
                    value: v,
                });
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Seed {
    pub id: Uuid,
    pub title: String,
    pub track: String,
    pub score: Score,
    pub total_score: i32,
    pub tier: Tier,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewSeed {
    pub title: String,
    pub track: String,
    pub score: Score,
}

impl NewSeed {
    /// 标题 ≤ 25 字（按 char 数，对齐原型 maxlength=25），track 非空
    pub fn validate(&self) -> Result<(), DomainError> {
        let n = self.title.chars().count();
        if !(1..=25).contains(&n) {
            return Err(DomainError::TitleLength { len: n });
        }
        if self.track.trim().is_empty() {
            return Err(DomainError::EmptyTrack);
        }
        self.score.validate()?;
        Ok(())
    }
}

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DomainError {
    #[error("title length {len} not in 1..=25")]
    TitleLength { len: usize },
    #[error("track is empty")]
    EmptyTrack,
    #[error("score {dim} = {value} out of 1..=5")]
    ScoreOutOfRange { dim: String, value: i16 },
    #[error("invalid status transition {from} → {to}")]
    BadTransition { from: String, to: String },
}

/// 项目状态机：seed 立项 → writing → ready（待发）→ published → archived。
/// 不支持回退、不支持跨级跳转。归档可从任何已发后状态回到 archived
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Writing,
    Ready,
    Published,
    Archived,
}

impl ProjectStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProjectStatus::Writing => "writing",
            ProjectStatus::Ready => "ready",
            ProjectStatus::Published => "published",
            ProjectStatus::Archived => "archived",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "writing" => ProjectStatus::Writing,
            "ready" => ProjectStatus::Ready,
            "published" => ProjectStatus::Published,
            "archived" => ProjectStatus::Archived,
            _ => return None,
        })
    }

    /// 默认推进：写作→待发→已发→归档
    pub fn next(&self) -> Option<Self> {
        match self {
            ProjectStatus::Writing => Some(ProjectStatus::Ready),
            ProjectStatus::Ready => Some(ProjectStatus::Published),
            ProjectStatus::Published => Some(ProjectStatus::Archived),
            ProjectStatus::Archived => None,
        }
    }

    pub fn validate_transition(from: Self, to: Self) -> Result<(), DomainError> {
        if from.next() == Some(to) {
            Ok(())
        } else {
            Err(DomainError::BadTransition {
                from: from.as_str().into(),
                to: to.as_str().into(),
            })
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: Uuid,
    pub seed_id: Uuid,
    pub title: String,
    pub track: String,
    pub status: ProjectStatus,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ReviewStage {
    #[serde(rename = "24h")]
    H24,
    #[serde(rename = "72h")]
    H72,
    #[serde(rename = "7d")]
    D7,
}

impl ReviewStage {
    pub fn as_str(self) -> &'static str {
        match self {
            ReviewStage::H24 => "24h",
            ReviewStage::H72 => "72h",
            ReviewStage::D7 => "7d",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "24h" => Some(Self::H24),
            "72h" => Some(Self::H72),
            "7d" => Some(Self::D7),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ReviewResult {
    #[serde(rename = "爆")]
    Explode,
    #[serde(rename = "平")]
    Flat,
    #[serde(rename = "扑")]
    Flop,
}

impl ReviewResult {
    pub fn as_str(self) -> &'static str {
        match self {
            ReviewResult::Explode => "爆",
            ReviewResult::Flat => "平",
            ReviewResult::Flop => "扑",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "爆" => Some(Self::Explode),
            "平" => Some(Self::Flat),
            "扑" => Some(Self::Flop),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectReview {
    pub id: Uuid,
    pub project_id: Uuid,
    pub stage: ReviewStage,
    pub published_at: chrono::DateTime<chrono::Utc>,
    pub data_recorded: bool,
    pub read_count: Option<i64>,
    pub completion_rate: Option<f64>,
    pub engagement_count: Option<i64>,
    pub overall_result: Option<ReviewResult>,
    pub title_result: Option<String>,
    pub hook_result: Option<String>,
    pub emotion_result: Option<String>,
    pub success_reason: Option<String>,
    pub failure_reason: Option<String>,
    pub continue_track: Option<String>,
    pub reusable_conclusion: Option<String>,
    pub next_action: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingProjectReview {
    pub project_id: Uuid,
    pub title: String,
    pub status: ProjectStatus,
    pub stage: ReviewStage,
    pub published_at: chrono::DateTime<chrono::Utc>,
    pub track: String,
    pub total_words: i64,
    pub data_recorded: bool,
    pub last_review_result: Option<ReviewResult>,
}

/// 章节段落 beat：AI 拆出来的小节点，由前端可重排
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Beat {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chapter {
    pub id: Uuid,
    pub project_id: Uuid,
    pub idx: i16,
    pub title: String,
    pub beats: Vec<Beat>,
    pub body: String,
    pub word_count: i32,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// 字数计算：按 unicode char 数，跟前端 textarea 显示口径一致
pub fn count_chars(s: &str) -> i32 {
    s.chars().count() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_thresholds() {
        assert_eq!(Tier::from_total(35), Tier::Greenlight);
        assert_eq!(Tier::from_total(28), Tier::Greenlight);
        assert_eq!(Tier::from_total(27), Tier::Backlog);
        assert_eq!(Tier::from_total(23), Tier::Backlog);
        assert_eq!(Tier::from_total(22), Tier::Reject);
        assert_eq!(Tier::from_total(7), Tier::Reject);
    }

    #[test]
    fn score_validate_range() {
        let mut s = Score { title: 5, opening: 5, slap: 5, emotion: 5, twist: 5, hook: 5, finish: 5 };
        assert!(s.validate().is_ok());
        s.title = 0;
        assert!(s.validate().is_err());
        s.title = 6;
        assert!(s.validate().is_err());
    }

    #[test]
    fn new_seed_validates_title_length() {
        let mut ns = NewSeed {
            title: "婚礼彩排那天伴娘群里弹出他和伴娘的开房记录".into(), // 21 字
            track: "现言婚恋火葬场".into(),
            score: Score { title: 5, opening: 5, slap: 5, emotion: 4, twist: 4, hook: 5, finish: 5 },
        };
        assert!(ns.validate().is_ok());
        // 26 字超
        ns.title = "婚礼彩排那天伴娘群里弹出他和伴娘的开房记录还多写一字".into();
        assert!(matches!(ns.validate(), Err(DomainError::TitleLength { .. })));
    }

    #[test]
    fn review_result_values_are_stable() {
        assert_eq!(ReviewResult::Explode.as_str(), "爆");
        assert_eq!(ReviewResult::Flat.as_str(), "平");
        assert_eq!(ReviewResult::Flop.as_str(), "扑");
    }
}
