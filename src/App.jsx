import { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, VolumeX, RefreshCw, Play, Keyboard } from 'lucide-react';
import { GameEngine } from './game/GameEngine';
import audioSynth from './game/AudioSynth';

const UI = '/assets/boss_level1/ui';

// ─── Analog Stick (Image-based) ──────────────────────────────────────────────
function AnalogStick({ onMove }) {
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const activeTouch = useRef(null);
  const dragging = useRef(false);
  const BASE_R = 55;
  const KNOB_R = 26;

  const getCenter = () => {
    const rect = baseRef.current.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  const applyKnob = useCallback((clientX, clientY) => {
    const c = getCenter();
    let dx = clientX - c.x;
    let dy = clientY - c.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const max = BASE_R - KNOB_R;
    if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px,${dy}px)`;
    onMove(dx / max);
  }, [onMove]);

  const resetKnob = useCallback(() => {
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px,0px)';
    onMove(0);
  }, [onMove]);

  const onTStart = (e) => { e.preventDefault(); if (activeTouch.current != null) return; const t = e.changedTouches[0]; activeTouch.current = t.identifier; applyKnob(t.clientX, t.clientY); };
  const onTMove  = (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === activeTouch.current) applyKnob(t.clientX, t.clientY); };
  const onTEnd   = (e) => { for (const t of e.changedTouches) if (t.identifier === activeTouch.current) { activeTouch.current = null; resetKnob(); } };

  const onMDown  = (e) => { dragging.current = true; applyKnob(e.clientX, e.clientY); };
  const onMMove  = useCallback((e) => { if (dragging.current) applyKnob(e.clientX, e.clientY); }, [applyKnob]);
  const onMUp    = useCallback(() => { if (dragging.current) { dragging.current = false; resetKnob(); } }, [resetKnob]);

  useEffect(() => {
    window.addEventListener('mousemove', onMMove);
    window.addEventListener('mouseup', onMUp);
    return () => { window.removeEventListener('mousemove', onMMove); window.removeEventListener('mouseup', onMUp); };
  }, [onMMove, onMUp]);

  return (
    <div ref={baseRef} onTouchStart={onTStart} onTouchMove={onTMove} onTouchEnd={onTEnd} onTouchCancel={onTEnd} onMouseDown={onMDown}
      style={{
        position:'relative', width:BASE_R*2, height:BASE_R*2,
        display:'flex', alignItems:'center', justifyContent:'center',
        userSelect:'none', WebkitUserSelect:'none', touchAction:'none', cursor:'pointer', flexShrink:0,
      }}>
      <img src={`${UI}/analog_base.png`} alt="" draggable={false}
        style={{ position:'absolute', width:'100%', height:'100%', pointerEvents:'none' }} />
      <div ref={knobRef} style={{ position:'absolute', width:KNOB_R*2, height:KNOB_R*2, pointerEvents:'none' }}>
        <img src={`${UI}/analog_knob.png`} alt="" draggable={false}
          style={{ width:'100%', height:'100%' }} />
      </div>
    </div>
  );
}

// ─── Image Action Button ─────────────────────────────────────────────────────
function ImgBtn({ imgNormal, imgPressed, size=58, onStart, onEnd }) {
  const [active, setActive] = useState(false);
  const start = (e) => { e.preventDefault(); setActive(true); onStart(); };
  const end   = (e) => { e.preventDefault(); setActive(false); onEnd(); };
  return (
    <button
      onTouchStart={start} onTouchEnd={end} onTouchCancel={end}
      onMouseDown={(e)=>{ e.preventDefault(); setActive(true); onStart(); }}
      onMouseUp={()=>{ setActive(false); onEnd(); }}
      onMouseLeave={()=>{ if(active){ setActive(false); onEnd(); } }}
      style={{
        width:size, height:size, cursor:'pointer', background:'none', border:'none', padding:0,
        touchAction:'manipulation', userSelect:'none', WebkitUserSelect:'none', outline:'none', flexShrink:0,
        transform: active ? 'scale(0.91)' : 'scale(1)',
        transition:'transform 0.08s',
      }}>
      <img src={active ? imgPressed : imgNormal} alt="" draggable={false}
        style={{ width:'100%', height:'100%', pointerEvents:'none' }} />
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  const [gameState, setGameState]               = useState('MENU');
  const [playerHp, setPlayerHp]                 = useState(5);
  const [playerEnergy, setPlayerEnergy]         = useState(100);
  const [bossHp, setBossHp]                     = useState(10000);
  const [bossMaxHp, setBossMaxHp]               = useState(10000);
  const [bossEnraged, setBossEnraged]           = useState(false);
  const [level, setLevel]                       = useState(1);
  const [dronesLeft, setDronesLeft]             = useState(0);
  const [powerupsCollected, setPowerupsCollected] = useState(0);
  const [laserCharge, setLaserCharge]           = useState(0);
  const [isMuted, setIsMuted]                   = useState(false);
  const [paused, setPaused]                     = useState(false);
  const [welcomeFrame, setWelcomeFrame]         = useState(0);
  const [showControlsModal, setShowControlsModal] = useState(false);

  // ─── Heavy Preload After Start Game ───
  useEffect(() => {
    if (gameState !== 'LOADING_LEVEL') return;

    const preloadGameAssets = async () => {
      const imagesToLoad = [];
      
      // 1. Player animations
      const playerAnims = { idle: 6, run: 8, jump: 4, fall: 4, dash: 4, shoot: 4, laser: 4, land: 3, hit: 2 };
      for (const [anim, frames] of Object.entries(playerAnims)) {
        for (let i = 0; i < frames; i++) {
          imagesToLoad.push(`/assets/boss_level1/player/${anim}/${String(i).padStart(3, '0')}.png`);
        }
      }

      // 2. Boss 1 animations
      const boss1Anims = { idle: 6, march: 8, slamepreap: 6, slamedown: 4, recover: 6, drillcharge: 6, drillrush: 4, hitdmg: 2, defeated: 8 };
      for (const [anim, frames] of Object.entries(boss1Anims)) {
        for (let i = 0; i < frames; i++) {
          imagesToLoad.push(`/assets/boss_level1/boss_iron_crusher/${anim}/${String(i).padStart(3, '0')}.png`);
        }
      }
      
      // 3. Boss 2 (Voltage Queen) animations
      const boss2Anims = { floatidle: 8, hit_damage: 2, laser: 6, shileld_broken: 4, defeated: 8 };
      for (const [anim, frames] of Object.entries(boss2Anims)) {
        for (let i = 0; i < frames; i++) {
          imagesToLoad.push(`/assets/boss_level2/boss_voltage_queen/${anim}/${String(i).padStart(3, '0')}.png`);
        }
      }

      // 4. Shield Drones (Level 2)
      for (let i = 0; i < 8; i++) {
        imagesToLoad.push(`/assets/boss_level2/drone/00${i}.png`);
      }

      // 5. Environments, VFX, and UI (Level 1 & Level 2)
      const staticAssets = [
        '/assets/boss_level1/background/bg_scrapyard.png',
        '/assets/boss_level1/floor/floor_scrapyard.png',
        '/assets/boss_level1/platform/platform_scrap.png',
        '/assets/boss_level1/ui/hud_player_portrait_frame.jpg',
        '/assets/boss_level2/background/bg_neon_lab.png',
        '/assets/boss_level2/platform/platform_glass.png',
        '/assets/boss_level2/ui/hud_boss_level2_panel_new.png',
        '/assets/boss_level2/fx/fx_overload_cell.png',
        '/assets/boss_level2/fx/fx_queen_shield_aura.png',
        '/assets/boss_level2/fx/fx_shield_block.png',
        '/assets/boss_level2/fx/fx_drone_explosion.png',
        '/assets/boss_level2/fx/fx_emp_blast.png',
        '/assets/boss_level2/fx/fx_electric_spark.png',
        '/assets/boss_level1/transition/bg_corridor.png',
        '/assets/boss_level1/transition/floor_corridor.png',
        '/assets/boss_level1/transition/portal_nextstage.png'
      ];
      imagesToLoad.push(...staticAssets);

      const promises = imagesToLoad.map(src => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = resolve;
          img.onerror = resolve; // proceed anyway
          img.src = src;
        });
      });

      await Promise.all(promises);
      
      // Small delay for smooth transition
      setTimeout(() => setGameState('PLAYING'), 300);
    };

    preloadGameAssets();
  }, [gameState]);

  useEffect(() => {
    if (gameState !== 'MENU') return;
    const interval = setInterval(() => {
      setWelcomeFrame((f) => (f + 1) % 6);
    }, 140);
    return () => clearInterval(interval);
  }, [gameState]);

  const analogDirs = useRef({ left: false, right: false });

  const handleAnalogMove = useCallback((nx) => {
    if (!engineRef.current) return;
    const isL = nx < -0.25, isR = nx > 0.25;
    if (isL !== analogDirs.current.left)  { engineRef.current.setTouchInput('left',  isL); analogDirs.current.left  = isL; }
    if (isR !== analogDirs.current.right) { engineRef.current.setTouchInput('right', isR); analogDirs.current.right = isR; }
  }, []);

  useEffect(() => {
    if (gameState !== 'PLAYING') {
      if (engineRef.current) { engineRef.current.stop(); engineRef.current = null; }
      return;
    }
    if (canvasRef.current) {
      audioSynth.resume();
      audioSynth.setMute(isMuted);
      const eng = new GameEngine(canvasRef.current, (s) => {
        setPlayerHp(s.playerHp); setPlayerEnergy(s.playerEnergy);
        setBossHp(s.bossHp); setBossMaxHp(s.bossMaxHp);
        setBossEnraged(s.bossEnraged);
        setLevel(s.level); setGameState(s.gameState);
        setDronesLeft(s.dronesLeft); setPowerupsCollected(s.powerupsCollected);
        setLaserCharge(s.laserCharge);
      });
      eng.start();
      engineRef.current = eng;
    }
    return () => { if (engineRef.current) { engineRef.current.stop(); engineRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  const toggleMute = () => { const m = !isMuted; setIsMuted(m); audioSynth.setMute(m); };
  const startGame  = () => { audioSynth.resume(); setPaused(false); setGameState('LOADING_LEVEL'); };
  const si = (k, v) => engineRef.current && engineRef.current.setTouchInput(k, v);

  const togglePause = () => {
    if (!engineRef.current) return;
    if (paused) {
      engineRef.current.start();
      setPaused(false);
    } else {
      engineRef.current.stop();
      setPaused(true);
    }
  };

  const resumeGame = () => {
    if (engineRef.current) engineRef.current.start();
    setPaused(false);
  };

  const restartGame = () => {
    if (engineRef.current) { engineRef.current.stop(); engineRef.current = null; }
    setPaused(false);
    setGameState('RESTARTING');
    setTimeout(() => {
      setGameState('PLAYING');
    }, 10);
  };

  const backToMenu = () => {
    if (engineRef.current) { engineRef.current.stop(); engineRef.current = null; }
    setPaused(false);
    setGameState('MENU');
  };

  // HP cells count (max 5)
  const maxHp = 5;
  const energyCells = 10;
  const energyFilled = Math.round((playerEnergy / 100) * energyCells);


  return (
    <main className="select-none">
      <div className="game-container">
        <div className="scanlines" />
        <div className="vignette" />

        {/* ── LOADING SCREEN (After Tap to Start) ── */}
        {gameState === 'LOADING_LEVEL' && (
          <div className="screen-overlay flex flex-col justify-center items-center text-center z-[200]" style={{ backgroundColor: '#000' }}>
            <div className="animate-spin mb-6" style={{ width: '40px', height: '40px', border: '3px solid transparent', borderTopColor: '#00ffff', borderBottomColor: '#ff007f', borderRadius: '50%' }} />
            <div className="hud-font font-bold text-[#00ffff] text-[12px] tracking-[0.3em] animate-pulse">
              LOADING COMBAT ASSETS...
            </div>
          </div>
        )}

        {/* ── MENU ── */}
        {gameState === 'MENU' && (
          <div className="hud-welcome-screen" onClick={startGame}>
            {/* Animated Player Character on the bottom-left platform */}
            <div className="welcome-char-container">
              <img
                src={`/assets/boss_level1/player/idle/${String(welcomeFrame).padStart(3, '0')}.png`}
                alt="Zero Standing"
                className="welcome-char-img"
              />
            </div>

            {/* Logo in the center */}
            <div className="welcome-logo-container" onClick={(e) => e.stopPropagation()}>
              <img src="/assets/welcome/logonew.png" alt="Core Breaker Last Protocol" className="welcome-logo" />
            </div>

            {/* Tap to Start image */}
            <div className="welcome-start-container" onClick={(e) => { e.stopPropagation(); startGame(); }}>
              <img src="/assets/welcome/start.png" alt="TAP TO START" className="welcome-start-btn" />
            </div>

            {/* Corner Controls button */}
            <button
              className="welcome-controls-btn pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation();
                setShowControlsModal(true);
              }}
            >
              <Keyboard size={12} /> KONTROL
            </button>

            {/* Controls popup Modal */}
            {showControlsModal && (
              <div className="welcome-modal-overlay pointer-events-auto" onClick={(e) => { e.stopPropagation(); setShowControlsModal(false); }}>
                <div className="welcome-modal-content" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-4 border-b border-[#a020f0]/30 pb-2">
                    <span className="hud-font text-[11px] font-bold text-[#ff007f] glow-magenta uppercase">SYSTEM BRIEFING & CONTROLS</span>
                    <button onClick={() => setShowControlsModal(false)} className="text-gray-400 hover:text-white font-bold text-[10px] uppercase font-mono">TUTUP</button>
                  </div>

                  <div className="mb-4 flex justify-between items-center bg-[#0b0816]/70 p-2 border border-[#00ffff]/30 rounded">
                    <span className="text-[#00ffff] font-bold text-[10px] uppercase hud-font">Layar Penuh (Immersive):</span>
                    <button 
                      onClick={() => {
                        if (!document.fullscreenElement) {
                          document.documentElement.requestFullscreen().catch(err => console.log(err));
                        } else {
                          document.exitFullscreen();
                        }
                      }}
                      className="px-3 py-1 bg-[#00ffff]/20 hover:bg-[#00ffff]/40 border border-[#00ffff] rounded text-white text-[10px] font-bold hud-font transition-all"
                    >
                      FULLSCREEN
                    </button>
                  </div>
                  
                  <div className="neon-panel p-3 text-xs text-[#cbd5e1] leading-relaxed border-l-4 border-l-[#00ffff] mb-4">
                    <div className="hud-font font-bold text-[10px] text-[#00ffff] mb-1 uppercase tracking-wider">Misi Utama:</div>
                    <p>Kecerdasan buatan <span className="text-[#ff007f] font-semibold">&quot;The Singularity&quot;</span> menguasai manufaktur robot dunia dan menganggap manusia sebagai bug untuk pembersihan total.</p>
                    <p className="mt-1">Kamu adalah <span className="text-[#00ffff] font-semibold">Zero</span>, cyborg pembawa inti energi terakhir.</p>
                  </div>

                  <div className="p-3 text-[11px] bg-[#0b0816]/70 border border-[#a020f0]/30 rounded-md">
                    <span className="hud-font text-[#00ffff] font-bold block mb-1 uppercase">KONTROL KEYBOARD:</span>
                    <ul className="list-disc pl-4 space-y-1 text-[#cbd5e1]">
                      <li><span className="font-semibold text-white">A / D</span>: Bergerak Kiri & Kanan</li>
                      <li><span className="font-semibold text-white">Spasi</span>: Lompat / Double Jump</li>
                      <li><span className="font-semibold text-white">Z / Klik Kiri</span>: Plasma Buster</li>
                      <li><span className="font-semibold text-white">Tahan Z / C</span>: Core Overcharge (Laser)</li>
                      <li><span className="font-semibold text-white">Shift / X</span>: Dash (i-frames)</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── GAMEOVER ── */}
        {gameState === 'GAMEOVER' && (
          <div className="screen-overlay flex flex-col justify-center items-center text-center" style={{ backgroundColor: 'rgba(10, 0, 0, 0.95)', zIndex: 100 }}>
            {/* Title Section */}
            <div style={{ position: 'relative', marginBottom: '2vh' }}>
              <h2 className="hud-font font-black" style={{ fontSize: 'clamp(2rem, 10vh, 4rem)', color: '#ff3b30', letterSpacing: '0.2em', textShadow: '0 0 20px rgba(255,59,48,0.8), 0 0 40px rgba(255,59,48,0.4)', margin: '0 0 10px 0' }}>
                CRITICAL FAILURE
              </h2>
              <div style={{ height: '4px', width: '100%', backgroundColor: '#ff3b30', opacity: 0.8, boxShadow: '0 0 15px #ff3b30' }} />
            </div>

            {/* Readout Panel */}
            <div style={{ width: '90%', maxWidth: '500px', backgroundColor: 'rgba(20, 2, 2, 0.9)', border: '1px solid rgba(255,59,48,0.5)', padding: '4vh 24px', position: 'relative', boxShadow: 'inset 0 0 40px rgba(255,59,48,0.15), 0 0 20px rgba(255,59,48,0.2)' }}>
              {/* Corner Accents */}
              <div style={{ position: 'absolute', top: 0, left: 0, width: '15px', height: '15px', borderTop: '3px solid #ff3b30', borderLeft: '3px solid #ff3b30' }} />
              <div style={{ position: 'absolute', top: 0, right: 0, width: '15px', height: '15px', borderTop: '3px solid #ff3b30', borderRight: '3px solid #ff3b30' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: '15px', height: '15px', borderBottom: '3px solid #ff3b30', borderLeft: '3px solid #ff3b30' }} />
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: '15px', height: '15px', borderBottom: '3px solid #ff3b30', borderRight: '3px solid #ff3b30' }} />
              
              <div style={{ textAlign: 'left', fontFamily: 'monospace', fontSize: '15px', lineHeight: '1.6' }}>
                <div style={{ color: '#ff3b30', fontWeight: 'bold', marginBottom: '16px', letterSpacing: '0.2em', borderBottom: '1px solid rgba(255,59,48,0.3)', paddingBottom: '8px' }}>
                  &gt; SYSTEM_ERR_0XF4
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fda4af', marginBottom: '10px' }}>
                  <span>ZERO_BIOMETRIC_SIGNAL</span>
                  <span className="animate-pulse" style={{ color: '#ff3b30', fontWeight: 'bold' }}>[ LOST ]</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fda4af', marginBottom: '10px' }}>
                  <span>CORE_ENERGY_MATRIX</span>
                  <span style={{ color: '#ff3b30', fontWeight: 'bold' }}>[ COMPROMISED ]</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fda4af' }}>
                  <span>MALWARE_UPLOAD</span>
                  <span style={{ color: '#ff007f', fontWeight: 'bold' }}>[ 100% ]</span>
                </div>

                <div className="animate-pulse" style={{ marginTop: '24px', paddingTop: '12px', fontSize: '13px', color: 'rgba(255,59,48,0.8)', textAlign: 'center', letterSpacing: '0.15em', borderTop: '1px solid rgba(255,59,48,0.2)' }}>
                  REBOOTING PROTOCOL...
                </div>
              </div>
            </div>

            {/* Action Button */}
            <button onClick={startGame} className="cyber-btn cyber-btn-magenta flex items-center gap-3" style={{ padding: '2vh 32px', marginTop: '3vh', letterSpacing: '2px' }}>
              <RefreshCw size={20} /> INITIALIZE REBOOT
            </button>
          </div>
        )}

        {/* ── VICTORY ── */}
        {gameState === 'VICTORY' && (
          <div className="screen-overlay flex flex-col justify-center items-center text-center" style={{ backgroundColor: 'rgba(0, 8, 12, 0.95)', zIndex: 100 }}>
            {/* Title Section */}
            <div style={{ position: 'relative', marginBottom: '2vh' }}>
              <h2 className="hud-font font-black" style={{ fontSize: 'clamp(2rem, 10vh, 4rem)', color: '#00ffff', letterSpacing: '0.2em', textShadow: '0 0 20px rgba(0,255,255,0.8), 0 0 40px rgba(0,255,255,0.4)', margin: '0 0 10px 0' }}>
                SYSTEM OVERRIDE
              </h2>
              <div style={{ height: '4px', width: '100%', backgroundColor: '#00ffff', opacity: 0.8, boxShadow: '0 0 15px #00ffff' }} />
            </div>

            {/* Readout Panel */}
            <div style={{ width: '90%', maxWidth: '500px', backgroundColor: 'rgba(2, 16, 20, 0.9)', border: '1px solid rgba(0,255,255,0.5)', padding: '4vh 24px', position: 'relative', boxShadow: 'inset 0 0 40px rgba(0,255,255,0.15), 0 0 20px rgba(0,255,255,0.2)' }}>
              {/* Corner Accents */}
              <div style={{ position: 'absolute', top: 0, left: 0, width: '15px', height: '15px', borderTop: '3px solid #00ffff', borderLeft: '3px solid #00ffff' }} />
              <div style={{ position: 'absolute', top: 0, right: 0, width: '15px', height: '15px', borderTop: '3px solid #00ffff', borderRight: '3px solid #00ffff' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: '15px', height: '15px', borderBottom: '3px solid #00ffff', borderLeft: '3px solid #00ffff' }} />
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: '15px', height: '15px', borderBottom: '3px solid #00ffff', borderRight: '3px solid #00ffff' }} />
              
              <div style={{ textAlign: 'left', fontFamily: 'monospace', fontSize: '15px', lineHeight: '1.6' }}>
                <div style={{ color: '#00ffff', fontWeight: 'bold', marginBottom: '16px', letterSpacing: '0.2em', borderBottom: '1px solid rgba(0,255,255,0.3)', paddingBottom: '8px' }}>
                  &gt; STATUS: TARGET ELIMINATED
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a5f3fc', marginBottom: '10px' }}>
                  <span>THE_SINGULARITY_CORE</span>
                  <span style={{ color: '#00ffff', fontWeight: 'bold' }}>[ DESTROYED ]</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a5f3fc', marginBottom: '10px' }}>
                  <span>GLOBAL_GRID_CONTROL</span>
                  <span style={{ color: '#34c759', fontWeight: 'bold' }}>[ RELEASED ]</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a5f3fc' }}>
                  <span>HUMAN_SURVIVAL_RATE</span>
                  <span className="animate-pulse" style={{ color: '#34c759', fontWeight: 'bold' }}>[ STABILIZING ]</span>
                </div>

                <div style={{ marginTop: '24px', paddingTop: '12px', fontSize: '13px', color: 'rgba(0,255,255,0.8)', textAlign: 'center', letterSpacing: '0.15em', borderTop: '1px solid rgba(0,255,255,0.2)' }}>
                  UPLOADING COMBAT LOGS... 100%
                </div>
              </div>
            </div>

            {/* Action Button */}
            <button onClick={() => setGameState('MENU')} className="cyber-btn flex items-center gap-3" style={{ padding: '2vh 32px', marginTop: '3vh', letterSpacing: '2px' }}>
              <RefreshCw size={20} /> DISCONNECT
            </button>
          </div>
        )}

        {/* ── PAUSE MENU ── */}
        {paused && gameState === 'PLAYING' && (
          <div className="screen-overlay flex flex-col items-center justify-center text-center" style={{ backgroundColor: 'rgba(0, 5, 10, 0.85)', backdropFilter: 'blur(8px)', zIndex: 100 }}>
            
            <div style={{ width: '90%', maxWidth: '500px', backgroundColor: 'rgba(2, 10, 16, 0.95)', border: '1px solid rgba(0,255,255,0.4)', padding: '5vh 5vw', position: 'relative', boxShadow: 'inset 0 0 30px rgba(0,255,255,0.1), 0 0 20px rgba(0,255,255,0.2)' }}>
              {/* Corner Accents */}
              <div style={{ position: 'absolute', top: 0, left: 0, width: '15px', height: '15px', borderTop: '3px solid #00ffff', borderLeft: '3px solid #00ffff' }} />
              <div style={{ position: 'absolute', top: 0, right: 0, width: '15px', height: '15px', borderTop: '3px solid #00ffff', borderRight: '3px solid #00ffff' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: '15px', height: '15px', borderBottom: '3px solid #00ffff', borderLeft: '3px solid #00ffff' }} />
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: '15px', height: '15px', borderBottom: '3px solid #00ffff', borderRight: '3px solid #00ffff' }} />
              
              <h2 className="hud-font font-black" style={{ fontSize: 'clamp(2rem, 8vh, 3rem)', color: '#00ffff', letterSpacing: '0.25em', textShadow: '0 0 15px rgba(0,255,255,0.8)', marginBottom: '4vh' }}>
                SYSTEM PAUSED
              </h2>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '280px', margin: '0 auto' }}>
                <button onClick={resumeGame} className="cyber-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '14px', letterSpacing: '2px' }}>
                  <Play size={18} fill="#fff" /> RESUME
                </button>
                <button onClick={restartGame} className="cyber-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '14px', letterSpacing: '2px' }}>
                  <RefreshCw size={18} /> RESTART
                </button>
                <button onClick={backToMenu} className="cyber-btn cyber-btn-magenta" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '14px', letterSpacing: '2px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                  MAIN MENU
                </button>
              </div>

              {/* Mute Toggle directly integrated */}
              <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'center' }}>
                <button onClick={toggleMute} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', color: isMuted ? '#64748b' : '#00ffff', cursor: 'pointer', fontFamily: 'monospace', fontSize: '14px', letterSpacing: '1px' }}>
                  {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  {isMuted ? 'AUDIO: OFF' : 'AUDIO: ON'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── HUD ── */}
        {(gameState === 'PLAYING' || gameState === 'MENU') && (
          <div className={`hud-overlay ${gameState === 'MENU' ? 'hud-menu-mode' : ''}`} style={{ padding:'6px 10px' }}>
            <div className="flex justify-between items-start w-full">

              {/* ── Player Panel (Left) ── */}
              <div className="hud-metallic-panel" style={{ flexShrink:0 }}>
                {/* SVG Background for beveled octagon corners & metallic border */}
                <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} viewBox="0 0 380 96" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="hudBorderGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#8a92a6" />
                      <stop offset="25%" stopColor="#484e5c" />
                      <stop offset="50%" stopColor="#252a36" />
                      <stop offset="75%" stopColor="#5d6578" />
                      <stop offset="100%" stopColor="#949db0" />
                    </linearGradient>
                  </defs>
                  {/* Outer Bevel Path (Octagon border) */}
                  <path d="M 14 0 L 366 0 L 380 14 L 380 82 L 366 96 L 14 96 L 0 82 L 0 14 Z" fill="url(#hudBorderGrad)" />
                  {/* Inner Content Path (Brushed metal inset by 2.5px) */}
                  <path d="M 15.2 2.5 L 364.8 2.5 L 377.5 15.2 L 377.5 80.8 L 364.8 93.5 L 15.2 93.5 L 2.5 80.8 L 2.5 15.2 Z" fill="#21252e" />
                </svg>

                {/* Brushed metal overlay effect inside the inner panel */}
                <div className="hud-brushed-metal" style={{ position:'absolute', left:3, top:3, right:3, bottom:3, clipPath:'polygon(12px 0%, calc(100% - 12px) 0%, 100% 12px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 12px 100%, 0% calc(100% - 12px), 0% 12px)', pointerEvents:'none' }} />

                {/* Portrait Circle Frame (Overlapping the left corner) */}
                <div className="hud-portrait-container">
                  <img src={`${UI}/hud_player_portrait_frame.jpg`} alt="Zero Portrait" draggable={false} className="hud-portrait-img" />
                </div>

                {/* Bars content */}
                <div className="hud-rows-container" style={{ position:'relative', zIndex:5 }}>
                  {/* HP Row */}
                  <div className="hud-row-panel hud-row-panel-hp">
                    <span className="hud-label hud-label-hp">HP</span>
                    <div className="hud-bars-area">
                      <div className="hud-cells-wrapper">
                        {[...Array(maxHp)].map((_, i) => (
                          <div
                            key={i}
                            className={i < playerHp ? 'hud-hp-cell-full' : 'hud-hp-cell-empty'}
                          />
                        ))}
                      </div>
                      <span className="hud-value hud-value-hp">{playerHp}/{maxHp}</span>
                    </div>
                  </div>

                  {/* Energy Row */}
                  <div className="hud-row-panel hud-row-panel-energy">
                    <span className="hud-label hud-label-energy">ENERGY</span>
                    <div className="hud-bars-area">
                      <div className="hud-cells-wrapper">
                        {[...Array(energyCells)].map((_, i) => (
                          <div
                            key={i}
                            className={i < energyFilled ? 'hud-energy-cell-full' : 'hud-energy-cell-empty'}
                          />
                        ))}
                      </div>
                      <span className="hud-value hud-value-energy">{Math.round(playerEnergy)}%</span>
                    </div>
                  </div>

                  {/* Laser Row */}
                  <div className="hud-row-panel hud-row-panel-laser">
                    <span className="hud-label hud-label-laser">LASER</span>
                    <div className="hud-bars-area">
                      <div className="hud-laser-trough">
                        <div className="hud-laser-fill" style={{ width: `${laserCharge}%` }} />
                      </div>
                      <span className="hud-value hud-value-laser">{Math.round(laserCharge)}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Boss Panel (Center-Right) ── */}
              {gameState === 'PLAYING' && (
                <div style={{ position:'relative', width:340, height:58, flexShrink:0 }}>
                  <img src={level === 2 ? `/assets/boss_level2/ui/hud_boss_level2_panel_new.png` : `${UI}/hud_boss_panel.png`} alt="" draggable={false}
                    style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'fill' }} />
                  {/* Only show HP numbers (panel image already has boss name text baked in) */}
                  <div style={{ position:'absolute', top:8, right:14 }}>
                    <span className="hud-font text-[10px] text-[#e2e8f0] font-bold">
                      {Math.round(bossHp)}/{bossMaxHp}
                    </span>
                  </div>
                  {/* Boss HP Bar */}
                  <div style={{ position:'absolute', bottom:10, left:14, right:14, height:14 }}>
                    <img src={`${UI}/hud_boss_hp_bar_bg.png`} alt="" draggable={false}
                      style={{ position:'absolute', width:'100%', height:'100%' }} />
                    <div style={{ position:'absolute', left:2, top:2, height:10, width:`${(bossHp / bossMaxHp) * 100}%`, overflow:'hidden' }}>
                      <img src={bossEnraged ? `${UI}/hud_boss_hp_fill_enraged.png` : `${UI}/hud_boss_hp_fill.png`}
                        alt="" draggable={false}
                        style={{ width:312, height:10 }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Pause & Mute */}
              <div style={{ display:'flex', gap:4, flexShrink:0, marginTop:2 }}>
                <button onClick={togglePause} className="pointer-events-auto p-1 hover:bg-white/10 rounded text-[#cbd5e1]" title="Pause">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                </button>
                <button onClick={toggleMute} className="pointer-events-auto p-1 hover:bg-white/10 rounded text-[#cbd5e1]">
                  {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              </div>
            </div>

            {/* Bottom row — Level 2 info */}
            <div className="flex justify-between items-end w-full">
              {level === 2 && (
                <div className="neon-panel p-2 flex gap-3 pointer-events-auto text-[9px] hud-font font-bold text-white border border-[#a020f0]/40">
                  <span className="text-[#a020f0]">DRONES: {dronesLeft > 0 ? dronesLeft : 'OFF'}</span>
                  <span className="text-[#34c759]">CELLS: {powerupsCollected}/3</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TOUCH CONTROLS (Image-based buttons) ── */}
        {gameState === 'PLAYING' && (
          <div style={{
            position:'absolute', bottom:0, left:0,
            width:'100%', height:140,
            display:'flex', justifyContent:'space-between', alignItems:'flex-end',
            padding:'0 16px 10px 16px', boxSizing:'border-box',
            zIndex:25, pointerEvents:'none',
          }}>
            {/* LEFT — Analog Stick */}
            <div style={{ pointerEvents:'auto', opacity:0.85 }}>
              <AnalogStick onMove={handleAnalogMove} />
            </div>

            {/* RIGHT — Action Buttons */}
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, pointerEvents:'auto', opacity:0.85 }}>
              {/* JUMP on top */}
              <ImgBtn
                imgNormal={`${UI}/btn_jump.png`}
                imgPressed={`${UI}/btn_jump_pressed.png`}
                size={48}
                onStart={() => si('up', true)} onEnd={() => si('up', false)} />
              {/* Row: DASH  FIRE  LASER */}
              <div style={{ display:'flex', gap:8 }}>
                <ImgBtn
                  imgNormal={`${UI}/btn_dash.png`}
                  imgPressed={`${UI}/btn_dash_pressed.png`}
                  size={44}
                  onStart={() => si('dash', true)} onEnd={() => si('dash', false)} />
                <ImgBtn
                  imgNormal={`${UI}/btn_fire.png`}
                  imgPressed={`${UI}/btn_fire_pressed.png`}
                  size={56}
                  onStart={() => si('shoot', true)} onEnd={() => si('shoot', false)} />
                <ImgBtn
                  imgNormal={`${UI}/btn_laser.png`}
                  imgPressed={`${UI}/btn_laser_pressed.png`}
                  size={44}
                  onStart={() => si('laser', true)} onEnd={() => si('laser', false)} />
              </div>
            </div>
          </div>
        )}

        {/* Canvas */}
        <canvas ref={canvasRef} className="game-canvas" />
      </div>
    </main>
  );
}
