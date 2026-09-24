#!/usr/bin/env python3
"""Strip personal data from a saved AASTMT portal page so it can be used as a test fixture.

Usage: tools/sanitize-portal-page.py <saved.html> <out.html>

Removes: the student header (name, registration number, GPA, faculty, ...), every
UC_Student1 hidden field, and the ASP.NET state blobs (__VIEWSTATE, __EVENTVALIDATION,
__PREVIOUSPAGE), which can encode the same data. Exits non-zero if any known personal
value is still present afterwards.
"""
import re
import sys

src, out = sys.argv[1], sys.argv[2]
html = open(src, encoding="utf-8", errors="replace").read()

# Values to verify are gone afterwards (read before redacting).
secrets = []
for field in ("lbl_regnum", "lbl_name", "lbl_GPA", "lbl_totalachive"):
    m = re.search(rf'id="ctl00_UC_Student1_{field}"[^>]*>([^<]*)<', html)
    if m and m.group(1).strip():
        secrets.append(m.group(1).strip())

# Visible header labels -> REDACTED (keep the semester line).
html = re.sub(
    r'(<span[^>]*id="ctl00_UC_Student1_lbl_(?!semester)[^"]*"[^>]*>)[^<]*(</span>)',
    r"\1REDACTED\2",
    html,
)
# Hidden student fields and ASP.NET state blobs -> empty values.
html = re.sub(r'(<input[^>]*name="ctl00\$UC_Student1\$[^"]*"[^>]*?value=")[^"]*(")', r"\1\2", html)
html = re.sub(r'(<input[^>]*name="(?:__VIEWSTATE|__EVENTVALIDATION|__PREVIOUSPAGE)"[^>]*?value=")[^"]*(")', r"\1\2", html)
# Any other stray copy of a secret value.
for s in secrets:
    html = html.replace(s, "REDACTED")

leaks = [s for s in secrets if s in html]
if leaks or not secrets:
    sys.exit(f"sanitize failed: leaks={leaks} secrets_found={len(secrets)}")
open(out, "w", encoding="utf-8").write(html)
print(f"{out}: redacted {len(secrets)} personal values")
