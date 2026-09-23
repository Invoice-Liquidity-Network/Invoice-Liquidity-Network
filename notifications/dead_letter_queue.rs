// Dead‑letter queue for permanently‑failing notification channels
// This module provides a simple persistent storage for notification failures
// that exceed the retry limit. It is used by the notifications service to
// record failures and expose them for later inspection or replay.

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeadLetterEntry {
    pub id: u64,                 // unique identifier
    pub channel: String,         // e.g. "webhook", "email"
    pub recipient: String,       // target identifier
    pub payload: String,         // original notification payload (JSON)
    pub error_message: String,   // final error after retries
    pub timestamp: u64,          // unix epoch seconds when recorded
}

pub struct DeadLetterQueue {
    path: PathBuf,
}

impl DeadLetterQueue {
    /// Create a new queue pointing at ``path``. The file is created if missing.
    pub fn new<P: Into<PathBuf>>(path: P) -> io::Result<Self> {
        let p = path.into();
        if !p.exists() {
            // ensure the directory exists
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent)?;
            }
            // start with an empty JSON array
            fs::write(&p, "[]")?;
        }
        Ok(Self { path: p })
    }

    /// Append a new entry to the dead‑letter store.
    pub fn push(&self, entry: DeadLetterEntry) -> io::Result<()> {
        let mut entries: Vec<DeadLetterEntry> = self.read_all()?;
        entries.push(entry);
        let json = serde_json::to_string_pretty(&entries)?;
        let mut file = OpenOptions::new().write(true).truncate(true).open(&self.path)?;
        file.write_all(json.as_bytes())?;
        Ok(())
    }

    /// Load all stored entries.
    pub fn read_all(&self) -> io::Result<Vec<DeadLetterEntry>> {
        let data = fs::read_to_string(&self.path)?;
        let entries: Vec<DeadLetterEntry> = serde_json::from_str(&data).unwrap_or_default();
        Ok(entries)
    }
}

// Example usage (to be called from the notification dispatcher):
// let dlq = DeadLetterQueue::new("./dead_letter.json")?;
// dlq.push(DeadLetterEntry { id: 1, channel: "webhook".into(), recipient: "user123".into(), payload: json_payload, error_message: err.to_string(), timestamp: now() })?;
