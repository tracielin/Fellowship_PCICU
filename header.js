// Shared header behavior for both pages.
// On phones (see the media query in each page's CSS), the email and Sign out button
// are replaced by a white circle with the user's initials. Tapping it opens a
// "Log out?" dialog.

export function updateHeaderUser(user) {
  const btn = document.getElementById("initials");
  btn.hidden = !user;
  btn.textContent = user ? initialsFor(user) : "";
  btn.setAttribute("aria-label", user ? `Signed in as ${user.email}. Log out?` : "");
}

export function initHeaderLogout(auth, signOut) {
  const dialog = document.getElementById("logoutDialog");
  document.getElementById("initials").addEventListener("click", () => dialog.showModal());
  document.getElementById("cancelLogout").addEventListener("click", () => dialog.close());
  document.getElementById("confirmLogout").addEventListener("click", () => {
    dialog.close();
    signOut(auth);
  });
}

function initialsFor(user) {
  const name = (user.displayName || "").trim();
  if (name) {
    const parts = name.split(/\s+/);
    const first = parts[0][0];
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }
  return (user.email || "?")[0].toUpperCase();
}
