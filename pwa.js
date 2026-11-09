// Progressive Web App helpers: service worker + "Install" button.

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("Service worker registration failed:", err));
  });
}

// Android Chrome fires "beforeinstallprompt" when the app can be installed.
// We keep the event and show our own Install button.
export function setupInstallButton(button) {
  if (window.matchMedia("(display-mode: standalone)").matches) return; // already installed

  let deferred = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    button.hidden = false;
  });

  button.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    deferred = null;
    button.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    button.hidden = true;
  });
}
