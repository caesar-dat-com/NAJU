import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import {
  Patient,
  PatientFile,
  PatientInput,
  createMentalExam,
  createPatient,
  deletePatient,
  importFiles,
  listPatientFiles,
  listPatients,
  openPath,
  openPatientFolder,
  setPatientPhoto,
  updatePatient,
} from "./lib/api";

import { open } from "@tauri-apps/api/dialog";
import { convertFileSrc } from "@tauri-apps/api/tauri";

type Section = "resumen" | "examenes" | "archivos";

type Toast = { type: "ok" | "err"; msg: string } | null;

function errMsg(e: any) {
  if (!e) return "Error desconocido";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

function startVT(fn: () => void) {
  const d: any = document;
  if (d.startViewTransition) d.startViewTransition(fn);
  else fn();
}

function isoToNice(iso: string) {
  try {
    const dt = new Date(iso);
    return dt.toLocaleString();
  } catch {
    return iso;
  }
}

function calcAge(birth: string | null) {
  if (!birth) return null;
  const d = new Date(birth + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return Math.max(0, age);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

function valOrDash(v: string | null | undefined) {
  const t = (v ?? "").trim();
  return t.length ? t : "—";
}

function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="pillBtn" onClick={onClose} aria-label="Cerrar">
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PatientForm({
  initial,
  onSave,
  onCancel,
  saveLabel,
  extraRight,
}: {
  initial: PatientInput;
  onSave: (v: PatientInput) => Promise<void>;
  onCancel: () => void;
  saveLabel: string;
  extraRight?: React.ReactNode;
}) {
  const [v, setV] = useState<PatientInput>(initial);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof PatientInput>(k: K, value: PatientInput[K]) {
    setV((p) => ({ ...p, [k]: value }));
  }

  async function submit() {
    if (!v.name?.trim()) return;
    setBusy(true);
    try {
      await onSave({
        name: v.name.trim(),
        doc_type: v.doc_type ?? null,
        doc_number: v.doc_number ?? null,
        insurer: v.insurer ?? null,
        birth_date: v.birth_date ?? null,
        sex: v.sex ?? null,
        phone: v.phone ?? null,
        email: v.email ?? null,
        address: v.address ?? null,
        emergency_contact: v.emergency_contact ?? null,
        notes: v.notes ?? null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="modalBody">
        <div className="formGrid">
          <div className="field">
            <div className="label">Nombre *</div>
            <input
              className="input"
              value={v.name ?? ""}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Ej: Luis Pérez"
            />
          </div>

          <div className="field">
            <div className="label">Aseguradora / EPS</div>
            <input
              className="input"
              value={v.insurer ?? ""}
              onChange={(e) => set("insurer", e.target.value)}
              placeholder="Ej: Sura"
            />
          </div>

          <div className="field">
            <div className="label">Tipo de documento</div>
            <select
              className="select"
              value={v.doc_type ?? ""}
              onChange={(e) => set("doc_type", e.target.value || null)}
            >
              <option value="">—</option>
              <option value="CC">CC</option>
              <option value="TI">TI</option>
              <option value="CE">CE</option>
              <option value="PP">Pasaporte</option>
            </select>
          </div>

          <div className="field">
            <div className="label">Número de documento</div>
            <input
              className="input"
              value={v.doc_number ?? ""}
              onChange={(e) => set("doc_number", e.target.value)}
              placeholder="Ej: 1005944430"
            />
          </div>

          <div className="field">
            <div className="label">Fecha de nacimiento</div>
            <input
              type="date"
              className="input"
              value={v.birth_date ?? ""}
              onChange={(e) => set("birth_date", e.target.value || null)}
            />
          </div>

          <div className="field">
            <div className="label">Sexo</div>
            <select
              className="select"
              value={v.sex ?? ""}
              onChange={(e) => set("sex", e.target.value || null)}
            >
              <option value="">—</option>
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
              <option value="O">Otro</option>
            </select>
          </div>

          <div className="field">
            <div className="label">Teléfono</div>
            <input
              className="input"
              value={v.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="Ej: +57 3xx xxx xxxx"
            />
          </div>

          <div className="field">
            <div className="label">Email</div>
            <input
              className="input"
              value={v.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
              placeholder="Ej: correo@dominio.com"
            />
          </div>

          <div className="field">
            <div className="label">Dirección</div>
            <input
              className="input"
              value={v.address ?? ""}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Ej: Cali, Valle"
            />
          </div>

          <div className="field">
            <div className="label">Contacto de emergencia</div>
            <input
              className="input"
              value={v.emergency_contact ?? ""}
              onChange={(e) => set("emergency_contact", e.target.value)}
              placeholder="Ej: María (Madre) - 300..."
            />
          </div>
        </div>

        <div className="field">
          <div className="label">Observaciones / notas</div>
          <textarea
            className="textarea"
            value={v.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Notas relevantes del paciente…"
          />
        </div>
      </div>

      <div className="modalFooter">
        <button className="pillBtn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        {extraRight}
        <button className="pillBtn primary" onClick={submit} disabled={busy || !v.name?.trim()}>
          {busy ? "Guardando..." : saveLabel}
        </button>
      </div>
    </>
  );
}

function MentalExamModal({
  patient,
  onClose,
  onCreated,
}: {
  patient: Patient;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const [fecha, setFecha] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  const [motivo, setMotivo] = useState("");
  const [aspecto, setAspecto] = useState("Adecuado");
  const [conducta, setConducta] = useState("Cooperador");
  const [actitud, setActitud] = useState("Colaborador");

  const [lenguaje, setLenguaje] = useState("Normal");
  const [animo, setAnimo] = useState("Eutímico");
  const [afecto, setAfecto] = useState("Congruente");
  const [cursoPens, setCursoPens] = useState("Lógico/Coherente");
  const [contPens, setContPens] = useState("");
  const [percepcion, setPercepcion] = useState("Sin alteraciones");
  const [orientacion, setOrientacion] = useState("Orientado");
  const [atencion, setAtencion] = useState("Conservada");
  const [memoria, setMemoria] = useState("Conservada");
  const [juicio, setJuicio] = useState("Conservado");
  const [insight, setInsight] = useState("Presente");
  const [riesgo, setRiesgo] = useState("Sin riesgo aparente");
  const [obs, setObs] = useState("");

  async function create() {
    setBusy(true);
    try {
      const payload = {
        type: "examen_mental",
        fecha,
        motivo_consulta: motivo || null,

        apariencia_aspecto_personal: aspecto,
        conducta_psicomotora: conducta,
        actitud: actitud,

        lenguaje,
        estado_de_animo: animo,
        afecto,

        pensamiento_curso: cursoPens,
        pensamiento_contenido: contPens || null,

        percepcion,
        orientacion,
        atencion,
        memoria,
        juicio,
        insight,
        riesgo,
        observaciones: obs || null,

        patient_snapshot: {
          id: patient.id,
          name: patient.name,
          doc_type: patient.doc_type,
          doc_number: patient.doc_number,
        },
      };

      await createMentalExam(patient.id, payload);
      await onCreated();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nuevo examen mental"
      subtitle="Selectores + calendario para que sea rápido y consistente."
      onClose={onClose}
    >
      <div className="modalBody">
        <div className="formGrid">
          <div className="field">
            <div className="label">Fecha</div>
            <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>

          <div className="field">
            <div className="label">Motivo de consulta</div>
            <input
              className="input"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: ansiedad, insomnio, duelo…"
            />
          </div>
        </div>

        <div className="card">
          <div className="formGrid">
            <div className="field">
              <div className="label">Apariencia / aspecto personal</div>
              <select className="select" value={aspecto} onChange={(e) => setAspecto(e.target.value)}>
                <option>Adecuado</option>
                <option>Descuidado</option>
                <option>Hipercuidado</option>
                <option>Desaliñado</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Conducta psicomotora</div>
              <select className="select" value={conducta} onChange={(e) => setConducta(e.target.value)}>
                <option>Cooperador</option>
                <option>Inquieto</option>
                <option>Agitado</option>
                <option>Retardado</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Actitud</div>
              <select className="select" value={actitud} onChange={(e) => setActitud(e.target.value)}>
                <option>Colaborador</option>
                <option>Desconfiado</option>
                <option>Hostil</option>
                <option>Inhibido</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Lenguaje</div>
              <select className="select" value={lenguaje} onChange={(e) => setLenguaje(e.target.value)}>
                <option>Normal</option>
                <option>Hipoproductivo</option>
                <option>Taquifemia</option>
                <option>Incoherente</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="formGrid">
            <div className="field">
              <div className="label">Estado de ánimo</div>
              <select className="select" value={animo} onChange={(e) => setAnimo(e.target.value)}>
                <option>Eutímico</option>
                <option>Ansioso</option>
                <option>Deprimido</option>
                <option>Irritable</option>
                <option>Expansivo</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Afecto</div>
              <select className="select" value={afecto} onChange={(e) => setAfecto(e.target.value)}>
                <option>Congruente</option>
                <option>Lábil</option>
                <option>Plano</option>
                <option>Incongruente</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Curso del pensamiento</div>
              <select className="select" value={cursoPens} onChange={(e) => setCursoPens(e.target.value)}>
                <option>Lógico/Coherente</option>
                <option>Tangencial</option>
                <option>Disgregado</option>
                <option>Fuga de ideas</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Percepción</div>
              <select className="select" value={percepcion} onChange={(e) => setPercepcion(e.target.value)}>
                <option>Sin alteraciones</option>
                <option>Alucinaciones</option>
                <option>Ilusiones</option>
                <option>Despersonalización</option>
              </select>
            </div>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <div className="label">Contenido del pensamiento</div>
            <textarea
              className="textarea"
              value={contPens}
              onChange={(e) => setContPens(e.target.value)}
              placeholder="Ideas obsesivas, rumiación, delirios, preocupación, etc…"
            />
          </div>
        </div>

        <div className="card">
          <div className="formGrid">
            <div className="field">
              <div className="label">Orientación</div>
              <select className="select" value={orientacion} onChange={(e) => setOrientacion(e.target.value)}>
                <option>Orientado</option>
                <option>Parcialmente orientado</option>
                <option>Desorientado</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Atención</div>
              <select className="select" value={atencion} onChange={(e) => setAtencion(e.target.value)}>
                <option>Conservada</option>
                <option>Disminuida</option>
                <option>Fluctuante</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Memoria</div>
              <select className="select" value={memoria} onChange={(e) => setMemoria(e.target.value)}>
                <option>Conservada</option>
                <option>Alterada</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Juicio</div>
              <select className="select" value={juicio} onChange={(e) => setJuicio(e.target.value)}>
                <option>Conservado</option>
                <option>Parcial</option>
                <option>Comprometido</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Insight</div>
              <select className="select" value={insight} onChange={(e) => setInsight(e.target.value)}>
                <option>Presente</option>
                <option>Parcial</option>
                <option>Ausente</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Riesgo</div>
              <select className="select" value={riesgo} onChange={(e) => setRiesgo(e.target.value)}>
                <option>Sin riesgo aparente</option>
                <option>Riesgo bajo</option>
                <option>Riesgo moderado</option>
                <option>Riesgo alto</option>
              </select>
            </div>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <div className="label">Observaciones</div>
            <textarea
              className="textarea"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Observaciones clínicas adicionales…"
            />
          </div>
        </div>
      </div>

      <div className="modalFooter">
        <button className="pillBtn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="pillBtn primary" onClick={create} disabled={busy}>
          {busy ? "Guardando..." : "Crear examen"}
        </button>
      </div>
    </Modal>
  );
}

export default function App() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<PatientFile[]>([]);
  const [section, setSection] = useState<Section>("resumen");

  const [toast, setToast] = useState<Toast>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showExam, setShowExam] = useState(false);

  const toastTimer = useRef<number | null>(null);

  function pushToast(t: Toast) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }

  const selected = useMemo(
    () => patients.find((p) => p.id === selectedId) ?? null,
    [patients, selectedId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => {
      const hay = `${p.name} ${p.doc_type ?? ""} ${p.doc_number ?? ""} ${p.insurer ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [patients, query]);

  const fileGroups = useMemo(() => {
    const attachments = files.filter((f) => f.kind === "attachment");
    const exams = files.filter((f) => f.kind === "exam");
    const photos = files.filter((f) => f.kind === "photo");
    return { attachments, exams, photos };
  }, [files]);

  async function refreshPatients() {
    const list = await listPatients("");
    setPatients(list);
    // Si el seleccionado ya no existe, lo limpiamos
    if (selectedId && !list.some((p) => p.id === selectedId)) {
      setSelectedId(null);
      setFiles([]);
      setSection("resumen");
    }
  }

  async function refreshFiles(pid: string) {
    const f = await listPatientFiles(pid);
    setFiles(f);
  }

  useEffect(() => {
    (async () => {
      try {
        await refreshPatients();
      } catch (e: any) {
        pushToast({ type: "err", msg: `Error cargando pacientes: ${errMsg(e)}` });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!selectedId) return;
      try {
        await refreshFiles(selectedId);
      } catch (e: any) {
        pushToast({ type: "err", msg: `Error cargando archivos: ${errMsg(e)}` });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function pickPatient(id: string) {
    startVT(() => {
      setSelectedId(id);
      setSection("resumen");
    });
  }

  async function onCreatePatient(input: PatientInput) {
    try {
      const p = await createPatient(input);
      await refreshPatients();
      startVT(() => setSelectedId(p.id));
      pushToast({ type: "ok", msg: "Paciente creado ✅" });
      setShowCreate(false);
    } catch (e: any) {
      pushToast({ type: "err", msg: `No se pudo crear: ${errMsg(e)}` });
    }
  }

  async function onUpdatePatient(input: PatientInput) {
    if (!selected) return;
    try {
      const p = await updatePatient(selected.id, input);
      await refreshPatients();
      startVT(() => setSelectedId(p.id));
      pushToast({ type: "ok", msg: "Paciente actualizado ✅" });
      setShowEdit(false);
    } catch (e: any) {
      pushToast({ type: "err", msg: `No se pudo actualizar: ${errMsg(e)}` });
    }
  }

  async function actionPickPhoto() {
    if (!selected) return;
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "Imagen", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (!picked || typeof picked !== "string") return;

      await setPatientPhoto(selected.id, picked);
      await refreshPatients();
      pushToast({ type: "ok", msg: "Foto actualizada ✅" });
    } catch (e: any) {
      pushToast({ type: "err", msg: `Error foto: ${errMsg(e)}` });
    }
  }

  async function actionAttachFiles() {
    if (!selected) return;
    try {
      const picked = await open({ multiple: true });
      if (!picked) return;

      const paths = Array.isArray(picked) ? picked : [picked];
      if (!paths.length) return;

      await importFiles(selected.id, paths);
      await refreshFiles(selected.id);
      pushToast({ type: "ok", msg: "Archivos adjuntados ✅" });
      startVT(() => setSection("archivos"));
    } catch (e: any) {
      pushToast({ type: "err", msg: `Error adjuntar: ${errMsg(e)}` });
    }
  }

  async function actionOpenFolder() {
    if (!selected) return;
    try {
      await openPatientFolder(selected.id);
    } catch (e: any) {
      pushToast({ type: "err", msg: `No se pudo abrir carpeta: ${errMsg(e)}` });
    }
  }

  async function actionOpenFile(path: string) {
    try {
      await openPath(path);
    } catch (e: any) {
      pushToast({ type: "err", msg: `No se pudo abrir: ${errMsg(e)}` });
    }
  }

  async function actionDeleteSelected() {
    if (!selected) return;
    const ok = confirm(`¿Eliminar a "${selected.name}"? Esto no borra tus archivos físicos (solo la referencia).`);
    if (!ok) return;
    try {
      await deletePatient(selected.id);
      await refreshPatients();
      pushToast({ type: "ok", msg: "Paciente eliminado ✅" });
    } catch (e: any) {
      pushToast({ type: "err", msg: `No se pudo eliminar: ${errMsg(e)}` });
    }
  }

  const selectedPhotoSrc = useMemo(() => {
    if (!selected?.photo_path) return null;
    try {
      return convertFileSrc(selected.photo_path);
    } catch {
      return null;
    }
  }, [selected?.photo_path]);

  return (
    <div className="app">
      <div className="shell">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebarTop">
            <div className="brandRow">
              <div className="brand">
                <div className="title">
                  <span>naju</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>gestor local</span>
                </div>
                <div className="subtitle">pacientes · exámenes · archivos (estética tierra)</div>
              </div>

              <div className="pillRow">
                <button className="pillBtn" onClick={() => setShowCreate(true)}>
                  + paciente
                </button>
              </div>
            </div>
          </div>

          <div className="searchWrap">
            <input
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="buscar por nombre, documento, EPS…"
            />
          </div>

          <div className="patientList">
            {filtered.length === 0 ? (
              <div className="card">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Sin resultados</div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>
                  Prueba otro texto de búsqueda o crea un paciente.
                </div>
              </div>
            ) : null}

            {filtered.map((p) => {
              const age = calcAge(p.birth_date);
              const img = p.photo_path ? convertFileSrc(p.photo_path) : null;

              return (
                <div
                  key={p.id}
                  className="pCard"
                  role="button"
                  tabIndex={0}
                  aria-current={p.id === selectedId ? "true" : "false"}
                  onClick={() => pickPatient(p.id)}
                  onKeyDown={(e) => (e.key === "Enter" ? pickPatient(p.id) : null)}
                >
                  <div className="avatar">
                    {img ? <img src={img} alt="Foto paciente" /> : <div className="initials">{initials(p.name)}</div>}
                  </div>

                  <div className="pMeta">
                    <div className="pName">{p.name}</div>
                    <div className="pSub">
                      {valOrDash(p.doc_type)} {valOrDash(p.doc_number)} · {valOrDash(p.insurer)}
                    </div>
                    <div className="badges">
                      <span className="badge gold">{age === null ? "Edad —" : `${age} años`}</span>
                      {p.phone ? <span className="badge">{p.phone}</span> : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <main className="main">
          <div className="mainTop">
            {!selected ? (
              <div className="mainTitle">
                <h2>selecciona un paciente</h2>
                <p className="hint">aquí verás el perfil, exámenes y archivos.</p>
              </div>
            ) : (
              <div className="mainTitle">
                <h2 style={{ display: "flex", gap: 10, alignItems: "center", margin: 0 }}>
                  {selectedPhotoSrc ? (
                    <span className="avatar" style={{ width: 42, height: 42, borderRadius: 16 }}>
                      <img src={selectedPhotoSrc} alt="Foto" />
                    </span>
                  ) : (
                    <span className="avatar" style={{ width: 42, height: 42, borderRadius: 16 }}>
                      <span className="initials">{initials(selected.name)}</span>
                    </span>
                  )}
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selected.name}
                  </span>
                </h2>
                <p className="hint" style={{ margin: 0 }}>
                  {valOrDash(selected.doc_type)} {valOrDash(selected.doc_number)} · {valOrDash(selected.insurer)}
                </p>
              </div>
            )}

            <div className="actionRow">
              <button className="iconBtn" disabled={!selected} onClick={() => setShowEdit(true)}>
                editar
              </button>
              <button className="iconBtn" disabled={!selected} onClick={actionPickPhoto}>
                foto
              </button>
              <button className="iconBtn" disabled={!selected} onClick={actionAttachFiles}>
                adjuntar
              </button>
              <button className="iconBtn" disabled={!selected} onClick={actionOpenFolder}>
                carpeta
              </button>
            </div>
          </div>

          {selected ? (
            <div className="segWrap">
              <div className="segmented" role="navigation" aria-label="Secciones del paciente">
                <button className="segBtn" aria-current={section === "resumen"} onClick={() => startVT(() => setSection("resumen"))}>
                  Resumen
                </button>
                <button className="segBtn" aria-current={section === "examenes"} onClick={() => startVT(() => setSection("examenes"))}>
                  Exámenes
                </button>
                <button className="segBtn" aria-current={section === "archivos"} onClick={() => startVT(() => setSection("archivos"))}>
                  Archivos
                </button>
              </div>
            </div>
          ) : null}

          <div className="content">
            {!selected ? (
              <div className="emptyState">
                <div className="hero">
                  <h1>NAJU</h1>
                  <p>
                    Selecciona un paciente del panel izquierdo o crea uno nuevo.
                    El detalle siempre se muestra aquí (sin sub-pestañas).
                  </p>
                </div>
              </div>
            ) : section === "resumen" ? (
              <div className="grid2">
                <div className="card">
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Datos</div>

                  <div className="kv">
                    <div className="k">Nombre</div>
                    <div className="v">{selected.name}</div>
                  </div>
                  <div className="kv">
                    <div className="k">Documento</div>
                    <div className="v">
                      {valOrDash(selected.doc_type)} {valOrDash(selected.doc_number)}
                    </div>
                  </div>
                  <div className="kv">
                    <div className="k">EPS</div>
                    <div className="v">{valOrDash(selected.insurer)}</div>
                  </div>
                  <div className="kv">
                    <div className="k">Nacimiento</div>
                    <div className="v">{valOrDash(selected.birth_date)}</div>
                  </div>
                  <div className="kv">
                    <div className="k">Teléfono</div>
                    <div className="v">{valOrDash(selected.phone)}</div>
                  </div>
                  <div className="kv">
                    <div className="k">Email</div>
                    <div className="v">{valOrDash(selected.email)}</div>
                  </div>
                  <div className="kv">
                    <div className="k">Dirección</div>
                    <div className="v">{valOrDash(selected.address)}</div>
                  </div>
                </div>

                <div className="card">
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Notas</div>
                  <div style={{ color: "var(--muted)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {valOrDash(selected.notes)}
                  </div>

                  <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="pillBtn primary" onClick={() => setShowExam(true)}>
                      + nuevo examen mental
                    </button>
                    <button className="pillBtn danger" onClick={actionDeleteSelected}>
                      eliminar paciente
                    </button>
                  </div>
                </div>
              </div>
            ) : section === "examenes" ? (
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>Exámenes</div>
                    <div style={{ color: "var(--muted)", fontSize: 13 }}>Examen mental y otros (guardados como JSON).</div>
                  </div>
                  <button className="pillBtn primary" onClick={() => setShowExam(true)}>
                    + examen mental
                  </button>
                </div>

                <div style={{ height: 12 }} />

                <div className="list">
                  {fileGroups.exams.length === 0 ? (
                    <div style={{ color: "var(--muted)" }}>Aún no hay exámenes.</div>
                  ) : (
                    fileGroups.exams.map((f) => (
                      <div key={f.id} className="fileRow">
                        <div className="fileMeta">
                          <div className="fileName">{f.filename}</div>
                          <div className="fileSub">{isoToNice(f.created_at)}</div>
                        </div>
                        <button className="smallBtn" onClick={() => actionOpenFile(f.path)}>
                          abrir
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>Archivos</div>
                    <div style={{ color: "var(--muted)", fontSize: 13 }}>Adjuntos del paciente (PDF, imágenes, etc.).</div>
                  </div>
                  <button className="pillBtn primary" onClick={actionAttachFiles}>
                    + adjuntar
                  </button>
                </div>

                <div style={{ height: 12 }} />

                <div className="list">
                  {fileGroups.attachments.length === 0 ? (
                    <div style={{ color: "var(--muted)" }}>Aún no hay archivos adjuntos.</div>
                  ) : (
                    fileGroups.attachments.map((f) => (
                      <div key={f.id} className="fileRow">
                        <div className="fileMeta">
                          <div className="fileName">{f.filename}</div>
                          <div className="fileSub">{isoToNice(f.created_at)}</div>
                        </div>
                        <button className="smallBtn" onClick={() => actionOpenFile(f.path)}>
                          abrir
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Modals */}
      {showCreate ? (
        <Modal title="Nuevo paciente" subtitle="Crea el perfil base del paciente." onClose={() => setShowCreate(false)}>
          <PatientForm
            initial={{ name: "", doc_type: null, doc_number: null, insurer: null, birth_date: null, sex: null, phone: null, email: null, address: null, emergency_contact: null, notes: null }}
            onSave={onCreatePatient}
            onCancel={() => setShowCreate(false)}
            saveLabel="Crear paciente"
          />
        </Modal>
      ) : null}

      {showEdit && selected ? (
        <Modal title="Editar paciente" subtitle="Actualiza los datos del perfil." onClose={() => setShowEdit(false)}>
          <PatientForm
            initial={{
              name: selected.name,
              doc_type: selected.doc_type,
              doc_number: selected.doc_number,
              insurer: selected.insurer,
              birth_date: selected.birth_date,
              sex: selected.sex,
              phone: selected.phone,
              email: selected.email,
              address: selected.address,
              emergency_contact: selected.emergency_contact,
              notes: selected.notes,
            }}
            onSave={onUpdatePatient}
            onCancel={() => setShowEdit(false)}
            saveLabel="Guardar cambios"
          />
        </Modal>
      ) : null}

      {showExam && selected ? (
        <MentalExamModal
          patient={selected}
          onClose={() => setShowExam(false)}
          onCreated={async () => {
            await refreshFiles(selected.id);
            pushToast({ type: "ok", msg: "Examen creado ✅" });
            startVT(() => setSection("examenes"));
          }}
        />
      ) : null}

      {/* Toast simple */}
      {toast ? (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            padding: "12px 14px",
            borderRadius: 16,
            border: "1px solid var(--border)",
            background: "rgba(255,253,248,.95)",
            boxShadow: "0 18px 50px rgba(44,32,18,.18)",
            color: toast.type === "err" ? "#7b2f25" : "var(--text)",
            maxWidth: 420,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 2 }}>{toast.type === "err" ? "Error" : "Listo"}</div>
          <div style={{ color: "var(--muted)", lineHeight: 1.35 }}>{toast.msg}</div>
        </div>
      ) : null}
    </div>
  );
}
