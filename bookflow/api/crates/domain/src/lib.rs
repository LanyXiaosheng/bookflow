use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

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
}
