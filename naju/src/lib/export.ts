import type { Appointment } from "./api";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toIcsUtc(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    String(d.getUTCFullYear()) +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    "Z"
  );
}

function escIcsText(input: string) {
  return (input || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldLine(line: string) {
  // RFC5545: lines SHOULD be folded at 75 octets. We do a simple char fold.
  const out: string[] = [];
  let s = line;
  while (s.length > 74) {
    out.push(s.slice(0, 74));
    s = " " + s.slice(74);
  }
  out.push(s);
  return out.join("\r\n");
}

export function appointmentsToIcs(appointments: Appointment[], patientNameById: Record<string, string>) {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//NAJU//Agenda//ES");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");

  const dtstamp = toIcsUtc(new Date().toISOString());

  for (const a of appointments.slice().sort((x, y) => Date.parse(x.start_iso) - Date.parse(y.start_iso))) {
    const uid = `naju-${a.id}@naju.local`;
    const pname = patientNameById[a.patient_id] || "Paciente";
    const summary = escIcsText(`${a.title} · ${pname}`);
    const descParts: string[] = [];
    descParts.push(`Paciente: ${pname}`);
    descParts.push(`PatientId: ${a.patient_id}`);
    if (a.notes) descParts.push(`Notas: ${a.notes}`);
    const description = escIcsText(descParts.join("\n"));

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    const ds = toIcsUtc(a.start_iso);
    const de = toIcsUtc(a.end_iso);
    if (ds) lines.push(`DTSTART:${ds}`);
    if (de) lines.push(`DTEND:${de}`);
    lines.push(`SUMMARY:${summary}`);
    lines.push(`DESCRIPTION:${description}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map((l) => foldLine(l)).join("\r\n") + "\r\n";
}

function csvEscape(val: string) {
  const s = String(val ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function appointmentsToCsv(appointments: Appointment[], patientNameById: Record<string, string>) {
  const header = ["patient_id", "patient_name", "title", "start_iso", "end_iso", "notes"].join(",");
  const rows = appointments
    .slice()
    .sort((x, y) => Date.parse(x.start_iso) - Date.parse(y.start_iso))
    .map((a) =>
      [
        csvEscape(a.patient_id),
        csvEscape(patientNameById[a.patient_id] || ""),
        csvEscape(a.title || ""),
        csvEscape(a.start_iso || ""),
        csvEscape(a.end_iso || ""),
        csvEscape(a.notes || ""),
      ].join(",")
    );
  return [header, ...rows].join("\n");
}

export function downloadTextFile(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
