#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use uuid::Uuid;

const APP_DIR: &str = "NAJU";
const DB_FILE: &str = "naju.sqlite";
const PATIENTS_DIR: &str = "patients";

fn now_stamp() -> String {
  Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn file_stamp() -> String {
  Local::now().format("%Y-%m-%d_%H-%M-%S").to_string()
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app
    .path_resolver()
    .app_data_dir()
    .ok_or("No se pudo resolver app_data_dir".to_string())
    .map(|p| p.join(APP_DIR))
}

fn ensure_dirs(app: &tauri::AppHandle) -> Result<(), String> {
  let base = app_data_dir(app)?;
  fs::create_dir_all(base.join(PATIENTS_DIR)).map_err(|e| e.to_string())?;
  Ok(())
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  Ok(app_data_dir(app)?.join(DB_FILE))
}

fn patient_dir(app: &tauri::AppHandle, patient_id: &str) -> Result<PathBuf, String> {
  Ok(app_data_dir(app)?.join(PATIENTS_DIR).join(patient_id))
}

fn conn(app: &tauri::AppHandle) -> Result<Connection, String> {
  ensure_dirs(app)?;
  let path = db_path(app)?;
  let c = Connection::open(path).map_err(|e| e.to_string())?;
  init_db(&c).map_err(|e| e.to_string())?;
  Ok(c)
}

fn init_db(c: &Connection) -> Result<(), rusqlite::Error> {
  c.execute_batch(
    r#"
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY, full_name TEXT NOT NULL, document_type TEXT, document_number TEXT, date_of_birth TEXT, sex TEXT, phone TEXT, email TEXT, address TEXT, insurance TEXT, emergency_contact TEXT, notes TEXT, photo_filename TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
    "#,
  )?;
  Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Patient {
  id: String,
  full_name: String,
  document_type: Option<String>,
  document_number: Option<String>,
  date_of_birth: Option<String>,
  sex: Option<String>,
  phone: Option<String>,
  email: Option<String>,
  address: Option<String>,
  insurance: Option<String>,
  emergency_contact: Option<String>,
  notes: Option<String>,
  photo_filename: Option<String>,
  created_at: String,
  updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PatientInput {
  full_name: String,
  document_type: Option<String>,
  document_number: Option<String>,
  date_of_birth: Option<String>,
  sex: Option<String>,
  phone: Option<String>,
  email: Option<String>,
  address: Option<String>,
  insurance: Option<String>,
  emergency_contact: Option<String>,
  notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PatientDetail {
  patient: Patient,
  folder: String,
  photo_path: Option<String>,
  files: Vec<String>,
  exams: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct MseInput {
  appearance: Option<String>,
  behavior: Option<String>,
  attitude: Option<String>,
  speech: Option<String>,
  mood: Option<String>,
  affect: Option<String>,
  thought_process: Option<String>,
  thought_content: Option<String>,
  perception: Option<String>,
  cognition_orientation: Option<String>,
  cognition_attention: Option<String>,
  cognition_memory: Option<String>,
  insight: Option<String>,
  judgment: Option<String>,
  risk_suicide: Option<String>,
  risk_homicide: Option<String>,
  risk_self_harm: Option<String>,
  risk_violence: Option<String>,
  sleep: Option<String>,
  appetite: Option<String>,
  substance_use: Option<String>,
  diagnosis_impression: Option<String>,
  plan: Option<String>,
  clinician_notes: Option<String>,
}

fn clean_opt(s: &Option<String>) -> Option<String> {
  s.as_ref()
    .map(|x| x.trim().to_string())
    .filter(|x| !x.is_empty())
}

fn copy_into_dir(src: &Path, dest_dir: &Path, dest_name: &str) -> Result<PathBuf, String> {
  fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
  let dest = dest_dir.join(dest_name);
  fs::copy(src, &dest).map_err(|e| e.to_string())?;
  Ok(dest)
}

#[tauri::command]
fn list_patients(app: tauri::AppHandle, query: Option<String>) -> Result<Vec<Patient>, String> {
  let c = conn(&app)?;
  let q = query.unwrap_or_default().trim().to_lowercase();
  let like = format!("%{}%", q);

  let mut stmt_all;
  let mut stmt_filter;
  
  let mut rows = if q.is_empty() {
    stmt_all = c.prepare(
      "SELECT id, full_name, document_type, document_number, date_of_birth, sex, phone, email, address, insurance, emergency_contact, notes, photo_filename, created_at, updated_at
        FROM patients ORDER BY updated_at DESC",
    ).map_err(|e| e.to_string())?;
    stmt_all.query([]).map_err(|e| e.to_string())?
  } else {
    stmt_filter = c.prepare(
      "SELECT id, full_name, document_type, document_number, date_of_birth, sex, phone, email, address, insurance, emergency_contact, notes, photo_filename, created_at, updated_at
        FROM patients
        WHERE LOWER(full_name) LIKE ?1 OR LOWER(COALESCE(document_number,'')) LIKE ?1
        ORDER BY updated_at DESC",
    ).map_err(|e| e.to_string())?;
    stmt_filter.query([like]).map_err(|e| e.to_string())?
  };

  let mut out = vec![];
  while let Ok(Some(r)) = rows.next() {
    out.push(Patient {
      id: r.get(0).map_err(|e| e.to_string())?,
      full_name: r.get(1).map_err(|e| e.to_string())?,
      document_type: r.get(2).map_err(|e| e.to_string())?,
      document_number: r.get(3).map_err(|e| e.to_string())?,
      date_of_birth: r.get(4).map_err(|e| e.to_string())?,
      sex: r.get(5).map_err(|e| e.to_string())?,
      phone: r.get(6).map_err(|e| e.to_string())?,
      email: r.get(7).map_err(|e| e.to_string())?,
      address: r.get(8).map_err(|e| e.to_string())?,
      insurance: r.get(9).map_err(|e| e.to_string())?,
      emergency_contact: r.get(10).map_err(|e| e.to_string())?,
      notes: r.get(11).map_err(|e| e.to_string())?,
      photo_filename: r.get(12).map_err(|e| e.to_string())?,
      created_at: r.get(13).map_err(|e| e.to_string())?,
      updated_at: r.get(14).map_err(|e| e.to_string())?,
    });
  }
  Ok(out)
}

#[tauri::command]
fn create_patient(app: tauri::AppHandle, input: PatientInput) -> Result<Patient, String> {
  let mut input = input;
  input.full_name = input.full_name.trim().to_string();
  if input.full_name.is_empty() {
    return Err("El nombre es obligatorio".to_string());
  }

  let c = conn(&app)?;
  let id = Uuid::new_v4().to_string();
  let created_at = now_stamp();
  let updated_at = created_at.clone();

  c.execute(
    r#"INSERT INTO patients
      (id, full_name, document_type, document_number, date_of_birth, sex, phone, email, address, insurance, emergency_contact, notes, photo_filename, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"#,
    params![
      id,
      input.full_name,
      clean_opt(&input.document_type),
      clean_opt(&input.document_number),
      clean_opt(&input.date_of_birth),
      clean_opt(&input.sex),
      clean_opt(&input.phone),
      clean_opt(&input.email),
      clean_opt(&input.address),
      clean_opt(&input.insurance),
      clean_opt(&input.emergency_contact),
      clean_opt(&input.notes),
      Option::<String>::None,
      created_at,
      updated_at
    ],
  )
  .map_err(|e| e.to_string())?;

  fs::create_dir_all(patient_dir(&app, &id)?).map_err(|e| e.to_string())?;

  get_patient(app, id)
}

#[tauri::command]
fn update_patient(app: tauri::AppHandle, patient_id: String, input: PatientInput) -> Result<Patient, String> {
  let c = conn(&app)?;
  let updated_at = now_stamp();

  c.execute(
    r#"UPDATE patients SET
      full_name=?2, document_type=?3, document_number=?4, date_of_birth=?5, sex=?6,
      phone=?7, email=?8, address=?9, insurance=?10, emergency_contact=?11, notes=?12,
      updated_at=?13
      WHERE id=?1"#,
    params![
      patient_id,
      input.full_name.trim(),
      clean_opt(&input.document_type),
      clean_opt(&input.document_number),
      clean_opt(&input.date_of_birth),
      clean_opt(&input.sex),
      clean_opt(&input.phone),
      clean_opt(&input.email),
      clean_opt(&input.address),
      clean_opt(&input.insurance),
      clean_opt(&input.emergency_contact),
      clean_opt(&input.notes),
      updated_at
    ],
  )
  .map_err(|e| e.to_string())?;

  get_patient(app, patient_id)
}

#[tauri::command]
fn get_patient(app: tauri::AppHandle, patient_id: String) -> Result<Patient, String> {
  let c = conn(&app)?;
  let mut stmt = c
    .prepare(
      "SELECT id, full_name, document_type, document_number, date_of_birth, sex, phone, email, address, insurance, emergency_contact, notes, photo_filename, created_at, updated_at
       FROM patients WHERE id=?1",
    )
    .map_err(|e| e.to_string())?;

  let p = stmt
    .query_row([patient_id], |r| {
      Ok(Patient {
        id: r.get(0)?,
        full_name: r.get(1)?,
        document_type: r.get(2)?,
        document_number: r.get(3)?,
        date_of_birth: r.get(4)?,
        sex: r.get(5)?,
        phone: r.get(6)?,
        email: r.get(7)?,
        address: r.get(8)?,
        insurance: r.get(9)?,
        emergency_contact: r.get(10)?,
        notes: r.get(11)?,
        photo_filename: r.get(12)?,
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
      })
    })
    .map_err(|e| e.to_string())?;

  Ok(p)
}

#[tauri::command]
fn get_patient_detail(app: tauri::AppHandle, patient_id: String) -> Result<PatientDetail, String> {
  let p = get_patient(app.clone(), patient_id.clone())?;
  let dir = patient_dir(&app, &patient_id)?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  let mut files: Vec<String> = vec![];
  let mut exams: Vec<String> = vec![];

  if let Ok(read_dir) = fs::read_dir(&dir) {
    for e in read_dir.flatten() {
      let name = e.file_name().to_string_lossy().to_string();
      if name.to_lowercase().ends_with(".json") && name.contains("examen_mental_formal") {
        exams.push(name.clone());
      } else {
        files.push(name.clone());
      }
    }
  }

  files.sort_by(|a, b| b.cmp(a));
  exams.sort_by(|a, b| b.cmp(a));

  let photo_path = p.photo_filename.as_ref().map(|fnm| dir.join(fnm).to_string_lossy().to_string());

  Ok(PatientDetail {
    patient: p,
    folder: dir.to_string_lossy().to_string(),
    photo_path,
    files,
    exams,
  })
}

#[tauri::command]
fn import_files(app: tauri::AppHandle, patient_id: String, paths: Vec<String>) -> Result<Vec<String>, String> {
  let dir = patient_dir(&app, &patient_id)?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let stamp = file_stamp();

  let mut out = vec![];
  for p in paths {
    let src = PathBuf::from(&p);
    if !src.exists() {
      continue;
    }
    let file_name = src
      .file_name()
      .map(|x| x.to_string_lossy().to_string())
      .unwrap_or_else(|| "archivo".to_string());

    let safe = file_name.replace(" ", "_");
    let dest_name = format!("{}_{}", stamp, safe);
    let _ = copy_into_dir(&src, &dir, &dest_name)?;
    out.push(dest_name);
  }
  Ok(out)
}

#[tauri::command]
fn set_patient_photo(app: tauri::AppHandle, patient_id: String, path: String) -> Result<String, String> {
  let dir = patient_dir(&app, &patient_id)?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  let src = PathBuf::from(path);
  if !src.exists() {
    return Err("La foto no existe".to_string());
  }
  let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png");
  let dest_name = format!("photo.{}", ext);
  let _dest = copy_into_dir(&src, &dir, &dest_name)?;

  let c = conn(&app)?;
  c.execute(
    "UPDATE patients SET photo_filename=?2, updated_at=?3 WHERE id=?1",
    params![patient_id, dest_name, now_stamp()],
  )
  .map_err(|e| e.to_string())?;

  Ok(dest_name)
}

#[tauri::command]
fn create_mse(app: tauri::AppHandle, patient_id: String, mse: MseInput) -> Result<String, String> {
  let dir = patient_dir(&app, &patient_id)?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  let filename = format!("{}_examen_mental_formal.json", file_stamp());
  let path = dir.join(&filename);

  let payload = serde_json::json!({
    "type": "examen_mental_formal",
    "patient_id": patient_id,
    "created_at": now_stamp(),
    "data": mse
  });

  fs::write(&path, serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?)
    .map_err(|e| e.to_string())?;

  Ok(filename)
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      list_patients,
      create_patient,
      update_patient,
      get_patient,
      get_patient_detail,
      import_files,
      set_patient_photo,
      create_mse
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
