"use client";
import { ChangeEvent, FormEvent, ReactNode, useEffect, useState } from "react";
import * as XLSX from "xlsx";

const nav = [
  "Overview",
  "Companies",
  "Fleet",
  "Daily production",
  "Breakdowns",
  "Leaks & hoses",
  "Maintenance",
  "Work orders",
  "Spares & OEM",
  "Intelligence",
  "Import centre",
  "Reports",
  "Pricing & quotes",
  "Payments & orders",
  "Alerts & contacts",
  "Users & roles",
  "Security",
  "Software Licence",
];
const icons = [
  "⌂",
  "◎",
  "▦",
  "P",
  "⚙",
  "⌁",
  "◷",
  "☑",
  "▣",
  "◈",
  "⇧",
  "▥",
  "R",
  "PO",
  "✦",
  "♙",
  "⌾",
  "◇",
];

type ImportRow = Record<string, string | number | boolean | null>;

function cleanKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function firstValue(row: ImportRow, aliases: string[]) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const found = entries.find(([key]) => cleanKey(key) === cleanKey(alias));
    if (found && found[1] !== "") return found[1];
  }
  return "";
}
async function readWorkbook(file: File): Promise<ImportRow[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<ImportRow>(sheet, { defval: "", raw: false });
}
function productionRows(rows: ImportRow[]) {
  return rows.map((row) => ({
    date: String(firstValue(row, ["date", "report date", "shift date"])),
    fleetNumber: String(firstValue(row, ["fleet number", "fleet", "machine", "equipment"])),
    shiftHours: Number(firstValue(row, ["shift hours", "planned hours", "available hours"]) || 24),
    plannedDowntime: Number(firstValue(row, ["planned downtime", "planned dt"]) || 0),
    unplannedDowntime: Number(firstValue(row, ["unplanned downtime", "downtime", "breakdown hours"]) || 0),
    operatingHours: Number(firstValue(row, ["operating hours", "running hours"]) || 0),
    productiveHours: Number(firstValue(row, ["productive hours", "working hours", "operating hours"]) || 0),
    tonnes: Number(firstValue(row, ["tonnes", "production", "actual production", "tons"]) || 0),
  })).filter((row) => row.date && row.fleetNumber);
}
function fleetRows(rows: ImportRow[]) {
  return rows.map((row) => ({
    fleetNumber: String(firstValue(row, ["fleet number", "fleet", "machine", "equipment"])),
    category: String(firstValue(row, ["machine type", "category", "type", "model"])),
    site: String(firstValue(row, ["site", "section", "area"]) || "Unassigned"),
    status: String(firstValue(row, ["status"]) || "operating"),
    operatingHours: Number(firstValue(row, ["operating hours", "hours", "hour meter"]) || 0),
    nextServiceHours: Number(firstValue(row, ["next service hours", "service due", "service hours"]) || 0),
  })).filter((row) => row.fleetNumber && row.category);
}
function downloadWord(filename: string, title: string, rows: ImportRow[]) {
  const headers = Object.keys(rows[0] || {});
  const html = `<!doctype html><html><body><h1>${title}</h1><table border="1" cellspacing="0" cellpadding="5"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((h) => `<td>${String(row[h] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "application/msword" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
function downloadExcel(filename: string, rows: ImportRow[]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Report");
  XLSX.writeFile(workbook, filename);
}
function printRows(title: string, rows: ImportRow[]) {
  const headers = Object.keys(rows[0] || {});
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) return;
  popup.document.write(`<!doctype html><html><head><title>${title}</title><style>body{font-family:Arial;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}</style></head><body><h1>${title}</h1><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((h) => `<td>${String(row[h] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`);
  popup.document.close(); popup.focus(); popup.print();
}

type Contact = {
  name: string;
  role: string;
  email: string;
  phone: string;
  emailOn: boolean;
  smsOn: boolean;
};
const blankContact = (): Contact => ({
  name: "",
  role: "",
  email: "",
  phone: "",
  emailOn: true,
  smsOn: true,
});

type AuthUser = { displayName: string; email: string; fullName: string | null };
type OwnerProfile = {
  id: number;
  email: string;
  fullName: string;
  businessName: string;
  phone: string | null;
  role: string;
  status: string;
};
export default function NcaConsole({
  authenticatedUser,
  ownerProfile: initialOwner,
}: {
  authenticatedUser: AuthUser;
  ownerProfile: OwnerProfile | null;
}) {
  const [active, setActive] = useState("Overview"),
    [companyModal, setCompanyModal] = useState(false),
    [machineModal, setMachineModal] = useState(false),
    [owner, setOwner] = useState<OwnerProfile | null>(initialOwner);
  if (!owner)
    return <OwnerOnboarding user={authenticatedUser} done={setOwner} />;
  const initials = owner.fullName
    .split(/\s+/)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <main className="shell nca-blank">
      <aside>
        <div className="brand">
          <img src="/sindane-logo.png" alt="Sindane Asset Solutions logo" />
          <div>
            <strong>TMM Asset Health</strong>
            <small>{owner.businessName}</small>
          </div>
        </div>
        <nav>
          {nav.map((n, i) => (
            <button
              key={n}
              className={active === n ? "active" : ""}
              onClick={() => setActive(n)}
            >
              <i>{icons[i]}</i>
              {n}
            </button>
          ))}
        </nav>
        <div className="lic blanklic">
          <span>○</span>
          <strong>No licence assigned</strong>
          <small>Create a company to issue its software licence.</small>
          <button onClick={() => setActive("Software Licence")}>
            Open licence centre
          </button>
        </div>
        <div className="user">
          <b>{initials}</b>
          <div>
            <strong>{owner.fullName}</strong>
            <small>
              Software owner ·{" "}
              <a href="/signout-with-chatgpt?return_to=/">Sign out</a>
            </small>
          </div>
        </div>
      </aside>
      <section className="work">
        <header>
          <div className="crumb">
            Sindane Asset Solutions <span>/</span> {active}
          </div>
          <label>
            ⌕<input placeholder="Search after adding company data" />
          </label>
          <button className="iconbtn" onClick={() => window.print()}>
            ▣ Print
          </button>
          <button
            className="primary"
            onClick={() =>
              active === "Companies"
                ? setCompanyModal(true)
                : setMachineModal(true)
            }
          >
            ＋ Quick add
          </button>
        </header>
        <div className="content">
          {active === "Overview" ? (
            <Overview go={setActive} addCompany={() => setCompanyModal(true)} />
          ) : active === "Companies" ? (
            <Companies add={() => setCompanyModal(true)} />
          ) : active === "Alerts & contacts" ? (
            <Contacts />
          ) : active === "Software Licence" ? (
            <Licence />
          ) : active === "Fleet" ? (
            <Fleet add={() => setMachineModal(true)} />
          ) : active === "Daily production" ? (
            <Production />
          ) : active === "Intelligence" ? (
            <Intelligence />
          ) : active === "Users & roles" ? (
            <Roles />
          ) : active === "Security" ? (
            <Security />
          ) : active === "Reports" ? (
            <SummaryReports />
          ) : active === "Pricing & quotes" ? (
            <PricingQuotes />
          ) : active === "Payments & orders" ? (
            <PaymentsOrders />
          ) : active === "Import centre" ? (
            <CaptureHub openManual={() => setActive("Daily production")} />
          ) : (
            <EmptyModule name={active} />
          )}
        </div>
      </section>
      {companyModal && (
        <SimpleModal
          title="Company self-onboarding"
          close={() => setCompanyModal(false)}
          fields={[
            "Registered company name",
            "Trading name",
            "Registration number",
            "Industry / operation type",
            "Head office address",
            "Primary site",
            "Company administrator name",
            "Company owner email",
            "Company owner phone",
            "Preferred SAS package",
          ]}
        />
      )}
      {machineModal && (
        <SimpleModal
          title="Add first machine"
          close={() => setMachineModal(false)}
          fields={[
            "Fleet number",
            "Machine type",
            "Site / section",
            "Current operating hours",
            "Service interval",
          ]}
        />
      )}
    </main>
  );
}

function OwnerOnboarding({
  user,
  done,
}: {
  user: AuthUser;
  done: (p: OwnerProfile) => void;
}) {
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const response = await fetch("/api/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: f.get("fullName"),
        businessName: f.get("businessName"),
        phone: f.get("phone"),
      }),
    }).catch(() => null);
    if (response?.ok) {
      const data = await response.json();
      done(data.profile);
    } else setError("The owner profile could not be saved. Please try again.");
    setSaving(false);
  }
  return (
    <main className="accountgate">
      <section className="accountbrand">
        <img src="/sindane-logo.png" alt="Sindane Asset Solutions" />
        <small>TMM ASSET HEALTH</small>
        <h1>Create your Software Owner account</h1>
        <p>
          This first account controls companies, licences and subscriptions.
          Your secure sign-in is linked to your verified ChatGPT identity.
        </p>
        <div>
          {[
            "Encrypted sign-in handled by ChatGPT",
            "Cloud database and automatic platform backups",
            "Separated company workspaces",
            "Role-based access and licence control",
          ].map((x) => (
            <span key={x}>✓ {x}</span>
          ))}
        </div>
      </section>
      <form className="accountform" onSubmit={save}>
        <small>OWNER REGISTRATION</small>
        <h2>Welcome, {user.fullName || user.displayName}</h2>
        <p>Confirm your details to activate the owner dashboard.</p>
        <label>
          Full name
          <input
            name="fullName"
            required
            defaultValue={user.fullName || "Mandlenkosi Sindane"}
          />
        </label>
        <label>
          Business name
          <input
            name="businessName"
            required
            defaultValue="Sindane Asset Solutions"
          />
        </label>
        <label>
          Owner email
          <input value={user.email} disabled />
          <em>Verified by secure sign-in</em>
        </label>
        <label>
          Recovery phone number
          <input name="phone" type="tel" placeholder="+27 00 000 0000" />
        </label>
        <label className="accountcheck">
          <input required type="checkbox" /> I confirm that I am the software
          owner and accept responsibility for company access.
        </label>
        {error && <div className="accounterror">{error}</div>}
        <button className="primary" disabled={saving}>
          {saving ? "Creating owner account…" : "Create owner account"}
        </button>
        <p className="accounthelp">
          Forgot your password? Sign out and use the password-recovery option on
          the secure ChatGPT sign-in screen.
        </p>
      </form>
    </main>
  );
}

function Overview({
  go,
  addCompany,
}: {
  go: (s: string) => void;
  addCompany: () => void;
}) {
  return (
    <>
      <Title
        tag="SAS SETUP CENTRE"
        title="Welcome to TMM Asset Health"
        desc="Your workspace is clean and ready for its first company, contacts and machines."
      />
      <div className="blankkpis">
        <Kpi label="Companies" value="0" note="No client company added" />
        <Kpi label="Machines" value="0" note="Fleet register is empty" />
        <Kpi label="Open alerts" value="0" note="No critical alerts" />
        <Kpi label="Licence" value="Not issued" note="Create a company first" />
      </div>
      <section className="setup panel">
        <div>
          <small>GET STARTED</small>
          <h2>Set up the system in four controlled steps</h2>
          <p>
            Company data is separated by licence. Machines, users, contacts,
            imports and reports will belong only to the selected company.
          </p>
        </div>
        <ol>
          <li>
            <b>1</b>
            <span>
              <strong>Add a company</strong>
              <small>Client details, sites and licence owner</small>
            </span>
            <button onClick={addCompany}>Start</button>
          </li>
          <li>
            <b>2</b>
            <span>
              <strong>Add alert contacts</strong>
              <small>Up to 10 emails and 10 phone numbers</small>
            </span>
            <button onClick={() => go("Alerts & contacts")}>Configure</button>
          </li>
          <li>
            <b>3</b>
            <span>
              <strong>Register machines</strong>
              <small>Fleet numbers, hours and service plans</small>
            </span>
            <button onClick={() => go("Fleet")}>Open</button>
          </li>
          <li>
            <b>4</b>
            <span>
              <strong>Issue SAS licence</strong>
              <small>Plan, expiry, grace period and limits</small>
            </span>
            <button onClick={() => go("SAS Licence")}>Review</button>
          </li>
        </ol>
      </section>
      <div className="twocol">
        <section className="panel emptybox">
          <b>▦</b>
          <h2>No fleet data yet</h2>
          <p>
            Register a machine or import an approved daily production
            spreadsheet.
          </p>
          <button className="primary" onClick={() => go("Fleet")}>
            Add first machine
          </button>
        </section>
        <section className="panel emptybox">
          <b>✦</b>
          <h2>Critical alerts are ready</h2>
          <p>
            Add responsible people and select whether each person receives
            email, SMS or both.
          </p>
          <button onClick={() => go("Alerts & contacts")}>
            Set alert contacts
          </button>
        </section>
      </div>
    </>
  );
}
function Companies({ add }: { add: () => void }) {
  return (
    <>
      <Title
        tag="MULTI-COMPANY CONTROL"
        title="Companies"
        desc="Each company receives a separate fleet, users, reports, contacts and SAS licence."
      >
        <button className="primary" onClick={add}>
          ＋ Add company
        </button>
      </Title>
      <section className="panel emptyhero">
        <div>◎</div>
        <h2>No companies have been added</h2>
        <p>
          Add the first client company to create its secure workspace and
          licence record.
        </p>
        <button className="primary" onClick={add}>
          Add first company
        </button>
      </section>
      <section className="panel safeguards">
        <Head tag="DATA SEPARATION" title="Company workspace controls" />
        <div>
          {[
            "Separate fleet register",
            "Separate users and roles",
            "Separate alert contacts",
            "Separate reports and imports",
            "Independent licence status",
            "Independent audit trail",
          ].map((x) => (
            <span key={x}>✓ {x}</span>
          ))}
        </div>
      </section>
    </>
  );
}
function Fleet({ add }: { add: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function importFleet(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setMessage("Reading fleet spreadsheet…");
    try {
      const rows = fleetRows(await readWorkbook(file));
      if (!rows.length) throw new Error("No valid fleet rows found. Required headings include Fleet Number and Machine Type.");
      const response = await fetch("/api/machines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId: 1, rows }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Fleet import failed");
      setMessage(`✓ Imported ${result.imported} machines; skipped ${result.skipped} duplicates or incomplete rows.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Fleet import failed"); }
    setBusy(false); e.target.value = "";
  }
  return (
    <>
      <Title tag="ASSET REGISTER" title="Machine fleet" desc="Register machines manually or import an approved Excel/CSV fleet list.">
        <button className="primary" onClick={add}>＋ Add machine</button>
      </Title>
      {message && <div className="ordersaved">{message}</div>}
      <section className="panel tablewrap">
        <div className="tabletop">
          <span>Company fleet register</span>
          <label className="primary" style={{cursor:"pointer"}}>
            {busy ? "Importing…" : "Import fleet list"}
            <input hidden type="file" accept=".xlsx,.xls,.xlsm,.csv" onChange={importFleet} disabled={busy} />
          </label>
        </div>
        <table><thead><tr><th>Fleet</th><th>Machine type</th><th>Site</th><th>Status</th><th>Operating hours</th><th>Service due</th></tr></thead>
          <tbody><tr><td colSpan={6}><EmptyRow text="Import a fleet spreadsheet or add a machine manually. Duplicate fleet numbers are skipped." /></td></tr></tbody>
        </table>
      </section>
    </>
  );
}
function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>(
      Array.from({ length: 10 }, blankContact),
    ),
    [saved, setSaved] = useState(false);
  function update(i: number, k: keyof Contact, v: string | boolean) {
    setContacts((c) => c.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  }
  return (
    <>
      <Title
        tag="CRITICAL NOTIFICATION ROUTING"
        title="Alerts & responsible contacts"
        desc="Configure up to 10 email addresses and 10 phone numbers for each company."
      >
        <button
          className="primary"
          onClick={() => {
            setSaved(true);
            setTimeout(() => setSaved(false), 1200);
          }}
        >
          {saved ? "✓ Saved" : "Save contacts"}
        </button>
      </Title>
      <div className="alertpolicy">
        <article className="panel">
          <b>!</b>
          <div>
            <strong>Critical-event rule</strong>
            <p>
              When severity is Critical, SAS queues an immediate alert to the
              company owner and every enabled responsible contact.
            </p>
          </div>
        </article>
        <article className="panel">
          <b>↻</b>
          <div>
            <strong>Escalation rule</strong>
            <p>
              If the alert is not acknowledged, escalate to the next enabled
              contact and record delivery in the audit trail.
            </p>
          </div>
        </article>
      </div>
      <section className="panel contactpanel">
        <Head tag="MAXIMUM 10 CONTACTS" title="Email and SMS recipients">
          <span className="provider">Email provider: Resend ready</span>
        </Head>
        <div className="contacthead">
          <span>#</span>
          <span>Name</span>
          <span>Responsibility</span>
          <span>Email address</span>
          <span>Phone number</span>
          <span>Channels</span>
        </div>
        {contacts.map((c, i) => (
          <div className="contactrow" key={i}>
            <b>{i + 1}</b>
            <input
              aria-label={`Contact ${i + 1} name`}
              value={c.name}
              onChange={(e) => update(i, "name", e.target.value)}
              placeholder="Full name"
            />
            <select
              aria-label={`Contact ${i + 1} role`}
              value={c.role}
              onChange={(e) => update(i, "role", e.target.value)}
            >
              <option value="">Select role</option>
              <option>Company owner</option>
              <option>Engineering manager</option>
              <option>Responsible mechanic</option>
              <option>Artisan</option>
              <option>Safety / environmental</option>
            </select>
            <input
              type="email"
              value={c.email}
              onChange={(e) => update(i, "email", e.target.value)}
              placeholder="name@company.co.za"
            />
            <input
              value={c.phone}
              onChange={(e) => update(i, "phone", e.target.value)}
              placeholder="+27 00 000 0000"
            />
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={c.emailOn}
                  onChange={(e) => update(i, "emailOn", e.target.checked)}
                />{" "}
                Email
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={c.smsOn}
                  onChange={(e) => update(i, "smsOn", e.target.checked)}
                />{" "}
                SMS
              </label>
            </div>
          </div>
        ))}
      </section>
      <section className="panel triggergrid">
        <Head tag="ALERT MATRIX" title="Recommended automatic triggers" />
        <div>
          {[
            ["Critical breakdown", "Immediately"],
            ["Oil spill / major leak", "Immediately"],
            ["Hydraulic hose burst", "Immediately"],
            ["Machine overdue for service", "Daily until acknowledged"],
            ["Recovery date missed", "Immediately"],
            ["Licence approaching expiry", "30, 14, 7 and 1 day before"],
          ].map((x) => (
            <p key={x[0]}>
              <b>{x[0]}</b>
              <span>{x[1]}</span>
              <i>Enabled</i>
            </p>
          ))}
        </div>
      </section>
    </>
  );
}
function Licence() {
  return (
    <>
      <Title
        tag="SAS LICENSING ENGINE"
        title="Licence centre"
        desc="Create and control licences without deleting a client’s operational records."
      />
      <div className="licgrid">
        <section className="panel plan emptyplan">
          <small>NO COMPANY SELECTED</small>
          <h2>No licence issued</h2>
          <p>Add a company before generating an SAS licence key.</p>
          <b>○ Unassigned</b>
          <dl>
            <div>
              <dt>Licence key</dt>
              <dd>—</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>—</dd>
            </div>
            <div>
              <dt>Expiry</dt>
              <dd>—</dd>
            </div>
            <div>
              <dt>Grace period</dt>
              <dd>7 days default</dd>
            </div>
            <div>
              <dt>User limit</dt>
              <dd>—</dd>
            </div>
            <div>
              <dt>Machine limit</dt>
              <dd>—</dd>
            </div>
          </dl>
          <button className="primary" disabled>
            Generate licence
          </button>
        </section>
        <section className="panel rules">
          <small>SAFE ACCESS CONTROL</small>
          <h2>Licence lifecycle</h2>
          {[
            ["1", "Trial", "Time-limited evaluation"],
            ["2", "Active", "Paid features enabled"],
            ["3", "Grace period", "Full access with payment warning"],
            ["4", "Read-only", "Records viewable and exportable"],
            ["5", "Suspended", "SAS owner access only"],
            ["6", "Restored", "Immediate return after renewal"],
          ].map((r) => (
            <div key={r[0]}>
              <b>{r[0]}</b>
              <p>
                <strong>{r[1]}</strong>
                <span>{r[2]}</span>
              </p>
            </div>
          ))}
        </section>
      </div>
      <section className="panel licenceops">
        <Head tag="SAS OWNER CONTROLS" title="Licence configuration fields" />
        <div>
          {[
            "Company and licence key",
            "Plan and billing cycle",
            "Start and expiry date",
            "Grace-period days",
            "Maximum users and machines",
            "Maximum sites and devices",
            "Offline verification period",
            "Payment reference",
            "Status-change reason",
            "Complete licence audit trail",
          ].map((x) => (
            <span key={x}>✓ {x}</span>
          ))}
        </div>
      </section>
    </>
  );
}
function Intelligence() {
  const groups = [
    ["Repeat failures", "Same component or failure mode recurring"],
    ["Oil-loss trend", "Increasing litres lost per operating hour"],
    ["Hose health", "Short life, repeat leaks or urgent inspection"],
    ["Reliability risk", "Low MTBF, rising MTTR or availability below target"],
    ["Cost exposure", "High repair cost, production loss or cost per hour"],
    ["Compliance risk", "Overdue service, inspection or work order"],
  ];
  return (
    <>
      <Title
        tag="BREAKDOWN-PREVENTION INTELLIGENCE"
        title="Reliability insights"
        desc="The system watches records automatically and shows only actions that need attention."
      />
      <div className="insightbanner">
        <div>
          <small>SAS ANALYSIS ENGINE</small>
          <h2>Simple signals. Engineering depth.</h2>
          <p>
            Automatic calculations include availability, utilisation, uptime,
            downtime, MTBF, MTTR, service compliance, repeat-failure rate, oil
            consumption and cost per operating hour.
          </p>
        </div>
        <b>
          0<span>risks detected</span>
        </b>
      </div>
      <div className="insightgrid">
        {groups.map((g, i) => (
          <article className="panel" key={g[0]}>
            <span>{["↻", "◉", "⌁", "△", "R", "✓"][i]}</span>
            <h3>{g[0]}</h3>
            <p>{g[1]}</p>
            <small>Starts after operational records are added</small>
          </article>
        ))}
      </div>
    </>
  );
}
function Roles() {
  const roles = [
    ["Operator", "Pre-start, production and fault capture"],
    ["Technician", "Inspections, repairs and work orders"],
    ["Supervisor", "Assignments, verification and approvals"],
    ["Engineer", "Reliability analysis and root causes"],
    ["Planner", "Maintenance schedules and resources"],
    ["Storeperson", "Spares, stock and purchase status"],
    ["Manager", "Dashboards and approved reports"],
    ["Company administrator", "Company setup, users and contacts"],
    ["SAS software owner", "Companies, licences and subscription control"],
  ];
  const [show, setShow] = useState(false),
    [saved, setSaved] = useState("");
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const response = await fetch("/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyId: 1,
        fullName: f.get("fullName"),
        email: f.get("email"),
        role: f.get("role"),
      }),
    });
    if (response.ok) {
      const result = await response.json();
      setSaved(
        result.delivery?.sent
          ? "Invitation created and emailed successfully."
          : "Invitation recorded. Email delivery is waiting for secure provider activation.",
      );
      setShow(false);
    }
  }
  return (
    <>
      <Title
        tag="ROLE-BASED ACCESS"
        title="Users & permissions"
        desc="Companies invite their own people and each user sees only what their job requires."
      >
        <button className="primary" onClick={() => setShow(true)}>
          ＋ Invite user
        </button>
      </Title>
      {saved && <div className="ordersaved">✓ {saved}</div>}
      <section className="panel roletable">
        <div className="rolehead">
          <b>Role</b>
          <b>What the user can access</b>
          <b>Users</b>
        </div>
        {roles.map((r) => (
          <div key={r[0]}>
            <strong>{r[0]}</strong>
            <span>{r[1]}</span>
            <em>0</em>
          </div>
        ))}
      </section>
      {show && (
        <div className="shade" onMouseDown={() => setShow(false)}>
          <form
            className="modal smallmodal"
            onSubmit={invite}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modalhead">
              <div>
                <small>COMPANY INVITATION</small>
                <h2>Invite a user</h2>
                <p>
                  The person will only access the selected company and assigned
                  role.
                </p>
              </div>
              <button type="button" onClick={() => setShow(false)}>
                ×
              </button>
            </div>
            <div className="formgrid">
              <label>
                Company workspace
                <select name="companyId" required>
                  <option value="1">Select company after company setup</option>
                </select>
              </label>
              <label>
                Full name
                <input name="fullName" required />
              </label>
              <label>
                Email address
                <input name="email" type="email" required />
              </label>
              <label>
                Role
                <select name="role" required>
                  {roles.slice(0, -1).map((r) => (
                    <option key={r[0]}>{r[0]}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modalfoot">
              <span>
                Invitation expires after 7 days and is recorded in the audit
                trail.
              </span>
              <button className="primary">Create invitation</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
function Security() {
  return (
    <>
      <Title
        tag="TRUST & DATA PROTECTION"
        title="Security centre"
        desc="Commercial controls for contractor and mine information."
      />
      <div className="securityscore">
        <div>
          <small>SECURITY READINESS</small>
          <h2>Protected by design</h2>
          <p>
            Company separation, secure access and a traceable record of every
            important action.
          </p>
        </div>
        <b>
          8<span>core controls</span>
        </b>
      </div>
      <div className="securitygrid">
        {[
          [
            "Secure sign-in",
            "Authentication required before company data is available",
          ],
          [
            "Company separation",
            "Users access only their authorised company workspace",
          ],
          [
            "Role permissions",
            "Every action is controlled by assigned responsibility",
          ],
          [
            "Audit trail",
            "Create, edit, approve, export and licence actions are recorded",
          ],
          [
            "Session protection",
            "Inactive sessions expire and require sign-in again",
          ],
          [
            "Backups & recovery",
            "Operational records designed for protected recovery",
          ],
          ["POPIA controls", "Contact data, export and retention controls"],
          [
            "Offline queue",
            "Field records wait safely and synchronise without duplicates",
          ],
        ].map((x) => (
          <article className="panel" key={x[0]}>
            <b>✓</b>
            <div>
              <strong>{x[0]}</strong>
              <p>{x[1]}</p>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
function Reports() {
  const reports = [
    "Daily machine report",
    "Daily production report",
    "Weekly fleet summary",
    "Monthly management report",
    "Availability and utilisation",
    "Downtime and Pareto",
    "Machine history",
    "Oil-loss and hose register",
    "Work orders",
    "Spares and OEM delays",
    "Maintenance cost",
    "Service compliance",
    "Repeat failures",
  ];
  return (
    <>
      <Title
        tag="MANAGEMENT REPORT STUDIO"
        title="Reports & exports"
        desc="Companies choose a report and date range; SAS performs the calculations."
      >
        <div className="exports">
          <button onClick={() => exportProduction("excel")}>▦ Excel</button>
          <button onClick={() => exportProduction("pdf")}>▣ PDF</button>
          <button onClick={() => exportProduction("word")}>W Word</button>
          <button onClick={() => exportProduction("pdf")}>⌁ Print</button>
        </div>
      </Title>
      <div className="reportcatalog">
        {reports.map((r, i) => (
          <article className="panel" key={r}>
            <span>
              {
                [
                  "D",
                  "P",
                  "W",
                  "M",
                  "%",
                  "▥",
                  "H",
                  "⌁",
                  "WO",
                  "S",
                  "R",
                  "✓",
                  "↻",
                ][i]
              }
            </span>
            <div>
              <strong>{r}</strong>
              <small>No records available yet</small>
            </div>
            <button>Generate →</button>
          </article>
        ))}
      </div>
    </>
  );
}
const moduleGuides: Record<string, string[]> = {
  Breakdowns: [
    "Machine, date and shift",
    "Start and finish time",
    "Fault, system and component",
    "Immediate and root cause",
    "Corrective and recovery action",
    "Technician and responsible person",
    "Spares, OEM and recovery date",
    "Photos, cost and approval",
  ],
  "Leaks & hoses": [
    "Oil leak quick report",
    "Litres lost and cost",
    "Environmental spill risk",
    "Containment and isolation",
    "Hose ID and QR code",
    "Hose specification and pressure",
    "Condition and expected life",
    "Next inspection and replacement",
  ],
  Maintenance: [
    "Calendar, hours or condition trigger",
    "Service type and interval",
    "Hours remaining",
    "Checklist, labour and parts",
    "Assigned technician",
    "Evidence and approval",
  ],
  "Work orders": [
    "Machine, fault and priority",
    "Safety risk and reported by",
    "Assigned technician",
    "Planned and actual times",
    "Labour and parts",
    "Repair procedure and verification",
  ],
  "Spares & OEM": [
    "Part and machine",
    "Minimum stock",
    "Supplier and quotation",
    "Purchase order status",
    "Expected delivery",
    "OEM response and delay",
  ],
  "Import centre": [
    "Choose daily Excel or CSV report",
    "Confirm automatic field mapping",
    "Review validation warnings",
    "Import daily records",
    "Weekly and monthly totals update automatically",
  ],
};
function EmptyModule({ name }: { name: string }) {
  const guide = moduleGuides[name] || [
    "Add the first record",
    "Complete required details",
    "Submit for approval",
  ];
  return (
    <>
      <Title
        tag="GUIDED WORKSPACE"
        title={name}
        desc="A simple quick-capture form first, with advanced engineering details available only when needed."
      />
      <div className="moduleintro">
        <section className="panel emptyhero">
          <div>◇</div>
          <h2>No records yet</h2>
          <p>
            There is no demonstration or confidential mine data in this
            workspace.
          </p>
          <button className="primary">＋ Add first record</button>
        </section>
        <section className="panel guide">
          <Head tag="CAPTURED WITHOUT COMPLICATION" title="What SAS records" />
          {guide.map((x, i) => (
            <p key={x}>
              <b>{i + 1}</b>
              <span>{x}</span>
            </p>
          ))}
        </section>
      </div>
      <section className="panel quickflow">
        <span>
          <b>1</b> Select machine
        </span>
        <i>→</i>
        <span>
          <b>2</b> Capture event
        </span>
        <i>→</i>
        <span>
          <b>3</b> Assign action
        </span>
        <i>→</i>
        <span>
          <b>4</b> Verify & close
        </span>
      </section>
    </>
  );
}
function SimpleModal({
  title,
  close,
  fields,
}: {
  title: string;
  close: () => void;
  fields: string[];
}) {
  function save(e: FormEvent) {
    e.preventDefault();
    close();
  }
  return (
    <div className="shade" onMouseDown={close}>
      <form
        className="modal smallmodal"
        onSubmit={save}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modalhead">
          <div>
            <small>SAS SETUP</small>
            <h2>{title}</h2>
            <p>Complete the required details to continue.</p>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </div>
        <div className="formgrid">
          {fields.map((x) => (
            <label key={x}>
              {x}
              <input
                required={x.includes("company") || x.includes("Fleet")}
                type={
                  x.includes("email")
                    ? "email"
                    : x.includes("phone")
                      ? "tel"
                      : "text"
                }
                placeholder={x}
              />
            </label>
          ))}
        </div>
        <div className="modalfoot">
          <span>Details will belong to the selected company only.</span>
          <button className="primary">Save</button>
        </div>
      </form>
    </div>
  );
}
function Production() {
  return (
    <>
      <Title
        tag="ONE-PAGE SHIFT CAPTURE"
        title="Daily production"
        desc="Operators enter the shift once; SAS calculates variance, availability and utilisation automatically."
      >
        <button className="primary">Save shift</button>
      </Title>
      <section className="panel productionform">
        <div className="formsection">
          <span>1</span>
          <div>
            <small>SHIFT</small>
            <h2>Where and when?</h2>
          </div>
        </div>
        <div className="simplefields">
          <label>
            Date
            <input type="date" />
          </label>
          <label>
            Shift
            <select>
              <option>Select shift</option>
              <option>Day</option>
              <option>Night</option>
            </select>
          </label>
          <label>
            Site / area
            <select>
              <option>Select site</option>
            </select>
          </label>
          <label>
            Machine
            <select>
              <option>Select machine</option>
            </select>
          </label>
          <label>
            Operator
            <input placeholder="Operator name" />
          </label>
        </div>
        <div className="formsection">
          <span>2</span>
          <div>
            <small>PERFORMANCE</small>
            <h2>Hours and production</h2>
          </div>
        </div>
        <div className="simplefields">
          <label>
            Planned hours
            <input type="number" placeholder="12" />
          </label>
          <label>
            Operating hours
            <input type="number" placeholder="0" />
          </label>
          <label>
            Idle hours
            <input type="number" placeholder="0" />
          </label>
          <label>
            Production unit
            <select>
              <option>Tonnes</option>
              <option>BCM</option>
              <option>Loads</option>
            </select>
          </label>
          <label>
            Production target
            <input type="number" placeholder="0" />
          </label>
          <label>
            Actual production
            <input type="number" placeholder="0" />
          </label>
        </div>
        <details>
          <summary>Advanced mining fields</summary>
          <div className="simplefields">
            <label>
              Loading tempo
              <input type="number" />
            </label>
            <label>
              Waste removed
              <input type="number" />
            </label>
            <label>
              Coal produced
              <input type="number" />
            </label>
            <label>
              Strip ratio
              <input type="number" />
            </label>
          </div>
        </details>
        <label className="shiftcomment">
          Shift comments
          <textarea placeholder="Exceptions, delays or important observations" />
        </label>
        <div className="autocalc">
          <span>
            <small>Variance</small>
            <b>Calculated</b>
          </span>
          <span>
            <small>Availability</small>
            <b>Calculated</b>
          </span>
          <span>
            <small>Utilisation</small>
            <b>Calculated</b>
          </span>
          <span>
            <small>Approval</small>
            <b>Pending supervisor</b>
          </span>
        </div>
      </section>
    </>
  );
}
function SummaryReports() {
  async function exportProduction(format: "excel" | "word" | "pdf") {
    const response = await fetch("/api/production");
    const data = await response.json();
    const rows = (data.records || []) as ImportRow[];
    if (!rows.length) { alert("Add or import daily production records first."); return; }
    if (format === "excel") downloadExcel("TMM-Production-Report.xlsx", rows);
    else if (format === "word") downloadWord("TMM-Production-Report.doc", "TMM Production Report", rows);
    else printRows("TMM Production Report — choose Save as PDF", rows);
  }
  const [period, setPeriod] = useState<"Weekly" | "Monthly">("Weekly");
  const labels =
    period === "Weekly"
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["W1", "W2", "W3", "W4", "W5"];
  const availability =
    period === "Weekly" ? [0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0];
  const reportTypes = [
    "Production",
    "Fleet availability",
    "Utilisation",
    "Downtime Pareto",
    "Breakdown history",
    "Oil and hose",
    "Maintenance cost",
    "Service compliance",
  ];
  return (
    <>
      <Title
        tag="AUTOMATIC MANAGEMENT SUMMARY"
        title="Weekly & monthly reports"
        desc="Daily records roll up automatically—no manual totals or repeated calculations."
      >
        <div className="exports">
          <button>▦ Excel</button>
          <button>▣ PDF</button>
          <button>W Word</button>
          <button>⌁ Print</button>
        </div>
      </Title>
      <div className="summarybar">
        <div className="periodswitch">
          <button
            className={period === "Weekly" ? "on" : ""}
            onClick={() => setPeriod("Weekly")}
          >
            Weekly summary
          </button>
          <button
            className={period === "Monthly" ? "on" : ""}
            onClick={() => setPeriod("Monthly")}
          >
            Monthly summary
          </button>
        </div>
        <label>
          {period === "Weekly" ? "Week" : "Month"}
          <select>
            <option>
              {period === "Weekly" ? "Current week" : "Current month"}
            </option>
          </select>
        </label>
        <label>
          Site
          <select>
            <option>All sites</option>
          </select>
        </label>
        <button className="primary">Generate summary</button>
      </div>
      <div className="summarykpis">
        <Kpi
          label="Availability"
          value="—"
          note="Scheduled time less downtime"
        />
        <Kpi
          label="Utilisation"
          value="—"
          note="Productive time ÷ available time"
        />
        <Kpi label="Production" value="—" note="Tonnes or BCM versus target" />
        <Kpi label="Downtime" value="—" note="Planned and unplanned hours" />
      </div>
      <div className="reportcharts">
        <section className="panel linechart">
          <Head
            tag={period.toUpperCase() + " TREND"}
            title="Availability & utilisation"
          >
            <span className="chartlegend">
              ● Availability　<span>● Utilisation</span>
            </span>
          </Head>
          <div className="chartempty">
            <svg viewBox="0 0 700 210" preserveAspectRatio="none">
              <g>
                <line x1="0" y1="35" x2="700" y2="35" />
                <line x1="0" y1="95" x2="700" y2="95" />
                <line x1="0" y1="155" x2="700" y2="155" />
              </g>
              <polyline
                points={availability
                  .map(
                    (v, i) =>
                      `${i * (700 / (availability.length - 1 || 1))},155`,
                  )
                  .join(" ")}
              />
            </svg>
            <div>
              {labels.map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            <p>Add daily production records to populate this graph.</p>
          </div>
        </section>
        <section className="panel donutcard">
          <Head tag="DOWNTIME SPLIT" title="Planned vs unplanned" />
          <div className="emptydonut">
            <div>
              <b>0h</b>
              <span>Total downtime</span>
            </div>
          </div>
          <p>
            <i /> Planned maintenance <b>0h</b>
          </p>
          <p>
            <i /> Unplanned breakdown <b>0h</b>
          </p>
        </section>
      </div>
      <div className="reportcharts second">
        <section className="panel bars">
          <Head tag="PRODUCTION PERFORMANCE" title="Target versus actual" />
          <div className="barsempty">
            {labels.map((x) => (
              <div key={x}>
                <i>
                  <em />
                  <b />
                </i>
                <span>{x}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel paretoempty">
          <Head tag="FAILURE PARETO" title="Downtime by system" />
          <div>
            ▥<p>No breakdown records for this period</p>
          </div>
        </section>
      </div>
      <section className="panel reportstrip">
        <Head tag="AVAILABLE REPORTS" title="Included in the summary" />
        <div>
          {reportTypes.map((x) => (
            <span key={x}>✓ {x}</span>
          ))}
        </div>
      </section>
    </>
  );
}
function PricingQuotes() {
  const [cycle, setCycle] = useState<"Monthly" | "Six months">("Monthly"),
    [published, setPublished] = useState(false);
  const packages = [
    {
      name: "Starter",
      monthly: "R4,500",
      six: "R24,300",
      setup: "R10,000",
      fit: "Small contractor",
      limits: "10 users · 25 machines · 1 site",
    },
    {
      name: "Professional",
      monthly: "R9,500",
      six: "R51,300",
      setup: "R20,000",
      fit: "Medium contractor",
      limits: "25 users · 75 machines · 3 sites",
    },
    {
      name: "Enterprise",
      monthly: "R18,000",
      six: "R97,200",
      setup: "From R35,000",
      fit: "Large mine or multi-site contractor",
      limits: "60 users · 200 machines · multiple sites",
    },
  ];
  return (
    <>
      <Title
        tag="COMMERCIAL LICENSING"
        title="Pricing & quotations"
        desc="Companies can compare packages; only the SAS owner can create and publish official quotations."
      >
        <span className="ownerbadge">◇ Owner controls</span>
      </Title>
      <div className="billingtoggle">
        <button
          className={cycle === "Monthly" ? "active" : ""}
          onClick={() => setCycle("Monthly")}
        >
          Pay monthly
        </button>
        <button
          className={cycle === "Six months" ? "active" : ""}
          onClick={() => setCycle("Six months")}
        >
          Pay every six months <b>Save 10%</b>
        </button>
      </div>
      <div className="pricingcards">
        {packages.map((p, i) => (
          <article
            className={`panel pricecard ${i === 1 ? "featured" : ""}`}
            key={p.name}
          >
            {i === 1 && <em>RECOMMENDED</em>}
            <small>SAS {p.name.toUpperCase()}</small>
            <h2>{p.name}</h2>
            <p>{p.fit}</p>
            <strong>
              {cycle === "Monthly" ? p.monthly : p.six}
              <span> / {cycle === "Monthly" ? "month" : "6 months"}</span>
            </strong>
            <div>{p.limits}</div>
            <ul>
              <li>Machine and production tracking</li>
              <li>Breakdowns, leaks and maintenance</li>
              <li>Weekly and monthly reports</li>
              <li>PDF, Excel and Word exports</li>
              <li>Company-isolated workspace</li>
            </ul>
            <footer>
              <span>Once-off setup</span>
              <b>{p.setup}</b>
            </footer>
            <button>Select package</button>
          </article>
        ))}
      </div>
      <section className="panel quotebuilder">
        <Head tag="SAS OWNER ONLY" title="Create an official quotation">
          <span className={published ? "published" : "draft"}>
            {published ? "● Published" : "○ Draft"}
          </span>
        </Head>
        <div className="quotegrid">
          <div className="quoteform">
            <h3>Quotation details</h3>
            <div className="simplefields">
              <label>
                Quote number
                <input placeholder="SAS-Q-0001" />
              </label>
              <label>
                Quote date
                <input type="date" />
              </label>
              <label>
                Valid until
                <input type="date" />
              </label>
              <label>
                Customer / company
                <input placeholder="Select company" />
              </label>
              <label>
                Contact person
                <input placeholder="Name and surname" />
              </label>
              <label>
                Customer email
                <input type="email" placeholder="admin@company.co.za" />
              </label>
              <label>
                Package
                <select>
                  <option>SAS Professional</option>
                  <option>SAS Starter</option>
                  <option>SAS Enterprise</option>
                </select>
              </label>
              <label>
                Billing cycle
                <select>
                  <option>Monthly</option>
                  <option>Six months</option>
                </select>
              </label>
              <label>
                Implementation fee
                <input placeholder="R20,000" />
              </label>
            </div>
            <h3>Payment details</h3>
            <div className="simplefields">
              <label>
                Account holder
                <input placeholder="Registered account holder" />
              </label>
              <label>
                Bank name
                <input placeholder="Bank name" />
              </label>
              <label>
                Account number
                <input placeholder="Account number" />
              </label>
              <label>
                Branch code
                <input placeholder="Branch code" />
              </label>
              <label>
                Account type
                <select>
                  <option>Business current</option>
                  <option>Savings</option>
                </select>
              </label>
              <label>
                Payment reference
                <input placeholder="Company / quote number" />
              </label>
            </div>
            <label className="shiftcomment">
              Quotation notes
              <textarea placeholder="Implementation, training, payment terms and exclusions" />
            </label>
            <div className="publishcontrol">
              <label>
                <input type="checkbox" /> Confirm banking details have been
                verified
              </label>
              <label>
                Visibility
                <select>
                  <option>Selected company administrators only</option>
                  <option>All registered company administrators</option>
                  <option>SAS owner only</option>
                </select>
              </label>
              <button className="primary" onClick={() => setPublished(true)}>
                {published ? "✓ Quotation published" : "Publish quotation"}
              </button>
            </div>
          </div>
          <aside className="quotepreview">
            <div className="quotehead">
              <b>SAS</b>
              <span>
                <strong>QUOTATION</strong>
                <small>Draft preview</small>
              </span>
            </div>
            <dl>
              <div>
                <dt>Quote number</dt>
                <dd>SAS-Q-0001</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>Not selected</dd>
              </div>
              <div>
                <dt>Valid until</dt>
                <dd>Not selected</dd>
              </div>
              <div>
                <dt>Prepared for</dt>
                <dd>Company not selected</dd>
              </div>
            </dl>
            <h4>SAS Professional</h4>
            <p>Monthly software licence</p>
            <strong>R9,500.00</strong>
            <small>Implementation and training quoted separately</small>
            <hr />
            <p className="privacy">
              Banking details appear here only after the owner verifies and
              publishes the quotation.
            </p>
            <div className="quoteactions">
              <button>▣ PDF</button>
              <button>W Word</button>
              <button>⌁ Print</button>
            </div>
          </aside>
        </div>
      </section>
      <section className="panel quotehistory">
        <Head tag="PUBLISHED DOCUMENTS" title="Quotation history" />
        <EmptyRow text="No quotations have been published yet." />
      </section>
    </>
  );
}
type PaymentOrder = {
  id: number;
  orderNumber: string;
  documentType: string;
  supplier: string;
  fleetNumber?: string;
  description: string;
  amount: number;
  orderDate: string;
  expectedDelivery?: string;
  paymentStatus: string;
  orderStatus: string;
  attachmentName?: string;
  responsiblePerson?: string;
};
function PaymentsOrders() {
  const [show, setShow] = useState(false),
    [orders, setOrders] = useState<PaymentOrder[]>([]),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/orders")
      .then((r) => r.json())
      .then((x) => setOrders(x.orders || []))
      .catch(() => undefined);
  }, []);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/orders", {
      method: "POST",
      body: new FormData(e.currentTarget),
    }).catch(() => null);
    if (response?.ok) {
      const x = await response.json();
      setOrders((o) => [x.order, ...o]);
      setMessage("✓ Order record saved");
      setShow(false);
    } else
      setMessage(
        "Could not save. Check the required fields and document size.",
      );
    setSaving(false);
  }
  const overdue = orders.filter(
    (o) =>
      o.expectedDelivery &&
      new Date(o.expectedDelivery) < new Date() &&
      !["delivered", "cancelled"].includes(o.orderStatus),
  ).length;
  const outstanding = orders
    .filter((o) => o.paymentStatus !== "paid")
    .reduce((s, o) => s + Number(o.amount || 0), 0);
  return (
    <>
      <Title
        tag="CONTRACTOR COMMERCIAL CONTROL"
        title="Payments & orders"
        desc="Keep purchase orders, quotations, supplier progress and machine-linked payment records together."
      >
        <button className="primary" onClick={() => setShow(true)}>
          ＋ Add PO or quotation
        </button>
      </Title>
      {message && <div className="ordersaved">{message}</div>}
      <div className="orderkpis">
        <Kpi
          label="Open orders"
          value={String(
            orders.filter(
              (o) => !["delivered", "cancelled"].includes(o.orderStatus),
            ).length,
          )}
          note="Awaiting store or supplier action"
        />
        <Kpi
          label="Payment outstanding"
          value={outstanding ? `R${outstanding.toLocaleString()}` : "R0"}
          note="Ordered value not marked paid"
        />
        <Kpi
          label="Delivery overdue"
          value={String(overdue)}
          note="Expected date has passed"
        />
        <Kpi
          label="Reminders"
          value="Email ready"
          note="SMS activates after provider setup"
        />
      </div>
      <div className="orderlayout">
        <section className="panel ordertable">
          <Head tag="COMPANY-ONLY RECORDS" title="Purchase orders & quotations">
            <div className="orderfilters">
              <button>All</button>
              <button>Awaiting quote</button>
              <button>Ordered</button>
              <button>Delivered</button>
            </div>
          </Head>
          {orders.length ? (
            <table>
              <thead>
                <tr>
                  <th>PO / quote</th>
                  <th>Machine & item</th>
                  <th>Supplier / store</th>
                  <th>Payment</th>
                  <th>Order status</th>
                  <th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.orderNumber}</strong>
                      <small>
                        {o.documentType.replaceAll("_", " ")}
                        {o.attachmentName ? ` · ${o.attachmentName}` : ""}
                      </small>
                    </td>
                    <td>
                      <strong>{o.fleetNumber || "General"}</strong>
                      <small>{o.description}</small>
                    </td>
                    <td>{o.supplier}</td>
                    <td>
                      <span className={`orderstatus ${o.paymentStatus}`}>
                        {o.paymentStatus.replaceAll("_", " ")}
                      </span>
                      <small>
                        {o.amount
                          ? `R${Number(o.amount).toLocaleString()}`
                          : "Amount pending"}
                      </small>
                    </td>
                    <td>
                      <span className={`orderstatus ${o.orderStatus}`}>
                        {o.orderStatus.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>{o.expectedDelivery || "Not confirmed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="orderempty">
              <b>PO</b>
              <h2>No payment or order records yet</h2>
              <p>
                Add a purchase order, supplier quotation or payment record and
                link it to the affected machine.
              </p>
              <button className="primary" onClick={() => setShow(true)}>
                Add first record
              </button>
            </div>
          )}
        </section>
        <aside className="panel reminderrail">
          <Head tag="FOLLOW-UP ENGINE" title="What gets tracked" />
          <div>
            {[
              [
                "Machine standing",
                "Order linked to the breakdown or work order",
              ],
              [
                "Quotation delayed",
                "Store has not supplied pricing by the follow-up date",
              ],
              [
                "PO not issued",
                "Approved request is waiting for a purchase order",
              ],
              ["Supplier overdue", "Expected delivery date has passed"],
              [
                "Payment required",
                "Deposit, balance or invoice remains unpaid",
              ],
              [
                "Part received",
                "Notify mechanic and update machine recovery plan",
              ],
            ].map((x, i) => (
              <article key={x[0]}>
                <b>{i + 1}</b>
                <span>
                  <strong>{x[0]}</strong>
                  <small>{x[1]}</small>
                </span>
              </article>
            ))}
          </div>
          <p>
            <b>Delivery status:</b> Resend email integration is ready. SMS
            remains unavailable until an approved SMS provider is connected.
          </p>
        </aside>
      </div>
      <section className="panel orderflow">
        <span>
          <b>1</b> Request quotation
        </span>
        <i>→</i>
        <span>
          <b>2</b> Approve & issue PO
        </span>
        <i>→</i>
        <span>
          <b>3</b> Track payment
        </span>
        <i>→</i>
        <span>
          <b>4</b> Follow supplier
        </span>
        <i>→</i>
        <span>
          <b>5</b> Receive & fit part
        </span>
      </section>
      {show && (
        <div className="shade" onMouseDown={() => setShow(false)}>
          <form
            className="modal ordermodal"
            onSubmit={save}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modalhead">
              <div>
                <small>PAYMENT & ORDER RECORD</small>
                <h2>Add PO, quotation or invoice</h2>
                <p>
                  Link the commercial document to the machine and responsible
                  person.
                </p>
              </div>
              <button type="button" onClick={() => setShow(false)}>
                ×
              </button>
            </div>
            <div className="formgrid">
              <label>
                Document type
                <select name="documentType">
                  <option value="purchase_order">Purchase order (PO)</option>
                  <option value="supplier_quotation">Supplier quotation</option>
                  <option value="invoice">Invoice</option>
                  <option value="payment_proof">Proof of payment</option>
                </select>
              </label>
              <label>
                PO / quotation number
                <input name="orderNumber" required placeholder="PO-0001" />
              </label>
              <label>
                Supplier / store
                <input
                  name="supplier"
                  required
                  placeholder="Supplier or store name"
                />
              </label>
              <label>
                Store contact
                <input name="storeContact" placeholder="Email or phone" />
              </label>
              <label>
                Machine / fleet number
                <input name="fleetNumber" placeholder="e.g. EX 011" />
              </label>
              <label>
                Part or service
                <input
                  name="description"
                  required
                  placeholder="Hydraulic hose assembly"
                />
              </label>
              <label>
                Order date
                <input name="orderDate" type="date" required />
              </label>
              <label>
                Expected delivery
                <input name="expectedDelivery" type="date" />
              </label>
              <label>
                Amount (R)
                <input
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                />
              </label>
              <label>
                Payment status
                <select name="paymentStatus">
                  <option value="not_paid">Not paid</option>
                  <option value="deposit_paid">Deposit paid</option>
                  <option value="part_paid">Part paid</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
              <label>
                Order status
                <select name="orderStatus">
                  <option value="quotation_requested">
                    Quotation requested
                  </option>
                  <option value="awaiting_approval">Awaiting approval</option>
                  <option value="po_issued">PO issued</option>
                  <option value="ordered">Ordered</option>
                  <option value="in_transit">In transit</option>
                  <option value="delivered">Delivered</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label>
                Responsible person
                <input
                  name="responsiblePerson"
                  placeholder="Planner / buyer / mechanic"
                />
              </label>
              <label>
                Next reminder
                <input name="nextReminderAt" type="datetime-local" />
              </label>
              <label>
                Attach document
                <input
                  name="document"
                  type="file"
                  accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
                />
                <small>PDF, Word, Excel or image · maximum 10 MB</small>
              </label>
              <label className="wide">
                Follow-up channels
                <span className="channelchecks">
                  <i>
                    <input
                      name="reminderEmail"
                      value="true"
                      type="checkbox"
                      defaultChecked
                    />{" "}
                    Email
                  </i>
                  <i>
                    <input name="reminderSms" value="true" type="checkbox" />{" "}
                    SMS
                  </i>
                </span>
              </label>
              <label className="wide">
                Notes
                <textarea
                  name="notes"
                  placeholder="Supplier commitment, delivery instructions or payment reference"
                />
              </label>
            </div>
            <div className="modalfoot">
              <span>
                Only authorised users in the selected company can see this
                record.
              </span>
              <button className="primary" disabled={saving}>
                {saving ? "Saving…" : "Save order record"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
function CaptureHub({ openManual }: { openManual: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("Control room daily report");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] || null; setFile(next); setRows([]); setMessage("");
    if (!next) return;
    try {
      const raw = await readWorkbook(next);
      const mapped = source === "Fleet availability report" ? fleetRows(raw) : productionRows(raw);
      if (!mapped.length) throw new Error("No valid rows detected. Check the required headings and try again.");
      setRows(mapped as unknown as ImportRow[]);
      setMessage(`✓ ${mapped.length} valid rows detected. Review the preview before approving.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The file could not be read."); }
  }
  async function approve() {
    if (!file || !rows.length) return; setSaving(true);
    const fleet = source === "Fleet availability report";
    const response = await fetch(fleet ? "/api/machines" : "/api/production", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: 1, sourceFile: file.name, rows })
    });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? `✓ Import completed: ${result.imported ?? 0} records saved to D1.` : result.error || "Import failed.");
    setSaving(false);
  }
  return (
    <>
      <Title tag="DATA CAPTURE HUB" title="Bring in daily machine information" desc="Upload an Excel/CSV control-room report, review detected fields, then approve the D1 import." />
      <div className="capturemethods">
        <article className="panel capturecard selected"><span>1</span><b>Excel or CSV upload</b><p>Reads headings and maps fleet, dates, hours, downtime and production.</p><em>Recommended</em></article>
        <article className="panel capturecard"><span>2</span><b>Manual daily entry</b><p>Use the shift form when a spreadsheet is unavailable.</p><button onClick={openManual}>Open manual capture →</button></article>
        <article className="panel capturecard"><span>3</span><b>Sensors & telematics</b><p>Optional future OEM or IoT connection.</p><em>Not connected</em></article>
      </div>
      <section className="panel importworkspace">
        <Head tag="CONTROL-ROOM IMPORT" title="Upload, review and approve"><span className="safechip">No automatic overwrite</span></Head>
        <div className="importgrid">
          <div className="dropzone"><input id="daily-file" type="file" accept=".xlsx,.xls,.xlsm,.csv" onChange={choose}/><label htmlFor="daily-file"><b>⇧</b><strong>{file ? file.name : "Choose the control-room report"}</strong><span>Excel or CSV · one file at a time</span><button type="button">Browse file</button></label></div>
          <div className="importsettings"><label>Report type<select value={source} onChange={(e)=>{setSource(e.target.value);setRows([]);setFile(null);}}><option>Control room daily report</option><option>Fleet availability report</option><option>Production summary</option></select></label><label>Duplicate rule<select><option>Flag / skip — never overwrite</option></select></label></div>
        </div>
        {message && <div className="importstatus success"><b>{rows.length ? "✓" : "!"}</b><span><strong>{message}</strong><small>Nothing is saved until Approve import is pressed.</small></span></div>}
        {rows.length > 0 && <><div className="panel tablewrap" style={{overflowX:"auto"}}><table><thead><tr>{Object.keys(rows[0]).map((key)=><th key={key}>{key}</th>)}</tr></thead><tbody>{rows.slice(0,5).map((row,i)=><tr key={i}>{Object.keys(rows[0]).map((key)=><td key={key}>{String(row[key] ?? "")}</td>)}</tr>)}</tbody></table></div><div className="modalfoot"><span>Previewing first {Math.min(rows.length,5)} of {rows.length} valid rows.</span><button className="primary" onClick={approve} disabled={saving}>{saving ? "Saving…" : "Approve import"}</button></div></>}
      </section>
    </>
  );
}
function EmptyRow({ text }: { text: string }) {
  return (
    <div className="emptyrow">
      <b>▦</b>
      <span>{text}</span>
    </div>
  );
}
function Kpi({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
function Title({
  tag,
  title,
  desc,
  children,
}: {
  tag: string;
  title: string;
  desc: string;
  children?: ReactNode;
}) {
  return (
    <div className="title">
      <div>
        <small>{tag}</small>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {children}
    </div>
  );
}
function Head({
  tag,
  title,
  children,
}: {
  tag: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="head">
      <div>
        <small>{tag}</small>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
