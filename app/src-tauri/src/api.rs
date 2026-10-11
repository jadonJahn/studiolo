//! Read-only HTTP API over the SQLite mirror, bound to loopback. Off unless the
//! user turns it on; useful for automations, or for sharing with other machines
//! through a tunnel such as `tailscale serve`.

use crate::db::{kv_get, now_ms};
use chrono::{Duration, Local, NaiveDate, TimeZone};
use rusqlite::Connection;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Request, Response, Server};

type Resp = Response<Cursor<Vec<u8>>>;

/// A running server; stopping it frees the port.
pub struct Handle {
    server: Arc<Server>,
    pub port: u16,
}

impl Handle {
    pub fn stop(self) {
        // Ends the request loop, which drops the last reference and closes the socket.
        self.server.unblock();
    }
}

pub fn start(db: Arc<Mutex<Connection>>, data_dir: PathBuf, app_name: String, first_port: u16) -> Option<Handle> {
    for port in first_port..first_port + 10 {
        if let Ok(server) = Server::http(("127.0.0.1", port)) {
            let server = Arc::new(server);
            let worker = server.clone();
            std::thread::spawn(move || {
                for req in worker.incoming_requests() {
                    let resp = route(&req, &db, &data_dir, &app_name);
                    let _ = req.respond(resp);
                }
            });
            return Some(Handle { server, port });
        }
    }
    None
}

fn json_resp(code: u16, v: &Value) -> Resp {
    Response::from_data(serde_json::to_vec_pretty(v).unwrap_or_default())
        .with_status_code(code)
        .with_header(Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap())
        .with_header(Header::from_bytes("Cache-Control", "no-store").unwrap())
}

fn err(code: u16, msg: &str) -> Resp {
    json_resp(code, &json!({ "error": msg }))
}

