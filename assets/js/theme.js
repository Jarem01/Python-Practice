/** Light/dark toggle. The initial theme is applied by a tiny inline script in each page's <head>. */

const KEY = "pypractice:theme";

// Light is the default: it matches the study-guide look. Dark mode is one click
// away and remembered from then on.
function currentTheme() {
  const stored = document.documentElement.dataset.theme;
  return stored === "dark" ? "dark" : "light";
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the toggle still works for this page view */
  }
  const button = document.getElementById("theme-toggle");
  if (button) {
    button.textContent = theme === "dark" ? "☾" : "☀";
    button.title = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
    button.setAttribute("aria-label", button.title);
  }
}

const button = document.getElementById("theme-toggle");
if (button) {
  button.addEventListener("click", () => apply(currentTheme() === "dark" ? "light" : "dark"));
}
apply(document.documentElement.dataset.theme || currentTheme());
