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
  kind: "attachment" | "exam" | "photo";
  filename: string;
  created_at: string;
  path: string;
  meta_json: string | null;
};

type Store = {
  patients: Patient[];
  files: PatientFile[];
  nextFileId: number;
};

const STORAGE_KEY = "naju_web_store";

function loadStore(): Store {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { patients: [], files: [], nextFileId: 1 };
  }
  try {
    const parsed = JSON.parse(raw) as Store;
    return {
      patients: parsed.patients ?? [],
      files: parsed.files ?? [],
      nextFileId: parsed.nextFileId ?? 1,
    };
  } catch {
    return { patients: [], files: [], nextFileId: 1 };
  }
}

function saveStore(store: Store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
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
  const store = loadStore();
  const q = normQuery(query);
  const patients = q
    ? store.patients.filter((p) => {
        const haystack = [
          p.name,
          p.doc_type,
          p.doc_number,
          p.insurer,
          p.phone,
          p.email,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
    : store.patients;
  return patients.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function createPatient(input: PatientInput): Promise<Patient> {
  const store = loadStore();
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
    created_at: iso,
    updated_at: iso,
  };
  store.patients.unshift(patient);
  saveStore(store);
  return patient;
}

export async function updatePatient(patientId: string, input: PatientInput): Promise<Patient> {
  const store = loadStore();
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
  saveStore(store);
  return updated;
}

export async function deletePatient(patientId: string): Promise<void> {
  const store = loadStore();
  store.patients = store.patients.filter((p) => p.id !== patientId);
  store.files = store.files.filter((f) => f.patient_id !== patientId);
  saveStore(store);
}

export async function setPatientPhoto(patientId: string, file: File): Promise<Patient> {
  const store = loadStore();
  const idx = store.patients.findIndex((p) => p.id === patientId);
  if (idx === -1) throw new Error("Paciente no encontrado");
  const dataUrl = await readFileAsDataUrl(file);
  const updated: Patient = {
    ...store.patients[idx],
    photo_path: dataUrl,
    updated_at: nowIso(),
  };
  store.patients[idx] = updated;
  saveStore(store);
  return updated;
}

export async function importFiles(patientId: string, files: File[]): Promise<PatientFile[]> {
  const store = loadStore();
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
  saveStore(store);
  return newFiles;
}

export async function listPatientFiles(patientId: string): Promise<PatientFile[]> {
  const store = loadStore();
  return store.files.filter((f) => f.patient_id === patientId);
}

export async function createMentalExam(patientId: string, payload: any): Promise<PatientFile> {
  const store = loadStore();
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
  saveStore(store);
  return entry;
}