fn query(url: &str) -> BTreeMap<String, String> {
    url.split_once('?')
        .map(|(_, q)| {
            q.split('&')
                .filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn route(req: &Request, db: &Arc<Mutex<Connection>>, dir: &PathBuf, app_name: &str) -> Resp {
    if *req.method() != Method::Get {
        return err(405, "read-only API: GET only");
    }
    let url = req.url().to_string();
    let path = url.split('?').next().unwrap_or("/").trim_end_matches('/');
    let q = query(&url);
    let Ok(conn) = db.lock() else { return err(500, "database lock poisoned") };
    let result = match path {
        "" | "/api" => Ok(index(app_name)),
        "/api/status" => status(&conn),
        "/api/summary" => summary(&conn, &q),
        "/api/sessions" => sessions(&conn, &q),
        "/api/tasks" => tasks(&conn, &q),
        "/api/activities" => activities(&conn),
        "/api/export" => export(&conn),
        "/flowstate.db" => return db_file(&conn, dir),
        _ => return err(404, "unknown endpoint; GET /api for the list"),
    };
    match result {
        Ok(v) => json_resp(200, &v),
        Err(e) => err(500, &e.to_string()),
    }
}

fn index(app_name: &str) -> Value {
    json!({
        "app": app_name,
        "description": format!("{app_name} focus timer. Read-only. Times are unix ms plus local ISO strings; durations are minutes."),
        "endpoints": {
            "GET /api/status": "Is a timer running right now, what for, time left; today's focus total vs daily goal; streak.",
            "GET /api/summary?days=7": "Per-day focus minutes split by activity, totals by activity, streaks, tasks completed. days 1-366.",
            "GET /api/sessions?days=7|since=YYYY-MM-DD&kind=focus|break|all&limit=200": "Individual sessions, newest first.",
            "GET /api/tasks?status=open|done|all": "Task list with estimates (focus blocks) and minutes spent.",
            "GET /api/activities": "Activity categories.",
            "GET /api/export": "Full app backup JSON (same format as in-app export).",
            "GET /flowstate.db": "Consistent SQLite snapshot of the whole database, for keeping a local copy."
        }
    })
}

fn today() -> NaiveDate {
    Local::now().date_naive()
}

fn local_iso(ms: i64) -> String {
    Local.timestamp_millis_opt(ms).single().map(|d| d.to_rfc3339()).unwrap_or_default()
}

fn day_start_ms(d: NaiveDate) -> i64 {
    d.and_hms_opt(0, 0, 0)
        .and_then(|dt| dt.and_local_timezone(Local).earliest())
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

fn settings(conn: &Connection) -> Value {
    kv_get(conn, "settings").ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)
}

fn streaks(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    let mut st = conn.prepare("SELECT DISTINCT day FROM sessions WHERE kind = 'focus' ORDER BY day")?;
    let days: Vec<NaiveDate> = st
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(|d| d.ok().and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok()))
        .collect();
    let (mut longest, mut run) = (0i64, 0i64);
    let mut prev: Option<NaiveDate> = None;
    for d in &days {
        run = if prev.map(|p| p + Duration::days(1) == *d).unwrap_or(false) { run + 1 } else { 1 };
        longest = longest.max(run);
        prev = Some(*d);
    }
    let set: std::collections::HashSet<_> = days.iter().copied().collect();
    let mut cur = today();
    if !set.contains(&cur) {
        cur -= Duration::days(1);
    }
    let mut current = 0;
    while set.contains(&cur) {
        current += 1;
        cur -= Duration::days(1);
    }
    Ok((current, longest.max(current)))
}

fn status(conn: &Connection) -> rusqlite::Result<Value> {
    let now = now_ms();
    let timer: Value = kv_get(conn, "timer")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    let timer_out = if timer.is_null() {
        Value::Null
    } else {
        let status = timer["status"].as_str().unwrap_or("idle");
        let acc = timer["accumulated_ms"].as_i64().unwrap_or(0);
        let run = timer["run_started_at"].as_i64();
        let target = timer["target_ms"].as_i64().unwrap_or(0);
        let elapsed = acc + if status == "running" { run.map(|r| now - r).unwrap_or(0) } else { 0 };
        let remaining = (target > 0).then(|| (target - elapsed).max(0));
        let mut m = timer.as_object().cloned().unwrap_or_default();
        m.insert("elapsed_min".into(), json!(elapsed as f64 / 60000.0));
        m.insert("remaining_min".into(), json!(remaining.map(|r| r as f64 / 60000.0)));
        m.insert(
            "ends_at".into(),
            json!((status == "running").then_some(remaining).flatten().map(|r| local_iso(now + r))),
        );
        Value::Object(m)
    };
    let (focus_min, n): (f64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(duration_min), 0), COUNT(*) FROM sessions WHERE kind = 'focus' AND day = ?1",
        [today().format("%Y-%m-%d").to_string()],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let (current, longest) = streaks(conn)?;
    let goal = settings(conn)["dailyGoalMin"].as_f64();
    Ok(json!({
        "now": local_iso(now),
        "timer": timer_out,
        "today": { "focus_min": focus_min.round(), "sessions": n, "goal_min": goal,
                   "goal_met": goal.map(|g| focus_min >= g) },
        "streak": { "current_days": current, "longest_days": longest }
    }))
}

fn summary(conn: &Connection, q: &BTreeMap<String, String>) -> rusqlite::Result<Value> {
    let days = q.get("days").and_then(|d| d.parse::<i64>().ok()).unwrap_or(7).clamp(1, 366);
    let from = today() - Duration::days(days - 1);
    let from_s = from.format("%Y-%m-%d").to_string();
    let mut st = conn.prepare(
        "SELECT day, COALESCE(activity_name, 'Other'), SUM(duration_min), COUNT(*)
         FROM sessions WHERE kind = 'focus' AND day >= ?1 GROUP BY day, activity_name ORDER BY day",
    )?;
    let mut per_day: BTreeMap<String, (f64, i64, Map<String, Value>)> = BTreeMap::new();
    let mut by_act: BTreeMap<String, f64> = BTreeMap::new();
    let rows = st.query_map([&from_s], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?, r.get::<_, i64>(3)?)))?;
    for row in rows {
        let (day, act, min, n) = row?;
        let e = per_day.entry(day).or_insert((0.0, 0, Map::new()));
        e.0 += min;
        e.1 += n;
        e.2.insert(act.clone(), json!(min.round()));
        *by_act.entry(act).or_default() += min;
    }
    let goal = settings(conn)["dailyGoalMin"].as_f64();
    let mut list = vec![];
    let mut d = from;
    while d <= today() {
        let k = d.format("%Y-%m-%d").to_string();
        let (min, n, acts) = per_day.remove(&k).unwrap_or((0.0, 0, Map::new()));
        list.push(json!({ "day": k, "focus_min": min.round(), "sessions": n, "by_activity": acts,
                          "goal_met": goal.map(|g| min >= g) }));
        d += Duration::days(1);
    }
    let total: f64 = by_act.values().fold(0.0, |a, b| a + b);
    let mut acts: Vec<_> = by_act.into_iter().collect();
    acts.sort_by(|a, b| b.1.total_cmp(&a.1));
    let tasks_done: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE done = 1 AND done_at >= ?1",
        [day_start_ms(from)],
        |r| r.get(0),
    )?;
    let (current, longest) = streaks(conn)?;
    Ok(json!({
        "from": from_s,
        "to": today().format("%Y-%m-%d").to_string(),
        "total_focus_min": total.round(),
        "avg_focus_min_per_day": (total / days as f64).round(),
        "by_activity": acts.into_iter().map(|(a, m)| json!({ "activity": a, "focus_min": m.round() })).collect::<Vec<_>>(),
        "tasks_completed": tasks_done,
        "streak": { "current_days": current, "longest_days": longest },
        "days": list
    }))
}

