# Patch 120 — Model costing (Admin only): materials × rate, manpower × hourly rate, extra charges, and the total cost of the model

Written against the current `src/App.jsx`.

DATABASE IS ALREADY LIVE AND TESTED (nothing to run): `model_costing` and `cost_rates`. Both are **Admin-only at the database level** — the Model Manager, Sales and Production cannot read or write a single costing line, whatever the screens do. If the Model Manager deletes a material or manpower line, its costing line disappears with it.

## What Admin gets
A new section **COSTING 🔒 Admin only** on the model page (after Material Used / Manpower Details). It is built from what the Model Manager already entered, so nobody types the same lines twice:

1. **Materials** — one line per material: the name and code, **what the Model Manager typed**, the **quantity used** (read from it automatically), a **rate per unit** (QAR) that Admin types, and the **amount** (quantity × rate).
2. **Manpower** — one line per person: name, role/department, **the time typed** (e.g. "6 Hrs", "45 MNTS"), the **hours** (read automatically), an **hourly rate** that Admin types, and the **amount** (hours × rate).
3. **Additional charges** — Admin adds lines such as **Packaging**, **Service charge**, **Transport**, **Overhead** or **Other** (or any name), each with an amount.
4. At the very bottom: **Materials + Manpower + Additional charges = TOTAL COST PER PIECE**.

