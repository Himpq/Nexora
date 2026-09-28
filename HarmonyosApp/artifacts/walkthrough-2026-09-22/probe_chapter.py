import json, sys, urllib.request
base = 'http://127.0.0.1:5001'
lec, book, ch = sys.argv[1], sys.argv[2], sys.argv[3]
req = urllib.request.Request(f'{base}/api/lectures/{lec}/books/{book}/chapter/{ch}?paragraphs=true', headers={'X-Nexora-Username': 'ots20oug'})
d = json.load(urllib.request.urlopen(req, timeout=30))
print({k: d[k] for k in d if k not in ('paragraphs', 'content')})
ps = d.get('paragraphs', [])
print('paragraph count', len(ps))
for p in ps[:24]:
    t = p.get('text', '')
    print(p.get('index'), p.get('kind'), p.get('heading_level'), repr(t[:80]))
content = d.get('content', '')
print('content head:', repr(content[:300]))
