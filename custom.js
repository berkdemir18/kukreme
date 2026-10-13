/*
 * custom.js — "Kendi sesini ekle".
 *
 * Kullanıcının yüklediği motor sesi dosyasını tarayıcıda analiz eder:
 * spektrumdaki harmonik merdiveninden her an motorun devrini çıkarır, devrin
 * düzgünce yükseldiği bölümleri (gaz çekişlerini) bulur ve bunları ses motorunun
 * kullandığı tabloya çevirir. Dosya ve tablo yalnızca bu cihazda (IndexedDB) saklanır,
 * hiçbir yere gönderilmez.
 */
(() => {
  'use strict';

  const SR = 11025;          // analiz örnekleme hızı
  const N = 2048;            // FFT boyu (~186 ms)
  const HOP = 256;           // ~23 ms
  const CMIN = 10, CMAX = 95, NC = 320;   // çevrim frekansı adayları (devir/120)
  const NH = 24;

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  // tek kanal + 11 kHz'e indir (basit kutu filtresi yeter: sadece analiz için)
  function downsample(buf) {
    const src = buf.getChannelData(0);
    const other = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const k = buf.sampleRate / SR;
    const n = Math.floor(src.length / k);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * k), b = Math.floor((i + 1) * k);
      let s = 0;
      for (let j = a; j < b; j++) s += other ? (src[j] + other[j]) * 0.5 : src[j];
      out[i] = s / Math.max(1, b - a);
    }
    return out;
  }

  // her kare için harmonik toplam: "bu çevrim frekansının katlarında enerji var mı"
  function salience(x) {
    const frames = Math.max(0, Math.floor((x.length - N) / HOP));
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const cands = new Float32Array(NC);
    for (let i = 0; i < NC; i++) cands[i] = CMIN * Math.pow(CMAX / CMIN, i / (NC - 1));
    const df = SR / N, maxBin = Math.floor(2600 / df);
    const S = new Float32Array(frames * NC);
    const energy = new Float32Array(frames);
    const re = new Float32Array(N), im = new Float32Array(N), L = new Float32Array(maxBin + 2);
    for (let f = 0; f < frames; f++) {
      const o = f * HOP;
      let e = 0;
      for (let i = 0; i < N; i++) { const v = x[o + i] * win[i]; re[i] = v; im[i] = 0; e += v * v; }
      energy[f] = e;
      fft(re, im);
      for (let b = 0; b <= maxBin + 1; b++) L[b] = Math.log(Math.hypot(re[b], im[b]) + 1e-7);
      // medyana göre normalize, negatifleri at
      const sorted = Array.from(L.subarray(0, maxBin)).sort((a, b) => a - b);
      const med = sorted[sorted.length >> 1];
      for (let b = 0; b <= maxBin + 1; b++) L[b] = Math.max(0, L[b] - med);
      for (let c = 0; c < NC; c++) {
        let s = 0;
        for (let h = 1; h <= NH; h++) {
          const bf = (cands[c] * h) / df;
          if (bf >= maxBin) break;
          const b0 = bf | 0, a = bf - b0;
          s += L[b0] * (1 - a) + L[b0 + 1] * a;
        }
        S[f * NC + c] = s / NH;
      }
    }
    return { S, frames, cands, energy };
  }

  // Viterbi: süreklilik cezası ile en olası devir izi
  function track(S, frames) {
    const MS = 7;
    let D = new Float32Array(NC), ND = new Float32Array(NC);
    const B = new Int16Array(frames * NC);
    for (let c = 0; c < NC; c++) D[c] = S[c];
    for (let f = 1; f < frames; f++) {
      for (let c = 0; c < NC; c++) {
        let best = -1e9, arg = c;
        for (let d = -MS; d <= MS; d++) {
          const k = c + d;
          if (k < 0 || k >= NC) continue;
          const v = D[k] - 0.02 * Math.abs(d);
          if (v > best) { best = v; arg = k; }
        }
        ND[c] = best + S[f * NC + c];
        B[f * NC + c] = arg;
      }
      const t = D; D = ND; ND = t;
    }
    let k = 0;
    for (let c = 1; c < NC; c++) if (D[c] > D[k]) k = c;
    const path = new Int16Array(frames);
    for (let f = frames - 1; f >= 0; f--) { path[f] = k; k = B[f * NC + k]; }
    return path;
  }

  // devrin düzgünce yükseldiği bölümler (gaz çekişleri)
  function risingSegments(rpm, sal, energy, dt) {
    const n = rpm.length;
    const eMax = energy.reduce((a, v) => Math.max(a, v), 0);
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, k = 0;
      for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) { s += rpm[j]; k++; }
      sm[i] = s / k;
    }
    const segs = [];
    let i = 0;
    while (i < n - 1) {
      let j = i, lowRun = 0;
      while (j < n - 1) {
        const ok = sm[j + 1] >= sm[j] * 0.995 && energy[j + 1] > eMax * 0.002;
        if (!ok) { lowRun++; if (lowRun > 3) break; } else lowRun = 0;
        j++;
      }
      const end = j - lowRun;
      const dur = (end - i) * dt;
      if (dur >= 1.0 && sm[end] / Math.max(1, sm[i]) >= 1.25) {
        let s = 0; for (let k = i; k <= end; k++) s += sal[k];
        segs.push({ a: i, b: end, dur, ratio: sm[end] / sm[i], q: s / (end - i + 1) });
      }
      i = Math.max(j, i + 1);
    }
    segs.sort((p, q) => q.dur * Math.log(q.ratio) * q.q - p.dur * Math.log(p.ratio) * p.q);
    return { segs: segs.slice(0, 6), sm };
  }

  async function analyze(arrayBuffer) {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
    if (buf.duration < 1.5) throw new Error('Kayıt çok kısa (en az 2 saniye olmalı).');
    if (buf.duration > 600) throw new Error('Kayıt çok uzun (en fazla 10 dakika).');
    const x = downsample(buf);
    const { S, frames, cands, energy } = salience(x);
    const path = track(S, frames);
    const dt = HOP / SR;
    const rpm = new Float32Array(frames), sal = new Float32Array(frames);
    for (let f = 0; f < frames; f++) { rpm[f] = cands[path[f]] * 120; sal[f] = S[f * NC + path[f]]; }
    const { segs, sm } = risingSegments(rpm, sal, energy, dt);
    const t0 = (N / 2) / SR;   // kare merkezi
    const pieces = [];
    for (const s of segs) {
      const a = t0 + s.a * dt, b = t0 + s.b * dt;
      const out = [];
      let prev = 0;
      for (let t = a; t <= b; t += 0.02) {
        const fi = Math.min(s.b, Math.max(s.a, (t - t0) / dt));
        const i0 = Math.floor(fi), w = fi - i0;
        let v = sm[i0] * (1 - w) + sm[Math.min(s.b, i0 + 1)] * w;
        v = Math.max(prev, v); prev = v;
        out.push(Math.round(v));
      }
      if (out.length >= 30) pieces.push({ start: +a.toFixed(4), rpm: out });
    }
    let found = pieces.length > 0;
    if (!found) {
      // yükselen bölüm yok: kaydın tamamını sabit devirde kabul et (perdeyle oynanır)
      const len = Math.max(30, Math.floor((buf.duration - 0.1) / 0.02));
      const med = Array.from(rpm).sort((p, q) => p - q)[rpm.length >> 1] || 3000;
      pieces.push({ start: 0, rpm: Array.from({ length: len }, (_, k) => Math.round(med * (1 + k * 1e-5))) });
    }
    const lo = Math.min(...pieces.map((p) => p.rpm[0]));
    const hi = Math.max(...pieces.map((p) => p.rpm[p.rpm.length - 1]));
    return { map: { step: 0.02, on: pieces, off: pieces }, lo, hi, found, duration: buf.duration, segments: pieces.length };
  }

  // ---- IndexedDB: dosya + analiz sadece bu cihazda
  const DB = 'kukreme-custom', STORE = 'engines';
  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  }
  const save = (rec) => tx('readwrite', (s) => s.put(rec));
  const list = () => tx('readonly', (s) => s.getAll());
  const remove = (id) => tx('readwrite', (s) => s.delete(id));

  window.KukremeCustom = { analyze, save, list, remove };
})();
