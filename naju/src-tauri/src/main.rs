#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

fn now_iso() -> String {
  // ISO simple sin dependencias extra pesadas
  let dt = chrono::Local::now();
  dt.to_rfc3339()
}

fn sanitize_filename(name: &str) -> String {
  let mut out = String::with_capacity(name.len());
  for c in name.chars() {
    let ok = c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' ' | '(' | ')' | '[' | ']');
    out.push(if ok { c } else { '_' });
  }
  out.trim().replace(' ', "_")
}

fn app_base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  // 1) Intento normal
  if let Some(mut dir) = tauri::api::path::app_data_dir(&app.config()) {
    dir.push("NAJU");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear base dir {:?}: {e}", dir))?;
    return Ok(dir);
  }

  // 2) Fallback: data_dir (Windows: AppData/Roaming)
  if let Some(mut dir) = tauri::api::path::data_dir() {
    dir.push("NAJU");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear base dir fallback {:?}: {e}", dir))?;
    return Ok(dir);
  }

  // 3) Último fallback: home_dir
  if let Some(mut dir) = tauri::api::path::home_dir() {
    dir.push("NAJU");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear base dir home {:?}: {e}", dir))?;
    return Ok(dir);
  }

  Err("No se pudo resolver ninguna carpeta de datos (app_data_dir/data_dir/home_dir)".to_string())
}

fn patients_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let mut d = app_base_dir(app)?;
  d.push("patients");
  fs::create_dir_all(&d).map_err(|e| format!("No se pudo crear patients dir: {e}"))?;
  Ok(d)
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let mut p = app_base_dir(app)?;
  p.push("naju.sqlite");
  Ok(p)
}

fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
  let p = db_path(app)?;
  let conn = Connection::open(p).map_err(|e| format!("DB open error: {e}"))?;

  conn.pragma_update(None, "foreign_keys", &"ON")
    .map_err(|e| format!("pragma foreign_keys failed: {e}"))?;

  ensure_schema(&conn).map_err(|e| format!("DB schema error: {e}"))?;
  Ok(conn)
}

fn table_columns(conn: &Connection, table: &str) -> Result<HashSet<String>, String> {
  let mut stmt = conn
    .prepare(&format!("PRAGMA table_info({})", table))
    .map_err(|e| format!("PRAGMA table_info error: {e}"))?;

  let rows = stmt
    .query_map([], |row| row.get::<_, String>(1))
    .map_err(|e| format!("query_map error: {e}"))?;

  let mut set = HashSet::new();
  for r in rows {
    let col = r.map_err(|e| format!("row error: {e}"))?;
    set.insert(col);
  }
  Ok(set)
}

