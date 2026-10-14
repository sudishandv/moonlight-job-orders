import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabaseClient";

// Supabase's default PostgREST config caps any single response at 1000 rows
// server-side, regardless of how large a .range() the client asks for — so
// tables that can exceed that (like legacy_orders) need real pagination.
async function fetchAllRows(table, columns) {
  const pageSize = 1000;
  let rows = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from(table).select(columns).range(offset, offset + pageSize - 1);
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

/* =========================================================
   MOONLIGHT CONCEPT — Job Order System (Supabase-backed)
   Roles: Sales (incl. showroom actions) / Production / Admin
========================================================= */

const PROJECTS_ENABLED = false; // flip to true when ready to continue building this module

const STATUS = {
  job_created: { label: "Job Created", color: "#2F8F46" },
  job_rejected: { label: "Job Rejected", color: "#C1302B" },
  job_in_process: { label: "Job In Progress", color: "#2F8F46" },
  job_completed: { label: "Job Completed", color: "#2F8F46" },
  job_returned: { label: "Job Returned", color: "#C1302B" },
  job_return_in_process: { label: "Job Return In Process", color: "#2F8F46" },
  job_return_complete: { label: "Job Return Complete", color: "#2F8F46" },
  ready_to_deliver: { label: "Ready To Deliver", color: "#1A1A1A" },
  delivered: { label: "Delivered", color: "#1A1A1A" },
  // Production cycle (part 1 uses the first two; the rest are filled in by the coming parts)
  job_accepted: { label: "Accepted — Assign Material", color: "#2F8F46" },
  material_assigned: { label: "Material Assigned — Assign Tailors", color: "#2F8F46" },
  manpower_planned: { label: "Tailors Planned — Start Tailoring", color: "#2F8F46" },
  public_in_process: { label: "Job In Process", color: "#C1302B" },   // what Sales sees instead of the internal stages
  job_pending_qc: { label: "Pending Quality Check", color: "#D98E2B" },
  job_rework: { label: "Rework", color: "#C1302B" },
  ready_in_production: { label: "Ready in Production", color: "#1A1A1A" },
  in_transit: { label: "Delivery to Stores", color: "#3B6FA0" },
  store_received: { label: "Delivery Accepted — Re-Quality Check", color: "#D98E2B" },
  ready_in_stores: { label: "Ready in Stores", color: "#1A1A1A" },
  delivery_assigned: { label: "Delivery Assigned", color: "#3B6FA0" },
};

// Internal production stages are hidden from everyone except Production and Admin; others see "Job In Process" instead.
const PRODUCTION_ONLY = ["job_accepted", "material_assigned", "manpower_planned", "job_in_process", "job_pending_qc", "job_rework"];
let VIEWER_ROLE = null;
const setViewerRole = (r) => { VIEWER_ROLE = r; };
const maskStatus = (status, role = VIEWER_ROLE) =>
  (role === "production" || role === "admin" || !PRODUCTION_ONLY.includes(status)) ? status : "public_in_process";
const hidePII = (session) => !!session && session.role === "production";   // Production never sees a customer's name or mobile number
// Statuses after production hands the order on: Production's own list drops them
const AFTER_PRODUCTION = ["in_transit", "store_received", "ready_in_stores", "delivery_assigned", "ready_to_deliver", "delivered"];
// "Delivered to stores" = everything from Delivery to Stores onwards, so a piece is never lost from view
const DELIVERED_STATUSES = AFTER_PRODUCTION;

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

const ROLE_HOME_CARDS = {
  sales: [
    ["🧵", "New Job Order", "Start one from scratch", "new"],
    ["📋", "All Records", "View and manage job orders", "records"],
    ["📦", "Incoming Deliveries", "Deliveries coming to your branch", "incoming"],
    ["🛵", "Customer Deliveries", "Assign drivers & track deliveries", "custdeliveries"],
    ["📐", "New Requirement", "Take fitting measurements", "requirement"],
    ["📄", "Requirement List", "Browse saved requirements", "requirements"],
    ["👤", "Customers", "Search profiles & history", "customers"],
    ["🔔", "Notifications", "Everything that has happened", "notifications"],
    ["🗂️", "Projects", "Design team projects", "projects"],
  ],
  production: [
    ["📋", "Production Panel", "Orders awaiting production", "records"],
    ["📅", "Production Calendar", "What's being made today", "calendar"],
    ["✅", "Quality Check", "Finished pieces waiting to be checked", "qcqueue"],
    ["🚚", "Delivery to Stores", "Send finished pieces to the branches", "deliveries"],
    ["🧥", "Item Details", "Browse the model catalog", "items"],
    ["📄", "Requirement List", "View saved requirements", "requirements"],
    ["🔔", "Notifications", "Everything that has happened", "notifications"],
    ["🗂️", "Projects", "Design team projects", "projects"],
  ],
  admin: [
    ["🧵", "New Job Order", "Start one from scratch", "new"],
    ["📋", "All Records", "View and manage job orders", "records"],
    ["📐", "New Requirement", "Take fitting measurements", "requirement"],
    ["📄", "All Requirements", "Browse saved requirements", "requirements"],
    ["🏬", "Add/Remove Branch", "Manage branch list", "branches"],
    ["➕", "Add Model", "Create a new style", "models"],
    ["🧥", "View Models", "Browse & edit the catalog", "viewmodels"],
    ["👥", "Add Users", "Create logins & assign roles", "users"],
    ["👤", "Customers", "Search profiles & history", "customers"],
    ["📊", "Analytics", "Which models and orders perform best", "analytics"],
    ["📅", "Production Calendar", "What's being made today", "calendar"],
    ["✅", "Quality Check", "Finished pieces waiting to be checked", "qcqueue"],
    ["📝", "Quality Checklist", "Edit the standard checks", "qcsetup"],
    ["🚚", "Delivery to Stores", "Send finished pieces to the branches", "deliveries"],
    ["📦", "Incoming Deliveries", "Deliveries coming to your branch", "incoming"],
    ["🛵", "Customer Deliveries", "Assign drivers & track deliveries", "custdeliveries"],
    ["🔐", "PIN & Devices", "Set PINs, approve showroom iPads", "pins"],
    ["🔔", "Notifications", "Everything that has happened", "notifications"],
    ["🗂️", "Projects", "Design team projects", "projects"],
  ],
  model_manager: [
    ["➕", "Add Model", "Create a new style", "models"],
    ["🧥", "View Models", "Browse & edit the catalog", "viewmodels"],
    ["📊", "Analytics", "Which models and orders perform best", "analytics"],
    ["🔔", "Notifications", "Everything that has happened", "notifications"],
    ["🗂️", "Projects", "Design team projects", "projects"],
  ],
};

// What is still waiting for this person, per tile. The numbers are real counts of work left, so they fall as the work is finished.
function computeTasks(profile, orders, sentNotes) {
  const t = {};
  if (!profile) return t;
  const role = profile.role;
  const list = orders || [];
  const mine = (o) => role === "admin" || o.branch === profile.branch;
  const count = (status, filter) => list.filter((o) => o.status === status && (!filter || filter(o))).length;
  const put = (key, parts, info) => {
    const live = parts.filter((p) => p[0] > 0);
    const total = live.reduce((s, p) => s + p[0], 0);
    if (total > 0 || info > 0) t[key] = { count: total, label: live.map((p) => `${p[0]} ${p[1]}`).join(" · "), info: info > 0 ? `${info} in process` : "" };
  };
  const inProd = list.filter((o) => ["job_accepted", "material_assigned", "manpower_planned", "job_in_process", "job_rework"].includes(o.status)).length;                 // what Production sees
  const inProdSales = list.filter((o) => mine(o) && ["job_accepted", "material_assigned", "manpower_planned", "job_in_process", "job_pending_qc", "job_rework"].includes(o.status)).length;  // what Sales sees as "Job In Process"
  const prod = role === "production" || role === "admin";
  const sales = role === "sales" || role === "admin";
  const records = [];
  if (prod) records.push([count("job_created"), "to accept"], [count("job_accepted"), "need material"], [count("material_assigned"), "need tailors"], [count("manpower_planned"), "to start"], [count("job_rework"), "for rework"]);
  if (sales) records.push([count("job_rejected", mine), "to fix & resend"]);
  put("records", records, prod ? inProd : inProdSales);
  if (prod) {
    put("qcqueue", [[count("job_pending_qc"), "to quality check"]]);
    put("deliveries", [[count("ready_in_production"), "ready to send"]]);
  }
  if (sales) {
    put("incoming", [[sentNotes || 0, "delivery to accept"], [count("store_received", mine), "to re-check"]]);
    put("custdeliveries", [[count("ready_in_stores", mine), "ready to deliver"]]);
  }
  return t;
}

function HomePage({ session, setSubpage, tasks }) {
  const cards = ROLE_HOME_CARDS[session.role] || [];
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: "#8a8a8a" }}>Welcome back, {session.name}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        {cards.map(([icon, title, desc, target]) => {
          const task = tasks && tasks[target];
          const urgent = task && task.count > 0;
          return (
            <div key={target} onClick={() => setSubpage(target)}
              style={{ position: "relative", border: "1px solid " + (urgent ? "#E8B9B6" : "#DDE1E7"), borderRadius: 4, padding: "26px 16px", textAlign: "center", cursor: "pointer", background: urgent ? "#FFFAFA" : "#fff" }}>
              {urgent && <span style={{ position: "absolute", top: 8, right: 8, minWidth: 24, height: 24, padding: "0 7px", borderRadius: 12, background: "#C1302B", color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(193,48,43,0.4)" }}>{task.count}</span>}
              <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "0.03em", marginBottom: 4 }}>{title.toUpperCase()}</div>
              <div style={{ fontSize: 11, color: "#8a8a8a" }}>{desc}</div>
              {urgent && <div style={{ fontSize: 11.5, color: "#C1302B", fontWeight: 700, marginTop: 6 }}>{task.label}</div>}
              {task && task.info && <div style={{ fontSize: 11.5, color: "#B87400", fontWeight: 600, marginTop: urgent ? 2 : 6 }}>{task.info}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const FITTING_FIELDS_GENERAL = [
  ["neckSize", "Neck Size"], ["shoulder", "Shoulder"], ["chest", "Chest"], ["waist", "Waist"], ["hips", "Hips"],
  ["bottom", "Bottom"], ["sleeveLength", "Sleeve Length"], ["sleeveOpen", "Sleeve Open"], ["armhole", "Armhole"], ["aroundArmhole", "Around Armhole"],
  ["bicep", "Bicep"], ["wrist", "Wrist"], ["upperArmLevel", "Upper Arm Level"], ["acrossBackWidth", "Across Back Width"],
  ["length", "Length"], ["lengthBack", "Length – Back"],
];
const FITTING_FIELDS_TROUSER = [
  ["trouserWaist", "Waist"], ["trouserHips", "Hips"], ["trouserThigh", "Thigh"],
  ["trouserRise", "Rise Front to Back"], ["trouserLength", "Length"],
];
const FITTING_FIELDS = [...FITTING_FIELDS_GENERAL, ...FITTING_FIELDS_TROUSER];

const MEASUREMENT_OPTIONS = [];
for (let v = 5; v <= 70; v += 0.5) MEASUREMENT_OPTIONS.push(v % 1 === 0 ? String(v) : v.toFixed(1));
const normalizeMeasurement = (v) => {
  if (v === undefined || v === null || v === "") return "";
  const n = parseFloat(v);
  if (Number.isNaN(n)) return "";
  return n % 1 === 0 ? String(n) : n.toFixed(1);
};

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

const cutTagsOf = (model) => (model.possibleCuts ? model.possibleCuts.split(",").map((c) => c.trim()).filter(Boolean) : []);
const toNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const rowsForCut = (sizes, cut) => {
  const exact = sizes.filter((s) => (s.cut || null) === (cut || null));
  if (exact.length) return exact;
  const general = sizes.filter((s) => !s.cut);
  return general.length ? general : sizes;
};
const calcFromRow = (row) => Object.fromEntries(
  Object.entries(row.measurements || {}).map(([k, v]) => [k, toNum(v)]).filter(([, v]) => v !== null)
);
const calcToStrings = (calc) => Object.fromEntries(
  Object.entries(calc || {}).filter(([, v]) => v !== null && v !== "" && v !== undefined).map(([k, v]) => [k, String(v)])
);
// Suggest a size: per field, compare the customer's value as-is AND halved against the chart (chart values for
// chest/waist/hips are usually half-circumference), and take whichever is closer.
const suggestSize = (customerM, rows) => {
  let best = null, bestScore = Infinity;
  rows.forEach((row) => {
    let score = 0, count = 0;
    CORE_FIT_FIELDS.forEach((f) => {
      const c = toNum(customerM[f]), b = toNum(row.measurements && row.measurements[f]);
      if (c !== null && b !== null) { score += Math.min(Math.abs(c - b), Math.abs(c / 2 - b)); count++; }
    });
    if (count > 0 && score / count < bestScore) { bestScore = score / count; best = row; }
  });
  return best || rows.find((r) => r.size_label === "Medium") || rows[0] || null;
};

const buildCalc = (model, cut, sizes, fitted) => {
  const entry = calcEntryFor(model, cut);
  const formulaCalc = calcHasRows(entry) ? runCalc(entry, fitted) : {};
  const chartKeys = new Set();
  rowsForCut(sizes || [], cut).forEach((row) => Object.entries(row.measurements || {}).forEach(([k, v]) => { if (toNum(v) !== null) chartKeys.add(k); }));
  const pointKeys = new Set([...Object.keys((entry && entry.rows) || {}), ...chartKeys]);
  const calc = {};
  const fittedKeys = [];
  pointKeys.forEach((k) => {
    if (formulaCalc[k] !== undefined) calc[k] = formulaCalc[k];
    else { const f = toNum(fitted[k]); if (f !== null) { calc[k] = f; fittedKeys.push(k); } }
  });
  if (pointKeys.size === 0) {
    FITTING_FIELDS_GENERAL.forEach(([k]) => { const f = toNum(fitted[k]); if (f !== null) { calc[k] = f; fittedKeys.push(k); } });
  }
  return { calc, formulaKeys: Object.keys(formulaCalc), fittedKeys };
};

// Rank the chart sizes by how close they are to the calculated values (best first).
// Only measurements that exist in BOTH the item and that size's chart row are compared.
const nearestSizes = (calc, sizes, cut) => {
  const scored = rowsForCut(sizes || [], cut).map((row) => {
    let sum = 0, n = 0;
    Object.entries(calc).forEach(([k, v]) => {
      const b = toNum(row.measurements && row.measurements[k]);
      if (b !== null) { sum += Math.abs(v - b); n++; }
    });
    return { row, label: row.size_label, gap: n ? sum / n : null, n };
  }).filter((s) => s.gap !== null);
  scored.sort((a, b) => a.gap - b.gap);
  return scored;
};

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
    sheilaType: before.sheilaType || SHEILA_TYPES[0], abayaOption: normAbaya(before.abayaOption),
    buttonFrom: before.buttonFrom || "", buttonTill: before.buttonTill || "", additionalRequirements: before.additionalRequirements || "", color: before.color || "",
    deliveryDate: before.deliveryDate || "", comments: before.comments || "",
  };
  const simpleMap = { name: "Name", mobile: "Mobile", orderType: "Order Type", model: "Model", item: "Item", branch: "Branch", sheilaType: "Sheila Type", abayaOption: "Abaya Option", buttonFrom: "Button start from", buttonTill: "Button till", additionalRequirements: "Additional Requirements", color: "Colour", deliveryDate: "Delivery Date", comments: "Comments" };
  Object.entries(simpleMap).forEach(([k, label]) => {
    const oldV = norm[k] || "—", newV = (k === "abayaOption" ? normAbaya(form[k]) : form[k]) || "—";
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
const ROLE_LABEL = { sales: "Sales Panel", production: "Production Panel", admin: "Admin Panel", model_manager: "Model Manager", driver: "Driver" };

const fmtDate = (d) => { if (!d) return "—"; try { return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return d; } };
const fmtDateTime = (d) => { try { return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return d; } };

// Customer files (signatures, order attachments) live in a PRIVATE bucket and are stored as "cf:<path>".
// Anything that still holds an ordinary web link (catalogue files, older customer files) keeps working.
const PRIVATE_BUCKET = "customer-files";
const PRIVATE_PREFIX = "cf:";
const isPrivateRef = (u) => typeof u === "string" && u.startsWith(PRIVATE_PREFIX);
const signedCache = {};

async function resolveFileUrl(ref) {
  if (!isPrivateRef(ref)) return ref;                       // ordinary public link — use as it is
  const path = ref.slice(PRIVATE_PREFIX.length);
  const hit = signedCache[path];
  if (hit && hit.exp > Date.now() + 60000) return hit.url;
  const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return "";
  signedCache[path] = { url: data.signedUrl, exp: Date.now() + 3600 * 1000 };
  return data.signedUrl;
}
function useFileUrl(ref) {
  const [url, setUrl] = useState(isPrivateRef(ref) ? "" : ref || "");
  useEffect(() => {
    let alive = true;
    if (!isPrivateRef(ref)) { setUrl(ref || ""); return; }
    resolveFileUrl(ref).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [ref]);
  return url;
}
// Use instead of <img> for any customer file (signatures, attachments)
function SecureImg({ src, style, ...rest }) {
  const url = useFileUrl(src);
  return url ? <img src={url} style={style} {...rest} /> : <div style={{ background: "#F2F2F2", ...style }} />;
}
// Same idea for a "View file" link.
function SecureLink({ href, children }) {
  const url = useFileUrl(href);
  return <a className="link" href={url || undefined} target="_blank" rel="noreferrer">{children}</a>;
}
async function uploadCustomerFile(path, file, contentType) {
  const { error } = await supabase.storage.from(PRIVATE_BUCKET).upload(path, file, contentType ? { contentType } : undefined);
  return error ? { error } : { ref: PRIVATE_PREFIX + path };
}

function Lightbox({ src, alt, onClose }) {
  const realSrc = useFileUrl(src);
  if (!realSrc) return null;
  return (
    <div className="no-print" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200, cursor: "zoom-out" }} onClick={onClose}>
      <img src={realSrc} alt={alt || ""} style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain", borderRadius: 4 }} onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} style={{ position: "absolute", top: 20, right: 24, background: "none", border: "none", color: "#fff", fontSize: 30, cursor: "pointer", lineHeight: 1 }}>×</button>
    </div>
  );
}

function ConfirmDialog({ title, children, confirmLabel, cancelLabel, busy, confirmDisabled, onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 24, maxWidth: 460, width: "100%", boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 19, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 14, color: "#3a3a3a", marginBottom: 20, lineHeight: 1.5 }}>{children}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={busy} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "10px 22px", fontSize: 14, fontWeight: 700 }}>{cancelLabel || "No"}</button>
          <button onClick={onConfirm} disabled={busy || confirmDisabled} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "10px 22px", fontSize: 14, fontWeight: 700, opacity: (busy || confirmDisabled) ? 0.4 : 1 }}>{busy ? "Saving…" : (confirmLabel || "Yes")}</button>
        </div>
      </div>
    </div>
  );
}

function VideoViewer({ src, onClose }) {
  const realSrc = useFileUrl(src);
  if (!realSrc) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative" }}>
        <video src={realSrc} controls autoPlay playsInline style={{ maxWidth: "92vw", maxHeight: "85vh", background: "#000" }} />
        <div onClick={onClose} style={{ position: "absolute", top: -34, right: 0, color: "#fff", fontSize: 26, cursor: "pointer" }}>×</div>
      </div>
    </div>
  );
}

// Read-only gallery (view pages, print). Images open in the Lightbox, videos in the VideoViewer.
function AttachmentGallery({ files }) {
  const [img, setImg] = useState(null);
  const [vid, setVid] = useState(null);
  if (!files || files.length === 0) return <span style={{ fontSize: 13, color: "#8a8a8a" }}>None</span>;
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {files.map((f, i) => (
          <div key={i} className={f.type === "video" ? "no-print" : undefined} style={{ width: 96 }}>
            {f.type === "video" ? (
              <div onClick={() => setVid(f.url)} style={{ width: 96, height: 96, background: "#1A1A1A", color: "#fff", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 30 }}>▶</div>
            ) : (
              <SecureImg src={f.url} alt={f.name} onClick={() => setImg(f.url)} style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 4, cursor: "zoom-in", border: "1px solid #E5E5E5" }} />
            )}
            <div style={{ fontSize: 10.5, color: "#8a8a8a", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
          </div>
        ))}
      </div>
      {img && <Lightbox src={img} onClose={() => setImg(null)} />}
      {vid && <VideoViewer src={vid} onClose={() => setVid(null)} />}
    </>
  );
}

// Editable: pick photos/videos, they upload straight away and appear as thumbnails with a remove ×.
function AttachmentField({ files, onChange, disabled, folder }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [img, setImg] = useState(null);
  const [vid, setVid] = useState(null);
  const [inputId] = useState(() => "att-" + Math.random().toString(36).slice(2));
  const list = files || [];

  const pick = async (e) => {
    const chosen = Array.from(e.target.files || []);
    e.target.value = "";
    if (chosen.length === 0) return;
    setUploading(true); setError("");
    const added = [];
    for (const file of chosen) {
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) { setError(`"${file.name}" isn't a photo or video.`); continue; }
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${folder || "order-files"}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
      const up = await uploadCustomerFile(path, file, file.type);
      if (up.error) { setError(`Couldn't upload "${file.name}": ${up.error.message}`); continue; }
      added.push({ url: up.ref, name: file.name, type: isVideo ? "video" : "image" });
    }
    setUploading(false);
    if (added.length) onChange([...list, ...added]);
  };
  const remove = (i) => onChange(list.filter((_, j) => j !== i));

  return (
    <div>
      <div style={label13}>Attachments (photos / videos)</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
        {list.map((f, i) => (
          <div key={i} style={{ width: 96, position: "relative" }}>
            {f.type === "video" ? (
              <div onClick={() => setVid(f.url)} style={{ width: 96, height: 96, background: "#1A1A1A", color: "#fff", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 30 }}>▶</div>
            ) : (
              <SecureImg src={f.url} alt={f.name} onClick={() => setImg(f.url)} style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 4, cursor: "zoom-in", border: "1px solid #E5E5E5" }} />
            )}
            {!disabled && (
              <span onClick={() => remove(i)} style={{ position: "absolute", top: -6, right: -6, background: "#C1302B", color: "#fff", borderRadius: 10, width: 18, height: 18, fontSize: 12, lineHeight: "18px", textAlign: "center", cursor: "pointer", fontWeight: 700 }}>×</span>
            )}
            <div style={{ fontSize: 10.5, color: "#8a8a8a", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
          </div>
        ))}
        {!disabled && (
          <label htmlFor={inputId} style={{ width: 96, height: 96, border: "1px dashed #C9CDD3", borderRadius: 4, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: uploading ? "wait" : "pointer", color: "#8a8a8a", fontSize: 12, textAlign: "center" }}>
            <span style={{ fontSize: 24, color: "#C9CDD3" }}>{uploading ? "…" : "+"}</span>
            {uploading ? "Uploading" : "Add photo / video"}
            <input id={inputId} type="file" accept="image/*,video/*" multiple onChange={pick} disabled={uploading} style={{ display: "none" }} />
          </label>
        )}
      </div>
      {error && <div style={{ color: "#C1302B", fontSize: 12, marginTop: 6 }}>{error}</div>}
      {img && <Lightbox src={img} onClose={() => setImg(null)} />}
      {vid && <VideoViewer src={vid} onClose={() => setVid(null)} />}
    </div>
  );
}

// `branch` limits which approved devices get the alert: omit it to use the signer's own branch, pass null for everyone.
// Set by a notification click: OrderDetail scrolls to its activity log when it opens (edits / status changes).
const openFocus = { current: null };

// `target` ({ type: "order" | "customer" | "model", id }) is what clicking the notification opens.
// `opts.internal` makes it a production-only notification: Sales can't read it and it's never pushed to shared devices.
async function notify(session, message, type, branch, target, opts) {
  try {
    const internal = !!(opts && opts.internal);
    const row = {
      message, type, created_by: session.name, branch: (branch !== undefined ? branch : session.branch) || null,
      target_type: target ? target.type : null, target_id: target ? String(target.id) : null,
      internal, hide_from_production: !!(opts && opts.hideFromProduction),
    };
    // Production-only notifications aren't pushed anywhere, so there is nothing to read back — and the person sending one
    // (e.g. Sales accepting a delivery) isn't allowed to read it, which would make a "return the new row" insert fail.
    if (internal) { await supabase.from("notifications").insert(row); return; }
    const { data } = await supabase.from("notifications").insert(row).select("id").single();
    if (data) {
      supabase.functions.invoke("push-service", {
        body: { action: "notify", notification_id: data.id, exclude_device_token: localStorage.getItem(DEVICE_KEY) || undefined },
      });   // fire and forget; the device that made the change is skipped
    }
  } catch (e) { /* non-critical, ignore */ }
}

const INTERNAL_STATUSES = ["material_assigned", "manpower_planned", "job_in_process", "job_pending_qc", "job_rework"];

// Move an order to a new status. `files` (optional) are attached to the history entry (used for rejections).
async function advanceOrder(session, order, toStatus, comment, extra, files, opts) {
  const label = STATUS[toStatus].label;
  const note = comment ? `${label}: ${comment}` : label;
  const entry = { at: new Date().toISOString(), by: session.name, note };
  if (toStatus === "job_accepted") { entry.internal = false; entry.public_note = STATUS.public_in_process.label; }
  else if (INTERNAL_STATUSES.includes(toStatus)) entry.internal = true;
  if (files && files.length) entry.attachments = files;
  const history = [...(order.history || []), entry];
  const { error } = await supabase.from("job_orders").update({ status: toStatus, history, updated_at: new Date().toISOString(), ...(extra || {}) }).eq("id", order.id);
  if (!error) {
    const internal = INTERNAL_STATUSES.includes(toStatus);
    const shown = toStatus === "job_accepted" ? STATUS.public_in_process.label : label;
    // no customer names in notifications — order number and model only
    // `silent` is used when one delivery moves several pieces: the delivery sends ONE notification instead of one per piece
    const hideProd = ["store_received", "ready_in_stores", "delivery_assigned", "delivered"].includes(toStatus);   // the showroom side stays out of Production's feed
    if (!(opts && opts.silent)) notify(session, `${session.name}: ${shown} — order ${order.jobOrderNo} (${order.model})${comment ? " — " + comment : ""}`, "status", order.branch, { type: "order", id: order.id }, { internal, hideFromProduction: hideProd });
  }
  return { error };
}

async function startTailoring(session, order) {
  const now = new Date().toISOString();
  await supabase.from("job_order_tailors").update({ started_at: now }).eq("job_order_id", order.id).is("started_at", null);
  return advanceOrder(session, order, "job_in_process", null, { production_started_at: now });
}

// Production sends a piece back, or a store does: a list of points, each with a comment and optional photos
async function raiseRework(session, order, source, points, comment) {
  const { data: all } = await supabase.from("job_order_rework").select("round").eq("job_order_id", order.id);
  const round = (all || []).reduce((m, r) => Math.max(m, r.round), 0) + 1;
  const clean = points.filter((p) => p.text.trim()).map((p, i) => ({
    id: "p" + (i + 1), text: p.text.trim(), files: p.files || [], fixed: false, fixed_at: null, fixed_by: null, response: "", response_files: [],
  }));
  const { data, error } = await supabase.from("job_order_rework")
    .insert({ job_order_id: order.id, round, source, branch: order.branch, raised_by: session.name, comment: comment || null, points: clean }).select().single();
  return { rework: data, error };
}

// Back to the tailors after a failed quality check
async function startRework(session, order) {
  const { data: rw } = await supabase.from("job_order_rework").select("id").eq("job_order_id", order.id).eq("status", "open").order("round", { ascending: false }).limit(1);
  if (rw && rw[0]) await supabase.from("job_order_rework").update({ status: "in_progress", started_at: new Date().toISOString(), started_by: session.name }).eq("id", rw[0].id);
  return advanceOrder(session, order, "job_in_process", "Rework started", { production_completed_at: null });
}

// the check list for the quality check that follows a rework: ONLY the points that were sent back
function buildReworkChecks(rework) {
  return (rework.points || []).map((p) => ({
    key: "rw-" + p.id, group: "Rework points", label: p.text,
    detail: (p.fixed ? `Fixed by ${p.fixed_by}${p.response ? ": " + p.response : ""}` : "") + (rework.verified_by ? ` · passed Production's check (${rework.verified_by})` : ""), ok: false, at: null, by: null,
  }));
}

// The checklist for one order: the standard checks + this order's own requirements + its measurements.
// It's saved as a snapshot, so later changes to the standard list never alter a check already done.
function buildQcChecks(order, standard) {
  const checks = [];
  const add = (group, key, label) => checks.push({ key, group, label, ok: false, at: null, by: null });
  (standard || []).forEach((s) => add("Standard checks", "s-" + s.id, s.label));
  add("This order's requirements", "model", `Model ${order.model}${order.cut ? " · cut " + order.cut : ""} is as ordered`);
  if (order.color) add("This order's requirements", "color", `Colour: ${order.color}`);
  if (order.abayaOption) {
    const opt = normAbaya(order.abayaOption);
    add("This order's requirements", "abaya", `Abaya option: ${abayaLabel(opt)}${opt === BUTTON_RANGE ? ` (${order.buttonFrom || "—"} to ${order.buttonTill || "—"})` : ""}`);
  }
  (order.additionalRequirements || "").split(",").map((t) => t.trim()).filter(Boolean)
    .forEach((t, i) => add("This order's requirements", "req-" + i, `Additional requirement: ${t}`));
  if ((order.comments || "").trim()) add("This order's requirements", "notes", `Notes followed: ${order.comments.trim().slice(0, 140)}`);
  ALL_MEASURE_FIELDS.filter(([k]) => order.measurements && order.measurements[k])
    .forEach(([k, l]) => add("Measurements", "m-" + k, `${l}: ${order.measurements[k]}`));
  return checks;
}

// Stop the clock: close the tailors' work and move the order to Pending Quality Check
async function completeProduction(session, order) {
  const now = new Date().toISOString();
  await supabase.from("job_order_tailors").update({ finished_at: now }).eq("job_order_id", order.id).is("finished_at", null);
  return advanceOrder(session, order, "job_pending_qc", null, { production_completed_at: now });
}

const fmtDuration = (ms) => {
  if (ms == null || ms < 0) return "—";
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return [d ? d + "d" : "", h ? h + "h" : "", (m % 60) + "m"].filter(Boolean).join(" ");
};
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");

// Switches on the compact print layout, measures the page, and shrinks it just enough to fit one A4 sheet.
function usePrintFit(ref) {
  useEffect(() => {
    const PAGE_W = (194 / 25.4) * 96;     // printable width  (A4 210mm minus 8mm margins), in CSS pixels
    const PAGE_H = (279 / 25.4) * 96;     // printable height (A4 297mm minus 8mm margins and a little spare)
    const before = () => {
      const el = ref.current;
      if (!el) return;
      document.documentElement.classList.add("print-compact");
      el.style.setProperty("--print-zoom", "1");
      el.style.width = PAGE_W + "px";
      const h = el.scrollHeight;                              // height with the compact layout at paper width
      const z = Math.max(0.5, Math.min(1, PAGE_H / h));
      el.style.setProperty("--print-zoom", String(z));
      el.style.width = PAGE_W / z + "px";                     // after shrinking, use the full paper width
    };
    const after = () => {
      const el = ref.current;
      document.documentElement.classList.remove("print-compact");
      if (el) { el.style.removeProperty("--print-zoom"); el.style.width = ""; }
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []); // eslint-disable-line
}

function ModelPeek({ order, models }) {
  const [open, setOpen] = useState(false);
  const model = (models || []).find((m) => m.modelNo === order.model);
  if (!model) return <span>{order.model}</span>;
  return (
    <>
      <span onClick={() => setOpen(true)} title="Tap to see the picture" style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "zoom-in" }}>
        <ModelThumb model={model} size={48} style={{ borderRadius: 4 }} />
        <span style={{ color: "#3B6FA0", fontWeight: 700, textDecoration: "underline" }}>{order.model}</span>
      </span>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, padding: 16 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>{order.model}{model.styleName ? ` — ${model.styleName}` : ""}</div>
          <div onClick={(e) => e.stopPropagation()}><ModelThumb model={model} width={380} height={520} fit="contain" /></div>
          <div style={{ color: "#ccc", fontSize: 12 }}>Tap anywhere to close</div>
        </div>
      )}
    </>
  );
}

function FullOrderButton({ onClick }) {
  return (
    <button onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F4F8FC", border: "1.5px solid #3B6FA0", color: "#2F5F8F", borderRadius: 10, padding: "13px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
      <span>📄 View full job order</span><span style={{ fontSize: 18 }}>›</span>
    </button>
  );
}

function NotificationBell({ session, notifications, refreshNotifications, onOpen, onViewAll }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = React.useRef(null);
  const [dismissed, setDismissed] = useState(new Set());
  const [clearedOverride, setClearedOverride] = useState(null);
  const [lastSeenOverride, setLastSeenOverride] = useState(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);   // iPad
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onOutside); document.removeEventListener("touchstart", onOutside); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  useEffect(() => {
    supabase.from("notification_dismissals").select("notification_id").then(({ data }) => setDismissed(new Set((data || []).map((d) => d.notification_id))));
  }, [session.id]);

  const clearedAt = clearedOverride || (session.notifications_cleared_at ? new Date(session.notifications_cleared_at) : new Date(0));
  const visible = notifications.filter((n) => new Date(n.created_at) > clearedAt && !dismissed.has(n.id));
  const lastSeen = lastSeenOverride || (session.notifications_last_seen_at ? new Date(session.notifications_last_seen_at) : new Date(0));
  const unread = visible.filter((n) => new Date(n.created_at) > lastSeen).length;

  const toggle = async () => {
    const opening = !open;
    setOpen(opening);
    if (opening) {
      const now = new Date().toISOString();
      setLastSeenOverride(new Date(now));
      await supabase.from("profiles").update({ notifications_last_seen_at: now }).eq("id", session.id);
      await refreshNotifications();
    }
  };
  const dismiss = async (n) => {
    setDismissed((s) => new Set([...s, n.id]));
    await supabase.from("notification_dismissals").insert({ user_id: session.id, notification_id: n.id });
  };
  const clearAll = async () => {
    const now = new Date();
    setClearedOverride(now);
    await supabase.from("profiles").update({ notifications_cleared_at: now.toISOString() }).eq("id", session.id);
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-block" }}>
      <span onClick={toggle} style={{ cursor: "pointer", position: "relative", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
        <span style={{ position: "relative", fontSize: 15 }}>
          🔔
          {unread > 0 && (
            <span style={{ position: "absolute", top: -7, right: -9, background: "#C1302B", color: "#fff", borderRadius: 10, fontSize: 9, padding: "1px 5px", fontWeight: 700, lineHeight: 1.3 }}>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        <span>Notifications</span>
      </span>
      {open && (
        <div className="no-print" style={{ position: "absolute", top: 26, right: 0, width: 330, maxHeight: 440, overflowY: "auto", background: "#fff", border: "1px solid #C9CDD3", borderRadius: 6, boxShadow: "0 10px 28px rgba(0,0,0,0.14)", zIndex: 200, padding: 12, textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.03em" }}>RECENT ACTIVITY</div>
            {visible.length > 0 && <a className="link" style={{ fontSize: 12, color: "#C1302B" }} onClick={clearAll}>Clear all</a>}
          </div>
          {visible.length === 0 ? <div style={{ fontSize: 12, color: "#8a8a8a", padding: "6px 0" }}>You're all caught up.</div> : visible.slice(0, 20).map((n) => (
            <div key={n.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", borderBottom: "1px solid #E5E5E5" }}>
              <div onClick={() => { setOpen(false); onOpen && onOpen(n); }} style={{ flex: 1, fontSize: 12, padding: "8px 6px", cursor: "pointer", borderRadius: 3 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#F2F2F2")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <div>{n.message}</div>
                <div className="mono" style={{ fontSize: 10.5, color: "#8a8a8a", marginTop: 2 }}>{fmtDateTime(n.created_at)}</div>
              </div>
              <span title="Clear this one" onClick={() => dismiss(n)} style={{ cursor: "pointer", color: "#9aa0a8", fontSize: 16, padding: "6px 4px" }}>×</span>
            </div>
          ))}
          <div style={{ textAlign: "center", paddingTop: 10 }}><a className="link" style={{ fontSize: 12.5 }} onClick={() => { setOpen(false); onViewAll && onViewAll(); }}>View all notifications →</a></div>
        </div>
      )}
    </div>
  );
}

const NOTE_TYPES = { status: "Status changes", job_order: "New job orders", edit: "Edits", delete: "Deletions", delivery: "Deliveries", profile: "Customers", requirement: "Requirements", model: "Models", project: "Projects" };

function NotificationsPage({ orders, session, onOpen }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [view, setView] = useState("date");        // "date" | "order"
  const [range, setRange] = useState("7");         // "1" | "7" | "30" | "all" | "custom"
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [openGroups, setOpenGroups] = useState({});
  const PAGE = 300;

  const since = (days) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (days - 1)); return d.toISOString(); };
  const load = async (append) => {
    setLoading(true);
    let query = supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(PAGE + 1);
    if (range === "1" || range === "7" || range === "30") query = query.gte("created_at", since(parseInt(range, 10)));
    if (range === "custom") {
      if (from) query = query.gte("created_at", new Date(from + "T00:00:00").toISOString());
      if (to) query = query.lte("created_at", new Date(to + "T23:59:59").toISOString());
    }
    if (append && rows.length) query = query.lt("created_at", rows[rows.length - 1].created_at);
    const { data } = await query;
    const list = data || [];
    setMore(list.length > PAGE);
    setRows(append ? [...rows, ...list.slice(0, PAGE)] : list.slice(0, PAGE));
    setLoading(false);
  };
  useEffect(() => { load(false); }, [range, from, to]); // eslint-disable-line
  useEffect(() => { if (!loading) load(false); }, [orders]); // eslint-disable-line   (new activity shows up by itself)

  const orderOf = (n) => (n.target_type === "order" ? orders.find((o) => o.id === n.target_id) : null);
  const needle = q.trim().toLowerCase();
  const list = rows.filter((n) => {
    if (type !== "all" && n.type !== type) return false;
    if (!needle) return true;
    const o = orderOf(n);
    return (n.message || "").toLowerCase().includes(needle) || (o && String(o.jobOrderNo).toLowerCase().includes(needle)) || (n.created_by || "").toLowerCase().includes(needle);
  });

  const dayLabel = (iso) => {
    const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };
  const byDate = [];
  list.forEach((n) => { const k = dayLabel(n.created_at); const last = byDate[byDate.length - 1]; if (last && last.k === k) last.items.push(n); else byDate.push({ k, items: [n] }); });

  const groups = {};
  list.forEach((n) => { const k = n.target_type === "order" ? n.target_id : "other"; (groups[k] = groups[k] || []).push(n); });
  const byOrder = Object.entries(groups)
    .map(([k, items]) => ({ k, order: k === "other" ? null : orders.find((o) => o.id === k), items }))
    .sort((a, b) => new Date(b.items[0].created_at) - new Date(a.items[0].created_at));

  const types = Array.from(new Set(rows.map((r) => r.type).filter(Boolean)));
  const pill = (on) => ({ padding: "6px 16px", fontSize: 12.5, borderRadius: 14, cursor: "pointer", border: "1px solid " + (on ? "#1A1A1A" : "#DDE1E7"), background: on ? "#1A1A1A" : "#fff", color: on ? "#fff" : "#1A1A1A" });
  const Item = ({ n }) => (
    <div onClick={() => onOpen && onOpen(n)} style={{ display: "flex", gap: 12, padding: "9px 6px", borderBottom: "1px solid #F0F0F0", cursor: "pointer", alignItems: "baseline" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#F7F7F5")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
      <span className="mono" style={{ fontSize: 11.5, color: "#8a8a8a", minWidth: 64 }}>{new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      <span style={{ flex: 1, fontSize: 13.5 }}>{n.message}</span>
      <span style={{ fontSize: 11, color: "#8a8a8a", whiteSpace: "nowrap" }}>{NOTE_TYPES[n.type] || n.type}</span>
    </div>
  );

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 6 }}>NOTIFICATIONS</h2>
      <div style={{ textAlign: "center", fontSize: 12, color: "#8a8a8a", marginBottom: 16 }}>The full record of what has happened, as far as it concerns you. Clearing the bell never removes anything from here.</div>

      <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button style={pill(view === "date")} onClick={() => setView("date")}>By date</button>
        <button style={pill(view === "order")} onClick={() => setView("order")}>By job order</button>
      </div>
      <div className="no-print" style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select value={range} onChange={(e) => setRange(e.target.value)} style={{ ...inputStyle, width: 150 }}>
          <option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option><option value="custom">Pick dates…</option>
        </select>
        {range === "custom" && (<><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...inputStyle, width: 150 }} /><span>to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...inputStyle, width: 150 }} /></>)}
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle, width: 170 }}>
          <option value="all">All kinds</option>{types.map((t) => <option key={t} value={t}>{NOTE_TYPES[t] || t}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order no, person, words…" style={{ ...inputStyle, width: 240 }} />
      </div>

      <div style={{ fontSize: 12, color: "#8a8a8a", marginBottom: 8 }}>{loading ? "Loading…" : `${list.length} notification${list.length === 1 ? "" : "s"}`}</div>

      {!loading && list.length === 0 && <div style={{ textAlign: "center", color: "#8a8a8a", padding: 40, fontSize: 14 }}>Nothing in this period.</div>}

      {view === "date" && byDate.map((g) => (
        <div key={g.k} style={{ marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 13, padding: "6px 6px", background: "#F4F5F7", borderRadius: 4, marginBottom: 4 }}>{g.k} <span style={{ color: "#8a8a8a", fontWeight: 400 }}>· {g.items.length}</span></div>
          {g.items.map((n) => <Item key={n.id} n={n} />)}
        </div>
      ))}

      {view === "order" && byOrder.map((g) => {
        const isOpen = openGroups[g.k] !== undefined ? openGroups[g.k] : false;
        return (
          <div key={g.k} style={{ border: "1px solid #E1E5EA", borderRadius: 8, marginBottom: 10 }}>
            <div onClick={() => setOpenGroups((s) => ({ ...s, [g.k]: !isOpen }))} style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 14px", cursor: "pointer", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#8a8a8a" }}>{isOpen ? "▾" : "▸"}</span>
              {g.k === "other" ? <strong>Other activity (not about one order)</strong> : (
                <>
                  <span className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{g.order ? g.order.jobOrderNo : "Removed order"}</span>
                  {g.order && <span style={{ fontSize: 13, color: "#5a5a5a" }}>{g.order.model}{g.order.color ? ` · ${g.order.color}` : ""}</span>}
                  {g.order && <StatusTag status={g.order.status} />}
                </>
              )}
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#8a8a8a" }}>{g.items.length} update{g.items.length === 1 ? "" : "s"} · last {fmtDateTime(g.items[0].created_at)}</span>
            </div>
            {isOpen && (
              <div style={{ padding: "0 14px 8px", borderTop: "1px solid #F0F0F0" }}>
                {[...g.items].reverse().map((n) => (
                  <div key={n.id} onClick={() => onOpen && onOpen(n)} style={{ display: "flex", gap: 12, padding: "8px 4px", borderBottom: "1px solid #F7F7F7", cursor: "pointer", alignItems: "baseline" }}>
                    <span className="mono" style={{ fontSize: 11.5, color: "#8a8a8a", minWidth: 130 }}>{fmtDateTime(n.created_at)}</span>
                    <span style={{ flex: 1, fontSize: 13.5 }}>{n.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {more && <div style={{ textAlign: "center", marginTop: 16 }}><button onClick={() => load(true)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "9px 22px", fontWeight: 700 }}>Load older notifications</button></div>}
    </div>
  );
}

function DashboardMenu({ session, setSubpage, onLogout, onLock, tasks }) {
  const [open, setOpen] = useState(false);
  const total = Object.values(tasks || {}).reduce((sum, t) => sum + t.count, 0);
  const wrapperRef = React.useRef(null);
  const cards = ROLE_HOME_CARDS[session.role] || [];

  useEffect(() => {
    const onClickOutside = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const go = (target) => { setSubpage(target); setOpen(false); };

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "7px 16px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.03em", cursor: "pointer" }}>
        DASHBOARD ▾{total > 0 && <span style={{ marginLeft: 8, background: "#C1302B", color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>{total}</span>}
      </button>
      {open && (
        <div className="no-print" style={{ position: "absolute", top: 34, right: 0, minWidth: 210, background: "#fff", border: "1px solid #C9CDD3", borderRadius: 6, boxShadow: "0 10px 28px rgba(0,0,0,0.14)", zIndex: 200, padding: 6, textAlign: "left" }}>
          <div onClick={() => go("home")} style={{ padding: "8px 10px", fontSize: 12.5, cursor: "pointer", borderRadius: 4 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#F2F2F2")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            🏠 Dashboard Home
          </div>
          <div style={{ borderTop: "1px solid #E5E5E5", margin: "4px 0" }} />
          {cards.map(([icon, title, desc, target]) => (
            <div key={target} onClick={() => go(target)} style={{ padding: "8px 10px", fontSize: 12.5, cursor: "pointer", borderRadius: 4 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#F2F2F2")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              {icon} {title}
              {tasks && tasks[target] && tasks[target].count > 0 && <span style={{ float: "right", background: "#C1302B", color: "#fff", borderRadius: 10, padding: "0 7px", fontSize: 11, fontWeight: 700 }}>{tasks[target].count}</span>}
            </div>
          ))}
          <div style={{ borderTop: "1px solid #E5E5E5", margin: "4px 0" }} />
          {localStorage.getItem(DEVICE_KEY) && (
            <>
              {session.role === "sales" && (
                <div onClick={() => { setOpen(false); onLock && onLock(); }} style={{ padding: "8px 10px", fontSize: 12.5, cursor: "pointer", borderRadius: 4 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F2F2F2")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>🔒 Lock now</div>
              )}
              <div onClick={async () => { setOpen(false); const r = await enableAlerts(); window.alert(r.ok ? "Lock-screen alerts are on for this device." : alertMsg(r.error)); }}
                style={{ padding: "8px 10px", fontSize: 12.5, cursor: "pointer", borderRadius: 4 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#F2F2F2")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>🔔 Turn on lock-screen alerts</div>
              <div onClick={() => { setOpen(false); onLogout(); }} style={{ padding: "8px 10px", fontSize: 12.5, cursor: "pointer", borderRadius: 4 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#F2F2F2")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                🔁 Switch user
              </div>
            </>
          )}
          <div onClick={() => { setOpen(false); onLogout(); }} style={{ padding: "8px 10px", fontSize: 12.5, cursor: "pointer", borderRadius: 4, color: "#C1302B" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#F2F2F2")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            Logout
          </div>
        </div>
      )}
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

function ModelThumb({ model, size, width, height, fit, style }) {
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
    <div style={{ width: width || s, height: height || s, background: "#F2F2F2", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, ...style }}>
      {url ? <img src={url} alt={model?.modelNo || ""} style={{ width: "100%", height: "100%", objectFit: fit || "cover" }} /> : <span style={{ fontSize: 10, color: "#8a8a8a" }}>No photo</span>}
    </div>
  );
}

/* ---------------- db <-> app field mapping ---------------- */

function dbToOrder(r) {
  return {
    id: r.id, invoiceNo: r.invoice_no, jobOrderNo: r.job_order_no, name: r.name, mobile: r.mobile, orderType: r.order_type,
    model: r.model, item: r.item, preparedBy: r.prepared_by, branch: r.branch,
    measurements: r.measurements || {}, sheilaType: r.sheila_type, abayaOption: r.abaya_option,
    buttonFrom: r.button_from, buttonTill: r.button_till, additionalRequirements: r.additional_requirements, attachments: r.attachments || [], color: r.color, colorSwatch: r.color_swatch, deliveryDate: r.delivery_date, attachmentUrl: r.attachment_url,
    comments: r.comments, status: r.status, history: r.history || [],
    createdAt: r.created_at, updatedAt: r.updated_at, cut: r.cut,
    acceptedAt: r.accepted_at, acceptedBy: r.accepted_by,
    productionStartedAt: r.production_started_at, productionCompletedAt: r.production_completed_at,
  };
}
function orderFieldsToDb(f) {
  const map = {
    invoiceNo: "invoice_no", orderType: "order_type", preparedBy: "prepared_by", sheilaType: "sheila_type",
    abayaOption: "abaya_option", buttonFrom: "button_from", buttonTill: "button_till", deliveryDate: "delivery_date",
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
    cuttingFormula: r.cutting_formula || {},
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

// Accept / Reject / Assign / Complete now live in ProductionActions; only the old return-and-rework steps remain here.
function productionActions(status) {
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
  const [subpage, setSubpage] = useState("home");
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => { if (subpage !== "records" && subpage !== "viewOrder") setSelectedId(null); }, [subpage]);
  const [toast, setToast] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const lastSeenNotifId = React.useRef(null);
  const [openRequest, setOpenRequest] = useState(null);       // { type, id, focus }
  const clearOpenRequest = useCallback(() => setOpenRequest(null), []);

  const onTrustedDevice = !!localStorage.getItem(DEVICE_KEY);
  const [locked, setLocked] = useState(() => !!localStorage.getItem(DEVICE_KEY) && localStorage.getItem("ml_locked") === "1");
  const [idleMin, setIdleMin] = useState(() => parseInt(localStorage.getItem("ml_idle_min") || "2", 10));
  const lock = useCallback(() => { localStorage.setItem("ml_locked", "1"); setLocked(true); }, []);
  const unlock = useCallback(() => { localStorage.removeItem("ml_locked"); setLocked(false); }, []);

  const flash =(msg) => { setToast(msg); window.clearTimeout(flash._t); flash._t = window.setTimeout(() => setToast(null), 2400); };

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
        setSubpage("home");
      });
  }, [session?.user?.id]);

  // Re-reads all the data and swaps it in quietly (no loading screen, no page state reset). Quick repeat calls are
  // coalesced so an older response can never overwrite a newer one, and a failed read (e.g. a dropped connection)
  // never replaces data that is already on screen.
  const loadState = React.useRef({ running: null, again: false, loadedOnce: false });
  const doLoad = useCallback(async () => {
    const results = await Promise.all([
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
    if (results.some((r) => r.error) && loadState.current.loadedOnce) return;
    const [{ data: branches }, { data: salespersons }, { data: models }, { data: ords }, { data: profs }, { data: reqItems }, { data: projs }, { data: collabs }, { data: users }, { data: tasks }, { data: projModels }] = results;
    loadState.current.loadedOnce = true;
    setConfig({ branches: branches || [], salespersons: salespersons || [], models: (models || []).map(dbToModel) });
    setOrders((ords || []).map(dbToOrder));
    setProfiles((profs || []).map((p) => ({ ...p, createdAt: p.created_at, updatedAt: p.updated_at })));
    setRequirementItems((reqItems || []).map((r) => ({
      id: r.id, profileId: r.profile_id, model: r.model, recommendedSize: r.recommended_size,
      deltas: r.deltas, notes: r.notes, jobOrderId: r.job_order_id, createdAt: r.created_at,
      calculated: r.calculated || {}, cut: r.cut,
      abayaOption: r.abaya_option, buttonFrom: r.button_from, buttonTill: r.button_till,
      additionalRequirements: r.additional_requirements, attachments: r.attachments || [],
      color: r.color, colorSwatch: r.color_swatch,
    })));
    setProjects(projs || []);
    setProjectCollaborators(collabs || []);
    setAllUsers(users || []);
    setProjectTasks(tasks || []);
    setProjectModels(projModels || []);
  }, []);
  const loadAll = useCallback(() => {
    const st = loadState.current;
    if (st.running) { st.again = true; return st.running; }   // a read is already going: run once more after it, so this call sees the latest data
    st.running = (async () => {
      try { do { st.again = false; await doLoad(); } while (st.again); }
      finally { st.running = null; }
    })();
    return st.running;
  }, [doLoad]);

  useEffect(() => { if (profile && profile.role !== "driver") loadAll(); }, [profile, loadAll]);

  const loadNotifications = useCallback(async () => {
    const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);
    const newest = data && data[0];
    if (newest && lastSeenNotifId.current && newest.id !== lastSeenNotifId.current && newest.created_by !== profile?.name) playChime();
    if (newest) lastSeenNotifId.current = newest.id;
    setNotifications(data || []);
  }, [profile?.name]);

  useEffect(() => {
    if (!profile || profile.role === "driver") return;
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [profile, loadNotifications]);

  // Live updates: refresh a moment after anyone changes something.
  useEffect(() => {
    if (!profile || profile.role === "driver") return;
    let timer = null;
    let lastRun = 0;
    const run = () => { lastRun = Date.now(); loadAll(); loadNotifications(); };
    const refreshSoon = () => {                       // bunch quick changes together; never more than once every 2.5 s
      clearTimeout(timer);
      const wait = Math.max(600, 2500 - (Date.now() - lastRun));
      timer = setTimeout(run, wait);
    };

    const channel = supabase.channel("live-data");
    ["job_orders", "requirement_items", "customer_profiles", "models", "branches"].forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refreshSoon);
    });
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => loadNotifications());   // bell + chime straight away
    channel.subscribe();

    // iPads drop the connection while asleep: catch up the moment the screen wakes, and as a safety net every 2 minutes
    const onVisible = () => { if (document.visibilityState === "visible") refreshSoon(); };
    document.addEventListener("visibilitychange", onVisible);
    const safety = setInterval(refreshSoon, 120000);

    return () => { clearTimeout(timer); clearInterval(safety); document.removeEventListener("visibilitychange", onVisible); supabase.removeChannel(channel); };
  }, [profile?.id]); // eslint-disable-line

  // Read this device's settings once signed in; register the service worker; keep the push subscription fresh.
  useEffect(() => {
    const token = localStorage.getItem(DEVICE_KEY);
    if (!profile || !token) return;
    pushService({ action: "info", device_token: token }).then(({ data, error }) => {
      if (error === "untrusted_device") { localStorage.removeItem(DEVICE_KEY); return; }
      if (data) { setIdleMin(data.idle_minutes); localStorage.setItem("ml_idle_min", String(data.idle_minutes)); }
    });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    if ("Notification" in window && Notification.permission === "granted" && !(isIOS() && !isStandalone())) enableAlerts();
  }, [profile?.id]); // eslint-disable-line

  useEffect(() => { const h = () => unlockAudio(); window.addEventListener("pointerdown", h); return () => window.removeEventListener("pointerdown", h); }, []);

  // Only Sales auto-locks (they unlock with a PIN); Production, Admin and Model Manager never lock.
  useIdleLock(!!profile && onTrustedDevice && !locked && idleMin > 0 && profile.role === "sales", idleMin, lock);

  // A non-Sales user can never be stuck behind a lock flag left over on the device.
  useEffect(() => {
    if (profile && profile.role !== "sales" && localStorage.getItem("ml_locked") === "1") { localStorage.removeItem("ml_locked"); setLocked(false); }
  }, [profile?.role]); // eslint-disable-line

  // The red numbers on the dashboard tiles: what is still waiting for this person
  const [sentNotes, setSentNotes] = useState(0);
  useEffect(() => {
    if (!profile || (profile.role !== "sales" && profile.role !== "admin")) return;
    supabase.from("delivery_notes").select("id", { count: "exact", head: true }).eq("status", "sent").then(({ count }) => setSentNotes(count || 0));
  }, [profile?.id, orders]); // eslint-disable-line   (the database only lets a showroom see its own branch's notes)
  const tasks = useMemo(() => computeTasks(profile, orders, sentNotes), [profile, orders, sentNotes]);

  // Which page can each role use for each kind of target?
  const openTarget = useCallback(async (type, id, focus) => {
    if (!profile) return;
    const role = profile.role;
    if (type === "order" && role !== "model_manager") {
      await loadAll();                                          // the order may have just been created by someone else
      setSubpage("records");
    } else if (type === "customer" && (role === "sales" || role === "admin")) {
      setSubpage("customers");
    } else if (type === "model" && (role === "admin" || role === "model_manager")) {
      await loadAll();
      setSubpage("viewmodels");
    } else if (type === "model" && role === "production") {
      await loadAll();
      setSubpage("items");
    } else if (type === "delivery" && (role === "production" || role === "admin")) {
      setSubpage("deliveries");
    } else if (type === "delivery" && role === "sales") {
      setSubpage("incoming");
    } else if (type === "cdelivery" && (role === "sales" || role === "admin")) {
      setSubpage("custdeliveries");
    } else {
      return;                                                   // this role has no page for it — do nothing
    }
    setOpenRequest({ type, id, focus });
  }, [profile, loadAll]);

  // A banner tapped on the lock screen arrives either as a link (?open=order:123) or as a message from the service worker.
  const handleOpenUrl = useCallback((url) => {
    try {
      const p = new URL(url, window.location.origin).searchParams.get("open");
      if (!p) return;
      const [type, ...rest] = p.split(":");
      openTarget(type, decodeURIComponent(rest.join(":")), "history");
      window.history.replaceState({}, "", "/");
    } catch (e) { /* ignore */ }
  }, [openTarget]);

  useEffect(() => { if (profile && config) handleOpenUrl(window.location.href); }, [profile?.id, !!config]); // eslint-disable-line
  useEffect(() => {
    if (!navigator.serviceWorker) return;
    const onMsg = (e) => { if (e.data && e.data.type === "open") handleOpenUrl(e.data.url); };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [handleOpenUrl]);

  // The lock screen is an overlay on top of the app, so the form underneath keeps its state.
  const withLock = (node) => (
    <>
      {node}
      {profile && locked && onTrustedDevice && profile.role === "sales" && <LockScreen profile={profile} onUnlock={unlock} />}
    </>
  );

  setViewerRole(profile ? profile.role : null);

  if (session === undefined) return <Loading text="Loading…" />;
  if (!session) return <LoginGate />;
  if (profile === null) return <NoProfileScreen onSignOut={() => supabase.auth.signOut()} />;
  if (profile.role === "driver") return <DriverApp profile={profile} onLogout={() => supabase.auth.signOut()} />;
  if (!config || !orders || !profiles || !requirementItems || !projects || !projectCollaborators || !allUsers || !projectTasks || !projectModels) return withLock(<Loading text="Loading job orders…" />);

  const refresh = loadAll;

  // Called when someone clicks a notification in the bell.
  const openFromNotification = (n) => {
    let type = n.target_type, id = n.target_id;
    if (!type) {                                               // older notifications: work it out from "…order 1042…"
      const m = /order\s+([A-Za-z0-9-]+)/i.exec(n.message || "");
      const found = m && orders.find((o) => String(o.jobOrderNo) === m[1]);
      if (found) { type = "order"; id = found.id; }
    }
    if (!type) return;
    openTarget(type, id, (n.type === "edit" || n.type === "status") ? "history" : null);
  };

  return withLock(
    <Shell session={profile} subpage={subpage} setSubpage={setSubpage} onLogout={() => supabase.auth.signOut()} onLock={lock} notifications={notifications} refreshNotifications={loadNotifications} onOpenNotification={openFromNotification} tasks={tasks}>
      {subpage === "home" && <HomePage session={profile} setSubpage={setSubpage} tasks={tasks} />}
      {subpage === "projects" && (
        PROJECTS_ENABLED
          ? <ProjectsPage projects={projects} collaborators={projectCollaborators} allUsers={allUsers} session={profile} refresh={refresh} flash={flash} tasks={projectTasks} projectModels={projectModels} models={config.models} />
          : <ProjectsUnderConstruction />
      )}
      {subpage === "analytics" && (profile.role === "admin" || profile.role === "model_manager") && (
        <AnalyticsPage orders={orders} models={config.models} />
      )}
      {subpage === "calendar" && (profile.role === "production" || profile.role === "admin") && (
        <ProductionCalendar orders={orders} models={config.models} session={profile} refresh={refresh} flash={flash} onOpenOrder={(id) => openTarget("order", id)} />
      )}
      {subpage === "deliveries" && (profile.role === "production" || profile.role === "admin") && (
        <DeliveryNotesPage orders={orders} session={profile} refresh={refresh} flash={flash} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />
      )}
      {subpage === "incoming" && (profile.role === "sales" || profile.role === "admin") && (
        <IncomingDeliveriesPage orders={orders} session={profile} refresh={refresh} flash={flash} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />
      )}
      {subpage === "qcqueue" && (profile.role === "production" || profile.role === "admin") && (
        <QcQueuePage orders={orders} session={profile} refresh={refresh} flash={flash} onOpenOrder={(id) => openTarget("order", id)} />
      )}
      {subpage === "qcsetup" && profile.role === "admin" && <QcSetupPage flash={flash} />}
      {subpage === "notifications" && <NotificationsPage orders={orders} session={profile} onOpen={openFromNotification} />}
      {subpage === "custdeliveries" && (profile.role === "sales" || profile.role === "admin") && (
        <CustomerDeliveriesPage orders={orders} models={config.models} session={profile} refresh={refresh} flash={flash} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />
      )}
      {subpage === "pins" && profile.role === "admin" && (
        <PinsPage users={allUsers} branches={config.branches.map((b) => b.name)} session={profile} />
      )}
      {subpage !== "home" && subpage !== "projects" && subpage !== "analytics" && subpage !== "pins" && subpage !== "calendar" && subpage !== "qcqueue" && subpage !== "qcsetup" && subpage !== "deliveries" && subpage !== "incoming" && subpage !== "notifications" && subpage !== "custdeliveries" && profile.role === "sales" && (
        <SalesPanel config={config} orders={orders} profiles={profiles} requirementItems={requirementItems} refresh={refresh} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />
      )}
      {subpage !== "home" && subpage !== "projects" && subpage !== "analytics" && subpage !== "pins" && subpage !== "calendar" && subpage !== "qcqueue" && subpage !== "qcsetup" && subpage !== "deliveries" && subpage !== "incoming" && subpage !== "notifications" && subpage !== "custdeliveries" && profile.role === "production" && (
        <ProductionPanel config={config} orders={orders} profiles={profiles} requirementItems={requirementItems} refresh={refresh} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />
      )}
      {subpage !== "home" && subpage !== "projects" && subpage !== "analytics" && subpage !== "pins" && subpage !== "calendar" && subpage !== "qcqueue" && subpage !== "qcsetup" && subpage !== "deliveries" && subpage !== "incoming" && subpage !== "notifications" && subpage !== "custdeliveries" && profile.role === "admin" && (
        <AdminPanel config={config} refresh={refresh} orders={orders} profiles={profiles} requirementItems={requirementItems} session={profile}
          subpage={subpage} setSubpage={setSubpage} selectedId={selectedId} setSelectedId={setSelectedId} flash={flash} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />
      )}
      {subpage !== "home" && subpage !== "projects" && subpage !== "analytics" && subpage !== "pins" && subpage !== "calendar" && subpage !== "qcqueue" && subpage !== "qcsetup" && subpage !== "deliveries" && subpage !== "incoming" && subpage !== "notifications" && subpage !== "custdeliveries" && profile.role === "model_manager" && (
        <ModelManagerPanel config={config} refresh={refresh} flash={flash} session={profile} subpage={subpage} setSubpage={setSubpage} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />
      )}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#1A1A1A", color: "#fff", padding: "10px 20px", borderRadius: 4, fontSize: 13, fontFamily: "Inter, sans-serif", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 1500 }}>
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
      @media print {
        @page { size: A4 portrait; margin: 8mm; }
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
      }
      /* applied by the print-fit code, only between "print" being pressed and the print dialog closing */
      html.print-compact .no-print { display: none !important; }
      html.print-compact .shell-content { padding: 0 !important; }
      html.print-compact .print-sheet { zoom: var(--print-zoom, 1); }
      html.print-compact .print-sheet h2 { margin: 0 0 6px !important; font-size: 16px !important; }
      html.print-compact .print-sheet input,
      html.print-compact .print-sheet select,
      html.print-compact .print-sheet textarea {
        border: 0 !important; border-bottom: 1px solid #cfcfcf !important; border-radius: 0 !important; background: transparent !important;
        box-shadow: none !important; padding: 1px 0 !important; height: auto !important; min-height: 0 !important; font-size: 11px !important;
        color: #000 !important; -webkit-text-fill-color: #000; opacity: 1 !important; -webkit-appearance: none; appearance: none; resize: none;
      }
      html.print-compact .print-sheet img { max-height: 64px; }
      @keyframes mc-spin { to { transform: rotate(360deg); } }
    `}</style>
  );
}

function Shell({ session, subpage, setSubpage, onLogout, onLock, children, notifications, refreshNotifications, onOpenNotification, tasks }) {
  const adminTabs = [
    ["records", "ALL RECORDS"], ["requirements", "ALL REQUIREMENTS"], ["branches", "ADD/REMOVE BRANCH"],
    ["models", "ADD MODEL"], ["viewmodels", "VIEW MODELS"], ["users", "ADD USERS"],
  ];
  return (
    <div style={{ minHeight: "100vh", background: "#fff", color: "#1A1A1A", fontFamily: F.body }}>
      <GlobalStyle />
      <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 100, background: "#fff", borderBottom: "2px solid #1A1A1A", padding: "18px 30px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div onClick={() => setSubpage("home")} style={{ fontFamily: F.display, fontWeight: 700, fontSize: 26, letterSpacing: "0.12em", cursor: "pointer" }}>
          MOONLIGHT
          <div style={{ fontSize: 10, letterSpacing: "0.35em", textAlign: "center", fontWeight: 500, marginTop: -4 }}>CONCEPT</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.03em", display: "flex", gap: 14, alignItems: "center" }}>
          <span><span style={{ color: "#8a8a8a" }}>{session.name} ·</span> {ROLE_LABEL[session.role].toUpperCase()}</span>
          <DashboardMenu session={session} setSubpage={setSubpage} onLogout={onLogout} onLock={onLock} tasks={tasks} />
          <NotificationBell session={session} notifications={notifications} refreshNotifications={refreshNotifications} onOpen={onOpenNotification} onViewAll={() => setSubpage("notifications")} />
        </div>
      </div>
      <div className="shell-content" style={{ padding: "26px 30px 60px" }}>{children}</div>
    </div>
  );
}

function StatusTag({ status }) {
  status = maskStatus(status);
  const s = STATUS[status] || { label: status, color: "#1A1A1A" };
  return <span style={{ color: s.color, fontWeight: 700, fontSize: 13 }}>{s.label.toUpperCase()}</span>;
}

const inputStyle = { width: "100%", border: "1px solid #C9CDD3", borderRadius: 3, padding: "8px 9px", fontSize: 14, fontFamily: F.body };
const label13 = { fontSize: 11.5, fontWeight: 600, color: "#5a5a5a", marginBottom: 4, letterSpacing: "0.02em", textTransform: "uppercase" };
const cardStyle = { background: "#fff", border: "1px solid #E5E5E5", borderRadius: 8, padding: "18px 20px" };

function TagField({ value, onChange, options, disabled }) {
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
              {!disabled && <span onClick={() => removeTag(t)} style={{ cursor: "pointer", color: "#C1302B", fontWeight: 700 }}>×</span>}
            </span>
          ))}
        </div>
      )}
      {disabled && tags.length === 0 && <div style={{ fontSize: 13, color: "#8a8a8a" }}>—</div>}
      {!disabled && <input
        value={input}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setInput(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); addTag(input); }
          else if (e.key === "Backspace" && !input && tags.length) removeTag(tags[tags.length - 1]);
        }}
        placeholder={options && options.length ? "Click to pick, or type your own…" : "Type a tag and press Enter…"}
        style={inputStyle}
      />}
      {!disabled && open && options && filtered.length > 0 && (
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

const ABAYA_OPTIONS = ["Normal", "Full button with fabric", "Full button without fabric", "Half button", "Button start from and till"];
const BUTTON_RANGE = "Button start from and till";

function ColorPicker({ colors, value, onChange, disabled, center }) {
  const [big, setBig] = useState(null);
  if (!colors || colors.length === 0) return null;
  return (
    <div>
      <div style={{ ...label13, textAlign: center ? "center" : "left" }}>Colour {!value && !disabled && <span style={{ color: "#C1302B" }}>— please choose</span>}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: center ? "center" : "flex-start" }}>
        {colors.map((c) => {
          const selected = value === c.color_name;
          return (
            <div
              key={c.id}
              onClick={() => !disabled && onChange({ name: c.color_name, swatch: c.swatch_url || "" })}
              onDoubleClick={() => c.swatch_url && setBig(c)}
              style={{ width: 84, textAlign: "center", cursor: disabled ? "default" : "pointer" }}
            >
              <div style={{ position: "relative", width: 76, height: 76, margin: "0 auto", borderRadius: 6, overflow: "hidden", background: "#F2F2F2", border: selected ? "3px solid #1A1A1A" : "1px solid #DDE1E7", boxSizing: "border-box" }}>
                {c.swatch_url
                  ? <img src={c.swatch_url} alt={c.color_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#8a8a8a" }}>No photo</div>}
                {selected && <div style={{ position: "absolute", top: 3, right: 3, background: "#1A1A1A", color: "#fff", borderRadius: 10, width: 18, height: 18, fontSize: 12, lineHeight: "18px", fontWeight: 700 }}>✓</div>}
                {c.swatch_url && (
                  <div
                    onClick={(e) => { e.stopPropagation(); setBig(c); }}
                    title="View larger"
                    style={{ position: "absolute", bottom: 3, right: 3, background: "rgba(255,255,255,0.92)", borderRadius: 10, width: 22, height: 22, lineHeight: "22px", textAlign: "center", fontSize: 12, cursor: "zoom-in", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
                  >🔍</div>
                )}
              </div>
              <div style={{ fontSize: 11.5, marginTop: 4, fontWeight: selected ? 700 : 400 }}>{c.color_name}</div>
            </div>
          );
        })}
      </div>
      {big && (
        <>
          <Lightbox src={big.swatch_url} onClose={() => setBig(null)} />
          <div style={{ position: "fixed", top: 18, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 16, fontWeight: 700, zIndex: 1001, pointerEvents: "none" }}>{big.color_name}</div>
        </>
      )}
    </div>
  );
}

const ADDITIONAL_REQ_OPTIONS = [
  "Add Pockets", "Remove Pockets",
  "Add Shoulder Pads", "Remove Shoulder Pads",
  "Add Batana", "Remove Batana",
  "Add Side Slit", "Remove Side Slit",
  "Add Cuff Slit", "Remove Cuff Slit",
];
const splitTags = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
// "Side Pocket, Open Front, SINGLE HOOK"  or  "Side pocket, side slit etc."  →  tags for the Additional Requirements field
const requirementTagsOf = (model) =>
  String((model && model.requirements) || "")
    .split(/[,;\n]+/)
    .map((t) => t.replace(/\s*\b(etc|and so on)\b\.?\s*$/i, "").replace(/[.;]+$/g, "").trim())
    .filter(Boolean)
    .filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)
    .join(", ");
const oppositeOf = (t) => (t.startsWith("Add ") ? "Remove " + t.slice(4) : t.startsWith("Remove ") ? "Add " + t.slice(7) : null);
// Picking "Add X" drops "Remove X" (and the other way round) so a form can't contradict itself.
const resolveAdditional = (prev, next) => {
  const before = splitTags(prev);
  let out = splitTags(next);
  out.filter((t) => !before.includes(t)).forEach((t) => { const o = oppositeOf(t); if (o) out = out.filter((x) => x !== o); });
  return out.join(", ");
};
// Older orders stored "normal" / "fullButton" / "buttonFromTill". The first and last map cleanly; the old
// "fullButton" can't be mapped (with or without fabric?) so it stays visible as its own legacy choice.
const normAbaya = (v) => (!v || v === "normal" ? "Normal" : v === "buttonFromTill" ? BUTTON_RANGE : v);
const abayaLabel = (v) => (v === "fullButton" ? "Full Button (old)" : v);

function AbayaOptionField({ option, from, till, onChange, disabled }) {
  const opt = normAbaya(option);
  const options = ABAYA_OPTIONS.includes(opt) ? ABAYA_OPTIONS : [...ABAYA_OPTIONS, opt];
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div>
        <div style={label13}>Abaya Option</div>
        <select
          value={opt} disabled={disabled} style={{ ...inputStyle, width: 250 }}
          onChange={(e) => onChange({ option: e.target.value, from: e.target.value === BUTTON_RANGE ? from : "", till: e.target.value === BUTTON_RANGE ? till : "" })}
        >
          {options.map((o) => <option key={o} value={o}>{abayaLabel(o)}</option>)}
        </select>
      </div>
      {opt === BUTTON_RANGE && (
        <>
          <div>
            <div style={label13}>Start from</div>
            <input value={from || ""} disabled={disabled} placeholder="e.g. 12" style={{ ...inputStyle, width: 110 }} onChange={(e) => onChange({ option: opt, from: e.target.value, till })} />
          </div>
          <div>
            <div style={label13}>Till</div>
            <input value={till || ""} disabled={disabled} placeholder="e.g. 40" style={{ ...inputStyle, width: 110 }} onChange={(e) => onChange({ option: opt, from, till: e.target.value })} />
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Login (real Supabase auth) ---------------- */

function LoginScreen({ onUsePin }) {
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
        {onUsePin && <a className="link" style={{ display: "block", textAlign: "center", marginTop: 16, fontSize: 13 }} onClick={onUsePin}>← Back to PIN login</a>}
      </div>
    </div>
  );
}

/* ---------------- PIN login (approved showroom devices) ---------------- */

const DEVICE_KEY = "ml_device_token";
const sha256Hex = async (s) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};
async function callFn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let detail = {};
    try { detail = await error.context.json(); } catch (e) { /* no body */ }
    return { error: detail.error || "network", detail };
  }
  return { data };
}
const pinAuth = (body) => callFn("pin-auth", body);
const pushService = (body) => callFn("push-service", body);

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const urlBase64ToUint8Array = (b64) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

// "needs_install" | "unsupported" | "denied" | "off" | "on"
async function alertsStatus() {
  if (isIOS() && !isStandalone()) return "needs_install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === "granted" ? "on" : "off";
}
async function enableAlerts() {
  const token = localStorage.getItem(DEVICE_KEY);
  if (!token) return { error: "not_trusted" };
  if (isIOS() && !isStandalone()) return { error: "needs_install" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return { error: "unsupported" };
  const perm = await Notification.requestPermission();      // must be called from a tap
  if (perm !== "granted") return { error: "denied" };
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const info = await pushService({ action: "info", device_token: token });
  if (info.error) return { error: info.error };
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(info.data.vapid_public) }));
  const saved = await pushService({ action: "subscribe", device_token: token, subscription: sub.toJSON() });
  return saved.error ? { error: saved.error } : { ok: true };
}
const alertMsg = (e) => ({
  needs_install: "On iPad: tap Share → Add to Home Screen, then open Moonlight from the Home Screen and try again.",
  denied: "Alerts are blocked. Turn them on in iPad Settings → Notifications → Moonlight.",
  unsupported: "This browser can't show lock-screen alerts. On iPad, update to iPadOS 16.4 or newer.",
  not_trusted: "Only devices approved by an Admin can use alerts.",
}[e] || "Couldn't turn on alerts. Please try again.");

// Sound: browsers only allow it after one tap on the page.
let audioCtx = null;
const unlockAudio = () => { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch (e) { /* ignore */ } };
const playChime = () => {
  if (!audioCtx || audioCtx.state !== "running") return;
  [880, 1175].forEach((freq, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t0 = audioCtx.currentTime + i * 0.18;
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    o.connect(g); g.connect(audioCtx.destination); o.start(t0); o.stop(t0 + 0.55);
  });
};

function useIdleLock(enabled, minutes, onLock) {
  useEffect(() => {
    if (!enabled) return;
    let timer;
    let last = Date.now();
    const arm = () => { clearTimeout(timer); timer = setTimeout(onLock, minutes * 60000); };
    const activity = () => { last = Date.now(); arm(); };
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - last >= minutes * 60000) onLock(); };
    const evs = ["pointerdown", "keydown", "touchstart", "scroll", "mousemove"];
    evs.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);   // iPads freeze timers while asleep
    arm();
    return () => { clearTimeout(timer); evs.forEach((e) => window.removeEventListener(e, activity)); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, minutes, onLock]);
}

function PinLogin({ onFallback, embedded, previousUser, onSuccess }) {
  const [users, setUsers] = useState(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [picked, setPicked] = useState(null);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(DEVICE_KEY);
    if (!token) { onFallback(); return; }
    pinAuth({ action: "list", device_token: token }).then(({ data, error }) => {
      if (error === "untrusted_device") { localStorage.removeItem(DEVICE_KEY); onFallback(); return; }
      if (error) { setMsg("Couldn't reach the server. Check the connection, or use email & password."); setUsers([]); return; }
      setUsers(data.users); setDeviceLabel(data.device.label);
    });
  }, []); // eslint-disable-line

  const submit = async (value) => {
    setBusy(true); setMsg("");
    const { data, error, detail } = await pinAuth({ action: "login", device_token: localStorage.getItem(DEVICE_KEY), user_id: picked.id, pin: value });
    if (error) {
      setPin("");
      if (error === "wrong_pin") setMsg(`Wrong PIN — ${detail.attempts_left} ${detail.attempts_left === 1 ? "try" : "tries"} left.`);
      else if (error === "locked") setMsg("Too many wrong attempts. Try again in a few minutes, or ask an admin to reset your PIN.");
      else if (error === "untrusted_device") { localStorage.removeItem(DEVICE_KEY); onFallback(); }
      else setMsg("Couldn't sign in. Try again, or use email & password.");
      setBusy(false); return;
    }
    if (previousUser && picked.id === previousUser.id) {      // same person unlocking: keep the existing session — nothing to reload
      setBusy(false); onSuccess && onSuccess(picked.id); return;
    }
    let { error: vErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
    if (vErr) ({ error: vErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "email" }));
    if (vErr) { setMsg("Couldn't sign in. Try again."); setPin(""); setBusy(false); return; }
    setBusy(false);   // on success the app's auth listener takes over and this screen goes away
    onSuccess && onSuccess(picked.id);
  };

  const press = (d) => { if (busy || pin.length >= 6) return; const next = pin + d; setPin(next); if (next.length === 6) submit(next); };
  const back = () => { if (!busy) setPin((p) => p.slice(0, -1)); };

  useEffect(() => {
    if (!picked) return;
    const onKey = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") back(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line

  const initials = (n) => (n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const keyStyle = { width: 78, height: 78, borderRadius: 39, border: "1px solid #C9CDD3", background: "#fff", fontSize: 26, fontWeight: 600, cursor: "pointer" };

  return (
    <div style={{ minHeight: embedded ? "100%" : "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: "#fff", fontFamily: F.body }}>
      <GlobalStyle />
      {!embedded && (
        <>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 30, letterSpacing: "0.12em", textAlign: "center" }}>
            MOONLIGHT
            <div style={{ fontSize: 11, letterSpacing: "0.35em", fontWeight: 500, marginTop: -4 }}>CONCEPT</div>
          </div>
          <div style={{ fontSize: 13, color: "#8a8a8a", margin: "8px 0 28px" }}>{deviceLabel}</div>
        </>
      )}

      {users === null ? <div style={{ color: "#8a8a8a" }}>Loading…</div> : !picked ? (
        <>
          <div style={{ fontWeight: 700, marginBottom: 16, letterSpacing: "0.04em" }}>WHO'S WORKING?</div>
          {users.length === 0 ? (
            <div style={{ color: "#8a8a8a", fontSize: 13.5, textAlign: "center", maxWidth: 340 }}>No PINs have been set up for this device yet. Use email & password, or ask an admin to set your PIN.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", maxWidth: 640 }}>
              {users.map((u) => (
                <div key={u.id} onClick={() => { setPicked(u); setPin(""); setMsg(""); }}
                  style={{ width: 150, padding: "20px 12px", border: "1px solid #DDE1E7", borderRadius: 8, textAlign: "center", cursor: "pointer" }}>
                  <div style={{ width: 56, height: 56, borderRadius: 28, background: "#1A1A1A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", fontWeight: 700, fontSize: 18 }}>{initials(u.name)}</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name}</div>
                  <div style={{ fontSize: 11.5, color: "#8a8a8a" }}>{ROLE_LABEL[u.role] || u.role}</div>
                </div>
              ))}
            </div>
          )}
          {msg && <div style={{ color: "#C1302B", fontSize: 13, marginTop: 16, textAlign: "center", maxWidth: 360 }}>{msg}</div>}
        </>
      ) : (
        <>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{picked.name}</div>
          <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 18 }}>Enter your 6-digit PIN</div>
          {previousUser && picked.id !== previousUser.id && (
            <div style={{ fontSize: 12, color: "#C1302B", maxWidth: 300, textAlign: "center", marginBottom: 10 }}>
              Not {previousUser.name}? Anything {previousUser.name} hadn't saved on this screen will be discarded.
            </div>
          )}
          <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={{ width: 16, height: 16, borderRadius: 8, border: "2px solid #1A1A1A", background: i < pin.length ? "#1A1A1A" : "#fff" }} />)}
          </div>
          <div style={{ minHeight: 20, color: "#C1302B", fontSize: 13, marginBottom: 12, textAlign: "center", maxWidth: 320 }}>{msg}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 78px)", gap: 14 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <button key={d} style={keyStyle} onClick={() => press(String(d))}>{d}</button>)}
            <div />
            <button style={keyStyle} onClick={() => press("0")}>0</button>
            <button style={{ ...keyStyle, fontSize: 20 }} onClick={back}>⌫</button>
          </div>
          <a className="link" style={{ marginTop: 22, fontSize: 13 }} onClick={() => { setPicked(null); setPin(""); setMsg(""); }}>← Not you? Choose another name</a>
        </>
      )}
      <a className="link" style={{ marginTop: 26, fontSize: 12.5, color: "#8a8a8a" }} onClick={onFallback}>{embedded ? "Sign out and use email & password" : "Use email & password instead"}</a>
    </div>
  );
}

function LoginGate() {
  const [mode, setMode] = useState(localStorage.getItem(DEVICE_KEY) ? "pin" : "password");
  if (mode === "pin") return <PinLogin onFallback={() => setMode("password")} />;
  return <LoginScreen onUsePin={localStorage.getItem(DEVICE_KEY) ? () => setMode("pin") : null} />;
}

function LockScreen({ profile, onUnlock }) {
  const [now, setNow] = useState(new Date());
  const [feed, setFeed] = useState([]);
  const [alerts, setAlerts] = useState("off");
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("");
  const seen = React.useRef(null);
  const token = localStorage.getItem(DEVICE_KEY);

  const loadFeed = async () => {
    const { data } = await pushService({ action: "feed", device_token: token });
    if (!data) return;
    if (seen.current && data.items.some((i) => !seen.current.has(i.id))) playChime();
    seen.current = new Set(data.items.map((i) => i.id));
    setFeed(data.items);
  };
  useEffect(() => {
    loadFeed(); alertsStatus().then(setAlerts);
    pushService({ action: "info", device_token: token }).then(({ data }) => data && setLabel(data.label));
    const clock = setInterval(() => setNow(new Date()), 15000);
    const poll = setInterval(loadFeed, 15000);
    const onMsg = (e) => { if (e.data && e.data.type === "push") loadFeed(); };   // a push just arrived — refresh straight away
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", onMsg);
    return () => { clearInterval(clock); clearInterval(poll); if (navigator.serviceWorker) navigator.serviceWorker.removeEventListener("message", onMsg); };
  }, []); // eslint-disable-line

  const turnOn = async () => { const r = await enableAlerts(); setAlerts(await alertsStatus()); setNote(r.error ? alertMsg(r.error) : ""); };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "#fff", overflowY: "auto", display: "flex", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 380px", minWidth: 300, padding: "36px 32px", borderRight: "1px solid #E5E5E5" }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 64, lineHeight: 1 }}>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
        <div style={{ fontSize: 15, color: "#5a5a5a", marginTop: 6 }}>{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>
        <div style={{ fontSize: 12.5, color: "#8a8a8a", marginTop: 2 }}>🔒 Locked · {label}</div>

        <div style={{ margin: "22px 0 8px", fontWeight: 700, fontSize: 13, letterSpacing: "0.05em" }}>RECENT ACTIVITY</div>
        <div style={{ maxHeight: "48vh", overflowY: "auto" }}>
          {feed.length === 0 ? <div style={{ fontSize: 13, color: "#8a8a8a" }}>Nothing yet.</div> : feed.map((n) => (
            <div key={n.id} style={{ padding: "9px 0", borderBottom: "1px solid #F0F0F0" }}>
              <div style={{ fontSize: 13.5 }}>{n.message}</div>
              <div className="mono" style={{ fontSize: 11, color: "#8a8a8a", marginTop: 2 }}>{fmtDateTime(n.created_at)}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, fontSize: 12.5 }}>
          {alerts === "on" && <span style={{ color: "#2F8F46" }}>🔔 Lock-screen alerts are on</span>}
          {alerts === "off" && <button onClick={turnOn} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 14px", fontSize: 12.5, fontWeight: 700 }}>🔔 Turn on lock-screen alerts</button>}
          {(alerts === "needs_install" || alerts === "denied" || alerts === "unsupported") && <span style={{ color: "#8a8a8a" }}>{alertMsg(alerts)}</span>}
          {note && <div style={{ color: "#C1302B", marginTop: 6 }}>{note}</div>}
          <div style={{ color: "#8a8a8a", marginTop: 8 }}>Tap anywhere once to enable the activity chime.</div>
        </div>
      </div>

      <div style={{ flex: "1 1 420px", minWidth: 320 }}>
        <PinLogin
          embedded previousUser={profile}
          onSuccess={(userId) => { if (userId === profile.id) onUnlock(); else { localStorage.removeItem("ml_locked"); window.location.reload(); } }}
          onFallback={() => { onUnlock(); supabase.auth.signOut(); }}
        />
      </div>
    </div>
  );
}

/* ---------------- Records table (shared) ---------------- */

function RecordsToolbar({ query, setQuery, statusFilter, setStatusFilter, noPII }) {
  const seesAll = VIEWER_ROLE === "production" || VIEWER_ROLE === "admin";
  const statusList = Object.entries(STATUS).filter(([k]) => (seesAll ? k !== "public_in_process" : !PRODUCTION_ONLY.includes(k)));
  return (
    <div className="no-print" style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 18, flexWrap: "wrap", justifyContent: "center" }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>SEARCH BY:</span>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={noPII ? "Job Order No / Model / Colour" : "Name / Mobile No / Job Order"} style={{ ...inputStyle, width: 260 }} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>STATUS TYPE:</span>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 200 }}>
        <option value="all">All statuses</option>
        {statusList.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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

function OrderTable({ orders, onOpen, editableStatuses, showDelete, onDelete, noPII }) {
  if (orders.length === 0) return <div style={{ textAlign: "center", padding: 50, color: "#8a8a8a", fontSize: 14 }}>No job orders found.</div>;
  return (
    <table>
      <thead>
        <tr style={{ borderBottom: "2px solid #1A1A1A", fontSize: 12.5, textAlign: "left" }}>
          {["Job Order No", noPII ? null : "Name", "Date", "DeliveryDate", noPII ? null : "Mobile", "Model", "Salesperson", "Branch", "Status", "View", showDelete ? "Action" : null]
            .filter(Boolean).map((h) => <th key={h} style={{ padding: "9px 10px", fontWeight: 700 }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} style={{ borderBottom: "1px solid #E5E5E5", fontSize: 13.5 }}>
            <td style={{ padding: "9px 10px" }} className="mono">{o.jobOrderNo || "—"}</td>
            {!noPII && <td style={{ padding: "9px 10px" }}>{o.name}</td>}
            <td style={{ padding: "9px 10px" }}>{fmtDate(o.createdAt)}</td>
            <td style={{ padding: "9px 10px" }}>{fmtDate(o.deliveryDate)}</td>
            {!noPII && <td style={{ padding: "9px 10px" }}>{o.mobile}</td>}
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

function useFilteredOrders(orders, query, statusFilter, noPII) {
  return useMemo(() => {
    let list = orders;
    if (statusFilter !== "all") list = list.filter((o) => maskStatus(o.status) === statusFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      // Production can only search by order number, model and colour — never by who the customer is
      list = noPII
        ? list.filter((o) => String(o.jobOrderNo || "").toLowerCase().includes(q) || (o.model || "").toLowerCase().includes(q) || (o.color || "").toLowerCase().includes(q))
        : list.filter((o) => o.name.toLowerCase().includes(q) || (o.mobile || "").includes(q) || (o.invoiceNo || "").toLowerCase().includes(q));
    }
    return list;
  }, [orders, query, statusFilter, noPII]);
}

/* ================= Sales Panel ================= */

function SalesPanel({ config, orders, profiles, requirementItems, refresh, session, subpage, setSubpage, selectedId, setSelectedId, flash, openRequest, clearOpenRequest }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingOrderId, setEditingOrderId] = useState(null);
  useEffect(() => {
    if (openRequest && openRequest.type === "order") { setSelectedId(openRequest.id); openFocus.current = openRequest.focus || null; clearOpenRequest(); }
  }, [openRequest]); // eslint-disable-line
  const [view, setView] = useState("all");
  const filtered = useFilteredOrders(view === "delivered" ? orders.filter((o) => DELIVERED_STATUSES.includes(o.status)) : orders, query, statusFilter);
  const selected = orders.find((o) => o.id === selectedId);

  const handleCreate = async (form, file) => {
    let attachmentUrl = null;
    if (file) {
      const up = await uploadCustomerFile(`order-files/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`, file, file.type);
      if (up.error) { flash("Couldn't upload the attachment: " + up.error.message); return; }
      attachmentUrl = up.ref;
    }
    const [jobNo] = await nextJobOrderNumbers(1);
    const now = new Date().toISOString();
    const row = {
      job_order_no: jobNo, invoice_no: form.invoiceNo || null, name: form.name, mobile: form.mobile, order_type: form.orderType,
      model: form.model, item: form.item, prepared_by: session.name, branch: form.branch || session.branch,
      measurements: form.measurements, sheila_type: form.sheilaType,
      abaya_option: form.abayaOption || "Normal", button_from: form.buttonFrom || null, button_till: form.buttonTill || null,
      additional_requirements: form.additionalRequirements || null, attachments: form.attachments || [],
      color: form.color || null, color_swatch: form.colorSwatch || null,
      delivery_date: form.deliveryDate || null,
      attachment_url: attachmentUrl || form.attachmentNote || null, comments: form.comments,
      status: "job_created", history: [{ note: "Job order created by Sales", by: session.name, at: now }],
    };
    const { data, error } = await supabase.from("job_orders").insert(row).select().single();
    if (error) { flash("Error: " + error.message); return; }
    notify(session, `${session.name} created job order ${jobNo}`, "job_order", row.branch, { type: "order", id: data.id });
    await refresh();
    setSubpage("records");
    setSelectedId(data.id);
    flash("Job order created");
  };

  const handleUpdateOrderFull = async (form, file) => {
    const before = orders.find((o) => o.id === editingOrderId);
    let attachmentUrl = before?.attachmentUrl || null;
    if (file) {
      const up = await uploadCustomerFile(`order-files/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`, file, file.type);
      if (up.error) { flash("Couldn't upload the attachment: " + up.error.message); return; }
      attachmentUrl = up.ref;
    }
    const changed = diffSummary(before, form, !!file);
    const now = new Date().toISOString();
    const note = changed.length ? `Job order edited — changed: ${changed.join(", ")}` : "Job order edited (no field changes detected)";
    const history = [...(before?.history || []), { note, by: session.name, at: now }];
    const { error } = await supabase.from("job_orders").update({
      name: form.name, mobile: form.mobile, order_type: form.orderType,
      model: form.model, item: form.item, branch: form.branch, measurements: form.measurements,
      sheila_type: form.sheilaType, abaya_option: form.abayaOption || "Normal", button_from: form.buttonFrom || null, button_till: form.buttonTill || null,
      additional_requirements: form.additionalRequirements || null, attachments: form.attachments || [],
      color: form.color || null, color_swatch: form.colorSwatch || null,
      delivery_date: form.deliveryDate || null, attachment_url: attachmentUrl, comments: form.comments,
      history, updated_at: now,
    }).eq("id", editingOrderId);
    if (error) { flash("Error: " + error.message); return; }
    notify(session, `${session.name} edited order ${before?.jobOrderNo || ""} (${form.model}): ${changed.length ? changed.map((c) => c.split(" (")[0]).join(", ") : "no field changes"}`, "edit", form.branch || before?.branch, { type: "order", id: editingOrderId });
    await refresh(); setSubpage("records"); setSelectedId(editingOrderId); flash("Job order updated");
  };

  const handleSaveFields = async (id, fields) => {
    const { error } = await supabase.from("job_orders").update({ ...orderFieldsToDb(fields), updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    const o = orders.find((x) => x.id === id);
    if (o) notify(session, `${session.name} edited order ${o.jobOrderNo} (${o.model})`, "edit", o.branch, { type: "order", id: o.id });
    await refresh(); flash("Changes saved");
  };

  const handleSaveRequirement = async (customer, measurements, items, deliveryDate, signatureUrl, createOrders) => {
    const branch = session.branch || (session.role === "admin" ? "Admin" : "");
    const { data: existing } = await supabase.from("customer_profiles").select("id").eq("mobile", customer.mobile).order("created_at", { ascending: false }).limit(1);

    let profile, pErr;
    if (existing && existing.length > 0) {
      const result = await supabase.from("customer_profiles").update({
        name: customer.name, measurements, branch, signature_url: signatureUrl || null, updated_at: new Date().toISOString(),
      }).eq("id", existing[0].id).select().single();
      profile = result.data; pErr = result.error;
    } else {
      const result = await supabase.from("customer_profiles").insert({
        name: customer.name, mobile: customer.mobile, measurements, branch, created_by: session.name,
        signature_url: signatureUrl || null,
      }).select().single();
      profile = result.data; pErr = result.error;
    }
    if (pErr) { flash("Error: " + pErr.message); return false; }

    const validItems = items.filter((it) => !it.error);
    const jobNumbers = createOrders && validItems.length > 0 ? await nextJobOrderNumbers(validItems.length) : [];

    let lastOrderId = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.error) continue;
      let jobOrderId = null;
      if (createOrders) {
        const now = new Date().toISOString();
        const fitNote = `${it.cut ? `Cut: ${it.cut}. ` : ""}${it.size ? `Nearest size: ${it.size}.` : ""}${it.notes ? " Notes: " + it.notes : ""}`;
        const vIdx = validItems.indexOf(it);
        const { data: order } = await supabase.from("job_orders").insert({
          job_order_no: jobNumbers[vIdx], name: customer.name, mobile: customer.mobile, order_type: "New",
          model: it.model, item: ITEM_TYPES[0], prepared_by: session.name, branch,
          measurements: calcToStrings(it.calc), cut: it.cut || null, delivery_date: deliveryDate || null,
          abaya_option: it.abayaOption || "Normal", button_from: it.buttonFrom || null, button_till: it.buttonTill || null,
          additional_requirements: it.additionalRequirements || null, attachments: it.attachments || [],
          color: it.color || null, color_swatch: it.colorSwatch || null,
          comments: fitNote, status: "job_created",
          history: [{ note: "Job order created from customer requirement", by: session.name, at: now }],
        }).select().single();
        jobOrderId = order?.id || null;
        lastOrderId = jobOrderId;
        if (order) notify(session, `${session.name} created job order ${order.job_order_no || order.id} from a requirement`, "job_order", branch, { type: "order", id: order.id });
      }
      await supabase.from("requirement_items").insert({
        profile_id: profile.id, model: it.model, recommended_size: it.size || null, deltas: {}, calculated: it.calc || {}, cut: it.cut || null,
        abaya_option: it.abayaOption || "Normal", button_from: it.buttonFrom || null, button_till: it.buttonTill || null,
        additional_requirements: it.additionalRequirements || null, attachments: it.attachments || [],
        color: it.color || null, color_swatch: it.colorSwatch || null,
        notes: it.notes || null, job_order_id: jobOrderId,
      });
    }
    await refresh();
    if (createOrders && lastOrderId) { setSubpage("records"); setSelectedId(lastOrderId); flash("Job order(s) created"); }
    else if (createOrders) { setSubpage("customers"); flash("Customer profile saved"); notify(session, `${session.name} saved a customer requirement`, "requirement", undefined, { type: "customer", id: customer.mobile }); }
    else { const exists = existing && existing.length > 0; flash(exists ? "Profile updated" : "Profile created"); notify(session, `${session.name} ${exists ? "updated" : "created"} a customer profile`, "profile", undefined, { type: "customer", id: customer.mobile }); }
    return true;
  };

  const handleCreateOrderFromRow = async (row) => {
    const branch = row.profile.branch || (session.role === "admin" ? "Admin" : session.branch || "");
    const [jobNo] = await nextJobOrderNumbers(1);
    const now = new Date().toISOString();
    const fitNote = `${row.cut ? `Cut: ${row.cut}. ` : ""}${row.recommendedSize ? `Nearest size: ${row.recommendedSize}.` : ""}${row.notes ? " Notes: " + row.notes : ""}`;
    const { data: order, error } = await supabase.from("job_orders").insert({
      job_order_no: jobNo, name: row.profile.name, mobile: row.profile.mobile, order_type: "New", model: row.model,
      item: ITEM_TYPES[0], prepared_by: session.name, branch,
      measurements: row.calculated && Object.keys(row.calculated).length ? calcToStrings(row.calculated) : suggestionMeasurements(row.profile.measurements, row.deltas),
      cut: row.cut || null, delivery_date: row.deliveryDate || null,
      abaya_option: row.abayaOption || "Normal", button_from: row.buttonFrom || null, button_till: row.buttonTill || null,
      additional_requirements: row.additionalRequirements || null, attachments: row.attachments || [],
      color: row.color || null, color_swatch: row.colorSwatch || null,
      comments: fitNote, status: "job_created",
      history: [{ note: "Job order created from saved requirement", by: session.name, at: now }],
    }).select().single();
    if (error) { flash("Error: " + error.message); return; }
    notify(session, `${session.name} created job order ${order.job_order_no || order.id} from a saved requirement`, "job_order", branch, { type: "order", id: order.id });
    await supabase.from("requirement_items").update({ job_order_id: order.id }).eq("id", row.id);
    await refresh(); setSubpage("records"); setSelectedId(order.id); flash("Job order created");
  };

  const runHistoryUpdate = async (id, status, note, comment) => {
    const current = orders.find((o) => o.id === id);
    const history = [...current.history, { note, by: session.name, at: new Date().toISOString() }];
    const { error } = await supabase.from("job_orders").update({ status, history, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    notify(session, `${session.name}: ${STATUS[status].label} — order ${current.jobOrderNo} (${current.model})${comment ? " — " + comment : ""}`, "status", current.branch, { type: "order", id: current.id });
    await refresh(); flash(STATUS[status].label);
  };

  const handleAction = (id, to, comment) => runHistoryUpdate(id, to, comment ? `${STATUS[to].label}: ${comment}` : STATUS[to].label, comment);
  const handleResubmit = (id) => runHistoryUpdate(id, "job_created", "Resubmitted to Production", "resubmitted to Production");

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
    return <CustomersPage profiles={profiles} orders={orders} session={session} refresh={refresh} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />;
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
      <RecordsViewTabs value={view} onChange={setView} tabs={[["all", "All records", orders.length], ["delivered", "Delivered to stores", orders.filter((o) => DELIVERED_STATUSES.includes(o.status)).length]]} />
      <RecordsToolbar query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
      <div className="no-print" style={{ textAlign: "right", marginBottom: 10 }}>
        <button onClick={() => setSubpage("requirement")} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.03em", marginRight: 8 }}>+ NEW REQUIREMENT</button>
        <button onClick={() => setSubpage("new")} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.03em" }}>+ NEW JOB ORDER</button>
      </div>
      <OrderTable orders={filtered} onOpen={setSelectedId} editableStatuses={["job_rejected", "ready_to_deliver"]} />
      {selected && <OrderDetail order={selected} role="sales" session={session} onClose={() => setSelectedId(null)} models={config.models} flash={flash} onProductionDone={refresh}
        onSaveFields={handleSaveFields} onAction={handleAction} onResubmit={handleResubmit}
        onEditFull={(id) => { setEditingOrderId(id); setSelectedId(null); setSubpage("editOrder"); }}
        onViewFull={(id) => { setEditingOrderId(id); setSubpage("viewOrder"); }} />}
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
    sheilaType: initialOrder.sheilaType || SHEILA_TYPES[0], abayaOption: normAbaya(initialOrder.abayaOption),
    additionalRequirements: initialOrder.additionalRequirements || "", attachments: initialOrder.attachments || [],
    color: initialOrder.color || "", colorSwatch: initialOrder.colorSwatch || "",
    buttonFrom: initialOrder.buttonFrom || "", buttonTill: initialOrder.buttonTill || "", deliveryDate: initialOrder.deliveryDate || "", comments: initialOrder.comments || "",
  } : {
    name: "", mobile: "", invoiceNo: "", orderType: "New", model: config.models[0]?.modelNo || "",
    item: ITEM_TYPES[0], branch: session.branch || config.branches[0]?.name || "",
    measurements: Object.fromEntries(ALL_MEASURE_FIELDS.map(([k]) => [k, ""])),
    sheilaType: SHEILA_TYPES[0], abayaOption: "Normal", buttonFrom: "", buttonTill: "", additionalRequirements: "", attachments: [],
    color: "", colorSwatch: "",
    deliveryDate: "", comments: "",
  });
  const [file, setFile] = useState(null);
  const [dateError, setDateError] = useState(false);
  const [modelSizes, setModelSizes] = useState([]);
  const [pickedCut, setPickedCut] = useState("");
  const [pickedSize, setPickedSize] = useState("");
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);
  const printRef = React.useRef(null);
  usePrintFit(printRef);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setMeasure = (k) => (e) => setForm((f) => ({ ...f, measurements: { ...f.measurements, [k]: e.target.value } }));
  const model = config.models.find((m) => m.modelNo === form.model);
  const valid = form.name.trim() && form.mobile.trim();

  const [modelColors, setModelColors] = useState([]);
  useEffect(() => {
    if (!model) { setModelColors([]); return; }
    supabase.from("model_colors").select("*").eq("model_id", model.id).order("created_at").then(({ data }) => {
      const list = data || [];
      setModelColors(list);
      if (!isEdit && list.length > 0) {
        setForm((f) => ({ ...f, color: list[0].color_name, colorSwatch: list[0].swatch_url || "" }));
      }
    });
  }, [model?.id]); // eslint-disable-line

  useEffect(() => {
    if (!model) { setModelSizes([]); return; }
    supabase.from("model_sizes").select("*").eq("model_id", model.id).then(({ data }) => { setModelSizes(data || []); setPickedCut(""); setPickedSize(""); });
  }, [model?.id]);

  const cutsAvailable = Array.from(new Set(modelSizes.map((s) => s.cut || "General")));
  const activeCut = pickedCut || cutsAvailable[0] || "General";
  const sizesForCut = modelSizes.filter((s) => (s.cut || "General") === activeCut);

  const applySize = (sizeLabel) => {
    const row = sizesForCut.find((s) => s.size_label === sizeLabel);
    if (!row) return;
    setForm((f) => ({ ...f, measurements: { ...f.measurements, ...row.measurements } }));
    setPickedSize(sizeLabel);
    setCatalogLoaded(true);
  };

  const visibleFields = readOnly
    ? ALL_MEASURE_FIELDS.filter(([k]) => form.measurements[k])
    : (catalogLoaded && !showAllFields) ? ALL_MEASURE_FIELDS.filter(([k]) => form.measurements[k]) : ALL_MEASURE_FIELDS;

  return (
    <div ref={printRef} className="print-sheet">
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>{isEdit ? "EDIT JOB ORDER" : "JOB ORDER"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 6 }}>
        {!hidePII(session) && <Field label="Name"><input style={inputStyle} value={form.name} onChange={set("name")} disabled={readOnly} /></Field>}
        {!hidePII(session) && <Field label="Mobile No"><input style={inputStyle} value={form.mobile} onChange={set("mobile")} disabled={readOnly} /></Field>}
        <Field label="Date"><input style={inputStyle} value={isEdit ? fmtDate(initialOrder.createdAt) : fmtDate(new Date())} disabled /></Field>
        <Field label="Job Order No"><input style={inputStyle} value={isEdit ? (initialOrder.jobOrderNo || "—") : "Auto-generated on save"} disabled /></Field>
        <Field label="Order Type"><select style={inputStyle} value={form.orderType} onChange={set("orderType")} disabled={readOnly}>{ORDER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Model"><select style={inputStyle} value={form.model} onChange={(e) => { const v = e.target.value; setForm((f) => {
          const next = { ...f, model: v, color: "", colorSwatch: "" };
          if (!initialOrder) {          // new order only: fill from the model, unless the person already typed their own
            const prevAuto = requirementTagsOf(config.models.find((m) => m.modelNo === f.model));
            if (!f.additionalRequirements || f.additionalRequirements === prevAuto) next.additionalRequirements = requirementTagsOf(config.models.find((m) => m.modelNo === v));
          }
          return next;
        }); }} disabled={readOnly}>{config.models.map((m) => <option key={m.id} value={m.modelNo}>{m.modelNo}</option>)}</select></Field>
        <Field label="Select Item"><select style={inputStyle} value={form.item} onChange={set("item")} disabled={readOnly}>{ITEM_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Prepared By"><input style={inputStyle} value={isEdit ? initialOrder.preparedBy : session.name} disabled /></Field>
        <Field label="Branch"><select style={inputStyle} value={form.branch} onChange={set("branch")} disabled={readOnly}>{config.branches.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}</select></Field>
      </div>

      <div style={{ margin: "0 0 16px" }}>
        <ColorPicker colors={readOnly ? modelColors.filter((c) => c.color_name === form.color) : modelColors} value={form.color} disabled={readOnly}
          onChange={(v) => setForm((f) => ({ ...f, color: v.name, colorSwatch: v.swatch }))} />
      </div>

      {!readOnly && modelSizes.length > 0 && (
        <div style={{ border: "1px solid #C9CDD3", borderRadius: 4, padding: 12, marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, fontWeight: 700, alignSelf: "center" }}>Load from catalog:</div>
          {cutsAvailable.length > 1 && (
            <div>
              <div style={label13}>Cut</div>
              <select value={activeCut} onChange={(e) => { setPickedCut(e.target.value); setPickedSize(""); }} style={{ ...inputStyle, width: 140 }}>
                {cutsAvailable.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div>
            <div style={label13}>Size</div>
            <select value={pickedSize} onChange={(e) => applySize(e.target.value)} style={{ ...inputStyle, width: 140 }}>
              <option value="">Select size…</option>
              {sizesForCut.map((s) => <option key={s.id} value={s.size_label}>{s.size_label}</option>)}
            </select>
          </div>
          {pickedSize && <div style={{ fontSize: 11.5, color: "#2F8F46", alignSelf: "center" }}>Loaded {pickedSize}{cutsAvailable.length > 1 ? ` (${activeCut})` : ""} — you can still edit any field below.</div>}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0 6px" }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>MEASUREMENTS</div>
        {!readOnly && catalogLoaded && (
          <a className="link" style={{ fontSize: 11.5 }} onClick={() => setShowAllFields((s) => !s)}>{showAllFields ? "Hide empty fields" : "Show all fields"}</a>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
        {visibleFields.map(([k, l]) => (
          <Field key={k} label={l}>
            {readOnly ? (
              <input style={inputStyle} value={form.measurements[k] || ""} disabled />
            ) : (
              <select value={form.measurements[k] || ""} onChange={setMeasure(k)} style={inputStyle}>
                <option value="">—</option>
                {MEASUREMENT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
          </Field>
        ))}
      </div>

      <div style={{ display: "flex", gap: 26, alignItems: "flex-end", marginTop: 6, marginBottom: 18, flexWrap: "wrap" }}>
        <Field label="Sheila Type"><select style={{ ...inputStyle, width: 180 }} value={form.sheilaType} onChange={set("sheilaType")} disabled={readOnly}>{SHEILA_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <div style={{ marginBottom: 12 }}>
          <AbayaOptionField
            option={form.abayaOption} from={form.buttonFrom} till={form.buttonTill} disabled={readOnly}
            onChange={(v) => setForm((f) => ({ ...f, abayaOption: v.option, buttonFrom: v.from, buttonTill: v.till }))}
          />
        </div>
      </div>

      <div style={{ margin: "0 0 16px" }}>
        <Field label="Additional Requirements">
          <TagField
            options={ADDITIONAL_REQ_OPTIONS}
            value={form.additionalRequirements}
            onChange={(v) => setForm((f) => ({ ...f, additionalRequirements: resolveAdditional(f.additionalRequirements, v) }))}
            disabled={readOnly}
          />
        </Field>
      </div>

      <div style={{ margin: "0 0 16px" }}>
        <AttachmentField files={form.attachments} onChange={(files) => setForm((f) => ({ ...f, attachments: files }))} disabled={readOnly} />
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
        <Field label={readOnly ? "Delivery Date" : "Delivery Date *"}>
          <input type="date" value={form.deliveryDate} disabled={readOnly}
            onChange={(e) => { setForm((f) => ({ ...f, deliveryDate: e.target.value })); setDateError(false); }}
            style={{ ...inputStyle, borderColor: dateError ? "#C1302B" : undefined, borderWidth: dateError ? 2 : undefined }} />
          {dateError && <div style={{ color: "#C1302B", fontSize: 12, marginTop: 4 }}>Please choose a delivery date.</div>}
        </Field>
        <Field label="Attachment (photo/video reference)">
          {isEdit && initialOrder.attachmentUrl ? (
            <div style={{ fontSize: 12.5 }}>Current file: <SecureLink href={initialOrder.attachmentUrl}>View</SecureLink>{!readOnly && " — choose a new file below to replace it."}</div>
          ) : readOnly ? <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No attachment.</div> : null}
          {!readOnly && <input type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} style={inputStyle} />}
        </Field>
      </div>
      {readOnly
        ? <Field label="Comments"><div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{form.comments || "—"}</div></Field>
        : <Field label="Comments"><textarea style={{ ...inputStyle, minHeight: 70 }} value={form.comments} onChange={set("comments")} /></Field>}

      <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 20 }}>
        <button onClick={() => window.print()} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>PRINT / SAVE PDF</button>
        {!readOnly && (
          <button disabled={!valid} onClick={() => { if (!form.deliveryDate) { setDateError(true); return; } onSubmit(form, file); }} style={{ background: valid ? (isEdit ? "#2F8F46" : "#3B6FA0") : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>{isEdit ? "Save Changes" : "SUBMIT"}</button>
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

const showNum = (v) => (v == null || v === "" ? "—" : isNaN(+v) ? String(v) : String(Math.round(+v * 100) / 100));

function SubmittedItemCard({ it, idx, nearestLabel, rows, showMeas, onToggleMeas, onPhoto, canEdit, onEdit, onRemove }) {
  const tags = splitTags(it.additionalRequirements);
  const opt = normAbaya(it.abayaOption);
  return (
    <div style={{ border: "1px solid #BFE0C7", background: "#F7FCF8", borderRadius: 8, padding: "12px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div onClick={() => it.photoUrl && onPhoto(it.photoUrl)} title={it.photoUrl ? "Tap to enlarge" : ""} style={{ cursor: it.photoUrl ? "zoom-in" : "default", textAlign: "center" }}>
          <ModelThumb model={{ id: it.modelId, photoUrl: it.photoUrl, modelNo: it.model }} width={78} height={104} fit="contain" style={{ borderRadius: 4 }} />
          {it.photoUrl && <div className="no-print" style={{ fontSize: 10, color: "#8a8a8a", marginTop: 2 }}>🔍 enlarge</div>}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Item {idx + 1} · {it.model}{it.cut ? ` — ${it.cut}` : ""}</span>
            <span style={{ fontSize: 11.5, background: "#E7F4EA", color: "#2F8F46", borderRadius: 10, padding: "2px 10px", fontWeight: 700 }}>✓ Submitted</span>
          </div>
          <div style={{ fontSize: 12.5, color: "#5a5a5a", marginTop: 4, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            {it.color && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{it.colorSwatch && <img src={it.colorSwatch} alt="" style={{ width: 18, height: 18, borderRadius: 3, objectFit: "cover", border: "1px solid #E5E5E5" }} />}{it.color}</span>}
            <span>{abayaLabel(opt)}{opt === BUTTON_RANGE ? ` (${it.buttonFrom || "—"} to ${it.buttonTill || "—"})` : ""}</span>
            {nearestLabel && <span>Nearest size {nearestLabel}</span>}
            {(it.attachments || []).length > 0 && <span>📎 {it.attachments.length}</span>}
          </div>
          {tags.length > 0 && <div style={{ fontSize: 12.5, marginTop: 4 }}>{tags.join(" · ")}</div>}
          {it.notes && <div style={{ fontSize: 12, color: "#8a8a8a", marginTop: 2 }}>Notes: {it.notes}</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={!canEdit} title={canEdit ? "" : "Submit the open item first"} onClick={onEdit} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "8px 16px", fontWeight: 700, fontSize: 13, opacity: canEdit ? 1 : 0.45 }}>Edit</button>
          <button onClick={onRemove} style={{ background: "#fff", border: "1px solid #E8B9B6", color: "#C1302B", borderRadius: 4, padding: "8px 16px", fontWeight: 700, fontSize: 13 }}>Remove</button>
        </div>
      </div>

      {rows.length > 0 && (
        <div style={{ marginTop: 12, borderTop: "1px dashed #BFE0C7", paddingTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showMeas ? 8 : 0 }}>
            <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.05em", color: "#5a5a5a" }}>FINAL MEASUREMENTS</div>
            <a className="link" style={{ fontSize: 12 }} onClick={onToggleMeas}>{showMeas ? "Hide ▴" : "Show ▾"}</a>
          </div>
          {showMeas && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 8 }}>
              {rows.map((r) => (
                <div key={r.key} style={{ background: "#fff", border: "1px solid #DCEBDF", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 10.5, color: "#8a8a8a" }}>{r.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{showNum(r.final)}</div>
                  {r.changed && <div style={{ fontSize: 10.5, color: "#8a8a8a" }}>fitted {showNum(r.fitted)}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
  const [dateError, setDateError] = useState(false);
  const [confirm, setConfirm] = useState(null);   // { createOrders, exists }
  const [busy, setBusy] = useState(false);
  const savingRef = React.useRef(false);
  const [loadMobile, setLoadMobile] = useState("");
  const [loadMsg, setLoadMsg] = useState("");
  const [legacyResults, setLegacyResults] = useState([]);
  const [legacyCuttingRefs, setLegacyCuttingRefs] = useState([]);
  const sigCanvasRef = React.useRef(null);

  const setC = (k) => (e) => setCustomer((c) => ({ ...c, [k]: e.target.value }));
  const setMVal = (k) => (v) => setMeasurements((m) => ({ ...m, [k]: v }));

  const loadByMobile = async () => {
    if (!loadMobile.trim()) return;
    setLoadMsg("Searching…");
    setLegacyResults([]);
    setLegacyCuttingRefs([]);

    const { data } = await supabase.from("customer_profiles").select("*").eq("mobile", loadMobile.trim()).order("created_at", { ascending: false }).limit(1);
    if (data && data[0]) {
      setCustomer({ name: data[0].name, mobile: data[0].mobile });
      setMeasurements({ ...Object.fromEntries(FITTING_FIELDS.map(([k]) => [k, ""])), ...(data[0].measurements || {}) });
      setLoadMsg(`Loaded measurements from ${fmtDate(data[0].created_at)}.`);
      return;
    }

    const { data: fitted } = await supabase.from("legacy_fitted_measurements").select("*").eq("mobile", loadMobile.trim()).limit(1);
    if (fitted && fitted.length > 0) {
      setLegacyResults(fitted);
      setLoadMsg("No profile in the new system — found a genuine fitted measurement from the old system below.");
    } else {
      setLoadMsg("No existing profile or fitted measurement found for that number.");
    }

    const { data: cuttingRefs } = await supabase.from("legacy_orders").select("*").eq("mobile", loadMobile.trim()).order("id", { ascending: false }).limit(5);
    if (cuttingRefs && cuttingRefs.length > 0) {
      setLegacyCuttingRefs(cuttingRefs);
    }
  };

  const [lightbox, setLightbox] = useState(null);
  const [formMsg, setFormMsg] = useState("");
  const [confirmItem, setConfirmItem] = useState(null);   // index being submitted
  const [reopenItem, setReopenItem] = useState(null);     // index being reopened for editing
  const [removeIdx, setRemoveIdx] = useState(null);       // index being removed
  const addBarRef = React.useRef(null);

  const addItem = async () => {
    const model = config.models.find((m) => m.modelNo === pickModel);
    if (!model) return;
    const { data: sizes } = await supabase.from("model_sizes").select("*").eq("model_id", model.id);
    const { data: colors } = await supabase.from("model_colors").select("*").eq("model_id", model.id).order("created_at");
    const cuts = cutTagsOf(model);
    let photoUrl = model.photoUrl;
    if (!photoUrl) {
      const { data: imgs } = await supabase.from("model_images").select("*").eq("model_id", model.id);
      if (imgs && imgs.length) photoUrl = (imgs.find((d) => d.view_label === "Front") || imgs[0]).url;
    }
    setItems((it) => [...it, {
      model: pickModel, modelId: model.id, modelObj: model, photoUrl,
      customFields: model.customFields || [], cuts, cut: cuts[0] || null, notes: "", sizes: sizes || [], overrides: {},
      abayaOption: "Normal", buttonFrom: "", buttonTill: "", additionalRequirements: requirementTagsOf(model), modelReq: requirementTagsOf(model), attachments: [],
      confirmed: false,
      colors: colors || [],
      color: (colors && colors[0] && colors[0].color_name) || "",
      colorSwatch: (colors && colors[0] && colors[0].swatch_url) || "",
    }]);
    setPickModel("");
  };
  const changeItemCut = (idx, cut) => setItems((prev) => prev.map((it, i) => (i !== idx ? it : { ...it, cut, overrides: {} })));
  const setItemCalc = (idx, key, value) => setItems((prev) => prev.map((it, i) => {
    if (i !== idx) return it;
    const clear = value === null || value === undefined || isNaN(value);
    return { ...it, overrides: { ...(it.overrides || {}), [key]: clear ? null : value } };
  }));

  // What an item currently shows: live calculation + the customer's fitted values, then any manual edits on top.
  const itemView = (it) => {
    const b = buildCalc(it.modelObj, it.cut, it.sizes, measurements);
    const calc = { ...b.calc };
    Object.entries(it.overrides || {}).forEach(([k, v]) => { if (v === null) delete calc[k]; else calc[k] = v; });
    return { ...b, calc };
  };
  const setItemNotes = (idx, text) => setItems((prev) => prev.map((it, i) => (i !== idx ? it : { ...it, notes: text })));
  const setItemColor = (idx, v) => { setFormMsg(""); setItems((prev) => prev.map((it, i) => (i !== idx ? it : { ...it, color: v.name, colorSwatch: v.swatch }))); };
  const setItemAttachments = (idx, files) => setItems((prev) => prev.map((it, i) => (i !== idx ? it : { ...it, attachments: files })));
  const setItemAdditional = (idx, v) => setItems((prev) => prev.map((it, i) => (i !== idx ? it : { ...it, additionalRequirements: resolveAdditional(it.additionalRequirements, v) })));
  const setItemAbaya = (idx, v) => setItems((prev) => prev.map((it, i) => (i !== idx ? it : { ...it, abayaOption: v.option, buttonFrom: v.from, buttonTill: v.till })));
  const removeItem = (idx) => setItems((it) => it.filter((_, i) => i !== idx));
  const openIdx = items.findIndex((it) => !it.confirmed);
  const submittedCount = items.filter((it) => it.confirmed).length;
  const [hideMeas, setHideMeas] = useState({});          // item index -> measurements hidden
  const allHidden = submittedCount > 0 && items.every((it, i) => !it.confirmed || hideMeas[i]);

  const itemProblem = (it) => {
    if (it.colors && it.colors.length > 0 && !it.color) return "Choose a colour for this item first.";
    const v = itemView(it);
    const hasRows = [...FITTING_FIELDS.map(([k]) => k), ...(it.customFields || []).map((c) => c.key)].some((k) => v.calc[k] != null);
    if (!hasRows) return "Fill in the customer's fitting measurements above first.";
    return "";
  };
  const submitItem = (idx) => { const p = itemProblem(items[idx]); if (p) { setFormMsg(p); return; } setFormMsg(""); setConfirmItem(idx); };
  const lockItem = (idx) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, confirmed: true } : it)));
    setConfirmItem(null);
    setTimeout(() => addBarRef.current && addBarRef.current.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
  };
  const unlockItem = (idx) => { setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, confirmed: false } : it))); setReopenItem(null); };
  const doRemove = () => { removeItem(removeIdx); setRemoveIdx(null); setHideMeas({}); };
  const customerValid = customer.name.trim() && customer.mobile.trim();

  const uploadSignature = async () => {
    if (!signed || !sigCanvasRef.current) return null;
    const blob = await new Promise((resolve) => sigCanvasRef.current.toBlob(resolve, "image/png"));
    if (!blob) return null;
    const path = `signatures/${Date.now()}.png`;
    const up = await uploadCustomerFile(path, blob, "image/png");
    return up.error ? null : up.ref;
  };

  // Validate, then ask. Nothing is saved until the pop-up is confirmed.
  const requestSave = async (createOrders) => {
    const open = items.findIndex((it) => !it.error && !it.confirmed);
    if (open !== -1) { setFormMsg(`Please submit item ${open + 1} (${items[open].model}) first — or remove it.`); return; }
    const missingColor = items.filter((it) => !it.error && it.colors && it.colors.length > 0 && !it.color);
    const problems = [];
    if (createOrders && missingColor.length > 0) problems.push(`Please choose a colour for: ${missingColor.map((m) => m.model).join(", ")}`);
    if (createOrders && !deliveryDate) { setDateError(true); problems.push("Please choose a delivery date."); }
    if (problems.length > 0) { setFormMsg(problems.join(" ")); return; }
    setFormMsg("");
    // Same lookup the save itself uses (handleSaveRequirement), so the pop-up can't say "new" while updating.
    const { data: ex } = await supabase.from("customer_profiles").select("id").eq("mobile", customer.mobile).limit(1);
    setConfirm({ createOrders, exists: !!(ex && ex.length) });
  };

  const doSave = async (createOrders) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    try {
      const signatureUrl = await uploadSignature();
      const ok = await onSave(customer, measurements, items.map((it) => {
        const v = itemView(it);
        const nb = nearestSizes(v.calc, it.sizes, it.cut)[0];
        return { ...it, calc: v.calc, size: nb ? nb.label : null };
      }), deliveryDate, signatureUrl, createOrders);
      setConfirm(null);
      if (ok && !createOrders) {
        setItems([]);   // saved to the Requirement List — clear them so a second click can't duplicate them
        setLoadMsg("Profile saved — you can add items below.");
      }
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
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
        {legacyResults.length > 0 && (
          <div style={{ border: "1px solid #2F8F46", borderRadius: 6, padding: 12, marginTop: 10, maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4, color: "#2F8F46" }}>GENUINE FITTED MEASUREMENT ON FILE (from old system)</div>
            <div style={{ fontSize: 11, color: "#8a8a8a", marginBottom: 8 }}>Shown for reference — enter the values into the fields above yourself.</div>
            {legacyResults.map((o) => (
              <div key={o.id} style={{ fontSize: 12, textAlign: "left", padding: "4px 0" }}>
                {["shoulder", "chest", "waist", "hips", "armhole", "sleeve_length", "length", "bicep", "wrist", "neck"].filter((k) => o[k]).map((k) => `${k}: ${o[k]}`).join(", ")}
              </div>
            ))}
          </div>
        )}

        {legacyCuttingRefs.length > 0 && (
          <div style={{ border: "1px solid #C9CDD3", borderRadius: 6, padding: 12, marginTop: 10, maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>PAST CUTTING REFERENCE (old system — not a fitted measurement)</div>
            <div style={{ fontSize: 11, color: "#8a8a8a", marginBottom: 8 }}>These are the cutting numbers actually used on past garments — shown for reference only, since they're already adjusted for a specific old model, not her raw body measurement.</div>
            {legacyCuttingRefs.map((o) => (
              <div key={o.id} style={{ borderBottom: "1px solid #E5E5E5", padding: "8px 0", fontSize: 12, textAlign: "left" }}>
                <strong>{o.order_date}</strong> — {o.garment_type || "—"} ({o.model_no || "—"})
                <div style={{ color: "#8a8a8a", fontSize: 11 }}>
                  {["shoulder", "chest", "waist", "hips", "bottom", "armhole", "sleeve_length", "sleeve_open", "length_front", "length_back"].filter((k) => o[k]).map((k) => `${k}: ${o[k]}`).join(", ") || "No usable measurements on this record"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 6 }}>
        <Field label="Customer Name"><input style={inputStyle} value={customer.name} onChange={setC("name")} /></Field>
        <Field label="Mobile No"><input style={inputStyle} value={customer.mobile} onChange={setC("mobile")} /></Field>
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, margin: "14px 0 6px" }}>CUSTOMER FITTING MEASUREMENTS — GENERAL</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 16 }}>
        {FITTING_FIELDS_GENERAL.map(([k, l]) => (
          <Field key={k} label={l}>
            <select value={measurements[k]} onChange={(e) => setMVal(k)(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {MEASUREMENT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
        ))}
      </div>
      <div style={{ fontWeight: 700, fontSize: 13, margin: "14px 0 6px" }}>FOR TROUSER</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {FITTING_FIELDS_TROUSER.map(([k, l]) => (
          <Field key={k} label={l}>
            <select value={measurements[k]} onChange={(e) => setMVal(k)(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {MEASUREMENT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
        ))}
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, margin: "20px 0 10px", borderTop: "1px solid #E5E5E5", paddingTop: 16 }}>ITEMS ({submittedCount} submitted{openIdx !== -1 ? ", 1 open" : ""})</div>
      {submittedCount > 0 && (
        <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 10 }}>
          Calculated measurements follow the customer's fitting measurements above — change those and every item updates.
          <a className="link" style={{ marginLeft: 12 }} onClick={() => setHideMeas(allHidden ? {} : Object.fromEntries(items.map((_, i) => [i, true])))}>{allHidden ? "Show all measurements" : "Hide all measurements"}</a>
        </div>
      )}

      {items.length === 0 && <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 12 }}>No items yet — pick a model below and click "+ Add Item".</div>}

      {items.map((it, idx) => {
        const view = itemView(it);
        const near = nearestSizes(view.calc, it.sizes, it.cut);
        const best = near[0] || null;
        const next = near[1] || null;
        const labelOf = (k) => (FITTING_FIELDS.find(([x]) => x === k) || (it.customFields || []).map((c) => [c.key, c.label]).find(([x]) => x === k) || [k, k])[1];
        const rowKeys = [...FITTING_FIELDS.map(([k]) => k), ...(it.customFields || []).map((c) => c.key)].filter((k) => view.calc[k] != null);
        if (it.confirmed) {
          const rows = rowKeys.map((k) => ({ key: k, label: labelOf(k), final: view.calc[k], fitted: measurements[k] || "", changed: !!measurements[k] && +measurements[k] !== +view.calc[k] }));
          return (
            <SubmittedItemCard key={idx} it={it} idx={idx} nearestLabel={best ? best.label : ""} rows={rows}
              showMeas={!hideMeas[idx]} onToggleMeas={() => setHideMeas((h) => ({ ...h, [idx]: !h[idx] }))} onPhoto={setLightbox}
              canEdit={openIdx === -1} onEdit={() => setReopenItem(idx)} onRemove={() => setRemoveIdx(idx)} />
          );
        }
        return (
          <div key={idx} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, letterSpacing: "0.06em", color: "#D98E2B", marginBottom: 6 }}>ITEM {idx + 1} OF {items.length} — IN PROGRESS</div>
          <div style={{ border: "2px solid #D98E2B", borderRadius: 6, padding: 16, display: "flex", gap: 22, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "0 0 300px", maxWidth: "100%" }}>
              <div onClick={() => it.photoUrl && setLightbox(it.photoUrl)} style={{ cursor: it.photoUrl ? "zoom-in" : "default" }}>
                <ModelThumb model={{ id: it.modelId, photoUrl: it.photoUrl, modelNo: it.model }} width={300} height={400} fit="contain" style={{ maxWidth: "100%" }} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, marginTop: 10, textAlign: "center" }}>{it.model}</div>
              {it.cut && <div style={{ fontSize: 13, color: "#5a5a5a", textAlign: "center" }}>{it.cut}</div>}
              {it.photoUrl && <div className="no-print" style={{ fontSize: 11, color: "#8a8a8a", textAlign: "center", marginTop: 2 }}>Tap photo to enlarge</div>}
              <div style={{ marginTop: 14 }}>
                <ColorPicker center colors={it.colors} value={it.color} onChange={(v) => setItemColor(idx, v)} />
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 320 }}>
              <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
                {it.cuts && it.cuts.length >= 2 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#8a8a8a" }}>Cut:</span>
                    <select value={it.cut || ""} onChange={(e) => changeItemCut(idx, e.target.value)} style={{ ...inputStyle, width: 150, padding: "4px 6px" }}>
                      {it.cuts.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ) : it.cuts && it.cuts.length === 1 ? (
                  <div style={{ fontSize: 12.5 }}><span style={{ color: "#8a8a8a" }}>Cut:</span> <strong>{it.cuts[0]}</strong></div>
                ) : null}
                <a className="link" style={{ color: "#C1302B", marginLeft: "auto" }} onClick={() => setRemoveIdx(idx)}>Remove</a>
              </div>

              {rowKeys.length === 0 ? (
                <div style={{ fontSize: 13, color: "#C1302B" }}>Fill in the customer's fitting measurements above — they'll appear here.</div>
              ) : (
                <table>
                  <thead><tr style={{ fontSize: 12, textAlign: "left" }}>
                    <th>Measurement</th><th>Customer Fitted Measurement</th><th>Calculated Measurement</th>
                  </tr></thead>
                  <tbody>
                    {rowKeys.map((k) => (
                      <tr key={k} style={{ fontSize: 13 }}>
                        <td style={{ padding: "3px 0" }}>{labelOf(k)}</td>
                        <td>{measurements[k] || "—"}</td>
                        <td style={{ fontWeight: 700 }}>
                          <EditableCell value={view.calc[k]} onCommit={(v) => setItemCalc(idx, k, v)} />
                          {view.fittedKeys.includes(k) && (it.overrides || {})[k] === undefined && <span style={{ fontWeight: 400, fontSize: 10.5, color: "#8a8a8a", marginLeft: 6 }}>as fitted</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {best ? (
                <div style={{ marginTop: 8, padding: "8px 10px", background: "#F2F7F3", border: "1px solid #CFE3D4", borderRadius: 4, fontSize: 12.5 }}>
                  <strong>Nearest size: {best.label}</strong> <span style={{ color: "#5a5a5a" }}>(average difference {best.gap.toFixed(1)})</span>
                  {next && <span style={{ color: "#5a5a5a" }}> · next closest: {next.label} ({next.gap.toFixed(1)})</span>}
                </div>
              ) : (it.sizes && it.sizes.length > 0 ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#8a8a8a" }}>No size to compare yet — the size chart has no values for these measurements.</div>
              ) : null)}
              <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 4 }}>
                {view.formulaKeys.length > 0 ? "Rows with a calculation are calculated; the rest are the customer's fitted measurements." : "No calculation set up for this model — values are the customer's fitted measurements."}
              </div>

              <div style={{ marginTop: 12 }}>
                <AbayaOptionField option={it.abayaOption} from={it.buttonFrom} till={it.buttonTill} onChange={(v) => setItemAbaya(idx, v)} />
              </div>

              <div style={{ marginTop: 12 }}>
                <Field label="Additional Requirements">
                  <TagField options={ADDITIONAL_REQ_OPTIONS} value={it.additionalRequirements || ""} onChange={(v) => setItemAdditional(idx, v)} />
                </Field>
                {it.modelReq && <div style={{ fontSize: 11.5, color: "#8a8a8a", marginTop: 4 }}>Filled in from this model's requirements — remove anything this customer doesn't want, or add more.</div>}
              </div>

              <div style={{ marginTop: 12 }}>
                <AttachmentField files={it.attachments} onChange={(files) => setItemAttachments(idx, files)} />
              </div>

              <div style={{ marginTop: 10 }}>
                <Field label="Special Requirements / Notes for this item">
                  <textarea style={{ ...inputStyle, minHeight: 50 }} value={it.notes} onChange={(e) => setItemNotes(idx, e.target.value)} placeholder="Anything specific to this item…" />
                </Field>
              </div>

              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px dashed #C9CDD3", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13.5 }}>Did you get all the requirements for <strong>item {idx + 1}</strong> ({it.model})?</div>
                <button onClick={() => submitItem(idx)} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 6, padding: "11px 22px", fontSize: 14, fontWeight: 700, boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>✔ Submit item {idx + 1}</button>
              </div>
            </div>
          </div>
          </div>
        );
      })}

      {/* Add-item bar — sits BELOW the items, so the next item is always one click away */}
      <div ref={addBarRef} style={{ border: "1px dashed #C9CDD3", borderRadius: 6, padding: 14, marginBottom: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", opacity: openIdx !== -1 ? 0.55 : 1 }}>
        {pickModel && (() => { const m = config.models.find((mm) => mm.modelNo === pickModel); return m ? <ModelThumb model={m} size={56} style={{ borderRadius: 3 }} /> : null; })()}
        <div>
          <div style={label13}>Model</div>
          <select style={{ ...inputStyle, width: 220 }} value={pickModel} disabled={openIdx !== -1} onChange={(e) => setPickModel(e.target.value)}>
            <option value="">Select a model…</option>
            {config.models.map((m) => <option key={m.id} value={m.modelNo}>{m.modelNo}{m.styleName ? ` — ${m.styleName}` : ""}</option>)}
          </select>
        </div>
        {pickModel && (() => { const m = config.models.find((mm) => mm.modelNo === pickModel); return m && m.possibleCuts ? <div style={{ fontSize: 12, color: "#8a8a8a", alignSelf: "flex-end", paddingBottom: 8 }}>Cuts: {m.possibleCuts}</div> : null; })()}
        <button onClick={addItem} disabled={!pickModel || openIdx !== -1} style={{ background: pickModel && openIdx === -1 ? "#3B6FA0" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, alignSelf: "flex-end" }}>+ Add Item</button>
        {openIdx !== -1 && <div style={{ fontSize: 12.5, color: "#C1302B", width: "100%" }}>Submit item {openIdx + 1} ({items[openIdx].model}) before adding another item.</div>}
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      <div style={{ marginTop: 16, maxWidth: 260 }}>
        <Field label="Delivery Date *">
          <input type="date" value={deliveryDate}
            onChange={(e) => { setDeliveryDate(e.target.value); setDateError(false); setFormMsg(""); }}
            style={{ ...inputStyle, width: 220, borderColor: dateError ? "#C1302B" : undefined, borderWidth: dateError ? 2 : undefined }} />
        </Field>
        {dateError && <div style={{ color: "#C1302B", fontSize: 12, marginTop: 4 }}>Delivery date is required to create a job order.</div>}
      </div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #E5E5E5" }}>
        <div style={label13}>Customer Signature — confirms agreement to the measurements & sizes above</div>
        <SignaturePad canvasRef={sigCanvasRef} onDrawn={setSigned} />
        {!signed && <div style={{ fontSize: 11.5, color: "#8a8a8a", marginTop: 4 }}>Required before creating a job order (optional if only saving the profile).</div>}
      </div>

      {formMsg && <div className="no-print" role="alert" style={{ background: "#FDECEC", color: "#C1302B", border: "1px solid #F0B8B8", borderRadius: 4, padding: "10px 12px", fontSize: 13, marginTop: 16, textAlign: "center" }}>{formMsg}</div>}

      <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 22 }}>
        <button disabled={!customerValid || busy} onClick={() => requestSave(false)} style={{ background: customerValid ? "#1A1A1A" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>Save Profile</button>
        <button disabled={!customerValid || items.length === 0 || !signed || busy} onClick={() => requestSave(true)} style={{ background: (customerValid && items.length > 0 && signed) ? "#2F8F46" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>Save & Create Job Order(s)</button>
        <button onClick={onCancel} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "10px 22px", fontWeight: 700, fontSize: 13.5 }}>Cancel</button>
      </div>

      {confirmItem !== null && items[confirmItem] && (
        <ConfirmDialog title={`Submit item ${confirmItem + 1}?`} confirmLabel="Yes, I got everything" onCancel={() => setConfirmItem(null)} onConfirm={() => lockItem(confirmItem)}>
          Did you get all the requirements for <strong>{items[confirmItem].model}</strong>{items[confirmItem].cut ? ` — ${items[confirmItem].cut}` : ""}{items[confirmItem].color ? ` — ${items[confirmItem].color}` : ""}?
          <div style={{ marginTop: 8, color: "#5a5a5a" }}>Once submitted, this item is locked so it can't be changed by accident. You can then add the next item, and reopen this one with Edit if you need to.</div>
        </ConfirmDialog>
      )}
      {reopenItem !== null && items[reopenItem] && (
        <ConfirmDialog title={`Edit item ${reopenItem + 1}?`} confirmLabel="Yes, reopen it" onCancel={() => setReopenItem(null)} onConfirm={() => unlockItem(reopenItem)}>
          {items[reopenItem].model} will open for changes. You'll need to submit it again before adding another item or saving.
        </ConfirmDialog>
      )}
      {removeIdx !== null && items[removeIdx] && (
        <ConfirmDialog title={`Remove item ${removeIdx + 1}?`} confirmLabel="Yes, remove" onCancel={() => setRemoveIdx(null)} onConfirm={doRemove}>
          {items[removeIdx].model}{items[removeIdx].color ? ` — ${items[removeIdx].color}` : ""} will be taken off this requirement.
        </ConfirmDialog>
      )}
      {confirm && !confirm.createOrders && (
        <ConfirmDialog
          title={confirm.exists ? "Update profile?" : "Create new profile?"}
          confirmLabel={confirm.exists ? "Yes, update profile" : "Yes, create profile"}
          busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => doSave(false)}
        >
          {confirm.exists
            ? <>{customer.name} ({customer.mobile}) already has a profile. This will replace her saved fitting measurements with the ones on this form.</>
            : <>This will create a new profile for {customer.name} ({customer.mobile}).</>}
          {items.filter((it) => !it.error).length > 0 && <div style={{ marginTop: 8, color: "#8a8a8a" }}>The {items.filter((it) => !it.error).length} item(s) on this form will also be saved to the Requirement List (no job orders created).</div>}
        </ConfirmDialog>
      )}
      {confirm && confirm.createOrders && (
        <ConfirmDialog
          title={`Create ${items.filter((it) => !it.error).length} job order(s)?`}
          confirmLabel="Yes, create job order(s)"
          busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => doSave(true)}
        >
          <div>This will submit the job order(s) for {customer.name} ({customer.mobile}) and {confirm.exists ? "update her existing profile" : "create her profile"}.</div>
          <ul style={{ margin: "10px 0 0 18px", padding: 0 }}>
            {items.filter((it) => !it.error).map((it, i) => <li key={i}>{it.model}{it.cut ? ` — ${it.cut}` : ""}{it.color ? ` — ${it.color}` : ""}</li>)}
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}

function RequirementsPage({ items, profiles, orders, canDelete, canCreateOrder, onCreateOrder, onDelete, noPII }) {
  const [selected, setSelected] = useState(null);
  const [datePrompt, setDatePrompt] = useState(null);   // { row, date }
  const askCreate = (row) => { if (row.deliveryDate) onCreateOrder(row); else setDatePrompt({ row, date: "" }); };
  const rows = items
    .map((it) => ({ ...it, profile: profiles.find((p) => p.id === it.profileId), order: orders.find((o) => o.id === it.jobOrderId) }))
    .filter((r) => r.profile);
  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ALL REQUIREMENTS</h2>
      {rows.length === 0 ? <div style={{ textAlign: "center", padding: 50, color: "#8a8a8a", fontSize: 14 }}>No requirements saved yet.</div> : (
        <table>
          <thead><tr style={{ borderBottom: "2px solid #1A1A1A", fontSize: 12.5, textAlign: "left" }}>
            {!noPII && <th style={{ padding: "9px 10px" }}>Name</th>}{!noPII && <th style={{ padding: "9px 10px" }}>Mobile</th>}<th style={{ padding: "9px 10px" }}>Model</th>
            <th style={{ padding: "9px 10px" }}>Size</th><th style={{ padding: "9px 10px" }}>Date</th><th style={{ padding: "9px 10px" }}>Job Order No</th><th style={{ padding: "9px 10px" }}></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #E5E5E5", fontSize: 13.5 }}>
                {!noPII && <td style={{ padding: "9px 10px" }}>{r.profile.name}</td>}
                {!noPII && <td style={{ padding: "9px 10px" }}>{r.profile.mobile}</td>}
                <td style={{ padding: "9px 10px" }}>{r.model}</td>
                <td style={{ padding: "9px 10px" }}>{r.recommendedSize || "—"}</td>
                <td style={{ padding: "9px 10px" }}>{fmtDate(r.createdAt)}</td>
                <td style={{ padding: "9px 10px" }} className="mono">{r.order ? r.order.jobOrderNo : <span style={{ color: "#8a8a8a" }}>Not yet</span>}</td>
                <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                  <a className="link" onClick={() => setSelected(r)}>View</a>
                  {!r.order && canCreateOrder && <a className="link" style={{ marginLeft: 10 }} onClick={() => askCreate(r)}>Create Job Order</a>}
                  {canDelete && <a className="link" style={{ marginLeft: 10, color: "#C1302B" }} onClick={() => onDelete(r.id)}>Delete</a>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && <RequirementDetail row={selected} noPII={noPII} onClose={() => setSelected(null)} />}
      {datePrompt && (
        <ConfirmDialog
          title="Delivery date needed" confirmLabel="Create job order"
          confirmDisabled={!datePrompt.date}
          onCancel={() => setDatePrompt(null)}
          onConfirm={() => { onCreateOrder({ ...datePrompt.row, deliveryDate: datePrompt.date }); setDatePrompt(null); }}
        >
          <div style={{ marginBottom: 8 }}>This saved requirement has no delivery date. Choose one to create the job order.</div>
          <input type="date" value={datePrompt.date} onChange={(e) => setDatePrompt((d) => ({ ...d, date: e.target.value }))} style={inputStyle} />
        </ConfirmDialog>
      )}
    </div>
  );
}

function RequirementDetail({ row, onClose, noPII }) {
  const p = row.profile;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "flex-end", zIndex: 400 }} className="no-print" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: 520, maxWidth: "100%", height: "100%", overflowY: "auto", padding: "26px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20 }}>{noPII ? row.model : p.name}</div>
            <div style={{ fontSize: 13.5, color: "#8a8a8a" }}>{noPII ? (p.branch || "") : `${p.mobile} · ${p.branch}`}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "#8a8a8a" }}>×</button>
        </div>

        <div style={{ marginTop: 14, fontSize: 13.5, display: "grid", gap: 4 }}>
          <div><strong>Model:</strong> {row.model}</div>
          <div><strong>Size:</strong> {row.recommendedSize || "—"}</div>
          <div><strong>Cut:</strong> {row.cut || "—"}</div>
          <div><strong>Colour:</strong> {row.color || "—"}</div>
          <div><strong>Abaya Option:</strong> {row.abayaOption || "—"}{row.abayaOption === BUTTON_RANGE ? ` (${row.buttonFrom || "—"} to ${row.buttonTill || "—"})` : ""}</div>
          <div><strong>Additional Requirements:</strong> {row.additionalRequirements || "—"}</div>
          <div style={{ marginTop: 8 }}><strong>Attachments:</strong> <AttachmentGallery files={row.attachments} /></div>
          <div><strong>Date:</strong> {fmtDate(row.createdAt)}</div>
          <div><strong>Job Order:</strong> {row.order ? row.order.jobOrderNo : "Not created yet"}</div>
          {row.notes && <div><strong>Notes:</strong> {row.notes}</div>}
        </div>

        <div style={{ fontWeight: 700, fontSize: 12.5, margin: "16px 0 6px" }}>MEASUREMENTS & COMPUTED DIFFERENCE</div>
        {row.calculated && Object.keys(row.calculated).length > 0 ? (
          <table>
            <thead><tr style={{ fontSize: 12, textAlign: "left" }}><th>Measurement</th><th>Customer Fitted Measurement</th><th>Calculated Measurement</th></tr></thead>
            <tbody>
              {Object.entries(row.calculated).map(([k, v]) => (
                <tr key={k} style={{ fontSize: 13 }}>
                  <td>{(ALL_MEASURE_FIELDS.find(([x]) => x === k) || [k, k.replace(/^custom_/, "").replace(/_/g, " ")])[1]}</td>
                  <td>{p.measurements?.[k] || "—"}</td>
                  <td style={{ fontWeight: 700 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
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
        )}

        {!noPII && <div style={{ fontWeight: 700, fontSize: 12.5, margin: "18px 0 6px" }}>CUSTOMER SIGNATURE</div>}
        {noPII ? null : p.signature_url ? <SecureImg src={p.signature_url} alt="signature" style={{ border: "1px solid #E5E5E5", maxWidth: "100%", background: "#fff" }} /> : <div style={{ fontSize: 13, color: "#8a8a8a" }}>No signature captured for this profile.</div>}
      </div>
    </div>
  );
}

function ProjectsUnderConstruction() {
  return (
    <div style={{ maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
      <div style={{ fontSize: 34, marginBottom: 12 }}>🚧</div>
      <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Projects — Under Construction</div>
      <div style={{ fontSize: 13.5, color: "#8a8a8a" }}>This module is still being worked on and isn't ready for regular use yet. Check back soon.</div>
    </div>
  );
}

/* ================= Analytics ================= */

const ANALYTICS_RANGES = [["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last 12 months"], ["all", "All time"]];
const baseModelOf = (m) => (m || "").trim().toUpperCase().split("-")[0].trim();
const isoDay = (d) => d.toISOString().slice(0, 10);
const pctChange = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const avgOf = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function Trend({ cur, prev, hide }) {
  const p = pctChange(cur, prev);
  if (hide || p === null) return null;
  const up = p >= 0;
  return <span style={{ color: up ? "#2F8F46" : "#C1302B", fontSize: 11.5, fontWeight: 700 }}>{up ? "▲" : "▼"} {Math.abs(p)}%</span>;
}

function KpiTile({ label, value, sub }) {
  return (
    <div style={{ ...cardStyle, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: "#8a8a8a", letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, margin: "4px 0 2px", fontFamily: F.display }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "#8a8a8a", minHeight: 16 }}>{sub}</div>
    </div>
  );
}

function ACard({ title, note, children }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: note ? 2 : 12 }}>{title}</div>
      {note && <div style={{ fontSize: 11, color: "#8a8a8a", marginBottom: 12 }}>{note}</div>}
      {children}
    </div>
  );
}

function BarList({ rows, color }) {
  if (!rows.length) return <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No data for this selection.</div>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 2, gap: 8 }}>
            <span>{r.label}</span>
            <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{r.value}{r.sub ? <span style={{ fontWeight: 500, marginLeft: 8 }}>{r.sub}</span> : null}</span>
          </div>
          <div style={{ height: 7, background: "#EEF0F2", borderRadius: 4 }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", background: color || "#1A1A1A", borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthBars({ rows }) {
  if (!rows.length) return <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No data for this selection.</div>;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 150, overflowX: "auto", paddingBottom: 2 }}>
      {rows.map((r) => (
        <div key={r.month} title={`${r.month}: ${r.n} orders`} style={{ flex: "1 0 16px", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }}>
          <div style={{ fontSize: 8.5, color: "#5a5a5a", marginBottom: 2 }}>{r.n}</div>
          <div style={{ width: "100%", height: `${(r.n / max) * 100}%`, background: "#3B6FA0", borderRadius: "2px 2px 0 0", minHeight: 1 }} />
          <div style={{ fontSize: 8.5, color: "#8a8a8a", marginTop: 3, whiteSpace: "nowrap" }}>{r.month.slice(2)}</div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsPage({ orders, models }) {
  const [range, setRange] = useState("90");
  const [source, setSource] = useState("all");
  const [legacy, setLegacy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const now = new Date();
  const toDay = isoDay(now);
  const days = range === "all" ? null : parseInt(range, 10);
  const fromDay = days ? isoDay(new Date(now.getTime() - (days - 1) * 86400000)) : "2000-01-01";
  const fromMs = new Date(fromDay + "T00:00:00").getTime();
  const toMs = now.getTime();
  const spanMs = toMs - fromMs;

  const newCur = useMemo(() => orders.filter((o) => { const t = new Date(o.createdAt).getTime(); return t >= fromMs && t <= toMs; }), [orders, range]); // eslint-disable-line
  const extraMobiles = useMemo(() => (source === "all" ? newCur.map((o) => (o.mobile || "").trim()).filter((m) => m.length >= 6) : []), [newCur, source]);

  useEffect(() => {
    if (source === "new") { setLoading(false); return; }
    setLoading(true); setErr("");
    supabase.rpc("analytics_legacy", { p_from: fromDay, p_to: toDay, p_extra_mobiles: extraMobiles }).then(({ data, error }) => {
      if (error) setErr(error.message); else setLegacy(data);
      setLoading(false);
    });
  }, [range, source, newCur]); // eslint-disable-line

  const nw = useMemo(() => {
    const prevOrders = range === "all" ? [] : orders.filter((o) => { const t = new Date(o.createdAt).getTime(); return t >= fromMs - spanMs - 1 && t < fromMs; });
    const hist = (o, prefix) => { const h = (o.history || []).find((x) => (x.note || "").startsWith(prefix)); return h ? new Date(h.at).getTime() : null; };
    const has = (o, prefix) => (o.history || []).some((x) => (x.note || "").startsWith(prefix));
    const prevByModel = {};
    prevOrders.forEach((o) => { const k = baseModelOf(o.model); if (k) prevByModel[k] = (prevByModel[k] || 0) + 1; });
    const modelMap = {}, funnel = {}, branch = {}, seller = {}, monthly = {}, category = {}, cust = {};
    const prodAll = [], turnAll = [];
    let rejected = 0, returned = 0, onTime = 0, dueDelivered = 0;
    newCur.forEach((o) => {
      const k = baseModelOf(o.model) || "(none)";
      const m = modelMap[k] || (modelMap[k] = { model: k, orders: 0, rejected: 0, returned: 0, prodDays: [] });
      m.orders++;
      if (has(o, "Job Rejected")) { m.rejected++; rejected++; }
      if (has(o, "Job Returned")) { m.returned++; returned++; }
      const a = hist(o, "Job In Process"), b = hist(o, "Job Completed");
      if (a && b && b >= a) { const d = (b - a) / 86400000; m.prodDays.push(d); prodAll.push(d); }
      const dl = hist(o, "Delivered");
      if (dl) {
        turnAll.push((dl - new Date(o.createdAt).getTime()) / 86400000);
        if (o.deliveryDate) { dueDelivered++; if (dl <= new Date(o.deliveryDate + "T23:59:59").getTime()) onTime++; }
      }
      funnel[o.status] = (funnel[o.status] || 0) + 1;
      if (o.branch) branch[o.branch] = (branch[o.branch] || 0) + 1;
      if (o.preparedBy) seller[o.preparedBy] = (seller[o.preparedBy] || 0) + 1;
      const mk = (o.createdAt || "").slice(0, 7); if (mk) monthly[mk] = (monthly[mk] || 0) + 1;
      const cat = (models.find((x) => baseModelOf(x.modelNo) === k) || {}).category; if (cat) category[cat] = (category[cat] || 0) + 1;
      const mob = (o.mobile || "").trim();
      if (mob.length >= 6) cust[mob] = { name: o.name, n: ((cust[mob] || {}).n || 0) + 1 };
    });
    const todayStart = new Date(toDay + "T00:00:00").getTime();
    const overdue = orders
      .filter((o) => o.deliveryDate && o.status !== "delivered" && new Date(o.deliveryDate + "T23:59:59").getTime() < todayStart)
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
    const dormant = models.filter((m) => !newCur.some((o) => baseModelOf(o.model) === baseModelOf(m.modelNo)));
    return {
      total: newCur.length, prevCount: prevOrders.length, prevByModel, modelMap, funnel, branch, seller, monthly, category, cust,
      rejectRate: newCur.length ? Math.round((rejected / newCur.length) * 100) : null,
      returnRate: newCur.length ? Math.round((returned / newCur.length) * 100) : null,
      avgProd: avgOf(prodAll), avgTurn: avgOf(turnAll),
      onTimePct: dueDelivered ? Math.round((onTime / dueDelivered) * 100) : null,
      inProduction: (funnel.job_in_process || 0) + (funnel.job_return_in_process || 0),
      overdue, dormant,
    };
  }, [orders, models, newCur, range]); // eslint-disable-line

  const useOld = source !== "new" && legacy;
  const useNew = source !== "old";
  const total = (useOld ? legacy.total : 0) + (useNew ? nw.total : 0);
  const prevTotal = (useOld ? legacy.prev_total : 0) + (useNew ? nw.prevCount : 0);
  const hideTrend = range === "all";

  let customers, repeat;
  if (source === "new") {
    const vals = Object.values(nw.cust);
    customers = vals.length; repeat = vals.filter((c) => c.n >= 2).length;
  } else if (legacy) { customers = legacy.customers; repeat = legacy.repeat_customers; }

  // Top models (merged)
  const modelMerge = {};
  if (useOld) legacy.top_models.forEach((r) => { modelMerge[r.model] = { model: r.model, orders: r.orders, prev: r.prev_orders }; });
  if (useNew) Object.values(nw.modelMap).forEach((r) => {
    if (r.model === "(none)") return;
    const e = modelMerge[r.model] || (modelMerge[r.model] = { model: r.model, orders: 0, prev: 0 });
    e.orders += r.orders; e.prev += nw.prevByModel[r.model] || 0;
  });
  const topModels = Object.values(modelMerge).sort((a, b) => b.orders - a.orders).slice(0, 12);

  // Monthly (merged)
  const monthMerge = {};
  if (useOld) legacy.monthly.forEach((r) => { monthMerge[r.month] = (monthMerge[r.month] || 0) + r.n; });
  if (useNew) Object.entries(nw.monthly).forEach(([m, n]) => { monthMerge[m] = (monthMerge[m] || 0) + n; });
  const monthly = Object.entries(monthMerge).sort((a, b) => a[0].localeCompare(b[0])).map(([month, n]) => ({ month, n }));

  const verdict = (m) => {
    if (m.orders < 3) return { text: "Not enough data yet", color: "#8a8a8a" };
    const rr = (m.returned / m.orders) * 100, rj = (m.rejected / m.orders) * 100;
    if (rr >= 20 || rj >= 20) return { text: "Needs attention", color: "#C1302B" };
    if (rr <= 5 && rj <= 5) return { text: "Performing well", color: "#2F8F46" };
    return { text: "OK", color: "#D98E2B" };
  };
  const healthRows = Object.values(nw.modelMap).filter((m) => m.model !== "(none)").sort((a, b) => b.orders - a.orders).slice(0, 15);
  const pill = (active) => ({ padding: "6px 14px", fontSize: 12, border: "1px solid " + (active ? "#1A1A1A" : "#DDE1E7"), borderRadius: 14, cursor: "pointer", background: active ? "#1A1A1A" : "#fff", color: active ? "#fff" : "#1A1A1A" });

  return (
    <div style={{ maxWidth: 1250, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 16 }}>ANALYTICS</h2>

      <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {ANALYTICS_RANGES.map(([k, l]) => <button key={k} style={pill(range === k)} onClick={() => setRange(k)}>{l}</button>)}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["all", "Old + New"], ["old", "Old system"], ["new", "New system"]].map(([k, l]) => <button key={k} style={pill(source === k)} onClick={() => setSource(k)}>{l}</button>)}
        </div>
      </div>

      {err && <div style={{ color: "#C1302B", fontSize: 13, textAlign: "center", marginBottom: 14 }}>Couldn't load old-system data: {err}</div>}
      {loading && source !== "new" && <div style={{ textAlign: "center", color: "#8a8a8a", fontSize: 13, marginBottom: 14 }}>Crunching numbers…</div>}
      {source !== "new" && legacy && legacy.total === 0 && range === "all" && (
        <div style={{ textAlign: "center", color: "#8a8a8a", fontSize: 12.5, marginBottom: 14 }}>No old-system data found — make sure legacy_order_stats has been imported.</div>
      )}

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
        <KpiTile label="Orders" value={total.toLocaleString()} sub={<>{!hideTrend && <Trend cur={total} prev={prevTotal} />} {!hideTrend && prevTotal > 0 ? " vs previous period" : ""}</>} />
        <KpiTile label="Active customers" value={customers != null ? customers.toLocaleString() : "—"} sub={customers ? `${Math.round((repeat / customers) * 100)}% ordered more than once` : ""} />
        {source !== "new" && legacy && <KpiTile label="Avg planned lead time" value={legacy.avg_lead_days != null ? `${legacy.avg_lead_days} d` : "—"} sub="order date → delivery date (old system)" />}
        {useNew && <KpiTile label="Avg actual turnaround" value={nw.avgTurn != null ? `${nw.avgTurn.toFixed(1)} d` : "—"} sub="created → delivered (new system)" />}
        {useNew && <KpiTile label="In production now" value={nw.inProduction} sub="new-system orders being worked on" />}
        {useNew && <KpiTile label="On-time delivery" value={nw.onTimePct != null ? `${nw.onTimePct}%` : "—"} sub={`${nw.overdue.length} order(s) overdue right now`} />}
        {useNew && <KpiTile label="Rejected / returned" value={nw.rejectRate != null ? `${nw.rejectRate}% / ${nw.returnRate}%` : "—"} sub="share of new-system orders" />}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginBottom: 16 }}>
        <ACard title="Top models" note="Colour variants are grouped under one base model; placeholder model B000 is excluded. Arrows compare with the previous period of the same length.">
          <BarList color="#1A1A1A" rows={topModels.map((m) => ({
            label: m.model, value: m.orders,
            sub: (
              <>
                <Trend cur={m.orders} prev={m.prev} hide={hideTrend} />
                {!hideTrend && m.orders >= 5 && m.prev > 0 && pctChange(m.orders, m.prev) >= 50 ? <span style={{ marginLeft: 6, color: "#D98E2B", fontWeight: 700 }}>🔥 rising</span> : null}
                {!hideTrend && m.orders >= 5 && m.prev === 0 ? <span style={{ marginLeft: 6, color: "#3B6FA0", fontWeight: 700 }}>✨ new</span> : null}
              </>
            ),
          }))} />
        </ACard>

        <ACard title="Orders over time" note="Monthly order volume — good for spotting busy and quiet seasons.">
          <MonthBars rows={monthly} />
        </ACard>
      </div>

      {useNew && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>Model health (new system)</div>
          <div style={{ fontSize: 11, color: "#8a8a8a", marginBottom: 12 }}>A model is "going great" when it sells AND rarely gets rejected by production or returned by the showroom. Needs at least 3 orders for a verdict.</div>
          {healthRows.length === 0 ? <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No new-system orders in this period yet.</div> : (
            <table>
              <thead><tr style={{ borderBottom: "2px solid #1A1A1A", fontSize: 12, textAlign: "left" }}>
                <th style={{ padding: "7px 8px" }}>Model</th><th style={{ padding: "7px 8px" }}>Orders</th><th style={{ padding: "7px 8px" }}>Rejected</th>
                <th style={{ padding: "7px 8px" }}>Returned</th><th style={{ padding: "7px 8px" }}>Avg production</th><th style={{ padding: "7px 8px" }}>Verdict</th>
              </tr></thead>
              <tbody>
                {healthRows.map((m) => {
                  const v = verdict(m);
                  return (
                    <tr key={m.model} style={{ borderBottom: "1px solid #E5E5E5", fontSize: 12.5 }}>
                      <td style={{ padding: "7px 8px", fontWeight: 600 }}>{m.model}</td>
                      <td style={{ padding: "7px 8px" }}>{m.orders}</td>
                      <td style={{ padding: "7px 8px" }}>{m.rejected} ({Math.round((m.rejected / m.orders) * 100)}%)</td>
                      <td style={{ padding: "7px 8px" }}>{m.returned} ({Math.round((m.returned / m.orders) * 100)}%)</td>
                      <td style={{ padding: "7px 8px" }}>{avgOf(m.prodDays) != null ? `${avgOf(m.prodDays).toFixed(1)} d` : "—"}</td>
                      <td style={{ padding: "7px 8px", color: v.color, fontWeight: 700 }}>{v.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 16 }}>
        {source !== "new" && legacy && (
          <ACard title="Garment type mix (old system)">
            <BarList color="#3B6FA0" rows={legacy.garment_mix.map((g) => ({ label: g.label, value: g.n }))} />
          </ACard>
        )}
        {useNew && (
          <ACard title="Category mix (new system)" note="From each model's catalog category.">
            <BarList color="#3B6FA0" rows={Object.entries(nw.category).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
          </ACard>
        )}
        {source !== "new" && legacy && (
          <ACard title="Tailor / master workload (old system)">
            <BarList color="#2F8F46" rows={legacy.masters.map((g) => ({ label: g.label, value: g.n }))} />
          </ACard>
        )}
        {useNew && (
          <ACard title="Orders by branch (new system)">
            <BarList color="#2F8F46" rows={Object.entries(nw.branch).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
          </ACard>
        )}
        {useNew && (
          <ACard title="Sales leaderboard (new system)">
            <BarList color="#D98E2B" rows={Object.entries(nw.seller).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }))} />
          </ACard>
        )}
        {useNew && (
          <ACard title="Order pipeline (new system)" note="Where this period's orders currently sit.">
            <BarList color="#1A1A1A" rows={Object.entries(nw.funnel).sort((a, b) => b[1] - a[1]).map(([k, value]) => ({ label: (STATUS[k] || {}).label || k, value }))} />
          </ACard>
        )}
        <ACard title="Top customers" note={source === "new" ? "By number of orders (new system)." : "By number of orders (old system data)."}>
          <BarList color="#1A1A1A" rows={
            (source === "new"
              ? Object.entries(nw.cust).sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([m, c]) => ({ label: `${c.name || m}`, value: c.n }))
              : (legacy ? legacy.top_customers.map((c) => ({ label: c.name || c.mobile, value: c.orders })) : []))
          } />
        </ACard>
      </div>

      {useNew && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginBottom: 16 }}>
          <ACard title={`Overdue orders (${nw.overdue.length})`} note="Past their delivery date and not yet delivered.">
            {nw.overdue.length === 0 ? <div style={{ fontSize: 12.5, color: "#2F8F46" }}>Nothing overdue. 🎉</div> : nw.overdue.slice(0, 10).map((o) => (
              <div key={o.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid #E5E5E5" }}>
                <span><span className="mono">{o.jobOrderNo}</span> · {o.name} · {o.model}</span>
                <span style={{ color: "#C1302B", fontWeight: 700 }}>due {fmtDate(o.deliveryDate)}</span>
              </div>
            ))}
          </ACard>
          <ACard title={`Catalog models with no orders (${nw.dormant.length})`} note="Styles in your catalog nobody has ordered in this period — candidates to promote, rework, or retire.">
            {nw.dormant.length === 0 ? <div style={{ fontSize: 12.5, color: "#2F8F46" }}>Every catalog model has orders.</div> : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {nw.dormant.slice(0, 30).map((m) => <span key={m.id} style={{ background: "#EEF0F2", border: "1px solid #C9CDD3", borderRadius: 12, padding: "3px 10px", fontSize: 12 }}>{m.modelNo}</span>)}
              </div>
            )}
          </ACard>
        </div>
      )}
    </div>
  );
}

// One-time move of customer signatures / order attachments from the old public bucket into the private one.
function MigrateFilesCard() {
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const add = (m) => setLog((l) => [...l, m]);
  const PUB = /\/storage\/v1\/object\/public\/attachments\/(.+)$/;
  const isCustomerPath = (p) => p.startsWith("signatures/") || p.startsWith("order-files/");

  const copyToPrivate = async (path, blob) => {
    const { error } = await supabase.storage.from(PRIVATE_BUCKET).upload(path, blob, { contentType: blob.type });
    if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  };
  // copy one old public file into the private bucket; returns the new reference, or null if it isn't a customer file
  const moveOne = async (url) => {
    const m = PUB.exec(url || "");
    if (!m) return null;
    const path = decodeURIComponent(m[1]);
    if (!isCustomerPath(path)) return null;
    const res = await fetch(url);
    if (!res.ok) throw new Error("couldn't download " + path);
    await copyToPrivate(path, await res.blob());
    return { path, ref: PRIVATE_PREFIX + path };
  };

  const run = async () => {
    setAsking(false); setBusy(true); setLog([]);
    const oldPaths = new Set();
    try {
      const { data: profs, error: pe } = await supabase.from("customer_profiles").select("id, signature_url").like("signature_url", "%/object/public/attachments/signatures/%");
      if (pe) throw pe;
      let n = 0;
      for (const p of profs || []) {
        const r = await moveOne(p.signature_url);
        if (r) {
          const { error } = await supabase.from("customer_profiles").update({ signature_url: r.ref }).eq("id", p.id);
          if (error) throw error;
          oldPaths.add(r.path); n++;
        }
      }
      add(`Signatures moved: ${n}`);

      for (const table of ["job_orders", "requirement_items"]) {
        const { data: rows, error: re } = await supabase.from(table).select("id, attachments").neq("attachments", "[]");
        if (re) throw re;
        let moved = 0;
        for (const row of rows || []) {
          let changed = false;
          const next = [];
          for (const f of row.attachments || []) {
            const r = await moveOne(f.url);
            if (r) { next.push({ ...f, url: r.ref }); oldPaths.add(r.path); changed = true; } else next.push(f);
          }
          if (changed) {
            const { error } = await supabase.from(table).update({ attachments: next }).eq("id", row.id);
            if (error) throw error;
            moved++;
          }
        }
        add(`${table}: ${moved} record(s) updated`);
      }

      // Files no record points at (left over from abandoned or test saves) are public too — move them as well.
      let orphans = 0;
      for (const folder of ["signatures", "order-files"]) {
        const { data: objs, error: le } = await supabase.storage.from("attachments").list(folder, { limit: 1000 });
        if (le) throw le;
        for (const o of objs || []) {
          if (!o.name || o.name.startsWith(".") || o.id === null) continue;
          const path = `${folder}/${o.name}`;
          if (oldPaths.has(path)) continue;
          const { data: blob, error: de } = await supabase.storage.from("attachments").download(path);
          if (de || !blob) throw new Error("couldn't download " + path);
          await copyToPrivate(path, blob);
          oldPaths.add(path); orphans++;
        }
      }
      add(`Unreferenced files moved: ${orphans}`);

      // only after every record points at the private copy do the public copies get deleted
      if (oldPaths.size) {
        const { error } = await supabase.storage.from("attachments").remove([...oldPaths]);
        add(error ? "Couldn't delete some old public copies: " + error.message : `Old public copies deleted: ${oldPaths.size}`);
      }
      add("Done.");
    } catch (e) { add("Stopped: " + (e.message || e) + " — nothing was deleted; you can run it again."); }
    setBusy(false);
  };

  return (
    <div style={{ ...cardStyle, marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>PRIVATE CUSTOMER FILES</div>
      <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 12 }}>One-time step: moves the signatures and order attachments saved before this update into the private folder, then deletes the old public copies. Safe to run again.</div>
      <button onClick={() => setAsking(true)} disabled={busy} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "9px 16px", fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>{busy ? "Moving…" : "Move existing files to private storage"}</button>
      {log.map((l, i) => <div key={i} style={{ fontSize: 12.5, marginTop: 6 }}>{l}</div>)}
      {asking && (
        <ConfirmDialog title="Move existing customer files?" confirmLabel="Yes, move them" onCancel={() => setAsking(false)} onConfirm={run}>
          Every existing customer signature and order attachment moves into the private folder. It can take a minute.
        </ConfirmDialog>
      )}
    </div>
  );
}

function StaffPicker({ staff, selected, onChange }) {
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div>
      <div style={{ display: "flex", gap: 14, marginBottom: 8, fontSize: 12 }}>
        <a className="link" onClick={() => onChange(staff.map((u) => u.id))}>Select all</a>
        <a className="link" onClick={() => onChange([])}>Clear</a>
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #E5E5E5", borderRadius: 4 }}>
        {staff.map((u) => (
          <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid #F0F0F0", cursor: "pointer", fontSize: 13.5 }}>
            <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
            <span style={{ flex: 1 }}>{u.name}</span>
            <span style={{ fontSize: 11.5, color: "#8a8a8a" }}>{ROLE_LABEL[u.role]}{u.branch ? ` · ${u.branch}` : ""}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function PinsPage({ users, branches, session }) {
  const staff = users.filter((u) => u.role === "sales" || u.role === "production");
  const [pins, setPins] = useState({});
  const [devices, setDevices] = useState([]);
  const [log, setLog] = useState([]);
  const [dialog, setDialog] = useState(null);      // { user, pin, error, busy }
  const [label, setLabel] = useState("");
  const [branch, setBranch] = useState("");
  const [msg, setMsg] = useState("");
  const [myHash, setMyHash] = useState("");
  const [staffDialog, setStaffDialog] = useState(null);   // { device, selected }
  const [newStaff, setNewStaff] = useState([]);            // list chosen while approving a new device
  const [subCounts, setSubCounts] = useState({});         // lock-screen alert subscriptions per device

  const load = async () => {
    const st = await pinAuth({ action: "pin-status" });
    if (st.data) setPins(Object.fromEntries(st.data.pins.map((p) => [p.user_id, p])));
    const { data: d } = await supabase.from("trusted_devices").select("*").order("created_at");
    setDevices(d || []);
    const { data: l } = await supabase.from("pin_login_log").select("*").order("created_at", { ascending: false }).limit(20);
    setLog(l || []);
    const { data: subs } = await supabase.from("push_subscriptions").select("device_id");
    setSubCounts((subs || []).reduce((m, x) => ({ ...m, [x.device_id]: (m[x.device_id] || 0) + 1 }), {}));
  };
  useEffect(() => {
    load();
    const t = localStorage.getItem(DEVICE_KEY);
    if (t) sha256Hex(t).then(setMyHash);
  }, []); // eslint-disable-line

  const randomPin = () => {
    for (;;) {
      const p = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
      if (!/^(\d)\1{5}$/.test(p) && !["123456", "654321", "012345", "123123", "121212"].includes(p)) return p;
    }
  };
  const savePin = async () => {
    setDialog((d) => ({ ...d, busy: true, error: "" }));
    const { error } = await pinAuth({ action: "set-pin", user_id: dialog.user.id, pin: dialog.pin });
    if (error) { setDialog((d) => ({ ...d, busy: false, error: error === "network" ? "Couldn't save the PIN." : error })); return; }
    setMsg(`PIN saved for ${dialog.user.name}.`); setDialog(null); load();
  };
  const [ask, setAsk] = useState(null);           // { title, text, label, run }
  const removePin = (u) => setAsk({
    title: `Remove ${u.name}'s PIN?`, text: "They'll have to use email & password.", label: "Yes, remove PIN",
    run: async () => { await pinAuth({ action: "clear-pin", user_id: u.id }); setMsg(`PIN removed for ${u.name}.`); load(); },
  });
  const saveStaff = async () => {
    const { error } = await supabase.from("trusted_devices")
      .update({ allowed_user_ids: staffDialog.selected.length ? staffDialog.selected : null })
      .eq("id", staffDialog.device.id);
    if (error) { setMsg("Couldn't save: " + error.message); return; }
    setMsg(`Updated who appears on "${staffDialog.device.label}".`); setStaffDialog(null); load();
  };
  const approveDevice = async () => {
    if (!label.trim()) { setMsg('Give this device a name first, e.g. "Al Waab iPad".'); return; }
    const token = crypto.randomUUID() + crypto.randomUUID();
    const hash = await sha256Hex(token);
    const { error } = await supabase.from("trusted_devices").insert({ label: label.trim(), branch: branch || null, token_hash: hash, created_by: session.name, allowed_user_ids: newStaff.length ? newStaff : null });
    if (error) { setMsg("Couldn't approve this device: " + error.message); return; }
    localStorage.setItem(DEVICE_KEY, token); setMyHash(hash); setLabel(""); setNewStaff([]);
    setMsg("This device is now approved for PIN login."); load();
  };
  const revoke = (d) => setAsk({
    title: `Stop trusting "${d.label}"?`, text: "PIN login will stop working on it.", label: "Yes, revoke",
    run: async () => {
      const { error } = await supabase.from("trusted_devices").delete().eq("id", d.id);
      if (error) { setMsg("Couldn't revoke the device: " + error.message); return; }
      if (d.token_hash === myHash) { localStorage.removeItem(DEVICE_KEY); setMyHash(""); }
      setMsg(`"${d.label}" is no longer trusted.`); load();
    },
  });

  const th = { textAlign: "left", padding: "7px 8px", fontSize: 12, borderBottom: "2px solid #1A1A1A" };
  const td = { padding: "8px", fontSize: 13, borderBottom: "1px solid #E5E5E5" };
  const myDeviceApproved = devices.some((d) => d.token_hash === myHash);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>PIN & DEVICES</h2>
      {msg && <div style={{ textAlign: "center", fontSize: 13, color: "#2F8F46", marginBottom: 14 }}>{msg}</div>}

      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>STAFF PINS</div>
        <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 12 }}>6 digits, for Sales and Production only. A PIN is never shown again after it's saved — reset it if someone forgets. Five wrong tries lock that person for 5 minutes.</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Name</th><th style={th}>Role</th><th style={th}>Branch</th><th style={th}>PIN</th><th style={th}></th></tr></thead>
          <tbody>
            {staff.map((u) => {
              const p = pins[u.id];
              const locked = p && p.locked_until && new Date(p.locked_until) > new Date();
              return (
                <tr key={u.id}>
                  <td style={td}>{u.name}</td><td style={td}>{ROLE_LABEL[u.role]}</td><td style={td}>{u.branch || "—"}</td>
                  <td style={{ ...td, color: locked ? "#C1302B" : p ? "#2F8F46" : "#8a8a8a", fontWeight: 600 }}>{locked ? "Locked" : p ? "Set" : "Not set"}</td>
                  <td style={td}>
                    <a className="link" onClick={() => setDialog({ user: u, pin: "", error: "", busy: false })}>{p ? "Reset PIN" : "Set PIN"}</a>
                    {p && <a className="link" style={{ marginLeft: 14, color: "#C1302B" }} onClick={() => removePin(u)}>Remove</a>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>APPROVED DEVICES</div>
        <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 12 }}>PIN login only works on devices approved here. Log in on the showroom iPad with an admin password, approve it, then log out. If you pick a branch, only that branch's salespeople show on its screen.</div>
        {devices.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
            <thead><tr><th style={th}>Device</th><th style={th}>Branch</th><th style={th}>Staff on this device</th><th style={th}>Auto-lock</th><th style={th}>Alerts</th><th style={th}>Approved</th><th style={th}>Last used</th><th style={th}></th></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td style={td}>{d.label}{d.token_hash === myHash && <span style={{ marginLeft: 8, fontSize: 11, color: "#2F8F46", fontWeight: 700 }}>THIS DEVICE</span>}</td>
                  <td style={td}>{d.branch || "All"}</td>
                  <td style={td}>
                    {d.allowed_user_ids && d.allowed_user_ids.length
                      ? d.allowed_user_ids.map((id) => (users.find((u) => u.id === id) || {}).name).filter(Boolean).join(", ")
                      : <span style={{ color: "#8a8a8a" }}>Everyone (by branch rule)</span>}
                  </td>
                  <td style={td}>
                    <select value={d.idle_minutes ?? 2} style={{ ...inputStyle, width: 90, padding: "3px 6px" }}
                      onChange={async (e) => {
                        const { error } = await supabase.from("trusted_devices").update({ idle_minutes: parseInt(e.target.value, 10) }).eq("id", d.id);
                        if (error) setMsg("Couldn't change auto-lock: " + error.message);
                        load();
                      }}>
                      <option value={0}>Off</option><option value={1}>1 min</option><option value={2}>2 min</option><option value={3}>3 min</option><option value={5}>5 min</option><option value={10}>10 min</option>
                    </select>
                  </td>
                  <td style={{ ...td, color: subCounts[d.id] ? "#2F8F46" : "#8a8a8a", fontWeight: 600 }}>{subCounts[d.id] ? "On" : "Off"}</td>
                  <td style={td}>{fmtDate(d.created_at)}</td><td style={td}>{d.last_used_at ? fmtDateTime(d.last_used_at) : "—"}</td>
                  <td style={td}>
                    <a className="link" style={{ marginRight: 14 }} onClick={() => setStaffDialog({ device: d, selected: d.allowed_user_ids || [] })}>Choose staff</a>
                    <a className="link" style={{ color: "#C1302B" }} onClick={() => revoke(d)}>Revoke</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {myDeviceApproved ? (
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#2F8F46" }}>✓ This device is approved.</span>
            <button onClick={async () => { const r = await enableAlerts(); setMsg(r.ok ? "Lock-screen alerts are on for this device." : alertMsg(r.error)); load(); }}
              style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 14px", fontSize: 12.5, fontWeight: 700 }}>🔔 Turn on lock-screen alerts</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><div style={label13}>Name this device</div><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder='e.g. "Al Waab iPad"' style={{ ...inputStyle, width: 220 }} /></div>
            <div><div style={label13}>Branch</div>
              <select value={branch} onChange={(e) => setBranch(e.target.value)} style={{ ...inputStyle, width: 170 }}>
                <option value="">All branches</option>{branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select></div>
            <div style={{ width: "100%" }}>
              <div style={label13}>Who can sign in on this device? (leave empty for everyone)</div>
              <StaffPicker staff={staff} selected={newStaff} onChange={setNewStaff} />
            </div>
            <button onClick={approveDevice} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "9px 16px", fontSize: 13, fontWeight: 700 }}>Approve this device</button>
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>RECENT PIN SIGN-INS</div>
        {log.length === 0 ? <div style={{ fontSize: 13, color: "#8a8a8a" }}>Nothing yet.</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td style={td}>{fmtDateTime(l.created_at)}</td>
                  <td style={td}>{(users.find((u) => u.id === l.user_id) || {}).name || "—"}</td>
                  <td style={td}>{(devices.find((d) => d.id === l.device_id) || {}).label || "—"}</td>
                  <td style={{ ...td, color: l.success ? "#2F8F46" : "#C1302B", fontWeight: 600 }}>{l.success ? "Signed in" : `Failed (${(l.reason || "").replace(/_/g, " ")})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <MigrateFilesCard />

      {ask && (
        <ConfirmDialog title={ask.title} confirmLabel={ask.label} onCancel={() => setAsk(null)}
          onConfirm={async () => { const a = ask; setAsk(null); await a.run(); }}>
          {ask.text}
        </ConfirmDialog>
      )}
      {staffDialog && (
        <ConfirmDialog title={`Who appears on "${staffDialog.device.label}"?`} confirmLabel="Save" onCancel={() => setStaffDialog(null)} onConfirm={saveStaff}>
          <div style={{ marginBottom: 10 }}>Tick the people who can sign in on this device. Everyone else is hidden from its login screen and can't sign in on it. Leave all unticked to fall back to the branch rule.</div>
          <StaffPicker staff={staff} selected={staffDialog.selected} onChange={(sel) => setStaffDialog((d) => ({ ...d, selected: sel }))} />
        </ConfirmDialog>
      )}
      {dialog && (
        <ConfirmDialog
          title={`${pins[dialog.user.id] ? "Reset" : "Set"} PIN for ${dialog.user.name}`}
          confirmLabel="Save PIN" busy={dialog.busy} confirmDisabled={dialog.pin.length !== 6}
          onCancel={() => setDialog(null)} onConfirm={savePin}
        >
          <div style={{ marginBottom: 10 }}>Choose 6 digits. Tell {dialog.user.name} the PIN — it can't be viewed again.</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={dialog.pin} inputMode="numeric" maxLength={6} placeholder="••••••"
              onChange={(e) => setDialog((d) => ({ ...d, pin: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
              style={{ ...inputStyle, width: 150, fontSize: 20, letterSpacing: "0.3em", textAlign: "center" }} />
            <a className="link" onClick={() => setDialog((d) => ({ ...d, pin: randomPin() }))}>Generate</a>
          </div>
          {dialog.error && <div style={{ color: "#C1302B", fontSize: 12.5, marginTop: 8 }}>{dialog.error}</div>}
        </ConfirmDialog>
      )}
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
    notify(session, `${session.name} created a new project: ${data.name}`, "project");
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
  const availableUsers = allUsers.filter((u) => u.role !== "driver" && !collaborators.some((c) => c.user_id === u.id));

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

function CustomersPage({ profiles, orders, session, refresh, openRequest, clearOpenRequest }) {
  const [query, setQuery] = useState("");
  const [selectedMobile, setSelectedMobile] = useState(null);
  useEffect(() => {
    if (openRequest && openRequest.type === "customer") { setSelectedMobile(openRequest.id); clearOpenRequest(); }
  }, [openRequest]); // eslint-disable-line
  const [legacyFittedIndex, setLegacyFittedIndex] = useState([]);
  const [legacyOrdersIndex, setLegacyOrdersIndex] = useState([]);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  useEffect(() => {
    fetchAllRows("legacy_fitted_measurements", "mobile,name").then(setLegacyFittedIndex);
    fetchAllRows("legacy_orders", "mobile,name").then(setLegacyOrdersIndex);
  }, []);

  const byMobile = {};
  profiles.forEach((p) => {
    if (!p.mobile) return;
    if (!byMobile[p.mobile] || new Date(p.createdAt) > new Date(byMobile[p.mobile].createdAt)) {
      byMobile[p.mobile] = { name: p.name, mobile: p.mobile, hasNewProfile: true };
    }
  });
  legacyFittedIndex.forEach((r) => { if (r.mobile && !byMobile[r.mobile]) byMobile[r.mobile] = { name: r.name, mobile: r.mobile, hasNewProfile: false }; });
  legacyOrdersIndex.forEach((r) => { if (r.mobile && !byMobile[r.mobile]) byMobile[r.mobile] = { name: r.name, mobile: r.mobile, hasNewProfile: false }; });

  const customers = Object.values(byMobile).map((c) => ({
    ...c,
    newOrderCount: orders.filter((o) => o.mobile === c.mobile).length,
    oldOrderCount: legacyOrdersIndex.filter((o) => o.mobile === c.mobile).length,
  }));
  const filtered = customers.filter((c) => !query.trim() || (c.name || "").toLowerCase().includes(query.toLowerCase()) || (c.mobile || "").includes(query));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (selectedMobile) {
    return (
      <CustomerDetail
        mobile={selectedMobile}
        profiles={profiles.filter((p) => p.mobile === selectedMobile)}
        orders={orders.filter((o) => o.mobile === selectedMobile)}
        session={session}
        refresh={refresh}
        onClose={() => setSelectedMobile(null)}
      />
    );
  }

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>CUSTOMER RECORDS</h2>
      <div className="no-print" style={{ textAlign: "center", marginBottom: 18 }}>
        <input placeholder="Search name or mobile number" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} style={{ ...inputStyle, width: 280, display: "inline-block" }} />
      </div>
      {filtered.length === 0 ? <div style={{ textAlign: "center", padding: 50, color: "#8a8a8a", fontSize: 14 }}>No customers found.</div> : (
        <table>
          <thead><tr style={{ borderBottom: "2px solid #1A1A1A", fontSize: 12.5, textAlign: "left" }}>
            <th style={{ padding: "9px 10px" }}>Name</th><th style={{ padding: "9px 10px" }}>Mobile</th>
            <th style={{ padding: "9px 10px" }}>New Orders</th><th style={{ padding: "9px 10px" }}>Old Orders</th>
            <th style={{ padding: "9px 10px" }}>Source</th><th style={{ padding: "9px 10px" }}>View</th>
          </tr></thead>
          <tbody>
            {paged.map((c) => (
              <tr key={c.mobile} style={{ borderBottom: "1px solid #E5E5E5", fontSize: 13.5 }}>
                <td style={{ padding: "9px 10px" }}>{c.name}</td>
                <td style={{ padding: "9px 10px" }}>{c.mobile}</td>
                <td style={{ padding: "9px 10px" }}>{c.newOrderCount}</td>
                <td style={{ padding: "9px 10px" }}>{c.oldOrderCount}</td>
                <td style={{ padding: "9px 10px", fontSize: 11.5, color: c.hasNewProfile ? "#2F8F46" : "#8a8a8a" }}>{c.hasNewProfile ? "New system" : "Old system only"}</td>
                <td style={{ padding: "9px 10px" }}><a className="link" onClick={() => setSelectedMobile(c.mobile)}>View</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {totalPages > 1 && (
        <div className="no-print" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 14, marginTop: 16 }}>
          <button disabled={currentPage === 1} onClick={() => setPage((p) => p - 1)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "6px 14px", fontSize: 12.5, opacity: currentPage === 1 ? 0.4 : 1 }}>← Prev</button>
          <span style={{ fontSize: 12.5, color: "#5a5a5a" }}>Page {currentPage} of {totalPages} ({filtered.length} customers)</span>
          <button disabled={currentPage === totalPages} onClick={() => setPage((p) => p + 1)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "6px 14px", fontSize: 12.5, opacity: currentPage === totalPages ? 0.4 : 1 }}>Next →</button>
        </div>
      )}
    </div>
  );
}

function CustomerDetail({ mobile, profiles, orders, session, refresh, onClose }) {
  const [legacyFitted, setLegacyFitted] = useState([]);
  const [legacyOrders, setLegacyOrders] = useState([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("legacy_fitted_measurements").select("*").eq("mobile", mobile).then(({ data }) => setLegacyFitted(data || []));
    supabase.from("legacy_orders").select("*").eq("mobile", mobile).order("id", { ascending: false }).then(({ data }) => setLegacyOrders(data || []));
  }, [mobile]);

  const latestProfile = [...profiles].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  const name = latestProfile?.name || legacyFitted[0]?.name || legacyOrders[0]?.name || "—";

  const startEdit = () => {
    const base = latestProfile?.measurements || {};
    const legacyBase = legacyFitted[0] || {};
    setForm({
      name,
      measurements: Object.fromEntries(FITTING_FIELDS.map(([k]) => [k, normalizeMeasurement(base[k]) || normalizeMeasurement(legacyBase[k])])),
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    if (latestProfile) {
      await supabase.from("customer_profiles").update({ name: form.name, measurements: form.measurements, updated_at: new Date().toISOString() }).eq("id", latestProfile.id);
    } else {
      await supabase.from("customer_profiles").insert({
        name: form.name, mobile, measurements: form.measurements,
        branch: session.branch || (session.role === "admin" ? "Admin" : ""), created_by: session.name,
      });
    }
    notify(session, `${session.name} updated a customer's fitted measurement`, "profile", undefined, { type: "customer", id: mobile });
    setSaving(false);
    setEditing(false);
    await refresh();
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div className="no-print" style={{ marginBottom: 14 }}><a className="link" onClick={onClose}>← Back to Customers</a></div>
      <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 24 }}>{name}</div>
      <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 20 }}>{mobile}</div>

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>FITTING MEASUREMENT (new system)</div>
          {!editing && <a className="link" onClick={startEdit}>{latestProfile ? "Edit" : "+ Add Fitted Measurement"}</a>}
        </div>

        {editing ? (
          <div>
            <Field label="Name"><input style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginTop: 10 }}>
              {FITTING_FIELDS.map(([k, l]) => (
                <Field key={k} label={l}>
                  <select value={form.measurements[k]} onChange={(e) => setForm((f) => ({ ...f, measurements: { ...f.measurements, [k]: e.target.value } }))} style={inputStyle}>
                    <option value="">—</option>
                    {MEASUREMENT_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button disabled={saving} onClick={saveEdit} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 4, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Save</button>
              <button onClick={() => setEditing(false)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Cancel</button>
            </div>
          </div>
        ) : latestProfile ? (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Last updated {fmtDateTime(latestProfile.updatedAt || latestProfile.createdAt)}{latestProfile.branch ? ` · ${latestProfile.branch}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "#8a8a8a" }}>
              {FITTING_FIELDS.filter(([k]) => latestProfile.measurements?.[k]).map(([k, l]) => `${l}: ${latestProfile.measurements[k]}`).join(", ") || "—"}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#8a8a8a" }}>No fitted measurement in the new system yet — click "+ Add Fitted Measurement" above{legacyFitted.length > 0 ? " (pre-filled from her old fitted record below)" : ""}.</div>
        )}
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>ALL ORDERS — NEW SYSTEM ({orders.length})</div>
        {orders.length === 0 ? <div style={{ fontSize: 13, color: "#8a8a8a" }}>No job orders placed yet.</div> : orders.map((o) => (
          <div key={o.id} style={{ border: "1px solid #E5E5E5", borderRadius: 4, padding: 10, marginBottom: 8, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span className="mono">{o.jobOrderNo}</span><StatusTag status={o.status} /></div>
            <div>{o.model} — {fmtDate(o.createdAt)}</div>
          </div>
        ))}
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: "#2F8F46" }}>OLD SYSTEM — GENUINE FITTED MEASUREMENT</div>
        {legacyFitted.length === 0 ? <div style={{ fontSize: 13, color: "#8a8a8a" }}>None found.</div> : legacyFitted.map((f) => (
          <div key={f.id} style={{ fontSize: 12, padding: "4px 0" }}>
            {["shoulder", "chest", "waist", "hips", "armhole", "sleeve_length", "length", "bicep", "wrist", "neck"].filter((k) => f[k]).map((k) => `${k}: ${f[k]}`).join(", ")}
          </div>
        ))}
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>OLD SYSTEM — PAST ORDERS / CUTTING REFERENCE ({legacyOrders.length})</div>
        {legacyOrders.length === 0 ? <div style={{ fontSize: 13, color: "#8a8a8a" }}>None found.</div> : legacyOrders.map((o) => (
          <div key={o.id} style={{ borderBottom: "1px solid #E5E5E5", padding: "8px 0", fontSize: 12 }}>
            <strong>{o.order_date}</strong> — {o.garment_type || "—"} ({o.model_no || "—"})
            <div style={{ color: "#8a8a8a" }}>
              {["shoulder", "chest", "waist", "hips", "bottom", "armhole", "sleeve_length", "sleeve_open", "length_front", "length_back"].filter((k) => o[k]).map((k) => `${k}: ${o[k]}`).join(", ") || "No usable measurements on this record"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Production cycle: assign & start, actions, record, calendar ---------------- */

// Stage 1: assign material (submitting it moves the order to "Material Assigned")
function AssignMaterialDialog({ order, models, session, onClose, onDone }) {
  const model = models.find((m) => m.modelNo === order.model);
  const [mats, setMats] = useState(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!model) { setMats([]); return; }
    supabase.from("model_materials").select("*").eq("model_id", model.id).order("created_at").then(({ data }) => {
      setMats((data || []).map((m) => {
        const n = parseFloat(m.quantity);
        return { material_type: m.material_type || "", material_code: m.material_code || "", required: m.quantity || "", assigned: isNaN(n) ? "" : String(n) };
      }));
    });
  }, []); // eslint-disable-line

  const setMat = (i, patch) => setMats((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const validate = () => {
    for (const m of (mats || []).filter((r) => r.material_type.trim() || r.assigned.trim())) {
      if (!m.material_type.trim()) return "Every material row needs a material name.";
      if (m.assigned === "" || isNaN(parseFloat(m.assigned)) || parseFloat(m.assigned) < 0) return `Enter the meters assigned for ${m.material_type}.`;
    }
    return "";
  };
  const short = (mats || []).filter((m) => { const r = parseFloat(m.required), a = parseFloat(m.assigned); return !isNaN(r) && !isNaN(a) && a < r; });

  const doSave = async () => {
    setBusy(true); setError("");
    const rows = (mats || []).filter((m) => m.material_type.trim()).map((m) => ({
      job_order_id: order.id, material_type: m.material_type.trim(), material_code: m.material_code || null,
      required_qty: m.required || null, assigned_qty: m.assigned || null, created_by: session.name,
    }));
    let ids = [];
    if (rows.length) {
      const { data, error: e1 } = await supabase.from("job_order_materials").insert(rows).select("id");
      if (e1) { setError(e1.message); setBusy(false); setConfirm(false); return; }
      ids = (data || []).map((r) => r.id);
    }
    const { error: e2 } = await advanceOrder(session, order, "material_assigned", null);
    if (e2) {                                  // undo what was just saved so a retry doesn't double it up
      if (ids.length) await supabase.from("job_order_materials").delete().in("id", ids);
      setError(e2.message); setBusy(false); setConfirm(false); return;
    }
    setBusy(false);
    onDone && onDone();
  };

  const th = { textAlign: "left", padding: "6px 8px", fontSize: 11.5, borderBottom: "2px solid #1A1A1A" };
  const td = { padding: "5px 8px", fontSize: 12.5 };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 24, width: "100%", maxWidth: 820 }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20, marginBottom: 2 }}>Assign material</div>
        <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 14 }}>Order {order.jobOrderNo} · {order.model}{order.cut ? ` · ${order.cut}` : ""}{order.color ? ` · ${order.color}` : ""}</div>
        <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 8 }}>Filled from this model's "Material Used". Enter the meters actually issued; add anything extra below.</div>
        {mats === null ? <div style={{ fontSize: 13, color: "#8a8a8a" }}>Loading…</div> : (
          <>
            {mats.length === 0 && <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 8 }}>No material is listed for this model. Add what you issued, or continue without.</div>}
            {mats.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
                <thead><tr><th style={th}>Material</th><th style={th}>Code</th><th style={th}>Required (model)</th><th style={th}>Assigned (meters)</th><th style={th}></th></tr></thead>
                <tbody>
                  {mats.map((m, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #E5E5E5" }}>
                      <td style={td}><input value={m.material_type} onChange={(e) => setMat(i, { material_type: e.target.value })} style={{ ...inputStyle, width: 170 }} /></td>
                      <td style={td}><input value={m.material_code} onChange={(e) => setMat(i, { material_code: e.target.value })} style={{ ...inputStyle, width: 110 }} /></td>
                      <td style={{ ...td, color: "#5a5a5a" }}>{m.required || "—"}</td>
                      <td style={td}><input value={m.assigned} inputMode="decimal" onChange={(e) => setMat(i, { assigned: e.target.value })} style={{ ...inputStyle, width: 90 }} /></td>
                      <td style={td}><a className="link" style={{ color: "#C1302B", fontSize: 11 }} onClick={() => setMats((rows) => rows.filter((_, j) => j !== i))}>Remove</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <a className="link" style={{ fontSize: 12.5 }} onClick={() => setMats((rows) => [...rows, { material_type: "", material_code: "", required: "", assigned: "" }])}>+ Add another material</a>
          </>
        )}
        {error && <div style={{ color: "#C1302B", fontSize: 13, marginTop: 14 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
          <button onClick={onClose} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "10px 20px", fontSize: 14, fontWeight: 700 }}>Cancel</button>
          <button onClick={() => { const v = validate(); if (v) setError(v); else { setError(""); setConfirm(true); } }} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "10px 20px", fontSize: 14, fontWeight: 700 }}>Submit material</button>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog title="Submit the material?" confirmLabel="Yes, submit" busy={busy} onCancel={() => setConfirm(false)} onConfirm={doSave}>
          The job moves to <strong>Material Assigned</strong>. Tailors are assigned in the next step.
          {short.length > 0 && <div style={{ marginTop: 8, color: "#C1302B" }}>Less material than the model needs: {short.map((m) => m.material_type).join(", ")}.</div>}
        </ConfirmDialog>
      )}
    </div>
  );
}

// Stage 2: assign tailors (can be planned for any date)
function AssignTailorsDialog({ order, session, reworkId, onClose, onDone }) {
  const today = localYmd(new Date());
  const [workers, setWorkers] = useState([]);
  const [crew, setCrew] = useState([{ worker_id: "", task: "", planned_date: today }]);
  const [adding, setAdding] = useState(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(null);       // "start" | "plan" | "add"
  const [busy, setBusy] = useState(false);
  const running = order.status === "job_in_process";   // adding more people to a job that is already running

  const loadWorkers = () => supabase.from("workers").select("*").eq("active", true).order("name").then(({ data }) => setWorkers(data || []));
  useEffect(() => { loadWorkers(); }, []);
  const setRow = (i, patch) => setCrew((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickWorker = (i, id) => { const w = workers.find((x) => x.id === id); setRow(i, { worker_id: id, task: (w && w.department) || "" }); };
  const saveNewWorker = async () => {
    if (!adding.name.trim()) return;
    const { error: e } = await supabase.from("workers").insert({ name: adding.name.trim(), department: adding.department.trim() || null });
    if (e) { setError(e.code === "23505" ? "That tailor is already in the list." : e.message); return; }
    setAdding(null); setError(""); loadWorkers();
  };
  const validate = (mode) => {
    if (!crew.some((c) => c.worker_id)) return "Choose at least one tailor.";
    if (mode === "plan" && crew.some((c) => c.worker_id && (!c.planned_date || c.planned_date < today))) return "Planned dates can't be in the past.";
    return "";
  };

  const doSave = async (mode) => {
    setBusy(true); setError("");
    const now = new Date().toISOString();
    const startsNow = mode === "start" || mode === "add";
    const rows = crew.filter((c) => c.worker_id).map((c) => {
      const w = workers.find((x) => x.id === c.worker_id);
      return { job_order_id: order.id, worker_id: c.worker_id, worker_name: w ? w.name : "", task: c.task || null, planned_date: c.planned_date || today, started_at: startsNow ? now : null, assigned_by: session.name, rework_id: reworkId || null };
    });
    const { data: saved, error: e1 } = await supabase.from("job_order_tailors").insert(rows).select("id");
    if (e1) { setError(e1.message); setBusy(false); setConfirm(null); return; }
    let res = { error: null };
    if (mode === "start" && !running) {
      await supabase.from("job_order_tailors").update({ started_at: now }).eq("job_order_id", order.id).is("started_at", null);   // also starts anyone planned earlier
      res = await advanceOrder(session, order, "job_in_process", null, { production_started_at: now });
    } else if (mode === "plan" && order.status === "material_assigned") {
      const first = rows.map((r) => r.planned_date).sort()[0];
      res = await advanceOrder(session, order, "manpower_planned", `planned from ${first}`);
    }
    if (res.error) {                           // undo what was just saved so a retry doesn't double it up
      await supabase.from("job_order_tailors").delete().in("id", (saved || []).map((r) => r.id));
      setError(res.error.message); setBusy(false); setConfirm(null); return;
    }
    setBusy(false);
    onDone && onDone();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 24, width: "100%", maxWidth: 760 }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20, marginBottom: 2 }}>{running ? "Add tailors" : "Assign tailors"}</div>
        <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 14 }}>Order {order.jobOrderNo} · {order.model}{order.cut ? ` · ${order.cut}` : ""}{order.color ? ` · ${order.color}` : ""}</div>
        <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 10 }}>
          Give each tailor the day they will work on it — a future date plans the work ahead and shows it on the Production Calendar.
          {!running && " The time stamp only starts when you press “Assign & start tailoring now” (or later, “Start tailoring”)."}
        </div>
        {crew.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <select value={c.worker_id} onChange={(e) => pickWorker(i, e.target.value)} style={{ ...inputStyle, width: 210 }}>
              <option value="">Choose a tailor…</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.name}{w.department ? ` — ${w.department}` : ""}</option>)}
            </select>
            <input value={c.task} onChange={(e) => setRow(i, { task: e.target.value })} placeholder="Task / department" list="dept-list" style={{ ...inputStyle, width: 170 }} />
            <input type="date" value={c.planned_date} min={running ? undefined : today} onChange={(e) => setRow(i, { planned_date: e.target.value })} style={{ ...inputStyle, width: 150 }} />
            {crew.length > 1 && <a className="link" style={{ color: "#C1302B", fontSize: 11 }} onClick={() => setCrew((rows) => rows.filter((_, j) => j !== i))}>Remove</a>}
          </div>
        ))}
        <datalist id="dept-list">{["Cutting", "Stitching", "Finishing", "Embroidery", "Pressing"].map((d) => <option key={d} value={d} />)}</datalist>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
          <a className="link" style={{ fontSize: 12.5 }} onClick={() => setCrew((rows) => [...rows, { worker_id: "", task: "", planned_date: today }])}>+ Add another tailor</a>
          {adding ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="New tailor's name" style={{ ...inputStyle, width: 160 }} />
              <input value={adding.department} onChange={(e) => setAdding({ ...adding, department: e.target.value })} placeholder="Department" list="dept-list" style={{ ...inputStyle, width: 130 }} />
              <button onClick={saveNewWorker} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 3, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>Save</button>
              <a className="link" style={{ fontSize: 12 }} onClick={() => setAdding(null)}>Cancel</a>
            </span>
          ) : <a className="link" style={{ fontSize: 12.5 }} onClick={() => setAdding({ name: "", department: "" })}>+ New tailor (not in the list yet)</a>}
        </div>
        {error && <div style={{ color: "#C1302B", fontSize: 13, marginTop: 14 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22, flexWrap: "wrap" }}>
          <button onClick={onClose} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "10px 20px", fontSize: 14, fontWeight: 700 }}>Cancel</button>
          {running ? (
            <button onClick={() => { const v = validate("add"); if (v) setError(v); else { setError(""); setConfirm("add"); } }} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "10px 20px", fontSize: 14, fontWeight: 700 }}>Add tailors</button>
          ) : (
            <>
              <button onClick={() => { const v = validate("plan"); if (v) setError(v); else { setError(""); setConfirm("plan"); } }} style={{ background: "#fff", border: "1px solid #1A1A1A", borderRadius: 4, padding: "10px 20px", fontSize: 14, fontWeight: 700 }}>Save plan — start later</button>
              <button onClick={() => { const v = validate("start"); if (v) setError(v); else { setError(""); setConfirm("start"); } }} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "10px 20px", fontSize: 14, fontWeight: 700 }}>Assign & start tailoring now</button>
            </>
          )}
        </div>
      </div>
      {confirm === "start" && <ConfirmDialog title="Start tailoring now?" confirmLabel="Yes, start" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => doSave("start")}>The job moves to <strong>Job In Progress</strong> and its time stamp starts at this moment.</ConfirmDialog>}
      {confirm === "plan" && <ConfirmDialog title="Save the plan?" confirmLabel="Yes, save plan" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => doSave("plan")}>The tailors are planned on their dates and show on the Production Calendar. The time stamp starts later, when you press <strong>Start tailoring</strong>.</ConfirmDialog>}
      {confirm === "add" && <ConfirmDialog title="Add these tailors?" confirmLabel="Yes, add" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => doSave("add")}>They are added to the running job.</ConfirmDialog>}
    </div>
  );
}

function ProductionActions({ order, session, models, onDone, flash }) {
  const [dlg, setDlg] = useState(null);
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState({ mats: 0, crew: 0 });
  const live = ["job_created", "job_accepted", "material_assigned", "manpower_planned", "job_in_process", "job_pending_qc", "job_rework"];

  useEffect(() => {
    if (session.role !== "production" && session.role !== "admin") return;
    supabase.from("job_order_materials").select("id", { count: "exact", head: true }).eq("job_order_id", order.id).then(({ count }) => setCounts((c) => ({ ...c, mats: count || 0 })));
    supabase.from("job_order_tailors").select("id", { count: "exact", head: true }).eq("job_order_id", order.id).then(({ count }) => setCounts((c) => ({ ...c, crew: count || 0 })));
  }, [order.id, order.status]);

  const [rework, setRework] = useState(null);
  useEffect(() => {
    if (session.role !== "production" && session.role !== "admin") return;
    if (!["job_rework", "job_in_process"].includes(order.status)) { setRework(null); return; }
    supabase.from("job_order_rework").select("*").eq("job_order_id", order.id).in("status", ["open", "in_progress"]).order("round", { ascending: false }).limit(1)
      .then(({ data }) => setRework(data && data[0] ? data[0] : null));
  }, [order.id, order.status]);

  const [qcOpen, setQcOpen] = useState(false);
  useEffect(() => {
    if (session.role !== "production" && session.role !== "admin") return;
    if (order.status !== "job_pending_qc" && order.status !== "job_rework") return;
    supabase.from("job_order_qc").select("status, started_at").eq("job_order_id", order.id).eq("stage", "production").order("started_at", { ascending: false }).limit(1)
      .then(({ data }) => { const r = data && data[0]; setQcOpen(!!r && r.status === "in_progress"); });
  }, [order.id, order.status]);

  if (session.role !== "production" && session.role !== "admin") return null;
  const s = order.status;
  if (!live.includes(s)) return null;

  const run = async (fn, okMsg) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false); setDlg(null); setReason(""); setFiles([]);
    if (error) flash && flash("Error: " + error.message); else { flash && flash(okMsg); onDone && onDone(); }
  };
  const pbtn = (bg, outline) => ({
    display: "inline-flex", alignItems: "center", gap: 8, minHeight: 46, padding: "11px 20px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer",
    background: outline ? "#fff" : bg, color: outline ? bg : "#fff", border: outline ? `1.5px solid ${bg}` : "none", boxShadow: outline ? "none" : "0 2px 6px rgba(0,0,0,0.16)",
  });
  const steps = ["Accepted", "Material", "Tailors", "Started", "Completed"];
  const doneCount = { job_created: 0, job_accepted: 1, material_assigned: 2, manpower_planned: 3, job_in_process: 4, job_rework: 4, job_pending_qc: 5 }[s] || 0;
  const hint = {
    job_created: "Review the job order, then accept or reject it.",
    job_accepted: "Assign the material for this order.",
    material_assigned: "Assign tailors — for today or planned for a future date.",
    manpower_planned: "Start tailoring when the tailors begin work.",
    job_in_process: "Mark it as completed when tailoring is finished.",
    job_pending_qc: "Run the quality check on the finished piece.",
    job_rework: "This piece was sent back — start the rework.",
  }[s];
  const accent = { job_created: "#D98E2B", job_rework: "#C1302B", job_pending_qc: "#3B6FA0" }[s] || "#2F8F46";

  return (
    <div style={{ background: "#fff", border: "1px solid #E1E5EA", borderLeft: `5px solid ${accent}`, borderRadius: 10, padding: "16px 18px", marginBottom: 18, boxShadow: "0 2px 10px rgba(20,30,50,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, letterSpacing: "0.08em", color: "#5a5a5a" }}>PRODUCTION</div>
        <StatusTag status={s} />
      </div>

      {s !== "job_created" && (
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          {steps.map((label, i) => {
            const done = i < doneCount, current = i === doneCount;
            return (
              <React.Fragment key={label}>
                <div style={{ textAlign: "center", minWidth: 54 }}>
                  <div style={{ width: 26, height: 26, margin: "0 auto", borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: done ? "#2F8F46" : "#fff", color: done ? "#fff" : current ? accent : "#9aa0a8", border: done ? "none" : `2px solid ${current ? accent : "#D5D9DE"}` }}>{done ? "✓" : i + 1}</div>
                  <div style={{ fontSize: 10.5, marginTop: 3, color: done || current ? "#1A1A1A" : "#9aa0a8", fontWeight: current ? 700 : 400 }}>{label}</div>
                </div>
                {i < steps.length - 1 && <div style={{ flex: 1, height: 2, background: i < doneCount - 1 ? "#2F8F46" : "#E1E5EA", marginBottom: 16 }} />}
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 13, color: "#5a5a5a", marginBottom: 14 }}>{hint}</div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {s === "job_created" && (<>
          <button style={pbtn("#2F8F46")} onClick={() => setDlg("accept")}>✔ Accept job order</button>
          <button style={pbtn("#C1302B", true)} onClick={() => setDlg("reject")}>✖ Reject</button>
        </>)}
        {s === "job_accepted" && <button style={pbtn("#1A1A1A")} onClick={() => setDlg("material")}>📦 Assign material</button>}
        {s === "material_assigned" && <button style={pbtn("#1A1A1A")} onClick={() => setDlg("tailors")}>👥 Assign tailors</button>}
        {s === "manpower_planned" && (<>
          <button style={pbtn("#2F8F46")} onClick={() => setDlg("start")}>▶ Start tailoring</button>
          <button style={pbtn("#5a5a5a", true)} onClick={() => setDlg("tailors")}>👥 Add / plan more tailors</button>
        </>)}
        {s === "job_in_process" && (<>
          <button style={pbtn("#2F8F46")} onClick={() => setDlg("complete")}>✅ Mark as completed</button>
          <button style={pbtn("#5a5a5a", true)} onClick={() => setDlg("tailors")}>👥 Add tailors</button>
        </>)}
        {s === "job_pending_qc" && <button style={pbtn("#1A1A1A")} onClick={() => setDlg("qc")}>🔍 {qcOpen ? "Continue quality check" : "Start quality check"}</button>}
        {s === "job_rework" && <button style={pbtn("#C1302B")} onClick={() => setDlg("rework")}>🔧 Start rework</button>}
      </div>

      {dlg === "accept" && (
        <ConfirmDialog title="Accept this job order?" confirmLabel="Yes, accept" busy={busy} onCancel={() => setDlg(null)}
          onConfirm={() => run(() => advanceOrder(session, order, "job_accepted", null, { accepted_at: new Date().toISOString(), accepted_by: session.name }), "Job order accepted")}>
          Order {order.jobOrderNo} · {order.model}. Next you'll assign the material, then the tailors.
        </ConfirmDialog>
      )}
      {dlg === "reject" && (
        <ConfirmDialog title="Reject this job order?" confirmLabel="Yes, reject" busy={busy} confirmDisabled={!reason.trim()} onCancel={() => { setDlg(null); setFiles([]); setReason(""); }}
          onConfirm={() => run(() => advanceOrder(session, order, "job_rejected", reason.trim(), null, files), "Job order rejected")}>
          <div style={{ marginBottom: 8 }}>Tell Sales why, so they can fix it and send it again.</div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 70, marginBottom: 12 }} placeholder="Reason (required)" />
          <AttachmentField files={files} onChange={setFiles} folder="rejections" />
        </ConfirmDialog>
      )}
      {dlg === "material" && <AssignMaterialDialog order={order} models={models} session={session} onClose={() => setDlg(null)} onDone={() => { setDlg(null); flash && flash("Material assigned"); onDone && onDone(); }} />}
      {dlg === "tailors" && <AssignTailorsDialog order={order} session={session} reworkId={rework && rework.status === "in_progress" ? rework.id : null} onClose={() => setDlg(null)} onDone={() => { setDlg(null); flash && flash("Tailors saved"); onDone && onDone(); }} />}
      {dlg === "start" && (
        <ConfirmDialog title="Start tailoring now?" confirmLabel="Yes, start" busy={busy} onCancel={() => setDlg(null)} onConfirm={() => run(() => startTailoring(session, order), "Tailoring started")}>
          The job moves to <strong>Job In Progress</strong> and its time stamp starts at this moment.
        </ConfirmDialog>
      )}
      {dlg === "complete" && (rework && rework.status === "in_progress"
        ? <ReworkCompleteDialog rework={rework} order={order} session={session} onClose={() => setDlg(null)} onDone={() => { setDlg(null); flash && flash("Rework completed"); onDone && onDone(); }} />
        : (
          <ConfirmDialog title="Mark as completed?" confirmLabel="Yes, completed" busy={busy} onCancel={() => setDlg(null)} onConfirm={() => run(() => completeProduction(session, order), "Marked as completed")}>
            The time stamp stops and the order moves to <strong>Pending Quality Check</strong>.
          </ConfirmDialog>
        ))}
      {dlg === "qc" && <QualityCheckDialog order={order} session={session} onClose={() => { setDlg(null); onDone && onDone(); }} onDone={(msg) => { setDlg(null); flash && flash(msg); onDone && onDone(); }} />}
      {dlg === "rework" && (
        <ConfirmDialog title="Start the rework?" confirmLabel="Yes, start rework" busy={busy} onCancel={() => setDlg(null)} onConfirm={() => run(() => startRework(session, order), "Rework started")}>
          Sent back by {rework ? rework.raised_by : "—"}{rework && rework.source === "store" ? ` from ${rework.branch || "the store"}` : ""}. The order goes back to <strong>Job In Progress</strong>; use "Add tailors" if someone different will fix it.
          {rework && rework.comment && <div style={{ marginTop: 8 }}>Comment: {rework.comment}</div>}
          {rework && (rework.points || []).map((p, i) => (
            <div key={p.id} style={{ marginTop: 8, padding: 8, background: "#FDF6F5", borderRadius: 4 }}>
              <strong>{i + 1}.</strong> {p.text}{p.files && p.files.length > 0 && <div style={{ marginTop: 4 }}><AttachmentGallery files={p.files} /></div>}
            </div>
          ))}
        </ConfirmDialog>
      )}
    </div>
  );
}

function ProductionInfo({ order }) {
  const [mats, setMats] = useState([]);
  const [crew, setCrew] = useState([]);
  useEffect(() => {
    supabase.from("job_order_materials").select("*").eq("job_order_id", order.id).order("created_at").then(({ data }) => setMats(data || []));
    supabase.from("job_order_tailors").select("*").eq("job_order_id", order.id).order("started_at").then(({ data }) => setCrew(data || []));
  }, [order.id, order.status]);
  if (!order.acceptedAt && mats.length === 0 && crew.length === 0) return null;
  const took = order.productionStartedAt ? new Date(order.productionCompletedAt || Date.now()) - new Date(order.productionStartedAt) : null;
  const th = { textAlign: "left", padding: "5px 8px", fontSize: 11.5, borderBottom: "2px solid #1A1A1A" };
  const td = { padding: "5px 8px", fontSize: 12.5, borderBottom: "1px solid #E5E5E5" };
  return (
    <div style={{ ...cardStyle, margin: "16px 0" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>PRODUCTION RECORD</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.8, marginBottom: 10 }}>
        {order.acceptedAt && <div>Accepted by <strong>{order.acceptedBy}</strong> · {fmtDateTime(order.acceptedAt)}</div>}
        {order.productionStartedAt && <div>Tailoring started · {fmtDateTime(order.productionStartedAt)}</div>}
        {order.productionCompletedAt && <div>Completed · {fmtDateTime(order.productionCompletedAt)}</div>}
        {took != null && <div>{order.productionCompletedAt ? "Time taken" : "Running for"}: <strong>{fmtDuration(took)}</strong></div>}
      </div>
      {mats.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
          <thead><tr><th style={th}>Material</th><th style={th}>Code</th><th style={th}>Required</th><th style={th}>Assigned (meters)</th></tr></thead>
          <tbody>{mats.map((m) => <tr key={m.id}><td style={td}>{m.material_type}</td><td style={td}>{m.material_code || "—"}</td><td style={td}>{m.required_qty || "—"}</td><td style={td}><strong>{m.assigned_qty || "—"}</strong></td></tr>)}</tbody>
        </table>
      )}
      {crew.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Tailor</th><th style={th}>Task</th><th style={th}>Started</th><th style={th}>Finished</th></tr></thead>
          <tbody>{crew.map((c) => <tr key={c.id}><td style={td}>{c.worker_name}</td><td style={td}>{c.task || "—"}</td><td style={td}>{c.started_at ? fmtDateTime(c.started_at) : "—"}</td><td style={td}>{c.finished_at ? fmtDateTime(c.finished_at) : "In progress"}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

// yyyy-mm-dd in the viewer's own time zone (toISOString would shift the day for anyone ahead of UTC, e.g. Qatar)
const localYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function ProductionCalendar({ orders, models, session, refresh, flash, onOpenOrder }) {
  const [day, setDay] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [crew, setCrew] = useState([]);
  const [pickedId, setPickedId] = useState(null);
  const [confirmDone, setConfirmDone] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { supabase.from("job_order_tailors").select("*").then(({ data }) => setCrew(data || [])); }, [orders]);   // refreshes live when orders change

  const bounds = (d) => { const a = new Date(d); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(23, 59, 59, 999); return [a, b]; };
  const activeOn = (o, d) => {
    if (!o.productionStartedAt) return false;
    const [a, b] = bounds(d);
    const s = new Date(o.productionStartedAt), e = o.productionCompletedAt ? new Date(o.productionCompletedAt) : null;
    return s <= b && (!e || e >= a);
  };
  const dayISO = localYmd(day);
  const working = orders.filter((o) => activeOn(o, day));
  // work planned for this day that hasn't started yet
  const plannedRows = crew.filter((c) => c.planned_date === dayISO && !c.started_at && orders.some((o) => o.id === c.job_order_id && !o.productionStartedAt));

  const lanes = {};    // tailor name -> [{ o, planned }]
  working.forEach((o) => {
    const rows = crew.filter((c) => c.job_order_id === o.id);
    const names = rows.length ? Array.from(new Set(rows.map((r) => r.worker_name))) : ["Unassigned"];
    names.forEach((n) => { (lanes[n] = lanes[n] || []).push({ o, planned: false }); });
  });
  plannedRows.forEach((c) => {
    const o = orders.find((x) => x.id === c.job_order_id);
    if (o && !(lanes[c.worker_name] || []).some((x) => x.o.id === o.id)) (lanes[c.worker_name] = lanes[c.worker_name] || []).push({ o, planned: true });
  });
  const who = (o) => (hidePII(session) ? `${o.model}${o.color ? " · " + o.color : ""}` : `${o.name} · ${o.model}`);
  const laneNames = Object.keys(lanes).sort((a, b) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)));
  const isToday = bounds(day)[0].getTime() === bounds(new Date())[0].getTime();
  const shift = (n) => setDay((d) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; });
  const strip = [-3, -2, -1, 0, 1, 2, 3].map((n) => { const x = new Date(day); x.setDate(x.getDate() + n); return x; });
  const picked = orders.find((o) => o.id === pickedId);
  const canAct = session.role === "production" || session.role === "admin";
  const today = localYmd(new Date());
  const waiting = {
    accept: orders.filter((o) => o.status === "job_created").length,
    material: orders.filter((o) => o.status === "job_accepted").length,
    tailors: orders.filter((o) => o.status === "material_assigned").length,
    planned: orders.filter((o) => o.status === "manpower_planned").length,
    qc: orders.filter((o) => o.status === "job_pending_qc").length,
  };
  const pickedCrew = picked ? crew.filter((c) => c.job_order_id === picked.id) : [];
  const pickedPlanned = pickedCrew.filter((c) => !c.started_at && c.planned_date).map((c) => c.planned_date).sort();

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 16 }}>PRODUCTION CALENDAR</h2>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={() => shift(-1)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "7px 14px" }}>◀</button>
        <div style={{ fontWeight: 700, fontSize: 16, minWidth: 220, textAlign: "center" }}>{isToday ? "Today · " : ""}{day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>
        <button onClick={() => shift(1)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "7px 14px" }}>▶</button>
        <button onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setDay(d); }} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 14px", fontWeight: 700 }}>Today</button>
        <input type="date" value={localYmd(day)} onChange={(e) => e.target.value && setDay(new Date(e.target.value + "T00:00:00"))} style={{ ...inputStyle, width: 160 }} />
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 18, flexWrap: "wrap" }}>
        {strip.map((d) => {
          const sel = bounds(d)[0].getTime() === bounds(day)[0].getTime();
          const n = orders.filter((o) => activeOn(o, d)).length + crew.filter((c) => c.planned_date === localYmd(d) && !c.started_at).length;
          return (
            <div key={d.toISOString()} onClick={() => setDay(d)} style={{ width: 92, padding: "8px 4px", textAlign: "center", borderRadius: 6, cursor: "pointer", border: "1px solid " + (sel ? "#1A1A1A" : "#DDE1E7"), background: sel ? "#1A1A1A" : "#fff", color: sel ? "#fff" : "#1A1A1A" }}>
              <div style={{ fontSize: 11 }}>{d.toLocaleDateString([], { weekday: "short" })} {d.getDate()}</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{n}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 18, flexWrap: "wrap", fontSize: 12.5 }}>
        <span style={{ background: "#EEF0F2", borderRadius: 12, padding: "5px 12px" }}>Being made on this day: <strong>{working.length}</strong></span>
        <span style={{ background: "#EEF0F2", borderRadius: 12, padding: "5px 12px" }}>Waiting to be accepted: <strong>{waiting.accept}</strong></span>
        <span style={{ background: "#EEF0F2", borderRadius: 12, padding: "5px 12px" }}>Waiting for material: <strong>{waiting.material}</strong></span>
        <span style={{ background: "#EEF0F2", borderRadius: 12, padding: "5px 12px" }}>Waiting for tailors: <strong>{waiting.tailors}</strong></span>
        <span style={{ background: "#EEF0F2", borderRadius: 12, padding: "5px 12px" }}>Planned (not started): <strong>{waiting.planned}</strong></span>
        <span style={{ background: "#EEF0F2", borderRadius: 12, padding: "5px 12px" }}>Pending quality check: <strong>{waiting.qc}</strong></span>
        <span style={{ background: "#EEF0F2", borderRadius: 12, padding: "5px 12px" }}>Sent back for rework: <strong>{orders.filter((o) => o.status === "job_rework").length}</strong></span>
      </div>

      {laneNames.length === 0 ? (
        <div style={{ textAlign: "center", color: "#8a8a8a", padding: 40, fontSize: 14 }}>Nothing was being made{laneNames.length ? "" : " or planned"} on this day.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {laneNames.map((name) => (
            <div key={name} style={{ border: "1px solid #DDE1E7", borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10, color: name === "Unassigned" ? "#C1302B" : "#1A1A1A" }}>👤 {name} <span style={{ color: "#8a8a8a", fontWeight: 400 }}>· {lanes[name].length}</span></div>
              {lanes[name].map(({ o, planned }) => {
                const overdue = o.deliveryDate && o.deliveryDate < today && !o.productionCompletedAt;
                return (
                  <div key={o.id} onClick={() => setPickedId(o.id)} style={{ border: planned ? "1px dashed #8a8a8a" : "1px solid #E5E5E5", borderLeft: "4px " + (planned ? "dashed #8a8a8a" : "solid " + (o.productionCompletedAt ? "#8a8a8a" : "#2F8F46")), borderRadius: 4, padding: "8px 10px", marginBottom: 8, cursor: "pointer", background: planned ? "#FAFAFA" : "#fff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}><span className="mono">{o.jobOrderNo}</span><span style={{ fontSize: 11, fontWeight: 400, color: "#8a8a8a" }}>{planned ? "Planned" : o.productionCompletedAt ? "done " + fmtTime(o.productionCompletedAt) : "since " + fmtTime(o.productionStartedAt)}</span></div>
                    <div style={{ fontSize: 12 }}>{who(o)}</div>
                    <div style={{ fontSize: 11, color: overdue ? "#C1302B" : "#8a8a8a", fontWeight: overdue ? 700 : 400 }}>Due {o.deliveryDate ? fmtDate(o.deliveryDate) : "—"}{overdue ? " · overdue" : ""}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {picked && (
        <div onClick={() => setPickedId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
              <ModelThumb model={(models || []).find((m) => m.modelNo === picked.model) || { id: null, modelNo: picked.model }} size={90} />
              <div>
                <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{picked.jobOrderNo}</div>
                {!hidePII(session) && <div style={{ fontSize: 14 }}>{picked.name}</div>}
                <div style={{ fontSize: 12.5, color: "#5a5a5a" }}>{picked.model}{picked.cut ? ` · ${picked.cut}` : ""}{picked.color ? ` · ${picked.color}` : ""}</div>
                <div style={{ marginTop: 4 }}><StatusTag status={picked.status} /></div>
              </div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
              <div><strong>Due:</strong> {picked.deliveryDate ? fmtDate(picked.deliveryDate) : "—"}</div>
              {picked.status === "manpower_planned" && <div><strong>Planned for:</strong> {pickedPlanned.length ? Array.from(new Set(pickedPlanned)).map((d) => fmtDate(d)).join(", ") : "—"}</div>}
              {(picked.status === "job_accepted" || picked.status === "material_assigned") && <div style={{ color: "#C1302B" }}>{picked.status === "job_accepted" ? "Still to do: assign material, then tailors" : "Still to do: assign tailors"}</div>}
              <div><strong>Started:</strong> {picked.productionStartedAt ? fmtDateTime(picked.productionStartedAt) : "—"}</div>
              <div><strong>{picked.productionCompletedAt ? "Time taken" : "Running for"}:</strong> {picked.productionStartedAt ? fmtDuration(new Date(picked.productionCompletedAt || Date.now()) - new Date(picked.productionStartedAt)) : "—"}</div>
              <div style={{ marginTop: 6 }}><strong>Working on it:</strong></div>
              {crew.filter((c) => c.job_order_id === picked.id).map((c) => <div key={c.id}>👤 {c.worker_name}{c.task ? ` — ${c.task}` : ""} <span style={{ color: "#8a8a8a" }}>{c.started_at ? `(since ${fmtTime(c.started_at)}${c.finished_at ? `, finished ${fmtTime(c.finished_at)}` : ""})` : `(planned ${c.planned_date ? fmtDate(c.planned_date) : "—"})`}</span></div>)}
              {crew.filter((c) => c.job_order_id === picked.id).length === 0 && <div style={{ color: "#C1302B" }}>No tailor recorded</div>}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button onClick={() => setPickedId(null)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "9px 16px", fontWeight: 700 }}>Close</button>
              <button onClick={() => { setPickedId(null); onOpenOrder && onOpenOrder(picked.id); }} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "9px 16px", fontWeight: 700 }}>Open full job order</button>
              {canAct && picked.status === "manpower_planned" && <button onClick={() => setConfirmStart(true)} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 4, padding: "9px 16px", fontWeight: 700 }}>Start tailoring</button>}
              {canAct && picked.status === "job_in_process" && <button onClick={() => setConfirmDone(true)} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 4, padding: "9px 16px", fontWeight: 700 }}>Mark as completed</button>}
            </div>
          </div>
        </div>
      )}
      {confirmStart && picked && (
        <ConfirmDialog title="Start tailoring now?" confirmLabel="Yes, start" busy={busy} onCancel={() => setConfirmStart(false)}
          onConfirm={async () => { setBusy(true); const { error } = await startTailoring(session, picked); setBusy(false); setConfirmStart(false); setPickedId(null); if (error) flash("Error: " + error.message); else { flash("Tailoring started"); refresh(); } }}>
          The job moves to <strong>Job In Progress</strong> and its time stamp starts at this moment.
        </ConfirmDialog>
      )}
      {confirmDone && picked && (
        <ConfirmDialog title="Mark as completed?" confirmLabel="Yes, completed" busy={busy} onCancel={() => setConfirmDone(false)}
          onConfirm={async () => { setBusy(true); const { error } = await completeProduction(session, picked); setBusy(false); setConfirmDone(false); setPickedId(null); if (error) flash("Error: " + error.message); else { flash("Marked as completed"); refresh(); } }}>
          The time stamp stops and order {picked.jobOrderNo} moves to <strong>Pending Quality Check</strong>.
        </ConfirmDialog>
      )}

      {canAct && <WorkersManager flash={flash} />}
    </div>
  );
}

function WorkersManager({ flash }) {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const [dept, setDept] = useState("");
  const load = () => supabase.from("workers").select("*").order("name").then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  const add = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from("workers").insert({ name: name.trim(), department: dept.trim() || null });
    if (error) { flash(error.code === "23505" ? "That tailor is already in the list." : error.message); return; }
    setName(""); setDept(""); load();
  };
  const toggle = async (w) => { await supabase.from("workers").update({ active: !w.active }).eq("id", w.id); load(); };
  return (
    <div style={{ ...cardStyle, marginTop: 28 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>TAILORS</div>
      <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 12 }}>The people you can assign to a job. They don't need a login. Switch someone off to hide them from the list without losing their history.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ ...inputStyle, width: 200 }} />
        <input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Department (Cutting, Stitching…)" style={{ ...inputStyle, width: 230 }} />
        <button onClick={add} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 700 }}>+ Add tailor</button>
      </div>
      {rows.length === 0 ? <div style={{ fontSize: 13, color: "#8a8a8a" }}>No tailors yet.</div> : rows.map((w) => (
        <div key={w.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #F0F0F0", fontSize: 13, opacity: w.active ? 1 : 0.5 }}>
          <span>{w.name}{w.department ? <span style={{ color: "#8a8a8a" }}> — {w.department}</span> : null}</span>
          <a className="link" onClick={() => toggle(w)}>{w.active ? "Switch off" : "Switch on"}</a>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Quality check ---------------- */

function QualityCheckDialog({ order, session, stage = "production", onClose, onDone }) {
  const isStore = stage === "store";
  const readyLabel = isStore ? "Ready in Stores" : "Ready in Production";
  const [qc, setQc] = useState(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [signed, setSigned] = useState(false);
  const sigRef = React.useRef(null);
  const checksRef = React.useRef([]);
  const startedRef = React.useRef(false);      // React runs effects twice in development — never start two checks
  const [mode, setMode] = useState(null);          // null | "pass" | "fail" (confirm pop-ups)
  const [failing, setFailing] = useState(false);   // shows the "needs rework" form
  const [points, setPoints] = useState([{ text: "", files: [] }]);   // the points to fix when sending back for rework
  const [comment, setComment] = useState("");
  const pointsOk = points.some((p) => p.text.trim());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      // pick up a check that was started earlier (so ticks are never lost), otherwise start a new round
      const { data: open } = await supabase.from("job_order_qc").select("*").eq("job_order_id", order.id).eq("stage", stage).eq("status", "in_progress").order("started_at", { ascending: false }).limit(1);
      if (open && open[0]) { checksRef.current = open[0].checks; setNotes(open[0].notes || ""); setQc(open[0]); return; }
      const { data: all } = await supabase.from("job_order_qc").select("round").eq("job_order_id", order.id).eq("stage", stage);
      const round = (all || []).reduce((m, r) => Math.max(m, r.round), 0) + 1;
      // after a rework, the production check covers ONLY the points that were sent back
      let reworkRow = null;
      if (stage === "production") {
        const { data: rw } = await supabase.from("job_order_rework").select("*").eq("job_order_id", order.id).eq("status", "completed").order("round", { ascending: false }).limit(1);
        reworkRow = rw && rw[0] ? rw[0] : null;
      } else {
        // store re-check of a piece that was sent back from this store and has since passed Production's check: only those points
        const { data: rw } = await supabase.from("job_order_rework").select("*").eq("job_order_id", order.id).eq("source", "store").eq("status", "verified").is("store_verified_at", null).order("round", { ascending: false }).limit(1);
        reworkRow = rw && rw[0] ? rw[0] : null;
      }
      const { data: std } = reworkRow ? { data: [] } : await supabase.from("qc_checklist_items").select("*").eq("stage", stage).eq("active", true).order("sort_order");
      const checks = reworkRow ? buildReworkChecks(reworkRow) : buildQcChecks(order, std || []);
      const { data: created, error: e } = await supabase.from("job_order_qc").insert({ job_order_id: order.id, stage, round, checks, started_by: session.name, rework_id: reworkRow ? reworkRow.id : null }).select().single();
      if (e) { setError(e.message); return; }
      checksRef.current = created.checks;
      setQc(created);
      notify(session, `${session.name} started the ${isStore ? "store re-check" : "quality check"} — order ${order.jobOrderNo} (${order.model})`, "status", order.branch, { type: "order", id: order.id }, { internal: !isStore, hideFromProduction: isStore });
    })();
  }, []); // eslint-disable-line

  // Tick / untick one line. Time-stamped, and saved straight away.
  const toggle = async (key) => {
    const now = new Date().toISOString();
    const checks = checksRef.current.map((c) => (c.key !== key ? c : c.ok ? { ...c, ok: false, at: null, by: null } : { ...c, ok: true, at: now, by: session.name }));
    checksRef.current = checks;
    setQc((q) => ({ ...q, checks }));
    const { error: e } = await supabase.from("job_order_qc").update({ checks }).eq("id", qc.id);
    if (e) setError("Couldn't save that tick: " + e.message);
  };

  const checks = qc ? qc.checks : [];
  const done = checks.filter((c) => c.ok).length;
  const allDone = checks.length > 0 && done === checks.length;
  const groups = ["Rework points", "Standard checks", "This order's requirements", "Measurements"].filter((g) => checks.some((c) => c.group === g));

  const doPass = async () => {
    setBusy(true); setError("");
    const blob = sigRef.current ? await new Promise((r) => sigRef.current.toBlob(r, "image/png")) : null;
    const up = blob ? await uploadCustomerFile(`${isStore ? "store-qc-signatures" : "qc-signatures"}/${order.id}-${Date.now()}.png`, blob, "image/png") : { error: { message: "no signature drawn" } };
    if (up.error) { setError(`Couldn't save the signature (${isStore ? "store-qc-signatures" : "qc-signatures"} as ${session.role}): ` + up.error.message); setBusy(false); setMode(null); return; }
    const { error: e1 } = await supabase.from("job_order_qc").update({
      status: "passed", confirmed: true, signature_url: up.ref, notes: notes || null, completed_by: session.name, completed_at: new Date().toISOString(),
    }).eq("id", qc.id);
    if (e1) { setError(e1.message); setBusy(false); setMode(null); return; }
    // a re-check that follows a rework closes that rework
    if (qc.rework_id) {
      if (isStore) await supabase.rpc("store_rework_result", { p_rework_id: qc.rework_id, p_qc_id: qc.id, p_passed: true });   // Sales can't edit rework rows directly
      else await supabase.from("job_order_rework").update({ status: "verified", verified_at: new Date().toISOString(), verified_by: session.name, qc_id: qc.id }).eq("id", qc.rework_id);
    }
    const { error: e2 } = await advanceOrder(session, order, isStore ? "ready_in_stores" : "ready_in_production", null);
    setBusy(false);
    if (e2) { setError(e2.message); setMode(null); return; }
    onDone && onDone(`${isStore ? "Re-check" : "Quality check"} passed — ${readyLabel}`);
  };

  const doFail = async () => {
    setBusy(true); setError("");
    const pts = points.filter((p) => p.text.trim());
    const allFiles = pts.flatMap((p) => p.files || []);
    const summary = `${pts.length} point${pts.length === 1 ? "" : "s"} to fix: ` + pts.map((p, i) => `${i + 1}. ${p.text.trim()}`).join("; ");
    const { error: e0 } = await raiseRework(session, order, isStore ? "store" : "production", pts, comment.trim());
    if (e0) { setError(e0.message); setBusy(false); setMode(null); return; }
    const { error: e1 } = await supabase.from("job_order_qc").update({
      status: "failed", fail_reason: summary, fail_attachments: allFiles, notes: notes || null, completed_by: session.name, completed_at: new Date().toISOString(),
    }).eq("id", qc.id);
    if (e1) { setError(e1.message); setBusy(false); setMode(null); return; }
    if (qc.rework_id) {                                                  // the earlier rework didn't pass this check
      if (isStore) await supabase.rpc("store_rework_result", { p_rework_id: qc.rework_id, p_qc_id: qc.id, p_passed: false });
      else await supabase.from("job_order_rework").update({ status: "superseded" }).eq("id", qc.rework_id);
    }
    const { error: e2 } = await advanceOrder(session, order, "job_rework", (isStore ? `Sent back from ${order.branch}: ` : "") + summary, null, allFiles);
    setBusy(false);
    if (e2) { setError(e2.message); setMode(null); return; }
    onDone && onDone("Sent back for rework");
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 24, width: "100%", maxWidth: 780 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20 }}>{isStore ? "Store re-check" : "Quality check"}{qc ? ` · round ${qc.round}` : ""}</div>
            <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 10 }}>Order {order.jobOrderNo} · {order.model}{order.cut ? ` · ${order.cut}` : ""}{order.color ? ` · ${order.color}` : ""}</div>
            {qc && qc.rework_id && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#C1302B", marginBottom: 8 }}>Re-check after rework — only the points that were sent back</div>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, color: "#8a8a8a" }}>×</button>
        </div>

        {!qc ? <div style={{ fontSize: 13, color: error ? "#C1302B" : "#8a8a8a", padding: "20px 0" }}>{error || "Loading…"}</div> : (
          <>
            <div style={{ margin: "6px 0 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}><span>{done} of {checks.length} checked</span><span style={{ color: "#8a8a8a" }}>Every tick is time-stamped and saved as you go</span></div>
              <div style={{ height: 8, background: "#EEF0F2", borderRadius: 4 }}><div style={{ width: `${checks.length ? (done / checks.length) * 100 : 0}%`, height: "100%", background: allDone ? "#2F8F46" : "#3B6FA0", borderRadius: 4, transition: "width .2s" }} /></div>
            </div>

            {groups.map((g) => (
              <div key={g} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, letterSpacing: "0.04em", color: "#5a5a5a", marginBottom: 6 }}>{g.toUpperCase()}</div>
                {checks.filter((c) => c.group === g).map((c) => (
                  <div key={c.key} onClick={() => toggle(c.key)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 12px", minHeight: 48, border: "1px solid " + (c.ok ? "#BFE0C7" : "#E5E5E5"), background: c.ok ? "#F2FAF4" : "#fff", borderRadius: 6, marginBottom: 6, cursor: "pointer" }}>
                    <div style={{ width: 26, height: 26, borderRadius: 5, border: "2px solid " + (c.ok ? "#2F8F46" : "#9aa0a8"), background: c.ok ? "#2F8F46" : "#fff", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>{c.ok ? "✓" : ""}</div>
                    <div style={{ flex: 1, fontSize: 14 }}>{c.label}{c.detail && <div style={{ fontSize: 12, color: "#5a5a5a", marginTop: 2 }}>{c.detail}</div>}</div>
                    <div className="mono" style={{ fontSize: 11, color: "#8a8a8a", textAlign: "right" }}>{c.ok ? <>{fmtTime(c.at)}<br />{c.by}</> : ""}</div>
                  </div>
                ))}
              </div>
            ))}

            <Field label="Notes (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => supabase.from("job_order_qc").update({ notes: notes || null }).eq("id", qc.id)} style={{ ...inputStyle, minHeight: 56 }} placeholder="Anything worth recording about this check…" /></Field>

            {failing ? (
              <div style={{ border: "1px solid #E8B9B6", background: "#FDF6F5", borderRadius: 6, padding: 14, marginTop: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Send back for rework — list each point</div>
                <div style={{ fontSize: 12, color: "#8a8a8a", marginBottom: 10 }}>The quality check that follows the rework will show exactly these points, one by one.</div>
                {points.map((p, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid #E8D2D0", borderRadius: 6, padding: 10, marginBottom: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <div style={{ fontWeight: 700, paddingTop: 8, minWidth: 20 }}>{i + 1}.</div>
                      <textarea value={p.text} onChange={(e) => setPoints((ps) => ps.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} style={{ ...inputStyle, minHeight: 56 }} placeholder="What needs fixing?" />
                      {points.length > 1 && <a className="link" style={{ color: "#C1302B", fontSize: 12, paddingTop: 8 }} onClick={() => setPoints((ps) => ps.filter((_, j) => j !== i))}>Remove</a>}
                    </div>
                    <div style={{ marginLeft: 28, marginTop: 8 }}><AttachmentField files={p.files} onChange={(f) => setPoints((ps) => ps.map((x, j) => (j === i ? { ...x, files: f } : x)))} folder="rework-files" /></div>
                  </div>
                ))}
                <a className="link" style={{ fontSize: 13 }} onClick={() => setPoints((ps) => [...ps, { text: "", files: [] }])}>+ Add another point</a>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} style={{ ...inputStyle, minHeight: 50, marginTop: 12 }} placeholder="Overall comment (optional)" />
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
                  <button onClick={() => setFailing(false)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "9px 16px", fontWeight: 700 }}>Back</button>
                  <button disabled={!pointsOk} onClick={() => setMode("fail")} style={{ background: pointsOk ? "#C1302B" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 4, padding: "9px 16px", fontWeight: 700 }}>Send back for rework</button>
                </div>
              </div>
            ) : (
              <div style={{ borderTop: "2px solid #1A1A1A", marginTop: 18, paddingTop: 16 }}>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, marginBottom: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1 }} />
                  <span>I confirm that all requirements for this order have been fulfilled and every check above has been done.</span>
                </label>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Signature — {session.name}</div>
                <SignaturePad canvasRef={sigRef} onDrawn={setSigned} />
                {error && <div style={{ color: "#C1302B", fontSize: 13, marginTop: 10 }}>{error}</div>}
                <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap", marginTop: 16 }}>
                  <button onClick={() => setFailing(true)} style={{ background: "#fff", border: "1px solid #C1302B", color: "#C1302B", borderRadius: 4, padding: "10px 18px", fontWeight: 700 }}>Needs rework</button>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={onClose} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "10px 18px", fontWeight: 700 }}>Save & close</button>
                    <button disabled={!(allDone && confirmed && signed)} onClick={() => setMode("pass")} style={{ background: allDone && confirmed && signed ? "#2F8F46" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 4, padding: "10px 18px", fontWeight: 700 }}>Sign & submit — {readyLabel}</button>
                  </div>
                </div>
                {!(allDone && confirmed && signed) && <div style={{ fontSize: 11.5, color: "#8a8a8a", textAlign: "right", marginTop: 6 }}>{!allDone ? "Tick every line" : !confirmed ? "Tick the confirmation" : "Sign above"} to submit.</div>}
              </div>
            )}
          </>
        )}
      </div>

      {mode === "pass" && <ConfirmDialog title={isStore ? "Submit the re-check?" : "Submit the quality check?"} confirmLabel="Yes, submit" busy={busy} onCancel={() => setMode(null)} onConfirm={doPass}>Order {order.jobOrderNo} becomes <strong>{readyLabel}</strong>, and your signature and the time stamps are saved.</ConfirmDialog>}
      {mode === "fail" && <ConfirmDialog title="Send back for rework?" confirmLabel="Yes, send back" busy={busy} onCancel={() => setMode(null)} onConfirm={doFail}>The order goes back to <strong>Rework</strong> with your points{points.some((p) => (p.files || []).length) ? " and photos" : ""}.</ConfirmDialog>}
    </div>
  );
}

// The quality-check record on the order page (Production and Admin only)
function QcRecord({ order }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const load = () => supabase.from("job_order_qc").select("*").eq("job_order_id", order.id).order("started_at").then(({ data }) => setRows(data || []));
    load();
    // a check can be started or ticked without the order's status changing — follow it live
    const channel = supabase.channel("qc-record-" + order.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_order_qc", filter: `job_order_id=eq.${order.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [order.id, order.status]);
  if (rows.length === 0) return null;
  return (
    <div style={{ ...cardStyle, margin: "16px 0" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>QUALITY CHECK RECORD</div>
      {rows.map((r) => (
        <div key={r.id} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #EEE" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: r.status === "passed" ? "#2F8F46" : r.status === "failed" ? "#C1302B" : "#D98E2B" }}>
            {r.stage === "store" ? "Store re-check" : r.rework_id ? "Re-check after rework" : "Production check"} — Round {r.round} — {r.status === "passed" ? "Passed" : r.status === "failed" ? "Sent back for rework" : "In progress"}
          </div>
          <div style={{ fontSize: 12, color: "#8a8a8a", marginBottom: 6 }}>
            Started {fmtDateTime(r.started_at)} by {r.started_by}
            {r.completed_at && <> · finished {fmtDateTime(r.completed_at)} by {r.completed_by} ({fmtDuration(new Date(r.completed_at) - new Date(r.started_at))})</>}
          </div>
          {r.fail_reason && <div style={{ fontSize: 12.5, color: "#C1302B", marginBottom: 6 }}>Reason: {r.fail_reason}{r.fail_attachments && r.fail_attachments.length > 0 && <div style={{ marginTop: 4 }}><AttachmentGallery files={r.fail_attachments} /></div>}</div>}
          <div style={{ fontSize: 12, columns: 2, columnGap: 20 }}>
            {(r.checks || []).map((c) => <div key={c.key} style={{ breakInside: "avoid", marginBottom: 3 }}>{c.ok ? "✓" : "○"} {c.label}{c.detail && <span style={{ color: "#5a5a5a" }}> ({c.detail})</span>}{c.ok && <span className="mono" style={{ color: "#8a8a8a" }}> · {fmtTime(c.at)} {c.by}</span>}</div>)}
          </div>
          {r.notes && <div style={{ fontSize: 12.5, marginTop: 6 }}><strong>Notes:</strong> {r.notes}</div>}
          {r.signature_url && <div style={{ marginTop: 8 }}><div style={{ fontSize: 11.5, color: "#8a8a8a" }}>Signed by {r.completed_by}</div><SecureImg src={r.signature_url} style={{ width: 200, height: 60, objectFit: "contain", border: "1px solid #E5E5E5", borderRadius: 3, background: "#fff" }} /></div>}
        </div>
      ))}
    </div>
  );
}

// The "Quality Check" queue page (Production and Admin)
function QcQueuePage({ orders, session, refresh, flash, onOpenOrder }) {
  const [open, setOpen] = useState({});            // order id -> check under way
  const [checking, setChecking] = useState(null);  // order being checked
  const pending = orders.filter((o) => o.status === "job_pending_qc").sort((a, b) => new Date(a.productionCompletedAt || 0) - new Date(b.productionCompletedAt || 0));
  const rework = orders.filter((o) => o.status === "job_rework");
  useEffect(() => {
    supabase.from("job_order_qc").select("job_order_id, started_by, checks").eq("stage", "production").eq("status", "in_progress")
      .then(({ data }) => setOpen(Object.fromEntries((data || []).map((r) => [r.job_order_id, r]))));
  }, [orders]);
  const th = { textAlign: "left", padding: "8px 10px", fontSize: 12.5, borderBottom: "2px solid #1A1A1A" };
  const td = { padding: "9px 10px", fontSize: 13.5, borderBottom: "1px solid #E5E5E5" };
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 18 }}>QUALITY CHECK</h2>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>WAITING TO BE CHECKED ({pending.length})</div>
      {pending.length === 0 ? <div style={{ color: "#8a8a8a", fontSize: 14, padding: "10px 0 24px" }}>Nothing is waiting for a quality check.</div> : (
        <table style={{ marginBottom: 28 }}>
          <thead><tr><th style={th}>Job order</th><th style={th}>Model</th><th style={th}>Colour</th><th style={th}>Finished</th><th style={th}>Waiting</th><th style={th}>Check</th><th style={th}></th></tr></thead>
          <tbody>
            {pending.map((o) => {
              const r = open[o.id];
              return (
                <tr key={o.id}>
                  <td style={td} className="mono">{o.jobOrderNo}</td><td style={td}>{o.model}{o.cut ? ` · ${o.cut}` : ""}</td><td style={td}>{o.color || "—"}</td>
                  <td style={td}>{o.productionCompletedAt ? fmtDateTime(o.productionCompletedAt) : "—"}</td>
                  <td style={td}>{o.productionCompletedAt ? fmtDuration(Date.now() - new Date(o.productionCompletedAt)) : "—"}</td>
                  <td style={{ ...td, color: r ? "#D98E2B" : "#8a8a8a", fontWeight: 600 }}>{r ? `In progress (${r.checks.filter((c) => c.ok).length}/${r.checks.length}) — ${r.started_by}` : "Not started"}</td>
                  <td style={td}><button onClick={() => setChecking(o)} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "7px 14px", fontWeight: 700, fontSize: 12.5 }}>{r ? "Continue" : "Start check"}</button> <a className="link" style={{ marginLeft: 10, fontSize: 12.5 }} onClick={() => onOpenOrder(o.id)}>Open</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rework.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#C1302B" }}>SENT BACK FOR REWORK ({rework.length})</div>
          {rework.map((o) => <div key={o.id} style={{ padding: "8px 0", borderBottom: "1px solid #EEE", fontSize: 13.5 }}><span className="mono">{o.jobOrderNo}</span> · {o.model} — <a className="link" onClick={() => onOpenOrder(o.id)}>Open to start the rework</a></div>)}
        </>
      )}
      {checking && <QualityCheckDialog order={checking} session={session} onClose={() => { setChecking(null); refresh(); }} onDone={(msg) => { setChecking(null); flash(msg); refresh(); }} />}
    </div>
  );
}

// Admin: the standard checklist editor
function QcSetupPage({ flash }) {
  const [stage, setStage] = useState("production");
  const [rows, setRows] = useState([]);
  const [text, setText] = useState("");
  const load = () => supabase.from("qc_checklist_items").select("*").eq("stage", stage).order("sort_order").then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, [stage]); // eslint-disable-line
  const add = async () => {
    if (!text.trim()) return;
    const next = rows.reduce((m, r) => Math.max(m, r.sort_order), 0) + 10;
    const { error } = await supabase.from("qc_checklist_items").insert({ stage, label: text.trim(), sort_order: next });
    if (error) { flash("Error: " + error.message); return; }
    setText(""); load();
  };
  const rename = async (r, label) => { if (label.trim() && label !== r.label) { await supabase.from("qc_checklist_items").update({ label: label.trim() }).eq("id", r.id); load(); } };
  const toggle = async (r) => { await supabase.from("qc_checklist_items").update({ active: !r.active }).eq("id", r.id); load(); };
  const move = async (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    await supabase.from("qc_checklist_items").update({ sort_order: rows[j].sort_order }).eq("id", rows[i].id);
    await supabase.from("qc_checklist_items").update({ sort_order: rows[i].sort_order }).eq("id", rows[j].id);
    load();
  };
  const pill = (on) => ({ padding: "6px 16px", fontSize: 12.5, borderRadius: 14, cursor: "pointer", border: "1px solid " + (on ? "#1A1A1A" : "#DDE1E7"), background: on ? "#1A1A1A" : "#fff", color: on ? "#fff" : "#1A1A1A" });
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 14 }}>QUALITY CHECKLIST</h2>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 6 }}>
        <button style={pill(stage === "production")} onClick={() => setStage("production")}>Production check</button>
        <button style={pill(stage === "store")} onClick={() => setStage("store")}>Store re-check</button>
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#8a8a8a", marginBottom: 16 }}>These standard lines appear on every check, alongside each order's own requirements and measurements (added automatically). A change only affects checks started after it.</div>
      <div style={cardStyle}>
        {rows.map((r, i) => (
          <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F0F0F0", opacity: r.active ? 1 : 0.5 }}>
            <input defaultValue={r.label} key={r.label} onBlur={(e) => rename(r, e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <a className="link" onClick={() => move(i, -1)}>↑</a><a className="link" onClick={() => move(i, 1)}>↓</a>
            <a className="link" style={{ fontSize: 12 }} onClick={() => toggle(r)}>{r.active ? "Switch off" : "Switch on"}</a>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a check…" style={{ ...inputStyle, flex: 1 }} />
          <button onClick={add} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 700 }}>+ Add</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Delivery to the customer (driver) ---------------- */

const baseNo = (no) => String(no || "").replace(/-\d+$/, "");          // "1042-2" → "1042"
const CD_STATUS = { assigned: ["Scheduled", "#3B6FA0"], delivered: ["Delivered", "#2F8F46"], not_delivered: ["Not delivered", "#C1302B"], cancelled: ["Cancelled", "#8a8a8a"] };
const mapUrlOf = (d) => d.map_link || (d.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}` : "");
const whenText = (iso) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function createCustomerDelivery(session, { orders, driver, whenISO, customerName, customerMobile, address, mapLink, notes, models }) {
  const { data: d, error } = await supabase.from("customer_deliveries").insert({
    kind: "delivery", branch: orders[0].branch, scheduled_at: whenISO, driver_id: driver.id, driver_name: driver.name,
    customer_name: customerName, customer_mobile: customerMobile, address: address || null, map_link: mapLink || null, notes: notes || null, created_by: session.name,
  }).select().single();
  if (error) return { error };
  const { error: e2 } = await supabase.from("customer_delivery_items").insert(orders.map((o) => {
    const m = (models || []).find((x) => x.modelNo === o.model);
    return { delivery_id: d.id, job_order_id: o.id, order_no: o.jobOrderNo, model: o.model, color: o.color || null, cut: o.cut || null, photo_url: (m && m.photoUrl) || null };
  }));
  if (e2) return { error: e2 };
  for (const o of orders) await advanceOrder(session, o, "delivery_assigned", `${d.delivery_no} — ${driver.name}, ${whenText(whenISO)}`, null, null, { silent: true });
  if (address || mapLink) await supabase.from("customer_profiles").update({ address: address || null, map_link: mapLink || null }).eq("mobile", customerMobile);   // pre-fills next time
  notify(session, `Delivery ${d.delivery_no} assigned to ${driver.name} for ${whenText(whenISO)}: ${orders.map((o) => o.jobOrderNo).join(", ")}`, "delivery", orders[0].branch, { type: "cdelivery", id: d.id }, { hideFromProduction: true });
  return { delivery: d };
}

async function cancelCustomerDelivery(session, d, items, orders) {
  const { error } = await supabase.from("customer_deliveries").update({ status: "cancelled" }).eq("id", d.id);
  if (error) return { error };
  for (const it of items) {
    const o = orders.find((x) => x.id === it.job_order_id);
    if (o && o.status === "delivery_assigned") await advanceOrder(session, o, "ready_in_stores", `${d.delivery_no} cancelled`, null, null, { silent: true });
  }
  notify(session, `Delivery ${d.delivery_no} was cancelled (${items.map((i) => i.order_no).join(", ")})`, "delivery", d.branch, { type: "cdelivery", id: d.id }, { hideFromProduction: true });
  return {};
}

function CustomerDeliveriesPage({ orders, models, session, refresh, flash, openRequest, clearOpenRequest }) {
  const [deliveries, setDeliveries] = useState([]);
  const [items, setItems] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [dlg, setDlg] = useState(null);       // { type: "assign" | "pickup" | "edit" | "view" | "cancel", delivery? }
  const mine = (o) => session.role === "admin" || o.branch === session.branch;

  const load = async () => {
    const { data: d } = await supabase.from("customer_deliveries").select("*").order("scheduled_at", { ascending: false }).limit(80);
    setDeliveries(d || []);
    const ids = (d || []).map((x) => x.id);
    if (ids.length) { const { data: it } = await supabase.from("customer_delivery_items").select("*").in("delivery_id", ids); setItems(it || []); } else setItems([]);
  };
  useEffect(() => { load(); }, [orders]); // eslint-disable-line   (a driver finishing a delivery changes the orders, so this refreshes by itself)
  useEffect(() => { supabase.rpc("list_drivers").then(({ data }) => setDrivers(data || [])); }, []);
  useEffect(() => { if (openRequest && openRequest.type === "cdelivery") { const d = deliveries.find((x) => x.id === openRequest.id); setDlg({ type: "view", delivery: d || { id: openRequest.id } }); clearOpenRequest(); } }, [openRequest, deliveries.length]); // eslint-disable-line

  const ready = orders.filter((o) => o.status === "ready_in_stores" && mine(o)).sort((a, b) => String(a.jobOrderNo).localeCompare(String(b.jobOrderNo), undefined, { numeric: true }));
  const groups = [];
  ready.forEach((o) => {
    const b = baseNo(o.jobOrderNo);
    let g = groups.find((x) => x.base === b && x.mobile === o.mobile);
    if (!g) { g = { base: b, name: o.name, mobile: o.mobile, pieces: [], total: orders.filter((x) => baseNo(x.jobOrderNo) === b && x.mobile === o.mobile).length }; groups.push(g); }
    g.pieces.push(o);
  });
  const chosen = ready.filter((o) => selected.includes(o.id));
  const lockedMobile = chosen[0] ? chosen[0].mobile : null;
  const toggle = (o) => setSelected((s) => (s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id]));
  const selectGroup = (g) => setSelected((s) => { const all = g.pieces.every((p) => s.includes(p.id)); return all ? s.filter((id) => !g.pieces.some((p) => p.id === id)) : [...new Set([...s, ...g.pieces.map((p) => p.id)])]; });

  const itemsOf = (id) => items.filter((i) => i.delivery_id === id);
  const scheduled = deliveries.filter((d) => d.status === "assigned").sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const recent = deliveries.filter((d) => d.status !== "assigned").slice(0, 25);
  const done = () => { setDlg(null); setSelected([]); refresh(); load(); };
  const th = { textAlign: "left", padding: "8px 10px", fontSize: 12.5, borderBottom: "2px solid #1A1A1A" };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 18 }}>CUSTOMER DELIVERIES</h2>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>READY FOR THE CUSTOMER ({ready.length})</div>
      {ready.length === 0 ? <div style={{ color: "#8a8a8a", fontSize: 14, padding: "6px 0 22px" }}>No pieces are waiting to be delivered.</div> : groups.map((g) => (
        <div key={g.base + g.mobile} style={{ border: "1px solid #DDE1E7", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
            <div><strong>Order {g.base}</strong> · {g.name} · {g.mobile}<span style={{ marginLeft: 10, fontSize: 12, color: g.pieces.length < g.total ? "#D98E2B" : "#2F8F46", fontWeight: 700 }}>{g.pieces.length} of {g.total} piece{g.total === 1 ? "" : "s"} ready</span></div>
            <a className="link" style={{ fontSize: 12.5 }} onClick={() => selectGroup(g)}>{g.pieces.every((p) => selected.includes(p.id)) ? "Unselect all" : "Select all pieces"}</a>
          </div>
          {g.pieces.map((o) => {
            const off = lockedMobile && o.mobile !== lockedMobile;
            return (
              <label key={o.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 6px", borderTop: "1px solid #F0F0F0", opacity: off ? 0.4 : 1, cursor: off ? "not-allowed" : "pointer" }}>
                <input type="checkbox" disabled={off} checked={selected.includes(o.id)} onChange={() => toggle(o)} style={{ width: 20, height: 20 }} />
                <span className="mono" style={{ fontWeight: 700, minWidth: 70 }}>{o.jobOrderNo}</span>
                <span style={{ flex: 1, fontSize: 13.5 }}>{o.model}{o.cut ? ` · ${o.cut}` : ""}{o.color ? ` · ${o.color}` : ""}</span>
                <span style={{ fontSize: 12, color: "#8a8a8a" }}>Due {o.deliveryDate ? fmtDate(o.deliveryDate) : "—"}</span>
              </label>
            );
          })}
        </div>
      ))}
      {chosen.length > 0 && (
        <div style={{ position: "sticky", bottom: 12, background: "#1A1A1A", color: "#fff", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", boxShadow: "0 6px 20px rgba(0,0,0,0.25)", marginBottom: 16 }}>
          <div style={{ fontSize: 13.5 }}>{chosen.length} piece{chosen.length === 1 ? "" : "s"} selected — {chosen[0].name}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setDlg({ type: "assign" })} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontWeight: 700 }}>🛵 Assign a driver</button>
            <button onClick={() => setDlg({ type: "pickup" })} style={{ background: "#fff", color: "#1A1A1A", border: "none", borderRadius: 6, padding: "10px 18px", fontWeight: 700 }}>🏬 Collected in store</button>
          </div>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 13, margin: "24px 0 8px" }}>SCHEDULED ({scheduled.length})</div>
      {scheduled.length === 0 ? <div style={{ color: "#8a8a8a", fontSize: 14 }}>No deliveries are scheduled.</div> : scheduled.map((d) => {
        const late = new Date(d.scheduled_at) < new Date();
        return (
          <div key={d.id} onClick={() => setDlg({ type: "view", delivery: d })} style={{ border: "1px solid " + (late ? "#E8B9B6" : "#BBD0E6"), background: late ? "#FFFAFA" : "#F4F8FC", borderRadius: 8, padding: "12px 16px", marginBottom: 10, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div><span className="mono" style={{ fontWeight: 700 }}>{d.delivery_no}</span> · <strong>{whenText(d.scheduled_at)}</strong>{late && <span style={{ color: "#C1302B", fontWeight: 700, marginLeft: 8, fontSize: 12 }}>time has passed</span>}</div>
              <div style={{ fontSize: 13 }}>🛵 {d.driver_name || "—"}</div>
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{d.customer_name} · {d.customer_mobile}</div>
            <div style={{ fontSize: 12.5, color: "#5a5a5a" }}>{itemsOf(d.id).map((i) => i.order_no).join(", ")}{d.address ? ` — ${d.address}` : ""}</div>
          </div>
        );
      })}

      {recent.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, margin: "26px 0 8px" }}>RECENT</div>
          <table>
            <thead><tr><th style={th}>Delivery</th><th style={th}>Customer</th><th style={th}>Pieces</th><th style={th}>Who</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {recent.map((d) => {
                const its = itemsOf(d.id);
                const part = d.status === "delivered" && its.some((i) => i.delivered === false);
                const st = part ? ["Partly delivered", "#D98E2B"] : CD_STATUS[d.status] || [d.status, "#1A1A1A"];
                return (
                  <tr key={d.id} onClick={() => setDlg({ type: "view", delivery: d })} style={{ cursor: "pointer" }}>
                    <td style={{ padding: "9px 10px", fontSize: 13.5, borderBottom: "1px solid #E5E5E5" }}><span className="mono">{d.delivery_no}</span><div style={{ fontSize: 11.5, color: "#8a8a8a" }}>{d.kind === "pickup" ? "Collected in store" : "Delivery"} · {fmtDateTime(d.delivered_at || d.scheduled_at)}</div></td>
                    <td style={{ padding: "9px 10px", fontSize: 13.5, borderBottom: "1px solid #E5E5E5" }}>{d.customer_name}</td>
                    <td style={{ padding: "9px 10px", fontSize: 13.5, borderBottom: "1px solid #E5E5E5" }}>{its.map((i) => i.order_no).join(", ")}</td>
                    <td style={{ padding: "9px 10px", fontSize: 13.5, borderBottom: "1px solid #E5E5E5" }}>{d.kind === "pickup" ? d.created_by : d.driver_name}</td>
                    <td style={{ padding: "9px 10px", fontSize: 13.5, borderBottom: "1px solid #E5E5E5", color: st[1], fontWeight: 700 }}>{st[0]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {dlg && dlg.type === "assign" && <DeliveryFormDialog pieces={chosen} drivers={drivers} models={models} session={session} onClose={() => setDlg(null)} onDone={(msg) => { flash(msg); done(); }} />}
      {dlg && dlg.type === "edit" && <DeliveryFormDialog delivery={dlg.delivery} pieces={[]} drivers={drivers} models={models} session={session} onClose={() => setDlg(null)} onDone={(msg) => { flash(msg); done(); }} />}
      {dlg && dlg.type === "pickup" && <PickupDialog pieces={chosen} session={session} onClose={() => setDlg(null)} onDone={(msg) => { flash(msg); done(); }} />}
      {dlg && dlg.type === "view" && dlg.delivery && (
        <DeliveryViewDialog delivery={dlg.delivery} items={itemsOf(dlg.delivery.id)} canManage={dlg.delivery.status === "assigned"} onClose={() => setDlg(null)}
          onEdit={() => setDlg({ type: "edit", delivery: dlg.delivery })} onCancel={() => setDlg({ type: "cancel", delivery: dlg.delivery })} />
      )}
      {dlg && dlg.type === "cancel" && (
        <ConfirmDialog title={`Cancel ${dlg.delivery.delivery_no}?`} confirmLabel="Yes, cancel it" onCancel={() => setDlg(null)}
          onConfirm={async () => { const { error } = await cancelCustomerDelivery(session, dlg.delivery, itemsOf(dlg.delivery.id), orders); if (error) flash("Error: " + error.message); else { flash("Delivery cancelled"); done(); } }}>
          The pieces go back to <strong>Ready in Stores</strong> so you can assign them again.
        </ConfirmDialog>
      )}
    </div>
  );
}

function DeliveryFormDialog({ delivery, pieces, drivers, models, session, onClose, onDone }) {
  const editing = !!delivery;
  const toLocal = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const nextHour = () => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return toLocal(d.toISOString()); };
  const [when, setWhen] = useState(editing ? toLocal(delivery.scheduled_at) : nextHour());
  const [driverId, setDriverId] = useState(editing ? delivery.driver_id || "" : "");
  const [name, setName] = useState(editing ? delivery.customer_name || "" : (pieces[0] && pieces[0].name) || "");
  const [mobile, setMobile] = useState(editing ? delivery.customer_mobile || "" : (pieces[0] && pieces[0].mobile) || "");
  const [address, setAddress] = useState(editing ? delivery.address || "" : "");
  const [mapLink, setMapLink] = useState(editing ? delivery.map_link || "" : "");
  const [notes, setNotes] = useState(editing ? delivery.notes || "" : "");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {   // pre-fill the address kept on the customer's profile
    if (editing || !pieces[0]) return;
    supabase.from("customer_profiles").select("address,map_link").eq("mobile", pieces[0].mobile).limit(1).then(({ data }) => {
      if (data && data[0]) { if (data[0].address) setAddress(data[0].address); if (data[0].map_link) setMapLink(data[0].map_link); }
    });
  }, []); // eslint-disable-line

  const driver = drivers.find((d) => d.id === driverId);
  const check = () => {
    if (!when) return "Choose the date and time.";
    if (!driver) return "Choose the driver.";
    if (!name.trim() || !mobile.trim()) return "The customer's name and mobile number are needed.";
    if (!address.trim() && !mapLink.trim()) return "Enter the delivery address or a map link.";
    return "";
  };
  const save = async () => {
    setBusy(true);
    const whenISO = new Date(when).toISOString();
    let res;
    if (editing) {
      res = await supabase.from("customer_deliveries").update({ scheduled_at: whenISO, driver_id: driver.id, driver_name: driver.name, customer_name: name.trim(), customer_mobile: mobile.trim(), address: address.trim() || null, map_link: mapLink.trim() || null, notes: notes.trim() || null }).eq("id", delivery.id);
      if (!res.error) notify(session, `Delivery ${delivery.delivery_no} updated: ${driver.name}, ${whenText(whenISO)}`, "delivery", delivery.branch, { type: "cdelivery", id: delivery.id }, { hideFromProduction: true });
    } else {
      res = await createCustomerDelivery(session, { orders: pieces, driver, whenISO, customerName: name.trim(), customerMobile: mobile.trim(), address: address.trim(), mapLink: mapLink.trim(), notes: notes.trim(), models });
    }
    setBusy(false); setConfirm(false);
    if (res.error) { setError(res.error.message); return; }
    onDone(editing ? "Delivery updated" : `Delivery assigned to ${driver.name}`);
  };

  const row = { marginBottom: 12 };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 24, width: "100%", maxWidth: 560 }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20, marginBottom: 4 }}>{editing ? `Edit ${delivery.delivery_no}` : "Assign a driver"}</div>
        {!editing && <div style={{ fontSize: 13, color: "#5a5a5a", marginBottom: 14 }}>{pieces.map((o) => `${o.jobOrderNo} (${o.model}${o.color ? " · " + o.color : ""})`).join(" · ")}</div>}
        <div style={row}><div style={label13}>Date & time *</div><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ ...inputStyle, width: 250 }} /></div>
        <div style={row}>
          <div style={label13}>Driver *</div>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} style={{ ...inputStyle, width: 250 }}>
            <option value="">Choose a driver…</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {drivers.length === 0 && <div style={{ fontSize: 12, color: "#C1302B", marginTop: 4 }}>No driver accounts yet — Admin creates one under Add Users (role: Driver).</div>}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ ...row, flex: 1, minWidth: 200 }}><div style={label13}>Customer name *</div><input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} /></div>
          <div style={{ ...row, flex: 1, minWidth: 200 }}><div style={label13}>Customer mobile *</div><input value={mobile} onChange={(e) => setMobile(e.target.value)} style={inputStyle} /></div>
        </div>
        <div style={row}><div style={label13}>Address *</div><textarea value={address} onChange={(e) => setAddress(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} placeholder="Area, street, building, landmark…" /></div>
        <div style={row}><div style={label13}>Map link (optional)</div><input value={mapLink} onChange={(e) => setMapLink(e.target.value)} style={inputStyle} placeholder="Paste a Google Maps / WhatsApp location link" /></div>
        <div style={row}><div style={label13}>Notes for the driver (optional)</div><input value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} placeholder="e.g. call before arriving, ring bell twice" /></div>
        {error && <div style={{ color: "#C1302B", fontSize: 13, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button onClick={onClose} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "10px 20px", fontWeight: 700 }}>Cancel</button>
          <button onClick={() => { const p = check(); if (p) setError(p); else { setError(""); setConfirm(true); } }} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "10px 22px", fontWeight: 700 }}>{editing ? "Save changes" : "Assign delivery"}</button>
        </div>
      </div>
      {confirm && driver && (
        <ConfirmDialog title={editing ? "Save the changes?" : "Assign this delivery?"} confirmLabel={editing ? "Yes, save" : "Yes, assign"} busy={busy} onCancel={() => setConfirm(false)} onConfirm={save}>
          {editing ? "The driver sees the new details straight away." : <>{pieces.length} piece{pieces.length === 1 ? "" : "s"} go to <strong>Delivery Assigned</strong> and appear on {driver.name}'s calendar for <strong>{whenText(new Date(when).toISOString())}</strong>.</>}
        </ConfirmDialog>
      )}
    </div>
  );
}

function PickupDialog({ pieces, session, onClose, onDone }) {
  const [by, setBy] = useState((pieces[0] && pieces[0].name) || "");
  const [mobile, setMobile] = useState((pieces[0] && pieces[0].mobile) || "");
  const [signed, setSigned] = useState(false);
  const sigCanvas = React.useRef(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    let ref = null;
    if (signed && sigCanvas.current) {
      const blob = await new Promise((r) => sigCanvas.current.toBlob(r, "image/png"));
      const up = blob ? await uploadCustomerFile(`delivery-proof/pickup-${pieces[0].id}-${Date.now()}.png`, blob, "image/png") : { error: { message: "no signature" } };
      if (up.error) { setError("Couldn't save the signature: " + up.error.message); setBusy(false); setConfirm(false); return; }
      ref = up.ref;
    }
    const { error: e } = await supabase.rpc("record_pickup", { p_order_ids: pieces.map((p) => p.id), p_received_by: by.trim(), p_received_mobile: mobile.trim(), p_signature: ref });
    setBusy(false); setConfirm(false);
    if (e) { setError(e.message); return; }
    onDone("Handed over — marked Delivered");
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 24, width: "100%", maxWidth: 520 }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20, marginBottom: 4 }}>Collected in the store</div>
        <div style={{ fontSize: 13, color: "#5a5a5a", marginBottom: 14 }}>{pieces.map((o) => o.jobOrderNo).join(", ")}</div>
        <div style={{ marginBottom: 12 }}><div style={label13}>Collected by *</div><input value={by} onChange={(e) => setBy(e.target.value)} style={inputStyle} /></div>
        <div style={{ marginBottom: 12 }}><div style={label13}>Mobile number</div><input value={mobile} onChange={(e) => setMobile(e.target.value)} style={inputStyle} /></div>
        <div style={label13}>Signature (optional)</div>
        <SignaturePad canvasRef={sigCanvas} onDrawn={setSigned} />
        {error && <div style={{ color: "#C1302B", fontSize: 13, marginTop: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "10px 20px", fontWeight: 700 }}>Cancel</button>
          <button disabled={!by.trim() && !mobile.trim()} onClick={() => setConfirm(true)} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 4, padding: "10px 22px", fontWeight: 700 }}>Hand over</button>
        </div>
      </div>
      {confirm && <ConfirmDialog title="Hand these pieces over?" confirmLabel="Yes, handed over" busy={busy} onCancel={() => setConfirm(false)} onConfirm={go}>{pieces.length} piece{pieces.length === 1 ? "" : "s"} become <strong>Delivered</strong>, received by {by || "the customer"}.</ConfirmDialog>}
    </div>
  );
}

function DeliveryViewDialog({ delivery: d, items, canManage, onClose, onEdit, onCancel }) {
  const st = CD_STATUS[d.status] || [d.status || "", "#1A1A1A"];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 24, width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div><div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{d.delivery_no || "Delivery"}</div><div style={{ fontSize: 13, color: st[1], fontWeight: 700 }}>{st[0]}{d.kind === "pickup" ? " — collected in store" : ""}</div></div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, color: "#8a8a8a" }}>×</button>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.8, margin: "10px 0" }}>
          {d.scheduled_at && <div><strong>{d.kind === "pickup" ? "Handed over" : "Scheduled"}:</strong> {whenText(d.scheduled_at)}</div>}
          {d.driver_name && <div><strong>Driver:</strong> {d.driver_name}</div>}
          <div><strong>Customer:</strong> {d.customer_name} · {d.customer_mobile}</div>
          {d.address && <div><strong>Address:</strong> {d.address}</div>}
          {mapUrlOf(d) && d.kind !== "pickup" && <div><a className="link" href={mapUrlOf(d)} target="_blank" rel="noreferrer">Open in maps ↗</a></div>}
          {d.notes && <div><strong>Notes:</strong> {d.notes}</div>}
        </div>
        {items.map((i) => (
          <div key={i.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0", borderTop: "1px solid #F0F0F0" }}>
            <span className="mono" style={{ fontWeight: 700, minWidth: 70 }}>{i.order_no}</span>
            <span style={{ flex: 1, fontSize: 13.5 }}>{i.model}{i.cut ? ` · ${i.cut}` : ""}{i.color ? ` · ${i.color}` : ""}</span>
            {i.delivered === true && <span style={{ color: "#2F8F46", fontWeight: 700, fontSize: 12 }}>Delivered</span>}
            {i.delivered === false && <span style={{ color: "#C1302B", fontWeight: 700, fontSize: 12 }}>Not delivered</span>}
          </div>
        ))}
        {(d.status === "delivered" || d.fail_reason) && (
          <div style={{ marginTop: 12, padding: 12, background: "#F7F9FB", borderRadius: 6, fontSize: 13.5, lineHeight: 1.8 }}>
            {d.status === "delivered" && (<>
              <div><strong>Received by:</strong> {d.received_by || "—"}{d.received_mobile ? ` · ${d.received_mobile}` : ""}</div>
              <div><strong>Proof:</strong> {d.proof_type === "both" ? "signature + mobile number" : d.proof_type === "signature" ? "signature" : "mobile number"} · {fmtDateTime(d.delivered_at)}{d.kind === "delivery" && d.delivered_by ? ` · by ${d.delivered_by}` : ""}</div>
              {d.signature_url && <SecureImg src={d.signature_url} style={{ width: 240, height: 80, objectFit: "contain", border: "1px solid #E5E5E5", borderRadius: 3, background: "#fff", marginTop: 6 }} />}
            </>)}
            {d.fail_reason && <div style={{ color: "#C1302B" }}><strong>Could not deliver:</strong> {d.fail_reason} · {fmtDateTime(d.delivered_at)}</div>}
          </div>
        )}
        {canManage && (
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={onCancel} style={{ background: "#fff", border: "1px solid #E8B9B6", color: "#C1302B", borderRadius: 4, padding: "9px 18px", fontWeight: 700 }}>Cancel delivery</button>
            <button onClick={onEdit} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "9px 18px", fontWeight: 700 }}>Edit time / driver / address</button>
          </div>
        )}
      </div>
    </div>
  );
}

function DriverApp({ profile, onLogout }) {
  const [rows, setRows] = useState([]);
  const [items, setItems] = useState([]);
  const [day, setDay] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [loading, setLoading] = useState(true);
  const [handover, setHandover] = useState(null);     // delivery being handed over
  const [failing, setFailing] = useState(null);       // delivery that couldn't be delivered
  const [toast, setToast] = useState("");

  const load = async () => {
    const { data: d } = await supabase.from("customer_deliveries").select("*").order("scheduled_at");
    setRows(d || []);
    const ids = (d || []).map((x) => x.id);
    if (ids.length) { const { data: it } = await supabase.from("customer_delivery_items").select("*").in("delivery_id", ids); setItems(it || []); } else setItems([]);
    setLoading(false);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("driver-live").on("postgres_changes", { event: "*", schema: "public", table: "customer_deliveries" }, () => load()).subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(load, 60000);
    return () => { supabase.removeChannel(ch); document.removeEventListener("visibilitychange", onVisible); clearInterval(t); };
  }, []); // eslint-disable-line

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };
  const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const sameDay = (a, b) => dayStart(a).getTime() === dayStart(b).getTime();
  const isToday = sameDay(day, new Date());
  const todays = rows.filter((r) => sameDay(r.scheduled_at, day) && r.status !== "cancelled");
  const earlier = isToday ? rows.filter((r) => r.status === "assigned" && new Date(r.scheduled_at) < dayStart(new Date())) : [];
  const strip = [-1, 0, 1, 2, 3, 4, 5].map((n) => { const x = new Date(); x.setDate(x.getDate() + n); return dayStart(x); });
  const openCount = (d) => rows.filter((r) => r.status === "assigned" && sameDay(r.scheduled_at, d)).length;
  const itemsOf = (id) => items.filter((i) => i.delivery_id === id);
  const shift = (n) => setDay((d) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; });

  const Card = ({ d }) => {
    const st = CD_STATUS[d.status] || [d.status, "#1A1A1A"];
    const late = d.status === "assigned" && new Date(d.scheduled_at) < new Date();
    const its = itemsOf(d.id);
    return (
      <div style={{ background: "#fff", border: "1px solid " + (late ? "#E8B9B6" : "#DDE1E7"), borderLeft: `5px solid ${st[1]}`, borderRadius: 10, padding: 14, marginBottom: 12, boxShadow: "0 2px 8px rgba(20,30,50,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{new Date(d.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          <div style={{ fontSize: 12, color: st[1], fontWeight: 700 }}>{st[0]}{late ? " · late" : ""} · <span className="mono">{d.delivery_no}</span></div>
        </div>
        {!isToday || sameDay(d.scheduled_at, day) ? null : <div style={{ fontSize: 12, color: "#C1302B" }}>{whenText(d.scheduled_at)}</div>}
        <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>{d.customer_name}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          {d.customer_mobile && <a href={`tel:${d.customer_mobile}`} style={{ textDecoration: "none", background: "#EAF3EC", color: "#2F8F46", borderRadius: 20, padding: "7px 14px", fontSize: 13.5, fontWeight: 700 }}>📞 {d.customer_mobile}</a>}
          {mapUrlOf(d) && <a href={mapUrlOf(d)} target="_blank" rel="noreferrer" style={{ textDecoration: "none", background: "#EAF1F8", color: "#2F5F8F", borderRadius: 20, padding: "7px 14px", fontSize: 13.5, fontWeight: 700 }}>📍 Open in maps</a>}
        </div>
        {d.address && <div style={{ fontSize: 13.5, color: "#333", marginBottom: 6 }}>{d.address}</div>}
        {d.notes && <div style={{ fontSize: 13, color: "#8a5a00", background: "#FFF8E6", borderRadius: 6, padding: "6px 10px", marginBottom: 8 }}>📝 {d.notes}</div>}
        {its.map((i) => (
          <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderTop: "1px solid #F0F0F0" }}>
            {i.photo_url ? <img src={i.photo_url} alt="" style={{ width: 42, height: 56, objectFit: "cover", borderRadius: 4, background: "#eee" }} /> : <div style={{ width: 42, height: 56, borderRadius: 4, background: "#eee" }} />}
            <div style={{ flex: 1, fontSize: 13.5 }}><strong className="mono">{i.order_no}</strong><div style={{ color: "#5a5a5a" }}>{i.model}{i.cut ? ` · ${i.cut}` : ""}{i.color ? ` · ${i.color}` : ""}</div></div>
            {i.delivered === true && <span style={{ color: "#2F8F46", fontWeight: 700, fontSize: 12 }}>✓ delivered</span>}
            {i.delivered === false && d.status !== "assigned" && <span style={{ color: "#C1302B", fontWeight: 700, fontSize: 12 }}>not delivered</span>}
          </div>
        ))}
        {d.status === "assigned" && (
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={() => setHandover(d)} style={{ flex: 1, background: "#2F8F46", color: "#fff", border: "none", borderRadius: 8, padding: "13px 10px", fontSize: 15, fontWeight: 700 }}>✔ Delivered</button>
            <button onClick={() => setFailing(d)} style={{ background: "#fff", color: "#C1302B", border: "1.5px solid #C1302B", borderRadius: 8, padding: "13px 14px", fontSize: 14, fontWeight: 700 }}>Couldn't deliver</button>
          </div>
        )}
        {d.status === "delivered" && <div style={{ fontSize: 12.5, color: "#5a5a5a", marginTop: 8 }}>Received by {d.received_by || "—"} · {fmtTime(d.delivered_at)}</div>}
        {d.status === "not_delivered" && <div style={{ fontSize: 12.5, color: "#C1302B", marginTop: 8 }}>{d.fail_reason}</div>}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 14px 40px", fontFamily: "Inter, sans-serif" }}>
      <GlobalStyle />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: "2px solid #1A1A1A", marginBottom: 14 }}>
        <div><div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 17, letterSpacing: "0.08em" }}>MOONLIGHT CONCEPT</div><div style={{ fontSize: 12, color: "#8a8a8a" }}>🛵 {profile.name}</div></div>
        <a className="link" style={{ fontSize: 13 }} onClick={onLogout}>Sign out</a>
      </div>

      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 10 }}>
        {strip.map((d) => {
          const sel = sameDay(d, day); const n = openCount(d);
          return (
            <div key={d.toISOString()} onClick={() => setDay(d)} style={{ minWidth: 64, textAlign: "center", padding: "8px 4px", borderRadius: 8, cursor: "pointer", border: "1px solid " + (sel ? "#1A1A1A" : "#DDE1E7"), background: sel ? "#1A1A1A" : "#fff", color: sel ? "#fff" : "#1A1A1A" }}>
              <div style={{ fontSize: 11 }}>{sameDay(d, new Date()) ? "Today" : d.toLocaleDateString([], { weekday: "short" })}</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{d.getDate()}</div>
              <div style={{ fontSize: 11, color: sel ? "#9fd3ab" : n ? "#C1302B" : "#9aa0a8", fontWeight: 700 }}>{n ? `${n} to do` : "—"}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <button onClick={() => shift(-1)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 6, padding: "6px 14px" }}>◀</button>
        <div style={{ fontWeight: 700 }}>{day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>
        <button onClick={() => shift(1)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 6, padding: "6px 14px" }}>▶</button>
      </div>

      {loading ? <div style={{ textAlign: "center", color: "#8a8a8a", padding: 30 }}>Loading…</div> : (
        <>
          {earlier.length > 0 && (<><div style={{ fontWeight: 700, fontSize: 12.5, color: "#C1302B", margin: "6px 0" }}>EARLIER — STILL OPEN ({earlier.length})</div>{earlier.map((d) => <Card key={d.id} d={d} />)}</>)}
          {todays.length === 0 && earlier.length === 0 && <div style={{ textAlign: "center", color: "#8a8a8a", padding: 40, fontSize: 14 }}>No deliveries on this day.</div>}
          {todays.map((d) => <Card key={d.id} d={d} />)}
        </>
      )}

      {handover && <DriverHandoverDialog delivery={handover} items={itemsOf(handover.id)} onClose={() => setHandover(null)} onDone={(m) => { setHandover(null); flash(m); load(); }} />}
      {failing && <DriverFailDialog delivery={failing} onClose={() => setFailing(null)} onDone={(m) => { setFailing(null); flash(m); load(); }} />}
      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#1A1A1A", color: "#fff", padding: "11px 20px", borderRadius: 6, fontSize: 14, zIndex: 1500 }}>{toast}</div>}
    </div>
  );
}

function DriverHandoverDialog({ delivery: d, items, onClose, onDone }) {
  const [ticks, setTicks] = useState(Object.fromEntries(items.map((i) => [i.id, true])));
  const [by, setBy] = useState(d.customer_name || "");
  const [mobile, setMobile] = useState("");
  const [signed, setSigned] = useState(false);
  const sigCanvas = React.useRef(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const picked = items.filter((i) => ticks[i.id]);

  const check = () => {
    if (picked.length === 0) return "Tick the pieces you delivered, or use “Couldn't deliver”.";
    if (!signed && mobile.replace(/\D/g, "").length < 7) return "Get a signature, or enter the receiver's mobile number.";
    return "";
  };
  const submit = async () => {
    setBusy(true); setError("");
    let ref = null;
    if (signed && sigCanvas.current) {
      const blob = await new Promise((r) => sigCanvas.current.toBlob(r, "image/png"));
      const up = blob ? await uploadCustomerFile(`delivery-proof/${d.id}-${Date.now()}.png`, blob, "image/png") : { error: { message: "no signature" } };
      if (up.error) { setError("Couldn't save the signature: " + up.error.message); setBusy(false); setConfirm(false); return; }
      ref = up.ref;
    }
    const { data: notifId, error: e } = await supabase.rpc("complete_delivery", { p_delivery_id: d.id, p_item_ids: picked.map((i) => i.id), p_received_by: by.trim(), p_received_mobile: mobile.trim(), p_signature: ref });
    setBusy(false); setConfirm(false);
    if (e) { setError(e.message); return; }
    if (notifId) supabase.functions.invoke("push-service", { body: { action: "notify", notification_id: notifId } });   // alerts the showroom
    onDone(`Delivered — ${picked.length} piece${picked.length === 1 ? "" : "s"} recorded`);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: 12 }}>
      <div style={{ background: "#fff", borderRadius: 10, padding: 20, width: "100%", maxWidth: 520 }}>
        <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 2 }}>Hand over · {d.delivery_no}</div>
        <div style={{ fontSize: 13, color: "#5a5a5a", marginBottom: 12 }}>{d.customer_name}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>PIECES DELIVERED</div>
        {items.map((i) => (
          <label key={i.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 4px", borderBottom: "1px solid #F0F0F0" }}>
            <input type="checkbox" checked={!!ticks[i.id]} onChange={() => setTicks((t) => ({ ...t, [i.id]: !t[i.id] }))} style={{ width: 24, height: 24 }} />
            <span style={{ fontSize: 14 }}><strong className="mono">{i.order_no}</strong> · {i.model}{i.color ? ` · ${i.color}` : ""}</span>
          </label>
        ))}
        {picked.length < items.length && <div style={{ fontSize: 12, color: "#C1302B", marginTop: 6 }}>Pieces left unticked go back to the store.</div>}

        <div style={{ fontSize: 12.5, fontWeight: 700, margin: "16px 0 6px" }}>PROOF — a signature or the receiver's mobile number</div>
        <div style={{ marginBottom: 10 }}><div style={label13}>Received by</div><input value={by} onChange={(e) => setBy(e.target.value)} style={inputStyle} /></div>
        <div style={{ marginBottom: 10 }}>
          <div style={label13}>Receiver's mobile number</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={mobile} inputMode="tel" onChange={(e) => setMobile(e.target.value)} style={inputStyle} placeholder="e.g. 5551 2345" />
            {d.customer_mobile && <button onClick={() => setMobile(d.customer_mobile)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "0 12px", fontSize: 12, whiteSpace: "nowrap" }}>Customer's number</button>}
          </div>
        </div>
        <div style={label13}>Signature</div>
        <SignaturePad canvasRef={sigCanvas} onDrawn={setSigned} />

        {error && <div style={{ color: "#C1302B", fontSize: 13.5, marginTop: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 8, padding: "13px 18px", fontWeight: 700 }}>Back</button>
          <button onClick={() => { const p = check(); if (p) setError(p); else { setError(""); setConfirm(true); } }} style={{ flex: 1, background: "#2F8F46", color: "#fff", border: "none", borderRadius: 8, padding: "13px 10px", fontSize: 15, fontWeight: 700 }}>Submit delivery</button>
        </div>
      </div>
      {confirm && <ConfirmDialog title="Submit this delivery?" confirmLabel="Yes, submit" busy={busy} onCancel={() => setConfirm(false)} onConfirm={submit}>{picked.length} piece{picked.length === 1 ? "" : "s"} handed over to {by || "the customer"}. This closes the delivery.</ConfirmDialog>}
    </div>
  );
}

function DriverFailDialog({ delivery: d, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const quick = ["Customer not available", "Wrong / unclear address", "Customer refused", "Customer asked to reschedule"];
  const go = async () => {
    setBusy(true);
    const { data: notifId, error: e } = await supabase.rpc("fail_delivery", { p_delivery_id: d.id, p_reason: reason.trim() });
    setBusy(false);
    if (e) { setError(e.message); return; }
    if (notifId) supabase.functions.invoke("push-service", { body: { action: "notify", notification_id: notifId } });
    onDone("Recorded — the showroom has been told");
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: "#fff", borderRadius: 10, padding: 20, width: "100%", maxWidth: 480 }}>
        <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 8 }}>Couldn't deliver · {d.delivery_no}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {quick.map((q) => <button key={q} onClick={() => setReason(q)} style={{ background: reason === q ? "#1A1A1A" : "#fff", color: reason === q ? "#fff" : "#1A1A1A", border: "1px solid #C9CDD3", borderRadius: 18, padding: "7px 14px", fontSize: 13 }}>{q}</button>)}
        </div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 70 }} placeholder="Reason (required)" />
        {error && <div style={{ color: "#C1302B", fontSize: 13.5, marginTop: 8 }}>{error}</div>}
        <div style={{ fontSize: 12, color: "#8a8a8a", marginTop: 8 }}>The pieces go back to the store and the showroom can arrange a new delivery.</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 8, padding: "11px 18px", fontWeight: 700 }}>Back</button>
          <button disabled={!reason.trim() || busy} onClick={go} style={{ background: reason.trim() ? "#C1302B" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 8, padding: "11px 18px", fontWeight: 700 }}>{busy ? "Saving…" : "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

function DeliveryRecord({ order }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    supabase.from("customer_delivery_items").select("*, delivery:customer_deliveries(*)").eq("job_order_id", order.id)
      .then(({ data }) => setRows((data || []).filter((r) => r.delivery).sort((a, b) => new Date(b.delivery.created_at) - new Date(a.delivery.created_at))));
  }, [order.id, order.status]);
  if (rows.length === 0) return null;
  return (
    <div style={{ ...cardStyle, margin: "16px 0" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>CUSTOMER DELIVERY RECORD</div>
      {rows.map((r) => {
        const d = r.delivery;
        const st = CD_STATUS[d.status] || [d.status, "#1A1A1A"];
        return (
          <div key={r.id} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #EEE", fontSize: 12.5, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: st[1] }}><span className="mono">{d.delivery_no}</span> — {d.kind === "pickup" ? "Collected in store" : "Delivery to customer"} · {r.delivered === false ? "this piece not delivered" : st[0]}</div>
            {d.kind === "delivery" && <div>{whenText(d.scheduled_at)} · driver {d.driver_name || "—"}{d.address ? ` · ${d.address}` : ""}</div>}
            {d.status === "delivered" && r.delivered !== false && (<>
              <div>Received by <strong>{d.received_by || "—"}</strong>{d.received_mobile ? ` · ${d.received_mobile}` : ""} · {fmtDateTime(d.delivered_at)}</div>
              {d.signature_url && <SecureImg src={d.signature_url} style={{ width: 200, height: 64, objectFit: "contain", border: "1px solid #E5E5E5", borderRadius: 3, background: "#fff", marginTop: 4 }} />}
            </>)}
            {d.fail_reason && <div style={{ color: "#C1302B" }}>Could not deliver: {d.fail_reason}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Delivery to stores ---------------- */

async function createDeliveryNote(session, { branch, sendAt, carriedBy, notes, orders, attachments }) {
  const { data: note, error } = await supabase.from("delivery_notes")
    .insert({ branch, send_at: sendAt, carried_by: carriedBy || null, notes: notes || null, attachments: attachments || [], created_by: session.name }).select().single();
  if (error) return { error };
  const { error: e2 } = await supabase.from("delivery_note_items").insert(orders.map((o) => ({ delivery_note_id: note.id, job_order_id: o.id })));
  if (e2) return { error: e2 };
  for (const o of orders) await advanceOrder(session, o, "in_transit", `${note.note_no} to ${branch}`, null, null, { silent: true });
  notify(session, `Delivery ${note.note_no} is on its way to ${branch}: ${orders.length} piece${orders.length === 1 ? "" : "s"}`, "delivery", branch, { type: "delivery", id: note.id });
  return { note };
}

// items: [{ id, order }], received: { itemId: true/false }
async function acceptDelivery(session, note, items, received, signatureRef) {
  const now = new Date().toISOString();
  const missing = [];
  let got = 0;
  for (const it of items) {
    const ok = !!received[it.id];
    await supabase.from("delivery_note_items").update({ received: ok, received_at: now }).eq("id", it.id);
    if (ok) { got++; await advanceOrder(session, it.order, "store_received", `${note.note_no} accepted at ${note.branch}`, null, null, { silent: true }); }
    else { missing.push(it.order); await advanceOrder(session, it.order, "ready_in_production", `Not received at ${note.branch} (${note.note_no})`, null, null, { silent: true }); }
  }
  const status = missing.length === 0 ? "accepted" : "partial";
  const { error } = await supabase.from("delivery_notes").update({ status, accepted_by: session.name, accepted_at: now, accepted_signature_url: signatureRef || null }).eq("id", note.id);
  notify(session, `${note.note_no} ${missing.length ? "arrived with missing pieces" : "was accepted"} at ${note.branch}: ${got} of ${items.length} received${missing.length ? " — not received: " + missing.map((o) => o.jobOrderNo).join(", ") : ""}`,
    "delivery", note.branch, { type: "delivery", id: note.id }, { internal: true });   // Production and Admin only
  return { error };
}

// Opens a clean A4 delivery note in a new window and prints it
async function printDeliveryNote(note, rows) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const w = window.open("", "_blank");
  if (!w) { window.alert("Please allow pop-ups to print the delivery note."); return; }
  const sig = note.accepted_signature_url ? await resolveFileUrl(note.accepted_signature_url) : "";
  w.document.write(`<!doctype html><html><head><title>Delivery note ${esc(note.note_no)}</title><style>
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: Georgia, serif; color: #111; font-size: 13px; }
    h1 { font-size: 20px; letter-spacing: 2px; margin: 0 0 8px; }
    .meta div { margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
    th { background: #f2f2f2; }
    .sign { display: flex; gap: 40px; margin-top: 70px; }
    .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 12px; }
  </style></head><body>
  <h1>MOONLIGHT CONCEPT — DELIVERY NOTE</h1>
  <div class="meta">
    <div><strong>Note no:</strong> ${esc(note.note_no)}</div><div><strong>From:</strong> Production</div><div><strong>To:</strong> ${esc(note.branch)}</div>
    <div><strong>Sent:</strong> ${esc(new Date(note.send_at).toLocaleString())}</div>
    ${note.carried_by ? `<div><strong>Carried by:</strong> ${esc(note.carried_by)}</div>` : ""}${note.notes ? `<div><strong>Notes:</strong> ${esc(note.notes)}</div>` : ""}
  </div>
  <table><thead><tr><th>#</th><th>Job order</th><th>Model</th><th>Colour</th><th>Cut</th><th>Due</th><th style="width:70px">Received</th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.no)}</td><td>${esc(r.model)}</td><td>${esc(r.color)}</td><td>${esc(r.cut)}</td><td>${esc(r.due)}</td><td></td></tr>`).join("")}
  </tbody></table>
  <div style="margin-top:10px"><strong>Total pieces:</strong> ${rows.length}</div>
  ${note.attachments && note.attachments.length ? `<div>Photos / videos attached: ${note.attachments.length}</div>` : ""}
  <div class="sign"><div>Sent by (Production)</div><div>${note.accepted_by ? `Received by ${esc(note.accepted_by)}, ${esc(new Date(note.accepted_at).toLocaleString())}${sig ? `<br><img src="${esc(sig)}" style="height:60px">` : ""}` : `Received by (${esc(note.branch)})`}</div></div>
  <script>window.onload = function () { window.print(); };<\/script></body></html>`);
  w.document.close();
}

const DN_STATUS = { sent: ["On the way", "#3B6FA0"], accepted: ["Accepted", "#2F8F46"], partial: ["Partly received", "#C1302B"] };

// Production / Admin: the "Delivery to Stores" page
function DeliveryNotesPage({ orders, session, refresh, flash, openRequest, clearOpenRequest }) {
  const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const [notes, setNotes] = useState([]);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState([]);
  const [sendAt, setSendAt] = useState(nowLocal());
  const [carriedBy, setCarriedBy] = useState("");
  const [noteText, setNoteText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [attach, setAttach] = useState([]);

  const load = async () => {
    const { data: n } = await supabase.from("delivery_notes").select("*").order("created_at", { ascending: false }).limit(60);
    setNotes(n || []);
    const ids = (n || []).map((x) => x.id);
    if (ids.length) { const { data: it } = await supabase.from("delivery_note_items").select("*").in("delivery_note_id", ids); setItems(it || []); } else setItems([]);
  };
  useEffect(() => { load(); }, [orders]); // eslint-disable-line
  useEffect(() => { if (openRequest && openRequest.type === "delivery") { setViewId(openRequest.id); clearOpenRequest(); } }, [openRequest]); // eslint-disable-line

  const ready = orders.filter((o) => o.status === "ready_in_production").sort((a, b) => (a.branch || "").localeCompare(b.branch || "") || String(a.jobOrderNo).localeCompare(String(b.jobOrderNo)));
  const chosen = ready.filter((o) => selected.includes(o.id));
  const branch = chosen[0] ? chosen[0].branch : "";
  const toggle = (o) => setSelected((s) => (s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id]));
  const byBranch = ready.reduce((m, o) => { (m[o.branch || "—"] = m[o.branch || "—"] || []).push(o); return m; }, {});

  const doSend = async () => {
    setBusy(true);
    const res = await createDeliveryNote(session, { branch, sendAt: new Date(sendAt).toISOString(), carriedBy: carriedBy.trim(), notes: noteText.trim(), orders: chosen, attachments: attach });
    setBusy(false); setConfirm(false);
    if (res.error) { flash("Error: " + res.error.message); return; }
    flash(`Delivery ${res.note.note_no} sent to ${branch}`);
    setSelected([]); setCarriedBy(""); setNoteText(""); setAttach([]); setSendAt(nowLocal()); refresh(); load();
  };

  const rowsOf = (noteId) => items.filter((i) => i.delivery_note_id === noteId).map((i) => {
    const o = orders.find((x) => x.id === i.job_order_id) || {};
    return { id: i.id, orderId: o.id, no: o.jobOrderNo, model: o.model, color: o.color || "", cut: o.cut || "", due: o.deliveryDate ? fmtDate(o.deliveryDate) : "", received: i.received };
  });
  const viewNote = notes.find((n) => n.id === viewId);
  const th = { textAlign: "left", padding: "8px 10px", fontSize: 12.5, borderBottom: "2px solid #1A1A1A" };
  const td = { padding: "9px 10px", fontSize: 13.5, borderBottom: "1px solid #E5E5E5" };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 18 }}>DELIVERY TO STORES</h2>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>READY IN PRODUCTION ({ready.length})</div>
      {ready.length === 0 ? <div style={{ color: "#8a8a8a", fontSize: 14, padding: "6px 0 24px" }}>No finished pieces are waiting to be sent.</div> : (
        <div style={{ marginBottom: 20 }}>
          {Object.entries(byBranch).map(([b, list]) => (
            <div key={b} style={{ border: "1px solid #DDE1E7", borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <strong>🏬 {b}</strong>
                <a className="link" style={{ fontSize: 12.5 }} onClick={() => setSelected(list.map((o) => o.id))}>Select all for {b}</a>
              </div>
              {list.map((o) => {
                const off = branch && o.branch !== branch;
                return (
                  <label key={o.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 6px", borderBottom: "1px solid #F0F0F0", opacity: off ? 0.4 : 1, cursor: off ? "not-allowed" : "pointer" }}>
                    <input type="checkbox" disabled={off} checked={selected.includes(o.id)} onChange={() => toggle(o)} style={{ width: 20, height: 20 }} />
                    <span className="mono" style={{ fontWeight: 700, minWidth: 70 }}>{o.jobOrderNo}</span>
                    <span style={{ flex: 1, fontSize: 13.5 }}>{o.model}{o.cut ? ` · ${o.cut}` : ""}{o.color ? ` · ${o.color}` : ""}</span>
                    <span style={{ fontSize: 12, color: "#8a8a8a" }}>Due {o.deliveryDate ? fmtDate(o.deliveryDate) : "—"}</span>
                  </label>
                );
              })}
            </div>
          ))}

          {chosen.length > 0 && (
            <div style={{ ...cardStyle, marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>New delivery note — {chosen.length} piece{chosen.length === 1 ? "" : "s"} to {branch}</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div><div style={label13}>Date & time</div><input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} style={{ ...inputStyle, width: 220 }} /></div>
                <div><div style={label13}>Carried by (optional)</div><input value={carriedBy} onChange={(e) => setCarriedBy(e.target.value)} placeholder="Driver / van" style={{ ...inputStyle, width: 200 }} /></div>
                <div style={{ flex: 1, minWidth: 220 }}><div style={label13}>Notes (optional)</div><input value={noteText} onChange={(e) => setNoteText(e.target.value)} style={inputStyle} /></div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "#8a8a8a", marginBottom: 4 }}>Photos / videos of the pieces being sent (recommended — proof of what left Production)</div>
                <AttachmentField files={attach} onChange={setAttach} folder="delivery-files" />
              </div>
              <div style={{ textAlign: "right", marginTop: 12 }}>
                <button onClick={() => setConfirm(true)} disabled={!sendAt} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "10px 20px", fontWeight: 700 }}>Create delivery note & send</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 13, margin: "24px 0 8px" }}>DELIVERY NOTES</div>
      {notes.length === 0 ? <div style={{ color: "#8a8a8a", fontSize: 14 }}>No delivery notes yet.</div> : (
        <table>
          <thead><tr><th style={th}>Note</th><th style={th}>To</th><th style={th}>Sent</th><th style={th}>Pieces</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {notes.map((n) => {
              const st = DN_STATUS[n.status] || [n.status, "#1A1A1A"];
              return (
                <tr key={n.id}>
                  <td style={td} className="mono">{n.note_no}</td><td style={td}>{n.branch}</td><td style={td}>{fmtDateTime(n.send_at)}</td>
                  <td style={td}>{items.filter((i) => i.delivery_note_id === n.id).length}</td>
                  <td style={{ ...td, color: st[1], fontWeight: 700 }}>{st[0]}</td>
                  <td style={td}><a className="link" onClick={() => setViewId(n.id)}>View</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {viewNote && (
        <div onClick={() => setViewId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 24, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div><div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{viewNote.note_no}</div><div style={{ fontSize: 13, color: "#5a5a5a" }}>To {viewNote.branch} · {fmtDateTime(viewNote.send_at)}{viewNote.carried_by ? ` · carried by ${viewNote.carried_by}` : ""}</div></div>
              <button onClick={() => setViewId(null)} style={{ background: "none", border: "none", fontSize: 24, color: "#8a8a8a" }}>×</button>
            </div>
            <div style={{ fontSize: 13, margin: "8px 0", color: (DN_STATUS[viewNote.status] || [])[1], fontWeight: 700 }}>{(DN_STATUS[viewNote.status] || [viewNote.status])[0]}{viewNote.accepted_at ? ` — ${viewNote.accepted_by}, ${fmtDateTime(viewNote.accepted_at)}` : ""}</div>
            {viewNote.notes && <div style={{ fontSize: 13, marginBottom: 8 }}>Notes: {viewNote.notes}</div>}
            {viewNote.attachments && viewNote.attachments.length > 0 && <div style={{ margin: "10px 0" }}><div style={label13}>Photos / videos of the delivery</div><AttachmentGallery files={viewNote.attachments} /></div>}
            {viewNote.accepted_by && (
              <div style={{ margin: "10px 0" }}>
                <div style={{ fontSize: 12.5 }}>Received by <strong>{viewNote.accepted_by}</strong> · {fmtDateTime(viewNote.accepted_at)}</div>
                {viewNote.accepted_signature_url && <SecureImg src={viewNote.accepted_signature_url} style={{ width: 220, height: 70, objectFit: "contain", border: "1px solid #E5E5E5", borderRadius: 3, background: "#fff", marginTop: 4 }} />}
              </div>
            )}
            {rowsOf(viewNote.id).map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid #F0F0F0", fontSize: 13.5, alignItems: "center" }}>
                <span className="mono" style={{ fontWeight: 700, minWidth: 70 }}>{r.no}</span><span style={{ flex: 1 }}>{r.model}{r.cut ? ` · ${r.cut}` : ""}{r.color ? ` · ${r.color}` : ""}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: r.received === true ? "#2F8F46" : r.received === false ? "#C1302B" : "#8a8a8a" }}>{r.received === true ? "Received" : r.received === false ? "Not received" : "On the way"}</span>
              </div>
            ))}
            <div style={{ textAlign: "right", marginTop: 14 }}>
              <button onClick={() => printDeliveryNote(viewNote, rowsOf(viewNote.id))} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "9px 18px", fontWeight: 700 }}>Print delivery note</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog title={`Send ${chosen.length} piece${chosen.length === 1 ? "" : "s"} to ${branch}?`} confirmLabel="Yes, send" busy={busy} onCancel={() => setConfirm(false)} onConfirm={doSend}>
          A numbered delivery note is created, the pieces move to <strong>Delivery to Stores</strong>, and {branch} is notified that the delivery is coming.
          <ul style={{ margin: "10px 0 0 18px", padding: 0 }}>{chosen.map((o) => <li key={o.id}>{o.jobOrderNo} — {o.model}{o.color ? ` · ${o.color}` : ""}</li>)}</ul>
        </ConfirmDialog>
      )}
    </div>
  );
}

// Sales / Admin: the "Incoming Deliveries" page (accept, then re-check)
function IncomingDeliveriesPage({ orders, session, refresh, flash, openRequest, clearOpenRequest }) {
  const [notes, setNotes] = useState([]);
  const [items, setItems] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [received, setReceived] = useState({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(null);
  const [qcOpen, setQcOpen] = useState({});
  const sigRef = React.useRef(null);
  const [signed, setSigned] = useState(false);
  useEffect(() => { setSigned(false); }, [openId]);   // a fresh signature pad every time a delivery is opened

  const load = async () => {
    const { data: n } = await supabase.from("delivery_notes").select("*").order("created_at", { ascending: false }).limit(40);
    setNotes(n || []);
    const ids = (n || []).map((x) => x.id);
    if (ids.length) { const { data: it } = await supabase.from("delivery_note_items").select("*").in("delivery_note_id", ids); setItems(it || []); } else setItems([]);
    const { data: q } = await supabase.from("job_order_qc").select("job_order_id, checks").eq("stage", "store").eq("status", "in_progress");
    setQcOpen(Object.fromEntries((q || []).map((r) => [r.job_order_id, r])));
  };
  useEffect(() => { load(); }, [orders]); // eslint-disable-line
  useEffect(() => { if (openRequest && openRequest.type === "delivery") { setOpenId(openRequest.id); clearOpenRequest(); } }, [openRequest]); // eslint-disable-line

  const mine = (o) => session.role === "admin" || o.branch === session.branch;
  const rowsOf = (noteId) => items.filter((i) => i.delivery_note_id === noteId).map((i) => ({ id: i.id, order: orders.find((x) => x.id === i.job_order_id) || {}, received: i.received }));
  const note = notes.find((n) => n.id === openId);
  const rows = note ? rowsOf(note.id) : [];
  useEffect(() => { if (note && note.status === "sent") setReceived(Object.fromEntries(rowsOf(note.id).map((r) => [r.id, true]))); }, [openId, items.length]); // eslint-disable-line

  const incoming = notes.filter((n) => n.status === "sent");
  const recent = notes.filter((n) => n.status !== "sent").slice(0, 12);
  const toCheck = orders.filter((o) => o.status === "store_received" && mine(o));
  const notReceived = rows.filter((r) => !received[r.id]).length;

  const doAccept = async () => {
    setBusy(true);
    const blob = sigRef.current ? await new Promise((r) => sigRef.current.toBlob(r, "image/png")) : null;
    const up = blob ? await uploadCustomerFile(`delivery-signatures/${note.id}-${Date.now()}.png`, blob, "image/png") : { error: { message: "no signature drawn" } };
    if (up.error) { flash("Couldn't save the signature: " + up.error.message); setBusy(false); setConfirm(false); return; }
    const { error } = await acceptDelivery(session, note, rows.filter((r) => r.order && r.order.id), received, up.ref);
    setBusy(false); setConfirm(false);
    if (error) { flash("Error: " + error.message); return; }
    flash(`${note.note_no} accepted`); setOpenId(null); setSigned(false); refresh(); load();
  };

  const th = { textAlign: "left", padding: "8px 10px", fontSize: 12.5, borderBottom: "2px solid #1A1A1A" };
  const td = { padding: "9px 10px", fontSize: 13.5, borderBottom: "1px solid #E5E5E5" };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 18 }}>INCOMING DELIVERIES</h2>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>ON THE WAY — TO ACCEPT ({incoming.length})</div>
      {incoming.length === 0 ? <div style={{ color: "#8a8a8a", fontSize: 14, padding: "6px 0 22px" }}>No deliveries are on the way.</div> : incoming.map((n) => (
        <div key={n.id} onClick={() => setOpenId(n.id)} style={{ border: "1px solid #BBD0E6", background: "#F4F8FC", borderRadius: 8, padding: "12px 16px", marginBottom: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div><span className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{n.note_no}</span> · from Production to {n.branch}<div style={{ fontSize: 12.5, color: "#5a5a5a" }}>Sent {fmtDateTime(n.send_at)} · {items.filter((i) => i.delivery_note_id === n.id).length} pieces{n.carried_by ? ` · carried by ${n.carried_by}` : ""}</div></div>
          <button style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 700 }}>Open & accept</button>
        </div>
      ))}

      <div style={{ fontWeight: 700, fontSize: 13, margin: "22px 0 8px" }}>ACCEPTED — WAITING FOR RE-CHECK ({toCheck.length})</div>
      {toCheck.length === 0 ? <div style={{ color: "#8a8a8a", fontSize: 14 }}>Nothing is waiting for a re-check.</div> : (
        <table>
          <thead><tr><th style={th}>Job order</th><th style={th}>Model</th><th style={th}>Colour</th><th style={th}>Due</th><th style={th}>Re-check</th><th style={th}></th></tr></thead>
          <tbody>
            {toCheck.map((o) => { const r = qcOpen[o.id]; return (
              <tr key={o.id}>
                <td style={td} className="mono">{o.jobOrderNo}</td><td style={td}>{o.model}{o.cut ? ` · ${o.cut}` : ""}</td><td style={td}>{o.color || "—"}</td>
                <td style={td}>{o.deliveryDate ? fmtDate(o.deliveryDate) : "—"}</td>
                <td style={{ ...td, color: r ? "#D98E2B" : "#8a8a8a", fontWeight: 600 }}>{r ? `In progress (${r.checks.filter((c) => c.ok).length}/${r.checks.length})` : "Not started"}</td>
                <td style={td}><button onClick={() => setChecking(o)} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "7px 14px", fontWeight: 700, fontSize: 12.5 }}>{r ? "Continue" : "Start re-check"}</button></td>
              </tr>
            ); })}
          </tbody>
        </table>
      )}

      {recent.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, margin: "26px 0 8px" }}>RECENT DELIVERIES</div>
          {recent.map((n) => { const st = DN_STATUS[n.status] || [n.status, "#1A1A1A"]; return (
            <div key={n.id} onClick={() => setOpenId(n.id)} style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px", borderBottom: "1px solid #EEE", cursor: "pointer", fontSize: 13.5 }}>
              <span><span className="mono" style={{ fontWeight: 700 }}>{n.note_no}</span> · {n.branch} · {fmtDateTime(n.send_at)}</span><span style={{ color: st[1], fontWeight: 700 }}>{st[0]}</span>
            </div>
          ); })}
        </>
      )}

      {note && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 24, width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div><div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{note.note_no}</div><div style={{ fontSize: 13, color: "#5a5a5a" }}>From Production to {note.branch} · sent {fmtDateTime(note.send_at)}{note.carried_by ? ` · carried by ${note.carried_by}` : ""}</div></div>
              <button onClick={() => setOpenId(null)} style={{ background: "none", border: "none", fontSize: 24, color: "#8a8a8a" }}>×</button>
            </div>
            {note.notes && <div style={{ fontSize: 13, margin: "8px 0" }}>Notes: {note.notes}</div>}
            {note.attachments && note.attachments.length > 0 && <div style={{ margin: "10px 0" }}><div style={label13}>Photos / videos of the delivery</div><AttachmentGallery files={note.attachments} /></div>}
            {note.accepted_by && (
              <div style={{ margin: "10px 0" }}>
                <div style={{ fontSize: 12.5 }}>Received by <strong>{note.accepted_by}</strong> · {fmtDateTime(note.accepted_at)}</div>
                {note.accepted_signature_url && <SecureImg src={note.accepted_signature_url} style={{ width: 220, height: 70, objectFit: "contain", border: "1px solid #E5E5E5", borderRadius: 3, background: "#fff", marginTop: 4 }} />}
              </div>
            )}
            <div style={{ fontSize: 12.5, color: "#8a8a8a", margin: "10px 0 6px" }}>{note.status === "sent" ? "Tick each piece that has actually arrived." : (DN_STATUS[note.status] || [note.status])[0] + (note.accepted_at ? ` — ${note.accepted_by}, ${fmtDateTime(note.accepted_at)}` : "")}</div>
            {rows.map((r) => (
              <label key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 6px", borderBottom: "1px solid #F0F0F0", cursor: note.status === "sent" ? "pointer" : "default" }}>
                {note.status === "sent"
                  ? <input type="checkbox" checked={!!received[r.id]} onChange={() => setReceived((m) => ({ ...m, [r.id]: !m[r.id] }))} style={{ width: 22, height: 22 }} />
                  : <span style={{ width: 22, textAlign: "center", fontWeight: 700, color: r.received ? "#2F8F46" : "#C1302B" }}>{r.received ? "✓" : "✗"}</span>}
                <span className="mono" style={{ fontWeight: 700, minWidth: 70 }}>{r.order.jobOrderNo}</span>
                <span style={{ flex: 1, fontSize: 13.5 }}>{r.order.model}{r.order.cut ? ` · ${r.order.cut}` : ""}{r.order.color ? ` · ${r.order.color}` : ""}</span>
                <span style={{ fontSize: 12, color: "#8a8a8a" }}>Due {r.order.deliveryDate ? fmtDate(r.order.deliveryDate) : "—"}</span>
              </label>
            ))}
            {note.status === "sent" && notReceived > 0 && <div style={{ color: "#C1302B", fontSize: 12.5, marginTop: 10 }}>{notReceived} piece{notReceived === 1 ? "" : "s"} not ticked — they go back to Production as "not received".</div>}
            {note.status === "sent" && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Received by {session.name} — sign to accept</div>
                <SignaturePad canvasRef={sigRef} onDrawn={setSigned} />
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setOpenId(null)} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "9px 18px", fontWeight: 700 }}>Close</button>
              {note.status === "sent" && <button disabled={!signed} onClick={() => setConfirm(true)} style={{ background: signed ? "#2F8F46" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 4, padding: "9px 18px", fontWeight: 700 }}>Accept delivery</button>}
            </div>
            {note.status === "sent" && !signed && <div style={{ fontSize: 11.5, color: "#8a8a8a", textAlign: "right", marginTop: 6 }}>Sign above to accept.</div>}
          </div>
        </div>
      )}

      {confirm && note && (
        <ConfirmDialog title={`Accept ${note.note_no}?`} confirmLabel="Yes, accept" busy={busy} onCancel={() => setConfirm(false)} onConfirm={doAccept}>
          {rows.length - notReceived} piece{rows.length - notReceived === 1 ? "" : "s"} become <strong>Delivery Accepted — Re-Quality Check</strong>.
          {notReceived > 0 && <div style={{ marginTop: 8, color: "#C1302B" }}>{notReceived} piece{notReceived === 1 ? "" : "s"} not received will go back to Ready in Production.</div>}
        </ConfirmDialog>
      )}
      {checking && <QualityCheckDialog order={checking} session={session} stage="store" onClose={() => { setChecking(null); refresh(); load(); }} onDone={(msg) => { setChecking(null); flash(msg); refresh(); load(); }} />}
    </div>
  );
}

// The order side panel for Sales / Admin: the store re-check
function StoreActions({ order, session, onDone, flash }) {
  const [dlg, setDlg] = useState(false);
  const [open, setOpen] = useState(false);
  const mine = session.role === "admin" || (session.role === "sales" && order.branch === session.branch);
  useEffect(() => {
    if (!mine || order.status !== "store_received") return;
    supabase.from("job_order_qc").select("id").eq("job_order_id", order.id).eq("stage", "store").eq("status", "in_progress").limit(1).then(({ data }) => setOpen(!!(data && data[0])));
  }, [order.id, order.status]); // eslint-disable-line
  if (!mine || !["in_transit", "store_received"].includes(order.status)) return null;
  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>STORE</div>
      {order.status === "in_transit" && <div style={{ fontSize: 13 }}>This piece is on its way to the store. Accept it from <strong>Incoming Deliveries</strong> on the Home dashboard.</div>}
      {order.status === "store_received" && <button onClick={() => setDlg(true)} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 4, padding: "10px 18px", fontSize: 13, fontWeight: 700 }}>{open ? "Continue re-check" : "Start re-quality check"}</button>}
      {dlg && <QualityCheckDialog order={order} session={session} stage="store" onClose={() => { setDlg(false); onDone && onDone(); }} onDone={(msg) => { setDlg(false); flash && flash(msg); onDone && onDone(); }} />}
    </div>
  );
}

/* ---------------- Rework: point by point ---------------- */

function ReworkCompleteDialog({ rework, order, session, onClose, onDone }) {
  const [points, setPoints] = useState((rework.points || []).map((p) => ({ ...p })));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setP = (i, patch) => setPoints((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const toggle = (i) => setP(i, points[i].fixed ? { fixed: false, fixed_at: null, fixed_by: null } : { fixed: true, fixed_at: new Date().toISOString(), fixed_by: session.name });
  const allFixed = points.length > 0 && points.every((p) => p.fixed);
  const doDone = async () => {
    setBusy(true); setError("");
    const { error: e1 } = await supabase.from("job_order_rework").update({ points, status: "completed", completed_at: new Date().toISOString(), completed_by: session.name }).eq("id", rework.id);
    if (e1) { setError(e1.message); setBusy(false); setConfirm(false); return; }
    const { error: e2 } = await completeProduction(session, order);
    setBusy(false);
    if (e2) { setError(e2.message); setConfirm(false); return; }
    onDone && onDone();
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 24, width: "100%", maxWidth: 720 }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20 }}>Complete the rework · round {rework.round}</div>
        <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 6 }}>Order {order.jobOrderNo} · {order.model}. Sent back by {rework.raised_by} ({rework.source === "store" ? `from ${rework.branch || "the store"}` : "quality check"}).</div>
        {rework.comment && <div style={{ fontSize: 13, marginBottom: 10 }}>Comment: {rework.comment}</div>}
        {points.map((p, i) => (
          <div key={p.id} style={{ border: "1px solid " + (p.fixed ? "#BFE0C7" : "#E5E5E5"), background: p.fixed ? "#F2FAF4" : "#fff", borderRadius: 6, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div onClick={() => toggle(i)} style={{ width: 28, height: 28, borderRadius: 5, border: "2px solid " + (p.fixed ? "#2F8F46" : "#9aa0a8"), background: p.fixed ? "#2F8F46" : "#fff", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>{p.fixed ? "✓" : ""}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14 }}><strong>{i + 1}.</strong> {p.text}</div>
                {p.files && p.files.length > 0 && <div style={{ margin: "6px 0" }}><AttachmentGallery files={p.files} /></div>}
                <input value={p.response || ""} onChange={(e) => setP(i, { response: e.target.value })} placeholder="What was done? (optional)" style={{ ...inputStyle, marginTop: 6 }} />
                <div style={{ marginTop: 6 }}><AttachmentField files={p.response_files || []} onChange={(f) => setP(i, { response_files: f })} folder="rework-files" /></div>
                {p.fixed && <div className="mono" style={{ fontSize: 11, color: "#8a8a8a", marginTop: 4 }}>Fixed {fmtTime(p.fixed_at)} · {p.fixed_by}</div>}
              </div>
            </div>
          </div>
        ))}
        {error && <div style={{ color: "#C1302B", fontSize: 13 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "10px 18px", fontWeight: 700 }}>Cancel</button>
          <button disabled={!allFixed} onClick={() => setConfirm(true)} style={{ background: allFixed ? "#2F8F46" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 4, padding: "10px 18px", fontWeight: 700 }}>Mark rework as completed</button>
        </div>
        {!allFixed && <div style={{ fontSize: 11.5, color: "#8a8a8a", textAlign: "right", marginTop: 6 }}>Tick every point as fixed to complete.</div>}
      </div>
      {confirm && <ConfirmDialog title="Complete the rework?" confirmLabel="Yes, completed" busy={busy} onCancel={() => setConfirm(false)} onConfirm={doDone}>The time stamp stops and the order moves to <strong>Pending Quality Check</strong>, where only these points will be checked.</ConfirmDialog>}
    </div>
  );
}

// The Rework record on the order page (Production and Admin see every rework; Sales only the ones it sent back from a store)
function ReworkRecord({ order }) {
  const [rows, setRows] = useState([]);
  const [crew, setCrew] = useState([]);
  useEffect(() => {
    const load = () => {
      supabase.from("job_order_rework").select("*").eq("job_order_id", order.id).order("raised_at").then(({ data }) => setRows(data || []));
      supabase.from("job_order_tailors").select("*").eq("job_order_id", order.id).not("rework_id", "is", null).then(({ data }) => setCrew(data || []));
    };
    load();
    const channel = supabase.channel("rework-record-" + order.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_order_rework", filter: `job_order_id=eq.${order.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [order.id, order.status]);
  if (rows.length === 0) return null;
  const stat = { open: ["Waiting for Production", "#D98E2B"], in_progress: ["Being reworked", "#3B6FA0"], completed: ["Reworked — waiting for re-check", "#D98E2B"], verified: ["Verified by quality check", "#2F8F46"], superseded: ["Did not pass the re-check", "#C1302B"] };
  return (
    <div style={{ ...cardStyle, margin: "16px 0" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>REWORK RECORD</div>
      {rows.map((r) => {
        const st = r.status === "verified" && r.store_verified_at ? ["Verified — re-checked at the store", "#2F8F46"] : (stat[r.status] || [r.status, "#1A1A1A"]);
        return (
          <div key={r.id} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #EEE" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: st[1] }}>Round {r.round} — {st[0]}</div>
            <div style={{ fontSize: 12, color: "#8a8a8a", marginBottom: 6 }}>
              Sent back by {r.raised_by} ({r.source === "store" ? `from the store${r.branch ? ", " + r.branch : ""}` : "production quality check"}) · {fmtDateTime(r.raised_at)}
              {r.started_at && <> · started {fmtDateTime(r.started_at)} by {r.started_by}</>}
              {r.completed_at && <> · finished {fmtDateTime(r.completed_at)} by {r.completed_by}</>}
              {r.verified_at && <> · verified {fmtDateTime(r.verified_at)} by {r.verified_by}</>}
              {r.store_verified_at && <> · re-checked at the store {fmtDateTime(r.store_verified_at)} by {r.store_verified_by}</>}
            </div>
            {r.comment && <div style={{ fontSize: 12.5, marginBottom: 6 }}><strong>Comment:</strong> {r.comment}</div>}
            {(r.points || []).map((p, i) => (
              <div key={p.id} style={{ padding: "6px 0", borderTop: "1px dashed #EEE", fontSize: 12.5 }}>
                <div><strong>{i + 1}.</strong> {p.text}</div>
                {p.files && p.files.length > 0 && <div style={{ margin: "4px 0" }}><AttachmentGallery files={p.files} /></div>}
                {(p.fixed || p.response) && <div style={{ color: "#2F8F46", marginTop: 2 }}>✓ {p.fixed_by ? `${p.fixed_by} · ${fmtTime(p.fixed_at)}` : ""}{p.response ? ` — ${p.response}` : ""}</div>}
                {p.response_files && p.response_files.length > 0 && <div style={{ margin: "4px 0" }}><AttachmentGallery files={p.response_files} /></div>}
              </div>
            ))}
            {crew.filter((c) => c.rework_id === r.id).length > 0 && (
              <div style={{ fontSize: 12, marginTop: 6 }}><strong>Tailors:</strong> {crew.filter((c) => c.rework_id === r.id).map((c) => c.worker_name + (c.task ? ` (${c.task})` : "")).join(", ")}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// All Records: switch between the working list and the pieces already delivered to the stores
function RecordsViewTabs({ value, onChange, tabs }) {
  return (
    <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 14, flexWrap: "wrap" }}>
      {tabs.map(([k, label, n]) => (
        <button key={k} onClick={() => onChange(k)} style={{ padding: "7px 16px", fontSize: 13, borderRadius: 16, cursor: "pointer", border: "1px solid " + (value === k ? "#1A1A1A" : "#DDE1E7"), background: value === k ? "#1A1A1A" : "#fff", color: value === k ? "#fff" : "#1A1A1A" }}>{label}{n != null ? ` (${n})` : ""}</button>
      ))}
    </div>
  );
}

/* ---------------- Order detail ---------------- */

function OrderDetail({ order, role, session, onClose, onSaveFields, onAction, onResubmit, onDelete, onEditFull, onViewFull, models, flash, onProductionDone }) {
  const [edit, setEdit] = useState(false);
  const [comment, setComment] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  useEffect(() => {
    if (openFocus.current === "history") {
      openFocus.current = null;
      setTimeout(() => { const el = document.getElementById("order-history"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 150);
    }
  }, [order.id]); // eslint-disable-line
  const seesInternal = role === "production" || role === "admin";
  const pii = role === "production";                    // Production never sees the customer's name or mobile number
  const editable = canEditFields(order.status, role);
  const resubmittable = canResubmit(order.status, role);
  const actions = role === "production" ? productionActions(order.status) : role === "sales" ? salesActions(order.status) : [];

  const confirmAction = (a) => {
    if (a.needsComment && !pendingAction) { setPendingAction(a); return; }
    onAction(order.id, a.to, a.needsComment ? comment : undefined);
    setPendingAction(null); setComment("");
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "flex-end", zIndex: 400 }} className="no-print" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: 520, maxWidth: "100%", height: "100%", overflowY: "auto", padding: "26px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div>
            <div className="mono" style={{ fontSize: 12, color: "#8a8a8a" }}>{order.invoiceNo}</div>
            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20 }}>{pii ? order.jobOrderNo : order.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "#8a8a8a" }}>×</button>
        </div>
        <StatusTag status={order.status} />

        {!edit ? (
          <div style={{ marginTop: 16 }}>
            {seesInternal && onViewFull && <div style={{ marginBottom: 14 }}><FullOrderButton onClick={() => onViewFull(order.id)} /></div>}
            <ProductionActions order={order} session={session} models={models || []} onDone={onProductionDone} flash={flash} />
            <StoreActions order={order} session={session} onDone={onProductionDone} flash={flash} />
            {!pii && <Row l="Mobile" v={order.mobile} />}<Row l="Order Type" v={order.orderType} />
            <Row l="Model" v={<ModelPeek order={order} models={models} />} />
            <Row l="Colour" v={order.color ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {order.colorSwatch && <img src={order.colorSwatch} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: "cover", border: "1px solid #E5E5E5" }} />}
                {order.color}
              </span>
            ) : "—"} />
            <Row l="Cut" v={order.cut || "—"} /><Row l="Item" v={order.item} />
            <Row l="Prepared By" v={order.preparedBy} /><Row l="Branch" v={order.branch} />
            <Row l="Delivery Date" v={fmtDate(order.deliveryDate)} />
            <Row l="Sheila Type" v={order.sheilaType} /><Row l="Abaya Option" v={order.abayaOption ? abayaLabel(normAbaya(order.abayaOption)) + (normAbaya(order.abayaOption) === BUTTON_RANGE ? ` (${order.buttonFrom || "—"} to ${order.buttonTill || "—"})` : "") : "—"} />
            <Row l="Additional Requirements" v={order.additionalRequirements || "—"} />
            <div style={{ margin: "12px 0" }}>
              <div style={label13}>Attachments</div>
              <AttachmentGallery files={order.attachments} />
            </div>
            <Row l="Attachment" v={order.attachmentUrl ? <SecureLink href={order.attachmentUrl}>View file</SecureLink> : "—"} />
            <Row l="Comments" v={order.comments || "—"} />
            <div style={{ marginTop: 10, fontWeight: 700, fontSize: 12.5, color: "#5a5a5a" }}>MEASUREMENTS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 13 }}>
              {ALL_MEASURE_FIELDS.filter(([k]) => order.measurements && order.measurements[k]).map(([k, l]) => <div key={k}>{l}: {order.measurements[k]}</div>)}
            </div>

            {onViewFull && !seesInternal && <div style={{ marginTop: 14 }}><FullOrderButton onClick={() => onViewFull(order.id)} /></div>}
            {editable && onEditFull && (
              <button onClick={() => onEditFull(order.id)} style={{ marginTop: 14, marginLeft: 8, background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "8px 16px", fontSize: 13, fontWeight: 700 }}>Edit Full Job Order</button>
            )}
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

            {seesInternal && <ProductionInfo order={order} />}
            {(seesInternal || role === "sales") && <QcRecord order={order} />}
            {(seesInternal || role === "sales") && <ReworkRecord order={order} />}
            {(role === "sales" || role === "admin") && <DeliveryRecord order={order} />}

            <div id="order-history" style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid #E5E5E5" }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#5a5a5a", marginBottom: 8 }}>ACTIVITY LOG</div>
              {order.history.filter((h) => seesInternal || !h.internal).slice().reverse().map((h, i) => {
                let note = seesInternal ? h.note : (h.public_note || h.note);
                if (pii) note = (note || "").replace(/(Name|Mobile) \([^)]*→[^)]*\)/g, "$1 (changed)");   // edit entries quote the old and new customer details
                return (
                  <div key={i} style={{ fontSize: 12.5, marginBottom: 8 }}>
                    <div>{note}</div>
                    {h.attachments && h.attachments.length > 0 && <div style={{ margin: "6px 0" }}><AttachmentGallery files={h.attachments} /></div>}
                    <div className="mono" style={{ fontSize: 10.5, color: "#8a8a8a" }}>{h.by} · {fmtDateTime(h.at)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <EditFieldsForm order={order} noPII={pii} onCancel={() => setEdit(false)} onSave={(fields) => { onSaveFields(order.id, fields); setEdit(false); }} />
        )}
      </div>
    </div>
  );
}

function Row({ l, v }) { return <div style={{ display: "flex", fontSize: 13.5, marginBottom: 5 }}><div style={{ width: 130, color: "#8a8a8a" }}>{l}</div><div>{v}</div></div>; }

function EditFieldsForm({ order, onCancel, onSave, noPII }) {
  const [form, setForm] = useState({ ...order, measurements: { ...order.measurements } });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setMeasure = (k) => (e) => setForm((f) => ({ ...f, measurements: { ...f.measurements, [k]: e.target.value } }));
  return (
    <div style={{ marginTop: 14 }}>
      {!noPII && <Field label="Name"><input style={inputStyle} value={form.name} onChange={set("name")} /></Field>}
      {!noPII && <Field label="Mobile"><input style={inputStyle} value={form.mobile} onChange={set("mobile")} /></Field>}
      <Field label="Delivery Date"><input type="date" style={inputStyle} value={form.deliveryDate || ""} onChange={set("deliveryDate")} /></Field>
      <Field label="Comments"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.comments || ""} onChange={set("comments")} /></Field>
      <div style={{ fontWeight: 700, fontSize: 12, color: "#5a5a5a", margin: "10px 0 6px" }}>MEASUREMENTS</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {ALL_MEASURE_FIELDS.map(([k, l]) => <Field key={k} label={l}><input style={inputStyle} value={form.measurements[k] || ""} onChange={setMeasure(k)} /></Field>)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={() => onSave({ ...(noPII ? {} : { name: form.name, mobile: form.mobile }), deliveryDate: form.deliveryDate, comments: form.comments, measurements: form.measurements })} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Save Changes</button>
        <button onClick={onCancel} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700 }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================= Production Panel ================= */

function ProductionPanel({ config, orders, profiles, requirementItems, refresh, session, subpage, setSubpage, selectedId, setSelectedId, flash, openRequest, clearOpenRequest }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  useEffect(() => {
    if (openRequest && openRequest.type === "order") { setSelectedId(openRequest.id); openFocus.current = openRequest.focus || null; clearOpenRequest(); }
  }, [openRequest]); // eslint-disable-line
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [view, setView] = useState("active");
  const visible = orders.filter((o) => (view === "delivered" ? DELIVERED_STATUSES.includes(o.status) : view === "all" ? true : !AFTER_PRODUCTION.includes(o.status)));
  const filtered = useFilteredOrders(visible, query, statusFilter, true);
  const selected = orders.find((o) => o.id === selectedId);

  const handleSaveFields = async (id, fields) => {
    const { error } = await supabase.from("job_orders").update({ ...orderFieldsToDb(fields), updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    const o = orders.find((x) => x.id === id);
    if (o) notify(session, `${session.name} edited order ${o.jobOrderNo} (${o.model})`, "edit", o.branch, { type: "order", id: o.id });
    await refresh(); flash("Changes saved");
  };
  const handleAction = async (id, to, comment) => {
    const current = orders.find((o) => o.id === id);
    const note = comment ? `${STATUS[to].label}: ${comment}` : STATUS[to].label;
    const history = [...current.history, { note, by: session.name, at: new Date().toISOString() }];
    const { error } = await supabase.from("job_orders").update({ status: to, history, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    notify(session, `${session.name}: ${STATUS[to].label} — order ${current.jobOrderNo} (${current.model})${comment ? " — " + comment : ""}`, "status", current.branch, { type: "order", id: current.id });
    await refresh(); flash(STATUS[to].label);
  };

  if (subpage === "items") return <ModelBrowser models={config.models} canEdit={false} session={session} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />;
  if (subpage === "requirements") {
    return <RequirementsPage items={requirementItems} profiles={profiles} orders={orders} canDelete={false} canCreateOrder={false} noPII />;
  }
  if (subpage === "viewOrder") {
    const viewing = orders.find((o) => o.id === editingOrderId);
    if (viewing) return <JobOrderForm config={config} session={session} initialOrder={viewing} readOnly onCancel={() => setSubpage("records")} />;
  }

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ALL RECORDS</h2>
      <RecordsViewTabs value={view} onChange={setView} tabs={[
        ["active", "In production", orders.filter((o) => !AFTER_PRODUCTION.includes(o.status)).length],
        ["delivered", "Delivered to stores", orders.filter((o) => DELIVERED_STATUSES.includes(o.status)).length],
        ["all", "All", orders.length],
      ]} />
      <RecordsToolbar query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} noPII />
      <OrderTable orders={filtered} onOpen={setSelectedId} editableStatuses={["job_rejected"]} noPII />
      {selected && <OrderDetail order={selected} role="production" session={session} onClose={() => setSelectedId(null)} onSaveFields={handleSaveFields} onAction={handleAction} models={config.models} flash={flash} onProductionDone={refresh}
        onViewFull={(id) => { setEditingOrderId(id); setSubpage("viewOrder"); }} />}
    </div>
  );
}

function ModelManagerPanel({ config, refresh, flash, session, subpage, setSubpage, openRequest, clearOpenRequest }) {
  if (subpage === "viewmodels") {
    return <ModelBrowser models={config.models} canEdit={true} refresh={refresh} flash={flash} session={session} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />;
  }
  // default view
  return <ManageModels config={config} refresh={refresh} flash={flash} session={session} />;
}

function ModelDetailPage({ model, models, canEdit, refresh, flash, onBack, session }) {
  const [formula, setFormula] = useState(model.cuttingFormula || {});
  const [images, setImages] = useState([]);
  const [colors, setColors] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [fabrics, setFabrics] = useState([]);
  const [trims, setTrims] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [manpower, setManpower] = useState([]);
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
    setFormula(model.cuttingFormula || {});
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
      bottom_finishing: coreForm.bottomFinishing, cutting_formula: formula, updated_at: new Date().toISOString(), updated_by: session.name,
    }).eq("id", model.id);
    setSavingCore(false);
    if (error) { flash("Error: " + error.message); return; }
    notify(session, `${session.name} updated model ${model.modelNo}`, "model", null, { type: "model", id: model.id });
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
    supabase.from("model_materials").select("*").eq("model_id", model.id).order("created_at").then(({ data }) => setMaterials(data || []));
    supabase.from("model_manpower").select("*").eq("model_id", model.id).order("created_at").then(({ data }) => setManpower(data || []));
    supabase.from("model_documents").select("*").eq("model_id", model.id).then(({ data }) => setDocs(data || []));
  };

  useEffect(loadReadOnlyData, [model.id]);
  useEffect(() => { setFormula(model.cuttingFormula || {}); }, [model.id]); // eslint-disable-line

  const removeModel = async () => {
    await supabase.from("models").delete().eq("id", model.id);
    notify(session, `${session.name} deleted model ${model.modelNo}`, "model", null);
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div style={cardStyle}>
          {(canEdit && editingModel) ? <ModelMaterials model={model} refresh={refresh} flash={flash} /> : (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>MATERIAL USED</div>
              {materials.length > 0 ? materials.map((r) => <div key={r.id} style={{ fontSize: 12.5, padding: "4px 0" }}>{r.material_type} — {r.material_code || "—"} — Qty {r.quantity || "—"}</div>) : <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No materials.</div>}
            </div>
          )}
        </div>
        <div style={cardStyle}>
          {(canEdit && editingModel) ? <ModelManpower model={model} refresh={refresh} flash={flash} /> : (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>MANPOWER DETAILS</div>
              {manpower.length > 0 ? manpower.map((r) => <div key={r.id} style={{ fontSize: 12.5, padding: "4px 0" }}>{r.person_name} — {r.department || "—"} — {r.time_used || "—"}</div>) : <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>No manpower entries.</div>}
            </div>
          )}
        </div>
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

      <div style={{ ...cardStyle, marginTop: 20 }}>
        <CalculationSection
          cuts={cutTagsOf(model).length ? cutTagsOf(model) : ["General"]}
          formula={formula} setFormula={setFormula}
          models={models} currentModelId={model.id}
          customFields={model.customFields}
          onAddCustomField={async (f) => { const ex = model.customFields || []; if (ex.some((x) => x.key === f.key)) return; await supabase.from("models").update({ custom_fields: [...ex, f] }).eq("id", model.id); await refresh(); }}
          readOnly={!(canEdit && editingModel)}
        />
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>SIZE MEASUREMENTS</div>
        {(canEdit && editingModel) ? <ModelSizes model={model} refresh={refresh} flash={flash} /> : <ReadOnlySizeTables model={model} sizes={sizes} />}
      </div>

      {editingModel && (
        <div style={{ display: "flex", gap: 10, marginTop: 24, paddingTop: 20, borderTop: "1px solid #E5E5E5" }}>
          <button disabled={savingCore} onClick={saveCoreEdits} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 4, padding: "10px 22px", fontSize: 13.5, fontWeight: 700 }}>Save Changes</button>
          <button onClick={() => { setEditingModel(false); setFormula(model.cuttingFormula || {}); loadReadOnlyData(); }} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "10px 22px", fontSize: 13.5, fontWeight: 700 }}>Done Editing</button>
        </div>
      )}
      {savingCore && <LoadingOverlay text="Saving changes…" />}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function ModelBrowser({ models, canEdit, refresh, flash, session, openRequest, clearOpenRequest }) {
  const [query, setQuery] = useState("");
  const [keywords, setKeywords] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => {
    if (openRequest && openRequest.type === "model") { setSelectedId(openRequest.id); clearOpenRequest(); }
  }, [openRequest]); // eslint-disable-line

  const addKeyword = () => {
    const k = query.trim();
    if (!k || keywords.includes(k)) return;
    setKeywords((prev) => [...prev, k]);
    setQuery("");
  };
  const removeKeyword = (k) => setKeywords((prev) => prev.filter((x) => x !== k));

  const matchesKeyword = (m, k) => {
    const q = k.toLowerCase();
    return [m.modelNo, m.styleName, m.collectionName, m.category, m.productType, m.season, m.description]
      .filter(Boolean).some((f) => f.toLowerCase().includes(q));
  };

  const filtered = models.filter((m) => {
    const liveQuery = query.trim();
    if (keywords.length === 0 && !liveQuery) return true;
    const allKeywords = liveQuery ? [...keywords, liveQuery] : keywords;
    return allKeywords.every((k) => matchesKeyword(m, k));
  });

  if (selectedId) {
    const current = models.find((m) => m.id === selectedId);
    if (current) return <ModelDetailPage model={current} models={models} canEdit={canEdit} refresh={refresh} flash={flash} session={session} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>VIEW MODELS</h2>
      <div className="no-print" style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center", maxWidth: 600 }}>
          <input
            placeholder="Search collection, model no, style, category, product type, season…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
            style={{ ...inputStyle, width: 320 }}
          />
          <button type="button" onClick={addKeyword} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 14px", fontSize: 12.5, fontWeight: 700 }}>+ Add Filter</button>
        </div>
        {keywords.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 10 }}>
            {keywords.map((k) => (
              <span key={k} style={{ background: "#EEF0F2", border: "1px solid #C9CDD3", borderRadius: 12, padding: "3px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {k}
                <span onClick={() => removeKeyword(k)} style={{ cursor: "pointer", color: "#C1302B", fontWeight: 700 }}>×</span>
              </span>
            ))}
            <a className="link" style={{ fontSize: 11.5, marginLeft: 4 }} onClick={() => setKeywords([])}>Clear all</a>
          </div>
        )}
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

function AdminPanel({ config, refresh, orders, profiles, requirementItems, session, subpage, setSubpage, selectedId, setSelectedId, flash, openRequest, clearOpenRequest }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingOrderId, setEditingOrderId] = useState(null);
  useEffect(() => {
    if (openRequest && openRequest.type === "order") { setSelectedId(openRequest.id); openFocus.current = openRequest.focus || null; clearOpenRequest(); }
  }, [openRequest]); // eslint-disable-line
  const [view, setView] = useState("all");
  const filtered = useFilteredOrders(view === "delivered" ? orders.filter((o) => DELIVERED_STATUSES.includes(o.status)) : orders, query, statusFilter);
  const selected = orders.find((o) => o.id === selectedId);

  const handleDeleteOrder = async (id) => {
    const o = orders.find((x) => x.id === id);
    const { error } = await supabase.from("job_orders").delete().eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    if (o) notify(session, `${session.name} deleted order ${o.jobOrderNo} (${o.model})`, "delete", o.branch);
    setSelectedId(null); await refresh(); flash("Record deleted");
  };
  const handleDeleteRequirement = async (id) => {
    const it = requirementItems.find((r) => r.id === id);
    const cust = it && profiles.find((p) => p.id === it.profileId);
    await supabase.from("requirement_items").delete().eq("id", id);
    notify(session, `${session.name} deleted a requirement`, "delete", undefined, cust ? { type: "customer", id: cust.mobile } : undefined);
    await refresh(); flash("Requirement deleted");
  };
  const handleSaveFields = async (id, fields) => {
    const { error } = await supabase.from("job_orders").update({ ...orderFieldsToDb(fields), updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { flash("Error: " + error.message); return; }
    const o = orders.find((x) => x.id === id);
    if (o) notify(session, `${session.name} edited order ${o.jobOrderNo} (${o.model})`, "edit", o.branch, { type: "order", id: o.id });
    await refresh(); flash("Changes saved");
  };

  const handleCreate = async (form, file) => {
    let attachmentUrl = null;
    if (file) {
      const up = await uploadCustomerFile(`order-files/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`, file, file.type);
      if (up.error) { flash("Couldn't upload the attachment: " + up.error.message); return; }
      attachmentUrl = up.ref;
    }
    const [jobNo] = await nextJobOrderNumbers(1);
    const now = new Date().toISOString();
    const row = {
      job_order_no: jobNo, invoice_no: form.invoiceNo || null, name: form.name, mobile: form.mobile, order_type: form.orderType,
      model: form.model, item: form.item, prepared_by: session.name, branch: form.branch || session.branch,
      measurements: form.measurements, sheila_type: form.sheilaType,
      abaya_option: form.abayaOption || "Normal", button_from: form.buttonFrom || null, button_till: form.buttonTill || null,
      additional_requirements: form.additionalRequirements || null, attachments: form.attachments || [],
      color: form.color || null, color_swatch: form.colorSwatch || null,
      delivery_date: form.deliveryDate || null,
      attachment_url: attachmentUrl || form.attachmentNote || null, comments: form.comments,
      status: "job_created", history: [{ note: `Job order created by Admin (${session.name})`, by: session.name, at: now }],
    };
    const { data, error } = await supabase.from("job_orders").insert(row).select().single();
    if (error) { flash("Error: " + error.message); return; }
    notify(session, `${session.name} created job order ${jobNo}`, "job_order", row.branch, { type: "order", id: data.id });
    await refresh();
    setSubpage("records");
    setSelectedId(data.id);
    flash("Job order created");
  };

  const handleUpdateOrderFull = async (form, file) => {
    const before = orders.find((o) => o.id === editingOrderId);
    let attachmentUrl = before?.attachmentUrl || null;
    if (file) {
      const up = await uploadCustomerFile(`order-files/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`, file, file.type);
      if (up.error) { flash("Couldn't upload the attachment: " + up.error.message); return; }
      attachmentUrl = up.ref;
    }
    const changed = diffSummary(before, form, !!file);
    const now = new Date().toISOString();
    const note = changed.length ? `Job order edited — changed: ${changed.join(", ")}` : "Job order edited (no field changes detected)";
    const history = [...(before?.history || []), { note, by: session.name, at: now }];
    const { error } = await supabase.from("job_orders").update({
      name: form.name, mobile: form.mobile, order_type: form.orderType,
      model: form.model, item: form.item, branch: form.branch, measurements: form.measurements,
      sheila_type: form.sheilaType, abaya_option: form.abayaOption || "Normal", button_from: form.buttonFrom || null, button_till: form.buttonTill || null,
      additional_requirements: form.additionalRequirements || null, attachments: form.attachments || [],
      color: form.color || null, color_swatch: form.colorSwatch || null,
      delivery_date: form.deliveryDate || null, attachment_url: attachmentUrl, comments: form.comments,
      history, updated_at: now,
    }).eq("id", editingOrderId);
    if (error) { flash("Error: " + error.message); return; }
    notify(session, `${session.name} edited order ${before?.jobOrderNo || ""} (${form.model}): ${changed.length ? changed.map((c) => c.split(" (")[0]).join(", ") : "no field changes"}`, "edit", form.branch || before?.branch, { type: "order", id: editingOrderId });
    await refresh(); setSubpage("records"); setSelectedId(editingOrderId); flash("Job order updated");
  };

  const handleSaveRequirement = async (customer, measurements, items, deliveryDate, signatureUrl, createOrders) => {
    const branch = session.branch || (session.role === "admin" ? "Admin" : "");
    const { data: existing } = await supabase.from("customer_profiles").select("id").eq("mobile", customer.mobile).order("created_at", { ascending: false }).limit(1);

    let profile, pErr;
    if (existing && existing.length > 0) {
      const result = await supabase.from("customer_profiles").update({
        name: customer.name, measurements, branch, signature_url: signatureUrl || null, updated_at: new Date().toISOString(),
      }).eq("id", existing[0].id).select().single();
      profile = result.data; pErr = result.error;
    } else {
      const result = await supabase.from("customer_profiles").insert({
        name: customer.name, mobile: customer.mobile, measurements, branch, created_by: session.name,
        signature_url: signatureUrl || null,
      }).select().single();
      profile = result.data; pErr = result.error;
    }
    if (pErr) { flash("Error: " + pErr.message); return false; }

    const validItems = items.filter((it) => !it.error);
    const jobNumbers = createOrders && validItems.length > 0 ? await nextJobOrderNumbers(validItems.length) : [];

    let lastOrderId = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.error) continue;
      let jobOrderId = null;
      if (createOrders) {
        const now = new Date().toISOString();
        const fitNote = `${it.cut ? `Cut: ${it.cut}. ` : ""}${it.size ? `Nearest size: ${it.size}.` : ""}${it.notes ? " Notes: " + it.notes : ""}`;
        const vIdx = validItems.indexOf(it);
        const { data: order } = await supabase.from("job_orders").insert({
          job_order_no: jobNumbers[vIdx], name: customer.name, mobile: customer.mobile, order_type: "New",
          model: it.model, item: ITEM_TYPES[0], prepared_by: session.name, branch,
          measurements: calcToStrings(it.calc), cut: it.cut || null, delivery_date: deliveryDate || null,
          abaya_option: it.abayaOption || "Normal", button_from: it.buttonFrom || null, button_till: it.buttonTill || null,
          additional_requirements: it.additionalRequirements || null, attachments: it.attachments || [],
          color: it.color || null, color_swatch: it.colorSwatch || null,
          comments: fitNote, status: "job_created",
          history: [{ note: `Job order created from customer requirement by Admin (${session.name})`, by: session.name, at: now }],
        }).select().single();
        jobOrderId = order?.id || null;
        lastOrderId = jobOrderId;
        if (order) notify(session, `${session.name} created job order ${order.job_order_no || order.id} from a requirement`, "job_order", branch, { type: "order", id: order.id });
      }
      await supabase.from("requirement_items").insert({
        profile_id: profile.id, model: it.model, recommended_size: it.size || null, deltas: {}, calculated: it.calc || {}, cut: it.cut || null,
        abaya_option: it.abayaOption || "Normal", button_from: it.buttonFrom || null, button_till: it.buttonTill || null,
        additional_requirements: it.additionalRequirements || null, attachments: it.attachments || [],
        color: it.color || null, color_swatch: it.colorSwatch || null,
        notes: it.notes || null, job_order_id: jobOrderId,
      });
    }
    await refresh();
    if (createOrders && lastOrderId) { setSubpage("records"); setSelectedId(lastOrderId); flash("Job order(s) created"); }
    else if (createOrders) { setSubpage("customers"); flash("Customer profile saved"); notify(session, `${session.name} saved a customer requirement`, "requirement", undefined, { type: "customer", id: customer.mobile }); }
    else { const exists = existing && existing.length > 0; flash(exists ? "Profile updated" : "Profile created"); notify(session, `${session.name} ${exists ? "updated" : "created"} a customer profile`, "profile", undefined, { type: "customer", id: customer.mobile }); }
    return true;
  };

  const handleCreateOrderFromRow = async (row) => {
    const branch = row.profile.branch || (session.role === "admin" ? "Admin" : session.branch || "");
    const [jobNo] = await nextJobOrderNumbers(1);
    const now = new Date().toISOString();
    const fitNote = `${row.cut ? `Cut: ${row.cut}. ` : ""}${row.recommendedSize ? `Nearest size: ${row.recommendedSize}.` : ""}${row.notes ? " Notes: " + row.notes : ""}`;
    const { data: order, error } = await supabase.from("job_orders").insert({
      job_order_no: jobNo, name: row.profile.name, mobile: row.profile.mobile, order_type: "New", model: row.model,
      item: ITEM_TYPES[0], prepared_by: session.name, branch,
      measurements: row.calculated && Object.keys(row.calculated).length ? calcToStrings(row.calculated) : suggestionMeasurements(row.profile.measurements, row.deltas),
      cut: row.cut || null, delivery_date: row.deliveryDate || null,
      abaya_option: row.abayaOption || "Normal", button_from: row.buttonFrom || null, button_till: row.buttonTill || null,
      additional_requirements: row.additionalRequirements || null, attachments: row.attachments || [],
      color: row.color || null, color_swatch: row.colorSwatch || null,
      comments: fitNote, status: "job_created",
      history: [{ note: "Job order created from saved requirement", by: session.name, at: now }],
    }).select().single();
    if (error) { flash("Error: " + error.message); return; }
    notify(session, `${session.name} created job order ${order.job_order_no || order.id} from a saved requirement`, "job_order", branch, { type: "order", id: order.id });
    await supabase.from("requirement_items").update({ job_order_id: order.id }).eq("id", row.id);
    await refresh(); setSubpage("records"); setSelectedId(order.id); flash("Job order created");
  };

  if (subpage === "branches") return <ManageList title="ADD / REMOVE BRANCH" items={config.branches} fields={[["name", "Branch Name"]]}
    onAdd={async (item) => { const { error } = await supabase.from("branches").insert(item); if (error) flash("Error: " + error.message); else { await refresh(); flash("Branch added"); } }}
    onRemove={async (id) => { await supabase.from("branches").delete().eq("id", id); await refresh(); }} />;

  if (subpage === "models") return <ManageModels config={config} refresh={refresh} flash={flash} session={session} />;
  if (subpage === "viewmodels") return <ModelBrowser models={config.models} canEdit={true} refresh={refresh} flash={flash} session={session} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />;
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
    return <CustomersPage profiles={profiles} orders={orders} session={session} refresh={refresh} openRequest={openRequest} clearOpenRequest={clearOpenRequest} />;
  }
  if (subpage === "requirements") {
    return (
      <div>
        <SalesTabs subpage={subpage} setSubpage={setSubpage} />
        <RequirementsPage items={requirementItems} profiles={profiles} orders={orders} canDelete={true} canCreateOrder={true} onCreateOrder={handleCreateOrderFromRow} onDelete={handleDeleteRequirement} />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ textAlign: "center", fontFamily: F.display, fontWeight: 700, fontSize: 22, letterSpacing: "0.06em", marginBottom: 20 }}>ALL RECORDS</h2>
      <SalesTabs subpage={subpage} setSubpage={setSubpage} />
      <RecordsViewTabs value={view} onChange={setView} tabs={[["all", "All records", orders.length], ["delivered", "Delivered to stores", orders.filter((o) => DELIVERED_STATUSES.includes(o.status)).length]]} />
      <RecordsToolbar query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
      <div className="no-print" style={{ textAlign: "right", marginBottom: 10 }}>
        <button onClick={() => setSubpage("requirement")} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.03em", marginRight: 8 }}>+ NEW REQUIREMENT</button>
        <button onClick={() => setSubpage("new")} style={{ background: "#1A1A1A", color: "#fff", border: "none", borderRadius: 3, padding: "9px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.03em" }}>+ NEW JOB ORDER</button>
      </div>
      <OrderTable orders={filtered} onOpen={setSelectedId} showDelete onDelete={handleDeleteOrder} />
      {selected && <OrderDetail order={selected} role="admin" session={session} onClose={() => setSelectedId(null)} models={config.models} flash={flash} onProductionDone={refresh}
        onSaveFields={handleSaveFields} onAction={() => {}} onDelete={handleDeleteOrder}
        onEditFull={(id) => { setEditingOrderId(id); setSelectedId(null); setSubpage("editOrder"); }}
        onViewFull={(id) => { setEditingOrderId(id); setSubpage("viewOrder"); }} />}
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
const DEFAULT_TEMPLATE_ROWS = ["shoulder", "chest", "sleeveLength", "sleeveOpen", "armhole", "length", "bottom"];

const calcHasRows = (entry) => !!(entry && entry.rows && Object.keys(entry.rows).length > 0);
const calcRowKeys = (entry) => (calcHasRows(entry) ? Object.keys(entry.rows) : []);
const anyCalc = (formula) => Object.values(formula || {}).some(calcHasRows);
const applyRounding = (v, r) => { const n = parseFloat(r); return n > 0 ? Math.round(v / n) * n : v; };
const runCalc = (entry, fitted) => {
  const out = {};
  Object.entries((entry && entry.rows) || {}).forEach(([k, rule]) => {
    const add = toNum(rule.add) || 0;
    let v = null;
    if (rule.src === "fixed") v = add;
    else {
      const part = (val, d) => { const c = toNum(val); const dv = toNum(d); return c === null ? null : c / (dv ? dv : 1); };
      let first;
      if (rule.div == null && rule.mult != null) { const c = toNum(fitted[k]); const m = toNum(rule.mult); first = c === null ? null : c * (m === null ? 1 : m); }
      else first = part(fitted[k], rule.div);
      if (first !== null) {
        v = first + add;
        for (const ex of rule.extra || []) {
          const p = part(fitted[ex.key], ex.div);
          if (p === null) { v = null; break; }
          v += p;
        }
      }
    }
    if (v !== null) out[k] = +applyRounding(v, entry.round).toFixed(2);
  });
  return out;
};
const calcEntryFor = (model, cut) => {
  const f = (model && model.cuttingFormula) || {};
  const key = cut || cutTagsOf(model)[0] || "General";
  return f[key] || f["General"] || null;
};

function CalculationSection({ cuts, formula, setFormula, models, currentModelId, customFields, onAddCustomField, readOnly }) {
  const [active, setActive] = useState(cuts[0] || "General");
  const [loadModelId, setLoadModelId] = useState("");
  const [loadCut, setLoadCut] = useState("");
  const [addingKey, setAddingKey] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);

  const current = cuts.includes(active) ? active : cuts[0] || "General";
  const entry = (formula && formula[current]) || { rows: {}, round: "0" };
  const allFields = [...FITTING_FIELDS, ...(customFields || []).map((c) => [c.key, c.label])];
  const labelOfKey = (k) => (allFields.find(([x]) => x === k) || [k, k])[1];
  const keys = Object.keys(entry.rows || {});
  const rowFields = allFields.filter(([k]) => keys.includes(k));
  const unused = allFields.filter(([k]) => !keys.includes(k));
  const newRule = () => ({ src: "fitted", div: "1", add: "0", extra: [] });
  const formulaText = (k, r) => r.src === "fixed"
    ? `${r.add || 0} (fixed)`
    : [`${labelOfKey(k)} ÷ ${r.div || 1}`, ...(r.extra || []).map((e) => `${labelOfKey(e.key)} ÷ ${e.div || 1}`)].join(" + ") + ` + ${r.add || 0}`;

  const update = (next) => setFormula({ ...(formula || {}), [current]: next });
  const setRow = (k, patch) => update({ ...entry, rows: { ...entry.rows, [k]: { ...entry.rows[k], ...patch } } });
  const addRow = (k) => update({ ...entry, rows: { ...entry.rows, [k]: newRule() } });
  const removeRow = (k) => { const rows = { ...entry.rows }; delete rows[k]; update({ ...entry, rows }); };
  const addExtra = (k) => {
    const other = (allFields.find(([fk]) => fk !== k) || [""])[0];
    setRow(k, { extra: [...(entry.rows[k].extra || []), { key: other, div: "1" }] });
  };
  const setExtra = (k, i, patch) => setRow(k, { extra: entry.rows[k].extra.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const removeExtra = (k, i) => setRow(k, { extra: entry.rows[k].extra.filter((_, j) => j !== i) });
  const addCommon = () => {
    const rows = { ...(entry.rows || {}) };
    DEFAULT_TEMPLATE_ROWS.forEach((k) => { if (!rows[k]) rows[k] = newRule(); });
    update({ ...entry, rows });
  };
  const addCustom = () => {
    const label = customLabel.trim();
    if (!label) return;
    const key = "custom_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (onAddCustomField) onAddCustomField({ key, label });
    update({ ...entry, rows: { ...(entry.rows || {}), [key]: newRule() } });
    setCustomLabel(""); setAddingCustom(false);
  };

  const loadableModels = (models || []).filter((m) => m.id !== currentModelId && anyCalc(m.cuttingFormula));
  const sourceModel = loadableModels.find((m) => m.id === loadModelId);
  const sourceCuts = sourceModel ? Object.keys(sourceModel.cuttingFormula).filter((c) => calcHasRows(sourceModel.cuttingFormula[c])) : [];
  const doLoad = () => {
    const src = sourceModel && sourceModel.cuttingFormula[loadCut];
    if (!calcHasRows(src)) return;
    if (keys.length > 0 && !window.confirm(`Replace the current ${current} calculation with ${sourceModel.modelNo} (${loadCut})?`)) return;
    Object.keys(src.rows).filter((k) => k.startsWith("custom_")).forEach((k) => {
      const f = (sourceModel.customFields || []).find((c) => c.key === k);
      if (f && !(customFields || []).some((c) => c.key === k) && onAddCustomField) onAddCustomField(f);
    });
    update(JSON.parse(JSON.stringify(src)));
    setLoadModelId(""); setLoadCut("");
  };

  const th = { padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A", textAlign: "left" };
  const td = { padding: "6px 8px", fontSize: 12.5 };
  const small = { ...inputStyle, width: 70, padding: "4px 6px", fontSize: 12.5 };

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>CALCULATION</div>
      <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 12 }}>How the cutting measurement is worked out from the customer's fitted measurement, for each cut. Add this first — the size chart unlocks once a calculation exists.</div>

      {cuts.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {cuts.map((c) => (
            <button key={c} type="button" onClick={() => setActive(c)} style={{ padding: "6px 14px", fontSize: 12, borderRadius: 14, cursor: "pointer", border: "1px solid " + (c === current ? "#1A1A1A" : "#DDE1E7"), background: c === current ? "#1A1A1A" : "#fff", color: c === current ? "#fff" : "#1A1A1A" }}>
              {c}{calcHasRows(formula && formula[c]) ? " ✓" : ""}
            </button>
          ))}
        </div>
      )}

      {!readOnly && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12, padding: 10, background: "#F7F7F5", borderRadius: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Load calculation:</span>
          <select value={loadModelId} onChange={(e) => { setLoadModelId(e.target.value); setLoadCut(""); }} style={{ ...inputStyle, width: 190 }}>
            <option value="">From model number…</option>
            {loadableModels.map((m) => <option key={m.id} value={m.id}>{m.modelNo}{m.styleName ? ` — ${m.styleName}` : ""}</option>)}
          </select>
          {sourceModel && (
            <select value={loadCut} onChange={(e) => setLoadCut(e.target.value)} style={{ ...inputStyle, width: 150 }}>
              <option value="">Which cut…</option>
              {sourceCuts.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button type="button" onClick={doLoad} disabled={!loadCut} style={{ background: loadCut ? "#3B6FA0" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 4, padding: "7px 14px", fontSize: 12, fontWeight: 700 }}>Load</button>
          {loadableModels.length === 0 && <span style={{ fontSize: 11.5, color: "#8a8a8a" }}>No other model has a calculation yet.</span>}
        </div>
      )}

      {keys.length === 0 ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: "#8a8a8a", marginBottom: 6 }}>No calculation for {current} yet.</div>
          {!readOnly && <button type="button" onClick={addCommon} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 4, padding: "6px 12px", fontSize: 12 }}>+ Start with common measurements</button>}
        </div>
      ) : readOnly ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
          <thead><tr style={{ background: "#F7F7F5" }}><th style={th}>Measurement</th><th style={th}>Calculation</th></tr></thead>
          <tbody>
            {rowFields.map(([k, l]) => (
              <tr key={k} style={{ borderBottom: "1px solid #E5E5E5" }}><td style={td}>{l}</td><td style={td}>{formulaText(k, entry.rows[k])}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
              <thead><tr style={{ background: "#F7F7F5" }}>
                <th style={th}>Measurement</th><th style={th}>Based on</th><th style={th}>Divide by</th><th style={th}>Then add</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {rowFields.map(([k, l]) => {
                  const r = entry.rows[k];
                  return (
                    <tr key={k} style={{ borderBottom: "1px solid #E5E5E5", verticalAlign: "top" }}>
                      <td style={td}>{l}</td>
                      <td style={td}>
                        <select value={r.src} onChange={(e) => setRow(k, { src: e.target.value })} style={{ ...inputStyle, width: 170, padding: "4px 6px", fontSize: 12.5 }}>
                          <option value="fitted">Fitted measurement</option>
                          <option value="fixed">Fixed value</option>
                        </select>
                        {r.src === "fitted" && (
                          <div style={{ marginTop: 6 }}>
                            {(r.extra || []).map((ex, i) => (
                              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, fontSize: 12 }}>
                                <span>+</span>
                                <select value={ex.key} onChange={(e) => setExtra(k, i, { key: e.target.value })} style={{ ...inputStyle, width: 140, padding: "3px 6px", fontSize: 12 }}>
                                  {allFields.map(([fk, fl]) => <option key={fk} value={fk}>{fl}</option>)}
                                </select>
                                <span>÷</span>
                                <input value={ex.div} onChange={(e) => setExtra(k, i, { div: e.target.value })} style={{ ...small, width: 50 }} />
                                <a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => removeExtra(k, i)}>×</a>
                              </div>
                            ))}
                            <a className="link" style={{ fontSize: 11.5 }} onClick={() => addExtra(k)}>+ Add another measurement</a>
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 4 }}>= {formulaText(k, r)}</div>
                      </td>
                      <td style={td}><input value={r.div == null ? "1" : r.div} disabled={r.src === "fixed"} onChange={(e) => setRow(k, { div: e.target.value })} style={small} /></td>
                      <td style={td}><input value={r.add} onChange={(e) => setRow(k, { add: e.target.value })} style={small} /></td>
                      <td style={td}><a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => removeRow(k)}>Remove</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {unused.length > 0 && (
              <>
                <select value={addingKey} onChange={(e) => setAddingKey(e.target.value)} style={{ ...inputStyle, width: 170 }}>
                  <option value="">+ Add measurement…</option>
                  {unused.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button type="button" disabled={!addingKey} onClick={() => { addRow(addingKey); setAddingKey(""); }} style={{ background: addingKey ? "#3B6FA0" : "#C9CDD3", color: "#fff", border: "none", borderRadius: 3, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>Add</button>
              </>
            )}
            {addingCustom ? (
              <>
                <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="New measurement name…" style={{ ...inputStyle, width: 170 }} />
                <button type="button" onClick={addCustom} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 3, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>Add</button>
                <button type="button" onClick={() => { setAddingCustom(false); setCustomLabel(""); }} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "7px 12px", fontSize: 12 }}>Cancel</button>
              </>
            ) : (
              <button type="button" onClick={() => setAddingCustom(true)} style={{ background: "#fff", border: "1px dashed #C9CDD3", borderRadius: 3, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>+ Custom Measurement</button>
            )}
            <span style={{ fontSize: 12, color: "#5a5a5a", marginLeft: 8 }}>Round to</span>
            <select value={entry.round || "0"} onChange={(e) => update({ ...entry, round: e.target.value })} style={{ ...inputStyle, width: 120 }}>
              <option value="0">no rounding</option><option value="0.25">nearest 0.25</option><option value="0.5">nearest 0.5</option><option value="1">nearest 1</option>
            </select>
          </div>
        </>
      )}
      {readOnly && keys.length > 0 && entry.round && entry.round !== "0" && <div style={{ fontSize: 11.5, color: "#8a8a8a" }}>Rounded to the nearest {entry.round}.</div>}
    </div>
  );
}

function SizeMeasurementGrid({ sizes, onChangeCell, onCellBlur, onAddSize, onRemoveSize, onRemoveRow, readOnly, customFields, onAddCustomField, initialRows }) {
  const [extraRows, setExtraRows] = useState(() => initialRows || []);
  const [addingKey, setAddingKey] = useState("");
  const [newSizeLabel, setNewSizeLabel] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [addingCustomSize, setAddingCustomSize] = useState(false);
  const [customSizeLabel, setCustomSizeLabel] = useState("");

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

  const addCustomSize = () => {
    const label = customSizeLabel.trim();
    if (!label || sizes.some((s) => s.size_label === label)) return;
    if (onAddSize) onAddSize(label);
    setCustomSizeLabel(""); setAddingCustomSize(false);
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
              + Add common measurements (Shoulder, Chest, Waist, Hips, Sleeve Length, Length)
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
          {onAddSize && (
            addingCustomSize ? (
              <>
                <input value={customSizeLabel} onChange={(e) => setCustomSizeLabel(e.target.value)} placeholder="e.g. Free Size, 2XL, Kids-6…" style={{ ...inputStyle, width: 170 }} />
                <button type="button" onClick={addCustomSize} style={{ background: "#2F8F46", color: "#fff", border: "none", borderRadius: 3, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>Add</button>
                <button type="button" onClick={() => { setAddingCustomSize(false); setCustomSizeLabel(""); }} style={{ background: "#fff", border: "1px solid #C9CDD3", borderRadius: 3, padding: "7px 12px", fontSize: 12 }}>Cancel</button>
              </>
            ) : (
              <button type="button" onClick={() => setAddingCustomSize(true)} style={{ background: "#fff", border: "1px dashed #C9CDD3", borderRadius: 3, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>+ Custom Size</button>
            )
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
  const [loaded, setLoaded] = useState(false);

  const load = () => supabase.from("model_sizes").select("*").eq("model_id", model.id).then(({ data }) => { setSizes(data || []); setLoaded(true); });
  useEffect(() => { setLoaded(false); load(); }, [model.id]); // eslint-disable-line

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
  const hasSizeData = sizes.some((s) => Object.values(s.measurements || {}).some((v) => v !== "" && v != null));
  const locked = loaded && !hasSizeData && !anyCalc(model.cuttingFormula);
  const availableCutsToAdd = cutTags.filter((c) => !cutGroups.includes(c) && (hasSizeData || calcHasRows((model.cuttingFormula || {})[c])));

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

  if (locked) return (
    <div style={{ fontSize: 13, color: "#8a8a8a", padding: "10px 0" }}>🔒 Add this model's calculation first — the size chart unlocks once a calculation exists.</div>
  );

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
  ["sales", "Sales"], ["production", "Production"], ["admin", "Admin"], ["model_manager", "Model Manager"], ["driver", "Driver"],
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

  const [pendingMaterials, setPendingMaterials] = useState([]);
  const [newMaterial, setNewMaterial] = useState({ material_type: "", material_code: "", quantity: "" });
  const setNewMaterialField = (k) => (e) => setNewMaterial((m) => ({ ...m, [k]: e.target.value }));
  const addPendingMaterial = () => {
    if (!newMaterial.material_type.trim()) return;
    setPendingMaterials((m) => [...m, newMaterial]);
    setNewMaterial({ material_type: "", material_code: "", quantity: "" });
  };
  const removePendingMaterial = (i) => setPendingMaterials((m) => m.filter((_, idx) => idx !== i));

  const [pendingManpower, setPendingManpower] = useState([]);
  const [newManpower, setNewManpower] = useState({ person_name: "", department: "", time_used: "" });
  const setNewManpowerField = (k) => (e) => setNewManpower((m) => ({ ...m, [k]: e.target.value }));
  const addPendingManpower = () => {
    if (!newManpower.person_name.trim()) return;
    setPendingManpower((m) => [...m, newManpower]);
    setNewManpower({ person_name: "", department: "", time_used: "" });
  };
  const removePendingManpower = (i) => setPendingManpower((m) => m.filter((_, idx) => idx !== i));

  const [pendingDocuments, setPendingDocuments] = useState([]);
  const addPendingDocument = (e) => {
    const file = e.target.files?.[0];
    if (file) setPendingDocuments((d) => [...d, file]);
  };
  const removePendingDocument = (i) => setPendingDocuments((d) => d.filter((_, idx) => idx !== i));

  const [pendingSizes, setPendingSizes] = useState(() =>
    DEFAULT_TEMPLATE_SIZES.map((label) => ({ size_label: label, measurements: Object.fromEntries(DEFAULT_TEMPLATE_ROWS.map((k) => [k, ""])), cut: null }))
  );
  const [pendingFormula, setPendingFormula] = useState({});
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
  const availableCutsToAdd = cutTags.filter((c) => !cutGroups.includes(c) && calcHasRows(pendingFormula[c]));

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
    payload.cutting_formula = pendingFormula;
    const { data: inserted, error } = await supabase.from("models").insert(payload).select().single();
    if (error) { flash("Error: " + error.message); setCreating(false); return; }
    notify(session, `${session.name} created a new model: ${inserted.model_no}`, "model", undefined, { type: "model", id: inserted.id });

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

    for (const m of pendingMaterials) {
      await supabase.from("model_materials").insert({ model_id: inserted.id, ...m });
    }
    for (const m of pendingManpower) {
      await supabase.from("model_manpower").insert({ model_id: inserted.id, ...m });
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

    setForm(blank); setPhotoFiles({}); setPendingColors([]); setPendingFabrics([]); setPendingTrims([]); setPendingPatterns([]); setPendingMaterials([]); setPendingManpower([]); setPendingDocuments([]);
    setPendingSizes(DEFAULT_TEMPLATE_SIZES.map((label) => ({ size_label: label, measurements: Object.fromEntries(DEFAULT_TEMPLATE_ROWS.map((k) => [k, ""])), cut: null })));
    setPendingCustomFields([]);
    setPendingFormula({});
    setAddingCutTable(false); setNewCutChoice(""); setDuplicateFrom("");
    setCreating(false);
    await refresh();
    flash("Model created" + (pendingColors.length || pendingSizes.length || Object.keys(photoFiles).length ? " with photos, colors, and sizes" : ""));
  };

  const remove = async (id) => {
    const m = config.models.find((x) => x.id === id);
    await supabase.from("models").delete().eq("id", id);
    if (m) notify(session, `${session.name} deleted model ${m.modelNo}`, "model", null);
    await refresh();
  };

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>MATERIAL USED</div>
          {pendingMaterials.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
              <thead><tr style={{ background: "#F7F7F5" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Type of Material</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Material Code</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Quantity</th>
                <th style={{ borderBottom: "2px solid #1A1A1A" }}></th>
              </tr></thead>
              <tbody>
                {pendingMaterials.map((m, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #E5E5E5" }}>
                    <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{m.material_type}</td>
                    <td style={{ padding: "6px 8px", fontSize: 12.5 }} className="mono">{m.material_code || "—"}</td>
                    <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{m.quantity || "—"}</td>
                    <td style={{ padding: "6px 8px" }}><a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => removePendingMaterial(i)}>Remove</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input placeholder="Type of Material" value={newMaterial.material_type} onChange={setNewMaterialField("material_type")} style={{ ...inputStyle, flex: "1 1 140px" }} />
            <input placeholder="Material Code" value={newMaterial.material_code} onChange={setNewMaterialField("material_code")} style={{ ...inputStyle, flex: "1 1 110px" }} />
            <input placeholder="Quantity" value={newMaterial.quantity} onChange={setNewMaterialField("quantity")} style={{ ...inputStyle, flex: "1 1 90px" }} />
            <button type="button" onClick={addPendingMaterial} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700 }}>+ Add</button>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>MANPOWER DETAILS</div>
          {pendingManpower.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
              <thead><tr style={{ background: "#F7F7F5" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Person Name</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Department</th>
                <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Time Used</th>
                <th style={{ borderBottom: "2px solid #1A1A1A" }}></th>
              </tr></thead>
              <tbody>
                {pendingManpower.map((m, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #E5E5E5" }}>
                    <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{m.person_name}</td>
                    <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{m.department || "—"}</td>
                    <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{m.time_used || "—"}</td>
                    <td style={{ padding: "6px 8px" }}><a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => removePendingManpower(i)}>Remove</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input placeholder="Person Name" value={newManpower.person_name} onChange={setNewManpowerField("person_name")} style={{ ...inputStyle, flex: "1 1 140px" }} />
            <input placeholder="Department" value={newManpower.department} onChange={setNewManpowerField("department")} style={{ ...inputStyle, flex: "1 1 110px" }} />
            <input placeholder="Time Used (e.g. 2.5 hrs)" value={newManpower.time_used} onChange={setNewManpowerField("time_used")} style={{ ...inputStyle, flex: "1 1 110px" }} />
            <button type="button" onClick={addPendingManpower} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700 }}>+ Add</button>
          </div>
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

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <CalculationSection
          cuts={cutTags.length ? cutTags : ["General"]}
          formula={pendingFormula} setFormula={setPendingFormula}
          models={config.models} currentModelId={null}
          customFields={pendingCustomFields} onAddCustomField={addPendingCustomField}
        />
      </div>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>SIZE MEASUREMENTS</div>
        {!anyCalc(pendingFormula) ? (
          <div style={{ fontSize: 13, color: "#8a8a8a", padding: "10px 0" }}>🔒 Add the calculation above first — the size chart unlocks once a calculation exists.</div>
        ) : (
          <>
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
                  initialRows={calcRowKeys(pendingFormula[cut || cutTags[0] || "General"]).length ? calcRowKeys(pendingFormula[cut || cutTags[0] || "General"]) : DEFAULT_TEMPLATE_ROWS}
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
          </>
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

function ModelMaterials({ model, refresh, flash }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ material_type: "", material_code: "", quantity: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = () => supabase.from("model_materials").select("*").eq("model_id", model.id).order("created_at").then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const add = async () => {
    if (!form.material_type.trim()) return;
    await supabase.from("model_materials").insert({ model_id: model.id, ...form });
    setForm({ material_type: "", material_code: "", quantity: "" });
    await load(); flash("Material added");
  };
  const remove = async (id) => { await supabase.from("model_materials").delete().eq("id", id); await load(); };

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>MATERIAL USED</div>
      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
          <thead><tr style={{ background: "#F7F7F5" }}>
            <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Type of Material</th>
            <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Material Code</th>
            <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Quantity</th>
            <th style={{ borderBottom: "2px solid #1A1A1A" }}></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #E5E5E5" }}>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{r.material_type}</td>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }} className="mono">{r.material_code || "—"}</td>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{r.quantity || "—"}</td>
                <td style={{ padding: "6px 8px" }}><a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => remove(r.id)}>Remove</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input placeholder="Type of Material" value={form.material_type} onChange={set("material_type")} style={{ ...inputStyle, flex: "1 1 140px" }} />
        <input placeholder="Material Code" value={form.material_code} onChange={set("material_code")} style={{ ...inputStyle, flex: "1 1 110px" }} />
        <input placeholder="Quantity" value={form.quantity} onChange={set("quantity")} style={{ ...inputStyle, flex: "1 1 90px" }} />
        <button type="button" onClick={add} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700 }}>+ Add</button>
      </div>
    </div>
  );
}

function ModelManpower({ model, refresh, flash }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ person_name: "", department: "", time_used: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = () => supabase.from("model_manpower").select("*").eq("model_id", model.id).order("created_at").then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const add = async () => {
    if (!form.person_name.trim()) return;
    await supabase.from("model_manpower").insert({ model_id: model.id, ...form });
    setForm({ person_name: "", department: "", time_used: "" });
    await load(); flash("Manpower entry added");
  };
  const remove = async (id) => { await supabase.from("model_manpower").delete().eq("id", id); await load(); };

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>MANPOWER DETAILS</div>
      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
          <thead><tr style={{ background: "#F7F7F5" }}>
            <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Person Name</th>
            <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Department</th>
            <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A" }}>Time Used</th>
            <th style={{ borderBottom: "2px solid #1A1A1A" }}></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #E5E5E5" }}>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{r.person_name}</td>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{r.department || "—"}</td>
                <td style={{ padding: "6px 8px", fontSize: 12.5 }}>{r.time_used || "—"}</td>
                <td style={{ padding: "6px 8px" }}><a className="link" style={{ fontSize: 11, color: "#C1302B" }} onClick={() => remove(r.id)}>Remove</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input placeholder="Person Name" value={form.person_name} onChange={set("person_name")} style={{ ...inputStyle, flex: "1 1 140px" }} />
        <input placeholder="Department" value={form.department} onChange={set("department")} style={{ ...inputStyle, flex: "1 1 110px" }} />
        <input placeholder="Time Used (e.g. 2.5 hrs)" value={form.time_used} onChange={set("time_used")} style={{ ...inputStyle, flex: "1 1 110px" }} />
        <button type="button" onClick={add} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700 }}>+ Add</button>
      </div>
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
