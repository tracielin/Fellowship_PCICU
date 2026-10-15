import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, onSnapshot, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAIL } from "./config.js";
import { curriculum } from "./curriculum.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const STATUSES = [
  { key: "none", label: "Haven't specifically learned yet", cls: "s-none" },
  { key: "more", label: "Learned, could use more", cls: "s-more" },
  { key: "decent", label: "Learned a decent amount", cls: "s-decent" }
];
const DEFAULT_STATUS = "none";
const STATUS_BY_KEY = Object.fromEntries(STATUSES.map(s => [s.key, s]));
const ITEMS = curriculum.filter(e => e.id);

let currentUser = null;
let mySelections = {};
let unsubSelf = null;
let unsubAdmin = null;

const $ = id => document.getElementById(id);

// ---------- Build the curriculum table ----------
// One table: the status labels are the column headers (sticky while scrolling),
// and each item row has one checkbox per status.
function buildCurriculum() {
  const table = document.createElement("table");
  table.className = "curriculum";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const topic = document.createElement("th");
  topic.scope = "col";
  topic.textContent = "Topic";
  headRow.appendChild(topic);
  for (const s of STATUSES) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = s.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const entry of curriculum) {
    const tr = document.createElement("tr");
    if (entry.header) {
      tr.className = "section";
      const td = document.createElement("td");
      td.colSpan = STATUSES.length + 1;
      td.textContent = entry.header;
      tr.appendChild(td);
      tbody.appendChild(tr);
      continue;
    }

    const title = document.createElement("th");
    title.scope = "row";
    title.textContent = entry.title;
    tr.appendChild(title);

    for (const s of STATUSES) {
      const td = document.createElement("td");
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
  table.appendChild(tbody);
  $("curriculum").appendChild(table);
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
  unsubSelf?.();
  unsubSelf = onSnapshot(doc(db, "selections", user.uid), snap => {
    const saved = snap.data()?.selections || {};

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

onAuthStateChanged(auth, user => {
  currentUser = user;
  $("login").hidden = !!user;
  $("app").hidden = !user;
  $("logout").hidden = !user;
  $("whoami").textContent = user ? user.email : "";

  if (user) startSync(user);
  else stopSync();
});

buildCurriculum();
