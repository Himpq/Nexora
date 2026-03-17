with open('F:/Code/AI/ChatDB/NexoraCode/main.py', 'r', encoding='utf-8') as f:
    content = f.read()

ICON_SETTINGS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06 .06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.8 1 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'

c1 = '<div class="nc-btb-btns"><button class="nb" data-act="min"'
r1 = '<div class="nc-btb-btns"><button class="nb" data-act="settings" title="\\u8bbe\\u7f6e">' + ICON_SETTINGS + '</button><button class="nb" data-act="min"'

if c1 in content:
    content = content.replace(c1, r1)
    print("Replaced HTML")
else:
    print("HTML not found")

c2 = "if (act === 'min' && a.minimize_window) a.minimize_window();"
r2 = "if (act === 'settings' && a.open_settings) a.open_settings();\n            else if (act === 'min' && a.minimize_window) a.minimize_window();"

if c2 in content:
    content = content.replace(c2, r2)
    print("Replaced JS")
else:
    print("JS not found")

with open('F:/Code/AI/ChatDB/NexoraCode/main.py', 'w', encoding='utf-8') as f:
    f.write(content)
