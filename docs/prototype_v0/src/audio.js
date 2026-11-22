window.MountainTD = window.MountainTD || {};

window.MountainTD.Audio = (function () {
  let ctx = null;

  function ensureCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) ctx = new AudioCtx();
    }
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function playTone(freq, duration, type, gainVal, endFreq) {
    const c = ensureCtx();
    if (!c) return;
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || "triangle";
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + duration);
    }
    gain.gain.setValueAtTime(gainVal || 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  return {
    chop() {
      playTone(170, 0.09, "square", 0.06, 85);
    },
    coin() {
      playTone(880, 0.09, "sine", 0.07, 1320);
      setTimeout(() => playTone(1174, 0.12, "sine", 0.06, 1568), 65);
    },
    build() {
      playTone(220, 0.08, "triangle", 0.08, 330);
      setTimeout(() => playTone(330, 0.11, "triangle", 0.07, 440), 75);
    },
    arrow() {
      playTone(620, 0.07, "triangle", 0.04, 240);
    },
    hit() {
      playTone(140, 0.08, "sawtooth", 0.05, 70);
    },
    trap() {
      playTone(300, 0.12, "sawtooth", 0.08, 95);
    },
    bearRoar() {
      playTone(110, 0.42, "sawtooth", 0.09, 55);
    },
    nightStart() {
      playTone(293.66, 0.28, "triangle", 0.08, 220);
      setTimeout(() => playTone(220, 0.35, "triangle", 0.08, 164.8), 220);
    },
    dawn() {
      // 五声音阶清晨短笛感
      const notes = [523.25, 587.33, 659.25, 783.99];
      notes.forEach((n, idx) => {
        setTimeout(() => playTone(n, 0.18, "sine", 0.06), idx * 95);
      });
    },
    wedding() {
      // 喜庆五声锣鼓旋律
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      notes.forEach((n, idx) => {
        setTimeout(() => playTone(n, 0.2, "triangle", 0.085), idx * 110);
      });
    },
  };
})();
