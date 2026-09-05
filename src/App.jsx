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

const POSSIBLE_CUTS_OPTIONS = ["A-line", "Flare", "Flare with panel", "Kimono", "Flare Kimono", "Drop Shoulder Kimono", "Dolman", "Butterfly", "A-line Suit", "Flare Suit", "Jacket"];
const SIZE_RANGE_OPTIONS = ["X-Small", "Small", "Medium", "Large", "X-Large", "XX-Large"];
const REQUIREMENTS_OPTIONS = ["Side Pocket", "Front Pocket", "Side Slit", "Sleeve Slit", "Back Slit", "Inside Rope", "Back Box", "Open Front", "Closed Front"];
const SIDE_FINISH_OPTIONS = ["Single Overlock", "Overlock and spread", "French Seam / Lootpot", "Single Bias Bound Seam / Single Jizz", "Spread Bias Bound Seam / Single Jizz", "Turn and Straight Stitch", "Flat-felled Seams / Lungi Shilayi", "Picot Finish", "Stitch and Spread"];
const SLEEVE_OPEN_FINISH_OPTIONS = ["The Folded Edge", "Dori Finish / Rope Stitch Finish", "Hemming with Lining Fabric", "Single Cuff", "Double Cuff"];
const ARM_HOLE_FINISH_OPTIONS = ["Overlock Finish", "Bias Bound Seam Finish / Jizz", "French Seam Finish / Lootpot", "Bias Binding (for sleeveless)"];
const BOTTOM_FINISH_OPTIONS = ["Dori Finish / Rope Stitch Finish", "The Folded Edge", "Fold and Hem", "Rolled Edge", "The Picot Edge", "Piping Finish", "Overlock-Folded Edge", "Bias Tape Finish", "The Laced Edge", "The Fringed Edge"];

const STYLE_FIELDS = [
  ["collectionName", "Collection Name"], ["styleName", "Style Name"], ["category", "Category"],
  ["productType", "Product Type"], ["season", "Season"],
];

const PRODUCT_CATALOG = {
  "Abaya": ["Classic Abaya", "A-Line Abaya", "Flare Abaya", "Butterfly Abaya", "Kimono Abaya", "Jacket-Cut Abaya", "Suit-Cut Abaya", "Cape Abaya", "Open Abaya", "Closed Abaya"],
  "Jacket & Blazer": ["Short Jacket", "Long Jacket", "Blazer", "Long Blazer", "Coat", "Couture Coat"],
  "Suit": ["Classic Suit", "Modest Suit", "Blazer & Trouser Suit", "Jacket & Trouser Suit", "A-Line Suit", "Travel Suit"],
  "Dress": ["Dress", "Modest Dress", "Inner Dress", "Butterfly Dress", "Evening Dress", "Silk Dress", "Couture Gown"],
  "Jalabiya": ["Classic Jalabiya", "Kimono Jalabiya", "Embroidered Jalabiya", "Velvet Jalabiya"],
  "Kaftan": ["Classic Kaftan", "Couture Kaftan", "Embroidered Kaftan", "Patterned Kaftan"],
  "Top & Shirt": ["Top", "Shirt", "Blouse", "Tunic"],
  "Trousers": ["Straight Trousers", "Wide-Leg Trousers", "Flare Trousers", "Tailored Trousers"],
  "Skirt": ["Straight Skirt", "A-Line Skirt", "Flared Skirt", "Maxi Skirt"],
  "Set": ["Top & Trouser Set", "Jacket & Skirt Set", "Modest Set", "Coordinated Set"],
};
const PRODUCT_CATEGORIES = Object.keys(PRODUCT_CATALOG);
const PHOTO_VIEWS = ["Front", "Back", "Side", "Detail"];

const PROJECT_TYPES = ["Client Commission", "Wholesale Order", "Event / Wedding", "In-house Collection", "Other"];
const PROJECT_STATUSES = ["Concept", "Design Development", "Sampling", "Client Review", "Approved", "In Production", "Delivered", "Closed"];
const TASK_STATUSES = ["To Do", "In Progress", "Review", "Done"];
const TASK_PRIORITIES = ["Low", "Normal", "High"];

function ProjectStatusTag({ status }) {
  const colors = { "Concept": "#8a8a8a", "Design Development": "#3B6FA0", "Sampling": "#D98E2B", "Client Review": "#C1302B", "Approved": "#2F8F46", "In Production": "#2F8F46", "Delivered": "#1A1A1A", "Closed": "#1A1A1A" };
  return <span style={{ color: colors[status] || "#1A1A1A", fontWeight: 700, fontSize: 13 }}>{(status || "").toUpperCase()}</span>;
}

