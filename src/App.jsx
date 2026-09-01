import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabaseClient";

/* =========================================================
   MOONLIGHT CONCEPT — Job Order System (Supabase-backed)
   Roles: Sales (incl. showroom actions) / Production / Admin
========================================================= */

const STATUS = {
  job_created: { label: "Job Created", color: "#2F8F46" },
  job_rejected: { label: "Job Rejected", color: "#C1302B" },
  job_in_process: { label: "Job In Process", color: "#2F8F46" },
  job_completed: { label: "Job Completed", color: "#2F8F46" },
  job_returned: { label: "Job Returned", color: "#C1302B" },
  job_return_in_process: { label: "Job Return In Process", color: "#2F8F46" },
  job_return_complete: { label: "Job Return Complete", color: "#2F8F46" },
  ready_to_deliver: { label: "Ready To Deliver", color: "#1A1A1A" },
  delivered: { label: "Delivered", color: "#1A1A1A" },
};

const MEASURE_FIELDS = [
  ["shoulder", "Shoulder"], ["chest", "Chest"], ["waist", "Waist"], ["hips", "Hips"],
  ["bottom", "Bottom"], ["lengthFront", "Length Front"], ["lengthBack", "Length Back"],
  ["sleeveLength", "Sleeve Length"], ["sleeveOpen", "Sleeve Open"], ["armHole", "Arm Hole"],
  ["coularLength", "Coular Length"], ["coularWidth", "Coular Width"],
  ["sheilaWidth", "Sheila Width"], ["sheilaLength", "Sheila Length"],
];

const MODEL_FIELDS = [
  ["modelNo", "Model No"], ["possibleCuts", "Possible Cuts"], ["mainFabricCode", "Main Fabric Code"],
  ["innerFabricCode", "Inner Fabric Code"], ["otherFabric", "Other Fabric"], ["sizeRange", "Size Range"],
  ["requirements", "Requirements (if any)"], ["sideFinishing", "Side Finishing"],
  ["sleeveOpenFinishing", "Sleeve Open Finishing"], ["armHoleFinishing", "Arm Hole Finishing"],
  ["bottomFinishing", "Bottom / Length Finishing"],
];

const CORE_FIT_FIELDS = ["shoulder", "chest", "waist", "hips"];

function nearestSize(customerM, sizes) {
  let best = null, bestScore = Infinity;
  sizes.forEach((sz) => {
    let score = 0, count = 0;
    CORE_FIT_FIELDS.forEach((f) => {
      const c = parseFloat(customerM[f]);
      const m = parseFloat(sz.measurements[f]);
      if (!isNaN(c) && !isNaN(m)) { score += Math.abs(c - m); count++; }
    });
    if (count > 0) {
      const avg = score / count;
      if (avg < bestScore) { bestScore = avg; best = sz; }
    }
  });
  return best;
}

function computeDeltas(customerM, baseM) {
  const out = {};
  MEASURE_FIELDS.forEach(([k]) => {
    const c = parseFloat(customerM[k]);
    const b = parseFloat(baseM[k]);
    out[k] = (!isNaN(c) && !isNaN(b)) ? +(c - b).toFixed(1) : null;
  });
  return out;
}

const ITEM_TYPES = ["Abaya", "Sheila", "Jalabiya", "Set"];
const SHEILA_TYPES = ["Chiffon", "Crepe", "Georgette", "Plain"];
const ORDER_TYPES = ["New", "Alteration"];
const ROLE_LABEL = { sales: "Sales Panel", production: "Production Panel", admin: "Admin Panel" };

const fmtDate = (d) => { if (!d) return "—"; try { return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return d; } };
const fmtDateTime = (d) => { try { return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return d; } };

/* ---------------- db <-> app field mapping ---------------- */

