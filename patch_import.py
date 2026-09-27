"""One-time patch: skip labels whose events aged out of the refresh window."""
import shutil

p = "labeling-kit/import_labels.py"
shutil.copy(p, p + ".bak")
s = open(p, encoding="utf-8").read()
old = "            cur.executemany(UPSERT, rows)"
new = (
    '            cur.execute("SELECT event_code FROM thermal_events")\n'
    "            existing = {r[0] for r in cur.fetchall()}\n"
    "            skipped = [r for r in rows if r[0] not in existing]\n"
    "            rows = [r for r in rows if r[0] in existing]\n"
    "            if skipped:\n"
    '                print(f"WARNING: {len(skipped)} labels skipped - "\n'
    '                      "events aged out of the refresh window:")\n'
    "                for _code, _lab, _who, _ in skipped:\n"
    '                    print(f"  - {_code} ({_who}: {_lab})")\n'
    "            cur.executemany(UPSERT, rows)"
)
assert s.count(old) == 1, "pattern not found - patch not applied"
open(p, "w", encoding="utf-8").write(s.replace(old, new))
print("patched OK (backup at labeling-kit/import_labels.py.bak)")
