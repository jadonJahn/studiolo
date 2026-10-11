//! SQLite mirror of the app's data. The webview owns the live state; it pushes
//! snapshots here so the data survives webview storage resets and can be served
//! to other machines (see api.rs).

use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use std::path::Path;

const SCHEMA: &str = include_str!("schema.sql");

#[derive(Deserialize)]
pub struct SessionRow {
    id: String,
    kind: String,
    mode: String,
    activity_id: Option<String>,
    activity_name: Option<String>,
    task_id: Option<String>,
    task_title: Option<String>,
    intent: Option<String>,
    started_at: i64,
    ended_at: i64,
    day: String,
    duration_min: f64,
    planned_min: f64,
    completed: bool,
    art_style: Option<String>,
}

#[derive(Deserialize)]
pub struct TaskRow {
    id: String,
    title: String,
    activity_id: Option<String>,
    activity_name: Option<String>,
    estimate: i64,
    done: bool,
    created_at: i64,
    done_at: Option<i64>,
    spent_min: f64,
}

#[derive(Deserialize)]
pub struct ActivityRow {
    id: String,
    name: String,
    emoji: String,
    color: String,
    archived: bool,
}

#[derive(Deserialize)]
pub struct Snapshot {
    raw: String,
    settings: serde_json::Value,
    sessions: Vec<SessionRow>,
    tasks: Vec<TaskRow>,
    activities: Vec<ActivityRow>,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=OFF;")?;
    c.execute_batch(SCHEMA)?;
    Ok(c)
}

pub fn write_snapshot(c: &mut Connection, s: &Snapshot) -> rusqlite::Result<()> {
    let tx = c.transaction()?;
    tx.execute("DELETE FROM sessions", [])?;
    tx.execute("DELETE FROM tasks", [])?;
    tx.execute("DELETE FROM activities", [])?;
    {
        let mut st = tx.prepare(
            "INSERT INTO sessions (id, kind, mode, activity_id, activity_name, task_id, task_title, intent,
               started_at, ended_at, day, duration_min, planned_min, completed, art_style)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )?;
        for r in &s.sessions {
            st.execute(params![
                r.id, r.kind, r.mode, r.activity_id, r.activity_name, r.task_id, r.task_title, r.intent,
                r.started_at, r.ended_at, r.day, r.duration_min, r.planned_min, r.completed, r.art_style
            ])?;
        }
        let mut st = tx.prepare(
            "INSERT INTO tasks (id, title, activity_id, activity_name, estimate, done, created_at, done_at, spent_min)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        for r in &s.tasks {
            st.execute(params![
                r.id, r.title, r.activity_id, r.activity_name, r.estimate, r.done, r.created_at, r.done_at, r.spent_min
            ])?;
        }
        let mut st = tx.prepare("INSERT INTO activities (id, name, emoji, color, archived) VALUES (?1, ?2, ?3, ?4, ?5)")?;
        for r in &s.activities {
            st.execute(params![r.id, r.name, r.emoji, r.color, r.archived])?;
        }
    }
    kv_set(&tx, "snapshot", &s.raw)?;
    kv_set(&tx, "settings", &s.settings.to_string())?;
    tx.commit()
}

pub fn kv_set(c: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now_ms()],
    )?;
    Ok(())
}

pub fn kv_get(c: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    c.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional()
}