function dbToOrder(r) {
  return {
    id: r.id, invoiceNo: r.invoice_no, name: r.name, mobile: r.mobile, orderType: r.order_type,
    model: r.model, item: r.item, preparedBy: r.prepared_by, branch: r.branch,
    measurements: r.measurements || {}, sheilaType: r.sheila_type, abayaOption: r.abaya_option,
    buttonTill: r.button_till, deliveryDate: r.delivery_date, attachmentUrl: r.attachment_url,
    comments: r.comments, status: r.status, history: r.history || [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function orderFieldsToDb(f) {
  const map = {
    invoiceNo: "invoice_no", orderType: "order_type", preparedBy: "prepared_by", sheilaType: "sheila_type",
    abayaOption: "abaya_option", buttonTill: "button_till", deliveryDate: "delivery_date",
    attachmentUrl: "attachment_url",
  };
  const out = {};
  Object.entries(f).forEach(([k, v]) => { out[map[k] || k] = v; });
  return out;
}
function dbToModel(r) {
  return {
    id: r.id, modelNo: r.model_no, possibleCuts: r.possible_cuts, mainFabricCode: r.main_fabric_code,
    innerFabricCode: r.inner_fabric_code, otherFabric: r.other_fabric, sizeRange: r.size_range,
    requirements: r.requirements, sideFinishing: r.side_finishing, sleeveOpenFinishing: r.sleeve_open_finishing,
    armHoleFinishing: r.arm_hole_finishing, bottomFinishing: r.bottom_finishing,
  };
}
function modelToDb(f) {
  return {
    model_no: f.modelNo, possible_cuts: f.possibleCuts, main_fabric_code: f.mainFabricCode,
    inner_fabric_code: f.innerFabricCode, other_fabric: f.otherFabric, size_range: f.sizeRange,
    requirements: f.requirements, side_finishing: f.sideFinishing, sleeve_open_finishing: f.sleeveOpenFinishing,
    arm_hole_finishing: f.armHoleFinishing, bottom_finishing: f.bottomFinishing,
  };
}

/* ---------------- workflow rules ---------------- */

function productionActions(status) {
  if (status === "job_created") return [
    { to: "job_in_process", label: "Accept & Start Production", color: "#2F8F46" },
    { to: "job_rejected", label: "Reject Job", color: "#C1302B", needsComment: true },
  ];
  if (status === "job_in_process") return [{ to: "job_completed", label: "Mark Completed → Send to Showroom", color: "#2F8F46" }];
  if (status === "job_returned") return [{ to: "job_return_in_process", label: "Accept Return & Start Rework", color: "#2F8F46" }];
  if (status === "job_return_in_process") return [{ to: "job_return_complete", label: "Mark Return Complete → Send to Showroom", color: "#2F8F46" }];
  return [];
}
function salesActions(status) {
  if (status === "job_completed") return [
    { to: "ready_to_deliver", label: "Accept & Ready to Deliver", color: "#1A1A1A" },
    { to: "job_returned", label: "Return to Production", color: "#C1302B", needsComment: true },
  ];
  if (status === "job_return_complete") return [{ to: "ready_to_deliver", label: "Accept & Ready to Deliver", color: "#1A1A1A" }];
  if (status === "ready_to_deliver") return [{ to: "delivered", label: "Mark Delivered to Customer", color: "#1A1A1A" }];
  return [];
}
function canEditFields(status, role) {
  if (role === "admin") return true;
  if (role === "sales") return status === "job_created" || status === "job_rejected";
  if (role === "production") return status === "job_rejected";
  return false;
}
function canResubmit(status, role) { return role === "sales" && status === "job_rejected"; }

/* ================= App ================= */

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [profile, setProfile] = useState(null);
  const [config, setConfig] = useState(null);
  const [orders, setOrders] = useState(null);
  const [subpage, setSubpage] = useState("records");
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState(null);

  const flash = (msg) => { setToast(msg); window.clearTimeout(flash._t); flash._t = window.setTimeout(() => setToast(null), 2400); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    supabase.from("profiles").select("*").eq("id", session.user.id).single()
      .then(({ data }) => setProfile(data || null));
  }, [session]);

  const loadAll = useCallback(async () => {
    const [{ data: branches }, { data: salespersons }, { data: models }, { data: ords }] = await Promise.all([
      supabase.from("branches").select("*").order("name"),
      supabase.from("salespersons").select("*").order("name"),
      supabase.from("models").select("*").order("model_no"),
      supabase.from("job_orders").select("*").order("created_at", { ascending: false }),
    ]);
    setConfig({ branches: branches || [], salespersons: salespersons || [], models: (models || []).map(dbToModel) });
    setOrders((ords || []).map(dbToOrder));
  }, []);

  useEffect(() => { if (profile) loadAll(); }, [profile, loadAll]);

  if (session === undefined) return <Loading text="Loading…" />;
  if (!session) return <LoginScreen onLoggedIn={() => {}} />;
  if (profile === null) return <NoProfileScreen onSignOut={() => supabase.auth.signOut()} />;
  if (!config || !orders) return <Loading text="Loading job orders…" />;

  const refresh = loadAll;

  return (
    <Shell session={profile} subpage={subpage} setSubpage={setSubpage} onLogout={() => supabase.auth.signOut()}>
      {profile.role === "sales" && (
        <SalesPanel config={config} orders={orders} refresh={refresh} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} />
      )}
      {profile.role === "production" && (
        <ProductionPanel config={config} orders={orders} refresh={refresh} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} />
      )}
      {profile.role === "admin" && (
        <AdminPanel config={config} refresh={refresh} orders={orders} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} />
      )}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#1A1A1A", color: "#fff", padding: "10px 20px", borderRadius: 4, fontSize: 13, fontFamily: "Inter, sans-serif", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 100 }}>
          {toast}
        </div>
      )}
    </Shell>
  );
}