How the typed text is read (and corrected when it can't be):
- Quantities: `3 meters`, `3.5`, `1.70` → 3, 3.5, 1.7. A quantity written as money — `100 QAR` (your "Handwork Materials") — is taken as a fixed amount of QAR 100. Something unclear like `2/2 meters` is NOT guessed: the line shows "enter the quantity used" so Admin types it.
- Hours: `6 Hrs`, `1.5 hrs`, `45 MNTS` / `45 MIN` (= 0.75 h), `2h 30m`, `1:30` are understood; a bare number like `9` is taken as hours and marked "assumed".
- Admin can overwrite the quantity or hours on any line; clearing it goes back to the typed value.
- Everything saves by itself when Admin leaves a box ("Saved ✓").
- **Remembered rates:** when Admin sets a rate for a fabric code (or a role such as Tailor / Master), the app remembers it. On other models the same fabric or role shows a banner **"Rates found for N lines from your other models — Fill them in"**: one click fills them (nothing changes silently; you can still edit each one).
- A line without a rate is flagged and the bottom line warns "N lines have no rate yet — the total is not complete".
Currency is shown as **QAR** (change `CURRENCY` below if needed). Quantities and hours are per piece, as entered in the model's details.

## 1. Helpers (top level)
```javascript
const CURRENCY = "QAR";
const money = (n) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const numOf = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? null : n; };
const EXTRA_PRESETS = ["Packaging", "Service charge", "Transport", "Overhead", "Other"];
const matKey = (r) => String(r.material_code || r.material_type || "").trim().toLowerCase();   // a fabric code, else its name
const depKey = (r) => String(r.department || r.person_name || "").trim().toLowerCase();         // a role (Tailor, Master…)

// "3 meters" / "3.5" / "1.70" → 3 / 3.5 / 1.7 ; "100 QAR" → a fixed amount ; "2/2 meters" → not understood
function readQuantity(text) {
  const t = String(text || "").trim();
  if (!t) return { qty: null, kind: "empty" };
  if (/\b(qar|qr|riyals?)\b/i.test(t)) return { qty: 1, amount: numOf((t.match(/[\d.,]+/) || [""])[0]), kind: "amount" };
  if (/\d\s*\/\s*\d/.test(t)) return { qty: null, kind: "unclear" };
  const m = t.match(/^\s*(\d+(?:[.,]\d+)?)/);
  return m ? { qty: numOf(m[1]), kind: "number" } : { qty: null, kind: "unclear" };
}
// "6 Hrs" / "45 MNTS" / "2h 30m" / "1:30" / "9" → hours
function readHours(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return { hours: null, kind: "empty" };
  const clock = t.match(/^(\d+):(\d{2})$/);
  if (clock) return { hours: +clock[1] + +clock[2] / 60, kind: "time" };
  let h = 0, found = false;
  const hm = t.match(/(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hour|hours)\b/);
  if (hm) { h += numOf(hm[1]); found = true; }
  const mm = t.match(/(\d+(?:[.,]\d+)?)\s*(m|min|mins|mnts|mint|minute|minutes)\b/);
  if (mm) { h += numOf(mm[1]) / 60; found = true; }
  if (found) return { hours: h, kind: "time" };
  const plain = t.match(/^(\d+(?:[.,]\d+)?)$/);
  if (plain) return { hours: numOf(plain[1]), kind: "assumed" };      // "9" → 9 hours (assumed)
  return { hours: null, kind: "unclear" };
}

// a number box that saves when you leave it
function NumCell({ value, placeholder, onCommit, width = 92, warn }) {
  const [t, setT] = useState(value == null ? "" : String(value));
  useEffect(() => { setT(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    const raw = t.trim();
    const n = raw === "" ? null : numOf(raw);
    if (raw !== "" && n == null) { setT(value == null ? "" : String(value)); return; }
    if (n !== (value == null ? null : Number(value))) onCommit(n);
  };
  return <input value={t} inputMode="decimal" placeholder={placeholder} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
    style={{ ...inputStyle, width, textAlign: "right", padding: "6px 8px", borderColor: warn ? "#E8B9B6" : undefined }} />;
}
```

## 2. The costing section
```javascript
function ModelCosting({ model, session, flash }) {
  const [mats, setMats] = useState(null);
  const [men, setMen] = useState([]);
  const [lines, setLines] = useState([]);
  const [card, setCard] = useState([]);
  const [status, setStatus] = useState("");
  const [removing, setRemoving] = useState(null);

  const load = async () => {
    const [a, b, c, d] = await Promise.all([
      supabase.from("model_materials").select("*").eq("model_id", model.id).order("created_at"),
      supabase.from("model_manpower").select("*").eq("model_id", model.id).order("created_at"),
      supabase.from("model_costing").select("*").eq("model_id", model.id).order("sort_order").order("updated_at"),
      supabase.from("cost_rates").select("*"),
    ]);
    setMats(a.data || []); setMen(b.data || []); setLines(c.data || []); setCard(d.data || []);
  };
  useEffect(() => { load(); }, [model.id]); // eslint-disable-line

  const rateFromCard = (kind, key) => { const c = card.find((x) => x.kind === kind && x.key === key); return c ? Number(c.rate) : null; };
  const matRows = (mats || []).map((r) => {
    const l = lines.find((x) => x.material_id === r.id);
    const read = readQuantity(r.quantity);
    const qty = l && l.qty != null ? Number(l.qty) : read.qty;
    const own = l && l.rate != null ? Number(l.rate) : null;
    const typedRate = read.kind === "amount" ? read.amount : null;              // "100 QAR": the amount is already in the details
    const rate = own != null ? own : typedRate;
    const suggestion = rate == null ? rateFromCard("material", matKey(r)) : null;
    return { r, read, qty, rate, suggestion, amount: qty != null && rate != null ? qty * rate : null };
  });
  const menRows = (men || []).map((r) => {
    const l = lines.find((x) => x.manpower_id === r.id);
    const read = readHours(r.time_used);
    const hours = l && l.qty != null ? Number(l.qty) : read.hours;
    const rate = l && l.rate != null ? Number(l.rate) : null;
    const suggestion = rate == null ? rateFromCard("manpower", depKey(r)) : null;
    return { r, read, hours, rate, suggestion, amount: hours != null && rate != null ? hours * rate : null };
  });
  const extras = lines.filter((l) => l.kind === "extra");

  const sum = (arr) => arr.reduce((s, x) => s + (x.amount || 0), 0);
  const matTotal = sum(matRows), menTotal = sum(menRows);
  const extraTotal = extras.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const total = matTotal + menTotal + extraTotal;
  const missing = matRows.filter((x) => x.amount == null).length + menRows.filter((x) => x.amount == null).length;
  const suggestions = [...matRows.map((x) => ({ ...x, kind: "material" })), ...menRows.map((x) => ({ ...x, kind: "manpower" }))].filter((x) => x.suggestion != null);

  const keep = (data) => setLines((prev) => (prev.some((x) => x.id === data.id) ? prev.map((x) => (x.id === data.id ? data : x)) : [...prev, data]));
  const saveLine = async (kind, row, patch) => {
    setStatus("Saving…");
    const col = kind === "material" ? "material_id" : "manpower_id";
    const { data, error } = await supabase.from("model_costing")
      .upsert({ model_id: model.id, kind, [col]: row.id, updated_by: session.name, updated_at: new Date().toISOString(), ...patch }, { onConflict: col }).select().single();
    if (error) { setStatus(""); flash("Couldn't save: " + error.message); return; }
    keep(data);
    if (patch.rate != null) {                                                     // remember it for the same fabric / role on other models
      const key = kind === "material" ? matKey(row) : depKey(row);
      if (key) {
        await supabase.from("cost_rates").upsert({ kind, key, rate: patch.rate, updated_by: session.name, updated_at: new Date().toISOString() }, { onConflict: "kind,key" });
        setCard((c) => [...c.filter((x) => !(x.kind === kind && x.key === key)), { kind, key, rate: patch.rate }]);
      }
    }
    setStatus("Saved ✓");
  };
  const fillSuggestions = async () => { for (const x of suggestions) await saveLine(x.kind, x.r, { rate: x.suggestion }); };

  const addExtra = async (label) => {
    setStatus("Saving…");
    const { data, error } = await supabase.from("model_costing").insert({ model_id: model.id, kind: "extra", label, amount: null, sort_order: extras.length, updated_by: session.name }).select().single();
    if (error) { setStatus(""); flash("Couldn't add: " + error.message); return; }
    keep(data); setStatus("Saved ✓");
  };
  const saveExtra = async (l, patch) => {
    setStatus("Saving…");
    const { data, error } = await supabase.from("model_costing").update({ ...patch, updated_by: session.name, updated_at: new Date().toISOString() }).eq("id", l.id).select().single();
    if (error) { setStatus(""); flash("Couldn't save: " + error.message); return; }
    keep(data); setStatus("Saved ✓");
  };
  const removeExtra = async () => {
    const { error } = await supabase.from("model_costing").delete().eq("id", removing.id);
    if (error) flash("Couldn't remove: " + error.message); else setLines((p) => p.filter((x) => x.id !== removing.id));
    setRemoving(null);
  };

  const th = { textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, borderBottom: "2px solid #1A1A1A", whiteSpace: "nowrap" };
  const td = { padding: "6px 8px", fontSize: 12.5, borderBottom: "1px solid #EEE", verticalAlign: "top" };
  const right = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const sub = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0" }}><span>{label}</span><span className="mono">{CURRENCY} {money(value)}</span></div>
  );

  return (
    <div style={{ ...cardStyle, marginBottom: 16, borderLeft: "5px solid #1A1A1A" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>COSTING <span style={{ fontWeight: 400, fontSize: 11.5, color: "#8a8a8a" }}>🔒 Admin only · {CURRENCY} per piece</span></div>
        <div style={{ fontSize: 12, color: "#2F8F46", minHeight: 16 }}>{status}</div>
      </div>
      <div style={{ fontSize: 11.5, color: "#8a8a8a", marginBottom: 12 }}>Built from the materials and manpower entered for this model. Type the rates; everything saves when you leave a box.</div>

      {suggestions.length > 0 && (
        <div style={{ background: "#EEF5FB", border: "1px solid #BBD0E6", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span>Rates found for <strong>{suggestions.length}</strong> line{suggestions.length === 1 ? "" : "s"} from your other models.</span>
          <button onClick={fillSuggestions} style={{ background: "#3B6FA0", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", fontWeight: 700, fontSize: 12.5 }}>Fill them in</button>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 12.5, letterSpacing: "0.05em", margin: "6px 0" }}>MATERIALS</div>
      {mats === null ? <div style={{ fontSize: 12.5, color: "#8a8a8a" }}>Loading…</div> : matRows.length === 0 ? <div style={{ fontSize: 12.5, color: "#8a8a8a", marginBottom: 8 }}>No materials have been entered for this model yet (the Model Manager adds them under Material Used).</div> : (
        <div style={{ overflowX: "auto", marginBottom: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Material</th><th style={th}>As entered</th><th style={{ ...th, textAlign: "right" }}>Qty used</th><th style={{ ...th, textAlign: "right" }}>Rate / unit</th><th style={{ ...th, textAlign: "right" }}>Amount</th></tr></thead>
            <tbody>
              {matRows.map((x) => (
                <tr key={x.r.id}>
                  <td style={td}>{x.r.material_type}{x.r.material_code ? <div className="mono" style={{ fontSize: 11, color: "#8a8a8a" }}>{x.r.material_code}</div> : null}</td>
                  <td style={td}>{x.r.quantity || "—"}{x.read.kind === "amount" && <div style={{ fontSize: 10.5, color: "#8a8a8a" }}>amount given in the details</div>}{x.read.kind === "unclear" && <div style={{ fontSize: 10.5, color: "#C1302B" }}>couldn't read this — enter the quantity used</div>}</td>
                  <td style={right}><NumCell value={x.qty} placeholder="qty" warn={x.qty == null} onCommit={(n) => saveLine("material", x.r, { qty: n === x.read.qty ? null : n })} /></td>
                  <td style={right}><NumCell value={x.rate} placeholder={x.suggestion != null ? String(x.suggestion) : "rate"} warn={x.rate == null} onCommit={(n) => saveLine("material", x.r, { rate: n })} /></td>
                  <td style={{ ...right, fontWeight: 700 }}>{money(x.amount)}</td>
                </tr>
              ))}
              <tr><td colSpan={4} style={{ ...right, fontWeight: 700 }}>Materials total</td><td style={{ ...right, fontWeight: 700 }}>{CURRENCY} {money(matTotal)}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 12.5, letterSpacing: "0.05em", margin: "16px 0 6px" }}>MANPOWER</div>
      {menRows.length === 0 ? <div style={{ fontSize: 12.5, color: "#8a8a8a", marginBottom: 8 }}>No manpower has been entered for this model yet.</div> : (
        <div style={{ overflowX: "auto", marginBottom: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Person</th><th style={th}>Role</th><th style={th}>Time entered</th><th style={{ ...th, textAlign: "right" }}>Hours</th><th style={{ ...th, textAlign: "right" }}>Hourly rate</th><th style={{ ...th, textAlign: "right" }}>Amount</th></tr></thead>
            <tbody>
              {menRows.map((x) => (
                <tr key={x.r.id}>
                  <td style={td}>{String(x.r.person_name || "").trim()}</td>
                  <td style={td}>{String(x.r.department || "").trim() || "—"}</td>
                  <td style={td}>{x.r.time_used || "—"}{x.read.kind === "assumed" && <div style={{ fontSize: 10.5, color: "#8a8a8a" }}>no unit — taken as hours</div>}{x.read.kind === "unclear" && <div style={{ fontSize: 10.5, color: "#C1302B" }}>couldn't read this — enter the hours</div>}</td>
                  <td style={right}><NumCell value={x.hours == null ? null : Math.round(x.hours * 100) / 100} placeholder="hrs" warn={x.hours == null} onCommit={(n) => saveLine("manpower", x.r, { qty: n === x.read.hours ? null : n })} /></td>
                  <td style={right}><NumCell value={x.rate} placeholder={x.suggestion != null ? String(x.suggestion) : "rate"} warn={x.rate == null} onCommit={(n) => saveLine("manpower", x.r, { rate: n })} /></td>
                  <td style={{ ...right, fontWeight: 700 }}>{money(x.amount)}</td>
                </tr>
              ))}
              <tr><td colSpan={5} style={{ ...right, fontWeight: 700 }}>Manpower total</td><td style={{ ...right, fontWeight: 700 }}>{CURRENCY} {money(menTotal)}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 12.5, letterSpacing: "0.05em", margin: "16px 0 6px" }}>ADDITIONAL CHARGES</div>
      {extras.map((l) => (
        <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
          <input defaultValue={l.label || ""} onBlur={(e) => { if (e.target.value !== (l.label || "")) saveExtra(l, { label: e.target.value.trim() }); }} placeholder="Charge (e.g. Packaging)" style={{ ...inputStyle, width: 240 }} />
          <NumCell value={l.amount == null ? null : Number(l.amount)} placeholder="amount" width={120} warn={l.amount == null} onCommit={(n) => saveExtra(l, { amount: n })} />
          <span style={{ fontSize: 12, color: "#8a8a8a" }}>{CURRENCY}</span>
          <a className="link" style={{ color: "#C1302B", fontSize: 12 }} onClick={() => setRemoving(l)}>Remove</a>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        {EXTRA_PRESETS.map((p) => <button key={p} onClick={() => addExtra(p === "Other" ? "" : p)} style={{ background: "#fff", border: "1px dashed #8a8a8a", borderRadius: 14, padding: "5px 13px", fontSize: 12.5, cursor: "pointer" }}>+ {p}</button>)}
      </div>
      <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>Additional charges total &nbsp; {CURRENCY} {money(extraTotal)}</div>

      <div style={{ borderTop: "2px solid #1A1A1A", marginTop: 18, paddingTop: 12, maxWidth: 440, marginLeft: "auto" }}>
        {sub("Materials", matTotal)}
        {sub("Manpower", menTotal)}
        {sub("Additional charges", extraTotal)}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: "1px solid #C9CDD3", marginTop: 8, paddingTop: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.05em" }}>TOTAL COST PER PIECE</span>
          <span className="mono" style={{ fontWeight: 700, fontSize: 22 }}>{CURRENCY} {money(total)}</span>
        </div>
        {missing > 0 && <div style={{ fontSize: 12, color: "#C1302B", marginTop: 6, textAlign: "right" }}>⚠ {missing} line{missing === 1 ? " has" : "s have"} no rate or quantity yet — the total is not complete.</div>}
      </div>

      {removing && (
        <ConfirmDialog title={`Remove "${removing.label || "this charge"}"?`} danger confirmLabel="Yes, remove" onCancel={() => setRemoving(null)} onConfirm={removeExtra}>
          This additional charge is taken off the costing.
        </ConfirmDialog>
      )}
    </div>
  );
}
```

## 3. Put it on the model page (Admin only)
In `ModelDetailPage`, right after the grid that holds `MATERIAL USED` and `MANPOWER DETAILS` and before the sketches block:
```javascript
{session && session.role === "admin" && !editingModel && <ModelCosting model={model} session={session} flash={flash} />}
```
(It is not drawn while the model is being edited, and it reloads the materials and manpower each time, so it always matches what the Model Manager entered. For every other role the section does not exist, and the database would return nothing anyway.)

---
Test:
1. As **Model Manager** enter materials and manpower for a model (for example Crepe Silk `3 meters`, Handwork Materials `100 QAR`, a tailor `6 Hrs`, a master `45 MIN`). Open the same model as Model Manager, Sales and Production → **no Costing section**.
2. As **Admin** open the model → **COSTING 🔒 Admin only**: the materials and manpower are listed with their quantities and hours already read (3, QAR 100 as a fixed amount, 6 h, 0.75 h). Type a **rate per unit** for the fabric and **hourly rates** → each amount appears and "Saved ✓" shows.
3. A line like `2/2 meters` is not guessed: it asks you to enter the quantity. A bare `9` for a person shows "taken as hours".
4. Add **+ Packaging** and **+ Service charge** with amounts (and **+ Other** with your own name). **Remove** asks first.
5. At the bottom: Materials + Manpower + Additional charges = **TOTAL COST PER PIECE**. Leave a rate empty → the bottom warns the total is incomplete.
6. Open **another model** that uses the same fabric code or the same roles → the banner "Rates found for N lines from your other models" appears; **Fill them in** applies them.
7. Have the Model Manager delete a material → its costing line is gone, the total updates; change a quantity there → the costing follows (unless you overwrote it).
Commit and push once confirmed.
