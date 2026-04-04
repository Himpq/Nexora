import os
import json

config = None

CONFIG_DIR = "./config"
SSL_DIR = "./config/ssl"
CONFIG_FILE = "./config/config.json"
ERROR_TEMPLATE_FILE = "./config/error.txt"
LOCAL_MX_FILE = "./config/localMX.json"


def _default_config():
    return {
        "smtp_services": {
            "settings": {
                "capabilities": [
                    "PIPELINING",
                    "SIZE 73400320",
                    "STARTTLS",
                    "AUTH LOGIN PLAIN",
                    "AUTH=LOGIN",
                    "SMTPUTF8",
                    "8BITMIME",
                ],
                "timeout": 5,
                "io_timeout": 60,
                "max_message_size": 50,
                "max_recipients": 5,
                "direct_ports": [25],
            },
            "services": {
                "25": {"bind_ip": "0.0.0.0", "ssl": False, "user_group": "default"},
                "465": {"bind_ip": "0.0.0.0", "ssl": True, "user_group": "default"},
            },
            "mail_relay": {
                "enable": False,
                "relay_host": "",
                "relay_port": 25,
                "relay_username": "",
                "relay_password": "",
                "ssl": False,
                "use_relay_username_as_sender": True,
            },
            "smtp_whitelist": {"mode": "disable", "whitelist": [], "blacklist": []},
        },
        "pop3_services": {
            "services": {
                "110": {"bind_ip": "0.0.0.0", "ssl": False, "user_group": "default"},
                "995": {"bind_ip": "0.0.0.0", "ssl": True, "user_group": "default"},
            },
            "settings": {
                "max_speed": 1,
                "idle_timeout": 300,
                "handshake_timeout": 10,
                "max_connections": 512,
            },
        },
        "user_groups": {
            "default": {
                "error_path": ERROR_TEMPLATE_FILE,
                "ssl_cert": {
                    "cert": "./config/ssl/cert.pem",
                    "key": "./config/ssl/key.pem",
                    "ca": "./config/ssl/ca.pem",
                },
            }
        },
        "wmailserver_settings": {
            "temp_path": os.path.join(".", "temp"),
            "ip_max_pwd_try": 5,
            "ip_block_seconds": 3600,
            "max_cmd_error": 5,
            "cmd_block_seconds": 60,
        },
        "api_server": {
            "enabled": True,
            "listen": {"host": "127.0.0.1", "port": 17171},
            "auth": {"api_key": ""},
            "security": {"local_only_when_no_api_key": True},
        },
        "integrations": {
            "nexora": {
                "enabled": False,
                "base_url": "http://127.0.0.1:5000",
                "api_key": "",
                "timeout": 10,
            }
        },
    }


def _default_error_template():
    return """Date: $TIME
From: <$MAIL_FROM>
To: <$MAIL_TO>
Message-ID: <$ERROR_MAIL_ID@$USERGROUP_DOMAIN>
Subject: $TITLE
MIME-Version: 1.0
Content-Type: text/html; charset="UTF-8"

<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px; background-color: #f9f9f9;">
    <h2 style="color: #d32f2f; margin-bottom: 20px;">Mail Delivery Failed</h2>
    <div style="background: #fff; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
        <p style="color: #333; line-height: 1.5;">We were unable to deliver your message to:</p>
        <p style="color: #666; margin: 10px 0; padding: 10px; background: #f5f5f5; border-left: 4px solid #d32f2f;">
            <strong>$RECIPIENT</strong>
        </p>
    </div>
    <div style="color: #666; line-height: 1.6;">
        <p>The recipient's email address was not found on this server.</p>
        <p>Please check the recipient's email address and try again.</p>
    </div>
</div>"""


