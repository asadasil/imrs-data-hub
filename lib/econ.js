/*!
 * econ.js 1.0.0 -- dependency-free econometrics for the IMRS Data Hub portal.
 *
 * Nowcasting and forecasting models that run in the browser (window.Econ) or in
 * Node (require / import).  The nowcasting models reproduce the Hub's Python
 * engine (uzdata/nowcast: the core model families and the extended suite)
 * number for number where the definitions match; see ECON_API.md.
 *
 * Layout: core & calendar | linalg | random | stats | series | data context &
 * information sets | models | evaluation | engine (Python parity) | runSpec.
 * ES2017, no dependencies.  All numbers are IEEE doubles; missing = NaN.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = factory();
  else root.Econ = factory();
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
'use strict';

const VERSION = '1.0.0';
const EPS = 2.220446049250313e-16;
const SEED = 20260929;

/** Error with a machine-readable ``code`` (and optional ``details``). */
class EconError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'EconError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
function fail(code, message, details) { throw new EconError(code, message, details); }
const isNum = (x) => typeof x === 'number' && x === x;
const toNum = (v) => (v === null || v === undefined || v === '' ? NaN : +v);
function nanArray(n) { const a = new Float64Array(n); a.fill(NaN); return a; }
function seq(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }
const isArrayLike = (x) => Array.isArray(x) || ArrayBuffer.isView(x);
const clean = (x) => (typeof x === 'number' && !isFinite(x) ? null : x);

// ---------------------------------------------------------------------------
// Calendar: integer day numbers (days since 1970-01-01, proleptic Gregorian,
// no time zones) and month ordinals (year * 12 + month - 1).
// ---------------------------------------------------------------------------

function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * ((m + 9) % 12) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d: doy - Math.floor((153 * mp + 2) / 5) + 1 };
}
const monthOrd = (y, m) => y * 12 + m - 1;
const ordYear = (o) => Math.floor(o / 12);
const ordMonth = (o) => o - 12 * Math.floor(o / 12) + 1;
const monthStartDay = (o) => daysFromCivil(ordYear(o), ordMonth(o), 1);
const monthEndDay = (o) => monthStartDay(o + 1) - 1;
function monthOfDay(day) { const c = civilFromDays(day); return monthOrd(c.y, c.m); }
const pad2 = (n) => (n < 10 ? '0' : '') + n;
function dayISO(day) { const c = civilFromDays(day); return `${c.y}-${pad2(c.m)}-${pad2(c.d)}`; }
function isoDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) fail('bad_date', `not a YYYY-MM-DD date: ${s}`);
  return daysFromCivil(+m[1], +m[2], +m[3]);
}
const monthISO = (o) => `${ordYear(o)}-${pad2(ordMonth(o))}`;
/** Month ordinal of the latest month whose last day is on or before ``day``. */
function lastCompleteMonth(day) { const o = monthOfDay(day); return monthEndDay(o) <= day ? o : o - 1; }

// ---------------------------------------------------------------------------
// Period codes of the Hub: 'YYYY' (A), 'YYYY-Qn' / 'YYYYQn' (Q), 'YYYY-MM' (M),
// 'YYYY-Cmm' (cumulative Jan..mm, C), 'YYYY-MM-DD' (D).
// ---------------------------------------------------------------------------

const RE_A = /^(\d{4})$/, RE_Q = /^(\d{4})-?Q([1-4])$/, RE_M = /^(\d{4})-(\d{2})$/,
  RE_C = /^(\d{4})-C(\d{2})$/, RE_D = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a Hub period code.
 * @param {string} code 'YYYY', 'YYYY-Qn' or 'YYYYQn', 'YYYY-MM', 'YYYY-Cmm', 'YYYY-MM-DD'
 * @returns {{freq:string, ord:number}|null} ``ord``: year (A), year*4+q-1 (Q), month
 *   ordinal (M, C) or day number (D); null if the code is not recognised.
 */
function parsePeriod(code) {
  const s = String(code).trim();
  let m;
  if ((m = RE_Q.exec(s))) return { freq: 'Q', ord: +m[1] * 4 + (+m[2] - 1) };
  if ((m = RE_M.exec(s))) return +m[2] >= 1 && +m[2] <= 12 ? { freq: 'M', ord: monthOrd(+m[1], +m[2]) } : null;
  if ((m = RE_D.exec(s))) return { freq: 'D', ord: daysFromCivil(+m[1], +m[2], +m[3]) };
  if ((m = RE_C.exec(s))) return +m[2] >= 1 && +m[2] <= 12 ? { freq: 'C', ord: monthOrd(+m[1], +m[2]) } : null;
  if ((m = RE_A.exec(s))) return { freq: 'A', ord: +m[1] };
  return null;
}

/**
 * Format a period ordinal.  Quarters use the engine style 'YYYYQn' unless
 * ``hub`` is true ('YYYY-Qn').
 */
function formatPeriod(freq, ord, hub) {
  switch (freq) {
    case 'A': return String(ord);
    case 'Q': return `${Math.floor(ord / 4)}${hub ? '-' : ''}Q${ord - 4 * Math.floor(ord / 4) + 1}`;
    case 'M': return monthISO(ord);
    case 'C': return `${ordYear(ord)}-C${pad2(ordMonth(ord))}`;
    case 'D': return dayISO(ord);
    default: fail('bad_freq', `unknown frequency ${freq}`);
  }
}

/** Low-frequency target calendars: months per period and the first month. */
const LOWFREQ = {
  Q: { k: 3, first: (o) => Math.floor(o / 4) * 12 + (o - 4 * Math.floor(o / 4)) * 3, ofMonth: (mo) => Math.floor(mo / 3) },
  A: { k: 12, first: (o) => o * 12, ofMonth: (mo) => Math.floor(mo / 12) },
};
function horizonsFor(freq) { const out = []; for (let h = 1; h <= LOWFREQ[freq].k; h++) out.push('H' + h); return out; }

// ---------------------------------------------------------------------------
// Linear algebra.  Matrices are arrays of rows (number[][]); vectors are
// arrays.  Routines follow LAPACK conventions so that results agree with numpy
// to rounding error.
// ---------------------------------------------------------------------------

const linalg = (function () {
  function zeros(m, n) { const A = new Array(m); for (let i = 0; i < m; i++) A[i] = new Array(n).fill(0); return A; }
  function eye(n) { const A = zeros(n, n); for (let i = 0; i < n; i++) A[i][i] = 1; return A; }
  function clone(A) { return A.map((r) => Array.from(r)); }
  function transpose(A) {
    const m = A.length, n = m ? A[0].length : 0, B = zeros(n, m);
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) B[j][i] = A[i][j];
    return B;
  }
  function matvec(A, x) {
    const out = new Array(A.length);
    for (let i = 0; i < A.length; i++) { const r = A[i]; let s = 0; for (let j = 0; j < x.length; j++) s += r[j] * x[j]; out[i] = s; }
    return out;
  }
  /** A B (B may be a vector). */
  function matmul(A, B) {
    if (!isArrayLike(B[0])) return matvec(A, B);
    const m = A.length, k = B.length, n = k ? B[0].length : 0, C = zeros(m, n);
    for (let i = 0; i < m; i++) {
      const Ai = A[i], Ci = C[i];
      for (let l = 0; l < k; l++) { const a = Ai[l], Bl = B[l]; for (let j = 0; j < n; j++) Ci[j] += a * Bl[j]; }
    }
    return C;
  }
  /** A' B without forming A'. */
  function tmatmul(A, B) {
    const m = A.length, p = m ? A[0].length : 0, n = m ? B[0].length : 0, C = zeros(p, n);
    for (let l = 0; l < m; l++) { const Al = A[l], Bl = B[l]; for (let i = 0; i < p; i++) { const a = Al[i], Ci = C[i]; for (let j = 0; j < n; j++) Ci[j] += a * Bl[j]; } }
    return C;
  }
  function dot(x, y) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * y[i]; return s; }
  const elementwise = (f) => (A, B) => (isArrayLike(A[0])
    ? A.map((r, i) => Array.from(r, (v, j) => f(v, typeof B === 'number' ? B : B[i][j])))
    : Array.from(A, (v, i) => f(v, typeof B === 'number' ? B : B[i])));
  const add = elementwise((a, b) => a + b), sub = elementwise((a, b) => a - b);
  const scale = (A, s) => elementwise((a, b) => a * b)(A, s);
  function diag(v) {
    if (isArrayLike(v[0])) return v.map((r, i) => r[i]);
    const D = zeros(v.length, v.length); for (let i = 0; i < v.length; i++) D[i][i] = v[i]; return D;
  }
  function kron(A, B) {
    const m = A.length, n = A[0].length, p = B.length, q = B[0].length, K = zeros(m * p, n * q);
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) for (let k = 0; k < p; k++) for (let l = 0; l < q; l++) K[i * p + k][j * q + l] = A[i][j] * B[k][l];
    return K;
  }
  function symmetrize(A) { return A.map((r, i) => r.map((v, j) => 0.5 * (v + A[j][i]))); }

  /** LU decomposition with partial pivoting (LAPACK getrf). */
  function lu(A) {
    const n = A.length, a = clone(A), piv = seq(n);
    let sign = 1, singular = false;
    for (let k = 0; k < n; k++) {
      let p = k, max = Math.abs(a[k][k]);
      for (let i = k + 1; i < n; i++) { const v = Math.abs(a[i][k]); if (v > max) { max = v; p = i; } }
      if (p !== k) { const t = a[p]; a[p] = a[k]; a[k] = t; const u = piv[p]; piv[p] = piv[k]; piv[k] = u; sign = -sign; }
      const akk = a[k][k];
      if (akk === 0) { singular = true; continue; }
      for (let i = k + 1; i < n; i++) {
        const f = a[i][k] / akk; a[i][k] = f;
        const ai = a[i], ak = a[k];
        for (let j = k + 1; j < n; j++) ai[j] -= f * ak[j];
      }
    }
    return { lu: a, piv, sign, singular };
  }
  /** Solve A X = B (B vector or matrix) by LU; throws code 'singular'. */
  function solve(A, B) {
    const n = A.length, f = lu(A);
    if (f.singular) fail('singular', 'singular matrix');
    const vec = !isArrayLike(B[0]), X = vec ? B.map((v) => [v]) : clone(B), k = X[0].length, a = f.lu;
    const Y = f.piv.map((p) => X[p].slice());
    for (let i = 0; i < n; i++) for (let l = 0; l < i; l++) { const c = a[i][l]; if (c !== 0) for (let j = 0; j < k; j++) Y[i][j] -= c * Y[l][j]; }
    for (let i = n - 1; i >= 0; i--) {
      for (let l = i + 1; l < n; l++) { const c = a[i][l]; for (let j = 0; j < k; j++) Y[i][j] -= c * Y[l][j]; }
      for (let j = 0; j < k; j++) Y[i][j] /= a[i][i];
    }
    return vec ? Y.map((r) => r[0]) : Y;
  }
  function inv(A) { return solve(A, eye(A.length)); }
  /** {sign, logabsdet} as numpy.linalg.slogdet. */
  function slogdet(A) {
    const f = lu(A);
    let sign = f.sign, ld = 0;
    for (let i = 0; i < A.length; i++) { const d = f.lu[i][i]; if (d === 0) return { sign: 0, logabsdet: -Infinity }; if (d < 0) sign = -sign; ld += Math.log(Math.abs(d)); }
    return { sign, logabsdet: ld };
  }
  function det(A) { const s = slogdet(A); return s.sign * Math.exp(s.logabsdet); }

  /**
   * Cholesky factor L (lower, A = L L').  ``opts.jitter`` (true or a relative
   * size) retries with jitter * mean(diag) * 10^k added to the diagonal when A
   * is not numerically positive definite; the jitter used is ``L.jitter``.
   */
  function cholesky(A, opts) {
    const n = A.length;
    const attempt = (jit) => {
      const L = zeros(n, n);
      for (let j = 0; j < n; j++) {
        let s = A[j][j] + jit; const Lj = L[j];
        for (let k = 0; k < j; k++) s -= Lj[k] * Lj[k];
        if (!(s > 0)) return null;
        const d = Math.sqrt(s); Lj[j] = d;
        for (let i = j + 1; i < n; i++) { let t = A[i][j]; const Li = L[i]; for (let k = 0; k < j; k++) t -= Li[k] * Lj[k]; Li[j] = t / d; }
      }
      return L;
    };
    let L = attempt(0);
    if (L) return L;
    if (!opts || !opts.jitter) fail('not_positive_definite', 'matrix is not positive definite');
    let md = 0; for (let i = 0; i < n; i++) md += Math.abs(A[i][i]) / n;
    let jit = (opts.jitter === true ? 1e-10 : opts.jitter) * (md > 0 ? md : 1);
    for (let t = 0; t < 12; t++, jit *= 10) { L = attempt(jit); if (L) { L.jitter = jit; return L; } }
    fail('not_positive_definite', 'matrix is not positive definite even with jitter');
  }

  // Householder reflector (LAPACK dlarfg) of x[off..off+len) with stride-1 Float64Array.
  function house(x, off, len) {
    let s = 0;
    for (let i = 1; i < len; i++) s += x[off + i] * x[off + i];
    const alpha = x[off];
    if (s === 0) return { tau: 0, beta: alpha };
    const norm = Math.hypot(alpha, Math.sqrt(s));
    const beta = alpha >= 0 ? -norm : norm, tau = (beta - alpha) / beta, sc = 1 / (alpha - beta);
    for (let i = 1; i < len; i++) x[off + i] *= sc;
    x[off] = 1;
    return { tau, beta };
  }
  // apply (I - tau v v') to column c of a (column-major, m rows) rows s..m-1; v in col j.
  function applyHouse(a, m, vcol, s, tau, tcol) {
    let d = 0;
    for (let i = s; i < m; i++) d += a[vcol + i] * a[tcol + i];
    d *= tau;
    if (d !== 0) for (let i = s; i < m; i++) a[tcol + i] -= d * a[vcol + i];
  }

  /**
   * Least squares ``min ||A x - b||`` by Householder QR with column pivoting.
   * Rank-deficient or under-determined problems get the minimum-norm solution
   * (complete orthogonal decomposition), the same solution numpy.linalg.lstsq
   * returns; rank uses rcond = eps * max(m, n) (numpy's default).
   * @param {number[][]} A m x n
   * @param {number[]|number[][]} b m vector or m x k matrix
   * @param {number} [rcond]
   * @returns {{x:number[]|number[][], rank:number}}
   */
  function lstsq(A, b, rcond) {
    const m = A.length, n = m ? A[0].length : 0, multi = isArrayLike(b[0]), k = multi ? b[0].length : 1;
    if (!m || !n) return { x: multi ? zeros(n, k) : new Array(n).fill(0), rank: 0 };
    const a = new Float64Array(m * n), bb = new Float64Array(m * k);
    for (let i = 0; i < m; i++) { const r = A[i]; for (let j = 0; j < n; j++) a[j * m + i] = r[j]; }
    for (let i = 0; i < m; i++) for (let c = 0; c < k; c++) bb[c * m + i] = multi ? b[i][c] : b[i];
    const perm = seq(n), p = Math.min(m, n), tau = new Float64Array(p), diagR = new Float64Array(p);
    const col = new Float64Array(m);
    for (let s = 0; s < p; s++) {
      let best = s, bestNorm = -1;
      for (let j = s; j < n; j++) { let t = 0; for (let i = s; i < m; i++) { const v = a[j * m + i]; t += v * v; } if (t > bestNorm) { bestNorm = t; best = j; } }
      if (best !== s) {
        for (let i = 0; i < m; i++) { const t = a[s * m + i]; a[s * m + i] = a[best * m + i]; a[best * m + i] = t; }
        const t = perm[s]; perm[s] = perm[best]; perm[best] = t;
      }
      const h = house(a, s * m + s, m - s);
      tau[s] = h.tau; diagR[s] = h.beta;
      if (h.tau !== 0) {
        for (let j = s + 1; j < n; j++) applyHouse(a, m, s * m, s, h.tau, j * m);
        for (let c = 0; c < k; c++) {
          for (let i = 0; i < m; i++) col[i] = bb[c * m + i];
          let d = 0; for (let i = s; i < m; i++) d += a[s * m + i] * col[i];
          d *= h.tau; for (let i = s; i < m; i++) bb[c * m + i] = col[i] - d * a[s * m + i];
        }
      }
    }
    const tol = (rcond === undefined || rcond === null ? EPS * Math.max(m, n) : rcond) * Math.abs(diagR[0]);
    let r = 0;
    while (r < p && Math.abs(diagR[r]) > tol) r++;
    const R = (i, j) => (i === j ? diagR[i] : a[j * m + i]);
    const X = zeros(n, k);
    if (r === n) {
      for (let c = 0; c < k; c++) {
        const xp = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) { let s = bb[c * m + i]; for (let j = i + 1; j < n; j++) s -= R(i, j) * xp[j]; xp[i] = s / R(i, i); }
        for (let j = 0; j < n; j++) X[perm[j]][c] = xp[j];
      }
    } else if (r > 0) {
      // complete orthogonal decomposition: R_top' (n x r) = Qz [U; 0]
      const z = new Float64Array(n * r), tz = new Float64Array(r), dz = new Float64Array(r);
      for (let i = 0; i < r; i++) for (let j = i; j < n; j++) z[i * n + j] = R(i, j);
      for (let s = 0; s < r; s++) {
        const h = house(z, s * n + s, n - s); tz[s] = h.tau; dz[s] = h.beta;
        if (h.tau !== 0) for (let j = s + 1; j < r; j++) applyHouse(z, n, s * n, s, h.tau, j * n);
      }
      const U = (i, j) => (i === j ? dz[i] : z[j * n + i]);   // upper triangular r x r
      for (let c = 0; c < k; c++) {
        const y = new Float64Array(n);
        for (let i = 0; i < r; i++) { let s = bb[c * m + i]; for (let l = 0; l < i; l++) s -= U(l, i) * y[l]; y[i] = s / U(i, i); }
        for (let s = r - 1; s >= 0; s--) {
          if (tz[s] === 0) continue;
          let d = y[s]; for (let i = s + 1; i < n; i++) d += z[s * n + i] * y[i];
          d *= tz[s]; y[s] -= d; for (let i = s + 1; i < n; i++) y[i] -= d * z[s * n + i];
        }
        for (let j = 0; j < n; j++) X[perm[j]][c] = y[j];
      }
    }
    return { x: multi ? X : X.map((row) => row[0]), rank: r };
  }

  /** Thin QR (Householder, no pivoting): A = Q R with Q m x n, R n x n (m >= n). */
  function qr(A) {
    const m = A.length, n = A[0].length;
    if (m < n) fail('bad_shape', 'qr needs m >= n');
    const a = new Float64Array(m * n), taus = new Float64Array(n), d = new Float64Array(n);
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) a[j * m + i] = A[i][j];
    for (let s = 0; s < n; s++) {
      const h = house(a, s * m + s, m - s); taus[s] = h.tau; d[s] = h.beta;
      if (h.tau !== 0) for (let j = s + 1; j < n; j++) applyHouse(a, m, s * m, s, h.tau, j * m);
    }
    const R = zeros(n, n);
    for (let i = 0; i < n; i++) { R[i][i] = d[i]; for (let j = i + 1; j < n; j++) R[i][j] = a[j * m + i]; }
    const Q = zeros(m, n);
    for (let c = 0; c < n; c++) {
      const e = new Float64Array(m); e[c] = 1;
      for (let s = n - 1; s >= 0; s--) {
        if (taus[s] === 0) continue;
        let t = e[s]; for (let i = s + 1; i < m; i++) t += a[s * m + i] * e[i];
        t *= taus[s]; e[s] -= t; for (let i = s + 1; i < m; i++) e[i] -= t * a[s * m + i];
      }
      for (let i = 0; i < m; i++) Q[i][c] = e[i];
    }
    return { Q, R };
  }

  /**
   * Symmetric eigen-decomposition by cyclic Jacobi rotations.
   * @param {number[][]} A symmetric n x n
   * @param {number[][]} [V0] optional orthogonal warm start (eigenvectors of a nearby matrix)
   * @returns {{values:number[], vectors:number[][]}} values descending; eigenvectors in columns
   */
  function eigh(A, V0) {
    const n = A.length, a = new Float64Array(n * n), v = new Float64Array(n * n);
    if (V0) {
      const T1 = matmul(A, V0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { let s = 0; for (let l = 0; l < n; l++) s += V0[l][i] * T1[l][j]; a[i * n + j] = s; }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const s = 0.5 * (a[i * n + j] + a[j * n + i]); a[i * n + j] = s; a[j * n + i] = s; }
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v[i * n + j] = V0[i][j];
    } else {
      for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) a[i * n + j] = A[i][j]; v[i * n + i] = 1; }
    }
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0, tot = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = a[i * n + j] * a[i * n + j]; tot += x; if (i !== j) off += x; }
      if (off <= 1e-32 * tot || off === 0) break;
      for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (apq === 0 || Math.abs(apq) < 1e-300) continue;
        const app = a[p * n + p], aqq = a[q * n + q];
        if (Math.abs(apq) <= EPS * 1e-3 * Math.sqrt(Math.abs(app * aqq))) { a[p * n + q] = 0; a[q * n + p] = 0; continue; }
        const theta = (aqq - app) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let r = 0; r < n; r++) {
          const arp = a[r * n + p], arq = a[r * n + q];
          a[r * n + p] = c * arp - s * arq; a[r * n + q] = s * arp + c * arq;
        }
        for (let r = 0; r < n; r++) {
          const apr = a[p * n + r], aqr = a[q * n + r];
          a[p * n + r] = c * apr - s * aqr; a[q * n + r] = s * apr + c * aqr;
        }
        a[p * n + q] = 0; a[q * n + p] = 0;
        for (let r = 0; r < n; r++) {
          const vrp = v[r * n + p], vrq = v[r * n + q];
          v[r * n + p] = c * vrp - s * vrq; v[r * n + q] = s * vrp + c * vrq;
        }
      }
    }
    const order = seq(n).sort((i, j) => a[j * n + j] - a[i * n + i]);
    return { values: order.map((i) => a[i * n + i]), vectors: seq(n).map((r) => order.map((i) => v[r * n + i])) };
  }

  /**
   * Thin singular value decomposition A = U diag(S) V' by one-sided Jacobi
   * (Hestenes); S descending.  Signs of singular vectors are arbitrary (as in
   * LAPACK); here the largest-magnitude entry of each column of V is positive.
   */
  function svd(A) {
    const m0 = A.length, n0 = A[0].length, tr = m0 < n0, M = tr ? transpose(A) : A;
    const m = M.length, n = M[0].length, u = new Float64Array(m * n), v = new Float64Array(n * n);
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) u[j * m + i] = M[i][j];
    for (let j = 0; j < n; j++) v[j * n + j] = 1;
    for (let sweep = 0; sweep < 80; sweep++) {
      let rotated = false;
      for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
        let al = 0, be = 0, ga = 0;
        for (let i = 0; i < m; i++) { const x = u[p * m + i], y = u[q * m + i]; al += x * x; be += y * y; ga += x * y; }
        if (ga === 0 || Math.abs(ga) <= EPS * Math.sqrt(al * be)) continue;
        rotated = true;
        const zeta = (be - al) / (2 * ga);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t), s = c * t;
        for (let i = 0; i < m; i++) { const x = u[p * m + i], y = u[q * m + i]; u[p * m + i] = c * x - s * y; u[q * m + i] = s * x + c * y; }
        for (let i = 0; i < n; i++) { const x = v[p * n + i], y = v[q * n + i]; v[p * n + i] = c * x - s * y; v[q * n + i] = s * x + c * y; }
      }
      if (!rotated) break;
    }
    const S = new Array(n);
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += u[j * m + i] * u[j * m + i]; S[j] = Math.sqrt(s); }
    const order = seq(n).sort((i, j) => S[j] - S[i]);
    const U = zeros(m, n), V = zeros(n, n), Ss = order.map((j) => S[j]);
    order.forEach((j, c) => {
      let big = 0, sg = 1;
      for (let i = 0; i < n; i++) { const x = v[j * n + i]; if (Math.abs(x) > big) { big = Math.abs(x); sg = x < 0 ? -1 : 1; } }
      for (let i = 0; i < n; i++) V[i][c] = sg * v[j * n + i];
      for (let i = 0; i < m; i++) U[i][c] = S[j] > 0 ? sg * u[j * m + i] / S[j] : 0;
    });
    return tr ? { U: V, S: Ss, V: U } : { U, S: Ss, V };
  }

  /**
   * Eigenvalues of a small general real matrix (closed form for n <= 2; else the
   * characteristic polynomial by Faddeev-LeVerrier and its roots by Durand-Kerner,
   * adequate for the n <= 6 VAR/factor transition matrices used here).
   * @returns {{re:number[], im:number[]}}
   */
  function eigvals(A) {
    const n = A.length;
    if (n === 1) return { re: [A[0][0]], im: [0] };
    if (n === 2) {
      const h = (A[0][0] + A[1][1]) / 2, disc = h * h - (A[0][0] * A[1][1] - A[0][1] * A[1][0]), s = Math.sqrt(Math.abs(disc));
      return disc >= 0 ? { re: [h + s, h - s], im: [0, 0] } : { re: [h, h], im: [s, -s] };
    }
    const c = [1]; let Mk = zeros(n, n);
    for (let k = 1; k <= n; k++) {
      Mk = matmul(A, Mk); for (let i = 0; i < n; i++) Mk[i][i] += c[k - 1];
      const AM = matmul(A, Mk); let tr = 0; for (let i = 0; i < n; i++) tr += AM[i][i];
      c.push(-tr / k);
    }
    let R = 0; for (let k = 1; k <= n; k++) R = Math.max(R, Math.pow(Math.abs(c[k]), 1 / k));
    const zr = [], zi = [];
    for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n + 0.4; zr.push((R + 1) * Math.cos(a)); zi.push((R + 1) * Math.sin(a)); }
    for (let it = 0; it < 2000; it++) {
      let delta = 0;
      for (let i = 0; i < n; i++) {
        let pr = 1, pi = 0;                                  // p(z) by Horner
        for (let k = 1; k <= n; k++) { const t = pr * zr[i] - pi * zi[i] + c[k]; pi = pr * zi[i] + pi * zr[i]; pr = t; }
        let qr = 1, qi = 0;                                  // prod_(j != i) (z_i - z_j)
        for (let j = 0; j < n; j++) if (j !== i) { const dr = zr[i] - zr[j], di = zi[i] - zi[j], t = qr * dr - qi * di; qi = qr * di + qi * dr; qr = t; }
        const den = qr * qr + qi * qi, wr = (pr * qr + pi * qi) / den, wi = (pi * qr - pr * qi) / den;
        zr[i] -= wr; zi[i] -= wi; delta = Math.max(delta, Math.hypot(wr, wi));
      }
      if (delta <= 1e-15 * (1 + R)) break;
    }
    const used = new Array(n).fill(false);          // real roots, and exact conjugate pairs
    for (let i = 0; i < n; i++) {
      if (used[i]) continue; used[i] = true;
      if (Math.abs(zi[i]) <= 1e-12 * (1 + Math.abs(zr[i]))) { zi[i] = 0; continue; }
      let j = -1, best = Infinity;
      for (let k = 0; k < n; k++) if (!used[k]) { const d = Math.hypot(zr[k] - zr[i], zi[k] + zi[i]); if (d < best) { best = d; j = k; } }
      if (j < 0) continue;
      used[j] = true; const re = (zr[i] + zr[j]) / 2, im = (Math.abs(zi[i]) + Math.abs(zi[j])) / 2;
      zr[i] = zr[j] = re; zi[i] = im; zi[j] = -im;
    }
    return { re: zr, im: zi };
  }
  /** max |eigenvalue| of a general real matrix. */
  function spectralRadius(A) { const e = eigvals(A); let r = 0; for (let i = 0; i < e.re.length; i++) r = Math.max(r, Math.hypot(e.re[i], e.im[i])); return r; }

  return { zeros, eye, clone, transpose, matmul, tmatmul, matvec, dot, add, sub, scale, diag, kron, symmetrize,
    lu, solve, inv, slogdet, det, cholesky, lstsq, qr, eigh, svd, eigvals, spectralRadius };
})();

// ---------------------------------------------------------------------------
// Random numbers.  Every generator exposes random() in [0, 1), normal(),
// gamma(shape), chisquare(df) and normals(n).
//   mulberry32(seed)  small, fast 32-bit generator (default for new models);
//   numpy(seed)       bit-exact port of numpy.random.default_rng(seed)
//                     (SeedSequence -> PCG64 -> ziggurat normals, Marsaglia-Tsang
//                     gamma) so seeded simulations match the Python engine.
// ---------------------------------------------------------------------------

const random = (function () {
  function b64(str) {
    const tbl = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const out = new Uint8Array(Math.floor(str.replace(/=+$/, '').length * 3 / 4));
    let buf = 0, bits = 0, o = 0;
    for (let i = 0; i < str.length && o < out.length; i++) {
      const v = tbl.indexOf(str[i]); if (v < 0) continue;
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
    }
    return out;
  }
  // numpy's ziggurat tables for the standard normal (ki_double, wi_double,
  // fi_double of numpy/random/src/distributions/ziggurat_constants.h, 256 entries
  // each, little-endian uint64 / float64), extracted from numpy 2.4 and verified
  // against numpy.random.Generator.standard_normal.
  let ZIG = null;
  function zig() {
    if (ZIG) return ZIG;
    const u8 = (s) => b64(s).buffer;
    const kiw = new Uint32Array(u8('au8lgD3zDgAAAAAAAAAAAKjG+5i+CAwAQoG9+lSjDQDq7sF+9lEOAH730+lVsg4Aucp+gUvvDgCqRPoKRxkPABjL/2HtNw8AXCVhlUZPDwCWoxvkpWEPAKSWU3V6cA8AmkQo7LJ8DwDTV2MM8YYPAN4lg1emjw8A2tBNxySXDwAJ9dsHqZ0PAHT6gfVgow8A+Etb3m+oDwDcVNNg8awPAA+5GGf7sA8AxnRTjZ+0DwB3/mYj7LcPAA7loensug8A7QsEnau9DwBXbP9gMMAPAEiiNxCCwg8A0VvieqbEDwAx7nqXosYPAKSWKKl6yA8Ahd5LXjLKDwAaIwLpzMsPAMQ5+BJNzQ8AmeyPTbXODwAwyR2/B9APAObE1k1G0Q8AUPTiqHLSDwAeyfBPjtMPAHi0kJma1A8AUw+SuJjVDwDsmY7AidYPADLoyKlu1w8A6Ah7VEjYDwCMLK2LF9kPANKtpwfd2Q8AjF4QcJnaDwAgLsBdTdsPAND8W1z52w8AfZq5653cDwCdchiBO90PAJAvNIjS3Q8AZJ82ZGPeDwBOUY1w7t4PAC60pgF03w8AQO2ZZfTfDwDyJLzkb+APAFiiJcLm4A8ATLgoPFnhDwCZP7yMx+EPAKoc2+kx4g8AkRvahZjiDwCGQbWP++IPAEqNVTNb4w8AKgDQmbfjDwB/rZ7pEOQPADR31EZn5A8AXAlM07rkDwAkldKuC+UPAHi8TvdZ5Q8AEhLkyKXlDwCJhhM+7+UPAHgQ2W825g8AeNXGdXvmDwCqER5mvuYPAPL05VX/5g8AAqcAWT7nDwA5nj6Ce+cPAKJwcOO25w8AQ0J3jfDnDwCM8FOQKOgPADoXNfte6A8AZAiE3JPoDwC8zvBBx+gPAPZOfTj56A8AHZuHzCnpDwDqiNMJWekPAKKak/uG6Q8AZkhxrLPpDwDVtpQm3+kPAHzmq3MJ6g8ApGbxnDLqDwAslTKrWuoPABp01aaB6g8A8Bzel6fqDwAg2fOFzOoPADzmZXjw6g8AE+wvdhPrDwBKKv6FNesPALRiMa5W6w8A+oTi9HbrDwAUIOZflusPAHydz/S06w8A0En0uNLrDwA+Lm6x7+sPAOi9HuML7A8AFVqxUifsDwDTr50EQuwPAJbxKf1b7A8A9O5sQHXsDwC0DFDSjewPABIfkbal7A8A/ifE8LzsDwAV+1SE0+wPALPIiHTp7A8At5F/xP7sDwAohTV3E+0PAANJhI8n7Q8ATC8kEDvtDwBuWK37Te0PAN3DmFRg7Q8A6E9BHXLtDwCCqeRXg+0PAMgspAaU7Q8ABLeFK6TtDwC0anTIs+0PAFJmQd/C7Q8AUm6kcdHtDwDTijyB3+0PAICZkA/t7Q8AFNQPHvrtDwDESxKuBu4PAAZa2cAS7g8A4AaQVx7uDwAkZUtzKe4PALzkChU07g8APJu4PT7uDwD0ginuR+4PAIawHSdR7g8AQX9A6VnuDwAutCg1Yu4PAPGXWAtq7g8Aegc+bHHuDwCCezJYeO4PALoGe89+7g8AskpI0oTuDwBDY7Zgiu4PAFHIzHqP7g8A2iV+IJTuDwDqKahRmO4PAFxIEw6c7g8A9HNyVZ/uDwCuzGInou4PAKxCa4Ok7g8AcS38aKbuDwD61m7Xp+4PAAr6BM6o7g8AOzPoS6nuDwAQZClQqe4PAF4HwNmo7g8AVHaJ56fuDwAkHUh4pu4PAIOeooqk7g8A2uQiHaLuDwAkIDUun+4PAC6vJryb7g8A5PIkxZfuDwA6CjxHk+4PABZ1VUCO7g8Aepw2rojuDwD9PX+Ogu4PAIi4p9577g8A/zf/m3TuDwBevanDbO4PAH4AnlJk7g8AiCijRVvuDwC2V06ZUe4PAM8GAEpH7g8AUCzhUzzuDwDYKuCyMO4PAAWCrWIk7g8AWjy4XhfuDwBHFCqiCe4PAMxJ4yf77Q8AbCF26uvtDwB+BCLk2+0PANM5zg7L7Q8A9CwEZLntDwDJOOncpu0PAI3pN3KT7Q8ANqg4HH/tDwArwLnSae0PAACuBo1T7Q8AIqTeQTztDwDYL2rnI+0PAETmL3MK7Q8ANP4H2u/sDwC4tw4Q1OwPALRulQi37A8AwTAStpjsDwB4qQ0KeewPAP4xD/VX7A8AYsmGZjXsDwA1s7RMEewPANBvjpTr6w8AkragKcTrDwDcDO71musPAEKFyeFv6w8Anh+t00LrDwBLLQuwE+sPAOkCGlni6g8AVyKZrq7qDwAm446NeOoPAOVz/c8/6g8A9tmNTATqDwA7Vi/WxekPAKRHqTuE6Q8AKEcdRz/pDwDWxXa99ugPAOboxF2q6A8A6rF64FnoDwBAqZD2BOgPAMAzgkir5w8ApWofdUznDwACoioQ6OYPANirtqB95g8AfjA4nwzmDwBC9zhzlOUPAIByl3AU5Q8AWPQ21IvkDwA3Hv2/+eMPAJyx7jVd4w8A/uQvErXiDwBXVZkDAOIPABSDeII84Q8AsGfuxGjgDwCqcSuwgt8PAKr+fsWH3g8A/TvGCXXdDwATvynlRtwPAIICLvj42g8Adbqy4YXZDwAEz0jv5tcPAAtlva0T1g8AEvDiSQHUDwCsx7SnodEPAJ4fdgTizg8AshFe2KjLDwAiLc1u0scPAO0iHi8rww8AOrjAgWW9DwA0VADEBrYPAHQoKlhArA8AmEUBHpeeDwD8HaRI+okPACww8PfFZg8AShwzS1oaDwA=')), ki = new Float64Array(256);
    for (let i = 0; i < 256; i++) ki[i] = kiw[2 * i] + kiw[2 * i + 1] * 4294967296;
    ZIG = { ki, wi: new Float64Array(u8('edkVeDtJzzzG9v3jC42LPLRbLDyvUJI8YTtEOLl8lTwMpy/o/AGYPLzQTC4MI5o892E4L00AnDx0cnRaL6ydPMPVTC1IMp88rbuOJzJNoDxDXQI7BfWgPHc2QZemkqE89Rp6j6InojyA2GM4LrWiPPWRV8A/PKM8L7GiwZ69ozxVm/+N7zmkPKf+PTa7saQ8dNMaYnUlpTyWzgengJWlPOp+2c8xAqY8PXyjYdJrpjxwBQCSotKmPKb4RtPaNqc8dyqzEK2YpzxD9UatRfinPHcKQ1PMVag8mnZ7nmSxqDyYz06pLgupPOoeLIJHY6k8RsU4jsm5qTwsp6TczA6qPFnNd21nYqo8MBYQbq20qjycbBNtsQWrPCl6QoeEVas8Op9Sjjakqzwygr8q1vGrPPNOWflwPqw8YTsypROKrDyLJnL+ydSsPEi3gA6fHq08EB/kKZ1nrTzDuCMAzq+tPFN28ak69608/u3Stes9rjwAb3oz6YOuPM6C+b06ya48JmLwhOcNrzyI9thU9lGvPK7Xh55tla88rC76fVPYrzzsNELgVg2wPJqPOfVALrA8/KUWnupOsDwQoHJbVm+wPAv0cZCGj7A8E2G8hH2vsDx/zEtmPc+wPGsIFkvI7rA87hWVMiAOsTy+DzEHRy2xPEGRjp8+TLE8HiDEvwhrsTw02ngap4mxPIht7lEbqLE8yyr4+GbGsTwu1OCTi+SxPJ+gQJmKArI86cbEcmUgsjwfw+l9HT6yPPtrqQy0W7I8f9MdZip5sjwb1xnHgZayPNouuGK7s7I8U7jhYtjQsjyOqcvo2e2yPNdIbg3BCrM8MLn04Y4nszyhXiZwRESzPNVSyrriYLM8algFvmp9szxksrJv3ZmzPAM9uL87trM84B1WmIbSszyDWnLevu6zPHSe4HHlCrQ8XXSmLfsmtDykMDzoAEO0PF3HynP3XrQ8NsNmnt96tDwvj0gyupa0PF1BAvaHsrQ83BGzrEnOtDwFpjgWAOq0PGJVXu+rBbU8WosK8k0htTxPZmrV5jy1PMiyG053WLU8eF9VDgB0tTwUhQ7GgY+1PFkbJCP9qrU8PXN90XLGtTzTjC974+G1PDhen8hP/bU8wx+jYLgYtjyisKLoHTS2PAsmtwSBT7Y8cpbJV+Jqtjw3MbGDQoa2PLGyUCmiobY8u0Oz6AG9tjxS0yhhYti2PFT4YTHE87Y862iL9ycPtzzGFGlRjiq3PNzucNz3Rbc8H3PlNWVhtzxJ9O/61ny3PJO9ushNmLc8CRSLPMqztzz7ItvzTM+3POfec4zW6rc8H+qGpGcGuDx2hsjaACK4PBWfic6iPbg8vfXRH05ZuDzFfnpvA3W4PC33R1/DkLg8Q8AFko6suDycDKGrZci4PCdqRFFJ5Lg8j7VzKToAuTxHgyjcOBy5PPwK7xJGOLk8iqIDeWJUuTzu1XC7jnC5PDEqLonLjLk8v5k/kxmpuTws2dWMecW5PBF0byvs4bk8StL6JnL+uTySNvk5DBu6PFvIoiG7N7o8iLsLnn9UujykqUpyWnG6PD0xoGRMjro8CPGfPlarujzO9VrNeMi6PDazi+G05bo8GqHDTwsDuzxbmJrwfCC7PAAM4KAKPrs8Az3OQbVbuzwniT+5fXm7PDz35fFkl7s8biWF22u1uzyiwC5rk9O7PIOugZvc8bs8oBbsbEgQvDwtevDl1y68PBwNbhOMTbw8BYfsCGZsvDwXpuvgZou8PKuiNr2Pqrw8kNY7x+HJvDw34GgwXum8PG6PizIGCb08IO83ENsovTxHxjMV3ki9PCPx55YQab08pfvX9HOJvTxwbiCZCaq9PA5J/PjSyr08Ny5SldHrvTwc0kn7Bg2+PPZG6sR0Lr48iNHBmRxQvjwl/pcvAHK+PAq/KkshlL48CG/3wIG2vjw6pxB2I9m+PKnsAWEI/L48IVPCijIfvzxtTbcPpEK/PGgBySBfZr88gpeJBGaKvzy/InEYu66/PIXnL9Jg0788C/YYwVn4vzx1oNNH1A7APEfJjwKoIcA8qwKpg6k0wDzH9T5O2kfAPH6zrfY7W8A8aCanI9BuwDwXLmOPmILAPFSi6AiXlsA8xMBxdc2qwDxI1O7RPb/APDA9qjTq08A8k2URz9TowDy2n6bv//3APEFwIARuE8E8NV27myEpwTxtCcRpHT/BPDsuYEhkVcE88+6dO/lrwTxhEtJ034LBPKzrTlYamsE8ji9/d62xwTyUpnGpnMnBPDmu5Pvr4cE8Adniwp/6wTyBzASdvBPCPO7Tb3pHLcI8JJyspEVHwjzgWHbHvGHCPC5ZqPqyfMI8eA53zS6YwjxSCipTN7TCPJfbljHU0MI89XipsQ3uwjzurlbS7AvDPKOkaF57KsM8oxKuBcRJwzxAqDN60mnDPApBVpKzisM8+oiucHWswzymBBezJ8/DPHX0YKrb8sM82uW5nKQXxDyUXlQVmD3EPBU6p0TOZMQ8vEOcdWKNxDwnWmudc7fEPAKJzQ0l48Q8QazpU58QxTxCfjpSEUDFPBvkSqmxccU82Y1xi8ClxTz+0DokitzFPEwehs9pFsY86moAe85TxjzD5Z++QJXGPDLiCY1r28Y8NHpf8CgnxzxzBglWlXnHPIzO1vQt1Mc8NPIpBQM5yDwUfKq/D6vIPJZEb5TgLsk8q1dAAe7LyTxad5R43I/KPLH9eDgfmMs8M60JgrQ7zTw=')), fi: new Float64Array(u8('AAAAAAAA8D+H8HnJakTvPxWpbFtUt+4/d/An4BE/7j+V3gSnb9PtP/K8VwaScO0/3BmheEkU7T/rLaeoM73sP394qc5eauw/6rru2Rwb7D+C3OFO687rP1L1jzplhes/EN00gjo+6z+i6Gw/KvnqPwQlevH+teo/4clQ1Yt06j8Pr/X9qjTqP9gfZe479uk/gQYkjSK56T/BemFXRn3pP0d6G8KRQuk/T3ExvfEI6T+oCuZPVdDoPwLfukitmOg/rLw3/Oth6D9uz1YPBSzoP8viIEvt9uc/WGicd5rC5z/VsKA8A4/nP1bYcAcfXOc/Em0/9OUp5z/ueuq6UPjmP4laY55Yx+Y/KjtRXveW5j8j45IqJ2fmPxgMVZjiN+Y/ZSaAmCQJ5j9q/0pv6NrlP4lcyKwpreU/j41MJuR/5T9Gno3wE1PlP9VsZVq1JuU/Z7Yg6MT65D/ATklPP8/kP3hS3HIhpOQ/ElDfX2h55D95NklKEU/kP+NfNYoZJeQ/gltYmX774z+jMa8QPtLjPw7NYqZVqeM/1QDaK8OA4z/pUPWLhFjjPzU6cMmXMOM/7zhk/foI4z/uO+pVrOHiP0qV1xSquuI/Fc2TjvKT4j/tBAUphG3iP4TbkFpdR+I/8vcvqXwh4j8glpKp4PvhP2mZVP6H1uE/EdE/V3Gx4T9QPJtwm4zhP9o5hhIFaOE/nKleEK1D4T84HzFIkh/hPxNZMqKz++A/oEJBEBDY4D+u2XCNprTgP4FdmR12keA/NjzwzH1u4D8uP6avvEvgPyqCi+ExKeA/xMq4hdwG4D+hvXuMd8nfP8oAqaedhd8/83ovyylC3z+Vj35xGv/eP1QfvSBuvN4/xcNOaiN63j+Fm1/qODjePwk6dket9t0/sVYLMn+13T8z3iZkrXTdP4AQAqE2NN0/bVuutBn03D9IqMBzVbTcP8fXALvodNw/uCwdb9I13D8XamF8EffbP5FtcdakuNs/GxMHeIt62z/KMbNixDzbP1KFoZ5O/9o/nlpfOinC2j+A2KRKU4XaP03AIOrLSNo/PoRGOZIM2j/fkx5epdDZP8bAGIQEldk/k5/g265Z2T8XyzObox7ZPxXxufzh49g/iJHeP2mp2D+2WqyoOG/YP9kNqn9PNdg/Edm4Ea371z+wFPSvUMLXP+tSkq85idc/7bHHaWdQ1z9MYak72RfXP6pMEoaO39Y/Id6IrYan1j/iyyUawW/WPxXlezc9ONY/yNKAdPoA1j9EwnZD+MnVP77u1hk2k9U/AAE9cLNc1T/tO1PCbybVP5Jtv45q8NQ/opwQV6O61D/Uaq2fGYXUP/4kw+/MT9Q/GXo10bwa1D/b0o7Q6OXTP65D8XxQsdM/eRMIaPN80z+e0fkl0UjTPy/2Wk3pFNM/Zgchdzvh0j/dP5Y+x63SPx6xTUGMetI/id4XH4pH0j+ezPd5wBTSPxaBGPYu4tE/UPDCOdWv0T/oVFTtsn3RP2fuNLvHS9E/IyTPTxMa0T/ECYdZlejQP9pCsohNt9A/NkOQjzuG0D/Z6UIiX1XQP350x/a3JNA/xZPfiYvozz81MriMEIjPP9KY6Wz+J88/RJzJpFTIzj/dPCiyEmnOP4RxRRY4Cs4/CpDHVcSrzT9PUbL4tk3NP8xvXooP8Mw/U99xmc2SzD9Hndi38DXMP6EYvnp42cs/qjGHemR9yz860cxStCHLPwcYV6Jnxso/fiYZC35ryj89fi0y9xDKP1r+0r/Stsk/J3xqXxBdyT9p+nS/rwPJP1uBkpGwqsg/OJqBihJSyD91cR9i1fnHPyOjaNP4occ/prV6nHxKxz8WR5Z+YPPGP1zyIT6knMY/nPGtokdGxj/5g/h2SvDFP2wd84ismsU/NWjIqW1FxT/BH+OtjfDEPy3O9WwMnMQ/1XUDwulHxD+uMWmLJfTDP+7X6Kq/oMM/iKu0BbhNwz9lKnyEDvvCPxoHehPDqMI/t16DotVWwj80PBglRgXCP0J9dZIUtME/Yy2o5UBjwT+5bqIdyxLBP7oJUj2zwsA/hb+4S/lywD8qfQZUnSPAPywia8s+qb8/HA5SKf8Lvz9LpZrye2++P4/odmG1070/5ZG9uas4vT8KdDtJX568PxUQC2jQBLw/M+LyeP9ruz8z9srp7NO6P4Zi6jOZPLo/GVud3ASmuT+roKR1MBC5P1Iov50ce7g/1u8+Acrmtz92EapaOVO3P0xKaXNrwLY/GE2FJGEutj+kZnRXG521P64r+gabDLU/EyIbQOF8tD+GmiYj7+2zP3A+2eTFX7M/ETGbz2bSsj+RDd1E00WyP32Jl74MurE/nRfy0BQvsT8llhUs7aSwP5fkMJ6XG7A/NW5sKywmrz+BUbJH1RauP2Lxrf4uCa0/LCooDz79qz9wXziQB/OqP2NVKfmQ6qk/q7VoKuDjqD8eJ693+96nP2TQmLPp26Y/1K3yPLLapT9dJxEOXdukP8vumM7y3aM/l/Q96Hzioj+8ah+fBemhPxGAli6Y8aA/xKUY14H4nz91jILbGhKePxoJzYMZMJw/+OsiTp9Smj8KwQC20XmYP4K/C/TapZY/ZLD78urWlD8TXquNOA2TPxIwYDQDSZE/Sd1yTyoVjz+sj08njaSLP3ikjQ0EQYg/4M8aQpbrhD+SL5UpkqWBPzdo7Phg4Xw/XbgM2aiedj/9sbADH4pwP2ewwUOfX2U/D/e5tgWmVD8=')) };
    return ZIG;
  }
  const NOR_R = 3.6541528853610088, NOR_INV_R = 0.27366123732975828;

  function withDistributions(g) {
    g.gamma = function (shape) {
      if (!(shape >= 0)) fail('bad_argument', 'gamma shape must be >= 0');
      if (shape === 0) return 0;
      if (shape < 1 || shape === 1) {
        if (shape === 1) return g.exponential();
        return g.gamma(shape + 1) * Math.pow(g.random(), 1 / shape);
      }
      const b = shape - 1 / 3, c = 1 / Math.sqrt(9 * b);
      for (;;) {
        let X, V;
        do { X = g.normal(); V = 1 + c * X; } while (V <= 0);
        V = V * V * V;
        const U = g.random();
        if (U < 1 - 0.0331 * (X * X) * (X * X)) return b * V;
        if (Math.log(U) < 0.5 * X * X + b * (1 - V + Math.log(V))) return b * V;
      }
    };
    g.chisquare = (df) => 2 * g.gamma(df / 2);
    g.exponential = () => -Math.log1p(-g.random());
    g.normals = (n) => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = g.normal(); return a; };
    return g;
  }

  /**
   * mulberry32 generator (32-bit state).  normal() uses the Marsaglia polar method.
   * @param {number} [seed=20260929]
   */
  function mulberry32(seed) {
    let a = (seed === undefined ? SEED : seed) >>> 0, spare = NaN;
    const g = { kind: 'mulberry32', seed: a };
    g.random = function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    g.normal = function () {
      if (spare === spare) { const s = spare; spare = NaN; return s; }
      let u, v, s;
      do { u = 2 * g.random() - 1; v = 2 * g.random() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
      const f = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * f;
      return u * f;
    };
    return withDistributions(g);
  }

  // SeedSequence(seed).generate_state(4, uint64) as eight uint32 words.
  function seedSequence(seed, nWords) {
    const MULT_A = 0x931e8875, MULT_B = 0x58f38ded, ML = 0xca01f9dd, MR = 0x4973f715;
    const ent = [];
    let s = Math.floor(Math.abs(seed));
    do { ent.push(s % 4294967296); s = Math.floor(s / 4294967296); } while (s > 0);
    let hc = 0x43b0d7e5;
    const hashmix = (v) => {
      v = (v ^ hc) >>> 0; hc = Math.imul(hc, MULT_A) >>> 0;
      v = Math.imul(v, hc) >>> 0; return (v ^ (v >>> 16)) >>> 0;
    };
    const mix = (x, y) => { let r = (Math.imul(ML, x) - Math.imul(MR, y)) >>> 0; return (r ^ (r >>> 16)) >>> 0; };
    const pool = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) pool[i] = hashmix(i < ent.length ? ent[i] : 0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) pool[j] = mix(pool[j], hashmix(pool[i]));
    for (let i = 4; i < ent.length; i++) for (let j = 0; j < 4; j++) pool[j] = mix(pool[j], hashmix(ent[i]));
    let hb = 0x8b51f9dd;
    const out = [];
    for (let i = 0; i < nWords; i++) {
      let v = (pool[i % 4] ^ hb) >>> 0; hb = Math.imul(hb, MULT_B) >>> 0;
      v = Math.imul(v, hb) >>> 0; out.push((v ^ (v >>> 16)) >>> 0);
    }
    return out;
  }

  /**
   * numpy-compatible generator: the same stream as numpy.random.default_rng(seed)
   * for random(), normal() (= standard_normal), gamma(shape > 1) and
   * chisquare(df > 2).  (gamma(shape <= 1) / exponential() are exact in
   * distribution but not in stream: numpy uses a second ziggurat there.)
   * @param {number} [seed=20260929] non-negative integer
   */
  function numpy(seed) {
    seed = seed === undefined ? SEED : seed;
    // 128-bit PCG state and increment as 8 little-endian 16-bit limbs
    const MUL = [0xF645, 0x9FCC, 0xDF64, 0x4385, 0x5DA4, 0x1FC6, 0xED05, 0x2360];
    const st = new Array(8).fill(0), inc = new Array(8).fill(0), acc = new Array(9);
    const w = seedSequence(seed, 8);         // uint64 v[k] = w[2k] + 2^32 w[2k+1]
    const limbs = (hi64lo, hi64hi, lo64lo, lo64hi) =>
      [lo64lo & 0xffff, lo64lo >>> 16, lo64hi & 0xffff, lo64hi >>> 16, hi64lo & 0xffff, hi64lo >>> 16, hi64hi & 0xffff, hi64hi >>> 16];
    const initstate = limbs(w[0], w[1], w[2], w[3]);   // (v0 << 64) | v1
    const initseq = limbs(w[4], w[5], w[6], w[7]);     // (v2 << 64) | v3
    let carry = 1;                                      // inc = (initseq << 1) | 1
    for (let i = 0; i < 8; i++) { const x = initseq[i] * 2 + carry; inc[i] = x & 0xffff; carry = x >>> 16; }
    function step() {
      for (let k = 0; k < 8; k++) acc[k] = inc[k];
      for (let i = 0; i < 8; i++) { const si = st[i]; if (si === 0) continue; for (let j = 0; j < 8 - i; j++) acc[i + j] += si * MUL[j]; }
      let c = 0;
      for (let k = 0; k < 8; k++) { const x = acc[k] + c; c = Math.floor(x / 65536); st[k] = x - c * 65536; }
    }
    step();
    carry = 0;
    for (let i = 0; i < 8; i++) { const x = st[i] + initstate[i] + carry; st[i] = x & 0xffff; carry = x >>> 16; }
    step();
    let hi = 0, lo = 0;            // last 64-bit output as two uint32 halves
    function next64() {
      step();
      const xh = (((st[7] << 16) | st[6]) ^ ((st[3] << 16) | st[2])) >>> 0;
      const xl = (((st[5] << 16) | st[4]) ^ ((st[1] << 16) | st[0])) >>> 0;
      const rot = st[7] >>> 10;
      if (rot === 0) { hi = xh; lo = xl; }
      else if (rot < 32) { lo = ((xl >>> rot) | (xh << (32 - rot))) >>> 0; hi = ((xh >>> rot) | (xl << (32 - rot))) >>> 0; }
      else if (rot === 32) { hi = xl; lo = xh; }
      else { const r = rot - 32; lo = ((xh >>> r) | (xl << (32 - r))) >>> 0; hi = ((xl >>> r) | (xh << (32 - r))) >>> 0; }
    }
    const g = { kind: 'numpy', seed };
    g.random = function () { next64(); return (hi * 2097152 + (lo >>> 11)) / 9007199254740992; };
    /** Raw uint64 outputs as [hi32, lo32] pairs (numpy PCG64.random_raw). */
    g.raw = function () { next64(); return [hi, lo]; };
    g.normal = function () {
      const Z = zig();
      for (;;) {
        next64();
        const idx = lo & 0xff;
        const rabs = (hi & 0x1fffffff) * 8388608 + (lo >>> 9);
        let x = rabs * Z.wi[idx];
        if ((lo >>> 8) & 1) x = -x;
        if (rabs < Z.ki[idx]) return x;
        if (idx === 0) {
          for (;;) {
            const xx = -NOR_INV_R * Math.log1p(-g.random());
            const yy = -Math.log1p(-g.random());
            if (yy + yy > xx * xx) return (Math.floor(rabs / 256) & 1) ? -(NOR_R + xx) : NOR_R + xx;
          }
        } else if ((Z.fi[idx - 1] - Z.fi[idx]) * g.random() + Z.fi[idx] < Math.exp(-0.5 * x * x)) return x;
      }
    };
    return withDistributions(g);
  }

  /** Create a generator from a spec: {rng:'numpy'|'mulberry32', seed} or an existing generator. */
  function make(spec, seed) {
    if (spec && typeof spec === 'object' && typeof spec.random === 'function') return spec;
    const kind = typeof spec === 'string' ? spec : (spec && spec.rng) || 'mulberry32';
    const s = seed !== undefined ? seed : (spec && spec.seed !== undefined ? spec.seed : SEED);
    if (kind === 'numpy') return numpy(s);
    if (kind === 'mulberry32') return mulberry32(s);
    fail('bad_rng', `unknown generator ${kind} (use 'numpy' or 'mulberry32')`);
  }

  /**
   * One draw Sigma ~ inverse-Wishart(scale, dof) via the Bartlett decomposition of
   * Sigma^-1 ~ Wishart(dof, scale^-1) (the Python engine's invwishart_draw; same
   * draw order).  E[Sigma] = scale / (dof - n - 1).
   */
  function invWishart(rng, dof, scale) {
    const n = scale.length, L = linalg.cholesky(linalg.inv(scale)), A = linalg.zeros(n, n);
    for (let i = 0; i < n; i++) {
      A[i][i] = Math.sqrt(rng.chisquare(dof - i));
      for (let j = 0; j < i; j++) A[i][j] = rng.normal();
    }
    const LA = linalg.matmul(L, A), W = linalg.matmul(LA, linalg.transpose(LA));
    return linalg.symmetrize(linalg.inv(W));
  }
  /** Draw from N(mean, cov) (Cholesky with jitter fallback). */
  function mvnormal(rng, mean, cov) {
    const L = linalg.cholesky(cov, { jitter: true }), z = mean.map(() => rng.normal());
    return mean.map((m, i) => { let s = m; for (let j = 0; j <= i; j++) s += L[i][j] * z[j]; return s; });
  }
  return { mulberry32, numpy, make, invWishart, mvnormal, seedSequence };
})();

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

const stats = (function () {
  const finite = (a) => Array.from(a).filter((x) => x === x);
  /** Sum with numpy's pairwise algorithm (bit-identical to numpy.sum of a 1-D float64 array). */
  function sum(a, lo, n) {
    lo = lo || 0; n = n === undefined ? a.length - lo : n;
    if (n < 8) { let r = -0.0; for (let i = 0; i < n; i++) r += a[lo + i]; return r; }
    if (n <= 128) {
      const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
      let i = 8;
      for (; i < n - (n % 8); i += 8) for (let k = 0; k < 8; k++) r[k] += a[lo + i + k];
      let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
      for (; i < n; i++) res += a[lo + i];
      return res;
    }
    let n2 = Math.floor(n / 2); n2 -= n2 % 8;
    return sum(a, lo, n2) + sum(a, lo + n2, n - n2);
  }
  function mean(a) { return a.length ? sum(a) / a.length : NaN; }
  /** Mean ignoring NaN (NaN when nothing is left). */
  function nanmean(a) { let s = 0, n = 0; for (let i = 0; i < a.length; i++) if (a[i] === a[i]) { s += a[i]; n++; } return n ? s / n : NaN; }
  /** Variance ignoring NaN with ``ddof`` (pandas default 1, numpy 0). */
  function variance(a, ddof) {
    ddof = ddof === undefined ? 1 : ddof;
    const x = finite(a), n = x.length;
    if (n - ddof <= 0) return NaN;
    const m = sum(x) / n;
    return sum(x.map((v) => (m - v) * (m - v))) / (n - ddof);
  }
  const std = (a, ddof) => Math.sqrt(variance(a, ddof));
  /** numpy.percentile (method 'linear') of the finite values; q in [0, 100] or an array. */
  function percentile(a, q) {
    const x = finite(a).sort((u, v) => u - v), n = x.length;
    const one = (p) => {
      if (!n) return NaN;
      const pos = (n - 1) * (p / 100), lo = Math.floor(pos), hi = Math.min(lo + 1, n - 1), t = pos - lo;
      const d = x[hi] - x[lo];
      return t >= 0.5 ? x[hi] - d * (1 - t) : x[lo] + d * t;
    };
    return Array.isArray(q) ? q.map(one) : one(q);
  }
  const quantile = (a, p) => percentile(a, Array.isArray(p) ? p.map((v) => 100 * v) : 100 * p);

  // log-gamma (Lanczos) and the regularised incomplete beta for t p-values
  function lgamma(x) {
    const c = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
      12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1; let a = 0.99999999999980993; const t = x + 7.5;
    for (let i = 0; i < 8; i++) a += c[i] / (x + i + 1);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function betacf(a, b, x) {
    const TINY = 1e-300; let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < TINY) d = TINY; d = 1 / d; let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY; c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY; c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY; d = 1 / d;
      const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  }
  function ibeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  /** Two-sided p-value of a t statistic with ``df`` degrees of freedom. */
  function tPValue(t, df) { return t === t && df > 0 ? ibeta(df / (df + t * t), df / 2, 0.5) : NaN; }

  /**
   * OLS (coefficients by linalg.lstsq) with standard errors, t, p, R2, adjusted R2,
   * sigma, Gaussian log-likelihood, AIC = -2LL + 2k, BIC = -2LL + k ln n (statsmodels).
   * @param {number[]} y
   * @param {number[][]} X n x k (include a column of ones for an intercept)
   * @param {string[]} [names]
   * @returns {{coef, names, se, t, p, n, k, rank, df, ssr, sigma, r2, adjR2, loglik, aic, bic, fitted, resid}}
   */
  function ols(y, X, names) {
    const n = y.length, k = n ? X[0].length : 0, fit = linalg.lstsq(X, y), coef = fit.x;
    const fitted = X.map((r) => linalg.dot(r, coef)), resid = y.map((v, i) => v - fitted[i]);
    const ssr = sum(resid.map((e) => e * e)), df = n - fit.rank;
    const ym = mean(y), sst = sum(y.map((v) => (v - ym) * (v - ym)));
    const hasConst = X.every((r) => r[0] === 1);
    const r2 = hasConst ? 1 - ssr / sst : 1 - ssr / sum(y.map((v) => v * v));
    const adjR2 = 1 - (1 - r2) * (n - (hasConst ? 1 : 0)) / Math.max(df, 1);
    const sigma2 = df > 0 ? ssr / df : NaN;
    let se = new Array(k).fill(NaN);
    if (df > 0 && fit.rank === k) {
      try { const V = linalg.inv(linalg.tmatmul(X, X)); se = V.map((r, i) => Math.sqrt(Math.max(r[i], 0) * sigma2)); } catch (e) { /* singular: keep NaN */ }
    }
    const t = coef.map((c, i) => c / se[i]), p = t.map((v) => tPValue(v, df));
    const loglik = -0.5 * n * (Math.log(2 * Math.PI) + Math.log(ssr / n) + 1);
    return { coef, names: names || coef.map((_, i) => 'x' + i), se, t, p, n, k, rank: fit.rank, df, ssr,
      sigma: Math.sqrt(sigma2), r2, adjR2, loglik, aic: -2 * loglik + 2 * k, bic: -2 * loglik + k * Math.log(n), fitted, resid };
  }
  /** Forecast accuracy of errors (actual - forecast): N, rmse, mae, bias. */
  function accuracy(errors) {
    const e = finite(errors);
    if (!e.length) return { N: 0, rmse: NaN, mae: NaN, bias: NaN };
    return { N: e.length, rmse: Math.sqrt(mean(e.map((v) => v * v))), mae: mean(e.map(Math.abs)), bias: mean(e) };
  }
  /**
   * Diebold-Mariano test of equal accuracy under squared loss, d = e1^2 - e2^2 over
   * the pairs where both errors exist, with the Harvey-Leybourne-Newbold (1997)
   * small-sample correction and Student t(n-1) p-values.
   * @param {number[]} e1 errors of the model
   * @param {number[]} e2 errors of the benchmark (same periods)
   * @param {number} [h] forecast horizon in periods (default 1)
   * @returns {{n:number, meanDiff:number, stat:number, pLess:number, pTwoSided:number}}
   *   pLess: one-sided p-value of "model 1 is more accurate"
   */
  function dieboldMariano(e1, e2, h) {
    h = h || 1;
    const d = [];
    for (let i = 0; i < e1.length; i++) { const a = e1[i], b = e2[i]; if (a === a && b === b && a !== null && b !== null) d.push(a * a - b * b); }
    const n = d.length, none = { n, meanDiff: NaN, stat: NaN, pLess: NaN, pTwoSided: NaN };
    if (n < 3) return none;
    const m = sum(d) / n;
    let v = 0; for (let i = 0; i < n; i++) v += (d[i] - m) * (d[i] - m); v /= n;
    for (let k = 1; k < h; k++) { let c = 0; for (let i = k; i < n; i++) c += (d[i] - m) * (d[i - k] - m); v += 2 * c / n; }
    if (!(v > 0)) return Object.assign(none, { meanDiff: m });
    const stat = m / Math.sqrt(v / n) * Math.sqrt((n + 1 - 2 * h + h * (h - 1) / n) / n), p2 = tPValue(stat, n - 1);
    return { n, meanDiff: m, stat, pLess: stat < 0 ? p2 / 2 : 1 - p2 / 2, pTwoSided: p2 };
  }
  return { sum, mean, nanmean, variance, std, percentile, quantile, ols, accuracy, tPValue, lgamma, dieboldMariano };
})();

// ---------------------------------------------------------------------------
// Series tools.  A Series is {freq, ords, values, name?, flags?}: ``ords`` are
// sorted unique period ordinals (see parsePeriod), ``values`` a Float64Array
// (NaN = missing).  All transformations align on the calendar (the value
// 12 months earlier is the one with ord - 12), never on array positions.
// ---------------------------------------------------------------------------

const series = (function () {
  const PER_YEAR = { M: 12, C: 12, Q: 4, A: 1 };

  function build(freq, ords, values, name, flags) {
    const s = { freq, ords: Array.from(ords), values: Float64Array.from(values), name: name || '' };
    if (flags) s.flags = flags;
    return s;
  }
  /**
   * Make a series from Hub period codes and values (null / undefined / '' = missing).
   * @param {string[]} periods e.g. ['2024-01', '2024-02'] or ['2024-Q1'] or daily dates
   * @param {Array<number|null>} values
   * @param {{name?:string, monthly?:boolean}} [opts] ``monthly``: read 'YYYY-MM-DD'
   *   codes as the month they fall in (e.g. month-end dates of nowcast_panel.json)
   * @returns {Series}
   */
  function make(periods, values, opts) {
    opts = opts || {};
    if (!isArrayLike(periods) || !isArrayLike(values) || periods.length !== values.length) {
      fail('bad_series', 'periods and values must be arrays of the same length');
    }
    let freq = null;
    const pairs = [];
    for (let i = 0; i < periods.length; i++) {
      let p = parsePeriod(periods[i]);
      if (!p) fail('bad_period', `unrecognised period code '${periods[i]}'`);
      if (opts.monthly && p.freq === 'D') p = { freq: 'M', ord: monthOfDay(p.ord) };
      if (freq === null) freq = p.freq;
      else if (p.freq !== freq) fail('mixed_frequencies', `series mixes ${freq} and ${p.freq} periods ('${periods[i]}')`);
      pairs.push([p.ord, toNum(values[i])]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < pairs.length; i++) if (pairs[i][0] === pairs[i - 1][0]) fail('duplicate_period', `duplicate period ${formatPeriod(freq, pairs[i][0])}`);
    return build(freq || 'M', pairs.map((p) => p[0]), pairs.map((p) => p[1]), opts.name);
  }
  /**
   * Series from a Hub shard dataset ({p: periods, r: [{k: key, v: values}]}).
   * @param {object} dataset one entry of a shard file (``shard[datasetId]``)
   * @param {string|number} key series key (``r[i].k``) or row index
   */
  function fromHub(dataset, key, opts) {
    if (!dataset || !Array.isArray(dataset.p) || !Array.isArray(dataset.r)) fail('bad_dataset', 'expected a Hub dataset {p, r}');
    const row = typeof key === 'number' ? dataset.r[key] : dataset.r.find((r) => r.k === key);
    if (!row) fail('unknown_series', `series '${key}' not in dataset`);
    return make(dataset.p, row.v, Object.assign({ name: String(row.k) }, opts || {}));
  }
  /** {periods, values} with null for missing (JSON-safe). */
  function toJSON(s, hub) { return { name: s.name, freq: s.freq, periods: s.ords.map((o) => formatPeriod(s.freq, o, hub)), values: Array.from(s.values, clean) }; }
  function lookup(s) { const m = new Map(); s.ords.forEach((o, i) => m.set(o, s.values[i])); return (o) => { const v = m.get(o); return v === undefined ? NaN : v; }; }
  /** Value at a period code or ordinal (NaN if absent). */
  function value(s, period) { const o = typeof period === 'number' ? period : parsePeriod(period).ord; return lookup(s)(o); }
  function mapPairs(s, k, f, name) { const get = lookup(s); return build(s.freq, s.ords, s.ords.map((o, i) => f(s.values[i], get(o - k))), name || s.name); }

  /** x(t - k) on the calendar (same periods as ``s``). */
  const lag = (s, k) => mapPairs(s, k === undefined ? 1 : k, (x, p) => p);
  /** x(t) - x(t - k). */
  const diff = (s, k) => mapPairs(s, k === undefined ? 1 : k, (x, p) => x - p);
  /** scale * (ln x(t) - ln x(t - k)); NaN unless both values are positive. */
  const logDiff = (s, k, scale) => mapPairs(s, k === undefined ? 1 : k, (x, p) => (x > 0 && p > 0 ? (scale === undefined ? 100 : scale) * (Math.log(x) - Math.log(p)) : NaN));
  /** 100 * (x(t) / x(t - k) - 1). */
  const pctChange = (s, k) => mapPairs(s, k === undefined ? 1 : k, (x, p) => 100 * (x / p - 1));
  /** Year-on-year change: 100*ln(x_t/x_{t-12|4|1}) (``log`` true, default) or percent. */
  function yoy(s, opts) {
    const k = PER_YEAR[s.freq]; if (!k) fail('bad_freq', `yoy needs M, Q or A data, not ${s.freq}`);
    return opts && opts.log === false ? pctChange(s, k) : logDiff(s, k);
  }
  const mapValues = (s, f) => build(s.freq, s.ords, Array.from(s.values, f), s.name);
  /** Previous-period = 100 index -> 100 * ln(index / 100) (NaN if index <= 0). */
  const momIndexLog = (s) => mapValues(s, (v) => (v > 0 ? 100 * Math.log(v / 100) : NaN));
  /** Index (same period previous year = 100) minus 100, e.g. the GDP target. */
  const indexMinus100 = (s) => mapValues(s, (v) => v - 100);

  /**
   * Year-to-date cumulative values -> flows within the calendar year
   * (flow_Jan = YTD_Jan, flow_m = YTD_m - YTD_(m-1); never across December ->
   * January; a missing previous month gives NaN).  Works on 'YYYY-MM' (M) and
   * 'YYYY-Cmm' (C) series; the result is monthly.  ``flags`` holds the quality
   * flags of the Hub engine (missing_raw, missing_previous_month,
   * unexpected_january_reset, nonpositive_monthly_flow, extreme_monthly_increment).
   */
  function decumulate(s, extremeRatio) {
    if (s.freq !== 'M' && s.freq !== 'C') fail('bad_freq', 'decumulate needs monthly YTD data (M or C codes)');
    extremeRatio = extremeRatio === undefined ? 3 : extremeRatio;
    const get = lookup(s), flows = [], flags = [];
    s.ords.forEach((o, i) => {
      const v = s.values[i], f = []; let flow;
      if (v !== v) { flow = NaN; f.push('missing_raw'); }
      else if (ordMonth(o) === 1) { flow = v; const pd = get(o - 1); if (pd === pd && v >= pd) f.push('unexpected_january_reset'); }
      else { const p = get(o - 1); flow = p === p ? v - p : NaN; if (p !== p) f.push('missing_previous_month'); }
      if (flow === flow && flow <= 0) f.push('nonpositive_monthly_flow');
      flows.push(flow); flags.push(f);
    });
    const fm = new Map(s.ords.map((o, i) => [o, flows[i]]));
    s.ords.forEach((o, i) => {
      const c = flows[i], p = fm.get(o - 1);
      if (c > 0 && p > 0 && Math.max(c / p, p / c) > extremeRatio) flags[i].push('extreme_monthly_increment');
    });
    return build('M', s.ords, flows, s.name, flags.map((f) => f.join(';')));
  }

  /**
   * Daily observations -> calendar-month table: mean of the values (the distinct
   * activation dates), number of days, and whether the download covered the
   * whole month (``coverageEnd`` / ``coverageStart`` 'YYYY-MM-DD').
   * @returns {{mean:Series, nDays:number[], complete:boolean[]}}
   */
  function dailyToMonthly(s, opts) {
    if (s.freq !== 'D') fail('bad_freq', 'dailyToMonthly needs daily data');
    opts = opts || {};
    const end = opts.coverageEnd ? isoDay(opts.coverageEnd) : null, start = opts.coverageStart ? isoDay(opts.coverageStart) : null;
    const groups = new Map();
    s.ords.forEach((d, i) => {
      const v = s.values[i]; if (v !== v) return;
      const mo = monthOfDay(d); const g = groups.get(mo) || { s: 0, n: 0 }; g.s += v; g.n++; groups.set(mo, g);
    });
    const months = Array.from(groups.keys()).sort((a, b) => a - b);
    return {
      mean: build('M', months, months.map((m) => groups.get(m).s / groups.get(m).n), s.name),
      nDays: months.map((m) => groups.get(m).n),
      complete: months.map((m) => !((end !== null && monthEndDay(m) > end) || (start !== null && monthStartDay(m) < start))),
    };
  }
  /**
   * Daily FX rates -> 100 * (ln m_t - ln m_(t-1)) of monthly means, NaN when this
   * or the previous month is partial (the Hub's FX_MONTHLY_DLOG transform).
   */
  function fxMonthlyDlog(daily, coverageEnd, coverageStart) {
    const t = dailyToMonthly(daily, { coverageEnd, coverageStart });
    const d = logDiff(t.mean, 1), comp = new Map(t.mean.ords.map((o, i) => [o, t.complete[i]]));
    const vals = d.ords.map((o, i) => {
      const prevOk = comp.has(o - 1) ? comp.get(o - 1) : true;
      return comp.get(o) && prevOk ? d.values[i] : NaN;
    });
    return build('M', d.ords, vals, daily.name);
  }
  /** Stocks dated 'YYYY-MM-01' (as of the first day) -> the previous month. */
  function firstOfMonthToPreviousMonth(s) {
    const pairs = [];
    s.ords.forEach((d, i) => { const c = civilFromDays(d); if (c.d === 1) pairs.push([monthOrd(c.y, c.m) - 1, s.values[i]]); });
    return build('M', pairs.map((p) => p[0]), pairs.map((p) => p[1]), s.name);
  }
  /** Combine two series of one frequency on their common periods with f(a, b), e.g. (x, y) => x - y. */
  function combine(a, b, f, name) {
    if (a.freq !== b.freq) fail('mixed_frequencies', 'series have different frequencies');
    const ga = lookup(a), gb = lookup(b), inB = new Set(b.ords), ords = a.ords.filter((o) => inB.has(o));
    return build(a.freq, ords, ords.map((o) => f(ga(o), gb(o))), name || a.name);
  }
  /** a / b on common periods (the Hub's 'ratio' combination). */
  const ratio = (a, b) => combine(a, b, (x, y) => (y !== 0 ? x / y : NaN));
  /** Midpoint of consecutive values ((x_t + x_(t-1)) / 2), e.g. the gold-price proxy. */
  const midpoint = (s) => mapPairs(s, 1, (x, p) => (x + p) / 2);

  /**
   * Named transformations (Hub registry codes and lowercase aliases):
   * GDP_TARGET|index_minus_100, DECUM_YOY|decum_yoy_log, DECUM_LEVEL|decum,
   * MOM_INDEX_LOG|mom_index_log, FX_MONTHLY_DLOG|fx_monthly_dlog (daily input,
   * opts.coverageEnd), PRICE_DLOG|logdiff, STOCK_YOY / FLOW_YOY|yoy_log, yoy_pct,
   * diff, log, level|none.
   */
  function transform(s, code, opts) {
    const c = String(code || 'none').toLowerCase();
    switch (c) {
      case 'none': case 'level': case 'raw': return s;
      case 'gdp_target': case 'index_minus_100': return indexMinus100(s);
      case 'decum_yoy': case 'decum_yoy_log': return logDiff(decumulate(s), 12);
      case 'decum_level': case 'decum': case 'decumulate': return decumulate(s);
      case 'mom_index_log': return momIndexLog(s);
      case 'fx_monthly_dlog': return fxMonthlyDlog(s, opts && opts.coverageEnd, opts && opts.coverageStart);
      case 'price_dlog': case 'logdiff': case 'dlog': return logDiff(s, 1);
      case 'stock_yoy': case 'flow_yoy': case 'yoy_log': case 'yoy': return yoy(s);
      case 'yoy_pct': return yoy(s, { log: false });
      case 'diff': return diff(s, 1);
      case 'pct': return pctChange(s, 1);
      case 'log': return mapValues(s, (v) => (v > 0 ? Math.log(v) : NaN));
      default: fail('bad_transform', `unknown transform '${code}'`);
    }
  }

  /**
   * Aggregate a monthly series to quarters ('Q') or years ('A').
   * @param {Series} s monthly
   * @param {'Q'|'A'} to
   * @param {'mean'|'sum'|'last'|'first'} [method='mean'] mean/sum of the observed months
   * @param {{through?:number|string, mask?:function(number):boolean, complete?:boolean}} [opts]
   *   visibility: only months <= ``through`` (month ordinal or 'YYYY-MM') or with
   *   mask(ord) true are used; ``complete`` requires every month of the period.
   */
  function aggregate(s, to, method, opts) {
    if (s.freq !== 'M' && s.freq !== 'C') fail('bad_freq', 'aggregate needs monthly data');
    const lf = LOWFREQ[to]; if (!lf) fail('bad_freq', `aggregate to 'Q' or 'A', not ${to}`);
    opts = opts || {}; method = method || 'mean';
    const through = opts.through === undefined ? Infinity : (typeof opts.through === 'number' ? opts.through : parsePeriod(opts.through).ord);
    const groups = new Map();
    s.ords.forEach((o, i) => {
      const v = s.values[i];
      if (o > through || (opts.mask && !opts.mask(o))) return;
      const p = lf.ofMonth(o), g = groups.get(p) || []; if (v === v) g.push([o, v]); groups.set(p, g);
    });
    const ords = Array.from(groups.keys()).sort((a, b) => a - b);
    const vals = ords.map((p) => {
      const g = groups.get(p);
      if (!g.length || (opts.complete && g.length < lf.k)) return NaN;
      if (method === 'sum') return g.reduce((a, x) => a + x[1], 0);
      if (method === 'last') return g[g.length - 1][1];
      if (method === 'first') return g[0][1];
      return g.reduce((a, x) => a + x[1], 0) / g.length;
    });
    return build(to, ords, vals, s.name);
  }
  /**
   * Standardise with the mean and population s.d. of the training values only.
   * @param {ArrayLike<number>} values
   * @param {ArrayLike<boolean>|function(number):boolean} train which positions are training
   * @returns {{z:Float64Array, mean:number, sd:number}}
   */
  function standardize(values, train) {
    const inTrain = typeof train === 'function' ? train : (i) => !!train[i];
    const tr = []; for (let i = 0; i < values.length; i++) if (inTrain(i) && values[i] === values[i]) tr.push(values[i]);
    const mu = stats.mean(tr); let sd = Math.sqrt(stats.variance(tr, 0));
    if (!(sd > 0)) sd = 1;
    return { z: Float64Array.from(values, (v) => (v - mu) / sd), mean: mu, sd };
  }
  /**
   * Convert a series to frequency ``freq`` ('M', 'Q' or 'A'): higher frequencies
   * are aggregated (daily -> monthly mean first; ``method`` mean|sum|last|first),
   * lower frequencies are placed in the last month / quarter of their period.
   */
  function toFreq(s, freq, method) {
    if (s.freq === 'C') s = build('M', s.ords, s.values, s.name);
    if (s.freq === freq) return s;
    if (s.freq === 'D') return toFreq(dailyToMonthly(s).mean, freq, method);
    const rank = { M: 0, Q: 1, A: 2 };
    if (!(freq in rank)) fail('bad_freq', `cannot convert to ${freq}`);
    if (rank[s.freq] < rank[freq]) {
      if (s.freq === 'M') return aggregate(s, freq, method);
      const g = new Map();                                   // Q -> A
      s.ords.forEach((o, i) => { const y = Math.floor(o / 4), a = g.get(y) || []; if (s.values[i] === s.values[i]) a.push(s.values[i]); g.set(y, a); });
      const ys = Array.from(g.keys()).sort((a, b) => a - b), f = { sum: (a) => a.reduce((x, y) => x + y, 0), last: (a) => a[a.length - 1], first: (a) => a[0] };
      return build('A', ys, ys.map((y) => { const a = g.get(y); return !a.length ? NaN : (f[method] ? f[method](a) : a.reduce((x, v) => x + v, 0) / a.length); }), s.name);
    }
    const last = s.freq === 'A' ? (freq === 'Q' ? (o) => o * 4 + 3 : (o) => o * 12 + 11) : (o) => LOWFREQ.Q.first(o) + 2;
    return build(freq, s.ords.map(last), s.values, s.name);
  }
  /**
   * Put series on a common calendar of frequency ``opts.freq`` (default: the
   * lowest frequency among them), converting with toFreq.
   * @param {Series[]} list
   * @param {{freq?:'M'|'Q'|'A', method?:string, start?:string|number, end?:string|number}} [opts]
   * @returns {{freq:string, ords:number[], periods:string[], names:string[], columns:Float64Array[]}}
   */
  function align(list, opts) {
    opts = opts || {};
    const rank = { D: -1, M: 0, C: 0, Q: 1, A: 2 };
    const freq = opts.freq || list.map((s) => s.freq).reduce((a, f) => (rank[f] > rank[a] ? f : a), 'M');
    const conv = list.map((s) => toFreq(s, freq === 'C' ? 'M' : freq, opts.method));
    const f2 = freq === 'C' || freq === 'D' ? 'M' : freq, toOrd = (v) => (typeof v === 'number' ? v : parsePeriod(v).ord);
    let lo = Infinity, hi = -Infinity;
    conv.forEach((s) => { if (s.ords.length) { lo = Math.min(lo, s.ords[0]); hi = Math.max(hi, s.ords[s.ords.length - 1]); } });
    if (opts.start !== undefined) lo = toOrd(opts.start);
    if (opts.end !== undefined) hi = toOrd(opts.end);
    const ords = []; for (let o = lo; o <= hi; o++) ords.push(o);
    const columns = conv.map((s) => { const g = lookup(s); return Float64Array.from(ords, g); });
    return { freq: f2, ords, periods: ords.map((o) => formatPeriod(f2, o)), names: list.map((s, i) => s.name || 'x' + i), columns };
  }
  return { make, fromHub, toJSON, value, lag, diff, logDiff, combine, pctChange, yoy, momIndexLog, indexMinus100, decumulate,
    dailyToMonthly, fxMonthlyDlog, firstOfMonthToPreviousMonth, ratio, midpoint, transform, aggregate, toFreq, standardize, align,
    parsePeriod, formatPeriod };
})();

// ---------------------------------------------------------------------------
// Information sets (release-lag rule of vendor/data.py)
// ---------------------------------------------------------------------------

const LAG_MODES = ['standard', 'conservative'];
/** Assumed publication lag: standard = max(lag, 0); conservative = max(lag + 15, 3). */
function effectiveLag(lagDays, mode) {
  if (mode === 'standard') return Math.max(Math.trunc(lagDays), 0);
  if (mode === 'conservative') return Math.max(Math.trunc(lagDays) + 15, 3);
  fail('bad_lag_mode', `unknown lag mode '${mode}' (use 'standard' or 'conservative')`);
}
/**
 * Latest reference month usable at ``originDay``: the largest month m with
 * end(m) + effective lag <= origin (month ordinal).
 */
function cutoffMonth(originDay, lagDays, mode) {
  const cand = originDay - effectiveLag(lagDays, mode), m = monthOfDay(cand);
  return monthEndDay(m) === cand ? m : m - 1;
}
/** Is a low-frequency target period published at ``day`` (end + lag <= day)? */
function targetReleased(freq, ord, day, lagDays, mode) {
  const lf = LOWFREQ[freq], end = monthEndDay(lf.first(ord) + lf.k - 1);
  return end + effectiveLag(lagDays === undefined ? 30 : lagDays, mode || 'standard') <= day;
}

const info = {
  LAG_MODES, effectiveLag, cutoffMonth, targetReleased,
  /** Horizon cutoff date 'YYYY-MM-DD' of a quarter ('2026Q3', 'H2' -> '2026-08-31') or year. */
  originDate(period, horizon) {
    const p = parsePeriod(period); if (!p || !LOWFREQ[p.freq]) fail('bad_period', `not a quarter/year: ${period}`);
    const h = +String(horizon).replace(/^H/i, ''); if (!(h >= 1 && h <= LOWFREQ[p.freq].k)) fail('bad_horizon', `bad horizon ${horizon}`);
    return dayISO(monthEndDay(LOWFREQ[p.freq].first(p.ord) + h - 1));
  },
  /** Is GDP of ``quarter`` published at ``date`` (quarter end + lag <= date; lag 31 days, +15 conservative)? */
  gdpReleased(quarter, date, lagDays, mode) { const p = parsePeriod(quarter); return targetReleased(p.freq, p.ord, isoDay(date), lagDays === undefined ? 31 : lagDays, mode); },
  /** Latest usable month 'YYYY-MM' of a variable with ``lagDays`` at ``date``. */
  latestUsableMonth(date, lagDays, mode) { return monthISO(cutoffMonth(isoDay(date), lagDays, mode || 'standard')); },
  horizons: horizonsFor,
};

// ---------------------------------------------------------------------------
// Data context: monthly predictors on a contiguous calendar, a quarterly (or
// annual) target, release lags, and caches of everything the models share.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Origin forecast origin: target period + horizon + lag mode
 * @property {string} period target period label ('2026Q3')
 * @property {number} ord period ordinal
 * @property {string} horizon 'H1'..'H3' (quarters) / 'H1'..'H12' (years)
 * @property {string} lagMode 'standard' | 'conservative'
 * @property {string} date origin date (last day of the horizon month)
 */
class NowcastData {
  /**
   * @param {object} o
   * @param {number|string} o.monthStart first month ('YYYY-MM' or ordinal)
   * @param {string[]} o.fields monthly predictor names
   * @param {Object<string, ArrayLike<number>>} o.values per field, aligned from monthStart (null = missing)
   * @param {Object<string, number>} [o.lags] release lag (days) per field (default 30)
   * @param {{name?:string, freq?:'Q'|'A', periods:string[], values:number[], lagDays?:number}} o.target
   * @param {object} [o.meta] per-field metadata (key, tier, name, transform)
   * @param {string} [o.asOf] information date 'YYYY-MM-DD'
   * @param {number|string} [o.vendorStart] first month seen by the core models (default monthStart)
   * @param {number|string} [o.arStart] first month of the AR used to extend series (default monthStart)
   * @param {{record_first:string, production_first:string, train_start:string, early_train_start:string,
   *   min_record_train?:number}} [o.training] the Hub's training-window rule (nowcast_panel.json
   *   release_rule.training): targets from production_first train on the periods from train_start, earlier
   *   targets (the early track record) on the periods from early_train_start.  Without it every model trains
   *   on all earlier periods.
   */
  constructor(o) {
    const toMonth = (v, d) => (v === undefined || v === null ? d : (typeof v === 'number' ? v : parsePeriod(v).ord));
    this.monthStart = toMonth(o.monthStart);
    if (!isNum(this.monthStart)) fail('bad_data', 'monthStart is required');
    let n = 0;
    (o.fields || []).forEach((f) => { n = Math.max(n, o.values[f] ? o.values[f].length : 0); });
    this.nMonths = o.nMonths || n;
    this.fields = [];
    this.values = {};
    this.lags = {};
    this.meta = {};
    (o.fields || []).forEach((f) => this._setField(f, o.values[f], o.lags && o.lags[f], o.meta && o.meta[f]));
    const t = o.target || {};
    const freq = t.freq || 'Q';
    if (!LOWFREQ[freq]) fail('bad_data', `target frequency must be Q or A, not ${freq}`);
    this.freq = freq;
    this.trainingRule = o.training || null;
    this.training = null;
    if (o.training) {
      const tq = (s, k) => { const p = parsePeriod(s); if (!p || p.freq !== freq) fail('bad_period', `training.${k} '${s}' is not ${freq === 'Q' ? 'a quarter' : 'a year'}`); return p.ord; };
      const r = o.training;
      this.training = { recordFirst: tq(r.record_first, 'record_first'), productionFirst: tq(r.production_first, 'production_first'),
        trainStart: tq(r.train_start, 'train_start'), earlyTrainStart: tq(r.early_train_start, 'early_train_start'),
        minRecordTrain: r.min_record_train === undefined || r.min_record_train === null ? 8 : +r.min_record_train };
    }
    this.targetName = t.name || 'target';
    this.targetLagDays = t.lagDays === undefined ? 31 : t.lagDays;
    const pairs = [];
    (t.periods || []).forEach((p, i) => {
      const q = parsePeriod(p);
      if (!q || q.freq !== freq) fail('bad_period', `target period '${p}' is not ${freq === 'Q' ? 'a quarter' : 'a year'}`);
      const v = toNum(t.values[i]); if (v === v) pairs.push([q.ord, v]);
    });
    pairs.sort((a, b) => a[0] - b[0]);
    this.periods = pairs.map((p) => p[0]);
    this.yv = new Map(pairs);
    this.asOf = o.asOf || null;
    this.vendorStart = toMonth(o.vendorStart, this.monthStart);
    this.arStart = toMonth(o.arStart, this.monthStart);
    this.source = o.source || 'custom';
    this.extra = o.extra || {};
    this._cache = new Map();
  }
  _setField(name, vals, lag, meta) {
    const a = nanArray(this.nMonths);
    if (vals) for (let i = 0; i < Math.min(vals.length, this.nMonths); i++) a[i] = toNum(vals[i]);
    if (!this.values[name]) this.fields.push(name);
    this.values[name] = a;
    this.lags[name] = lag === undefined || lag === null ? 30 : +lag;
    this.meta[name] = meta || {};
    this._cache = new Map();
  }
  /**
   * Add (or replace) a monthly predictor from a Series (e.g. a transformed Hub
   * series); values outside the context calendar are ignored.
   */
  addMonthly(name, s, opts) {
    opts = opts || {};
    if (s.freq !== 'M') fail('bad_freq', `monthly predictor '${name}' must be monthly (transform or aggregate it first)`);
    const a = nanArray(this.nMonths);
    s.ords.forEach((o, i) => { const k = o - this.monthStart; if (k >= 0 && k < this.nMonths) a[k] = s.values[i]; });
    this._setField(name, a, opts.lagDays, Object.assign({ name }, opts.meta || {}));
    return this;
  }
  get monthEnd() { return this.monthStart + this.nMonths - 1; }
  /** Target value of a period ordinal (NaN if unknown). */
  y(ord) { const v = this.yv.get(ord); return v === undefined ? NaN : v; }
  has(field) { return Object.prototype.hasOwnProperty.call(this.values, field); }
  /** Requested fields present in the data (a missing series never crashes a model). */
  present(fields) { return fields.filter((f) => this.has(f)); }
  periodLabel(ord) { return formatPeriod(this.freq, ord); }
  periodOrd(p) {
    if (typeof p === 'number') return p;
    const q = parsePeriod(p); if (!q || q.freq !== this.freq) fail('bad_period', `'${p}' is not a ${this.freq === 'Q' ? 'quarter' : 'year'}`);
    return q.ord;
  }
  /** Months (ordinals) of a target period. */
  periodMonths(ord) { const lf = LOWFREQ[this.freq], f = lf.first(ord), out = []; for (let i = 0; i < lf.k; i++) out.push(f + i); return out; }
  /**
   * Forecast origin of ``period`` at ``horizon`` (end of the h-th month of the period).
   * @returns {Origin}
   */
  origin(period, horizon, lagMode) {
    const ord = this.periodOrd(period), lf = LOWFREQ[this.freq];
    const hs = String(horizon || 'H' + lf.k).toUpperCase(), h = +hs.replace(/^H/, '');
    if (!(h >= 1 && h <= lf.k) || !/^H\d+$/.test(hs)) fail('bad_horizon', `horizon must be H1..H${lf.k}, not '${horizon}'`);
    lagMode = lagMode || 'standard';
    effectiveLag(0, lagMode);
    const day = monthEndDay(lf.first(ord) + h - 1);
    return { period: this.periodLabel(ord), ord, horizon: 'H' + h, h, lagMode, day, date: dayISO(day), month: lastCompleteMonth(day) };
  }
  /** Information set at an origin: last visible month per field (cached). */
  info(origin) {
    const key = `i|${origin.day}|${origin.lagMode}`;
    let r = this._cache.get(key);
    if (!r) {
      const cut = {};
      for (const f of this.fields) cut[f] = Math.min(origin.month, cutoffMonth(origin.day, this.lags[f], origin.lagMode));
      r = { day: origin.day, month: origin.month, cut };
      this._cache.set(key, r);
    }
    return r;
  }
  /** Visible value of ``field`` in month ``m`` at an information set (NaN if not released). */
  visible(field, m, inf) {
    if (m > inf.cut[field] || m < this.monthStart) return NaN;
    const k = m - this.monthStart; return k < this.nMonths ? this.values[field][k] : NaN;
  }
  /** First training period of target ``ord`` under the training rule (-Infinity without one). */
  trainStartOrd(ord) {
    const r = this.training;
    return r ? (ord >= r.productionFirst ? r.trainStart : r.earlyTrainStart) : -Infinity;
  }
  /** First earlier target whose errors may weight a combination for target ``ord``: production_first for
   *  production targets, record_first for the early record (engine models.history_start); null without a rule. */
  historyStartOrd(ord) {
    const r = this.training;
    return r ? (ord >= r.productionFirst ? r.productionFirst : r.recordFirst) : null;
  }
  /** Targets of the pseudo-real-time track record (engine models.evaluation_targets): with a training rule,
   *  the periods from record_first with at least min_record_train training periods; else those with at
   *  least ``MIN_TRAIN`` earlier periods. */
  recordTargets() {
    const r = this.training;
    if (!r) return this.periods.filter((_, i) => i >= MIN_TRAIN);
    return this.periods.filter((q) => { if (q < r.recordFirst) return false; const s = this.trainStartOrd(q); let n = 0; for (const p of this.periods) if (p < q && p >= s) n++; return n >= r.minRecordTrain; });
  }
  /** Training set for an origin: every target period before it with a known value, from the training start. */
  train(origin, opts) {
    const s0 = this.trainStartOrd(origin.ord);
    const before = this.periods.filter((p) => p < origin.ord && p >= s0);
    let periods = before;
    if (opts && opts.gdpReleaseLag) periods = before.filter((p) => targetReleased(this.freq, p, origin.day, this.targetLagDays, origin.lagMode));
    return { ctx: this, origin, target: origin.ord, periods, horizon: origin.horizon, lagMode: origin.lagMode };
  }
  _cached(key, fn) { let v = this._cache.get(key); if (v === undefined) { v = fn(); this._cache.set(key, v); } return v; }
  /**
   * Mean of the visible months of ``period`` at its own horizon origin, per
   * field (vendor bridge.aggregate_monthly_to_quarter).
   */
  visibleMean(period, horizon, mode, start) {
    start = start === undefined ? this.monthStart : start;
    return this._cached(`vm|${period}|${horizon}|${mode}|${start}`, () => {
      const o = this.origin(period, horizon, mode), inf = this.info(o), months = this.periodMonths(period).filter((m) => m >= start && m <= o.month);
      const out = {};
      for (const f of this.fields) {
        let s = 0, n = 0;
        for (const m of months) { const v = this.visible(f, m, inf); if (v === v) { s += v; n++; } }
        out[f] = n ? s / n : NaN;
      }
      return out;
    });
  }
  /**
   * Number of released months of ``field`` inside the target period at an origin.
   */
  visibleCount(origin, field) {
    const inf = this.info(origin); let n = 0;
    for (const m of this.periodMonths(origin.ord)) { const v = m <= origin.month ? this.visible(field, m, inf) : NaN; if (v === v) n++; }
    return n;
  }
  /**
   * Last ``n`` visible monthly values per field (oldest first) at the horizon
   * origin of ``period``; NaN-filled when fewer than n exist since ``start``
   * (vendor midas._monthly_lag_vector / engine Context.last_visible).
   */
  lastVisible(period, horizon, mode, n, start) {
    start = start === undefined ? this.monthStart : start;
    return this._cached(`lv|${period}|${horizon}|${mode}|${n}|${start}`, () => {
      const o = this.origin(period, horizon, mode), inf = this.info(o), out = {};
      for (const f of this.fields) {
        const vals = [];
        for (let m = Math.min(inf.cut[f], o.month); m >= start && vals.length < n; m--) { const v = this.visible(f, m, inf); if (v === v) vals.push(v); }
        out[f] = vals.length < n ? nanArray(n) : Float64Array.from(vals.reverse());
      }
      return out;
    });
  }
  /** Months (ordinals, oldest first) behind lastVisible(...)[field]; null when fewer than n are visible. */
  lastVisibleMonths(period, horizon, mode, n, start, field) {
    start = start === undefined ? this.monthStart : start;
    const o = this.origin(period, horizon, mode), inf = this.info(o), out = [];
    for (let m = Math.min(inf.cut[field], o.month); m >= start && out.length < n; m--) { const v = this.visible(field, m, inf); if (v === v) out.push(m); }
    return out.length < n ? null : out.reverse();
  }
  /** Months averaged by visibleMean(...)[field]: released months of the period up to its horizon origin. */
  visibleMonthsIn(period, horizon, mode, start, field) {
    start = start === undefined ? this.monthStart : start;
    const o = this.origin(period, horizon, mode), inf = this.info(o);
    return this.periodMonths(this.periodOrd(period)).filter((m) => { if (m < start || m > o.month) return false; const v = this.visible(field, m, inf); return v === v; });
  }
  /**
   * The visible series of ``field`` at an origin, extended to the end of the
   * target period by an AR(p), p <= 3 chosen by BIC (engine models.ar_extend).
   * @returns {{start:number, values:Float64Array, p:number}} values from monthStart
   */
  extended(origin, field, pmax) {
    pmax = pmax || 3;
    return this._cached(`ext|${origin.day}|${origin.lagMode}|${origin.ord}|${field}|${pmax}`, () => {
      const inf = this.info(origin), endM = this.periodMonths(origin.ord).slice(-1)[0], len = endM - this.monthStart + 1;
      const out = nanArray(len);
      let last = -1;
      for (let k = 0; k < len; k++) { const v = this.visible(field, this.monthStart + k, inf); out[k] = v; if (v === v) last = k; }
      // (last / arFrom / coef / bics describe the extension for the workings view)
      if (last < 0 || last >= len - 1) return { start: this.monthStart, values: out, p: 0, last: last < 0 ? null : this.monthStart + last, bics: [] };
      const h0 = Math.max(this.arStart - this.monthStart, 0), vals = out.subarray(h0, last + 1);
      let best = null;
      const bics = [];
      for (let p = 1; p <= pmax; p++) {
        if (vals.length <= p + 5) continue;
        const X = [], Y = [];
        for (let t = p; t < vals.length; t++) {
          const row = [1]; let ok = vals[t] === vals[t];
          for (let j = 1; j <= p; j++) { const v = vals[t - j]; row.push(v); if (v !== v) ok = false; }
          if (ok) { X.push(row); Y.push(vals[t]); }
        }
        const nn = Y.length;
        if (nn < 3 * (p + 1) + 5) continue;
        const coef = linalg.lstsq(X, Y).x;
        let ss = 0; for (let i = 0; i < nn; i++) { const e = Y[i] - linalg.dot(X[i], coef); ss += e * e; }
        const bic = nn * Math.log(Math.max(ss / nn, 1e-12)) + (p + 1) * Math.log(nn);
        bics.push({ p, n: nn, ssr: ss, bic, coef });
        if (best === null || bic < best.bic) best = { bic, p, coef };
      }
      if (!best) return { start: this.monthStart, values: out, p: 0, last: this.monthStart + last, bics };
      for (let k = last + 1; k < len; k++) {
        let d = 0, ok = true;
        for (let j = 1; j <= best.p; j++) { const v = out[k - j]; if (v !== v) { ok = false; break; } d += best.coef[j] * v; }
        if (!ok) break;
        out[k] = best.coef[0] + d;
      }
      return { start: this.monthStart, values: out, p: best.p, coef: best.coef, bics, last: this.monthStart + last, arFrom: this.monthStart + h0 };
    });
  }
  /**
   * Data availability at an origin (run.py data_availability): per field the
   * latest usable month, the latest month due under the lag rule, the latest
   * month in the data, months behind, released months inside the target period
   * and a status (Available | Awaiting release | Missing).
   */
  availability(origin) {
    const inf = this.info(origin), me = (m) => (m === null ? null : dayISO(monthEndDay(m))), rows = [];
    let eligible = 0;
    this.fields.forEach((f) => {
      const a = this.values[f]; let lastHub = null, lastUse = null;
      for (let k = 0; k < this.nMonths; k++) if (a[k] === a[k]) { lastHub = this.monthStart + k; if (this.monthStart + k <= inf.cut[f]) lastUse = this.monthStart + k; }
      const due = cutoffMonth(origin.day, this.lags[f], origin.lagMode), tq = this.visibleCount(origin, f);
      eligible += tq;
      rows.push({ key: this.meta[f].key || f, field: f, lag_days: this.lags[f], latest_usable: me(lastUse), latest_due: me(due), latest_in_hub: me(lastHub),
        months_behind: lastUse === null ? null : due - lastUse, target_quarter_months: tq,
        status: lastHub === null ? 'Missing' : (lastUse === null ? 'Awaiting release' : 'Available') });
    });
    const count = (s) => rows.filter((r) => r.status === s).length, usable = rows.map((r) => r.latest_usable).filter(Boolean).sort();
    return { summary: { registered: rows.length, available: count('Available'), awaiting_release: count('Awaiting release'), missing: count('Missing'),
      up_to_date: rows.filter((r) => r.months_behind === 0).length }, rows, latest_usable_reference_period: usable.length ? usable[usable.length - 1] : null,
      release_eligible_target_quarter_records: eligible, origin: origin.date, lag_mode: origin.lagMode };
  }
  /** Means per target period of a monthly array starting at ``start`` (NaN-skipping). */
  periodMeans(values, start) {
    const lf = LOWFREQ[this.freq], sums = new Map();
    for (let k = 0; k < values.length; k++) {
      const v = values[k], p = lf.ofMonth(start + k), g = sums.get(p) || [0, 0];
      if (v === v) { g[0] += v; g[1]++; }
      sums.set(p, g);
    }
    const out = new Map(); sums.forEach((g, p) => out.set(p, g[1] ? g[0] / g[1] : NaN));
    return out;
  }
  /** AR-extended period means of ``field`` at an origin (Map period ord -> mean). */
  extendedMeans(origin, field) {
    return this._cached(`em|${origin.day}|${origin.lagMode}|${origin.ord}|${field}`, () => { const e = this.extended(origin, field); return this.periodMeans(e.values, e.start); });
  }
  /**
   * Production origin at ``asOf`` (default: the data's as-of date): target =
   * period after the latest published target value (target lag, default 31
   * days, when ``asOf`` is earlier than the data), stage = latest horizon
   * cutoff on or before ``asOf`` (run.py rule).
   */
  productionOrigin(asOf, lagMode, opts) {
    asOf = asOf || this.asOf; if (!asOf) fail('missing_as_of', 'an as-of date is needed for the production origin');
    const day = isoDay(asOf);
    let known = this.periods;
    if (opts && opts.applyTargetLag) known = known.filter((p) => targetReleased(this.freq, p, day, this.targetLagDays, 'standard'));
    if (!known.length) fail('no_target', 'no published target value');
    const target = known[known.length - 1] + 1, lf = LOWFREQ[this.freq];
    let stage = null, note = null;
    for (let h = 1; h <= lf.k; h++) if (monthEndDay(lf.first(target) + h - 1) <= day) stage = h;
    if (stage === null) { stage = 1; note = 'before_H1_cutoff'; }
    else if (stage === lf.k && monthEndDay(lf.first(target) + lf.k - 1) < day) note = 'quarter_closed_awaiting_gdp';
    const o = this.origin(target, 'H' + stage, lagMode || 'standard');
    o.stageNote = note;
    return o;
  }
  /**
   * Build a context from nowcast_panel.json (schema imrs-nowcast-panel/1).
   * @param {object} json parsed panel
   */
  static fromPanel(json) {
    if (!json || !json.monthly || !json.quarterly) fail('bad_panel', 'expected nowcast_panel.json (monthly, quarterly)');
    if (json.schema && !/^imrs-nowcast-panel\//.test(json.schema)) fail('bad_panel', `unsupported schema ${json.schema}`);
    const m = json.monthly, first = parsePeriod(m.dates[0]);
    if (!first || first.freq !== 'D') fail('bad_panel', 'monthly.dates must be month-end dates');
    const monthStart = monthOfDay(first.ord);
    m.dates.forEach((d, i) => { if (monthOfDay(isoDay(d)) !== monthStart + i) fail('bad_panel', 'monthly.dates must be consecutive months'); });
    const lags = {}, meta = {};
    (json.variables || []).forEach((v) => {
      if (v.tier === 'target') return;
      lags[v.field] = v.lag_days === null || v.lag_days === undefined ? 30 : v.lag_days;
      meta[v.field] = { key: v.key, name: v.name, tier: v.tier, transform: v.transform, block: v.block, unit: v.unit };
    });
    const tv = (json.variables || []).find((v) => v.tier === 'target') || {};
    const trn = (json.release_rule && json.release_rule.training) || null;
    // first month the core models see (engine VENDOR_PANEL_START) and of the AR used to extend series
    const vp = trn && trn.vendor_panel_start ? parsePeriod(trn.vendor_panel_start) : null;
    const vendor = vp && vp.freq === 'M' ? vp.ord : monthOrd(2015, 1), ar = monthOrd(2014, 1);
    const ctx = new NowcastData({
      monthStart, nMonths: m.dates.length, fields: m.fields, values: m.values, lags, meta,
      target: { name: tv.field || 'gdp_real_yoy_pct', freq: 'Q', periods: json.quarterly.quarters, values: json.quarterly.gdp_real_yoy_pct,
        lagDays: json.release_rule && json.release_rule.gdp_lag_days !== undefined ? json.release_rule.gdp_lag_days : 31 },
      asOf: json.as_of, vendorStart: Math.max(vendor, monthStart), arStart: Math.max(ar, monthStart), source: 'imrs-nowcast-panel',
      training: trn,
      extra: { tiers: json.tiers || null, modelFields: json.model_fields || null, bvarFields: json.bvar_fields || null,
        fxCoverageEnd: json.fx_coverage_end || null, ytd: parseYtd(json.ytd) },
    });
    return ctx;
  }
  /**
   * Build a context from generic Hub series.
   * @param {object} o
   * @param {object} o.target {name, periods, values, transform?, lagDays?} quarterly ('YYYY-Qn') or annual
   * @param {Array<object>} o.monthly [{name, periods, values, transform?, lagDays?, coverageEnd?}]:
   *   monthly, cumulative ('YYYY-Cmm'), daily (with transform fx_monthly_dlog) or quarterly/annual
   *   series (placed in the last month of their period)
   * @param {string} [o.asOf]
   * @param {string} [o.start] first month (default: earliest predictor month)
   * @param {{periods:string[], values:number[], name?:string}} [o.nominal] year-to-date nominal GDP by quarter:
   *   with it, models can run in quarterly form (form: 'quarter')
   */
  static fromSeries(o) {
    if (!o || !o.target) fail('bad_data', 'fromSeries needs a target series');
    let ts = series.make(o.target.periods, o.target.values, { name: o.target.name });
    ts = series.transform(ts, o.target.transform);
    if (!LOWFREQ[ts.freq]) fail('bad_data', 'the target must be quarterly or annual');
    const monthly = (o.monthly || []).map((d, i) => {
      if (!d || !d.name) fail('bad_data', `monthly[${i}] needs a name`);
      let s = d.series || series.make(d.periods, d.values, { name: d.name });
      s = series.transform(s, d.transform, { coverageEnd: d.coverageEnd });
      if (LOWFREQ[s.freq]) {       // quarterly / annual predictor: value in the last month of its period
        const lf = LOWFREQ[s.freq];
        s = { freq: 'M', ords: s.ords.map((p) => lf.first(p) + lf.k - 1), values: s.values, name: d.name };
      } else if (s.freq === 'C') s = { freq: 'M', ords: s.ords, values: s.values, name: d.name };
      if (s.freq !== 'M') fail('bad_data', `predictor '${d.name}' is ${s.freq}; give a transform that makes it monthly`);
      return { d, s };
    });
    let lo = Infinity, hi = -Infinity;
    monthly.forEach(({ s }) => { if (s.ords.length) { lo = Math.min(lo, s.ords[0]); hi = Math.max(hi, s.ords[s.ords.length - 1]); } });
    const lf = LOWFREQ[ts.freq];
    if (ts.ords.length) hi = Math.max(hi, lf.first(ts.ords[ts.ords.length - 1] + 1) + lf.k - 1);
    if (o.asOf) hi = Math.max(hi, monthOfDay(isoDay(o.asOf)));
    if (o.start) lo = parsePeriod(o.start).ord;
    if (!isFinite(lo)) lo = ts.ords.length ? lf.first(ts.ords[0]) : 0;
    const ctx = new NowcastData({ monthStart: lo, nMonths: hi - lo + 1, fields: [], values: {},
      target: { name: ts.name || o.target.name, freq: ts.freq, periods: ts.ords.map((p) => formatPeriod(ts.freq, p)), values: Array.from(ts.values), lagDays: o.target.lagDays },
      asOf: o.asOf, source: 'series' });
    monthly.forEach(({ d, s }) => ctx.addMonthly(d.name, s, { lagDays: d.lagDays, meta: { transform: d.transform || 'none' } }));
    if (o.nominal && o.nominal.periods) {
      const ng = new Map();
      o.nominal.periods.forEach((p, i) => { const q = parsePeriod(p), v = toNum(o.nominal.values[i]); if (q && q.freq === 'Q' && v === v) ng.set(formatPeriod('Q', q.ord), v); });
      ctx.extra.nominalGDP = ng;
      ctx.extra.nominalSource = o.nominal.name || 'given series';
    }
    return ctx;
  }
}

// ---------------------------------------------------------------------------
// Models.  Every model: model.fit(train) -> fitted, fitted.predict(origin) ->
// {model, family, period, horizon, lagMode, origin, value, coefficients,
// diagnostics, failure}; model.nowcast(ctx, origin) = fit(ctx.train(origin))
// .predict(origin).  ``train`` = ctx.train(origin): every target period before
// the origin's period, regressors built at the same horizon and lag mode (the
// pseudo-real-time convention).  A model never throws on data
// problems: it returns value NaN and a ``failure`` code.
// ---------------------------------------------------------------------------

const MIN_TRAIN = 12;
const minRowsRule = (params) => Math.max(MIN_TRAIN, 3 * params);   // effective-training safeguard
// Set only while workings() re-estimates a model: fits then keep their intermediate
// results in diagnostics.trace and predictions in diagnostics.trace_now.
let TRACE = false;

function makeModel(family, name, options, fitFn) {
  const model = { family, name, options: options || {} };
  model.fit = function (train) {
    if (!train || !train.ctx || !train.origin) fail('bad_train', 'fit(train) expects ctx.train(origin)');
    let f;
    try { f = fitFn(train) || {}; } catch (e) {
      if (!(e instanceof EconError)) throw e;
      f = { failure: `${e.code}: ${e.message}` };
    }
    const fitted = {
      model, train, coefficients: f.coefficients || {}, diagnostics: f.diagnostics || {}, failure: f.failure || null,
      predict(origin) {
        origin = origin || train.origin;
        let out = { value: NaN, failure: fitted.failure };
        if (!fitted.failure) {
          try { out = f.predict(origin) || out; } catch (e) {
            if (!(e instanceof EconError)) throw e;
            out = { value: NaN, failure: `${e.code}: ${e.message}` };
          }
        }
        const value = isNum(out.value) ? out.value : NaN;
        return { model: name, family, period: origin.period, horizon: origin.horizon, lagMode: origin.lagMode, origin: origin.date,
          value, coefficients: out.coefficients || fitted.coefficients,
          diagnostics: Object.assign({}, fitted.diagnostics, out.diagnostics || {}), failure: out.failure || null };
      },
    };
    return fitted;
  };
  model.nowcast = (ctx, origin) => model.fit(ctx.train(origin)).predict(origin);
  return model;
}
const named = (names, coef) => { const o = {}; names.forEach((n, i) => { o[n] = coef[i]; }); return o; };
const hasNaN = (a) => { for (let i = 0; i < a.length; i++) if (a[i] !== a[i]) return true; return false; };
function needField(ctx, f) { if (!ctx.has(f)) fail('unknown_field', `predictor '${f}' is not in the data`); }
/** OLS fit + standard diagnostics block (fitted values keyed by period). */
function olsBlock(ctx, Y, X, names, periods) {
  const o = stats.ols(Y, X, names);
  const k = X[0].length;
  const diagnostics = {
    n_train: Y.length, residual_variance: o.ssr / Math.max(Y.length - k, 1), r2: o.r2, adj_r2: o.adjR2, sigma: o.sigma,
    aic: o.aic, bic: o.bic, se: named(names, o.se), t: named(names, o.t), p: named(names, o.p),
    fitted: periods.map((p, i) => ({ period: ctx.periodLabel(p), actual: Y[i], fitted: o.fitted[i], residual: o.resid[i] })) };
  if (TRACE) diagnostics.trace = { design: { columns: names.slice(), periods: periods.map((p) => ctx.periodLabel(p)), X: X.map((r) => Array.from(r)), y: Array.from(Y) } };
  return { o, coefficients: named(names, o.coef), diagnostics };
}
const dotc = (coef, x) => { let d = 0; for (let j = 1; j < coef.length; j++) d += coef[j] * x[j]; return coef[0] + d; };
// numpy ``coef @ x`` (sequential sum including the intercept term)
const npdot = (coef, x) => { let d = 0; for (let j = 0; j < coef.length; j++) d += coef[j] * x[j]; return d; };

/**
 * Historical mean of the target over the training periods.
 * @param {{name?:string}} [opts]
 */
function historicalMean(opts) {
  opts = opts || {};
  return makeModel('benchmark', opts.name || 'historical_mean', opts, (train) => {
    const ys = train.periods.map((p) => train.ctx.y(p));
    if (!ys.length) return { failure: 'historical mean requires at least one training observation' };
    const m = stats.sum(ys) / ys.length, diagnostics = { n_train: ys.length };
    if (TRACE) diagnostics.trace = { kind: 'mean', periods: train.periods.map((p) => train.ctx.periodLabel(p)), y: ys };
    return { coefficients: { mean: m }, diagnostics, predict: () => ({ value: m }) };
  });
}

/**
 * AR(p) on the target by OLS, y_t = c + phi_1 y_(t-1) + ... + phi_p y_(t-p)
 * (vendor benchmarks.fit_ar: lags by position among the known values).
 * @param {{p?:number, name?:string}} [opts]
 */
function ar(opts) {
  opts = opts || {};
  const p = opts.p === undefined ? 1 : opts.p;
  if (!(Number.isInteger(p) && p >= 1)) fail('bad_option', 'AR order p must be an integer >= 1');
  return makeModel('benchmark', opts.name || `ar${p}`, opts, (train) => {
    const ctx = train.ctx, v = train.periods.map((q) => ctx.y(q));
    if (v.length <= p) return { failure: `AR(${p}) needs more than ${p} training observations; got ${v.length}` };
    const Y = [], X = [];
    for (let t = p; t < v.length; t++) { const r = [1]; for (let j = 1; j <= p; j++) r.push(v[t - j]); X.push(r); Y.push(v[t]); }
    const names = ['intercept']; for (let j = 1; j <= p; j++) names.push(`ar${j}`);
    const b = olsBlock(ctx, Y, X, names, train.periods.slice(p));
    const coef = b.o.coef;
    if (TRACE) Object.assign(b.diagnostics.trace, { kind: 'ar', p });
    return { coefficients: b.coefficients, diagnostics: b.diagnostics, predict: () => {
      const x = [1]; for (let j = 1; j <= p; j++) x.push(v[v.length - j]);
      const out = { value: dotc(coef, x) };
      if (TRACE) out.diagnostics = { trace_now: { x, lagPeriods: seq(p).map((j) => ctx.periodLabel(train.periods[train.periods.length - 1 - j])) } };
      return out;
    } };
  });
}

// --- MIDAS -------------------------------------------------------------------

/** Exponential Almon weights w_j ~ exp(t1 j + t2 j^2), j = 0 (newest)..K-1. */
function expalmonWeights(t1, t2, K) {
  const z = []; let mx = -Infinity;
  for (let j = 0; j < K; j++) { const v = t1 * j + t2 * j * j; z.push(v); if (v > mx) mx = v; }
  const w = z.map((v) => Math.exp(v - mx)); let s = 0; for (let j = 0; j < K; j++) s += w[j];
  return w.map((v) => v / s);
}
/** Normalised Beta lag weights (Ghysels, Sinko & Valkanov 2007), j = 0 (newest)..K-1. */
function betaWeights(a, b, K, eps) {
  eps = eps === undefined ? 1e-3 : eps;
  const w = []; let s = 0;
  for (let j = 0; j < K; j++) { const x = eps + (1 - 2 * eps) * j / Math.max(K - 1, 1); const v = Math.pow(x, a - 1) * Math.pow(1 - x, b - 1); w.push(v); s += v; }
  return w.map((v) => v / s);
}
const EXPALMON_GRID = [], BETA_GRID = [];
for (let i = 0; i <= 10; i++) for (const t2 of [0.0, -0.02, -0.05, -0.1, -0.2, -0.35, -0.5]) EXPALMON_GRID.push([i === 10 ? 1 : i * 0.2 - 1, t2]);
for (const a of [1.0, 1.25, 1.5, 2.0, 3.0, 5.0]) for (const b of [1.0, 1.5, 2.0, 3.0, 5.0, 8.0, 12.0]) BETA_GRID.push([a, b]);

/**
 * MIDAS: y_t = a + b0 y_(t-1) + sum_l g_l x_(m(t,h)-l), m(t,h) = latest visible month.
 * weighting 'umidas' (free g_l; default K=3) | 'almon' (polynomial of degree ``poly``
 * in l/(K-1), oldest lag first) | 'expalmon' | 'beta' (g_l = b1 w_l(theta), K=6;
 * theta on the engine's grid, estimation 'nls' refines it by Levenberg-Marquardt).
 * @param {{predictor:string, lags?:number, weighting?:string, poly?:number,
 *   estimation?:'grid'|'nls', minRows?:number, name?:string}} opts
 */
function midas(opts) {
  opts = opts || {};
  const f = opts.predictor, wt = opts.weighting || 'umidas';
  if (!f) fail('bad_option', 'midas needs a predictor');
  if (['umidas', 'almon', 'expalmon', 'beta'].indexOf(wt) < 0) fail('bad_option', `unknown MIDAS weighting '${wt}'`);
  const nls = wt === 'expalmon' || wt === 'beta';
  const K = opts.lags === undefined ? (nls ? 6 : 3) : opts.lags;
  if (!(Number.isInteger(K) && K >= 1)) fail('bad_option', 'MIDAS lags must be an integer >= 1');
  const poly = opts.poly === undefined ? 1 : opts.poly;
  const name = opts.name || (wt === 'umidas' ? `umidas_${f}` : wt === 'almon' ? `almon_${f}` : `midas_${wt}_${f}`);
  if (nls) return midasNLS(f, wt, K, name, opts);
  const minRows = opts.minRows === undefined ? minRowsRule(2 + (wt === 'almon' ? poly + 1 : K)) : opts.minRows;
  const basis = [];
  for (let l = 0; l < K; l++) { const x = l / Math.max(K - 1, 1), r = []; for (let d = 0; d <= poly; d++) r.push(Math.pow(x, d)); basis.push(r); }
  const regs = (v) => (wt === 'almon' ? basis[0].map((_, d) => { let s = 0; for (let l = 0; l < K; l++) s += v[l] * basis[l][d]; return s; }) : Array.from(v));
  return makeModel('midas', name, opts, (train) => {
    const ctx = train.ctx; needField(ctx, f);
    const start = ctx.vendorStart, P = train.periods, X = [], Y = [], used = [], rows = TRACE ? [] : null;
    P.forEach((q, i) => {
      const v = ctx.lastVisible(q, train.horizon, train.lagMode, K, start)[f], y = ctx.y(q), g = i > 0 ? ctx.y(P[i - 1]) : NaN;
      if (hasNaN(v) || y !== y || g !== g) return;
      X.push([1, g].concat(regs(v))); Y.push(y); used.push(q);
      if (rows) rows.push({ raw: Array.from(v), months: ctx.lastVisibleMonths(q, train.horizon, train.lagMode, K, start, f), gdpLag: ctx.periodLabel(P[i - 1]) });
    });
    if (!X.length) return { failure: `MIDAS spec ${name} has no training rows` };
    const names = ['intercept', 'gdp_lag1'].concat(wt === 'almon' ? basis[0].map((_, d) => `almon_${d}`) : seq(K).map((l) => `${f}@m${l === K - 1 ? '' : '-' + (K - 1 - l)}`));
    const b = olsBlock(ctx, Y, X, names, used), coef = b.o.coef;
    if (TRACE) Object.assign(b.diagnostics.trace, { kind: 'midas', field: f, K, weighting: wt, poly, basis: wt === 'almon' ? basis : null, rows, start, minRows });
    return { coefficients: b.coefficients, diagnostics: b.diagnostics, predict: (origin) => {
      const v = ctx.lastVisible(origin.ord, origin.horizon, origin.lagMode, K, start)[f];
      if (hasNaN(v)) return { value: NaN, failure: 'missing_monthly_lags_at_target' };
      const g = ctx.y(P[P.length - 1]);
      if (g !== g) return { value: NaN, failure: 'missing_gdp_lag_at_target' };
      const value = npdot(coef, [1, g].concat(regs(v)));
      if (value === value && Y.length < minRows) return { value: NaN, failure: 'insufficient_effective_training' };
      const out = { value, diagnostics: { lags_at_origin: Array.from(v) } };
      if (TRACE) out.diagnostics.trace_now = { x: [1, g].concat(regs(v)), raw: Array.from(v), months: ctx.lastVisibleMonths(origin.ord, origin.horizon, origin.lagMode, K, start, f), gdpLag: ctx.periodLabel(P[P.length - 1]) };
      return out;
    } };
  });
}

function midasNLS(f, wt, K, name, opts) {
  const minRows = opts.minRows === undefined ? MIN_TRAIN : opts.minRows;
  const grid = wt === 'expalmon' ? EXPALMON_GRID : BETA_GRID;
  const wfun = (th) => (wt === 'expalmon' ? expalmonWeights(th[0], th[1], K) : betaWeights(th[0], th[1], K));
  const W = grid.map(wfun);
  const profile = (L, y, g, w) => {
    const X = L.map((r, i) => { let s = 0; for (let j = 0; j < K; j++) s += r[j] * w[j]; return [1, g[i], s]; });
    const coef = linalg.lstsq(X, y).x;
    let ssr = 0; for (let i = 0; i < y.length; i++) { const e = y[i] - npdot(coef, X[i]); ssr += e * e; }
    return { coef, ssr, X };
  };
  return makeModel('midas_nls', name, opts, (train) => {
    const ctx = train.ctx; needField(ctx, f);
    const P = train.periods, L = [], y = [], g = [], used = [], tr = TRACE ? { months: [], gdpLag: [], gridSSR: [] } : null;
    P.forEach((q, i) => {
      if (i === 0) return;
      const v = ctx.lastVisible(q, train.horizon, train.lagMode, K, ctx.monthStart)[f];
      if (hasNaN(v)) return;
      L.push(Array.from(v).reverse()); y.push(ctx.y(q)); g.push(ctx.y(P[i - 1])); used.push(q);
      if (tr) { tr.months.push(ctx.lastVisibleMonths(q, train.horizon, train.lagMode, K, ctx.monthStart, f).reverse()); tr.gdpLag.push(ctx.periodLabel(P[i - 1])); }
    });
    const vT = ctx.lastVisible(train.origin.ord, train.horizon, train.lagMode, K, ctx.monthStart)[f];
    const diag = { n_train: y.length };
    if (y.length < minRows || hasNaN(vT)) return { failure: y.length < minRows ? 'insufficient_effective_training' : 'missing_target_lags', diagnostics: diag };
    let best = null;
    W.forEach((w, gi) => { const r = profile(L, y, g, w); if (tr) tr.gridSSR.push(r.ssr); if (best === null || r.ssr < best.ssr - 1e-12) best = { ssr: r.ssr, gi, coef: r.coef, theta: grid[gi].slice(), w }; });
    diag.grid_ssr = best.ssr;
    if (opts.estimation === 'nls') {
      // Levenberg-Marquardt on theta (variable projection; beta shapes on the log scale)
      const toU = (th) => (wt === 'beta' ? th.map(Math.log) : th.slice()), fromU = (u) => (wt === 'beta' ? u.map(Math.exp) : u.slice());
      const resid = (u) => { const r = profile(L, y, g, wfun(fromU(u))); return { r: y.map((v, i) => v - npdot(r.coef, r.X[i])), ssr: r.ssr, coef: r.coef }; };
      let u = toU(best.theta), cur = resid(u), mu = 1e-3, it = 0;
      for (; it < 200; it++) {
        const J = u.map((_, k) => { const h = 1e-6 * Math.max(1, Math.abs(u[k])), up = u.slice(), dn = u.slice(); up[k] += h; dn[k] -= h; const a = resid(up).r, c = resid(dn).r; return a.map((v, i) => -(v - c[i]) / (2 * h)); });
        const JtJ = [[linalg.dot(J[0], J[0]), linalg.dot(J[0], J[1])], [linalg.dot(J[1], J[0]), linalg.dot(J[1], J[1])]];
        const Jtr = [linalg.dot(J[0], cur.r), linalg.dot(J[1], cur.r)];
        let improved = false;
        for (let tries = 0; tries < 20 && !improved; tries++) {
          let d;
          try { d = linalg.solve([[JtJ[0][0] * (1 + mu), JtJ[0][1]], [JtJ[1][0], JtJ[1][1] * (1 + mu)]], Jtr); } catch (e) { mu *= 10; continue; }
          const un = [u[0] + d[0], u[1] + d[1]];
          if (un.every(isFinite) && Math.abs(un[0]) < 50 && Math.abs(un[1]) < 50) {
            const nx = resid(un);
            if (nx.ssr < cur.ssr) { const rel = (cur.ssr - nx.ssr) / Math.max(cur.ssr, 1e-300); u = un; cur = nx; mu = Math.max(mu / 3, 1e-12); improved = true; if (rel < 1e-12) it = 1e9; }
          }
          if (!improved) mu *= 10;
        }
        if (!improved) break;
      }
      const th = fromU(u), w = wfun(th);
      best = { ssr: cur.ssr, gi: -1, coef: cur.coef, theta: th, w };
      diag.nls_ssr = cur.ssr;
    }
    diag.theta = best.theta; diag.weights = best.w;
    const names = ['intercept', 'gdp_lag1', `${f}_weighted`];
    const coefs = Object.assign(named(names, best.coef), wt === 'expalmon' ? { theta1: best.theta[0], theta2: best.theta[1] } : { a: best.theta[0], b: best.theta[1] });
    const fittedRows = L.map((r, i) => { let s = 0; for (let j = 0; j < K; j++) s += r[j] * best.w[j]; const fv = npdot(best.coef, [1, g[i], s]); return { period: ctx.periodLabel(used[i]), actual: y[i], fitted: fv, residual: y[i] - fv }; });
    diag.fitted = fittedRows;
    if (tr) {
      const S = L.map((r) => { let s = 0; for (let j = 0; j < K; j++) s += r[j] * best.w[j]; return s; });
      diag.trace = Object.assign(tr, { kind: 'midas_nls', field: f, K, weighting: wt, grid: grid.map((t) => t.slice()), bestIndex: best.gi, theta: best.theta.slice(),
        weights: Array.from(best.w), estimation: opts.estimation || 'grid', ssr: best.ssr, L: L.map((r) => r.slice()), S, minRows,
        design: { columns: names.slice(), periods: used.map((q) => ctx.periodLabel(q)), X: L.map((r, i) => [1, g[i], S[i]]), y: y.slice() } });
    }
    return { coefficients: coefs, diagnostics: diag, predict: (origin) => {
      const v = ctx.lastVisible(origin.ord, origin.horizon, origin.lagMode, K, ctx.monthStart)[f];
      if (hasNaN(v)) return { value: NaN, failure: 'missing_target_lags' };
      const rv = Array.from(v).reverse(); let s = 0; for (let j = 0; j < K; j++) s += rv[j] * best.w[j];
      const out = { value: npdot(best.coef, [1, ctx.y(P[P.length - 1]), s]) };
      if (TRACE) out.diagnostics = { trace_now: { raw: rv, months: ctx.lastVisibleMonths(origin.ord, origin.horizon, origin.lagMode, K, ctx.monthStart, f).reverse(), s, x: [1, ctx.y(P[P.length - 1]), s], gdpLag: ctx.periodLabel(P[P.length - 1]) } };
      return out;
    } };
  });
}

// --- Bridge equations ----------------------------------------------------------

/**
 * Bridge equation y_t = a + b0 y_(t-1) + sum_k b_k xbar_t^(k).  extension 'none':
 * xbar = mean of the months visible at t's own horizon origin (core
 * bridge.py); 'ar': complete period means, unreleased months of the target period
 * forecast by an AR(p <= 3, BIC) (the engine's bridge_ar models).
 * @param {{predictors:string[], extension?:'none'|'ar', minRows?:number, name?:string}} opts
 */
function bridge(opts) {
  opts = opts || {};
  const fields = opts.predictors || (opts.predictor ? [opts.predictor] : null);
  if (!fields || !fields.length) fail('bad_option', 'bridge needs predictors');
  const ext = opts.extension || 'none';
  if (ext !== 'none' && ext !== 'ar') fail('bad_option', `bridge extension must be 'none' or 'ar'`);
  const name = opts.name || (ext === 'ar' ? 'bridge_ar_' : 'bridge_') + fields.join('+');
  const names = ['intercept', 'gdp_lag1'].concat(fields);
  if (ext === 'ar') {
    const minRows = opts.minRows === undefined ? MIN_TRAIN : opts.minRows;
    return makeModel('bridge_ar', name, opts, (train) => {
      const ctx = train.ctx; fields.forEach((f) => needField(ctx, f));
      const P = train.periods, means = fields.map((f) => ctx.extendedMeans(train.origin, f)), X = [], Y = [], used = [];
      P.forEach((q, i) => {
        if (i === 0) return;
        const xs = means.map((m) => (m.has(q) ? m.get(q) : NaN));
        if (hasNaN(xs)) return;
        X.push([1, ctx.y(P[i - 1])].concat(xs)); Y.push(ctx.y(q)); used.push(q);
      });
      const diag = { n_train: Y.length, ar_order: named(fields, fields.map((f) => ctx.extended(train.origin, f).p)),
        months_visible: named(fields, fields.map((f) => ctx.visibleCount(train.origin, f))) };
      const aggT = means.map((m) => (m.has(train.origin.ord) ? m.get(train.origin.ord) : NaN));
      if (Y.length < minRows || hasNaN(aggT)) return { failure: Y.length < minRows ? 'insufficient_effective_training' : 'no_target_aggregate', diagnostics: diag };
      const b = olsBlock(ctx, Y, X, names, used), coef = b.o.coef;
      if (TRACE) Object.assign(b.diagnostics.trace, { kind: 'bridge_ar', fields, gdpLag: used.map((q) => ctx.periodLabel(P[P.indexOf(q) - 1])), ext: fields.map((f) => ctx.extended(train.origin, f)) });
      return { coefficients: b.coefficients, diagnostics: Object.assign(b.diagnostics, diag), predict: (origin) => {
        const agg = fields.map((f) => { const m = ctx.extendedMeans(origin, f); return m.has(origin.ord) ? m.get(origin.ord) : NaN; });
        if (hasNaN(agg)) return { value: NaN, failure: 'no_target_aggregate' };
        const out = { value: npdot(coef, [1, ctx.y(P[P.length - 1])].concat(agg)), diagnostics: { target_aggregate: named(fields, agg) } };
        if (TRACE) out.diagnostics.trace_now = { x: [1, ctx.y(P[P.length - 1])].concat(agg), gdpLag: ctx.periodLabel(P[P.length - 1]), ext: fields.map((f) => ctx.extended(origin, f)) };
        return out;
      } };
    });
  }
  const minRows = opts.minRows === undefined ? minRowsRule(2 + fields.length) : opts.minRows;
  return makeModel('bridge', name, opts, (train) => {
    const ctx = train.ctx; fields.forEach((f) => needField(ctx, f));
    const start = ctx.vendorStart, P = train.periods, X = [], Y = [], used = [], rows = TRACE ? [] : null;
    P.forEach((q, i) => {
      const agg = ctx.visibleMean(q, train.horizon, train.lagMode, start), g = i > 0 ? ctx.y(P[i - 1]) : NaN;
      const row = [1, g].concat(fields.map((f) => agg[f])), y = ctx.y(q);
      if (hasNaN(row) || y !== y) return;
      X.push(row); Y.push(y); used.push(q);
      if (rows) rows.push({ months: fields.map((f) => ctx.visibleMonthsIn(q, train.horizon, train.lagMode, start, f)), gdpLag: ctx.periodLabel(P[i - 1]) });
    });
    if (!X.length) return { failure: 'bridge training frame is empty after dropping NaNs' };
    const b = olsBlock(ctx, Y, X, names, used), coef = b.o.coef;
    if (TRACE) Object.assign(b.diagnostics.trace, { kind: 'bridge', fields, rows, start, minRows });
    return { coefficients: b.coefficients, diagnostics: b.diagnostics, predict: (origin) => {
      const agg = ctx.visibleMean(origin.ord, origin.horizon, origin.lagMode, start);
      const x = [1, ctx.y(P[P.length - 1])].concat(fields.map((f) => agg[f]));
      if (hasNaN(x)) return { value: NaN, failure: 'missing_input_at_target' };
      const value = npdot(coef, x);
      if (value === value && Y.length < minRows) return { value: NaN, failure: 'insufficient_effective_training' };
      const out = { value, diagnostics: { target_aggregate: named(fields, x.slice(2)) } };
      if (TRACE) out.diagnostics.trace_now = { x, gdpLag: ctx.periodLabel(P[P.length - 1]), months: fields.map((f) => ctx.visibleMonthsIn(origin.ord, origin.horizon, origin.lagMode, start, f)) };
      return out;
    } };
  });
}

// --- Factor models -------------------------------------------------------------

/** pandas-style mean / std of a column with NaN (NaN -> 0 in the pairwise sums). */
function pdMoments(vals, ddof) {
  const z = new Float64Array(vals.length); let cnt = 0;
  for (let i = 0; i < vals.length; i++) { const v = vals[i]; if (v === v) { z[i] = v; cnt++; } }
  const mean = cnt ? stats.sum(z) / cnt : NaN;
  const q = new Float64Array(vals.length);
  for (let i = 0; i < vals.length; i++) { const v = vals[i]; if (v === v) q[i] = (mean - v) * (mean - v); }
  const d = cnt - ddof;
  return { mean, std: d > 0 ? Math.sqrt(stats.sum(q) / d) : NaN, count: cnt };
}
// top-k right singular vectors of W (T x N, row-major) from the Gram matrix W'W
function topRightSV(W, T, N, k, V0) {
  const G = linalg.zeros(N, N);
  for (let t = 0; t < T; t++) { const o = t * N; for (let a = 0; a < N; a++) { const x = W[o + a]; if (x === 0) continue; const Ga = G[a]; for (let b = a; b < N; b++) Ga[b] += x * W[o + b]; } }
  for (let a = 0; a < N; a++) for (let b = 0; b < a; b++) G[a][b] = G[b][a];
  if (V0) {                               // re-orthonormalise the warm start (modified Gram-Schmidt)
    for (let c = 0; c < N; c++) {
      for (let p = 0; p < c; p++) { let d = 0; for (let i = 0; i < N; i++) d += V0[i][p] * V0[i][c]; for (let i = 0; i < N; i++) V0[i][c] -= d * V0[i][p]; }
      let nn = 0; for (let i = 0; i < N; i++) nn += V0[i][c] * V0[i][c]; nn = Math.sqrt(nn); for (let i = 0; i < N; i++) V0[i][c] /= nn;
    }
  }
  const e = linalg.eigh(G, V0);
  return e.vectors;
}

/**
 * EM principal components on a panel with missing cells (the core
 * dfm._em_pca): column-mean start, SVD, re-impute the missing cells from the
 * rank-k reconstruction, until the relative change of the observed-cell loss
 * is <= tol.
 * @param {Float64Array} X T x N row-major, NaN = missing
 * @returns {{factors:number[][], loadings:number[][], converged:boolean, iterations:number, loss:number, fractionMissing:number}}
 */
function emPCA(X, T, N, k, maxIter, tol) {
  k = Math.min(k, N, T);
  const W = Float64Array.from(X), miss = [], obs = [];
  for (let j = 0; j < N; j++) {
    let s = 0, c = 0; for (let t = 0; t < T; t++) { const v = X[t * N + j]; if (v === v) { s += v; c++; } }
    const m = c ? s / c : 0;
    for (let t = 0; t < T; t++) if (X[t * N + j] !== X[t * N + j]) W[t * N + j] = m;
  }
  for (let i = 0; i < T * N; i++) (X[i] === X[i] ? obs : miss).push(i);
  let prev = null, conv = false, it = 0, V = null, F = null, Vk = null, loss = NaN;
  const d = new Float64Array(obs.length), rec = new Float64Array(T * N);
  for (it = 1; it <= maxIter; it++) {
    V = topRightSV(W, T, N, k, V);
    Vk = V.map((r) => r.slice(0, k));
    F = [];
    for (let t = 0; t < T; t++) {
      const row = new Array(k).fill(0);
      for (let j = 0; j < N; j++) { const x = W[t * N + j]; for (let c = 0; c < k; c++) row[c] += x * Vk[j][c]; }
      F.push(row);
      for (let j = 0; j < N; j++) { let s = 0; for (let c = 0; c < k; c++) s += row[c] * Vk[j][c]; rec[t * N + j] = s; }
    }
    for (let i = 0; i < obs.length; i++) { const e = X[obs[i]] - rec[obs[i]]; d[i] = e * e; }
    loss = stats.sum(d) / obs.length;
    for (let i = 0; i < miss.length; i++) W[miss[i]] = rec[miss[i]];
    if (prev !== null && Math.abs(prev - loss) / Math.max(Math.abs(prev), EPS) <= tol) { conv = true; break; }
    prev = loss;
  }
  return { factors: F, loadings: Vk, converged: conv, iterations: Math.min(it, maxIter), loss, fractionMissing: miss.length / (T * N) };
}

/**
 * Approximate dynamic factor model (vendor/dfm.py): training-window
 * standardisation, EM-PCA with k factors, later months projected on the fixed
 * loadings with their observed cells (ragged edge), period means of the
 * factors, y_t = a + b0 y_(t-1) + sum_r b_r F_(r,t).
 * @param {{predictors:string[], factors?:number, emIterations?:number, emTolerance?:number,
 *   minObservedMonths?:number, minRows?:number, name?:string}} opts
 */
function dfm(opts) {
  opts = opts || {};
  const fields = opts.predictors || [], k = opts.factors || 1, maxIter = opts.emIterations || 100;
  const tol = opts.emTolerance || 1e-4, minObs = opts.minObservedMonths === undefined ? 12 : opts.minObservedMonths;
  const minRows = opts.minRows === undefined ? MIN_TRAIN : opts.minRows;
  const name = opts.name || `dfm_pca_k${k}`;
  return makeModel('dfm_pca', name, opts, (train) => {
    const ctx = train.ctx, origin = train.origin, inf = ctx.info(origin), start = ctx.vendorStart, endM = origin.month, P = train.periods;
    if (!fields.some((f) => ctx.has(f))) return { failure: 'no_configured_fields_available' };
    if (!P.length) return { failure: 'training_slice_empty' };
    const lf = LOWFREQ[ctx.freq];
    const trS = Math.max(lf.first(P[0]), start), trE = Math.min(lf.first(P[P.length - 1]) + lf.k - 1, endM), Ttr = trE - trS + 1;
    if (Ttr <= 0) return { failure: 'training_slice_empty' };
    const resolutions = [], inc = [];
    fields.forEach((f) => {
      if (!ctx.has(f)) { resolutions.push({ field: f, status: 'unavailable' }); return; }
      const col = []; for (let m = trS; m <= trE; m++) col.push(ctx.visible(f, m, inf));
      const obsv = col.filter((v) => v === v), uniq = new Set(obsv).size;
      if (obsv.length < minObs) { resolutions.push({ field: f, status: 'excluded', reason: 'insufficient_in_window_coverage' }); return; }
      if (uniq < 2 || !(pdMoments(col, 1).std !== 0)) { resolutions.push({ field: f, status: 'excluded', reason: 'zero_variance' }); return; }
      resolutions.push({ field: f, status: 'included' }); inc.push({ f, col });
    });
    if (inc.length < Math.max(k, 2)) return { failure: 'insufficient_resolved_factor_fields', diagnostics: { field_resolutions: resolutions } };
    const N = inc.length, mu = [], sd = [];
    inc.forEach(({ col }) => { const m = pdMoments(col, 0); mu.push(m.mean); sd.push(m.std === 0 || m.std !== m.std ? 1 : m.std); });
    const Z = new Float64Array(Ttr * N);
    for (let t = 0; t < Ttr; t++) for (let j = 0; j < N; j++) Z[t * N + j] = (inc[j].col[t] - mu[j]) / sd[j];
    const em = emPCA(Z, Ttr, N, k, maxIter, tol);
    const project = (o, detail) => {       // factors of the target period's months at origin o
      const infO = ctx.info(o), out = new Map();
      ctx.periodMonths(o.ord).forEach((m) => {
        if (m > o.month || m < start) { if (detail) detail.push({ month: m, source: 'not used (after the origin)', factor: null, observed: [] }); return; }
        if (m >= trS && m <= trE) { out.set(m, em.factors[m - trS]); if (detail) detail.push({ month: m, source: 'estimated in the EM-PCA window', factor: em.factors[m - trS], observed: inc.filter(({ col }) => col[m - trS] === col[m - trS]).map(({ f }) => f) }); return; }
        const L = [], yv = [], obs = [];
        inc.forEach(({ f }, j) => { const v = ctx.visible(f, m, infO); if (v === v) { L.push(em.loadings[j]); yv.push((v - mu[j]) / sd[j]); obs.push(f); } });
        out.set(m, L.length ? linalg.lstsq(L, yv).x : null);
        if (detail) detail.push({ month: m, source: L.length ? 'projected on the fixed loadings (least squares on the released cells)' : 'no released cell', factor: out.get(m), observed: obs, z: yv });
      });
      return out;
    };
    const periodFactor = (q, proj) => {
      const acc = new Array(k).fill(0); let n = 0;
      ctx.periodMonths(q).forEach((m) => {
        const fv = m >= trS && m <= trE ? em.factors[m - trS] : (proj ? proj.get(m) : undefined);
        if (fv) { for (let c = 0; c < k; c++) acc[c] += fv[c]; n++; }
      });
      return n ? acc.map((v) => v / n) : new Array(k).fill(NaN);
    };
    const X = [], Y = [], used = [];
    P.forEach((q, i) => {
      const row = [1, i > 0 ? ctx.y(P[i - 1]) : NaN].concat(periodFactor(q, null));
      if (hasNaN(row) || ctx.y(q) !== ctx.y(q)) return;
      X.push(row); Y.push(ctx.y(q)); used.push(q);
    });
    const names = ['intercept', 'gdp_lag1'].concat(seq(k).map((c) => `factor_${c + 1}`));
    const diag = { em_converged: em.converged, em_iterations: em.iterations, em_loss: em.loss, fraction_missing: em.fractionMissing,
      field_resolutions: resolutions, loadings: named(inc.map((x) => x.f), em.loadings), n_fields: N };
    if (X.length < names.length) return { failure: 'gdp_regression:DFM GDP regression has too few complete rows', diagnostics: diag };
    const b = olsBlock(ctx, Y, X, names, used), coef = b.o.coef;
    if (TRACE) Object.assign(b.diagnostics.trace, { kind: 'dfm', k, fields: inc.map((x) => x.f), resolutions, mu, sd, trS, trE, start, minRows,
      em: { iterations: em.iterations, converged: em.converged, loss: em.loss, fractionMissing: em.fractionMissing, maxIter, tol },
      loadings: em.loadings.map((r) => r.slice()), factors: em.factors.map((r) => r.slice()), gdpLag: used.map((q) => ctx.periodLabel(P[P.indexOf(q) - 1])) });
    return { coefficients: b.coefficients, diagnostics: Object.assign(b.diagnostics, diag), predict: (o) => {
      const detail = TRACE ? [] : null, fr = periodFactor(o.ord, project(o, detail));
      if (hasNaN(fr)) return { value: NaN, failure: 'missing_factor_at_target' };
      const g = ctx.y(P[P.length - 1]);
      if (g !== g) return { value: NaN, failure: 'missing_gdp_lag_at_target' };
      const value = npdot(coef, [1, g].concat(fr));
      if (value === value && Y.length < minRows) return { value: NaN, failure: 'insufficient_effective_training' };
      const out = { value, diagnostics: { factor_at_target: fr } };
      if (detail) out.diagnostics.trace_now = { x: [1, g].concat(fr), gdpLag: ctx.periodLabel(P[P.length - 1]), months: detail };
      return out;
    } };
  });
}

// small dense r x r helpers on flat row-major arrays (Kalman filter); results go to ``out``
const sm = {
  mul(A, ao, B, bo, r, C, co) {
    for (let i = 0; i < r * r; i++) C[co + i] = 0;
    for (let i = 0; i < r; i++) for (let l = 0; l < r; l++) { const a = A[ao + i * r + l]; for (let j = 0; j < r; j++) C[co + i * r + j] += a * B[bo + l * r + j]; }
  },
  mulT(A, ao, B, bo, r, C, co) { for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) { let s = 0; for (let l = 0; l < r; l++) s += A[ao + i * r + l] * B[bo + j * r + l]; C[co + i * r + j] = s; } },
  vec(A, ao, x, xo, r, y, yo) { for (let i = 0; i < r; i++) { let s = 0; for (let j = 0; j < r; j++) s += A[ao + i * r + j] * x[xo + j]; y[yo + i] = s; } },
  sym(A, ao, r, B, bo) { for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) B[bo + i * r + j] = 0.5 * (A[ao + i * r + j] + A[ao + j * r + i]); },
  toRows(A, r, o) { o = o || 0; const M = []; for (let i = 0; i < r; i++) M.push(Array.from(A.subarray(o + i * r, o + i * r + r))); return M; },
  // LU with partial pivoting (as linalg.lu / linalg.solve with an identity right-hand side);
  // writes the inverse to out and returns log|det| (sign in lu.sign), NaN if singular
  inv(A, ao, r, out, oo, w) {
    const a = w.a, piv = w.piv; let sign = 1;
    for (let i = 0; i < r * r; i++) a[i] = A[ao + i];
    for (let i = 0; i < r; i++) piv[i] = i;
    for (let k = 0; k < r; k++) {
      let p = k, max = Math.abs(a[k * r + k]);
      for (let i = k + 1; i < r; i++) { const v = Math.abs(a[i * r + k]); if (v > max) { max = v; p = i; } }
      if (p !== k) { for (let j = 0; j < r; j++) { const t = a[p * r + j]; a[p * r + j] = a[k * r + j]; a[k * r + j] = t; } const u = piv[p]; piv[p] = piv[k]; piv[k] = u; sign = -sign; }
      const akk = a[k * r + k];
      if (akk === 0) fail('singular', 'singular matrix');
      for (let i = k + 1; i < r; i++) { const f = a[i * r + k] / akk; a[i * r + k] = f; for (let j = k + 1; j < r; j++) a[i * r + j] -= f * a[k * r + j]; }
    }
    for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) out[oo + i * r + j] = piv[i] === j ? 1 : 0;
    for (let i = 0; i < r; i++) for (let l = 0; l < i; l++) { const c = a[i * r + l]; if (c !== 0) for (let j = 0; j < r; j++) out[oo + i * r + j] -= c * out[oo + l * r + j]; }
    for (let i = r - 1; i >= 0; i--) {
      for (let l = i + 1; l < r; l++) { const c = a[i * r + l]; for (let j = 0; j < r; j++) out[oo + i * r + j] -= c * out[oo + l * r + j]; }
      for (let j = 0; j < r; j++) out[oo + i * r + j] /= a[i * r + i];
    }
    let ld = 0; for (let i = 0; i < r; i++) { const d = a[i * r + i]; if (d < 0) sign = -sign; ld += Math.log(Math.abs(d)); }
    w.sign = sign;
    return ld;
  },
  work(r) { return { a: new Float64Array(r * r), piv: new Int32Array(r), sign: 1 }; },
};

/**
 * Kalman filter + Rauch-Tung-Striebel smoother with missing observations for
 * x_t = L f_t + e_t (e ~ N(0, diag(R))), f_t = A f_(t-1) + u_t (u ~ N(0, Q)); the
 * engine's kalman_smoother (information-form update, r x r steps).  State
 * arrays are flat: f[t*r + a], P[t*r*r + a*r + b].
 * @returns {{f:Float64Array, P:Float64Array, Pc:Float64Array, loglik:number, fFiltered:Float64Array}}
 */
function kalmanSmoother(X, T, N, lam, rvar, A, Q, f0, P0, r) {
  const rr = r * r, rinv = rvar.map((v) => 1 / v), AT = new Float64Array(rr), w = sm.work(r);
  for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) AT[i * r + j] = A[j * r + i];
  const fp = new Float64Array(T * r), Pp = new Float64Array(T * rr), ff = new Float64Array(T * r), Pf = new Float64Array(T * rr);
  const Wt = new Float64Array(rr), wt = new Float64Array(r), T1 = new Float64Array(rr), Pinv = new Float64Array(rr), prec = new Float64Array(rr);
  const Pu = new Float64Array(rr), rhs = new Float64Array(r), fu = new Float64Array(r), Wf = new Float64Array(r), bb = new Float64Array(r);
  const vv = new Float64Array(N), ld = new Float64Array(N), L2P = Math.log(2 * Math.PI);
  let fPrev = Float64Array.from(f0), PPrev = Float64Array.from(P0), fpo = 0, Ppo = 0, loglik = 0;
  for (let t = 0; t < T; t++) {
    Wt.fill(0); wt.fill(0);
    let nobs = 0;
    for (let i = 0; i < N; i++) {
      const x = X[t * N + i]; if (x !== x) continue;
      const ri = rinv[i], li = lam[i];
      for (let a = 0; a < r; a++) { wt[a] += x * ri * li[a]; for (let b = 0; b < r; b++) Wt[a * r + b] += ri * li[a] * li[b]; }
      vv[nobs] = i; nobs++;
    }
    const fo = t * r, po = t * rr;
    sm.vec(A, 0, fPrev, fpo, r, fp, fo);
    sm.mul(A, 0, PPrev, Ppo, r, T1, 0); sm.mul(T1, 0, AT, 0, r, Pp, po);
    for (let i = 0; i < rr; i++) Pp[po + i] += Q[i];
    if (nobs) {
      const ldP = sm.inv(Pp, po, r, Pinv, 0, w), sgP = w.sign;
      for (let i = 0; i < rr; i++) prec[i] = Pinv[i] + Wt[i];
      const ldQ = sm.inv(prec, 0, r, Pu, 0, w), sgQ = w.sign;
      sm.vec(Pinv, 0, fp, fo, r, rhs, 0); for (let a = 0; a < r; a++) rhs[a] += wt[a];
      sm.vec(Pu, 0, rhs, 0, r, fu, 0);
      for (let c = 0; c < nobs; c++) {
        const i = vv[c], li = lam[i]; let s = 0;
        for (let a = 0; a < r; a++) s += li[a] * fp[fo + a];
        const v = X[t * N + i] - s; vv[c] = v * v * rinv[i]; ld[c] = Math.log(rvar[i]);
      }
      sm.vec(Wt, 0, fp, fo, r, Wf, 0); for (let a = 0; a < r; a++) bb[a] = wt[a] - Wf[a];
      let bPb = 0; for (let j = 0; j < r; j++) { let s = 0; for (let a = 0; a < r; a++) s += bb[a] * Pu[a * r + j]; bPb += s * bb[j]; }
      const quad = stats.sum(vv, 0, nobs) - bPb;
      const logdet = stats.sum(ld, 0, nobs) + (sgP > 0 ? ldP : Infinity) + (sgQ > 0 ? ldQ : Infinity);
      loglik += -0.5 * (nobs * L2P + logdet + quad);
      for (let a = 0; a < r; a++) ff[fo + a] = fu[a];
      sm.sym(Pu, 0, r, Pf, po);
    } else {
      for (let a = 0; a < r; a++) ff[fo + a] = fp[fo + a];
      sm.sym(Pp, po, r, Pf, po);
    }
    fPrev = ff; fpo = fo; PPrev = Pf; Ppo = po;
  }
  const fs = Float64Array.from(ff), Ps = Float64Array.from(Pf), Pc = new Float64Array(T * rr);
  const J = new Float64Array(rr), Ji = new Float64Array(rr), d = new Float64Array(r), Jd = new Float64Array(r), D = new Float64Array(rr), JD = new Float64Array(rr), JDJ = new Float64Array(rr), Pn = new Float64Array(rr);
  for (let t = T - 2; t >= 0; t--) {
    const fo = t * r, po = t * rr, fo1 = fo + r, po1 = po + rr;
    sm.inv(Pp, po1, r, Ji, 0, w);
    sm.mul(Pf, po, AT, 0, r, T1, 0); sm.mul(T1, 0, Ji, 0, r, J, 0);
    for (let a = 0; a < r; a++) d[a] = fs[fo1 + a] - fp[fo1 + a];
    sm.vec(J, 0, d, 0, r, Jd, 0);
    for (let a = 0; a < r; a++) fs[fo + a] = ff[fo + a] + Jd[a];
    for (let i = 0; i < rr; i++) D[i] = Ps[po1 + i] - Pp[po1 + i];
    sm.mul(J, 0, D, 0, r, JD, 0); sm.mulT(JD, 0, J, 0, r, JDJ, 0);
    for (let i = 0; i < rr; i++) Pn[i] = Pf[po + i] + JDJ[i];
    sm.sym(Pn, 0, r, Ps, po);
    sm.mulT(Ps, po1, J, 0, r, Pc, po1);
  }
  return { f: fs, P: Ps, Pc, loglik, fFiltered: ff };
}

function stationaryCov(A, Q, r) {
  const P = new Float64Array(r * r);
  if (linalg.spectralRadius(sm.toRows(A, r)) < 0.999) {
    const I = linalg.eye(r * r), K = linalg.kron(sm.toRows(A, r), sm.toRows(A, r)), M = I.map((row, i) => row.map((v, j) => v - K[i][j]));
    sm.sym(Float64Array.from(linalg.solve(M, Array.from(Q))), 0, r, P, 0);
    return P;
  }
  for (let i = 0; i < r; i++) P[i * r + i] = 10; return P;
}

/**
 * EM estimation of the Kalman-filter DFM on a standardised panel with NaN
 * (the engine's fit_kalman_dfm; Banbura & Modugno 2014 without idiosyncratic
 * dynamics) from a principal-components start.
 * @param {Float64Array} X T x N row-major
 * @returns {{lam:number[][], rvar:number[], A:number[][], Q:number[][], factors:number[][], loglik:number, iterations:number, converged:boolean}}
 */
function fitKalmanDFM(X, T, N, r, maxIter, tol, rmin) {
  r = r || 2; maxIter = maxIter || 60; tol = tol || 1e-4; rmin = rmin === undefined ? 1e-3 : rmin;
  const X0 = Float64Array.from(X, (v) => (v === v ? v : 0));
  const V = topRightSV(X0, T, N, r).map((row) => row.slice(0, r));
  const F = []; for (let t = 0; t < T; t++) { const row = new Array(r).fill(0); for (let j = 0; j < N; j++) for (let c = 0; c < r; c++) row[c] += X0[t * N + j] * V[j][c]; F.push(row); }
  const lam = [], rvar = [];
  for (let i = 0; i < N; i++) {
    const Fo = [], xo = [];
    for (let t = 0; t < T; t++) { const x = X[t * N + i]; if (x === x) { Fo.push(F[t]); xo.push(x); } }
    const c = xo.length ? linalg.lstsq(Fo, xo).x : new Array(r).fill(0);
    lam.push(c);
    const res = xo.map((x, j) => { let s = 0; for (let a = 0; a < r; a++) s += Fo[j][a] * c[a]; return (x - s) * (x - s); });
    rvar.push(Math.max(xo.length ? stats.sum(res) / res.length : 1, rmin));
  }
  const Bc = linalg.lstsq(F.slice(0, -1), F.slice(1)).x;
  let A = new Float64Array(r * r); for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) A[i * r + j] = Bc[j][i];
  const E = F.slice(1).map((row, t) => row.map((v, c) => { let s = 0; for (let a = 0; a < r; a++) s += F[t][a] * Bc[a][c]; return v - s; }));
  let Q = new Float64Array(r * r);
  if (r > 1) {
    const means = seq(r).map((c) => stats.sum(E.map((e) => e[c])) / E.length), fac = 1 / (E.length - 1);
    for (let a = 0; a < r; a++) for (let b = 0; b < r; b++) { let s = 0; for (let t = 0; t < E.length; t++) s += (E[t][a] - means[a]) * (E[t][b] - means[b]); Q[a * r + b] = s * fac; }
  } else Q[0] = stats.variance(E.map((e) => e[0]), 0);
  const Qs = new Float64Array(r * r); sm.sym(Q, 0, r, Qs, 0); Q = Qs; for (let i = 0; i < r; i++) Q[i * r + i] += 1e-6;
  const rr = r * r, w = sm.work(r), EFF = new Float64Array(T * rr), terms = new Float64Array(T), iS00 = new Float64Array(rr), AS = new Float64Array(rr);
  let prev = null, it = 0, conv = false, smo = null;
  for (it = 1; it <= maxIter; it++) {
    smo = kalmanSmoother(X, T, N, lam, rvar, A, Q, new Float64Array(r), stationaryCov(A, Q, r), r);
    const ll = smo.loglik, f = smo.f, P = smo.P, Pc = smo.Pc;
    for (let t = 0; t < T; t++) for (let a = 0; a < r; a++) for (let b = 0; b < r; b++) EFF[t * rr + a * r + b] = P[t * rr + a * r + b] + f[t * r + a] * f[t * r + b];
    const S11 = new Float64Array(rr), S00 = new Float64Array(rr), S10 = new Float64Array(rr);
    for (let t = 1; t < T; t++) for (let i = 0; i < rr; i++) S11[i] += EFF[t * rr + i];
    for (let t = 0; t < T - 1; t++) for (let i = 0; i < rr; i++) S00[i] += EFF[t * rr + i];
    for (let t = 1; t < T; t++) for (let a = 0; a < r; a++) for (let b = 0; b < r; b++) S10[a * r + b] += Pc[t * rr + a * r + b] + f[t * r + a] * f[(t - 1) * r + b];
    sm.inv(S00, 0, r, iS00, 0, w);
    A = new Float64Array(rr); sm.mul(S10, 0, iS00, 0, r, A, 0);
    sm.mulT(A, 0, S10, 0, r, AS, 0);
    const Qn = new Float64Array(rr);
    for (let i = 0; i < rr; i++) Qn[i] = (S11[i] - AS[i]) / (T - 1);
    Q = new Float64Array(rr); sm.sym(Qn, 0, r, Q, 0); for (let i = 0; i < r; i++) Q[i * r + i] += 1e-8;
    const rad = linalg.spectralRadius(sm.toRows(A, r));
    if (rad >= 0.995) A = A.map((v) => v * (0.995 / rad));
    for (let i = 0; i < N; i++) {
      const S = new Float64Array(rr), s = new Array(r).fill(0);
      let nt = 0;
      for (let t = 0; t < T; t++) { const x = X[t * N + i]; if (x !== x) continue; nt++; for (let j = 0; j < rr; j++) S[j] += EFF[t * rr + j]; for (let a = 0; a < r; a++) s[a] += x * f[t * r + a]; }
      if (!nt) continue;
      const li = linalg.solve(sm.toRows(S, r), s);
      lam[i] = li;
      let c = 0;
      for (let t = 0; t < T; t++) {
        const x = X[t * N + i]; if (x !== x) continue;
        let fl = 0; for (let a = 0; a < r; a++) fl += f[t * r + a] * li[a];
        const e = x - fl; let q = 0;
        for (let a = 0; a < r; a++) for (let b = 0; b < r; b++) q += li[a] * P[t * rr + a * r + b] * li[b];
        terms[c++] = e * e + q;
      }
      rvar[i] = Math.max(stats.sum(terms, 0, c) / c, rmin);
    }
    if (prev !== null && Math.abs(ll - prev) <= tol * Math.max(Math.abs(prev), 1)) { conv = true; break; }
    prev = ll;
  }
  smo = kalmanSmoother(X, T, N, lam, rvar, A, Q, new Float64Array(r), stationaryCov(A, Q, r), r);
  const factors = []; for (let t = 0; t < T; t++) factors.push(Array.from(smo.f.subarray(t * r, t * r + r)));
  return { lam, rvar, A: sm.toRows(A, r), Q: sm.toRows(Q, r), factors, loglik: smo.loglik, iterations: Math.min(it, maxIter), converged: conv };
}

/**
 * Dynamic factor model with Kalman filter/smoother (the engine's dfm_kalman):
 * r monthly factors (VAR(1)), EM from a PCA start on the training-standardised
 * panel from ``windowStart`` (default: the first month of the training window) to
 * the end of the target period; y_t = a + b0
 * y_(t-1) + g' Fbar_t with Fbar the period means of the smoothed factors.
 * @param {{predictors:string[], factors?:number, maxIter?:number, tol?:number,
 *   windowStart?:string, minRows?:number, name?:string}} opts
 */
function dfmKalman(opts) {
  opts = opts || {};
  const r = opts.factors || 1, fields = opts.predictors || [], minRows = opts.minRows === undefined ? MIN_TRAIN : opts.minRows;
  return makeModel('dfm_kalman', opts.name || 'dfm_kalman', opts, (train) => {
    const ctx = train.ctx, origin = train.origin, inf = ctx.info(origin), lf = LOWFREQ[ctx.freq], P = train.periods;
    const fl = ctx.present(fields);
    const w0 = opts.windowStart ? parsePeriod(opts.windowStart).ord : lf.first(ctx.training ? ctx.trainStartOrd(origin.ord) : ctx.periods[0]);
    const endM = lf.first(origin.ord) + lf.k - 1, T = endM - w0 + 1;
    if (!P.length || T <= 0) return { failure: 'insufficient_effective_training' };
    const trainEnd = lf.first(P[P.length - 1]) + lf.k - 1;
    const cols = fl.map((f) => { const c = new Float64Array(T); for (let t = 0; t < T; t++) { const m = w0 + t; c[t] = m <= origin.month ? ctx.visible(f, m, inf) : NaN; } return c; });
    const keep = [];
    fl.forEach((f, j) => { const trc = cols[j].subarray(0, Math.max(0, Math.min(T, trainEnd - w0 + 1))); const m = pdMoments(trc, 1); if (m.count >= 12 && m.std > 0) keep.push(j); });
    if (keep.length < Math.max(r, 3)) return { failure: 'insufficient_fields', diagnostics: { n_fields: keep.length } };
    const N = keep.length, Z = new Float64Array(T * N), mus = [], sds = [];
    keep.forEach((j, c) => {
      const trc = cols[j].subarray(0, Math.max(0, Math.min(T, trainEnd - w0 + 1))), m = pdMoments(trc, 0);
      for (let t = 0; t < T; t++) Z[t * N + c] = (cols[j][t] - m.mean) / m.std;
      mus.push(m.mean); sds.push(m.std);
    });
    const fit = fitKalmanDFM(Z, T, N, r, opts.maxIter || 60, opts.tol || 1e-4, 1e-3);
    const Fq = new Map();
    for (let t = 0; t < T; t++) { const p = lf.ofMonth(w0 + t), g = Fq.get(p) || { s: new Array(r).fill(0), n: 0 }; for (let c = 0; c < r; c++) g.s[c] += fit.factors[t][c]; g.n++; Fq.set(p, g); }
    const fq = (p) => { const g = Fq.get(p); return g ? g.s.map((v) => v / g.n) : null; };
    const X = [], Y = [], used = [];
    P.forEach((q, i) => { if (i === 0 || !fq(q)) return; X.push([1, ctx.y(P[i - 1])].concat(fq(q))); Y.push(ctx.y(q)); used.push(q); });
    const diag = { n_train: Y.length, n_fields: N, em_iterations: fit.iterations, em_converged: fit.converged, loglik: fit.loglik,
      loadings: named(keep.map((j) => fl[j]), fit.lam), A: fit.A };
    if (Y.length < minRows) return { failure: 'insufficient_effective_training', diagnostics: diag };
    const names = ['intercept', 'gdp_lag1'].concat(seq(r).map((c) => `factor_${c + 1}`));
    const coef = linalg.lstsq(X, Y).x;
    const fitted = X.map((x, i) => { const v = npdot(coef, x); return { period: ctx.periodLabel(used[i]), actual: Y[i], fitted: v, residual: Y[i] - v }; });
    if (TRACE) {
      const nObs = []; for (let t = 0; t < T; t++) { let c = 0; for (let i = 0; i < N; i++) if (Z[t * N + i] === Z[t * N + i]) c++; nObs.push(c); }
      diag.trace = { kind: 'dfm_kalman', r, fields: keep.map((j) => fl[j]), dropped: fl.filter((_, j) => keep.indexOf(j) < 0), mu: mus, sd: sds, w0, endM, trainEnd, T,
        lam: fit.lam.map((x) => Array.from(x)), rvar: Array.from(fit.rvar), A: fit.A, Q: fit.Q, loglik: fit.loglik, iterations: fit.iterations, converged: fit.converged,
        maxIter: opts.maxIter || 60, tol: opts.tol || 1e-4, factors: fit.factors, nObs, originMonth: origin.month, minRows,
        gdpLag: used.map((q) => ctx.periodLabel(P[P.indexOf(q) - 1])),
        design: { columns: names.slice(), periods: used.map((q) => ctx.periodLabel(q)), X: X.map((x) => x.slice()), y: Y.slice() } };
    }
    return { coefficients: named(names, coef), diagnostics: Object.assign(diag, { fitted }), predict: (o) => {
      if (o.ord !== origin.ord || o.day !== origin.day || o.lagMode !== origin.lagMode) fail('origin_mismatch', 'dfm_kalman predicts at its training origin only');
      const out = { value: npdot(coef, [1, ctx.y(P[P.length - 1])].concat(fq(origin.ord))), diagnostics: { factor_at_target: fq(origin.ord) } };
      if (TRACE) out.diagnostics.trace_now = { x: [1, ctx.y(P[P.length - 1])].concat(fq(origin.ord)), gdpLag: ctx.periodLabel(P[P.length - 1]) };
      return out;
    } };
  });
}

// --- Lasso and elastic net (port of scikit-learn 1.8 coordinate descent) --------

const enet = (function () {
  // Dense solver state: X is column-major (n x p) and ``cols`` holds one view per
  // column (faster element access in V8 than offset arithmetic).
  const views = (X, n, p) => { const c = new Array(p); for (let j = 0; j < p; j++) c[j] = X.subarray(j * n, j * n + n); return c; };
  function colNorms(cols, n) { return Float64Array.from(cols, (x) => { let s = 0; for (let i = 0; i < n; i++) s += x[i] * x[i]; return s; }); }
  // dual gap of the dense problem; fills XtA, writes [gap, dual norm] into out
  function gap(n, p, w, alpha, beta, cols, y, R, XtA, out) {
    for (let j = 0; j < p; j++) { const x = cols[j]; let s = 0; for (let i = 0; i < n; i++) s += x[i] * R[i]; XtA[j] = s - beta * w[j]; }
    let dual = Math.abs(XtA[0]);
    for (let j = 1; j < p; j++) { const d = Math.abs(XtA[j]); if (d > dual) dual = d; }
    let Rn = 0, Ry = 0, wn = 0, l1 = 0;
    for (let i = 0; i < n; i++) { Rn += R[i] * R[i]; Ry += R[i] * y[i]; }
    if (beta > 0) for (let j = 0; j < p; j++) wn += w[j] * w[j];
    for (let j = 0; j < p; j++) l1 += Math.abs(w[j]);
    let c, g;
    if (dual > alpha) { c = alpha / dual; g = 0.5 * (Rn + Rn * (c * c)); } else { c = 1; g = Rn; }
    out[0] = g + (alpha * l1 - c * Ry + 0.5 * beta * (1 + c * c) * wn); out[1] = dual;
  }
  // gap-safe screening (dense): returns the number of active features
  function screenDense(initial, n, p, w, alpha, beta, cols, R, XtA, norm2, active, excl, g, dual) {
    let nActive = 0;
    const rad = Math.sqrt(2 * g) / alpha, den = alpha > dual ? alpha : dual;
    for (let j = 0; j < p; j++) {
      if (initial && norm2[j] === 0) { w[j] = 0; excl[j] = 1; continue; }
      if (!initial && excl[j]) continue;
      const d = (1 - Math.abs(XtA[j] / den)) / Math.sqrt(norm2[j] + beta);
      if (d <= rad) { active[nActive++] = j; excl[j] = 0; }
      else { const wj = w[j], x = cols[j]; for (let i = 0; i < n; i++) R[i] += wj * x[i]; w[j] = 0; excl[j] = 1; }
    }
    return nActive;
  }
  /**
   * enet_coordinate_descent: min 1/2||y - Xw||^2 + alpha||w||_1 + beta/2||w||^2,
   * cyclic, gap-safe screening (scikit-learn 1.8).  X column-major (n x p);
   * w is updated in place.  The residual update of one coordinate is fused with
   * the dot product of the next (same floating-point operations).
   */
  function cdDense(w, alpha, beta, X, n, p, y, maxIter, tol, cols, norm2, yy) {
    cols = cols || views(X, n, p); norm2 = norm2 || colNorms(cols, n);
    const R = Float64Array.from(y), XtA = new Float64Array(p), gd = new Float64Array(2);
    for (let j = 0; j < p; j++) { const wj = w[j]; if (wj !== 0) { const x = cols[j]; for (let i = 0; i < n; i++) R[i] -= wj * x[i]; } }
    if (yy === undefined) { yy = 0; for (let i = 0; i < n; i++) yy += y[i] * y[i]; }
    const dwTol = tol; tol *= yy;
    gap(n, p, w, alpha, beta, cols, y, R, XtA, gd);
    if (gd[0] <= tol) return { gap: gd[0], nIter: 0 };
    const active = new Int32Array(p), excl = new Uint8Array(p);
    let nActive = screenDense(true, n, p, w, alpha, beta, cols, R, XtA, norm2, active, excl, gd[0], gd[1]);
    let it = 0;
    for (it = 0; it < maxIter; it++) {
      let wMax = 0, dwMax = 0, pend = null, pd = 0;
      for (let fi = 0; fi < nActive; fi++) {
        const j = active[fi], nj = norm2[j];
        if (nj === 0) continue;
        const wj = w[j], x = cols[j];
        let tmp = 0;
        if (pend !== null) { for (let i = 0; i < n; i++) { const r = R[i] + pd * pend[i]; R[i] = r; tmp += x[i] * r; } pend = null; }
        else for (let i = 0; i < n; i++) tmp += x[i] * R[i];
        tmp += wj * nj;
        const at = Math.abs(tmp) - alpha, sh = at > 0 ? at : 0;
        const wn = (tmp === 0 ? 0 : tmp > 0 ? 1 : -1) * sh / (nj + beta);
        w[j] = wn;
        if (wn !== wj) { pend = x; pd = wj - wn; }
        const dw = Math.abs(wn - wj), aw = Math.abs(wn);
        if (dw > dwMax) dwMax = dw;
        if (aw > wMax) wMax = aw;
      }
      if (pend !== null) for (let i = 0; i < n; i++) R[i] += pd * pend[i];
      if (wMax === 0 || dwMax / wMax <= dwTol || it === maxIter - 1) {
        gap(n, p, w, alpha, beta, cols, y, R, XtA, gd);
        if (gd[0] <= tol) break;
        nActive = screenDense(false, n, p, w, alpha, beta, cols, R, XtA, norm2, active, excl, gd[0], gd[1]);
      }
    }
    return { gap: gd[0], nIter: Math.min(it, maxIter - 1) + 1 };
  }
  function gapGram(p, w, alpha, beta, Qw, q, yy, XtA, out) {
    let qw = 0; for (let j = 0; j < p; j++) qw += w[j] * q[j];
    for (let j = 0; j < p; j++) XtA[j] = q[j] - Qw[j] - beta * w[j];
    let dual = Math.abs(XtA[0]); for (let j = 1; j < p; j++) { const d = Math.abs(XtA[j]); if (d > dual) dual = d; }
    let wQw = 0; for (let j = 0; j < p; j++) wQw += w[j] * Qw[j];
    const Rn = yy + wQw - 2.0 * qw;
    let wn = 0, l1 = 0; if (beta > 0) for (let j = 0; j < p; j++) wn += w[j] * w[j];
    for (let j = 0; j < p; j++) l1 += Math.abs(w[j]);
    let c, g;
    if (dual > alpha) { c = alpha / dual; g = 0.5 * (Rn + Rn * (c * c)); } else { c = 1; g = Rn; }
    out[0] = g + (alpha * l1 - c * (yy - qw) + 0.5 * beta * (1 + c * c) * wn); out[1] = dual;
  }
  function screenGram(p, w, alpha, beta, Q, Qw, XtA, active, excl, g, dual) {
    let nActive = 0;
    const rad = Math.sqrt(2 * Math.abs(g)) / alpha, den = alpha > dual ? alpha : dual;
    for (let j = 0; j < p; j++) {
      const Qjj = Q[j * p + j];
      if (Qjj === 0) { w[j] = 0; excl[j] = 1; continue; }
      const d = (1 - Math.abs(XtA[j] / den)) / Math.sqrt(Qjj + beta);
      if (d <= rad) { active[nActive++] = j; excl[j] = 0; }
      else { const wj = w[j]; for (let i = 0; i < p; i++) Qw[i] += -wj * Q[j * p + i]; w[j] = 0; excl[j] = 1; }
    }
    return nActive;
  }
  /** enet_coordinate_descent_gram on Q = X'X (row-major p x p), q = X'y. */
  function cdGram(w, alpha, beta, Q, q, yy, p, maxIter, tol) {
    const Qw = new Float64Array(p), XtA = new Float64Array(p), gd = new Float64Array(2);
    for (let i = 0; i < p; i++) { let s = 0; for (let j = 0; j < p; j++) s += Q[i * p + j] * w[j]; Qw[i] = s; }
    const dwTol = tol; tol *= yy;
    gapGram(p, w, alpha, beta, Qw, q, yy, XtA, gd);
    if (gd[0] >= 0 && gd[0] <= tol) return { gap: gd[0], nIter: 0 };
    const active = new Int32Array(p), excl = new Uint8Array(p);
    let nActive = screenGram(p, w, alpha, beta, Q, Qw, XtA, active, excl, gd[0], gd[1]);
    let it = 0;
    for (it = 0; it < maxIter; it++) {
      let wMax = 0, dwMax = 0;
      for (let fi = 0; fi < nActive; fi++) {
        const j = active[fi], Qjj = Q[j * p + j]; if (Qjj === 0) continue;
        const wj = w[j], tmp = q[j] - Qw[j] + wj * Qjj;
        const at = Math.abs(tmp) - alpha, sh = at > 0 ? at : 0;
        const wn = (tmp === 0 ? 0 : tmp > 0 ? 1 : -1) * sh / (Qjj + beta);
        w[j] = wn;
        if (wn !== wj) { const d = wn - wj, o = j * p; for (let i = 0; i < p; i++) Qw[i] += d * Q[o + i]; }
        const dw = Math.abs(wn - wj); if (dw > dwMax) dwMax = dw;
        if (Math.abs(wn) > wMax) wMax = Math.abs(wn);
      }
      if (wMax === 0 || dwMax / wMax <= dwTol || it === maxIter - 1) {
        gapGram(p, w, alpha, beta, Qw, q, yy, XtA, gd);
        if (gd[0] <= tol) break;
        nActive = screenGram(p, w, alpha, beta, Q, Qw, XtA, active, excl, gd[0], gd[1]);
      }
    }
    return { gap: gd[0], nIter: Math.min(it, maxIter - 1) + 1 };
  }
  function center(rows, idx, y) {
    const p = rows[0].length, n = idx.length, off = new Float64Array(p), col = new Float64Array(n);
    for (let j = 0; j < p; j++) { for (let k = 0; k < n; k++) col[k] = rows[idx[k]][j]; off[j] = stats.sum(col) / n; }
    const X = new Float64Array(n * p);
    for (let j = 0; j < p; j++) for (let k = 0; k < n; k++) X[j * n + k] = rows[idx[k]][j] - off[j];
    const yv = idx.map((i) => y[i]), yo = stats.sum(yv) / n;
    return { X, n, p, off, yo, yc: Float64Array.from(yv, (v) => v - yo) };
  }
  /** numpy.geomspace(start, stop, num). */
  function geomspace(a, b, num) {
    const la = Math.log10(a), lb = Math.log10(b), step = (lb - la) / (num - 1), out = [];
    for (let i = 0; i < num; i++) out.push(Math.pow(10, i * step + la));
    out[0] = a; if (num > 1) out[num - 1] = b;
    return out;
  }
  /** _alpha_grid with fit_intercept (X rows, y) for one l1 ratio. */
  function alphaGrid(rows, y, l1, nAlphas, eps) {
    const n = rows.length, p = rows[0].length, ym = stats.sum(y) / n, yc = y.map((v) => v - ym), sy = stats.sum(yc);
    let mx = 0;
    for (let j = 0; j < p; j++) {
      const col = rows.map((r) => r[j]), xm = stats.sum(col) / n;
      let s = 0; for (let i = 0; i < n; i++) s += col[i] * yc[i];
      const v = s - xm * sy; if (v * v > mx) mx = v * v;
    }
    const amax = Math.sqrt(Math.abs(mx)) / (n * l1);
    if (amax <= 1e-15) return new Array(nAlphas).fill(1e-15);
    return geomspace(amax, amax * eps, nAlphas);
  }
  /** sklearn TimeSeriesSplit(n_splits).split. */
  function timeSeriesSplit(n, k) {
    const ts = Math.floor(n / (k + 1)), out = [];
    if (k + 1 > n || n - ts * k <= 0) fail('bad_cv', `cannot make ${k} time-series splits of ${n} rows`);
    for (let s = n - k * ts; s < n; s += ts) out.push({ train: seq(s), test: seq(ts).map((i) => s + i) });
    return out;
  }
  function path(c, alphas, l1, maxIter, tol, precompute) {
    const { X, n, p, yc } = c, w = new Float64Array(p), coefs = [];
    const gram = precompute === 'auto' ? n > p : !!precompute;
    let Q = null, q = null, yy = 0;
    if (gram) {
      Q = new Float64Array(p * p); q = new Float64Array(p);
      for (let a = 0; a < p; a++) for (let b = a; b < p; b++) { let s = 0; for (let i = 0; i < n; i++) s += X[a * n + i] * X[b * n + i]; Q[a * p + b] = s; Q[b * p + a] = s; }
      for (let a = 0; a < p; a++) { let s = 0; for (let i = 0; i < n; i++) s += X[a * n + i] * yc[i]; q[a] = s; }
      for (let i = 0; i < n; i++) yy += yc[i] * yc[i];
    }
    let cols = null, norm2 = null, yyd = 0;
    if (!gram) { cols = views(X, n, p); norm2 = colNorms(cols, n); for (let i = 0; i < n; i++) yyd += yc[i] * yc[i]; }
    alphas.forEach((alpha) => {
      const a1 = alpha * l1 * n, a2 = alpha * (1.0 - l1) * n;
      if (gram) cdGram(w, a1, a2, Q, q, yy, p, maxIter, tol); else cdDense(w, a1, a2, X, n, p, yc, maxIter, tol, cols, norm2, yyd);
      coefs.push(Float64Array.from(w));
    });
    return coefs;
  }
  /**
   * LassoCV / ElasticNetCV (scikit-learn 1.8 semantics: fit_intercept, alpha grid
   * of ``nAlphas`` values down to eps * alpha_max, warm-started paths per fold,
   * TimeSeriesSplit, mean test MSE, refit on all rows without Gram).
   * @param {number[][]} rows n x p design (already standardised)
   * @param {number[]} y
   */
  function cv(rows, y, o) {
    const n = rows.length, l1s = o.l1Ratios || [1], nA = o.nAlphas || 40, eps = o.eps || 1e-3;
    const maxIter = o.maxIter || 20000, tol = o.tol === undefined ? 1e-4 : o.tol;
    const folds = timeSeriesSplit(n, o.nSplits);
    const grids = l1s.map((l1) => alphaGrid(rows, y, l1, nA, eps));
    let best = null;
    const msePath = l1s.map((l1, li) => {
      const mean = new Float64Array(nA);
      const per = folds.map(({ train, test }) => {
        const c = center(rows, train, y), coefs = path(c, grids[li], l1, maxIter, tol, 'auto');
        return coefs.map((w) => {
          let ic = 0; for (let j = 0; j < c.p; j++) ic += c.off[j] * w[j];
          const icpt = c.yo - ic, res = test.map((i) => { let s = 0; for (let j = 0; j < c.p; j++) s += rows[i][j] * w[j]; const e = (s - y[i]) + icpt; return e * e; });
          return stats.sum(res) / res.length;
        });
      });
      for (let a = 0; a < nA; a++) { let s = 0; for (let f = 0; f < per.length; f++) s += per[f][a]; mean[a] = s / per.length; }
      let ia = 0; for (let a = 1; a < nA; a++) if (mean[a] < mean[ia]) ia = a;
      if (best === null || mean[ia] < best.mse) best = { mse: mean[ia], alpha: grids[li][ia], l1: l1s[li] };
      return Array.from(mean);
    });
    const c = center(rows, seq(n), y), w = new Float64Array(c.p);
    const r = cdDense(w, best.alpha * best.l1 * n, best.alpha * (1.0 - best.l1) * n, c.X, n, c.p, c.yc, maxIter, tol);
    let ic = 0; for (let j = 0; j < c.p; j++) ic += c.off[j] * w[j];
    return { alpha: best.alpha, l1Ratio: best.l1, coef: Array.from(w), intercept: c.yo - ic, alphas: grids, msePath, nIter: r.nIter, dualGap: r.gap / n };
  }
  return { cv, cdDense, cdGram, alphaGrid, timeSeriesSplit, geomspace };
})();

/**
 * Lasso / elastic net on training-standardised predictors (+ gdp_lag1), penalty and
 * l1 ratio by time-series CV on the training rows (engine lasso_* / enet_*).
 * design 'bridge' = period means of visible months; 'umidas' = last ``lags`` visible
 * values per predictor.  Columns need >= 8 training values, a target value and
 * variance; missing training cells get the training mean.
 * @param {{predictors:string[], design?:'bridge'|'umidas', lags?:number, l1Ratios?:number[],
 *   nAlphas?:number, cvSplits?:number, maxIter?:number, tol?:number, eps?:number, minRows?:number, name?:string}} opts
 */
function penalized(kind, opts) {
  opts = opts || {};
  const fields = opts.predictors || [], design = opts.design || 'bridge', K = opts.lags || 3;
  if (design !== 'bridge' && design !== 'umidas') fail('bad_option', `design must be 'bridge' or 'umidas'`);
  const l1s = kind === 'lasso' ? [1] : (opts.l1Ratios || [0.2, 0.5, 0.8]);
  const minRows = opts.minRows === undefined ? MIN_TRAIN : opts.minRows;
  return makeModel('ml', opts.name || `${kind}_${design}`, opts, (train) => {
    const ctx = train.ctx, P = train.periods, fl = ctx.present(fields), h = train.horizon, mode = train.lagMode;
    const cols = ['gdp_lag1'];
    fl.forEach((f) => { if (design === 'bridge') cols.push(f); else for (let l = 0; l < K; l++) cols.push(`${f}_l${l}`); });
    const rowOf = (q, prev) => {
      const r = [ctx.y(prev)];
      if (design === 'bridge') { const m = ctx.visibleMean(q, h, mode, ctx.monthStart); fl.forEach((f) => r.push(m[f])); }
      else { const lv = ctx.lastVisible(q, h, mode, K, ctx.monthStart); fl.forEach((f) => { for (let l = 0; l < K; l++) r.push(lv[f][K - 1 - l]); }); }
      return r;
    };
    const Xtr = P.slice(1).map((q, i) => rowOf(q, P[i])), y = P.slice(1).map((q) => ctx.y(q));
    const xT = rowOf(train.origin.ord, P[P.length - 1]);
    const keep = [];
    cols.forEach((c, j) => { const col = Xtr.map((r) => r[j]); const m = pdMoments(col, 1); if (m.count >= 8 && xT[j] === xT[j] && m.std > 0) keep.push(j); });
    const n = y.length, diag = { n_train: n, n_features: keep.length };
    if (n < minRows || keep.length < 2) return { failure: 'insufficient_effective_training', diagnostics: diag };
    const mu = [], sd = [];
    keep.forEach((j) => { const m = pdMoments(Xtr.map((r) => r[j]), 0); mu.push(m.mean); sd.push(m.std); });
    const Z = Xtr.map((r) => keep.map((j, c) => { const v = (r[j] - mu[c]) / sd[c]; return v === v ? v : 0; }));
    const splits = opts.cvSplits || Math.max(3, Math.min(5, Math.floor(n / 4)));
    const res = enet.cv(Z, y, { l1Ratios: l1s, nAlphas: opts.nAlphas || 40, nSplits: splits, maxIter: opts.maxIter || 20000, tol: opts.tol, eps: opts.eps });
    const names = keep.map((j) => cols[j]);
    const sel = names.filter((_, c) => Math.abs(res.coef[c]) > 1e-10);
    Object.assign(diag, { alpha: res.alpha, l1_ratio: res.l1Ratio, selected: sel, n_selected: sel.length, cv_splits: splits,
      standardisation: { mean: named(names, mu), sd: named(names, sd) } });
    if (TRACE) {
      const reason = cols.map((c, j) => { if (keep.indexOf(j) >= 0) return 'kept'; const m = pdMoments(Xtr.map((r) => r[j]), 1); return m.count < 8 ? 'fewer than 8 training values' : xT[j] !== xT[j] ? 'no value at the forecast origin' : 'no variance'; });
      const months = {};
      fl.forEach((f) => { months[f] = design === 'bridge' ? ctx.visibleMonthsIn(train.origin.ord, h, mode, ctx.monthStart, f) : ctx.lastVisibleMonths(train.origin.ord, h, mode, K, ctx.monthStart, f); });
      diag.trace = { kind: 'penalized', penalty: kind, design, K, fields: fl, cols, keep, reason, periods: P.slice(1).map((q) => ctx.periodLabel(q)), gdpLag: P.slice(0, -1).map((q) => ctx.periodLabel(q)),
        Xtr: Xtr.map((r) => r.slice()), y: y.slice(), xT: xT.slice(), mu, sd, Z: Z.map((r) => r.slice()), splits, folds: enet.timeSeriesSplit(n, splits), l1s,
        alphas: res.alphas, msePath: res.msePath, alpha: res.alpha, l1: res.l1Ratio, coef: res.coef.slice(), intercept: res.intercept, nIter: res.nIter, dualGap: res.dualGap,
        nAlphas: opts.nAlphas || 40, names, months, originGdpLag: ctx.periodLabel(P[P.length - 1]) };
    }
    const coefs = Object.assign({ intercept: res.intercept }, named(names, res.coef));
    return { coefficients: coefs, diagnostics: diag, predict: (o) => {
      const x = o.ord === train.origin.ord && o.day === train.origin.day && o.lagMode === mode ? xT : rowOf(o.ord, P[P.length - 1]);
      const z = keep.map((j, c) => (x[j] - mu[c]) / sd[c]);
      if (hasNaN(z)) return { value: NaN, failure: 'missing_input_at_target' };
      let s = 0; for (let c = 0; c < z.length; c++) s += z[c] * res.coef[c];
      const out = { value: s + res.intercept };
      if (TRACE) out.diagnostics = { trace_now: { x: keep.map((j) => x[j]), z } };
      return out;
    } };
  });
}
const lasso = (opts) => penalized('lasso', opts);
const elasticNet = (opts) => penalized('enet', opts);

// --- Bayesian VAR ----------------------------------------------------------------

/**
 * Normal-inverse-Wishart posterior of a VAR(p) with a Minnesota-type dummy-
 * observation prior (Banbura, Giannone & Reichlin 2010; the engine's
 * bvar_posterior).  Columns of X: lag 1 variables, ..., lag p variables, constant.
 * @param {number[][]} Y T0 x n
 * @returns {{B:number[][], S:number[][], dof:number, XtXinv:number[][], n:number, p:number, T:number, sigma:number[]}}
 */
function bvarPosterior(Y, p, lam, delta, eps) {
  p = p || 1; lam = lam === undefined ? 0.2 : lam; eps = eps === undefined ? 1e-3 : eps;
  const T0 = Y.length, n = Y[0].length, d = delta || new Array(n).fill(0), sig = [];
  for (let i = 0; i < n; i++) {
    const yy = [], X = [];
    for (let t = 1; t < T0; t++) { yy.push(Y[t][i]); X.push([1, Y[t - 1][i]]); }
    const c = linalg.lstsq(X, yy).x, e = yy.map((v, t) => v - (X[t][0] * c[0] + X[t][1] * c[1]));
    sig.push(Math.max(Math.sqrt(stats.variance(e, 0)), 1e-3));
  }
  const k = n * p + 1, Yd = [], Xd = [];
  for (let i = 0; i < n; i++) { const r = new Array(n).fill(0); r[i] = d[i] * sig[i] / lam; Yd.push(r); }
  for (let i = 0; i < n * (p - 1); i++) Yd.push(new Array(n).fill(0));
  for (let i = 0; i < n; i++) { const r = new Array(n).fill(0); r[i] = sig[i]; Yd.push(r); }
  Yd.push(new Array(n).fill(0));
  for (let l = 1; l <= p; l++) for (let i = 0; i < n; i++) { const r = new Array(k).fill(0); r[(l - 1) * n + i] = l * sig[i] / lam; Xd.push(r); }
  for (let i = 0; i < n; i++) Xd.push(new Array(k).fill(0));
  { const r = new Array(k).fill(0); r[k - 1] = eps; Xd.push(r); }
  const Yt = Y.slice(p), Xt = Yt.map((_, t) => { const r = []; for (let l = 1; l <= p; l++) r.push(...Y[p + t - l]); r.push(1); return r; });
  const Ys = Yt.concat(Yd), Xs = Xt.concat(Xd);
  const XtXinv = linalg.inv(linalg.tmatmul(Xs, Xs));
  const B = linalg.matmul(linalg.matmul(XtXinv, linalg.transpose(Xs)), Ys);
  const E = linalg.sub(Ys, linalg.matmul(Xs, B));
  return { B, S: linalg.tmatmul(E, E), dof: Yd.length + 2 + Yt.length - k, XtXinv, n, p, T: Yt.length, sigma: sig, Yd, Xd, Yt, Xt, lam, delta: d, eps };
}

/**
 * Draws of variable 0 next period given observed values of others (cond: {index: value}),
 * integrating over the posterior (engine bvar_conditional_draws; the same draw order).
 */
function bvarConditionalDraws(post, zlags, cond, nDraws, rng) {
  const { n, B, S, dof } = post, k = B.length, xrow = Array.from(zlags).concat([1]);
  const Lv = linalg.cholesky(post.XtXinv.map((r, i) => r.map((v, j) => v + (i === j ? 1e-12 : 0))));
  const idc = Object.keys(cond).map(Number).sort((a, b) => a - b), out = new Float64Array(nDraws);
  for (let d = 0; d < nDraws; d++) {
    const Sig = random.invWishart(rng, dof, S);
    const Ls = linalg.cholesky(Sig.map((r, i) => r.map((v, j) => v + (i === j ? 1e-12 : 0))));
    const Z = []; for (let i = 0; i < k; i++) { const r = []; for (let j = 0; j < n; j++) r.push(rng.normal()); Z.push(r); }
    const Bd = linalg.add(B, linalg.matmul(linalg.matmul(Lv, Z), linalg.transpose(Ls)));
    const mu = new Array(n).fill(0);
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < k; i++) s += xrow[i] * Bd[i][j]; mu[j] = s; }
    let m = mu[0], v = Sig[0][0];
    if (idc.length) {
      const Syc = idc.map((i) => Sig[0][i]), Scc = idc.map((i) => idc.map((j) => Sig[i][j]));
      const gain = linalg.solve(Scc, Syc);
      let a = 0, b = 0; idc.forEach((i, c) => { a += gain[c] * (cond[i] - mu[i]); b += Syc[c] * gain[c]; });
      m = mu[0] + a; v = Sig[0][0] - b;
    }
    out[d] = m + Math.sqrt(Math.max(v, 1e-12)) * rng.normal();
  }
  return out;
}

/**
 * BVAR(p) in the target and AR-extended period means of predictors, Minnesota
 * natural-conjugate prior; nowcast = mean of seeded posterior-predictive draws of
 * the target given the target period's released predictor aggregates, with
 * 68%/90% bands (rng 'numpy' = numpy.random.default_rng(seed), draw for draw).
 * @param {{predictors:string[], lags?:number, lambda?:number, priorMean?:Object<string,number>,
 *   draws?:number, seed?:number, rng?:'numpy'|'mulberry32', minRows?:number, name?:string}} opts
 */
function bvar(opts) {
  opts = opts || {};
  const p = opts.lags || 1, lam = opts.lambda === undefined ? 0.2 : opts.lambda, nDraws = opts.draws || 2000;
  const minRows = opts.minRows === undefined ? MIN_TRAIN : opts.minRows;
  return makeModel('bvar', opts.name || 'bvar', opts, (train) => {
    const ctx = train.ctx, o0 = train.origin, P = train.periods, fl = ctx.present(opts.predictors || []);
    const means = fl.map((f) => ctx.extendedMeans(o0, f));
    let rows = P.map((q) => ({ q, v: [ctx.y(q)].concat(means.map((m) => (m.has(q) ? m.get(q) : NaN))) })).filter((r) => !hasNaN(r.v));
    const run = [];
    for (let i = rows.length - 1; i >= 0; i--) { if (!run.length || rows[i].q + 1 === run[run.length - 1].q) run.push(rows[i]); else break; }
    rows = run.reverse();
    if (rows.length - p < minRows || !rows.length || rows[rows.length - 1].q !== P[P.length - 1]) {
      return { failure: 'insufficient_effective_training', diagnostics: { n_train: Math.max(rows.length - p, 0) } };
    }
    const names = [ctx.targetName].concat(fl), pm = opts.priorMean || {};
    const delta = names.map((c, i) => (pm[c] !== undefined ? pm[c] : (i === 0 || /yoy/.test(c) ? 0.8 : 0.0)));
    const Y = rows.map((r) => r.v), post = bvarPosterior(Y, p, lam, delta, opts.eps);
    const coefs = {};
    names.forEach((to, j) => { for (let l = 1; l <= p; l++) names.forEach((from, i) => { coefs[`${to}~${from}(-${l})`] = post.B[(l - 1) * names.length + i][j]; }); coefs[`${to}~const`] = post.B[post.B.length - 1][j]; });
    const draw = (o) => {
      const cond = {};
      fl.forEach((f, j) => { const m = ctx.extendedMeans(o, f); if (ctx.visibleCount(o, f) >= 1 && m.has(o.ord) && m.get(o.ord) === m.get(o.ord)) cond[j + 1] = m.get(o.ord); });
      const z = []; for (let l = 0; l < p; l++) z.push(...Y[Y.length - 1 - l]);
      const rng = random.make(opts.rng || 'numpy', opts.seed === undefined ? SEED : opts.seed);
      const dr = bvarConditionalDraws(post, z, cond, nDraws, rng), q = stats.percentile(dr, [5, 16, 50, 84, 95]);
      // plug-in point forecast at the posterior means of B and Sigma (no simulation)
      const n = names.length, xr = z.concat([1]), ES = post.S.map((r) => r.map((v) => v / (post.dof - n - 1)));
      const mu = seq(n).map((j) => { let s = 0; for (let i = 0; i < xr.length; i++) s += xr[i] * post.B[i][j]; return s; });
      const idc = Object.keys(cond).map(Number).sort((a, b) => a - b);
      let plug = mu[0], gain = null;
      if (idc.length) { const g = linalg.solve(idc.map((i) => idc.map((j) => ES[i][j])), idc.map((i) => ES[0][i])); gain = g; idc.forEach((i, c) => { plug += g[c] * (cond[i] - mu[i]); }); }
      const out = { value: stats.sum(dr) / dr.length, diagnostics: { band68: [q[1], q[3]], band90: [q[0], q[4]], median: q[2],
        conditioned_on: Object.keys(cond).map((j) => fl[j - 1]), draws: nDraws, plugin_mean: plug, mc_se: Math.sqrt(stats.variance(dr, 1) / nDraws) } };
      if (TRACE) {
        out.diagnostics.trace_now = { cond: idc.map((i) => ({ index: i, field: fl[i - 1], value: cond[i], months: ctx.visibleMonthsIn(o.ord, o.horizon, o.lagMode, ctx.monthStart, fl[i - 1]) })),
          unconditioned: fl.filter((_, j) => cond[j + 1] === undefined), z, xrow: xr, mu, ES, gain, plug, draws: Array.from(dr), quantiles: q, seed: opts.seed === undefined ? SEED : opts.seed,
          rng: opts.rng || 'numpy', ext: fl.map((f) => ctx.extended(o, f)) };
      }
      return out;
    };
    const fitDiag = { n_train: post.T, sample_start: ctx.periodLabel(rows[0].q), prior_mean: named(names, delta), lambda: lam, dof: post.dof };
    if (TRACE) fitDiag.trace = { kind: 'bvar', names, fields: fl, p, lam, delta, nDraws, periods: rows.map((r) => ctx.periodLabel(r.q)), Y: Y.map((r) => r.slice()),
      post: { B: post.B, S: post.S, dof: post.dof, sigma: post.sigma, Yd: post.Yd, Xd: post.Xd, T: post.T, eps: post.eps }, minRows };
    return { coefficients: coefs, diagnostics: fitDiag, predict: draw };
  });
}

// --- Combinations ------------------------------------------------------------------

/**
 * Equal-weight and inverse-MSE combination of one origin (engine _combine).
 * @param {Array<object>} block prediction rows of the origin {model, prediction}
 * @param {Array<object>} history rows of earlier targets (same horizon and lag mode) {model, error}
 * @returns {{equal:number, invmse:number, weights:Object<string,number>|null, n:number, fallback:boolean}|null}
 */
function combineRows(block, history, members, minPast) {
  minPast = minPast === undefined ? 4 : minPast;
  const set = new Set(members), avail = block.filter((r) => set.has(r.model) && r.prediction === r.prediction);
  if (!avail.length) return null;
  const eq = stats.sum(avail.map((r) => r.prediction)) / avail.length;
  const inAvail = new Set(avail.map((r) => r.model)), errs = new Map();
  history.forEach((r) => { if (inAvail.has(r.model) && r.error === r.error) { if (!errs.has(r.model)) errs.set(r.model, []); errs.get(r.model).push(r.error); } });
  const mse = new Map();
  errs.forEach((e, m) => { if (e.length >= minPast) mse.set(m, stats.sum(e.map((x) => x * x)) / e.length); });
  const elig = avail.filter((r) => mse.has(r.model));
  const nPast = {}; errs.forEach((e, m) => { nPast[m] = e.length; });
  const mseObj = {}; mse.forEach((v, m) => { mseObj[m] = v; });
  if (elig.length >= 2) {
    const w = elig.map((r) => 1 / Math.max(mse.get(r.model), 1e-8)), ws = stats.sum(w), wn = w.map((v) => v / ws);
    let inv = 0; elig.forEach((r, i) => { inv += wn[i] * r.prediction; });
    return { equal: eq, invmse: inv, weights: named(elig.map((r) => r.model), wn), n: avail.length, nInv: elig.length, fallback: false, mse: mseObj, nPast, minPast };
  }
  return { equal: eq, invmse: eq, weights: null, n: avail.length, nInv: avail.length, fallback: true, mse: mseObj, nPast, minPast };
}

/**
 * Combination of member models: weights 'equal'; 'invmse' (w ~ 1/MSE of each
 * member's errors at earlier targets, same horizon and lag mode, >= minPast each,
 * else equal); or fixed numbers (all members required, e.g. the ensemble).
 * @param {{members:object[], weights?:'equal'|'invmse'|number[], minPast?:number, historyFrom?:string, name?:string}} opts
 */
function combination(opts) {
  opts = opts || {};
  const members = opts.members || [], wt = opts.weights || 'equal';
  if (!members.length) fail('bad_option', 'combination needs members');
  if (Array.isArray(wt) && wt.length !== members.length) fail('bad_option', 'one weight per member');
  const name = opts.name || `combo_${Array.isArray(wt) ? 'fixed' : wt}`;
  const model = makeModel('combination', name, opts, (train) => {
    const ctx = train.ctx, o = train.origin;
    const block = members.map((m) => { const r = cachedNowcast(ctx, m, o); return { model: m.name, prediction: r.value, n: r.diagnostics.n_train, failure: r.failure }; });
    if (Array.isArray(wt)) {
      const ok = block.every((r) => r.prediction === r.prediction);
      let v = 0; block.forEach((r, i) => { v += wt[i] * r.prediction; });
      const ns = block.map((r) => r.n).filter(isNum);
      const diagnostics = { components: named(block.map((r) => r.model), block.map((r) => r.prediction)), n_train: ns.length ? Math.min(...ns) : null };
      if (TRACE) diagnostics.trace = { kind: 'combination', weighting: 'fixed', weights: wt.slice(), block };
      return { coefficients: named(block.map((r) => r.model), wt), diagnostics,
        predict: () => (ok ? { value: v } : { value: NaN, failure: 'missing_component_prediction' }) };
    }
    let history = [];
    if (wt === 'invmse') {
      const hs = ctx.historyStartOrd(o.ord);
      const from = opts.historyFrom ? ctx.periodOrd(opts.historyFrom) : hs !== null ? hs : (ctx.periods[MIN_TRAIN] === undefined ? Infinity : ctx.periods[MIN_TRAIN]);
      ctx.periods.filter((q) => q >= from && q < o.ord).forEach((q) => {
        const oq = ctx.origin(q, o.horizon, o.lagMode);
        members.forEach((m) => { const r = cachedNowcast(ctx, m, oq); history.push({ model: m.name, target: ctx.periodLabel(q), prediction: r.value, actual: ctx.y(q), error: ctx.y(q) - r.value }); });
      });
    }
    const c = combineRows(block, history, members.map((m) => m.name), opts.minPast);
    if (!c) return { failure: 'no_member_prediction' };
    const value = wt === 'invmse' ? c.invmse : c.equal;
    const diagnostics = { n_members: wt === 'invmse' ? c.nInv : c.n, components: named(block.map((r) => r.model), block.map((r) => r.prediction)), equal_weights_fallback: wt === 'invmse' ? c.fallback : undefined };
    if (TRACE) diagnostics.trace = { kind: 'combination', weighting: wt, block, history, combine: c };
    return { coefficients: wt === 'invmse' && c.weights ? c.weights : named(block.filter((r) => r.prediction === r.prediction).map((r) => r.model), block.filter((r) => r.prediction === r.prediction).map(() => 1 / c.n)),
      diagnostics,
      predict: () => ({ value, failure: wt === 'invmse' && c.fallback ? 'equal_weights_fallback' : null }) };
  });
  model.members = members;
  return model;
}
/** Member nowcasts are cached per context and origin (combinations re-use them). */
function cachedNowcast(ctx, model, origin) {
  return ctx._cached(`nc|${model.name}|${JSON.stringify(model.options, (k, v) => (k === 'members' ? undefined : v))}|${origin.ord}|${origin.day}|${origin.lagMode}`, () => model.nowcast(ctx, origin));
}
/** The 50/50 ensemble: 0.5 AR(2) + 0.5 USD/UZS U-MIDAS(3) (>= 15 rows). */
function ensemble5050(opts) {
  opts = opts || {};
  return combination({ name: opts.name || 'ensemble_ar2_umidas_usd', weights: [0.5, 0.5],
    members: [ar({ p: 2 }), midas({ predictor: opts.predictor || 'usd_uzs_mom_dlog', lags: 3, weighting: 'umidas', minRows: 15 })] });
}

// ---------------------------------------------------------------------------
// Year-to-date bottom-up model (engine uzdata/nowcast/ytd.py)
// ---------------------------------------------------------------------------

/** The panel's ``ytd`` block (sector growth, current-price weights, monthly SIAT indices) for fast lookups. */
function parseYtd(y) {
  if (!y || !y.quarters || !y.growth) return null;
  const qi = new Map(y.quarters.map((q, i) => [q, i])), ind = {};
  Object.keys(y.indicators || {}).forEach((k) => {
    const d = y.indicators[k], by = new Map();
    (d.months || []).forEach((p, i) => { const pp = parsePeriod(p), v = toNum(d.values[i]); if (pp && pp.freq === 'M' && v === v) by.set(pp.ord, v); });
    ind[k] = { name: d.name || k, dataset: d.dataset || null, key: d.key || null, lag: d.lag_days === undefined ? 30 : d.lag_days, by, months: Array.from(by.keys()).sort((a, b) => a - b) };
  });
  const nominalGDP = new Map();
  if (y.gdp_nominal && y.gdp_nominal.quarters) y.gdp_nominal.quarters.forEach((q, i) => { const v = toNum(y.gdp_nominal.values[i]); if (v === v) nominalGDP.set(q, v); });
  else (y.quarters || []).forEach((q, i) => { const v = y.nominal && y.nominal.GDP ? toNum(y.nominal.GDP[i]) : NaN; if (v === v) nominalGDP.set(q, v); });
  return { quarters: y.quarters, qi, sectors: y.sectors, names: y.names || {}, growth: y.growth, nominal: y.nominal, ind,
    map: y.sector_indicators || {}, q1Years: y.q1_years || 3, flashLag: (y.flash && y.flash.lag_days) || 33, weights: y.combination_weights || null, rule: y.rule || '', sources: y.sources || {},
    nominalGDP, nominalSources: (y.gdp_nominal && y.gdp_nominal.sources) || [] };
}
const qParts = (q) => { const m = /^(\d{4})Q([1-4])$/.exec(q); return m ? [+m[1], +m[2]] : null; };
const qLabel = (y, n) => `${y}Q${n}`;
/**
 * Bottom-up nowcast of the year-to-date target at an origin:
 * y = sum_s w_s g_s, w_s = section share over the same months of the previous year (current prices);
 * Q2-Q4: g_s = previous quarter's growth + change of the section's monthly index since the end of that
 * quarter (indices released by the origin), else the previous quarter's growth; Q1: mean of the
 * section's last ``q1Years`` annual growth rates. At the flash stage (``o.horizon`` 'H4', origin from
 * :func:`ytdFlashOrigin`) Q1 sections with an index also move by its change since December.
 * @returns {{value:number, failure:string|null, parts:object[], weightQuarter:string, anchor:string|null}}
 */
function ytdUpdates(Y, sec, o, m0) {
  const ups = [];
  (Y.map[sec] || []).forEach((name) => {
    const d = Y.ind[name]; if (!d || !d.months.length) return;
    const cut = cutoffMonth(o.day, d.lag, o.lagMode);
    let m = null; for (let k = d.months.length - 1; k >= 0; k--) if (d.months[k] <= cut) { m = d.months[k]; break; }
    if (m === null || m <= m0 || !d.by.has(m0)) return;
    const v = d.by.get(m), x0 = d.by.get(m0);
    ups.push({ indicator: name, month: monthISO(m), value: v, base_month: monthISO(m0), base_value: x0, change: v - x0 });
  });
  return ups;
}
function ytdCompute(ctx, Y, o, knownOrds) {
  const t = qParts(o.period); if (!t) return { value: NaN, failure: 'bad_period', parts: [] };
  const [yr, n] = t, isQ1 = n === 1, prev = isQ1 ? qLabel(yr - 1, 4) : qLabel(yr, n - 1), ly = qLabel(yr - 1, n);
  const li = Y.qi.get(ly), gN = li === undefined ? NaN : toNum(Y.nominal.GDP[li]);
  const out = { value: NaN, failure: null, parts: [], weightQuarter: ly, anchor: isQ1 ? null : prev, origin: o.date };
  if (!(gN === gN) || gN === 0) { out.failure = "no_weights: last year's current-price values are missing"; return out; }
  const w = {};
  for (const s of Y.sectors) { const v = toNum(Y.nominal[s][li]); if (!(v === v)) { out.failure = `no_weights: section ${s}`; return out; } w[s] = v / gN; }
  const known = new Set(knownOrds.map((p) => ctx.periodLabel(p)));
  if (!isQ1 && !known.has(prev)) { out.failure = `no_anchor: ${prev} is not published`; return out; }
  const pi = Y.qi.get(prev), m0 = monthOrd(isQ1 ? yr - 1 : yr, isQ1 ? 12 : 3 * (n - 1));
  let total = 0;
  for (const sec of Y.sectors) {
    const part = { sector: sec, name: Y.names[sec] || sec, weight: w[sec], source: '', nowcast: NaN, contribution: NaN };
    let g = NaN;
    if (isQ1) {
      const years = [];
      for (let k = 1; k <= Y.q1Years; k++) { const q = qLabel(yr - k, 4), i = Y.qi.get(q), v = i === undefined ? NaN : toNum(Y.growth[sec][i]); if (v === v) years.push([q, v]); }
      g = years.length ? stats.sum(years.map((x) => x[1])) / years.length : NaN;
      part.source = 'q1_trend'; part.years = years;
      if (o.horizon === YTD_FLASH) {              // flash stage: the Q1 trend moves with the indices since December
        const ups = ytdUpdates(Y, sec, o, m0);
        if (ups.length && g === g) { part.trend = g; g += stats.sum(ups.map((u) => u.change)) / ups.length; part.source = 'q1_trend_indicator'; part.updates = ups; }
      }
    } else {
      const gp = pi === undefined ? NaN : toNum(Y.growth[sec][pi]);
      part.previous = gp; part.source = 'previous'; g = gp;
      const ups = ytdUpdates(Y, sec, o, m0);
      if (ups.length && gp === gp) { g = gp + stats.sum(ups.map((u) => u.change)) / ups.length; part.source = 'indicator'; part.updates = ups; }
    }
    part.nowcast = g; part.contribution = w[sec] * g;
    out.parts.push(part);
    if (!(g === g)) { out.failure = `no_value: section ${sec}`; return out; }
    total += w[sec] * g;
  }
  out.value = total;
  return out;
}
/**
 * Year-to-date bottom-up model (nothing estimated; needs the panel's ``ytd`` block).
 * @param {{name?:string}} [opts]
 */
function ytdBottomUp(opts) {
  opts = opts || {};
  return makeModel('ytd', opts.name || 'ytd_bottom_up', opts, (train) => {
    const ctx = train.ctx, Y = ctx.extra.ytd;
    if (!Y) return { failure: 'no_ytd_data: the panel has no year-to-date sector data' };
    const r = ytdCompute(ctx, Y, train.origin, train.periods);
    const diagnostics = { n_train: null, sections: r.parts.length };
    if (TRACE) diagnostics.trace = Object.assign({ kind: 'ytd', q1Years: Y.q1Years, rule: Y.rule, sources: Y.sources, indicators: Y.ind, map: Y.map }, r);
    if (r.failure) return { failure: r.failure, diagnostics };
    const coefficients = {}; r.parts.forEach((p) => { coefficients[p.sector] = p.weight; });
    return { coefficients, diagnostics, predict: () => ({ value: r.value }) };
  });
}
const YTD_FLASH = 'H4';
/** Flash origin (engine ytd.origin_date at H4): quarter end + the longest indicator lag (``lagMode`` rule). */
function ytdFlashOrigin(ctx, period, lagMode) {
  const o = ctx.origin(period, 'H3', lagMode), Y = ctx.extra.ytd, lag = (Y && Y.flashLag) || 33;
  const day = o.day + effectiveLag(lag, o.lagMode);
  return Object.assign({}, o, { horizon: YTD_FLASH, h: 4, day, date: dayISO(day), month: lastCompleteMonth(day) });
}
/** Flash estimate of ``period`` (engine ytd.flash_rows): the bottom-up model at the flash origin and, given the
 *  ensemble's H3 value, the flash combination 0.5 x ensemble + 0.5 x bottom-up. */
function ytdFlash(ctx, period, lagMode, ensembleH3) {
  const Y = ctx.extra.ytd;
  if (!Y) return { value: NaN, bottomUp: NaN, failure: 'no_ytd_data: the panel has no year-to-date sector data', parts: [] };
  const o = ytdFlashOrigin(ctx, period, lagMode), r = ytdCompute(ctx, Y, o, ctx.train(o).periods);
  const e = ensembleH3 === undefined ? NaN : +ensembleH3;
  return Object.assign(r, { bottomUp: r.value, value: 0.5 * e + 0.5 * r.value, origin: o.date });
}
/** The combination 0.5 x 50/50 ensemble + 0.5 x year-to-date bottom-up. */
function ytdCombination(opts) {
  opts = opts || {};
  return combination({ name: opts.name || 'ytd_combination', weights: [0.5, 0.5],
    members: [opts.ensemble || ensemble5050({ name: 'ensemble_ar2_umidas_usd' }), opts.bottomUp || ytdBottomUp()] });
}

// ---------------------------------------------------------------------------
// Quarterly form (engine ytd.single_quarter / ytd.quarter_form / suite.py).
// y_q = (1 − w_q)·y_(q−1) + w_q·g_q: year-to-date growth y is the previous
// quarter's year-to-date growth and the growth of the single quarter g, weighted
// by the quarter's share w in last year's same-period GDP at current prices.  A
// model in quarterly form is estimated on g and its nowcast ĝ is converted with
// the published y_(q−1) (Q1: y = g, w = 1).
// ---------------------------------------------------------------------------

/** Year-to-date nominal GDP by quarter label (Map) of a context, or null: extra.nominalGDP, else the panel's ytd block. */
function nominalOf(ctx) {
  const n = ctx.extra.nominalGDP || (ctx.extra.ytd && ctx.extra.ytd.nominalGDP);
  return n && n.size ? n : null;
}
/** Weight w of quarter ``ord`` (also the quarter being nowcast) from last year's nominal GDP; NaN if unknown. */
function quarterWeight(ctx, ord) {
  const NG = nominalOf(ctx), lab = ctx.periodLabel(ord), t = qParts(lab);
  if (!t) return NaN;
  if (t[1] === 1) return 1;
  if (!NG) return NaN;
  const N = NG.get(qLabel(t[0] - 1, t[1])), Np = NG.get(qLabel(t[0] - 1, t[1] - 1));
  return N === undefined || Np === undefined || N === 0 ? NaN : (N - Np) / N;
}
/**
 * Single-quarter growth g_q and weights w_q of every published quarter (cached):
 * w = (N − N_prev)/N, g = (y·N − y_prev·N_prev)/(N − N_prev) with N, N_prev last year's
 * year-to-date nominal GDP of the same and the previous quarter.
 * @returns {{g: Map<number, number>, w: Map<number, number>}|null} null without nominal GDP
 */
function quarterSeries(ctx) {
  return ctx._cached('qform|series', () => {
    const NG = nominalOf(ctx);
    if (ctx.freq !== 'Q' || !NG) return null;
    const g = new Map(), w = new Map();
    ctx.periods.forEach((p) => {
      const y = ctx.y(p), t = qParts(ctx.periodLabel(p));
      if (!(y === y) || !t) return;
      if (t[1] === 1) { g.set(p, y); w.set(p, 1); return; }
      const N = NG.get(qLabel(t[0] - 1, t[1])), Np = NG.get(qLabel(t[0] - 1, t[1] - 1)), yp = ctx.y(p - 1);
      if (N === undefined || Np === undefined || !(yp === yp) || N === Np) return;
      const n = N - Np;
      w.set(p, n / N); g.set(p, (y * N - yp * Np) / n);
    });
    return { g, w };
  });
}
/**
 * Context whose target is the single-quarter growth g (monthly data shared); null without nominal GDP.
 * g is kept from the first quarter after its last gap (engine suite.continuous): the models regress g on
 * the previous training quarter, which must be the previous calendar quarter (g 2016Q2-Q4 needs 2015
 * nominal GDP, which is not published quarterly).
 */
function quarterContext(ctx) {
  return ctx._cached('qform|ctx', () => {
    const s = quarterSeries(ctx);
    if (!s) return null;
    let periods = Array.from(s.g.keys()).sort((a, b) => a - b), st = 0;
    for (let i = 1; i < periods.length; i++) if (periods[i] !== periods[i - 1] + 1) st = i;
    periods = periods.slice(st);
    const q = new NowcastData({ monthStart: ctx.monthStart, nMonths: ctx.nMonths, fields: ctx.fields.slice(), values: ctx.values,
      lags: ctx.lags, meta: ctx.meta,
      target: { name: 'gdp_single_quarter_yoy_pct', freq: ctx.freq, periods: periods.map((p) => ctx.periodLabel(p)), values: periods.map((p) => s.g.get(p)), lagDays: ctx.targetLagDays },
      asOf: ctx.asOf, vendorStart: ctx.vendorStart, arStart: ctx.arStart, source: ctx.source, extra: ctx.extra, training: ctx.trainingRule });
    q.parentTarget = ctx;
    return q;
  });
}
/**
 * A model in quarterly form: ``inner`` is estimated on the single-quarter growth g at the
 * same origins, and its nowcast ĝ is converted to year-to-date growth,
 * (1 − w)·y(t−1) + w·ĝ (first quarter: ĝ).  Diagnostics add single_quarter_nowcast,
 * quarter_weight, anchor and anchor_value.
 * @param {object} inner any model object
 * @param {{name?:string}} [opts]
 */
function quarterForm(inner, opts) {
  opts = opts || {};
  const model = makeModel(inner.family, opts.name || inner.name, Object.assign({}, inner.options, { form: 'quarter' }), (train) => {
    const ctx = train.ctx, q = quarterContext(ctx);
    if (!q) return { failure: 'no_quarter_form: the data have no nominal GDP to weight the quarters' };
    const oq = q.origin(train.origin.period, train.origin.horizon, train.origin.lagMode);
    const fitted = inner.fit(q.train(oq));
    if (fitted.failure) return { failure: fitted.failure, diagnostics: fitted.diagnostics };
    return { coefficients: fitted.coefficients, diagnostics: fitted.diagnostics,
      predict: (origin) => {
        const r = fitted.predict(q.origin(origin.period, origin.horizon, origin.lagMode));
        const q1 = /Q1$/.test(origin.period), w = quarterWeight(ctx, origin.ord), a = q1 ? NaN : ctx.y(origin.ord - 1);
        const value = q1 ? r.value : (1 - w) * a + w * r.value;
        const d = Object.assign({}, r.diagnostics, { form: 'quarter', single_quarter_nowcast: r.value, quarter_weight: w,
          anchor: q1 ? null : ctx.periodLabel(origin.ord - 1), anchor_value: q1 ? null : a });
        if (!q1) {                                   // predictive distribution (BVAR): the same linear map
          const cv = (x) => (typeof x === 'number' ? (1 - w) * a + w * x : x);
          if (d.median !== undefined) d.median = cv(d.median);
          ['band68', 'band90'].forEach((k) => { if (Array.isArray(d[k])) d[k] = d[k].map(cv); });
        }
        if (TRACE) {
          d.trace = { kind: 'quarter', inner: r.diagnostics.trace || {}, gHat: r.value, w, anchor: d.anchor, anchorValue: a, q1, value };
          d.trace_now = r.diagnostics.trace_now || {};
        }
        if (!q1 && !(w === w)) return { value: NaN, failure: 'no_quarter_weight', diagnostics: d };
        if (!q1 && !(a === a)) return { value: NaN, failure: 'no_anchor', diagnostics: d };
        return { value, failure: r.failure, coefficients: r.coefficients, diagnostics: d };
      } };
  });
  model.inner = inner;
  model.form = 'quarter';
  return model;
}

// ---------------------------------------------------------------------------
// Evaluation: expanding-window pseudo-out-of-sample loop and accuracy tables
// ---------------------------------------------------------------------------

const DETAIL_KEYS = ['band68', 'band90', 'median', 'conditioned_on', 'weights', 'alpha', 'l1_ratio', 'selected', 'n_selected',
  'n_features', 'theta', 'em_iterations', 'em_converged', 'n_fields', 'ar_order', 'n_members', 'sample_start', 'components',
  'form', 'single_quarter_nowcast', 'quarter_weight', 'anchor', 'anchor_value'];
function toRow(ctx, r, o) {
  const actual = ctx.y(o.ord), details = {};
  DETAIL_KEYS.forEach((k) => { if (r.diagnostics && r.diagnostics[k] !== undefined) details[k] = r.diagnostics[k]; });
  const n = r.diagnostics ? r.diagnostics.n_train : undefined;
  return { model: r.model, family: r.family, target: o.period, horizon: o.horizon, lagMode: o.lagMode, origin: o.date,
    prediction: r.value, actual, error: actual - r.value, n_train: n === undefined ? null : n, failure: r.failure, details };
}
function resolveTargets(ctx, opts) {
  if (opts.targets) return opts.targets.map((t) => ctx.periodOrd(t));
  const known = ctx.periods, rec = opts.from ? null : ctx.recordTargets();
  const from = opts.from ? ctx.periodOrd(opts.from) : (rec.length ? rec[0] : known[known.length - 1] + 1);
  const to = opts.to ? ctx.periodOrd(opts.to) : known[known.length - 1] + 1;
  const out = []; for (let q = from; q <= to; q++) out.push(q);
  return out;
}

/**
 * Accuracy per model x horizon x lag mode (+ pooled over horizons) on the given
 * target periods (engine metrics_table): N, rmse, mae, bias (mean of actual -
 * forecast) and rmse_rel_ar2 = RMSE / RMSE of the benchmark on exactly the same
 * (period, horizon) pairs.
 * @param {object[]} rows prediction rows (evaluate().predictions)
 * @param {string[]} [periods] default: every period with an outcome
 */
function metricsTable(rows, periods, opts) {
  opts = opts || {};
  const bench = opts.benchmark === undefined ? 'ar2' : opts.benchmark, pooled = opts.pooled !== false;
  const set = periods ? new Set(periods) : null;
  const sub = rows.filter((r) => (!set || set.has(r.target)) && r.actual === r.actual);
  const groups = new Map(), order = [];
  const add = (key, r) => { if (!groups.has(key)) { groups.set(key, []); order.push(key); } groups.get(key).push(r); };
  sub.forEach((r) => { add(`${r.model}\u0001${r.horizon}\u0001${r.lagMode}`, r); if (pooled) add(`${r.model}\u0001pooled\u0001${r.lagMode}`, r); });
  const bRows = sub.filter((r) => r.model === bench && r.prediction === r.prediction);
  const hk = (h) => (h === 'pooled' ? 1e9 : +h.slice(1)), mo = new Map();
  order.forEach((k) => { const m = k.split('\u0001')[0]; if (!mo.has(m)) mo.set(m, mo.size); });
  order.sort((a, b) => { const x = a.split('\u0001'), y = b.split('\u0001'); return mo.get(x[0]) - mo.get(y[0]) || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0) || hk(x[1]) - hk(y[1]); });
  return order.map((key) => {
    const g = groups.get(key), [model, horizon, lagMode] = key.split('\u0001');
    const valid = g.filter((r) => r.prediction === r.prediction), st = stats.accuracy(valid.map((r) => r.error));
    const keys = new Set(valid.map((r) => `${r.target}|${r.horizon}`));
    const b = bRows.filter((r) => r.lagMode === lagMode && (horizon === 'pooled' || r.horizon === horizon) && keys.has(`${r.target}|${r.horizon}`));
    const bst = stats.accuracy(b.map((r) => r.error));
    const qs = valid.map((r) => r.target).sort();
    return { model, family: g[0].family, horizon, lagMode, N: st.N, rmse: st.rmse, mae: st.mae, bias: st.bias,
      benchmark_rmse: bst.rmse, rmse_rel_ar2: bst.rmse ? st.rmse / bst.rmse : NaN,
      first: qs.length ? qs[0] : null, last: qs.length ? qs[qs.length - 1] : null };
  });
}

/**
 * Expanding-window pseudo-out-of-sample evaluation: each model refitted at every
 * origin (target x horizon x lag mode) on the periods before the target only.
 * @param {NowcastData} ctx
 * @param {object[]} models
 * @param {{from?, to?, targets?, horizons?, lagModes?, lagMode?, asOf?, benchmark?:boolean}} [opts]
 *   benchmark (default true) adds AR(2) for rmse_rel_ar2; origins after ``asOf`` are skipped
 * @returns {{predictions:object[], metrics:object[], metricsFor:function(string[]):object[]}}
 */
function evaluate(ctx, models, opts) {
  opts = opts || {};
  const targets = resolveTargets(ctx, opts), horizons = opts.horizons || horizonsFor(ctx.freq);
  const modes = opts.lagModes || [opts.lagMode || 'standard'], asOfDay = opts.asOf ? isoDay(opts.asOf) : null;
  const list = models.slice();
  if (opts.benchmark !== false && !list.some((m) => m.name === 'ar2')) list.push(ar({ p: 2 }));
  const rows = [];
  modes.forEach((mode) => targets.forEach((t) => horizons.forEach((h) => {
    const o = ctx.origin(t, h, mode);
    if (asOfDay !== null && o.day > asOfDay) return;
    list.forEach((m) => rows.push(toRow(ctx, cachedNowcast(ctx, m, o), o)));
  })));
  return { predictions: rows, metrics: metricsTable(rows), metricsFor: (periods, o) => metricsTable(rows, periods, o) };
}

// ---------------------------------------------------------------------------
// Engine: the Hub's Python run (uzdata.nowcast.models.evaluate) on the panel
// ---------------------------------------------------------------------------

const engine = (function () {
  const USD = 'usd_uzs_mom_dlog', USD_UMIDAS = 'umidas_usd_uzs_mom_dlog', USD_ALMON = 'almon_usd_uzs_mom_dlog', KALMAN_FACTORS = 1;
  const ENSEMBLE = 'ensemble_ar2_umidas_usd', YTD = 'ytd_bottom_up', YTD_COMBO = 'ytd_combination';
  // the headline since 2026-10-06 (engine ytd.HEADLINE_COMBINATION): 0.5 bottom-up + 0.5 Kalman factor model on
  // six real-activity series, real M2 (CPI from 2019) and USD/UZS (models.KALMAN_ACTIVITY, quarterly form)
  const KALMAN_ACTIVITY = 'dfm_kalman_activity', HEADLINE = 'bu_kalman_combination';
  // the V2 method computed by the engine (engine models.V2_DFM / V2_COMBO): 1-factor Kalman DFM on V2's eight
  // indicators in year-to-date form, and its 50/50 combination with the USD/UZS U-MIDAS(3)
  const V2_DFM = 'v2_dfm_kalman', V2_COMBO = 'v2_combination';
  const V2_FIELDS = ['m2_yoy_log', 'usd_uzs_mom_dlog', 'fx_reserves_exgold_yoy_log', 'real_ind_prod_pct', 'rub_uzs_mom_dlog',
    'ppi_mom_log', 'gold_price_mom_dlog', 'pos_turnover_yoy_log'];
  const KALMAN_ACTIVITY_FIELDS = ['ind_prod_yoy_log', 'manufacturing_yoy_log', 'mining_yoy_log', 'utilities_yoy_log', 'retail_yoy_log',
    'wholesale_yoy_log', 'real_m2_yoy_log', 'usd_uzs_mom_dlog'];
  const COMBO_POOL = ['ar2', USD_UMIDAS, 'dfm_kalman', 'bridge_ar_mean', 'lasso_bridge', 'enet_bridge', 'lasso_umidas',
    'enet_umidas', 'bvar', 'midas_expalmon_mean', 'midas_beta_mean'];
  const FAMILY_COMBOS = { bridge_ar: 'bridge_ar_', midas_expalmon: 'midas_expalmon_', midas_beta: 'midas_beta_' };
  // vendor bridge.ECONOMIC_BLOCKS and midas.default_midas_specs candidates (field names verbatim)
  const ECONOMIC_BLOCKS = [
    ['activity', ['ind_prod_yoy_log', 'manufacturing_yoy_log', 'mining_yoy_log', 'electricity_gas_yoy_log', 'construction_yoy_log', 'retail_trade_yoy_log', 'wholesale_trade_yoy_log']],
    ['prices', ['cpi_headline_mom_log', 'cpi_food_mom_log', 'cpi_services_mom_log', 'ppi_mom_log']],
    ['external', ['exports_total_yoy_log', 'exports_non_gold_yoy_log', 'imports_total_yoy_log', 'gold_exports_proxy_usd_m', 'usd_uzs_mom_dlog', 'rub_uzs_mom_dlog', 'gold_price_yoy_log']],
    ['monetary', ['m2_yoy_log', 'fx_reserves_exgold_yoy_log']]];
  const MIDAS_CANDIDATES = ['ind_prod_yoy_log', 'construction_yoy_log', 'retail_trade_yoy_log', 'cpi_headline_mom_log', 'ppi_mom_log',
    'exports_total_yoy_log', 'imports_total_yoy_log', 'usd_uzs_mom_dlog', 'm2_yoy_log'];
  const BVAR_PRIOR = { gdp_real_yoy_pct: 0.8, ind_prod_yoy_log: 0.8, m2_yoy_log: 0.8, usd_uzs_mom_dlog: 0.0 };
  // experimental models (engine models.EXPERIMENTAL_MODELS): estimated and scored like the others, never members
  // of a combination; built when their extra fields have data
  const EXPERIMENTAL = { dfm_tierC_k1_ntl: { family: 'dfm', tier: 'C', extra: ['ntl_yoy_log'], factors: 1, baseline: 'dfm_tierC_k1' },
    dfm_activity_k1: { family: 'dfm', tier: 'B', fields: ['ind_prod_yoy_log', 'manufacturing_yoy_log', 'mining_yoy_log', 'utilities_yoy_log', 'retail_yoy_log', 'wholesale_yoy_log', 'm2_yoy_log', 'usd_uzs_mom_dlog'], extra: [], factors: 1, baseline: 'dfm_tierC_k1' } };
  /** Factor-panel fields of an experimental model: its own list (``fields``), else its tier plus ``extra``. */
  const experimentalFields = (e, tf) => (e.fields ? e.fields.slice() : tf[e.tier].concat(e.extra));

  function hasData(ctx, f) { const a = ctx.values[f]; if (!a) return false; for (let i = 0; i < a.length; i++) if (a[i] === a[i]) return true; return false; }
  function tierFields(ctx) {
    const tiers = ctx.extra.tiers || {}, byKey = {};
    ctx.fields.forEach((f) => { if (ctx.meta[f] && ctx.meta[f].key) byKey[ctx.meta[f].key] = f; });
    const have = new Set(ctx.fields.filter((f) => { const a = ctx.values[f]; for (let i = 0; i < a.length; i++) if (a[i] === a[i]) return true; return false; }));
    const keys = { A: tiers.A || [], B: (tiers.A || []).concat(tiers.B || []), C: (tiers.A || []).concat(tiers.B || [], tiers.C || []) };
    const out = {};
    Object.keys(keys).forEach((t) => { out[t] = keys[t].map((k) => byKey[k]).filter((f) => f && have.has(f)); });
    return out;
  }
  const tag = (m, role, tier) => Object.assign(m, { role, tier: tier || '' });
  /** The core model families on the panel (engine core_specs + benchmarks + USD models). */
  function coreModels(ctx) {
    const tf = tierFields(ctx), out = [];
    out.push(tag(historicalMean(), 'benchmark'), tag(ar({ p: 1 }), 'benchmark'), tag(ar({ p: 2 }), 'benchmark'));
    if (ctx.has(USD)) {
      out.push(tag(midas({ predictor: USD, lags: 3, weighting: 'umidas', minRows: 15, name: USD_UMIDAS }), 'model', 'A'));
      out.push(tag(midas({ predictor: USD, lags: 3, weighting: 'almon', poly: 1, minRows: 12, name: USD_ALMON }), 'model', 'A'));
    }
    const specs = (have) => {
      const s = [];
      ECONOMIC_BLOCKS.forEach(([block, fields]) => {
        fields.forEach((f) => { if (have.indexOf(f) >= 0) s.push({ name: `bridge_${f}`, fields: [f] }); });
        const bf = fields.filter((f) => have.indexOf(f) >= 0);
        if (bf.length >= 2) s.push({ name: `bridge_block_${block}`, fields: bf.slice(0, 3), block: true });
      });
      return s;
    };
    const bridges = [];
    specs(tf.C).forEach((s) => { if (!s.block) bridges.push({ name: s.name, fields: s.fields, tier: 'C' }); });
    ['A', 'B', 'C'].forEach((t) => specs(tf[t]).forEach((s) => {
      if (s.block && !bridges.some((b) => b.fields.join('|') === s.fields.join('|'))) bridges.push({ name: `${s.name}_tier${t}`, fields: s.fields, tier: t });
    }));
    // indicator models: quarterly form (estimated on the single quarter's growth, converted)
    bridges.forEach((b) => out.push(tag(quarterForm(bridge({ predictors: b.fields, name: b.name })), b.fields.length > 1 ? 'model' : 'single', b.tier)));
    MIDAS_CANDIDATES.forEach((f) => {
      if (tf.C.indexOf(f) < 0 || f === USD) return;
      out.push(tag(quarterForm(midas({ predictor: f, lags: 3, weighting: 'umidas' })), 'single', 'C'));
      out.push(tag(quarterForm(midas({ predictor: f, lags: 3, weighting: 'almon', poly: 1 })), 'single', 'C'));
    });
    [['A', 1], ['B', 1], ['C', 1]].forEach(([t, k]) => {
      out.push(tag(quarterForm(dfm({ predictors: tf[t], factors: k, emIterations: 100, emTolerance: 1e-4, minObservedMonths: 12, name: `dfm_tier${t}_k${k}` })), 'model', t));
    });
    if (V2_FIELDS.every((f) => hasData(ctx, f))) out.push(tag(dfmKalman({ predictors: V2_FIELDS, factors: KALMAN_FACTORS, name: V2_DFM }), 'model', 'A'));
    if (KALMAN_ACTIVITY_FIELDS.every((f) => hasData(ctx, f))) {
      out.push(tag(quarterForm(dfmKalman({ predictors: KALMAN_ACTIVITY_FIELDS, factors: KALMAN_FACTORS, name: KALMAN_ACTIVITY })), 'model', 'B'));
    }
    Object.keys(EXPERIMENTAL).forEach((name) => {
      const e = EXPERIMENTAL[name];
      if (!(e.fields || e.extra).every((f) => hasData(ctx, f))) return;
      out.push(tag(quarterForm(dfm({ predictors: experimentalFields(e, tf), factors: e.factors, emIterations: 100, emTolerance: 1e-4, minObservedMonths: 12, name })), 'experimental', e.tier));
    });
    return out;
  }
  /** The extended suite, in quarterly form: dfm_kalman (1 factor), bridge_ar per field, lasso/enet, bvar, MIDAS exp-Almon and Beta per field. */
  function extendedModels(ctx) {
    const fields = ctx.present(ctx.extra.modelFields || ctx.fields), bv = ctx.present(ctx.extra.bvarFields || []);
    const out = [tag(quarterForm(dfmKalman({ predictors: fields, factors: KALMAN_FACTORS })), 'model')];
    fields.forEach((f) => out.push(tag(quarterForm(bridge({ predictors: [f], extension: 'ar', name: `bridge_ar_${f}` })), 'single')));
    ['bridge', 'umidas'].forEach((d) => { out.push(tag(quarterForm(lasso({ predictors: fields, design: d })), 'model'), tag(quarterForm(elasticNet({ predictors: fields, design: d })), 'model')); });
    out.push(tag(quarterForm(bvar({ predictors: bv, lags: 1, lambda: 0.2, priorMean: BVAR_PRIOR, draws: 2000, seed: SEED, rng: 'numpy' })), 'model'));
    fields.forEach((f) => ['expalmon', 'beta'].forEach((w) => out.push(tag(quarterForm(midas({ predictor: f, weighting: w, lags: 6 })), 'single'))));
    return out;
  }
  /**
   * Every model of the Python run as a model object, by name: the core families, the
   * extended suite, the 50/50 ensemble, the family combinations (bridge_ar_*,
   * midas_expalmon_*, midas_beta_* mean / invmse) and the pool combinations
   * (combo_equal, combo_invmse) -- the latter re-run their members at every
   * earlier origin, so prefer workings.fromRows with published predictions for them.
   */
  function registry(ctx) {
    return ctx._cached('engine|registry', () => {
      const m = new Map();
      coreModels(ctx).forEach((x) => m.set(x.name, x));
      extendedModels(ctx).forEach((x) => m.set(x.name, x));
      m.set(ENSEMBLE, tag(ensemble5050({ name: ENSEMBLE }), 'combination'));
      if (m.has(V2_DFM) && m.has(USD_UMIDAS)) m.set(V2_COMBO, tag(combination({ name: V2_COMBO, weights: [0.5, 0.5], members: [m.get(V2_DFM), m.get(USD_UMIDAS)] }), 'combination'));
      if (ctx.extra.ytd) {
        m.set(YTD, tag(ytdBottomUp({ name: YTD }), 'model'));
        m.set(YTD_COMBO, tag(ytdCombination({ name: YTD_COMBO, ensemble: m.get(ENSEMBLE), bottomUp: m.get(YTD) }), 'combination'));
        if (m.has(KALMAN_ACTIVITY)) m.set(HEADLINE, tag(combination({ name: HEADLINE, weights: [0.5, 0.5], members: [m.get(YTD), m.get(KALMAN_ACTIVITY)] }), 'combination'));
      }
      const base = Array.from(m.values()).filter((x) => x.name !== YTD && x.name !== YTD_COMBO && x.name !== HEADLINE && x.name !== V2_COMBO);
      Object.keys(FAMILY_COMBOS).forEach((fam) => {
        const members = base.filter((x) => x.name.indexOf(FAMILY_COMBOS[fam]) === 0 && !/_(mean|invmse)$/.test(x.name));
        if (members.length) [['mean', 'equal'], ['invmse', 'invmse']].forEach(([s, w]) => m.set(`${fam}_${s}`, tag(combination({ members, weights: w, name: `${fam}_${s}` }), 'combination', '')));
      });
      const order = Array.from(m.keys()), pool = COMBO_POOL.filter((n) => m.has(n)).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((n) => m.get(n));
      if (pool.length) [['combo_equal', 'equal'], ['combo_invmse', 'invmse']].forEach(([n, w]) => m.set(n, tag(combination({ members: pool, weights: w, name: n }), 'combination', '')));
      return m;
    });
  }
  const modelByName = (ctx, name) => registry(ctx).get(name) || null;
  /** Evaluation targets (engine evaluation_targets): the track record (NowcastData.recordTargets), plus ``extra``. */
  function targets(ctx, extra) {
    const qs = ctx.recordTargets().map((q) => ctx.periodLabel(q));
    (extra || []).forEach((q) => { if (qs.indexOf(q) < 0) qs.push(q); });
    return qs;
  }
  function comboRows(block, hist, members, nameEq, nameInv, family) {
    const c = combineRows(block, hist, members);
    if (!c) return [];
    const b0 = block[0], base = { target: b0.target, horizon: b0.horizon, lagMode: b0.lagMode, origin: b0.origin, actual: b0.actual, n_train: null, family };
    const row = (model, v, extra) => Object.assign({ model, prediction: v, error: b0.actual - v, failure: null, details: {} }, base, extra || {});
    return [row(nameEq, c.equal, { details: { n_members: c.n } }),
      c.fallback ? row(nameInv, c.equal, { failure: 'equal_weights_fallback', details: { n_members: c.n } })
        : row(nameInv, c.invmse, { details: { n_members: c.nInv, weights: c.weights } })];
  }
  /** Family and pool combinations over targets in order (engine add_combinations); with ``ctx`` (training
   *  rule) the weights of a target use only errors from its history start (NowcastData.historyStartOrd). */
  function addCombinations(rows, ctx) {
    const h0 = (t) => { const s = ctx && ctx.training ? ctx.historyStartOrd(ctx.periodOrd(t)) : null; return s === null ? '' : ctx.periodLabel(s); };
    const models = []; const seen = new Set(); rows.forEach((r) => { if (!seen.has(r.model)) { seen.add(r.model); models.push(r.model); } });
    const fams = Object.keys(FAMILY_COMBOS).map((name) => [name, models.filter((m) => m.startsWith(FAMILY_COMBOS[name]) && !/_(mean|invmse)$/.test(m))]);
    const groups = new Map();
    rows.forEach((r) => { const k = `${r.horizon}|${r.lagMode}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    const extra = [];
    Array.from(groups.keys()).sort().forEach((k) => {
      const grp = groups.get(k), ts = Array.from(new Set(grp.map((r) => r.target))).sort(), famRows = [];
      ts.forEach((t) => {
        const s = h0(t), block = grp.filter((r) => r.target === t), hist = grp.filter((r) => r.target < t && r.target >= s && r.actual === r.actual);
        const fh = famRows.filter((r) => r.target < t && r.target >= s && r.actual === r.actual);
        let nw = [];
        fams.forEach(([name, members]) => { nw = nw.concat(comboRows(block, hist, members, `${name}_mean`, `${name}_invmse`, name)); });
        famRows.push(...nw);
        extra.push(...nw, ...comboRows(block.concat(nw), hist.concat(fh), COMBO_POOL, 'combo_equal', 'combo_invmse', 'combination'));
      });
    });
    return rows.concat(extra);
  }
  function addEnsemble(rows) {
    const idx = new Map(); rows.forEach((r) => { if (r.model === 'ar2' || r.model === USD_UMIDAS) idx.set(`${r.model}|${r.target}|${r.horizon}|${r.lagMode}`, r); });
    const out = [];
    rows.forEach((a) => {
      if (a.model !== 'ar2') return;
      const u = idx.get(`${USD_UMIDAS}|${a.target}|${a.horizon}|${a.lagMode}`); if (!u) return;
      const ok = a.prediction === a.prediction && u.prediction === u.prediction, v = ok ? 0.5 * a.prediction + 0.5 * u.prediction : NaN;
      const ns = [a.n_train, u.n_train].filter(isNum);
      out.push({ model: ENSEMBLE, family: 'ensemble', target: a.target, horizon: a.horizon, lagMode: a.lagMode, origin: a.origin, prediction: v,
        actual: a.actual, error: a.actual - v, n_train: ns.length ? Math.min(...ns) : null, failure: ok ? null : 'missing_component_prediction',
        details: { components: { ar2: a.prediction, [USD_UMIDAS]: u.prediction } } });
    });
    return rows.concat(out);
  }
  /** 0.5 V2 Kalman DFM + 0.5 USD/UZS U-MIDAS for every origin of both (engine models.add_v2_combination). */
  function addV2(rows) {
    const idx = new Map(); rows.forEach((r) => { if (r.model === USD_UMIDAS) idx.set(`${r.target}|${r.horizon}|${r.lagMode}`, r); });
    const out = [];
    rows.forEach((a) => {
      if (a.model !== V2_DFM) return;
      const u = idx.get(`${a.target}|${a.horizon}|${a.lagMode}`); if (!u) return;
      const ok = a.prediction === a.prediction && u.prediction === u.prediction, v = ok ? 0.5 * a.prediction + 0.5 * u.prediction : NaN;
      out.push({ model: V2_COMBO, family: 'combination', target: a.target, horizon: a.horizon, lagMode: a.lagMode, origin: a.origin, prediction: v,
        actual: a.actual, error: a.actual - v, n_train: null, failure: ok ? null : 'missing_component_prediction',
        details: { components: { [V2_DFM]: a.prediction, [USD_UMIDAS]: u.prediction } } });
    });
    return rows.concat(out);
  }
  /**
   * Every forecast of the core families and the extended suite at every origin, with the ensemble and
   * the combinations -- the prediction table of the Hub's Python run.
   * @param {NowcastData} ctx context from nowcast_panel.json
   * @param {{targets?:string[], horizons?:string[], lagModes?:string[], extendedModes?:string[],
   *   asOf?:string, core?:boolean, extended?:boolean, onProgress?:function}} [opts]
   */
  function evaluateAll(ctx, opts) {
    opts = opts || {};
    const asOf = opts.asOf || ctx.asOf, prod = ctx.productionOrigin(asOf);
    const tgs = opts.targets || targets(ctx, [prod.period]), horizons = opts.horizons || ['H1', 'H2', 'H3'];
    const modes = opts.lagModes || LAG_MODES, extModes = opts.extendedModes || modes, asOfDay = isoDay(asOf);
    const core = opts.core === false ? [] : coreModels(ctx), ext = opts.extended === false ? [] : extendedModels(ctx);
    const rows = [];
    modes.forEach((mode) => tgs.forEach((t) => {
      horizons.forEach((h) => {
        const o = ctx.origin(t, h, mode); if (o.day > asOfDay) return;
        core.forEach((m) => rows.push(Object.assign(toRow(ctx, m.nowcast(ctx, o), o), { role: m.role, tier: m.tier })));
        if (extModes.indexOf(mode) >= 0) ext.forEach((m) => rows.push(Object.assign(toRow(ctx, m.nowcast(ctx, o), o), { role: m.role })));
      });
      if (opts.onProgress) opts.onProgress(t, mode);
    }));
    let out = rows;
    if (opts.core !== false) out = addV2(addEnsemble(out));
    if (opts.extended !== false) out = addCombinations(out, ctx);
    if (opts.core !== false && ctx.extra.ytd) out = addYtd(ctx, out);
    return out;
  }
  /** Year-to-date bottom-up, its combination with the ensemble and the headline (bottom-up + Kalman activity model)
   *  for every ensemble row (engine ytd.add_rows). */
  function addYtd(ctx, rows) {
    const bu = ytdBottomUp({ name: YTD }), out = [], kal = new Map();
    rows.forEach((r) => { if (r.model === KALMAN_ACTIVITY) { const k = `${r.target}|${r.horizon}|${r.lagMode}`; if (!kal.has(k)) kal.set(k, r.prediction); } });
    rows.forEach((e) => {
      if (e.model !== ENSEMBLE) return;
      const o = ctx.origin(e.target, e.horizon, e.lagMode), r = bu.nowcast(ctx, o), v = r.value;
      const base = { target: e.target, horizon: e.horizon, lagMode: e.lagMode, origin: e.origin, actual: e.actual, n_train: null };
      out.push(Object.assign({ model: YTD, family: 'ytd', role: 'model', prediction: v, error: e.actual - v, failure: r.failure, details: {} }, base));
      const ok = v === v && e.prediction === e.prediction, c = ok ? 0 + 0.5 * e.prediction + 0.5 * v : NaN;
      out.push(Object.assign({ model: YTD_COMBO, family: 'combination', role: 'combination', prediction: c, error: e.actual - c,
        failure: ok ? null : 'missing_component_prediction', details: { components: { [ENSEMBLE]: e.prediction, [YTD]: v } } }, base));
      const kv = kal.has(`${e.target}|${e.horizon}|${e.lagMode}`) ? kal.get(`${e.target}|${e.horizon}|${e.lagMode}`) : NaN;
      const okh = v === v && kv === kv, hc = okh ? 0 + 0.5 * v + 0.5 * kv : NaN;
      out.push(Object.assign({ model: HEADLINE, family: 'combination', role: 'combination', prediction: hc, error: e.actual - hc,
        failure: okh ? null : 'missing_component_prediction', details: { components: { [YTD]: v, [KALMAN_ACTIVITY]: kv } } }, base));
    });
    return rows.concat(out);
  }
  return { COMBO_POOL, FAMILY_COMBOS, ECONOMIC_BLOCKS, MIDAS_CANDIDATES, BVAR_PRIOR, USD_UMIDAS, USD_ALMON, ENSEMBLE, YTD, YTD_COMBO, KALMAN_ACTIVITY, KALMAN_ACTIVITY_FIELDS, HEADLINE, V2_DFM, V2_COMBO, V2_FIELDS, addV2, EXPERIMENTAL, experimentalFields,
    coreModels, extendedModels, registry, modelByName, targets, evaluateAll, addCombinations, addEnsemble, addYtd, tierFields };
})();

// ---------------------------------------------------------------------------
// runSpec: models from a JSON description (for people and AI assistants)
// ---------------------------------------------------------------------------

const INT = (min, max, def) => ({ type: 'int', min, max, def });
const NUM = (min, max, def) => ({ type: 'number', min, max, def });
const ENUM = (values, def) => ({ type: 'enum', values, def });
const SPEC_FAMILIES = {
  mean: { predictors: [0, 0], options: {}, doc: 'historical mean of the target' },
  ar: { predictors: [0, 0], options: { p: INT(1, 8, 1) }, doc: 'AR(p) on the target' },
  bridge: { predictors: [1, 12], options: { extension: ENUM(['none', 'ar'], 'none'), minRows: INT(3, 200) },
    doc: 'bridge equation on period means of visible months (extension ar: AR-extended missing months)' },
  bridge_ar: { predictors: [1, 12], options: { minRows: INT(3, 200) }, doc: 'bridge equation with AR-extended missing months' },
  midas: { predictors: [1, 1], options: { lags: INT(1, 36), weighting: ENUM(['umidas', 'almon', 'expalmon', 'beta'], 'umidas'),
    poly: INT(0, 4, 1), estimation: ENUM(['grid', 'nls'], 'grid'), minRows: INT(3, 200) }, doc: 'MIDAS on one monthly predictor' },
  dfm: { predictors: [2, 60], options: { factors: INT(1, 6, 1), emIterations: INT(1, 1000, 100), emTolerance: NUM(1e-12, 1, 1e-4),
    minObservedMonths: INT(1, 600, 12), minRows: INT(3, 200) }, doc: 'EM-PCA approximate dynamic factor model' },
  dfm_kalman: { predictors: [3, 60], options: { factors: INT(1, 5, 1), maxIter: INT(1, 1000, 60), tol: NUM(1e-12, 1, 1e-4),
    windowStart: { type: 'month' }, minRows: INT(3, 200) }, doc: 'dynamic factor model, Kalman filter/smoother, EM' },
  lasso: { predictors: [1, 60], options: { design: ENUM(['bridge', 'umidas'], 'bridge'), lags: INT(1, 12, 3), nAlphas: INT(5, 200, 40),
    cvSplits: INT(2, 10), maxIter: INT(10, 1e6, 20000), tol: NUM(1e-12, 1, 1e-4), eps: NUM(1e-8, 0.5, 1e-3), minRows: INT(3, 200) },
    doc: 'Lasso with time-series cross-validation' },
  enet: { predictors: [1, 60], options: { design: ENUM(['bridge', 'umidas'], 'bridge'), lags: INT(1, 12, 3), nAlphas: INT(5, 200, 40),
    l1Ratios: { type: 'numbers', min: 1e-6, max: 1 }, cvSplits: INT(2, 10), maxIter: INT(10, 1e6, 20000), tol: NUM(1e-12, 1, 1e-4),
    eps: NUM(1e-8, 0.5, 1e-3), minRows: INT(3, 200) }, doc: 'elastic net with time-series cross-validation' },
  bvar: { predictors: [1, 8], options: { lags: INT(1, 4, 1), lambda: NUM(1e-4, 100, 0.2), priorMean: { type: 'object' },
    draws: INT(100, 50000, 2000), seed: INT(0, 4294967295, SEED), rng: ENUM(['numpy', 'mulberry32'], 'numpy'), minRows: INT(3, 200) },
    doc: 'Bayesian VAR with Minnesota natural-conjugate prior, conditional nowcast' },
  ensemble: { predictors: [0, 1], options: {}, doc: 'ensemble 0.5 AR(2) + 0.5 U-MIDAS(3) of USD/UZS (or the given predictor)' },
  v2: { predictors: [3, 60], options: { factors: INT(1, 5, 1) },
    doc: 'V2 method: 0.5 Kalman DFM on the predictors (year-to-date form) + 0.5 U-MIDAS(3) of USD/UZS' },
  combination: { predictors: [0, 0], options: { members: { type: 'specs' }, weights: { type: 'weights' }, minPast: INT(1, 100, 4),
    historyFrom: { type: 'period' } }, doc: 'forecast combination of member specs (equal, inverse-MSE or fixed weights)' },
};

function editDistance(a, b) {
  const d = seq(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
function suggest(name, pool) {
  const s = String(name).toLowerCase(), scored = pool.map((p) => [p, p.toLowerCase().indexOf(s) >= 0 || s.indexOf(p.toLowerCase()) >= 0 ? 0 : editDistance(s, p.toLowerCase())]);
  scored.sort((a, b) => a[1] - b[1]);
  return scored.filter((x) => x[1] <= Math.max(3, s.length / 3)).slice(0, 3).map((x) => x[0]);
}

/**
 * Check a model spec against the data; returns a list of {path, message} (empty = valid).
 * @param {object} spec see ECON_API.md
 * @param {NowcastData} [ctx]
 */
function validateSpec(spec, ctx, path) {
  path = path || '';
  const errs = [], err = (p, m) => errs.push({ path: path + p, message: m });
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) { err('', 'spec must be an object like {family, predictors, options}'); return errs; }
  const known = ['family', 'target', 'predictors', 'options', 'form', 'origin', 'evaluation', 'name', 'asOf', 'series'];
  Object.keys(spec).forEach((k) => { if (known.indexOf(k) < 0) err(k, `unknown key '${k}'${suggest(k, known).length ? `; did you mean '${suggest(k, known)[0]}'?` : ''} (allowed: ${known.join(', ')})`); });
  const fam = SPEC_FAMILIES[spec.family];
  if (!fam) { err('family', `unknown family '${spec.family}'; use one of ${Object.keys(SPEC_FAMILIES).join(', ')}`); return errs; }
  if (spec.target !== undefined && ctx && spec.target !== ctx.targetName) err('target', `target '${spec.target}' is not the data's target '${ctx.targetName}'`);
  const preds = spec.predictors === undefined ? [] : spec.predictors;
  if (!Array.isArray(preds)) err('predictors', 'predictors must be an array of field names');
  else {
    const [lo, hi] = fam.predictors;
    if (preds.length < lo || preds.length > hi) err('predictors', lo === hi ? `${spec.family} takes ${lo === 0 ? 'no' : 'exactly ' + lo} predictor${lo === 1 ? '' : 's'}` : `${spec.family} takes ${lo} to ${hi} predictors, got ${preds.length}`);
    const extra = (spec.series || []).map((s) => s && s.name);
    preds.forEach((p, i) => {
      if (typeof p !== 'string') { err(`predictors[${i}]`, 'predictor names must be strings'); return; }
      if (ctx && !ctx.has(p) && extra.indexOf(p) < 0) {
        const s = suggest(p, ctx.fields);
        err(`predictors[${i}]`, `unknown predictor '${p}'${s.length ? `; did you mean ${s.map((x) => `'${x}'`).join(' or ')}?` : ''}`);
      }
    });
    if (new Set(preds).size !== preds.length) err('predictors', 'duplicate predictors');
  }
  const opts = spec.options === undefined ? {} : spec.options;
  if (typeof opts !== 'object' || Array.isArray(opts)) err('options', 'options must be an object');
  else Object.keys(opts).forEach((k) => {
    const def = fam.options[k], v = opts[k], p = `options.${k}`;
    if (!def) { const s = suggest(k, Object.keys(fam.options)); err(p, `unknown option '${k}' for ${spec.family}${s.length ? `; did you mean '${s[0]}'?` : ''} (allowed: ${Object.keys(fam.options).join(', ') || 'none'})`); return; }
    if (def.type === 'int' && !(Number.isInteger(v) && v >= def.min && v <= def.max)) err(p, `${k} must be an integer in [${def.min}, ${def.max}]`);
    if (def.type === 'number' && !(typeof v === 'number' && v >= def.min && v <= def.max)) err(p, `${k} must be a number in [${def.min}, ${def.max}]`);
    if (def.type === 'enum' && def.values.indexOf(v) < 0) err(p, `${k} must be one of ${def.values.map((x) => `'${x}'`).join(', ')}`);
    if (def.type === 'numbers' && !(Array.isArray(v) && v.length && v.every((x) => typeof x === 'number' && x >= def.min && x <= def.max))) err(p, `${k} must be a non-empty array of numbers in (0, 1]`);
    if (def.type === 'object' && (typeof v !== 'object' || Array.isArray(v) || !Object.keys(v).every((x) => typeof v[x] === 'number'))) err(p, `${k} must map variable names to numbers`);
    if (def.type === 'month' && !(parsePeriod(v) && parsePeriod(v).freq === 'M')) err(p, `${k} must be a month 'YYYY-MM'`);
    if (def.type === 'period' && ctx && !(parsePeriod(v) && parsePeriod(v).freq === ctx.freq)) err(p, `${k} must be a ${ctx.freq === 'Q' ? "quarter 'YYYYQn'" : "year 'YYYY'"}`);
    if (def.type === 'specs') {
      if (!Array.isArray(v) || !v.length) err(p, 'members must be a non-empty array of specs');
      else v.forEach((m, i) => { validateSpec(m, ctx, `${path}${p}[${i}].`).forEach((e) => errs.push(e)); if (m && m.family === 'combination') err(`${p}[${i}]`, 'nested combinations are not supported'); });
    }
    if (def.type === 'weights' && !(v === 'equal' || v === 'invmse' || (Array.isArray(v) && v.every((x) => typeof x === 'number')))) err(p, "weights must be 'equal', 'invmse' or an array of numbers");
  });
  if (spec.family === 'combination') {
    const m = opts.members;
    if (!m) err('options.members', 'combination needs options.members (an array of specs)');
    if (Array.isArray(opts.weights) && Array.isArray(m) && opts.weights.length !== m.length) err('options.weights', 'give one weight per member');
  }
  if (spec.family === 'midas' && opts.weighting && opts.weighting !== 'almon' && opts.poly !== undefined) err('options.poly', 'poly applies to weighting almon only');
  if (spec.form !== undefined) {
    if (['quarter', 'ytd'].indexOf(spec.form) < 0) err('form', "form must be 'quarter' (single-quarter growth, converted to year to date) or 'ytd'");
    else if (spec.family === 'combination') err('form', 'a combination takes the forms of its members; give form to each member');
    else if (spec.form === 'quarter' && ctx && !quarterSeries(ctx)) err('form', "the quarterly form needs year-to-date nominal GDP (the Hub panel's ytd block); use form 'ytd'");
  }
  if (spec.family === 'lasso' && opts.l1Ratios !== undefined) err('options.l1Ratios', 'lasso has l1 ratio 1; use family enet');
  if (spec.origin !== undefined) {
    const o = spec.origin;
    if (typeof o !== 'object' || Array.isArray(o)) err('origin', 'origin must be {quarter, horizon, lagMode}');
    else {
      const q = o.quarter || o.period;
      if (q !== undefined && !(parsePeriod(q) && (!ctx || parsePeriod(q).freq === ctx.freq))) err('origin.quarter', `'${q}' is not a ${ctx && ctx.freq === 'A' ? 'year' : "quarter like '2026Q3'"}`);
      if (o.horizon !== undefined && !/^H\d+$/.test(o.horizon)) err('origin.horizon', "horizon must be 'H1', 'H2' or 'H3'");
      if (o.lagMode !== undefined && LAG_MODES.indexOf(o.lagMode) < 0) err('origin.lagMode', "lagMode must be 'standard' or 'conservative'");
      Object.keys(o).forEach((k) => { if (['quarter', 'period', 'horizon', 'lagMode'].indexOf(k) < 0) err(`origin.${k}`, `unknown key '${k}' (allowed: quarter, horizon, lagMode)`); });
    }
  }
  if (spec.asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(spec.asOf)) err('asOf', "asOf must be a date 'YYYY-MM-DD'");
  if (spec.evaluation !== undefined && spec.evaluation !== false) {
    const e = spec.evaluation;
    if (typeof e !== 'object' || Array.isArray(e)) err('evaluation', 'evaluation must be an object or false');
    else {
      const ek = ['from', 'to', 'horizons', 'lagMode', 'lagModes', 'benchmark', 'windows'];
      Object.keys(e).forEach((k) => { if (ek.indexOf(k) < 0) err(`evaluation.${k}`, `unknown key '${k}' (allowed: ${ek.join(', ')})`); });
      ['from', 'to'].forEach((k) => { if (e[k] !== undefined && !(parsePeriod(e[k]) && (!ctx || parsePeriod(e[k]).freq === ctx.freq))) err(`evaluation.${k}`, `'${e[k]}' is not a quarter like '2021Q1'`); });
      if (e.horizons !== undefined && !(Array.isArray(e.horizons) && e.horizons.length && e.horizons.every((h) => /^H\d+$/.test(h) && (!ctx || +h.slice(1) <= LOWFREQ[ctx.freq].k)))) err('evaluation.horizons', "horizons must be a subset of ['H1', 'H2', 'H3']");
      if (e.lagMode !== undefined && LAG_MODES.indexOf(e.lagMode) < 0) err('evaluation.lagMode', "lagMode must be 'standard' or 'conservative'");
      if (e.lagModes !== undefined && !(Array.isArray(e.lagModes) && e.lagModes.every((m) => LAG_MODES.indexOf(m) >= 0))) err('evaluation.lagModes', "lagModes must list 'standard' and/or 'conservative'");
      if (e.windows !== undefined && (typeof e.windows !== 'object' || !Object.keys(e.windows).every((w) => Array.isArray(e.windows[w]) && e.windows[w].length === 2))) err('evaluation.windows', "windows must map names to [from, to], e.g. {test: ['2025Q1', '2026Q2']}");
    }
  }
  if (spec.series !== undefined) {
    if (!Array.isArray(spec.series)) err('series', 'series must be an array of {name, periods, values, transform?, lagDays?}');
    else spec.series.forEach((s, i) => {
      if (!s || typeof s.name !== 'string' || !Array.isArray(s.periods) || !Array.isArray(s.values)) err(`series[${i}]`, 'each series needs name, periods and values');
      else if (s.periods.length !== s.values.length) err(`series[${i}]`, 'periods and values differ in length');
    });
  }
  return errs;
}

/** Target form of a spec: given, else the Hub's convention (indicator models quarterly, benchmarks and the ensemble year to date). */
const QUARTER_DEFAULT = ['bridge', 'bridge_ar', 'midas', 'dfm', 'dfm_kalman', 'lasso', 'enet', 'bvar'];
function specForm(spec, ctx) {
  if (spec.family === 'combination' || spec.family === 'v2') return null;
  if (spec.form) return spec.form;
  return QUARTER_DEFAULT.indexOf(spec.family) >= 0 && (!ctx || quarterSeries(ctx)) ? 'quarter' : 'ytd';
}
/** Build a model object from a (validated) spec; ``ctx`` decides the default form. */
function buildModel(spec, ctx) {
  const m = buildInner(spec, ctx);
  return specForm(spec, ctx) === 'quarter' ? quarterForm(m) : m;
}
function buildInner(spec, ctx) {
  const o = Object.assign({}, spec.options || {}), p = spec.predictors || [], nm = spec.name;
  switch (spec.family) {
    case 'mean': return historicalMean({ name: nm });
    case 'ar': return ar({ p: o.p || 1, name: nm });
    case 'bridge': return bridge(Object.assign(o, { predictors: p, name: nm }));
    case 'bridge_ar': return bridge(Object.assign(o, { predictors: p, extension: 'ar', name: nm }));
    case 'midas': return midas(Object.assign(o, { predictor: p[0], name: nm }));
    case 'dfm': return dfm(Object.assign(o, { predictors: p, name: nm || `dfm_pca_k${o.factors || 1}` }));
    case 'dfm_kalman': return dfmKalman(Object.assign(o, { predictors: p, name: nm }));
    case 'lasso': return lasso(Object.assign(o, { predictors: p, name: nm }));
    case 'enet': return elasticNet(Object.assign(o, { predictors: p, name: nm }));
    case 'bvar': return bvar(Object.assign(o, { predictors: p, name: nm }));
    case 'ensemble': return ensemble5050({ predictor: p[0], name: nm });
    case 'v2': return combination({ weights: [0.5, 0.5], name: nm, members: [
      dfmKalman({ predictors: p, factors: o.factors || 1, name: `${nm}_dfm` }),
      midas({ predictor: 'usd_uzs_mom_dlog', lags: 3, weighting: 'umidas', minRows: 15, name: `${nm}_umidas` })] });
    case 'combination': return combination({ members: o.members.map((ms) => buildModel(ms, ctx)), weights: o.weights || 'equal', minPast: o.minPast, historyFrom: o.historyFrom, name: nm });
    default: fail('bad_spec', `unknown family ${spec.family}`);
  }
}
function toContext(data) {
  if (data instanceof NowcastData) return data;
  if (data && data.schema && /^imrs-nowcast-panel/.test(data.schema)) return NowcastData.fromPanel(data);
  if (data && data.monthly && data.quarterly) return NowcastData.fromPanel(data);
  if (data && data.target) return NowcastData.fromSeries(data);
  fail('bad_data', 'data must be a context (Econ.data.*), nowcast_panel.json, or {target, monthly}');
}
const jsonNum = (x) => (typeof x === 'number' ? (isFinite(x) ? x : null) : x);
function jsonify(o) { return JSON.parse(JSON.stringify(o, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v, jsonNum) : jsonNum(v)))); }

/**
 * Run a model from a JSON spec: validate, fit at the nowcast origin, predict,
 * and evaluate out of sample.  Never throws on bad input: returns
 * {ok:false, errors:[{path, message}]}.
 * @param {object} spec {family, predictors?, options?, origin?, asOf?, evaluation?, name?, series?}
 * @param {object} data nowcast_panel.json, a context from Econ.data, or {target, monthly} series
 * @returns {object} {ok, model, spec, nowcast, coefficients, fitted, diagnostics, accuracy, warnings, timing_ms}
 */
function runSpec(spec, data) {
  const t0 = Date.now();
  let ctx;
  try { ctx = toContext(data); } catch (e) { return { ok: false, errors: [{ path: 'data', message: e.message }] }; }
  const errors = validateSpec(spec, ctx);
  if (errors.length) return { ok: false, errors, spec };
  const warnings = [];
  try {
    if (spec.series && spec.series.length) {
      ctx = cloneContext(ctx);
      spec.series.forEach((s) => {
        let ser = series.transform(series.make(s.periods, s.values, { name: s.name }), s.transform, { coverageEnd: s.coverageEnd });
        if (ser.freq === 'C') ser = Object.assign({}, ser, { freq: 'M' });
        ctx.addMonthly(s.name, ser, { lagDays: s.lagDays === undefined ? 30 : s.lagDays, meta: { transform: s.transform || 'none' } });
        if (s.lagDays === undefined) warnings.push(`series '${s.name}': no lagDays given, 30 days assumed`);
      });
    }
    const model = buildModel(spec, ctx);
    const so = spec.origin || {};
    const lagMode = so.lagMode || (spec.evaluation && spec.evaluation.lagMode) || 'standard';
    const origin = so.quarter || so.period ? ctx.origin(so.quarter || so.period, so.horizon || 'H' + LOWFREQ[ctx.freq].k, lagMode)
      : ctx.productionOrigin(spec.asOf, lagMode);
    if (!(so.quarter || so.period) && so.horizon) Object.assign(origin, ctx.origin(origin.period, so.horizon, lagMode));
    const fitted = model.fit(ctx.train(origin)), res = fitted.predict(origin);
    const diag = Object.assign({}, res.diagnostics), fittedRows = diag.fitted || []; delete diag.fitted;
    const nowcast = { period: origin.period, horizon: origin.horizon, lagMode: origin.lagMode, origin: origin.date, value: res.value,
      failure: res.failure, stage_note: origin.stageNote || null };
    ['band68', 'band90', 'median'].forEach((k) => { if (diag[k] !== undefined) nowcast[k] = diag[k]; });
    if (diag.n_train !== undefined && diag.n_train < 20) warnings.push(`only ${diag.n_train} training rows: estimates are imprecise`);
    let accuracy = null;
    if (spec.evaluation !== false) {
      const e = spec.evaluation || {}, lastKnown = ctx.periods[ctx.periods.length - 1];
      const ev = evaluate(ctx, [model], { from: e.from, to: e.to || ctx.periodLabel(lastKnown), horizons: e.horizons || horizonsFor(ctx.freq),
        lagModes: e.lagModes || [e.lagMode || lagMode], benchmark: e.benchmark !== false });
      const own = ev.predictions.filter((r) => r.model === model.name);
      const windows = { all: null };
      Object.keys(e.windows || {}).forEach((w) => { const [a, b] = e.windows[w]; windows[w] = ctx.periods.map((q) => ctx.periodLabel(q)).filter((q) => q >= a && q <= b); });
      accuracy = { benchmark: e.benchmark === false ? null : 'ar2', windows: {} };
      Object.keys(windows).forEach((w) => { accuracy.windows[w] = ev.metricsFor(windows[w]).filter((r) => r.model === model.name); });
      accuracy.predictions = own.map((r) => ({ period: r.target, horizon: r.horizon, lagMode: r.lagMode, origin: r.origin, prediction: r.prediction, actual: r.actual, error: r.error, failure: r.failure }));
      const nf = own.filter((r) => r.prediction !== r.prediction).length;
      if (nf) warnings.push(`${nf} of ${own.length} evaluation origins produced no forecast (see accuracy.predictions[].failure)`);
    }
    return jsonify({ ok: true, model: model.name, family: model.family, spec, nowcast, coefficients: res.coefficients, fitted: fittedRows,
      diagnostics: diag, accuracy, warnings, timing_ms: Date.now() - t0 });
  } catch (e) {
    if (e instanceof EconError) return { ok: false, errors: [{ path: '', message: e.message, code: e.code }], spec };
    throw e;
  }
}
function cloneContext(ctx) {
  const c = Object.create(NowcastData.prototype);
  Object.assign(c, ctx);
  c.fields = ctx.fields.slice(); c.values = Object.assign({}, ctx.values); c.lags = Object.assign({}, ctx.lags); c.meta = Object.assign({}, ctx.meta);
  c._cache = new Map();
  return c;
}
/** Machine-readable description of the spec format (families, options, defaults). */
function specSchema(ctx) {
  const fams = {};
  Object.keys(SPEC_FAMILIES).forEach((f) => { const d = SPEC_FAMILIES[f]; fams[f] = { doc: d.doc, predictors: { min: d.predictors[0], max: d.predictors[1] }, options: d.options }; });
  return { families: fams, form: { values: ['quarter', 'ytd'], default: `quarter for ${QUARTER_DEFAULT.join(', ')} (when the data have nominal GDP); ytd for mean, ar, ensemble`,
    doc: "quarter: estimated on the growth of the quarter alone and converted to year-to-date growth with the published previous quarter; ytd: estimated on the published year-to-date growth" },
    origin: { quarter: 'YYYYQn', horizon: 'H1|H2|H3', lagMode: LAG_MODES }, evaluation: { from: 'YYYYQn', to: 'YYYYQn', horizons: ['H1', 'H2', 'H3'], lagMode: LAG_MODES, benchmark: 'boolean (AR(2))', windows: '{name: [from, to]}' },
    predictors: ctx ? ctx.fields.map((f) => ({ field: f, lagDays: ctx.lags[f], name: ctx.meta[f] && ctx.meta[f].name, tier: ctx.meta[f] && ctx.meta[f].tier })) : undefined };
}

// ---------------------------------------------------------------------------
// Workings: every number behind one nowcast -- the data the model saw at the
// forecast origin, the design matrix, the estimation (OLS algebra, lag weights,
// factors, penalty path, posterior, combination weights) and the nowcast term
// by term.  The model is re-estimated at the origin with tracing switched on,
// so the numbers shown are the ones the model used.
// ---------------------------------------------------------------------------

const workings = (function () {
  const sub = (k) => String(k).split('').map((c) => '₀₁₂₃₄₅₆₇₈₉'[+c] || c).join('');
  const exp1 = (v) => (v === v && v !== null ? Number(v).toExponential(1) : 'n/a');
  const f4 = (v) => (v === v && v !== null ? Number(v).toFixed(4) : 'n/a');
  const f6 = (v) => (v === v && v !== null ? Number(v).toFixed(6) : 'n/a');
  const months = (ms) => (ms && ms.length ? ms.map(monthISO).join(' · ') : '–');
  // QF: explaining the single-quarter model inside a quarterly-form model (target g, not year-to-date GDP growth)
  let QF = false;
  const G = () => (QF ? 'g' : 'GDP');

  /** Two-sided critical value of Student's t (bisection on stats.tPValue). */
  function tCrit(df, level) {
    const a = 1 - (level === undefined ? 0.95 : level);
    if (!(df > 0)) return NaN;
    let lo = 0, hi = 1e4;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (stats.tPValue(mid, df) > a) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function resolveOrigin(ctx, o) {
    if (o && typeof o.day === 'number' && typeof o.ord === 'number') return o;
    o = o || {};
    const mode = o.lagMode || 'standard', q = o.quarter || o.period;
    if (q) return ctx.origin(q, o.horizon || 'H' + LOWFREQ[ctx.freq].k, mode);
    const p = ctx.productionOrigin(o.asOf, mode);
    return o.horizon ? Object.assign(ctx.origin(p.period, o.horizon, mode), { stageNote: p.stageNote }) : p;
  }
  const vname = (ctx, f) => ((ctx.meta[f] || {}).name || f);
  function varRow(ctx, origin, f, used) {
    const inf = ctx.info(origin), a = ctx.values[f] || [], meta = ctx.meta[f] || {};
    let lastData = null, lastUse = null;
    for (let k = 0; k < a.length; k++) if (a[k] === a[k]) { const m = ctx.monthStart + k; lastData = m; if (m <= inf.cut[f]) lastUse = m; }
    return { field: f, role: 'predictor', name: meta.name || f, key: meta.key || null, block: meta.block || null, tier: meta.tier || null,
      transform: meta.transform || null, unit: meta.unit || null, lag_days: ctx.lags[f], rule_cutoff: monthISO(inf.cut[f]),
      last_usable: lastUse === null ? null : monthISO(lastUse), last_in_data: lastData === null ? null : monthISO(lastData), used: used || '' };
  }
  function targetRow(ctx, origin, periods) {
    const nm = ctx.targetName === 'gdp_real_yoy_pct' ? 'Real GDP growth, year to date (% vs the same months a year earlier)'
      : ctx.targetName === 'gdp_single_quarter_yoy_pct' ? 'Real GDP growth of the quarter alone, g (% vs the same quarter a year earlier), derived from the published year-to-date growth and nominal GDP' : ctx.targetName;
    return { field: ctx.targetName, role: 'target', name: nm,
      lag_days: ctx.targetLagDays, transform: 'as published', rule_cutoff: null,
      last_usable: periods.length ? ctx.periodLabel(periods[periods.length - 1]) : null,
      used: periods.length ? `${ctx.periodLabel(periods[0])}–${ctx.periodLabel(periods[periods.length - 1])}: ${periods.length} quarters published before ${origin.period}` : '' };
  }
  const coefOf = (res, cols) => cols.map((c) => res.coefficients[c]);

  /** Design matrix, X'X, (X'X)^-1, X'y, coefficients with SE/t/p/CI, fit statistics, fitted values. */
  function olsSection(W, design, o) {
    o = o || {};
    const X = design.X, y = design.y, n = y.length, k = X[0].length, names = o.colLabels || design.columns;
    const fit = stats.ols(y, X, design.columns);
    let XtX = null, XtXi = null, Xty = null, bNE = null, dmax = NaN;
    try {
      XtX = linalg.tmatmul(X, X); XtXi = linalg.inv(XtX); Xty = linalg.matvec(linalg.transpose(X), y); bNE = linalg.matvec(XtXi, Xty);
      dmax = 0; bNE.forEach((b, i) => { dmax = Math.max(dmax, Math.abs(b - fit.coef[i])); });
    } catch (e) { if (!(e instanceof EconError)) throw e; }
    const tc = tCrit(fit.df, 0.95), extra = o.extra || [];
    W.blocks.push({ id: 'design', title: 'Training sample: dependent variable y and design matrix X', note: o.designNote || null,
      columns: ['Quarter t', o.depLabel || `${G()}(t)`].concat(names, extra.map((e) => e.title)),
      rows: design.periods.map((p, i) => [p, y[i]].concat(Array.from(X[i]), extra.map((e) => e.values[i]))) });
    if (XtX) {
      W.blocks.push({ id: 'xtx', title: 'X′X (cross-products of the regressors)', kind: 'matrix', columns: [''].concat(names), rows: XtX.map((r, i) => [names[i]].concat(r)) });
      W.blocks.push({ id: 'xtx_inv', title: '(X′X)⁻¹', kind: 'matrix', columns: [''].concat(names), rows: XtXi.map((r, i) => [names[i]].concat(r)) });
      W.blocks.push({ id: 'xty', title: 'X′y and the normal equations β = (X′X)⁻¹X′y', kind: 'matrix', columns: ['', 'X′y', '(X′X)⁻¹X′y'], rows: Xty.map((v, i) => [names[i], v, bNE[i]]) });
    }
    W.blocks.push({ id: 'coef', title: 'Coefficients', columns: ['Term', 'Coefficient β', 'Std. error', 't', 'p-value', '95% low', '95% high'],
      note: `β by least squares (QR decomposition); the normal equations give the same β (largest difference ${exp1(dmax)}). σ² = SSR/(n − k); SE = √(σ²·diagonal of (X′X)⁻¹); t = β/SE; p two-sided from t(${fit.df}); 95% interval β ± ${f4(tc)}·SE.${o.coefNote ? ' ' + o.coefNote : ''}`,
      rows: names.map((nm, i) => [nm, fit.coef[i], fit.se[i], fit.t[i], fit.p[i], fit.coef[i] - tc * fit.se[i], fit.coef[i] + tc * fit.se[i]]) });
    W.blocks.push({ id: 'fit', title: 'Fit statistics', kind: 'kv', columns: ['Statistic', 'Value'], rows: [
      ['Observations n', n], ['Parameters k', k], ['Degrees of freedom n − k', fit.df], ['Sum of squared residuals (SSR)', fit.ssr],
      ['σ = √(SSR/(n − k))', fit.sigma], ['R²', fit.r2], ['Adjusted R²', fit.adjR2], ['Gaussian log-likelihood LL', fit.loglik],
      ['AIC = −2LL + 2k', fit.aic], ['BIC = −2LL + k·ln n', fit.bic]] });
    W.blocks.push({ id: 'fitted', title: 'Fitted values and residuals', columns: ['Quarter', 'Actual', 'Fitted', 'Residual'],
      rows: design.periods.map((p, i) => [p, y[i], fit.fitted[i], fit.resid[i]]) });
    W.fitted = design.periods.map((p, i) => ({ period: p, actual: y[i], fitted: fit.fitted[i], residual: fit.resid[i] }));
    return fit;
  }
  function setTerms(W, rows, value, note) {
    let s = 0; rows.forEach((r) => { if (typeof r[4] === 'number') s += r[4]; });
    W.terms = { columns: ['Term', 'Coefficient', 'Value at the origin', 'What the value is', 'Contribution'], rows, total: value, sum: s, note: note || null };
  }
  const gdpLabel = () => `${G()}(t−1)`;
  /** SIAT publishes quarterly GDP growth cumulatively from January: "2026Q2" = Jan–Jun 2026 vs Jan–Jun 2025. */
  function gdpYtdText(q) {
    const m = /^(\d{4})Q([1-4])$/.exec(String(q || ''));
    if (!m) return QF ? `growth of ${q} alone` : `published GDP growth ${q}`;
    const span = ['Jan–Mar', 'Jan–Jun', 'Jan–Sep', 'Jan–Dec'][+m[2] - 1];
    if (QF) { const qm = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][+m[2] - 1]; return `growth of ${q} alone: ${qm} ${m[1]} vs ${qm} ${+m[1] - 1} (from the published year-to-date growth)`; }
    return `published GDP growth ${q}: ${span} ${m[1]} vs ${span} ${+m[1] - 1} (year to date)`;
  }

  // ---- one explainer per family ----
  const X = {};
  X.mean = (W, ctx, o, tr) => {
    const n = tr.y.length, s = stats.sum(tr.y);
    W.equation = QF ? 'ĝ = average growth of the single quarter over the training quarters' : 'Nowcast = average GDP growth over the training quarters';
    W.method = [`Simple mean of the ${n} quarters ${tr.periods[0]}–${tr.periods[n - 1]} published before ${o.period}.`];
    W.blocks.push({ id: 'sample', title: 'Training sample', columns: ['Quarter', QF ? 'Growth of the quarter alone, % y/y' : 'GDP growth, year to date, % y/y'], rows: tr.periods.map((p, i) => [p, tr.y[i]]) });
    setTerms(W, [[QF ? 'Sum of g ÷ number of quarters' : 'Sum of GDP growth ÷ number of quarters', 1 / n, s, `Σ of ${n} quarters`, s / n]], W.value);
  };
  X.ar = (W, ctx, o, tr, tn, res) => {
    const p = tr.p, d = tr.design, labels = ['1 (intercept)'].concat(seq(p).map((j) => `${G()}(t−${j + 1})`));
    W.equation = `${G()}(t) = c + ${seq(p).map((j) => `φ${sub(j + 1)}·${G()}(t−${j + 1})`).join(' + ')} + ε(t)`;
    W.method = ['Ordinary least squares on every quarter published before the target quarter (expanding window).',
      `Training rows ${d.periods[0]}–${d.periods[d.periods.length - 1]} (n = ${d.y.length}); the first ${p} published quarter${p > 1 ? 's' : ''} only serve${p > 1 ? '' : 's'} as lags.`];
    olsSection(W, d, { colLabels: labels });
    if (tn.x) {
      const c = coefOf(res, d.columns);
      setTerms(W, [['c (intercept)', c[0], 1, 'constant', c[0]]].concat(seq(p).map((j) => [`φ${sub(j + 1)} × ${G()}(${tn.lagPeriods[j]})`, c[j + 1], tn.x[j + 1], gdpYtdText(tn.lagPeriods[j]), c[j + 1] * tn.x[j + 1]])), W.value);
    }
  };
  X.midas = (W, ctx, o, tr, tn, res) => {
    const f = tr.field, K = tr.K, d = tr.design, almon = tr.weighting === 'almon', lagName = (l) => `${f}(m${l === K - 1 ? '' : '−' + (K - 1 - l)})`;
    const labels = ['1 (intercept)', gdpLabel()].concat(almon ? tr.basis[0].map((_, q) => `Z${sub(q)}`) : seq(K).map(lagName));
    W.equation = almon
      ? `${G()}(t) = a + b·${G()}(t−1) + ${tr.basis[0].map((_, q) => `θ${sub(q)}·Z${sub(q)}(t)`).join(' + ')} + ε(t),  Z${sub('d')}(t) = Σ over l = 0..${K - 1} of x(m−${K - 1}+l)·(l/${K - 1})^d`
      : `${G()}(t) = a + b·${G()}(t−1) + ${seq(K).map((l) => `g${sub(l)}·x(m${l === K - 1 ? '' : '−' + (K - 1 - l)})`).join(' + ')} + ε(t)`;
    W.method = [`x = ${vname(ctx, f)} (${f}); m = the latest month of x released by the forecast origin of quarter t, at the same stage (${o.horizon}) and release rule (${o.lagMode}) as the nowcast.`,
      almon ? `Almon lag polynomial of degree ${tr.poly} on ${K} monthly lags: the ${tr.poly + 1} θ's are estimated by OLS and imply the lag weights g_l = Σ_d θ_d·(l/${K - 1})^d.` : `Unrestricted MIDAS: one free coefficient per monthly lag (${K} lags), estimated by OLS.`,
      `Months before ${monthISO(tr.start)} are not used (the sample start of the core models); at least ${tr.minRows} training rows are required.`];
    const extra = [{ title: 'Months of x used (oldest first)', values: tr.rows.map((r) => months(r.months)) }];
    if (almon) seq(K).forEach((l) => extra.push({ title: lagName(l), values: tr.rows.map((r) => r.raw[l]) }));
    const fit = olsSection(W, d, { colLabels: labels, extra, designNote: QF ? `g(t−1) is the growth of the previous quarter alone; x is ${tr.field}.` : `GDP(t−1) is the previous quarter's published GDP growth; x is ${tr.field}.` });
    if (almon) {
      W.blocks.push({ id: 'basis', title: 'Almon basis B (lag × polynomial degree)', kind: 'matrix', columns: ['Lag'].concat(tr.basis[0].map((_, q) => `d = ${q}`)),
        rows: tr.basis.map((r, l) => [lagName(l)].concat(r)) });
      W.blocks.push({ id: 'implied', title: 'Implied lag weights g_l = Σ_d θ_d·B_ld', columns: ['Lag', 'Weight g_l'],
        rows: seq(K).map((l) => { let s = 0; tr.basis[l].forEach((b, q) => { s += fit.coef[2 + q] * b; }); return [lagName(l), s]; }) });
    }
    if (tn.x) {
      const c = coefOf(res, d.columns), rows = [['a (intercept)', c[0], 1, 'constant', c[0]], [`b × ${G()}(${tn.gdpLag})`, c[1], tn.x[1], gdpYtdText(tn.gdpLag), c[1] * tn.x[1]]];
      if (almon) {
        tr.basis[0].forEach((_, q) => rows.push([`θ${sub(q)} × Z${sub(q)}`, c[2 + q], tn.x[2 + q], `Σ_l x(month l)·B_l${q} over ${months(tn.months)}`, c[2 + q] * tn.x[2 + q]]));
        W.blocks.push({ id: 'z_now', title: 'Almon regressors at the origin', columns: ['Lag', 'Month', 'x'].concat(tr.basis[0].map((_, q) => `B·d${q}`)),
          rows: seq(K).map((l) => [lagName(l), monthISO(tn.months[l]), tn.raw[l]].concat(tr.basis[l].map((b) => b * tn.raw[l]))) });
      } else seq(K).forEach((l) => rows.push([`g${sub(l)} × x(${monthISO(tn.months[l])})`, c[2 + l], tn.x[2 + l], `${vname(ctx, f)}, ${monthISO(tn.months[l])}`, c[2 + l] * tn.x[2 + l]]));
      setTerms(W, rows, W.value);
    }
  };
  X.midas_nls = (W, ctx, o, tr, tn, res) => {
    const f = tr.field, K = tr.K, exp = tr.weighting === 'expalmon', d = tr.design;
    const lag = (j) => `x(m${j ? '−' + j : ''})`;
    W.equation = `${G()}(t) = a + b·${G()}(t−1) + c·S(t) + ε(t),  S(t) = Σ over j = 0..${K - 1} of w_j(θ)·x(m−j),  ` + (exp
      ? 'w_j = exp(θ₁·j + θ₂·j²) / Σ_i exp(θ₁·i + θ₂·i²)'
      : 'w_j ∝ u_j^(α−1)·(1 − u_j)^(β−1), u_j = 0.001 + 0.998·j/' + (K - 1) + ', weights sum to 1');
    W.method = [`x = ${vname(ctx, f)} (${f}); m = the latest month released by the forecast origin of quarter t (stage ${o.horizon}, ${o.lagMode} lags); ${K} monthly lags, newest first.`,
      `θ = ${exp ? '(θ₁, θ₂)' : '(α, β)'} chosen from a grid of ${tr.grid.length} pairs: for each pair, a, b, c are estimated by OLS and the pair with the smallest sum of squared residuals is kept (profile least squares)${tr.estimation === 'nls' ? ', then refined by Levenberg–Marquardt' : ''}.`,
      'Standard errors below are conditional on the chosen θ (they ignore the uncertainty of the grid search).', `At least ${tr.minRows} training rows are required.`];
    const order = tr.gridSSR.map((s, i) => i).sort((a, b) => tr.gridSSR[a] - tr.gridSSR[b]);
    W.blocks.push({ id: 'grid', title: `Grid search: sum of squared residuals for each ${exp ? '(θ₁, θ₂)' : '(α, β)'}`, note: `${tr.grid.length} candidate pairs, sorted by SSR; the first row is the one used.`,
      columns: ['Rank', exp ? 'θ₁' : 'α', exp ? 'θ₂' : 'β', 'SSR'], rows: order.map((i, r) => [r + 1, tr.grid[i][0], tr.grid[i][1], tr.gridSSR[i]]) });
    W.blocks.push({ id: 'weights', title: `Lag weights w_j at the chosen ${exp ? 'θ' : '(α, β)'} = (${f4(tr.theta[0])}, ${f4(tr.theta[1])})`, columns: ['Lag j', 'Month', 'Weight w_j'],
      rows: tr.weights.map((w, j) => [j, lag(j), w]) });
    const extra = seq(K).map((j) => ({ title: lag(j), values: tr.L.map((r) => r[j]) })).concat([{ title: 'Months (newest first)', values: tr.months.map((ms) => months(ms)) }]);
    olsSection(W, d, { colLabels: ['1 (intercept)', gdpLabel(), 'S(t)'], extra, designNote: 'S(t) = Σ_j w_j·x(m−j) with the weights above.' });
    if (tn.x) {
      const c = coefOf(res, d.columns);
      W.blocks.push({ id: 's_now', title: 'S at the origin', columns: ['Lag j', 'Month', 'x', 'w_j', 'w_j·x'],
        rows: tn.raw.map((v, j) => [j, monthISO(tn.months[j]), v, tr.weights[j], tr.weights[j] * v]).concat([['', 'S = Σ', '', '', tn.s]]) });
      setTerms(W, [['a (intercept)', c[0], 1, 'constant', c[0]], [`b × ${G()}(${tn.gdpLag})`, c[1], tn.x[1], gdpYtdText(tn.gdpLag), c[1] * tn.x[1]],
        ['c × S', c[2], tn.s, `weighted ${f}, ${months(tn.months.slice().reverse())}`, c[2] * tn.s]], W.value);
    }
  };
  X.bridge = (W, ctx, o, tr, tn, res) => {
    const d = tr.design, F = tr.fields;
    W.equation = `${G()}(t) = a + b₀·${G()}(t−1) + ${F.map((f, k) => `b${sub(k + 1)}·x̄${sub(k + 1)}(t)`).join(' + ')} + ε(t)`;
    W.method = [`x̄_k(t) = mean of the months of quarter t of indicator k that are released by the forecast origin of quarter t at the same stage (${o.horizon}) and release rule (${o.lagMode}).`,
      F.map((f, k) => `x${sub(k + 1)} = ${vname(ctx, f)} (${f})`).join('; ') + '.', `Months before ${monthISO(tr.start)} are not used; at least ${tr.minRows} training rows are required.`];
    const extra = F.map((f, k) => ({ title: `Months averaged, ${f}`, values: tr.rows.map((r) => months(r.months[k])) }));
    olsSection(W, d, { colLabels: ['1 (intercept)', gdpLabel()].concat(F.map((f) => `mean ${f}`)), extra });
    if (tn.x) {
      const c = coefOf(res, d.columns);
      setTerms(W, [['a (intercept)', c[0], 1, 'constant', c[0]], [`b₀ × ${G()}(${tn.gdpLag})`, c[1], tn.x[1], gdpYtdText(tn.gdpLag), c[1] * tn.x[1]]]
        .concat(F.map((f, k) => [`b${sub(k + 1)} × x̄${sub(k + 1)}(${o.period})`, c[2 + k], tn.x[2 + k], `mean of ${f} over ${months(tn.months[k])}`, c[2 + k] * tn.x[2 + k]])), W.value);
    }
  };
  function extensionBlocks(W, ctx, o, F, exts, title) {
    F.forEach((f, k) => {
      const e = exts[k], qm = ctx.periodMonths(o.ord), rows = [];
      rows.push(['Last released month at the origin', e.last === null ? 'none' : monthISO(e.last)]);
      if (e.arFrom !== undefined) rows.push(['AR estimation sample', `${monthISO(e.arFrom)}–${monthISO(e.last)} (months with data)`]);
      (e.bics || []).forEach((b) => rows.push([`BIC of AR(${b.p}) (n = ${b.n})`, b.bic]));
      rows.push(['AR order chosen (smallest BIC)', e.p || 'none needed']);
      if (e.coef) e.coef.forEach((c, j) => rows.push([j ? `φ${sub(j)}` : 'c', c]));
      W.blocks.push({ id: `ext_${f}`, title: `${title}: ${vname(ctx, f)} (${f})`, kind: 'kv', columns: ['Item', 'Value'], rows,
        note: e.coef ? `Months after ${monthISO(e.last)} are forecast recursively: x(m) = c + ${seq(e.p).map((j) => `φ${sub(j + 1)}·x(m−${j + 1})`).join(' + ')}.` : null });
      W.blocks.push({ id: `extq_${f}`, title: `${o.period} months of ${f}`, columns: ['Month', 'Value', 'Status'],
        rows: qm.map((m) => { const v = e.values[m - e.start]; return [monthISO(m), v === undefined ? null : v, e.last !== null && m <= e.last ? (v === v ? 'released' : 'missing') : (v === v ? `forecast by AR(${e.p})` : 'not available')]; }) });
    });
  }
  X.bridge_ar = (W, ctx, o, tr, tn, res) => {
    const d = tr.design, F = tr.fields;
    W.equation = `${G()}(t) = a + b₀·${G()}(t−1) + ${F.map((f, k) => `b${sub(k + 1)}·x̄${sub(k + 1)}(t)`).join(' + ')} + ε(t)`;
    W.method = ['x̄_k(t) = mean of the three months of quarter t of indicator k. Months of the target quarter that are not released yet at the origin are forecast by an AR(p) model of the monthly indicator (p ≤ 3 chosen by BIC, estimated from 2014-01 to the last released month).',
      F.map((f, k) => `x${sub(k + 1)} = ${vname(ctx, f)} (${f}, released ${ctx.lags[f]} days after the month)`).join('; ') + '.',
      `Training quarters use the same AR-extended series, so a training quarter only uses forecast months when its own data are not yet released at the origin. At least ${tr.minRows || MIN_TRAIN} training rows are required.`];
    const extra = F.map((f, k) => ({ title: `Forecast months in the mean, ${f}`, values: d.periods.map((p) => { const e = tr.ext[k]; return ctx.periodMonths(ctx.periodOrd(p)).filter((m) => e.last !== null && m > e.last).length; }) }));
    extensionBlocks(W, ctx, o, F, tn.ext || tr.ext, 'Monthly AR extension');
    olsSection(W, d, { colLabels: ['1 (intercept)', gdpLabel()].concat(F.map((f) => `mean ${f}`)), extra });
    if (tn.x) {
      const c = coefOf(res, d.columns);
      setTerms(W, [['a (intercept)', c[0], 1, 'constant', c[0]], [`b₀ × ${G()}(${tn.gdpLag})`, c[1], tn.x[1], gdpYtdText(tn.gdpLag), c[1] * tn.x[1]]]
        .concat(F.map((f, k) => [`b${sub(k + 1)} × x̄${sub(k + 1)}(${o.period})`, c[2 + k], tn.x[2 + k], `mean of ${f} over ${o.period} (released + AR-forecast months)`, c[2 + k] * tn.x[2 + k]])), W.value);
    }
  };
  X.dfm = (W, ctx, o, tr, tn, res) => {
    const k = tr.k, d = tr.design, Fl = seq(k).map((c) => `F${sub(c + 1)}`);
    W.equation = `${G()}(t) = a + b·${G()}(t−1) + ${seq(k).map((c) => `g${sub(c + 1)}·F̄${sub(c + 1)}(t)`).join(' + ')} + ε(t)`;
    W.method = [`F = the first ${k} principal component${k > 1 ? 's' : ''} of the standardised monthly panel (EM-PCA: missing cells are filled from the rank-${k} reconstruction until the loss converges), F̄(t) = mean of F over the months of quarter t.`,
      `Panel window ${monthISO(tr.trS)}–${monthISO(tr.trE)} (training quarters, data released by the origin); each field is standardised with its window mean and standard deviation.`,
      'Months of the target quarter after the window are projected on the fixed loadings, using only the fields released in that month (ragged edge).'];
    const resol = {}; tr.resolutions.forEach((r) => { resol[r.field] = r; });
    W.blocks.push({ id: 'fields', title: 'Fields of the factor panel', columns: ['Field', 'Status', 'Mean (window)', 'Std. dev. (window)'].concat(Fl.map((x) => `Loading on ${x}`)),
      rows: tr.resolutions.map((r) => { const j = tr.fields.indexOf(r.field); return [r.field, r.status + (r.reason ? ': ' + r.reason.replace(/_/g, ' ') : '')].concat(j >= 0 ? [tr.mu[j], tr.sd[j]].concat(tr.loadings[j]) : [null, null].concat(Fl.map(() => null))); }) });
    W.blocks.push({ id: 'em', title: 'EM-PCA estimation', kind: 'kv', columns: ['Item', 'Value'], rows: [['Window', `${monthISO(tr.trS)}–${monthISO(tr.trE)}`], ['Months T', tr.trE - tr.trS + 1], ['Fields N', tr.fields.length],
      ['Share of missing cells', tr.em.fractionMissing], ['Iterations', tr.em.iterations], ['Converged (relative loss change ≤ ' + tr.em.tol + ')', tr.em.converged ? 'yes' : 'no'], ['Final mean squared reconstruction error', tr.em.loss]] });
    W.blocks.push({ id: 'factors', title: 'Monthly factors (EM-PCA window)', columns: ['Month'].concat(Fl), rows: tr.factors.map((r, t) => [monthISO(tr.trS + t)].concat(r)) });
    if (tn.months) W.blocks.push({ id: 'target_factor', title: `Factors in the months of ${o.period}`, columns: ['Month', 'Source', 'Fields released'].concat(Fl),
      rows: tn.months.map((m) => [monthISO(m.month), m.source, m.observed.length].concat(m.factor ? Array.from(m.factor) : Fl.map(() => null))) });
    olsSection(W, d, { colLabels: ['1 (intercept)', gdpLabel()].concat(Fl.map((x) => `F̄${x.slice(1)}`)) });
    if (tn.x) {
      const c = coefOf(res, d.columns);
      setTerms(W, [['a (intercept)', c[0], 1, 'constant', c[0]], [`b × ${G()}(${tn.gdpLag})`, c[1], tn.x[1], gdpYtdText(tn.gdpLag), c[1] * tn.x[1]]]
        .concat(seq(k).map((q) => [`g${sub(q + 1)} × F̄${sub(q + 1)}(${o.period})`, c[2 + q], tn.x[2 + q], `mean of ${Fl[q]} over the released months of ${o.period}`, c[2 + q] * tn.x[2 + q]])), W.value);
    }
  };
  X.dfm_kalman = (W, ctx, o, tr, tn, res) => {
    const r = tr.r, d = tr.design, Fl = seq(r).map((c) => `f${sub(c + 1)}`);
    W.equation = `x_i(m) = λ_i′f(m) + e_i(m),  f(m) = A·f(m−1) + u(m),  e_i ~ N(0, R_i), u ~ N(0, Q);  ${G()}(t) = a + b·${G()}(t−1) + ${seq(r).map((c) => `g${sub(c + 1)}·F̄${sub(c + 1)}(t)`).join(' + ')} + ε(t)`;
    W.method = [`${r} monthly factors with VAR(1) dynamics, estimated by EM (Kalman filter and Rauch–Tung–Striebel smoother, PCA start, at most ${tr.maxIter} iterations, tolerance ${tr.tol} on the log-likelihood).`,
      `Panel ${monthISO(tr.w0)}–${monthISO(tr.endM)} (${tr.T} months, ${tr.fields.length} fields), each standardised with its mean and standard deviation over the training months; values after ${monthISO(tr.originMonth)} or not yet released at the origin are missing, and the smoother fills them from the factor dynamics.`,
      'F̄(t) = mean of the smoothed factors over the months of quarter t; the GDP equation is estimated by least squares.' + (tr.dropped.length ? ` Dropped (fewer than 12 values or no variance): ${tr.dropped.join(', ')}.` : '')];
    W.blocks.push({ id: 'fields', title: 'Fields, standardisation and loadings Λ', columns: ['Field', 'Mean', 'Std. dev.'].concat(Fl.map((x) => `λ on ${x}`), ['R_i (idiosyncratic variance)']),
      rows: tr.fields.map((f, i) => [f, tr.mu[i], tr.sd[i]].concat(tr.lam[i], [tr.rvar[i]])) });
    W.blocks.push({ id: 'A', title: 'Factor transition matrix A', kind: 'matrix', columns: [''].concat(Fl.map((x) => `${x}(m−1)`)), rows: tr.A.map((row, i) => [`${Fl[i]}(m)`].concat(row)) });
    W.blocks.push({ id: 'Q', title: 'Factor innovation covariance Q', kind: 'matrix', columns: [''].concat(Fl), rows: tr.Q.map((row, i) => [Fl[i]].concat(row)) });
    W.blocks.push({ id: 'em', title: 'EM estimation', kind: 'kv', columns: ['Item', 'Value'], rows: [['Iterations', tr.iterations], ['Converged', tr.converged ? 'yes' : 'no'], ['Log-likelihood', tr.loglik], ['Months T', tr.T], ['Fields N', tr.fields.length]] });
    W.blocks.push({ id: 'factors', title: 'Smoothed monthly factors', columns: ['Month', 'Fields with data'].concat(Fl, ['Note']),
      rows: tr.factors.map((row, t) => [monthISO(tr.w0 + t), tr.nObs[t]].concat(row, [tr.w0 + t > tr.originMonth ? 'after the origin: from the factor VAR' : (tr.nObs[t] ? '' : 'no data released: from the factor VAR')])) });
    olsSection(W, d, { colLabels: ['1 (intercept)', gdpLabel()].concat(Fl.map((x) => `F̄${x.slice(1)}`)) });
    if (tn.x) {
      const c = coefOf(res, d.columns);
      setTerms(W, [['a (intercept)', c[0], 1, 'constant', c[0]], [`b × ${G()}(${tn.gdpLag})`, c[1], tn.x[1], gdpYtdText(tn.gdpLag), c[1] * tn.x[1]]]
        .concat(seq(r).map((q) => [`g${sub(q + 1)} × F̄${sub(q + 1)}(${o.period})`, c[2 + q], tn.x[2 + q], `mean of smoothed ${Fl[q]} over ${o.period}`, c[2 + q] * tn.x[2 + q]])), W.value);
    }
  };
  X.penalized = (W, ctx, o, tr, tn, res) => {
    const lasso = tr.penalty === 'lasso', names = tr.names, nm = (c) => c;
    W.equation = `${G()}(t) = β₀ + Σ_j β_j·z_j(t),  β = argmin (1/2n)·Σ_t (${G()}(t) − β₀ − Σ_j β_j·z_j(t))² + α·` + (lasso ? 'Σ_j |β_j|' : '[ρ·Σ_j |β_j| + (1 − ρ)/2·Σ_j β_j²]');
    W.method = [`Candidate regressors: the previous quarter's GDP growth and, for each of ${tr.fields.length} indicators, ` + (tr.design === 'bridge' ? 'the mean of the months of quarter t released by its forecast origin.' : `the last ${tr.K} monthly values released by the forecast origin of quarter t.`),
      'Columns need at least 8 training values, a value at the origin and non-zero variance. z_j = (x_j − mean_j)/sd_j with training means and standard deviations; a missing training cell becomes 0 (the training mean).',
      `${lasso ? 'α' : 'α and ρ ∈ {' + tr.l1s.join(', ') + '}'} chosen by time-series cross-validation: ${tr.splits} expanding folds, ${tr.nAlphas} values of α from α_max down to 0.001·α_max, the smallest mean test MSE wins; then refitted on all ${tr.y.length} rows (coordinate descent, scikit-learn 1.8).`];
    const ci = {}; names.forEach((c, k) => { ci[c] = k; });
    W.blocks.push({ id: 'candidates', title: 'Candidate regressors, standardisation and coefficients', note: 'β per unit = β/sd: the effect of a one-unit change in the original variable.',
      columns: ['Column', 'Status', 'Mean (training)', 'Std. dev. (training)', 'Value at origin', 'z at origin', 'β (standardised)', 'β per unit', 'Selected'],
      rows: tr.cols.map((c, j) => { const k = ci[c]; return k === undefined ? [nm(c), tr.reason[j], null, null, tr.xT[j], null, null, null, 'no']
        : [nm(c), 'kept', tr.mu[k], tr.sd[k], tr.xT[j], tn.z ? tn.z[k] : null, tr.coef[k], tr.coef[k] / tr.sd[k], Math.abs(tr.coef[k]) > 1e-10 ? 'yes' : 'no']; }) });
    const P = tr.periods;
    W.blocks.push({ id: 'folds', title: 'Cross-validation folds (time-series split)', columns: ['Fold', 'Training quarters', 'Test quarters'],
      rows: tr.folds.map((fd, i) => [i + 1, `${P[fd.train[0]]}–${P[fd.train[fd.train.length - 1]]} (${fd.train.length})`, `${P[fd.test[0]]}–${P[fd.test[fd.test.length - 1]]} (${fd.test.length})`]) });
    const cvRows = [];
    tr.l1s.forEach((l, li) => tr.alphas[li].forEach((a, i) => { const pick = a === tr.alpha && l === tr.l1 ? 'chosen' : ''; cvRows.push(lasso ? [a, tr.msePath[li][i], pick] : [l, a, tr.msePath[li][i], pick]); }));
    W.blocks.push({ id: 'cv', title: 'Penalty path: mean cross-validated test MSE', note: `Chosen: α = ${f6(tr.alpha)}${lasso ? '' : `, ρ = ${tr.l1}`} (smallest mean MSE over the ${tr.splits} folds). α_max is the smallest penalty that sets every coefficient to zero${lasso ? '' : '; each ρ has its own α grid'}.`,
      columns: lasso ? ['α', 'Mean CV MSE', ''] : ['ρ (l1 ratio)', 'α', 'Mean CV MSE', ''], rows: cvRows });
    const keepIdx = tr.keep;
    W.blocks.push({ id: 'design', title: 'Training sample (original units)', columns: ['Quarter t', `${G()}(t)`].concat(keepIdx.map((j) => tr.cols[j])), rows: P.map((p, i) => [p, tr.y[i]].concat(keepIdx.map((j) => tr.Xtr[i][j]))) });
    W.blocks.push({ id: 'z', title: 'Standardised design Z', columns: ['Quarter t'].concat(names), rows: P.map((p, i) => [p].concat(tr.Z[i])) });
    W.blocks.push({ id: 'chosen', title: 'Final fit', kind: 'kv', columns: ['Item', 'Value'], rows: [['α', tr.alpha]].concat(lasso ? [] : [['ρ (l1 ratio)', tr.l1]], [['Intercept β₀', tr.intercept],
      ['Selected columns', `${tr.coef.filter((v) => Math.abs(v) > 1e-10).length} of ${names.length}`], ['Coordinate-descent iterations', tr.nIter], ['Duality gap / n', tr.dualGap], ['Training rows n', tr.y.length]]) });
    if (tn.z) {
      const rows = [['β₀ (intercept)', tr.intercept, 1, `mean ${G()}(t) of the training rows − Σ β_j·mean(z_j); the z have mean 0`, tr.intercept]];
      names.forEach((c, k) => { if (Math.abs(tr.coef[k]) > 1e-10) rows.push([`β × z(${c})`, tr.coef[k], tn.z[k], `(${f6(tn.x[k])} − ${f6(tr.mu[k])}) / ${f6(tr.sd[k])}`, tr.coef[k] * tn.z[k]]); });
      const zero = names.length - rows.length + 1;
      if (zero > 0) rows.push([`${zero} other columns`, 0, null, 'coefficient shrunk to zero', 0]);
      setTerms(W, rows, W.value);
    }
  };
  X.bvar = (W, ctx, o, tr, tn) => {
    const names = tr.names, n = names.length, p = tr.p, post = tr.post;
    const regs = []; for (let l = 1; l <= p; l++) names.forEach((v) => regs.push(`${v}(−${l})`)); regs.push('constant');
    W.equation = `Y(t) = c + ${seq(p).map((l) => `B${sub(l + 1)}·Y(t−${l + 1})`).join(' + ')} + u(t),  u ~ N(0, Σ),  Y = [${names.join(', ')}]`;
    W.method = [`Bayesian VAR(${p}) in ${QF ? 'the growth of the single quarter g' : 'GDP growth'} and the quarterly means of ${tr.fields.join(', ')} (months not yet released at the origin are AR-forecast).`,
      `Minnesota natural-conjugate prior as dummy observations: prior mean δ_i on each variable's own first lag, tightness λ = ${tr.lam}, scales σ_i = residual std. dev. of an AR(1) of each variable; posterior B̄ = (X*′X*)⁻¹X*′Y*, S = (Y* − X*B̄)′(Y* − X*B̄), Σ ~ inverse-Wishart(S, ν = ${post.dof}).`,
      `Nowcast = mean of ${tr.nDraws} draws of GDP(${o.period}) from the posterior predictive distribution, conditional on the target quarter's indicator means already released at the origin (Gaussian conditioning inside each draw; seed ${tn.seed || SEED}, ${tn.rng || 'numpy'} generator). Bands are percentiles of the draws.`];
    W.blocks.push({ id: 'data', title: `Sample: ${tr.periods[0]}–${tr.periods[tr.periods.length - 1]} (contiguous quarters ending with the last training quarter)`, columns: ['Quarter'].concat(names), rows: tr.periods.map((q, i) => [q].concat(tr.Y[i])) });
    W.blocks.push({ id: 'prior', title: 'Prior', columns: ['Variable', 'Prior mean of own lag δ_i', 'Scale σ_i (AR(1) residual s.d.)'], rows: names.map((v, i) => [v, tr.delta[i], post.sigma[i]]), note: `Tightness λ = ${tr.lam}; the constant has a diffuse prior (dummy weight ${post.eps}).` });
    W.blocks.push({ id: 'dummies', title: 'Dummy observations (Y* | X*)', columns: names.map((v) => `Y*: ${v}`).concat(regs.map((v) => `X*: ${v}`)), rows: post.Yd.map((r, i) => r.concat(post.Xd[i])) });
    W.blocks.push({ id: 'B', title: 'Posterior mean B̄ (rows: regressors, columns: equations)', kind: 'matrix', columns: [''].concat(names), rows: post.B.map((r, i) => [regs[i]].concat(r)) });
    W.blocks.push({ id: 'S', title: 'Posterior scale S', kind: 'matrix', columns: [''].concat(names), rows: post.S.map((r, i) => [names[i]].concat(r)), note: `Degrees of freedom ν = ${post.dof}; E[Σ] = S/(ν − n − 1).` });
    if (tn.mu) {
      extensionBlocks(W, ctx, o, tr.fields, tn.ext, 'Quarterly mean of the indicator (AR-extended)');
      const condBy = {}; tn.cond.forEach((c) => { condBy[c.index] = c; });
      W.blocks.push({ id: 'conditioning', title: `Conditional forecast for ${o.period}`, note: 'μ = B̄′·[Y(t−1), …, 1] is the unconditional one-step forecast; observed indicators shift GDP by gain × (observed − μ), gain = E[Σ]_GDP,obs·E[Σ]_obs,obs⁻¹.',
        columns: ['Variable', 'Unconditional forecast μ', 'Observed in the target quarter', 'Months released', 'Gain'],
        rows: names.map((v, i) => { const c = condBy[i]; const gi = c && tn.gain ? tn.gain[tn.cond.indexOf(c)] : null; return [v, tn.mu[i], c ? c.value : (i === 0 ? '(nowcast target)' : 'not released'), c ? months(c.months) : '', gi]; }) });
      const q = tn.quantiles;
      W.blocks.push({ id: 'draws', title: `Posterior-predictive draws of GDP(${o.period})`, kind: 'kv', columns: ['Statistic', 'Value'], rows: [['Draws', tn.draws.length], ['Mean (the nowcast)', W.value],
        ['Monte Carlo standard error', Math.sqrt(stats.variance(tn.draws, 1) / tn.draws.length)], ['Median', q[2]], ['5th percentile', q[0]], ['16th percentile', q[1]], ['84th percentile', q[3]], ['95th percentile', q[4]], ['Plug-in conditional mean (no simulation)', tn.plug]] });
      W.blocks.push({ id: 'draws_list', title: 'All draws', excelOnly: true, columns: ['Draw', QF ? 'g' : 'GDP growth'], rows: tn.draws.map((v, i) => [i + 1, v]) });
      const rows = [['μ_GDP: unconditional forecast', 1, tn.mu[0], `B̄′·[${tr.periods[tr.periods.length - 1]} values, 1]`, tn.mu[0]]];
      tn.cond.forEach((c, k) => rows.push([`gain × (${c.field} − μ)`, tn.gain[k], c.value - tn.mu[c.index], `${f6(c.value)} − ${f6(tn.mu[c.index])}`, tn.gain[k] * (c.value - tn.mu[c.index])]));
      rows.push(['Simulation: mean of draws − plug-in', null, null, `${tn.draws.length} posterior draws of B and Σ`, W.value - tn.plug]);
      setTerms(W, rows, W.value, 'The first rows give the plug-in conditional mean at the posterior means of B and Σ; the last row is the difference to the mean of the simulated draws (parameter uncertainty and Monte Carlo noise).');
    }
  };
  function comboExplain(W, ctx, o, tr, labelOf) {
    const L = labelOf || ((m) => m);
    if (tr.weighting === 'fixed') {
      W.equation = 'Nowcast = ' + tr.block.map((b, i) => `${tr.weights[i]} × ${L(b.model)}`).join(' + ');
      const ytdMember = tr.block.some((b) => b.model === 'ytd_bottom_up');
      W.method = [ytdMember
        ? 'Fixed equal weights: the ensemble (AR(2) + USD/UZS U-MIDAS) and the year-to-date bottom-up model; every component must produce a nowcast.'
        : 'Fixed weights; every component must produce a nowcast.'];
      W.members = tr.block.map((b, i) => ({ model: b.model, weight: tr.weights[i], value: b.prediction }));
      W.blocks.push({ id: 'members', title: 'Components', columns: ['Component', 'Weight', 'Nowcast', 'Weight × nowcast'], rows: tr.block.map((b, i) => [L(b.model), tr.weights[i], b.prediction, tr.weights[i] * b.prediction]) });
      setTerms(W, tr.block.map((b, i) => [`${tr.weights[i]} × ${L(b.model)}`, tr.weights[i], b.prediction, `${L(b.model)} at ${o.period} ${o.horizon}`, tr.weights[i] * b.prediction]), W.value);
      return;
    }
    const c = tr.combine, inv = tr.weighting === 'invmse' && !c.fallback, avail = tr.block.filter((b) => b.prediction === b.prediction);
    W.equation = inv ? 'Nowcast = Σ_i w_i·ŷ_i,  w_i = (1/MSE_i) / Σ_j (1/MSE_j)' : `Nowcast = (1/${avail.length})·Σ_i ŷ_i`;
    W.method = [inv ? `MSE_i = mean squared pseudo-real-time error of member i over the earlier quarters (same stage ${o.horizon} and ${o.lagMode} lags); members need at least ${c.minPast} past errors.` : 'Equal weights over the members that produce a nowcast.',
      `${avail.length} of ${tr.block.length} members produce a nowcast at this origin.` + (tr.weighting === 'invmse' && c.fallback ? ' Fewer than two members have enough past errors, so equal weights are used.' : '')];
    const w = inv ? c.weights : null;
    W.members = tr.block.map((b) => ({ model: b.model, weight: inv ? (w[b.model] === undefined ? 0 : w[b.model]) : (b.prediction === b.prediction ? 1 / avail.length : 0), value: b.prediction }));
    W.blocks.push({ id: 'members', title: 'Members', columns: ['Member', 'Nowcast', 'Past errors', 'MSE', '1/MSE', 'Weight', 'Weight × nowcast'],
      rows: W.members.map((m) => { const mse = c.mse[m.model]; return [L(m.model), m.value, c.nPast[m.model] || 0, mse === undefined ? null : mse, mse === undefined ? null : 1 / Math.max(mse, 1e-8), m.weight, m.weight * (m.value === m.value ? m.value : 0)]; }) });
    if (tr.history && tr.history.length) {
      const qs = Array.from(new Set(tr.history.map((h) => h.target))).sort(), ms = tr.block.map((b) => b.model), cell = {};
      tr.history.forEach((h) => { cell[`${h.target}|${h.model}`] = h.error; });
      W.blocks.push({ id: 'history', title: 'Past pseudo-real-time errors of the members (actual − forecast)', columns: ['Quarter'].concat(ms.map(L)), rows: qs.map((q) => [q].concat(ms.map((m) => { const v = cell[`${q}|${m}`]; return v === undefined ? null : v; }))) });
    }
    setTerms(W, W.members.filter((m) => m.weight).map((m) => [`w × ${L(m.model)}`, m.weight, m.value, `${L(m.model)} at ${o.period} ${o.horizon}`, m.weight * m.value]), W.value);
  }
  X.combination = (W, ctx, o, tr, tn, res, opts) => comboExplain(W, ctx, o, tr, opts.labelOf);
  X.quarter = (W, ctx, o, tr, tn, res, opts) => {
    const q = quarterContext(ctx), oq = q.origin(o.period, o.horizon, o.lagMode), inner = tr.inner || {}, fn = inner.kind ? X[inner.kind] : null;
    const final = W.value, NG = nominalOf(ctx);
    W.value = tr.gHat;
    QF = true;
    try { if (fn) fn(W, q, oq, inner, tn || {}, res, opts); else if (!W.failure) W.method.push('No detailed workings are available for the single-quarter model.'); } finally { QF = false; }
    W.value = final;
    const innerEq = W.equation, innerTerms = W.terms, w = tr.w, a = tr.anchorValue;
    const qm = (lab) => { const t = qParts(lab); return t ? `${['Jan–Mar', 'Jan–Jun', 'Jan–Sep', 'Jan–Dec'][t[1] - 1]} ${t[0]}` : lab; };
    const tq = qParts(o.period), ly = tq ? qLabel(tq[0] - 1, tq[1]) : null, lyp = tq && tq[1] > 1 ? qLabel(tq[0] - 1, tq[1] - 1) : null;
    W.single_quarter = { value: tr.gHat, weight: w, anchor: tr.anchor, anchor_value: tr.q1 ? null : a, first_quarter: tr.q1 };
    W.equation = (innerEq ? innerEq + '\n' : '') + (tr.q1
      ? `${o.period} is a first quarter: year-to-date growth = growth of the quarter = ĝ(t)`
      : `GDP growth, year to date (t) = (1 − w)·GDP(${tr.anchor}) + w·ĝ(t),  w = ${f6(w)}`);
    W.method.unshift(
      'Quarterly form: SIAT publishes GDP growth year to date, so it combines the earlier quarters of the year with the quarter itself: y(t) = (1 − w)·y(t−1) + w·g(t), where g is the growth of the quarter alone (% vs the same quarter a year earlier) and w the quarter\'s share in last year\'s GDP of the same months at current prices. The model below is estimated on g — the series its monthly indicators describe — and its nowcast ĝ is converted with the published y(t−1).',
      'The training values of g are derived from the published year-to-date growth and GDP at current prices (table siat-3695; before 2018 the expenditure-side total, siat-3104): g = (y·N − y_prev·N_prev)/(N − N_prev), with N and N_prev last year\'s GDP from January to the end of the quarter and of the previous quarter. For a first quarter g = y and w = 1.');
    const rows = tr.q1 ? [['First quarter: no earlier quarter of the year', '', '', ''], ['Year-to-date growth = ĝ', '', '', tr.gHat]]
      : [[`Published GDP growth ${tr.anchor} (year to date, ${qm(tr.anchor)})`, 'y(t−1)', a, ''],
        [`GDP at current prices, ${qm(ly)}`, 'N', NG ? NG.get(ly) : null, ''],
        [`GDP at current prices, ${qm(lyp)}`, 'N_prev', NG ? NG.get(lyp) : null, ''],
        [`Weight of ${o.period} = (N − N_prev)/N`, 'w', w, ''],
        ['Single-quarter nowcast of the model above', 'ĝ', tr.gHat, ''],
        ['(1 − w)·y(t−1)', '', (1 - w) * a, (1 - w) * a],
        ['w·ĝ', '', w * tr.gHat, w * tr.gHat],
        ['Year-to-date nowcast', '', final, (1 - w) * a + w * tr.gHat]];
    W.blocks.push({ id: 'quarter_form', title: 'From the growth of the quarter alone to year-to-date growth', columns: ['Item', 'Symbol', 'Value', 'Sum'], rows,
      note: tr.q1 ? null : `An error of ĝ moves the year-to-date nowcast by w = ${f4(w)} times as much.` });
    if (q && NG) {
      const s = quarterSeries(ctx), P = q.periods.filter((p) => p < oq.ord);
      W.blocks.push({ id: 'single_quarter', title: 'Growth of each training quarter alone, derived from the published figures', excelOnly: false,
        columns: ['Quarter', 'y (year to date), %', 'y of the previous quarter, %', 'N (last year), bn UZS', 'N_prev (last year), bn UZS', 'w', 'g, %'],
        rows: P.map((p) => {
          const lab = ctx.periodLabel(p), t = qParts(lab), first = t && t[1] === 1;
          const N = first ? null : NG.get(qLabel(t[0] - 1, t[1])), Np = first ? null : NG.get(qLabel(t[0] - 1, t[1] - 1));
          return [lab, ctx.y(p), first ? null : ctx.y(p - 1), N === undefined ? null : N, Np === undefined ? null : Np, s.w.get(p), s.g.get(p)];
        }) });
    }
    if (tr.q1) return;
    const scaled = innerTerms && innerTerms.rows ? innerTerms.rows.map((r) => [`w × (${r[0]})`, typeof r[1] === 'number' ? w * r[1] : r[1], r[2], r[3], typeof r[4] === 'number' ? w * r[4] : r[4]])
      : [['w × ĝ', w, tr.gHat, 'single-quarter nowcast', w * tr.gHat]];
    setTerms(W, [[`(1 − w) × GDP(${tr.anchor})`, 1 - w, a, gdpYtdText(tr.anchor), (1 - w) * a]].concat(scaled), final,
      'Each term of the single-quarter model is multiplied by w; the published year-to-date growth of the previous quarter enters with weight 1 − w.');
  };
  X.ytd = (W, ctx, o, tr) => {
    const parts = tr.parts || [], q1 = /Q1$/.test(o.period), Y = ctx.extra.ytd;
    const span = (q) => { const p = qParts(q); return p ? `${['Jan–Mar', 'Jan–Jun', 'Jan–Sep', 'Jan–Dec'][p[1] - 1]} ${p[0]}` : q; };
    W.equation = 'GDP growth (year to date) = Σ_s w_s × g_s\n' +
      `w_s = share of section s in GDP over ${span(tr.weightQuarter)} (current prices)\n` +
      (q1 ? `Q1: g_s = mean of the section's last ${tr.q1Years} annual growth rates`
        : `g_s = g_s(${tr.anchor}) + [x_s(latest month released) − x_s(end of ${tr.anchor})]  if the section's monthly SIAT index has a newer month, else g_s(${tr.anchor})`);
    W.method = [
      `SIAT publishes GDP growth cumulatively from January: ${o.period} = ${span(o.period)} compared with the same months a year earlier, and so is the growth of each section's value added (table ${tr.sources.sector_growth || 'siat-3699'}) and of net taxes (${tr.sources.tax_growth || 'siat-3700'}).`,
      `Production identity: GDP growth = Σ_s w_s g_s with w_s each section's share in GDP over the same months of the previous year at current prices (tables ${tr.sources.sector_nominal || 'siat-3696'} and ${tr.sources.gdp_nominal || 'siat-3695'}; net taxes = GDP − sections). It reproduces published GDP growth within about 0.1 percentage points in every quarter since 2019.`,
      q1 ? `For a first quarter there is no earlier quarter of the same year, so each section's growth is the mean of its last ${tr.q1Years} annual growth rates. January–February indices are not used: in 2023 and 2024 they moved by up to 25 points while first-quarter growth did not.`
        : `${tr.anchor} is published, so each section starts from its ${span(tr.anchor)} growth. Where SIAT's monthly year-to-date index of the section (industry by section, construction, retail and wholesale trade) has a month released by the origin after the end of ${tr.anchor}, the section's growth moves by the index's change since then; release lags as for the other models (industry 33 days, construction 27, trade 24, ${o.lagMode} rule).`,
      'Nothing is estimated: weights and growth rates are published numbers, so there are no coefficients and no training window.'];
    const L = (s) => `${s} ${(Y && Y.names[s]) || ''}`.trim();
    W.blocks.push({ id: 'sections', title: `Sections: weight, nowcast growth and contribution (${o.period}, ${o.horizon})`,
      note: `w = value added over ${span(tr.weightQuarter)} ÷ GDP over ${span(tr.weightQuarter)}, current prices. The contributions add up to the nowcast.`,
      columns: ['Section', 'Value added, ' + span(tr.weightQuarter) + ', bn UZS', 'Weight w', 'Source', q1 ? 'Mean of annual growth, %' : `Growth ${tr.anchor}, %`, 'Change from monthly index, pp', 'Nowcast g, %', 'Contribution w×g, pp'],
      rows: parts.map((p) => {
        const li = Y ? Y.qi.get(tr.weightQuarter) : undefined, va = li === undefined ? null : toNum(Y.nominal[p.sector][li]);
        const ch = p.updates ? stats.sum(p.updates.map((u) => u.change)) / p.updates.length : null;
        const src = p.source === 'indicator' ? `monthly index (${p.updates.map((u) => u.indicator).join(', ')})` : p.source === 'q1_trend' ? `mean of ${p.years.length} annual rates` : `${tr.anchor} published`;
        return [L(p.sector), va, p.weight, src, q1 ? p.nowcast : p.previous, ch, p.nowcast, p.contribution];
      }) });
    const ups = []; parts.forEach((p) => (p.updates || []).forEach((u) => { const d = tr.indicators[u.indicator] || {}; ups.push([L(p.sector), d.name || u.indicator, `${d.dataset || ''} ${d.key || ''}`.trim(), d.lag, u.base_month, u.base_value, u.month, u.value, u.change]); }));
    if (!q1) W.blocks.push({ id: 'updates', title: 'Monthly SIAT indices released by the origin (year to date, % vs the same months a year earlier)',
      note: ups.length ? `Change = latest released month − end of ${tr.anchor}. A section with two indices (trade: retail and wholesale) takes the mean change.` : `No index has a month released after the end of ${tr.anchor} at this origin; every section keeps its ${tr.anchor} growth.`,
      columns: ['Section', 'Index', 'Hub dataset and series', 'Release lag, days', `End of ${tr.anchor}`, 'Value, %', 'Latest month released', 'Value, %', 'Change, pp'], rows: ups });
    if (q1) W.blocks.push({ id: 'q1', title: 'First quarter: annual growth rates averaged per section', columns: ['Section', 'Years (Q4 = whole year)', 'Annual growth, %', 'Mean, %'],
      rows: parts.map((p) => [L(p.sector), (p.years || []).map((x) => x[0]).join(', '), (p.years || []).map((x) => f4(x[1])).join(' · '), p.nowcast]) });
    if (Y && !q1 && tr.anchor) {
      const ai = Y.qi.get(tr.anchor), ly = qParts(tr.anchor), li2 = ly ? Y.qi.get(qLabel(ly[0] - 1, ly[1])) : undefined;
      if (ai !== undefined && li2 !== undefined) {
        const gN = toNum(Y.nominal.GDP[li2]); let s = 0;
        Y.sectors.forEach((sec) => { s += toNum(Y.nominal[sec][li2]) / gN * toNum(Y.growth[sec][ai]); });
        W.blocks.push({ id: 'identity', title: `Check of the identity on ${tr.anchor}`, kind: 'kv', columns: ['Item', 'Value'],
          rows: [[`Σ w × published section growth, ${tr.anchor}`, s], [`Published GDP growth ${tr.anchor}`, ctx.y(ctx.periodOrd(tr.anchor))], ['Gap, pp', ctx.y(ctx.periodOrd(tr.anchor)) - s]] });
      }
    }
    setTerms(W, parts.map((p) => [`w × g (${p.sector})`, p.weight, p.nowcast, `${(Y && Y.names[p.sector]) || p.sector}: ${p.source === 'indicator' ? 'updated by the monthly index' : p.source === 'q1_trend' ? 'mean annual growth' : 'previous quarter'}`, p.contribution]), W.value);
  };

  function variablesOf(ctx, o, tr, tn, model) {
    if (tr.kind === 'quarter') {
      const q = quarterContext(ctx), oq = q.origin(o.period, o.horizon, o.lagMode), t = qParts(o.period), Y = ctx.extra.ytd;
      const nom = { field: 'gdp_nominal', role: 'weights', name: 'GDP at current prices, year to date (bn UZS)', key: (Y && Y.nominalSources && Y.nominalSources.join(', ')) || ctx.extra.nominalSource || 'given series',
        block: 'quarterly form', tier: null, transform: 'as published', unit: 'bn UZS', lag_days: ctx.targetLagDays, rule_cutoff: null,
        last_usable: null, last_in_data: null, used: tr.q1 ? 'not needed for a first quarter' : `w = ${f6(tr.w)} for ${o.period}, from ${qLabel(t[0] - 1, t[1])} and ${qLabel(t[0] - 1, t[1] - 1)}` };
      return [targetRow(ctx, o, ctx.train(o).periods), nom].concat(variablesOf(q, oq, tr.inner || {}, tn, model && model.inner));
    }
    const out = [], P = ctx.train(o).periods;
    out.push(targetRow(ctx, o, P));
    const add = (f, used) => { if (ctx.has(f)) out.push(varRow(ctx, o, f, used)); };
    switch (tr.kind) {
      case 'midas': add(tr.field, tn.months ? `${tr.K} lags at the origin: ${months(tn.months)}` : `${tr.K} monthly lags`); break;
      case 'midas_nls': add(tr.field, tn.months ? `${tr.K} lags at the origin: ${months(tn.months.slice().reverse())}` : `${tr.K} monthly lags`); break;
      case 'bridge': tr.fields.forEach((f, k) => add(f, tn.months ? `mean of ${months(tn.months[k])}` : 'quarterly mean of released months')); break;
      case 'bridge_ar': tr.fields.forEach((f) => add(f, 'quarterly mean, unreleased months AR-forecast')); break;
      case 'dfm': tr.fields.forEach((f) => add(f, 'factor panel')); break;
      case 'dfm_kalman': tr.fields.forEach((f) => add(f, 'factor panel')); break;
      case 'penalized': tr.fields.forEach((f) => add(f, tr.design === 'bridge' ? `mean of ${months(tr.months[f])}` : `last ${tr.K} values: ${months(tr.months[f])}`)); break;
      case 'bvar': tr.fields.forEach((f) => add(f, 'quarterly mean (AR-extended)')); break;
      case 'ytd': {
        const used = {};
        (tr.parts || []).forEach((p) => (p.updates || []).forEach((u) => { used[u.indicator] = `${u.base_month} → ${u.month} (section ${p.sector})`; }));
        Object.keys(tr.indicators || {}).forEach((k) => {
          const d = tr.indicators[k], cut = cutoffMonth(o.day, d.lag, o.lagMode);
          let last = null; for (let i = d.months.length - 1; i >= 0; i--) if (d.months[i] <= cut) { last = d.months[i]; break; }
          out.push({ field: k, role: 'predictor', name: d.name, key: `${d.dataset} ${d.key}`, block: 'sector release', tier: null, transform: 'year to date, % (as published − 100)',
            unit: '% vs the same months a year earlier', lag_days: d.lag, rule_cutoff: monthISO(cut), last_usable: last === null ? null : monthISO(last),
            last_in_data: d.months.length ? monthISO(d.months[d.months.length - 1]) : null, used: used[k] || (/Q1$/.test(o.period) ? 'not used for a first quarter' : 'no month after the previous quarter yet') });
        });
        break;
      }
      default: break;
    }
    return out;
  }

  /**
   * Re-estimate ``model`` at ``origin`` and return every intermediate result.
   * @param {object|string} model model object (Econ.models.*, buildModel) or an engine model name
   * @param {NowcastData} ctx
   * @param {object} [origin] Origin, or {quarter, horizon, lagMode}; default: the production origin
   * @param {{labelOf?:function(string):string}} [opts]
   * @returns {{ok, model, family, origin, value, failure, equation, method:string[], variables:object[],
   *   blocks:{id,title,columns,rows,note?,kind?}[], terms:{columns,rows,total,sum}, members?, fitted?}}
   */
  function explain(model, ctx, origin, opts) {
    opts = opts || {};
    if (typeof model === 'string') { const m = engine.modelByName(ctx, model); if (!m) fail('unknown_model', `no model named '${model}'`); model = m; }
    const o = resolveOrigin(ctx, origin);
    let res;
    TRACE = true;
    try { res = model.fit(ctx.train(o)).predict(o); } finally { TRACE = false; }
    const d = res.diagnostics || {}, tr = d.trace || {}, tn = d.trace_now || {};
    const W = { ok: true, model: model.name, family: model.family, role: model.role || null, tier: model.tier || null,
      origin: { period: o.period, horizon: o.horizon, lagMode: o.lagMode, date: o.date, month: monthISO(o.month), stageNote: o.stageNote || null },
      value: res.value, failure: res.failure, n_train: d.n_train === undefined ? null : d.n_train, coefficients: res.coefficients,
      equation: '', method: [], variables: [], blocks: [], terms: null, members: null, fitted: null, actual: ctx.y(o.ord) };
    const fn = tr.kind ? X[tr.kind] : null;
    if (fn) fn(W, ctx, o, tr, tn, res, opts);
    else if (!W.failure) W.method.push('No detailed workings are available for this model.');
    W.variables = tr.kind ? variablesOf(ctx, o, tr, tn, model) : [targetRow(ctx, o, ctx.train(o).periods)];
    if (W.failure) W.method.push(`The model produced no nowcast at this origin: ${W.failure}.`);
    return jsonify(W);
  }

  /**
   * Workings of an equal-weight or inverse-MSE combination rebuilt from prediction
   * rows (e.g. nowcast.json predictions): the engine's pool combinations
   * combo_equal / combo_invmse, or the family combinations.
   * @param {{name:string, rows:object[], members:string[], weights:'equal'|'invmse', target:string,
   *   horizon:string, lagMode:string, historyFrom?:string, training?:object, minPast?:number, labelOf?:function}} o
   *   rows: {model, target, horizon, lagMode, prediction, actual}; training: the panel's release_rule.training
   *   (errors from production_first, or record_first for earlier targets); default history from 2021Q1
   */
  function fromRows(o) {
    const tr = o.training, set = new Set(o.members);
    const from = o.historyFrom || (tr ? (o.target >= tr.production_first ? tr.production_first : tr.record_first) : '2021Q1');
    const grp = o.rows.filter((r) => r.horizon === o.horizon && r.lagMode === o.lagMode && set.has(r.model));
    const num = (v) => (v === null || v === undefined ? NaN : v);
    const block = grp.filter((r) => r.target === o.target).map((r) => ({ model: r.model, prediction: num(r.prediction) }));
    const history = grp.filter((r) => r.target < o.target && r.target >= from && num(r.actual) === num(r.actual))
      .map((r) => ({ model: r.model, target: r.target, prediction: num(r.prediction), actual: num(r.actual), error: num(r.actual) - num(r.prediction) }));
    const c = combineRows(block, history, o.members, o.minPast);
    const W = { ok: true, model: o.name, family: 'combination', role: 'combination', tier: null,
      origin: { period: o.target, horizon: o.horizon, lagMode: o.lagMode, date: null, month: null, stageNote: null },
      value: c ? (o.weights === 'invmse' ? c.invmse : c.equal) : NaN, failure: c ? (o.weights === 'invmse' && c.fallback ? 'equal_weights_fallback' : null) : 'no_member_prediction',
      n_train: null, coefficients: {}, equation: '', method: [], variables: [], blocks: [], terms: null, members: null, fitted: null, actual: null };
    if (c) comboExplain(W, null, { period: o.target, horizon: o.horizon, lagMode: o.lagMode }, { kind: 'combination', weighting: o.weights, block, history, combine: c }, o.labelOf);
    W.method.push('Rebuilt from the published member predictions (rounded to 6 decimals).');
    return jsonify(W);
  }
  return { explain, fromRows, tCrit, resolveOrigin };
})();

/**
 * Workings of a model given as a JSON spec (the model lab): the spec's data,
 * added series and origin as in runSpec.
 */
function workingsSpec(spec, data, origin) {
  let ctx;
  try { ctx = toContext(data); } catch (e) { return { ok: false, errors: [{ path: 'data', message: e.message }] }; }
  const errors = validateSpec(spec, ctx);
  if (errors.length) return { ok: false, errors, spec };
  try {
    if (spec.series && spec.series.length) {
      ctx = cloneContext(ctx);
      spec.series.forEach((s) => {
        let ser = series.transform(series.make(s.periods, s.values, { name: s.name }), s.transform, { coverageEnd: s.coverageEnd });
        if (ser.freq === 'C') ser = Object.assign({}, ser, { freq: 'M' });
        ctx.addMonthly(s.name, ser, { lagDays: s.lagDays === undefined ? 30 : s.lagDays, meta: { transform: s.transform || 'none' } });
      });
    }
    const model = buildModel(spec, ctx), so = spec.origin || {};
    const lagMode = so.lagMode || (spec.evaluation && spec.evaluation.lagMode) || 'standard';
    let o = origin;
    if (!o) {
      o = so.quarter || so.period ? ctx.origin(so.quarter || so.period, so.horizon || 'H' + LOWFREQ[ctx.freq].k, lagMode) : ctx.productionOrigin(spec.asOf, lagMode);
      if (!(so.quarter || so.period) && so.horizon) o = Object.assign(ctx.origin(o.period, so.horizon, lagMode), { stageNote: o.stageNote });
    }
    const W = workings.explain(model, ctx, o);
    W.spec = spec;
    return W;
  } catch (e) {
    if (e instanceof EconError) return { ok: false, errors: [{ path: '', message: e.message, code: e.code }], spec };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

return {
  version: VERSION, SEED, EconError,
  linalg, random, stats, series, info,
  calendar: { daysFromCivil, civilFromDays, dayISO, isoDay, monthOrd, monthISO, monthEndDay, monthOfDay, parsePeriod, formatPeriod },
  data: { fromPanel: NowcastData.fromPanel, fromSeries: NowcastData.fromSeries, NowcastData },
  models: { historicalMean, ar, bridge, midas, dfm, dfmKalman, lasso, elasticNet, bvar, combination, ensemble5050, ytdBottomUp, ytdCombination, parseYtd, ytdCompute, ytdFlash, ytdFlashOrigin,
    quarterForm, quarterSeries, quarterWeight, quarterContext,
    expalmonWeights, betaWeights, EXPALMON_GRID, BETA_GRID, emPCA, fitKalmanDFM, kalmanSmoother, bvarPosterior, bvarConditionalDraws,
    combineRows, enet, makeModel },
  evaluate, metricsTable, engine, runSpec, validateSpec, specSchema, buildModel,
  workings: { explain: workings.explain, fromRows: workings.fromRows, spec: workingsSpec, tCrit: workings.tCrit, resolveOrigin: workings.resolveOrigin },
};
});
