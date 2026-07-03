use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use anyhow::{anyhow, bail, Context};

fn main() -> anyhow::Result<()> {
    let password = std::env::args()
        .nth(1)
        .context("usage: cargo run -p bookflow-app --bin hash_password -- '<password>'")?;
    if password.chars().count() < 6 {
        bail!("password must be at least 6 characters")
    }
    let salt = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes())
        .map_err(|e| anyhow!("failed to build argon2 salt: {e}"))?;
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow!("failed to hash password: {e}"))?;
    println!("{hash}");
    Ok(())
}