def _default_local_mx():
    return {
        "163.com": {"smtp": "smtp.163.com", "ports": [25, 465]},
        "126.com": {"smtp": "smtp.126.com", "ports": [25]},
        "139.com": {"smtp": "smtp.139.com", "ports": [25]},
        "qq.com": {"smtp": "smtp.qq.com", "ports": [25, 465, 587]},
        "gmail.com": {"smtp": "smtp.gmail.com", "ports": [587, 465]},
        "sina.com": {"smtp": "smtp.sina.com", "ports": [25]},
        "sohu.com": {"smtp": "smtp.sohu.com", "ports": [25]},
        "yahoo.com": {"smtp": "smtp.mail.yahoo.cn", "ports": [25, 465]},
        "hotmail.com": {"smtp": "smtp.live.com", "ports": [25]},
        "263.net": {"smtp": "smtp.263.net", "ports": [25]},
    }


def _merge_defaults(dst, src):
    changed = False
    for key, val in src.items():
        if key not in dst:
            dst[key] = val
            changed = True
        elif isinstance(val, dict) and isinstance(dst.get(key), dict):
            if _merge_defaults(dst[key], val):
                changed = True
    return changed


def _normalize_legacy_keys(cfg):
    changed = False

    top_map = {
        "SMTPServices": "smtp_services",
        "POP3Services": "pop3_services",
        "UserGroups": "user_groups",
        "wMailServerSettings": "wmailserver_settings",
        "APIServer": "api_server",
        "Integrations": "integrations",
    }
    for old, new in top_map.items():
        if old in cfg and new not in cfg:
            cfg[new] = cfg[old]
            changed = True

    smtp = cfg.setdefault("smtp_services", {})
    pop3 = cfg.setdefault("pop3_services", {})
    user_groups = cfg.setdefault("user_groups", {})
    wset = cfg.setdefault("wmailserver_settings", {})
    api = cfg.setdefault("api_server", {})
    integrations = cfg.setdefault("integrations", {})

    if isinstance(smtp, dict):
        if "MailRelay" in smtp and "mail_relay" not in smtp:
            smtp["mail_relay"] = smtp["MailRelay"]
            changed = True
        if "SMTPWhiteList" in smtp and "smtp_whitelist" not in smtp:
            smtp["smtp_whitelist"] = smtp["SMTPWhiteList"]
            changed = True
        settings = smtp.setdefault("settings", {})
        if isinstance(settings, dict):
            if "ioTimeout" in settings and "io_timeout" not in settings:
                settings["io_timeout"] = settings["ioTimeout"]
                changed = True
            if "maxMessageSize" in settings and "max_message_size" not in settings:
                settings["max_message_size"] = settings["maxMessageSize"]
                changed = True
            if "maxRecipients" in settings and "max_recipients" not in settings:
                settings["max_recipients"] = settings["maxRecipients"]
                changed = True
            if "directPorts" in settings and "direct_ports" not in settings:
                settings["direct_ports"] = settings["directPorts"]
                changed = True
        relay = smtp.setdefault("mail_relay", {})
        if isinstance(relay, dict):
            relay_map = {
                "relayHost": "relay_host",
                "relayPort": "relay_port",
                "relayUsername": "relay_username",
                "relayPassword": "relay_password",
                "useRelayUsernameAsSender": "use_relay_username_as_sender",
            }
            for old, new in relay_map.items():
                if old in relay and new not in relay:
                    relay[new] = relay[old]
                    changed = True
        services = smtp.get("services", {})
        if isinstance(services, dict):
            for _, svc in services.items():
                if not isinstance(svc, dict):
                    continue
                if "bindIP" in svc and "bind_ip" not in svc:
                    svc["bind_ip"] = svc["bindIP"]
                    changed = True
                if "userGroup" in svc and "user_group" not in svc:
                    svc["user_group"] = svc["userGroup"]
                    changed = True

    if isinstance(pop3, dict):
        settings = pop3.setdefault("settings", {})
        if isinstance(settings, dict):
            if "maxSpeed" in settings and "max_speed" not in settings:
                settings["max_speed"] = settings["maxSpeed"]
                changed = True
            if "idleTimeout" in settings and "idle_timeout" not in settings:
                settings["idle_timeout"] = settings["idleTimeout"]
                changed = True
            if "handshakeTimeout" in settings and "handshake_timeout" not in settings:
                settings["handshake_timeout"] = settings["handshakeTimeout"]
                changed = True
            if "maxConnections" in settings and "max_connections" not in settings:
                settings["max_connections"] = settings["maxConnections"]
                changed = True
        services = pop3.get("services", {})
        if isinstance(services, dict):
            for _, svc in services.items():
                if not isinstance(svc, dict):
                    continue
                if "bindIP" in svc and "bind_ip" not in svc:
                    svc["bind_ip"] = svc["bindIP"]
                    changed = True
                if "userGroup" in svc and "user_group" not in svc:
                    svc["user_group"] = svc["userGroup"]
                    changed = True

    if isinstance(user_groups, dict):
        for _, group_cfg in user_groups.items():
            if not isinstance(group_cfg, dict):
                continue
            if "errorPath" in group_cfg and "error_path" not in group_cfg:
                group_cfg["error_path"] = group_cfg["errorPath"]
                changed = True
            if "sslCert" in group_cfg and "ssl_cert" not in group_cfg:
                group_cfg["ssl_cert"] = group_cfg["sslCert"]
                changed = True

    if isinstance(wset, dict):
        wmap = {
            "tempPath": "temp_path",
            "ipMaxPwdTry": "ip_max_pwd_try",
            "ipBlockSeconds": "ip_block_seconds",
            "maxCmdError": "max_cmd_error",
            "cmdBlockSeconds": "cmd_block_seconds",
        }
        for old, new in wmap.items():
            if old in wset and new not in wset:
                wset[new] = wset[old]
                changed = True

    if isinstance(api, dict):
        if "listen" not in api:
            api["listen"] = {}
            changed = True
        if "auth" not in api:
            api["auth"] = {}
            changed = True
        if "security" not in api:
            api["security"] = {}
            changed = True
        listen = api["listen"] if isinstance(api["listen"], dict) else {}
        auth = api["auth"] if isinstance(api["auth"], dict) else {}
        security = api["security"] if isinstance(api["security"], dict) else {}
        if not isinstance(api["listen"], dict):
            api["listen"] = listen
            changed = True
        if not isinstance(api["auth"], dict):
            api["auth"] = auth
            changed = True
        if not isinstance(api["security"], dict):
            api["security"] = security
            changed = True
        if "host" in api and "host" not in listen:
            listen["host"] = api["host"]
            changed = True
        if "port" in api and "port" not in listen:
            listen["port"] = api["port"]
            changed = True
        if "token" in api and "api_key" not in auth:
            auth["api_key"] = api["token"]
            changed = True
        if "api_key" in api and "api_key" not in auth:
            auth["api_key"] = api["api_key"]
            changed = True
        if "localOnlyWhenNoApiKey" in security and "local_only_when_no_api_key" not in security:
            security["local_only_when_no_api_key"] = security["localOnlyWhenNoApiKey"]
            changed = True

    if isinstance(integrations, dict):
        if "Nexora" in integrations and "nexora" not in integrations:
            integrations["nexora"] = integrations["Nexora"]
            changed = True

    return changed


