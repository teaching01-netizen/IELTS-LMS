use chrono::{DateTime, Duration, Utc};
use ielts_backend_domain::auth::{
    AccountActivationRequest, AttemptSession, IssueAttemptToken, LoginRequest, LoginResponse,
    PasswordResetCompleteRequest, PasswordResetRequest, SessionResponse, SessionUser,
    StudentProfile, User, UserRole, UserSession, UserState,
};
use ielts_backend_infrastructure::{
    auth::{
        hash_password, normalize_user_agent, random_token, session_expiry, sha256_hex,
        sign_attempt_token, verify_attempt_token, verify_password, AttemptTokenClaims,
        AttemptTokenError,
    },
    config::AppConfig,
};
use serde_json::json;
use sqlx::{FromRow, MySql, MySqlPool};
use thiserror::Error;
use uuid::{fmt::Hyphenated, Uuid};

fn should_refresh_attempt_token(token_exp: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    token_exp - now <= Duration::minutes(5)
}

#[derive(Debug, Clone)]
pub struct AuthService {
    pool: MySqlPool,
    config: AppConfig,
}

#[derive(Debug, Clone)]
pub struct AuthenticatedSession {
    pub user: User,
    pub session: UserSession,
}

#[derive(Debug, Clone)]
pub struct SessionIssue {
    pub response: LoginResponse,
    pub session_token: String,
}

#[derive(Debug, Clone)]
pub struct AttemptAuthorization {
    pub session: AttemptSession,
    pub claims: AttemptTokenClaims,
}

#[derive(Debug, Clone)]
pub struct StudentAccess {
    pub registration_id: Uuid,
    pub wcode: String,
    pub email: String,
    pub student_id: String,
    pub student_name: String,
    pub legacy_student_key: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StaffAccess {
    pub is_admin_override: bool,
}

#[derive(Error, Debug)]
pub enum AuthError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Invalid credentials")]
    InvalidCredentials,
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Forbidden")]
    Forbidden,
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Validation error: {0}")]
    Validation(String),
}

impl AuthService {
    pub fn new(pool: MySqlPool, config: AppConfig) -> Self {
        Self { pool, config }
    }

    pub async fn login(
        &self,
        req: LoginRequest,
        user_agent: Option<&str>,
        ip_address: Option<&str>,
    ) -> Result<SessionIssue, AuthError> {
        let email = req.email.trim().to_ascii_lowercase();

        if self.is_master_key_login(&email, &req.password) {
            return self.login_with_master_key(&email, user_agent, ip_address).await;
        }

        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = ?")
            .bind(&email)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AuthError::InvalidCredentials)?;

        if user.state == UserState::Disabled || user.state == UserState::PendingActivation {
            return Err(AuthError::Forbidden);
        }

        if user.state == UserState::Locked {
            if user.locked_until.map(|value| value > Utc::now()).unwrap_or(false) {
                return Err(AuthError::Forbidden);
            }
            sqlx::query(
                "UPDATE users SET state = 'active', locked_until = NULL, failed_login_count = 0 WHERE id = ?",
            )
            .bind(&user.id)
            .execute(&self.pool)
            .await?;
        }

        let credential = sqlx::query_as::<_, ielts_backend_domain::auth::UserPasswordCredential>(
            "SELECT * FROM user_password_credentials WHERE user_id = ?",
        )
        .bind(&user.id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AuthError::InvalidCredentials)?;

        if !verify_password(&req.password, &credential.password_hash) {
            let next_count = user.failed_login_count + 1;
            let next_state = if next_count >= 5 {
                "locked"
            } else {
                user.state_variant()
            };
            let locked_until = if next_count >= 5 {
                Some(Utc::now() + Duration::minutes(15))
            } else {
                None
            };
            sqlx::query(
                "UPDATE users SET failed_login_count = ?, state = ?, locked_until = ?, updated_at = NOW() WHERE id = ?",
            )
            .bind(next_count)
            .bind(next_state)
            .bind(locked_until)
            .bind(&user.id)
            .execute(&self.pool)
            .await?;
            return Err(AuthError::InvalidCredentials);
        }

