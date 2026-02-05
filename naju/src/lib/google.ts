export type GoogleStatus = {
  connected: boolean;
  expiresAt: number | null;
  scopes: string[] | null;
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
  createdTime?: string;
  size?: string;
};

export type CalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
};

declare global {
  interface Window {
    google?: any;
  }
}

const TOKEN_KEY = "naju_google_access_token_v1";
const EXP_KEY = "naju_google_access_token_exp_v1";
const SCOPE_KEY = "naju_google_scopes_v1";
const DRIVE_ROOT_KEY = "naju_drive_root_folder_id_v1";

export const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
];

type NajuPublicConfig = {
  googleClientId?: string;
};

let _publicClientIdPromise: Promise<string | null> | null = null;

async function publicConfigClientId(): Promise<string | null> {
  if (_publicClientIdPromise) return _publicClientIdPromise;
  _publicClientIdPromise = (async () => {
    try {
      const res = await fetch("/naju.config.json", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as NajuPublicConfig;
      const id = (data as any)?.googleClientId;
      if (typeof id === "string" && id.trim()) return id.trim();
      return null;
    } catch {
      return null;
    }
  })();
  return _publicClientIdPromise;
}

async function resolveClientId(): Promise<string> {
  const fromPublic = await publicConfigClientId();
  const fromEnv = (import.meta as any)?.env?.VITE_GOOGLE_CLIENT_ID as string | undefined;

  if (fromPublic) return fromPublic;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();

  throw new Error(
    "Falta googleClientId en public/naju.config.json (recomendado para distribución) o VITE_GOOGLE_CLIENT_ID en .env."
  );
}


function nowMs() {
  return Date.now();
}

function saveToken(token: string, expiresInSec?: number, scopes?: string[]) {
  const exp = expiresInSec
    ? nowMs() + Math.max(30, expiresInSec - 30) * 1000
    : nowMs() + 45 * 60 * 1000;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EXP_KEY, String(exp));
  if (scopes && scopes.length) localStorage.setItem(SCOPE_KEY, JSON.stringify(scopes));
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXP_KEY);
  localStorage.removeItem(SCOPE_KEY);
}

function readToken(): { token: string | null; expiresAt: number | null; scopes: string[] | null } {
  const token = localStorage.getItem(TOKEN_KEY);
  const expRaw = localStorage.getItem(EXP_KEY);
  const expiresAt = expRaw ? Number(expRaw) : null;
  let scopes: string[] | null = null;
  try {
    const s = localStorage.getItem(SCOPE_KEY);
    scopes = s ? (JSON.parse(s) as string[]) : null;
  } catch {
    scopes = null;
  }

  if (!token || !expiresAt) return { token: null, expiresAt: null, scopes };
  if (Number.isNaN(expiresAt)) return { token: null, expiresAt: null, scopes };
  if (nowMs() > expiresAt) return { token: null, expiresAt: null, scopes };
  return { token, expiresAt, scopes };
}

export function getGoogleStatus(): GoogleStatus {
  const { token, expiresAt, scopes } = readToken();
  return { connected: !!token, expiresAt, scopes };
}

function ensureGisLoaded() {
  const google = (window as any).google;
  if (!google?.accounts?.oauth2?.initTokenClient) {
    throw new Error("Google Identity Services no está cargado. Revisa index.html.");
  }
  return google;
}

export async function connectGoogleInteractive(scopes: string[] = DEFAULT_SCOPES): Promise<GoogleStatus> {
  const google = ensureGisLoaded();
  const scopeStr = scopes.join(" ");
  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: await resolveClientId(),
    scope: scopeStr,
    prompt: "consent",
    callback: (_resp: any) => _resp,
  });

  const resp: any = await new Promise((resolve, reject) => {
    try {
      tokenClient.callback = (r: any) => resolve(r);
      tokenClient.requestAccessToken({ prompt: "consent" });
    } catch (e) {
      reject(e);
    }
  });

  if (!resp?.access_token) {
    throw new Error(resp?.error_description || resp?.error || "No se pudo obtener token de Google.");
  }

  saveToken(resp.access_token, resp.expires_in, scopes);
  return getGoogleStatus();
}

export function disconnectGoogle() {
  clearToken();
  localStorage.removeItem(DRIVE_ROOT_KEY);
}

