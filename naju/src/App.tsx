import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import {
  Patient,
  PatientFile,
  PatientInput,
  createMentalExam,
  createPatientNote,
  createPatient,
  deletePatient,
  importFiles,
  listAllFiles,
  listPatientFiles,
  listPatients,
  setPatientPhoto,
  updatePatient,
} from "./lib/api";
import { buildProfileMap } from "./lib/profile";

type Section = "resumen" | "examenes" | "notas" | "archivos";

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

function parseMetaJson(file: PatientFile) {
  if (!file.meta_json) return null;
  try {
    return JSON.parse(file.meta_json);
  } catch {
    return null;
  }
}

function fileIcon(file: PatientFile) {
  const name = file.filename.toLowerCase();
  if (file.kind === "note") return "📝";
  if (file.kind === "exam") return "🧠";
  if (name.endsWith(".pdf")) return "📄";
  if (name.match(/\.(png|jpg|jpeg|webp|gif)$/)) return "🖼️";
  return "📎";
}

function isImage(path: string) {
  return path.startsWith("data:image/") || /\.(png|jpg|jpeg|webp|gif)$/i.test(path);
}

function isPdf(path: string) {
  return path.startsWith("data:application/pdf") || /\.pdf$/i.test(path);
}

function scoreLookup(value: string | null | undefined, map: Record<string, number>) {
  if (!value) return 0;
  return map[value] ?? 0;
}

const AXES = [
  {
    key: "estado_de_animo",
    noteKey: "estado_animo",
    label: "Ánimo",
    map: {
      "Eutímico": 0,
      "Ansioso": 2,
      "Deprimido": 3,
      "Irritable": 2,
      "Expansivo": 2,
    },
  },
  {
    key: "afecto",
    label: "Afecto",
    map: {
      "Congruente": 0,
      "Lábil": 2,
      "Plano": 3,
      "Incongruente": 2,
    },
  },
  {
    key: "orientacion",
    label: "Orientación",
    map: {
      "Orientado": 0,
      "Parcialmente orientado": 2,
      "Desorientado": 3,
    },
  },
  {
    key: "memoria",
    label: "Memoria",
    map: {
      "Conservada": 0,
      "Alterada": 2,
    },
  },
  {
    key: "juicio",
    label: "Juicio",
    map: {
      "Conservado": 0,
      "Parcial": 2,
      "Comprometido": 3,
    },
  },
  {
    key: "riesgo",
    label: "Riesgo",
    map: {
      "Sin riesgo aparente": 0,
      "Sin riesgo": 0,
      "Riesgo bajo": 1,
      "Bajo": 1,
      "Riesgo moderado": 2,
      "Moderado": 2,
      "Riesgo alto": 3,
      "Alto": 3,
    },
  },
];

const PROFILE_COLORS: Record<string, string> = {
  "Ánimo": "#5b7bd5",
  "Afecto": "#b06fdc",
  "Orientación": "#5aa6b2",
  "Memoria": "#c48b5a",
  "Juicio": "#6da878",
  "Riesgo": "#d7665a",
};

function getAxisValues(files: PatientFile[]) {
  const latestByAxis = new Map<string, { value: number; created_at: string }>();
  files
    .filter((f) => f.kind === "exam" || f.kind === "note")
    .forEach((file) => {
      const meta = parseMetaJson(file);
      if (!meta) return;
      AXES.forEach((axis) => {
        const raw = meta[axis.key] ?? (axis.noteKey ? meta[axis.noteKey] : undefined);
        if (!raw) return;
        const value = scoreLookup(raw, axis.map);
        const current = latestByAxis.get(axis.label);
        if (!current || file.created_at > current.created_at) {
          latestByAxis.set(axis.label, { value, created_at: file.created_at });
        }
      });
    });

  const values = AXES.map((axis) => latestByAxis.get(axis.label)?.value ?? 0);
  let dominant: { label: string; value: number } | null = null;
  values.forEach((value, idx) => {
    if (!dominant || value > dominant.value) {
      dominant = { label: AXES[idx].label, value };
    }
  });
  if (!dominant || dominant.value === 0) return { values, dominant: null };
  return { values, dominant };
}

function scoreAxisValues(files: PatientFile[], mode: "aggregate" | "avg3" | "latest") {
  if (files.length === 0) return AXES.map(() => 0);
  const sorted = [...files].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const targetFiles =
    mode === "latest" ? sorted.slice(0, 1) : mode === "avg3" ? sorted.slice(0, 3) : sorted;
  const sums = AXES.map(() => 0);
  const counts = AXES.map(() => 0);

  targetFiles.forEach((file) => {
    const meta = parseMetaJson(file);
    if (!meta) return;
    AXES.forEach((axis, idx) => {
      const raw = meta[axis.key] ?? (axis.noteKey ? meta[axis.noteKey] : undefined);
      if (!raw) return;
      const value = scoreLookup(raw, axis.map);
      sums[idx] += value;
      counts[idx] += 1;
    });
  });

  return sums.map((sum, idx) => (counts[idx] ? sum / counts[idx] : 0));
}

function buildEmotionCounts(files: PatientFile[]) {
  const bucket = new Map<string, number>();
  files.forEach((file) => {
    const meta = parseMetaJson(file);
    if (!meta) return;
    const value = meta.estado_de_animo ?? meta.estado_animo;
    if (!value) return;
    bucket.set(value, (bucket.get(value) ?? 0) + 1);
  });
  const entries = Array.from(bucket.entries()).sort((a, b) => b[1] - a[1]);
  return {
    labels: entries.map(([label]) => label),
    values: entries.map(([, count]) => count),
  };
}

function isoToShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function RadarChart({
  labels,
  values,
  accent,
  max,
}: {
  labels: string[];
  values: number[];
  accent: string;
  max: number;
}) {
  const size = 260;
  const center = size / 2;
  const radius = 90;
  const points = values.map((value, i) => {
    const angle = (Math.PI * 2 * i) / values.length - Math.PI / 2;
    const r = (radius * value) / max;
    return {
      x: center + Math.cos(angle) * r,
      y: center + Math.sin(angle) * r,
      angle,
    };
  });
  const polygon = points.map((p) => `${p.x},${p.y}`).join(" ");
  const gridLevels = Array.from({ length: 5 }, (_, idx) => idx + 1).map((level) => {
    const r = (radius * level) / 5;
    const ring = values.map((_, i) => {
      const angle = (Math.PI * 2 * i) / values.length - Math.PI / 2;
      return `${center + Math.cos(angle) * r},${center + Math.sin(angle) * r}`;
    });
    return ring.join(" ");
  });

  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} aria-label="Perfil radial del paciente">
      {gridLevels.map((ring, idx) => (
        <polygon key={idx} points={ring} className="radarGrid" />
      ))}
      {points.map((p, idx) => (
        <line key={idx} x1={center} y1={center} x2={p.x} y2={p.y} className="radarAxis" />
      ))}
      <polygon points={polygon} className="radarFill" style={{ fill: accent }} />
      {labels.map((label, idx) => {
        const angle = (Math.PI * 2 * idx) / labels.length - Math.PI / 2;
        const labelRadius = radius + 18;
        const x = center + Math.cos(angle) * labelRadius;
        const y = center + Math.sin(angle) * labelRadius;
        return (
          <text key={label} x={x} y={y} className="radarLabel" textAnchor="middle">
            {label}
          </text>
        );
      })}
    </svg>
  );
}

function useCanvasSize(canvas: HTMLCanvasElement | null) {
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, dpr };
}

function ProgressDashes({
  title,
  labels,
  values,
  max,
  colors,
  footer,
  showScale = true,
}: {
  title?: string;
  labels: string[];
  values: number[];
  max: number;
  colors?: Record<string, string>;
  footer?: string;
  showScale?: boolean;
}) {
  const sum = values.reduce((acc, val) => acc + val, 0);
  return (
    <div className="percent-panel">
      {title ? <h4>{title}</h4> : null}
      {labels.map((label, idx) => {
        const pct = sum === 0 ? 0 : (values[idx] / sum) * 100;
        const barStyle = colors?.[label]
          ? { width: `${pct}%`, background: colors[label] }
          : { width: `${pct}%` };
        return (
          <div key={label} className="percent-row">
            <div className="lbl">{label}</div>
            <div className="pct">{pct.toFixed(0)}%</div>
            <div className="bar">
              <span style={barStyle} />
            </div>
          </div>
        );
      })}
      {footer ? <div className="percentFoot">{footer}</div> : null}
      {!footer && max && showScale ? <div className="percentFoot">Escala: 0–{max}</div> : null}
    </div>
  );
}

function buildEvidence(files: PatientFile[], labels: string[]) {
  const evidence = labels.map(() => new Map<string, number>());
  files.forEach((file) => {
    const meta = parseMetaJson(file);
    if (!meta) return;
    const values = [
      meta.estado_de_animo ?? meta.estado_animo,
      meta.afecto,
      meta.orientacion,
      meta.memoria,
      meta.juicio,
      meta.riesgo,
    ];
    values.forEach((value, idx) => {
      if (!value) return;
      const bucket = evidence[idx];
      bucket.set(value, (bucket.get(value) ?? 0) + 1);
    });
  });
  return evidence;
}

