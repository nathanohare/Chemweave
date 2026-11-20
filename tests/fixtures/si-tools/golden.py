import sys, json, shutil, tempfile
from pathlib import Path
sys.path.insert(0, '/home/user/chem-si-assistant')
from si_assistant.core.project import Project
from si_assistant.core import checks
src = Path(sys.argv[1])
tmp = Path(tempfile.mkdtemp()) / 'p'
shutil.copytree(src, tmp)
p = Project.open(tmp, read_only=True)
rep = p.id_report()
out = {}
for c in p.all_compounds():
    ws = checks.all_warnings(p, c, rep)
    out[c.id] = [dict(check=w.check, field=w.field, key=w.key, fp=w.fingerprint, legacy=w.legacy, message=w.message, dismissed=checks.is_dismissed(c, w)) for w in ws]
    try:
        r, prob = checks.compound_hrms(p, c)
        if r: out[c.id].append(dict(hrms=[r.monoisotopic.mz, r.ppm, r.matched.mz if r.matched else None, r.monoisotopic.formula]))
    except Exception as e: out[c.id].append(dict(err=str(e)))
print(json.dumps(out, ensure_ascii=False, indent=1))
