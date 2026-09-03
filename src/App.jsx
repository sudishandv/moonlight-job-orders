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

const STYLE_FIELDS = [
  ["collectionName", "Collection Name"], ["styleName", "Style Name"], ["category", "Category"],
  ["productType", "Product Type"], ["season", "Season"],
];
const PHOTO_VIEWS = ["Front", "Back", "Side", "Detail"];

const FITTING_FIELDS_GENERAL = [
  ["neckSize", "Neck Size"], ["shoulder", "Shoulder"], ["chest", "Chest"], ["waist", "Waist"], ["hips", "Hips"],
  ["sleeveLength", "Sleeve Length"], ["aroundArmhole", "Around Armhole"], ["bicep", "Bicep"], ["wrist", "Wrist"],
  ["upperArmLevel", "Upper Arm Level"], ["acrossBackWidth", "Across Back Width"], ["length", "Length"],
];
const FITTING_FIELDS_TROUSER = [
  ["trouserWaist", "Waist"], ["trouserHips", "Hips"], ["trouserThigh", "Thigh"],
  ["trouserRise", "Rise Front to Back"], ["trouserLength", "Length"],
];
const FITTING_FIELDS = [...FITTING_FIELDS_GENERAL, ...FITTING_FIELDS_TROUSER];

const ALL_MEASURE_FIELDS = [...MEASURE_FIELDS, ...FITTING_FIELDS_GENERAL, ...FITTING_FIELDS_TROUSER]
  .filter((f, i, arr) => arr.findIndex((x) => x[0] === f[0]) === i);

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

function computeDeltas(fields, customerM, baseM) {
  const out = {};
  fields.forEach(([k]) => {
    const c = parseFloat(customerM[k]);
    const b = parseFloat(baseM[k]);
    out[k] = (!isNaN(c) && !isNaN(b)) ? +(c - b).toFixed(1) : null;
  });
  return out;
}

function suggestionMeasurements(customerM, deltas) {
  const out = {};
  FITTING_FIELDS.forEach(([k]) => {
    const c = parseFloat(customerM[k]);
    const d = deltas ? deltas[k] : null;
    if (!isNaN(c) && d != null) {
      out[k] = String(+(c + d).toFixed(2));
    }
  });
  return out;
}

async function nextJobOrderNumbers(count) {
  const { data: base, error } = await supabase.rpc("next_job_order_base");
  if (error || base == null) return Array.from({ length: count }, (_, i) => `TEMP-${Date.now()}-${i + 1}`);
  return count === 1 ? [String(base)] : Array.from({ length: count }, (_, i) => `${base}-${i + 1}`);
}

function diffSummary(before, form, fileChanged) {
  const changed = [];
  const norm = {
    name: before.name || "", mobile: before.mobile || "", orderType: before.orderType || "New",
    model: before.model || "", item: before.item || ITEM_TYPES[0], branch: before.branch || "",
    sheilaType: before.sheilaType || SHEILA_TYPES[0], abayaOption: before.abayaOption || "fullButton",
    deliveryDate: before.deliveryDate || "", comments: before.comments || "",
  };
  const simpleMap = { name: "Name", mobile: "Mobile", orderType: "Order Type", model: "Model", item: "Item", branch: "Branch", sheilaType: "Sheila Type", abayaOption: "Abaya Option", deliveryDate: "Delivery Date", comments: "Comments" };
  Object.entries(simpleMap).forEach(([k, label]) => {
    const oldV = norm[k] || "—", newV = form[k] || "—";
    if (oldV !== newV) changed.push(`${label} (${oldV} → ${newV})`);
  });
  ALL_MEASURE_FIELDS.forEach(([k, l]) => {
    const oldV = before.measurements?.[k] || "—", newV = form.measurements?.[k] || "—";
    if (oldV !== newV) changed.push(`${l} (${oldV} → ${newV})`);
  });
  if (fileChanged) changed.push("Attachment (replaced)");
  return changed;
}

const ITEM_TYPES = ["Abaya", "Sheila", "Jalabiya", "Set"];
const SHEILA_TYPES = ["Chiffon", "Crepe", "Georgette", "Plain"];
const ORDER_TYPES = ["New", "Alteration"];
const ROLE_LABEL = { sales: "Sales Panel", production: "Production Panel", admin: "Admin Panel" };

const fmtDate = (d) => { if (!d) return "—"; try { return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return d; } };
const fmtDateTime = (d) => { try { return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return d; } };

function Lightbox({ src, alt, onClose }) {
  if (!src) return null;
  return (
    <div className="no-print" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, cursor: "zoom-out" }} onClick={onClose}>
      <img src={src} alt={alt || ""} style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain", borderRadius: 4 }} onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} style={{ position: "absolute", top: 20, right: 24, background: "none", border: "none", color: "#fff", fontSize: 30, cursor: "pointer", lineHeight: 1 }}>×</button>
    </div>
  );
}

let fileButtonCounter = 0;
function FileButton({ onChange, label, accept }) {
  const [id] = useState(() => `fb-${++fileButtonCounter}`);
  return (
    <label htmlFor={id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", color: "#1A1A1A", whiteSpace: "nowrap" }}>
      {label || "Choose File"}
      <input id={id} type="file" accept={accept || "image/*"} onChange={onChange} style={{ display: "none" }} />
    </label>
  );
}

function ModelThumb({ model, size, style }) {
  const [url, setUrl] = useState(model?.photoUrl || null);
  useEffect(() => {
    if (model?.photoUrl) { setUrl(model.photoUrl); return; }
    if (!model?.id) { setUrl(null); return; }
    supabase.from("model_images").select("*").eq("model_id", model.id).then(({ data }) => {
      if (!data || data.length === 0) { setUrl(null); return; }
      const front = data.find((d) => d.view_label === "Front");
      setUrl((front || data[0]).url);
    });
  }, [model?.id, model?.photoUrl]);

  const s = size || 70;
  return (
    <div style={{ width: s, height: s, background: "#F2F2F2", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, ...style }}>
      {url ? <img src={url} alt={model?.modelNo || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 10, color: "#8a8a8a" }}>No photo</span>}
    </div>
  );
}

/* ---------------- db <-> app field mapping ---------------- */

