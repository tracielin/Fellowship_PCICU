import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, onSnapshot, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAIL } from "./config.js";
import { curriculum } from "./curriculum.js";
import { updateHeaderUser, initHeaderLogout } from "./header.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const STATUSES = [
  { key: "none", label: "Haven't specifically learned yet", cls: "s-none" },
  { key: "more", label: "Learned, could use more", cls: "s-more" },
  { key: "decent", label: "Learned a decent amount", cls: "s-decent" },
  { key: "competent", label: "Confirmed competent per attending", cls: "s-competent" }
];
const DEFAULT_STATUS = "none";
const STATUS_BY_KEY = Object.fromEntries(STATUSES.map(s => [s.key, s]));
const ITEMS = curriculum.filter(e => e.id);
const COLLAPSED_KEY = "pcicu.collapsedSections";

let currentUser = null;
let mySelections = {};
let unsubSelf = null;
let unsubAdmin = null;
let sections = [];

const $ = id => document.getElementById(id);

// ---------- Collapsible sections ----------
// The collapsed sections are saved in the user's Firestore record (field "collapsed"),
// so they follow the person across devices.
let collapsedLoaded = false;

function currentCollapsedNames() {
  return sections.filter(s => s.collapsed).map(s => s.name);
}

async function saveCollapsedNames(names = currentCollapsedNames()) {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, "selections", currentUser.uid), {
      name: currentUser.displayName || "",
      email: currentUser.email || "",
      collapsed: names
    }, { merge: true });
  } catch (err) {
    console.error("Could not save table layout:", err);
  }
}

// Only used once, to carry over the layout a returning user saved in this browser
// before the setting moved to Firestore.
function loadLegacyCollapsedNames() {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || null;
  } catch {
    return null;
  }
}

function applyCollapsedNames(names) {
  const collapsed = new Set(names);
  for (const section of sections) setSection(section, collapsed.has(section.name));
}

