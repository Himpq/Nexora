# NexoraCode local plugins

NexoraCode loads trusted local plugins from `<app root>/plugins/<plugin-id>/`. In a source checkout, `<app root>` is the `NexoraCode/` directory. In a packaged build, it is the directory beside the executable. Plugin data is stored separately under `<app root>/data/plugins/`.

Install a plugin by copying its directory into `plugins/`, open **Settings → Plugins**, enable it, and restart NexoraCode. The first plugin API version is `1`.

## Package layout

```text
plugins/example-plugin/
  manifest.json
  __init__.py
  plugin.py
  tools.py
  ui/
    index.html
    panel.js
    panel.css
```

Example manifest:

```json
{
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "api_version": 1,
  "description": "An example local plugin",
  "entrypoint": "plugin.py:register",
  "enabled_by_default": false,
  "capabilities": ["network"],
  "surfaces": ["local"],
  "settings": {
    "title": "Example settings",
    "type": "object",
    "properties": {
      "service_url": {
        "type": "string",
        "title": "Service URL",
        "default": "http://127.0.0.1:5001"
      },
      "api_key": {
        "type": "string",
        "title": "API key",
        "secret": true
      }
    },
    "required": ["service_url"]
  },
  "ui": {
    "pages": [
      {"id": "home", "title": "Example", "entry": "ui/index.html"}
    ],
    "scripts": ["ui/panel.js"],
    "styles": ["ui/panel.css"]
  }
}
```

## Python contributions

The entry point exports `register(api)`. It can register `LocalTool` instances, additional pages, settings schema, and plugin-scoped HTTP routes:

```python
from local import LocalTool


class ExampleTool(LocalTool):
    name = "example_plugin_lookup"
    description = "Look up an item in Example Service."
    permission_operation = "network"
    parameters = {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    }

    def __init__(self, api):
        self.api = api

    def run(self, args, context):
        settings = self.api.get_settings()["values"]
        # Call the configured service and return a JSON-compatible result.
        return {"success": True, "query": args["query"], "service": settings["service_url"]}


def register(api):
    api.register_tool(ExampleTool(api))
    api.register_route("/status", lambda: {"success": True})
```

Plugin routes are mounted at `/api/plugins/<plugin-id>/...`. Tool names should use a plugin prefix to avoid collisions. Supported permission operations are `read`, `write`, `command`, and `network`. A plugin using `network` or `command` must declare that capability in its manifest. Remote Agent tool exposure must be declared with `surfaces: ["remote"]`; only plugin tools marked `read` are exposed remotely because the remote execution path cannot show local confirmation cards. Other plugin tools are not exposed remotely and remain available locally only when `local` is also declared.

## UI contributions

Pages declared in `ui.pages` appear in the chat sidebar and open in an embedded plugin page frame. Plugin JS modules are ES modules; they may export `register(api)` and use the page and mount APIs:

```javascript
export function register(api) {
    api.mount("chat.sidebar.footer", ({ host }) => {
        const button = document.createElement("button");
        button.textContent = "Example";
        button.addEventListener("click", () => api.openPage("home"));
        return button;
    });
}
```

Available mount slots are `chat.sidebar.toolbar`, `chat.sidebar.footer`, and `chat.main`. Plugin assets must live under `ui/`; the host serves only those files. A plugin can also render its own complete page in `ui/` and load local or remote service content there.

## Settings

The host renders string, password/secret, boolean, number, integer, and enum fields from the plugin settings schema. Values are stored in `data/plugins/<plugin-id>/settings.json`; secret values are not returned by the settings API. Settings endpoints are:

- `GET /api/local/plugins/<plugin-id>/settings`
- `PUT /api/local/plugins/<plugin-id>/settings` with `{"settings": {...}}`
- `GET /api/local/plugins` for installed plugin status
- `GET /api/local/plugins/ui` for active UI contributions

Enable/disable state is stored in `data/plugins/registry.json`. Changing it takes effect after restarting NexoraCode.

## NexoraLearning example

`plugins/nexoralearning/` is a working local bridge plugin. It embeds the NexoraLearning frontend and registers `nexoralearning_list_lectures`, which queries the service's `/api/lectures` endpoint. Start `NexoraLearning/main.py` separately, then configure its URL and username in NexoraCode settings. The plugin exposes its tool to the local Agent only.

## Trust and runtime

Python plugins run in the NexoraCode process with the current user's permissions. Plugin UI scripts run in the NexoraCode local web origin. Enable only plugin code you trust. Plugin settings currently use the same local file storage model as other NexoraCode configuration; the UI masks secret fields but does not encrypt their files. Plugin changes load at process startup, so enabling or disabling a plugin requires a restart.