function dbToOrder(r) {
  return {
    id: r.id, invoiceNo: r.invoice_no, jobOrderNo: r.job_order_no, name: r.name, mobile: r.mobile, orderType: r.order_type,
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
    armHoleFinishing: r.arm_hole_finishing, bottomFinishing: r.bottom_finishing, photoUrl: r.photo_url,
    collectionName: r.collection_name, styleName: r.style_name, category: r.category,
    productType: r.product_type, season: r.season, description: r.description, createdBy: r.created_by,
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
  const [profiles, setProfiles] = useState(null);
  const [requirementItems, setRequirementItems] = useState(null);
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
    const [{ data: branches }, { data: salespersons }, { data: models }, { data: ords }, { data: profs }, { data: reqItems }] = await Promise.all([
      supabase.from("branches").select("*").order("name"),
      supabase.from("salespersons").select("*").order("name"),
      supabase.from("models").select("*").order("model_no"),
      supabase.from("job_orders").select("*").order("created_at", { ascending: false }),
      supabase.from("customer_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("requirement_items").select("*").order("created_at", { ascending: false }),
    ]);
    setConfig({ branches: branches || [], salespersons: salespersons || [], models: (models || []).map(dbToModel) });
    setOrders((ords || []).map(dbToOrder));
    setProfiles((profs || []).map((p) => ({ ...p, createdAt: p.created_at })));
    setRequirementItems((reqItems || []).map((r) => ({
      id: r.id, profileId: r.profile_id, model: r.model, recommendedSize: r.recommended_size,
      deltas: r.deltas, notes: r.notes, jobOrderId: r.job_order_id, createdAt: r.created_at,
    })));
  }, []);

  useEffect(() => { if (profile) loadAll(); }, [profile, loadAll]);

  if (session === undefined) return <Loading text="Loading…" />;
  if (!session) return <LoginScreen onLoggedIn={() => {}} />;
  if (profile === null) return <NoProfileScreen onSignOut={() => supabase.auth.signOut()} />;
  if (!config || !orders || !profiles || !requirementItems) return <Loading text="Loading job orders…" />;

  const refresh = loadAll;

  return (
    <Shell session={profile} subpage={subpage} setSubpage={setSubpage} onLogout={() => supabase.auth.signOut()}>
      {profile.role === "sales" && (
        <SalesPanel config={config} orders={orders} profiles={profiles} requirementItems={requirementItems} refresh={refresh} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} />
      )}
      {profile.role === "production" && (
        <ProductionPanel config={config} orders={orders} profiles={profiles} requirementItems={requirementItems} refresh={refresh} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} />
      )}
      {profile.role === "admin" && (
        <AdminPanel config={config} refresh={refresh} orders={orders} profiles={profiles} requirementItems={requirementItems} session={profile}
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
    ["records", "ALL RECORDS"], ["requirements", "ALL REQUIREMENTS"], ["branches", "ADD/REMOVE BRANCH"],
    ["salespersons", "ADD/REMOVE SALES PERSON"], ["models", "ADD/REMOVE MODEL"], ["viewmodels", "VIEW MODELS"],
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
              <a className="link" onClick={() => setSubpage("requirements")}>ALL REQUIREMENTS</a>
            </>
          )}
          {(session.role === "sales" || session.role === "admin") && (
            <>
              <span>|</span>
              <a className="link" onClick={() => setSubpage("customers")}>CUSTOMERS</a>
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

function SalesTabs({ subpage, setSubpage }) {
  const tabs = [["records", "ALL RECORDS"], ["requirements", "ALL REQUIREMENTS"]];
  return (
    <div className="no-print" style={{ display: "flex", gap: 22, marginBottom: 20, borderBottom: "1px solid #E5E5E5", paddingBottom: 10, justifyContent: "center" }}>
      {tabs.map(([key, label]) => (
        <button key={key} onClick={() => setSubpage(key)} style={{ background: "transparent", border: "none", fontSize: 12.5, fontWeight: subpage === key ? 700 : 500, letterSpacing: "0.04em", textDecoration: subpage === key ? "underline" : "none", color: "#1A1A1A" }}>{label}</button>
      ))}
    </div>
  );
}

function OrderTable({ orders, onOpen, editableStatuses, showDelete, onDelete }) {
  if (orders.length === 0) return <div style={{ textAlign: "center", padding: 50, color: "#8a8a8a", fontSize: 14 }}>No job orders found.</div>;
  return (
    <table>
      <thead>
        <tr style={{ borderBottom: "2px solid #1A1A1A", fontSize: 12.5, textAlign: "left" }}>
          {["Job Order No", "Name", "Date", "DeliveryDate", "Mobile", "Model", "Salesperson", "Branch", "Status", "View", showDelete ? "Action" : null]
            .filter(Boolean).map((h) => <th key={h} style={{ padding: "9px 10px", fontWeight: 700 }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} style={{ borderBottom: "1px solid #E5E5E5", fontSize: 13.5 }}>
            <td style={{ padding: "9px 10px" }} className="mono">{o.jobOrderNo || "—"}</td>
            <td style={{ padding: "9px 10px" }}>{o.name}</td>
            <td style={{ padding: "9px 10px" }}>{fmtDate(o.createdAt)}</td>
            <td style={{ padding: "9px 10px" }}>{fmtDate(o.deliveryDate)}</td>
            <td style={{ padding: "9px 10px" }}>{o.mobile}</td>
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

function SalesPanel({ config, orders, profiles, requirementItems, refresh, session, subpage, setSubpage, selectedId, setSelectedId, flash }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingOrderId, setEditingOrderId] = useState(null);
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
    const [jobNo] = await nextJobOrderNumbers(1);
    const now = new Date().toISOString();
    const row = {
      job_order_no: jobNo, invoice_no: form.invoiceNo || null, name: form.name, mobile: form.mobile, order_type: form.orderType,
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

  const handleUpdateOrderFull = async (form, file) => {
    const before = orders.find((o) => o.id === editingOrderId);
    let attachmentUrl = before?.attachmentUrl || null;
    if (file) {
      const path = `${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("attachments").upload(path, file);
      if (!upErr) {
        const { data } = supabase.storage.from("attachments").getPublicUrl(path);
        attachmentUrl = data.publicUrl;
      }
    }
    const changed = diffSummary(before, form, !!file);
    const now = new Date().toISOString();
    const note = changed.length ? `Job order edited — changed: ${changed.join(", ")}` : "Job order edited (no field changes detected)";
    const history = [...(before?.history || []), { note, by: session.name, at: now }];
    const { error } = await supabase.from("job_orders").update({
      name: form.name, mobile: form.mobile, order_type: form.orderType,
      model: form.model, item: form.item, branch: form.branch, measurements: form.measurements,
      sheila_type: form.sheilaType, abaya_option: form.abayaOption, button_till: form.buttonTill,
      delivery_date: form.deliveryDate || null, attachment_url: attachmentUrl, comments: form.comments,
      history, updated_at: now,
    }).eq("id", editingOrderId);
    if (error) { flash("Error: " + error.message); return; }
    await refresh(); setSubpage("records"); setSelectedId(editingOrderId); flash("Job order updated");
  };

  const handleSaveFields = async (id, fields) => {
    const { error } = await supabase.from("job_orders").update({ ...orderFieldsToDb(fields), updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    await refresh(); flash("Changes saved");
  };

  const handleSaveRequirement = async (customer, measurements, items, deliveryDate, signatureUrl, createOrders) => {
    const branch = session.branch || (session.role === "admin" ? "Admin" : "");
    const { data: profile, error: pErr } = await supabase.from("customer_profiles").insert({
      name: customer.name, mobile: customer.mobile, measurements, branch, created_by: session.name,
      signature_url: signatureUrl || null,
    }).select().single();
    if (pErr) { flash("Error: " + pErr.message); return; }

    const validItems = items.filter((it) => !it.error);
    const jobNumbers = createOrders && validItems.length > 0 ? await nextJobOrderNumbers(validItems.length) : [];

    let lastOrderId = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.error) continue;
      let jobOrderId = null;
      if (createOrders) {
        const now = new Date().toISOString();
        const fitNote = `Selected size: ${it.size}.${it.notes ? " Notes: " + it.notes : ""}`;
        const vIdx = validItems.indexOf(it);
        const { data: order } = await supabase.from("job_orders").insert({
          job_order_no: jobNumbers[vIdx], name: customer.name, mobile: customer.mobile, order_type: "New",
          model: it.model, item: ITEM_TYPES[0], prepared_by: session.name, branch,
          measurements: suggestionMeasurements(measurements, it.deltas), delivery_date: deliveryDate || null,
          comments: fitNote, status: "job_created",
          history: [{ note: "Job order created from customer requirement", by: session.name, at: now }],
        }).select().single();
        jobOrderId = order?.id || null;
        lastOrderId = jobOrderId;
      }
      await supabase.from("requirement_items").insert({
        profile_id: profile.id, model: it.model, recommended_size: it.size || null, deltas: it.deltas || {},
        notes: it.notes || null, job_order_id: jobOrderId,
      });
    }
    await refresh();
    if (createOrders && lastOrderId) { setSubpage("records"); setSelectedId(lastOrderId); flash("Job order(s) created"); }
    else { setSubpage("customers"); flash("Customer profile saved"); }
  };

  const handleCreateOrderFromRow = async (row) => {
    const branch = row.profile.branch || (session.role === "admin" ? "Admin" : session.branch || "");
    const [jobNo] = await nextJobOrderNumbers(1);
    const now = new Date().toISOString();
    const fitNote = `Selected size: ${row.recommendedSize || "—"}.${row.notes ? " Notes: " + row.notes : ""}`;
    const { data: order, error } = await supabase.from("job_orders").insert({
      job_order_no: jobNo, name: row.profile.name, mobile: row.profile.mobile, order_type: "New", model: row.model,
      item: ITEM_TYPES[0], prepared_by: session.name, branch,
      measurements: suggestionMeasurements(row.profile.measurements, row.deltas),
      comments: fitNote, status: "job_created",
      history: [{ note: "Job order created from saved requirement", by: session.name, at: now }],
    }).select().single();
    if (error) { flash("Error: " + error.message); return; }
    await supabase.from("requirement_items").update({ job_order_id: order.id }).eq("id", row.id);
    await refresh(); setSubpage("records"); setSelectedId(order.id); flash("Job order created");
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
  if (subpage === "editOrder") {
    const editing = orders.find((o) => o.id === editingOrderId);
    return <JobOrderForm config={config} session={session} initialOrder={editing} onCancel={() => setSubpage("records")} onSubmit={handleUpdateOrderFull} />;
  }
  if (subpage === "viewOrder") {
    const viewing = orders.find((o) => o.id === editingOrderId);
    return <JobOrderForm config={config} session={session} initialOrder={viewing} readOnly onCancel={() => setSubpage("records")} />;
  }
  if (subpage === "requirement") {
    return <RequirementForm config={config} session={session} onCancel={() => setSubpage("records")} onSave={handleSaveRequirement} />;
  }
  if (subpage === "customers") {
    return <CustomersPage profiles={profiles} orders={orders} />;
  }
  if (subpage === "requirements") {
    return (
      <div>
        <SalesTabs subpage={subpage} setSubpage={setSubpage} />
        <RequirementsPage items={requirementItems} profiles={profiles} orders={orders} canDelete={false} canCreateOrder={true} onCreateOrder={handleCreateOrderFromRow} />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ALL RECORDS</h2>
      <SalesTabs subpage={subpage} setSubpage={setSubpage} />
      <RecordsToolbar query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
      <div className="no-print" style={{ textAlign: "right", marginBottom: 10 }}>
        <button onClick={() => setSubpage("requirement")} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.03em", marginRight: 8 }}>+ NEW REQUIREMENT</button>
        <button onClick={() => setSubpage("new")} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.03em" }}>+ NEW JOB ORDER</button>
      </div>
      <OrderTable orders={filtered} onOpen={setSelectedId} editableStatuses={["job_rejected", "ready_to_deliver"]} />
      {selected && <OrderDetail order={selected} role="sales" session={session} onClose={() => setSelectedId(null)}
        onSaveFields={handleSaveFields} onAction={handleAction} onResubmit={handleResubmit}
        onEditFull={(id) => { setEditingOrderId(id); setSelectedId(null); setSubpage("editOrder"); }}
        onViewFull={(id) => { setEditingOrderId(id); setSelectedId(null); setSubpage("viewOrder"); }} />}
    </div>
  );
}

/* ---------------- Job Order form ---------------- */

function JobOrderForm({ config, session, onCancel, onSubmit, initialOrder, readOnly }) {
  const isEdit = !!initialOrder;
  const [form, setForm] = useState(() => isEdit ? {
    name: initialOrder.name || "", mobile: initialOrder.mobile || "", invoiceNo: initialOrder.invoiceNo || "",
    orderType: initialOrder.orderType || "New", model: initialOrder.model || config.models[0]?.modelNo || "",
    item: initialOrder.item || ITEM_TYPES[0], branch: initialOrder.branch || session.branch || config.branches[0]?.name || "",
    measurements: { ...Object.fromEntries(ALL_MEASURE_FIELDS.map(([k]) => [k, ""])), ...(initialOrder.measurements || {}) },
    sheilaType: initialOrder.sheilaType || SHEILA_TYPES[0], abayaOption: initialOrder.abayaOption || "fullButton",
    buttonTill: initialOrder.buttonTill || "", deliveryDate: initialOrder.deliveryDate || "", comments: initialOrder.comments || "",
  } : {
    name: "", mobile: "", invoiceNo: "", orderType: "New", model: config.models[0]?.modelNo || "",
    item: ITEM_TYPES[0], branch: session.branch || config.branches[0]?.name || "",
    measurements: Object.fromEntries(ALL_MEASURE_FIELDS.map(([k]) => [k, ""])),
    sheilaType: SHEILA_TYPES[0], abayaOption: "fullButton", buttonTill: "",
    deliveryDate: "", comments: "",
  });
  const [file, setFile] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setMeasure = (k) => (e) => setForm((f) => ({ ...f, measurements: { ...f.measurements, [k]: e.target.value } }));
  const model = config.models.find((m) => m.modelNo === form.model);
  const valid = form.name.trim() && form.mobile.trim();

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>{isEdit ? "EDIT JOB ORDER" : "JOB ORDER"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 6 }}>
        <Field label="Name"><input style={inputStyle} value={form.name} onChange={set("name")} disabled={readOnly} /></Field>
        <Field label="Mobile No"><input style={inputStyle} value={form.mobile} onChange={set("mobile")} disabled={readOnly} /></Field>
        <Field label="Date"><input style={inputStyle} value={isEdit ? fmtDate(initialOrder.createdAt) : fmtDate(new Date())} disabled /></Field>
        <Field label="Job Order No"><input style={inputStyle} value={isEdit ? (initialOrder.jobOrderNo || "—") : "Auto-generated on save"} disabled /></Field>
        <Field label="Order Type"><select style={inputStyle} value={form.orderType} onChange={set("orderType")} disabled={readOnly}>{ORDER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Model"><select style={inputStyle} value={form.model} onChange={set("model")} disabled={readOnly}>{config.models.map((m) => <option key={m.id} value={m.modelNo}>{m.modelNo}</option>)}</select></Field>
        <Field label="Select Item"><select style={inputStyle} value={form.item} onChange={set("item")} disabled={readOnly}>{ITEM_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Prepared By"><input style={inputStyle} value={isEdit ? initialOrder.preparedBy : session.name} disabled /></Field>
        <Field label="Branch"><select style={inputStyle} value={form.branch} onChange={set("branch")} disabled={readOnly}>{config.branches.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}</select></Field>
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, margin: "14px 0 6px" }}>MEASUREMENTS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
        {(readOnly ? ALL_MEASURE_FIELDS.filter(([k]) => form.measurements[k]) : ALL_MEASURE_FIELDS).map(([k, l]) => (
          <Field key={k} label={l}><input style={inputStyle} value={form.measurements[k] || ""} onChange={setMeasure(k)} disabled={readOnly} /></Field>
        ))}
      </div>

      <div style={{ display: "flex", gap: 26, alignItems: "flex-end", marginTop: 6, marginBottom: 18, flexWrap: "wrap" }}>
        <Field label="Sheila Type"><select style={{ ...inputStyle, width: 180 }} value={form.sheilaType} onChange={set("sheilaType")} disabled={readOnly}>{SHEILA_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <div>
          <div style={label13}>Abaya Option</div>
          <div style={{ display: "flex", gap: 16, fontSize: 13.5, paddingTop: 6 }}>
            {[["fullButton", "Full Button"], ["normal", "Normal"], ["buttonFromTill", "Button From/Till"]].map(([k, l]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="radio" checked={form.abayaOption === k} onChange={() => setForm((f) => ({ ...f, abayaOption: k }))} disabled={readOnly} /> {l}
              </label>
            ))}
            {form.abayaOption === "buttonFromTill" && <input style={{ ...inputStyle, width: 90 }} value={form.buttonTill} onChange={set("buttonTill")} placeholder="e.g. 20cm" disabled={readOnly} />}
          </div>
        </div>
      </div>

      {model && (
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 20, border: "1px solid #C9CDD3", padding: 18, marginBottom: 18 }}>
          <ModelThumb model={model} size="100%" style={{ borderRadius: 0 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>DEFAULT PRODUCT DETAILS</div>
            {MODEL_FIELDS.map(([k, l]) => <div key={k} style={{ fontSize: 13, marginBottom: 3 }}><strong>{l.toUpperCase()}:</strong> {model[k] || "—"}</div>)}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label="Delivery Date"><input type="date" style={inputStyle} value={form.deliveryDate} onChange={set("deliveryDate")} disabled={readOnly} /></Field>
        <Field label="Attachment (photo/video reference)">
          {isEdit && initialOrder.attachmentUrl ? (
            <div style={{ fontSize: 12.5 }}>Current file: <a className="link" href={initialOrder.attachmentUrl} target="_blank" rel="noreferrer">View</a>{!readOnly && " — choose a new file below to replace it."}</div>
          ) : readOnly ? <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No attachment.</div> : null}
          {!readOnly && <input type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} style={inputStyle} />}
        </Field>
      </div>
      <Field label="Comments"><textarea style={{ ...inputStyle, minHeight: 70 }} value={form.comments} onChange={set("comments")} disabled={readOnly} /></Field>

      <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 20 }}>
        <button onClick={() => window.print()} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>PRINT / SAVE PDF</button>
        {!readOnly && (
          <button disabled={!valid} onClick={() => onSubmit(form, file)} style={{ background: valid ? (isEdit ? "#2F8F46" : "#3B6FA0") : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>{isEdit ? "Save Changes" : "SUBMIT"}</button>
        )}
        <button onClick={onCancel} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>{readOnly ? "CLOSE" : "CANCEL"}</button>
      </div>
    </div>
  );
}

function SignaturePad({ canvasRef, onDrawn }) {
  const drawing = React.useRef(false);
  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvasRef.current.width / rect.width), y: (e.clientY - rect.top) * (canvasRef.current.height / rect.height) };
  };
  const start = (e) => { drawing.current = true; const ctx = canvasRef.current.getContext("2d"); const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext("2d"); const p = getPos(e);
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#1A1A1A";
    ctx.lineTo(p.x, p.y); ctx.stroke();
    onDrawn(true);
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    onDrawn(false);
  };
  return (
    <div>
      <canvas ref={canvasRef} width={500} height={150}
        style={{ border: "1px solid #C9CDD3", borderRadius: 3, touchAction: "none", width: "100%", maxWidth: 500, background: "#fff" }}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <button type="button" onClick={clear} style={{ marginTop: 6, background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "5px 12px", fontSize: 12 }}>Clear Signature</button>
    </div>
  );
}

const SHAPES = [
  ["rectangle", "Panel"], ["aline", "A-Line"], ["sleeve", "Sleeve"],
  ["collar", "Collar"], ["trouserleg", "Trouser Leg"], ["circle", "Round"],
  ["yoke", "Yoke"], ["pocket", "Pocket"], ["cuff", "Cuff"],
  ["waistband", "Waistband"], ["gusset", "Gusset"], ["halfcircle", "Half-Circle"],
];

function drawShapeStamp(ctx, type) {
  ctx.save();
  ctx.strokeStyle = "#1A1A1A";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const cx = W / 2, cy = H / 2;
  if (type === "rectangle") {
    ctx.rect(cx - 100, cy - 80, 200, 160);
  } else if (type === "aline") {
    ctx.moveTo(cx - 60, cy - 100);
    ctx.lineTo(cx + 60, cy - 100);
    ctx.lineTo(cx + 100, cy + 100);
    ctx.lineTo(cx - 100, cy + 100);
    ctx.closePath();
  } else if (type === "sleeve") {
    ctx.moveTo(cx - 80, cy + 90);
    ctx.quadraticCurveTo(cx - 90, cy, cx - 40, cy - 90);
    ctx.quadraticCurveTo(cx, cy - 120, cx + 40, cy - 90);
    ctx.quadraticCurveTo(cx + 90, cy, cx + 80, cy + 90);
    ctx.closePath();
  } else if (type === "collar") {
    ctx.moveTo(cx - 110, cy + 20);
    ctx.quadraticCurveTo(cx, cy - 60, cx + 110, cy + 20);
    ctx.quadraticCurveTo(cx, cy + 10, cx - 110, cy + 20);
    ctx.closePath();
  } else if (type === "trouserleg") {
    ctx.moveTo(cx - 70, cy - 110);
    ctx.lineTo(cx + 70, cy - 110);
    ctx.lineTo(cx + 40, cy + 110);
    ctx.lineTo(cx - 40, cy + 110);
    ctx.closePath();
  } else if (type === "circle") {
    ctx.arc(cx, cy, 90, 0, Math.PI * 2);
  } else if (type === "yoke") {
    ctx.moveTo(cx - 120, cy - 40);
    ctx.quadraticCurveTo(cx, cy - 90, cx + 120, cy - 40);
    ctx.lineTo(cx + 120, cy - 10);
    ctx.quadraticCurveTo(cx, cy - 60, cx - 120, cy - 10);
    ctx.closePath();
  } else if (type === "pocket") {
    ctx.moveTo(cx - 60, cy - 40);
    ctx.quadraticCurveTo(cx, cy - 60, cx + 60, cy - 40);
    ctx.lineTo(cx + 60, cy + 50);
    ctx.quadraticCurveTo(cx, cy + 65, cx - 60, cy + 50);
    ctx.closePath();
  } else if (type === "cuff") {
    ctx.rect(cx - 90, cy - 25, 180, 50);
  } else if (type === "waistband") {
    ctx.rect(cx - 140, cy - 15, 280, 30);
  } else if (type === "gusset") {
    ctx.moveTo(cx, cy - 110);
    ctx.lineTo(cx + 90, cy + 110);
    ctx.quadraticCurveTo(cx, cy + 90, cx - 90, cy + 110);
    ctx.closePath();
  } else if (type === "halfcircle") {
    ctx.moveTo(cx - 130, cy);
    ctx.arc(cx, cy, 130, Math.PI, 2 * Math.PI);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

function DrawingPad({ canvasRef, onDrawn }) {
  const drawing = React.useRef(false);
  const [mode, setMode] = useState("draw");
  const [customShapes, setCustomShapes] = useState([]);
  const [savingName, setSavingName] = useState(false);
  const [shapeName, setShapeName] = useState("");
  const [selectedShape, setSelectedShape] = useState("");

  const loadCustomShapes = () => supabase.from("custom_shapes").select("*").order("created_at", { ascending: false }).then(({ data }) => setCustomShapes(data || []));
  useEffect(() => { loadCustomShapes(); }, []);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvasRef.current.width / rect.width), y: (e.clientY - rect.top) * (canvasRef.current.height / rect.height) };
  };
  const start = (e) => { drawing.current = true; const ctx = canvasRef.current.getContext("2d"); const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext("2d"); const p = getPos(e);
    if (mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = 18;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1A1A1A";
    }
    ctx.lineCap = "round";
    ctx.lineTo(p.x, p.y); ctx.stroke();
    onDrawn(true);
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    onDrawn(false);
  };
  const stamp = (type) => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.globalCompositeOperation = "source-over";
    drawShapeStamp(ctx, type);
    onDrawn(true);
  };
  const stampCustom = (shape) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const ctx = canvasRef.current.getContext("2d");
      ctx.globalCompositeOperation = "source-over";
      const W = canvasRef.current.width, H = canvasRef.current.height;
      const size = Math.min(W, H) * 0.7;
      ctx.drawImage(img, (W - size) / 2, (H - size) / 2, size, size);
      onDrawn(true);
    };
    img.src = shape.image_url;
  };

  const insertSelectedShape = () => {
    if (!selectedShape) return;
    const custom = customShapes.find((s) => s.id === selectedShape);
    if (custom) stampCustom(custom);
    else stamp(selectedShape);
  };

  const saveCustomShape = async () => {
    if (!shapeName.trim()) return;
    const blob = await new Promise((resolve) => canvasRef.current.toBlob(resolve, "image/png"));
    if (!blob) return;
    const path = `custom-shapes/${Date.now()}-${shapeName.replace(/\s+/g, "-")}.png`;
    const { error } = await supabase.storage.from("attachments").upload(path, blob);
    if (!error) {
      const { data } = supabase.storage.from("attachments").getPublicUrl(path);
      await supabase.from("custom_shapes").insert({ name: shapeName, image_url: data.publicUrl });
      setShapeName(""); setSavingName(false);
      loadCustomShapes();
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <select value={selectedShape} onChange={(e) => setSelectedShape(e.target.value)} style={{ border: "1px solid #C9CDD3", borderRadius: 3, padding: "6px 8px", fontSize: 12, width: 180 }}>
          <option value="">Select a shape…</option>
          <optgroup label="Basic Shapes">
            {SHAPES.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
          </optgroup>
          {customShapes.length > 0 && (
            <optgroup label="Custom Shapes">
              {customShapes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          )}
        </select>
        <button type="button" disabled={!selectedShape} onClick={insertSelectedShape}
          style={{ background: selectedShape ? "#3B6FA0" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "6px 14px", fontSize: 12, fontWeight: 700 }}>
          Insert Shape
        </button>
      </div>

      <canvas ref={canvasRef} width={420} height={280}
        style={{ border: "1px solid #C9CDD3", borderRadius: 3, touchAction: "none", width: "100%", maxWidth: 420, background: "#fff" }}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />

      <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setMode("draw")} style={{ background: mode === "draw" ? "#1A1A1A" : "#fff", color: mode === "draw" ? "#fff" : "#1A1A1A", border: "1px solid #C9CDD3", borderRadius: 3, padding: "5px 12px", fontSize: 12 }}>Draw</button>
        <button type="button" onClick={() => setMode("erase")} style={{ background: mode === "erase" ? "#1A1A1A" : "#fff", color: mode === "erase" ? "#fff" : "#1A1A1A", border: "1px solid #C9CDD3", borderRadius: 3, padding: "5px 12px", fontSize: 12 }}>Erase</button>
        <button type="button" onClick={clear} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "5px 12px", fontSize: 12 }}>Clear</button>
        {!savingName ? (
          <button type="button" onClick={() => setSavingName(true)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "5px 12px", fontSize: 12 }}>+ Save as Custom Shape</button>
        ) : (
          <>
            <input value={shapeName} onChange={(e) => setShapeName(e.target.value)} placeholder="Shape name" style={{ border: "1px solid #C9CDD3", borderRadius: 3, padding: "5px 8px", fontSize: 12, width: 120 }} />
            <button type="button" onClick={saveCustomShape} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "5px 12px", fontSize: 12 }}>Save</button>
            <button type="button" onClick={() => { setSavingName(false); setShapeName(""); }} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "5px 12px", fontSize: 12 }}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

function EditableCell({ value, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? "");
  useEffect(() => { setVal(value ?? ""); }, [value]);
  if (!editing) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {value == null ? "—" : value}
        <button type="button" onClick={() => setEditing(true)} title="Edit" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#8a8a8a", padding: 0 }}>✎</button>
      </span>
    );
  }
  return (
    <input autoFocus style={{ width: 64, border: "1px solid #C9CDD3", borderRadius: 3, padding: "3px 5px", fontSize: 12.5 }}
      value={val} onChange={(e) => setVal(e.target.value)}
      onBlur={() => { setEditing(false); onCommit(val === "" ? null : parseFloat(val)); }}
      onKeyDown={(e) => { if (e.key === "Enter") { setEditing(false); onCommit(val === "" ? null : parseFloat(val)); } }} />
  );
}

const stepBtnStyle = { width: 28, height: 28, borderRadius: "50%", border: "1px solid #C9CDD3", background: "#fff", fontSize: 16, lineHeight: "1", cursor: "pointer", color: "#1A1A1A", flexShrink: 0 };

function MeasureStepper({ value, onChange, step = 0.5, min = 0 }) {
  const [editing, setEditing] = useState(false);
  const num = parseFloat(value);
  const display = value === "" || value == null || isNaN(num) ? "—" : value;
  const set = (v) => onChange(String(Math.max(min, +v.toFixed(2))));
  const dec = () => set((isNaN(num) ? 0 : num) - step);
  const inc = () => set((isNaN(num) ? 0 : num) + step);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
      <button type="button" onClick={dec} style={stepBtnStyle}>−</button>
      {editing ? (
        <input autoFocus type="number" inputMode="decimal" value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
          style={{ width: 48, textAlign: "center", border: "1px solid #C9CDD3", borderRadius: 3, padding: "5px 2px", fontSize: 13 }} />
      ) : (
        <span onClick={() => setEditing(true)} style={{ width: 48, textAlign: "center", fontSize: 13.5, fontWeight: 600, cursor: "text", borderBottom: "1px dashed #C9CDD3", padding: "3px 0" }}>{display}</span>
      )}
      <button type="button" onClick={inc} style={stepBtnStyle}>+</button>
    </div>
  );
}

function RequirementForm({ config, session, onCancel, onSave }) {
  const [customer, setCustomer] = useState({ name: "", mobile: "" });
  const [measurements, setMeasurements] = useState(Object.fromEntries(FITTING_FIELDS.map(([k]) => [k, ""])));
  const [items, setItems] = useState([]);
  const [pickModel, setPickModel] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadMobile, setLoadMobile] = useState("");
  const [loadMsg, setLoadMsg] = useState("");
  const sigCanvasRef = React.useRef(null);

  const setC = (k) => (e) => setCustomer((c) => ({ ...c, [k]: e.target.value }));
  const setMVal = (k) => (v) => setMeasurements((m) => ({ ...m, [k]: v }));

  const loadByMobile = async () => {
    if (!loadMobile.trim()) return;
    setLoadMsg("Searching…");
    const { data } = await supabase.from("customer_profiles").select("*").eq("mobile", loadMobile.trim()).order("created_at", { ascending: false }).limit(1);
    if (data && data[0]) {
      setCustomer({ name: data[0].name, mobile: data[0].mobile });
      setMeasurements({ ...Object.fromEntries(FITTING_FIELDS.map(([k]) => [k, ""])), ...(data[0].measurements || {}) });
      setLoadMsg(`Loaded measurements from ${fmtDate(data[0].created_at)}.`);
    } else {
      setLoadMsg("No existing profile found for that number.");
    }
  };

  const addItem = async () => {
    const model = config.models.find((m) => m.modelNo === pickModel);
    if (!model) return;
    const { data: sizes } = await supabase.from("model_sizes").select("*").eq("model_id", model.id);
    if (!sizes || sizes.length === 0) {
      setItems((it) => [...it, { model: pickModel, photoUrl: model.photoUrl, sizes: [], notes: "", error: "No size chart saved for this model yet — add one in Admin > Add/Remove Model." }]);
      return;
    }
    const best = nearestSize(measurements, sizes);
    if (!best) {
      setItems((it) => [...it, { model: pickModel, photoUrl: model.photoUrl, sizes, notes: "", error: "Enter shoulder / chest / waist / hips first to compute a match." }]);
      return;
    }
    setItems((it) => [...it, { model: pickModel, photoUrl: model.photoUrl, sizes, size: best.size_label, auto: best.size_label, notes: "", deltas: computeDeltas(FITTING_FIELDS, measurements, best.measurements) }]);
  };
  const changeItemSize = (idx, sizeLabel) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const sizeObj = it.sizes.find((s) => s.size_label === sizeLabel);
      if (!sizeObj) return it;
      return { ...it, size: sizeLabel, deltas: computeDeltas(FITTING_FIELDS, measurements, sizeObj.measurements) };
    }));
  };
  const setItemDelta = (idx, key, newDelta) => setItems((prev) => prev.map((it, i) => i !== idx ? it : { ...it, deltas: { ...it.deltas, [key]: newDelta } }));
  const setItemNotes = (idx, text) => setItems((prev) => prev.map((it, i) => i !== idx ? it : { ...it, notes: text }));
  const removeItem = (idx) => setItems((it) => it.filter((_, i) => i !== idx));
  const customerValid = customer.name.trim() && customer.mobile.trim();

  const uploadSignature = async () => {
    if (!signed || !sigCanvasRef.current) return null;
    const blob = await new Promise((resolve) => sigCanvasRef.current.toBlob(resolve, "image/png"));
    if (!blob) return null;
    const path = `signatures/${Date.now()}.png`;
    const { error } = await supabase.storage.from("attachments").upload(path, blob);
    if (error) return null;
    const { data } = supabase.storage.from("attachments").getPublicUrl(path);
    return data.publicUrl;
  };

  const save = async (createOrders) => {
    setSaving(true);
    const signatureUrl = await uploadSignature();
    await onSave(customer, measurements, items, deliveryDate, signatureUrl, createOrders);
    setSaving(false);
  };

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>CUSTOMER REQUIREMENT</h2>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", justifyContent: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <div style={label13}>Load existing customer by mobile</div>
          <input style={{ ...inputStyle, width: 200 }} value={loadMobile} onChange={(e) => setLoadMobile(e.target.value)} placeholder="Mobile number" />
        </div>
        <button onClick={loadByMobile} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "9px 16px", fontSize: 13, fontWeight: 700 }}>Load Measurements</button>
        {loadMsg && <span style={{ fontSize: 12, color: "#8a8a8a" }}>{loadMsg}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 6 }}>
        <Field label="Customer Name"><input style={inputStyle} value={customer.name} onChange={setC("name")} /></Field>
        <Field label="Mobile No"><input style={inputStyle} value={customer.mobile} onChange={setC("mobile")} /></Field>
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, margin: "14px 0 6px" }}>CUSTOMER FITTING MEASUREMENTS — GENERAL</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 16 }}>
        {FITTING_FIELDS_GENERAL.map(([k, l]) => <Field key={k} label={l}><MeasureStepper value={measurements[k]} onChange={setMVal(k)} /></Field>)}
      </div>
      <div style={{ fontWeight: 700, fontSize: 13, margin: "14px 0 6px" }}>FOR TROUSER</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {FITTING_FIELDS_TROUSER.map(([k, l]) => <Field key={k} label={l}><MeasureStepper value={measurements[k]} onChange={setMVal(k)} /></Field>)}
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, margin: "20px 0 10px", borderTop: "1px solid #E5E5E5", paddingTop: 16 }}>ITEMS</div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <div style={label13}>Model</div>
          <select style={{ ...inputStyle, width: 200 }} value={pickModel} onChange={(e) => setPickModel(e.target.value)}>
            <option value="">Select a model…</option>
            {config.models.map((m) => <option key={m.id} value={m.modelNo}>{m.modelNo}</option>)}
          </select>
        </div>
        <button onClick={addItem} disabled={!pickModel} style={{ background: pickModel ? "#3B6FA0" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>+ Add Item</button>
      </div>

      {pickModel && (() => {
        const m = config.models.find((mm) => mm.modelNo === pickModel);
        return m ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, border: "1px solid #E5E5E5", padding: 10 }}>
            <ModelThumb model={m} size={70} style={{ borderRadius: 3 }} />
            <div style={{ fontSize: 13 }}><strong>{m.modelNo}</strong><br />{m.possibleCuts}</div>
          </div>
        ) : null;
      })()}

      {items.map((it, idx) => (
        <div key={idx} style={{ border: "1px solid #C9CDD3", padding: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {it.photoUrl && <img src={it.photoUrl} alt={it.model} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 3 }} />}
              <strong>{it.model}</strong>
            </div>
            {!it.error && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#8a8a8a" }}>Size:</span>
                <select value={it.size} onChange={(e) => changeItemSize(idx, e.target.value)} style={{ ...inputStyle, width: 130, padding: "4px 6px" }}>
                  {it.sizes.map((s) => <option key={s.id} value={s.size_label}>{s.size_label}{s.size_label === it.auto ? " (auto match)" : ""}</option>)}
                </select>
              </div>
            )}
            <a className="link" style={{ color: "#C1302B" }} onClick={() => removeItem(idx)}>Remove</a>
          </div>
          {it.error ? <div style={{ color: "#C1302B", fontSize: 13 }}>{it.error}</div> : (
            FITTING_FIELDS.filter(([k]) => it.deltas[k] != null).length === 0 ? (
              <div style={{ fontSize: 13, color: "#8a8a8a" }}>This model's size chart doesn't have matching values for anything entered yet.</div>
            ) : (
              <table>
                <thead><tr style={{ fontSize: 12, textAlign: "left" }}><th>Measurement</th><th>Customer</th><th>Difference</th><th>Suggestion</th></tr></thead>
                <tbody>
                  {FITTING_FIELDS.filter(([k]) => it.deltas[k] != null).map(([k, l]) => {
                    const customerVal = parseFloat(measurements[k]);
                    const diff = it.deltas[k];
                    const suggestion = (diff != null && !isNaN(customerVal)) ? +(customerVal + diff).toFixed(1) : null;
                    return (
                      <tr key={k} style={{ fontSize: 13 }}>
                        <td>{l}</td>
                        <td>{measurements[k] || "—"}</td>
                        <td style={{ color: diff > 0 ? "#2F8F46" : diff < 0 ? "#C1302B" : "#1A1A1A", fontWeight: 600 }}>
                          <EditableCell value={diff} onCommit={(newDiff) => setItemDelta(idx, k, newDiff)} />
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          <EditableCell value={suggestion} onCommit={(newSugg) => setItemDelta(idx, k, newSugg == null || isNaN(customerVal) ? null : +(newSugg - customerVal).toFixed(1))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}
          <div style={{ marginTop: 10 }}>
            <Field label="Special Requirements / Notes for this item">
              <textarea style={{ ...inputStyle, minHeight: 50 }} value={it.notes} onChange={(e) => setItemNotes(idx, e.target.value)} placeholder="Anything specific to this item…" />
            </Field>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 16, maxWidth: 260 }}>
        <Field label="Delivery Date"><input type="date" style={inputStyle} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></Field>
      </div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #E5E5E5" }}>
        <div style={label13}>Customer Signature — confirms agreement to the measurements & sizes above</div>
        <SignaturePad canvasRef={sigCanvasRef} onDrawn={setSigned} />
        {!signed && <div style={{ fontSize: 11.5, color: "#8a8a8a", marginTop: 4 }}>Required before creating a job order (optional if only saving the profile).</div>}
      </div>

      <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 22 }}>
        <button disabled={!customerValid || saving} onClick={() => save(false)} style={{ background: customerValid ? "#1A1A1A" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>Save Profile</button>
        <button disabled={!customerValid || items.length === 0 || !signed || saving} onClick={() => save(true)} style={{ background: (customerValid && items.length > 0 && signed) ? "#2F8F46" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>Save & Create Job Order(s)</button>
        <button onClick={onCancel} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>Cancel</button>
      </div>
    </div>
  );
}

function RequirementsPage({ items, profiles, orders, canDelete, canCreateOrder, onCreateOrder, onDelete }) {
  const [selected, setSelected] = useState(null);
  const rows = items
    .map((it) => ({ ...it, profile: profiles.find((p) => p.id === it.profileId), order: orders.find((o) => o.id === it.jobOrderId) }))
    .filter((r) => r.profile);
  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ALL REQUIREMENTS</h2>
      {rows.length === 0 ? <div style={{ textAlign: "center", padding: 50, color: "#8a8a8a", fontSize: 14 }}>No requirements saved yet.</div> : (
        <table>
          <thead><tr style={{ borderBottom: "2px solid #1A1A1A", fontSize: 12.5, textAlign: "left" }}>
            <th style={{ padding: "9px 10px" }}>Name</th><th style={{ padding: "9px 10px" }}>Mobile</th><th style={{ padding: "9px 10px" }}>Model</th>
            <th style={{ padding: "9px 10px" }}>Size</th><th style={{ padding: "9px 10px" }}>Date</th><th style={{ padding: "9px 10px" }}>Job Order No</th><th style={{ padding: "9px 10px" }}></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #E5E5E5", fontSize: 13.5 }}>
                <td style={{ padding: "9px 10px" }}>{r.profile.name}</td>
                <td style={{ padding: "9px 10px" }}>{r.profile.mobile}</td>
                <td style={{ padding: "9px 10px" }}>{r.model}</td>
                <td style={{ padding: "9px 10px" }}>{r.recommendedSize || "—"}</td>
                <td style={{ padding: "9px 10px" }}>{fmtDate(r.createdAt)}</td>
                <td style={{ padding: "9px 10px" }} className="mono">{r.order ? r.order.jobOrderNo : <span style={{ color: "#8a8a8a" }}>Not yet</span>}</td>
                <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                  <a className="link" onClick={() => setSelected(r)}>View</a>
                  {!r.order && canCreateOrder && <a className="link" style={{ marginLeft: 10 }} onClick={() => onCreateOrder(r)}>Create Job Order</a>}
                  {canDelete && <a className="link" style={{ marginLeft: 10, color: "#C1302B" }} onClick={() => onDelete(r.id)}>Delete</a>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && <RequirementDetail row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function RequirementDetail({ row, onClose }) {
  const p = row.profile;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "flex-end", zIndex: 50 }} className="no-print" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: 520, maxWidth: "100%", height: "100%", overflowY: "auto", padding: "26px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20 }}>{p.name}</div>
            <div style={{ fontSize: 13.5, color: "#8a8a8a" }}>{p.mobile} · {p.branch}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "#8a8a8a" }}>×</button>
        </div>

        <div style={{ marginTop: 14, fontSize: 13.5, display: "grid", gap: 4 }}>
          <div><strong>Model:</strong> {row.model}</div>
          <div><strong>Size:</strong> {row.recommendedSize || "—"}</div>
          <div><strong>Date:</strong> {fmtDate(row.createdAt)}</div>
          <div><strong>Job Order:</strong> {row.order ? row.order.jobOrderNo : "Not created yet"}</div>
          {row.notes && <div><strong>Notes:</strong> {row.notes}</div>}
        </div>

        <div style={{ fontWeight: 700, fontSize: 12.5, margin: "16px 0 6px" }}>MEASUREMENTS & COMPUTED DIFFERENCE</div>
        <table>
          <thead><tr style={{ fontSize: 12, textAlign: "left" }}><th>Measurement</th><th>Customer</th><th>Difference</th><th>Suggestion</th></tr></thead>
          <tbody>
            {FITTING_FIELDS.filter(([k]) => row.deltas && row.deltas[k] != null).map(([k, l]) => {
              const c = parseFloat(p.measurements?.[k]);
              const d = row.deltas[k];
              const s = (d != null && !isNaN(c)) ? +(c + d).toFixed(1) : null;
              return (
                <tr key={k} style={{ fontSize: 13 }}>
                  <td>{l}</td><td>{p.measurements?.[k] || "—"}</td><td>{d > 0 ? "+" : ""}{d}</td><td style={{ fontWeight: 700 }}>{s ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ fontWeight: 700, fontSize: 12.5, margin: "18px 0 6px" }}>CUSTOMER SIGNATURE</div>
        {p.signature_url ? <img src={p.signature_url} alt="signature" style={{ border: "1px solid #E5E5E5", maxWidth: "100%", background: "#fff" }} /> : <div style={{ fontSize: 13, color: "#8a8a8a" }}>No signature captured for this profile.</div>}
      </div>
    </div>
  );
}

function CustomersPage({ profiles, orders }) {
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const filtered = profiles.filter((p) => !query.trim() || p.name.toLowerCase().includes(query.toLowerCase()) || (p.mobile || "").includes(query));
  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>CUSTOMER RECORDS</h2>
      <div className="no-print" style={{ textAlign: "center", marginBottom: 18 }}>
        <input placeholder="Search name or mobile number" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...inputStyle, width: 280, display: "inline-block" }} />
      </div>
      {filtered.length === 0 ? <div style={{ textAlign: "center", padding: 50, color: "#8a8a8a", fontSize: 14 }}>No customer profiles found.</div> : (
        <table>
          <thead><tr style={{ borderBottom: "2px solid #1A1A1A", fontSize: 12.5, textAlign: "left" }}>
            <th style={{ padding: "9px 10px" }}>Name</th><th style={{ padding: "9px 10px" }}>Mobile</th><th style={{ padding: "9px 10px" }}>Branch</th><th style={{ padding: "9px 10px" }}>Created</th><th style={{ padding: "9px 10px" }}>View</th>
          </tr></thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #E5E5E5", fontSize: 13.5 }}>
                <td style={{ padding: "9px 10px" }}>{p.name}</td>
                <td style={{ padding: "9px 10px" }}>{p.mobile}</td>
                <td style={{ padding: "9px 10px" }}>{p.branch}</td>
                <td style={{ padding: "9px 10px" }}>{fmtDate(p.createdAt)}</td>
                <td style={{ padding: "9px 10px" }}><a className="link" onClick={() => setSelected(p)}>View</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && <CustomerDetail profile={selected} orders={orders} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CustomerDetail({ profile, orders, onClose }) {
  const history = orders.filter((o) => o.mobile === profile.mobile);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "flex-end", zIndex: 50 }} className="no-print" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: 480, maxWidth: "100%", height: "100%", overflowY: "auto", padding: "26px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20 }}>{profile.name}</div>
            <div style={{ fontSize: 13.5, color: "#8a8a8a" }}>{profile.mobile}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "#8a8a8a" }}>×</button>
        </div>

        <div style={{ fontWeight: 700, fontSize: 12.5, margin: "18px 0 6px" }}>FITTING MEASUREMENTS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 13, marginBottom: 16 }}>
          {FITTING_FIELDS.map(([k, l]) => <div key={k}>{l}: {profile.measurements?.[k] || "—"}</div>)}
        </div>

        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>ALL ORDERS FOR THIS PHONE NUMBER</div>
        {history.length === 0 ? <div style={{ fontSize: 13, color: "#8a8a8a" }}>No job orders placed yet.</div> : (
          <div style={{ display: "grid", gap: 8 }}>
            {history.map((o) => (
              <div key={o.id} style={{ border: "1px solid #E5E5E5", padding: 10, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="mono">{o.invoiceNo}</span>
                  <StatusTag status={o.status} />
                </div>
                <div>{o.model} — {fmtDate(o.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Order detail ---------------- */

function OrderDetail({ order, role, session, onClose, onSaveFields, onAction, onResubmit, onDelete, onEditFull, onViewFull }) {
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
              {ALL_MEASURE_FIELDS.filter(([k]) => order.measurements && order.measurements[k]).map(([k, l]) => <div key={k}>{l}: {order.measurements[k]}</div>)}
            </div>

            {onViewFull && (
              <button onClick={() => onViewFull(order.id)} style={{ marginTop: 14, background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>View Full Job Order</button>
            )}
            {editable && onEditFull && (
              <button onClick={() => onEditFull(order.id)} style={{ marginTop: 14, marginLeft: 8, background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>Edit Full Job Order</button>
            )}
            <button onClick={() => window.print()} style={{ marginTop: 14, marginLeft: 8, background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>Print</button>
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
        {ALL_MEASURE_FIELDS.map(([k, l]) => <Field key={k} label={l}><input style={inputStyle} value={form.measurements[k] || ""} onChange={setMeasure(k)} /></Field>)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={() => onSave({ name: form.name, mobile: form.mobile, deliveryDate: form.deliveryDate, comments: form.comments, measurements: form.measurements })} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Save Changes</button>
        <button onClick={onCancel} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================= Production Panel ================= */

function ProductionPanel({ config, orders, profiles, requirementItems, refresh, session, subpage, setSubpage, selectedId, setSelectedId, flash }) {
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

  if (subpage === "items") return <ModelBrowser models={config.models} canEdit={false} />;
  if (subpage === "requirements") {
    return <RequirementsPage items={requirementItems} profiles={profiles} orders={orders} canDelete={false} canCreateOrder={false} />;
  }

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ALL RECORDS</h2>
      <RecordsToolbar query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
      <OrderTable orders={filtered} onOpen={setSelectedId} editableStatuses={["job_rejected"]} />
      {selected && <OrderDetail order={selected} role="production" session={session} onClose={() => setSelectedId(null)} onSaveFields={handleSaveFields} onAction={handleAction} />}
    </div>
  );
}

function ModelDetailPage({ model, canEdit, refresh, flash, onBack }) {
  const [images, setImages] = useState([]);
  const [colors, setColors] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [fabrics, setFabrics] = useState([]);
  const [trims, setTrims] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    supabase.from("model_images").select("*").eq("model_id", model.id).then(({ data }) => setImages(data || []));
    supabase.from("model_colors").select("*").eq("model_id", model.id).then(({ data }) => setColors(data || []));
    supabase.from("model_sizes").select("*").eq("model_id", model.id).then(({ data }) => setSizes(data || []));
    supabase.from("model_fabrics").select("*").eq("model_id", model.id).then(({ data }) => setFabrics(data || []));
    supabase.from("model_trims").select("*").eq("model_id", model.id).then(({ data }) => setTrims(data || []));
    supabase.from("model_patterns").select("*").eq("model_id", model.id).order("created_at").then(({ data }) => setPatterns(data || []));
  }, [model.id]);

  const removeModel = async () => {
    await supabase.from("models").delete().eq("id", model.id);
    await refresh();
    onBack();
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="no-print" style={{ marginBottom: 14 }}>
        <a className="link" onClick={onBack}>← Back to Models</a>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 22 }}>{model.modelNo}{model.styleName ? ` — ${model.styleName}` : ""}</div>
          <div style={{ fontSize: 13, color: "#8a8a8a" }}>{[model.collectionName, model.category, model.productType, model.season].filter(Boolean).join(" · ")}</div>
        </div>
        {canEdit && <a className="link" style={{ color: "#C1302B" }} onClick={removeModel}>Remove Model</a>}
      </div>
      {model.description && <div style={{ fontSize: 13.5, color: "#4A5468", margin: "10px 0 18px" }}>{model.description}</div>}

      {canEdit ? <ModelImages model={model} refresh={refresh} flash={flash} /> : images.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>PHOTOS</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {images.map((img) => (
              <div key={img.id} style={{ textAlign: "center" }}>
                <img src={img.url} alt={img.view_label} onClick={() => setLightbox(img.url)} style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 3, cursor: "zoom-in" }} />
                <div style={{ fontSize: 10.5, marginTop: 2 }}>{img.view_label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canEdit ? <ModelColors model={model} refresh={refresh} flash={flash} /> : colors.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>COLOR VARIATIONS</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {colors.map((c) => (
              <div key={c.id} style={{ textAlign: "center" }}>
                <div onClick={() => c.swatch_url && setLightbox(c.swatch_url)} style={{ width: 44, height: 44, borderRadius: 3, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", cursor: c.swatch_url ? "zoom-in" : "default" }}>
                  {c.swatch_url && <img src={c.swatch_url} alt={c.color_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontSize: 10, marginTop: 2 }}>{c.color_name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canEdit ? <ModelFabrics model={model} refresh={refresh} flash={flash} /> : fabrics.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>FABRIC SWATCHES</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {fabrics.map((f) => (
              <div key={f.id} style={{ textAlign: "center", width: 90 }}>
                <div onClick={() => f.swatch_url && setLightbox(f.swatch_url)} style={{ width: 70, height: 50, borderRadius: 3, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", margin: "0 auto", cursor: f.swatch_url ? "zoom-in" : "default" }}>
                  {f.swatch_url && <img src={f.swatch_url} alt={f.fabric_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{f.fabric_role}</div>
                <div style={{ fontSize: 10, color: "#8a8a8a" }}>{f.fabric_name}{f.fabric_code ? ` · ${f.fabric_code}` : ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canEdit ? <ModelTrims model={model} refresh={refresh} flash={flash} /> : trims.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>TRIMS & ACCESSORIES</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {trims.map((t) => (
              <div key={t.id} style={{ textAlign: "center", width: 80 }}>
                <div onClick={() => t.image_url && setLightbox(t.image_url)} style={{ width: 60, height: 60, borderRadius: 3, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", margin: "0 auto", cursor: t.image_url ? "zoom-in" : "default" }}>
                  {t.image_url && <img src={t.image_url} alt={t.item_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{t.item_name}</div>
                <div style={{ fontSize: 10, color: "#8a8a8a" }}>{t.item_code}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canEdit ? <ModelPatterns model={model} refresh={refresh} flash={flash} /> : patterns.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>PATTERN & CUTTING SUMMARY</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F7F7F5" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Pattern No</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Piece Name</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Material</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Cut Qty</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Cutting Instruction</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Diagram</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid #E5E5E5" }}>
                  <td style={{ padding: "6px 8px", fontSize: 12.5 }} className="mono">{p.pattern_no || "—"}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.piece_name}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.material || "—"}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.cut_qty || "—"}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.cutting_instruction || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{p.diagram_url ? <a href={p.diagram_url} target="_blank" rel="noreferrer"><img src={p.diagram_url} alt="diagram" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 3, border: "1px solid #E5E5E5" }} /></a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>KEY DETAILS / MANUFACTURING SPECS</div>
        {MODEL_FIELDS.slice(1).map(([k, l]) => <div key={k} style={{ fontSize: 13, marginBottom: 3 }}><strong>{l}:</strong> {model[k] || "—"}</div>)}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>SIZE MEASUREMENTS</div>
        {canEdit ? <ModelSizes model={model} refresh={refresh} flash={flash} /> : <SizeMeasurementGrid sizes={sizes} readOnly />}
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function ModelBrowser({ models, canEdit, refresh, flash }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const filtered = models.filter((m) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return [m.modelNo, m.styleName, m.collectionName, m.category, m.productType, m.season, m.description]
      .filter(Boolean).some((f) => f.toLowerCase().includes(q));
  });

  if (selectedId) {
    const current = models.find((m) => m.id === selectedId);
    if (current) return <ModelDetailPage model={current} canEdit={canEdit} refresh={refresh} flash={flash} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>VIEW MODELS</h2>
      <div className="no-print" style={{ textAlign: "center", marginBottom: 18 }}>
        <input placeholder="Search model number, category, style, keyword…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...inputStyle, width: 340, display: "inline-block" }} />
      </div>
      {filtered.length === 0 ? <div style={{ textAlign: "center", padding: 50, color: "#8a8a8a", fontSize: 14 }}>No models match your search.</div> : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((m) => (
            <div key={m.id} onClick={() => setSelectedId(m.id)} style={{ border: "1px solid #E5E5E5", padding: 14, display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
              <ModelThumb model={m} size={56} style={{ borderRadius: 3 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{m.modelNo}{m.styleName ? ` — ${m.styleName}` : ""}</div>
                <div style={{ fontSize: 12, color: "#8a8a8a" }}>{[m.collectionName, m.category, m.productType, m.season].filter(Boolean).join(" · ") || "No details yet"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelBrowserCard({ model }) {
  const [images, setImages] = useState([]);
  const [colors, setColors] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  useEffect(() => {
    supabase.from("model_images").select("*").eq("model_id", model.id).then(({ data }) => setImages(data || []));
    supabase.from("model_colors").select("*").eq("model_id", model.id).then(({ data }) => setColors(data || []));
  }, [model.id]);

  return (
    <div style={{ border: "1px solid #C9CDD3", padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{model.modelNo}{model.styleName ? ` — ${model.styleName}` : ""}</div>
      <div style={{ fontSize: 12, color: "#8a8a8a", marginBottom: 10 }}>{[model.collectionName, model.category, model.season].filter(Boolean).join(" · ")}</div>
      {model.description && <div style={{ fontSize: 13, marginBottom: 12 }}>{model.description}</div>}

      {images.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          {images.map((img) => (
            <div key={img.id} style={{ textAlign: "center" }}>
              <img src={img.url} alt={img.view_label} onClick={() => setLightbox(img.url)} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 3, cursor: "zoom-in" }} />
              <div style={{ fontSize: 10.5, marginTop: 2 }}>{img.view_label}</div>
            </div>
          ))}
        </div>
      )}
      {colors.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          {colors.map((c) => (
            <div key={c.id} style={{ textAlign: "center" }}>
              <div onClick={() => c.swatch_url && setLightbox(c.swatch_url)} style={{ width: 40, height: 40, borderRadius: 3, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", cursor: c.swatch_url ? "zoom-in" : "default" }}>
                {c.swatch_url && <img src={c.swatch_url} alt={c.color_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </div>
              <div style={{ fontSize: 10, marginTop: 2 }}>{c.color_name}</div>
            </div>
          ))}
        </div>
      )}

      {MODEL_FIELDS.slice(1).map(([k, l]) => <div key={k} style={{ fontSize: 13, marginBottom: 3 }}><strong>{l}:</strong> {model[k] || "—"}</div>)}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/* ================= Admin Panel ================= */

function AdminPanel({ config, refresh, orders, profiles, requirementItems, session, subpage, setSubpage, selectedId, setSelectedId, flash }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingOrderId, setEditingOrderId] = useState(null);
  const filtered = useFilteredOrders(orders, query, statusFilter);
  const selected = orders.find((o) => o.id === selectedId);

  const handleDeleteOrder = async (id) => {
    const { error } = await supabase.from("job_orders").delete().eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    setSelectedId(null); await refresh(); flash("Record deleted");
  };
  const handleDeleteRequirement = async (id) => {
    await supabase.from("requirement_items").delete().eq("id", id);
    await refresh(); flash("Requirement deleted");
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
    const [jobNo] = await nextJobOrderNumbers(1);
    const now = new Date().toISOString();
    const row = {
      job_order_no: jobNo, invoice_no: form.invoiceNo || null, name: form.name, mobile: form.mobile, order_type: form.orderType,
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

  const handleUpdateOrderFull = async (form, file) => {
    const before = orders.find((o) => o.id === editingOrderId);
    let attachmentUrl = before?.attachmentUrl || null;
    if (file) {
      const path = `${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("attachments").upload(path, file);
      if (!upErr) {
        const { data } = supabase.storage.from("attachments").getPublicUrl(path);
        attachmentUrl = data.publicUrl;
      }
    }
    const changed = diffSummary(before, form, !!file);
    const now = new Date().toISOString();
    const note = changed.length ? `Job order edited — changed: ${changed.join(", ")}` : "Job order edited (no field changes detected)";
    const history = [...(before?.history || []), { note, by: session.name, at: now }];
    const { error } = await supabase.from("job_orders").update({
      name: form.name, mobile: form.mobile, order_type: form.orderType,
      model: form.model, item: form.item, branch: form.branch, measurements: form.measurements,
      sheila_type: form.sheilaType, abaya_option: form.abayaOption, button_till: form.buttonTill,
      delivery_date: form.deliveryDate || null, attachment_url: attachmentUrl, comments: form.comments,
      history, updated_at: now,
    }).eq("id", editingOrderId);
    if (error) { flash("Error: " + error.message); return; }
    await refresh(); setSubpage("records"); setSelectedId(editingOrderId); flash("Job order updated");
  };

  const handleSaveRequirement = async (customer, measurements, items, deliveryDate, signatureUrl, createOrders) => {
    const branch = session.branch || (session.role === "admin" ? "Admin" : "");
    const { data: profile, error: pErr } = await supabase.from("customer_profiles").insert({
      name: customer.name, mobile: customer.mobile, measurements, branch, created_by: session.name,
      signature_url: signatureUrl || null,
    }).select().single();
    if (pErr) { flash("Error: " + pErr.message); return; }

    const validItems = items.filter((it) => !it.error);
    const jobNumbers = createOrders && validItems.length > 0 ? await nextJobOrderNumbers(validItems.length) : [];

    let lastOrderId = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.error) continue;
      let jobOrderId = null;
      if (createOrders) {
        const now = new Date().toISOString();
        const fitNote = `Selected size: ${it.size}.${it.notes ? " Notes: " + it.notes : ""}`;
        const vIdx = validItems.indexOf(it);
        const { data: order } = await supabase.from("job_orders").insert({
          job_order_no: jobNumbers[vIdx], name: customer.name, mobile: customer.mobile, order_type: "New",
          model: it.model, item: ITEM_TYPES[0], prepared_by: session.name, branch,
          measurements: suggestionMeasurements(measurements, it.deltas), delivery_date: deliveryDate || null,
          comments: fitNote, status: "job_created",
          history: [{ note: `Job order created from customer requirement by Admin (${session.name})`, by: session.name, at: now }],
        }).select().single();
        jobOrderId = order?.id || null;
        lastOrderId = jobOrderId;
      }
      await supabase.from("requirement_items").insert({
        profile_id: profile.id, model: it.model, recommended_size: it.size || null, deltas: it.deltas || {},
        notes: it.notes || null, job_order_id: jobOrderId,
      });
    }
    await refresh();
    if (createOrders && lastOrderId) { setSubpage("records"); setSelectedId(lastOrderId); flash("Job order(s) created"); }
    else { setSubpage("customers"); flash("Customer profile saved"); }
  };

  const handleCreateOrderFromRow = async (row) => {
    const branch = row.profile.branch || (session.role === "admin" ? "Admin" : session.branch || "");
    const [jobNo] = await nextJobOrderNumbers(1);
    const now = new Date().toISOString();
    const fitNote = `Selected size: ${row.recommendedSize || "—"}.${row.notes ? " Notes: " + row.notes : ""}`;
    const { data: order, error } = await supabase.from("job_orders").insert({
      job_order_no: jobNo, name: row.profile.name, mobile: row.profile.mobile, order_type: "New", model: row.model,
      item: ITEM_TYPES[0], prepared_by: session.name, branch,
      measurements: suggestionMeasurements(row.profile.measurements, row.deltas),
      comments: fitNote, status: "job_created",
      history: [{ note: "Job order created from saved requirement", by: session.name, at: now }],
    }).select().single();
    if (error) { flash("Error: " + error.message); return; }
    await supabase.from("requirement_items").update({ job_order_id: order.id }).eq("id", row.id);
    await refresh(); setSubpage("records"); setSelectedId(order.id); flash("Job order created");
  };

  if (subpage === "branches") return <ManageList title="ADD / REMOVE BRANCH" items={config.branches} fields={[["name", "Branch Name"]]}
    onAdd={async (item) => { const { error } = await supabase.from("branches").insert(item); if (error) flash("Error: " + error.message); else { await refresh(); flash("Branch added"); } }}
    onRemove={async (id) => { await supabase.from("branches").delete().eq("id", id); await refresh(); }} />;

  if (subpage === "salespersons") return <ManageList title="ADD / REMOVE SALES PERSON" items={config.salespersons}
    fields={[["name", "Name"], ["branch", "Branch", config.branches.map((b) => b.name)]]}
    onAdd={async (item) => { const { error } = await supabase.from("salespersons").insert(item); if (error) flash("Error: " + error.message); else { await refresh(); flash("Added"); } }}
    onRemove={async (id) => { await supabase.from("salespersons").delete().eq("id", id); await refresh(); }} />;

  if (subpage === "models") return <ManageModels config={config} refresh={refresh} flash={flash} session={session} />;
  if (subpage === "viewmodels") return <ModelBrowser models={config.models} canEdit={true} refresh={refresh} flash={flash} />;
  if (subpage === "new") {
    return <JobOrderForm config={config} session={session} onCancel={() => setSubpage("records")} onSubmit={handleCreate} />;
  }
  if (subpage === "editOrder") {
    const editing = orders.find((o) => o.id === editingOrderId);
    return <JobOrderForm config={config} session={session} initialOrder={editing} onCancel={() => setSubpage("records")} onSubmit={handleUpdateOrderFull} />;
  }
  if (subpage === "viewOrder") {
    const viewing = orders.find((o) => o.id === editingOrderId);
    return <JobOrderForm config={config} session={session} initialOrder={viewing} readOnly onCancel={() => setSubpage("records")} />;
  }
  if (subpage === "requirement") {
    return <RequirementForm config={config} session={session} onCancel={() => setSubpage("records")} onSave={handleSaveRequirement} />;
  }
  if (subpage === "customers") {
    return <CustomersPage profiles={profiles} orders={orders} />;
  }
  if (subpage === "requirements") {
    return <RequirementsPage items={requirementItems} profiles={profiles} orders={orders} canDelete={true} canCreateOrder={true} onCreateOrder={handleCreateOrderFromRow} onDelete={handleDeleteRequirement} />;
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
      {selected && <OrderDetail order={selected} role="admin" session={session} onClose={() => setSelectedId(null)}
        onSaveFields={handleSaveFields} onAction={() => {}} onDelete={handleDeleteOrder}
        onEditFull={(id) => { setEditingOrderId(id); setSelectedId(null); setSubpage("editOrder"); }}
        onViewFull={(id) => { setEditingOrderId(id); setSelectedId(null); setSubpage("viewOrder"); }} />}
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

const CORE_DEFAULT_ROWS = ["shoulder", "chest", "waist", "hips", "sleeveLength", "length"];

function SizeMeasurementGrid({ sizes, onChangeCell, onCellBlur, onAddSize, onRemoveSize, onRemoveRow, readOnly }) {
  const [extraRows, setExtraRows] = useState([]);
  const [addingKey, setAddingKey] = useState("");
  const [newSizeLabel, setNewSizeLabel] = useState("");
  const [hiddenRows, setHiddenRows] = useState([]);

  const dataKeys = FITTING_FIELDS.filter(([k]) => sizes.some((s) => s.measurements[k])).map(([k]) => k);
  const rowKeys = Array.from(new Set([...CORE_DEFAULT_ROWS, ...extraRows, ...dataKeys])).filter((k) => !hiddenRows.includes(k));
  const rows = FITTING_FIELDS.filter(([k]) => rowKeys.includes(k));
  const unusedFields = FITTING_FIELDS.filter(([k]) => !rowKeys.includes(k));
  const availableSizeLabels = ["Small", "Medium", "Large", "X-Large"].filter((l) => !sizes.some((s) => s.size_label === l));
  const removeRow = (key) => {
    setHiddenRows((h) => [...h, key]);
    if (onRemoveRow) {
      onRemoveRow(key);
    } else {
      sizes.forEach((s) => onChangeCell(s.size_label, key, ""));
    }
  };

  return (
    <div>
      {sizes.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 10 }}>Add a size column (S/M/L/XL) below to start entering measurements.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
          <thead>
            <tr style={{ background: "#F7F7F5" }}>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Measurement</th>
              {sizes.map((s) => (
                <th key={s.size_label} style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, borderBottom: "2px solid #1A1A1A", textAlign: "center" }}>
                  {s.size_label}
                  {onRemoveSize && <a className="link" style={{ fontSize: 10, color: "#C1302B", marginLeft: 6 }} onClick={() => onRemoveSize(s.size_label)}>×</a>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, l]) => (
              <tr key={k} style={{ borderBottom: "1px solid #E5E5E5" }}>
                <td style={{ padding: "7px 10px", fontSize: 13 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {l}
                    {!readOnly && <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => removeRow(k)}>×</a>}
                  </span>
                </td>
                {sizes.map((s) => (
                  <td key={s.size_label} style={{ padding: "5px 8px", textAlign: "center", fontSize: 13 }}>
                    {readOnly ? (s.measurements[k] || "—") : (
                      <input
                        value={s.measurements[k] || ""}
                        onChange={(e) => onChangeCell(s.size_label, k, e.target.value)}
                        onBlur={() => onCellBlur && onCellBlur(s.size_label, k)}
                        style={{ width: 52, textAlign: "center", border: "1px solid #C9CDD3", borderRadius: 3, padding: "4px 2px", fontSize: 12.5 }}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!readOnly && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {unusedFields.length > 0 && (
          <>
            <select value={addingKey} onChange={(e) => setAddingKey(e.target.value)} style={{ ...inputStyle, width: 170 }}>
              <option value="">+ Add measurement row…</option>
              {unusedFields.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button type="button" disabled={!addingKey} onClick={() => { setExtraRows((r) => [...r, addingKey]); setAddingKey(""); }}
              style={{ background: addingKey ? "#3B6FA0" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>Add Row</button>
          </>
        )}
        {onAddSize && availableSizeLabels.length > 0 && (
          <>
            <select value={newSizeLabel} onChange={(e) => setNewSizeLabel(e.target.value)} style={{ ...inputStyle, width: 140 }}>
              <option value="">+ Add size column…</option>
              {availableSizeLabels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button type="button" disabled={!newSizeLabel} onClick={() => { onAddSize(newSizeLabel); setNewSizeLabel(""); }}
              style={{ background: newSizeLabel ? "#1A1A1A" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>Add Size</button>
          </>
        )}
      </div>}
    </div>
  );
}

function ModelSizes({ model, refresh, flash }) {
  const [sizes, setSizes] = useState([]);
  const load = () => supabase.from("model_sizes").select("*").eq("model_id", model.id).then(({ data }) => setSizes(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const changeCell = (sizeLabel, key, value) => {
    setSizes((prev) => prev.map((s) => s.size_label === sizeLabel ? { ...s, measurements: { ...s.measurements, [key]: value } } : s));
  };
  const persistCell = async (sizeLabel) => {
    const row = sizes.find((s) => s.size_label === sizeLabel);
    if (!row) return;
    await supabase.from("model_sizes").update({ measurements: row.measurements }).eq("id", row.id);
  };
  const removeRow = async (key) => {
    const updated = sizes.map((s) => ({ ...s, measurements: { ...s.measurements, [key]: "" } }));
    setSizes(updated);
    await Promise.all(updated.map((s) => supabase.from("model_sizes").update({ measurements: s.measurements }).eq("id", s.id)));
  };
  const addSize = async (label) => {
    const { error } = await supabase.from("model_sizes").insert({ model_id: model.id, size_label: label, measurements: {} });
    if (error) { flash("Error: " + error.message); return; }
    load(); flash("Size added");
  };
  const removeSize = async (label) => {
    const row = sizes.find((s) => s.size_label === label);
    if (row) await supabase.from("model_sizes").delete().eq("id", row.id);
    load();
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #C9CDD3" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>SIZE MEASUREMENTS FOR {model.modelNo}</div>
      <SizeMeasurementGrid sizes={sizes} onChangeCell={changeCell} onCellBlur={persistCell} onAddSize={addSize} onRemoveSize={removeSize} onRemoveRow={removeRow} />
    </div>
  );
}

function ManageModels({ config, refresh, flash, session }) {
  const blank = { ...Object.fromEntries(MODEL_FIELDS.map(([k]) => [k, ""])), ...Object.fromEntries(STYLE_FIELDS.map(([k]) => [k, ""])), description: "" };
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Pending (not-yet-saved) photos, colors, and sizes for the model being created
  const [photoFiles, setPhotoFiles] = useState({});
  const setPhotoFile = (view) => (e) => setPhotoFiles((f) => ({ ...f, [view]: e.target.files?.[0] || null }));
  const [lightbox, setLightbox] = useState(null);
  const [newPhotoLabel, setNewPhotoLabel] = useState("");

  const [pendingColors, setPendingColors] = useState([]);
  const [newColorName, setNewColorName] = useState("");
  const [newColorFile, setNewColorFile] = useState(null);
  const addPendingColor = () => {
    if (!newColorName.trim()) return;
    setPendingColors((c) => [...c, { name: newColorName, file: newColorFile }]);
    setNewColorName(""); setNewColorFile(null);
  };
  const removePendingColor = (i) => setPendingColors((c) => c.filter((_, idx) => idx !== i));

  const [pendingFabrics, setPendingFabrics] = useState([]);
  const [newFabricRole, setNewFabricRole] = useState("Main Fabric");
  const [newFabricName, setNewFabricName] = useState("");
  const [newFabricCode, setNewFabricCode] = useState("");
  const [newFabricFile, setNewFabricFile] = useState(null);
  const addPendingFabric = () => {
    if (!newFabricName.trim()) return;
    setPendingFabrics((f) => [...f, { role: newFabricRole, name: newFabricName, code: newFabricCode, file: newFabricFile }]);
    setNewFabricName(""); setNewFabricCode(""); setNewFabricFile(null);
  };
  const removePendingFabric = (i) => setPendingFabrics((f) => f.filter((_, idx) => idx !== i));

  const [pendingTrims, setPendingTrims] = useState([]);
  const [newTrimName, setNewTrimName] = useState("");
  const [newTrimCode, setNewTrimCode] = useState("");
  const [newTrimFile, setNewTrimFile] = useState(null);
  const addPendingTrim = () => {
    if (!newTrimName.trim()) return;
    setPendingTrims((t) => [...t, { name: newTrimName, code: newTrimCode, file: newTrimFile }]);
    setNewTrimName(""); setNewTrimCode(""); setNewTrimFile(null);
  };
  const removePendingTrim = (i) => setPendingTrims((t) => t.filter((_, idx) => idx !== i));

  const [pendingPatterns, setPendingPatterns] = useState([]);
  const [newPattern, setNewPattern] = useState({ pattern_no: "", piece_name: "", material: "", cut_qty: "", cutting_instruction: "" });
  const [newPatternDiagramMode, setNewPatternDiagramMode] = useState("upload");
  const [newPatternDiagram, setNewPatternDiagram] = useState(null);
  const [newPatternHasDrawing, setNewPatternHasDrawing] = useState(false);
  const newPatternCanvasRef = React.useRef(null);
  const setNewPatternField = (k) => (e) => setNewPattern((p) => ({ ...p, [k]: e.target.value }));
  const addPendingPattern = async () => {
    if (!newPattern.piece_name.trim()) return;
    let diagramFile = newPatternDiagram;
    if (newPatternDiagramMode === "draw" && newPatternHasDrawing && newPatternCanvasRef.current) {
      const blob = await new Promise((resolve) => newPatternCanvasRef.current.toBlob(resolve, "image/png"));
      if (blob) diagramFile = new File([blob], "drawing.png", { type: "image/png" });
    }
    setPendingPatterns((p) => [...p, { ...newPattern, diagramFile }]);
    setNewPattern({ pattern_no: "", piece_name: "", material: "", cut_qty: "", cutting_instruction: "" });
    setNewPatternDiagram(null); setNewPatternHasDrawing(false);
    if (newPatternCanvasRef.current) { const ctx = newPatternCanvasRef.current.getContext("2d"); ctx.clearRect(0, 0, newPatternCanvasRef.current.width, newPatternCanvasRef.current.height); }
  };
  const removePendingPattern = (i) => setPendingPatterns((p) => p.filter((_, idx) => idx !== i));

  const [pendingSizes, setPendingSizes] = useState([]);
  const changePendingCell = (sizeLabel, key, value) => setPendingSizes((prev) => prev.map((s) => s.size_label === sizeLabel ? { ...s, measurements: { ...s.measurements, [key]: value } } : s));
  const addPendingSize = (label) => setPendingSizes((prev) => [...prev, { size_label: label, measurements: {} }]);
  const removePendingSize = (label) => setPendingSizes((prev) => prev.filter((s) => s.size_label !== label));

  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!form.modelNo.trim()) return;
    setCreating(true);
    const payload = { ...modelToDb(form) };
    STYLE_FIELDS.forEach(([k]) => { payload[k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase())] = form[k]; });
    payload.description = form.description;
    payload.created_by = session.name;
    const { data: inserted, error } = await supabase.from("models").insert(payload).select().single();
    if (error) { flash("Error: " + error.message); setCreating(false); return; }

    let frontUrl = null;
    for (const view of Object.keys(photoFiles)) {
      const file = photoFiles[view];
      if (!file) continue;
      const path = `model-photos/${inserted.id}-${view}-${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("attachments").upload(path, file);
      if (!upErr) {
        const { data } = supabase.storage.from("attachments").getPublicUrl(path);
        await supabase.from("model_images").insert({ model_id: inserted.id, view_label: view, url: data.publicUrl });
        if (view === "Front") frontUrl = data.publicUrl;
      }
    }
    if (frontUrl) await supabase.from("models").update({ photo_url: frontUrl }).eq("id", inserted.id);

    for (const c of pendingColors) {
      let swatchUrl = null;
      if (c.file) {
        const path = `model-colors/${inserted.id}-${Date.now()}-${c.file.name}`;
        const { error: upErr } = await supabase.storage.from("attachments").upload(path, c.file);
        if (!upErr) { const { data } = supabase.storage.from("attachments").getPublicUrl(path); swatchUrl = data.publicUrl; }
      }
      await supabase.from("model_colors").insert({ model_id: inserted.id, color_name: c.name, swatch_url: swatchUrl });
    }

    for (const f of pendingFabrics) {
      let swatchUrl = null;
      if (f.file) {
        const path = `model-fabrics/${inserted.id}-${Date.now()}-${f.file.name}`;
        const { error: upErr } = await supabase.storage.from("attachments").upload(path, f.file);
        if (!upErr) { const { data } = supabase.storage.from("attachments").getPublicUrl(path); swatchUrl = data.publicUrl; }
      }
      await supabase.from("model_fabrics").insert({ model_id: inserted.id, fabric_role: f.role, fabric_name: f.name, fabric_code: f.code, swatch_url: swatchUrl });
    }
    for (const t of pendingTrims) {
      let imageUrl = null;
      if (t.file) {
        const path = `model-trims/${inserted.id}-${Date.now()}-${t.file.name}`;
        const { error: upErr } = await supabase.storage.from("attachments").upload(path, t.file);
        if (!upErr) { const { data } = supabase.storage.from("attachments").getPublicUrl(path); imageUrl = data.publicUrl; }
      }
      await supabase.from("model_trims").insert({ model_id: inserted.id, item_name: t.name, item_code: t.code, image_url: imageUrl });
    }

    for (const p of pendingPatterns) {
      const { diagramFile, ...rest } = p;
      let diagramUrl = null;
      if (diagramFile) {
        const path = `model-patterns/${inserted.id}-${Date.now()}-${diagramFile.name}`;
        const { error: upErr } = await supabase.storage.from("attachments").upload(path, diagramFile);
        if (!upErr) { const { data } = supabase.storage.from("attachments").getPublicUrl(path); diagramUrl = data.publicUrl; }
      }
      await supabase.from("model_patterns").insert({ model_id: inserted.id, ...rest, diagram_url: diagramUrl });
    }

    for (const s of pendingSizes) {
      await supabase.from("model_sizes").insert({ model_id: inserted.id, size_label: s.size_label, measurements: s.measurements });
    }

    setForm(blank); setPhotoFiles({}); setPendingColors([]); setPendingFabrics([]); setPendingTrims([]); setPendingPatterns([]); setPendingSizes([]);
    setCreating(false);
    await refresh();
    flash("Model created" + (pendingColors.length || pendingSizes.length || Object.keys(photoFiles).length ? " with photos, colors, and sizes" : ""));
  };

  const remove = async (id) => { await supabase.from("models").delete().eq("id", id); await refresh(); };

  const cardStyle = { background: "#fff", border: "1px solid #E5E5E5", borderRadius: 8, padding: "18px 20px" };

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ADD / REMOVE MODEL</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>STYLE OVERVIEW</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <Field label="Style No (Model No)"><input style={inputStyle} value={form.modelNo} onChange={set("modelNo")} /></Field>
            {STYLE_FIELDS.map(([k, l]) => <Field key={k} label={l}><input style={inputStyle} value={form[k]} onChange={set(k)} /></Field>)}
          </div>
          <Field label="Description"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={set("description")} /></Field>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>KEY DETAILS / MANUFACTURING SPECS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {MODEL_FIELDS.slice(1).map(([k, l]) => <Field key={k} label={l}><input style={inputStyle} value={form[k]} onChange={set(k)} /></Field>)}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div style={{ ...cardStyle, alignContent: "flex-start" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>PHOTOS</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {PHOTO_VIEWS.map((view) => (
              <div key={view} style={{ textAlign: "center" }}>
                <div onClick={() => photoFiles[view] && setLightbox(URL.createObjectURL(photoFiles[view]))}
                  style={{ width: 110, height: 110, background: "#F2F2F2", borderRadius: 6, overflow: "hidden", marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", cursor: photoFiles[view] ? "zoom-in" : "default" }}>
                  {photoFiles[view] ? <img src={URL.createObjectURL(photoFiles[view])} alt={view} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "#8a8a8a" }}>No photo</span>}
                </div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>{view}</div>
                <FileButton label="Choose File" onChange={setPhotoFile(view)} />
              </div>
            ))}
            {Object.keys(photoFiles).filter((k) => !PHOTO_VIEWS.includes(k)).map((label) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div onClick={() => setLightbox(URL.createObjectURL(photoFiles[label]))} style={{ width: 110, height: 110, background: "#F2F2F2", borderRadius: 6, overflow: "hidden", marginBottom: 6, cursor: "zoom-in" }}>
                  <img src={URL.createObjectURL(photoFiles[label])} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>{label}</div>
                <a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => setPhotoFiles((f) => { const n = { ...f }; delete n[label]; return n; })}>Remove</a>
              </div>
            ))}
            <div style={{ textAlign: "center", width: 110 }}>
              <div style={{ width: 110, height: 110, border: "1px dashed #C9CDD3", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 24, color: "#C9CDD3" }}>+</span>
              </div>
              <input placeholder="Label" value={newPhotoLabel} onChange={(e) => setNewPhotoLabel(e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: "5px 6px", marginBottom: 4, textAlign: "center" }} />
              <FileButton label="Add Photo" onChange={(e) => { const f = e.target.files?.[0]; if (f && newPhotoLabel.trim()) { setPhotoFiles((p) => ({ ...p, [newPhotoLabel.trim()]: f })); setNewPhotoLabel(""); } }} />
            </div>
          </div>
          {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
        </div>

        <div style={{ ...cardStyle, alignContent: "flex-start" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>COLOR VARIATIONS</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {pendingColors.map((c, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div onClick={() => c.file && setLightbox(URL.createObjectURL(c.file))} style={{ width: 50, height: 50, borderRadius: 3, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", cursor: c.file ? "zoom-in" : "default" }}>
                  {c.file && <img src={URL.createObjectURL(c.file)} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontSize: 10.5, marginTop: 2 }}>{c.name}</div>
                <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => removePendingColor(i)}>Remove</a>
              </div>
            ))}
            <div style={{ textAlign: "center", width: 110 }}>
              <div style={{ width: 110, height: 90, border: "1px dashed #C9CDD3", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>
              </div>
              <input placeholder="Color name" value={newColorName} onChange={(e) => setNewColorName(e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: "5px 6px", marginBottom: 4, textAlign: "center" }} />
              <FileButton label="Photo" onChange={(e) => setNewColorFile(e.target.files?.[0] || null)} />
              <button type="button" onClick={addPendingColor} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, alignContent: "flex-start" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>FABRIC SWATCHES</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {pendingFabrics.map((f, i) => (
              <div key={i} style={{ textAlign: "center", width: 90 }}>
                <div onClick={() => f.file && setLightbox(URL.createObjectURL(f.file))} style={{ width: 70, height: 50, borderRadius: 3, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", margin: "0 auto", cursor: f.file ? "zoom-in" : "default" }}>
                  {f.file && <img src={URL.createObjectURL(f.file)} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{f.role}</div>
                <div style={{ fontSize: 10, color: "#8a8a8a" }}>{f.name}{f.code ? ` · ${f.code}` : ""}</div>
                <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => removePendingFabric(i)}>Remove</a>
              </div>
            ))}
            <div style={{ textAlign: "center", width: 120 }}>
              <div style={{ width: 120, height: 70, border: "1px dashed #C9CDD3", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>
              </div>
              <select value={newFabricRole} onChange={(e) => setNewFabricRole(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }}>
                {["Main Fabric", "Lining", "Other"].map((r) => <option key={r}>{r}</option>)}
              </select>
              <input placeholder="Fabric name" value={newFabricName} onChange={(e) => setNewFabricName(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
              <input placeholder="Code" value={newFabricCode} onChange={(e) => setNewFabricCode(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
              <FileButton label="Photo" onChange={(e) => setNewFabricFile(e.target.files?.[0] || null)} />
              <button type="button" onClick={addPendingFabric} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, alignContent: "flex-start" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>TRIMS & ACCESSORIES</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {pendingTrims.map((t, i) => (
              <div key={i} style={{ textAlign: "center", width: 80 }}>
                <div onClick={() => t.file && setLightbox(URL.createObjectURL(t.file))} style={{ width: 60, height: 60, borderRadius: 3, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", margin: "0 auto", cursor: t.file ? "zoom-in" : "default" }}>
                  {t.file && <img src={URL.createObjectURL(t.file)} alt={t.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 10, color: "#8a8a8a" }}>{t.code}</div>
                <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => removePendingTrim(i)}>Remove</a>
              </div>
            ))}
            <div style={{ textAlign: "center", width: 110 }}>
              <div style={{ width: 110, height: 80, border: "1px dashed #C9CDD3", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>
              </div>
              <input placeholder="Item name" value={newTrimName} onChange={(e) => setNewTrimName(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
              <input placeholder="Code" value={newTrimCode} onChange={(e) => setNewTrimCode(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
              <FileButton label="Photo" onChange={(e) => setNewTrimFile(e.target.files?.[0] || null)} />
              <button type="button" onClick={addPendingTrim} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>PATTERN & CUTTING SUMMARY</div>
        {pendingPatterns.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
            <thead>
              <tr style={{ background: "#F7F7F5" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Pattern No</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Piece Name</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Material</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Cut Qty</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Cutting Instruction</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Diagram</th>
                <th style={{ borderBottom: "2px solid #1A1A1A" }}></th>
              </tr>
            </thead>
            <tbody>
              {pendingPatterns.map((p, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #E5E5E5" }}>
                  <td style={{ padding: "6px 8px", fontSize: 12.5 }} className="mono">{p.pattern_no || "—"}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.piece_name}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.material || "—"}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.cut_qty || "—"}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.cutting_instruction || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{p.diagramFile ? <img src={URL.createObjectURL(p.diagramFile)} alt="diagram" onClick={() => setLightbox(URL.createObjectURL(p.diagramFile))} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 3, border: "1px solid #E5E5E5", cursor: "zoom-in" }} /> : "—"}</td>
                  <td style={{ padding: "6px 8px" }}><a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => removePendingPattern(i)}>Remove</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", width: "100%" }}>
          <input placeholder="Pattern No (e.g. P01)" value={newPattern.pattern_no} onChange={setNewPatternField("pattern_no")} style={{ ...inputStyle, flex: "1 1 100px" }} />
          <input placeholder="Piece Name (e.g. Front)" value={newPattern.piece_name} onChange={setNewPatternField("piece_name")} style={{ ...inputStyle, flex: "1 1 140px" }} />
          <input placeholder="Material" value={newPattern.material} onChange={setNewPatternField("material")} style={{ ...inputStyle, flex: "1 1 100px" }} />
          <input placeholder="Cut Qty" value={newPattern.cut_qty} onChange={setNewPatternField("cut_qty")} style={{ ...inputStyle, flex: "1 1 70px" }} />
          <input placeholder="Cutting Instruction" value={newPattern.cutting_instruction} onChange={setNewPatternField("cutting_instruction")} style={{ ...inputStyle, flex: "1 1 160px" }} />
          <div style={{ width: "100%" }}>
            <div style={{ display: "flex", gap: 14, marginBottom: 6 }}>
              <label style={{ fontSize: 12 }}><input type="radio" checked={newPatternDiagramMode === "upload"} onChange={() => setNewPatternDiagramMode("upload")} /> Upload image</label>
              <label style={{ fontSize: 12 }}><input type="radio" checked={newPatternDiagramMode === "draw"} onChange={() => setNewPatternDiagramMode("draw")} /> Draw diagram</label>
            </div>
            {newPatternDiagramMode === "upload" ? (
              <FileButton onChange={(e) => setNewPatternDiagram(e.target.files?.[0] || null)} />
            ) : (
              <DrawingPad canvasRef={newPatternCanvasRef} onDrawn={setNewPatternHasDrawing} />
            )}
          </div>
          <button type="button" onClick={addPendingPattern} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 700 }}>+ Add Piece</button>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>SIZE MEASUREMENTS</div>
        <SizeMeasurementGrid sizes={pendingSizes} onChangeCell={changePendingCell} onAddSize={addPendingSize} onRemoveSize={removePendingSize} />
      </div>

      <button disabled={creating} onClick={create} style={{ width: "100%", background: creating ? "#C9CDD3" : "#1A1A1A", color: "#fff", border: "none", borderRadius: 6, padding: "14px", fontSize: 14, fontWeight: 700, marginBottom: 28 }}>
        {creating ? "Creating…" : "Create Model"}
      </button>
    </div>
  );
}

function ModelImages({ model, refresh, flash }) {
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const [newLabel, setNewLabel] = useState("");

  const load = () => supabase.from("model_images").select("*").eq("model_id", model.id).then(({ data }) => setImages(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const upload = async (viewLabel, file) => {
    if (!file) return;
    setUploading(viewLabel);
    const path = `model-photos/${model.id}-${viewLabel}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("attachments").upload(path, file);
    if (!error) {
      const { data } = supabase.storage.from("attachments").getPublicUrl(path);
      const existing = images.find((i) => i.view_label === viewLabel);
      if (existing) await supabase.from("model_images").delete().eq("id", existing.id);
      await supabase.from("model_images").insert({ model_id: model.id, view_label: viewLabel, url: data.publicUrl });
      if (viewLabel === "Front") await supabase.from("models").update({ photo_url: data.publicUrl }).eq("id", model.id);
      await load(); await refresh(); flash(`${viewLabel} photo updated`);
    }
    setUploading("");
  };
  const removeImage = async (id) => { await supabase.from("model_images").delete().eq("id", id); await load(); await refresh(); };
  const extraImages = images.filter((i) => !PHOTO_VIEWS.includes(i.view_label));

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #C9CDD3" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>PHOTOS</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {PHOTO_VIEWS.map((view) => {
          const img = images.find((i) => i.view_label === view);
          return (
            <div key={view} style={{ textAlign: "center" }}>
              <div onClick={() => img && setLightbox(img.url)}
                style={{ width: 110, height: 110, background: "#F2F2F2", borderRadius: 6, overflow: "hidden", marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", cursor: img ? "zoom-in" : "default" }}>
                {img ? <img src={img.url} alt={view} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "#8a8a8a" }}>No photo</span>}
              </div>
              <div style={{ fontSize: 12, marginBottom: 6 }}>{view}</div>
              <FileButton label="Choose File" onChange={(e) => upload(view, e.target.files?.[0])} />
            </div>
          );
        })}
        {extraImages.map((img) => (
          <div key={img.id} style={{ textAlign: "center" }}>
            <div onClick={() => setLightbox(img.url)} style={{ width: 110, height: 110, background: "#F2F2F2", borderRadius: 6, overflow: "hidden", marginBottom: 6, cursor: "zoom-in" }}>
              <img src={img.url} alt={img.view_label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ fontSize: 12, marginBottom: 6 }}>{img.view_label}</div>
            <a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => removeImage(img.id)}>Remove</a>
          </div>
        ))}
        <div style={{ textAlign: "center", width: 110 }}>
          <div style={{ width: 110, height: 110, border: "1px dashed #C9CDD3", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 24, color: "#C9CDD3" }}>+</span>
          </div>
          <input placeholder="Label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: "5px 6px", marginBottom: 4, textAlign: "center" }} />
          <FileButton label="Add Photo" onChange={(e) => { const f = e.target.files?.[0]; if (f && newLabel.trim()) { upload(newLabel.trim(), f); setNewLabel(""); } }} />
        </div>
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function ModelColors({ model, refresh, flash }) {
  const [colors, setColors] = useState([]);
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const load = () => supabase.from("model_colors").select("*").eq("model_id", model.id).then(({ data }) => setColors(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const add = async () => {
    if (!name.trim()) return;
    let swatchUrl = null;
    if (file) {
      const path = `model-colors/${model.id}-${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("attachments").upload(path, file);
      if (!error) { const { data } = supabase.storage.from("attachments").getPublicUrl(path); swatchUrl = data.publicUrl; }
    }
    await supabase.from("model_colors").insert({ model_id: model.id, color_name: name, swatch_url: swatchUrl });
    setName(""); setFile(null); await load(); flash("Color added");
  };
  const remove = async (id) => { await supabase.from("model_colors").delete().eq("id", id); await load(); };

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #C9CDD3" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>COLOR VARIATIONS</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {colors.map((c) => (
          <div key={c.id} style={{ textAlign: "center", position: "relative" }}>
            <div onClick={() => c.swatch_url && setLightbox(c.swatch_url)} style={{ width: 50, height: 50, borderRadius: 3, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", cursor: c.swatch_url ? "zoom-in" : "default" }}>
              {c.swatch_url && <img src={c.swatch_url} alt={c.color_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ fontSize: 10.5, marginTop: 2 }}>{c.color_name}</div>
            <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => remove(c.id)}>Remove</a>
          </div>
        ))}
        <div style={{ textAlign: "center", width: 110 }}>
          <div style={{ width: 110, height: 90, border: "1px dashed #C9CDD3", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>
          </div>
          <input placeholder="Color name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: "5px 6px", marginBottom: 4, textAlign: "center" }} />
          <FileButton label="Photo" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button type="button" onClick={add} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
        </div>
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function ModelFabrics({ model, refresh, flash }) {
  const [fabrics, setFabrics] = useState([]);
  const [role, setRole] = useState("Main Fabric");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [file, setFile] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const load = () => supabase.from("model_fabrics").select("*").eq("model_id", model.id).then(({ data }) => setFabrics(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const add = async () => {
    if (!name.trim()) return;
    let swatchUrl = null;
    if (file) {
      const path = `model-fabrics/${model.id}-${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("attachments").upload(path, file);
      if (!error) { const { data } = supabase.storage.from("attachments").getPublicUrl(path); swatchUrl = data.publicUrl; }
    }
    await supabase.from("model_fabrics").insert({ model_id: model.id, fabric_role: role, fabric_name: name, fabric_code: code, swatch_url: swatchUrl });
    setName(""); setCode(""); setFile(null); await load(); flash("Fabric added");
  };
  const remove = async (id) => { await supabase.from("model_fabrics").delete().eq("id", id); await load(); };

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #C9CDD3" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>FABRIC SWATCHES</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {fabrics.map((f) => (
          <div key={f.id} style={{ textAlign: "center", width: 90 }}>
            <div onClick={() => f.swatch_url && setLightbox(f.swatch_url)} style={{ width: 70, height: 50, borderRadius: 3, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", margin: "0 auto", cursor: f.swatch_url ? "zoom-in" : "default" }}>
              {f.swatch_url && <img src={f.swatch_url} alt={f.fabric_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{f.fabric_role}</div>
            <div style={{ fontSize: 10, color: "#8a8a8a" }}>{f.fabric_name}{f.fabric_code ? ` · ${f.fabric_code}` : ""}</div>
            <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => remove(f.id)}>Remove</a>
          </div>
        ))}
        <div style={{ textAlign: "center", width: 120 }}>
          <div style={{ width: 120, height: 70, border: "1px dashed #C9CDD3", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }}>
            {["Main Fabric", "Lining", "Other"].map((r) => <option key={r}>{r}</option>)}
          </select>
          <input placeholder="Fabric name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
          <input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
          <FileButton label="Photo" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button type="button" onClick={add} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
        </div>
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function ModelTrims({ model, refresh, flash }) {
  const [trims, setTrims] = useState([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [file, setFile] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const load = () => supabase.from("model_trims").select("*").eq("model_id", model.id).then(({ data }) => setTrims(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const add = async () => {
    if (!name.trim()) return;
    let imageUrl = null;
    if (file) {
      const path = `model-trims/${model.id}-${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("attachments").upload(path, file);
      if (!error) { const { data } = supabase.storage.from("attachments").getPublicUrl(path); imageUrl = data.publicUrl; }
    }
    await supabase.from("model_trims").insert({ model_id: model.id, item_name: name, item_code: code, image_url: imageUrl });
    setName(""); setCode(""); setFile(null); await load(); flash("Trim/accessory added");
  };
  const remove = async (id) => { await supabase.from("model_trims").delete().eq("id", id); await load(); };

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #C9CDD3" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>TRIMS & ACCESSORIES</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {trims.map((t) => (
          <div key={t.id} style={{ textAlign: "center", width: 80 }}>
            <div onClick={() => t.image_url && setLightbox(t.image_url)} style={{ width: 60, height: 60, borderRadius: 3, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", margin: "0 auto", cursor: t.image_url ? "zoom-in" : "default" }}>
              {t.image_url && <img src={t.image_url} alt={t.item_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{t.item_name}</div>
            <div style={{ fontSize: 10, color: "#8a8a8a" }}>{t.item_code}</div>
            <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => remove(t.id)}>Remove</a>
          </div>
        ))}
        <div style={{ textAlign: "center", width: 110 }}>
          <div style={{ width: 110, height: 80, border: "1px dashed #C9CDD3", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>
          </div>
          <input placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
          <input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
          <FileButton label="Photo" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button type="button" onClick={add} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
        </div>
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function ModelPatterns({ model, refresh, flash }) {
  const [patterns, setPatterns] = useState([]);
  const [form, setForm] = useState({ pattern_no: "", piece_name: "", material: "", cut_qty: "", cutting_instruction: "" });
  const [diagramMode, setDiagramMode] = useState("upload");
  const [diagramFile, setDiagramFile] = useState(null);
  const [hasDrawing, setHasDrawing] = useState(false);
  const drawCanvasRef = React.useRef(null);
  const [lightbox, setLightbox] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = () => supabase.from("model_patterns").select("*").eq("model_id", model.id).order("created_at").then(({ data }) => setPatterns(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const add = async () => {
    if (!form.piece_name.trim()) return;
    let diagramUrl = null;
    if (diagramMode === "draw" && hasDrawing && drawCanvasRef.current) {
      const blob = await new Promise((resolve) => drawCanvasRef.current.toBlob(resolve, "image/png"));
      if (blob) {
        const path = `model-patterns/${model.id}-${Date.now()}-drawing.png`;
        const { error } = await supabase.storage.from("attachments").upload(path, blob);
        if (!error) { const { data } = supabase.storage.from("attachments").getPublicUrl(path); diagramUrl = data.publicUrl; }
      }
    } else if (diagramFile) {
      const path = `model-patterns/${model.id}-${Date.now()}-${diagramFile.name}`;
      const { error } = await supabase.storage.from("attachments").upload(path, diagramFile);
      if (!error) { const { data } = supabase.storage.from("attachments").getPublicUrl(path); diagramUrl = data.publicUrl; }
    }
    await supabase.from("model_patterns").insert({ model_id: model.id, ...form, diagram_url: diagramUrl });
    setForm({ pattern_no: "", piece_name: "", material: "", cut_qty: "", cutting_instruction: "" });
    setDiagramFile(null); setHasDrawing(false);
    if (drawCanvasRef.current) { const ctx = drawCanvasRef.current.getContext("2d"); ctx.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height); }
    await load(); flash("Pattern piece added");
  };
  const remove = async (id) => { await supabase.from("model_patterns").delete().eq("id", id); await load(); };

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #C9CDD3" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>PATTERN & CUTTING SUMMARY</div>
      {patterns.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
          <thead>
            <tr style={{ background: "#F7F7F5" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Pattern No</th>
              <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Piece Name</th>
              <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Material</th>
              <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Cut Qty</th>
              <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Cutting Instruction</th>
              <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Diagram</th>
              <th style={{ borderBottom: "2px solid #1A1A1A" }}></th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #E5E5E5" }}>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }} className="mono">{p.pattern_no || "—"}</td>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.piece_name}</td>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.material || "—"}</td>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.cut_qty || "—"}</td>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{p.cutting_instruction || "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  {p.diagram_url ? <img src={p.diagram_url} alt="diagram" onClick={() => setLightbox(p.diagram_url)} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 3, border: "1px solid #E5E5E5", cursor: "zoom-in" }} /> : "—"}
                </td>
                <td style={{ padding: "6px 8px" }}><a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => remove(p.id)}>Remove</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", width: "100%" }}>
        <input placeholder="Pattern No (e.g. P01)" value={form.pattern_no} onChange={set("pattern_no")} style={{ ...inputStyle, flex: "1 1 100px" }} />
        <input placeholder="Piece Name (e.g. Front)" value={form.piece_name} onChange={set("piece_name")} style={{ ...inputStyle, flex: "1 1 140px" }} />
        <input placeholder="Material" value={form.material} onChange={set("material")} style={{ ...inputStyle, flex: "1 1 100px" }} />
        <input placeholder="Cut Qty" value={form.cut_qty} onChange={set("cut_qty")} style={{ ...inputStyle, flex: "1 1 70px" }} />
        <input placeholder="Cutting Instruction" value={form.cutting_instruction} onChange={set("cutting_instruction")} style={{ ...inputStyle, flex: "1 1 160px" }} />
        <div style={{ width: "100%" }}>
          <div style={{ display: "flex", gap: 14, marginBottom: 6 }}>
            <label style={{ fontSize: 12 }}><input type="radio" checked={diagramMode === "upload"} onChange={() => setDiagramMode("upload")} /> Upload image</label>
            <label style={{ fontSize: 12 }}><input type="radio" checked={diagramMode === "draw"} onChange={() => setDiagramMode("draw")} /> Draw diagram</label>
          </div>
          {diagramMode === "upload" ? (
            <FileButton onChange={(e) => setDiagramFile(e.target.files?.[0] || null)} />
          ) : (
            <DrawingPad canvasRef={drawCanvasRef} onDrawn={setHasDrawing} />
          )}
        </div>
        <button type="button" onClick={add} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 700 }}>+ Add Piece</button>
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
