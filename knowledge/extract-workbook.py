"""Read all XLSX sheets without Excel or third-party dependencies; retain row locators."""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

def extract(path):
    with zipfile.ZipFile(path) as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        sheets = []
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS):
            target = rels[sheet.attrib[REL]]
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            rows = []
            for row in ET.fromstring(z.read(target)).findall('s:sheetData/s:row', NS):
                cells = {}
                for cell in row.findall('s:c', NS):
                    value = cell.find('s:v', NS)
                    text = value.text if value is not None else ''
                    if cell.attrib.get('t') == 's':
                        text = strings[int(text)] if text else ''
                    elif cell.attrib.get('t') == 'inlineStr':
                        text = ''.join(cell.find('s:is', NS).itertext())
                    if text:
                        col = ''.join(c for c in cell.attrib['r'] if c.isalpha())
                        cells[col] = text
                if cells:
                    rows.append({'row': int(row.attrib['r']), 'cells': cells})
            sheets.append({'name': sheet.attrib['name'], 'rows': rows})
        return {'file': Path(path).name, 'sheets': sheets}

if __name__ == '__main__':
    result = extract(sys.argv[1])
    Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps([{'name': s['name'], 'rows': len(s['rows']), 'head': s['rows'][:3]} for s in result['sheets']], ensure_ascii=False))
