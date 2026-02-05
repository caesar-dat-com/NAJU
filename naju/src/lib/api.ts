export type Patient = {
  id: string;
  name: string;
  doc_type: string | null;
  doc_number: string | null;
  insurer: string | null;
  birth_date: string | null;
  sex: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  emergency_contact: string | null;
  notes: string | null;
  photo_path: string | null;
  drive_folder_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientInput = {
  name: string;
  doc_type?: string | null;
  doc_number?: string | null;
  insurer?: string | null;
  birth_date?: string | null;
  sex?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  emergency_contact?: string | null;
  notes?: string | null;
};

export type PatientFile = {
  id: number;
  patient_id: string;
  kind: "attachment" | "exam" | "note" | "photo";
  filename: string;
  created_at: string;
  path: string;
  meta_json: string | null;
};

export type Appointment = {
  id: number;
  patient_id: string;
  title: string;
  start_iso: string; // ISO string in UTC (Date.toISOString())
  end_iso: string;   // ISO string in UTC (Date.toISOString())
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AppointmentInput = {
  patient_id: string;
  title: string;
  start_iso: string;
  end_iso: string;
  notes?: string | null;
};


type Store = {
  patients: Patient[];
  files: PatientFile[];
  appointments: Appointment[];
  nextFileId: number;
  nextAppointmentId: number;
};

const STORAGE_KEY = "naju_web_store";
// Dev-only endpoint (served by Vite middleware) that persists the store inside the project folder.
// Falls back to localStorage automatically when the endpoint is not available.
const FILE_STORE_ENDPOINT = "/__naju_store";

let cachedStore: Store | null = null;

function normalizeStore(input: any): Store {
  return {
    patients: Array.isArray(input?.patients) ? (input.patients as Patient[]) : [],
    files: Array.isArray(input?.files) ? (input.files as PatientFile[]) : [],
    appointments: Array.isArray(input?.appointments) ? (input.appointments as Appointment[]) : [],
    nextFileId: typeof input?.nextFileId === "number" ? input.nextFileId : 1,
    nextAppointmentId: typeof input?.nextAppointmentId === "number" ? input.nextAppointmentId : 1,
  };
}

function loadStoreFromLocalStorage(): Store {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { patients: [], files: [], appointments: [], nextFileId: 1, nextAppointmentId: 1 };
  }
  try {
    return normalizeStore(JSON.parse(raw));
  } catch {
    return { patients: [], files: [], appointments: [], nextFileId: 1, nextAppointmentId: 1 };
  }
}

function saveStoreToLocalStorage(store: Store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

async function loadStoreAsync(): Promise<Store> {
  // Try dev file-store first; fallback to localStorage.
  try {
    const res = await fetch(FILE_STORE_ENDPOINT, { cache: "no-store" });
    if (res.ok) {
      const parsed = await res.json();
      const store = normalizeStore(parsed);
      saveStoreToLocalStorage(store); // mirror for backup
      return store;
    }
  } catch {
    // ignore
  }
  return loadStoreFromLocalStorage();
}

async function getStore(): Promise<Store> {
  if (cachedStore) return cachedStore;
  cachedStore = await loadStoreAsync();
  return cachedStore;
}

async function persistStore(store: Store) {
  cachedStore = store;
  saveStoreToLocalStorage(store);
  try {
    await fetch(FILE_STORE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(store),
    });
  } catch {
    // ignore (localStorage already persisted)
  }
}

function normQuery(q?: string) {
  return (q ?? "").trim().toLowerCase();
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export async function listPatients(query?: string): Promise<Patient[]> {
  const store = await getStore();
  const q = normQuery(query);
  const patients = q
    ? store.patients.filter((p) => {
        const haystack = [p.name, p.doc_type, p.doc_number, p.insurer, p.phone, p.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
    : store.patients;
  return [...patients].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function createPatient(input: PatientInput): Promise<Patient> {
  const store = await getStore();
  const iso = nowIso();
  const patient: Patient = {
    id: newId(),
    name: input.name,
    doc_type: input.doc_type ?? null,
    doc_number: input.doc_number ?? null,
    insurer: input.insurer ?? null,
    birth_date: input.birth_date ?? null,
    sex: input.sex ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    emergency_contact: input.emergency_contact ?? null,
    notes: input.notes ?? null,
    photo_path: null,
    drive_folder_id: null,
    created_at: iso,
    updated_at: iso,
  };
  store.patients.unshift(patient);
  await persistStore(store);
  return patient;
}

export async function updatePatient(patientId: string, input: PatientInput): Promise<Patient> {
  const store = await getStore();
  const idx = store.patients.findIndex((p) => p.id === patientId);
  if (idx === -1) throw new Error("Paciente no encontrado");
  const current = store.patients[idx];
  const updated: Patient = {
    ...current,
    name: input.name,
    doc_type: input.doc_type ?? null,
    doc_number: input.doc_number ?? null,
    insurer: input.insurer ?? null,
    birth_date: input.birth_date ?? null,
    sex: input.sex ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    emergency_contact: input.emergency_contact ?? null,
    notes: input.notes ?? null,
    updated_at: nowIso(),
  };
  store.patients[idx] = updated;
  await persistStore(store);
  return updated;
}

export async function deletePatient(patientId: string): Promise<void> {
  const store = await getStore();
  store.patients = store.patients.filter((p) => p.id !== patientId);
  store.files = store.files.filter((f) => f.patient_id !== patientId);
  store.appointments = store.appointments.filter((a) => a.patient_id !== patientId);
  await persistStore(store);
}

export async function setPatientPhoto(patientId: string, file: File): Promise<Patient> {
  const store = await getStore();
  const idx = store.patients.findIndex((p) => p.id === patientId);
  if (idx === -1) throw new Error("Paciente no encontrado");
  const dataUrl = await readFileAsDataUrl(file);
  const updated: Patient = {
    ...store.patients[idx],
    photo_path: dataUrl,
    updated_at: nowIso(),
  };
  store.patients[idx] = updated;
  await persistStore(store);
  return updated;
}

export async function importFiles(patientId: string, files: File[]): Promise<PatientFile[]> {
  const store = await getStore();
  const createdAt = nowIso();
  const newFiles: PatientFile[] = [];
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    const entry: PatientFile = {
      id: store.nextFileId++,
      patient_id: patientId,
      kind: "attachment",
      filename: file.name,
      created_at: createdAt,
      path: dataUrl,
      meta_json: null,
    };
    newFiles.push(entry);
    store.files.unshift(entry);
  }
  await persistStore(store);
  return newFiles;
}

export async function listPatientFiles(patientId: string): Promise<PatientFile[]> {
  const store = await getStore();
  return store.files.filter((f) => f.patient_id === patientId);
}

export async function listAllFiles(): Promise<PatientFile[]> {
  const store = await getStore();
  return store.files;
}

export async function createMentalExam(patientId: string, payload: any): Promise<PatientFile> {
  const store = await getStore();
  const createdAt = nowIso();
  const filename = `examen-${createdAt.slice(0, 10)}.json`;
  const json = JSON.stringify(payload, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  const entry: PatientFile = {
    id: store.nextFileId++,
    patient_id: patientId,
    kind: "exam",
    filename,
    created_at: createdAt,
    path: dataUrl,
    meta_json: json,
  };
  store.files.unshift(entry);
  await persistStore(store);
  return entry;
}

export async function createPatientNote(patientId: string, payload: any): Promise<PatientFile> {
  const store = await getStore();
  const createdAt = nowIso();
  const filename = `nota-${createdAt.slice(0, 10)}.json`;
  const json = JSON.stringify(payload, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  const entry: PatientFile = {
    id: store.nextFileId++,
    patient_id: patientId,
    kind: "note",
    filename,
    created_at: createdAt,
    path: dataUrl,
    meta_json: json,
  };
  store.files.unshift(entry);
  await persistStore(store);
  return entry;
}

export async function setPatientDriveFolder(patientId: string, folderId: string | null): Promise<Patient> {
  const store = await getStore();
  const idx = store.patients.findIndex((p) => p.id === patientId);
  if (idx === -1) throw new Error("Paciente no encontrado");
  const current = store.patients[idx];
  const updated: Patient = {
    ...current,
    drive_folder_id: folderId ?? null,
    updated_at: nowIso(),
  };
  store.patients[idx] = updated;
  await persistStore(store);
  return updated;
}

export async function createAttachmentLink(
  patientId: string,
  filename: string,
  url: string,
  meta?: any
): Promise<PatientFile> {
  const store = await getStore();
  const createdAt = nowIso();
  const entry: PatientFile = {
    id: store.nextFileId++,
    patient_id: patientId,
    kind: "attachment",
    filename,
    created_at: createdAt,
    path: url,
    meta_json: meta ? JSON.stringify(meta) : null,
  };
  store.files.unshift(entry);
  await persistStore(store);
  return entry;
}


function sortByStartIso(a: Appointment, b: Appointment) {
  const ta = Date.parse(a.start_iso || "");
  const tb = Date.parse(b.start_iso || "");
  return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
}

export async function listAppointments(): Promise<Appointment[]> {
  const store = await getStore();
  return (store.appointments || []).slice().sort(sortByStartIso);
}

export async function listAppointmentsForPatient(patientId: string): Promise<Appointment[]> {
  const store = await getStore();
  return (store.appointments || []).filter((a) => a.patient_id === patientId).slice().sort(sortByStartIso);
}

export async function createAppointment(input: AppointmentInput): Promise<Appointment> {
  const store = await getStore();
  const now = nowIso();
  const entry: Appointment = {
    id: store.nextAppointmentId++,
    patient_id: input.patient_id,
    title: (input.title || "").trim() || "Cita",
    start_iso: input.start_iso,
    end_iso: input.end_iso,
    notes: (input.notes ?? null) ? String(input.notes) : null,
    created_at: now,
    updated_at: now,
  };
  store.appointments.unshift(entry);
  await persistStore(store);
  return entry;
}

export async function updateAppointment(appointmentId: number, patch: Partial<AppointmentInput>): Promise<Appointment> {
  const store = await getStore();
  const idx = (store.appointments || []).findIndex((a) => a.id === appointmentId);
  if (idx === -1) throw new Error("Cita no encontrada");
  const cur = store.appointments[idx];
  const updated: Appointment = {
    ...cur,
    patient_id: patch.patient_id ?? cur.patient_id,
    title: typeof patch.title === "string" ? (patch.title.trim() || "Cita") : cur.title,
    start_iso: typeof patch.start_iso === "string" ? patch.start_iso : cur.start_iso,
    end_iso: typeof patch.end_iso === "string" ? patch.end_iso : cur.end_iso,
    notes: patch.notes !== undefined ? (patch.notes === null ? null : String(patch.notes)) : cur.notes,
    updated_at: nowIso(),
  };
  store.appointments[idx] = updated;
  await persistStore(store);
  return updated;
}

export async function deleteAppointment(appointmentId: number): Promise<void> {
  const store = await getStore();
  store.appointments = (store.appointments || []).filter((a) => a.id !== appointmentId);
  await persistStore(store);
}