def _inject_runtime_aliases(cfg):
    # top-level
    cfg["SMTPServices"] = cfg.get("smtp_services", {})
    cfg["POP3Services"] = cfg.get("pop3_services", {})
    cfg["UserGroups"] = cfg.get("user_groups", {})
    cfg["wMailServerSettings"] = cfg.get("wmailserver_settings", {})
    cfg["APIServer"] = cfg.get("api_server", {})
    cfg["Integrations"] = cfg.get("integrations", {})

    smtp = cfg.get("smtp_services", {})
    if isinstance(smtp, dict):
        smtp["MailRelay"] = smtp.get("mail_relay", {})
        smtp["SMTPWhiteList"] = smtp.get("smtp_whitelist", {})
        settings = smtp.get("settings", {})
        if isinstance(settings, dict):
            settings["ioTimeout"] = settings.get("io_timeout", settings.get("ioTimeout", 60))
            settings["maxMessageSize"] = settings.get("max_message_size", settings.get("maxMessageSize", 50))
            settings["maxRecipients"] = settings.get("max_recipients", settings.get("maxRecipients", 5))
            settings["directPorts"] = settings.get("direct_ports", settings.get("directPorts", [25]))
        relay = smtp.get("mail_relay", {})
        if isinstance(relay, dict):
            relay["relayHost"] = relay.get("relay_host", relay.get("relayHost", ""))
            relay["relayPort"] = relay.get("relay_port", relay.get("relayPort", 25))
            relay["relayUsername"] = relay.get("relay_username", relay.get("relayUsername", ""))
            relay["relayPassword"] = relay.get("relay_password", relay.get("relayPassword", ""))
            relay["useRelayUsernameAsSender"] = relay.get(
                "use_relay_username_as_sender", relay.get("useRelayUsernameAsSender", True)
            )
        services = smtp.get("services", {})
        if isinstance(services, dict):
            for _, svc in services.items():
                if isinstance(svc, dict):
                    svc["bindIP"] = svc.get("bind_ip", svc.get("bindIP", "0.0.0.0"))
                    svc["userGroup"] = svc.get("user_group", svc.get("userGroup", "default"))

    pop3 = cfg.get("pop3_services", {})
    if isinstance(pop3, dict):
        settings = pop3.get("settings", {})
        if isinstance(settings, dict):
            settings["maxSpeed"] = settings.get("max_speed", settings.get("maxSpeed", 1))
            settings["idleTimeout"] = settings.get("idle_timeout", settings.get("idleTimeout", 300))
            settings["handshakeTimeout"] = settings.get("handshake_timeout", settings.get("handshakeTimeout", 10))
            settings["maxConnections"] = settings.get("max_connections", settings.get("maxConnections", 512))
        services = pop3.get("services", {})
        if isinstance(services, dict):
            for _, svc in services.items():
                if isinstance(svc, dict):
                    svc["bindIP"] = svc.get("bind_ip", svc.get("bindIP", "0.0.0.0"))
                    svc["userGroup"] = svc.get("user_group", svc.get("userGroup", "default"))

    groups = cfg.get("user_groups", {})
    if isinstance(groups, dict):
        for _, g in groups.items():
            if isinstance(g, dict):
                g["errorPath"] = g.get("error_path", g.get("errorPath", ERROR_TEMPLATE_FILE))
                g["sslCert"] = g.get("ssl_cert", g.get("sslCert", {}))

    ws = cfg.get("wmailserver_settings", {})
    if isinstance(ws, dict):
        ws["tempPath"] = ws.get("temp_path", ws.get("tempPath", os.path.join(".", "temp")))
        ws["ipMaxPwdTry"] = ws.get("ip_max_pwd_try", ws.get("ipMaxPwdTry", 5))
        ws["ipBlockSeconds"] = ws.get("ip_block_seconds", ws.get("ipBlockSeconds", 3600))
        ws["maxCmdError"] = ws.get("max_cmd_error", ws.get("maxCmdError", 5))
        ws["cmdBlockSeconds"] = ws.get("cmd_block_seconds", ws.get("cmdBlockSeconds", 60))

    api = cfg.get("api_server", {})
    if isinstance(api, dict):
        listen = api.get("listen", {}) if isinstance(api.get("listen"), dict) else {}
        auth = api.get("auth", {}) if isinstance(api.get("auth"), dict) else {}
        security = api.get("security", {}) if isinstance(api.get("security"), dict) else {}
        api["host"] = listen.get("host", api.get("host", "127.0.0.1"))
        api["port"] = listen.get("port", api.get("port", 17171))
        api["token"] = auth.get("api_key", api.get("token", ""))
        api["api_key"] = auth.get("api_key", api.get("api_key", ""))
        security["localOnlyWhenNoApiKey"] = security.get(
            "local_only_when_no_api_key", security.get("localOnlyWhenNoApiKey", True)
        )
        api["listen"] = listen
        api["auth"] = auth
        api["security"] = security

    ints = cfg.get("integrations", {})
    if isinstance(ints, dict):
        ints["Nexora"] = ints.get("nexora", ints.get("Nexora", {}))