fn add_column_if_missing(conn: &Connection, table: &str, col: &str, ddl: &str) -> Result<(), String> {
  let cols = table_columns(conn, table)?;
  if !cols.contains(col) {
    conn.execute(&format!("ALTER TABLE {} ADD COLUMN {} {}", table, col, ddl), [])
      .map_err(|e| format!("ALTER TABLE add {table}.{col} failed: {e}"))?;
  }
  Ok(())
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
  // 1) Crear tabla base si no existe
  conn.execute(
    r#"
    CREATE TABLE IF NOT EXISTS patients (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      sex         TEXT,
      emergency_contact TEXT,
      created_at  TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT ''
    );
    "#,
    [],
  ).map_err(|e| format!("CREATE TABLE patients failed: {e}"))?;

  // 2) Asegurar todas las columnas necesarias (migración incremental)
  add_column_if_missing(conn, "patients", "name", "TEXT NOT NULL DEFAULT ''")?;
  add_column_if_missing(conn, "patients", "doc_type", "TEXT")?;
  add_column_if_missing(conn, "patients", "doc_number", "TEXT")?;
  add_column_if_missing(conn, "patients", "insurer", "TEXT")?;
  add_column_if_missing(conn, "patients", "birth_date", "TEXT")?;
  add_column_if_missing(conn, "patients", "phone", "TEXT")?;
  add_column_if_missing(conn, "patients", "email", "TEXT")?;
  add_column_if_missing(conn, "patients", "address", "TEXT")?;
  add_column_if_missing(conn, "patients", "notes", "TEXT")?;
  add_column_if_missing(conn, "patients", "photo_path", "TEXT")?;
  add_column_if_missing(conn, "patients", "created_at", "TEXT NOT NULL DEFAULT ''")?;
  add_column_if_missing(conn, "patients", "updated_at", "TEXT NOT NULL DEFAULT ''")?;

  // 3) Migración de 'full_name' a 'name' si existe (para versiones viejas)
  let cols = table_columns(conn, "patients")?;
  if cols.contains("full_name") && cols.contains("name") {
    conn.execute(
      r#"UPDATE patients
         SET name = COALESCE(NULLIF(name,''), full_name)
         WHERE name IS NULL OR TRIM(name) = ''"#,
      [],
    ).map_err(|e| format!("migrate full_name -> name failed: {e}"))?;
  }

  // 4) Asegurar created_at/updated_at en datos viejos
  conn.execute(
    r#"UPDATE patients
       SET created_at = COALESCE(NULLIF(created_at, ''), datetime('now')),
           updated_at = COALESCE(NULLIF(updated_at, ''), datetime('now'))
       WHERE created_at IS NULL OR TRIM(created_at) = '' 
          OR updated_at IS NULL OR TRIM(updated_at) = ''"#,
    [],
  ).map_err(|e| format!("fill timestamps failed: {e}"))?;

  // 5) Tabla de archivos
  conn.execute(
    r#"
    CREATE TABLE IF NOT EXISTS files (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id      TEXT NOT NULL,
      kind            TEXT NOT NULL,
      filename        TEXT NOT NULL,
      stored_relpath  TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      meta_json       TEXT,
      FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );
    "#,
    [],
  ).map_err(|e| format!("CREATE TABLE files failed: {e}"))?;

  conn.execute("CREATE INDEX IF NOT EXISTS idx_files_patient ON files(patient_id);", []).ok();

  Ok(())
}

fn patient_folder(app: &tauri::AppHandle, patient_id: &str) -> Result<PathBuf, String> {
  let mut p = patients_dir(app)?;
  p.push(patient_id);
  fs::create_dir_all(&p).map_err(|e| format!("No se pudo crear carpeta paciente: {e}"))?;

  let mut files = p.clone();
  files.push("files");
  fs::create_dir_all(&files).map_err(|e| format!("No se pudo crear files/: {e}"))?;

  let mut exams = p.clone();
  exams.push("exams");
  fs::create_dir_all(&exams).map_err(|e| format!("No se pudo crear exams/: {e}"))?;

  let mut profile = p.clone();
  profile.push("profile");
  fs::create_dir_all(&profile).map_err(|e| format!("No se pudo crear profile/: {e}"))?;

  Ok(p)
}

fn rel_from_base(app: &tauri::AppHandle, abs: &Path) -> Result<String, String> {
  let base = app_base_dir(app)?;
  let rel = abs
    .strip_prefix(&base)
    .map_err(|_| "No se pudo calcular ruta relativa".to_string())?;
  Ok(rel.to_string_lossy().replace('\\', "/"))
}

