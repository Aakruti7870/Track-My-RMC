use crate::{error::AppError, middleware::auth::AuthUser};

pub fn check_role(user: &AuthUser, allowed_roles: &[&str]) -> Result<(), AppError> {
    if allowed_roles.contains(&user.role.as_str()) {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!(
            "Role '{}' is not authorized to access this resource",
            user.role
        )))
    }
}
