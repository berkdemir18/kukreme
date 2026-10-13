/*
 * Kükreme — Tesla'da gerçek gaz/fren tepkisine göre benzinli motor sesi.
 *
 * Girdi:  iPhone ivmeölçeri (saniyede ~60 ölçüm, gaz/fren anında hissedilir)
 *         + GPS hızı (hızı düzeltmek için). Sensör yoksa sadece GPS.
 * Model:  ölçülen ivmeden "benzinli araba olsa gaza ne kadar basardın" tahmini,
 *         sanal vites kutusu, devir.
 * Ses:    gerçek dyno kayıtlarından granüler çalma (engine-worklet.js).
 */
(() => {
  'use strict';

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('kukreme.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('kukreme.' + k, JSON.stringify(v)); } catch {} },
  };

  // ---------------------------------------------------------------- araçlar
  const CARS = {
    supra: {
      name: 'Toyota Supra', spec: '2JZ · 3.0 sıralı 6 · turbo', file: 'audio/supra.mp3',
      ratios: [3.83, 2.36, 1.69, 1.31, 1.0, 0.79], final: 3.27, tire: 2.05,
      idle: 900, redline: 8000, turbo: true,
      credit: { by: 'editboy23', url: 'https://freesound.org/people/editboy23/sounds/496171/' },
    },
    frs: {
      name: 'Toyota GT86', spec: 'FR-S · 2.0 boxer 4 · atmosferik', file: 'audio/frs.mp3',
      ratios: [3.626, 2.188, 1.541, 1.213, 1.0, 0.767], final: 4.1, tire: 1.95,
      idle: 800, redline: 7400, turbo: false,
      credit: { by: 'dezoris', url: 'https://freesound.org/people/dezoris/sounds/183654/' },
    },
    gtsc: {
      name: 'GT86 Kompresör', spec: '2.0 boxer 4 · Vortech supercharger', file: 'audio/gtsc.mp3',
      ratios: [3.626, 2.188, 1.541, 1.213, 1.0, 0.767], final: 4.1, tire: 1.95,
      idle: 800, redline: 7400, turbo: false,
      credit: { by: 'dezoris', url: 'https://freesound.org/people/dezoris/sounds/191194/' },
    },
    ferrari: {
      name: 'Ferrari', spec: 'İtalyan yüksek devir · yol kaydı', file: 'audio/ferrari.mp3',
      ratios: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], final: 4.44, tire: 2.07,
      idle: 1000, redline: 8500, turbo: false,
      credit: { by: 'biholao', url: 'https://freesound.org/people/biholao/sounds/370278/' },
    },
    m3: {
      name: 'BMW M3', spec: 'M serisi · pist kaydı', file: 'audio/m3.mp3',
      ratios: [4.23, 2.53, 1.67, 1.23, 1.0, 0.83], final: 3.62, tire: 2.0,
      idle: 900, redline: 8200, turbo: false,
      credit: { by: 'ikbenraar', url: 'https://freesound.org/people/ikbenraar/sounds/415276/' },
    },
    vtec: {
      name: 'Honda VTEC', spec: '3.2 V6 VTEC · egzoz mikrofonu', file: 'audio/vtec.mp3',
      ratios: [3.72, 2.13, 1.52, 1.15, 0.86, 0.69], final: 4.2, tire: 1.95,
      idle: 800, redline: 6600, turbo: false,
      credit: { by: 'EvanBoyerman', url: 'https://freesound.org/people/EvanBoyerman/sounds/754775/' },
    },
    dubai: {
      name: 'Dubai Süper Spor', spec: 'Egzotik · tam gaz vites vites', file: 'audio/dubai.mp3',
      ratios: [3.13, 2.12, 1.63, 1.3, 1.08, 0.9, 0.75], final: 4.3, tire: 2.08,
      idle: 1000, redline: 8600, turbo: false,
      credit: { by: 'florianreichelt', url: 'https://freesound.org/people/florianreichelt/sounds/457560/' },
    },
    p911: {
      name: 'Porsche 911', spec: 'Boxer 6 · arkadan motorlu', file: 'audio/p911.mp3',
      ratios: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], final: 3.44, tire: 2.07,
      idle: 900, redline: 7800, turbo: false,
      credit: { by: 'jerry.berumen', url: 'https://freesound.org/people/jerry.berumen/sounds/772802/' },
    },
    race: {
      name: 'Yarış Arabası', spec: 'Pist · yüksek devir', file: 'audio/race.mp3',
      ratios: [2.9, 2.2, 1.75, 1.45, 1.22, 1.05], final: 4.0, tire: 2.0,
      idle: 1300, redline: 8800, turbo: false,
      credit: { by: 'biholao', url: 'https://freesound.org/people/biholao/sounds/370276/' },
    },
    camaro: {
      name: 'Chevrolet Camaro', spec: 'Amerikan V8 · yakın kayıt', file: 'audio/camaro.mp3',
      ratios: [2.97, 2.07, 1.43, 1.0, 0.84, 0.57], final: 3.73, tire: 2.1,
      idle: 750, redline: 6800, turbo: false,
      credit: { by: 'biholao', url: 'https://freesound.org/people/biholao/sounds/370277/' },
    },
    v8: {
      name: '454 Big-Block V8', spec: '7.4 L · twin-turbo · 1700 hp', file: 'audio/v8.mp3',
      ratios: [2.66, 1.78, 1.3, 1.0, 0.74, 0.5], final: 3.42, tire: 2.1,
      idle: 850, redline: 7000, turbo: true,
      credit: { by: 'Ears68', url: 'https://freesound.org/people/Ears68/sounds/213665/' },
    },
  };

  const settings = {
    car: store.get('car', 'supra'),
    mode: store.get('mode', 'drive'),
    volume: store.get('volume', 0.85),
    response: store.get('response', 2.6),   // m/s² — bu ivmede "tam gaz"
    crackle: store.get('crackle2', 0),
    style: store.get('style', 'sport'),
    city: store.get('city2', 1.35),
  };
  if (!CARS[settings.car]) settings.car = 'supra';

  // ---------------------------------------------------------------- ses
  const audio = { ctx: null, node: null, filter: null, master: null, maps: null, buffers: {}, ready: false };

  async function loadMaps() {
    if (!audio.maps) audio.maps = await fetch('audio/maps.json').then((r) => r.json());
    return audio.maps;
  }

  async function initAudio() {
    if (audio.ctx) { await audio.ctx.resume(); return; }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    audio.ctx = ctx;
    await ctx.audioWorklet.addModule('engine-worklet.js');
    const node = new AudioWorkletNode(ctx, 'engine-processor', { numberOfInputs: 0, outputChannelCount: [1] });
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 2000; filter.Q.value = 0.6;
    const body = ctx.createBiquadFilter();       // kabin/gövde rezonansı: alt-orta frekansa hafif dolgunluk
    body.type = 'peaking'; body.frequency.value = 140; body.Q.value = 0.9; body.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.18;
    const master = ctx.createGain();
    master.gain.value = 0;
    node.connect(filter).connect(body).connect(comp).connect(master).connect(ctx.destination);
    // kısa, stereo "kabin" yankısı: kuru kayıt hissini alır, sesi hoparlörlere yayar
    const ir = ctx.createBuffer(2, Math.round(ctx.sampleRate * 0.22), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        lp += ((Math.random() * 2 - 1) - lp) * 0.35;
        d[i] = lp * Math.exp(-i / (ctx.sampleRate * 0.045));
      }
    }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0;   // yapay yankı kapalı
    comp.connect(conv).connect(wet).connect(master);
    audio.node = node; audio.filter = filter; audio.master = master; audio.comp = comp;
    await ctx.resume();
  }

  async function loadCar(id) {
    const ctx = audio.ctx;
    const maps = await loadMaps();
    let b = audio.buffers[id];
    if (!b) {
      const arr = await fetch(CARS[id].file).then((r) => r.arrayBuffer());
      b = await new Promise((res, rej) => ctx.decodeAudioData(arr, res, rej));
      audio.buffers[id] = b;
    }
    const m = maps[id];
    const data = new Float32Array(b.getChannelData(0));
    const sr = b.sampleRate;
    // kayıt dyno'da devirle birlikte gürleşiyor; seviyeyi düzleştirip
    // sesi kendimiz (yük + devir) yönetiyoruz
    const table = (t) => {
      const n = t.rpm.length, step = m.step * sr, s0 = t.start * sr, w = Math.round(0.06 * sr);
      const rms = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const c = Math.round(s0 + i * step);
        let s = 0, k = 0;
        for (let j = Math.max(0, c - w); j < Math.min(data.length, c + w); j += 4) { s += data[j] * data[j]; k++; }
        rms[i] = Math.sqrt(s / Math.max(1, k));
      }
      const sm = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0, k = 0;
        for (let j = Math.max(0, i - 12); j <= Math.min(n - 1, i + 12); j++) { s += rms[j]; k++; }
        sm[i] = s / k;
      }
      return { sm, n, start: t.start, step: m.step, rpm: Float32Array.from(t.rpm) };
    };
    // bir motorun birden çok çekişi (parçası) olabilir
    const arr = (x) => (Array.isArray(x) ? x : [x]);
    const on = arr(m.on).map(table), off = arr(m.off).map(table);
    let refSum = 0, refN = 0;
    for (const t of on) { for (const v of t.sm) refSum += v; refN += t.n; }
    const ref = refSum / Math.max(1, refN);
    for (const t of [...on, ...off]) {
      t.norm = new Float32Array(t.n);
      for (let i = 0; i < t.n; i++) t.norm[i] = clamp((ref / Math.max(1e-4, t.sm[i])) * 0.5, 0.12, 4);
      delete t.sm;
    }
    audio.node.port.postMessage({ type: 'car', data, on, off }, [data.buffer]);
    if (!audio.popsSent) {
      audio.popsSent = true;
      try {
        const [pb, pl] = await Promise.all([fetch('audio/pops.mp3').then((r) => r.arrayBuffer()), fetch('audio/pops.json').then((r) => r.json())]);
        const pbuf = await new Promise((res, rej) => ctx.decodeAudioData(pb, res, rej));
        const pd = new Float32Array(pbuf.getChannelData(0));
        audio.node.port.postMessage({ type: 'pops', data: pd, list: pl }, [pd.buffer]);
      } catch (e) { console.warn('patlamalar yüklenemedi', e); }
    }
    audio.ready = true;
  }

  function blowOff(strength) {
    const ctx = audio.ctx;
    if (!ctx) return;
    const len = Math.round(ctx.sampleRate * 0.55);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(900, t + 0.45);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22 * strength, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(bp).connect(g).connect(audio.comp);
    src.start(t); src.stop(t + 0.56);
  }

  // ---------------------------------------------------------------- sanal araç
  const veh = {
    running: false, v: 0, a: 0, thr: 0, over: 0, gear: 1, rpm: 0, shiftT: 0, shiftKind: 'up', lim: 0,
    startT: 0, peakThr: 0, lastShiftAt: -10, time: 0,
  };

  // 1. viteste kalkış: kalkış devri ile tekerlek devrinin yumuşak maksimumu —
  // devir hiç düz kalmadan sürekli tırmanır, tekerlek devrine yumuşakça bağlanır
  function engineRpm(car, gear, v, thr) {
    const w = wheelRpm(car, gear, v);
    if (gear !== 1) return w;
    const span = car.redline - car.idle;
    const L = car.idle + Math.pow(thr, 1.2) * Math.min(1500, span * 0.3) + v * Math.min(40, span * 0.008);
    return Math.pow(Math.pow(L, 2.5) + Math.pow(w, 2.5), 1 / 2.5);
  }

  // Şehir keyfi: düşük hızda sanal vitesleri kısaltır (40 km/s'de bile motor kaydın
  // en canlı bölgesinde bağırır), etkisi ~110 km/s'ye doğru sönümlenir
  function cityBoost(v) {
    const b = settings.city;
    if (!(b > 1)) return 1;
    return 1 + (b - 1) * clamp(1 - v / 31, 0, 1);
  }
  function wheelRpm(car, gear, v) {
    return (v / car.tire) * 60 * car.ratios[gear - 1] * car.final * cityBoost(v);
  }

  function stepVehicle(dt, v, a) {
    const car = CARS[settings.car];
    veh.time += dt;
    veh.v = v; veh.a = a;

    // gaz tahmini: bu ivmeyi tutturmak için motor ne kadar çalışmalı
    const resist = v > 0.5 ? 0.12 + 0.00042 * v * v : 0;
    const thrRaw = clamp((a + resist) / settings.response, 0, 1);
    const neutralNow = settings.mode === 'test' && sim.brakeIn > 0 && sim.gasIn > 0 && v < 0.6;
    if (!neutralNow) veh.thr += (thrRaw - veh.thr) * Math.min(1, dt * (thrRaw > veh.thr ? 30 : 18));
    const overRaw = a < -0.2 ? clamp((-a - 0.2) / 2.5, 0, 1) : 0;
    veh.over += (overRaw - veh.over) * Math.min(1, dt * 12);
    // boşta gaz (test modu: araç dururken fren + gaz) — varex/aragaz şovu
    const neutral = neutralNow;
    if (neutral) { veh.thr += (sim.gas - veh.thr) * Math.min(1, dt * 20); veh.over = 0; }
    veh.neutral = neutral;

    // turbo boşaltma: sert gazdan ani ayak çekme
    veh.peakThr = Math.max(veh.thr, veh.peakThr - dt * 1.5);
    if (car.turbo && settings.crackle > 0.3 && veh.peakThr > 0.6 && veh.thr < 0.12 && veh.rpm > 3200) { blowOff(veh.peakThr); veh.peakThr = 0; }

    // ---- vites
    const n = car.ratios.length;
    let fuelCut = false, blip = false;
    if (neutral) {
      veh.shiftT = 0; veh.gear = 1;
    } else if (veh.shiftT > 0) {
      veh.shiftT -= dt;
      if (veh.shiftKind === 'up') fuelCut = true; else blip = true;
    } else {
      const r = engineRpm(car, veh.gear, v, veh.thr);
      // sürüş karakteri: vitesin ne zaman atılıp ne zaman küçültüleceği
      // eşikler kırmızı çizgiye oranla: 2300 devirli traktörde de 8500 devirli Ferrari'de de aynı karakter
      const R = car.redline;
      const st = { calm: [0.27, 0.9, 0.15, 0.4, 0.14], sport: [0.36, 0.6, 0.2, 0.46, 0.2], race: [0.6, 0.35, 0.32, 0.48, 0.33] }[settings.style] || [0.36, 0.6, 0.2, 0.46, 0.2];
      const up = lerp(Math.max(st[0] * R, car.idle * 1.6), R - Math.min(250, R * 0.04), Math.pow(veh.thr, st[1]));
      // gazdayken aşağı eşik yukarı eşiğin yarısının altında (vites avlanmaz);
      // frende ise sportif şanzıman gibi erken küçültür (frende büyütme zaten yok)
      const downBase = Math.max(lerp(st[2] * R, R * st[3], veh.thr), car.idle * 1.3 + st[4] * R * veh.over);
      const down = veh.over > 0.2 ? Math.min(downBase, R * 0.55) : Math.min(up * 0.5, downBase);
      // şov arabaları (varex/aragaz) ve Yarış modu: vites atmadan önce kesiciye vurur
      const showOff = (car.show || settings.style === 'race') && veh.thr > 0.5;
      const wantUp = showOff ? r > R - 30 && veh.lim > (car.show ? 0.5 : 0.25) : r > up;
      if (wantUp && veh.gear < n && veh.over < 0.15 && a > -0.35 && veh.time - veh.lastShiftAt > 0.5) {
        veh.gear++; veh.lastShiftAt = veh.time; veh.shiftKind = 'up';
        veh.shiftT = veh.thr > 0.4 ? 0.11 : 0.22;          // tam gazda hızlı, sakin sürüşte yumuşak
        fuelCut = true;
        if (veh.thr > 0.6 && Math.random() < (car.show ? 0.9 : settings.crackle)) sendPop(0.8);
      } else if (veh.gear > 1 && r < down && veh.time - veh.lastShiftAt > 0.5 && wheelRpm(car, veh.gear - 1, v) < car.redline - 500) {
        veh.gear--; veh.lastShiftAt = veh.time; veh.shiftKind = 'down'; veh.shiftT = 0.13; blip = true;
        if (veh.over > 0.2 && Math.random() < (car.show ? 0.9 : settings.crackle * 1.3)) sendPop(0.9);
      }
    }
    if (v < 0.3) veh.gear = 1;
    let target = Math.max(car.idle, wheelRpm(car, veh.gear, v));
    // kalkış: debriyaj kaydırma. Devir hiç düşmeden, gazla orantılı tırmanır;
    // tekerlek devri yetişince ona bağlanır (30-40'ta "takılıp fırlama" olmasın)
    if (veh.gear === 1) target = Math.max(target, engineRpm(car, 1, v, veh.thr));
    // rölanti dalgalanması
    if (target < car.idle * 1.15) target += Math.sin(veh.time * 7.1) * 12 + Math.sin(veh.time * 2.3) * 9;
    if (neutral) target = car.idle + veh.thr * (car.redline + 300 - car.idle);

    // ---- devir kesici: gerçek araçtaki gibi yakıt kes/aç, devir zıplar
    // son viteste kesiciye girmesin (Tesla bu motorun son hızından hızlı gidebilir): devir regülatörde tutulur
    if (veh.gear === n && target > car.redline - 150) target = car.redline - 150 + Math.sin(veh.time * 9) * 25;
    if (target > car.redline - 30 && veh.thr > 0.3) {
      veh.lim += dt;
      const ph = (veh.lim % 0.085) / 0.085;
      if (ph < 0.45) {
        fuelCut = true; target = car.redline - 280;
        if (car.show && !veh.limPop) { veh.limPop = true; if (Math.random() < 0.45) sendPop(0.6); }
      } else veh.limPop = false;
      if (!fuelCut) target = car.redline + 40;
    } else veh.lim = 0;

    // ---- çalıştırma: marş + kısa gaz
    const sinceStart = veh.time - veh.startT;
    let startAmp = 1;
    if (sinceStart < 1.6) {
      const t = sinceStart;
      target = t < 0.35 ? 300 + t * 900 : car.idle + Math.max(0, 1 - (t - 0.35) / 1.2) * 1700 * Math.sin(Math.min(1, (t - 0.35) * 3) * Math.PI / 2);
      startAmp = t < 0.35 ? 0.4 : 1;
    }

    // devir takibi: vites/kesici anlarında çok hızlı, normalde hızlı
    let k = Math.min(1, dt * (veh.shiftT > 0 || veh.lim > 0 ? 34 : 16));
    if (neutral && target < veh.rpm && veh.lim === 0) k = Math.min(1, dt * 4.5);   // boşta devir yavaş düşer
    veh.rpm += (target - veh.rpm) * k;

    // ---- ses
    const rn = clamp((veh.rpm - car.idle) / (car.redline - car.idle), 0, 1);
    let load = sinceStart < 1.6 ? 0.6 : veh.thr;
    if (blip) load = Math.max(load, 0.55);
    // Ayak çekik: aynı kayıtta kalırız (tını değişmesin), sadece yük düşer —
    // ses kısılır ve üst frekanslar (emme/yanma sertliği) yumuşar. Ayrı gazsız
    // kayıttan yalnızca hafif bir doku katılır.
    let lift = clamp(1 - (load - 0.04) / 0.16, 0, 1);
    if (fuelCut) lift = 1;
    const mix = 0;   // ikinci katman yok: aynı kaydın iki kopyası üst üste binince metalik faz sesi yapıyordu
    // hafif gazda kısık ve boğuk, gaza basıldıkça açılan ses (kayıtlar hep tam gaz)
    const onAmp = (0.22 + 0.78 * Math.pow(load, 0.75)) * (0.55 + 0.45 * rn);
    const offAmp = (0.42 + 0.3 * rn) * (0.55 + 0.45 * rn) * (veh.lim > 0 ? 0.85 : 1);
    const amp = settings.volume * lerp(onAmp, offAmp, lift) * startAmp;
    const over = lift > 0.6 && veh.rpm > 2800 && !veh.lim ? Math.max(veh.over, 0.3 * rn) : 0;
    if (audio.node) {
      const crk = car.show ? Math.max(settings.crackle, 0.65) : settings.crackle;
      audio.node.port.postMessage({ type: 'set', rpm: veh.rpm, amp, mix, overrun: over, crackle: crk, popSet: /cargo|kamyon/i.test(car.name) ? 'truck' : 'car' });
      const open = clamp(Math.pow(load, 0.8) * (1 - lift), 0, 1);
      const fc = lerp(2400 + 3200 * rn, 15000, open);
      audio.filter.frequency.setTargetAtTime(fc, audio.ctx.currentTime, veh.lim > 0 ? 0.008 : lift > 0.5 ? 0.04 : 0.02);
    }
  }

  function sendPop(s) { if (audio.node) audio.node.port.postMessage({ type: 'pop', strength: s }); }

  // ---------------------------------------------------------------- test modu (pedallar)
  const sim = { gas: 0, brake: 0, v: 0, a: 0, gasIn: 0, brakeIn: 0 };
  function stepSim(dt) {
    sim.gas += (sim.gasIn - sim.gas) * Math.min(1, dt * 25);
    sim.brake += (sim.brakeIn - sim.brake) * Math.min(1, dt * 25);
    const drag = sim.v > 0.1 ? 0.12 + 0.00042 * sim.v * sim.v : 0;
    const regen = sim.gas < 0.02 && sim.v > 1 ? 0.9 : 0;    // Tesla gibi: ayak çekince rejen
    const power = Math.pow(sim.gas, 1.4) * Math.min(3.4, 700 / Math.max(8, sim.v * 3.6));
    sim.a = power - drag - regen - sim.brake * 7;
    sim.v = Math.max(0, sim.v + sim.a * dt);
    if (sim.v === 0 && sim.a < 0) sim.a = 0;
    return { v: sim.v, a: sim.a };
  }

  // ---------------------------------------------------------------- sensörler (yolda)
  const sens = {
    motion: false, motionSeen: false, gps: false, gpsSpeed: null, gpsAt: 0, gpsAcc: null,
    g: [0, 0, -9.8], hLp: [0, 0, 0], fwd: store.get('fwd', null), gref: store.get('gref', null),
    aF: 0, v: 0, lastT: 0, still: 0, cal: 'none', calSum: [0, 0, 0], calT: 0, goT: 0,
    fixes: [], gpsA: 0, signVotes: 0, bias: 0, lastPos: null,
  };
  if (sens.fwd) sens.cal = 'ok';

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  function onMotion(e) {
    const ag = e.accelerationIncludingGravity;
    if (!ag || ag.x === null) return;
    sens.motionSeen = true;
    const now = performance.now() / 1000;
    const dt = sens.lastT ? clamp(now - sens.lastT, 0.001, 0.1) : 0.016;
    sens.lastT = now;
    const raw = [ag.x, ag.y, ag.z];
    const kg = Math.min(1, dt / 1.2);
    for (let i = 0; i < 3; i++) sens.g[i] += (raw[i] - sens.g[i]) * kg;
    let lin;
    const la = e.acceleration;
    if (la && la.x !== null) lin = [la.x, la.y, la.z];
    else lin = [raw[0] - sens.g[0], raw[1] - sens.g[1], raw[2] - sens.g[2]];
    const gh = norm3(sens.g);
    const vert = dot(lin, gh);
    const h = [lin[0] - vert * gh[0], lin[1] - vert * gh[1], lin[2] - vert * gh[2]];
    const kh = Math.min(1, dt / 0.05);
    for (let i = 0; i < 3; i++) sens.hLp[i] += (h[i] - sens.hLp[i]) * kh;
    const mag = Math.hypot(sens.hLp[0], sens.hLp[1], sens.hLp[2]);

    // duruyor mu?
    const gpsStill = sens.gpsSpeed === null || sens.gpsSpeed < 0.6;
    if (mag < 0.22 && gpsStill) sens.still += dt; else sens.still = 0;

    // telefon yerinden oynadı mı? (yerçekimi yönü 18°'den fazla değiştiyse yeniden kalibre)
    if (sens.cal === 'ok' && sens.gref && sens.still > 1.5 && dot(gh, sens.gref) < Math.cos((18 * Math.PI) / 180)) {
      sens.cal = 'still'; sens.fwd = null;
    }

    calibrate(dt, mag, gh);

    if (sens.fwd) {
      let a = dot(sens.hLp, sens.fwd);
      if (sens.still > 0.8) sens.bias += (a - sens.bias) * Math.min(1, dt * 2);
      a -= sens.bias;
      sens.aF = a;
      sens.v = Math.max(0, sens.v + a * dt);
    }
    if (sens.still > 1.2) sens.v = 0;
  }

  function calibrate(dt, mag, gh) {
    if (sens.cal === 'ok' || sens.cal === 'none') return;
    if (sens.cal === 'still') {
      if (sens.still > 1.0) { sens.cal = 'go'; sens.goT = 0; sens.calT = 0; sens.calSum = [0, 0, 0]; }
      return;
    }
    if (sens.cal === 'go') {
      if (mag > 0.9) {
        sens.goT += dt;
        for (let i = 0; i < 3; i++) sens.calSum[i] += sens.hLp[i] * dt;
        if (sens.goT > 0.9) {
          sens.fwd = norm3(sens.calSum);
          sens.gref = gh;
          store.set('fwd', sens.fwd); store.set('gref', sens.gref);
          sens.cal = 'ok'; sens.signVotes = 0;
          toast('Kalibrasyon tamam. İleri yön öğrenildi.');
        }
      } else if (sens.goT > 0) {
        sens.goT = Math.max(0, sens.goT - dt * 2);
        if (sens.goT === 0) sens.calSum = [0, 0, 0];
      }
    }
  }

  function onPosition(pos) {
    const c = pos.coords;
    const now = performance.now() / 1000;
    sens.gps = true;
    sens.gpsAcc = c.accuracy;
    // Tesla tarayıcısı aynı konumu tekrar tekrar gönderebiliyor: kopyaları at
    const key = c.latitude + ',' + c.longitude + ',' + c.speed;
    if (key === sens.lastKey && now - (sens.lastKeyAt || 0) < 1.5) return;
    sens.lastKey = key; sens.lastKeyAt = now;
    // konum sıklığı (Tesla ~10 Hz, telefon ~1 Hz)
    if (sens.lastFixAt) sens.fixInt = sens.fixInt ? sens.fixInt * 0.8 + (now - sens.lastFixAt) * 0.2 : now - sens.lastFixAt;
    sens.lastFixAt = now;
    let sp = typeof c.speed === 'number' && c.speed >= 0 && !Number.isNaN(c.speed) ? c.speed : null;
    if (sp === null) {
      // hız alanı yoksa konumdan hesapla (en az 0.4 sn aralıkla, gürültü az olsun)
      const p = sens.lastPos;
      if (!p) { sens.lastPos = { lat: c.latitude, lon: c.longitude, t: now }; return; }
      const dtp = now - p.t;
      if (dtp < 0.4) return;
      if (c.accuracy < 30) {
        const R = 6371000, rad = Math.PI / 180;
        const dLat = (c.latitude - p.lat) * rad, dLon = (c.longitude - p.lon) * rad;
        const q = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * rad) * Math.cos(c.latitude * rad) * Math.sin(dLon / 2) ** 2;
        sp = (2 * R * Math.asin(Math.min(1, Math.sqrt(q)))) / dtp;
        sp = sens.gpsSpeed === null ? sp : sens.gpsSpeed * 0.4 + sp * 0.6;
      }
      sens.lastPos = { lat: c.latitude, lon: c.longitude, t: now };
      if (sp === null) return;
    }
    if (sp < 0.4) sp = 0;
    sens.gpsSpeed = sp; sens.gpsAt = now;
    sens.fixes.push({ t: now, v: sp });
    // ivme penceresi: ~7 ölçüm (Tesla'da ~0.7 sn: hızlı tepki; telefonda ~2 sn: sakin)
    const win = clamp(7 * (sens.fixInt || 1), 0.5, 2.2);
    while (sens.fixes.length && now - sens.fixes[0].t > win) sens.fixes.shift();
    const f = sens.fixes;
    if (f.length >= 3) {
      let st = 0, sv = 0, stt = 0, stv = 0;
      for (const x of f) { const t = x.t - now; st += t; sv += x.v; stt += t * t; stv += t * x.v; }
      const n = f.length, den = n * stt - st * st;
      const aFit = den > 1e-6 ? (n * stv - st * sv) / den : 0;
      sens.gpsA = sp === 0 && aFit < 0.3 ? 0 : clamp(aFit, -9, 7);
    }
    // hız füzyonu
    if (sens.fwd && sens.motionSeen) sens.v += (sp - sens.v) * 0.35;
    else sens.v = sp;
    // ileri yön işaret kontrolü: GPS belirgin hızlanırken ivmeölçer ters diyorsa çevir
    if (sens.fwd && Math.abs(sens.gpsA) > 1.0 && Math.abs(sens.aF) > 0.7) {
      sens.signVotes += Math.sign(sens.gpsA) === Math.sign(sens.aF) ? 1 : -1;
      if (sens.signVotes < -4) {
        sens.fwd = sens.fwd.map((x) => -x); store.set('fwd', sens.fwd); sens.signVotes = 0; sens.aF = -sens.aF;
      }
      sens.signVotes = clamp(sens.signVotes, -6, 6);
    }
  }

  let geoWatch = null;
  async function startSensors() {
    // iOS: hareket izni bir dokunuşun içinde istenmeli
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const r = await DeviceMotionEvent.requestPermission();
        sens.motion = r === 'granted';
      } catch { sens.motion = false; }
    } else {
      sens.motion = typeof DeviceMotionEvent !== 'undefined';
    }
    if (sens.motion) window.addEventListener('devicemotion', onMotion);
    if (!sens.fwd) sens.cal = 'still';
    if ('geolocation' in navigator) {
      geoWatch = navigator.geolocation.watchPosition(onPosition, (err) => {
        if (err.code === 1) { sens.gps = false; toast('Konum izni verilmedi. Hız sadece sensörden tahmin edilecek.'); }
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    }
  }
  function stopSensors() {
    window.removeEventListener('devicemotion', onMotion);
    if (geoWatch !== null) navigator.geolocation.clearWatch(geoWatch);
    geoWatch = null;
  }

  function sensorInput(dt) {
    const now = performance.now() / 1000;
    const motionOk = sens.motionSeen && sens.fwd;
    const gpsFresh = sens.gpsAt && now - sens.gpsAt < 3;
    if (motionOk) return { v: sens.v, a: sens.aF };
    if (gpsFresh) {
      // sadece GPS: son ölçümden ivmeyle ileri tahmin
      const v = Math.max(0, sens.gpsSpeed + sens.gpsA * Math.min(0.6, now - sens.gpsAt));
      return { v, a: sens.gpsA };
    }
    return { v: 0, a: 0 };
  }

  // ---------------------------------------------------------------- döngü
  // fizik ve ses 125 Hz'de, çizimden bağımsız (ekran çizmese de ses tepki verir)
  let lastTick = 0, loopOn = false, lastInp = { v: 0, a: 0 };
  function tick() {
    const now = performance.now();
    const dt = lastTick ? clamp((now - lastTick) / 1000, 0.001, 0.05) : 0.008;
    lastTick = now;
    lastInp = settings.mode === 'test' ? stepSim(dt) : sensorInput(dt);
    if (veh.running) stepVehicle(dt, lastInp.v, lastInp.a);
  }
  function frame() {
    if (!loopOn) return;
    draw(lastInp);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- arayüz
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && veh.running) keepAwake();
  });

  async function start() {
    const btn = $('start');
    btn.disabled = true;
    btn.textContent = 'Hazırlanıyor…';
    try {
      // izinler aynı dokunuşta istenmeli (iOS)
      const sensorsP = settings.mode === 'drive' ? startSensors() : Promise.resolve();
      await initAudio();
      await sensorsP;
      await loadCar(settings.car);
      veh.running = true; veh.startT = veh.time; veh.gear = 1; veh.rpm = 0; veh.thr = 0;
      audio.master.gain.setTargetAtTime(1, audio.ctx.currentTime, 0.05);
      keepAwake();
      document.body.dataset.running = '1';
      btn.textContent = 'Motoru durdur';
    } catch (err) {
      console.error(err);
      toast('Başlatılamadı: ' + (err && err.message ? err.message : err));
      btn.textContent = 'Motoru çalıştır';
    }
    btn.disabled = false;
  }

  function stop() {
    veh.running = false;
    if (audio.master) audio.master.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.12);
    stopSensors();
    try { wakeLock && wakeLock.release(); } catch {}
    document.body.dataset.running = '0';
    $('start').textContent = 'Motoru çalıştır';
  }

  async function selectCar(id) {
    settings.car = id; store.set('car', id);
    renderCars();
    if (audio.ctx && veh.running) {
      audio.master.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05);
      await loadCar(id);
      veh.startT = veh.time; veh.rpm = 0;
      audio.master.gain.setTargetAtTime(1, audio.ctx.currentTime, 0.05);
    }
  }

  function renderCars() {
    const wrap = $('cars');
    // kategori: id -> grup; bilinmeyen id "Diğer"e düşer
    const CAT_OF = { supra: 'Spor', frs: 'Spor', gtsc: 'Spor', m3: 'Spor', vtec: 'Spor', p911: 'Spor', ferrari: 'Egzotik', dubai: 'Egzotik', race: 'Egzotik', v8: 'Klasik & Kas', camaro: 'Klasik & Kas', t3: 'Klasik & Kas', kamyon: 'İş & Ağır vasıta', traktor: 'İş & Ağır vasıta', otobus: 'İş & Ağır vasıta', harley: 'İki teker' };
    const CAT_ORDER = ['Özel', 'Senin seslerin', 'Spor', 'Egzotik', 'Klasik & Kas', 'İş & Ağır vasıta', 'İki teker', 'Diğer'];
    const saved = {};
    for (const s of wrap.querySelectorAll('.car-strip')) saved[s.dataset.cat] = s.scrollLeft;
    const groups = {};
    wrap.innerHTML = '';
    for (const [id, c] of Object.entries(CARS)) {
      const b = document.createElement('button');
      b.className = 'car';
      b.type = 'button';
      b.setAttribute('aria-pressed', id === settings.car ? 'true' : 'false');
      const mo = audio.maps && audio.maps[id] && audio.maps[id].on;
      const maps = mo && (Array.isArray(mo) ? { rpm: [Math.min(...mo.map((p) => p.rpm[0])), Math.max(...mo.map((p) => p.rpm[p.rpm.length - 1]))] } : mo);
      const lo = maps ? Math.round(maps.rpm[0] / 100) * 100 : c.idle, hi = maps ? Math.round(maps.rpm[maps.rpm.length - 1] / 100) * 100 : c.redline;
      const range = `${lo}–${hi} rpm`;
      // karakter etiketleri: mevcut alanlardan türetilir, bilinmeyen araç da düzgün görünür
      const sp = (c.spec || '').toLocaleLowerCase('tr'), tags = [];
      if (c.turbo) tags.push('Turbo');
      else if (/kompres|supercharg/.test(sp)) tags.push('Kompresör');
      else if (/atmosferik/.test(sp)) tags.push('Atmosferik');
      if (c.redline >= 8000) tags.push('Yüksek devir');
      else if (/v8|big-block/.test(sp + ' ' + c.name.toLocaleLowerCase('tr'))) tags.push('V8');
      else if (/v6/.test(sp)) tags.push('V6');
      else if (/boxer/.test(sp)) tags.push('Boxer');
      const hues = { supra: 22, frs: 205, gtsc: 168, ferrari: 4, m3: 222, vtec: 345, v8: 42 };
      let hue = hues[id];
      if (hue === undefined) { hue = 0; for (const ch of id) hue = (hue * 31 + ch.charCodeAt(0)) % 360; }
      b.style.setProperty('--h', hue);
      b.innerHTML = `<span class="car-name"></span><span class="car-spec"></span><span class="car-tags"></span><span class="car-rng"><span class="car-rng-bar"><i></i></span><span class="car-src"></span></span>`;
      b.querySelector('.car-name').textContent = c.name;
      b.querySelector('.car-spec').textContent = c.spec;
      for (const t of tags.slice(0, 2)) { const s = document.createElement('span'); s.className = 'car-tag'; s.textContent = t; b.querySelector('.car-tags').appendChild(s); }
      const fill = b.querySelector('.car-rng-bar i');
      fill.style.left = (lo / 10000 * 100).toFixed(1) + '%';
      fill.style.width = Math.max(4, (hi - lo) / 10000 * 100).toFixed(1) + '%';
      b.querySelector('.car-src').textContent = 'Gerçek kayıt · ' + range;
      b.addEventListener('click', () => selectCar(id));
      const cat = c.custom ? 'Senin seslerin' : c.ozel ? 'Özel' : (CAT_OF[id] || 'Diğer');
      if (c.custom) {
        b.style.position = 'relative';
        const del = document.createElement('span');
        del.className = 'car-del'; del.textContent = 'Sil'; del.setAttribute('role', 'button'); del.tabIndex = 0;
        del.addEventListener('click', (e) => { e.stopPropagation(); removeCustom(id); });
        b.appendChild(del);
      }
      (groups[cat] = groups[cat] || []).push(b);
    }
    const cats = CAT_ORDER.filter((k) => groups[k]);
    let filt = '';
    try { filt = localStorage.getItem('kukreme.carcat') || ''; } catch {}
    if (filt && !groups[filt]) filt = '';
    let bar = $('car-filter');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'car-filter'; bar.className = 'car-filter'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Motor kategorisi');
      wrap.parentNode.insertBefore(bar, wrap);
    }
    bar.innerHTML = '';
    const total = Object.values(groups).reduce((n, a) => n + a.length, 0);
    for (const k of ['', ...cats]) {
      const f = document.createElement('button');
      f.type = 'button'; f.className = 'car-fchip';
      f.setAttribute('aria-pressed', k === filt ? 'true' : 'false');
      f.innerHTML = '<span></span><em></em>';
      f.firstChild.textContent = k || 'Hepsi';
      f.lastChild.textContent = k ? groups[k].length : total;
      f.addEventListener('click', () => { try { localStorage.setItem('kukreme.carcat', k); } catch {} renderCars(); });
      bar.appendChild(f);
    }
    for (const k of cats) {
      if (filt && k !== filt) continue;
      const sec = document.createElement('div');
      sec.className = 'car-group';
      const h = document.createElement('div');
      h.className = 'car-group-h';
      h.textContent = k;
      const strip = document.createElement('div');
      strip.className = 'car-strip'; strip.dataset.cat = k;
      for (const b of groups[k]) strip.appendChild(b);
      sec.append(h, strip);
      wrap.appendChild(sec);
      if (saved[k]) strip.scrollLeft = saved[k];
    }
  }

  function setMode(m) {
    settings.mode = m; store.set('mode', m);
    document.body.dataset.mode = m;
    for (const b of document.querySelectorAll('[data-setmode]')) b.setAttribute('aria-pressed', b.dataset.setmode === m ? 'true' : 'false');
    if (veh.running && m === 'drive') startSensors();
    sim.v = 0; sim.gasIn = 0; sim.brakeIn = 0;
  }

  let toastT = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 4200);
  }

  // kademeli pedal: parmağın pedalın ne kadar yukarısında, o kadar basılı (alt kenar %25, üst kenar %100)
  function bindPedal(el, key) {
    let down = false;
    const level = (e) => {
      const r = el.getBoundingClientRect();
      return clamp(1 - (e.clientY - r.top) / r.height, 0, 1) * 0.75 + 0.25;
    };
    const setLv = (v) => { sim[key] = v; el.style.setProperty('--lv', v); el.dataset.on = v > 0 ? '1' : '0'; };
    const on = (e) => { e.preventDefault(); down = true; setLv(level(e)); try { el.setPointerCapture(e.pointerId); } catch {} };
    const move = (e) => { if (down) setLv(level(e)); };
    const off = () => { down = false; setLv(0); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
  }

  function bindRange(id, key, fmt) {
    const el = $(id), out = $(id + '-out');
    el.value = settings[key];
    const show = () => { out.textContent = fmt(settings[key]); };
    el.addEventListener('input', () => { settings[key] = parseFloat(el.value); store.set(key === 'crackle' ? 'crackle2' : key === 'city' ? 'city2' : key, settings[key]); show(); });
    show();
  }

  // ---------------------------------------------------------------- gösterge
  const cv = $('gauge');
  const g2 = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();

  function sizeCanvas() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    sizeCanvas.dpr = dpr;
  }
  window.addEventListener('resize', sizeCanvas);

  function draw(inp) {
    const car = CARS[settings.car];
    const W = cv.clientWidth, H = cv.clientHeight;
    if (W < 2 || H < 2) return;
    if (cv.width !== Math.round(W * (sizeCanvas.dpr || 1)) || cv.height !== Math.round(H * (sizeCanvas.dpr || 1))) sizeCanvas();
    g2.clearRect(0, 0, W, H);
    const DISP = "'Saira Condensed', 'Arial Narrow', sans-serif", BODY = "'Manrope', system-ui, sans-serif";
    const R = Math.min(W * 0.46, H / 1.8), cx = W / 2, cy = H / 2 + R * 0.15;
    const maxK = Math.ceil(car.redline / 1000) + 1;
    const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22;
    const ang = (r) => a0 + (a1 - a0) * clamp(r / (maxK * 1000), 0, 1);
    const line = col('--line'), muted = col('--muted'), fg = col('--fg'), amber = col('--accent'), red = col('--red'), blue = col('--blue'), bg = col('--bg'), p2 = col('--panel-2');
    const nowMs = performance.now();

    // ekranda görünen devir: ibre yumuşak takip eder (gerçek devir ses için ayrı kalır)
    const dtd = draw._t ? Math.min(0.1, (nowMs - draw._t) / 1000) : 0.016;
    draw._t = nowMs;
    const rpmReal = veh.running ? veh.rpm : 0;
    draw._n = (draw._n || 0) + (rpmReal - (draw._n || 0)) * (1 - Math.exp(-dtd * 20));
    const rpm = Math.max(0, draw._n);

    // devir kesiciye yakın mı? (ikaz ışıkları + kırmızı ışıma)
    const warnStart = car.redline - 1600;
    const near = veh.running ? clamp((veh.rpm - warnStart) / (car.redline - 150 - warnStart), 0, 1) : 0;
    const blink = near >= 1 && Math.floor(nowMs / 70) % 2 === 0;

    // kadran yüzü
    const lw = Math.max(7, R * 0.055);
    const face = () => { g2.beginPath(); g2.arc(cx, cy, R + lw * 0.9, a0 - 0.12, a1 + 0.12); g2.closePath(); };
    const fgrad = g2.createRadialGradient(cx, cy - R * 0.25, R * 0.1, cx, cy, R * 1.15);
    fgrad.addColorStop(0, '#16203a'); fgrad.addColorStop(0.55, '#0c1220'); fgrad.addColorStop(1, bg);
    g2.fillStyle = fgrad; face(); g2.fill();
    g2.strokeStyle = line; g2.lineWidth = 1.5; face(); g2.stroke();
    if (blink) { g2.fillStyle = 'rgba(255,77,58,0.16)'; face(); g2.fill(); }

    // dış yay: parçalı (LED şerit gibi) çizilir
    const arcLen = (a1 - a0) * R;
    const dashN = Math.round(arcLen / (R * 0.045)), dash = arcLen / dashN;
    g2.lineCap = 'butt';
    g2.lineWidth = lw;
    g2.setLineDash([dash * 0.78, dash * 0.22]);
    g2.strokeStyle = p2;
    g2.beginPath(); g2.arc(cx, cy, R, a0, a1); g2.stroke();
    // kırmızı bölge
    g2.strokeStyle = red; g2.globalAlpha = 0.55;
    g2.beginPath(); g2.arc(cx, cy, R, ang(car.redline), a1); g2.stroke();
    g2.globalAlpha = 1;
    // dolu kısım
    if (rpm > 20) {
      g2.strokeStyle = rpm > car.redline - 200 ? red : amber;
      g2.beginPath(); g2.arc(cx, cy, R, a0, ang(Math.min(rpm, maxK * 1000))); g2.stroke();
    }
    g2.setLineDash([]);
    // ibre izi: ibrenin arkasında kısa süre kalan yumuşak şerit (yükselirken ve düşerken)
    draw._tr = (draw._tr || 0) + (rpm - (draw._tr || 0)) * (1 - Math.exp(-dtd * 5));
    if (Math.abs(draw._tr - rpm) > 40) {
      const ta = ang(Math.min(draw._tr, maxK * 1000)), tb = ang(Math.min(rpm, maxK * 1000));
      g2.strokeStyle = 'rgba(255,174,43,0.28)'; g2.lineWidth = lw * 0.45;
      g2.beginPath(); g2.arc(cx, cy, R - lw * 1.15, Math.min(ta, tb), Math.max(ta, tb)); g2.stroke();
    }

    // çentikler + rakamlar
    g2.font = `700 ${Math.round(R * 0.12)}px ${DISP}`;
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    for (let k = 0; k <= maxK; k++) {
      for (let h = 0; h < (k < maxK ? 2 : 1); h++) {
        const r = k * 1000 + h * 500;
        const t = ang(r);
        const r1 = R - lw * 0.75, r2 = r1 - (h ? R * 0.035 : R * 0.07);
        g2.strokeStyle = r >= car.redline ? red : muted;
        g2.lineWidth = h ? 1.2 : 2.2;
        g2.beginPath(); g2.moveTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1); g2.lineTo(cx + Math.cos(t) * r2, cy + Math.sin(t) * r2); g2.stroke();
        if (!h) { g2.fillStyle = r >= car.redline ? red : muted; g2.fillText(String(k), cx + Math.cos(t) * (R * 0.76), cy + Math.sin(t) * (R * 0.76)); }
      }
    }

    // ibre: sivri, amber; ortada vitesi kapatmaz (dış halkada)
    const t = ang(Math.min(rpm, maxK * 1000));
    const ca = Math.cos(t), sa = Math.sin(t), nx = -sa, ny = ca;
    const n0 = R * 0.66, n1 = R * 0.99, hw = Math.max(2.2, R * 0.024);
    g2.fillStyle = amber;
    g2.beginPath();
    g2.moveTo(cx + ca * n1, cy + sa * n1);
    g2.lineTo(cx + ca * n0 + nx * hw, cy + sa * n0 + ny * hw);
    g2.lineTo(cx + ca * n0 - nx * hw, cy + sa * n0 - ny * hw);
    g2.closePath(); g2.fill();
    // ibrenin kök noktasına küçük bir sıcak nokta
    g2.fillStyle = '#fff3d6';
    g2.beginPath(); g2.arc(cx + ca * (n0 + (n1 - n0) * 0.1), cy + sa * (n0 + (n1 - n0) * 0.1), hw * 0.9, 0, Math.PI * 2); g2.fill();

    // vites değişim ışıkları (üstte 11 geniş segment): 1-6 amber, 7-11 kırmızı, limitte hepsi yanıp söner
    const nL = 11, lwid = R * 0.075, lgap = R * 0.02, rowW = nL * lwid + (nL - 1) * lgap, ly = cy - R * 0.47, lh = R * 0.06;
    const lit = Math.ceil(near * nL - 1e-6);
    for (let i = 0; i < nL; i++) {
      const on = near >= 1 ? blink : i < lit;
      g2.fillStyle = on ? (i >= 6 || near >= 1 ? red : amber) : '#18213a';
      const x = cx - rowW / 2 + i * (lwid + lgap);
      g2.beginPath();
      if (g2.roundRect) g2.roundRect(x, ly - lh / 2, lwid, lh, R * 0.015); else g2.rect(x, ly - lh / 2, lwid, lh);
      g2.fill();
    }

    // araç adı (üstte, harf aralıklı)
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.font = `700 ${Math.round(R * 0.095)}px ${DISP}`;
    if ('letterSpacing' in g2) g2.letterSpacing = Math.round(R * 0.014) + 'px';
    g2.fillStyle = veh.running ? fg : muted;
    g2.fillText(car.name.toLocaleUpperCase('tr'), cx, cy - R * 0.6, R * 1.1);
    if ('letterSpacing' in g2) g2.letterSpacing = '0px';

    // hız (kokpitin en büyük yazısı)
    const spd = Math.round(inp.v * 3.6);
    g2.font = `800 ${Math.round(R * 0.56)}px ${DISP}`;
    g2.fillStyle = veh.running ? fg : muted;
    g2.fillText(String(spd), cx, cy + R * 0.06);
    g2.font = `700 ${Math.round(R * 0.08)}px ${BODY}`;
    g2.fillStyle = muted;
    if ('letterSpacing' in g2) g2.letterSpacing = Math.round(R * 0.02) + 'px';
    g2.fillText('KM/SA', cx, cy + R * 0.36);
    if ('letterSpacing' in g2) g2.letterSpacing = '0px';
    // rejen göstergesi (mavi): ayak çekince/fren yapınca
    if (veh.running && veh.over > 0.12) {
      g2.globalAlpha = clamp(veh.over * 2, 0.35, 1);
      g2.fillStyle = blue;
      g2.font = `800 ${Math.round(R * 0.075)}px ${BODY}`;
      g2.fillText('REJEN', cx, cy + R * 0.48);
      g2.globalAlpha = 1;
    }

    // alt sıra: solda vites kutusu, sağda dijital devir
    const isN = veh.running && inp.v < 0.3 && veh.thr < 0.05;
    const shifting = veh.running && veh.shiftT > 0;
    const bs = R * 0.27, bx = cx - R * 0.3 - bs / 2, by = cy + R * 0.62 - bs / 2;
    g2.fillStyle = shifting ? 'rgba(255,174,43,0.22)' : 'rgba(255,255,255,0.03)';
    g2.strokeStyle = shifting ? amber : col('--line-2'); g2.lineWidth = 1.5;
    g2.beginPath();
    if (g2.roundRect) g2.roundRect(bx, by, bs, bs, R * 0.04); else g2.rect(bx, by, bs, bs);
    g2.fill(); g2.stroke();
    g2.font = `800 ${Math.round(R * 0.25)}px ${DISP}`;
    g2.fillStyle = shifting ? amber : (veh.running ? (isN ? muted : fg) : p2);
    g2.fillText(veh.running && !isN ? String(veh.gear) : 'N', cx - R * 0.3, cy + R * 0.635);
    g2.font = `700 ${Math.round(R * 0.055)}px ${BODY}`;
    g2.fillStyle = muted;
    g2.fillText('VİTES', cx - R * 0.3, by - R * 0.05);
    // dijital devir (sağa hizalı sayı: rakamlar oynarken kaymasın)
    g2.textBaseline = 'alphabetic';
    g2.font = `700 ${Math.round(R * 0.2)}px ${DISP}`;
    g2.fillStyle = near >= 1 ? red : (veh.running ? fg : muted);
    g2.textAlign = 'right';
    g2.fillText(String(Math.round(rpm / 10) * 10), cx + R * 0.42, cy + R * 0.7);
    g2.textAlign = 'left';
    g2.font = `700 ${Math.round(R * 0.06)}px ${BODY}`;
    g2.fillStyle = muted;
    g2.fillText('rpm', cx + R * 0.45, cy + R * 0.7);

    // pedallar
    $('thr-bar').style.transform = `scaleX(${veh.running ? veh.thr : 0})`;
    $('brk-bar').style.transform = `scaleX(${veh.running ? veh.over : 0})`;
    void blue;

    // durum çipleri
    if (settings.mode === 'drive') {
      chip('chip-motion', sens.motionSeen ? 'ok' : sens.motion ? 'wait' : 'off', sens.motionSeen ? 'İvmeölçer açık' : sens.motion ? 'İvmeölçer bekleniyor' : 'İvmeölçer yok');
      const now = performance.now() / 1000;
      const fresh = sens.gpsAt && now - sens.gpsAt < 3;
      chip('chip-gps', fresh ? 'ok' : sens.gps ? 'wait' : 'off', fresh ? `GPS ±${Math.round(sens.gpsAcc || 0)} m` : 'GPS bekleniyor');
      const calTxt = !sens.motionSeen ? 'GPS modu' : { ok: 'Kalibre', still: 'Kalibrasyon: dur', go: 'Kalibrasyon: gaz ver', none: 'Kalibre değil' }[sens.cal];
      chip('chip-cal', sens.cal === 'ok' ? 'ok' : sens.motionSeen ? 'wait' : 'off', calTxt);
      const banner = $('cal-banner');
      const showBanner = veh.running && sens.motionSeen && (sens.cal === 'still' || sens.cal === 'go');
      banner.hidden = !showBanner;
      if (showBanner) $('cal-text').textContent = sens.cal === 'still'
        ? 'Telefonu tutucuya sabitle ve aracı durdur. Bir saniye bekle.'
        : 'Şimdi düz yolda 1–2 saniye net bir şekilde gaza bas. İleri yönü öğreniyorum.';
    }
  }
  function chip(id, state, text) {
    const el = $(id);
    if (el.dataset.state !== state) el.dataset.state = state;
    if (el.textContent !== text) el.textContent = text;
  }

  // ---------------------------------------------------------------- kurulum
  // ---------------------------------------------------------------- kendi sesin
  const ownBase = { ratios: [3.36, 2.27, 1.68, 1.33, 1.08, 0.9], final: 3.9, tire: 2.0, idle: 900, turbo: false };
  function registerCustom(rec) {
    const redline = clamp(Math.round(rec.hi / 100) * 100, 4500, 9500);
    CARS[rec.id] = Object.assign({}, ownBase, {
      name: rec.name, spec: rec.found ? `Senin sesin · ${rec.segments} gaz çekişi` : 'Senin sesin · sabit ses',
      file: URL.createObjectURL(new Blob([rec.audio])), redline, custom: true,
      idle: Math.min(900, Math.round(rec.lo * 0.45)),
    });
    if (audio.maps) audio.maps[rec.id] = rec.map;
  }
  // özel klasör: sadece Berk'in kendi kullanımı için eklenen sesler (herkese açık yayına girmez)
  async function loadOzel() {
    try {
      const r = await fetch('ozel/ozel.json', { cache: 'no-cache' });
      if (!r.ok) return;
      const list = await r.json();
      await loadMaps();
      for (const [id, o] of Object.entries(list)) {
        CARS[id] = Object.assign({ ozel: true }, o.car);
        audio.maps[id] = o.map;
      }
    } catch {}
  }
  async function loadCustom() {
    await loadOzel();
    if (!window.KukremeCustom) { renderCars(); return; }
    try {
      await loadMaps();
      const recs = await window.KukremeCustom.list();
      recs.sort((p, q) => p.created - q.created).forEach(registerCustom);
      const want = store.get('car', null);
      if (want && CARS[want] && settings.car !== want) settings.car = want;
      renderCars();
    } catch (e) { console.warn('özel sesler yüklenemedi', e); }
  }
  async function addCustomFile(file) {
    if (!file || !window.KukremeCustom) return;
    const btn = $('add-own-btn'), hint = $('add-own-hint');
    btn.disabled = true; btn.textContent = 'Analiz ediliyor…';
    try {
      const audioBuf = await file.arrayBuffer();
      const res = await window.KukremeCustom.analyze(audioBuf);
      const name = (file.name || 'Benim motorum').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 32) || 'Benim motorum';
      const rec = { id: 'u_' + Date.now().toString(36), name, audio: audioBuf, map: res.map, lo: res.lo, hi: res.hi, found: res.found, segments: res.segments, created: Date.now() };
      await loadMaps();
      await window.KukremeCustom.save(rec);
      registerCustom(rec);
      await selectCar(rec.id);
      toast(res.found
        ? `${name} eklendi: ${res.segments} gaz çekişi bulundu (${Math.round(res.lo / 100) * 100}–${Math.round(res.hi / 100) * 100} rpm).`
        : `${name} eklendi ama devrin yükseldiği yer bulunamadı; sabit ses olarak çalacak. İçinde gaz verilen bir kayıt daha iyi olur.`);
    } catch (e) {
      console.error(e);
      toast('Bu dosya okunamadı: ' + (e && e.message ? e.message : 'bilinmeyen hata'));
    }
    btn.disabled = false; btn.textContent = '+ Kendi sesini ekle';
    void hint;
  }
  async function removeCustom(id) {
    try { await window.KukremeCustom.remove(id); } catch {}
    try { URL.revokeObjectURL(CARS[id].file); } catch {}
    delete CARS[id]; delete audio.buffers[id]; if (audio.maps) delete audio.maps[id];
    if (settings.car === id) await selectCar('supra'); else renderCars();
    toast('Silindi.');
  }
  // A/B: seçili motorun işlenmemiş ham kaydını çal
  let rawEl = null;
  function bindRaw() {
    const btn = $('raw-play');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (rawEl && !rawEl.paused) { rawEl.pause(); btn.textContent = 'Ham kaydı dinle'; return; }
      if (veh.running) stop();
      rawEl = new Audio(CARS[settings.car].file);
      rawEl.volume = Math.min(1, settings.volume);
      rawEl.onended = () => { btn.textContent = 'Ham kaydı dinle'; };
      rawEl.play().then(() => { btn.textContent = 'Durdur'; }).catch(() => toast('Ham kayıt çalınamadı.'));
    });
  }

  function bindCustomUi() {
    const box = $('add-own'), input = $('add-own-file');
    if (!box) return;
    $('add-own-btn').addEventListener('click', () => input.click());
    input.addEventListener('change', () => { addCustomFile(input.files[0]); input.value = ''; });
    box.addEventListener('dragover', (e) => { e.preventDefault(); box.dataset.drag = '1'; });
    box.addEventListener('dragleave', () => { box.dataset.drag = '0'; });
    box.addEventListener('drop', (e) => { e.preventDefault(); box.dataset.drag = '0'; addCustomFile(e.dataTransfer.files[0]); });
  }

  function boot() {
    document.body.dataset.mode = settings.mode;
    for (const b of document.querySelectorAll('[data-setmode]')) b.addEventListener('click', () => setMode(b.dataset.setmode));
    setMode(settings.mode);
    $('start').addEventListener('click', () => (veh.running ? stop() : start()));
    bindPedal($('pedal-gas'), 'gasIn');
    bindPedal($('pedal-brake'), 'brakeIn');
    window.addEventListener('keydown', (e) => {
      if (settings.mode !== 'test' || e.repeat) return;
      const half = e.shiftKey ? 0.45 : 1;   // Shift ile yarım gaz/fren
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { sim.gasIn = half; $('pedal-gas').style.setProperty('--lv', half); $('pedal-gas').dataset.on = '1'; e.preventDefault(); }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S' || e.key === ' ') { sim.brakeIn = half; $('pedal-brake').style.setProperty('--lv', half); $('pedal-brake').dataset.on = '1'; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { sim.gasIn = 0; $('pedal-gas').style.setProperty('--lv', 0); $('pedal-gas').dataset.on = '0'; }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S' || e.key === ' ') { sim.brakeIn = 0; $('pedal-brake').style.setProperty('--lv', 0); $('pedal-brake').dataset.on = '0'; }
    });
    bindRange('volume', 'volume', (v) => Math.round(v * 100) + '%');
    bindRange('response', 'response', (v) => (v < 2 ? 'Hassas' : v < 3.4 ? 'Normal' : 'Sert') + ` · ${v.toFixed(1)} m/s²`);
    bindRange('crackle', 'crackle', (v) => (v < 0.05 ? 'Kapalı' : Math.round(v * 100) + '%'));
    bindRange('city', 'city', (v) => (v < 1.05 ? 'Kapalı' : v < 1.5 ? 'Hafif' : v < 2.0 ? 'Canlı' : 'Bağırsın'));
    const styleBtns = document.querySelectorAll('[data-style]');
    const showStyle = () => styleBtns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === settings.style ? 'true' : 'false'));
    styleBtns.forEach((b) => b.addEventListener('click', () => { settings.style = b.dataset.style; store.set('style', settings.style); showStyle(); }));
    showStyle();
    $('recal').addEventListener('click', () => {
      sens.fwd = null; sens.gref = null; store.set('fwd', null); store.set('gref', null);
      sens.cal = sens.motionSeen ? 'still' : 'none';
      toast(sens.motionSeen ? 'Araç dururken bekle, sonra gaza bas.' : 'Motoru çalıştırınca kalibrasyon başlar.');
    });
    renderCars();
    loadMaps().then(renderCars).catch(() => {});
    bindCustomUi();
    bindRaw();
    loadCustom();
    sizeCanvas();
    loopOn = true;
    setInterval(tick, 8);
    requestAnimationFrame(frame);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeCanvas);
  }

  window.__kukreme = { veh, sens, sim, audio, settings, stepSim, stepVehicle, onPosition, sensorInput };
  boot();
})();
