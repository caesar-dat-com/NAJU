import React, { useEffect, useMemo, useState } from "react";
import "./styles.css";
import { api, type Patient, type PatientDetail, type PatientInput, type MseInput } from "./lib/api";
import { open } from "@tauri-apps/api/shell";
import { open as openDialog } from "@tauri-apps/api/dialog";
import { convertFileSrc } from "@tauri-apps/api/tauri";

type TabKey = "resumen" | "examenes" | "archivos";

function calcAge(dob?: string | null) {
  if (!dob) return "";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "";
  const t = new Date();
  let age = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
  return String(age);
}

function safeMeta(p: Patient) {
  const doc = [p.document_type, p.document_number].filter(Boolean).join(" ");
  const age = calcAge(p.date_of_birth);
  const bits = [
    doc ? `📄 ${doc}` : "",
    p.date_of_birth ? `🎂 ${p.date_of_birth}${age ? ` · ${age} años` : ""}` : "",
    p.sex ? `🧬 ${p.sex}` : "",
    p.phone ? `📞 ${p.phone}` : "",
    p.email ? `✉️ ${p.email}` : "",
    p.insurance ? `🏥 ${p.insurance}` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

function Modal({ open, onClose, title, children, footer }: any) {
  if (!open) return null;
  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h3>{title}</h3>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody">{children}</div>
        <div className="modalFooter">{footer}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [tab, setTab] = useState<TabKey>("resumen");

  const [openPatientForm, setOpenPatientForm] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);

  const [openMse, setOpenMse] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  async function refresh() {
    const list = await api.listPatients(query);
    setPatients(list);
  }

  useEffect(() => { refresh(); }, [query]);

  async function loadDetail(id: string) {
    setSelectedId(id);
    const d = await api.getDetail(id);
    setDetail(d);
    setTab("resumen");
  }

  const showList = selectedId === null;

  const selectedPhotoSrc = useMemo(() => {
    if (!detail?.photo_path) return null;
    return convertFileSrc(detail.photo_path);
  }, [detail?.photo_path]);

  async function pickAndSetPhoto() {
    if (!selectedId) return;
    const f = await openDialog({ multiple: false, filters: [{ name: "Imagen", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (!f || Array.isArray(f)) return;
    await api.setPhoto(selectedId, f);
    await loadDetail(selectedId);
    await refresh();
  }

  async function pickAndImportFiles() {
    if (!selectedId) return;
    const f = await openDialog({ multiple: true });
    if (!f) return;
    const files = Array.isArray(f) ? f : [f];
    await api.importFiles(selectedId, files);
    await loadDetail(selectedId);
  }

  async function openPatientFolder() {
    if (!detail?.folder) return;
    await open(detail.folder);
  }

  async function openFile(name: string) {
    if (!detail?.folder) return;
    await open(`${detail.folder}\\${name}`);
  }

  async function submitPatient(input: PatientInput) {
    if (editing) {
      await api.updatePatient(editing.id, input);
    } else {
      const created = await api.createPatient(input);
      await refresh();
      await loadDetail(created.id);
    }
    setOpenPatientForm(false);
    setEditing(null);
  }

  async function submitMse(mse: MseInput) {
    if (!selectedId) return;
    await api.createMse(selectedId, mse);
    setOpenMse(false);
    await loadDetail(selectedId);
  }

  return (
    <div className="shell">
      {showList && (
        <div className="panel left">
          <div className="topbar">
            <div className="brand">
              <h1>naju</h1>
              <p>gestor local de pacientes · estética tierra</p>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? "☀️" : "🌙"}
              </button>
              <button className="btn primary" onClick={() => { setEditing(null); setOpenPatientForm(true); }}>
                + paciente
              </button>
            </div>
          </div>

          <div style={{ padding: "0 18px 12px" }}>
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="buscar por nombre o documento…" />
          </div>

          <div className="grid">
            {patients.map((p) => {
              const age = calcAge(p.date_of_birth);
              const doc = [p.document_type, p.document_number].filter(Boolean).join(" ");
              return (
                <div key={p.id} className="card" onClick={() => loadDetail(p.id)}>
                  <div className="cardVisual">
                    <div className="badge">{age ? `${age} años` : "paciente"}</div>
                  </div>
                  <div className="cardBody">
                    <h3>{p.full_name}</h3>
                    <p>{doc || "sin documento"} · {p.insurance || "sin seguro"}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* RIGHT: panel detalle (siempre) */}
      <div className="panel right">
        {!detail ? (
          <div className="section">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: "ui-serif", fontWeight: 500, textTransform: "lowercase" }}>
                  selecciona un paciente
                </h2>
                <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
                  aquí verás el perfil, exámenes y archivos.
                </p>
              </div>
              <button className="btn primary" onClick={() => { setEditing(null); setOpenPatientForm(true); }}>
                + paciente
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="detailHeader">
              <div className="avatar">
                {selectedPhotoSrc ? <img src={selectedPhotoSrc} alt="foto paciente" /> : null}
              </div>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="detailTitle">
                    <h2>{detail.patient.full_name}</h2>
                    <div className="meta">{safeMeta(detail.patient) || "sin datos principales aún"}</div>
                  </div>
                  <div className="row">
                    <button className="btn" onClick={() => { setSelectedId(null); setDetail(null); }}>← pacientes</button>
                    <button className="btn" onClick={() => { setEditing(detail.patient); setOpenPatientForm(true); }}>editar</button>
                    <button className="btn" onClick={pickAndSetPhoto}>foto</button>
                    <button className="btn" onClick={pickAndImportFiles}>adjuntar</button>
                    <button className="btn" onClick={openPatientFolder}>carpeta</button>
                    <button className="btn primary" onClick={() => setOpenMse(true)}>+ examen mental</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="pills">
              <div className={"pill " + (tab === "resumen" ? "active" : "")} onClick={() => setTab("resumen")}>Resumen</div>
              <div className={"pill " + (tab === "examenes" ? "active" : "")} onClick={() => setTab("examenes")}>Exámenes</div>
              <div className={"pill " + (tab === "archivos" ? "active" : "")} onClick={() => setTab("archivos")}>Archivos</div>
            </div>

            {tab === "resumen" && (
              <div className="section">
                <div className="fieldGrid">
                  <div>
                    <label>Tipo documento</label>
                    <div className="input">{detail.patient.document_type || "—"}</div>
                  </div>
                  <div>
                    <label>Número documento</label>
                    <div className="input">{detail.patient.document_number || "—"}</div>
                  </div>
                  <div>
                    <label>Fecha nacimiento</label>
                    <div className="input">{detail.patient.date_of_birth || "—"}</div>
                  </div>
                  <div>
                    <label>Sexo</label>
                    <div className="input">{detail.patient.sex || "—"}</div>
                  </div>
                  <div>
                    <label>Teléfono</label>
                    <div className="input">{detail.patient.phone || "—"}</div>
                  </div>
                  <div>
                    <label>Correo</label>
                    <div className="input">{detail.patient.email || "—"}</div>
                  </div>
                  <div>
                    <label>Seguro / EPS</label>
                    <div className="input">{detail.patient.insurance || "—"}</div>
                  </div>
                  <div>
                    <label>Contacto de emergencia</label>
                    <div className="input">{detail.patient.emergency_contact || "—"}</div>
                  </div>
                </div>

                <div>
                  <label>Notas</label>
                  <div className="input" style={{ minHeight: 92, whiteSpace: "pre-wrap" }}>
                    {detail.patient.notes || "—"}
                  </div>
                </div>
              </div>
            )}

            {tab === "examenes" && (
              <div className="section">
                {detail.exams.length === 0 ? (
                  <div style={{ color: "var(--muted)" }}>Aún no hay exámenes. Crea uno con “+ examen mental”.</div>
                ) : (
                  detail.exams.map((x) => (
                    <div key={x} className="row" style={{ justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontWeight: 650 }}>{x}</div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>doble click / abrir archivo</div>
                      </div>
                      <button className="btn" onClick={() => openFile(x)}>abrir</button>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === "archivos" && (
              <div className="section">
                {detail.files.length === 0 ? (
                  <div style={{ color: "var(--muted)" }}>No hay archivos adjuntos todavía.</div>
                ) : (
                  detail.files.map((x) => (
                    <div key={x} className="row" style={{ justifyContent: "space-between" }}>
                      <div style={{ fontWeight: 650 }}>{x}</div>
                      <button className="btn" onClick={() => openFile(x)}>abrir</button>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* MODAL: Paciente (selectores + calendario real) */}
      <PatientFormModal
        open={openPatientForm}
        onClose={() => { setOpenPatientForm(false); setEditing(null); }}
        initial={editing}
        onSubmit={submitPatient}
      />

      {/* MODAL: Examen mental formal */}
      <MseModal
        open={openMse}
        onClose={() => setOpenMse(false)}
        onSubmit={submitMse}
      />
    </div>
  );
}

function PatientFormModal({
  open, onClose, initial, onSubmit
}: {
  open: boolean;
  onClose: () => void;
  initial: Patient | null;
  onSubmit: (input: PatientInput) => Promise<void>;
}) {
  const [v, setV] = useState<PatientInput>({
    full_name: "", document_type: null, document_number: null, date_of_birth: null, sex: null, phone: null, email: null, address: null, insurance: null, emergency_contact: null, notes: null,
  });

  useEffect(() => {
    if (initial) {
      setV({
        full_name: initial.full_name || "",
        document_type: initial.document_type ?? null,
        document_number: initial.document_number ?? null,
        date_of_birth: initial.date_of_birth ?? null,
        sex: initial.sex ?? null,
        phone: initial.phone ?? null,
        email: initial.email ?? null,
        address: initial.address ?? null,
        insurance: initial.insurance ?? null,
        emergency_contact: initial.emergency_contact ?? null,
        notes: initial.notes ?? null,
      });
    } else {
      setV({
        full_name: "", document_type: "CC", document_number: "", date_of_birth: "", sex: "No especifica", phone: "", email: "", address: "", insurance: "", emergency_contact: "", notes: "",
      } as any);
    }
  }, [initial, open]);

  const title = initial ? "editar paciente" : "crear paciente";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onClose}>cancelar</button>
          <button
            className="btn primary"
            onClick={async () => {
              if (!v.full_name.trim()) return;
              await onSubmit({ ...v, full_name: v.full_name.trim() });
            }}
          >
            guardar
          </button>
        </>
      }
    >
      <div className="fieldGrid">
        <div>
          <label>Nombre completo *</label>
          <input className="input" value={v.full_name ?? ""} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
        </div>
        <div>
          <label>Tipo documento</label>
          <select className="input" value={v.document_type ?? ""} onChange={(e) => setV({ ...v, document_type: e.target.value })}>
            <option value="CC">CC</option>
            <option value="TI">TI</option>
            <option value="CE">CE</option>
            <option value="Pasaporte">Pasaporte</option>
          </select>
        </div>
        <div>
          <label>Número documento</label>
          <input className="input" value={v.document_number ?? ""} onChange={(e) => setV({ ...v, document_number: e.target.value })} />
        </div>
        <div>
          <label>Fecha nacimiento</label>
          <input className="input" type="date" value={v.date_of_birth ?? ""} onChange={(e) => setV({ ...v, date_of_birth: e.target.value })} />
        </div>
        <div>
          <label>Sexo</label>
          <select className="input" value={v.sex ?? ""} onChange={(e) => setV({ ...v, sex: e.target.value })}>
            <option value="No especifica">No especifica</option>
            <option value="Femenino">Femenino</option>
            <option value="Masculino">Masculino</option>
            <option value="Otro">Otro</option>
          </select>
        </div>
        <div>
          <label>Teléfono</label>
          <input className="input" value={v.phone ?? ""} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </div>
        <div>
          <label>Correo</label>
          <input className="input" value={v.email ?? ""} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </div>
        <div>
          <label>Dirección</label>
          <input className="input" value={v.address ?? ""} onChange={(e) => setV({ ...v, address: e.target.value })} />
        </div>
        <div>
          <label>EPS / Seguro</label>
          <input className="input" value={v.insurance ?? ""} onChange={(e) => setV({ ...v, insurance: e.target.value })} />
        </div>
        <div>
          <label>Contacto emergencia</label>
          <input className="input" value={v.emergency_contact ?? ""} onChange={(e) => setV({ ...v, emergency_contact: e.target.value })} />
        </div>
      </div>
      <div>
        <label>Notas</label>
        <textarea className="input" value={v.notes ?? ""} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </div>
    </Modal>
  );
}

function MseModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (m: MseInput) => Promise<void> }) {
  const [m, setM] = useState<MseInput>({});
  useEffect(() => { if (open) setM({}); }, [open]);
  function t(key: keyof MseInput, label: string) {
    return (
      <div key={key}>
        <label>{label}</label>
        <textarea className="input" value={(m[key] as any) ?? ""} onChange={(e) => setM({ ...m, [key]: e.target.value })} />
      </div>
    );
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="examen mental formal"
      footer={
        <>
          <button className="btn" onClick={onClose}>cancelar</button>
          <button className="btn primary" onClick={async () => { await onSubmit(m); }}>guardar examen</button>
        </>
      }
    >
      <div className="fieldGrid">
        {t("appearance", "Apariencia")}
        {t("behavior", "Conducta")}
        {t("attitude", "Actitud")}
        {t("speech", "Lenguaje / Habla")}
        {t("mood", "Ánimo (Mood)")}
        {t("affect", "Afecto")}
        {t("thought_process", "Pensamiento: curso / forma")}
        {t("thought_content", "Pensamiento: contenido")}
        {t("perception", "Percepción (alucinaciones/ilusiones)")}
        {t("cognition_orientation", "Cognición: orientación")}
        {t("cognition_attention", "Cognición: atención")}
        {t("cognition_memory", "Cognición: memoria")}
        {t("insight", "Insight / conciencia de enfermedad")}
        {t("judgment", "Juicio")}
        {t("risk_suicide", "Riesgo suicida")}
        {t("risk_homicide", "Riesgo homicida")}
        {t("risk_self_harm", "Autolesión")}
        {t("risk_violence", "Violencia")}
        {t("sleep", "Sueño")}
        {t("appetite", "Apetito")}
        {t("substance_use", "Consumo de sustancias")}
        {t("diagnosis_impression", "Impresión diagnóstica")}
        {t("plan", "Plan")}
      </div>
      {t("clinician_notes", "Notas del clínico")}
    </Modal>
  );
}