fn abs_from_base(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
  let mut base = app_base_dir(app)?;
  base.push(rel);
  Ok(base)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Patient {
  pub id: String,
  pub name: String,
  pub doc_type: Option<String>,
  pub doc_number: Option<String>,
  pub insurer: Option<String>,
  pub birth_date: Option<String>,
  pub sex: Option<String>,
  pub phone: Option<String>,
  pub email: Option<String>,
  pub address: Option<String>,
  pub emergency_contact: Option<String>,
  pub notes: Option<String>,
  pub photo_path: Option<String>, // absolute (conveniencia para frontend)
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientInput {
  pub name: String,
  pub doc_type: Option<String>,
  pub doc_number: Option<String>,
  pub insurer: Option<String>,
  pub birth_date: Option<String>,
  pub sex: Option<String>,
  pub phone: Option<String>,
  pub email: Option<String>,
  pub address: Option<String>,
  pub emergency_contact: Option<String>,
  pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientFile {
  pub id: i64,
  pub patient_id: String,
  pub kind: String,
  pub filename: String,
  pub created_at: String,
  pub path: String,      // absolute
  pub meta_json: Option<String>,
}

fn row_to_patient(app: &tauri::AppHandle, row: &rusqlite::Row) -> rusqlite::Result<Patient> {
  let photo_rel: Option<String> = row.get(12)?;
  let photo_abs = if let Some(rel) = photo_rel.clone() {
    Some(abs_from_base(app, &rel).unwrap_or_else(|_| PathBuf::from(rel)).to_string_lossy().to_string())
  } else {
    None
  };

  Ok(Patient {
    id: row.get(0)?,
    name: row.get(1)?,
    doc_type: row.get(2)?,
    doc_number: row.get(3)?,
    insurer: row.get(4)?,
    birth_date: row.get(5)?,
    sex: row.get(6)?,
    phone: row.get(7)?,
    email: row.get(8)?,
    address: row.get(9)?,
    emergency_contact: row.get(10)?,
    notes: row.get(11)?,
    photo_path: photo_abs,
    created_at: row.get(13)?,
    updated_at: row.get(14)?,
  })
}

#[tauri::command]
fn list_patients(app: tauri::AppHandle, query: String) -> Result<Vec<Patient>, String> {
  let conn = open_db(&app)?;
  let q = query.trim().to_string();

  let mut out: Vec<Patient> = Vec::new();

  if q.is_empty() {
    let mut stmt = conn
      .prepare(
        r#"
        SELECT id,name,doc_type,doc_number,insurer,birth_date,sex,phone,email,address,emergency_contact,notes,photo_path,created_at,updated_at
        FROM patients
        ORDER BY updated_at DESC
        "#,
      )
      .map_err(|e| e.to_string())?;

    let rows = stmt
      .query_map([], |r| row_to_patient(&app, r))
      .map_err(|e| e.to_string())?;

    for r in rows {
      out.push(r.map_err(|e| e.to_string())?);
    }
    return Ok(out);
  }

  let like = format!("%{}%", q);
  let mut stmt = conn
    .prepare(
      r#"
      SELECT id,name,doc_type,doc_number,insurer,birth_date,sex,phone,email,address,emergency_contact,notes,photo_path,created_at,updated_at
      FROM patients
      WHERE name LIKE ?1 OR doc_number LIKE ?1 OR insurer LIKE ?1 OR emergency_contact LIKE ?1
      ORDER BY updated_at DESC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map(params![like], |r| row_to_patient(&app, r))
    .map_err(|e| e.to_string())?;

  for r in rows {
    out.push(r.map_err(|e| e.to_string())?);
  }

  Ok(out)
}

#[tauri::command]
fn create_patient(app: tauri::AppHandle, input: PatientInput) -> Result<Patient, String> {
  let name = input.name.trim();
  if name.is_empty() {
    return Err("Nombre requerido".to_string());
  }

  let conn = open_db(&app)?;
  let id = uuid::Uuid::new_v4().to_string();

  let created_at = now_iso();
  let updated_at = created_at.clone();

  conn.execute(
    r#"
    INSERT INTO patients (id,name,doc_type,doc_number,insurer,birth_date,sex,phone,email,address,emergency_contact,notes,photo_path,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,NULL,?13,?14)
    "#,
    params![
      id,
      name,
      input.doc_type,
      input.doc_number,
      input.insurer,
      input.birth_date,
      input.sex,
      input.phone,
      input.email,
      input.address,
      input.emergency_contact,
      input.notes,
      created_at,
      updated_at
    ],
  ).map_err(|e| format!("DB insert error: {e}"))?;

  // crear estructura de carpetas
  let _ = patient_folder(&app, &id)?;

  // devolver creado
  let mut stmt = conn
    .prepare(
      r#"
      SELECT id,name,doc_type,doc_number,insurer,birth_date,phone,email,address,notes,photo_path,created_at,updated_at
      FROM patients WHERE id=?1
      "#,
    )
    .map_err(|e| e.to_string())?;

  let p = stmt
    .query_row(params![id], |r| row_to_patient(&app, r))
    .map_err(|e| e.to_string())?;

  Ok(p)
}

#[tauri::command]
fn update_patient(app: tauri::AppHandle, patient_id: String, input: PatientInput) -> Result<Patient, String> {
  let conn = open_db(&app)?;
  let updated_at = now_iso();

  conn.execute(
    r#"
    UPDATE patients
    SET name=?2, doc_type=?3, doc_number=?4, insurer=?5, birth_date=?6, sex=?7, phone=?8, email=?9, address=?10, emergency_contact=?11, notes=?12, updated_at=?13
    WHERE id=?1
    "#,
    params![
      patient_id,
      input.name.trim(),
      input.doc_type,
      input.doc_number,
      input.insurer,
      input.birth_date,
      input.sex,
      input.phone,
      input.email,
      input.address,
      input.emergency_contact,
      input.notes,
      updated_at
    ],
  )
  .map_err(|e| e.to_string())?;

  let mut stmt = conn
    .prepare(
      r#"
      SELECT id,name,doc_type,doc_number,insurer,birth_date,phone,email,address,notes,photo_path,created_at,updated_at
      FROM patients WHERE id=?1
      "#,
    )
    .map_err(|e| e.to_string())?;

  let p = stmt
    .query_row(params![patient_id], |r| row_to_patient(&app, r))
    .map_err(|e| e.to_string())?;

  Ok(p)
}

#[tauri::command]
fn delete_patient(app: tauri::AppHandle, patient_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  // Solo DB (como pediste: no destruir físicamente archivos)
  conn
    .execute("DELETE FROM patients WHERE id=?1", params![patient_id])
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn set_patient_photo(app: tauri::AppHandle, patient_id: String, source_path: String) -> Result<Patient, String> {
  let conn = open_db(&app)?;
  let pf = patient_folder(&app, &patient_id)?;

  let src = PathBuf::from(source_path);
  if !src.exists() {
    return Err("El archivo de foto no existe".to_string());
  }

  let ext = src.extension().and_then(|s| s.to_str()).unwrap_or("jpg");
  let filename = format!("profile_{}.{}", chrono::Local::now().format("%Y%m%d_%H%M%S"), ext);
  let mut dst = pf.clone();
  dst.push("profile");
  dst.push(filename);

  fs::copy(&src, &dst).map_err(|e| format!("No se pudo copiar foto: {e}"))?;

  let rel = rel_from_base(&app, &dst)?;
  let updated_at = now_iso();

  conn.execute(
    "UPDATE patients SET photo_path=?2, updated_at=?3 WHERE id=?1",
    params![patient_id, rel, updated_at],
  )
  .map_err(|e| e.to_string())?;

  // Registrar como file kind=photo (opcional pero útil)
  let stored_relpath = rel_from_base(&app, &dst)?;
  let created_at = now_iso();
  let filename_only = dst.file_name().and_then(|s| s.to_str()).unwrap_or("profile").to_string();

  conn.execute(
    r#"
    INSERT INTO files (patient_id, kind, filename, stored_relpath, created_at, meta_json)
    VALUES (?1,'photo',?2,?3,?4,NULL)
    "#,
    params![patient_id, filename_only, stored_relpath, created_at],
  )
  .ok();

  // devolver paciente actualizado
  let mut stmt = conn
    .prepare(
      r#"
      SELECT id,name,doc_type,doc_number,insurer,birth_date,phone,email,address,notes,photo_path,created_at,updated_at
      FROM patients WHERE id=?1
      "#,
    )
    .map_err(|e| e.to_string())?;

  let p = stmt
    .query_row(params![patient_id], |r| row_to_patient(&app, r))
    .map_err(|e| e.to_string())?;

  Ok(p)
}

#[tauri::command]
fn import_files(app: tauri::AppHandle, patient_id: String, source_paths: Vec<String>) -> Result<Vec<PatientFile>, String> {
  let conn = open_db(&app)?;
  let pf = patient_folder(&app, &patient_id)?;

  let mut created: Vec<PatientFile> = Vec::new();

  for src_str in source_paths {
    let src = PathBuf::from(&src_str);
    if !src.exists() {
      continue;
    }
    let orig_name = src.file_name().and_then(|s| s.to_str()).unwrap_or("archivo");
    let safe = sanitize_filename(orig_name);

    let filename = format!("{}_{}", chrono::Local::now().format("%Y%m%d_%H%M%S"), safe);

    let mut dst = pf.clone();
    dst.push("files");
    dst.push(&filename);

    fs::copy(&src, &dst).map_err(|e| format!("No se pudo copiar archivo: {e}"))?;

    let rel = rel_from_base(&app, &dst)?;
    let created_at = now_iso();

    conn.execute(
      r#"
      INSERT INTO files (patient_id, kind, filename, stored_relpath, created_at, meta_json)
      VALUES (?1,'attachment',?2,?3,?4,NULL)
      "#,
      params![patient_id, safe, rel, created_at],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    created.push(PatientFile {
      id,
      patient_id: patient_id.clone(),
      kind: "attachment".to_string(),
      filename: safe,
      created_at,
      path: dst.to_string_lossy().to_string(),
      meta_json: None,
    });
  }

  Ok(created)
}

#[tauri::command]
fn list_patient_files(app: tauri::AppHandle, patient_id: String) -> Result<Vec<PatientFile>, String> {
  let conn = open_db(&app)?;

  let mut stmt = conn
    .prepare(
      r#"
      SELECT id, patient_id, kind, filename, stored_relpath, created_at, meta_json
      FROM files
      WHERE patient_id=?1
      ORDER BY created_at DESC, id DESC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map(params![patient_id], |row| {
      let id: i64 = row.get(0)?;
      let pid: String = row.get(1)?;
      let kind: String = row.get(2)?;
      let filename: String = row.get(3)?;
      let rel: String = row.get(4)?;
      let created_at: String = row.get(5)?;
      let meta_json: Option<String> = row.get(6)?;
      Ok((id, pid, kind, filename, rel, created_at, meta_json))
    })
    .map_err(|e| e.to_string())?;

  let mut out = Vec::new();
  for r in rows {
    let (id, pid, kind, filename, rel, created_at, meta_json) = r.map_err(|e| e.to_string())?;
    let abs = abs_from_base(&app, &rel)?.to_string_lossy().to_string();

    out.push(PatientFile {
      id,
      patient_id: pid,
      kind,
      filename,
      created_at,
      path: abs,
      meta_json,
    });
  }

  Ok(out)
}

#[tauri::command]
fn create_mental_exam(app: tauri::AppHandle, patient_id: String, payload: serde_json::Value) -> Result<PatientFile, String> {
  let conn = open_db(&app)?;
  let pf = patient_folder(&app, &patient_id)?;

  let created_at = now_iso();
  let fname = format!("emf_{}.json", chrono::Local::now().format("%Y%m%d_%H%M%S"));

  let mut dst = pf.clone();
  dst.push("exams");
  dst.push(&fname);

  let pretty = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
  fs::write(&dst, pretty).map_err(|e| format!("No se pudo escribir examen: {e}"))?;

  let rel = rel_from_base(&app, &dst)?;
  let meta = Some(r#"{"type":"examen_mental"}"#.to_string());

  conn.execute(
    r#"
    INSERT INTO files (patient_id, kind, filename, stored_relpath, created_at, meta_json)
    VALUES (?1,'exam',?2,?3,?4,?5)
    "#,
    params![patient_id, fname, rel, created_at, meta],
  )
  .map_err(|e| e.to_string())?;

  let id = conn.last_insert_rowid();

  Ok(PatientFile {
    id,
    patient_id,
    kind: "exam".to_string(),
    filename: fname,
    created_at,
    path: dst.to_string_lossy().to_string(),
    meta_json: Some(r#"{"type":"examen_mental"}"#.to_string()),
  })
}

#[tauri::command]
fn open_patient_folder(app: tauri::AppHandle, patient_id: String) -> Result<(), String> {
  let p = patient_folder(&app, &patient_id)?;
  open::that(p).map_err(|e| format!("No se pudo abrir carpeta: {e}"))?;
  Ok(())
}

#[tauri::command]
fn open_path(_app: tauri::AppHandle, path: String) -> Result<(), String> {
  open::that(path).map_err(|e| format!("No se pudo abrir: {e}"))?;
  Ok(())
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      list_patients,
      create_patient,
      update_patient,
      delete_patient,
      set_patient_photo,
      import_files,
      list_patient_files,
      create_mental_exam,
      open_patient_folder,
      open_path
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