const FITTING_FIELDS_GENERAL = [
  ["neckSize", "Neck Size"], ["shoulder", "Shoulder"], ["chest", "Chest"], ["waist", "Waist"], ["hips", "Hips"],
  ["bottom", "Bottom"], ["sleeveLength", "Sleeve Length"], ["sleeveOpen", "Sleeve Open"], ["armhole", "Armhole"], ["aroundArmhole", "Around Armhole"],
  ["bicep", "Bicep"], ["wrist", "Wrist"], ["upperArmLevel", "Upper Arm Level"], ["acrossBackWidth", "Across Back Width"],
  ["length", "Length – Front"], ["lengthBack", "Length – Back"],
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
const ROLE_LABEL = { sales: "Sales Panel", production: "Production Panel", admin: "Admin Panel", model_manager: "Model Manager" };

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

function LoadingOverlay({ text }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, flexDirection: "column", gap: 12 }}>
      <div style={{ width: 36, height: 36, border: "3px solid #C9CDD3", borderTopColor: "#1A1A1A", borderRadius: "50%", animation: "mc-spin 0.8s linear infinite" }} />
      <div style={{ fontSize: 13, color: "#1A1A1A", fontWeight: 600 }}>{text}</div>
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
    productType: r.product_type, season: r.season, description: r.description,
    createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at,
    customFields: r.custom_fields || [],
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
  const [projects, setProjects] = useState(null);
  const [projectCollaborators, setProjectCollaborators] = useState(null);
  const [allUsers, setAllUsers] = useState(null);
  const [projectTasks, setProjectTasks] = useState(null);
  const [projectModels, setProjectModels] = useState(null);
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
      .then(({ data }) => {
        setProfile(data || null);
        setSubpage(data?.role === "model_manager" ? "models" : "records");
      });
  }, [session?.user?.id]);

  const loadAll = useCallback(async () => {
    const [{ data: branches }, { data: salespersons }, { data: models }, { data: ords }, { data: profs }, { data: reqItems }, { data: projs }, { data: collabs }, { data: users }, { data: tasks }, { data: projModels }] = await Promise.all([
      supabase.from("branches").select("*").order("name"),
      supabase.from("salespersons").select("*").order("name"),
      supabase.from("models").select("*").order("model_no"),
      supabase.from("job_orders").select("*").order("created_at", { ascending: false }),
      supabase.from("customer_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("requirement_items").select("*").order("created_at", { ascending: false }),
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("project_collaborators").select("*"),
      supabase.from("profiles").select("*"),
      supabase.from("project_tasks").select("*"),
      supabase.from("project_models").select("*"),
    ]);
    setConfig({ branches: branches || [], salespersons: salespersons || [], models: (models || []).map(dbToModel) });
    setOrders((ords || []).map(dbToOrder));
    setProfiles((profs || []).map((p) => ({ ...p, createdAt: p.created_at })));
    setRequirementItems((reqItems || []).map((r) => ({
      id: r.id, profileId: r.profile_id, model: r.model, recommendedSize: r.recommended_size,
      deltas: r.deltas, notes: r.notes, jobOrderId: r.job_order_id, createdAt: r.created_at,
    })));
    setProjects(projs || []);
    setProjectCollaborators(collabs || []);
    setAllUsers(users || []);
    setProjectTasks(tasks || []);
    setProjectModels(projModels || []);
  }, []);

  useEffect(() => { if (profile) loadAll(); }, [profile, loadAll]);

  if (session === undefined) return <Loading text="Loading…" />;
  if (!session) return <LoginScreen onLoggedIn={() => {}} />;
  if (profile === null) return <NoProfileScreen onSignOut={() => supabase.auth.signOut()} />;
  if (!config || !orders || !profiles || !requirementItems || !projects || !projectCollaborators || !allUsers || !projectTasks || !projectModels) return <Loading text="Loading job orders…" />;

  const refresh = loadAll;

  return (
    <Shell session={profile} subpage={subpage} setSubpage={setSubpage} onLogout={() => supabase.auth.signOut()}>
      {subpage === "projects" && (
        <ProjectsPage projects={projects} collaborators={projectCollaborators} allUsers={allUsers} session={profile} refresh={refresh} flash={flash} tasks={projectTasks} projectModels={projectModels} models={config.models} />
      )}
      {subpage !== "projects" && profile.role === "sales" && (
        <SalesPanel config={config} orders={orders} profiles={profiles} requirementItems={requirementItems} refresh={refresh} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} />
      )}
      {subpage !== "projects" && profile.role === "production" && (
        <ProductionPanel config={config} orders={orders} profiles={profiles} requirementItems={requirementItems} refresh={refresh} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} />
      )}
      {subpage !== "projects" && profile.role === "admin" && (
        <AdminPanel config={config} refresh={refresh} orders={orders} profiles={profiles} requirementItems={requirementItems} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} />
      )}
      {subpage !== "projects" && profile.role === "model_manager" && (
        <ModelManagerPanel config={config} refresh={refresh} flash={flash} session={profile} subpage={subpage} setSubpage={setSubpage} />
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
      @keyframes mc-spin { to { transform: rotate(360deg); } }
    `}</style>
  );
}

function Shell({ session, subpage, setSubpage, onLogout, children }) {
  const adminTabs = [
    ["records", "ALL RECORDS"], ["requirements", "ALL REQUIREMENTS"], ["branches", "ADD/REMOVE BRANCH"],
    ["models", "ADD/REMOVE MODEL"], ["viewmodels", "VIEW MODELS"], ["users", "ADD USERS"],
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
          <a className="link" onClick={() => setSubpage("projects")}>PROJECTS</a>
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
      {session.role === "model_manager" && (
        <div className="no-print" style={{ background: "#8a8a8a", padding: "10px 30px", display: "flex", gap: 22, flexWrap: "wrap" }}>
          <button onClick={() => setSubpage("models")} style={{ background: "transparent", border: "none", color: "#fff", fontWeight: subpage === "models" ? 700 : 500, fontSize: 12.5, letterSpacing: "0.04em", textDecoration: subpage === "models" ? "underline" : "none" }}>ADD/REMOVE MODEL</button>
          <button onClick={() => setSubpage("viewmodels")} style={{ background: "transparent", border: "none", color: "#fff", fontWeight: subpage === "viewmodels" ? 700 : 500, fontSize: 12.5, letterSpacing: "0.04em", textDecoration: subpage === "viewmodels" ? "underline" : "none" }}>VIEW MODELS</button>
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
const cardStyle = { background: "#fff", border: "1px solid #E5E5E5", borderRadius: 8, padding: "18px 20px" };

function TagField({ value, onChange, options }) {
  const tags = value ? value.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = React.useRef(null);

  const addTag = (tag) => {
    const t = (tag || "").trim();
    if (!t || tags.includes(t)) { setInput(""); setOpen(false); return; }
    onChange([...tags, t].join(", "));
    setInput("");
    setOpen(false);
  };
  const removeTag = (tag) => onChange(tags.filter((t) => t !== tag).join(", "));

  const filtered = (options || []).filter((o) => !tags.includes(o) && o.toLowerCase().includes(input.toLowerCase()));

  useEffect(() => {
    const onClickOutside = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {tags.map((t, i) => (
            <span key={`${t}-${i}`} style={{ background: "#EEF0F2", border: "1px solid #C9CDD3", borderRadius: 12, padding: "3px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              {t}
              <span onClick={() => removeTag(t)} style={{ cursor: "pointer", color: "#C1302B", fontWeight: 700 }}>×</span>
            </span>
          ))}
        </div>
      )}
      <input
        value={input}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setInput(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); addTag(input); }
          else if (e.key === "Backspace" && !input && tags.length) removeTag(tags[tags.length - 1]);
        }}
        placeholder={options && options.length ? "Click to pick, or type your own…" : "Type a tag and press Enter…"}
        style={inputStyle}
      />
      {open && options && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, marginTop: 2, maxHeight: 180, overflowY: "auto", zIndex: 20, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
          {filtered.map((o) => (
            <div key={o} onMouseDown={() => addTag(o)}
              style={{ padding: "7px 10px", fontSize: 13, cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#F2F2F2")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}>
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
            {MODEL_FIELDS.map(([k, l]) => (
              <div key={k} style={{ fontSize: 13, marginBottom: 6 }}>
                <strong>{l.toUpperCase()}:</strong>{" "}
                {model[k] ? (
                  <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
                    {model[k].split(",").map((t) => t.trim()).filter(Boolean).map((t, i) => (
                      <span key={`${t}-${i}`} style={{ background: "#EEF0F2", border: "1px solid #C9CDD3", borderRadius: 10, padding: "1px 8px", fontSize: 11.5 }}>{t}</span>
                    ))}
                  </span>
                ) : "—"}
              </div>
            ))}
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
    ctx.rect(cx - 170, cy - 136, 340, 272);
  } else if (type === "aline") {
    ctx.moveTo(cx - 102, cy - 170);
    ctx.lineTo(cx + 102, cy - 170);
    ctx.lineTo(cx + 170, cy + 170);
    ctx.lineTo(cx - 170, cy + 170);
    ctx.closePath();
  } else if (type === "sleeve") {
    ctx.moveTo(cx - 136, cy + 153);
    ctx.quadraticCurveTo(cx - 153, cy, cx - 68, cy - 153);
    ctx.quadraticCurveTo(cx, cy - 204, cx + 68, cy - 153);
    ctx.quadraticCurveTo(cx + 153, cy, cx + 136, cy + 153);
    ctx.closePath();
  } else if (type === "collar") {
    ctx.moveTo(cx - 187, cy + 34);
    ctx.quadraticCurveTo(cx, cy - 102, cx + 187, cy + 34);
    ctx.quadraticCurveTo(cx, cy + 17, cx - 187, cy + 34);
    ctx.closePath();
  } else if (type === "trouserleg") {
    ctx.moveTo(cx - 119, cy - 187);
    ctx.lineTo(cx + 119, cy - 187);
    ctx.lineTo(cx + 68, cy + 187);
    ctx.lineTo(cx - 68, cy + 187);
    ctx.closePath();
  } else if (type === "circle") {
    ctx.arc(cx, cy, 153, 0, Math.PI * 2);
  } else if (type === "yoke") {
    ctx.moveTo(cx - 204, cy - 68);
    ctx.quadraticCurveTo(cx, cy - 153, cx + 204, cy - 68);
    ctx.lineTo(cx + 204, cy - 17);
    ctx.quadraticCurveTo(cx, cy - 102, cx - 204, cy - 17);
    ctx.closePath();
  } else if (type === "pocket") {
    ctx.moveTo(cx - 102, cy - 68);
    ctx.quadraticCurveTo(cx, cy - 102, cx + 102, cy - 68);
    ctx.lineTo(cx + 102, cy + 85);
    ctx.quadraticCurveTo(cx, cy + 111, cx - 102, cy + 85);
    ctx.closePath();
  } else if (type === "cuff") {
    ctx.rect(cx - 153, cy - 43, 306, 85);
  } else if (type === "waistband") {
    ctx.rect(cx - 238, cy - 26, 476, 51);
  } else if (type === "gusset") {
    ctx.moveTo(cx, cy - 187);
    ctx.lineTo(cx + 153, cy + 187);
    ctx.quadraticCurveTo(cx, cy + 153, cx - 153, cy + 187);
    ctx.closePath();
  } else if (type === "halfcircle") {
    ctx.moveTo(cx - 221, cy);
    ctx.arc(cx, cy, 221, Math.PI, 2 * Math.PI);
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

      <canvas ref={canvasRef} width={800} height={520}
        style={{ border: "1px solid #C9CDD3", borderRadius: 3, touchAction: "none", width: "100%", maxWidth: 800, background: "#fff" }}
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

function ProjectsPage({ projects, collaborators, allUsers, session, refresh, flash, tasks, projectModels, models }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", clientName: "", projectType: PROJECT_TYPES[0], brief: "" });

  const canCreate = session.role === "admin" || session.role === "model_manager";
  const canSeeAll = canCreate;
  const collabByProject = (id) => collaborators.filter((c) => c.project_id === id);
  const visible = projects.filter((p) => canSeeAll || collabByProject(p.id).some((c) => c.user_id === session.id));
  const filtered = visible.filter((p) => !query.trim() || p.name.toLowerCase().includes(query.toLowerCase()) || (p.client_name || "").toLowerCase().includes(query.toLowerCase()));

  const createProject = async () => {
    if (!form.name.trim()) return;
    const { data, error } = await supabase.from("projects").insert({
      name: form.name, client_name: form.clientName, project_type: form.projectType, brief: form.brief,
      status: "Concept", created_by: session.name,
    }).select().single();
    if (error) { flash("Error: " + error.message); return; }
    setCreating(false); setForm({ name: "", clientName: "", projectType: PROJECT_TYPES[0], brief: "" });
    await refresh(); setSelectedId(data.id); flash("Project created");
  };

  if (selectedId) {
    const p = projects.find((x) => x.id === selectedId);
    if (p) return <ProjectDetailPage project={p} collaborators={collabByProject(p.id)} allUsers={allUsers} session={session} refresh={refresh} flash={flash} onBack={() => setSelectedId(null)} tasks={tasks} projectModels={projectModels} models={models} />;
  }

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>PROJECTS</h2>
      <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <input placeholder="Search project or client…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...inputStyle, width: 260 }} />
        {canCreate && <button onClick={() => setCreating(true)} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>+ New Project</button>}
      </div>

      {creating && (
        <div style={{ ...cardStyle, maxWidth: 600, margin: "0 auto 24px" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>NEW PROJECT</div>
          <Field label="Project Name"><input style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Client Name"><input style={inputStyle} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} /></Field>
          <Field label="Project Type">
            <select style={inputStyle} value={form.projectType} onChange={(e) => setForm((f) => ({ ...f, projectType: e.target.value }))}>
              {PROJECT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Brief (optional for now)"><textarea style={{ ...inputStyle, minHeight: 70 }} value={form.brief} onChange={(e) => setForm((f) => ({ ...f, brief: e.target.value }))} /></Field>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={createProject} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Create Project</button>
            <button onClick={() => setCreating(false)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Cancel</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? <div style={{ textAlign: "center", padding: 50, color: "#8a8a8a", fontSize: 14 }}>No projects found.</div> : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((p) => (
            <div key={p.id} onClick={() => setSelectedId(p.id)} style={{ border: "1px solid #E5E5E5", padding: 14, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: "#8a8a8a" }}>{p.client_name}{p.project_type ? ` · ${p.project_type}` : ""}</div>
              </div>
              <ProjectStatusTag status={p.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskBoard({ project, tasks, collaborators, allUsers, session, refresh, flash }) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", assigneeId: "", dueDate: "", priority: "Normal" });
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const projectTasks = tasks.filter((t) => t.project_id === project.id);
  const priorityColor = { Low: "#8a8a8a", Normal: "#3B6FA0", High: "#C1302B" };

  const createTask = async () => {
    if (!form.title.trim()) return;
    const { error } = await supabase.from("project_tasks").insert({
      project_id: project.id, title: form.title, description: form.description,
      assignee_id: form.assigneeId || null, due_date: form.dueDate || null, priority: form.priority, status: "To Do",
      created_by: session.name,
    });
    if (error) { flash("Error: " + error.message); return; }
    setCreating(false); setForm({ title: "", description: "", assigneeId: "", dueDate: "", priority: "Normal" });
    await refresh(); flash("Task added");
  };
  const updateTaskStatus = async (taskId, status) => {
    await supabase.from("project_tasks").update({ status, updated_at: new Date().toISOString() }).eq("id", taskId);
    await refresh();
  };
  const deleteTask = async (taskId) => { await supabase.from("project_tasks").delete().eq("id", taskId); await refresh(); };
  const startEdit = (t) => {
    setEditingTaskId(t.id);
    setEditForm({ title: t.title, description: t.description || "", assigneeId: t.assignee_id || "", dueDate: t.due_date || "", priority: t.priority || "Normal" });
  };
  const saveEdit = async () => {
    await supabase.from("project_tasks").update({
      title: editForm.title, description: editForm.description, assignee_id: editForm.assigneeId || null,
      due_date: editForm.dueDate || null, priority: editForm.priority, updated_at: new Date().toISOString(),
    }).eq("id", editingTaskId);
    setEditingTaskId(null); await refresh(); flash("Task updated");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>TASKS</div>
        <button onClick={() => setCreating(true)} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "7px 14px", fontSize: 12.5, fontWeight: 700 }}>+ Add Task</button>
      </div>

      {creating && (
        <div style={{ border: "1px solid #C9CDD3", borderRadius: 6, padding: 14, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <Field label="Task Title"><input style={inputStyle} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></Field>
            <Field label="Assignee">
              <select style={inputStyle} value={form.assigneeId} onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}>
                <option value="">Unassigned</option>
                {collaborators.map((c) => { const u = allUsers.find((x) => x.id === c.user_id); return u ? <option key={u.id} value={u.id}>{u.name}</option> : null; })}
              </select>
            </Field>
            <Field label="Due Date"><input type="date" style={inputStyle} value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} /></Field>
            <Field label="Priority">
              <select style={inputStyle} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={createTask} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontSize: 12.5, fontWeight: 700 }}>Add Task</button>
            <button onClick={() => setCreating(false)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "8px 16px", fontSize: 12.5, fontWeight: 700 }}>Cancel</button>
          </div>
        </div>
      )}

      {projectTasks.length === 0 ? <div style={{ fontSize: 13, color: "#8a8a8a" }}>No tasks yet.</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {TASK_STATUSES.map((status) => (
            <div key={status}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#5a5a5a", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                {status} ({projectTasks.filter((t) => t.status === status).length})
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {projectTasks.filter((t) => t.status === status).map((t) => {
                  const assignee = allUsers.find((u) => u.id === t.assignee_id);
                  const isEditing = editingTaskId === t.id;
                  return (
                    <div key={t.id} style={{ border: "1px solid #E5E5E5", borderRadius: 6, padding: 10, background: "#fff" }}>
                      {isEditing ? (
                        <div>
                          <input style={{ ...inputStyle, marginBottom: 6, fontSize: 12.5 }} value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
                          <textarea style={{ ...inputStyle, minHeight: 40, marginBottom: 6, fontSize: 12 }} value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
                          <select style={{ ...inputStyle, marginBottom: 6, fontSize: 12 }} value={editForm.assigneeId} onChange={(e) => setEditForm((f) => ({ ...f, assigneeId: e.target.value }))}>
                            <option value="">Unassigned</option>
                            {collaborators.map((c) => { const u = allUsers.find((x) => x.id === c.user_id); return u ? <option key={u.id} value={u.id}>{u.name}</option> : null; })}
                          </select>
                          <input type="date" style={{ ...inputStyle, marginBottom: 6, fontSize: 12 }} value={editForm.dueDate} onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))} />
                          <select style={{ ...inputStyle, marginBottom: 8, fontSize: 12 }} value={editForm.priority} onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}>
                            {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                          </select>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={saveEdit} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 3, padding: "5px 10px", fontSize: 11, fontWeight: 700 }}>Save</button>
                            <button onClick={() => setEditingTaskId(null)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "5px 10px", fontSize: 11 }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t.title}</div>
                          {t.description && <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 6 }}>{t.description}</div>}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 11, color: "#5a5a5a" }}>{assignee ? assignee.name : "Unassigned"}</span>
                            {t.priority && <span style={{ fontSize: 10, fontWeight: 700, color: priorityColor[t.priority] }}>{t.priority.toUpperCase()}</span>}
                          </div>
                          {t.due_date && <div style={{ fontSize: 11, color: "#8a8a8a", marginBottom: 6 }}>Due {fmtDate(t.due_date)}</div>}
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <select value={t.status} onChange={(e) => updateTaskStatus(t.id, e.target.value)} style={{ fontSize: 11, border: "1px solid #C9CDD3", borderRadius: 3, padding: "3px 4px" }}>
                              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <a className="link" style={{ fontSize: 11 }} onClick={() => startEdit(t)}>Edit</a>
                            <a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => deleteTask(t.id)}>Delete</a>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkedModels({ project, projectModels, models, session, refresh, flash, onViewModel }) {
  const [addingModelId, setAddingModelId] = useState("");
  const linked = projectModels.filter((pm) => pm.project_id === project.id);
  const linkedModelObjs = linked.map((pm) => models.find((m) => m.id === pm.model_id)).filter(Boolean);
  const availableModels = models.filter((m) => !linked.some((pm) => pm.model_id === m.id));

  const addModel = async () => {
    if (!addingModelId) return;
    const { error } = await supabase.from("project_models").insert({ project_id: project.id, model_id: addingModelId, added_by: session.name });
    if (error) { flash("Error: " + error.message); return; }
    setAddingModelId(""); await refresh(); flash("Model linked");
  };
  const removeModel = async (modelId) => {
    const row = linked.find((pm) => pm.model_id === modelId);
    if (row) await supabase.from("project_models").delete().eq("id", row.id);
    await refresh();
  };

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>LINKED MODELS</div>
      {linkedModelObjs.length === 0 ? <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 12 }}>No models linked yet.</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 14 }}>
          {linkedModelObjs.map((m) => (
            <div key={m.id} style={{ border: "1px solid #E5E5E5", borderRadius: 6, padding: 10, textAlign: "center" }}>
              <ModelThumb model={m} size={80} style={{ margin: "0 auto 6px" }} />
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.modelNo}</div>
              <div style={{ fontSize: 11, color: "#8a8a8a", marginBottom: 6 }}>{m.styleName || ""}</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
                <a className="link" style={{ fontSize: 11 }} onClick={() => onViewModel(m.id)}>View</a>
                <a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => removeModel(m.id)}>Unlink</a>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={addingModelId} onChange={(e) => setAddingModelId(e.target.value)} style={{ ...inputStyle, width: 240 }}>
          <option value="">Select a model to link…</option>
          {availableModels.map((m) => <option key={m.id} value={m.id}>{m.modelNo}{m.styleName ? ` — ${m.styleName}` : ""}</option>)}
        </select>
        <button onClick={addModel} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontSize: 12.5, fontWeight: 700 }}>+ Link Model</button>
      </div>
    </div>
  );
}

function ProjectDetailPage({ project, collaborators, allUsers, session, refresh, flash, onBack, tasks, projectModels, models }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [newCollabId, setNewCollabId] = useState("");
  const [viewingModelId, setViewingModelId] = useState(null);
  const canManage = session.role === "admin";

  if (viewingModelId) {
    const m = models.find((x) => x.id === viewingModelId);
    if (m) return <ModelDetailPage model={m} canEdit={false} refresh={refresh} flash={flash} session={session} onBack={() => setViewingModelId(null)} />;
  }

  const startEdit = () => {
    setForm({ name: project.name, clientName: project.client_name || "", projectType: project.project_type || "", brief: project.brief || "", status: project.status });
    setEditing(true);
  };
  const save = async () => {
    const { error } = await supabase.from("projects").update({
      name: form.name, client_name: form.clientName, project_type: form.projectType, brief: form.brief, status: form.status,
      updated_by: session.name, updated_at: new Date().toISOString(),
    }).eq("id", project.id);
    if (error) { flash("Error: " + error.message); return; }
    setEditing(false); await refresh(); flash("Project updated");
  };
  const addCollaborator = async () => {
    if (!newCollabId) return;
    const { error } = await supabase.from("project_collaborators").insert({ project_id: project.id, user_id: newCollabId, added_by: session.name });
    if (error) { flash("Error: " + error.message); return; }
    setNewCollabId(""); await refresh(); flash("Collaborator added");
  };
  const removeCollaborator = async (id) => { await supabase.from("project_collaborators").delete().eq("id", id); await refresh(); };
  const availableUsers = allUsers.filter((u) => !collaborators.some((c) => c.user_id === u.id));

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div className="no-print" style={{ marginBottom: 14 }}><a className="link" onClick={onBack}>← Back to Projects</a></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 24 }}>{project.name}</div>
          <div style={{ fontSize: 13, color: "#8a8a8a" }}>{project.client_name}{project.project_type ? ` · ${project.project_type}` : ""}</div>
          <div style={{ fontSize: 11.5, color: "#8a8a8a", marginTop: 4 }}>
            Created by {project.created_by || "—"} on {fmtDateTime(project.created_at)}
            {project.updated_by && project.updated_at !== project.created_at ? ` · Last edited by ${project.updated_by} on ${fmtDateTime(project.updated_at)}` : ""}
          </div>
        </div>
        {canManage && !editing && <a className="link" onClick={startEdit}>Edit Project</a>}
      </div>
      <div style={{ marginTop: 8 }}><ProjectStatusTag status={project.status} /></div>

      {editing ? (
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>EDIT PROJECT</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Field label="Project Name"><input style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Client Name"><input style={inputStyle} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} /></Field>
            <Field label="Project Type">
              <select style={inputStyle} value={form.projectType} onChange={(e) => setForm((f) => ({ ...f, projectType: e.target.value }))}>
                <option value="">Select…</option>
                {PROJECT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Brief (occasion, budget, style direction, references)"><textarea style={{ ...inputStyle, minHeight: 100 }} value={form.brief} onChange={(e) => setForm((f) => ({ ...f, brief: e.target.value }))} /></Field>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button onClick={save} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 4, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Save Changes</button>
            <button onClick={() => setEditing(false)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>BRIEF</div>
          <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{project.brief || "No brief added yet."}</div>
        </div>
      )}

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>COLLABORATORS</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: canManage ? 12 : 0 }}>
          {collaborators.length === 0 && <div style={{ fontSize: 13, color: "#8a8a8a" }}>No collaborators added yet.</div>}
          {collaborators.map((c) => {
            const u = allUsers.find((x) => x.id === c.user_id);
            return (
              <span key={c.id} style={{ background: "#EEF0F2", border: "1px solid #C9CDD3", borderRadius: 14, padding: "5px 12px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 8 }}>
                {u ? `${u.name} (${u.role})` : "Unknown user"}
                {canManage && <span onClick={() => removeCollaborator(c.id)} style={{ cursor: "pointer", color: "#C1302B", fontWeight: 700 }}>×</span>}
              </span>
            );
          })}
        </div>
        {canManage && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={newCollabId} onChange={(e) => setNewCollabId(e.target.value)} style={{ ...inputStyle, width: 220 }}>
              <option value="">Select a user to add…</option>
              {availableUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
            <button onClick={addCollaborator} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontSize: 12.5, fontWeight: 700 }}>+ Add Collaborator</button>
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <TaskBoard project={project} tasks={tasks} collaborators={collaborators} allUsers={allUsers} session={session} refresh={refresh} flash={flash} />
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <LinkedModels project={project} projectModels={projectModels} models={models} session={session} refresh={refresh} flash={flash} onViewModel={setViewingModelId} />
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

  if (subpage === "items") return <ModelBrowser models={config.models} canEdit={false} session={session} />;
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

function ModelManagerPanel({ config, refresh, flash, session, subpage, setSubpage }) {
  if (subpage === "viewmodels") {
    return <ModelBrowser models={config.models} canEdit={true} refresh={refresh} flash={flash} session={session} />;
  }
  // default view
  return <ManageModels config={config} refresh={refresh} flash={flash} session={session} />;
}

function ModelDetailPage({ model, canEdit, refresh, flash, onBack, session }) {
  const [images, setImages] = useState([]);
  const [colors, setColors] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [fabrics, setFabrics] = useState([]);
  const [trims, setTrims] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [docs, setDocs] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [editingModel, setEditingModel] = useState(false);
  const [coreForm, setCoreForm] = useState(null);
  const [savingCore, setSavingCore] = useState(false);

  const startEditCore = () => {
    setCoreForm({
      collectionName: model.collectionName || "", styleName: model.styleName || "", category: model.category || "",
      productType: model.productType || "", season: model.season || "", description: model.description || "",
      possibleCuts: model.possibleCuts || "", mainFabricCode: model.mainFabricCode || "", innerFabricCode: model.innerFabricCode || "",
      otherFabric: model.otherFabric || "", sizeRange: model.sizeRange || "", requirements: model.requirements || "",
      sideFinishing: model.sideFinishing || "", sleeveOpenFinishing: model.sleeveOpenFinishing || "", armHoleFinishing: model.armHoleFinishing || "",
      bottomFinishing: model.bottomFinishing || "",
    });
    setEditingModel(true);
  };

  const saveCoreEdits = async () => {
    setSavingCore(true);
    const category = coreForm.category === "__other__" ? (coreForm.customCategory || "") : coreForm.category;
    const productType = coreForm.productType === "__other__" ? (coreForm.customProductType || "") : coreForm.productType;
    const { error } = await supabase.from("models").update({
      collection_name: coreForm.collectionName, style_name: coreForm.styleName, category, product_type: productType,
      season: coreForm.season, description: coreForm.description, possible_cuts: coreForm.possibleCuts, main_fabric_code: coreForm.mainFabricCode,
      inner_fabric_code: coreForm.innerFabricCode, other_fabric: coreForm.otherFabric, size_range: coreForm.sizeRange, requirements: coreForm.requirements,
      side_finishing: coreForm.sideFinishing, sleeve_open_finishing: coreForm.sleeveOpenFinishing, arm_hole_finishing: coreForm.armHoleFinishing,
      bottom_finishing: coreForm.bottomFinishing, updated_at: new Date().toISOString(), updated_by: session.name,
    }).eq("id", model.id);
    setSavingCore(false);
    if (error) { flash("Error: " + error.message); return; }
    setEditingModel(false);
    loadReadOnlyData();
    await refresh();
    flash("Model details updated");
  };

  const loadReadOnlyData = () => {
    supabase.from("model_images").select("*").eq("model_id", model.id).then(({ data }) => setImages(data || []));
    supabase.from("model_colors").select("*").eq("model_id", model.id).then(({ data }) => setColors(data || []));
    supabase.from("model_sizes").select("*").eq("model_id", model.id).then(({ data }) => setSizes(data || []));
    supabase.from("model_fabrics").select("*").eq("model_id", model.id).then(({ data }) => setFabrics(data || []));
    supabase.from("model_trims").select("*").eq("model_id", model.id).then(({ data }) => setTrims(data || []));
    supabase.from("model_patterns").select("*").eq("model_id", model.id).order("created_at").then(({ data }) => setPatterns(data || []));
    supabase.from("model_documents").select("*").eq("model_id", model.id).then(({ data }) => setDocs(data || []));
  };

  useEffect(loadReadOnlyData, [model.id]);

  const removeModel = async () => {
    await supabase.from("models").delete().eq("id", model.id);
    await refresh();
    onBack();
  };

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <div className="no-print" style={{ marginBottom: 14 }}>
        <a className="link" onClick={onBack}>← Back to Models</a>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 24 }}>{model.modelNo}{model.styleName ? ` — ${model.styleName}` : ""}</div>
          <div style={{ fontSize: 13, color: "#8a8a8a" }}>{[model.collectionName, model.category, model.productType, model.season].filter(Boolean).join(" · ")}</div>
          <div style={{ fontSize: 11.5, color: "#8a8a8a", marginTop: 4 }}>
            Created by {model.createdBy || "—"} on {fmtDateTime(model.createdAt)}
            {model.updatedBy && model.updatedAt && model.updatedAt !== model.createdAt ? ` · Last edited by ${model.updatedBy} on ${fmtDateTime(model.updatedAt)}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {canEdit && !editingModel && <a className="link" onClick={startEditCore}>Edit Model</a>}
          {canEdit && <a className="link" style={{ color: "#C1302B" }} onClick={removeModel}>Remove Model</a>}
        </div>
      </div>

      {editingModel && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>EDIT STYLE OVERVIEW & KEY DETAILS</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 12 }}>
            <Field label="Collection Name"><input style={inputStyle} value={coreForm.collectionName} onChange={(e) => setCoreForm((f) => ({ ...f, collectionName: e.target.value }))} /></Field>
            <Field label="Style Name"><input style={inputStyle} value={coreForm.styleName} onChange={(e) => setCoreForm((f) => ({ ...f, styleName: e.target.value }))} /></Field>
            <Field label="Category">
              <select style={inputStyle} value={coreForm.category} onChange={(e) => setCoreForm((f) => ({ ...f, category: e.target.value, productType: "" }))}>
                <option value="">Select category…</option>
                {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__other__">Other (specify)</option>
              </select>
              {coreForm.category === "__other__" && <input style={{ ...inputStyle, marginTop: 6 }} placeholder="Enter custom category" value={coreForm.customCategory || ""} onChange={(e) => setCoreForm((f) => ({ ...f, customCategory: e.target.value }))} />}
            </Field>
            <Field label="Product Type">
              <select style={inputStyle} value={coreForm.productType} onChange={(e) => setCoreForm((f) => ({ ...f, productType: e.target.value }))} disabled={!coreForm.category || coreForm.category === "__other__"}>
                <option value="">{coreForm.category ? "Select product type…" : "Select a category first"}</option>
                {(PRODUCT_CATALOG[coreForm.category] || []).map((t) => <option key={t} value={t}>{t}</option>)}
                <option value="__other__">Other (specify)</option>
              </select>
              {coreForm.productType === "__other__" && <input style={{ ...inputStyle, marginTop: 6 }} placeholder="Enter custom product type" value={coreForm.customProductType || ""} onChange={(e) => setCoreForm((f) => ({ ...f, customProductType: e.target.value }))} />}
            </Field>
            <Field label="Season"><input style={inputStyle} value={coreForm.season} onChange={(e) => setCoreForm((f) => ({ ...f, season: e.target.value }))} /></Field>
          </div>
          <Field label="Description"><textarea style={{ ...inputStyle, minHeight: 60 }} value={coreForm.description} onChange={(e) => setCoreForm((f) => ({ ...f, description: e.target.value }))} /></Field>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 14 }}>
            <Field label="Possible Cuts"><TagField value={coreForm.possibleCuts} onChange={(v) => setCoreForm((f) => ({ ...f, possibleCuts: v }))} options={POSSIBLE_CUTS_OPTIONS} /></Field>
            <Field label="Main Fabric Code"><TagField value={coreForm.mainFabricCode} onChange={(v) => setCoreForm((f) => ({ ...f, mainFabricCode: v }))} /></Field>
            <Field label="Inner Fabric Code"><TagField value={coreForm.innerFabricCode} onChange={(v) => setCoreForm((f) => ({ ...f, innerFabricCode: v }))} /></Field>
            <Field label="Other Fabric"><TagField value={coreForm.otherFabric} onChange={(v) => setCoreForm((f) => ({ ...f, otherFabric: v }))} /></Field>
            <Field label="Size Range"><TagField value={coreForm.sizeRange} onChange={(v) => setCoreForm((f) => ({ ...f, sizeRange: v }))} options={SIZE_RANGE_OPTIONS} /></Field>
            <Field label="Requirements"><TagField value={coreForm.requirements} onChange={(v) => setCoreForm((f) => ({ ...f, requirements: v }))} options={REQUIREMENTS_OPTIONS} /></Field>
            <Field label="Side Finishing"><TagField value={coreForm.sideFinishing} onChange={(v) => setCoreForm((f) => ({ ...f, sideFinishing: v }))} options={SIDE_FINISH_OPTIONS} /></Field>
            <Field label="Sleeve Open Finishing"><TagField value={coreForm.sleeveOpenFinishing} onChange={(v) => setCoreForm((f) => ({ ...f, sleeveOpenFinishing: v }))} options={SLEEVE_OPEN_FINISH_OPTIONS} /></Field>
            <Field label="Arm Hole Finishing"><TagField value={coreForm.armHoleFinishing} onChange={(v) => setCoreForm((f) => ({ ...f, armHoleFinishing: v }))} options={ARM_HOLE_FINISH_OPTIONS} /></Field>
            <Field label="Bottom / Length Finishing"><TagField value={coreForm.bottomFinishing} onChange={(v) => setCoreForm((f) => ({ ...f, bottomFinishing: v }))} options={BOTTOM_FINISH_OPTIONS} /></Field>
          </div>
        </div>
      )}

      {model.description && <div style={{ fontSize: 13.5, color: "#4A5468", margin: "10px 0 20px" }}>{model.description}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>PHOTOS</div>
          {(canEdit && editingModel) ? <ModelImages model={model} refresh={refresh} flash={flash} /> : images.length > 0 ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {images.map((img) => (
                <div key={img.id} style={{ textAlign: "center" }}>
                  <img src={img.url} alt={img.view_label} onClick={() => setLightbox(img.url)} style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 3, cursor: "zoom-in" }} />
                  <div style={{ fontSize: 10.5, marginTop: 2 }}>{img.view_label}</div>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No photos.</div>}
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>COLOR VARIATIONS</div>
          {(canEdit && editingModel) ? <ModelColors model={model} refresh={refresh} flash={flash} /> : colors.length > 0 ? (
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
          ) : <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No colors.</div>}
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>FABRIC SWATCHES</div>
          {(canEdit && editingModel) ? <ModelFabrics model={model} refresh={refresh} flash={flash} /> : fabrics.length > 0 ? (
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
          ) : <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No fabrics.</div>}
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>TRIMS & ACCESSORIES</div>
          {(canEdit && editingModel) ? <ModelTrims model={model} refresh={refresh} flash={flash} /> : trims.length > 0 ? (
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
          ) : <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No trims.</div>}
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>PATTERN & CUTTING SUMMARY</div>
        {(canEdit && editingModel) ? <ModelPatterns model={model} refresh={refresh} flash={flash} /> : patterns.length > 0 ? (
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
        ) : <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No pattern pieces.</div>}
      </div>

      {((canEdit && editingModel) || docs.length > 0) && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>SKETCHES & REFERENCE DOCUMENTS</div>
          {(canEdit && editingModel) ? <ModelDocuments model={model} session={session} refresh={refresh} flash={flash} /> : (
            <div style={{ display: "grid", gap: 6 }}>
              {docs.map((d) => (
                <div key={d.id} style={{ fontSize: 12.5 }}><a href={d.file_url} target="_blank" rel="noreferrer" className="link">{d.file_name}</a></div>
              ))}
            </div>
          )}
        </div>
      )}

      {!editingModel && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>KEY DETAILS / MANUFACTURING SPECS</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {MODEL_FIELDS.slice(1).map(([k, l]) => (
              <div key={k}>
                <div style={label13}>{l}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(model[k] || "").split(",").map((t) => t.trim()).filter(Boolean).map((t, i) => (
                    <span key={`${t}-${i}`} style={{ background: "#EEF0F2", border: "1px solid #C9CDD3", borderRadius: 12, padding: "2px 9px", fontSize: 11.5 }}>{t}</span>
                  ))}
                  {!model[k] && <span style={{ fontSize: 13, color: "#8a8a8a" }}>—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>SIZE MEASUREMENTS</div>
        {(canEdit && editingModel) ? <ModelSizes model={model} refresh={refresh} flash={flash} /> : <ReadOnlySizeTables model={model} sizes={sizes} />}
      </div>

      {editingModel && (
        <div style={{ display: "flex", gap: 10, marginTop: 24, paddingTop: 20, borderTop: "1px solid #E5E5E5" }}>
          <button disabled={savingCore} onClick={saveCoreEdits} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 4, padding: "10px 22px", fontSize: 13.5, fontWeight: 700 }}>Save Changes</button>
          <button onClick={() => { setEditingModel(false); loadReadOnlyData(); }} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "10px 22px", fontSize: 13.5, fontWeight: 700 }}>Done Editing</button>
        </div>
      )}
      {savingCore && <LoadingOverlay text="Saving changes…" />}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function ModelBrowser({ models, canEdit, refresh, flash, session }) {
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
    if (current) return <ModelDetailPage model={current} canEdit={canEdit} refresh={refresh} flash={flash} session={session} onBack={() => setSelectedId(null)} />;
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

  if (subpage === "models") return <ManageModels config={config} refresh={refresh} flash={flash} session={session} />;
  if (subpage === "viewmodels") return <ModelBrowser models={config.models} canEdit={true} refresh={refresh} flash={flash} session={session} />;
  if (subpage === "users") return <AddUsers config={config} />;
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
const DEFAULT_TEMPLATE_SIZES = ["Small", "Medium", "Large", "X-Large"];
const DEFAULT_TEMPLATE_ROWS = ["shoulder", "chest", "sleeveLength", "armhole", "length", "bottom"];

function SizeMeasurementGrid({ sizes, onChangeCell, onCellBlur, onAddSize, onRemoveSize, onRemoveRow, readOnly, customFields, onAddCustomField, initialRows }) {
  const [extraRows, setExtraRows] = useState(() => initialRows || []);
  const [addingKey, setAddingKey] = useState("");
  const [newSizeLabel, setNewSizeLabel] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState("");

  const ALL_FIELDS = [...FITTING_FIELDS, ...(customFields || []).map((c) => [c.key, c.label])];
  const dataKeys = ALL_FIELDS.filter(([k]) => sizes.some((s) => s.measurements[k])).map(([k]) => k);
  const rowKeys = Array.from(new Set([...extraRows, ...dataKeys]));
  const rows = ALL_FIELDS.filter(([k]) => rowKeys.includes(k));
  const unusedFields = ALL_FIELDS.filter(([k]) => !rowKeys.includes(k));
  const availableSizeLabels = ["Small", "Medium", "Large", "X-Large"].filter((l) => !sizes.some((s) => s.size_label === l));

  const removeRow = (key) => {
    setExtraRows((r) => r.filter((k) => k !== key));
    if (onRemoveRow) {
      onRemoveRow(key);
    } else {
      sizes.forEach((s) => {
        onChangeCell(s.size_label, key, "");
        if (onCellBlur) onCellBlur(s.size_label, key);
      });
    }
  };

  const addCustomField = () => {
    const label = customLabel.trim();
    if (!label) return;
    const key = "custom_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (onAddCustomField) onAddCustomField({ key, label });
    setExtraRows((r) => Array.from(new Set([...r, key])));
    setCustomLabel(""); setAddingCustom(false);
  };

  return (
    <div>
      {sizes.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 10 }}>Add a size column (S/M/L/XL) below to start entering measurements.</div>
      ) : rows.length === 0 ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 6 }}>No measurement rows yet.</div>
          {!readOnly && (
            <button type="button" onClick={() => setExtraRows(CORE_DEFAULT_ROWS)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "6px 12px", fontSize: 12 }}>
              + Add common measurements (Shoulder, Chest, Waist, Hips, Sleeve Length, Length – Front)
            </button>
          )}
        </div>
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

      {!readOnly && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
          {addingCustom ? (
            <>
              <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="New measurement name…" style={{ ...inputStyle, width: 170 }} />
              <button type="button" onClick={addCustomField} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 3, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>Add</button>
              <button type="button" onClick={() => { setAddingCustom(false); setCustomLabel(""); }} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "7px 12px", fontSize: 12 }}>Cancel</button>
            </>
          ) : (
            <button type="button" onClick={() => setAddingCustom(true)} title="Create a brand-new measurement term specific to this design"
              style={{ background: "#fff", border: "1px dashed #C9CDD3", borderRadius: 3, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>+ Custom Measurement</button>
          )}
        </div>
      )}
    </div>
  );
}

