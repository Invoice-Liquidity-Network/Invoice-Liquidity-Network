// Degraded‑mode contract for the oracle‑service
// This module defines the behavior of the oracle when it becomes fully unavailable.
// The contract is intentionally simple: downstream consumers receive a stale
// response with a `degraded` flag and optional cached data.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DegradedResponse<T> {
    /// Indicates that the service is operating in degraded mode.
    pub degraded: bool,
    /// Optional cached data that may be stale.
    pub cached: Option<T>,
    /// Reason why the service is degraded (e.g., "unavailable", "timeout").
    pub reason: String,
}

impl<T> DegradedResponse<T> {
    /// Create a new degraded response with no cached data.
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            degraded: true,
            cached: None,
            reason: reason.into(),
        }
    }

    /// Create a degraded response that includes cached data.
    pub fn with_cache(cached: T, reason: impl Into<String>) -> Self {
        Self {
            degraded: true,
            cached: Some(cached),
            reason: reason.into(),
        }
    }
}

// Example usage inside the oracle service handler (pseudo‑code):
// if service_unavailable() {
//     return HttpResponse::Ok().json(DegradedResponse::<Price>::new("oracle unavailable"));
// }