fn sessions(conn: &Connection, q: &BTreeMap<String, String>) -> rusqlite::Result<Value> {
    let from = q
        .get("since")
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| today() - Duration::days(q.get("days").and_then(|d| d.parse().ok()).unwrap_or(7i64).clamp(1, 3650) - 1));
    let kind = match q.get("kind").map(String::as_str) {
        Some("break") => "break",
        Some("all") => "%",
        _ => "focus",
    };
    let limit = q.get("limit").and_then(|l| l.parse::<i64>().ok()).unwrap_or(200).clamp(1, 5000);
    let mut st = conn.prepare(
        "SELECT id, kind, mode, activity_name, task_title, intent, started_at, ended_at, day, duration_min,
                planned_min, completed, art_style
         FROM sessions WHERE day >= ?1 AND kind LIKE ?2 ORDER BY started_at DESC LIMIT ?3",
    )?;
    let rows = st.query_map(rusqlite::params![from.format("%Y-%m-%d").to_string(), kind, limit], |r| {
        let started: i64 = r.get(6)?;
        let ended: i64 = r.get(7)?;
        Ok(json!({
            "id": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?, "mode": r.get::<_, String>(2)?,
            "activity": r.get::<_, Option<String>>(3)?, "task": r.get::<_, Option<String>>(4)?,
            "intent": r.get::<_, Option<String>>(5)?,
            "started_at": started, "started": local_iso(started), "ended_at": ended, "ended": local_iso(ended),
            "day": r.get::<_, String>(8)?, "duration_min": (r.get::<_, f64>(9)? * 10.0).round() / 10.0,
            "planned_min": r.get::<_, f64>(10)?, "completed": r.get::<_, bool>(11)?,
            "art_style": r.get::<_, Option<String>>(12)?
        }))
    })?;
    Ok(Value::Array(rows.collect::<rusqlite::Result<_>>()?))
}

fn tasks(conn: &Connection, q: &BTreeMap<String, String>) -> rusqlite::Result<Value> {
    let filter = match q.get("status").map(String::as_str) {
        Some("done") => "WHERE done = 1",
        Some("all") => "",
        _ => "WHERE done = 0",
    };
    let mut st = conn.prepare(&format!(
        "SELECT id, title, activity_name, estimate, done, created_at, done_at, spent_min FROM tasks {filter}
         ORDER BY done, created_at DESC"
    ))?;
    let rows = st.query_map([], |r| {
        let done_at: Option<i64> = r.get(6)?;
        Ok(json!({
            "id": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)?, "activity": r.get::<_, Option<String>>(2)?,
            "estimate_blocks": r.get::<_, i64>(3)?, "done": r.get::<_, bool>(4)?,
            "created": local_iso(r.get(5)?), "completed": done_at.map(local_iso),
            "spent_min": r.get::<_, f64>(7)?.round()
        }))
    })?;
    Ok(Value::Array(rows.collect::<rusqlite::Result<_>>()?))
}

fn activities(conn: &Connection) -> rusqlite::Result<Value> {
    let mut st = conn.prepare("SELECT id, name, emoji, color, archived FROM activities")?;
    let rows = st.query_map([], |r| {
        Ok(json!({ "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "emoji": r.get::<_, String>(2)?,
                   "color": r.get::<_, String>(3)?, "archived": r.get::<_, bool>(4)? }))
    })?;
    Ok(Value::Array(rows.collect::<rusqlite::Result<_>>()?))
}

