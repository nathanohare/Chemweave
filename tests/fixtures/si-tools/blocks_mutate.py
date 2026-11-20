# Builds tests/fixtures/si-blocks from si-example: compounds given every kind of data the
# compiled SI writes a sentence for (golden text made by SI Assistant itself, blocks_golden.py).
import json, shutil, sys
from pathlib import Path
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
def add(c, key, value, custom=None):
    e = {'key': key}
    if custom: e['custom'] = custom
    c['fields'].insert(len(c['fields']) - 1, e)
    c['values'][key] = value
def nmr(data, nuc): return next(r for r in data['values']['nmr'] if r['nucleus'] == nuc)
# 2a: every data field, a labelled NMR report and one written without its header
d, c = comp('c-26c39a99'); v = c['values']
v['rf']['visualization'] = 'UV, KMnO4'
nmr(c, '1H')['label'] = 'major rotamer'
v['nmr'].append({'id': 'r-x19f', 'nucleus': '19F', 'label': 'minor', 'text': 'δ -115.5 (s), 7.36-7.29 ppm'})
add(c, 'mp', {'value': '45-47', 'solvent': 'CH2Cl2/hexanes'})
add(c, 'ir', {'bands': '3350, 2970, 1450', 'method': 'ATR'})
add(c, 'rotation', {'value': '+42.1', 'temperature': '20', 'c': '1.00', 'solvent': 'CHCl3'})
add(c, 'ee', {'value': '99%', 'method': 'HPLC', 'column': 'Chiralpak ID', 'eluent': '10% iPrOH/hexanes', 'flow': '1.0', 'wavelength': '254', 't_major': '12.3', 't_minor': '14.8'})
add(c, 'dr', {'value': '>20:1', 'method': '1H NMR of the crude mixture'})
add(c, 'ea', {'calcd': 'C, 78.65; H, 8.25', 'found': 'C, 78.60; H, 8.31', 'formula': ''})
add(c, 'xray', {'ccdc': '2345678'})
add(c, 'cf-solvent', {'text': 'dried over Na2SO4'}, {'label': 'Storage', 'type': 'short_text'})
add(c, 'cf-temp', {'value': '-20', 'unit': '°C'}, {'label': 'Kept at', 'type': 'number_unit'})
save(d, c)
# 2b: the user's own SI text in place of the generated text
d, c = comp('c-cf3f4417')
add(c, 'si_text', None, {'label': 'SI text', 'type': 'long_text'})
(d / 'si_text.txt').write_text('**Own text** for @{c-cf3f4417}: colorless oil, CDCl3 run.\n\nSecond paragraph.', 'utf-8')
save(d, c)
# 2c: no procedure field (purification printed on its own, typed sentence); bare ee, typed EA formula
d, c = comp('c-e2e36085'); v = c['values']
c['fields'] = [f for f in c['fields'] if f['key'] != 'procedure']
v['purification']['sentence'] = 'Purified by Kugelrohr distillation (0.1 mbar, 90 °C).'
add(c, 'ee', {'value': '97:3', 'method': 'SFC'})
add(c, 'ea', {'calcd': 'C, 60.1', 'found': '', 'formula': 'C8H9FO·0.25H2O'})
save(d, c)
# 2d: no physical state: "Yield: …" with a note; rotation without concentration
d, c = comp('c-1eebe878'); v = c['values']
v['physical_state']['text'] = ''
v['yield']['note'] = 'over two steps'
add(c, 'rotation', {'value': '-8.2', 'temperature': '', 'c': '', 'solvent': 'MeOH'})
save(d, c)
# 2e: a GP value typed with a mention and formatting; HRMS without a found value
d, c = comp('c-ad564675'); v = c['values']
v['procedure']['values']['ketone'] = "4′-bromoacetophenone (from @{c-26c39a99}, *dried*)"
v['hrms']['found'] = ''
save(d, c)
# 2f: a GP value missing, and the typed {scale} (the field wins)
d, c = comp('c-bfbaadc9'); v = c['values']
del v['procedure']['values']['mass']
v['procedure']['values']['scale'] = '0.30 mmol'
save(d, c)