function ReadOnlySizeTables({ model, sizes }) {
  const cutTags = model.possibleCuts ? model.possibleCuts.split(",").map((c) => c.trim()).filter(Boolean) : [];
  const cutGroups = Array.from(new Set(sizes.map((s) => s.cut || null)));
  const groupsToShow = cutGroups.length > 0 ? cutGroups : [null];
  return groupsToShow.map((cut) => (
    <div key={cut || "general"} style={{ marginBottom: 16 }}>
      {cutTags.length > 1 && <div style={{ fontSize: 12, fontWeight: 700, color: "#3B6FA0", marginBottom: 6 }}>{cut || "General"}</div>}
      <SizeMeasurementGrid sizes={sizes.filter((s) => (s.cut || null) === cut)} customFields={model.customFields} readOnly />
    </div>
  ));
}

function ModelSizes({ model, refresh, flash }) {
  const [sizes, setSizes] = useState([]);
  const [addingCutTable, setAddingCutTable] = useState(false);
  const [newCutChoice, setNewCutChoice] = useState("");
  const [duplicateFrom, setDuplicateFrom] = useState("");

  const load = () => supabase.from("model_sizes").select("*").eq("model_id", model.id).then(({ data }) => setSizes(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const changeCell = (cut, sizeLabel, key, value) => {
    setSizes((prev) => prev.map((s) => (s.cut || null) === (cut || null) && s.size_label === sizeLabel ? { ...s, measurements: { ...s.measurements, [key]: value } } : s));
  };
  const persistCell = async (cut, sizeLabel) => {
    const row = sizes.find((s) => (s.cut || null) === (cut || null) && s.size_label === sizeLabel);
    if (!row) return;
    await supabase.from("model_sizes").update({ measurements: row.measurements }).eq("id", row.id);
  };
  const removeRow = async (cut, key) => {
    const groupSizes = sizes.filter((s) => (s.cut || null) === (cut || null));
    const updated = groupSizes.map((s) => ({ ...s, measurements: { ...s.measurements, [key]: "" } }));
    setSizes((prev) => prev.map((s) => updated.find((u) => u.id === s.id) || s));
    await Promise.all(updated.map((s) => supabase.from("model_sizes").update({ measurements: s.measurements }).eq("id", s.id)));
  };
  const addSize = async (cut, label) => {
    const { error } = await supabase.from("model_sizes").insert({ model_id: model.id, size_label: label, measurements: {}, cut: cut || null });
    if (error) { flash("Error: " + error.message); return; }
    load(); flash("Size added");
  };
  const removeSize = async (cut, label) => {
    const row = sizes.find((s) => (s.cut || null) === (cut || null) && s.size_label === label);
    if (row) await supabase.from("model_sizes").delete().eq("id", row.id);
    load();
  };
  const addCustomField = async (field) => {
    const existing = model.customFields || [];
    if (existing.some((f) => f.key === field.key)) return;
    await supabase.from("models").update({ custom_fields: [...existing, field] }).eq("id", model.id);
    await refresh();
  };

  const cutTags = model.possibleCuts ? model.possibleCuts.split(",").map((c) => c.trim()).filter(Boolean) : [];
  const cutGroups = Array.from(new Set(sizes.map((s) => s.cut || null)));
  const groupsToShow = cutGroups.length > 0 ? cutGroups : [null];
  const availableCutsToAdd = cutTags.filter((c) => !cutGroups.includes(c));

  const addCutTable = async () => {
    if (!newCutChoice) return;
    if (duplicateFrom) {
      const sourceCut = duplicateFrom === "__none__" ? null : duplicateFrom;
      const sourceRows = sizes.filter((s) => (s.cut || null) === sourceCut);
      for (const row of sourceRows) {
        await supabase.from("model_sizes").insert({ model_id: model.id, size_label: row.size_label, measurements: { ...row.measurements }, cut: newCutChoice });
      }
    } else {
      for (const label of DEFAULT_TEMPLATE_SIZES) {
        await supabase.from("model_sizes").insert({ model_id: model.id, size_label: label, measurements: Object.fromEntries(DEFAULT_TEMPLATE_ROWS.map((k) => [k, ""])), cut: newCutChoice });
      }
    }
    setAddingCutTable(false); setNewCutChoice(""); setDuplicateFrom("");
    load(); flash(`Size table added for ${newCutChoice}`);
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #C9CDD3" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>SIZE MEASUREMENTS FOR {model.modelNo}</div>

      {groupsToShow.map((cut) => (
        <div key={cut || "general"} style={{ marginBottom: 20 }}>
          {cutTags.length > 1 && <div style={{ fontSize: 12, fontWeight: 700, color: "#3B6FA0", marginBottom: 6 }}>{cut || "General"}</div>}
          <SizeMeasurementGrid
            sizes={sizes.filter((s) => (s.cut || null) === cut)}
            onChangeCell={(sizeLabel, key, value) => changeCell(cut, sizeLabel, key, value)}
            onCellBlur={(sizeLabel) => persistCell(cut, sizeLabel)}
            onAddSize={(label) => addSize(cut, label)}
            onRemoveSize={(label) => removeSize(cut, label)}
            onRemoveRow={(key) => removeRow(cut, key)}
            customFields={model.customFields}
            onAddCustomField={addCustomField}
          />
        </div>
      ))}

      {cutTags.length > 1 && (
        addingCutTable ? (
          <div style={{ border: "1px solid #C9CDD3", borderRadius: 6, padding: 12, marginTop: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>ADD SIZE TABLE FOR ANOTHER CUT</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <select value={newCutChoice} onChange={(e) => setNewCutChoice(e.target.value)} style={{ ...inputStyle, width: 160 }}>
                <option value="">Select cut…</option>
                {availableCutsToAdd.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={duplicateFrom} onChange={(e) => setDuplicateFrom(e.target.value)} style={{ ...inputStyle, width: 240 }}>
                <option value="">Start blank (Small–X-Large template)</option>
                {groupsToShow.map((c) => <option key={c || "general"} value={c || "__none__"}>Duplicate values from {c || "General"}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addCutTable} disabled={!newCutChoice} style={{ background: newCutChoice ? "#3B6FA0" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 4, padding: "7px 14px", fontSize: 12, fontWeight: 700 }}>Add Table</button>
              <button onClick={() => setAddingCutTable(false)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "7px 14px", fontSize: 12 }}>Cancel</button>
            </div>
          </div>
        ) : availableCutsToAdd.length > 0 && (
          <button onClick={() => setAddingCutTable(true)} style={{ background: "#fff", border: "1px dashed #C9CDD3", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, marginTop: 10 }}>+ Add Size Table for Another Cut</button>
        )
      )}
    </div>
  );
}

const ROLE_OPTIONS = [
  ["sales", "Sales"], ["production", "Production"], ["admin", "Admin"], ["model_manager", "Model Manager"],
];

function AddUsers({ config }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "sales", branch: "" });
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async () => {
    setMessage(null);
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setMessage({ type: "error", text: "Name, email, and password are all required." });
      return;
    }
    setCreating(true);
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: { email: form.email.trim(), password: form.password, name: form.name.trim(), role: form.role, branch: form.branch || null },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    setCreating(false);
    if (error || data?.error) {
      setMessage({ type: "error", text: data?.error || error?.message || "Something went wrong." });
      return;
    }
    setMessage({ type: "success", text: `${form.name} was created successfully with the ${form.role} role.` });
    setForm({ name: "", email: "", password: "", role: "sales", branch: "" });
  };

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 20, letterSpacing: "0.05em", marginBottom: 20 }}>ADD USERS</h2>

      <Field label="Full Name"><input style={inputStyle} value={form.name} onChange={set("name")} /></Field>
      <Field label="Email"><input type="email" style={inputStyle} value={form.email} onChange={set("email")} /></Field>
      <Field label="Password"><input type="text" style={inputStyle} value={form.password} onChange={set("password")} placeholder="At least 6 characters" /></Field>
      <Field label="Role">
        <select style={inputStyle} value={form.role} onChange={set("role")}>
          {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {form.role === "sales" && (
        <Field label="Branch">
          <select style={inputStyle} value={form.branch} onChange={set("branch")}>
            <option value="">Select branch…</option>
            {config.branches.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
        </Field>
      )}

      {message && (
        <div style={{ background: message.type === "error" ? "#FDECEC" : "#EAF5EC", color: message.type === "error" ? "#C1302B" : "#2F8F46", border: `1px solid ${message.type === "error" ? "#F0B8B8" : "#B7DFC0"}`, borderRadius: 4, padding: "10px 12px", fontSize: 13, marginBottom: 14 }}>
          {message.text}
        </div>
      )}

      <button disabled={creating} onClick={create} style={{ width: "100%", background: creating ? "#C9CDD3" : "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "11px 0", fontSize: 13.5, fontWeight: 700 }}>
        {creating ? "Creating…" : "Create User"}
      </button>
      {creating && <LoadingOverlay text="Creating login and assigning role…" />}
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
  const [colorAddError, setColorAddError] = useState("");
  const addPendingColor = () => {
    if (!newColorName.trim()) {
      setColorAddError("Enter a color name before adding.");
      return;
    }
    setColorAddError("");
    setPendingColors((c) => [...c, { name: newColorName, file: newColorFile }]);
    setNewColorName(""); setNewColorFile(null);
  };
  const removePendingColor = (i) => setPendingColors((c) => c.filter((_, idx) => idx !== i));

  const [pendingFabrics, setPendingFabrics] = useState([]);
  const [newFabricRole, setNewFabricRole] = useState("Main Fabric");
  const [newFabricName, setNewFabricName] = useState("");
  const [newFabricCode, setNewFabricCode] = useState("");
  const [newFabricFile, setNewFabricFile] = useState(null);
  const [fabricAddError, setFabricAddError] = useState("");
  const addPendingFabric = () => {
    if (!newFabricName.trim()) {
      setFabricAddError("Enter a fabric name before adding.");
      return;
    }
    setFabricAddError("");
    setPendingFabrics((f) => [...f, { role: newFabricRole, name: newFabricName, code: newFabricCode, file: newFabricFile }]);
    setNewFabricName(""); setNewFabricCode(""); setNewFabricFile(null);
  };
  const removePendingFabric = (i) => setPendingFabrics((f) => f.filter((_, idx) => idx !== i));

  const [pendingTrims, setPendingTrims] = useState([]);
  const [newTrimName, setNewTrimName] = useState("");
  const [newTrimCode, setNewTrimCode] = useState("");
  const [newTrimFile, setNewTrimFile] = useState(null);
  const [trimAddError, setTrimAddError] = useState("");
  const addPendingTrim = () => {
    if (!newTrimName.trim()) {
      setTrimAddError("Enter an item name before adding.");
      return;
    }
    setTrimAddError("");
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

  const [pendingDocuments, setPendingDocuments] = useState([]);
  const addPendingDocument = (e) => {
    const file = e.target.files?.[0];
    if (file) setPendingDocuments((d) => [...d, file]);
  };
  const removePendingDocument = (i) => setPendingDocuments((d) => d.filter((_, idx) => idx !== i));

  const [pendingSizes, setPendingSizes] = useState(() =>
    DEFAULT_TEMPLATE_SIZES.map((label) => ({ size_label: label, measurements: Object.fromEntries(DEFAULT_TEMPLATE_ROWS.map((k) => [k, ""])), cut: null }))
  );
  const [pendingCustomFields, setPendingCustomFields] = useState([]);
  const addPendingCustomField = (field) => setPendingCustomFields((f) => [...f, field]);
  const changePendingCell = (sizeLabel, key, value) => setPendingSizes((prev) => prev.map((s) => s.size_label === sizeLabel ? { ...s, measurements: { ...s.measurements, [key]: value } } : s));
  const addPendingSize = (label) => setPendingSizes((prev) => [...prev, { size_label: label, measurements: {} }]);
  const removePendingSize = (label) => setPendingSizes((prev) => prev.filter((s) => s.size_label !== label));

  const [addingCutTable, setAddingCutTable] = useState(false);
  const [newCutChoice, setNewCutChoice] = useState("");
  const [duplicateFrom, setDuplicateFrom] = useState("");

  const cutTags = form.possibleCuts ? form.possibleCuts.split(",").map((c) => c.trim()).filter(Boolean) : [];
  const cutGroups = Array.from(new Set(pendingSizes.map((s) => s.cut || null)));
  const groupsToShow = cutGroups.length > 0 ? cutGroups : [null];
  const availableCutsToAdd = cutTags.filter((c) => !cutGroups.includes(c));

  const changePendingCellForCut = (cut, sizeLabel, key, value) =>
    setPendingSizes((prev) => prev.map((s) => (s.cut || null) === (cut || null) && s.size_label === sizeLabel ? { ...s, measurements: { ...s.measurements, [key]: value } } : s));
  const addPendingSizeForCut = (cut, label) => setPendingSizes((prev) => [...prev, { size_label: label, measurements: {}, cut: cut || null }]);
  const removePendingSizeForCut = (cut, label) => setPendingSizes((prev) => prev.filter((s) => !((s.cut || null) === (cut || null) && s.size_label === label)));

  const addCutTable = () => {
    if (!newCutChoice) return;
    if (duplicateFrom) {
      const sourceCut = duplicateFrom === "__none__" ? null : duplicateFrom;
      const sourceRows = pendingSizes.filter((s) => (s.cut || null) === sourceCut);
      setPendingSizes((prev) => [...prev, ...sourceRows.map((r) => ({ size_label: r.size_label, measurements: { ...r.measurements }, cut: newCutChoice }))]);
    } else {
      setPendingSizes((prev) => [...prev, ...DEFAULT_TEMPLATE_SIZES.map((label) => ({ size_label: label, measurements: Object.fromEntries(DEFAULT_TEMPLATE_ROWS.map((k) => [k, ""])), cut: newCutChoice }))]);
    }
    setAddingCutTable(false); setNewCutChoice(""); setDuplicateFrom("");
  };

  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!form.modelNo.trim()) return;
    setCreating(true);
    const payload = { ...modelToDb(form) };
    STYLE_FIELDS.forEach(([k]) => { payload[k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase())] = form[k]; });
    payload.description = form.description;
    payload.created_by = session.name;
    payload.category = form.category === "__other__" ? (form.customCategory || "") : form.category;
    payload.product_type = form.productType === "__other__" ? (form.customProductType || "") : form.productType;
    payload.custom_fields = pendingCustomFields;
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

    for (const file of pendingDocuments) {
      const path = `model-documents/${inserted.id}-${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("attachments").upload(path, file);
      if (!upErr) {
        const { data } = supabase.storage.from("attachments").getPublicUrl(path);
        await supabase.from("model_documents").insert({ model_id: inserted.id, file_name: file.name, file_url: data.publicUrl, file_type: file.type, uploaded_by: session.name });
      }
    }

    for (const s of pendingSizes) {
      await supabase.from("model_sizes").insert({ model_id: inserted.id, size_label: s.size_label, measurements: s.measurements, cut: s.cut || null });
    }

    setForm(blank); setPhotoFiles({}); setPendingColors([]); setPendingFabrics([]); setPendingTrims([]); setPendingPatterns([]); setPendingDocuments([]);
    setPendingSizes(DEFAULT_TEMPLATE_SIZES.map((label) => ({ size_label: label, measurements: Object.fromEntries(DEFAULT_TEMPLATE_ROWS.map((k) => [k, ""])), cut: null })));
    setPendingCustomFields([]);
    setAddingCutTable(false); setNewCutChoice(""); setDuplicateFrom("");
    setCreating(false);
    await refresh();
    flash("Model created" + (pendingColors.length || pendingSizes.length || Object.keys(photoFiles).length ? " with photos, colors, and sizes" : ""));
  };

  const remove = async (id) => { await supabase.from("models").delete().eq("id", id); await refresh(); };

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ADD / REMOVE MODEL</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>STYLE OVERVIEW</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <Field label="Style No (Model No)"><input style={inputStyle} value={form.modelNo} onChange={set("modelNo")} /></Field>
            <Field label="Collection Name"><input style={inputStyle} value={form.collectionName} onChange={set("collectionName")} /></Field>
            <Field label="Style Name"><input style={inputStyle} value={form.styleName} onChange={set("styleName")} /></Field>
            <Field label="Category">
              <select style={inputStyle} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, productType: "" }))}>
                <option value="">Select category…</option>
                {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__other__">Other (specify)</option>
              </select>
              {form.category === "__other__" && (
                <input style={{ ...inputStyle, marginTop: 6 }} placeholder="Enter custom category" value={form.customCategory || ""} onChange={(e) => setForm((f) => ({ ...f, customCategory: e.target.value }))} />
              )}
            </Field>
            <Field label="Product Type">
              <select style={inputStyle} value={form.productType} onChange={(e) => setForm((f) => ({ ...f, productType: e.target.value }))} disabled={!form.category || form.category === "__other__"}>
                <option value="">{form.category ? "Select product type…" : "Select a category first"}</option>
                {(PRODUCT_CATALOG[form.category] || []).map((t) => <option key={t} value={t}>{t}</option>)}
                <option value="__other__">Other (specify)</option>
              </select>
              {form.productType === "__other__" && (
                <input style={{ ...inputStyle, marginTop: 6 }} placeholder="Enter custom product type" value={form.customProductType || ""} onChange={(e) => setForm((f) => ({ ...f, customProductType: e.target.value }))} />
              )}
            </Field>
            <Field label="Season"><input style={inputStyle} value={form.season} onChange={set("season")} /></Field>
          </div>
          <Field label="Description"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={set("description")} /></Field>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>KEY DETAILS / MANUFACTURING SPECS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 12 }}>
            <Field label="Possible Cuts"><TagField value={form.possibleCuts} onChange={(v) => setForm((f) => ({ ...f, possibleCuts: v }))} options={POSSIBLE_CUTS_OPTIONS} /></Field>
            <Field label="Main Fabric Code"><TagField value={form.mainFabricCode} onChange={(v) => setForm((f) => ({ ...f, mainFabricCode: v }))} /></Field>
            <Field label="Inner Fabric Code"><TagField value={form.innerFabricCode} onChange={(v) => setForm((f) => ({ ...f, innerFabricCode: v }))} /></Field>
            <Field label="Other Fabric"><TagField value={form.otherFabric} onChange={(v) => setForm((f) => ({ ...f, otherFabric: v }))} /></Field>
            <Field label="Size Range"><TagField value={form.sizeRange} onChange={(v) => setForm((f) => ({ ...f, sizeRange: v }))} options={SIZE_RANGE_OPTIONS} /></Field>
            <Field label="Requirements (if any)"><TagField value={form.requirements} onChange={(v) => setForm((f) => ({ ...f, requirements: v }))} options={REQUIREMENTS_OPTIONS} /></Field>
            <Field label="Side Finishing"><TagField value={form.sideFinishing} onChange={(v) => setForm((f) => ({ ...f, sideFinishing: v }))} options={SIDE_FINISH_OPTIONS} /></Field>
            <Field label="Sleeve Open Finishing"><TagField value={form.sleeveOpenFinishing} onChange={(v) => setForm((f) => ({ ...f, sleeveOpenFinishing: v }))} options={SLEEVE_OPEN_FINISH_OPTIONS} /></Field>
            <Field label="Arm Hole Finishing"><TagField value={form.armHoleFinishing} onChange={(v) => setForm((f) => ({ ...f, armHoleFinishing: v }))} options={ARM_HOLE_FINISH_OPTIONS} /></Field>
            <Field label="Bottom / Length Finishing"><TagField value={form.bottomFinishing} onChange={(v) => setForm((f) => ({ ...f, bottomFinishing: v }))} options={BOTTOM_FINISH_OPTIONS} /></Field>
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
              <div key={i} style={{ textAlign: "center", width: 110 }}>
                <div onClick={() => c.file && setLightbox(URL.createObjectURL(c.file))} style={{ width: 110, height: 110, borderRadius: 6, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", cursor: c.file ? "zoom-in" : "default" }}>
                  {c.file && <img src={URL.createObjectURL(c.file)} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontSize: 10.5, marginTop: 2 }}>{c.name}</div>
                <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => removePendingColor(i)}>Remove</a>
              </div>
            ))}
            <div style={{ textAlign: "center", width: 110 }}>
              <label htmlFor="pending-color-photo" style={{ width: 110, height: 110, border: "1px dashed #C9CDD3", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, cursor: "pointer" }}>
                {newColorFile ? <img src={URL.createObjectURL(newColorFile)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>}
                <input id="pending-color-photo" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setNewColorFile(e.target.files?.[0] || null)} />
              </label>
              <input placeholder="Color name" value={newColorName} onChange={(e) => setNewColorName(e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: "5px 6px", marginBottom: 4, textAlign: "center" }} />
              <button type="button" onClick={addPendingColor} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
              {colorAddError && <div style={{ color: "#C1302B", fontSize: 11.5, marginTop: 4 }}>{colorAddError}</div>}
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, alignContent: "flex-start" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>FABRIC SWATCHES</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {pendingFabrics.map((f, i) => (
              <div key={i} style={{ textAlign: "center", width: 110 }}>
                <div onClick={() => f.file && setLightbox(URL.createObjectURL(f.file))} style={{ width: 110, height: 110, borderRadius: 6, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", margin: "0 auto", cursor: f.file ? "zoom-in" : "default" }}>
                  {f.file && <img src={URL.createObjectURL(f.file)} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{f.role}</div>
                <div style={{ fontSize: 10, color: "#8a8a8a" }}>{f.name}{f.code ? ` · ${f.code}` : ""}</div>
                <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => removePendingFabric(i)}>Remove</a>
              </div>
            ))}
            <div style={{ textAlign: "center", width: 110 }}>
              <label htmlFor="pending-fabric-photo" style={{ width: 110, height: 110, border: "1px dashed #C9CDD3", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, cursor: "pointer" }}>
                {newFabricFile ? <img src={URL.createObjectURL(newFabricFile)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>}
                <input id="pending-fabric-photo" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setNewFabricFile(e.target.files?.[0] || null)} />
              </label>
              <select value={newFabricRole} onChange={(e) => setNewFabricRole(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }}>
                {["Main Fabric", "Lining", "Other"].map((r) => <option key={r}>{r}</option>)}
              </select>
              <input placeholder="Fabric name" value={newFabricName} onChange={(e) => setNewFabricName(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
              <input placeholder="Code" value={newFabricCode} onChange={(e) => setNewFabricCode(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
              <button type="button" onClick={addPendingFabric} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
              {fabricAddError && <div style={{ color: "#C1302B", fontSize: 11.5, marginTop: 4 }}>{fabricAddError}</div>}
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, alignContent: "flex-start" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>TRIMS & ACCESSORIES</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {pendingTrims.map((t, i) => (
              <div key={i} style={{ textAlign: "center", width: 110 }}>
                <div onClick={() => t.file && setLightbox(URL.createObjectURL(t.file))} style={{ width: 110, height: 110, borderRadius: 6, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", margin: "0 auto", cursor: t.file ? "zoom-in" : "default" }}>
                  {t.file && <img src={URL.createObjectURL(t.file)} alt={t.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 10, color: "#8a8a8a" }}>{t.code}</div>
                <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => removePendingTrim(i)}>Remove</a>
              </div>
            ))}
            <div style={{ textAlign: "center", width: 110 }}>
              <label htmlFor="pending-trim-photo" style={{ width: 110, height: 110, border: "1px dashed #C9CDD3", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, cursor: "pointer" }}>
                {newTrimFile ? <img src={URL.createObjectURL(newTrimFile)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>}
                <input id="pending-trim-photo" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setNewTrimFile(e.target.files?.[0] || null)} />
              </label>
              <input placeholder="Item name" value={newTrimName} onChange={(e) => setNewTrimName(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
              <input placeholder="Code" value={newTrimCode} onChange={(e) => setNewTrimCode(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
              <button type="button" onClick={addPendingTrim} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
              {trimAddError && <div style={{ color: "#C1302B", fontSize: 11.5, marginTop: 4 }}>{trimAddError}</div>}
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

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>SKETCHES & REFERENCE DOCUMENTS</div>
        {pendingDocuments.length > 0 && (
          <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
            {pendingDocuments.map((f, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, border: "1px solid #E5E5E5", padding: "6px 10px", borderRadius: 4 }}>
                <span>{f.name}</span>
                <a className="link" style={{ color: "#C1302B" }} onClick={() => removePendingDocument(i)}>Remove</a>
              </div>
            ))}
          </div>
        )}
        <FileButton label="Upload Sketch or Document" accept="image/*,.pdf,.doc,.docx" onChange={addPendingDocument} />
      </div>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>SIZE MEASUREMENTS</div>
        {groupsToShow.map((cut) => (
          <div key={cut || "general"} style={{ marginBottom: 20 }}>
            {cutTags.length > 1 && <div style={{ fontSize: 12, fontWeight: 700, color: "#3B6FA0", marginBottom: 6 }}>{cut || "General"}</div>}
            <SizeMeasurementGrid
              sizes={pendingSizes.filter((s) => (s.cut || null) === cut)}
              onChangeCell={(sizeLabel, key, value) => changePendingCellForCut(cut, sizeLabel, key, value)}
              onAddSize={(label) => addPendingSizeForCut(cut, label)}
              onRemoveSize={(label) => removePendingSizeForCut(cut, label)}
              customFields={pendingCustomFields}
              onAddCustomField={addPendingCustomField}
              initialRows={cut === (groupsToShow[0] || null) ? DEFAULT_TEMPLATE_ROWS : []}
            />
          </div>
        ))}

        {cutTags.length > 1 && (
          addingCutTable ? (
            <div style={{ border: "1px solid #C9CDD3", borderRadius: 6, padding: 12, marginTop: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>ADD SIZE TABLE FOR ANOTHER CUT</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <select value={newCutChoice} onChange={(e) => setNewCutChoice(e.target.value)} style={{ ...inputStyle, width: 160 }}>
                  <option value="">Select cut…</option>
                  {availableCutsToAdd.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={duplicateFrom} onChange={(e) => setDuplicateFrom(e.target.value)} style={{ ...inputStyle, width: 240 }}>
                  <option value="">Start blank (Small–X-Large template)</option>
                  {groupsToShow.map((c) => <option key={c || "general"} value={c || "__none__"}>Duplicate values from {c || "General"}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={addCutTable} disabled={!newCutChoice} style={{ background: newCutChoice ? "#3B6FA0" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 4, padding: "7px 14px", fontSize: 12, fontWeight: 700 }}>Add Table</button>
                <button onClick={() => setAddingCutTable(false)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "7px 14px", fontSize: 12 }}>Cancel</button>
              </div>
            </div>
          ) : availableCutsToAdd.length > 0 && (
            <button onClick={() => setAddingCutTable(true)} style={{ background: "#fff", border: "1px dashed #C9CDD3", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, marginTop: 10 }}>+ Add Size Table for Another Cut</button>
          )
        )}
      </div>

      <button disabled={creating} onClick={create} style={{ width: "100%", background: creating ? "#C9CDD3" : "#1A1A1A", color: "#fff", border: "none", borderRadius: 6, padding: "14px", fontSize: 14, fontWeight: 700, marginBottom: 28 }}>
        {creating ? "Creating…" : "Create Model"}
      </button>
      {creating && <LoadingOverlay text="Creating model — uploading photos and details…" />}
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
    <div>
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
  const [addError, setAddError] = useState("");

  const load = () => supabase.from("model_colors").select("*").eq("model_id", model.id).then(({ data }) => setColors(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const add = async () => {
    if (!name.trim()) {
      setAddError("Enter a color name before adding.");
      return;
    }
    setAddError("");
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
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {colors.map((c) => (
          <div key={c.id} style={{ textAlign: "center", width: 110, position: "relative" }}>
            <div onClick={() => c.swatch_url && setLightbox(c.swatch_url)} style={{ width: 110, height: 110, borderRadius: 6, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", cursor: c.swatch_url ? "zoom-in" : "default" }}>
              {c.swatch_url && <img src={c.swatch_url} alt={c.color_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ fontSize: 10.5, marginTop: 2 }}>{c.color_name}</div>
            <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => remove(c.id)}>Remove</a>
          </div>
        ))}
        <div style={{ textAlign: "center", width: 110 }}>
          <label htmlFor="model-color-photo" style={{ width: 110, height: 110, border: "1px dashed #C9CDD3", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, cursor: "pointer" }}>
            {file ? <img src={URL.createObjectURL(file)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>}
            <input id="model-color-photo" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <input placeholder="Color name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: "5px 6px", marginBottom: 4, textAlign: "center" }} />
          <button type="button" onClick={add} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
          {addError && <div style={{ color: "#C1302B", fontSize: 11.5, marginTop: 4 }}>{addError}</div>}
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
  const [addError, setAddError] = useState("");

  const load = () => supabase.from("model_fabrics").select("*").eq("model_id", model.id).then(({ data }) => setFabrics(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const add = async () => {
    if (!name.trim()) {
      setAddError("Enter a fabric name before adding.");
      return;
    }
    setAddError("");
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
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {fabrics.map((f) => (
          <div key={f.id} style={{ textAlign: "center", width: 110 }}>
            <div onClick={() => f.swatch_url && setLightbox(f.swatch_url)} style={{ width: 110, height: 110, borderRadius: 6, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", margin: "0 auto", cursor: f.swatch_url ? "zoom-in" : "default" }}>
              {f.swatch_url && <img src={f.swatch_url} alt={f.fabric_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{f.fabric_role}</div>
            <div style={{ fontSize: 10, color: "#8a8a8a" }}>{f.fabric_name}{f.fabric_code ? ` · ${f.fabric_code}` : ""}</div>
            <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => remove(f.id)}>Remove</a>
          </div>
        ))}
        <div style={{ textAlign: "center", width: 110 }}>
          <label htmlFor="model-fabric-photo" style={{ width: 110, height: 110, border: "1px dashed #C9CDD3", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, cursor: "pointer" }}>
            {file ? <img src={URL.createObjectURL(file)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>}
            <input id="model-fabric-photo" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }}>
            {["Main Fabric", "Lining", "Other"].map((r) => <option key={r}>{r}</option>)}
          </select>
          <input placeholder="Fabric name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
          <input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
          <button type="button" onClick={add} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
          {addError && <div style={{ color: "#C1302B", fontSize: 11.5, marginTop: 4 }}>{addError}</div>}
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
  const [addError, setAddError] = useState("");

  const load = () => supabase.from("model_trims").select("*").eq("model_id", model.id).then(({ data }) => setTrims(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const add = async () => {
    if (!name.trim()) {
      setAddError("Enter an item name before adding.");
      return;
    }
    setAddError("");
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
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {trims.map((t) => (
          <div key={t.id} style={{ textAlign: "center", width: 110 }}>
            <div onClick={() => t.image_url && setLightbox(t.image_url)} style={{ width: 110, height: 110, borderRadius: 6, overflow: "hidden", background: "#F2F2F2", border: "1px solid #E5E5E5", margin: "0 auto", cursor: t.image_url ? "zoom-in" : "default" }}>
              {t.image_url && <img src={t.image_url} alt={t.item_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{t.item_name}</div>
            <div style={{ fontSize: 10, color: "#8a8a8a" }}>{t.item_code}</div>
            <a className="link" style={{ fontSize: 10, color: "#C1302B" }} onClick={() => remove(t.id)}>Remove</a>
          </div>
        ))}
        <div style={{ textAlign: "center", width: 110 }}>
          <label htmlFor="model-trim-photo" style={{ width: 110, height: 110, border: "1px dashed #C9CDD3", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, cursor: "pointer" }}>
            {file ? <img src={URL.createObjectURL(file)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, color: "#C9CDD3" }}>+</span>}
            <input id="model-trim-photo" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <input placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
          <input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} style={{ ...inputStyle, fontSize: 10, padding: "4px", marginBottom: 3 }} />
          <button type="button" onClick={add} style={{ marginTop: 4, width: "100%", background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 0", fontSize: 11, fontWeight: 700 }}>+ Add</button>
          {addError && <div style={{ color: "#C1302B", fontSize: 11.5, marginTop: 4 }}>{addError}</div>}
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
    <div>
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

function ModelDocuments({ model, session, refresh, flash }) {
  const [docs, setDocs] = useState([]);
  const load = () => supabase.from("model_documents").select("*").eq("model_id", model.id).order("created_at", { ascending: false }).then(({ data }) => setDocs(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const path = `model-documents/${model.id}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("attachments").upload(path, file);
    if (!error) {
      const { data } = supabase.storage.from("attachments").getPublicUrl(path);
      await supabase.from("model_documents").insert({ model_id: model.id, file_name: file.name, file_url: data.publicUrl, file_type: file.type, uploaded_by: session.name });
      load(); flash("File added");
    }
  };
  const remove = async (id) => { await supabase.from("model_documents").delete().eq("id", id); load(); };

  return (
    <div>
      <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
        {docs.map((d) => (
          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, border: "1px solid #E5E5E5", padding: "6px 10px", borderRadius: 4 }}>
            <a href={d.file_url} target="_blank" rel="noreferrer" className="link">{d.file_name}</a>
            <span style={{ color: "#8a8a8a", fontSize: 11 }}>{d.uploaded_by} · {fmtDate(d.created_at)}</span>
            <a className="link" style={{ color: "#C1302B" }} onClick={() => remove(d.id)}>Remove</a>
          </div>
        ))}
      </div>
      <FileButton label="Upload Sketch or Document" accept="image/*,.pdf,.doc,.docx" onChange={upload} />
    </div>
  );
}