def _sync_alias_back_to_canonical(cfg):
    # Ensure if runtime code changed legacy aliases, canonical values are updated before save.
    _normalize_legacy_keys(cfg)
    smtp = cfg.get("smtp_services", {})
    if isinstance(smtp, dict):
        if "MailRelay" in smtp:
            smtp["mail_relay"] = smtp["MailRelay"]
        if "SMTPWhiteList" in smtp:
            smtp["smtp_whitelist"] = smtp["SMTPWhiteList"]
        settings = smtp.get("settings", {})
        if isinstance(settings, dict):
            if "ioTimeout" in settings:
                settings["io_timeout"] = settings["ioTimeout"]
            if "maxMessageSize" in settings:
                settings["max_message_size"] = settings["maxMessageSize"]
            if "maxRecipients" in settings:
                settings["max_recipients"] = settings["maxRecipients"]
            if "directPorts" in settings:
                settings["direct_ports"] = settings["directPorts"]
        services = smtp.get("services", {})
        if isinstance(services, dict):
            for _, svc in services.items():
                if isinstance(svc, dict):
                    if "bindIP" in svc:
                        svc["bind_ip"] = svc["bindIP"]
                    if "userGroup" in svc:
                        svc["user_group"] = svc["userGroup"]

    pop3 = cfg.get("pop3_services", {})
    if isinstance(pop3, dict):
        settings = pop3.get("settings", {})
        if isinstance(settings, dict):
            if "maxSpeed" in settings:
                settings["max_speed"] = settings["maxSpeed"]
            if "idleTimeout" in settings:
                settings["idle_timeout"] = settings["idleTimeout"]
            if "handshakeTimeout" in settings:
                settings["handshake_timeout"] = settings["handshakeTimeout"]
            if "maxConnections" in settings:
                settings["max_connections"] = settings["maxConnections"]
        services = pop3.get("services", {})
        if isinstance(services, dict):
            for _, svc in services.items():
                if isinstance(svc, dict):
                    if "bindIP" in svc:
                        svc["bind_ip"] = svc["bindIP"]
                    if "userGroup" in svc:
                        svc["user_group"] = svc["userGroup"]

    groups = cfg.get("user_groups", {})
    if isinstance(groups, dict):
        for _, g in groups.items():
            if isinstance(g, dict):
                if "errorPath" in g:
                    g["error_path"] = g["errorPath"]
                if "sslCert" in g:
                    g["ssl_cert"] = g["sslCert"]

    ws = cfg.get("wmailserver_settings", {})
    if isinstance(ws, dict):
        if "tempPath" in ws:
            ws["temp_path"] = ws["tempPath"]
        if "ipMaxPwdTry" in ws:
            ws["ip_max_pwd_try"] = ws["ipMaxPwdTry"]
        if "ipBlockSeconds" in ws:
            ws["ip_block_seconds"] = ws["ipBlockSeconds"]
        if "maxCmdError" in ws:
            ws["max_cmd_error"] = ws["maxCmdError"]
        if "cmdBlockSeconds" in ws:
            ws["cmd_block_seconds"] = ws["cmdBlockSeconds"]

    api = cfg.get("api_server", {})
    if isinstance(api, dict):
        listen = api.get("listen", {}) if isinstance(api.get("listen"), dict) else {}
        auth = api.get("auth", {}) if isinstance(api.get("auth"), dict) else {}
        security = api.get("security", {}) if isinstance(api.get("security"), dict) else {}
        if "host" in api:
            listen["host"] = api["host"]
        if "port" in api:
            listen["port"] = api["port"]
        if "token" in api:
            auth["api_key"] = api["token"]
        if "api_key" in api and not auth.get("api_key"):
            auth["api_key"] = api["api_key"]
        if "localOnlyWhenNoApiKey" in security:
            security["local_only_when_no_api_key"] = security["localOnlyWhenNoApiKey"]
        api["listen"] = listen
        api["auth"] = auth
        api["security"] = security

    ints = cfg.get("integrations", {})
    if isinstance(ints, dict):
        if "Nexora" in ints:
            ints["nexora"] = ints["Nexora"]


