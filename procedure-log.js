import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc, query, where, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAIL } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const COLLECTION = "procedureLogs";
const ECG_LABEL = "ECG interpretation";

const EP_GOAL = 5;

const CICU_PROCEDURES = [
  "Intubation", "Bag-mask ventilation", "LMA placement", "Chest tube", "CVL placement",
  "PICC placement", "Pleural tap", "Pericardial tap", "Pericardial drain placement",
  "IO placement", "Peritoneal tap", "Peritoneal drain placement",
  "Tested temporary pacing wires", "Other"
];

const ECHO_OPTIONS = ["Obtained TTE images", "Obtained TEE images", "Other"];

const SECTIONS = [
  {
    key: "cath",
    title: "Cath",
    goal: "Goal is to interpret at least 5 caths (hemodynamics and angiography) and participate in at least 3 caths.",
    progress: null
  },
  {
    key: "ep",
    title: "EP",
    goal: "Goal is to independently interpret 5 ECGs. Add each ECG as its own entry. Other EP procedures can be logged too, but they are not counted toward the goal.",
    progress: entries => {
      const n = entries.filter(e => e.item === ECG_LABEL).length;
      return `${n} of ${EP_GOAL} ECGs completed`;
    }
  },
  {
    key: "cicu",
    title: "CICU/Anesthesiology",
    goal: "Log all CICU/Anesthesiology procedures here.",
    progress: null
  },
  {
    key: "echo",
    title: "Echo",
    goal: "While we would like you to both obtain echo images and discuss interpretation, to avoid fatigue about logging, we only ask that you log experience with obtaining echo images.",
    progress: null
  }
];

const $ = id => document.getElementById(id);
let currentUser = null;
let unsubOwn = null;
let unsubAdmin = null;
const listFor = {};

const isOtherChoice = value => value.startsWith("Other");

// ---------- Build sections and entry forms ----------
function buildSections() {
  for (const section of SECTIONS) {
    const wrap = document.createElement("section");
    wrap.className = "log-section";

    const h3 = document.createElement("h3");
    h3.textContent = section.title;
    wrap.appendChild(h3);

    const goal = document.createElement("p");
    goal.className = "goal";
    goal.textContent = section.goal;
    wrap.appendChild(goal);

    const progress = document.createElement("p");
    progress.className = "progress";
    progress.dataset.progress = section.key;
    wrap.appendChild(progress);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "primary";
    addBtn.textContent = "Add new";
    wrap.appendChild(addBtn);

    const form = buildForm(section);
    form.hidden = true;
    wrap.appendChild(form);
    addBtn.addEventListener("click", () => { form.hidden = false; form.querySelector("input[name=date]").focus(); });

    const list = document.createElement("ul");
    list.className = "logs";
    wrap.appendChild(list);
    listFor[section.key] = list;

    $("sections").appendChild(wrap);
  }
}

function buildForm(section) {
  const form = document.createElement("form");
  form.className = "entry";

  const today = new Date();
  const localIso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  let extra = "";
  if (section.key === "cath") {
    extra = `<label>What you did
      <textarea name="description" rows="2" required placeholder="e.g. interpreted cath, obtained access, performed BAS"></textarea></label>`;
  } else if (section.key === "ep") {
    extra = `<label>Type
        <select name="item" required>
          <option value="${ECG_LABEL}">${ECG_LABEL}</option>
          <option value="Other procedure">Other procedure</option>
        </select></label>
      <label class="other-field" hidden>Describe the procedure
        <textarea name="description" rows="2"></textarea></label>`;
  } else {
    const choices = section.key === "echo" ? ECHO_OPTIONS : CICU_PROCEDURES;
    const label = section.key === "echo" ? "Echo images" : "Procedure";
    const options = choices.map(p => `<option value="${p}">${p}</option>`).join("");
    extra = `<label>${label}
        <select name="item" required><option value="">Select an option</option>${options}</select></label>
      <label class="other-field" hidden>Describe the procedure
        <input type="text" name="description"></label>`;
  }

  form.innerHTML = `
    <label>Date <input type="date" name="date" required value="${localIso}"></label>
    <label>Supervising attending <input type="text" name="supervisor" required></label>
    ${extra}
    <div class="entry-actions">
      <button type="submit" class="primary">Save</button>
      <button type="button" class="cancel-btn">Cancel</button>
    </div>`;

  const select = form.querySelector("select[name=item]");
  const otherLabel = form.querySelector(".other-field");
  const otherInput = otherLabel?.querySelector("[name=description]");

  // Show the freetext box only when "Other" is chosen; keep it required only while shown.
  const updateOther = () => {
    if (!select || !otherLabel) return;
    const show = isOtherChoice(select.value);
    otherLabel.hidden = !show;
    otherInput.required = show;
  };
  select?.addEventListener("change", updateOther);

  form.querySelector(".cancel-btn").addEventListener("click", () => {
    form.hidden = true;
    form.reset();
    updateOther();
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!currentUser) return;
    const fd = new FormData(form);
    const item = fd.get("item") || null;
    let description = (fd.get("description") || "").trim() || null;
    if (section.key !== "cath" && !isOtherChoice(item || "")) description = null;
    if (section.key === "ep" && item !== "Other procedure") description = null;

    const record = {
      uid: currentUser.uid,
      name: currentUser.displayName || "",
      email: currentUser.email || "",
      section: section.key,
      date: fd.get("date"),
      supervisor: fd.get("supervisor").trim(),
      item: section.key === "cath" ? null : item,
      description,
      createdAt: serverTimestamp()
    };

    try {
      await addDoc(collection(db, COLLECTION), record);
      form.reset();
      form.hidden = true;
      updateOther();
    } catch (err) {
      console.error("Save failed:", err);
      alert("Could not save this entry. Please check your connection and try again.");
    }
  });

  return form;
}