function TrendCanvas({
  labels,
  files,
}: {
  labels: string[];
  files: PatientFile[];
}) {
  const treeRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = treeRef.current;
    if (!canvas) return;
    const size = useCanvasSize(canvas);
    if (!size) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = size;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(0,0,0,0.04)";
    ctx.fillRect(0, 0, width, height);

    const evidence = buildEvidence(files, labels);
    const root = { x: width * 0.5, y: height * 0.12 };
    const row1 = height * 0.48;
    const row2 = height * 0.82;
    const xs = labels.map((_, i) => width * 0.12 + (i * width * 0.76) / (labels.length - 1));

    ctx.strokeStyle = "rgba(199,164,90,0.35)";
    ctx.lineWidth = 1.5;
    xs.forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(root.x, root.y + 18);
      ctx.lineTo(x, row1 - 18);
      ctx.stroke();
    });

    ctx.fillStyle = "rgba(199,164,90,0.2)";
    ctx.beginPath();
    ctx.arc(root.x, root.y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(199,164,90,0.8)";
    ctx.stroke();
    ctx.fillStyle = "rgba(43,36,29,0.8)";
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText("Perfil global", root.x - 30, root.y - 24);

    labels.forEach((label, idx) => {
      const x = xs[idx];
      ctx.beginPath();
      ctx.arc(x, row1, 14, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(109,123,85,0.2)";
      ctx.fill();
      ctx.strokeStyle = "rgba(109,123,85,0.6)";
      ctx.stroke();
      ctx.fillStyle = "rgba(43,36,29,0.8)";
      ctx.fillText(label, x - ctx.measureText(label).width / 2, row1 + 28);

      const bucket = evidence[idx];
      const entries = Array.from(bucket.entries()).slice(0, 2);
      entries.forEach((entry, j) => {
        const [value] = entry;
        const lx = x + (j === 0 ? -32 : 32);
        ctx.beginPath();
        ctx.arc(lx, row2, 10, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(31,41,55,0.18)";
        ctx.fill();
        ctx.strokeStyle = "rgba(199,164,90,0.5)";
        ctx.stroke();
        ctx.fillStyle = "rgba(43,36,29,0.75)";
        ctx.fillText(String(value), lx - ctx.measureText(String(value)).width / 2, row2 + 24);
        ctx.strokeStyle = "rgba(199,164,90,0.25)";
        ctx.beginPath();
        ctx.moveTo(x, row1 + 14);
        ctx.lineTo(lx, row2 - 12);
        ctx.stroke();
      });
    });
  }, [labels, files]);

  return <canvas ref={treeRef} className="trendCanvas treeCanvas" aria-label="Árbol de tendencias" />;
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
  const [lugarEntrevista, setLugarEntrevista] = useState("");
  const [acompanante, setAcompanante] = useState("");
  const [edadAparente, setEdadAparente] = useState("");
  const [contextura, setContextura] = useState("");
  const [etnia, setEtnia] = useState("");
  const [estaturaEdad, setEstaturaEdad] = useState("");
  const [arregloPersonal, setArregloPersonal] = useState("Adecuado");

  const [contactoVisual, setContactoVisual] = useState("Intermitente");
  const [contactoVerbal, setContactoVerbal] = useState("Normal");
  const [actitud, setActitud] = useState("Colaboradora");

  const [actividadCuant, setActividadCuant] = useState("Euquinético");
  const [tonoMuscular, setTonoMuscular] = useState("Normotónico");
  const [posicion, setPosicion] = useState("Postura habitual");
  const [movimientos, setMovimientos] = useState("Adaptativos");

  const [lenguaje, setLenguaje] = useState("Normal");
  const [animo, setAnimo] = useState("Eutímico");
  const [afecto, setAfecto] = useState("Congruente");
  const [cursoPens, setCursoPens] = useState("Lógico/Coherente");
  const [nexosAsociativos, setNexosAsociativos] = useState("Coherentes");
  const [relevanciaPens, setRelevanciaPens] = useState("Relevante");
  const [contPens, setContPens] = useState("");
  const [percepcion, setPercepcion] = useState("Sin alteraciones");
  const [orientacion, setOrientacion] = useState("Orientado");
  const [sensorio, setSensorio] = useState("Alerta");
  const [atencion, setAtencion] = useState("Conservada");
  const [memoria, setMemoria] = useState("Conservada");
  const [calculo, setCalculo] = useState("Eucalculia");
  const [abstraccion, setAbstraccion] = useState("Abstrae");
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

        lugar_entrevista: lugarEntrevista || null,
        acompanante: acompanante || null,
        edad_aparente: edadAparente || null,
        contextura_fisica: contextura || null,
        caracteristicas_etnicas: etnia || null,
        estatura_para_la_edad: estaturaEdad || null,
        arreglo_personal: arregloPersonal,

        contacto_visual: contactoVisual,
        contacto_verbal: contactoVerbal,
        actitud: actitud,

        actividad_motora_cuantitativa: actividadCuant,
        tono_muscular: tonoMuscular,
        posicion: posicion,
        movimientos: movimientos,

        lenguaje,
        estado_de_animo: animo,
        afecto,

        pensamiento_curso: cursoPens,
        pensamiento_nexos_asociativos: nexosAsociativos,
        pensamiento_relevancia: relevanciaPens,
        pensamiento_contenido: contPens || null,

        percepcion,
        orientacion,
        sensorio,
        atencion,
        memoria,
        calculo,
        abstraccion,
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
              <div className="label">Lugar de la entrevista</div>
              <input
                className="input"
                value={lugarEntrevista}
                onChange={(e) => setLugarEntrevista(e.target.value)}
                placeholder="Consultorio, domicilio, hospital..."
              />
            </div>

            <div className="field">
              <div className="label">Acompañante</div>
              <input
                className="input"
                value={acompanante}
                onChange={(e) => setAcompanante(e.target.value)}
                placeholder="Ej: Familiar, amigo, ninguno"
              />
            </div>

            <div className="field">
              <div className="label">Edad aparente</div>
              <input
                className="input"
                value={edadAparente}
                onChange={(e) => setEdadAparente(e.target.value)}
                placeholder="Ej: acorde a la edad, menor..."
              />
            </div>

            <div className="field">
              <div className="label">Contextura física</div>
              <input
                className="input"
                value={contextura}
                onChange={(e) => setContextura(e.target.value)}
                placeholder="Ej: delgado, atlético..."
              />
            </div>

            <div className="field">
              <div className="label">Características étnicas</div>
              <input
                className="input"
                value={etnia}
                onChange={(e) => setEtnia(e.target.value)}
                placeholder="Describe si es relevante"
              />
            </div>

            <div className="field">
              <div className="label">Estatura para la edad</div>
              <input
                className="input"
                value={estaturaEdad}
                onChange={(e) => setEstaturaEdad(e.target.value)}
                placeholder="Ej: acorde, baja, alta"
              />
            </div>

            <div className="field">
              <div className="label">Arreglo personal</div>
              <select className="select" value={arregloPersonal} onChange={(e) => setArregloPersonal(e.target.value)}>
                <option>Adecuado</option>
                <option>Descuidado</option>
                <option>Hipercuidado</option>
                <option>Desaliñado</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="formGrid">
            <div className="field">
              <div className="label">Contacto visual</div>
              <select className="select" value={contactoVisual} onChange={(e) => setContactoVisual(e.target.value)}>
                <option>Intermitente</option>
                <option>Sostenido</option>
                <option>Mirada perpleja</option>
                <option>Evitativo</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Contacto verbal</div>
              <select className="select" value={contactoVerbal} onChange={(e) => setContactoVerbal(e.target.value)}>
                <option>Normal</option>
                <option>Escaso</option>
                <option>Esporádico</option>
                <option>Abundante</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Actitud hacia el examinador</div>
              <select className="select" value={actitud} onChange={(e) => setActitud(e.target.value)}>
                <option>Colaboradora</option>
                <option>Hostil</option>
                <option>Indiferente</option>
                <option>Desdeñoso</option>
                <option>Evasivo</option>
                <option>Altivo</option>
                <option>Hiperfamiliar</option>
                <option>Intrusivo</option>
                <option>Suspicaz</option>
                <option>Congraciante</option>
                <option>Seductora</option>
                <option>Hipersexual</option>
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
                <option>Aplanado</option>
                <option>Inapropiado</option>
                <option>Ambivalente</option>
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
              <div className="label">Nexos asociativos</div>
              <select className="select" value={nexosAsociativos} onChange={(e) => setNexosAsociativos(e.target.value)}>
                <option>Coherentes</option>
                <option>Incoherentes</option>
                <option>Asíndesis</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Relevancia</div>
              <select className="select" value={relevanciaPens} onChange={(e) => setRelevanciaPens(e.target.value)}>
                <option>Relevante</option>
                <option>Irrelevante</option>
                <option>Circunstancial</option>
                <option>Tangencial</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Percepción</div>
              <select className="select" value={percepcion} onChange={(e) => setPercepcion(e.target.value)}>
                <option>Sin alteraciones</option>
                <option>Alucinaciones</option>
                <option>Ilusiones</option>
                <option>Despersonalización</option>
                <option>Pseudoalucinaciones</option>
                <option>Alucinosis</option>
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
              <div className="label">Sensorio</div>
              <select className="select" value={sensorio} onChange={(e) => setSensorio(e.target.value)}>
                <option>Alerta</option>
                <option>Somnoliento</option>
                <option>Estuporoso</option>
                <option>Coma</option>
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
              <div className="label">Cálculo</div>
              <select className="select" value={calculo} onChange={(e) => setCalculo(e.target.value)}>
                <option>Eucalculia</option>
                <option>Discalculia</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Abstracción</div>
              <select className="select" value={abstraccion} onChange={(e) => setAbstraccion(e.target.value)}>
                <option>Abstrae</option>
                <option>Concreto</option>
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
              placeholder="Observaciones clínicas adicionales (sensorio, juicio, riesgo, etc.)…"
            />
          </div>
        </div>

        <div className="card">
          <div className="formGrid">
            <div className="field">
              <div className="label">Índice de actividad motora (cuantitativo)</div>
              <select className="select" value={actividadCuant} onChange={(e) => setActividadCuant(e.target.value)}>
                <option>Euquinético</option>
                <option>Hiperquinético</option>
                <option>Hipoquinético</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Tono muscular</div>
              <select className="select" value={tonoMuscular} onChange={(e) => setTonoMuscular(e.target.value)}>
                <option>Normotónico</option>
                <option>Hipertónico</option>
                <option>Hipotónico</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Posición / postura</div>
              <select className="select" value={posicion} onChange={(e) => setPosicion(e.target.value)}>
                <option>Postura habitual</option>
                <option>Posturas estereotipadas</option>
                <option>Inhibida</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Movimientos</div>
              <select className="select" value={movimientos} onChange={(e) => setMovimientos(e.target.value)}>
                <option>Adaptativos</option>
                <option>Tics</option>
                <option>Temblores</option>
                <option>Estereotipias</option>
                <option>Gesticulaciones</option>
                <option>Manierismos</option>
                <option>Convulsiones</option>
                <option>Bloqueo motriz</option>
                <option>Parálisis</option>
                <option>Compulsión</option>
              </select>
            </div>
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

function NoteModal({
  patient,
  onClose,
  onCreated,
}: {
  patient: Patient;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [fecha, setFecha] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });
  const [animo, setAnimo] = useState("Eutímico");
  const [riesgo, setRiesgo] = useState("Sin riesgo");
  const [texto, setTexto] = useState("");
  const [continuidad, setContinuidad] = useState("");
  const [transcripcion, setTranscripcion] = useState("");

  async function readBlobAsDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("No se pudo leer el audio"));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      setAudioError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setAudioError("Grabación no disponible en este navegador.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        try {
          const dataUrl = await readBlobAsDataUrl(blob);
          setAudioUrl(dataUrl);
        } catch (err) {
          setAudioError(err instanceof Error ? err.message : "No se pudo procesar el audio.");
        }
      };
      recorder.start();
      setRecording(true);
    } catch (err) {
      setAudioError("No se pudo iniciar la grabación.");
    }
  }

  async function create() {
    setBusy(true);
    try {
      const payload = {
        type: "nota",
        fecha,
        estado_animo: animo,
        riesgo,
        texto: texto || null,
        continuidad: continuidad || null,
        transcripcion: transcripcion || null,
        audio_data_url: audioUrl,
        patient_snapshot: {
          id: patient.id,
          name: patient.name,
          doc_type: patient.doc_type,
          doc_number: patient.doc_number,
        },
      };
      await createPatientNote(patient.id, payload);
      await onCreated();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nueva nota" subtitle="Registro rápido del seguimiento clínico." onClose={onClose}>
      <div className="modalBody">
        <div className="formGrid">
          <div className="field">
            <div className="label">Fecha</div>
            <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>

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
            <div className="label">Riesgo</div>
            <select className="select" value={riesgo} onChange={(e) => setRiesgo(e.target.value)}>
              <option>Sin riesgo</option>
              <option>Bajo</option>
              <option>Moderado</option>
              <option>Alto</option>
            </select>
          </div>
        </div>

        <div className="field">
          <div className="label">Nota clínica</div>
          <textarea
            className="textarea"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Describe el seguimiento, cambios y observaciones..."
          />
        </div>

        <div className="field">
          <div className="label">Continuidad (plan de trabajo)</div>
          <textarea
            className="textarea"
            value={continuidad}
            onChange={(e) => setContinuidad(e.target.value)}
            placeholder="Describa el plan de trabajo o continuidad clínica..."
          />
        </div>

        <div className="field">
          <div className="label">Transcripción (opcional)</div>
          <textarea
            className="textarea"
            value={transcripcion}
            onChange={(e) => setTranscripcion(e.target.value)}
            placeholder="Pega aquí una transcripción o dicta manualmente."
          />
        </div>

        <div className="audioRow">
          <button className={`pillBtn ${recording ? "danger" : ""}`} onClick={toggleRecording} type="button">
            {recording ? "Detener grabación" : "Grabar audio"}
          </button>
          {audioUrl ? <span className="audioStatus">Audio listo para guardarse.</span> : null}
          {audioError ? <span className="audioError">{audioError}</span> : null}
        </div>

        {audioUrl ? (
          <audio controls src={audioUrl} style={{ width: "100%" }} />
        ) : null}
      </div>

      <div className="modalFooter">
        <button className="pillBtn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="pillBtn primary" onClick={create} disabled={busy || !texto.trim()}>
          {busy ? "Guardando..." : "Guardar nota"}
        </button>
      </div>
    </Modal>
  );
}

