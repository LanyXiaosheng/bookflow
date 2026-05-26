pub struct Config {
    pub database_url: String,
    pub llm_api_key: String,
    pub llm_model: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
            llm_api_key: std::env::var("LLM_API_KEY").unwrap_or_default(),
            llm_model: std::env::var("LLM_MODEL")
                .unwrap_or_else(|_| "claude-sonnet-4-6".to_string()),
        }
    }
}