// ---------- Rendering ----------
const createdMillis = e => e.createdAt?.toMillis?.() ?? Date.now();
const byNewest = (a, b) => (b.date || "").localeCompare(a.date || "") || createdMillis(b) - createdMillis(a);

function logItem(entry, deletable) {
  const li = document.createElement("li");
  const info = document.createElement("div");

  const main = document.createElement("div");
  main.className = "log-main";
  main.textContent = entry.item && entry.description
    ? `${entry.item}: ${entry.description}`
    : (entry.item || entry.description || "");
  info.appendChild(main);

  const meta = document.createElement("div");
  meta.className = "log-meta";
  meta.textContent = `${entry.date} · Supervising attending: ${entry.supervisor}`;
  info.appendChild(meta);
  li.appendChild(info);

  if (deletable) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-btn";
    del.textContent = "Delete";
    del.addEventListener("click", () => deleteEntry(entry.id));
    li.appendChild(del);
  }
  return li;
}

function renderOwn(entries) {
  for (const section of SECTIONS) {
    const mine = entries.filter(e => e.section === section.key).sort(byNewest);
    const list = listFor[section.key];
    list.textContent = "";
    if (mine.length === 0) {
      const none = document.createElement("li");
      none.className = "empty";
      none.textContent = "No entries yet.";
      list.appendChild(none);
    }
    for (const e of mine) list.appendChild(logItem(e, true));

    const progressEl = document.querySelector(`[data-progress="${section.key}"]`);
    if (section.progress) progressEl.textContent = section.progress(mine);
    else progressEl.textContent = "";
  }
}

function renderAdmin(entries) {
  const list = $("adminList");
  list.textContent = "";
  if (entries.length === 0) {
    list.textContent = "No entries yet.";
    return;
  }

  const byUser = new Map();
  for (const e of entries) {
    if (!byUser.has(e.uid)) byUser.set(e.uid, { name: e.name, email: e.email, entries: [] });
    byUser.get(e.uid).entries.push(e);
  }

  const users = [...byUser.values()].sort((a, b) =>
    (a.name || a.email || "").localeCompare(b.name || b.email || ""));

  for (const user of users) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${user.name || "(no name)"} · ${user.email} · ${user.entries.length} entries`;
    details.appendChild(summary);

    for (const section of SECTIONS) {
      const mine = user.entries.filter(e => e.section === section.key).sort(byNewest);
      const h4 = document.createElement("h4");
      h4.textContent = section.title;
      details.appendChild(h4);

      if (mine.length === 0) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No entries.";
        details.appendChild(p);
        continue;
      }
      const ul = document.createElement("ul");
      ul.className = "logs";
      for (const e of mine) ul.appendChild(logItem(e, false));
      details.appendChild(ul);
    }
    list.appendChild(details);
  }
}

let pendingDeleteId = null;

function deleteEntry(id) {
  pendingDeleteId = id;
  $("confirmDialog").showModal();
}

$("keepEntry").addEventListener("click", () => {
  pendingDeleteId = null;
  $("confirmDialog").close();
});

$("confirmDelete").addEventListener("click", async () => {
  const id = pendingDeleteId;
  pendingDeleteId = null;
  $("confirmDialog").close();
  if (!id) return;
  try {
    await deleteDoc(doc(db, COLLECTION, id));
  } catch (err) {
    console.error("Delete failed:", err);
    alert("Could not delete this entry. Please try again.");
  }
});

// Escape or clicking outside the dialog also cancels the pending delete.
$("confirmDialog").addEventListener("close", () => { pendingDeleteId = null; });

// ---------- Sync with Firestore ----------
function startSync(user) {
  unsubOwn?.();
  unsubOwn = onSnapshot(
    query(collection(db, COLLECTION), where("uid", "==", user.uid)),
    snap => renderOwn(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

  unsubAdmin?.();
  unsubAdmin = null;
  const isAdmin = user.email === ADMIN_EMAIL;
  $("admin").hidden = !isAdmin;
  if (isAdmin) {
    unsubAdmin = onSnapshot(collection(db, COLLECTION), snap => {
      renderAdmin(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
}

function stopSync() {
  unsubOwn?.();
  unsubAdmin?.();
  unsubOwn = unsubAdmin = null;
  for (const section of SECTIONS) listFor[section.key].textContent = "";
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

buildSections();
