import React, { useMemo, useState } from "react";
import type { ErrorReport, ErrorReportInput, Patient } from "./lib/api";
import { downloadTextFile } from "./lib/export";

function errMsg(e: any) {
  if (!e) return "Error desconocido";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export default function ErrorCenter(props: {
  reports: ErrorReport[];
  patients: Patient[];
  onCreate: (input: ErrorReportInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<"baja" | "media" | "alta">("media");
  const [patientId, setPatientId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => {
    const m = new Map<string, string>();
    props.patients.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [props.patients]);

  function exportJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      reports: props.reports,
    };
    downloadTextFile("naju_error_reports.json", "application/json;charset=utf-8", JSON.stringify(payload, null, 2));
    setToast({ type: "ok", msg: "JSON exportado ✅" });
  }

  async function submit() {
    try {
      setBusy(true);
      setToast(null);
      const ctx = {
        userAgent: navigator.userAgent,
        url: location.href,
        time: new Date().toISOString(),
      };
      await props.onCreate({
        title,
        severity,
        patient_id: patientId ? patientId : null,
        description,
        steps: steps.trim() ? steps : null,
        expected: expected.trim() ? expected : null,
        actual: actual.trim() ? actual : null,
        context: ctx,
      });
      setTitle("");
      setSeverity("media");
      setPatientId("");
      setDescription("");
      setSteps("");
      setExpected("");
      setActual("");
      setToast({ type: "ok", msg: "Reporte guardado ✅" });
      await props.onRefresh();
    } catch (e: any) {
      setToast({ type: "err", msg: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Reporte de errores</div>
            <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
              Guarda incidentes y exporta un JSON para soporte.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="pillBtn" onClick={props.onRefresh} disabled={busy}>Refrescar</button>
            <button className="pillBtn primary" onClick={exportJson} disabled={busy || props.reports.length === 0}>
              Exportar JSON
            </button>
          </div>
        </div>
      </div>

      {toast ? (
        <div className={"toast " + (toast.type === "ok" ? "ok" : "err")}>
          {toast.msg}
        </div>
      ) : null}

      <div className="grid2">
        <div className="card">
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Nuevo reporte</div>

          <div className="field">
            <div className="label">Título</div>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: No guarda una nota" />
          </div>

          <div className="grid2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <div className="label">Severidad</div>
              <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as any)}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
              </select>
            </div>

            <div className="field">
              <div className="label">Paciente (opcional)</div>
              <select className="input" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                <option value="">—</option>
                {props.patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <div className="label">Descripción</div>
            <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Qué pasó, cuándo y dónde." />
          </div>

          <div className="field">
            <div className="label">Pasos para reproducir (opcional)</div>
            <textarea className="textarea" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="1) … 2) … 3) …" />
          </div>

          <div className="grid2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <div className="label">Esperado (opcional)</div>
              <textarea className="textarea" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Qué esperabas que pasara." />
            </div>
            <div className="field">
              <div className="label">Actual (opcional)</div>
              <textarea className="textarea" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="Qué pasó realmente." />
            </div>
          </div>

          <button className="pillBtn primary" onClick={submit} disabled={busy}>
            Guardar reporte
          </button>

          <div style={{ height: 10 }} />
          <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            Tip: adjunta pasos claros. Si es por paciente, selecciónalo para contexto.
          </div>
        </div>

        <div className="card">
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Historial</div>
          {props.reports.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>Aún no hay reportes.</div>
          ) : (
            <div className="list">
              {props.reports.map((r) => (
                <div key={r.id} className="fileRow">
                  <div className="fileIcon">🐞</div>
                  <div className="fileMeta">
                    <div className="fileName">
                      {r.title} <span className="badge">{r.severity}</span> {r.status !== "abierto" ? <span className="badge">{r.status}</span> : null}
                    </div>
                    <div className="fileSub">
                      {new Date(r.created_at).toLocaleString()}
                      {r.patient_id ? ` · ${byId.get(r.patient_id) || "Paciente"}` : ""}
                    </div>
                  </div>
                  <button className="smallBtn danger" onClick={() => props.onDelete(r.id)} disabled={busy}>
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
