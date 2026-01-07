import { invoke } from "@tauri-apps/api/tauri";

export type Patient = {
    id: string;
    name: string;
    doc_type: string | null;
    doc_number: string | null;
    insurer: string | null;
    birth_date: string | null; // YYYY-MM-DD
    sex: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    emergency_contact: string | null;
    notes: string | null;
    photo_path: string | null; // absolute path in OS (backend)
    created_at: string; // ISO
    updated_at: string; // ISO
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
    created_at: string; // ISO
    path: string; // absolute path for opening / preview
    meta_json: string | null;
};

function normQuery(q?: string) {
    return (q ?? "").trim();
}

export async function listPatients(query?: string): Promise<Patient[]> {
    return await invoke("list_patients", { query: normQuery(query) });
}

export async function createPatient(input: PatientInput): Promise<Patient> {
    return await invoke("create_patient", { input });
}

export async function updatePatient(patientId: string, input: PatientInput): Promise<Patient> {
    return await invoke("update_patient", { patientId, input });
}

export async function deletePatient(patientId: string): Promise<void> {
    await invoke("delete_patient", { patientId });
}

export async function setPatientPhoto(patientId: string, sourcePath: string): Promise<Patient> {
    return await invoke("set_patient_photo", { patientId, sourcePath });
}

export async function importFiles(patientId: string, sourcePaths: string[]): Promise<PatientFile[]> {
    return await invoke("import_files", { patientId, sourcePaths });
}

export async function listPatientFiles(patientId: string): Promise<PatientFile[]> {
    return await invoke("list_patient_files", { patientId });
}

export async function createMentalExam(patientId: string, payload: any): Promise<PatientFile> {
    return await invoke("create_mental_exam", { patientId, payload });
}

export async function openPath(path: string): Promise<void> {
    await invoke("open_path", { path });
}

export async function openPatientFolder(patientId: string): Promise<void> {
    await invoke("open_patient_folder", { patientId });
}
