/* FABRI-CORE · escritor de .xlsx real, sin librerías (multi-hoja + fórmulas).
 *
 * Genera un ZIP (método store) con las partes OOXML mínimas que Excel,
 * LibreOffice y Google Sheets abren sin quejarse.
 *
 * Uso:
 *   XLSXW.build([{ name:'Hoja 1', cols:['a','b'], rows:[['1','2']] }])
 *   XLSXW.build([{ name:'Gastos', cols:[...], rows:[[{ v: 535500, f: 'B2*0.19' }]] }])
 *
 * Cada celda puede ser un primitivo (número o texto) o { v, f }: v = valor ya
 * calculado que Excel muestra al abrir, f = fórmula sin el "=".
 */
(function () {
  'use strict';

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const time = 0, date = ((2024 - 1980) << 9) | (1 << 5) | 1;

    files.forEach(f => {
      const nameB = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
        u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0)
      );
      chunks.push(new Uint8Array(local), nameB, data);
      central.push({ nameB, crc, size: data.length, offset });
      offset += local.length + nameB.length + data.length;
    });

    const cdStart = offset;
    central.forEach(c => {
      const head = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
        u32(c.crc), u32(c.size), u32(c.size), u16(c.nameB.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(c.offset)
      );
      chunks.push(new Uint8Array(head), c.nameB);
      offset += head.length + c.nameB.length;
    });

    const eocd = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(offset - cdStart), u32(cdStart), u16(0)
    ));
    chunks.push(eocd);

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    chunks.forEach(c => { out.set(c, p); p += c.length; });
    return out;
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\r?\n/g, '&#10;');

  const colName = i => {
    let s = '', n = i;
    while (true) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; if (n < 0) break; }
    return s;
  };

  const isNum = v => typeof v === 'number' && isFinite(v);

  /* Una hoja. Las fórmulas llevan el valor cacheado en <v> para que el archivo
     se vea bien incluso antes de recalcular. */
  function sheetXml(sh) {
    const cols = sh.cols || [];
    const rows = sh.rows || [];
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>';

    const cell = (ref, v, formula, head) => {
      const style = head ? ' s="1"' : '';
      if (formula) {
        const cached = isNum(v) ? '<v>' + v + '</v>' : (v == null || v === '' ? '<v>0</v>' :
          '<v>' + esc(v) + '</v>');
        return '<c r="' + ref + '"' + style + '><f>' + esc(formula.replace(/^=/, '')) + '</f>' + cached + '</c>';
      }
      if (isNum(v)) return '<c r="' + ref + '"' + style + '><v>' + v + '</v></c>';
      if (typeof v === 'boolean') return '<c r="' + ref + '" t="b"' + style + '><v>' + (v ? 1 : 0) + '</v></c>';
      if (v == null || v === '') return '';
      return '<c r="' + ref + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
    };

    const row = (r, vals, head) => {
      let s = '<row r="' + r + '">';
      (vals || []).forEach((raw, i) => {
        const ref = colName(i) + r;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          s += cell(ref, raw.v, raw.f, head);
        } else {
          s += cell(ref, raw, null, head);
        }
      });
      return s + '</row>';
    };

    if (cols.length) x += row(1, cols, true);
    rows.forEach((r, i) => { x += row(i + 2, r, false); });
    return x + '</sheetData></worksheet>';
  }

  const safeName = (n, i) => {
    const s = String(n || ('Hoja ' + (i + 1))).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31);
    return s || ('Hoja ' + (i + 1));
  };

  function build(sheets) {
    sheets = (sheets && sheets.length ? sheets : [{ name: 'Hoja 1', cols: [], rows: [] }]);
    const n = sheets.length;

    const overrides = sheets.map((s, i) =>
      '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    ).join('');

    const CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      overrides +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    const WBR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) =>
        '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'
      ).join('') +
      '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    const WB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) =>
        '<sheet name="' + esc(safeName(s.name, i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'
      ).join('') + '</sheets></workbook>';

    const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="2"><xf xfId="0"/><xf fontId="1" xfId="0" applyFont="1"/></cellXfs></styleSheet>';

    const files = [
      { name: '[Content_Types].xml', data: enc.encode(CT) },
      { name: '_rels/.rels', data: enc.encode(RELS) },
      { name: 'xl/workbook.xml', data: enc.encode(WB) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WBR) },
      { name: 'xl/styles.xml', data: enc.encode(STYLES) }
    ];
    sheets.forEach((s, i) => {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: enc.encode(sheetXml(s)) });
    });
    return zip(files);
  }

  window.XLSXW = {
    build,
    csv(cols, rows) {
      const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const lines = [cols.map(q).join(';')];
      rows.forEach(r => lines.push(r.map(q).join(';')));
      return new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    },
    download(bytes, filename) {
      const blob = bytes instanceof Blob ? bytes : new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  };
})();