function Loading({ text }) {
  return <div style={{ padding: 60, textAlign: "center", fontFamily: "Georgia, serif", color: "#8a8a8a" }}>{text}</div>;
}
function NoProfileScreen({ onSignOut }) {
  return (
    <div style={{ padding: 60, textAlign: "center", fontFamily: "Georgia, serif" }}>
      <p>You're signed in, but no profile record exists yet for your account.</p>
      <p style={{ color: "#8a8a8a", fontSize: 14 }}>Ask an Admin to add a row for you in the <code>profiles</code> table (name, role, branch).</p>
      <button onClick={onSignOut} style={{ marginTop: 16, background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px" }}>Sign out</button>
    </div>
  );
}

/* ================= shared UI chrome ================= */

const F = { display: "'Cormorant Garamond', serif", body: "'EB Garamond', Georgia, serif", mono: "'IBM Plex Mono', monospace" };

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=EB+Garamond:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
      * { box-sizing: border-box; }
      body, input, select, textarea, button { font-family: 'EB Garamond', Georgia, serif; }
      button { cursor: pointer; }
      table { border-collapse: collapse; width: 100%; }
      a.link { color: #1A1A1A; text-decoration: underline; cursor: pointer; }
      @media print { .no-print { display: none !important; } }
    `}</style>
  );
}

function Shell({ session, subpage, setSubpage, onLogout, children }) {
  const adminTabs = [
    ["records", "ALL RECORDS"], ["branches", "ADD/REMOVE BRANCH"], ["salespersons", "ADD/REMOVE SALES PERSON"],
    ["models", "ADD/REMOVE MODEL"], ["viewmodels", "VIEW MODELS"],
  ];
  return (
    <div style={{ minHeight: "100vh", background: "#fff", color: "#1A1A1A", fontFamily: F.body }}>
      <GlobalStyle />
      <div className="no-print" style={{ borderBottom: "2px solid #1A1A1A", padding: "18px 30px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 26, letterSpacing: "0.12em" }}>
          MOONLIGHT
          <div style={{ fontSize: 10, letterSpacing: "0.35em", textAlign: "center", fontWeight: 500, marginTop: -4 }}>CONCEPT</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.03em", display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: "#8a8a8a" }}>{session.name} ·</span>
          <span>{ROLE_LABEL[session.role].toUpperCase()}</span>
          {session.role === "production" && (
            <>
              <span>|</span>
              <a className="link" onClick={() => setSubpage("records")}>PRODUCTION PANEL</a>
              <a className="link" onClick={() => setSubpage("items")}>ITEM DETAILS</a>
            </>
          )}
          <span>|</span>
          <a className="link" onClick={onLogout}>LOGOUT</a>
        </div>
      </div>
      {session.role === "admin" && (
        <div className="no-print" style={{ background: "#8a8a8a", padding: "10px 30px", display: "flex", gap: 22, flexWrap: "wrap" }}>
          {adminTabs.map(([key, label]) => (
            <button key={key} onClick={() => setSubpage(key)} style={{ background: "transparent", border: "none", color: "#fff", fontWeight: subpage === key ? 700 : 500, fontSize: 12.5, letterSpacing: "0.04em", textDecoration: subpage === key ? "underline" : "none" }}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div style={{ padding: "26px 30px 60px" }}>{children}</div>
    </div>
  );
}

function StatusTag({ status }) {
  const s = STATUS[status] || { label: status, color: "#1A1A1A" };
  return <span style={{ color: s.color, fontWeight: 700, fontSize: 13 }}>{s.label.toUpperCase()}</span>;
}

const inputStyle = { width: "100%", border: "1px solid #C9CDD3", borderRadius: 3, padding: "8px 9px", fontSize: 14, fontFamily: F.body };
const label13 = { fontSize: 11.5, fontWeight: 600, color: "#5a5a5a", marginBottom: 4, letterSpacing: "0.02em", textTransform: "uppercase" };

function Field({ label, children }) {
  return <label style={{ display: "block", marginBottom: 12 }}><div style={label13}>{label}</div>{children}</label>;
}

/* ---------------- Login (real Supabase auth) ---------------- */

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const login = async () => {
    setBusy(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.body }}>
      <GlobalStyle />
      <div style={{ width: 320, textAlign: "center" }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 34, letterSpacing: "0.14em" }}>MOONLIGHT</div>
        <div style={{ fontSize: 11, letterSpacing: "0.4em", marginTop: -6, marginBottom: 36 }}>CONCEPT</div>

        <div style={{ textAlign: "left", marginBottom: 12 }}>
          <div style={label13}>Email</div>
          <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div style={{ textAlign: "left", marginBottom: 16 }}>
          <div style={label13}>Password</div>
          <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()} />
        </div>
        {error && <div style={{ color: "#C1302B", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button disabled={busy} onClick={login} style={{ width: "100%", background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "11px 0", fontSize: 14, fontWeight: 700, letterSpacing: "0.05em" }}>
          {busy ? "SIGNING IN…" : "LOGIN"}
        </button>
        <div style={{ fontSize: 11.5, color: "#8a8a8a", marginTop: 14 }}>Accounts are created by an Admin in the Supabase dashboard.</div>
      </div>
    </div>
  );
}

/* ---------------- Records table (shared) ---------------- */

function RecordsToolbar({ query, setQuery, statusFilter, setStatusFilter }) {
  return (
    <div className="no-print" style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 18, flexWrap: "wrap", justifyContent: "center" }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>SEARCH BY:</span>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name / Mobile No / Job Order" style={{ ...inputStyle, width: 260 }} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>STATUS TYPE:</span>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 200 }}>
        <option value="all">All statuses</option>
        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
    </div>
  );
}

function OrderTable({ orders, onOpen, editableStatuses, showDelete, onDelete }) {
  if (orders.length === 0) return <div style={{ textAlign: "center", padding: 50, color: "#8a8a8a", fontSize: 14 }}>No job orders found.</div>;
  return (
    <table>
      <thead>
        <tr style={{ borderBottom: "2px solid #1A1A1A", fontSize: 12.5, textAlign: "left" }}>
          {["Name", "Date", "DeliveryDate", "Mobile", "Inv No", "Model", "Salesperson", "Branch", "Status", "View", showDelete ? "Action" : null]
            .filter(Boolean).map((h) => <th key={h} style={{ padding: "9px 10px", fontWeight: 700 }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} style={{ borderBottom: "1px solid #E5E5E5", fontSize: 13.5 }}>
            <td style={{ padding: "9px 10px" }}>{o.name}</td>
            <td style={{ padding: "9px 10px" }}>{fmtDate(o.createdAt)}</td>
            <td style={{ padding: "9px 10px" }}>{fmtDate(o.deliveryDate)}</td>
            <td style={{ padding: "9px 10px" }}>{o.mobile}</td>
            <td style={{ padding: "9px 10px" }} className="mono">{o.invoiceNo}</td>
            <td style={{ padding: "9px 10px" }}>{o.model}</td>
            <td style={{ padding: "9px 10px" }}>{o.preparedBy}</td>
            <td style={{ padding: "9px 10px" }}>{o.branch}</td>
            <td style={{ padding: "9px 10px" }}><StatusTag status={o.status} /></td>
            <td style={{ padding: "9px 10px" }}><a className="link" onClick={() => onOpen(o.id)}>{editableStatuses && editableStatuses.includes(o.status) ? "View/Edit" : "View"}</a></td>
            {showDelete && <td style={{ padding: "9px 10px" }}><a className="link" style={{ color: "#C1302B" }} onClick={() => onDelete(o.id)}>Delete</a></td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function useFilteredOrders(orders, query, statusFilter) {
  return useMemo(() => {
    let list = orders;
    if (statusFilter !== "all") list = list.filter((o) => o.status === statusFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((o) => o.name.toLowerCase().includes(q) || (o.mobile || "").includes(q) || (o.invoiceNo || "").toLowerCase().includes(q));
    }
    return list;
  }, [orders, query, statusFilter]);
}

/* ================= Sales Panel ================= */

function SalesPanel({ config, orders, refresh, session, subpage, setSubpage, selectedId, setSelectedId, flash }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const filtered = useFilteredOrders(orders, query, statusFilter);
  const selected = orders.find((o) => o.id === selectedId);

  const handleCreate = async (form, file) => {
    let attachmentUrl = null;
    if (file) {
      const path = `${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("attachments").upload(path, file);
      if (!upErr) {
        const { data } = supabase.storage.from("attachments").getPublicUrl(path);
        attachmentUrl = data.publicUrl;
      }
    }
    const now = new Date().toISOString();
    const row = {
      invoice_no: form.invoiceNo || null, name: form.name, mobile: form.mobile, order_type: form.orderType,
      model: form.model, item: form.item, prepared_by: session.name, branch: form.branch || session.branch,
      measurements: form.measurements, sheila_type: form.sheilaType, abaya_option: form.abayaOption,
      button_till: form.buttonTill, delivery_date: form.deliveryDate || null,
      attachment_url: attachmentUrl || form.attachmentNote || null, comments: form.comments,
      status: "job_created", history: [{ note: "Job order created by Sales", by: session.name, at: now }],
    };
    const { data, error } = await supabase.from("job_orders").insert(row).select().single();
    if (error) { flash("Error: " + error.message); return; }
    await refresh();
    setSubpage("records");
    setSelectedId(data.id);
    flash("Job order created");
  };

  const handleSaveFields = async (id, fields) => {
    const { error } = await supabase.from("job_orders").update({ ...orderFieldsToDb(fields), updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    await refresh(); flash("Changes saved");
  };

  const handleSaveProfile = async (form, fit) => {
    const row = {
      name: form.name, mobile: form.mobile, measurements: form.measurements, model: form.model,
      recommended_size: fit && !fit.error ? fit.size : null, deltas: fit && !fit.error ? fit.deltas : {},
      branch: session.branch, created_by: session.name,
    };
    const { error } = await supabase.from("customer_profiles").insert(row);
    if (error) { flash("Error: " + error.message); return; }
    setSubpage("records"); flash("Customer profile saved");
  };

  const handleCreateOrderFromRequirement = async (form, fit) => {
    const profileRow = {
      name: form.name, mobile: form.mobile, measurements: form.measurements, model: form.model,
      recommended_size: fit && !fit.error ? fit.size : null, deltas: fit && !fit.error ? fit.deltas : {},
      branch: session.branch, created_by: session.name,
    };
    const { data: profile } = await supabase.from("customer_profiles").insert(profileRow).select().single();

    const now = new Date().toISOString();
    const fitNote = fit && !fit.error ? `Closest size: ${fit.size}. Adjustments: ${MEASURE_FIELDS.map(([k, l]) => `${l} ${fit.deltas[k] > 0 ? "+" : ""}${fit.deltas[k] ?? "—"}`).join(", ")}` : "";
    const orderRow = {
      name: form.name, mobile: form.mobile, order_type: "New", model: form.model, item: ITEM_TYPES[0],
      prepared_by: session.name, branch: session.branch, measurements: form.measurements,
      comments: fitNote, status: "job_created",
      history: [{ note: "Job order created from customer requirement", by: session.name, at: now }],
    };
    const { data: order, error } = await supabase.from("job_orders").insert(orderRow).select().single();
    if (error) { flash("Error: " + error.message); return; }
    if (profile) await supabase.from("customer_profiles").update({ job_order_id: order.id }).eq("id", profile.id);
    await refresh(); setSubpage("records"); setSelectedId(order.id); flash("Job order created from requirement");
  };

  const runHistoryUpdate = async (id, status, note) => {
    const current = orders.find((o) => o.id === id);
    const history = [...current.history, { note, by: session.name, at: new Date().toISOString() }];
    const { error } = await supabase.from("job_orders").update({ status, history, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    await refresh(); flash(STATUS[status].label);
  };

  const handleAction = (id, to, comment) => runHistoryUpdate(id, to, comment ? `${STATUS[to].label}: ${comment}` : STATUS[to].label);
  const handleResubmit = (id) => runHistoryUpdate(id, "job_created", "Resubmitted to Production");

  if (subpage === "new") return <JobOrderForm config={config} session={session} onCancel={() => setSubpage("records")} onSubmit={handleCreate} />;
  if (subpage === "requirement") {
    return <RequirementForm config={config} session={session} onCancel={() => setSubpage("records")} onSaveProfile={handleSaveProfile} onCreateOrder={handleCreateOrderFromRequirement} />;
  }

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ALL RECORDS</h2>
      <RecordsToolbar query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
      <div className="no-print" style={{ textAlign: "right", marginBottom: 10 }}>
        <button onClick={() => setSubpage("requirement")} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.03em", marginRight: 8 }}>+ NEW REQUIREMENT</button>
        <button onClick={() => setSubpage("new")} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.03em" }}>+ NEW JOB ORDER</button>
      </div>
      <OrderTable orders={filtered} onOpen={setSelectedId} editableStatuses={["job_rejected", "ready_to_deliver"]} />
      {selected && <OrderDetail order={selected} role="sales" session={session} onClose={() => setSelectedId(null)} onSaveFields={handleSaveFields} onAction={handleAction} onResubmit={handleResubmit} />}
    </div>
  );
}

/* ---------------- Job Order form ---------------- */

function JobOrderForm({ config, session, onCancel, onSubmit }) {
  const [form, setForm] = useState({
    name: "", mobile: "", invoiceNo: "", orderType: "New", model: config.models[0]?.modelNo || "",
    item: ITEM_TYPES[0], branch: session.branch || config.branches[0]?.name || "",
    measurements: Object.fromEntries(MEASURE_FIELDS.map(([k]) => [k, ""])),
    sheilaType: SHEILA_TYPES[0], abayaOption: "fullButton", buttonTill: "",
    deliveryDate: "", attachmentNote: "", comments: "",
  });
  const [file, setFile] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setMeasure = (k) => (e) => setForm((f) => ({ ...f, measurements: { ...f.measurements, [k]: e.target.value } }));
  const model = config.models.find((m) => m.modelNo === form.model);
  const valid = form.name.trim() && form.mobile.trim();

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>JOB ORDER</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 6 }}>
        <Field label="Name"><input style={inputStyle} value={form.name} onChange={set("name")} /></Field>
        <Field label="Mobile No"><input style={inputStyle} value={form.mobile} onChange={set("mobile")} /></Field>
        <Field label="Date"><input style={inputStyle} value={fmtDate(new Date())} disabled /></Field>
        <Field label="Invoice No"><input style={inputStyle} value={form.invoiceNo} onChange={set("invoiceNo")} placeholder="optional" /></Field>
        <Field label="Order Type"><select style={inputStyle} value={form.orderType} onChange={set("orderType")}>{ORDER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Model"><select style={inputStyle} value={form.model} onChange={set("model")}>{config.models.map((m) => <option key={m.id} value={m.modelNo}>{m.modelNo}</option>)}</select></Field>
        <Field label="Select Item"><select style={inputStyle} value={form.item} onChange={set("item")}>{ITEM_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Prepared By"><input style={inputStyle} value={session.name} disabled /></Field>
        <Field label="Branch"><select style={inputStyle} value={form.branch} onChange={set("branch")}>{config.branches.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}</select></Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12, marginTop: 14 }}>
        {MEASURE_FIELDS.map(([k, l]) => <Field key={k} label={l}><input style={inputStyle} value={form.measurements[k]} onChange={setMeasure(k)} /></Field>)}
      </div>

      <div style={{ display: "flex", gap: 26, alignItems: "flex-end", marginTop: 6, marginBottom: 18, flexWrap: "wrap" }}>
        <Field label="Sheila Type"><select style={{ ...inputStyle, width: 180 }} value={form.sheilaType} onChange={set("sheilaType")}>{SHEILA_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <div>
          <div style={label13}>Abaya Option</div>
          <div style={{ display: "flex", gap: 16, fontSize: 13.5, paddingTop: 6 }}>
            {[["fullButton", "Full Button"], ["normal", "Normal"], ["buttonFromTill", "Button From/Till"]].map(([k, l]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="radio" checked={form.abayaOption === k} onChange={() => setForm((f) => ({ ...f, abayaOption: k }))} /> {l}
              </label>
            ))}
            {form.abayaOption === "buttonFromTill" && <input style={{ ...inputStyle, width: 90 }} value={form.buttonTill} onChange={set("buttonTill")} placeholder="e.g. 20cm" />}
          </div>
        </div>
      </div>

      {model && (
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 20, border: "1px solid #C9CDD3", padding: 18, marginBottom: 18 }}>
          <div style={{ background: "#F2F2F2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#8a8a8a", textAlign: "center", padding: 10 }}>Product photo<br />on file for {model.modelNo}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>DEFAULT PRODUCT DETAILS</div>
            {MODEL_FIELDS.map(([k, l]) => <div key={k} style={{ fontSize: 13, marginBottom: 3 }}><strong>{l.toUpperCase()}:</strong> {model[k] || "—"}</div>)}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label="Delivery Date"><input type="date" style={inputStyle} value={form.deliveryDate} onChange={set("deliveryDate")} /></Field>
        <Field label="Attachment (photo/video reference)">
          <input type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} style={inputStyle} />
        </Field>
      </div>
      <Field label="Comments"><textarea style={{ ...inputStyle, minHeight: 70 }} value={form.comments} onChange={set("comments")} /></Field>

      <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 20 }}>
        <button onClick={() => window.print()} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>PRINT / SAVE PDF</button>
        <button disabled={!valid} onClick={() => onSubmit(form, file)} style={{ background: valid ? "#3B6FA0" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>SUBMIT</button>
        <button onClick={onCancel} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>CANCEL</button>
      </div>
    </div>
  );
}

function RequirementForm({ config, session, onCancel, onSaveProfile, onCreateOrder }) {
  const [form, setForm] = useState({
    name: "", mobile: "", model: config.models[0]?.modelNo || "",
    measurements: Object.fromEntries(MEASURE_FIELDS.map(([k]) => [k, ""])),
  });
  const [sizes, setSizes] = useState([]);
  const [fit, setFit] = useState(null); // { size, deltas }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setMeasure = (k) => (e) => setForm((f) => ({ ...f, measurements: { ...f.measurements, [k]: e.target.value } }));

  useEffect(() => {
    const m = config.models.find((mm) => mm.modelNo === form.model);
    if (!m) { setSizes([]); return; }
    supabase.from("model_sizes").select("*").eq("model_id", m.id).then(({ data }) => setSizes(data || []));
  }, [form.model, config.models]);

  const computeFit = () => {
    if (sizes.length === 0) { setFit({ error: "No size measurements saved for this model yet — add them in Admin > Add/Remove Model." }); return; }
    const best = nearestSize(form.measurements, sizes);
    if (!best) { setFit({ error: "Enter at least shoulder, chest, waist or hips to compute a match." }); return; }
    setFit({ size: best.size_label, deltas: computeDeltas(form.measurements, best.measurements) });
  };

  const valid = form.name.trim() && form.mobile.trim();

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>CUSTOMER REQUIREMENT</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 6 }}>
        <Field label="Customer Name"><input style={inputStyle} value={form.name} onChange={set("name")} /></Field>
        <Field label="Mobile No"><input style={inputStyle} value={form.mobile} onChange={set("mobile")} /></Field>
        <Field label="Model"><select style={inputStyle} value={form.model} onChange={set("model")}>{config.models.map((m) => <option key={m.id} value={m.modelNo}>{m.modelNo}</option>)}</select></Field>
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, margin: "14px 0 6px" }}>CUSTOMER FITTING MEASUREMENTS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
        {MEASURE_FIELDS.map(([k, l]) => <Field key={k} label={l}><input style={inputStyle} value={form.measurements[k]} onChange={setMeasure(k)} /></Field>)}
      </div>

      <button onClick={computeFit} style={{ marginTop: 14, background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Compute Fit</button>

      {fit && fit.error && <div style={{ color: "#C1302B", marginTop: 12, fontSize: 13 }}>{fit.error}</div>}

      {fit && !fit.error && (
        <div style={{ marginTop: 18, border: "1px solid #C9CDD3", padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Closest base size: {fit.size}</div>
          <table>
            <thead><tr style={{ fontSize: 12, textAlign: "left", borderBottom: "1px solid #E5E5E5" }}><th>Measurement</th><th>Customer</th><th>Difference from {fit.size}</th></tr></thead>
            <tbody>
              {MEASURE_FIELDS.map(([k, l]) => (
                <tr key={k} style={{ fontSize: 13 }}>
                  <td style={{ padding: "4px 0" }}>{l}</td>
                  <td>{form.measurements[k] || "—"}</td>
                  <td style={{ color: fit.deltas[k] > 0 ? "#2F8F46" : fit.deltas[k] < 0 ? "#C1302B" : "#1A1A1A", fontWeight: 600 }}>
                    {fit.deltas[k] == null ? "—" : (fit.deltas[k] > 0 ? "+" : "") + fit.deltas[k]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 22 }}>
        <button disabled={!valid} onClick={() => onSaveProfile(form, fit)} style={{ background: valid ? "#1A1A1A" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>Save Profile</button>
        <button disabled={!valid} onClick={() => onCreateOrder(form, fit)} style={{ background: valid ? "#2F8F46" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>Save & Create Job Order</button>
        <button onClick={onCancel} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------------- Order detail ---------------- */

function OrderDetail({ order, role, session, onClose, onSaveFields, onAction, onResubmit, onDelete }) {
  const [edit, setEdit] = useState(false);
  const [comment, setComment] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const editable = canEditFields(order.status, role);
  const resubmittable = canResubmit(order.status, role);
  const actions = role === "production" ? productionActions(order.status) : role === "sales" ? salesActions(order.status) : [];

  const confirmAction = (a) => {
    if (a.needsComment && !pendingAction) { setPendingAction(a); return; }
    onAction(order.id, a.to, a.needsComment ? comment : undefined);
    setPendingAction(null); setComment("");
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "flex-end", zIndex: 50 }} className="no-print" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: 520, maxWidth: "100%", height: "100%", overflowY: "auto", padding: "26px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div>
            <div className="mono" style={{ fontSize: 12, color: "#8a8a8a" }}>{order.invoiceNo}</div>
            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20 }}>{order.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "#8a8a8a" }}>×</button>
        </div>
        <StatusTag status={order.status} />

        {!edit ? (
          <div style={{ marginTop: 16 }}>
            <Row l="Mobile" v={order.mobile} /><Row l="Order Type" v={order.orderType} />
            <Row l="Model" v={order.model} /><Row l="Item" v={order.item} />
            <Row l="Prepared By" v={order.preparedBy} /><Row l="Branch" v={order.branch} />
            <Row l="Delivery Date" v={fmtDate(order.deliveryDate)} />
            <Row l="Sheila Type" v={order.sheilaType} /><Row l="Abaya Option" v={order.abayaOption} />
            <Row l="Attachment" v={order.attachmentUrl ? <a className="link" href={order.attachmentUrl} target="_blank" rel="noreferrer">View file</a> : "—"} />
            <Row l="Comments" v={order.comments || "—"} />
            <div style={{ marginTop: 10, fontWeight: 700, fontSize: 12.5, color: "#5a5a5a" }}>MEASUREMENTS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 13 }}>
              {MEASURE_FIELDS.map(([k, l]) => <div key={k}>{l}: {order.measurements[k] || "—"}</div>)}
            </div>

            {editable && <button onClick={() => setEdit(true)} style={{ marginTop: 14, background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>Edit Details</button>}
            {resubmittable && <button onClick={() => onResubmit(order.id)} style={{ marginTop: 14, marginLeft: 8, background: "#2F8F46", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Resubmit to Production</button>}

            {actions.length > 0 && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #E5E5E5" }}>
                {actions.map((a) => (
                  <div key={a.to} style={{ marginBottom: 10 }}>
                    <button onClick={() => confirmAction(a)} style={{ width: "100%", background: a.color, color: "#fff", border: "none", borderRadius: 3, padding: "10px 14px", fontWeight: 700, fontSize: 13.5 }}>{a.label}</button>
                    {pendingAction && pendingAction.to === a.to && (
                      <div style={{ marginTop: 8 }}>
                        <textarea autoFocus style={{ ...inputStyle, minHeight: 60 }} placeholder="Add a comment (required)" value={comment} onChange={(e) => setComment(e.target.value)} />
                        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                          <button disabled={!comment.trim()} onClick={() => confirmAction(a)} style={{ background: comment.trim() ? a.color : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "7px 14px", fontSize: 12.5, fontWeight: 700 }}>Confirm</button>
                          <button onClick={() => { setPendingAction(null); setComment(""); }} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "7px 14px", fontSize: 12.5, fontWeight: 700 }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {onDelete && <button onClick={() => onDelete(order.id)} style={{ marginTop: 16, background: "#fff", border: "1px solid #C1302B", color: "#C1302B", borderRadius: 3, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>Delete Record</button>}

            <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid #E5E5E5" }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#5a5a5a", marginBottom: 8 }}>ACTIVITY LOG</div>
              {order.history.slice().reverse().map((h, i) => (
                <div key={i} style={{ fontSize: 12.5, marginBottom: 8 }}>
                  <div>{h.note}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "#8a8a8a" }}>{h.by} · {fmtDateTime(h.at)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EditFieldsForm order={order} onCancel={() => setEdit(false)} onSave={(fields) => { onSaveFields(order.id, fields); setEdit(false); }} />
        )}
      </div>
    </div>
  );
}

function Row({ l, v }) { return <div style={{ display: "flex", fontSize: 13.5, marginBottom: 5 }}><div style={{ width: 130, color: "#8a8a8a" }}>{l}</div><div>{v}</div></div>; }

function EditFieldsForm({ order, onCancel, onSave }) {
  const [form, setForm] = useState({ ...order, measurements: { ...order.measurements } });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setMeasure = (k) => (e) => setForm((f) => ({ ...f, measurements: { ...f.measurements, [k]: e.target.value } }));
  return (
    <div style={{ marginTop: 14 }}>
      <Field label="Name"><input style={inputStyle} value={form.name} onChange={set("name")} /></Field>
      <Field label="Mobile"><input style={inputStyle} value={form.mobile} onChange={set("mobile")} /></Field>
      <Field label="Delivery Date"><input type="date" style={inputStyle} value={form.deliveryDate || ""} onChange={set("deliveryDate")} /></Field>
      <Field label="Comments"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.comments || ""} onChange={set("comments")} /></Field>
      <div style={{ fontWeight: 700, fontSize: 12, color: "#5a5a5a", margin: "10px 0 6px" }}>MEASUREMENTS</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {MEASURE_FIELDS.map(([k, l]) => <Field key={k} label={l}><input style={inputStyle} value={form.measurements[k] || ""} onChange={setMeasure(k)} /></Field>)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={() => onSave({ name: form.name, mobile: form.mobile, deliveryDate: form.deliveryDate, comments: form.comments, measurements: form.measurements })} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Save Changes</button>
        <button onClick={onCancel} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================= Production Panel ================= */

function ProductionPanel({ config, orders, refresh, session, subpage, setSubpage, selectedId, setSelectedId, flash }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const visible = orders.filter((o) => o.status !== "ready_to_deliver" && o.status !== "delivered");
  const filtered = useFilteredOrders(visible, query, statusFilter);
  const selected = orders.find((o) => o.id === selectedId);

  const handleSaveFields = async (id, fields) => {
    const { error } = await supabase.from("job_orders").update({ ...orderFieldsToDb(fields), updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    await refresh(); flash("Changes saved");
  };
  const handleAction = async (id, to, comment) => {
    const current = orders.find((o) => o.id === id);
    const note = comment ? `${STATUS[to].label}: ${comment}` : STATUS[to].label;
    const history = [...current.history, { note, by: session.name, at: new Date().toISOString() }];
    const { error } = await supabase.from("job_orders").update({ status: to, history, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    await refresh(); flash(STATUS[to].label);
  };

  if (subpage === "items") return <ModelBrowser models={config.models} />;

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ALL RECORDS</h2>
      <RecordsToolbar query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
      <OrderTable orders={filtered} onOpen={setSelectedId} editableStatuses={["job_rejected"]} />
      {selected && <OrderDetail order={selected} role="production" session={session} onClose={() => setSelectedId(null)} onSaveFields={handleSaveFields} onAction={handleAction} />}
    </div>
  );
}

function ModelBrowser({ models }) {
  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ITEM DETAILS</h2>
      <div style={{ display: "grid", gap: 16 }}>
        {models.map((m) => (
          <div key={m.id} style={{ border: "1px solid #C9CDD3", padding: 16, display: "grid", gridTemplateColumns: "160px 1fr", gap: 18 }}>
            <div style={{ background: "#F2F2F2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#8a8a8a", textAlign: "center" }}>Product photo<br />{m.modelNo}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{m.modelNo}</div>
              {MODEL_FIELDS.slice(1).map(([k, l]) => <div key={k} style={{ fontSize: 13, marginBottom: 3 }}><strong>{l}:</strong> {m[k] || "—"}</div>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= Admin Panel ================= */

function AdminPanel({ config, refresh, orders, session, subpage, setSubpage, selectedId, setSelectedId, flash }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const filtered = useFilteredOrders(orders, query, statusFilter);
  const selected = orders.find((o) => o.id === selectedId);

  const handleDeleteOrder = async (id) => {
    const { error } = await supabase.from("job_orders").delete().eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    setSelectedId(null); await refresh(); flash("Record deleted");
  };
  const handleSaveFields = async (id, fields) => {
    const { error } = await supabase.from("job_orders").update({ ...orderFieldsToDb(fields), updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    await refresh(); flash("Changes saved");
  };

  const handleCreate = async (form, file) => {
    let attachmentUrl = null;
    if (file) {
      const path = `${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("attachments").upload(path, file);
      if (!upErr) {
        const { data } = supabase.storage.from("attachments").getPublicUrl(path);
        attachmentUrl = data.publicUrl;
      }
    }
    const now = new Date().toISOString();
    const row = {
      invoice_no: form.invoiceNo || null, name: form.name, mobile: form.mobile, order_type: form.orderType,
      model: form.model, item: form.item, prepared_by: session.name, branch: form.branch || session.branch,
      measurements: form.measurements, sheila_type: form.sheilaType, abaya_option: form.abayaOption,
      button_till: form.buttonTill, delivery_date: form.deliveryDate || null,
      attachment_url: attachmentUrl || form.attachmentNote || null, comments: form.comments,
      status: "job_created", history: [{ note: `Job order created by Admin (${session.name})`, by: session.name, at: now }],
    };
    const { data, error } = await supabase.from("job_orders").insert(row).select().single();
    if (error) { flash("Error: " + error.message); return; }
    await refresh();
    setSubpage("records");
    setSelectedId(data.id);
    flash("Job order created");
  };

  const handleSaveProfile = async (form, fit) => {
    const row = {
      name: form.name, mobile: form.mobile, measurements: form.measurements, model: form.model,
      recommended_size: fit && !fit.error ? fit.size : null, deltas: fit && !fit.error ? fit.deltas : {},
      branch: form.branch || session.branch, created_by: session.name,
    };
    const { error } = await supabase.from("customer_profiles").insert(row);
    if (error) { flash("Error: " + error.message); return; }
    setSubpage("records"); flash("Customer profile saved");
  };

  const handleCreateOrderFromRequirement = async (form, fit) => {
    const profileRow = {
      name: form.name, mobile: form.mobile, measurements: form.measurements, model: form.model,
      recommended_size: fit && !fit.error ? fit.size : null, deltas: fit && !fit.error ? fit.deltas : {},
      branch: form.branch || session.branch, created_by: session.name,
    };
    const { data: profile } = await supabase.from("customer_profiles").insert(profileRow).select().single();

    const now = new Date().toISOString();
    const fitNote = fit && !fit.error ? `Closest size: ${fit.size}. Adjustments: ${MEASURE_FIELDS.map(([k, l]) => `${l} ${fit.deltas[k] > 0 ? "+" : ""}${fit.deltas[k] ?? "—"}`).join(", ")}` : "";
    const orderRow = {
      name: form.name, mobile: form.mobile, order_type: "New", model: form.model, item: ITEM_TYPES[0],
      prepared_by: session.name, branch: form.branch || session.branch, measurements: form.measurements,
      comments: fitNote, status: "job_created",
      history: [{ note: `Job order created from customer requirement by Admin (${session.name})`, by: session.name, at: now }],
    };
    const { data: order, error } = await supabase.from("job_orders").insert(orderRow).select().single();
    if (error) { flash("Error: " + error.message); return; }
    if (profile) await supabase.from("customer_profiles").update({ job_order_id: order.id }).eq("id", profile.id);
    await refresh(); setSubpage("records"); setSelectedId(order.id); flash("Job order created from requirement");
  };

  if (subpage === "branches") return <ManageList title="ADD / REMOVE BRANCH" items={config.branches} fields={[["name", "Branch Name"]]}
    onAdd={async (item) => { const { error } = await supabase.from("branches").insert(item); if (error) flash("Error: " + error.message); else { await refresh(); flash("Branch added"); } }}
    onRemove={async (id) => { await supabase.from("branches").delete().eq("id", id); await refresh(); }} />;

  if (subpage === "salespersons") return <ManageList title="ADD / REMOVE SALES PERSON" items={config.salespersons}
    fields={[["name", "Name"], ["branch", "Branch", config.branches.map((b) => b.name)]]}
    onAdd={async (item) => { const { error } = await supabase.from("salespersons").insert(item); if (error) flash("Error: " + error.message); else { await refresh(); flash("Added"); } }}
    onRemove={async (id) => { await supabase.from("salespersons").delete().eq("id", id); await refresh(); }} />;

  if (subpage === "models") return <ManageModels config={config} refresh={refresh} flash={flash} />;
  if (subpage === "viewmodels") return <ModelBrowser models={config.models} />;
  if (subpage === "new") {
    return <JobOrderForm config={config} session={session} onCancel={() => setSubpage("records")} onSubmit={handleCreate} />;
  }
  if (subpage === "requirement") {
    return <RequirementForm config={config} session={session} onCancel={() => setSubpage("records")} onSaveProfile={handleSaveProfile} onCreateOrder={handleCreateOrderFromRequirement} />;
  }

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ALL RECORDS</h2>
      <RecordsToolbar query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
      <div className="no-print" style={{ textAlign: "right", marginBottom: 10 }}>
        <button onClick={() => setSubpage("requirement")} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.03em", marginRight: 8 }}>+ NEW REQUIREMENT</button>
        <button onClick={() => setSubpage("new")} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.03em" }}>+ NEW JOB ORDER</button>
      </div>
      <OrderTable orders={filtered} onOpen={setSelectedId} showDelete onDelete={handleDeleteOrder} />
      {selected && <OrderDetail order={selected} role="admin" session={session} onClose={() => setSelectedId(null)} onSaveFields={handleSaveFields} onAction={() => {}} onDelete={handleDeleteOrder} />}
    </div>
  );
}

function ManageList({ title, items, fields, onAdd, onRemove }) {
  const [form, setForm] = useState(Object.fromEntries(fields.map(([k, , opts]) => [k, opts ? opts[0] : ""])));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 20, letterSpacing: "0.05em", marginBottom: 20 }}>{title}</h2>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        {fields.map(([k, l, opts]) => (
          <div key={k} style={{ flex: 1, minWidth: 130 }}>
            <div style={label13}>{l}</div>
            {opts ? <select style={inputStyle} value={form[k]} onChange={set(k)}>{opts.map((o) => <option key={o} value={o}>{o || "—"}</option>)}</select> : <input style={inputStyle} value={form[k]} onChange={set(k)} />}
          </div>
        ))}
        <button onClick={() => onAdd(form)} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 16px", fontSize: 13, fontWeight: 700, height: 38 }}>Add</button>
      </div>
      <table>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} style={{ borderBottom: "1px solid #E5E5E5" }}>
              {fields.map(([k]) => <td key={k} style={{ padding: "8px 6px", fontSize: 13.5 }}>{it[k] || "—"}</td>)}
              <td style={{ padding: "8px 6px", textAlign: "right" }}><a className="link" style={{ color: "#C1302B" }} onClick={() => onRemove(it.id)}>Remove</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelSizes({ model, refresh, flash }) {
  const [sizes, setSizes] = useState([]);
  const [form, setForm] = useState({ size_label: "Small", measurements: Object.fromEntries(MEASURE_FIELDS.map(([k]) => [k, ""])) });

  const load = () => supabase.from("model_sizes").select("*").eq("model_id", model.id).then(({ data }) => setSizes(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setMeasure = (k) => (e) => setForm((f) => ({ ...f, measurements: { ...f.measurements, [k]: e.target.value } }));

  const add = async () => {
    const { error } = await supabase.from("model_sizes").insert({ model_id: model.id, size_label: form.size_label, measurements: form.measurements });
    if (error) { flash("Error: " + error.message); return; }
    setForm({ size_label: "Small", measurements: Object.fromEntries(MEASURE_FIELDS.map(([k]) => [k, ""])) });
    load(); flash("Size added");
  };
  const remove = async (id) => { await supabase.from("model_sizes").delete().eq("id", id); load(); };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #C9CDD3" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>SIZE MEASUREMENTS FOR {model.modelNo}</div>
      {sizes.map((s) => (
        <div key={s.id} style={{ fontSize: 12.5, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
          <span><strong>{s.size_label}:</strong> {MEASURE_FIELDS.map(([k, l]) => `${l} ${s.measurements[k] || "—"}`).join(", ")}</span>
          <a className="link" style={{ color: "#C1302B" }} onClick={() => remove(s.id)}>Remove</a>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
        <div>
          <div style={label13}>Size Label</div>
          <select style={{ ...inputStyle, width: 110 }} value={form.size_label} onChange={set("size_label")}>
            {["Small", "Medium", "Large", "X-Large"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        {MEASURE_FIELDS.map(([k, l]) => (
          <div key={k} style={{ width: 70 }}>
            <div style={{ ...label13, fontSize: 9.5 }}>{l}</div>
            <input style={{ ...inputStyle, padding: "6px 6px" }} value={form.measurements[k]} onChange={setMeasure(k)} />
          </div>
        ))}
        <button onClick={add} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, height: 34 }}>Add Size</button>
      </div>
    </div>
  );
}

function ManageModels({ config, refresh, flash }) {
  const blank = Object.fromEntries(MODEL_FIELDS.map(([k]) => [k, ""]));
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const add = async () => {
    if (!form.modelNo.trim()) return;
    const { error } = await supabase.from("models").insert(modelToDb(form));
    if (error) { flash("Error: " + error.message); return; }
    setForm(blank); await refresh(); flash("Model added");
  };
  const remove = async (id) => { await supabase.from("models").delete().eq("id", id); await refresh(); };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 20, letterSpacing: "0.05em", marginBottom: 20 }}>ADD / REMOVE MODEL</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        {MODEL_FIELDS.map(([k, l]) => <Field key={k} label={l}><input style={inputStyle} value={form[k]} onChange={set(k)} /></Field>)}
      </div>
      <button onClick={add} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, marginBottom: 24 }}>Add Model</button>
      <div style={{ display: "grid", gap: 10 }}>
        {config.models.map((m) => (
          <div key={m.id} style={{ border: "1px solid #E5E5E5", padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><strong>{m.modelNo}</strong> — {m.mainFabricCode} — {m.sizeRange}</div>
              <a className="link" style={{ color: "#C1302B" }} onClick={() => remove(m.id)}>Remove</a>
            </div>
            <ModelSizes model={m} refresh={refresh} flash={flash} />
          </div>
        ))}
      </div>
    </div>
  );
}