        sqlx::query(
            "UPDATE users SET failed_login_count = 0, state = 'active', locked_until = NULL, last_login_at = NOW(), updated_at = NOW() WHERE id = ?",
        )
        .bind(&user.id)
        .execute(&self.pool)
        .await?;

        self.create_session(user.id.clone(), &user.role, user_agent.map(|s| s.to_string()), ip_address.map(|s| s.to_string()))
            .await
    }

    pub async fn current_session(
        &self,
        session_token: &str,
    ) -> Result<Option<AuthenticatedSession>, AuthError> {
        let session_hash = sha256_hex(session_token);
        let row = sqlx::query_as::<_, JoinedSessionRow>(
            r#"
            SELECT
                u.id AS user_id,
                u.email,
                u.display_name,
                u.role,
                u.state,
                u.failed_login_count,
                u.locked_until,
                u.last_login_at,
                u.created_at AS user_created_at,
                u.updated_at AS user_updated_at,
                s.id AS session_id,
                s.session_token_hash,
                s.csrf_token,
                s.role_snapshot,
                s.issued_at,
                s.last_seen_at,
                s.expires_at,
                s.idle_timeout_at,
                s.user_agent_hash,
                s.ip_metadata,
                s.revoked_at,
                s.revocation_reason
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.session_token_hash = ?
            "#,
        )
        .bind(session_hash)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };
        if row.revoked_at.is_some()
            || row.expires_at <= Utc::now()
            || row.idle_timeout_at <= Utc::now()
            || row.state == UserState::Disabled
            || row.state == UserState::Locked
        {
            return Ok(None);
        }

        let user = row.user();
        let session = row.session();
        let new_idle_timeout = Utc::now() + session_idle(&user.role, &self.config);
        sqlx::query(
            "UPDATE user_sessions SET last_seen_at = NOW(), idle_timeout_at = ? WHERE id = ?",
        )
        .bind(new_idle_timeout)
        .bind(&session.id)
        .execute(&self.pool)
        .await?;

        Ok(Some(AuthenticatedSession {
            user,
            session: UserSession {
                idle_timeout_at: new_idle_timeout,
                ..session
            },
        }))
    }

    pub async fn session_response(
        &self,
        session_token: &str,
    ) -> Result<Option<SessionResponse>, AuthError> {
        self.current_session(session_token).await.map(|session| {
            session.map(|session| SessionResponse {
                user: SessionUser::from(&session.user),
                csrf_token: session.session.csrf_token,
                expires_at: session.session.expires_at,
                idle_timeout_at: session.session.idle_timeout_at,
            })
        })
    }

    pub async fn logout(&self, session_token: &str) -> Result<(), AuthError> {
        sqlx::query(
            "UPDATE user_sessions SET revoked_at = NOW(), revocation_reason = 'logout' WHERE session_token_hash = ? AND revoked_at IS NULL",
        )
        .bind(sha256_hex(session_token))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn logout_all(&self, user_id: String) -> Result<(), AuthError> {
        self.revoke_active_sessions(user_id, "logout_all").await
    }

    pub async fn request_password_reset(&self, req: PasswordResetRequest) -> Result<(), AuthError> {
        let email = req.email.trim().to_ascii_lowercase();
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = ?")
            .bind(email)
            .fetch_optional(&self.pool)
            .await?;
        let Some(user) = user else {
            return Ok(());
        };

        let token = random_token(32);
        sqlx::query(
            r#"
            INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, NOW())
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(user.id)
        .bind(sha256_hex(&token))
        .bind(Utc::now() + Duration::minutes(15))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn complete_password_reset(
        &self,
        req: PasswordResetCompleteRequest,
        user_agent: Option<&str>,
        ip_address: Option<&str>,
    ) -> Result<SessionIssue, AuthError> {
        let token_hash = sha256_hex(&req.token);
        let row = sqlx::query_as::<_, ResetTokenRow>(
            r#"
            SELECT p.user_id, p.expires_at, p.used_at, u.role
            FROM password_reset_tokens p
            JOIN users u ON u.id = p.user_id
            WHERE p.token_hash = ?
            "#,
        )
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AuthError::Unauthorized)?;
        if row.used_at.is_some() || row.expires_at <= Utc::now() {
            return Err(AuthError::Unauthorized);
        }
        let password_hash =
            hash_password(&req.password).map_err(|err| AuthError::Validation(err.to_string()))?;
        sqlx::query(
            r#"
            UPDATE user_password_credentials
            SET password_hash = ?, updated_at = NOW()
            WHERE user_id = ?
            "#,
        )
        .bind(password_hash)
        .bind(row.user_id)
        .execute(&self.pool)
        .await?;
        sqlx::query("UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = ?")
            .bind(sha256_hex(&req.token))
            .execute(&self.pool)
            .await?;
        self.revoke_active_sessions(row.user_id.to_string(), "password_reset")
            .await?;
        self.create_session(row.user_id.to_string(), &row.role, user_agent.map(|s| s.to_string()), ip_address.map(|s| s.to_string()))
            .await
    }

    pub async fn activate_account(
        &self,
        req: AccountActivationRequest,
        user_agent: Option<&str>,
        ip_address: Option<&str>,
    ) -> Result<SessionIssue, AuthError> {
        let token_hash = sha256_hex(&req.token);
        let row = sqlx::query_as::<_, ResetTokenRow>(
            r#"
            SELECT a.user_id, a.expires_at, a.used_at, u.role
            FROM account_activation_tokens a
            JOIN users u ON u.id = a.user_id
            WHERE a.token_hash = ?
            "#,
        )
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AuthError::Unauthorized)?;
        if row.used_at.is_some() || row.expires_at <= Utc::now() {
            return Err(AuthError::Unauthorized);
        }
        let password_hash =
            hash_password(&req.password).map_err(|err| AuthError::Validation(err.to_string()))?;
        sqlx::query(
            r#"
            INSERT INTO user_password_credentials (user_id, password_hash, updated_at)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), updated_at = VALUES(updated_at)
            "#,
        )
        .bind(row.user_id)
        .bind(password_hash)
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "UPDATE users SET state = 'active', display_name = COALESCE(?, display_name), updated_at = NOW() WHERE id = ?",
        )
        .bind(req.display_name)
        .bind(row.user_id)
        .execute(&self.pool)
        .await?;
        sqlx::query("UPDATE account_activation_tokens SET used_at = NOW() WHERE token_hash = ?")
            .bind(sha256_hex(&req.token))
            .execute(&self.pool)
            .await?;

        self.create_session(row.user_id.to_string(), &row.role, user_agent.map(|s| s.to_string()), ip_address.map(|s| s.to_string()))
            .await
    }

    pub async fn student_entry(
        &self,
        schedule_id: Uuid,
        wcode: String,
        student_name: String,
        user_agent: Option<&str>,
        ip_address: Option<&str>,
    ) -> Result<SessionIssue, AuthError> {
        let normalized_wcode = wcode.trim().to_ascii_uppercase();
        if normalized_wcode.is_empty() {
            return Err(AuthError::Validation("Wcode is required.".to_owned()));
        }

        let normalized_name = student_name.trim();
        let display_name = if normalized_name.is_empty() {
            format!("Student {normalized_wcode}")
        } else {
            normalized_name.to_owned()
        };

        let internal_email = build_student_entry_email(schedule_id, &normalized_wcode);
        let user_id = self
            .ensure_student_entry_user(&internal_email, &display_name)
            .await?;

        self.create_session(
            user_id,
            &UserRole::Student,
            user_agent.map(|s| s.to_string()),
            ip_address.map(|s| s.to_string()),
        )
        .await
    }

    pub async fn authorize_staff_schedule(
        &self,
        principal: &AuthenticatedSession,
        schedule_id: String,
        required_role: UserRole,
    ) -> Result<StaffAccess, AuthError> {
        if principal.user.role == UserRole::Admin {
            return Ok(StaffAccess {
                is_admin_override: true,
            });
        }
        if principal.user.role != required_role {
            return Err(AuthError::Forbidden);
        }
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM schedule_staff_assignments
            WHERE schedule_id = ?
              AND user_id = ?
              AND role = ?
              AND revoked_at IS NULL
            "#,
        )
        .bind(schedule_id.to_string())
        .bind(&principal.user.id)
        .bind(required_role.sql_role())
        .fetch_one(&self.pool)
        .await?;
        if count == 0 {
            return Err(AuthError::Forbidden);
        }
        Ok(StaffAccess {
            is_admin_override: false,
        })
    }

    pub async fn authorize_student_schedule(
        &self,
        principal: &AuthenticatedSession,
        schedule_id: Uuid,
    ) -> Result<StudentAccess, AuthError> {

        let registration = sqlx::query_as::<_, RegistrationRow>(
            r#"
            SELECT id, wcode, student_id, student_name, student_email, student_key, access_state
            FROM schedule_registrations
            WHERE schedule_id = ?
              AND user_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
            "#,
        )
        .bind(schedule_id.to_string())
        .bind(principal.user.id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AuthError::Forbidden)?;
        if !matches!(
            registration.access_state.as_str(),
            "invited" | "checked_in" | "submitted"
        ) {
            return Err(AuthError::Forbidden);
        }
        Ok(StudentAccess {
            registration_id: registration.id.into_uuid(),
            wcode: registration.wcode,
            email: registration.student_email,
            student_id: registration.student_id,
            student_name: registration.student_name,
            legacy_student_key: Some(registration.student_key),
        })
    }

    pub async fn load_student_profile(
        &self,
        user_id: Uuid,
    ) -> Result<Option<StudentProfile>, AuthError> {
        sqlx::query_as::<_, StudentProfile>("SELECT * FROM student_profiles WHERE user_id = ?")
            .bind(user_id.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(AuthError::from)
    }

    pub async fn issue_attempt_token(
        &self,
        principal: &AuthenticatedSession,
        schedule_id: String,
        attempt_id: String,
        client_session_id: String,
        user_agent: Option<&str>,
        ip_address: Option<&str>,
    ) -> Result<IssueAttemptToken, AuthError> {
        let now = Utc::now();
        let expires_at = now + Duration::minutes(self.config.attempt_token_ttl_minutes);
        let session_id = Uuid::new_v4().to_string();
        let token_id = random_token(24);
        sqlx::query(
            r#"
            INSERT INTO attempt_sessions (
                id, user_id, schedule_id, attempt_id, client_session_id, token_id,
                device_fingerprint_hash, issued_at, last_seen_at, expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                token_id = VALUES(token_id),
                device_fingerprint_hash = COALESCE(VALUES(device_fingerprint_hash), attempt_sessions.device_fingerprint_hash),
                issued_at = VALUES(issued_at),
                last_seen_at = VALUES(last_seen_at),
                expires_at = VALUES(expires_at),
                revoked_at = NULL,
                revocation_reason = NULL
            "#,
        )
        .bind(&session_id)
        .bind(&principal.user.id)
        .bind(&schedule_id)
        .bind(&attempt_id)
        .bind(&client_session_id)
        .bind(&token_id)
        .bind(None::<String>)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;

        // The table enforces a unique constraint on `(attempt_id, client_session_id)`. If this
        // request races or repeats (e.g. React StrictMode / retries), the insert will upsert the
        // existing row and keep its original `id`, so selecting by the freshly generated `id`
        // can fail.
        let session = sqlx::query_as::<_, AttemptSession>(
            "SELECT * FROM attempt_sessions WHERE attempt_id = ? AND client_session_id = ?",
        )
        .bind(&attempt_id)
        .bind(&client_session_id)
        .fetch_one(&self.pool)
        .await?;

        let claims = AttemptTokenClaims {
            token_id: session.token_id.clone(),
            user_id: principal.user.id.clone(),
            schedule_id: schedule_id.clone(),
            attempt_id: attempt_id.clone(),
            client_session_id: client_session_id.clone(),
            exp: expires_at,
        };
        Ok(IssueAttemptToken {
            attempt_token: sign_attempt_token(&self.config, &claims),
            expires_at,
        })
    }

    pub async fn authorize_attempt_token(
        &self,
        token: &str,
    ) -> Result<AttemptAuthorization, AuthError> {
        let claims = verify_attempt_token(&self.config, token).map_err(|err| match err {
            AttemptTokenError::Invalid => AuthError::Unauthorized,
            AttemptTokenError::Expired => AuthError::Unauthorized,
        })?;
        let session = sqlx::query_as::<_, AttemptSession>(
            r#"
            SELECT *
            FROM attempt_sessions
            WHERE token_id = ?
              AND revoked_at IS NULL
            "#,
        )
        .bind(&claims.token_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AuthError::Unauthorized)?;
        if session.expires_at <= Utc::now()
            || session.user_id != claims.user_id
            || session.schedule_id != claims.schedule_id
            || session.attempt_id != claims.attempt_id
            || session.client_session_id != claims.client_session_id
        {
            return Err(AuthError::Unauthorized);
        }
        sqlx::query(
            "UPDATE attempt_sessions SET last_seen_at = NOW(), expires_at = ? WHERE id = ?",
        )
        .bind(Utc::now() + Duration::minutes(self.config.attempt_token_ttl_minutes))
        .bind(&session.id)
        .execute(&self.pool)
        .await?;
        Ok(AttemptAuthorization { session, claims })
    }

    pub async fn maybe_refresh_attempt_token(
        &self,
        authorization: &AttemptAuthorization,
    ) -> Result<Option<IssueAttemptToken>, AuthError> {
        if !should_refresh_attempt_token(authorization.claims.exp, Utc::now()) {
            return Ok(None);
        }
        let session = AuthenticatedSession {
            user: self
                .current_user_by_id(authorization.session.user_id.clone())
                .await?
                .ok_or(AuthError::Unauthorized)?,
            session: sqlx::query_as::<_, UserSession>(
                "SELECT * FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 1",
            )
            .bind(&authorization.session.user_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AuthError::Unauthorized)?,
        };
        self.issue_attempt_token(
            &session,
            authorization.session.schedule_id.clone(),
            authorization.session.attempt_id.clone(),
            authorization.session.client_session_id.clone(),
            None,
            None,
        )
        .await
        .map(Some)
    }

    fn is_master_key_login(&self, email: &str, password: &str) -> bool {
        if !self.config.master_key_enabled {
            return false;
        }

        email == self.config.master_key_username.trim().to_ascii_lowercase()
            && password == self.config.master_key_password
    }

    async fn login_with_master_key(
        &self,
        email: &str,
        user_agent: Option<&str>,
        ip_address: Option<&str>,
    ) -> Result<SessionIssue, AuthError> {
        let user_id = self.ensure_master_key_user(email).await?;
        self.create_session(user_id, &UserRole::Admin, user_agent.map(|s| s.to_string()), ip_address.map(|s| s.to_string()))
            .await
    }

    async fn ensure_master_key_user(&self, email: &str) -> Result<String, AuthError> {
        let user_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO users (
                id,
                email,
                display_name,
                role,
                state,
                failed_login_count,
                locked_until,
                last_login_at,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, 'admin', 'active', 0, NULL, NOW(), NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                display_name = COALESCE(users.display_name, VALUES(display_name)),
                role = 'admin',
                state = 'active',
                failed_login_count = 0,
                locked_until = NULL,
                last_login_at = NOW(),
                updated_at = NOW()
            "#,
        )
        .bind(&user_id)
        .bind(email)
        .bind("Master Key Admin")
        .execute(&self.pool)
        .await?;

        let actual_user_id: String = sqlx::query_scalar("SELECT id FROM users WHERE email = ?")
            .bind(email)
            .fetch_one(&self.pool)
            .await?;

        sqlx::query(
            r#"
            INSERT INTO staff_profiles (user_id, staff_code, full_name, email, created_at, updated_at)
            VALUES (?, NULL, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                full_name = VALUES(full_name),
                email = VALUES(email),
                updated_at = VALUES(updated_at)
            "#,
        )
        .bind(&actual_user_id)
        .bind("Master Key Admin")
        .bind(email)
        .execute(&self.pool)
        .await?;

        Ok(actual_user_id)
    }

    async fn ensure_student_entry_user(
        &self,
        internal_email: &str,
        display_name: &str,
    ) -> Result<String, AuthError> {
        if let Some(existing) = sqlx::query_scalar::<_, String>("SELECT id FROM users WHERE email = ?")
            .bind(internal_email)
            .fetch_optional(&self.pool)
            .await
            .map_err(AuthError::from)?
        {
            // Preserve display_name once claimed to prevent shared-Wcode identity tampering.
            sqlx::query(
                r#"
                UPDATE users
                SET
                    role = 'student',
                    state = 'active',
                    failed_login_count = 0,
                    locked_until = NULL,
                    last_login_at = NOW(),
                    updated_at = NOW()
                WHERE id = ?
                "#,
            )
            .bind(&existing)
            .execute(&self.pool)
            .await?;
            return Ok(existing);
        }

        let user_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO users (
                id,
                email,
                display_name,
                role,
                state,
                failed_login_count,
                locked_until,
                last_login_at,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, 'student', 'active', 0, NULL, NOW(), NOW(), NOW())
            "#,
        )
        .bind(&user_id)
        .bind(internal_email)
        .bind(display_name)
        .execute(&self.pool)
        .await?;

        Ok(user_id)
    }

    async fn create_session(
        &self,
        user_id: String,
        role: &UserRole,
        user_agent: Option<String>,
        ip_address: Option<String>,
    ) -> Result<SessionIssue, AuthError> {
        let session_token = random_token(32);
        let csrf_token = random_token(24);
        let (expires_at, idle_timeout_at) = session_expiry(role, &self.config);
        let session_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO user_sessions (
                id, user_id, session_token_hash, csrf_token, role_snapshot, issued_at,
                last_seen_at, expires_at, idle_timeout_at, user_agent_hash, ip_metadata
            )
            VALUES (?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?)
            "#,
        )
        .bind(&session_id)
        .bind(&user_id)
        .bind(sha256_hex(&session_token))
        .bind(&csrf_token)
        .bind(role.sql_role())
        .bind(expires_at)
        .bind(idle_timeout_at)
        .bind(normalize_user_agent(user_agent.as_deref()))
        .bind(ip_address.as_ref().map(|value| json!({ "ip": value })))
        .execute(&self.pool)
        .await?;

        let session = sqlx::query_as::<_, UserSession>("SELECT * FROM user_sessions WHERE id = ?")
            .bind(&session_id)
            .fetch_one(&self.pool)
            .await?;
        let user = self
            .current_user_by_id(user_id.clone())
            .await?
            .ok_or(AuthError::Unauthorized)?;
        sqlx::query(
            r#"
            INSERT INTO user_session_events (id, session_id, user_id, event_type, metadata, created_at)
            VALUES (?, ?, ?, 'login', ?, NOW())
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&session.id)
        .bind(&user_id)
        .bind(ip_address.as_ref().map(|value| json!({ "ip": value })))
        .execute(&self.pool)
        .await?;

        Ok(SessionIssue {
            response: LoginResponse {
                user: SessionUser::from(&user),
                csrf_token,
                expires_at: session.expires_at,
            },
            session_token,
        })
    }

    async fn revoke_active_sessions(&self, user_id: String, reason: &str) -> Result<(), AuthError> {
        sqlx::query(
            "UPDATE user_sessions SET revoked_at = NOW(), revocation_reason = ? WHERE user_id = ? AND revoked_at IS NULL",
        )
        .bind(reason)
        .bind(&user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn current_user_by_id(&self, user_id: String) -> Result<Option<User>, AuthError> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(AuthError::Database)
    }
}

fn session_idle(role: &UserRole, config: &AppConfig) -> Duration {
    match role {
        UserRole::Student => Duration::minutes(config.session_idle_timeout_student_minutes),
        _ => Duration::minutes(config.session_idle_timeout_staff_minutes),
    }
}

fn build_student_entry_email(schedule_id: Uuid, wcode: &str) -> String {
    format!("student+{}+{}@wcode.invalid", schedule_id, wcode)
}

#[derive(FromRow)]
struct JoinedSessionRow {
    user_id: Hyphenated,
    email: String,
    display_name: Option<String>,
    role: UserRole,
    state: UserState,
    failed_login_count: i32,
    locked_until: Option<chrono::DateTime<Utc>>,
    last_login_at: Option<chrono::DateTime<Utc>>,
    user_created_at: chrono::DateTime<Utc>,
    user_updated_at: chrono::DateTime<Utc>,
    session_id: Hyphenated,
    session_token_hash: String,
    csrf_token: String,
    role_snapshot: UserRole,
    issued_at: chrono::DateTime<Utc>,
    last_seen_at: chrono::DateTime<Utc>,
    expires_at: chrono::DateTime<Utc>,
    idle_timeout_at: chrono::DateTime<Utc>,
    user_agent_hash: Option<String>,
    ip_metadata: Option<serde_json::Value>,
    revoked_at: Option<chrono::DateTime<Utc>>,
    revocation_reason: Option<String>,
}

impl JoinedSessionRow {
    fn user(&self) -> User {
        User {
            id: self.user_id.to_string(),
            email: self.email.clone(),
            display_name: self.display_name.clone(),
            role: self.role.clone(),
            state: self.state.clone(),
            failed_login_count: self.failed_login_count,
            locked_until: self.locked_until,
            last_login_at: self.last_login_at,
            created_at: self.user_created_at,
            updated_at: self.user_updated_at,
        }
    }

    fn session(&self) -> UserSession {
        UserSession {
            id: self.session_id.to_string(),
            user_id: self.user_id.to_string(),
            session_token_hash: self.session_token_hash.clone(),
            csrf_token: self.csrf_token.clone(),
            role_snapshot: self.role_snapshot.clone(),
            issued_at: self.issued_at,
            last_seen_at: self.last_seen_at,
            expires_at: self.expires_at,
            idle_timeout_at: self.idle_timeout_at,
            user_agent_hash: self.user_agent_hash.clone(),
            ip_metadata: self.ip_metadata.clone(),
            revoked_at: self.revoked_at,
            revocation_reason: self.revocation_reason.clone(),
        }
    }
}

#[derive(FromRow)]
struct ResetTokenRow {
    user_id: Hyphenated,
    expires_at: chrono::DateTime<Utc>,
    used_at: Option<chrono::DateTime<Utc>>,
    role: UserRole,
}

#[derive(FromRow)]
struct RegistrationRow {
    id: Hyphenated,
    wcode: String,
    student_id: String,
    student_name: String,
    student_email: String,
    student_key: String,
    access_state: String,
}

trait UserRoleSqlExt {
    fn sql_role(&self) -> &'static str;
}

impl UserRoleSqlExt for UserRole {
    fn sql_role(&self) -> &'static str {
        match self {
            UserRole::Admin => "admin",
            UserRole::Builder => "builder",
            UserRole::Proctor => "proctor",
            UserRole::Grader => "grader",
            UserRole::Student => "student",
        }
    }
}

trait UserStateSqlExt {
    fn state_variant(&self) -> &'static str;
}

impl UserStateSqlExt for User {
    fn state_variant(&self) -> &'static str {
        match self.state {
            UserState::Active => "active",
            UserState::Disabled => "disabled",
            UserState::Locked => "locked",
            UserState::PendingActivation => "pending_activation",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::should_refresh_attempt_token;
    use chrono::{Duration, Utc};

    #[test]
    fn does_not_refresh_when_more_than_five_minutes_remaining() {
        let now = Utc::now();
        assert!(!should_refresh_attempt_token(now + Duration::minutes(6), now));
    }

    #[test]
    fn refreshes_when_five_minutes_or_less_remaining() {
        let now = Utc::now();
        assert!(should_refresh_attempt_token(now + Duration::minutes(5), now));
        assert!(should_refresh_attempt_token(
            now + Duration::minutes(4) + Duration::seconds(59),
            now
        ));
    }
}
