// Core Breaker: Last Protocol - Audio Synthesizer (Procedural Web Audio API)

class AudioSynth {
  constructor() {
    this.ctx = null;
    this.musicInterval = null;
    this.musicNodes = [];
    this.isMuted = false;
    this.currentLevel = 0;
    this.currentLaserNode = null;
    this.currentLaserGain = null;
    this.volume = 0.5;
  }

  init() {
    if (this.ctx) return;
    // Create AudioContext
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMute(mute) {
    this.isMuted = mute;
    if (this.isMuted) {
      this.stopMusic();
      this.stopLaser();
    } else if (this.currentLevel > 0) {
      this.startMusic(this.currentLevel);
    }
  }

  // --- SOUND EFFECTS ---

  createNoiseBuffer() {
    if (!this.ctx) return null;
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  playBuster() {
    this.resume();
    if (this.isMuted || !this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(this.volume * 0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.13);
  }

  playDash() {
    this.resume();
    if (this.isMuted || !this.ctx) return;

    // Dash sounds like a clean white noise sweep through a bandpass filter
    const noise = this.ctx.createBufferSource();
    const buffer = this.createNoiseBuffer();
    if (!buffer) return;
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3.0;
    filter.frequency.setValueAtTime(400, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1800, this.ctx.currentTime + 0.2);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(this.volume * 0.6, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start();
    noise.stop(this.ctx.currentTime + 0.25);
  }

  playJump() {
    this.resume();
    if (this.isMuted || !this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(450, this.ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(this.volume * 0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.16);
  }

  startLaser() {
    this.resume();
    if (this.isMuted || !this.ctx || this.currentLaserNode) return;

    const osc = this.ctx.createOscillator();
    const vibrato = this.ctx.createOscillator();
    const vibratoGain = this.ctx.createGain();
    const distortion = this.ctx.createWaveShaper();
    const gain = this.ctx.createGain();

    // Create wave shaper curve for distortion
    const makeDistortionCurve = (amount) => {
      const k = typeof amount === 'number' ? amount : 50;
      const n_samples = 44100;
      const curve = new Float32Array(n_samples);
      const deg = Math.PI / 180;
      for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
      }
      return curve;
    };
    distortion.curve = makeDistortionCurve(60);
    distortion.oversample = '4x';

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, this.ctx.currentTime);

    vibrato.frequency.value = 18; // Hz
    vibratoGain.gain.value = 30; // Frequency variation in Hz

    gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(this.volume * 0.45, this.ctx.currentTime + 0.1);

    // Wire up LFO/Vibrato to main laser pitch
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    osc.connect(distortion);
    distortion.connect(gain);
    gain.connect(this.ctx.destination);

    vibrato.start();
    osc.start();

    this.currentLaserNode = { osc, vibrato };
    this.currentLaserGain = gain;
  }

  stopLaser() {
    if (!this.ctx || !this.currentLaserNode) return;

    const { osc, vibrato } = this.currentLaserNode;
    const gain = this.currentLaserGain;

    if (gain) {
      try {
        gain.gain.setValueAtTime(gain.gain.value, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
      } catch {
        /* ignore */
      }
    }

    setTimeout(() => {
      try {
        osc.stop();
        vibrato.stop();
      } catch {
        /* ignore */
      }
    }, 120);

    this.currentLaserNode = null;
    this.currentLaserGain = null;
  }

  playGroundSlam() {
    this.resume();
    if (this.isMuted || !this.ctx) return;

    // Lower rumble + noise explosion
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(25, this.ctx.currentTime + 0.5);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;

    gain.gain.setValueAtTime(this.volume * 0.8, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.6);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.6);

    // Overlay noise crash
    const noise = this.ctx.createBufferSource();
    const buffer = this.createNoiseBuffer();
    if (buffer) {
      noise.buffer = buffer;
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(300, this.ctx.currentTime);
      noiseFilter.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.4);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(this.volume * 0.7, this.ctx.currentTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      noise.start();
      noise.stop(this.ctx.currentTime + 0.45);
    }
  }

  playElectroFloor() {
    this.resume();
    if (this.isMuted || !this.ctx) return;

    // Buzzing noise burst
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(90, this.ctx.currentTime);
    // FM synth buzz
    const fm = this.ctx.createOscillator();
    const fmGain = this.ctx.createGain();
    fm.frequency.value = 150;
    fmGain.gain.value = 100;
    fm.connect(fmGain);
    fmGain.connect(osc.frequency);

    gain.gain.setValueAtTime(this.volume * 0.25, this.ctx.currentTime);
    gain.gain.setValueAtTime(0, this.ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(this.volume * 0.25, this.ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    fm.start();
    osc.start();
    fm.stop(this.ctx.currentTime + 0.21);
    osc.stop(this.ctx.currentTime + 0.21);
  }

  playHit() {
    this.resume();
    if (this.isMuted || !this.ctx) return;

    // Very short noise burst
    const noise = this.ctx.createBufferSource();
    const buffer = this.createNoiseBuffer();
    if (!buffer) return;
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(this.volume * 0.35, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start();
    noise.stop(this.ctx.currentTime + 0.06);
  }

  playExplosion() {
    this.resume();
    if (this.isMuted || !this.ctx) return;

    // Main low frequency rumble
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(10, this.ctx.currentTime + 1.2);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(20, this.ctx.currentTime + 1.2);

    gain.gain.setValueAtTime(this.volume * 0.9, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 1.3);

    // Full spectrum noise burst
    const noise = this.ctx.createBufferSource();
    const buffer = this.createNoiseBuffer();
    if (buffer) {
      noise.buffer = buffer;
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(this.volume * 0.85, this.ctx.currentTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.9);
      
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.value = 500;

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      noise.start();
      noise.stop(this.ctx.currentTime + 0.95);
    }
  }

  // --- BACKGROUND MUSIC ---

  startMusic(level) {
    this.resume();
    this.stopMusic();
    this.currentLevel = level;
    if (this.isMuted || !this.ctx) return;

    let step = 0;
    const bpm = level === 1 ? 125 : 140;
    const stepTime = 60 / bpm / 2; // Eighth notes

    // Level 1: Heavy Industrial Metal (driving dark synth bass + metal drum clangs)
    const playL1Step = (time) => {
      // 8-step bassline pattern in E minor
      const bassPattern = [41.2, 41.2, 49.0, 41.2, 55.0, 41.2, 49.0, 46.2]; // E1, E1, G1, E1, A1, E1, G1, F#1
      const currentFreq = bassPattern[step % 8];

      // Bass Synth
      const bassOsc = this.ctx.createOscillator();
      const bassGain = this.ctx.createGain();
      bassOsc.type = 'sawtooth';
      bassOsc.frequency.setValueAtTime(currentFreq, time);

      // Distort slightly
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4.0;
      filter.frequency.setValueAtTime(150, time);
      filter.frequency.exponentialRampToValueAtTime(450, time + stepTime * 0.8);

      bassGain.gain.setValueAtTime(this.volume * 0.35, time);
      bassGain.gain.exponentialRampToValueAtTime(0.01, time + stepTime * 0.95);

      bassOsc.connect(filter);
      filter.connect(bassGain);
      bassGain.connect(this.ctx.destination);
      bassOsc.start(time);
      bassOsc.stop(time + stepTime);
      this.musicNodes.push(bassOsc);

      // Heavy Drums
      // Kick on step 0 and 4
      if (step % 4 === 0) {
        const kickOsc = this.ctx.createOscillator();
        const kickGain = this.ctx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(150, time);
        kickOsc.frequency.exponentialRampToValueAtTime(40, time + 0.15);

        kickGain.gain.setValueAtTime(this.volume * 0.85, time);
        kickGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

        kickOsc.connect(kickGain);
        kickGain.connect(this.ctx.destination);
        kickOsc.start(time);
        kickOsc.stop(time + 0.16);
        this.musicNodes.push(kickOsc);
      }

      // Snare / Metal clang on step 2 and 6
      if (step % 4 === 2) {
        const snareOsc = this.ctx.createOscillator();
        const snareGain = this.ctx.createGain();
        snareOsc.type = 'triangle';
        snareOsc.frequency.setValueAtTime(220, time);
        snareOsc.frequency.exponentialRampToValueAtTime(80, time + 0.12);

        snareGain.gain.setValueAtTime(this.volume * 0.4, time);
        snareGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

        snareOsc.connect(snareGain);
        snareGain.connect(this.ctx.destination);
        snareOsc.start(time);
        snareOsc.stop(time + 0.16);
        this.musicNodes.push(snareOsc);

        // Clang noise
        const clang = this.ctx.createBufferSource();
        const buf = this.createNoiseBuffer();
        if (buf) {
          clang.buffer = buf;
          const clangFilter = this.ctx.createBiquadFilter();
          clangFilter.type = 'bandpass';
          clangFilter.frequency.value = 1800;
          clangFilter.Q.value = 8;
          const clangGain = this.ctx.createGain();
          clangGain.gain.setValueAtTime(this.volume * 0.25, time);
          clangGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

          clang.connect(clangFilter);
          clangFilter.connect(clangGain);
          clangGain.connect(this.ctx.destination);
          clang.start(time);
          clang.stop(time + 0.16);
          this.musicNodes.push(clang);
        }
      }
    };

    // Level 2: Fast-tempo Synthwave (pulsing synth lead arpeggiator + high sweep chords)
    const playL2Step = (time) => {
      // Fast arpeggiated retro lead
      const melodyPattern = [164.8, 196.0, 220.0, 246.9, 329.6, 293.7, 246.9, 196.0]; // E3, G3, A3, B3, E4, D4, B3, G3
      const currentFreq = melodyPattern[step % 8];

      // Arp Synth
      const arpOsc = this.ctx.createOscillator();
      const arpGain = this.ctx.createGain();
      arpOsc.type = 'sawtooth';
      arpOsc.frequency.setValueAtTime(currentFreq, time);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, time);
      filter.frequency.exponentialRampToValueAtTime(1400, time + stepTime * 0.5);

      arpGain.gain.setValueAtTime(this.volume * 0.22, time);
      arpGain.gain.exponentialRampToValueAtTime(0.01, time + stepTime * 0.9);

      arpOsc.connect(filter);
      filter.connect(arpGain);
      arpGain.connect(this.ctx.destination);
      arpOsc.start(time);
      arpOsc.stop(time + stepTime);
      this.musicNodes.push(arpOsc);

      // Pulsing 8th note bass
      const bassFreqs = [82.4, 82.4, 98.0, 98.0, 110.0, 110.0, 73.4, 73.4]; // E2, G2, A2, D2
      const bassFreq = bassFreqs[Math.floor(step / 2) % 8];

      const bassOsc = this.ctx.createOscillator();
      const bassGain = this.ctx.createGain();
      bassOsc.type = 'triangle';
      bassOsc.frequency.setValueAtTime(bassFreq, time);

      bassGain.gain.setValueAtTime(this.volume * 0.35, time);
      bassGain.gain.exponentialRampToValueAtTime(0.01, time + stepTime * 0.95);

      bassOsc.connect(bassGain);
      bassGain.connect(this.ctx.destination);
      bassOsc.start(time);
      bassOsc.stop(time + stepTime);
      this.musicNodes.push(bassOsc);

      // High background chord (pads) every 16 steps
      if (step % 16 === 0) {
        const chords = [
          [329.6, 392.0, 493.9], // Em
          [261.6, 329.6, 392.0], // C
          [392.0, 493.9, 587.3], // G
          [293.7, 369.9, 440.0]  // D
        ];
        const chordIndex = Math.floor(step / 16) % 4;
        const notes = chords[chordIndex];

        notes.forEach((freq) => {
          const padOsc = this.ctx.createOscillator();
          const padGain = this.ctx.createGain();
          padOsc.type = 'sine';
          padOsc.frequency.setValueAtTime(freq, time);

          padGain.gain.setValueAtTime(0, time);
          padGain.gain.linearRampToValueAtTime(this.volume * 0.08, time + stepTime * 4);
          padGain.gain.exponentialRampToValueAtTime(0.001, time + stepTime * 15.5);

          padOsc.connect(padGain);
          padGain.connect(this.ctx.destination);
          padOsc.start(time);
          padOsc.stop(time + stepTime * 16);
          this.musicNodes.push(padOsc);
        });
      }

      // Synthwave beat (Kick on 0/4/8/12, Snare/Clap on 4/12)
      const beatStep = step % 8;
      if (beatStep === 0 || beatStep === 4) {
        const kickOsc = this.ctx.createOscillator();
        const kickGain = this.ctx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(120, time);
        kickOsc.frequency.exponentialRampToValueAtTime(45, time + 0.12);

        kickGain.gain.setValueAtTime(this.volume * 0.7, time);
        kickGain.gain.exponentialRampToValueAtTime(0.01, time + 0.12);

        kickOsc.connect(kickGain);
        kickGain.connect(this.ctx.destination);
        kickOsc.start(time);
        kickOsc.stop(time + 0.13);
        this.musicNodes.push(kickOsc);
      }

      if (beatStep === 2 || beatStep === 6) {
        // Snare
        const snareOsc = this.ctx.createOscillator();
        const snareGain = this.ctx.createGain();
        snareOsc.type = 'triangle';
        snareOsc.frequency.setValueAtTime(250, time);
        snareOsc.frequency.exponentialRampToValueAtTime(100, time + 0.1);

        snareGain.gain.setValueAtTime(this.volume * 0.35, time);
        snareGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

        snareOsc.connect(snareGain);
        snareGain.connect(this.ctx.destination);
        snareOsc.start(time);
        snareOsc.stop(time + 0.11);
        this.musicNodes.push(snareOsc);

        // Hi-hat / White noise burst
        const hh = this.ctx.createBufferSource();
        const buf = this.createNoiseBuffer();
        if (buf) {
          hh.buffer = buf;
          const hhFilter = this.ctx.createBiquadFilter();
          hhFilter.type = 'highpass';
          hhFilter.frequency.value = 6000;
          const hhGain = this.ctx.createGain();
          hhGain.gain.setValueAtTime(this.volume * 0.15, time);
          hhGain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

          hh.connect(hhFilter);
          hhFilter.connect(hhGain);
          hhGain.connect(this.ctx.destination);
          hh.start(time);
          hh.stop(time + 0.06);
          this.musicNodes.push(hh);
        }
      }
    };

    // Main scheduler loop
    let nextStepTime = this.ctx.currentTime + 0.05;
    const scheduleAheadTime = 0.1;

    const scheduler = () => {
      while (nextStepTime < this.ctx.currentTime + scheduleAheadTime) {
        if (level === 1) {
          playL1Step(nextStepTime);
        } else {
          playL2Step(nextStepTime);
        }
        nextStepTime += stepTime;
        step++;
      }
    };

    this.musicInterval = setInterval(scheduler, 40);
  }

  stopMusic() {
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }

    // Stop and clear all active nodes immediately to prevent hanging notes
    this.musicNodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        /* ignore */
      }
    });
    this.musicNodes = [];
    this.currentLevel = 0;
  }
}

// Create a single global instance for the game
const audioSynth = new AudioSynth();
export default audioSynth;
