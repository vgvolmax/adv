(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OzonXlsx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const td = new TextDecoder('utf-8');

  function u16(view, off) { return view.getUint16(off, true); }
  function u32(view, off) { return view.getUint32(off, true); }

  function findEocd(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const min = Math.max(0, bytes.byteLength - 22 - 0xFFFF);
    for (let i = bytes.byteLength - 22; i >= min; i--) {
      if (u32(view, i) === 0x06054b50) return i;
    }
    throw new Error('Не найден каталог ZIP: файл не похож на XLSX');
  }

  function listZipEntries(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const eocd = findEocd(bytes);
    const count = u16(view, eocd + 10);
    let off = u32(view, eocd + 16);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (u32(view, off) !== 0x02014b50) throw new Error('Повреждён центральный каталог ZIP');
      const method = u16(view, off + 10);
      const compressedSize = u32(view, off + 20);
      const uncompressedSize = u32(view, off + 24);
      const nameLen = u16(view, off + 28);
      const extraLen = u16(view, off + 30);
      const commentLen = u16(view, off + 32);
      const localOffset = u32(view, off + 42);
      const name = td.decode(bytes.subarray(off + 46, off + 46 + nameLen));
      entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return { bytes, view, entries };
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream !== 'function') throw new Error('Браузер не поддерживает DecompressionStream');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function extractEntry(zip, name) {
    const entry = zip.entries.get(name);
    if (!entry) return null;
    const { view, bytes } = zip;
    const off = entry.localOffset;
    if (u32(view, off) !== 0x04034b50) throw new Error('Повреждён локальный заголовок ZIP: ' + name);
    const nameLen = u16(view, off + 26);
    const extraLen = u16(view, off + 28);
    const start = off + 30 + nameLen + extraLen;
    const compressed = bytes.subarray(start, start + entry.compressedSize);
    let out;
    if (entry.method === 0) out = compressed.slice();
    else if (entry.method === 8) out = await inflateRaw(compressed);
    else throw new Error('Неподдерживаемый метод сжатия ZIP: ' + entry.method);
    return out;
  }

  async function extractText(zip, name) {
    const b = await extractEntry(zip, name);
    return b ? td.decode(b) : null;
  }

  function xmlDecode(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  function attrs(text) {
    const out = {};
    const re = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(text || ''))) out[m[1]] = xmlDecode(m[2]);
    return out;
  }

  function textTags(xml) {
    let out = '';
    const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = re.exec(xml || ''))) out += xmlDecode(m[1]);
    return out;
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const out = [];
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml))) out.push(textTags(m[1]));
    return out;
  }

  function colIndexFromRef(ref) {
    const m = /^([A-Z]+)/i.exec(ref || '');
    if (!m) return null;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function cellValue(attr, body, shared) {
    const t = attr.t || '';
    if (t === 'inlineStr') return textTags(body);
    const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body || '');
    const raw = vm ? xmlDecode(vm[1]) : '';
    if (t === 's') return shared[Number(raw)] ?? '';
    if (t === 'str' || t === 'e') return raw;
    if (t === 'b') return raw === '1';
    if (raw === '') return '';
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }

  function parseSheetRows(xml, shared) {
    const rows = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(xml || ''))) {
      const body = rm[1];
      const row = [];
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
      let cm;
      let seq = 0;
      while ((cm = cellRe.exec(body))) {
        const a = attrs(cm[1] || cm[3] || '');
        const idx = colIndexFromRef(a.r);
        const col = idx == null ? seq : idx;
        row[col] = cellValue(a, cm[2] || '', shared);
        seq = col + 1;
      }
      rows.push(row);
    }
    return rows;
  }

  function parseWorkbookSheets(xml) {
    const out = [];
    const re = /<sheet\b([^>]*)\/?\s*>/g;
    let m;
    while ((m = re.exec(xml || ''))) {
      const a = attrs(m[1]);
      out.push({ name: a.name || '', relId: a['r:id'] || '' });
    }
    return out;
  }

  function parseRelationships(xml) {
    const out = new Map();
    const re = /<Relationship\b([^>]*)\/?\s*>/g;
    let m;
    while ((m = re.exec(xml || ''))) {
      const a = attrs(m[1]);
      if (a.Id) out.set(a.Id, a.Target || '');
    }
    return out;
  }

  function normalizeTarget(target) {
    target = String(target || '').replace(/^\//, '');
    if (target.startsWith('xl/')) return target;
    return 'xl/' + target.replace(/^\.\//, '');
  }

  function normHeader(x) { return String(x == null ? '' : x).trim().replace(/\s+/g, ' '); }

  const REQUIRED = ['День', 'SKU', 'Клики', 'Добавления в корзину', 'Средняя стоимость клика, ₽', 'Заказано на сумму, ₽'];

  function findOzonTable(rows) {
    for (let i = 0; i < rows.length; i++) {
      const headers = rows[i].map(normHeader);
      const set = new Set(headers);
      if (REQUIRED.every(h => set.has(h))) {
        const objects = [];
        for (let r = i + 1; r < rows.length; r++) {
          const arr = rows[r];
          if (!arr || arr.every(v => v == null || v === '')) continue;
          const obj = {};
          headers.forEach((h, c) => { if (h) obj[h] = arr[c] == null ? '' : arr[c]; });
          objects.push(obj);
        }
        const preamble = rows.slice(0, i).flat().filter(v => typeof v === 'string').join(' ');
        const cm = /Кампания[^№#\d]*(?:№|#)?\s*(\d{5,})/i.exec(preamble) || /№\s*(\d{5,})/.exec(preamble);
        return { headerRow: i, headers, rows: objects, campaignId: cm ? cm[1] : null };
      }
    }
    return null;
  }

  async function readOzonWorkbook(arrayBuffer) {
    const zip = listZipEntries(arrayBuffer);
    const workbookXml = await extractText(zip, 'xl/workbook.xml');
    const relsXml = await extractText(zip, 'xl/_rels/workbook.xml.rels');
    if (!workbookXml || !relsXml) throw new Error('В XLSX отсутствует workbook.xml');
    const shared = parseSharedStrings(await extractText(zip, 'xl/sharedStrings.xml'));
    const sheets = parseWorkbookSheets(workbookXml);
    const rels = parseRelationships(relsXml);
    for (const sheet of sheets) {
      const target = rels.get(sheet.relId);
      if (!target) continue;
      const path = normalizeTarget(target);
      const xml = await extractText(zip, path);
      if (!xml) continue;
      const matrix = parseSheetRows(xml, shared);
      const found = findOzonTable(matrix);
      if (found) return { campaignId: found.campaignId, sheetName: sheet.name, headers: found.headers, rows: found.rows, headerRow: found.headerRow };
    }
    throw new Error('Не найдена таблица Ozon с обязательными колонками: ' + REQUIRED.join(', '));
  }

  return { readOzonWorkbook, _internals: { listZipEntries, parseSheetRows, findOzonTable, xmlDecode } };
});