def _build_canonical_for_save(cfg):
    out = json.loads(json.dumps(cfg, ensure_ascii=False))
    _sync_alias_back_to_canonical(out)
    _normalize_legacy_keys(out)

    # Remove legacy top-level aliases
    for k in ["SMTPServices", "POP3Services", "UserGroups", "wMailServerSettings", "APIServer", "Integrations"]:
        out.pop(k, None)

    # Remove legacy nested aliases
    smtp = out.get("smtp_services", {})
    if isinstance(smtp, dict):
        smtp.pop("MailRelay", None)
        smtp.pop("SMTPWhiteList", None)
        settings = smtp.get("settings", {})
        if isinstance(settings, dict):
            for k in ["ioTimeout", "maxMessageSize", "maxRecipients", "directPorts"]:
                settings.pop(k, None)
        relay = smtp.get("mail_relay", {})
        if isinstance(relay, dict):
            for k in ["relayHost", "relayPort", "relayUsername", "relayPassword", "useRelayUsernameAsSender"]:
                relay.pop(k, None)
        services = smtp.get("services", {})
        if isinstance(services, dict):
            for _, svc in services.items():
                if isinstance(svc, dict):
                    svc.pop("bindIP", None)
                    svc.pop("userGroup", None)

    pop3 = out.get("pop3_services", {})
    if isinstance(pop3, dict):
        settings = pop3.get("settings", {})
        if isinstance(settings, dict):
            for k in ["maxSpeed", "idleTimeout", "handshakeTimeout", "maxConnections"]:
                settings.pop(k, None)
        services = pop3.get("services", {})
        if isinstance(services, dict):
            for _, svc in services.items():
                if isinstance(svc, dict):
                    svc.pop("bindIP", None)
                    svc.pop("userGroup", None)

    groups = out.get("user_groups", {})
    if isinstance(groups, dict):
        for _, g in groups.items():
            if isinstance(g, dict):
                g.pop("errorPath", None)
                g.pop("sslCert", None)

    ws = out.get("wmailserver_settings", {})
    if isinstance(ws, dict):
        for k in ["tempPath", "ipMaxPwdTry", "ipBlockSeconds", "maxCmdError", "cmdBlockSeconds"]:
            ws.pop(k, None)

    api = out.get("api_server", {})
    if isinstance(api, dict):
        for k in ["host", "port", "token", "api_key"]:
            api.pop(k, None)
        security = api.get("security", {})
        if isinstance(security, dict):
            security.pop("localOnlyWhenNoApiKey", None)

    ints = out.get("integrations", {})
    if isinstance(ints, dict):
        ints.pop("Nexora", None)

    return out


