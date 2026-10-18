// Lightweight WebAudio synth: EV motor whine, wind, tyre squeal, UI beeps.
export class Sfx {
  constructor() { this.ctx = null; this.muted = localStorage.getItem('rr_mute') === '1'; }
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.6; this.master.connect(c.destination);
      // motor: two detuned oscillators through lowpass
      this.motorGain = c.createGain(); this.motorGain.gain.value = 0;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
      this.o2 = c.createOscillator(); this.o2.type = 'sine';
      this.o3 = c.createOscillator(); this.o3.type = 'triangle';
      const g1 = c.createGain(); g1.gain.value = 0.18; const g2 = c.createGain(); g2.gain.value = 0.5; const g3 = c.createGain(); g3.gain.value = 0.3;
      this.o1.connect(g1).connect(lp); this.o2.connect(g2).connect(lp); this.o3.connect(g3).connect(lp);
      lp.connect(this.motorGain).connect(this.master);
      [this.o1, this.o2, this.o3].forEach((o) => o.start());
      // noise source for wind + squeal
      const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const mk = (type, f, q) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(this.master); s.start(); return g; };
      this.windGain = mk('lowpass', 600, 0.5);
      this.squealGain = mk('bandpass', 1500, 6);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setMuted(m) { this.muted = m; localStorage.setItem('rr_mute', m ? '1' : '0'); if (this.master) this.master.gain.value = m ? 0 : 0.6; }
  update(kmh, throttle, slip, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 70 + kmh * 4.2;
    this.o1.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.o2.frequency.setTargetAtTime(f, t, 0.05);
    this.o3.frequency.setTargetAtTime(f * 2.01, t, 0.05);
    this.motorGain.gain.setTargetAtTime(active ? 0.05 + throttle * 0.1 + Math.min(kmh, 200) / 200 * 0.05 : 0, t, 0.1);
    this.windGain.gain.setTargetAtTime(active ? Math.min(1, (kmh / 250) ** 2) * 0.5 : 0, t, 0.2);
    this.squealGain.gain.setTargetAtTime(active ? Math.min(1, slip) * 0.35 * Math.min(1, kmh / 40) : 0, t, 0.06);
  }
  beep(freq, dur) {
    if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.setValueAtTime(0.12, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(this.master); o.start(); o.stop(c.currentTime + dur + 0.05);
  }
  fanfare() { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => this.beep(f, 0.25), i * 140)); }
}
