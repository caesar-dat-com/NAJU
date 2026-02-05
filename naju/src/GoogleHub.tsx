import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Patient } from "./lib/api";
import {
  CalendarEvent,
  DriveFile,
  connectGoogleInteractive,
  disconnectGoogle,
  getGoogleStatus,
  ensureRootDriveFolder,
  ensurePatientDriveFolder,
  driveListFolderFiles,
  driveUploadMultipart,
  calendarCreatePatientEvent,
  calendarListForPatient,
  calendarListUpcoming,
} from "./lib/google";

type NotifyFn = (type: "ok" | "err", msg: string) => void;

type Props = {
  open: boolean;
  onClose: () => void;
  patients: Patient[];
  selected: Patient | null;
  onPickPatient: (patientId: string) => void;
  onSetDriveFolder: (patientId: string, folderId: string | null) => Promise<void>;
  onCreateAttachmentLink: (patientId: string, filename: string, url: string, meta?: any) => Promise<void>;
  onRefreshPatientFiles: (patientId: string) => Promise<void>;
  notify: NotifyFn;
};

function eventStartMs(ev: CalendarEvent) {
  const s = ev?.start?.dateTime || (ev?.start?.date ? `${ev.start.date}T00:00:00` : "");
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
}

function niceDateTime(ev: CalendarEvent) {
  const s = ev?.start?.dateTime || (ev?.start?.date ? `${ev.start.date}T00:00:00` : "");
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function extractPatientId(ev: CalendarEvent): string | null {
  const ext = ev?.extendedProperties?.private;
  if (ext?.najuPatientId) return ext.najuPatientId;
  const desc = ev?.description || "";
  const m = desc.match(/NAJU_PATIENT_ID=([a-zA-Z0-9_-]+)/);
  return m?.[1] || null;
}

function groupByDay(events: CalendarEvent[]) {
  const map = new Map<string, CalendarEvent[]>();
  events.forEach((ev) => {
    const ms = eventStartMs(ev);
    const d = ms ? new Date(ms) : new Date();
    const key = d.toLocaleDateString();
    const arr = map.get(key) || [];
    arr.push(ev);
    map.set(key, arr);
  });
  return Array.from(map.entries()).map(([day, items]) => ({
    day,
    items: items.slice().sort((a, b) => eventStartMs(a) - eventStartMs(b)),
  }));
}

export default function GoogleHub(props: Props) {
  const {
    open,
    onClose,
    patients,
    selected,
    onPickPatient,
    onSetDriveFolder,
    onCreateAttachmentLink,
    onRefreshPatientFiles,
    notify,
  } = props;

  const [tab, setTab] = useState<"agenda" | "paciente">("agenda");
  const [status, setStatus] = useState(() => getGoogleStatus());
  const connected = status.connected;

  const [busy, setBusy] = useState(false);
  const [agendaEvents, setAgendaEvents] = useState<CalendarEvent[]>([]);
  const [patientEvents, setPatientEvents] = useState<CalendarEvent[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const patientNameById = useMemo(() => {
    const m = new Map<string, string>();
    patients.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [patients]);

  const agendaGroups = useMemo(() => groupByDay(agendaEvents), [agendaEvents]);
  const patientGroups = useMemo(() => groupByDay(patientEvents), [patientEvents]);

  const [apptStart, setApptStart] = useState("");
  const [apptMinutes, setApptMinutes] = useState("60");
  const [apptTitle, setApptTitle] = useState("");
  const [apptNotes, setApptNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setStatus(getGoogleStatus());
    setTab(selected ? "paciente" : "agenda");
  }, [open, selected?.id]);

  async function connect() {
    try {
      setBusy(true);
      await connectGoogleInteractive();
      setStatus(getGoogleStatus());
      notify("ok", "Google conectado");
    } catch (e: any) {
      notify("err", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    try {
      disconnectGoogle();
      setStatus(getGoogleStatus());
      setAgendaEvents([]);
      setPatientEvents([]);
      setDriveFiles([]);
      notify("ok", "Google desconectado");
    } catch (e: any) {
      notify("err", e?.message || String(e));
    }
  }

  async function refreshAgenda() {
    if (!connected) return;
    try {
      setBusy(true);
      const now = new Date();
      const timeMinISO = now.toISOString();
      const future = new Date(now.getTime());
      future.setDate(future.getDate() + 30);
      const timeMaxISO = future.toISOString();
      const items = await calendarListUpcoming({ timeMinISO, timeMaxISO });
      setAgendaEvents(items);
    } catch (e: any) {
      notify("err", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshPatientSide() {
    if (!connected || !selected) return;
    try {
      setBusy(true);

      const now = new Date();
      const past = new Date(now.getTime());
      past.setDate(past.getDate() - 90);
      const future = new Date(now.getTime());
      future.setDate(future.getDate() + 365);

      const events = await calendarListForPatient({
        patientId: selected.id,
        timeMinISO: past.toISOString(),
        timeMaxISO: future.toISOString(),
      });
      setPatientEvents(events);

      const rootId = await ensureRootDriveFolder();
      let folderId = (selected as any).drive_folder_id as string | null | undefined;
      if (!folderId) {
        folderId = await ensurePatientDriveFolder(selected.id, selected.name, rootId);
        await onSetDriveFolder(selected.id, folderId);
      }
      const files = await driveListFolderFiles(folderId);
      setDriveFiles(files);
    } catch (e: any) {
      notify("err", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    if (tab === "agenda") {
      if (connected) refreshAgenda();
    } else {
      if (connected && selected) refreshPatientSide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, connected, selected?.id]);

  async function createAppointment() {
    if (!selected) return;
    if (!connected) return notify("err", "Conecta Google para agendar");

    const startLocal = (apptStart || "").trim();
    if (!startLocal) return notify("err", "Selecciona inicio");

    const minutes = Math.max(5, Number(apptMinutes || "60") || 60);
    const start = new Date(startLocal);
    if (Number.isNaN(start.getTime())) return notify("err", "Fecha/hora inválida");
    const end = new Date(start.getTime() + minutes * 60 * 1000);

    try {
      setBusy(true);
      await calendarCreatePatientEvent({
        patientId: selected.id,
        patientName: selected.name,
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        title: apptTitle,
        notes: apptNotes,
      });
      notify("ok", "Cita agendada");
      await refreshAgenda();
      await refreshPatientSide();
    } catch (e: any) {
      notify("err", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function triggerUpload() {
    if (!selected) return notify("err", "Selecciona un paciente");
    if (!connected) return notify("err", "Conecta Google para usar Drive");
    uploadRef.current?.click();
  }

  async function onUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!selected) return;
    const list = Array.from(e.target.files || []);
    e.target.value = "";
    if (!list.length) return;

    try {
      setBusy(true);
      const rootId = await ensureRootDriveFolder();
      let folderId = (selected as any).drive_folder_id as string | null | undefined;
      if (!folderId) {
        folderId = await ensurePatientDriveFolder(selected.id, selected.name, rootId);
        await onSetDriveFolder(selected.id, folderId);
      }

      for (const f of list) {
        const uploaded = await driveUploadMultipart(folderId!, f);
        if (uploaded.webViewLink) {
          await onCreateAttachmentLink(selected.id, f.name, uploaded.webViewLink, {
            external: true,
            provider: "drive",
            driveFileId: uploaded.id,
          });
        }
      }

      await onRefreshPatientFiles(selected.id);
      await refreshPatientSide();
      notify("ok", "Archivo(s) subido(s) y vinculado(s)");
    } catch (e: any) {
      notify("err", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function linkDriveFile(df: DriveFile) {
    if (!selected) return;
    if (!df.webViewLink) return;
    try {
      setBusy(true);
      await onCreateAttachmentLink(selected.id, df.name, df.webViewLink, {
        external: true,
        provider: "drive",
        driveFileId: df.id,
      });
      await onRefreshPatientFiles(selected.id);
      notify("ok", "Archivo vinculado");
    } catch (e: any) {
      notify("err", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <h3>Google</h3>
            <p>
              {selected
                ? `Paciente: ${selected.name} · Citas (Calendar) y Archivos (Drive)`
                : "Agenda global (Calendar) y Drive"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {!connected ? (
              <button className="pillBtn primary" onClick={connect} disabled={busy}>
                Conectar
              </button>
            ) : (
              <button className="pillBtn" onClick={disconnect} disabled={busy}>
                Desconectar
              </button>
            )}
            <button className="pillBtn" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>

        <div className="modalBody">
          <div className="segWrap" style={{ marginTop: 6 }}>
            <div className="segmented" role="navigation" aria-label="Google">
              <button className="segBtn" aria-current={tab === "agenda"} onClick={() => setTab("agenda")}>
                Agenda
              </button>
              <button
                className="segBtn"
                aria-current={tab === "paciente"}
                onClick={() => setTab("paciente")}
                disabled={!selected}
              >
                Paciente
              </button>
            </div>
          </div>

          {!connected ? (
            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Conecta tu cuenta</div>
              <div style={{ color: "var(--muted)", lineHeight: 1.6 }}>
                Para usar Drive y Calendar, el producto debe incluir su Client ID de Google.
                Configúralo en <b>public/naju.config.json</b> (campo <b>googleClientId</b>).
              </div>
              <div style={{ height: 12 }} />
              <button className="pillBtn primary" onClick={connect} disabled={busy}>
                Conectar Google
              </button>
            </div>
          ) : tab === "agenda" ? (
            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>Agenda (próximos 30 días)</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    Citas creadas desde NAJU en tu Google Calendar.
                  </div>
                </div>
                <button className="pillBtn" onClick={refreshAgenda} disabled={busy}>
                  Refrescar
                </button>
              </div>

              <div style={{ height: 12 }} />

              {agendaEvents.length === 0 ? (
                <div style={{ color: "var(--muted)" }}>Aún no hay citas.</div>
              ) : (
                agendaGroups.map((g) => (
                  <div key={g.day} style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>{g.day}</div>
                    <div className="list">
                      {g.items.map((ev) => {
                        const pid = extractPatientId(ev);
                        const pname = pid ? patientNameById.get(pid) || "Paciente" : "Paciente";
                        return (
                          <div key={ev.id} className="fileRow">
                            <div className="fileIcon">📅</div>
                            <div className="fileMeta">
                              <div className="fileName">{(ev.summary || "Cita") + " · " + pname}</div>
                              <div className="fileSub">{niceDateTime(ev)}</div>
                            </div>
                            {pid ? (
                              <button
                                className="smallBtn"
                                onClick={() => {
                                  onPickPatient(pid);
                                  setTab("paciente");
                                }}
                              >
                                Ir
                              </button>
                            ) : null}
                            {ev.htmlLink ? (
                              <a className="smallBtn" href={ev.htmlLink} target="_blank" rel="noreferrer">
                                Abrir
                              </a>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="grid2" style={{ marginTop: 12 }}>
              <input ref={uploadRef} type="file" multiple onChange={onUploadChange} style={{ display: "none" }} />

              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>Agendar cita</div>
                    <div style={{ color: "var(--muted)", fontSize: 13 }}>Se guarda en tu Google Calendar.</div>
                  </div>
                  <button className="pillBtn" onClick={refreshPatientSide} disabled={busy}>
                    Refrescar
                  </button>
                </div>

                <div style={{ height: 12 }} />

                <div style={{ display: "grid", gap: 10 }}>
                  <div className="grid2" style={{ gridTemplateColumns: "1fr 140px" }}>
                    <label className="field">
                      <div className="label">Inicio</div>
                      <input
                        className="input"
                        type="datetime-local"
                        value={apptStart}
                        onChange={(e) => setApptStart(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <div className="label">Minutos</div>
                      <input
                        className="input"
                        type="number"
                        min={5}
                        step={5}
                        value={apptMinutes}
                        onChange={(e) => setApptMinutes(e.target.value)}
                      />
                    </label>
                  </div>

                  <label className="field">
                    <div className="label">Título</div>
                    <input
                      className="input"
                      value={apptTitle}
                      onChange={(e) => setApptTitle(e.target.value)}
                      placeholder={selected ? `Cita - ${selected.name}` : "Cita"}
                    />
                  </label>

                  <label className="field">
                    <div className="label">Notas</div>
                    <textarea
                      className="textarea"
                      value={apptNotes}
                      onChange={(e) => setApptNotes(e.target.value)}
                      placeholder="Motivo, acuerdos, etc."
                    />
                  </label>

                  <button className="pillBtn primary" onClick={createAppointment} disabled={busy}>
                    Agendar
                  </button>
                </div>
              </div>

              <div className="card">
                <div>
                  <div style={{ fontWeight: 800 }}>Citas del paciente</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>Eventos NAJU asociados al paciente.</div>
                </div>

                <div style={{ height: 12 }} />

                {patientEvents.length === 0 ? (
                  <div style={{ color: "var(--muted)" }}>Aún no hay citas.</div>
                ) : (
                  patientGroups.map((g) => (
                    <div key={g.day} style={{ marginBottom: 14 }}>
                      <div style={{ fontWeight: 800, marginBottom: 8 }}>{g.day}</div>
                      <div className="list">
                        {g.items.map((ev) => (
                          <div key={ev.id} className="fileRow">
                            <div className="fileIcon">📅</div>
                            <div className="fileMeta">
                              <div className="fileName">{ev.summary || "Cita"}</div>
                              <div className="fileSub">{niceDateTime(ev)}</div>
                            </div>
                            {ev.htmlLink ? (
                              <a className="smallBtn" href={ev.htmlLink} target="_blank" rel="noreferrer">
                                Abrir
                              </a>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}

                <div style={{ height: 14 }} />
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>Drive</div>
                      <div style={{ color: "var(--muted)", fontSize: 13 }}>
                        Carpeta por paciente dentro de “NAJU - Pacientes”.
                      </div>
                    </div>
                    <button className="pillBtn primary" onClick={triggerUpload} disabled={busy}>
                      Subir archivo
                    </button>
                  </div>

                  <div style={{ height: 12 }} />

                  {driveFiles.length === 0 ? (
                    <div style={{ color: "var(--muted)" }}>Aún no hay archivos en Drive.</div>
                  ) : (
                    <div className="list">
                      {driveFiles.map((df) => (
                        <div key={df.id} className="fileRow">
                          <div className="fileIcon">📎</div>
                          <div className="fileMeta">
                            <div className="fileName">{df.name}</div>
                            <div className="fileSub">
                              {df.createdTime ? new Date(df.createdTime).toLocaleString() : ""}
                            </div>
                          </div>
                          {df.webViewLink ? (
                            <>
                              <button className="smallBtn" onClick={() => linkDriveFile(df)} disabled={busy}>
                                Vincular
                              </button>
                              <a className="smallBtn" href={df.webViewLink} target="_blank" rel="noreferrer">
                                Abrir
                              </a>
                            </>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
