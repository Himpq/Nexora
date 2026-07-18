(function () {
  "use strict";

  const chunkPaths = [
    "app_modules/00_core_state.js",
    "app_modules/01_learning_path.js",
    "app_modules/02_reader_dashboard.js",
    "app_modules/03_feed_profile.js",
    "app_modules/02_question_exam.js",
    "app_modules/03_feed_composer.js",
    "app_modules/04_settings.js",
    "app_modules/04_cognition_twin.js",
    "app_modules/05_materials.js",
    "app_modules/06_reader_core.js",
    "app_modules/07_reader_floating.js",
    "app_modules/08_actions.js",
    "app_modules/09_events_init.js"
  ];

  const appScriptUrl = resolveAppScriptUrl();

  function resolveAppScriptUrl() {
    const currentScript = document.currentScript || findCurrentScript();
    return currentScript && currentScript.src
      ? new URL(currentScript.src, window.location.href)
      : new URL("/api/frontend/assets/app.js", window.location.href);
  }

  function resolveChunkUrl(path) {
    const baseUrl = appScriptUrl;
    const chunkUrl = new URL(path, baseUrl);

    if (baseUrl.search) {
      chunkUrl.search = baseUrl.search;
    }

    return chunkUrl.href;
  }

  function findCurrentScript() {
    const scripts = Array.from(document.getElementsByTagName("script"));

    for (let index = scripts.length - 1; index >= 0; index -= 1) {
      const script = scripts[index];
      const src = String(script && script.src || "");

      if (src.includes("/app.js")) {
        return script;
      }
    }

    return null;
  }

  async function loadChunkSource(path) {
    const url = resolveChunkUrl(path);
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "default"
    });

    if (!response.ok) {
      throw new Error(`Failed to load NexoraLearning app chunk: ${path} (${response.status})`);
    }

    return `${await response.text()}
//# sourceURL=${url}`;
  }

  async function bootApp() {
    const sources = await Promise.all(chunkPaths.map(loadChunkSource));
    const source = sources.join("\n");
    const runApp = new Function(source);
    runApp();
  }

  bootApp().catch((error) => {
    console.error("[NexoraLearning] app modules load failed", error);
    throw error;
  });
})();