async function googleFetch(url: string, init?: RequestInit) {
  const { token } = readToken();
  if (!token) throw new Error("Google no está conectado o el token expiró.");
  const headers = new Headers(init?.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return fetch(url, { ...init, headers });
}

function base64FromArrayBuffer(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function driveFindFolderByName(name: string, parentId: string | null) {
  const qParts = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${name.replace(/'/g, "\\'")}'`,
    "trashed=false",
  ];
  if (parentId) qParts.push(`'${parentId}' in parents`);
  else qParts.push("'root' in parents");
  const q = qParts.join(" and ");
  const url =
    "https://www.googleapis.com/drive/v3/files?fields=files(id,name)&pageSize=10&q=" +
    encodeURIComponent(q);
  const res = await googleFetch(url, { method: "GET" });
  const data = await res.json();
  const files = Array.isArray(data?.files) ? data.files : [];
  return files[0]?.id ? (files[0].id as string) : null;
}

async function driveCreateFolder(name: string, parentId: string | null) {
  const body: any = { name, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) body.parents = [parentId];
  const url = "https://www.googleapis.com/drive/v3/files?fields=id,name";
  const res = await googleFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("No se pudo crear carpeta en Drive.");
  const data = await res.json();
  return data.id as string;
}

export async function ensureRootDriveFolder(): Promise<string> {
  const cached = localStorage.getItem(DRIVE_ROOT_KEY);
  if (cached) return cached;
  const name = "NAJU - Pacientes";
  let id = await driveFindFolderByName(name, null);
  if (!id) id = await driveCreateFolder(name, null);
  localStorage.setItem(DRIVE_ROOT_KEY, id);
  return id;
}

export async function ensurePatientDriveFolder(
  patientId: string,
  patientName: string,
  rootFolderId?: string
): Promise<string> {
  const root = rootFolderId || (await ensureRootDriveFolder());
  const folderName = `${patientName} (${patientId})`;
  let id = await driveFindFolderByName(folderName, root);
  if (!id) id = await driveCreateFolder(folderName, root);
  return id;
}

export async function driveListFolderFiles(folderId: string): Promise<DriveFile[]> {
  const q = `'${folderId}' in parents and trashed=false`;
  const url =
    "https://www.googleapis.com/drive/v3/files?fields=files(id,name,mimeType,webViewLink,createdTime,size)&orderBy=createdTime desc&pageSize=50&q=" +
    encodeURIComponent(q);
  const res = await googleFetch(url, { method: "GET" });
  if (!res.ok) throw new Error("No se pudieron listar archivos de Drive.");
  const data = await res.json();
  return Array.isArray(data?.files) ? (data.files as DriveFile[]) : [];
}

export async function driveUploadMultipart(folderId: string, file: File): Promise<DriveFile> {
  const boundary = "-------naju_drive_boundary_" + Math.random().toString(16).slice(2);
  const metadata: any = { name: file.name, parents: [folderId] };
  const fileB64 = base64FromArrayBuffer(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${fileB64}\r\n` +
    `--${boundary}--`;

  const url =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,createdTime,size";

  const res = await googleFetch(url, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`No se pudo subir a Drive. ${txt ? txt.slice(0, 160) : ""}`.trim());
  }

  return (await res.json()) as DriveFile;
}

function eventHasPatient(event: CalendarEvent, patientId: string) {
  const ext = event?.extendedProperties?.private;
  if (ext?.najuPatientId && ext.najuPatientId === patientId) return true;
  const desc = event?.description || "";
  return desc.includes(`NAJU_PATIENT_ID=${patientId}`);
}

function eventIsNaju(event: CalendarEvent) {
  const ext = event?.extendedProperties?.private;
  if (ext?.najuPatientId) return true;
  const desc = event?.description || "";
  return desc.includes("NAJU_PATIENT_ID=");
}

export async function calendarCreatePatientEvent(args: {
  patientId: string;
  patientName: string;
  startISO: string;
  endISO: string;
  title?: string;
  notes?: string;
}): Promise<CalendarEvent> {
  const { patientId, patientName, startISO, endISO, title, notes } = args;
  const summary = title && title.trim() ? title.trim() : `Cita - ${patientName}`;
  const desc = [notes?.trim() ? notes.trim() : "", `NAJU_PATIENT_ID=${patientId}`]
    .filter(Boolean)
    .join("\n\n");

  const body: any = {
    summary,
    description: desc,
    start: { dateTime: startISO },
    end: { dateTime: endISO },
    extendedProperties: { private: { najuPatientId: patientId } },
  };

  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?fields=id,summary,description,htmlLink,start,end,extendedProperties";

  const res = await googleFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error("No se pudo crear la cita en Google Calendar.");
  return (await res.json()) as CalendarEvent;
}

export async function calendarListForPatient(args: {
  patientId: string;
  timeMinISO: string;
  timeMaxISO: string;
}): Promise<CalendarEvent[]> {
  const { patientId, timeMinISO, timeMaxISO } = args;
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50" +
    `&timeMin=${encodeURIComponent(timeMinISO)}` +
    `&timeMax=${encodeURIComponent(timeMaxISO)}` +
    "&fields=items(id,summary,description,htmlLink,start,end,extendedProperties)";

  const res = await googleFetch(url, { method: "GET" });
  if (!res.ok) throw new Error("No se pudieron listar las citas del paciente.");
  const data = await res.json();
  const items: CalendarEvent[] = Array.isArray(data?.items) ? data.items : [];
  return items.filter((ev) => eventHasPatient(ev, patientId));
}

export async function calendarListUpcoming(args: {
  timeMinISO: string;
  timeMaxISO: string;
}): Promise<CalendarEvent[]> {
  const { timeMinISO, timeMaxISO } = args;
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=120" +
    `&timeMin=${encodeURIComponent(timeMinISO)}` +
    `&timeMax=${encodeURIComponent(timeMaxISO)}` +
    "&fields=items(id,summary,description,htmlLink,start,end,extendedProperties)";

  const res = await googleFetch(url, { method: "GET" });
  if (!res.ok) throw new Error("No se pudieron listar las citas.");
  const data = await res.json();
  const items: CalendarEvent[] = Array.isArray(data?.items) ? data.items : [];
  return items.filter((ev) => eventIsNaju(ev));
}