function FilePreviewModal({
  file,
  onClose,
}: {
  file: PatientFile;
  onClose: () => void;
}) {
  const meta = parseMetaJson(file);
  const isImageFile = file.kind === "attachment" && isImage(file.path);
  const isPdfFile = file.kind === "attachment" && isPdf(file.path);

  return (
    <Modal
      title={file.filename}
      subtitle={isoToNice(file.created_at)}
      onClose={onClose}
    >
      <div className="modalBody">
        {file.kind === "attachment" ? (
          <div className="previewBody">
            {isImageFile ? (
              <img className="previewImage" src={file.path} alt={`Vista previa de ${file.filename}`} />
            ) : isPdfFile ? (
              <object className="previewPdf" data={file.path} type="application/pdf">
                <p>Vista previa no disponible.</p>
              </object>
            ) : (
              <div className="previewEmpty">
                <div style={{ fontWeight: 700 }}>Archivo adjunto</div>
                <div style={{ color: "var(--muted)" }}>Descarga para abrir este tipo de archivo.</div>
              </div>
            )}
            <a className="pillBtn" href={file.path} download={file.filename}>
              Descargar
            </a>
          </div>
        ) : file.kind === "exam" ? (
          <div className="previewBody">
            <div className="previewTitle">Examen mental formal</div>
            <div className="kv">
              <div className="k">Fecha</div>
              <div className="v">{meta?.fecha ?? "—"}</div>
            </div>
            <div className="kv">
              <div className="k">Motivo</div>
              <div className="v">{meta?.motivo_consulta ?? "—"}</div>
            </div>
            <div className="previewGrid">
              {[
                ["Apariencia", meta?.apariencia_aspecto_personal],
                ["Conducta", meta?.conducta_psicomotora],
                ["Actitud", meta?.actitud],
                ["Lenguaje", meta?.lenguaje],
                ["Ánimo", meta?.estado_de_animo],
                ["Afecto", meta?.afecto],
                ["Curso pensamiento", meta?.pensamiento_curso],
                ["Percepción", meta?.percepcion],
                ["Orientación", meta?.orientacion],
                ["Atención", meta?.atencion],
                ["Memoria", meta?.memoria],
                ["Juicio", meta?.juicio],
                ["Insight", meta?.insight],
                ["Riesgo", meta?.riesgo],
              ].map(([label, value]) => (
                <div key={label} className="previewItem">
                  <div className="k">{label}</div>
                  <div className="v">{value ?? "—"}</div>
                </div>
              ))}
            </div>
            <div className="previewNote">{meta?.observaciones ?? "Sin observaciones adicionales."}</div>
          </div>
        ) : (
          <div className="previewBody">
            <div className="previewTitle">Nota de seguimiento</div>
            <div className="kv">
              <div className="k">Fecha</div>
              <div className="v">{meta?.fecha ?? "—"}</div>
            </div>
            <div className="previewGrid">
              {[
                ["Estado de ánimo", meta?.estado_animo],
                ["Riesgo", meta?.riesgo],
                ["Plan de trabajo", meta?.continuidad],
              ].map(([label, value]) => (
                <div key={label} className="previewItem">
                  <div className="k">{label}</div>
                  <div className="v">{value ?? "—"}</div>
                </div>
              ))}
            </div>
            <div className="previewNote">{meta?.texto ?? "Sin texto adicional."}</div>
            {meta?.transcripcion ? (
              <div className="previewNote">
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Transcripción</div>
                <div>{meta.transcripcion}</div>
              </div>
            ) : null}
            {meta?.audio_data_url ? (
              <audio controls src={meta.audio_data_url} style={{ width: "100%" }} />
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function App() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<PatientFile[]>([]);
  const [allFiles, setAllFiles] = useState<PatientFile[]>([]);
  const [section, setSection] = useState<Section>("resumen");

  const [toast, setToast] = useState<Toast>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showExam, setShowExam] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [previewFile, setPreviewFile] = useState<PatientFile | null>(null);

  const toastTimer = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    const notes = files.filter((f) => f.kind === "note");
    const photos = files.filter((f) => f.kind === "photo");
    return { attachments, exams, notes, photos };
  }, [files]);

  const [timePreset, setTimePreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [includeExams, setIncludeExams] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [calcMode, setCalcMode] = useState("aggregate");
  const [focusRecord, setFocusRecord] = useState("");
  const [scale, setScale] = useState("10");

  const dateRange = useMemo(() => {
    if (timePreset === "custom") {
      const from = dateFrom ? new Date(dateFrom) : null;
      const to = dateTo ? new Date(dateTo) : null;
      return { from, to };
    }
    if (timePreset === "30d" || timePreset === "90d") {
      const days = timePreset === "30d" ? 30 : 90;
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);
      return { from, to };
    }
    return { from: null, to: null };
  }, [timePreset, dateFrom, dateTo]);

  const trendFiles = useMemo(() => {
    const selectedFiles: PatientFile[] = [];
    if (includeExams) selectedFiles.push(...fileGroups.exams);
    if (includeNotes) selectedFiles.push(...fileGroups.notes);
    const filtered = selectedFiles.filter((file) => {
      const created = new Date(file.created_at);
      if (Number.isNaN(created.getTime())) return true;
      if (dateRange.from && created < dateRange.from) return false;
      if (dateRange.to && created > dateRange.to) return false;
      return true;
    });
    return filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [includeExams, includeNotes, fileGroups.exams, fileGroups.notes, dateRange]);

  const radarRawValues = useMemo(
    () => scoreAxisValues(trendFiles, calcMode as "aggregate" | "avg3" | "latest"),
    [trendFiles, calcMode]
  );
  const scaleMax = Number(scale);
  const radarValues = useMemo(
    () => radarRawValues.map((value) => (value / 3) * scaleMax),
    [radarRawValues, scaleMax]
  );
  const radarSum = useMemo(() => radarValues.reduce((acc, val) => acc + val, 0), [radarValues]);
  const dominantMacro = useMemo(() => {
    let winner: { label: string; value: number } | null = null;
    radarValues.forEach((value, idx) => {
      if (!winner || value > winner.value) {
        winner = { label: AXES[idx].label, value };
      }
    });
    if (!winner || winner.value === 0) return null;
    const pct = radarSum ? (winner.value / radarSum) * 100 : 0;
    return { ...winner, pct };
  }, [radarValues, radarSum]);

  const emotionCounts = useMemo(() => buildEmotionCounts(trendFiles), [trendFiles]);

  const focusOptions = useMemo(
    () =>
      trendFiles.map((file) => ({
        value: file.id,
        label: `${file.kind === "exam" ? "Examen" : "Nota"} · ${file.filename} · ${isoToShortDate(
          file.created_at
        )}`,
      })),
    [trendFiles]
  );

  const profileByPatientMap = useMemo(
    () => buildProfileMap(patients, allFiles, getAxisValues, PROFILE_COLORS),
    [patients, allFiles]
  );

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

  async function refreshAllFiles() {
    const f = await listAllFiles();
    setAllFiles(f);
  }

  useEffect(() => {
    (async () => {
      try {
        await refreshPatients();
        await refreshAllFiles();
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
      await refreshAllFiles();
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
      await refreshAllFiles();
      startVT(() => setSelectedId(p.id));
      pushToast({ type: "ok", msg: "Paciente actualizado ✅" });
      setShowEdit(false);
    } catch (e: any) {
      pushToast({ type: "err", msg: `No se pudo actualizar: ${errMsg(e)}` });
    }
  }

  async function actionPickPhoto() {
    if (!selected) return;
    photoInputRef.current?.click();
  }

  async function actionAttachFiles() {
    if (!selected) return;
    fileInputRef.current?.click();
  }

  async function actionOpenFile(file: PatientFile) {
    setPreviewFile(file);
  }

  async function onPhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    if (!selected) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await setPatientPhoto(selected.id, file);
      await refreshPatients();
      await refreshAllFiles();
      pushToast({ type: "ok", msg: "Foto actualizada ✅" });
    } catch (err: any) {
      pushToast({ type: "err", msg: `Error foto: ${errMsg(err)}` });
    } finally {
      e.target.value = "";
    }
  }

  async function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    if (!selected) return;
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;
    try {
      await importFiles(selected.id, files);
      await refreshFiles(selected.id);
      await refreshAllFiles();
      pushToast({ type: "ok", msg: "Archivos adjuntados ✅" });
      startVT(() => setSection("archivos"));
    } catch (err: any) {
      pushToast({ type: "err", msg: `Error adjuntar: ${errMsg(err)}` });
    } finally {
      e.target.value = "";
    }
  }

  function resetTrendFilters() {
    setTimePreset("all");
    setDateFrom("");
    setDateTo("");
    setIncludeExams(true);
    setIncludeNotes(true);
    setCalcMode("aggregate");
    setFocusRecord("");
    setScale("10");
  }

  async function actionDeleteSelected() {
    if (!selected) return;
    const ok = confirm(`¿Eliminar a "${selected.name}"? Se eliminarán los datos locales guardados en este navegador.`);
    if (!ok) return;
    try {
      await deletePatient(selected.id);
      await refreshPatients();
      await refreshAllFiles();
      pushToast({ type: "ok", msg: "Paciente eliminado ✅" });
    } catch (e: any) {
      pushToast({ type: "err", msg: `No se pudo eliminar: ${errMsg(e)}` });
    }
  }

  const selectedPhotoSrc = useMemo(() => {
    if (!selected?.photo_path) return null;
    return selected.photo_path;
  }, [selected?.photo_path]);

  const selectedProfile = useMemo(() => {
    if (!selected) return null;
    return profileByPatientMap.get(selected.id) ?? { values: AXES.map(() => 0), accent: "#c7a45a", label: null };
  }, [profileByPatientMap, selected]);
  const profileLabels = useMemo(() => AXES.map((axis) => axis.label), []);
  const radarHint = useMemo(() => {
    if (calcMode === "latest") return "Radar = último registro dentro del filtro";
    if (calcMode === "avg3") return "Radar = promedio de los últimos 3 dentro del filtro";
    return "Radar = promedio de todo lo filtrado";
  }, [calcMode]);
  const emotionColors = useMemo(() => {
    const palette: Record<string, string> = {};
    emotionCounts.labels.forEach((label, idx) => {
      palette[label] = `hsla(${(idx * 70) % 360}, 85%, 62%, .95)`;
    });
    return palette;
  }, [emotionCounts.labels]);
  const emotionDominant = useMemo(() => {
    if (!emotionCounts.values.length) return null;
    const max = Math.max(...emotionCounts.values);
    const idx = emotionCounts.values.findIndex((value) => value === max);
    if (idx === -1) return null;
    const pct = emotionCounts.values.reduce((acc, val) => acc + val, 0)
      ? (emotionCounts.values[idx] / emotionCounts.values.reduce((acc, val) => acc + val, 0)) * 100
      : 0;
    return { label: emotionCounts.labels[idx], pct };
  }, [emotionCounts]);

  return (
    <div
      className="app"
      style={{ "--profile-accent": selectedProfile?.accent ?? "#c7a45a" } as React.CSSProperties}
    >
      <input
        ref={photoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onPhotoSelected}
        style={{ display: "none" }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={onFilesSelected}
        style={{ display: "none" }}
      />
      <div className="shell">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebarTop">
            <div className="brandRow">
              <div className="brand">
                <div className="title">
                  <span>NAJU</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>gestor web</span>
                </div>
                <div className="subtitle">pacientes · exámenes · archivos (web)</div>
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
              const img = p.photo_path ?? null;
              const profile = profileByPatientMap.get(p.id);

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
                  <span className="profileDot" style={{ background: profile?.accent ?? "#c7a45a" }} />
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
                ✏️ editar
              </button>
              <button className="iconBtn" disabled={!selected} onClick={actionPickPhoto}>
                📷 foto
              </button>
              <button className="iconBtn" disabled={!selected} onClick={actionAttachFiles}>
                📎 adjuntar
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
                <button className="segBtn" aria-current={section === "notas"} onClick={() => startVT(() => setSection("notas"))}>
                  Notas
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
              <>
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
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Notas del perfil</div>
                    <div style={{ color: "var(--muted)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {valOrDash(selected.notes)}
                    </div>

                    <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button className="pillBtn primary" onClick={() => setShowExam(true)}>
                        + nuevo examen mental
                      </button>
                      <button className="pillBtn primary" onClick={() => setShowNote(true)}>
                        + nueva nota
                      </button>
                      <button className="pillBtn danger" onClick={actionDeleteSelected}>
                        eliminar paciente
                      </button>
                    </div>
                  </div>
                </div>

                <div className="card profileCard">
                  <div className="profileHeader">
                    <div>
                      <div style={{ fontWeight: 800 }}>Perfil del paciente</div>
                      <div style={{ color: "var(--muted)", fontSize: 13 }}>
                        Tendencias dinámicas con radar y árbol explicativo del filtro actual.
                      </div>
                    </div>
                    <span className="profileBadge">
                      {dominantMacro ? `Dominante: ${dominantMacro.label}` : "Perfil estable"}
                    </span>
                  </div>
                  <div className="profileBody">
                    <div className="panel" style={{ gridColumn: "1 / -1" }}>
                      <div className="hd">
                        <h3>Resumen de tendencias (macro) + explicación (micro)</h3>
                        <span className="pill" id="macroHint">
                          {radarHint}
                        </span>
                      </div>
                      <div className="bd">
                        <div className="radar-wrap">
                          <div className="stack">
                            <div className="radarCanvasWrap">
                              <RadarChart
                                labels={profileLabels}
                                values={radarValues}
                                accent={selectedProfile?.accent ?? "#c7a45a"}
                                max={scaleMax}
                              />
                            </div>
                            <div className="miniHelp" id="treeHow">
                              Árbol: raíz = resumen global · ramas = categorías macro · hojas = micro-evidencias
                              (examen mental + notas) que explican la tendencia.
                            </div>
                            <TrendCanvas labels={profileLabels} files={trendFiles} />
                          </div>

                          <div className="controls">
                            <div className="percent-panel">
                              <h4>Filtros</h4>

                              <div className="field">
                                <label className="label" htmlFor="timePreset">
                                  Rango de fechas
                                </label>
                                <select
                                  id="timePreset"
                                  value={timePreset}
                                  onChange={(e) => setTimePreset(e.target.value)}
                                  className="select"
                                >
                                  <option value="all">Histórico (todo)</option>
                                  <option value="30d">Últimos 30 días</option>
                                  <option value="90d">Últimos 90 días</option>
                                  <option value="custom">Personalizado</option>
                                </select>
                              </div>

                              <div className="row2" style={{ display: timePreset === "custom" ? "grid" : "none" }}>
                                <div className="field">
                                  <label className="label" htmlFor="dateFrom">
                                    Desde
                                  </label>
                                  <input
                                    id="dateFrom"
                                    type="date"
                                    value={dateFrom}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                    className="input"
                                  />
                                </div>
                                <div className="field">
                                  <label className="label" htmlFor="dateTo">
                                    Hasta
                                  </label>
                                  <input
                                    id="dateTo"
                                    type="date"
                                    value={dateTo}
                                    onChange={(e) => setDateTo(e.target.value)}
                                    className="input"
                                  />
                                </div>
                              </div>

                              <div className="checks">
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={includeExams}
                                    onChange={(e) => setIncludeExams(e.target.checked)}
                                  />{" "}
                                  Exámenes
                                </label>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={includeNotes}
                                    onChange={(e) => setIncludeNotes(e.target.checked)}
                                  />{" "}
                                  Notas
                                </label>
                              </div>

                              <div className="field">
                                <label className="label" htmlFor="calcMode">
                                  Cálculo del radar
                                </label>
                                <select
                                  id="calcMode"
                                  value={calcMode}
                                  onChange={(e) => setCalcMode(e.target.value)}
                                  className="select"
                                >
                                  <option value="aggregate">Agregado (promedio del filtro)</option>
                                  <option value="avg3">Promedio últimos 3 (del filtro)</option>
                                  <option value="latest">Último registro (del filtro)</option>
                                </select>
                              </div>

                              <div className="field">
                                <label className="label" htmlFor="focusRecord">
                                  Comparar con un registro (archivo)
                                </label>
                                <select
                                  id="focusRecord"
                                  value={focusRecord}
                                  onChange={(e) => setFocusRecord(e.target.value)}
                                  className="select"
                                >
                                  <option value="">(sin comparación)</option>
                                  {focusOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="field">
                                <label className="label" htmlFor="scale">
                                  Escala
                                </label>
                                <select
                                  id="scale"
                                  value={scale}
                                  onChange={(e) => setScale(e.target.value)}
                                  className="select"
                                >
                                  <option value="10">0 a 10</option>
                                  <option value="5">0 a 5</option>
                                </select>
                              </div>

                              <button className="pillBtn" onClick={resetTrendFilters} style={{ width: "100%" }}>
                                reset filtros
                              </button>
                            </div>

                            <ProgressDashes
                              title="Peso relativo (macro)"
                              labels={profileLabels}
                              values={radarValues}
                              max={scaleMax}
                              colors={PROFILE_COLORS}
                            />
                            <div className="trendPillRow">
                              <span className="pill">
                                {dominantMacro
                                  ? `Dominante: ${dominantMacro.label} (${dominantMacro.pct.toFixed(0)}%)`
                                  : "Dominante: --"}
                              </span>
                              <span className="pill">Suma: {radarSum.toFixed(1)} (macro)</span>
                            </div>

                            {emotionDominant ? (
                              <div className="trendPillRow">
                                <span className="pill">
                                  Predomina: {emotionDominant.label} ({emotionDominant.pct.toFixed(0)}%)
                                </span>
                              </div>
                            ) : null}
                            {emotionCounts.labels.length ? (
                              <ProgressDashes
                                title="Emoción predominante (tipo)"
                                labels={emotionCounts.labels}
                                values={emotionCounts.values}
                                max={100}
                                colors={emotionColors}
                                showScale={false}
                              />
                            ) : (
                              <div className="percent-panel">
                                <h4>Emoción predominante (tipo)</h4>
                                <div className="emptyHint">Sin datos de emoción en el filtro.</div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
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
                        <div className="fileIcon">{fileIcon(f)}</div>
                        <div className="fileMeta">
                          <div className="fileName">{f.filename}</div>
                          <div className="fileSub">{isoToNice(f.created_at)}</div>
                        </div>
                        <button className="smallBtn" onClick={() => actionOpenFile(f)}>
                          abrir
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : section === "notas" ? (
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>Notas</div>
                    <div style={{ color: "var(--muted)", fontSize: 13 }}>Seguimiento clínico rápido con estado y riesgo.</div>
                  </div>
                  <button className="pillBtn primary" onClick={() => setShowNote(true)}>
                    + nueva nota
                  </button>
                </div>

                <div style={{ height: 12 }} />

                <div className="list">
                  {fileGroups.notes.length === 0 ? (
                    <div style={{ color: "var(--muted)" }}>Aún no hay notas.</div>
                  ) : (
                    fileGroups.notes.map((f) => (
                      <div key={f.id} className="fileRow">
                        <div className="fileIcon">{fileIcon(f)}</div>
                        <div className="fileMeta">
                          <div className="fileName">{f.filename}</div>
                          <div className="fileSub">{isoToNice(f.created_at)}</div>
                        </div>
                        <button className="smallBtn" onClick={() => actionOpenFile(f)}>
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
                        <div className="fileIcon">{fileIcon(f)}</div>
                        <div className="fileMeta">
                          <div className="fileName">{f.filename}</div>
                          <div className="fileSub">{isoToNice(f.created_at)}</div>
                        </div>
                        <button className="smallBtn" onClick={() => actionOpenFile(f)}>
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
            await refreshAllFiles();
            pushToast({ type: "ok", msg: "Examen creado ✅" });
            startVT(() => setSection("examenes"));
          }}
        />
      ) : null}

      {showNote && selected ? (
        <NoteModal
          patient={selected}
          onClose={() => setShowNote(false)}
          onCreated={async () => {
            await refreshFiles(selected.id);
            await refreshAllFiles();
            pushToast({ type: "ok", msg: "Nota creada ✅" });
            startVT(() => setSection("notas"));
          }}
        />
      ) : null}

      {previewFile ? <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} /> : null}

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
