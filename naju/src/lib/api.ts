import { invoke } from "@tauri-apps/api/tauri";

export type Patient = {
    id: string;
    full_name: string;
    document_type?: string | null;
    document_number?: string | null;
    date_of_birth?: string | null;
    sex?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    insurance?: string | null;
    emergency_contact?: string | null;
    notes?: string | null;
    photo_filename?: string | null;
    created_at: string;
    updated_at: string;
};

export type PatientInput = Omit<Patient, "id" | "created_at" | "updated_at" | "photo_filename">;

export type PatientDetail = {
    patient: Patient;
    folder: string;
    photo_path?: string | null;
    files: string[];
    exams: string[];
};

export type MseInput = {
    appearance?: string | null;
    behavior?: string | null;
    attitude?: string | null;
    speech?: string | null;
    mood?: string | null;
    affect?: string | null;
    thought_process?: string | null;
    thought_content?: string | null;
    perception?: string | null;
    cognition_orientation?: string | null;
    cognition_attention?: string | null;
    cognition_memory?: string | null;
    insight?: string | null;
    judgment?: string | null;
    risk_suicide?: string | null;
    risk_homicide?: string | null;
    risk_self_harm?: string | null;
    risk_violence?: string | null;
    sleep?: string | null;
    appetite?: string | null;
    substance_use?: string | null;
    diagnosis_impression?: string | null;
    plan?: string | null;
    clinician_notes?: string | null;
};

export const api = {
    listPatients: (query?: string) => invoke<Patient[]>("list_patients", { query }),
    createPatient: (input: PatientInput) => invoke<Patient>("create_patient", { input }),
    updatePatient: (patientId: string, input: PatientInput) =>
        invoke<Patient>("update_patient", { patientId, input }),
    getDetail: (patientId: string) => invoke<PatientDetail>("get_patient_detail", { patientId }),
    importFiles: (patientId: string, paths: string[]) => invoke<string[]>("import_files", { patientId, paths }),
    setPhoto: (patientId: string, path: string) => invoke<string>("set_patient_photo", { patientId, path }),
    createMse: (patientId: string, mse: MseInput) => invoke<string>("create_mse", { patientId, mse }),
};
