//! Safe conditional automation policy. Unlike generic workflow scripting,
//! this DSL is bounded, typed and can only inspect an authorized order.
//! No arbitrary SQL, external URLs, expressions or code execution.
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct OrderConditions {
    pub min_quantity_m3: Option<f64>,
    pub max_quantity_m3: Option<f64>,
    pub grade_in: Vec<String>,
}

impl OrderConditions {
    pub fn validate(&self) -> Result<(), &'static str> {
        for quantity in [self.min_quantity_m3, self.max_quantity_m3]
            .into_iter()
            .flatten()
        {
            if !quantity.is_finite() || !(0.0..=100_000.0).contains(&quantity) {
                return Err("Quantity conditions must be finite and within 0..100000 m3");
            }
        }
        if self
            .min_quantity_m3
            .zip(self.max_quantity_m3)
            .is_some_and(|(min, max)| min > max)
        {
            return Err("Minimum quantity cannot exceed maximum quantity");
        }
        if self.grade_in.len() > 16 {
            return Err("At most 16 grades may be selected");
        }
        for grade in &self.grade_in {
            let normalized = grade.trim();
            if normalized.is_empty()
                || normalized.len() > 24
                || !normalized
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-')
            {
                return Err("Grades must contain 1..24 ASCII letters, numbers or hyphens");
            }
        }
        Ok(())
    }

    pub fn matches(&self, grade: &str, quantity_m3: f64) -> bool {
        if !quantity_m3.is_finite() {
            return false;
        }
        if self.min_quantity_m3.is_some_and(|min| quantity_m3 < min)
            || self.max_quantity_m3.is_some_and(|max| quantity_m3 > max)
        {
            return false;
        }
        self.grade_in.is_empty()
            || self
                .grade_in
                .iter()
                .any(|allowed| allowed.trim().eq_ignore_ascii_case(grade))
    }

    /// Locks the order row for a consistent decision during job execution.
    /// A missing/cross-plant order fails closed.
    pub async fn matches_order(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        order: Uuid,
        plant: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let record: Option<(String, f64)> = sqlx::query_as(
            "SELECT concrete_grade,total_quantity_m3::DOUBLE PRECISION
             FROM orders WHERE id=$1 AND plant_id=$2 FOR SHARE",
        )
        .bind(order)
        .bind(plant)
        .fetch_optional(&mut **tx)
        .await?;
        Ok(record.is_some_and(|(grade, quantity)| self.matches(&grade, quantity)))
    }
}

#[cfg(test)]
mod tests {
    use super::OrderConditions;

    #[test]
    fn allowlisted_conditions_enforce_numeric_and_grade_bounds() {
        let policy = OrderConditions {
            min_quantity_m3: Some(6.0),
            max_quantity_m3: Some(20.0),
            grade_in: vec!["M25".into(), "M-30".into()],
        };
        assert!(policy.validate().is_ok());
        assert!(policy.matches("m25", 10.0));
        assert!(!policy.matches("M20", 10.0));
        assert!(!policy.matches("M25", 21.0));
        assert!(OrderConditions {
            min_quantity_m3: Some(50.0),
            max_quantity_m3: Some(10.0),
            ..Default::default()
        }
        .validate()
        .is_err());
        assert!(OrderConditions {
            grade_in: vec!["M25; DROP TABLE orders".into()],
            ..Default::default()
        }
        .validate()
        .is_err());
    }

    #[test]
    fn unknown_fields_are_rejected() {
        assert!(serde_json::from_str::<OrderConditions>(
            r#"{"http_request":"https://example.com"}"#
        )
        .is_err());
    }
}
