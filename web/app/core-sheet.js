/* FABRI-CORE · planilla con cálculo real.
 *
 * - Rejilla editable con barra de fórmulas, varias hojas y persistencia en SQLite.
 * - Motor de fórmulas propio: + - * / ^ % & comparaciones, referencias A1,
 *   rangos A1:B9, detección de ciclos y ~35 funciones en español e inglés.
 * - Exporta .xlsx de todas las hojas con las fórmulas escritas y su valor cacheado.
 * - Importa CSV.
 *
 * Sin dependencias. Todo el cálculo ocurre en el dispositivo.
 */
(function () {
  'use strict';

  const F = () => window.Fabri;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const ROWS = 40, COLS = 12;

  /* ── direcciones ───────────────────────────────────────────────────────── */
  const colLetter = i => {
    let s = '', n = i;
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  };
  const refOf = (r, c) => colLetter(c) + (r + 1);
  const parseRef = ref => {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,5})$/.exec(String(ref).replace(/\s/g, ''));
    if (!m) return null;
    let c = 0;
    const L = m[1].toUpperCase();
    for (let i = 0; i < L.length; i++) c = c * 26 + (L.charCodeAt(i) - 64);
    const r = parseInt(m[2], 10);
    if (r < 1 || c < 1) return null;
    return { r: r - 1, c: c - 1 };
  };

  /* ── errores de hoja ───────────────────────────────────────────────────── */
  class XErr {
    constructor(code) { this.code = code; }
    toString() { return this.code; }
  }
  const err = c => new XErr(c);

  const isErr = v => v instanceof XErr;

  /* ── tokenizador ───────────────────────────────────────────────────────── */
  function lex(src) {
    const out = [];
    let i = 0;
    const s = String(src);
    const push = (t, v) => out.push({ t, v });

    while (i < s.length) {
      const ch = s[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }

      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(s.slice(i));
        push('num', parseFloat(m[0])); i += m[0].length; continue;
      }
      if (ch === '"') {
        let j = i + 1, buf = '';
        while (j < s.length) {
          if (s[j] === '"' && s[j + 1] === '"') { buf += '"'; j += 2; continue; }
          if (s[j] === '"') break;
          buf += s[j++];
        }
        push('str', buf); i = j + 1; continue;
      }

      const three = s.slice(i, i + 2);
      if (three === '<=' || three === '>=' || three === '<>') { push('op', three); i += 2; continue; }
      if ('+-*/^&%<>='.includes(ch)) { push('op', ch); i++; continue; }
      if (ch === '(' || ch === ')' || ch === ',' || ch === ';' || ch === ':') { push(ch, ch); i++; continue; }

      const rest = s.slice(i);
      const refm = /^\$?[A-Za-z]{1,3}\$?[0-9]{1,5}(?![A-Za-z0-9_])/.exec(rest);
      if (refm && parseRef(refm[0])) { push('ref', refm[0].toUpperCase()); i += refm[0].length; continue; }

      const idm = /^[A-Za-zÁÉÍÓÚÜÑñ][A-Za-z0-9ÁÉÍÓÚÜÑñ_.]*/.exec(rest);
      if (idm) { push('id', idm[0].toUpperCase()); i += idm[0].length; continue; }

      push('bad', ch); i++;
    }
    return out;
  }

  /* ── parser ────────────────────────────────────────────────────────────── */
  function parse(src) {
    const tk = lex(src);
    let p = 0;
    const peek = () => tk[p];
    const eat = t => { if (tk[p] && tk[p].t === t) { p++; return true; } return false; };

    function expr() { return compare(); }

    function compare() {
      let l = concat();
      while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
        const op = tk[p++].v;
        l = { t: 'op', op, l, r: concat() };
      }
      return l;
    }
    function concat() {
      let l = add();
      while (peek() && peek().t === 'op' && peek().v === '&') {
        p++; l = { t: 'op', op: '&', l, r: add() };
      }
      return l;
    }
    function add() {
      let l = mul();
      while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = tk[p++].v;
        l = { t: 'op', op, l, r: mul() };
      }
      return l;
    }
    function mul() {
      let l = pow();
      while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
        const op = tk[p++].v;
        l = { t: 'op', op, l, r: pow() };
      }
      return l;
    }
    function pow() {
      const l = unary();
      if (peek() && peek().t === 'op' && peek().v === '^') {
        p++; return { t: 'op', op: '^', l, r: pow() };
      }
      return l;
    }
    function unary() {
      if (peek() && peek().t === 'op' && (peek().v === '-' || peek().v === '+')) {
        const op = tk[p++].v;
        const v = unary();
        return op === '-' ? { t: 'neg', v } : v;
      }
      return primary();
    }
    function primary() {
      const t = peek();
      if (!t) return { t: 'n', v: 0 };
      if (t.t === 'num') { p++; return { t: 'n', v: t.v }; }
      if (t.t === 'str') { p++; return { t: 's', v: t.v }; }
      if (t.t === '(') {
        p++;
        let e = expr();
        while (peek() && peek().t !== ')') { p++; e = expr(); if (p > tk.length) break; }
        eat(')');
        return e;
      }
      if (t.t === 'ref') {
        p++;
        if (peek() && peek().t === ':' && tk[p + 1] && tk[p + 1].t === 'ref') {
          p++;
          const b = tk[p++].v;
          return { t: 'range', a: t.v, b };
        }
        return { t: 'ref', ref: t.v };
      }
      if (t.t === 'id') {
        p++;
        if (peek() && peek().t === '(') {
          p++;
          const args = [];
          if (peek() && peek().t !== ')') {
            args.push(expr());
            while (peek() && (peek().t === ',' || peek().t === ';')) { p++; args.push(expr()); }
          }
          eat(')');
          return { t: 'call', name: t.v, args };
        }
        if (t.v === 'VERDADERO' || t.v === 'TRUE') return { t: 'n', v: true };
        if (t.v === 'FALSO' || t.v === 'FALSE') return { t: 'n', v: false };
        return { t: 'name', v: t.v };
      }
      p++;
      return { t: 'n', v: 0 };
    }

    const node = expr();
    return node;
  }

  /* ── evaluación ────────────────────────────────────────────────────────── */
  const num = v => {
    if (isErr(v)) return v;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v == null || v === '') return 0;
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : err('#VALOR!');
  };

  const txt = v => {
    if (isErr(v)) return v.code;
    if (v == null) return '';
    if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10);
    return String(v);
  };

  function expandRange(a, b) {
    const A = parseRef(a), B = parseRef(b);
    if (!A || !B) return null;
    const r1 = Math.min(A.r, B.r), r2 = Math.max(A.r, B.r);
    const c1 = Math.min(A.c, B.c), c2 = Math.max(A.c, B.c);
    const refs = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) refs.push(refOf(r, c));
    return { refs, r1, c1, r2, c2 };
  }

  const flat = vals => {
    const out = [];
    vals.forEach(v => {
      if (v && v.__range) v.__range.forEach(r => out.push(r));
      else out.push(v);
    });
    return out;
  };
  const numsOf = vals => flat(vals).map(num).filter(v => typeof v === 'number');

  function compare(op, a, b) {
    if (a && a.__range) a = a.__range[0];
    if (b && b.__range) b = b.__range[0];
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    const na = typeof a === 'number' || (a !== '' && a != null && isFinite(Number(a)));
    const nb = typeof b === 'number' || (b !== '' && b != null && isFinite(Number(b)));
    let x = a, y = b;
    if (na && nb) { x = Number(a); y = Number(b); }
    else { x = String(a == null ? '' : a).toLowerCase(); y = String(b == null ? '' : b).toLowerCase(); }
    switch (op) {
      case '=': return x === y;
      case '<>': return x !== y;
      case '<': return x < y;
      case '>': return x > y;
      case '<=': return x <= y;
      case '>=': return x >= y;
    }
    return err('#VALOR!');
  }

  function evalNode(n, ctx) {
    switch (n.t) {
      case 'n': return n.v;
      case 's': return n.v;
      case 'ref': return ctx.get(n.ref);
      case 'range': {
        const r = expandRange(n.a, n.b);
        if (!r) return err('#REF!');
        const vals = r.refs.map(ref => ctx.get(ref));
        const bad = vals.find(isErr);
        return { __range: vals, refs: r.refs, r1: r.r1, c1: r.c1, r2: r.r2, c2: r.c2, error: bad };
      }
      case 'name': return err('#NOMBRE?');
      case 'neg': {
        const v = num(evalNode(n.v, ctx));
        return isErr(v) ? v : -v;
      }
      case 'op': {
        const a = evalNode(n.l, ctx);
        const b = evalNode(n.r, ctx);
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) return compare(n.op, a, b);
        if (n.op === '&') {
          if (isErr(a)) return a;
          if (isErr(b)) return b;
          return txt(a && a.__range ? a.__range[0] : a) + txt(b && b.__range ? b.__range[0] : b);
        }
        const x = num(a && a.__range ? a.__range[0] : a);
        const y = num(b && b.__range ? b.__range[0] : b);
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        switch (n.op) {
          case '+': return x + y;
          case '-': return x - y;
          case '*': return x * y;
          case '/': return y === 0 ? err('#DIV/0!') : x / y;
          case '^': { const v = Math.pow(x, y); return isFinite(v) ? v : err('#NUM!'); }
        }
        return err('#VALOR!');
      }
      case 'call': return callFn(n.name, n.args.map(a => evalNode(a, ctx)), ctx);
    }
    return err('#VALOR!');
  }

  const round = (x, d) => {
    const m = Math.pow(10, d || 0);
    return Math.round((x + Number.EPSILON) * m) / m;
  };

  function callFn(name, vals, ctx) {
    const fn = name.replace(/\./g, '.');
    // Ojo: NO usar flat() aquí. Aplanar convierte A2:B3 en sus valores y
    // desplaza los argumentos: SUMAR.SI(rango;">3500") acababa leyendo 3200.
    const arg = i => {
      const v = vals[i];
      if (v && v.__range) return v.__range[0];
      return v;
    };
    const first = () => arg(0);
    const opt = i => arg(i);

    switch (fn) {
      case 'SUMA': case 'SUM': {
        const ns = numsOf(vals);
        return ns.reduce((a, b) => a + b, 0);
      }
      case 'PROMEDIO': case 'AVERAGE': case 'MEDIA': {
        const ns = numsOf(vals);
        return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : err('#DIV/0!');
      }
      case 'MIN': {
        const ns = numsOf(vals);
        return ns.length ? Math.min.apply(null, ns) : 0;
      }
      case 'MAX': {
        const ns = numsOf(vals);
        return ns.length ? Math.max.apply(null, ns) : 0;
      }
      case 'CONTAR': case 'COUNT':
        return numsOf(vals).length;
      case 'CONTARA': case 'COUNTA':
        return flat(vals).filter(v => v !== '' && v != null && !isErr(v)).length;
      case 'CONTAR.BLANCO': case 'COUNTBLANK':
        return flat(vals).filter(v => v === '' || v == null).length;
      case 'SI': case 'IF': {
        const c = first();
        if (isErr(c)) return c;
        const truthy = typeof c === 'boolean' ? c : !!num(c);
        if (truthy) return vals.length > 1 ? opt(1) : true;
        return vals.length > 2 ? opt(2) : false;
      }
      case 'SI.ERROR': case 'IFERROR': {
        const v = first();
        return isErr(v) ? (vals.length > 1 ? opt(1) : '') : v;
      }
      case 'Y': case 'AND': {
        const vs = flat(vals);
        return vs.every(v => (typeof v === 'boolean' ? v : !!num(v)));
      }
      case 'O': case 'OR': {
        const vs = flat(vals);
        return vs.some(v => (typeof v === 'boolean' ? v : !!num(v)));
      }
      case 'NO': case 'NOT': {
        const v = first();
        return !(typeof v === 'boolean' ? v : !!num(v));
      }
      case 'REDONDEAR': case 'ROUND': {
        const x = num(first());
        if (isErr(x)) return x;
        const d = vals.length > 1 ? num(opt(1)) : 0;
        return round(x, d);
      }
      case 'REDONDEAR.MAS': case 'ROUNDUP': {
        const x = num(first());
        if (isErr(x)) return x;
        const d = vals.length > 1 ? num(opt(1)) : 0;
        const m = Math.pow(10, d);
        return (x < 0 ? -Math.ceil(Math.abs(x) * m) : Math.ceil(x * m)) / m;
      }
      case 'REDONDEAR.MENOS': case 'ROUNDDOWN': {
        const x = num(first());
        if (isErr(x)) return x;
        const d = vals.length > 1 ? num(opt(1)) : 0;
        const m = Math.pow(10, d);
        return (x < 0 ? -Math.floor(Math.abs(x) * m) : Math.floor(x * m)) / m;
      }
      case 'ENTERO': case 'INT': {
        const x = num(first());
        return isErr(x) ? x : Math.floor(x);
      }
      case 'ABS': { const x = num(first()); return isErr(x) ? x : Math.abs(x); }
      case 'RAIZ': case 'SQRT': {
        const x = num(first());
        if (isErr(x)) return x;
        return x < 0 ? err('#NUM!') : Math.sqrt(x);
      }
      case 'POTENCIA': case 'POWER': {
        const x = num(first()), y = num(opt(1));
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        const v = Math.pow(x, y);
        return isFinite(v) ? v : err('#NUM!');
      }
      case 'RESIDUO': case 'MOD': {
        const x = num(first()), y = num(opt(1));
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        return y === 0 ? err('#DIV/0!') : x - y * Math.floor(x / y);
      }
      case 'EXP': { const x = num(first()); return isErr(x) ? x : Math.exp(x); }
      case 'LN': { const x = num(first()); return x <= 0 ? err('#NUM!') : Math.log(x); }
      case 'LOG10': case 'LOG': { const x = num(first()); return x <= 0 ? err('#NUM!') : Math.log10(x); }
      case 'ALEATORIO': case 'RAND': return Math.random();
      case 'HOY': case 'TODAY': {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }
      case 'AHORA': case 'NOW': return new Date().toISOString().slice(0, 19).replace('T', ' ');
      case 'LARGO': case 'LEN': return txt(first()).length;
      case 'MAYUSC': case 'UPPER': return txt(first()).toUpperCase();
      case 'MINUSC': case 'LOWER': return txt(first()).toLowerCase();
      case 'NOMBREC': case 'PROPER':
        return txt(first()).replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
      case 'RECORTAR': case 'TRIM': return txt(first()).trim().replace(/\s+/g, ' ');
      case 'CONCATENAR': case 'CONCAT': return flat(vals).map(txt).join('');
      case 'IZQUIERDA': case 'LEFT': return txt(first()).slice(0, num(opt(1)) || 1);
      case 'DERECHA': case 'RIGHT': {
        const s = txt(first()), n = num(opt(1)) || 1;
        return s.slice(Math.max(0, s.length - n));
      }
      case 'EXTRAE': case 'MID': {
        const s = txt(first()), i = num(opt(1)) || 1, n = num(opt(2)) || 0;
        return s.substr(i - 1, n);
      }
      case 'IGUAL': case 'EXACT': return txt(first()) === txt(opt(1));
      case 'TEXTO': {
        const v = first(), dec = vals.length > 1 ? num(opt(1)) : 0;
        const x = num(v);
        return isErr(x) ? txt(v) : x.toFixed(Math.max(0, Math.min(8, dec)));
      }
      case 'REDONDEAR.A': case 'MROUND': {
        const x = num(first()), m = num(opt(1)) || 1;
        return isErr(x) ? x : Math.round(x / m) * m;
      }
      case 'SUMAR.SI': case 'SUMIF': {
        const range = vals[0];
        if (!range || !range.__range) return err('#VALOR!');
        const crit = opt(1);
        const target = (vals[2] && vals[2].__range) ? vals[2].__range : range.__range;
        const test = critFn(crit);
        let acc = 0;
        range.__range.forEach((v, i) => {
          if (!test(v)) return;
          const t = num(target[i]);
          if (typeof t === 'number') acc += t;
        });
        return acc;
      }
      case 'CONTAR.SI': case 'COUNTIF': {
        const range = vals[0];
        if (!range || !range.__range) return err('#VALOR!');
        const test = critFn(opt(1));
        return range.__range.filter(v => test(v)).length;
      }
      case 'BUSCARV': case 'VLOOKUP': {
        const needle = first();
        const range = vals[1];
        const colIdx = num(opt(2)) || 1;
        if (!range || !range.__range) return err('#VALOR!');
        const width = range.c2 - range.c1 + 1;
        const rowsN = Math.ceil(range.__range.length / width);
        for (let r = 0; r < rowsN; r++) {
          const hv = range.__range[r * width];
          const eq = String(hv).toLowerCase() === String(needle).toLowerCase() || hv === needle;
          if (eq) {
            const target = range.__range[r * width + (colIdx - 1)];
            return target === undefined ? err('#REF!') : target;
          }
        }
        return err('#N/A');
      }
      case 'INDICE': case 'INDEX': {
        const range = vals[0];
        if (!range || !range.__range) return err('#VALOR!');
        const width = range.c2 - range.c1 + 1;
        const r = num(opt(1)) || 1, c = num(opt(2)) || 1;
        const v = range.__range[(r - 1) * width + (c - 1)];
        return v === undefined ? err('#REF!') : v;
      }
      case 'COINCIDIR': case 'MATCH': {
        const needle = first();
        const range = vals[1];
        if (!range || !range.__range) return err('#VALOR!');
        const i = range.__range.findIndex(v => String(v).toLowerCase() === String(needle).toLowerCase());
        return i >= 0 ? i + 1 : err('#N/A');
      }
      case 'FILA': case 'ROW': {
        const r = ctx.rowOf ? ctx.rowOf() : 1;
        return r + 1;
      }
      case 'COLUMNA': case 'COLUMN': {
        const c = ctx.colOf ? ctx.colOf() : 1;
        return c + 1;
      }
      case 'MAX.SI': case 'MAXIFS': case 'MIN.SI': case 'MINIFS': {
        const ns = numsOf(vals.slice(1));
        if (!ns.length) return 0;
        return fn.startsWith('MAX') ? Math.max.apply(null, ns) : Math.min.apply(null, ns);
      }
    }
    return err('#NOMBRE?');
  }

  function critFn(crit) {
    if (isErr(crit)) return () => false;
    const s = String(crit == null ? '' : crit);
    const m = /^(<=|>=|<>|<|>|=)\s*(.*)$/.exec(s);
    if (m) {
      const op = m[1];
      const raw = m[2];
      const n = Number(raw);
      const isNumCrit = raw.trim() !== '' && isFinite(n);
      return v => {
        if (isNumCrit) {
          const x = num(v);
          if (typeof x !== 'number') return false;
          switch (op) {
            case '>': return x > n;
            case '<': return x < n;
            case '>=': return x >= n;
            case '<=': return x <= n;
            case '<>': return x !== n;
            case '=': return x === n;
          }
        }
        const a = String(v == null ? '' : v).toLowerCase();
        const b = raw.toLowerCase();
        switch (op) {
          case '=': return a === b;
          case '<>': return a !== b;
          case '>': return a > b;
          case '<': return a < b;
          case '>=': return a >= b;
          case '<=': return a <= b;
        }
        return false;
      };
    }
    // comodines * y ?
    if (/[*?]/.test(s)) {
      const rx = new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
      return v => rx.test(String(v == null ? '' : v));
    }
    const n = Number(s);
    const isNumCrit = s.trim() !== '' && isFinite(n);
    return v => isNumCrit ? num(v) === n : String(v == null ? '' : v).toLowerCase() === s.toLowerCase();
  }

  const coerce = raw => {
    const s = String(raw).trim();
    if (s === '') return '';
    // "500.000" o "1.234.567" son miles a la chilena, no decimales.
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) return Number(s.replace(/,/g, ''));
    if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
    if (/^-?\d+,\d+$/.test(s)) return Number(s.replace(',', '.'));
    if (/^(VERDADERO|TRUE)$/i.test(s)) return true;
    if (/^(FALSO|FALSE)$/i.test(s)) return false;
    if (/^#(DIV\/0!|VALOR!|REF!|NOMBRE\?|NUM!|N\/A|CICLO!)$/i.test(s)) return err(s.toUpperCase());
    return s;
  };

  /* ── cálculo de una hoja completa ──────────────────────────────────────── */
  function calcSheet(cells) {
    const memo = new Map();
    const visiting = new Set();
    const issues = [];

    function get(ref) {
      if (memo.has(ref)) return memo.get(ref);
      if (visiting.has(ref)) { issues.push(ref + ': ciclo'); return err('#CICLO!'); }
      const raw = cells.get(ref);
      if (raw == null || raw === '') { memo.set(ref, ''); return ''; }
      const s = String(raw);
      let val;
      if (s[0] === '=') {
        visiting.add(ref);
        try {
          const node = parse(s.slice(1));
          val = evalNode(node, { get, rowOf: () => parseRef(ref).r, colOf: () => parseRef(ref).c });
        } catch (e) {
          val = err('#VALOR!');
          issues.push(ref + ': ' + e.message);
        }
        visiting.delete(ref);
      } else {
        val = coerce(s);
      }
      if (isErr(val)) issues.push(ref + ': ' + val.code);
      memo.set(ref, val);
      return val;
    }

    // evaluar todo lo que tenga fórmula o valor
    cells.forEach((_, ref) => get(ref));
    return { get, issues };
  }

  /* ── formato para pantalla ─────────────────────────────────────────────── */
  const fmt = v => {
    if (isErr(v)) return v.code;
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
    if (typeof v === 'number') {
      if (!isFinite(v)) return '#NUM!';
      const r = round(v, 6);
      return r.toLocaleString('es-CL', { maximumFractionDigits: 6 });
    }
    return String(v);
  };

  /* ── estado ────────────────────────────────────────────────────────────── */
  const S = {
    sheets: [],       // [{id, name}]
    id: null,
    cells: new Map(), // ref -> raw
    active: 'A1',
    calc: null,
    timer: null
  };

  function init() {
    const f = F();
    try {
      f.S.db.run(`
        CREATE TABLE IF NOT EXISTS sheets(
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
          created_at INTEGER, updated_at INTEGER);
        CREATE TABLE IF NOT EXISTS cells(
          sheet_id INTEGER NOT NULL, ref TEXT NOT NULL, raw TEXT NOT NULL,
          PRIMARY KEY(sheet_id, ref));
      `);
    } catch (e) { console.error(e); }

    S.sheets = f.q('SELECT id, name FROM sheets ORDER BY id');
    if (!S.sheets.length) {
      f.run('INSERT INTO sheets(name, created_at, updated_at) VALUES(?,?,?)',
        ['Hoja 1', Date.now(), Date.now()]);
      f.save();
      S.sheets = f.q('SELECT id, name FROM sheets ORDER BY id');
    }
    S.id = S.sheets[0].id;
    load();
  }

  function load() {
    const f = F();
    S.cells = new Map();
    try {
      f.q('SELECT ref, raw FROM cells WHERE sheet_id = ?', [S.id])
        .forEach(r => S.cells.set(r.ref, r.raw));
    } catch (_) {}
    S.calc = calcSheet(S.cells);
  }

  function recalc() { S.calc = calcSheet(S.cells); }

  function persist(ref) {
    const f = F();
    const raw = S.cells.get(ref);
    try {
      if (raw == null || raw === '') f.run('DELETE FROM cells WHERE sheet_id = ? AND ref = ?', [S.id, ref]);
      else f.run('INSERT OR REPLACE INTO cells(sheet_id, ref, raw) VALUES(?,?,?)', [S.id, ref, raw]);
      f.run('UPDATE sheets SET updated_at = ? WHERE id = ?', [Date.now(), S.id]);
      f.save();
    } catch (e) { console.error(e); }
  }

  /* ── UI ────────────────────────────────────────────────────────────────── */
  const CSS = `
  .sh-wrap{display:flex;flex-direction:column;gap:8px}
  .sh-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}
  .sh-tab{display:flex;align-items:center;gap:6px;flex:0 0 auto;padding:6px 10px;border-radius:9px;
    border:1px solid var(--line);background:transparent;color:inherit;font:inherit;font-size:11.5px;cursor:pointer}
  .sh-tab.on{border-color:var(--accent);color:var(--accent);font-weight:800}
  .sh-tab i{font-style:normal;opacity:.5;padding:0 2px}
  .sh-bar{display:flex;align-items:center;gap:7px}
  .sh-addr{flex:0 0 auto;min-width:46px;text-align:center;font-family:var(--mono);font-size:11px;
    padding:6px 4px;border:1px solid var(--line);border-radius:8px;font-weight:700}
  .sh-fx{flex:1;min-width:0;background:transparent;border:1px solid var(--line);border-radius:8px;
    padding:7px 9px;color:inherit;font-family:var(--mono);font-size:11.5px}
  .sh-tools{display:flex;gap:6px;flex-wrap:wrap}
  .sh-grid{overflow:auto;max-height:58vh;border:1px solid var(--line);border-radius:11px;background:rgba(0,0,0,.12)}
  .sh-grid table{border-collapse:separate;border-spacing:0;font-size:12px;font-family:var(--sans)}
  .sh-grid th{position:sticky;background:#161b2b;color:rgba(255,255,255,.55);font-size:10px;
    font-weight:700;text-align:center;padding:4px 0;border-right:1px solid var(--line);border-bottom:1px solid var(--line);z-index:2}
  .sh-grid th.corner{left:0;z-index:4;min-width:34px}
  .sh-grid th.colh{top:0}
  .sh-grid th.rowh{left:0;z-index:3;min-width:34px}
  .sh-grid td{padding:4px 7px;min-width:86px;max-width:190px;height:28px;
    border-right:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;outline:none;color:inherit}
  .sh-grid td.num{text-align:right;font-variant-numeric:tabular-nums}
  .sh-grid td.err{color:#FF6B6B;font-weight:700}
  .sh-grid td.on{box-shadow:inset 0 0 0 2px var(--accent);border-radius:3px;background:var(--accent-soft)}
  .sh-grid td:focus{box-shadow:inset 0 0 0 2px var(--accent);background:var(--accent-soft)}
  .sh-stat{font-size:11px;opacity:.72;line-height:1.5}
  .sh-stat b{font-family:var(--mono);font-weight:700;opacity:1}
  `;

  function mount(root) {
    if (!root) return;
    if (!F().S || !F().S.db) return;

    if (!document.getElementById('sh-css')) {
      const st = document.createElement('style');
      st.id = 'sh-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    try { init(); } catch (e) { root.innerHTML = '<div class="hint">No pude abrir la planilla: ' + e.message + '</div>'; return; }

    root.innerHTML = `
      <div class="sh-wrap">
        <div class="sh-tabs" id="shTabs"></div>
        <div class="sh-bar">
          <div class="sh-addr" id="shAddr">A1</div>
          <input class="sh-fx" id="shFx" placeholder="=SUMA(B2:B9) · escribe y pulsa Enter" spellcheck="false">
        </div>
        <div class="sh-tools">
          <button class="btn" id="shXlsx">Exportar XLSX</button>
          <button class="btn ghost" id="shCsv">Importar CSV</button>
          <button class="btn ghost" id="shDemo">Ejemplo</button>
          <button class="btn ghost" id="shClear">Limpiar hoja</button>
        </div>
        <div class="sh-grid" id="shGrid"></div>
        <div class="sh-stat" id="shStat"></div>
      </div>`;

    drawTabs();
    drawGrid();
    wire();
  }

  function drawTabs() {
    const host = $('#shTabs');
    if (!host) return;
    host.innerHTML = S.sheets.map(s =>
      `<button class="sh-tab${s.id === S.id ? ' on' : ''}" data-id="${s.id}">
        <span data-name="${s.id}">${escapeHtml(s.name)}</span>
        ${S.sheets.length > 1 ? `<i data-del="${s.id}" title="borrar hoja">×</i>` : ''}
      </button>`).join('') +
      `<button class="sh-tab" id="shAdd" title="nueva hoja">+</button>`;

    host.querySelectorAll('.sh-tab[data-id]').forEach(b => {
      b.onclick = e => {
        if (e.target.dataset.del) return;
        S.id = Number(b.dataset.id); load(); drawTabs(); drawGrid(); updateStat();
      };
      b.ondblclick = () => rename(Number(b.dataset.id));
    });
    host.querySelectorAll('[data-del]').forEach(x => x.onclick = e => {
      e.stopPropagation();
      del(Number(x.dataset.del));
    });
    const add = $('#shAdd');
    if (add) add.onclick = () => addSheet();
  }

  function rename(id) {
    const f = F();
    const cur = (S.sheets.find(s => s.id === id) || {}).name || '';
    const name = prompt('Nombre de la hoja:', cur);
    if (!name || !name.trim()) return;
    f.run('UPDATE sheets SET name = ?, updated_at = ? WHERE id = ?', [name.trim().slice(0, 31), Date.now(), id]);
    f.save();
    S.sheets = f.q('SELECT id, name FROM sheets ORDER BY id');
    drawTabs();
  }

  function addSheet() {
    const f = F();
    const n = 'Hoja ' + (S.sheets.length + 1);
    f.run('INSERT INTO sheets(name, created_at, updated_at) VALUES(?,?,?)', [n, Date.now(), Date.now()]);
    f.save();
    S.sheets = f.q('SELECT id, name FROM sheets ORDER BY id');
    S.id = S.sheets[S.sheets.length - 1].id;
    load(); drawTabs(); drawGrid(); updateStat();
  }

  function del(id) {
    const f = F();
    if (S.sheets.length <= 1) return F().toast('Necesitas al menos una hoja');
    if (!confirm('¿Borrar la hoja "' + (S.sheets.find(s => s.id === id) || {}).name + '" con sus celdas?')) return;
    f.run('DELETE FROM cells WHERE sheet_id = ?', [id]);
    f.run('DELETE FROM sheets WHERE id = ?', [id]);
    f.save(); F().audit(null, 'hoja_borrada', '#' + id);
    S.sheets = f.q('SELECT id, name FROM sheets ORDER BY id');
    if (S.id === id) S.id = S.sheets[0].id;
    load(); drawTabs(); drawGrid(); updateStat();
  }

  function drawGrid() {
    const host = $('#shGrid');
    if (!host) return;
    let head = '<tr><th class="corner"></th>';
    for (let c = 0; c < COLS; c++) head += `<th class="colh">${colLetter(c)}</th>`;
    head += '</tr>';

    let body = '';
    for (let r = 0; r < ROWS; r++) {
      body += `<tr><th class="rowh">${r + 1}</th>`;
      for (let c = 0; c < COLS; c++) {
        const ref = refOf(r, c);
        body += `<td data-ref="${ref}" contenteditable="true" spellcheck="false" inputmode="text"></td>`;
      }
      body += '</tr>';
    }
    host.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
    paint();
  }

  function paint(skip) {
    const cells = $$('#shGrid td[data-ref]');
    cells.forEach(td => {
      const ref = td.dataset.ref;
      if (ref === skip) return;
      const v = S.calc.get(ref);
      const text = fmt(v);
      if (td.textContent !== text) td.textContent = text;
      td.classList.toggle('num', typeof v === 'number');
      td.classList.toggle('err', isErr(v));
      td.classList.toggle('on', ref === S.active);
    });
  }

  function updateStat() {
    const el = $('#shStat');
    if (!el) return;
    const n = S.cells.size;
    const e = S.calc.issues.length;
    const sheet = S.sheets.find(s => s.id === S.id) || {};
    el.innerHTML = `Hoja <b>${escapeHtml(sheet.name || '')}</b> · ${n} celda${n === 1 ? '' : 's'} con contenido · ` +
      (e ? `<span style="color:#FF6B6B">${e} problema${e === 1 ? '' : 's'} de fórmula</span>` : 'sin errores de fórmula') +
      ` · guardado en SQLite`;
  }

  function setActive(ref) {
    S.active = ref;
    const addr = $('#shAddr');
    if (addr) addr.textContent = ref;
    const fx = $('#shFx');
    if (fx) fx.value = S.cells.get(ref) || '';
    $$('#shGrid td.on').forEach(td => td.classList.remove('on'));
    const td = document.querySelector(`#shGrid td[data-ref="${ref}"]`);
    if (td) td.classList.add('on');
  }

  function commit(td) {
    const ref = td.dataset.ref;
    const raw = td.textContent.replace(/\u00a0/g, ' ').trim();
    const prev = S.cells.get(ref) || '';
    // Si la celda muestra el valor ya calculado (p. ej. "500.000") y el usuario
    // no tocó nada, NO se vuelve a interpretar: se leería como 500 decimal.
    if (raw === prev || raw === fmt(S.calc.get(ref))) { paint(); return; }
    if (raw === '') S.cells.delete(ref);
    else S.cells.set(ref, raw);
    recalc();
    persist(ref);
    td.textContent = fmt(S.calc.get(ref));
    td.classList.toggle('num', typeof S.calc.get(ref) === 'number');
    td.classList.toggle('err', isErr(S.calc.get(ref)));
    paint();
    updateStat();
    if (isErr(S.calc.get(ref))) F().toast(S.calc.get(ref).code + ' en ' + ref);
  }

  function move(ref, dr, dc) {
    const p = parseRef(ref);
    if (!p) return;
    const r = Math.max(0, Math.min(ROWS - 1, p.r + dr));
    const c = Math.max(0, Math.min(COLS - 1, p.c + dc));
    const next = refOf(r, c);
    const td = document.querySelector(`#shGrid td[data-ref="${next}"]`);
    if (td) { td.focus(); if (window.getSelection) { const r2 = document.createRange(); r2.selectNodeContents(td); r2.collapse(false); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r2); } }
  }

  function wire() {
    const grid = $('#shGrid');
    if (!grid) return;

    grid.addEventListener('focusin', e => {
      const td = e.target.closest('td[data-ref]');
      if (!td) return;
      const ref = td.dataset.ref;
      setActive(ref);
      const raw = S.cells.get(ref) || '';
      td.textContent = raw;
      setTimeout(() => {
        const r = document.createRange();
        r.selectNodeContents(td); r.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
      }, 0);
    });

    grid.addEventListener('focusout', e => {
      const td = e.target.closest('td[data-ref]');
      if (td) commit(td);
    });

    grid.addEventListener('keydown', e => {
      const td = e.target.closest('td[data-ref]');
      if (!td) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const ref = td.dataset.ref;
        commit(td);
        move(ref, 1, 0);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const ref = td.dataset.ref;
        commit(td);
        move(ref, 0, e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        td.textContent = fmt(S.calc.get(td.dataset.ref));
        td.blur();
      }
    });

    const fx = $('#shFx');
    if (fx) fx.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const td = document.querySelector(`#shGrid td[data-ref="${S.active}"]`);
      if (!td) return;
      const raw = fx.value.trim();
      if (raw === '') S.cells.delete(S.active);
      else S.cells.set(S.active, raw);
      recalc(); persist(S.active);
      td.textContent = fmt(S.calc.get(S.active));
      td.classList.toggle('num', typeof S.calc.get(S.active) === 'number');
      td.classList.toggle('err', isErr(S.calc.get(S.active)));
      paint(); updateStat();
      if (isErr(S.calc.get(S.active))) F().toast(S.calc.get(S.active).code);
    });

    $('#shXlsx').onclick = exportXlsx;
    $('#shCsv').onclick = importCsv;
    $('#shDemo').onclick = demo;
    $('#shClear').onclick = () => {
      if (!confirm('¿Vaciar esta hoja?')) return;
      S.cells.clear();
      F().run('DELETE FROM cells WHERE sheet_id = ?', [S.id]);
      F().save(); recalc(); paint(); updateStat(); F().toast('Hoja vacía');
    };
  }

  /* ── datos de ejemplo (para ver el cálculo funcionando) ────────────────── */
  function demo() {
    const f = F();
    const rows = [
      ['Concepto', 'Monto', 'IVA', 'Total'],
      ['Arriendo', '450000', '=B2*0.19', '=B2+C2'],
      ['Luz', '38000', '=B3*0.19', '=B3+C3'],
      ['Internet', '24990', '=B4*0.19', '=B4+C4'],
      ['Total', '=SUMA(B2:B4)', '=SUMA(C2:C4)', '=SUMA(D2:D4)'],
      ['', '', '', ''],
      ['Promedio', '=PROMEDIO(B2:B4)', '', ''],
      ['Máximo', '=MAX(B2:B4)', '', ''],
      ['Celdas', '=CONTAR(B2:B4)', '', ''],
      ['Con IVA', '=SUMA(D2:D4)', '', '']
    ];
    rows.forEach((row, r) => row.forEach((val, c) => {
      if (val === '') return;
      const ref = refOf(r, c);
      S.cells.set(ref, val);
      f.run('INSERT OR REPLACE INTO cells(sheet_id, ref, raw) VALUES(?,?,?)', [S.id, ref, val]);
    }));
    f.run('UPDATE sheets SET name = ?, updated_at = ? WHERE id = ?', ['Gastos', Date.now(), S.id]);
    f.save();
    S.sheets = f.q('SELECT id, name FROM sheets ORDER BY id');
    recalc(); drawTabs(); paint(); updateStat();
    f.metric('planilla_demo', 1);
    f.toast('Ejemplo cargado: edita B2 y mira cómo cambian los totales');
  }

  /* ── exportar ──────────────────────────────────────────────────────────── */
  function exportXlsx() {
    const f = F();
    try {
      const out = [];
      S.sheets.forEach(sh => {
        const cells = new Map();
        f.q('SELECT ref, raw FROM cells WHERE sheet_id = ?', [sh.id]).forEach(r => cells.set(r.ref, r.raw));
        const calc = calcSheet(cells);
        let maxR = 0, maxC = 0;
        cells.forEach((_, ref) => {
          const p = parseRef(ref);
          if (!p) return;
          maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c);
        });
        const cols = [];
        for (let c = 0; c <= Math.max(maxC, 3); c++) cols.push(colLetter(c));
        const rows = [];
        for (let r = 0; r <= Math.max(maxR, 4); r++) {
          const row = [];
          for (let c = 0; c <= Math.max(maxC, 3); c++) {
            const ref = refOf(r, c);
            const raw = cells.get(ref);
            const v = calc.get(ref);
            if (raw && String(raw)[0] === '=') row.push({ v: typeof v === 'number' ? v : String(v == null ? '' : v), f: String(raw).slice(1) });
            else if (typeof v === 'number') row.push(v);
            else row.push(v == null ? '' : String(v));
          }
          rows.push(row);
        }
        out.push({ name: sh.name, cols, rows });
      });
      const bytes = XLSXW.build(out);
      XLSXW.download(bytes, 'fabri-planilla-' + Date.now() + '.xlsx');
      f.run('INSERT INTO files(name, size, mime, kind, at) VALUES(?,?,?,?,?)',
        ['planilla.xlsx', bytes.length, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'planilla', Date.now()]);
      f.save(); f.metric('export_planilla', 1);
      f.toast('XLSX con ' + S.sheets.length + ' hoja(s) y fórmulas');
    } catch (e) {
      f.toast('No pude exportar: ' + e.message);
    }
  }

  /* ── importar CSV ──────────────────────────────────────────────────────── */
  function importCsv() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.csv,text/csv,text/plain';
    inp.onchange = async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
      if (!lines.length) return F().toast('El archivo está vacío');
      const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
      const parseLine = line => {
        const out = []; let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (q) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') q = false;
            else cur += ch;
          } else if (ch === '"') q = true;
          else if (ch === sep) { out.push(cur); cur = ''; }
          else cur += ch;
        }
        out.push(cur);
        return out;
      };
      const f = F();
      let n = 0;
      lines.slice(0, ROWS).forEach((line, r) => {
        parseLine(line).slice(0, COLS).forEach((val, c) => {
          if (val === '') return;
          const ref = refOf(r, c);
          S.cells.set(ref, val);
          f.run('INSERT OR REPLACE INTO cells(sheet_id, ref, raw) VALUES(?,?,?)', [S.id, ref, val]);
          n++;
        });
      });
      f.save(); recalc(); paint(); updateStat();
      f.metric('import_csv', 1);
      f.toast(n + ' celdas importadas desde ' + file.name);
    };
    inp.click();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.Sheet = {
    mount, init,
    /* expuesto para pruebas */
    _test: {
      parse, calcSheet, fmt, colLetter, refOf, parseRef,
      setCells(cells, id) {
        S.cells = new Map(Object.entries(cells));
        S.calc = calcSheet(S.cells);
        S.id = id || S.id;
        return S.calc;
      },
      state: S
    }
  };
})();
