/*
 * engine-worklet.js — gerçek dyno kayıtlarından granüler motor sesi.
 *
 * Her araç için iki kayıt parçası var:
 *   on  — dyno'da tam gaz, yük altında devir yükselişi
 *   off — gaz kesildikten sonra gerçek devir düşüşü (motor freni / patlamalar)
 * İki "ses" aynı anda çalışır, karışım oranı pedaldan gelir; gaz-kes geçişi anında olur.
 *
 * Her ses: hedef devirdeki kayıt anını bulur, ~120 ms'lik Hann pencereleri %50 örtüşerek
 * çalar. Yeni pencere mümkünse eskisinin kaldığı yerden devam eder (dikişsiz); kayma
 * büyürse hedefe sıçrar ve sıçrama noktasını dalga şekline göre hizalar (WSOLA) —
 * örtüşen iki pencere aynı fazda olduğu için "faz/vızıltı" yapaylığı oluşmaz.
 * Okuma hızı her blokta hedefRpm / kaynakRpm: kayıt kendi içinde süpürse de perde sabit.
 */
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Bir "ses": aynı kayıttan bir ya da birden çok devir süpürmesi (parça). Birden çok
// parça varsa (ör. 1., 2., 3. vites çekişleri) her sıçramada hedef devri kapsayan
// parçalardan rastgele biri seçilir — aynı kesit tekrar tekrar çalmaz, döngü hissi kaybolur.
class Voice {
  constructor(proc, data, tbls, sr) {
    this.proc = proc;
    this.data = data;
    this.pieces = (Array.isArray(tbls) ? tbls : [tbls]).map((t) => {
      const n = t.rpm.length, step = t.step * sr, start = Math.round(t.start * sr);
      const dir = t.rpm[n - 1] >= t.rpm[0] ? 1 : -1;
      return {
        step, start, rpm: t.rpm, norm: t.norm, n, dir,
        rmin: Math.min(t.rpm[0], t.rpm[n - 1]), rmax: Math.max(t.rpm[0], t.rpm[n - 1]),
        end: Math.min(data.length - 2, start + (n - 1) * step),
      };
    });
    this.rmin = Math.min(...this.pieces.map((p) => p.rmin));
    this.rmax = Math.max(...this.pieces.map((p) => p.rmax));
    this.grains = [];
    this.last = null;
    this.tmp = new Float32Array(2);
    this.jumps = 0;
  }
  lookup(pc, p) {
    let f = (p - pc.start) / pc.step;
    if (f < 0) f = 0;
    if (f > pc.n - 1.001) f = pc.n - 1.001;
    const i = f | 0, a = f - i;
    this.tmp[0] = pc.rpm[i] + (pc.rpm[i + 1] - pc.rpm[i]) * a;
    this.tmp[1] = pc.norm[i] + (pc.norm[i + 1] - pc.norm[i]) * a;
    return this.tmp;
  }
  posForRpm(pc, r) {
    const R = pc.rpm, d = pc.dir;
    let lo = 0, hi = pc.n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (d * R[m] < d * r) lo = m; else hi = m;
    }
    const span = R[hi] - R[lo];
    const a = span !== 0 ? clamp((r - R[lo]) / span, 0, 1) : 0;
    return pc.start + (lo + a) * pc.step;
  }
  // aralığın altında perdeyi tamamen düşürmek yerine sıkıştır: tını korunur
  srcTarget(r) {
    if (r >= this.rmin) return Math.min(r, this.rmax);
    return this.rmin * Math.pow(r / this.rmin, 0.78);
  }
  pick(rc, margin) {
    const ok = this.pieces.filter((pc) => rc >= pc.rmin * 0.98 && rc <= pc.rmax * 1.02 && pc.end - pc.start > margin * 1.5);
    // aynı çekişte kal (tını titremesin); kapsamıyorsa en uzun kapsayan çekişe geç
    if (this.last && ok.includes(this.last.pc)) return this.last.pc;
    if (ok.length) return ok.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    let best = this.pieces[0], bd = Infinity;
    for (const pc of this.pieces) {
      const d = rc < pc.rmin ? pc.rmin / rc : rc > pc.rmax ? rc / pc.rmax : 1;
      if (d < bd) { bd = d; best = pc; }
    }
    return best;
  }
  spawn(at, rpm, gl) {
    const rc = clamp(rpm, this.rmin, this.rmax);
    const margin = gl * 2.2;
    const last = this.last;
    let q = -1;
    if (last && last.age < gl) {
      q = last.p + at * (last.rate || 1);
      const pc = last.pc;
      if (q < pc.end - margin && q > pc.start) {
        const sr0 = this.lookup(pc, q)[0];
        // okuma ucu ileri aktıkça kaynak devir yükselir; hedefin %12 altı ile %6 üstü arasında
        // kaldıkça kesintisiz devam (perde zaten düzeltiliyor) — sabit devirde uzun, ritimsiz döngü
        const m = sr0 / rc - 1;
        if (m > -0.12 && m < 0.06) { this.push(q, pc); return; }
      }
    }
    const pc = this.pick(rc, margin);
    // geri sıçrarken hedefin %4–11 altına, rastgele bir yere: tekrar eden bir ritim oluşmasın
    const back = rc * (0.89 + Math.random() * 0.07);
    let p = this.posForRpm(pc, clamp(back, pc.rmin, pc.rmax));
    p = clamp(p, pc.start, pc.end - margin);
    if (q > 0 && q < this.data.length - 600) p = this.align(q, p, last.rate || 1, pc);
    this.jumps++;
    this.push(p, pc);
  }
  // WSOLA: eski pencerenin devamına en çok benzeyen kaydırmayı bul
  align(q, p, rate, pc) {
    const d = this.data, M = 320, D = Math.round(sampleRate * 0.0075);
    let best = p, bestScore = -Infinity;
    const lo = Math.max(pc.start, p - D), hi = Math.min(pc.end - 2000, p + D);
    for (let c = lo; c <= hi; c += 2) {
      let xy = 0, yy = 1e-9;
      const ci = c | 0;
      for (let i = 0; i < M; i += 2) {
        const r = d[(q + i * rate) | 0];
        const y = d[ci + ((i * rate) | 0)];
        xy += r * y; yy += y * y;
      }
      const s = xy / Math.sqrt(yy);
      if (s > bestScore) { bestScore = s; best = c + (p - (p | 0)); }
    }
    return best;
  }
  push(p, pc) {
    const g = { p, pc, age: 0, rate: 1, delay: 0 };
    this.grains.push(g);
    this.last = g;
  }
  render(out, N, rpm, gain, win, gl) {
    const tr = this.srcTarget(rpm);
    const data = this.data;
    for (let k = this.grains.length - 1; k >= 0; k--) {
      const g = this.grains[k];
      const t = this.lookup(g.pc, g.p);
      const rate = clamp(tr / t[0], 0.4, 1.9);
      const nrm = t[1] * gain;
      g.rate = rate;
      let p = g.p, age = g.age;
      const s0 = g.delay; g.delay = 0;
      if (nrm > 1e-5) {
        for (let s = s0; s < N && age < gl; s++, age++) {
          const i = p | 0, a = p - i;
          out[s] += (data[i] + (data[i + 1] - data[i]) * a) * win[age] * nrm;
          p += rate;
        }
      } else {
        const n = Math.min(N - s0, gl - age);
        p += rate * n; age += n;
      }
      g.p = p; g.age = age;
      if (age >= gl || p >= g.pc.end) this.grains.splice(k, 1);
    }
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = null; this.off = null;
    this.rpm = 900; this.target = 900;
    this.amp = 0; this.tAmp = 0;
    this.mix = 0; this.tMix = 0;        // 0 = gazda, 1 = gazsız
    this.crackle = 0.5; this.overrun = 0;
    this.gl = Math.round(0.16 * sampleRate);
    this.hop = this.gl >> 1;
    this.untilNext = 0;
    this.win = new Float32Array(this.gl);
    for (let i = 0; i < this.gl; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.gl);
    this.pops = [];
    this.bufOn = new Float32Array(128);
    this.bufOff = new Float32Array(128);
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  onMsg(d) {
    if (d.type === 'car') {
      this.on = new Voice(this, d.data, d.on, sampleRate);
      this.off = new Voice(this, d.data, d.off, sampleRate);
      this.untilNext = 0;
    } else if (d.type === 'set') {
      if (d.rpm !== undefined) this.target = d.rpm;
      if (d.amp !== undefined) this.tAmp = d.amp;
      if (d.mix !== undefined) this.tMix = d.mix;
      if (d.overrun !== undefined) this.overrun = d.overrun;
      if (d.crackle !== undefined) this.crackle = d.crackle;
      if (d.popSet !== undefined) this.popSet = d.popSet;
      if (d.snap) { this.rpm = this.target; this.mix = this.tMix; }
    } else if (d.type === 'pops') {
      this.bank = { data: d.data, list: d.list.map((p) => ({ s: Math.round(p.start * sampleRate), l: Math.round(p.len * sampleRate), src: p.src })) };
    } else if (d.type === 'pop') {
      this.addPop(d.strength || 1);
    } else if (d.type === 'stats') {
      this.port.postMessage({ jumpsOn: this.on && this.on.jumps, jumpsOff: this.off && this.off.jumps });
    }
  }

  addPop(s) {
    // gerçek kayıttan kesilmiş patlamalar (varsa); kamyonda kamyon patlamaları
    if (this.bank) {
      const want = this.popSet === 'truck' ? '717867' : null;
      let L = this.bank.list.filter((p) => (want ? p.src === want : p.src !== '717867'));
      if (!L.length) L = this.bank.list;
      const p = L[(Math.random() * L.length) | 0];
      this.pops.push({ real: true, pos: p.s, end: p.s + p.l, rate: 0.85 + Math.random() * 0.3, amp: (0.5 + Math.random() * 0.5) * s });
      return;
    }
    // egzoz patlaması: düşük frekanslı gövde "tok" + kısa parlak çatırtı
    const f = 70 + Math.random() * 70;
    this.pops.push({
      age: 0,
      len: Math.round((0.05 + Math.random() * 0.05) * sampleRate),
      amp: (0.45 + Math.random() * 0.55) * s,
      f, ph: 0, crack: 0.25 + Math.random() * 0.5, lp: 0, hp: 0,
    });
  }

  process(_in, outputs) {
    const out = outputs[0][0];
    const N = out.length;
    out.fill(0);
    if (!this.on) return true;

    this.rpm += (this.target - this.rpm) * 0.5;      // ~3 ms blok: neredeyse anında
    this.amp += (this.tAmp - this.amp) * 0.35;
    this.mix += (this.tMix - this.mix) * 0.3;

    if (this.untilNext <= N) {
      const at = Math.max(0, this.untilNext);
      this.on.spawn(at, this.rpm, this.gl); this.on.last.delay = at;
      this.off.spawn(at, this.rpm, this.gl); this.off.last.delay = at;
      this.untilNext += this.hop;
    }
    this.untilNext -= N;

    // eşit güçlü geçiş
    const m = this.mix;
    const gOn = Math.cos(m * Math.PI / 2), gOff = Math.sin(m * Math.PI / 2);
    this.on.render(out, N, this.rpm, gOn * this.amp, this.win, this.gl);
    this.off.render(out, N, this.rpm, gOff * this.amp * 1.15, this.win, this.gl);

    // ek patlamalar: ayak çekik + yüksek devir
    const rate = this.overrun * this.crackle * (0.4 + this.rpm / 7000) * 9;  // patlama/s
    if (rate > 0 && Math.random() < (rate * N) / sampleRate) this.addPop(0.6 + this.overrun * 0.4);
    for (let k = this.pops.length - 1; k >= 0; k--) {
      const q = this.pops[k];
      if (q.real) {
        const D = this.bank.data, g = q.amp * 0.55 * Math.max(0.35, this.crackle);
        for (let s = 0; s < N && q.pos < q.end - 1; s++) {
          const i = q.pos | 0, a = q.pos - i;
          out[s] += (D[i] + (D[i + 1] - D[i]) * a) * g;
          q.pos += q.rate;
        }
        if (q.pos >= q.end - 1) this.pops.splice(k, 1);
        continue;
      }
      const w = (2 * Math.PI * q.f) / sampleRate;
      for (let s = 0; s < N && q.age < q.len; s++, q.age++) {
        const t = q.age / q.len;
        const env = t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) * 9);
        q.ph += w * (1 - t * 0.4);
        const body = Math.sin(q.ph) * env;
        const n = Math.random() * 2 - 1;
        q.lp += (n - q.lp) * 0.5;
        const crack = (n - q.lp) * Math.exp(-t * 40) * q.crack;
        out[s] += (body * 0.9 + crack) * q.amp * 0.5 * this.crackle;
      }
      if (q.age >= q.len) this.pops.splice(k, 1);
    }
    return true;
  }
}

registerProcessor('engine-processor', EngineProcessor);
