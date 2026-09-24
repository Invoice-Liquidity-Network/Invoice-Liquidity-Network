// Placeholder for latency SLO instrumentation in `oracle-service`
// The intention is to record per‑stage latency (fetch, aggregate, publish)
// and expose Prometheus metrics for dashboards.

use prometheus::{HistogramVec, opts, register_histogram_vec};

lazy_static::lazy_static! {
    pub static ref LATENCY_HISTOGRAM: HistogramVec = register_histogram_vec!(
        opts!("oracle_service_latency_seconds", "Latency of oracle service stages"),
        &["stage"]
    ).unwrap();
}

pub fn record_latency(stage: &str, seconds: f64) {
    LATENCY_HISTOGRAM.with_label_values(&[stage]).observe(seconds);
}

// Example usage in the service code (pseudo):
// let start = Instant::now();
// // fetch price
// let elapsed = start.elapsed().as_secs_f64();
// record_latency("fetch", elapsed);
