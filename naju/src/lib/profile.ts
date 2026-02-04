import type { Patient, PatientFile } from "./api";

type ProfileMeta = { values: number[]; accent: string; label: string | null };

export function buildProfileMap(
  patients: Patient[],
  allFiles: PatientFile[],
  getAxisValues: (files: PatientFile[]) => { values: number[]; dominant: { label: string; value: number } | null },
  profileColors: Record<string, string>
) {
  const map = new Map<string, ProfileMeta>();
  patients.forEach((patient) => {
    const patientFiles = allFiles.filter((f) => f.patient_id === patient.id);
    const { values, dominant } = getAxisValues(patientFiles);
    const label = dominant?.label ?? null;
    const accent = label ? profileColors[label] : "#c7a45a";
    map.set(patient.id, { values, accent, label });
  });
  return map;
}
