use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::config::AppConfig;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttemptTokenClaims {
    pub token_id: String,
    pub user_id: String,
    pub schedule_id: String,
    pub attempt_id: String,
    pub client_session_id: String,
    pub exp: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttemptTokenError {
    Invalid,
    Expired,
}

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
}

pub fn verify_password(password: &str, password_hash: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(password_hash) else {
        return false;
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

pub fn random_token(byte_len: usize) -> String {
    let mut bytes = vec![0_u8; byte_len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

pub fn normalize_user_agent(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sha256_hex)
}

pub fn session_idle_timeout(
    role: &ielts_backend_domain::auth::UserRole,
    config: &AppConfig,
) -> Duration {
    match role {
        ielts_backend_domain::auth::UserRole::Student => {
            Duration::minutes(config.session_idle_timeout_student_minutes)
        }
        _ => Duration::minutes(config.session_idle_timeout_staff_minutes),
    }
}

pub fn session_expiry(
    role: &ielts_backend_domain::auth::UserRole,
    config: &AppConfig,
) -> (DateTime<Utc>, DateTime<Utc>) {
    let now = Utc::now();
    (
        now + Duration::hours(config.session_absolute_lifetime_hours),
        now + session_idle_timeout(role, config),
    )
}

pub fn sign_attempt_token(config: &AppConfig, claims: &AttemptTokenClaims) -> String {
    let payload = serde_json::to_vec(claims).expect("serialize attempt token");
    let encoded_payload = URL_SAFE_NO_PAD.encode(payload);
    let mut mac =
        HmacSha256::new_from_slice(config.auth_secret.as_bytes()).expect("static HMAC key");
    mac.update(encoded_payload.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    format!("{encoded_payload}.{signature}")
}

pub fn verify_attempt_token(
    config: &AppConfig,
    token: &str,
) -> Result<AttemptTokenClaims, AttemptTokenError> {
    let Some((encoded_payload, encoded_signature)) = token.split_once('.') else {
        return Err(AttemptTokenError::Invalid);
    };

    let mut mac =
        HmacSha256::new_from_slice(config.auth_secret.as_bytes()).expect("static HMAC key");
    mac.update(encoded_payload.as_bytes());
    let expected_signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    if expected_signature
        .as_bytes()
        .ct_eq(encoded_signature.as_bytes())
        .unwrap_u8()
        != 1
    {
        return Err(AttemptTokenError::Invalid);
    }

    let payload = URL_SAFE_NO_PAD
        .decode(encoded_payload)
        .map_err(|_| AttemptTokenError::Invalid)?;
    let claims: AttemptTokenClaims =
        serde_json::from_slice(&payload).map_err(|_| AttemptTokenError::Invalid)?;
    if claims.exp <= Utc::now() {
        return Err(AttemptTokenError::Expired);
    }

    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::{sign_attempt_token, verify_attempt_token, AttemptTokenClaims, AttemptTokenError};
    use crate::config::AppConfig;
    use chrono::{Duration, Utc};

    #[test]
    fn rejects_expired_attempt_tokens() {
        let config = AppConfig::default();
        let now = Utc::now();
        let claims = AttemptTokenClaims {
            token_id: "token-1".to_owned(),
            user_id: "user-1".to_owned(),
            schedule_id: "schedule-1".to_owned(),
            attempt_id: "attempt-1".to_owned(),
            client_session_id: "client-1".to_owned(),
            exp: now - Duration::seconds(1),
        };

        let token = sign_attempt_token(&config, &claims);
        assert_eq!(
            verify_attempt_token(&config, &token),
            Err(AttemptTokenError::Expired)
        );
    }
}
