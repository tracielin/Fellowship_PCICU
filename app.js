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
const STATUS_BY_KEY = Object.fromEntries(STATUSES.map(s => [s.key, s]));
const ITEMS = curriculum.filter(e => e.id);

let currentUser = null;
let mySelections = {};
let unsubSelf = null;
let unsubAdmin = null;

const $ = id => document.getElementById(id);

// ---------- Build the curriculum list ----------
function buildCurriculum() {
  const wrap = $("curriculum");
  for (const entry of curriculum) {
    if (entry.header) {
      const h = document.createElement("h3");
      h.textContent = entry.header;
      wrap.appendChild(h);
      continue;
    }
    const row = document.createElement("div");
    row.className = "row";

    const title = document.createElement("span");
    title.textContent = entry.title;
    row.appendChild(title);

    const opts = document.createElement("div");
    opts.className = "opts";
    for (const s of STATUSES) {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.item = entry.id;
      cb.dataset.status = s.key;
      cb.addEventListener("change", () => onToggle(entry.id, s.key, cb.checked));
      label.append(cb, " " + s.label);
      opts.appendChild(label);
    }
    row.appendChild(opts);
    wrap.appendChild(row);
  }
}

// Each item allows exactly one status. Checking one clears the others.
function onToggle(itemId, status, checked) {
  const next = { ...mySelections };
  if (checked) next[itemId] = status;
  else delete next[itemId];
  mySelections = next;
  paintCheckboxes();
  saveSelections();
}

function paintCheckboxes() {
  document.querySelectorAll("#curriculum input[type=checkbox]").forEach(cb => {
    cb.checked = mySelections[cb.dataset.item] === cb.dataset.status;
  });
}

async function saveSelections() {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, "selections", currentUser.uid), {
      name: currentUser.displayName || "",
      email: currentUser.email || "",
      selections: mySelections,
      updatedAt: serverTimestamp()
    });
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
    mySelections = snap.data()?.selections || {};
    paintCheckboxes();
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