// Runs once per login, on the first snapshot of the user's record.
//  - First login (no record yet): every section starts collapsed, and that is saved.
//  - Returning user with a saved layout: that layout is restored.
//  - Returning user from before this change: their layout from this browser is carried
//    over (or expanded, if none was saved), and saved to Firestore.
function applyInitialCollapse(snap, data) {
  if (!snap.exists()) {
    applyCollapsedNames(sections.map(s => s.name));
    saveCollapsedNames(sections.map(s => s.name));
    return;
  }
  if (Array.isArray(data.collapsed)) {
    applyCollapsedNames(data.collapsed);
    return;
  }
  const legacy = loadLegacyCollapsedNames() || [];
  applyCollapsedNames(legacy);
  saveCollapsedNames(legacy);
  try {
    localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

function setSection(section, collapsed) {
  section.collapsed = collapsed;
  section.toggle.setAttribute("aria-expanded", String(!collapsed));
  section.sign.textContent = collapsed ? "+" : "\u2212";
  for (const tr of section.rows) tr.hidden = collapsed;
  updateToggleAll();
}

// One button. It reads "Collapse all" while any section is open, and
// "Expand all" once every section is collapsed.
function updateToggleAll() {
  const btn = $("toggleAll");
  if (!btn) return;
  btn.textContent = sections.some(s => !s.collapsed) ? "Collapse all" : "Expand all";
}

$("toggleAll").addEventListener("click", () => {
  const anyOpen = sections.some(s => !s.collapsed);
  sections.forEach(s => setSection(s, anyOpen));
  saveCollapsedNames();
});

// Status labels row. Built under each section header. It is the sticky row for
// its section: CSS keeps it pinned while its own table is on screen, and the
// next section's table pushes it away when the user scrolls down.
function buildLabelRow() {
  const tr = document.createElement("tr");
  tr.className = "labels";
  const topic = document.createElement("th");
  topic.scope = "col";
  topic.textContent = "Topic";
  tr.appendChild(topic);
  for (const s of STATUSES) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = s.label;
    if (s.key === "competent") th.classList.add("col-sep");
    tr.appendChild(th);
  }
  return tr;
}

// Every section's table uses the same fixed column widths so the columns line up.
function buildColgroup() {
  const colgroup = document.createElement("colgroup");
  const first = document.createElement("col");
  first.style.width = "40%";
  colgroup.appendChild(first);
  const rest = (100 - 40) / STATUSES.length;
  for (let i = 0; i < STATUSES.length; i++) {
    const col = document.createElement("col");
    col.style.width = `${rest}%`;
    colgroup.appendChild(col);
  }
  return colgroup;
}

// ---------- Build the curriculum table ----------
// One table per section. Each table holds its section header, its status-label
// row (sticky), and the item rows. Section header rows toggle the rows beneath them.
function buildCurriculum() {
  const container = $("curriculum");
  let tbody = null;
  let current = null;

  for (const entry of curriculum) {
    if (entry.header) {
      const table = document.createElement("table");
      table.className = "curriculum";
      table.appendChild(buildColgroup());
      tbody = document.createElement("tbody");
      table.appendChild(tbody);
      container.appendChild(table);

      const tr = document.createElement("tr");
      tr.className = "section";
      const td = document.createElement("td");
      td.colSpan = STATUSES.length + 1;

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "section-toggle";
      const label = document.createElement("span");
      label.textContent = entry.header;
      const sign = document.createElement("span");
      sign.className = "sign";
      sign.setAttribute("aria-hidden", "true");
      toggle.append(label, sign);
      td.appendChild(toggle);
      tr.appendChild(td);
      tbody.appendChild(tr);

      const labels = buildLabelRow();
      tbody.appendChild(labels);

      const section = { name: entry.header, toggle, sign, rows: [labels], collapsed: false };
      setSection(section, false);
      toggle.addEventListener("click", () => {
        setSection(section, !section.collapsed);
        saveCollapsedNames();
      });
      sections.push(section);
      current = section;
      continue;
    }

    const tr = document.createElement("tr");
    if (current) current.rows.push(tr);

    const title = document.createElement("th");
    title.scope = "row";
    title.textContent = entry.title;
    tr.appendChild(title);

    for (const s of STATUSES) {
      const td = document.createElement("td");
      if (s.key === "competent") td.classList.add("col-sep");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.item = entry.id;
      cb.dataset.status = s.key;
      cb.setAttribute("aria-label", `${entry.title}: ${s.label}`);
      cb.addEventListener("change", () => onToggle(entry.id, s.key, cb.checked));
      td.appendChild(cb);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

}

// Exactly one status per row. Clicking the checked box does nothing;
// clicking another box moves the selection to it.
function onToggle(itemId, status, checked) {
  if (!checked) {
    paintCheckboxes();
    return;
  }
  mySelections = { ...mySelections, [itemId]: status };
  paintCheckboxes();
  saveSelections({ [itemId]: status });
}

function paintCheckboxes() {
  document.querySelectorAll("#curriculum input[type=checkbox]").forEach(cb => {
    cb.checked = mySelections[cb.dataset.item] === cb.dataset.status;
  });
}

// Writes only the given keys. merge: true means other saved answers are untouched.
async function saveSelections(partial) {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, "selections", currentUser.uid), {
      name: currentUser.displayName || "",
      email: currentUser.email || "",
      selections: partial,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.error("Save failed:", err);
    alert("Could not save your selection. Please check your connection and try again.");
  }
}

// ---------- Moderator view ----------
function renderAdmin(users) {
  const list = $("adminList");
  list.textContent = "";
  users.sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));

  if (users.length === 0) {
    list.textContent = "No selections yet.";
    return;
  }

  for (const user of users) {
    const sel = user.selections || {};
    const count = Object.keys(sel).length;

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${user.name || "(no name)"} · ${user.email || ""} · ${count}/${ITEMS.length} answered`;
    details.appendChild(summary);

    const ul = document.createElement("ul");
    ul.className = "summary";
    for (const item of ITEMS) {
      const li = document.createElement("li");
      const status = STATUS_BY_KEY[sel[item.id]];
      li.textContent = `${item.title}: `;
      const span = document.createElement("span");
      span.textContent = status ? status.label : "not answered";
      if (status) span.className = status.cls;
      else span.style.color = "#aaa";
      li.appendChild(span);
      ul.appendChild(li);
    }
    details.appendChild(ul);
    list.appendChild(details);
  }
}

// ---------- Sync with Firestore ----------
function startSync(user) {
  collapsedLoaded = false;
  unsubSelf?.();
  unsubSelf = onSnapshot(doc(db, "selections", user.uid), snap => {
    const data = snap.data() || {};
    const saved = data.selections || {};

    if (!collapsedLoaded) {
      collapsedLoaded = true;
      applyInitialCollapse(snap, data);
    }

    // Any item without a saved answer defaults to "Haven't specifically learned yet".
    // Those defaults are saved once, so the data is complete for every user.
    const missing = {};
    for (const item of ITEMS) {
      if (!(item.id in saved)) missing[item.id] = DEFAULT_STATUS;
    }

    mySelections = { ...saved, ...missing };
    paintCheckboxes();

    if (Object.keys(missing).length > 0) saveSelections(missing);
  });

  unsubAdmin?.();
  unsubAdmin = null;
  const isAdmin = user.email === ADMIN_EMAIL;
  $("admin").hidden = !isAdmin;
  if (isAdmin) {
    unsubAdmin = onSnapshot(collection(db, "selections"), snap => {
      renderAdmin(snap.docs.map(d => d.data()));
    });
  }
}

function stopSync() {
  collapsedLoaded = false;
  unsubSelf?.();
  unsubAdmin?.();
  unsubSelf = unsubAdmin = null;
  mySelections = {};
}

// ---------- Auth ----------
$("loginBtn").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error("Sign-in failed:", err);
    alert("Sign-in failed. Please try again.");
  }
});

$("logout").addEventListener("click", () => signOut(auth));
initHeaderLogout(auth, signOut);

onAuthStateChanged(auth, user => {
  currentUser = user;
  $("login").hidden = !!user;
  $("app").hidden = !user;
  $("logout").hidden = !user;
  $("whoami").textContent = user ? user.email : "";
  updateHeaderUser(user);

  if (user) startSync(user);
  else stopSync();
});

buildCurriculum();
