# Builds tests/fixtures/si-checks from si-example: each compound changed so that SI Assistant's
# checks have something to say (golden results made by SI Assistant itself, golden.py).
import json, shutil, sys
from pathlib import Path
from rdkit import Chem
from rdkit.Chem import AllChem
src, dst = Path(sys.argv[1]), Path(sys.argv[2])
if dst.exists(): shutil.rmtree(dst)
shutil.copytree(src, dst)
(dst / 'README.md').unlink(missing_ok=True)
sec = dst / 'sections' / 's-972b3c47_synthesis-and-charac' / 'compounds'
def comp(prefix):
    d = next(sec.glob(prefix + '*'))
    return d, json.loads((d / 'compound.json').read_text('utf-8'))
def save(d, data):
    (d / 'compound.json').write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', 'utf-8')
def nmr(data, nuc): return next(r for r in data['values']['nmr'] if r['nucleus'] == nuc)
# 2a: HRMS off, 1H integrations, 13C count, a large J
d, c = comp('c-26c39a99'); v = c['values']
v['hrms']['found'] = '145.0700'
h = nmr(c, '1H'); h['text'] = h['text'].replace('(m, 1H), 4.90', '(m, 2H), 4.90').replace('1.50 (d, J = 6.5 Hz', '1.50 (d, J = 26.5 Hz')
cc = nmr(c, '13C'); cc['text'] = cc['text'].replace('125.5, ', '')
save(d, c)
# 2b: yield, a missing 13C spectrum, an impurity singlet, 13C frequency
d, c = comp('c-cf3f4417'); v = c['values']
v['yield']['mass'] = '80.0'
v['spectra'] = [s for s in v['spectra'] if s['type'] != '13C']
h = nmr(c, '1H'); h['text'] = h['text'].replace('δ ', 'δ 7.26 (s, 1H), ', 1)
cc = nmr(c, '13C'); cc['text'] = cc['text'].replace('(126 MHz', '(150 MHz')
save(d, c)
# 2c: no 19F report text, a typed M formula that differs; a 19F spectrum without report
d, c = comp('c-e2e36085'); v = c['values']
nmr(c, '19F')['text'] = ''
v['hrms']['formula'] = 'C8H9ClO'
save(d, c)
# 2d: an adduct that can't be read; a decimal-comma found value elsewhere
d, c = comp('c-1eebe878'); v = c['values']
v['hrms']['adduct'] = '[M+Xx]+'
save(d, c)
# 2e: a salt (pyridinium triflate) given [M+H]+; automatic M is the cation
d, c = comp('c-ad564675'); v = c['values']
m = Chem.MolFromSmiles('c1cc[nH+]cc1.[O-]S(=O)(=O)C(F)(F)F'); AllChem.Compute2DCoords(m)
(d / 'structure.mol').write_text(Chem.MolToMolBlock(m), 'utf-8')
v['hrms']['adduct'] = '[M+H]+'
save(d, c)
# 2f: a deleted compound mentioned, a missing reference cited, a GP value missing, {scale} differs
d, c = comp('c-bfbaadc9'); v = c['values']
pv = v['procedure']['values']
del pv['mass']
pv['ketone'] = '2′-acetonaphthone (see @{c-deadbeef})'
pv['scale'] = '0.30 mmol'
v['references']['refs'] = v['references']['refs'] + ['r-missing1']
save(d, c)
