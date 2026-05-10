/* Tiny client-side router — toggles [hidden] on .screen sections.
   Screen IDs: home, recording, parsing, confirm, saved, stories, storyDetail, settings. */

(function () {
  const TAB_SCREENS = new Set(["home", "stories"]);

  let current = "home";
  const listeners = [];

  function $screen(name) {
    return document.querySelector(`.screen[data-screen="${name}"]`);
  }

  function show(name) {
    document.querySelectorAll(".screen").forEach((el) => {
      const isTarget = el.dataset.screen === name;
      if (isTarget) {
        el.hidden = false;
        // restart entry animation
        el.style.animation = "none";
        // force reflow
        void el.offsetWidth;
        el.style.animation = "";
      } else {
        el.hidden = true;
      }
    });

    current = name;
    updateTabs(name);
    listeners.forEach((fn) => {
      try { fn(name); } catch (e) { console.error(e); }
    });

    // scroll to top of app shell on screen change
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function updateTabs(name) {
    document.querySelectorAll(".tab").forEach((tab) => {
      const target = tab.dataset.tabTarget;
      const active = TAB_SCREENS.has(name) && target === name;
      tab.classList.toggle("is-active", active);
    });
  }

  function on(fn) { listeners.push(fn); }

  window.Router = { show, on, get current() { return current; } };
})();