fn export(conn: &Connection) -> rusqlite::Result<Value> {
    Ok(kv_get(conn, "snapshot")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null))
}

fn db_file(conn: &Connection, dir: &PathBuf) -> Resp {
    let tmp = dir.join(format!("export-{}.db", now_ms()));
    let res = conn
        .execute("VACUUM INTO ?1", [tmp.to_string_lossy().to_string()])
        .map_err(|e| e.to_string())
        .and_then(|_| std::fs::read(&tmp).map_err(|e| e.to_string()));
    let _ = std::fs::remove_file(&tmp);
    match res {
        Ok(bytes) => Response::from_data(bytes)
            .with_header(Header::from_bytes("Content-Type", "application/vnd.sqlite3").unwrap())
            .with_header(Header::from_bytes("Content-Disposition", "attachment; filename=\"flowstate.db\"").unwrap()),
        Err(e) => err(500, &e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn snapshot_round_trip_feeds_api() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("schema.sql")).unwrap();
        let today = Local::now().format("%Y-%m-%d").to_string();
        let now = now_ms();
        // Same shape the webview sends (src/lib/desktop.ts snapshot()).
        let payload = json!({
            "raw": "{\"version\":1}",
            "settings": { "dailyGoalMin": 60 },
            "sessions": [
                { "id": "a", "kind": "focus", "mode": "pomodoro", "activity_id": "study", "activity_name": "Study",
                  "task_id": null, "task_title": null, "intent": "ch 3", "started_at": now - 3_000_000, "ended_at": now - 1_500_000,
                  "day": today, "duration_min": 25.0, "planned_min": 25.0, "completed": true, "art_style": "flow" },
                { "id": "b", "kind": "focus", "mode": "stopwatch", "activity_id": "code", "activity_name": "Code",
                  "task_id": "t1", "task_title": "API", "intent": null, "started_at": now - 1_000_000, "ended_at": now,
                  "day": today, "duration_min": 40.0, "planned_min": 0.0, "completed": true, "art_style": null },
                { "id": "c", "kind": "break", "mode": "pomodoro", "activity_id": null, "activity_name": null,
                  "task_id": null, "task_title": null, "intent": null, "started_at": now, "ended_at": now,
                  "day": today, "duration_min": 5.0, "planned_min": 5.0, "completed": true, "art_style": null }
            ],
            "tasks": [{ "id": "t1", "title": "API", "activity_id": "code", "activity_name": "Code", "estimate": 2,
                        "done": true, "created_at": now - 9_000_000, "done_at": now, "spent_min": 40.0 }],
            "activities": [{ "id": "study", "name": "Study", "emoji": "📚", "color": "#fff", "archived": false }]
        });
        let snap: db::Snapshot = serde_json::from_value(payload).unwrap();
        db::write_snapshot(&mut c, &snap).unwrap();

        let st = status(&c).unwrap();
        assert_eq!(st["today"]["focus_min"], json!(65.0));
        assert_eq!(st["today"]["sessions"], json!(2));
        assert_eq!(st["today"]["goal_met"], json!(true));
        assert_eq!(st["streak"]["current_days"], json!(1));

        let sm = summary(&c, &BTreeMap::from([("days".into(), "7".into())])).unwrap();
        assert_eq!(sm["total_focus_min"], json!(65.0));
        assert_eq!(sm["by_activity"][0]["activity"], json!("Code"));
        assert_eq!(sm["tasks_completed"], json!(1));

        let ss = sessions(&c, &BTreeMap::from([("kind".into(), "all".into())])).unwrap();
        assert_eq!(ss.as_array().unwrap().len(), 3);
        let open = tasks(&c, &BTreeMap::new()).unwrap();
        assert_eq!(open.as_array().unwrap().len(), 0);

        // Empty DB shouldn't produce negative zero.
        let empty = Connection::open_in_memory().unwrap();
        empty.execute_batch(include_str!("schema.sql")).unwrap();
        assert_eq!(summary(&empty, &BTreeMap::new()).unwrap()["total_focus_min"].to_string(), "0.0");
    }
}