def checkConf():
    if not os.path.exists(CONFIG_DIR):
        os.makedirs(CONFIG_DIR, exist_ok=True)
    if not os.path.exists(SSL_DIR):
        os.makedirs(SSL_DIR, exist_ok=True)

    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(_default_config(), f, indent=4, ensure_ascii=False)

    if not os.path.exists(ERROR_TEMPLATE_FILE):
        with open(ERROR_TEMPLATE_FILE, "w", encoding="utf-8") as f:
            f.write(_default_error_template())

    if not os.path.exists(LOCAL_MX_FILE):
        with open(LOCAL_MX_FILE, "w", encoding="utf-8") as f:
            json.dump(_default_local_mx(), f, indent=2, ensure_ascii=False)


def init():
    global config
    checkConf()
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    if not isinstance(loaded, dict):
        loaded = {}

    changed = False
    if _normalize_legacy_keys(loaded):
        changed = True
    if _merge_defaults(loaded, _default_config()):
        changed = True

    config = loaded
    _inject_runtime_aliases(config)

    if changed:
        save()


def get(key, default=None):
    global config
    if not config:
        init()
    return config.get(key, default)


def save():
    global config
    if config is None:
        return
    canonical = _build_canonical_for_save(config)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(canonical, f, indent=4, ensure_ascii=False)
    config = canonical
    _inject_runtime_aliases(config)


def ensureDefaults(defaults: dict):
    global config
    if not config:
        init()
    _sync_alias_back_to_canonical(config)
    updated = _merge_defaults(config, defaults)
    if updated:
        save()
    return updated

