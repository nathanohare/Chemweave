# The compound blocks SI Assistant writes for a project (compile/blocks.py), for the Chemweave
# parity test: per compound, its title's text and its paragraphs as runs.
import sys, json, shutil, tempfile
from pathlib import Path
sys.path.insert(0, '/home/user/chem-si-assistant')
from si_assistant.core.project import Project
from si_assistant.compile.blocks import compound_block
src = Path(sys.argv[1])
tmp = Path(tempfile.mkdtemp()) / 'p'
shutil.copytree(src, tmp)
p = Project.open(tmp, read_only=True)
rep = p.id_report()
def runs(rs): return [[r.text, r.bold, r.italic, r.valign, r.ref, r.underline] for r in rs]
out = {}
for c in p.all_compounds():
    b = compound_block(p, c, rep.display_id(c.id), True)
    out[c.id] = dict(title=''.join(r.text for r in b.title), paragraphs=[runs(x.runs) for x in b.paragraphs],
                     figures=[[f.path.name, f.caption] for f in b.figures], custom=b.custom_text)
print(json.dumps(out, ensure_ascii=False, indent=1))
