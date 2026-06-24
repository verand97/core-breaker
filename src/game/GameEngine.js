// Core Breaker: Last Protocol - Canvas Game Engine
import audioSynth from './AudioSynth';
import { BossAnimator } from './BossAnimator';
import { PlayerAnimator } from './PlayerAnimator';

// Constants
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 562; // 16:9 aspect ratio
const GRAVITY = 1200;
const PLAYER_SPEED = 280;
const JUMP_FORCE = -550;
const DASH_SPEED = 700;
const MAX_PLAYER_HP = 5;

// Image loaders cache
const images = {};
export function getAsset(src, enableChromaKey = false) {
  const cacheKey = src + (enableChromaKey ? '_chroma' : '');
  if (images[cacheKey]) return images[cacheKey];

  const img = new Image();
  img.src = src;

  if (!enableChromaKey) {
    images[cacheKey] = img;
    return img;
  }

  // Wrapper for chroma key processing
  const wrapper = {
    complete: false,
    canvas: null,
    img: img
  };

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width;
    const h = canvas.height;

    // We do a flood-fill from the edges to remove the background connected components.
    // This prevents inner white highlights/details in the sprites from being keyed out.
    const visited = new Uint8Array(w * h);
    const queue = [];

    // Helper to read pixel
    const samplePixel = (x, y) => {
      const idx = (x + y * w) * 4;
      return { r: data[idx], g: data[idx+1], b: data[idx+2], a: data[idx+3] };
    };

    const corners = [
      samplePixel(0, 0),
      samplePixel(w - 1, 0),
      samplePixel(0, h - 1),
      samplePixel(w - 1, h - 1)
    ];

    // Find the average color of corners
    const avgBg = corners.reduce((acc, c) => {
      acc.r += c.r; acc.g += c.g; acc.b += c.b;
      return acc;
    }, { r: 0, g: 0, b: 0 });
    avgBg.r /= 4; avgBg.g /= 4; avgBg.b /= 4;

    // Check if green screen (high G relative to R and B)
    const isGreenScreen = avgBg.g > 130 && avgBg.g > avgBg.r * 1.4 && avgBg.g > avgBg.b * 1.4;

    // Threshold: green screen is more vibrant, white screen is neutral
    const threshold = isGreenScreen ? 120 : 60;

    const isBackgroundPixel = (r, g, b, a) => {
      if (a < 10) return true;
      if (isGreenScreen) {
        // Distance to average corner green color
        const dist = Math.sqrt((r - avgBg.r)**2 + (g - avgBg.g)**2 + (b - avgBg.b)**2);
        return dist < threshold || (g > 120 && g > r * 1.3 && g > b * 1.3);
      } else {
        // Distance to average corner white color
        const dist = Math.sqrt((r - avgBg.r)**2 + (g - avgBg.g)**2 + (b - avgBg.b)**2);
        return dist < threshold;
      }
    };

    // Queue edges
    for (let x = 0; x < w; x++) {
      queue.push(x, 0);
      queue.push(x, h - 1);
    }
    for (let y = 1; y < h - 1; y++) {
      queue.push(0, y);
      queue.push(w - 1, y);
    }

    let head = 0;
    while (head < queue.length) {
      const cx = queue[head++];
      const cy = queue[head++];
      const idx = cx + cy * w;

      if (visited[idx]) continue;
      visited[idx] = 1;

      const pIdx = idx * 4;
      const r = data[pIdx];
      const g = data[pIdx+1];
      const b = data[pIdx+2];
      const a = data[pIdx+3];

      if (isBackgroundPixel(r, g, b, a)) {
        data[pIdx+3] = 0; // Make transparent

        // Enqueue 4-connected neighbors
        if (cx > 0) queue.push(cx - 1, cy);
        if (cx < w - 1) queue.push(cx + 1, cy);
        if (cy > 0) queue.push(cx, cy - 1);
        if (cy < h - 1) queue.push(cx, cy + 1);
      }
    }

    // Spill suppression: check remaining opaque pixels, reduce green color bleed
    if (isGreenScreen) {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Suppress neon green glow on sprite edges
          if (g > r * 1.1 && g > b * 1.1) {
            data[i + 1] = Math.round((r + b) / 2);
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    wrapper.canvas = canvas;
    wrapper.complete = true;
  };

  // Trigger onload manually if image was already cached complete by the browser
  if (img.complete) {
    setTimeout(() => { if (!wrapper.complete) img.onload(); }, 1);
  }

  images[cacheKey] = wrapper;
  return wrapper;
}

export class GameEngine {
  constructor(canvas, onStateChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onStateChange = onStateChange;

    // Set dimensions
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;

    // Game state
    this.level = 1; // 1 = Scrap-Yard, 2 = Neon Lab
    this.gameState = 'PLAYING'; // PLAYING, GAMEOVER, VICTORY, TRANSITION
    this.timeScale = 1.0;
    this.slowMoTimer = 0;
    this.whiteFlashAlpha = 0;
    this.score = 0;
    this.transitionLevelWidth = CANVAS_WIDTH; // Extended during transition

    // Input state
    this.keys = {};
    this.touchInputs = { left: false, right: false, up: false, shoot: false, dash: false, laser: false };

    // Camera
    this.camera = { x: 0, y: 0, shake: 0, shakeDecay: 0.9 };

    // Initialize level entities
    this.initLevel(1);

    // Setup input listeners
    this.bindInputs();

    // Loop variables
    this.lastTime = 0;
    this.animationId = null;
    this.active = true;
  }

  initLevel(levelNum) {
    this.level = levelNum;
    this.gameState = 'PLAYING'; // Always reset to PLAYING when loading a level
    audioSynth.startMusic(levelNum);

    // Player Object
    this.player = {
      x: 100,
      y: 300,
      vx: 0,
      vy: 0,
      width: 52,
      height: 110,
      hp: MAX_PLAYER_HP,
      energy: 100,
      maxEnergy: 100,
      isGrounded: false,
      jumpCount: 0,
      maxJumps: 2,
      dashTimer: 0,     // i-frame count
      dashCooldown: 0,
      dashDir: 1,
      facing: 1,        // 1 = right, -1 = left
      isShooting: false,
      shootCooldown: 0,
      chargeVal: 0,      // laser charge meter (0 - 100)
      isLaserActive: false,
      invulnerableTimer: 0, // General damage immunity after hit
      score: this.score,
      // Animation state
      animState: 'idle', // idle | run | jump | fall | dash | shoot | laser
      animTimer: 0,      // time accumulator for frame cycling
      animFrame: 0,      // current frame index
      breathCycle: 0,    // sine wave for idle breathing
      runLegPhase: 0,    // leg swing oscillation for running
    };

    // Level configuration
    this.bullets = [];
    this.particles = [];
    this.debris = [];
    this.powerups = [];
    this.shockwaves = [];
    this.platforms = [];
    this.powerupsCollected = this.powerupsCollected || 0;
    this.bossExplosionTriggered = false;
    this.pendingTransition = false;
    this.transitionLevelWidth = CANVAS_WIDTH;
    this.transitionHazards = null;
    this.transitionPortal = null;
    this.transitionPlatforms = null;

    // Reset camera to player start position
    this.camera = { x: 0, y: 0, shake: 0, shakeDecay: 0.9 };

    // Player Sprite Animator (shared across levels)
    this.playerAnimator = new PlayerAnimator();

    if (this.level === 1) {
      // Level 1 Floor and Scrap platforms
      this.floorY = 470;
      this.platforms = [
        { x: 300, y: 350, w: 150, h: 20 },
        { x: 550, y: 280, w: 160, h: 20 },
        { x: 800, y: 350, w: 150, h: 20 }
      ];

      // Boss 1: Iron-Crusher
      this.boss = {
        name: 'IRON-CRUSHER 01',
        type: 'heavy',
        x: 750,
        y: 470 - 160,
        width: 160,
        height: 160,
        hp: 10000,
        maxHp: 10000,
        state: 'IDLE', // IDLE, MARCH, SLAM_PREP, SLAM_DOWN, RECOVER, DRILL_CHARGE, DRILL_RUSH
        stateTimer: 1.5,
        facing: -1, // starts facing left (towards player)
        hitFlash: 0,
        weakPointOpen: false,
        attackCooldown: 1.0,
      };

      // Environmental Debris Rain Timer
      this.debrisTimer = 0;

      // Boss Sprite Animator
      this.bossAnimator = new BossAnimator(1);
    } else {
      // Level 2 Floor and Glass platforms
      this.floorY = 470;
      this.platforms = [
        { x: 150, y: 350, w: 180, h: 15, oscY: 350, oscAmp: 40, oscSpeed: 1.5 },
        { x: 400, y: 250, w: 200, h: 15, oscY: 250, oscAmp: 60, oscSpeed: 1.0 },
        { x: 680, y: 350, w: 180, h: 15, oscY: 350, oscAmp: 40, oscSpeed: 1.5 }
      ];

      // Boss 2: Voltage Queen
      this.boss = {
        name: 'VOLTAGE QUEEN',
        type: 'queen',
        x: 700,
        y: 200,
        baseY: 200,
        width: 130,
        height: 130,
        hp: 10000,
        maxHp: 10000,
        state: 'FLOAT', // FLOAT, MAGNETIC_FLOOR, LASER_SWEEP
        stateTimer: 2.0,
        facing: -1,
        hitFlash: 0,
        shieldActive: true,
        attackCooldown: 2.0,
      };

      // 4 shield drones rotating Voltage Queen
      this.drones = [];
      for (let i = 0; i < 4; i++) {
        this.drones.push({
          angle: (i * Math.PI) / 2,
          radius: 110,
          width: 32,
          height: 32,
          hp: 800,
          maxHp: 800,
          active: true,
          hitFlash: 0
        });
      }

      // Magnetic floor cycle state
      this.magneticFloorState = 'SAFE'; // SAFE, WARNING, ELECTRIFIED
      this.magneticFloorTimer = 3.0; // Seconds

      // Diagonal Lasers (4 corners targeting center)
      this.diagonalLasers = [];
      this.laserActive = false;

      // Overload Cells (Misi Sampingan)
      this.powerupsCollected = 0;
      this.powerups = [
        { x: 80, y: 150, collected: false, pulse: 0 },
        { x: 500, y: 120, collected: false, pulse: 1.5 },
        { x: 920, y: 150, collected: false, pulse: 3.0 }
      ];
      
      this.bossAnimator = new BossAnimator(2);
    }

    this.syncState();
  }

  bindInputs() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (this.ctx && this.ctx.state === 'suspended') {
        audioSynth.resume();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Mouse control click for Plasma Buster shooting
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left click
        this.keys['MouseLeft'] = true;
        audioSynth.resume();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.keys['MouseLeft'] = false;
      }
    });
  }

  // API to trigger touch controls from React overlay
  setTouchInput(control, value) {
    this.touchInputs[control] = value;
    audioSynth.resume();
  }

  syncState() {
    if (this.onStateChange) {
      this.onStateChange({
        playerHp: this.player.hp,
        playerEnergy: this.player.energy,
        bossHp: this.boss.hp,
        bossMaxHp: this.boss.maxHp,
        bossName: this.boss.name,
        bossEnraged: this.boss.hp < this.boss.maxHp * 0.3,
        level: this.level,
        // Report TRANSITION as PLAYING to React so it doesn't stop the engine
        gameState: this.gameState === 'TRANSITION' ? 'PLAYING' : this.gameState,
        powerupsCollected: this.powerupsCollected,
        dronesLeft: this.level === 2 ? this.drones.filter(d => d.active).length : 0,
        laserCharge: this.player.chargeVal
      });
    }
  }

  start() {
    this.active = true;
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  stop() {
    this.active = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    audioSynth.stopMusic();
    audioSynth.stopLaser();
  }

  loop(timestamp) {
    if (!this.active) return;

    let dt = (timestamp - this.lastTime) / 1000;
    if (dt > 0.1) dt = 0.1;
    this.lastTime = timestamp;

    this.realDt = dt;

    const actualDt = dt * this.timeScale;

    try {
      this.update(actualDt);
      this.render();
    } catch (e) {
      console.error('[GameEngine] Error in game loop:', e);
    }

    this.animationId = requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    if (this.gameState === 'TRANSITION') {
      this.updateTransition(dt);
      return;
    }

    if (this.gameState !== 'PLAYING') {
      this.updatePostGame(dt);
      return;
    }

    // Check if boss 1 was just defeated — start transition at the top of next frame
    if (this.pendingTransition) {
      this.pendingTransition = false;
      this.startTransition();
      this.updateTransition(dt);
      return;
    }

    // Handle Slow Motion fade (uses REAL time, not scaled time)
    if (this.slowMoTimer > 0) {
      this.slowMoTimer -= this.realDt;
      if (this.slowMoTimer <= 0) {
        this.timeScale = 1.0;
        this.whiteFlashAlpha = 0.8;
      }
    }

    // Level 2 boss defeat transition
    if (this.boss.hp <= 0 && this.level === 2 && this.bossExplosionTriggered) {
      if (this.bossDefeatedTimer > 0) {
         this.bossDefeatedTimer -= this.realDt; // Use realDt so it doesn't get slowed down
         if (this.bossDefeatedTimer <= 0) {
           this.gameState = 'VICTORY';
           audioSynth.stopMusic();
           this.syncState();
           return;
         }
      }
    }

    if (this.whiteFlashAlpha > 0) {
      this.whiteFlashAlpha -= dt * 2.0; // Fade out white flash quickly
    }

    // 1. Update Player
    this.updatePlayer(dt);

    // 1b. Update Player Animation State
    this.updatePlayerAnimation(dt);

    // 2. Update Platforms
    this.updatePlatforms(dt);

    // 3. Update Boss State Machine
    if (this.level === 1) {
      this.updateBossLevel1(dt);
    } else {
      this.updateBossLevel2(dt);
    }

    // 4. Update Projectiles & Shockwaves
    this.updateProjectiles(dt);

    // 5. Update Particles
    this.updateParticles(dt);

    // 6. Camera Follow & Screen Shake
    this.updateCamera(dt);

    // Periodic state synchronization to HUD (throttled to ~10fps for performance)
    this.syncTimer = (this.syncTimer || 0) + dt;
    if (this.syncTimer >= 0.1) {
      this.syncTimer = 0;
      this.syncState();
    }
  }

  updatePostGame(dt) {
    if (this.whiteFlashAlpha > 0) {
      this.whiteFlashAlpha -= dt * 1.5;
    }
    this.updateParticles(dt);
  }

  // ─── TRANSITION CORRIDOR (Level 1 → Level 2) ──────────────────────────────
  // After defeating Boss 1, the arena extends to the right.
  // Player runs through obstacles and reaches a portal to enter Level 2.

  startTransition() {
    this.gameState = 'TRANSITION';
    this.transitionLevelWidth = 3000; // Extended level width
    this.timeScale = 1.0; // Ensure normal speed
    this.whiteFlashAlpha = 0; // No white flash
    this.slowMoTimer = 0; // No slow motion
    this.boss.hp = 0; // Make sure boss stays dead

    // Remove boss from collision area
    this.boss.x = -500;
    this.boss.y = -500;

    // Clear leftover projectiles/debris
    this.bullets = [];
    this.shockwaves = [];
    this.debris = [];

    // Preload transition assets
    getAsset('/assets/boss_level1/transition/bg_corridor.png');
    getAsset('/assets/boss_level1/transition/floor_corridor.png');
    getAsset('/assets/boss_level1/transition/platform_metal.png');
    getAsset('/assets/boss_level1/transition/spike_trap.png');
    getAsset('/assets/boss_level1/transition/portal_nextstage.png');
    getAsset('/assets/boss_level1/transition/portal_glow.png');
    getAsset('/assets/boss_level1/transition/debris_bg_01.png');
    getAsset('/assets/boss_level1/transition/debris_bg_02.png');

    // Reset player state
    this.player.hp = Math.max(this.player.hp, 3); // Restore some HP
    this.player.energy = this.player.maxEnergy;
    this.player.invulnerableTimer = 0;
    this.player.isLaserActive = false;
    this.player.chargeVal = 0;

    // Transition obstacles — platforms and hazards along the corridor
    this.transitionPlatforms = [
      { x: 1100, y: 370, w: 120, h: 20 },
      { x: 1350, y: 300, w: 100, h: 20 },
      { x: 1550, y: 350, w: 130, h: 20 },
      { x: 1800, y: 280, w: 110, h: 20 },
      { x: 2050, y: 330, w: 120, h: 20 },
      { x: 2300, y: 260, w: 100, h: 20 },
      { x: 2500, y: 350, w: 140, h: 20 },
    ];

    // Spike hazards on the floor (gaps/spikes player must jump over)
    this.transitionHazards = [
      { x: 1200, y: this.floorY - 20, w: 80, h: 20 },
      { x: 1600, y: this.floorY - 20, w: 100, h: 20 },
      { x: 2000, y: this.floorY - 20, w: 80, h: 20 },
      { x: 2400, y: this.floorY - 20, w: 100, h: 20 },
    ];

    // Portal at the end of the corridor
    this.transitionPortal = {
      x: 2800,
      y: this.floorY - 140,
      w: 80,
      h: 140,
      pulseTimer: 0,
    };

    // Update platforms to include transition platforms
    this.platforms = [...this.platforms, ...this.transitionPlatforms];

    this.syncState();
  }

  updateTransition(dt) {
    // White flash fade — fade quickly so player can see the corridor
    if (this.whiteFlashAlpha > 0) {
      this.whiteFlashAlpha -= dt * 3.0;
      if (this.whiteFlashAlpha < 0) this.whiteFlashAlpha = 0;
    }

    // Player physics (movement, jump, platforms, gravity)
    this.updatePlayer(dt);
    this.updatePlayerAnimation(dt);

    // Platform collision (includes transition platforms)
    this.updatePlatforms(dt);

    // Particles (visual only)
    this.updateParticles(dt);

    // Camera follows player across the wider level
    this.updateCamera(dt);

    // Hazard collision — spikes damage player
    const p = this.player;
    if (p.invulnerableTimer <= 0 && p.dashTimer <= 0) {
      for (const hazard of this.transitionHazards) {
        if (this.checkCollision(p, hazard)) {
          this.damagePlayer(1);
          p.vy = JUMP_FORCE * 0.6; // Bounce player up
          break;
        }
      }
    }

    // Portal pulse animation
    this.transitionPortal.pulseTimer += dt * 3;

    // Portal particles
    const portal = this.transitionPortal;
    if (Math.random() < 0.4) {
      this.particles.push({
        type: 'spark',
        x: portal.x + portal.w / 2 + (Math.random() - 0.5) * 60,
        y: portal.y + Math.random() * portal.h,
        vx: (Math.random() - 0.5) * 40,
        vy: -Math.random() * 80 - 30,
        color: Math.random() > 0.5 ? '#00ffff' : '#a020f0',
        life: 0.6,
        maxLife: 0.6,
        size: Math.random() * 4 + 2,
      });
    }

    // Check if player reached the portal
    if (this.checkCollision(p, portal)) {
      // Transition to Level 2!
      audioSynth.playExplosion();
      this.gameState = 'PLAYING';
      this.initLevel(2);
      return;
    }

    // Throttled HUD sync
    this.syncTimer = (this.syncTimer || 0) + dt;
    if (this.syncTimer >= 0.1) {
      this.syncTimer = 0;
      this.syncState();
    }
  }

  // ─── Animation State Machine ───────────────────────────────────────────────
  updatePlayerAnimation(dt) {
    const p = this.player;
    p.animTimer += dt;
    p.breathCycle += dt * 2.2; // breathing oscillation speed

    // Determine anim state priority: dash > laser > shoot > jump/fall > run > idle
    let newState;
    if (p.dashTimer > 0) {
      newState = 'dash';
    } else if (p.isLaserActive) {
      newState = 'laser';
    } else if (p.isShooting) {
      newState = 'shoot';
    } else if (!p.isGrounded && p.vy < -50) {
      newState = 'jump';
    } else if (!p.isGrounded && p.vy >= -50) {
      newState = 'fall';
    } else if (Math.abs(p.vx) > 20) {
      newState = 'run';
    } else {
      newState = 'idle';
    }

    if (newState !== p.animState) {
      p.animState = newState;
      p.animTimer = 0;
      p.animFrame = 0;
    }

    // Running leg phase – continuous oscillation (not frame-based)
    if (p.animState === 'run') {
      p.runLegPhase += dt * 12; // Speed of leg cycling
    } else {
      // Decay leg phase back to neutral
      p.runLegPhase *= 0.85;
    }

    // Sync PlayerAnimator with current state
    if (this.playerAnimator) {
      this.playerAnimator.setState(p.animState);
      this.playerAnimator.update(dt);
      p.animFrame = this.playerAnimator.currentFrame;
    }
  }

  updatePlayer(dt) {
    const p = this.player;

    // Invulnerability timer
    if (p.invulnerableTimer > 0) {
      p.invulnerableTimer -= dt;
    }

    // Energy recovery
    if (p.energy < p.maxEnergy) {
      p.energy = Math.min(p.maxEnergy, p.energy + 25 * dt);
    }

    // 1. Horizontal Movement inputs
    let moveDir = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.touchInputs.left) {
      moveDir = -1;
      p.facing = -1;
    }
    if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.touchInputs.right) {
      moveDir = 1;
      p.facing = 1;
    }

    // 2. Dash initiation
    if ((this.keys['ShiftLeft'] || this.keys['KeyX'] || this.touchInputs.dash) && p.dashCooldown <= 0 && p.energy >= 35) {
      p.dashTimer = 0.25; // 0.25 seconds of dash duration (i-frames)
      p.dashCooldown = 0.6; // Cooldown between dashes
      p.energy -= 35;
      p.dashDir = moveDir !== 0 ? moveDir : p.facing;
      audioSynth.playDash();
      // Dash particles
      this.spawnDashParticles();
    }

    if (p.dashCooldown > 0) {
      p.dashCooldown -= dt;
    }

    // Apply movement physics
    if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      p.vx = p.dashDir * DASH_SPEED;
      p.vy = 0; // Dash cancels gravity temporarily
      // Create ghost particle trail
      if (Math.random() < 0.4) {
        this.particles.push({
          type: 'ghost',
          x: p.x + p.width/2,
          y: p.y + p.height/2,
          w: p.width,
          h: p.height,
          facing: p.facing,
          alpha: 0.5,
          life: 0.2,
          maxLife: 0.2
        });
      }
    } else {
      // Normal movement
      if (moveDir !== 0) {
        p.vx = moveDir * PLAYER_SPEED;
      } else {
        p.vx *= 0.75; // Friction
        if (Math.abs(p.vx) < 5) p.vx = 0;
      }

      // Gravity
      p.vy += GRAVITY * dt;
    }

    // Update position
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Floor collision
    if (p.y + p.height >= this.floorY) {
      p.y = this.floorY - p.height;
      p.vy = 0;
      p.isGrounded = true;
      p.jumpCount = 0;
    } else {
      p.isGrounded = false;
    }

    // Platforms collision (one-way platforms falling down)
    if (p.vy >= 0 && p.dashTimer <= 0) { // Only collide when falling down
      for (const plat of this.platforms) {
        if (
          p.x + p.width > plat.x &&
          p.x < plat.x + plat.w &&
          p.y + p.height >= plat.y &&
          p.y + p.height - p.vy * dt <= plat.y + 10
        ) {
          p.y = plat.y - p.height;
          p.vy = 0;
          p.isGrounded = true;
          p.jumpCount = 0;
          break;
        }
      }
    }

    // Boundary constraints
    const levelWidth = this.gameState === 'TRANSITION' ? this.transitionLevelWidth : CANVAS_WIDTH;
    if (p.x < 0) p.x = 0;
    if (p.x + p.width > levelWidth) p.x = levelWidth - p.width;

    // 3. Jump Inputs
    const jumpPressed = this.keys['Space'] || this.touchInputs.up;
    if (jumpPressed && !this.wasJumpPressed) {
      if (p.isGrounded) {
        p.vy = JUMP_FORCE;
        p.jumpCount = 1;
        p.isGrounded = false;
        audioSynth.playJump();
        this.spawnDust(p.x + p.width/2, this.floorY, 8);
      } else if (p.jumpCount < p.maxJumps) {
        p.vy = JUMP_FORCE * 0.95; // Slightly weaker double jump
        p.jumpCount++;
        audioSynth.playJump();
        this.spawnDust(p.x + p.width/2, p.y + p.height, 6);
      }
    }
    this.wasJumpPressed = jumpPressed;

    // 4. Shooting & Laser Charging
    const shootPressed = this.keys['KeyZ'] || this.keys['MouseLeft'] || this.touchInputs.shoot;
    const laserPressed = this.keys['KeyC'] || this.touchInputs.laser; // We can use C or Touch Laser for charging overcharge

    // Plasma Buster Shooting (Rapid fire)
    if (shootPressed && !laserPressed && p.dashTimer <= 0) {
      p.isShooting = true;
      if (p.shootCooldown <= 0) {
        const muzzle = this.getPlayerMuzzlePos();
        const bSize = 28; // plasma orb is square-ish
        this.bullets.push({
          x: muzzle.x - bSize / 2,
          y: muzzle.y - bSize / 2,
          vx: p.facing * 750,
          vy: 0,
          w: bSize,
          h: bSize,
          isPlayer: true,
          damage: 120
        });
        p.shootCooldown = 0.12; // 120ms between shots
        audioSynth.playBuster();
        
        // Spawn small muzzle spark
        this.particles.push({
          type: 'spark',
          x: muzzle.x,
          y: muzzle.y,
          vx: p.facing * 200 + (Math.random() - 0.5) * 100,
          vy: (Math.random() - 0.5) * 100,
          color: '#00ffff',
          life: 0.15,
          maxLife: 0.15,
          size: 4
        });
      }
    } else {
      p.isShooting = false;
    }

    if (p.shootCooldown > 0) {
      p.shootCooldown -= dt;
    }

    // Core Overcharge Laser Charging (Hold key/mouse or button)
    // In this implementation, holding Z or laser touch button charges the core.
    const isCharging = (shootPressed && this.keys['KeyZ']) || laserPressed;
    if (isCharging && p.dashTimer <= 0 && p.energy > 5) {
      p.chargeVal = Math.min(100, p.chargeVal + 90 * dt); // Charges full in ~1.1s
      
      // Charging sound trigger / visual sparks towards chest core
      if (p.chargeVal > 10 && Math.random() < 0.25) {
        const muzzle = this.getPlayerMuzzlePos();
        const startX = muzzle.x + (Math.random() - 0.5) * 80;
        const startY = muzzle.y + (Math.random() - 0.5) * 80;
        this.particles.push({
          type: 'spark',
          x: startX,
          y: startY,
          vx: (muzzle.x - startX) * 5,
          vy: (muzzle.y - startY) * 5,
          color: '#ff3b30',
          life: 0.2,
          maxLife: 0.2,
          size: 3
        });
      }

      // Auto fire laser when fully charged
      if (p.chargeVal >= 100) {
        p.isLaserActive = true;
        p.energy -= 40 * dt; // Continuous drain
        audioSynth.startLaser();
        
        // Screen rumble during laser
        this.camera.shake = Math.max(this.camera.shake, 2.5);

        // Laser damage triggers every frame (handled in collision section)
        if (p.energy <= 5) {
          p.isLaserActive = false;
          p.chargeVal = 0;
          audioSynth.stopLaser();
        }
      }
    } else {
      if (p.isLaserActive) {
        audioSynth.stopLaser();
      }
      p.isLaserActive = false;
      p.chargeVal = Math.max(0, p.chargeVal - 180 * dt); // Discharges quickly when not charging
    }
  }

  updatePlatforms(dt) {
    // Oscillating glass platforms in Level 2
    this.platforms.forEach(plat => {
      if (plat.oscAmp) {
        if (!plat.angle) plat.angle = 0;
        plat.angle += plat.oscSpeed * dt;
        plat.y = plat.oscY + Math.sin(plat.angle) * plat.oscAmp;
      }
    });
  }

  // LEVEL 1: Iron-Crusher AI
  // States flow: IDLE → MARCH → SLAM_PREP → SLAM_DOWN → RECOVER → IDLE
  // Enraged:     IDLE → DRILL_CHARGE → DRILL_RUSH → RECOVER → IDLE
  // On hit:      hitdmg animation plays briefly
  // On death:    immediately transition to corridor
  updateBossLevel1(dt) {
    const b = this.boss;
    const p = this.player;

    // --- DEFEATED: play defeated animation, then transition ---
    if (b.hp <= 0) {
      if (!this.bossExplosionTriggered) {
        // First frame of defeat — trigger effects
        this.bossExplosionTriggered = true;
        this.bossDefeatedTimer = 4.0; // 4 seconds to watch defeated animation
        audioSynth.playExplosion();
        audioSynth.stopLaser();
        this.camera.shake = 12;

        // Trigger defeated animation on boss sprite
        if (this.bossAnimator) {
          this.bossAnimator.triggerDefeated();
        }

        // Spawn explosion sparks
        for (let i = 0; i < 30; i++) {
          this.particles.push({
            type: 'spark',
            x: b.x + b.width / 2,
            y: b.y + b.height / 2,
            vx: (Math.random() - 0.5) * 500,
            vy: (Math.random() - 0.5) * 500,
            color: '#ffa500',
            life: 1.5,
            maxLife: 1.5,
            size: Math.random() * 6 + 3
          });
        }
      }

      // Update defeated animation
      if (this.bossAnimator) {
        this.bossAnimator.update(dt);
      }

      // Periodic small explosions on boss body while dying
      if (Math.random() < 0.3) {
        this.particles.push({
          type: 'spark',
          x: b.x + Math.random() * b.width,
          y: b.y + Math.random() * b.height,
          vx: (Math.random() - 0.5) * 150,
          vy: (Math.random() - 0.5) * 150,
          color: Math.random() > 0.5 ? '#ffa500' : '#ff4400',
          life: 0.3,
          maxLife: 0.3,
          size: Math.random() * 5 + 2
        });
      }

      // Countdown, then trigger transition
      this.bossDefeatedTimer -= dt;
      if (this.bossDefeatedTimer <= 0) {
        this.pendingTransition = true;
      }
      return;
    }

    // Flash timer decay
    if (b.hitFlash > 0) b.hitFlash -= dt * 10;

    // Enraged threshold: Drill charge unlocks when HP < 30%
    const isEnraged = b.hp < b.maxHp * 0.3;

    b.stateTimer -= dt;

    switch (b.state) {
      // --- IDLE: boss breathes/idles, faces player, picks next action ---
      case 'IDLE':
        b.weakPointOpen = false;
        b.facing = p.x < b.x ? -1 : 1;
        if (b.stateTimer <= 0) {
          if (isEnraged) {
            b.state = 'DRILL_CHARGE';
            b.stateTimer = 0.7; // charge-up before rush
          } else {
            b.state = 'MARCH';
            b.stateTimer = 2.5;
          }
        }
        break;

      // --- MARCH: walk towards player ---
      case 'MARCH':
        b.facing = p.x < b.x ? -1 : 1;
        b.x += b.facing * 90 * dt;

        if (b.x < 300) b.x = 300;
        if (b.x > 840) b.x = 840;

        if (b.stateTimer <= 0) {
          b.state = 'SLAM_PREP';
          b.stateTimer = 0.6; // wind-up time
        }
        break;

      // --- SLAM_PREP: raise arms, preparing slam ---
      case 'SLAM_PREP':
        b.weakPointOpen = false;
        if (b.stateTimer <= 0) {
          b.state = 'SLAM_DOWN';
          b.stateTimer = 0.35;
          audioSynth.playGroundSlam();
          this.camera.shake = 12;

          // Slam impact effect (image particle)
          this.particles.push({
            type: 'slam_impact',
            x: b.x + b.width / 2 - 40,
            y: this.floorY - 35,
            vx: 0, vy: 0,
            life: 0.5,
            maxLife: 0.5,
            size: 1,
            color: '#ffa500'
          });

          // Dust clouds on both sides
          this.particles.push({
            type: 'dust_cloud',
            x: b.x + b.width / 2 - 60,
            y: this.floorY - 20,
            vx: -60, vy: -10,
            life: 0.6, maxLife: 0.6,
            size: 1, color: '#888'
          });
          this.particles.push({
            type: 'dust_cloud',
            x: b.x + b.width / 2 + 20,
            y: this.floorY - 20,
            vx: 60, vy: -10,
            life: 0.6, maxLife: 0.6,
            size: 1, color: '#888'
          });

          // Ground shockwave towards player
          this.shockwaves.push({
            x: b.x + (b.facing === -1 ? 0 : b.width),
            y: this.floorY - 30,
            vx: b.facing * 400,
            w: 40,
            h: 30,
            damage: 1
          });
        }
        break;

      // --- SLAM_DOWN: impact on ground ---
      case 'SLAM_DOWN':
        if (b.stateTimer <= 0) {
          b.state = 'RECOVER';
          b.stateTimer = 2.0;
          b.weakPointOpen = true; // core exposed
        }
        break;

      // --- RECOVER: stunned, weak point open ---
      case 'RECOVER':
        b.weakPointOpen = true;

        // Weak point glow particle (re-spawn if expired)
        if (!this._weakGlowActive) {
          this._weakGlowActive = true;
          this.particles.push({
            type: 'weak_point_glow',
            x: b.x + b.width / 2 - 24,
            y: b.y + b.height / 2 - 24,
            vx: 0, vy: 0,
            life: 2.0, maxLife: 2.0,
            size: 1, color: '#00c8ff',
            bossRef: b
          });
        }

        if (b.stateTimer <= 0) {
          b.state = 'IDLE';
          b.stateTimer = 1.0;
          b.weakPointOpen = false;
          this._weakGlowActive = false;
        }
        break;

      // --- DRILL_CHARGE: enraged charge-up before rushing ---
      case 'DRILL_CHARGE':
        b.facing = p.x < b.x ? -1 : 1;
        b.weakPointOpen = false;

        // Drill spin visual particle
        if (!this._drillSpinActive) {
          this._drillSpinActive = true;
          this.particles.push({
            type: 'drill_spin',
            x: b.x + (b.facing === -1 ? -20 : b.width - 20),
            y: b.y + b.height / 2 - 24,
            vx: 0, vy: 0,
            life: 0.7, maxLife: 0.7,
            size: 1, color: '#aaa',
            bossRef: b
          });
        }

        if (b.stateTimer <= 0) {
          b.state = 'DRILL_RUSH';
          b.stateTimer = 1.2;
          this._drillSpinActive = false;
        }
        break;

      // --- DRILL_RUSH: fast dash across arena ---
      case 'DRILL_RUSH':
        b.x += b.facing * 450 * dt;
        b.weakPointOpen = true;

        // Drill exhaust flame behind the boss (image-based)
        if (!this._drillExhaustTimer) this._drillExhaustTimer = 0;
        this._drillExhaustTimer += dt;
        if (this._drillExhaustTimer > 0.05) {
          this._drillExhaustTimer = 0;
          this.particles.push({
            type: 'drill_exhaust',
            x: b.facing === -1 ? b.x + b.width + 5 : b.x - 48 - 5,
            y: b.y + b.height / 2 - 16,
            vx: -b.facing * 80,
            vy: (Math.random() - 0.5) * 30,
            life: 0.25,
            maxLife: 0.25,
            size: 1,
            color: '#ffa500',
            flip: b.facing
          });
        }

        if (b.stateTimer <= 0 || b.x < 50 || b.x + b.width > CANVAS_WIDTH - 50) {
          this.camera.shake = 10;
          audioSynth.playGroundSlam();
          b.state = 'RECOVER';
          b.stateTimer = 2.5;
          b.weakPointOpen = true;
          this._drillExhaustTimer = 0;
        }
        break;
    }

    // Update Boss Sprite Animator AFTER state machine
    if (this.bossAnimator) {
      this.bossAnimator.setBossState(b.state);
      this.bossAnimator.update(dt);
    }

    // Environmental Debris Rain
    this.debrisTimer += dt;
    const debrisInterval = isEnraged ? 0.6 : 1.2;
    if (this.debrisTimer >= debrisInterval) {
      this.debrisTimer = 0;
      this.debris.push({
        x: Math.random() * (CANVAS_WIDTH - 100) + 50,
        y: -30,
        vy: 350,
        w: 30,
        h: 30,
        angle: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 5
      });
    }

    // Contact damage (boss body hits player)
    if (p.dashTimer <= 0 && p.invulnerableTimer <= 0) {
      if (this.checkCollision(p, b)) {
        this.damagePlayer(1);
      }
    }
  }

  // LEVEL 2: Voltage Queen AI
  updateBossLevel2(dt) {
    if (this.bossAnimator) {
      this.bossAnimator.setBossState(this.boss.state);
      if (!this.boss.shieldActive) this.bossAnimator.setBossState('SHIELD_BROKEN');
      this.bossAnimator.update(dt);
    }
    const b = this.boss;
    const p = this.player;

    if (b.hp <= 0) {
      this.triggerBossExplosion(b, dt);
      return;
    }

    // Flash timers
    if (b.hitFlash > 0) b.hitFlash -= dt * 10;
    this.drones.forEach(d => {
      if (d.hitFlash > 0) d.hitFlash -= dt * 10;
    });

    const isEnraged = b.hp < b.maxHp * 0.3;

    // 1. Hover/Sine Floating behavior
    if (!b.sineAngle) b.sineAngle = 0;
    b.sineAngle += 2.0 * dt;
    b.y = b.baseY + Math.sin(b.sineAngle) * 35;

    // Follow player X coordinates slowly to align attacks
    const targetX = p.x - b.width / 2 + 100;
    b.x += (targetX - b.x) * 1.5 * dt;
    b.x = Math.max(300, Math.min(b.x, 800));

    // Update facing direction towards player
    b.facing = p.x < b.x + b.width / 2 ? -1 : 1;

    // Shield status
    b.shieldActive = this.drones.some(d => d.active);

    // 2. Rotate Shield Drones
    if (!this.droneRotAngle) this.droneRotAngle = 0;
    // Speed up rotation if enraged
    this.droneRotAngle += (isEnraged ? 2.5 : 1.2) * dt;

    this.drones.forEach((d, i) => {
      if (!d.active) return;
      d.angle = this.droneRotAngle + (i * Math.PI) / 2;
      d.x = (b.x + b.width / 2) + Math.cos(d.angle) * d.radius - d.width / 2;
      d.y = (b.y + b.height / 2) + Math.sin(d.angle) * d.radius - d.height / 2;
      
      // Drone sparks
      if (Math.random() < 0.1) {
        this.particles.push({
          type: 'spark',
          x: d.x + d.width/2,
          y: d.y + d.height/2,
          vx: (Math.random() - 0.5) * 80,
          vy: (Math.random() - 0.5) * 80,
          color: '#a020f0',
          life: 0.2,
          maxLife: 0.2,
          size: 2
        });
      }

      // Collide drone with player
      if (p.dashTimer <= 0 && p.invulnerableTimer <= 0) {
        if (this.checkCollision(p, d)) {
          this.damagePlayer(1);
        }
      }
    });

    // 3. Magnetic Floor State Machine
    this.magneticFloorTimer -= dt;
    if (this.magneticFloorTimer <= 0) {
      if (this.magneticFloorState === 'SAFE') {
        this.magneticFloorState = 'WARNING';
        this.magneticFloorTimer = 2.0; // 2 seconds warning
      } else if (this.magneticFloorState === 'WARNING') {
        this.magneticFloorState = 'ELECTRIFIED';
        this.magneticFloorTimer = 3.0; // 3 seconds shock
        audioSynth.playElectroFloor();
        this.camera.shake = 4;
      } else {
        this.magneticFloorState = 'SAFE';
        this.magneticFloorTimer = 4.0; // 4 seconds rest
      }
    }

    // Electrified floor damage
    if (this.magneticFloorState === 'ELECTRIFIED') {
      if (p.y + p.height >= this.floorY - 10 && p.invulnerableTimer <= 0 && p.dashTimer <= 0) {
        this.damagePlayer(1);
        audioSynth.playElectroFloor();
      }
      
      // Sparks from floor
      if (Math.random() < 0.4) {
        this.particles.push({
          type: 'spark',
          x: Math.random() * CANVAS_WIDTH,
          y: this.floorY + (Math.random() - 0.5) * 10,
          vx: 0,
          vy: -Math.random() * 200 - 100,
          color: '#00ffff',
          life: 0.25,
          maxLife: 0.25,
          size: 2
        });
      }
    }

    // 4. Boss Attack Cycles
    b.stateTimer -= dt;
    if (b.stateTimer <= 0) {
      // Pick next state
      const states = ['FLOAT', 'LASER_SWEEP'];
      b.state = states[Math.floor(Math.random() * states.length)];
      b.stateTimer = b.state === 'LASER_SWEEP' ? 4.0 : 3.0;
      
      if (b.state === 'LASER_SWEEP') {
        this.laserActive = true;
        this.laserTimer = 3.0;
        this.camera.shake = 5;
      }
    }

    // Diagonal Corner Lasers attack execution
    if (this.laserActive) {
      this.laserTimer -= dt;
      if (this.laserTimer <= 0) {
        this.laserActive = false;
      }

      // Check laser hit against player (unless safe zone in the middle or dashing)
      if (p.dashTimer <= 0 && p.invulnerableTimer <= 0) {
        // Simple geometry check: diagonal lines intersect player screen box, except center.
        // Corner coordinates:
        const corners = [
          { x: 0, y: 0 },
          { x: CANVAS_WIDTH, y: 0 },
          { x: 0, y: this.floorY },
          { x: CANVAS_WIDTH, y: this.floorY }
        ];

        // Safe zone: exact center box w=160, h=250
        const centerX = CANVAS_WIDTH / 2;
        const inSafeZone = (p.x + p.width/2 > centerX - 80 && p.x + p.width/2 < centerX + 80);

        if (!inSafeZone) {
          // If player is outside safe zone, laser sweep hits them
          // Draw four lines connecting corners to player box
          corners.forEach(c => {
            // Line intersection with player bounding box
            if (this.lineRectIntersect(c.x, c.y, b.x + b.width/2, b.y + b.height/2, p)) {
              this.damagePlayer(1);
            }
          });
        }
      }
    }

    // 5. Overload power-up checks
    this.powerups.forEach(pow => {
      if (pow.collected) return;
      
      pow.pulse += dt * 3;

      // Contact with player
      const dx = (p.x + p.width/2) - pow.x;
      const dy = (p.y + p.height/2) - pow.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist < 40) {
        pow.collected = true;
        this.powerupsCollected++;
        audioSynth.playElectroFloor(); // Play electric collect SFX
        this.camera.shake = 4;
        
        // Spawn ring explosion particles
        for (let i = 0; i < 15; i++) {
          const angle = (i * Math.PI * 2) / 15;
          this.particles.push({
            type: 'spark',
            x: pow.x,
            y: pow.y,
            vx: Math.cos(angle) * 150,
            vy: Math.sin(angle) * 150,
            color: '#34c759',
            life: 0.4,
            maxLife: 0.4,
            size: 4
          });
        }

        // EMP Blast: If all 3 collected, blow up drones instantly!
        if (this.powerupsCollected === 3) {
          audioSynth.playExplosion();
          this.camera.shake = 15;
          this.particles.push({ type: 'emp_blast', x: b.x + b.width/2, y: b.y + b.height/2, vx: 0, vy: 0, life: 1.0, maxLife: 1.0 });
          this.drones.forEach(d => {
            if (d.active) {
              d.active = false;
              this.particles.push({ type: 'drone_explosion', x: d.x + d.width/2, y: d.y + d.height/2, vx: 0, vy: 0, life: 0.4, maxLife: 0.4 });
              // Explode drone particles
              for (let j = 0; j < 12; j++) {
                this.particles.push({
                  type: 'spark',
                  x: d.x + d.width/2,
                  y: d.y + d.height/2,
                  vx: (Math.random() - 0.5) * 300,
                  vy: (Math.random() - 0.5) * 300,
                  color: '#a020f0',
                  life: 0.5,
                  maxLife: 0.5,
                  size: 5
                });
              }
            }
          });
        }
      }
    });

    // Check contact damage (boss hits player)
    if (p.dashTimer <= 0 && p.invulnerableTimer <= 0) {
      if (this.checkCollision(p, b)) {
        this.damagePlayer(1);
      }
    }
  }

  // Dynamic projectile & hazard updates
  updateProjectiles(dt) {
    const p = this.player;
    const b = this.boss;

    // 1. Bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bul = this.bullets[i];
      bul.x += bul.vx * dt;
      bul.y += bul.vy * dt;

      // Offscreen destroy
      if (bul.x < -50 || bul.x > CANVAS_WIDTH + 50 || bul.y < -50 || bul.y > CANVAS_HEIGHT + 50) {
        this.bullets.splice(i, 1);
        continue;
      }

      // Hit checks
      if (bul.isPlayer) {
        // Check Drones first if Level 2
        let hitDrone = false;
        if (this.level === 2 && b.shieldActive) {
          for (const d of this.drones) {
            if (d.active && this.checkCollision(bul, d)) {
              d.hp -= bul.damage;
              d.hitFlash = 1.0;
              hitDrone = true;
              this.bullets.splice(i, 1);
              audioSynth.playHit();
              
              if (d.hp <= 0) {
                d.active = false;
                audioSynth.playExplosion();
                this.camera.shake = 5;
                // Explode drone particles
                for (let j = 0; j < 15; j++) {
                  this.particles.push({
                    type: 'spark',
                    x: d.x + d.width/2,
                    y: d.y + d.height/2,
                    vx: (Math.random() - 0.5) * 200,
                    vy: (Math.random() - 0.5) * 200,
                    color: '#a020f0',
                    life: 0.4,
                    maxLife: 0.4,
                    size: 4
                  });
                }
              }
              break;
            }
          }
        }

        if (hitDrone) continue;

        // Check Boss Hit
        if (this.checkCollision(bul, b)) {
          this.bullets.splice(i, 1);
          audioSynth.playHit();

          if (this.level === 2 && b.shieldActive) {
            // Invulnerable, shield blocks
            this.spawnShieldBlockParticles(bul.x, bul.y);
          } else {
            // Level 1 Chest Core Check
            let finalDamage = bul.damage;
            if (this.level === 1) {
              const weakX = b.x + b.width/2 - 25;
              const weakY = b.y + b.height/2 - 25;
              const inWeakSpot = (bul.x >= weakX && bul.x <= weakX + 50 && bul.y >= weakY && bul.y <= weakY + 50);
              
              if (b.weakPointOpen && inWeakSpot) {
                finalDamage *= 3.0; // 3x Damage!
                this.spawnWeakPointHitParticles(bul.x, bul.y);
              } else {
                b.hitFlash = 1.0;
              }
            } else {
              b.hitFlash = 1.0;
            }

            b.hp = Math.max(0, b.hp - finalDamage);
            p.score += Math.round(finalDamage / 10);
            this.score = p.score;

            // Trigger boss hit animation
            if (this.bossAnimator) {
              this.bossAnimator.triggerHit();
            }
          }
        }
      }
    }

    // 2. Continuous Core Overcharge Laser Damage
    if (p.isLaserActive) {
      const muzzle = this.getPlayerMuzzlePos();
      const laserRange = p.facing === 1 ? CANVAS_WIDTH - muzzle.x : muzzle.x;
      const laserStartX = p.facing === 1 ? muzzle.x : 0;
      const laserY = muzzle.y;
      const laserHeight = 24;

      // Laser collision box
      const laserBox = {
        x: laserStartX,
        y: laserY - laserHeight/2,
        width: laserRange,
        height: laserHeight
      };

      // Check Drones level 2
      if (this.level === 2 && b.shieldActive) {
        this.drones.forEach(d => {
          if (d.active && this.checkCollision(laserBox, d)) {
            d.hp -= 2000 * dt; // High DPS
            d.hitFlash = 1.0;
            if (d.hp <= 0) {
              d.active = false;
              audioSynth.playExplosion();
              this.camera.shake = 5;
              this.particles.push({ type: 'drone_explosion', x: d.x + d.width/2, y: d.y + d.height/2, vx: 0, vy: 0, life: 0.4, maxLife: 0.4 });
            }
          }
        });
      }

      // Check Boss Hit
      if (this.checkCollision(laserBox, b)) {
        if (this.level === 2 && b.shieldActive) {
          this.spawnShieldBlockParticles(b.x + b.width/2 - 40, laserY);
        } else {
          let finalDps = 2500; // Base DPS
          if (this.level === 1) {
            const weakX = b.x + b.width/2 - 25;
            const inWeakSpot = (laserBox.x + laserBox.width >= weakX && laserBox.x <= weakX + 50);
            if (b.weakPointOpen && inWeakSpot) {
              finalDps *= 3.0; // 3x Damage!
              this.spawnWeakPointHitParticles(b.x + b.width/2, laserY);
            } else {
              b.hitFlash = 1.0;
            }
          } else {
            b.hitFlash = 1.0;
          }

          b.hp = Math.max(0, b.hp - finalDps * dt);
          p.score += Math.round((finalDps * dt) / 10);
          this.score = p.score;

          // Trigger boss hit animation for laser
          if (this.bossAnimator) {
            this.bossAnimator.triggerHit();
          }
        }
      }
    }

    // 3. Shockwaves (Level 1 ground waves)
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.x += sw.vx * dt;

      // Out of screen
      if (sw.x < -100 || sw.x > CANVAS_WIDTH + 100) {
        this.shockwaves.splice(i, 1);
        continue;
      }

      // Hit player
      if (p.dashTimer <= 0 && p.invulnerableTimer <= 0) {
        const swRect = { x: sw.x, y: sw.y, width: sw.w, height: sw.h };
        if (this.checkCollision(p, swRect)) {
          this.damagePlayer(sw.damage);
          this.shockwaves.splice(i, 1);
        }
      }
    }

    // 4. Falling Debris (Level 1 environmental)
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const deb = this.debris[i];
      deb.y += deb.vy * dt;
      deb.angle += deb.rotSpeed * dt;

      // hit floor
      if (deb.y + deb.h >= this.floorY) {
        // Explode debris
        this.spawnDust(deb.x + deb.w/2, this.floorY, 5);
        this.debris.splice(i, 1);
        continue;
      }

      // Hit player
      if (p.dashTimer <= 0 && p.invulnerableTimer <= 0) {
        if (this.checkCollision(p, deb)) {
          this.damagePlayer(1);
          this.debris.splice(i, 1);
        }
      }
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const part = this.particles[i];
      part.life -= dt;
      if (part.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      if (part.type === 'ghost') {
        part.alpha = part.life / part.maxLife;
      } else {
        part.x += part.vx * dt;
        part.y += part.vy * dt;
      }
    }
  }

  updateCamera(dt) {
    const p = this.player;

    // Follow player smoothly
    const targetCamX = p.x - CANVAS_WIDTH / 2.5;
    this.camera.x += (targetCamX - this.camera.x) * 4 * dt;

    // Bound camera X — wider during transition
    const maxCamX = this.gameState === 'TRANSITION'
      ? this.transitionLevelWidth - CANVAS_WIDTH
      : CANVAS_WIDTH - 200;
    this.camera.x = Math.max(0, Math.min(this.camera.x, maxCamX));

    // Shake decay
    if (this.camera.shake > 0.05) {
      this.camera.shake *= this.camera.shakeDecay;
    } else {
      this.camera.shake = 0;
    }
  }

  damagePlayer(amount) {
    const p = this.player;
    p.hp = Math.max(0, p.hp - amount);
    p.invulnerableTimer = 1.2; // 1.2s i-frames after getting hit
    this.camera.shake = 8;
    audioSynth.playHit();

    // Spawn red spark explosion
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        type: 'spark',
        x: p.x + p.width/2,
        y: p.y + p.height/2,
        vx: (Math.random() - 0.5) * 200,
        vy: (Math.random() - 0.5) * 200,
        color: '#ff3b30',
        life: 0.3,
        maxLife: 0.3,
        size: 3
      });
    }

    if (p.hp <= 0) {
      this.gameState = 'GAMEOVER';
      audioSynth.stopMusic();
      audioSynth.stopLaser();
      this.syncState();
    }
  }

  triggerBossExplosion(b, dt) {
    if (this.bossAnimator) {
      this.bossAnimator.update(this.realDt || dt);
    }

    // Boss defeat cinematic trigger — only fires once
    if (this.bossExplosionTriggered) return;

    if (this.slowMoTimer <= 0) {
      this.bossExplosionTriggered = true;
      if (this.bossAnimator) {
        this.bossAnimator.triggerDefeated();
      }
      this.bossDefeatedTimer = 3.5; // Wait 3.5 seconds before VICTORY screen
      this.slowMoTimer = 1.5; // 1.5 seconds real-time slow mo
      this.timeScale = 0.15;  // Slow physics to 15%
      audioSynth.playExplosion();
      audioSynth.stopLaser();
      this.camera.shake = 16;

      // Spawn large number of mechanical sparks
      for (let i = 0; i < 40; i++) {
        this.particles.push({
          type: 'spark',
          x: b.x + b.width/2,
          y: b.y + b.height/2,
          vx: (Math.random() - 0.5) * 600,
          vy: (Math.random() - 0.5) * 600,
          color: this.level === 1 ? '#ffa500' : '#00ffff',
          life: 1.5,
          maxLife: 1.5,
          size: Math.random() * 8 + 3
        });
      }
    }

    // Spawn periodic random small explosions
    if (Math.random() < 0.2) {
      const rx = b.x + Math.random() * b.width;
      const ry = b.y + Math.random() * b.height;
      audioSynth.playHit();
      for (let i = 0; i < 5; i++) {
        this.particles.push({
          type: 'spark',
          x: rx,
          y: ry,
          vx: (Math.random() - 0.5) * 150,
          vy: (Math.random() - 0.5) * 150,
          color: '#ffffff',
          life: 0.3,
          maxLife: 0.3,
          size: 4
        });
      }
    }
  }

  // --- PARTICLE GENERATION HELPER METHODS ---

  spawnDashParticles() {
    const p = this.player;
    const bulletX = p.facing === 1 ? p.x : p.x + p.width;
    for (let i = 0; i < 15; i++) {
      this.particles.push({
        type: 'spark',
        x: bulletX + (Math.random() - 0.5) * 10,
        y: p.y + p.height/2 + (Math.random() - 0.5) * 30,
        vx: -p.facing * (Math.random() * 200 + 100),
        vy: (Math.random() - 0.5) * 100,
        color: '#00ffff',
        life: 0.25,
        maxLife: 0.25,
        size: Math.random() * 4 + 2
      });
    }
  }

  spawnDust(x, y, count) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        type: 'spark',
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 150,
        vy: -Math.random() * 100,
        color: this.level === 1 ? '#8b5a2b' : '#a020f0', // brown dust vs neon purple smoke
        life: 0.4,
        maxLife: 0.4,
        size: Math.random() * 6 + 3
      });
    }
  }

  spawnShieldBlockParticles(x, y) {
    this.particles.push({
      type: 'shield_block',
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      life: 0.3,
      maxLife: 0.3
    });
    for (let i = 0; i < 5; i++) {
      this.particles.push({
        type: 'spark',
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 100,
        vy: (Math.random() - 0.5) * 100,
        color: '#a020f0',
        life: 0.2,
        maxLife: 0.2,
        size: 3
      });
    }
  }

  spawnWeakPointHitParticles(x, y) {
    for (let i = 0; i < 12; i++) {
      this.particles.push({
        type: 'spark',
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 300,
        vy: (Math.random() - 0.5) * 300,
        color: '#ff3b30', // Red critical hit flash
        life: 0.35,
        maxLife: 0.35,
        size: Math.random() * 5 + 3
      });
    }
  }

  getPlayerMuzzlePos() {
    const p = this.player;

    // Muzzle position calibrated to sprite
    // Sprite rendered: anchor at feet, scale 1.35, total height ~148px
    // Arm cannon is at upper-body (about 35% from top = 96px from feet)
    // Arm tip is near the right edge of sprite (~30px from center)

    let offsetX = 30;
    let offsetY = -95;

    if (p.animState === 'shoot') {
      offsetX = 34;
      offsetY = -100;
    } else if (p.animState === 'laser') {
      offsetX = 14;
      offsetY = -98;
    } else if (p.animState === 'dash') {
      offsetX = 32;
      offsetY = -80;
    } else if (p.animState === 'run') {
      offsetX = 28;
      offsetY = -90;
    } else if (p.animState === 'jump' || p.animState === 'fall') {
      offsetX = 28;
      offsetY = -88;
    }

    return {
      x: p.x + p.width / 2 + offsetX * p.facing,
      y: p.y + p.height + offsetY
    };
  }

  // --- COLLISION MATH HELPER METHODS ---

  checkCollision(rect1, rect2) {
    const w1 = rect1.width !== undefined ? rect1.width : rect1.w;
    const h1 = rect1.height !== undefined ? rect1.height : rect1.h;
    const w2 = rect2.width !== undefined ? rect2.width : rect2.w;
    const h2 = rect2.height !== undefined ? rect2.height : rect2.h;
    return (
      rect1.x < rect2.x + w2 &&
      rect1.x + w1 > rect2.x &&
      rect1.y < rect2.y + h2 &&
      rect1.y + h1 > rect2.y
    );
  }

  lineRectIntersect(x1, y1, x2, y2, rect) {
    // Simple check: does segment x1,y1 to x2,y2 cross rect bounds?
    const rx = rect.x;
    const ry = rect.y;
    const rw = rect.width;
    const rh = rect.height;

    // Check lines of the box
    return (
      this.lineLineIntersect(x1, y1, x2, y2, rx, ry, rx + rw, ry) || // top
      this.lineLineIntersect(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh) || // bottom
      this.lineLineIntersect(x1, y1, x2, y2, rx, ry, rx, ry + rh) || // left
      this.lineLineIntersect(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh)    // right
    );
  }

  lineLineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const uA = ((x4-x3)*(y1-y3) - (y4-y3)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));
    const uB = ((x2-x1)*(y1-y3) - (y2-y1)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));
    return (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1);
  }


  // --- CANVAS RENDERING ---


  // ─── Procedural Zero Sprite Animator ────────────────────────────────────────
  drawZeroSprite(ctx, p) {
    const { animState, breathCycle, runLegPhase, facing, dashTimer } = p;

    // SCALE: character render scale — increase for bigger character
    const S = 1.65;

    // Foot-anchor: character feet should be at bottom of hitbox
    // so we anchor the drawing origin at the foot level, not the center
    const footX = p.x + p.width / 2;
    const footY = p.y + p.height;   // bottom of hitbox = floor contact

    // Pose parameters
    let bodyBob    = 0;
    let bodyLean   = 0;
    let headTilt   = 0;
    let legAngle   = 0;
    let legAngle2  = 0;
    let armAngle   = 0;
    let armReach   = 0;
    let chargeGlow = 0;
    let dashStretch = 1;
    let dashSquash  = 1;

    switch (animState) {
      case 'idle': {
        bodyBob   = Math.sin(breathCycle) * 2.5;
        headTilt  = Math.sin(breathCycle * 0.7) * 0.04;
        armAngle  = Math.sin(breathCycle * 0.8) * 0.06 - 0.08;
        legAngle  = Math.sin(breathCycle * 0.5) * 0.03;
        break;
      }
      case 'run': {
        const phase = runLegPhase;
        bodyBob   = Math.abs(Math.sin(phase)) * -4;
        bodyLean  = 0.2 * facing;
        legAngle  = Math.sin(phase) * 0.6;
        legAngle2 = -Math.sin(phase) * 0.6;
        armAngle  = -Math.sin(phase) * 0.35 - 0.05;
        headTilt  = bodyLean * 0.35;
        break;
      }
      case 'jump': {
        bodyLean = 0.13 * facing;
        legAngle  = -0.65;
        legAngle2 = 0.32;
        armAngle  = -0.28;
        headTilt  = -0.1;
        break;
      }
      case 'fall': {
        legAngle  = 0.38;
        legAngle2 = 0.18;
        armAngle  = 0.22;
        bodyLean  = 0.07 * facing;
        break;
      }
      case 'dash': {
        bodyLean  = 0.52 * facing;
        legAngle  = -0.75;
        legAngle2 = -0.35;
        armAngle  = -0.5;
        dashStretch = 1.3;
        dashSquash  = 0.75;
        bodyBob   = 4;
        break;
      }
      case 'shoot': {
        bodyLean = -0.09 * facing;
        armAngle = -0.18;
        armReach = 10;
        legAngle = 0.09;
        bodyBob  = Math.sin(breathCycle * 5) * 1.2;
        break;
      }
      case 'laser': {
        bodyLean  = 0.06 * facing;
        armAngle  = -0.04;
        armReach  = 16;
        legAngle  = 0.13;
        legAngle2 = -0.13;
        chargeGlow = 16 + Math.sin(p.animTimer * 18) * 5;
        bodyBob   = Math.sin(p.animTimer * 22) * 1.2;
        break;
      }
    }

    // ─── Helper: draw filled rounded rect ───
    const rr = (x, y, w, h, r, fill, stroke, strokeW) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      if (fill)   { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeW || 1.5; ctx.stroke(); }
    };

    ctx.save();
    // Anchor at foot, then offset up for the character center
    // All body part coords use (0,0) = foot center
    ctx.translate(footX, footY + bodyBob * S);
    ctx.scale(facing * dashStretch * S, dashSquash * S);

    // ─────────────────────────────────────────────────────────────
    // All coordinates below are in DESIGN UNITS (before S scale)
    // Character is ~55px wide, ~130px tall in design space
    // 0,0 = foot contact point
    // ─────────────────────────────────────────────────────────────

    // ── SHADOW / GROUND CONTACT ──
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(0, 2, 20, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // ── BACK LEG ──────────────────────────────────────────────────
    ctx.save();
    ctx.translate(-5, -16);
    ctx.rotate(legAngle2);
    // Thigh
    const thighGrad1 = ctx.createLinearGradient(-8, 0, 8, 0);
    thighGrad1.addColorStop(0, '#141028');
    thighGrad1.addColorStop(1, '#1e1a30');
    rr(-8, 0, 16, 25, 5, null, null);
    ctx.fillStyle = thighGrad1; ctx.fill();
    ctx.strokeStyle = '#2a2248'; ctx.lineWidth = 1.5; ctx.stroke();
    // Knee
    ctx.fillStyle = '#0e8080';
    ctx.beginPath(); ctx.arc(0, 25, 4.5, 0, Math.PI*2); ctx.fill();
    // Shin
    ctx.translate(0, 25);
    ctx.rotate(legAngle2 * 0.4);
    rr(-7, 0, 14, 22, 4, '#100c20', '#1e1838');
    // Boot
    ctx.translate(0, 22);
    rr(-8, 0, 18, 10, 3, '#0c0a1a', '#181530');
    ctx.fillStyle = '#00b0b0';
    ctx.fillRect(-6, 2, 12, 2.5);
    ctx.restore();

    // ── FRONT LEG ─────────────────────────────────────────────────
    ctx.save();
    ctx.translate(5, -16);
    ctx.rotate(legAngle);
    // Thigh gradient
    const thighGrad2 = ctx.createLinearGradient(-8, 0, 8, 0);
    thighGrad2.addColorStop(0, '#201c38');
    thighGrad2.addColorStop(1, '#2a2448');
    rr(-8, 0, 16, 25, 5, null, null);
    ctx.fillStyle = thighGrad2; ctx.fill();
    ctx.strokeStyle = '#3a3260'; ctx.lineWidth = 1.5; ctx.stroke();
    // Circuit line on thigh
    ctx.strokeStyle = '#006868'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(2, 6); ctx.lineTo(2, 20); ctx.stroke();
    // Glowing knee joint
    ctx.shadowColor = '#00e8e8'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#00c8c8';
    ctx.beginPath(); ctx.arc(0, 25, 5, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    // Knee inner
    ctx.fillStyle = '#ffffff60';
    ctx.beginPath(); ctx.arc(-1.5, 23.5, 2, 0, Math.PI*2); ctx.fill();
    // Shin
    ctx.translate(0, 25);
    ctx.rotate(legAngle * 0.4);
    const shinGrad = ctx.createLinearGradient(-7, 0, 7, 0);
    shinGrad.addColorStop(0, '#181430');
    shinGrad.addColorStop(1, '#201c3a');
    rr(-7, 0, 14, 22, 4, null, null);
    ctx.fillStyle = shinGrad; ctx.fill();
    ctx.strokeStyle = '#2c2850'; ctx.lineWidth = 1.5; ctx.stroke();
    // Shin circuit
    ctx.strokeStyle = '#00606080'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-3, 4); ctx.lineTo(-3, 18); ctx.stroke();
    // Boot
    ctx.translate(0, 22);
    const bootGrad = ctx.createLinearGradient(-8, 0, 8, 0);
    bootGrad.addColorStop(0, '#0e0c22');
    bootGrad.addColorStop(1, '#181430');
    rr(-8, 0, 18, 11, 4, null, null);
    ctx.fillStyle = bootGrad; ctx.fill();
    ctx.strokeStyle = '#2a2650'; ctx.lineWidth = 1.5; ctx.stroke();
    // Boot cyan accent stripe
    ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#00e8e8';
    ctx.fillRect(-6, 2, 14, 3);
    ctx.shadowBlur = 0;
    ctx.restore();

    // ── TORSO ──────────────────────────────────────────────────────
    ctx.save();
    ctx.translate(0, -70);
    ctx.rotate(bodyLean);

    // Main chest plate gradient (left to right)
    const torsoGrad = ctx.createLinearGradient(-18, 0, 18, 0);
    torsoGrad.addColorStop(0, '#181530');
    torsoGrad.addColorStop(0.5, '#201d3a');
    torsoGrad.addColorStop(1, '#141228');
    rr(-18, -18, 36, 52, 7, null, '#2e2a50', 2);
    ctx.fillStyle = torsoGrad; ctx.fill();
    ctx.strokeStyle = '#2e2a50'; ctx.lineWidth = 2; ctx.stroke();

    // Abdominal detail lines
    ctx.strokeStyle = '#ffffff15'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-12, 4); ctx.lineTo(12, 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-10, 12); ctx.lineTo(10, 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, 20); ctx.lineTo(8, 20); ctx.stroke();

    // Right shoulder pad (cannon side)
    const rShoulderGrad = ctx.createLinearGradient(10, -25, 28, -25);
    rShoulderGrad.addColorStop(0, '#28244a');
    rShoulderGrad.addColorStop(1, '#1e1a38');
    rr(10, -28, 18, 16, 5, null, null);
    ctx.fillStyle = rShoulderGrad; ctx.fill();
    ctx.strokeStyle = '#00c8c8'; ctx.lineWidth = 1.5; ctx.stroke();
    // Shoulder screw detail
    ctx.fillStyle = '#00c8c860';
    ctx.beginPath(); ctx.arc(19, -20, 2.5, 0, Math.PI*2); ctx.fill();

    // Left shoulder pad
    const lShoulderGrad = ctx.createLinearGradient(-28, -25, -10, -25);
    lShoulderGrad.addColorStop(0, '#1e1a38');
    lShoulderGrad.addColorStop(1, '#16142e');
    rr(-28, -28, 18, 16, 5, null, '#282440', 1.5);
    ctx.fillStyle = lShoulderGrad; ctx.fill();
    ctx.strokeStyle = '#282440'; ctx.lineWidth = 1.5; ctx.stroke();

    // Chest energy core (glowing)
    const coreR = 8 + (chargeGlow ? chargeGlow * 0.35 : Math.sin(breathCycle * 2) * 1.5);
    const coreColor = animState === 'laser' ? '#ff5500' : '#00ffff';
    const coreColor2 = animState === 'laser' ? '#ff2200' : '#00c8c8';
    const coreGrad = ctx.createRadialGradient(-4, -5, 1, -4, -5, coreR);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.35, coreColor);
    coreGrad.addColorStop(1, coreColor2 + '80');
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = chargeGlow ? chargeGlow : (12 + Math.sin(breathCycle * 2) * 4);
    ctx.fillStyle = coreGrad;
    ctx.beginPath(); ctx.arc(-4, -5, coreR, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    // Chest circuit lines
    ctx.strokeStyle = '#00808060'; ctx.lineWidth = 1;
    for (const [x1,y1,x2,y2] of [[4,-16,4,-8],[8,-2,16,-2],[6,8,14,8],[-16,-2,-8,-2]]) {
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }

    // Belt plate
    const beltGrad = ctx.createLinearGradient(-16, 30, 16, 30);
    beltGrad.addColorStop(0, '#0e0c22');
    beltGrad.addColorStop(1, '#181430');
    rr(-16, 28, 32, 10, 4, null, null);
    ctx.fillStyle = beltGrad; ctx.fill();
    ctx.strokeStyle = '#201c38'; ctx.lineWidth = 1; ctx.stroke();
    // Belt cells
    ctx.fillStyle = '#00c8c840';
    ctx.fillRect(-12, 30, 8, 5);
    ctx.fillRect(2, 30, 8, 5);

    // ── ARM CANNON (RIGHT) ─────────────────────────────────────────
    ctx.save();
    ctx.translate(18, -12);
    ctx.rotate(armAngle);
    // Upper arm
    const uArmGrad = ctx.createLinearGradient(-5, 0, 5, 0);
    uArmGrad.addColorStop(0, '#282440');
    uArmGrad.addColorStop(1, '#201c38');
    rr(-5, -6, 16, 26, 5, null, '#3c3860', 1.5);
    ctx.fillStyle = uArmGrad; ctx.fill();
    ctx.strokeStyle = '#3c3860'; ctx.lineWidth = 1.5; ctx.stroke();
    // Elbow joint glow
    ctx.shadowColor = '#00e8e8'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#00c8c8';
    ctx.beginPath(); ctx.arc(3, 18, 5.5, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff70';
    ctx.beginPath(); ctx.arc(1.5, 16.5, 2, 0, Math.PI*2); ctx.fill();

    // Cannon barrel assembly
    ctx.translate(armReach * 0.5, 18);
    const barrelGrad = ctx.createLinearGradient(-6, 0, 22, 0);
    barrelGrad.addColorStop(0, '#2a2648');
    barrelGrad.addColorStop(0.5, '#38346a');
    barrelGrad.addColorStop(1, '#222040');
    rr(-6, 0, 34, 18, 6, null, null);
    ctx.fillStyle = barrelGrad; ctx.fill();
    ctx.strokeStyle = '#00c8c8'; ctx.lineWidth = 1.5; ctx.stroke();
    // Barrel ridge lines
    ctx.strokeStyle = '#00404050'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(4 + i*8, 2); ctx.lineTo(4 + i*8, 16); ctx.stroke();
    }
    // Vents
    ctx.fillStyle = '#00c8c840';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(5 + i * 7, 3, 4, 7);
    }
    // Muzzle glow ring
    const muzzleR = animState === 'laser'
      ? 7 + Math.sin(p.animTimer * 25) * 2
      : animState === 'shoot' ? 7 : 3.5;
    ctx.shadowColor = animState === 'laser' ? '#ff6600' : '#00ffff';
    ctx.shadowBlur = muzzleR * 2.5;
    ctx.fillStyle = (animState === 'shoot' || animState === 'laser') ? '#ffffff' : '#00c8c8';
    ctx.beginPath(); ctx.arc(armReach + 24, 9, muzzleR, 0, Math.PI*2); ctx.fill();
    // Outer ring
    ctx.strokeStyle = animState === 'laser' ? '#ff6600' : '#00ffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(armReach + 24, 9, muzzleR + 4, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore(); // end cannon

    // ── LEFT ARM ─────────────────────────────────────────────────
    ctx.save();
    ctx.translate(-20, -10);
    ctx.rotate(-armAngle * 0.5 - bodyLean * 0.3);
    const lArmGrad = ctx.createLinearGradient(-6, 0, 6, 0);
    lArmGrad.addColorStop(0, '#161230');
    lArmGrad.addColorStop(1, '#1c1838');
    rr(-6, -5, 14, 20, 5, null, '#201c38', 1.5);
    ctx.fillStyle = lArmGrad; ctx.fill();
    ctx.strokeStyle = '#201c38'; ctx.lineWidth = 1.5; ctx.stroke();
    // Forearm
    ctx.translate(0, 20);
    rr(-5, 0, 13, 18, 4, '#120e28', '#1c1830', 1);
    // Wrist energy band
    ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#00c8c8';
    ctx.fillRect(-3, 15, 9, 4);
    ctx.shadowBlur = 0;
    ctx.restore(); // end left arm

    ctx.restore(); // end torso

    // ── HEAD ──────────────────────────────────────────────────────
    ctx.save();
    ctx.translate(0, -105);
    ctx.rotate(bodyLean * 0.55 + headTilt);

    // Neck
    rr(-5, 8, 10, 12, 3, '#141228', '#201c38', 1);

    // Helmet outer
    const helmGrad = ctx.createLinearGradient(-14, -20, 14, 8);
    helmGrad.addColorStop(0, '#1e1a34');
    helmGrad.addColorStop(1, '#161230');
    rr(-14, -18, 28, 30, 8, null, '#2c2850', 2);
    ctx.fillStyle = helmGrad; ctx.fill();
    ctx.strokeStyle = '#2c2850'; ctx.lineWidth = 2; ctx.stroke();

    // Helmet top ridge
    ctx.fillStyle = '#252040';
    rr(-10, -20, 20, 5, 3, '#252040', null);

    // Visor
    const visorGrad = ctx.createLinearGradient(-10, -12, 10, -2);
    visorGrad.addColorStop(0, '#00c8c845');
    visorGrad.addColorStop(1, '#00c8c820');
    rr(-10, -12, 20, 12, 4, null, '#00c8c8', 1.5);
    ctx.fillStyle = visorGrad; ctx.fill();
    ctx.strokeStyle = '#00c8c8'; ctx.lineWidth = 1.5; ctx.stroke();
    // Visor inner reflection shine
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rr(-9, -11, 8, 4, 2, 'rgba(255,255,255,0.18)', null);

    // Eyes (glowing)
    ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#00ffff';
    ctx.beginPath(); ctx.ellipse(-4, -6, 3, 2, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, -6, 3, 2, 0, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    // Eye highlight sparkle
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(-5.5, -7, 1, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(3.5, -7, 1, 0, Math.PI*2); ctx.fill();

    // White hair — stylized flowing wisps
    ctx.fillStyle = '#f0eaf8';
    // Main swept tuft
    ctx.beginPath();
    ctx.moveTo(-13, -15);
    ctx.bezierCurveTo(-22, -35, -12, -42, -4, -38);
    ctx.bezierCurveTo(2, -34, 4, -22, 2, -16);
    ctx.lineTo(-4, -16);
    ctx.closePath();
    ctx.fill();
    // Side wisp
    ctx.beginPath();
    ctx.moveTo(2, -16);
    ctx.bezierCurveTo(8, -30, 16, -28, 16, -20);
    ctx.bezierCurveTo(16, -15, 12, -13, 8, -13);
    ctx.closePath();
    ctx.fill();
    // Hair inner shadow
    ctx.fillStyle = '#c0b8d040';
    ctx.beginPath();
    ctx.moveTo(-11, -17);
    ctx.bezierCurveTo(-14, -28, -8, -35, -2, -30);
    ctx.lineTo(-2, -18);
    ctx.closePath();
    ctx.fill();

    // Antenna (glowing)
    ctx.shadowColor = '#00c8c8'; ctx.shadowBlur = 8;
    ctx.strokeStyle = '#00e0e0'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(9, -15); ctx.lineTo(16, -32); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 12;
    ctx.fillStyle = '#00ffff';
    ctx.beginPath(); ctx.arc(16, -33, 4, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    // Antenna orb inner shine
    ctx.fillStyle = '#ffffff80';
    ctx.beginPath(); ctx.arc(14.5, -34.5, 1.5, 0, Math.PI*2); ctx.fill();

    ctx.restore(); // end head

    // ── DASH AFTERBURN ──────────────────────────────────────────────
    if (animState === 'dash' && dashTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(dashTimer * 4, 0.55);
      const grad = ctx.createLinearGradient(-60, 0, 0, 0);
      grad.addColorStop(0, 'rgba(0,200,200,0)');
      grad.addColorStop(0.7, 'rgba(0,200,200,0.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0.7)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(-28, -55, 30, 18, 0, 0, Math.PI*2);
      ctx.fill();
      // Speed lines
      ctx.strokeStyle = '#00ffff80';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        const ly = -90 + i * 18;
        const lx = -20 - Math.random() * 25;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx - 30, ly); ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore(); // end main transform
  }

  drawIronCrusher(ctx, b) {
    const footX = b.x + b.width / 2;
    const footY = b.y + b.height;

    // Bobbing/shaking based on state
    let bob;
    let drillRot = 0;
    const shoulderY = -100;
    let rightArmAngle;
    let leftArmAngle;

    if (b.state === 'SLAM_PREP') {
      bob = -15; // raising up
      rightArmAngle = -1.8; // raised high
      leftArmAngle = -1.8;
    } else if (b.state === 'SLAM_DOWN') {
      bob = 10; // squatting down
      rightArmAngle = 1.2; // slammed down
      leftArmAngle = 1.2;
    } else if (b.state === 'RECOVER') {
      bob = 8; // panting / vulnerable
      rightArmAngle = 0.5;
      leftArmAngle = -0.5;
      // panting movement
      bob += Math.sin(Date.now() / 100) * 4;
    } else if (b.state === 'DRILL_CHARGE') {
      bob = Math.sin(Date.now() / 30) * 2; // high frequency vibrations
      rightArmAngle = -0.8; // drill pointing forward
      leftArmAngle = 0.4;
      drillRot = Date.now() / 20; // fast spin
    } else {
      // idle or march
      bob = Math.sin(Date.now() / 250) * 3;
      rightArmAngle = 0.2 + Math.sin(Date.now() / 250) * 0.1;
      leftArmAngle = -0.2 - Math.sin(Date.now() / 250) * 0.1;
    }

    ctx.save();
    ctx.translate(footX, footY + bob);
    ctx.scale(b.facing, 1); // Flip horizontally depending on facing direction

    const color = (c) => (b.hitFlash > 0.05 ? '#ffffff' : c);

    const rr = (x, y, w, h, r, fillCol, strokeCol, strokeW) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      if (fillCol) {
        ctx.fillStyle = color(fillCol);
        ctx.fill();
      }
      if (strokeCol) {
        ctx.strokeStyle = color(strokeCol);
        ctx.lineWidth = strokeW || 2;
        ctx.stroke();
      }
    };

    // ─── SHADOW ───
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(0, 0, 70, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ─── LEGS & FEET ───
    // Left Leg (Back Leg)
    ctx.save();
    ctx.translate(-35, -20);
    rr(-12, -15, 24, 30, 4, '#242220', '#3b3734', 2); // thigh
    rr(-10, 15, 20, 20, 3, '#1c1a18', '#2b2926', 2);  // shin
    rr(-18, 30, 36, 12, 4, '#151312', '#22201e', 3);  // foot plate
    // Hydraulic piston
    ctx.strokeStyle = color('#4d4845'); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 20); ctx.stroke();
    ctx.restore();

    // Right Leg (Front Leg)
    ctx.save();
    ctx.translate(35, -20);
    rr(-12, -15, 24, 30, 4, '#2d2a27', '#48433e', 2); // thigh
    rr(-10, 15, 20, 20, 3, '#22201d', '#33302b', 2);  // shin
    rr(-18, 30, 36, 12, 4, '#1b1a18', '#2d2a27', 3);  // foot plate
    // Hydraulic piston
    ctx.strokeStyle = color('#5c5652'); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 20); ctx.stroke();
    ctx.restore();

    // ─── BACK ARM (LEFT ARM) ───
    ctx.save();
    ctx.translate(-45, shoulderY);
    ctx.rotate(leftArmAngle);
    // Upper arm
    rr(-12, 0, 24, 45, 5, '#22201d', '#3a3632', 2);
    // Elbow joint
    ctx.fillStyle = color('#55504a'); ctx.beginPath(); ctx.arc(0, 45, 8, 0, Math.PI*2); ctx.fill();
    // Forearm / Giant Shield Fist
    ctx.translate(0, 45);
    rr(-18, 0, 36, 45, 6, '#181715', '#2a2824', 3);
    // Spikes on fist
    ctx.fillStyle = color('#7d756d');
    ctx.beginPath();
    ctx.moveTo(-15, 45); ctx.lineTo(-18, 55); ctx.lineTo(-5, 45);
    ctx.moveTo(15, 45); ctx.lineTo(18, 55); ctx.lineTo(5, 45);
    ctx.fill();
    ctx.restore();

    // ─── TORSO ───
    // Heavy back plates
    rr(-55, -115, 110, 85, 12, '#1b1918', '#2d2b29', 3);
    // Main heavy chest plate
    rr(-48, -110, 96, 75, 10, '#36322f', '#5e5651', 3);
    // Bolt details
    ctx.fillStyle = color('#7d756d');
    ctx.beginPath();
    ctx.arc(-40, -100, 3, 0, Math.PI*2);
    ctx.arc(40, -100, 3, 0, Math.PI*2);
    ctx.arc(-40, -45, 3, 0, Math.PI*2);
    ctx.arc(40, -45, 3, 0, Math.PI*2);
    ctx.fill();

    // ─── CHEST REACTOR / WEAK POINT ───
    ctx.save();
    if (b.weakPointOpen) {
      // Open hatch visual
      // Left cover door
      rr(-42, -80, 16, 40, 2, '#201d1c', '#3d3836', 1.5);
      // Right cover door
      rr(26, -80, 16, 40, 2, '#201d1c', '#3d3836', 1.5);

      // Glowing core (Level 1 blue core)
      const pulse = 16 + Math.sin(Date.now() / 80) * 4;
      ctx.shadowColor = '#00c8ff';
      ctx.shadowBlur = pulse;
      ctx.fillStyle = color('#00c8ff');
      ctx.beginPath();
      ctx.arc(0, -60, pulse, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Inner white core shine
      ctx.fillStyle = color('#ffffff');
      ctx.beginPath();
      ctx.arc(0, -60, pulse * 0.5, 0, Math.PI*2);
      ctx.fill();
    } else {
      // Closed core cover
      rr(-22, -80, 44, 40, 6, '#1a1817', '#2e2a28', 2);
      // Orange energy lines on chest
      ctx.strokeStyle = color('#ff5e00'); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-15, -60); ctx.lineTo(15, -60); ctx.stroke();
      ctx.fillStyle = color('#ff5e00');
      ctx.beginPath(); ctx.arc(0, -60, 4, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();

    // ─── FRONT ARM (RIGHT DRILL ARM) ───
    ctx.save();
    ctx.translate(45, shoulderY);
    ctx.rotate(rightArmAngle);
    // Upper arm
    rr(-12, 0, 24, 45, 5, '#3d3834', '#605751', 2);
    // Elbow joint
    ctx.fillStyle = color('#756b62'); ctx.beginPath(); ctx.arc(0, 45, 9, 0, Math.PI*2); ctx.fill();
    // Forearm drill casing
    ctx.translate(0, 45);
    rr(-16, 0, 32, 35, 4, '#242220', '#423d39', 2.5);

    // Spinning Drill Bit
    ctx.save();
    ctx.translate(0, 35);
    ctx.rotate(drillRot);
    // Giant steel drill cone
    const drillGrad = ctx.createLinearGradient(-18, 0, 18, 45);
    drillGrad.addColorStop(0, '#59534d');
    drillGrad.addColorStop(0.5, '#aba096');
    drillGrad.addColorStop(1, '#3b3835');
    ctx.fillStyle = color(drillGrad);
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(18, 0);
    ctx.lineTo(0, 50); // Cone point
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color('#d4c5b6'); ctx.lineWidth = 1.5; ctx.stroke();
    // Drill spiral ridges
    ctx.strokeStyle = color('#3d3835'); ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-12, 10); ctx.quadraticCurveTo(0, 15, 12, 10);
    ctx.moveTo(-8, 25); ctx.quadraticCurveTo(0, 30, 8, 25);
    ctx.moveTo(-4, 38); ctx.quadraticCurveTo(0, 41, 4, 38);
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // end front arm

    // ─── HEAD ───
    ctx.save();
    ctx.translate(0, -112);
    // Neck collar
    rr(-18, -4, 36, 10, 3, '#22201d', '#3d3833', 2);
    // Main head helmet
    rr(-15, -28, 30, 26, 6, '#3a3632', '#6b6158', 2);
    // Visor plate
    rr(-11, -21, 22, 9, 2, '#181715', '#2d2a26', 1.5);
    // Glowing mono-eye
    const eyePulse = 5 + Math.sin(Date.now() / 60) * 1.5;
    const eyeColor = (b.state === 'DRILL_CHARGE' || b.hp / b.maxHp < 0.3) ? '#ff5e00' : '#ff2200';
    ctx.shadowColor = eyeColor;
    ctx.shadowBlur = eyePulse;
    ctx.fillStyle = color(eyeColor);
    ctx.beginPath();
    ctx.arc(0, -16, 3.5, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.restore(); // end main transform
  }

  drawVoltageQueen(ctx, b) {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;

    // Bobbing and rotation based on state
    let bob = Math.sin(Date.now() / 150) * 6;
    let wingAngle = Math.sin(Date.now() / 120) * 0.15;
    let coreGlow = 10 + Math.sin(Date.now() / 50) * 3;
    let hoverFlameScale = 1.0 + Math.sin(Date.now() / 40) * 0.25;

    ctx.save();
    ctx.translate(cx, cy + bob);
    ctx.scale(b.facing, 1); // Flip horizontally depending on facing direction

    const color = (c) => (b.hitFlash > 0.05 ? '#ffffff' : c);

    const rr = (x, y, w, h, r, fillCol, strokeCol, strokeW) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      if (fillCol) {
        ctx.fillStyle = color(fillCol);
        ctx.fill();
      }
      if (strokeCol) {
        ctx.strokeStyle = color(strokeCol);
        ctx.lineWidth = strokeW || 1.5;
        ctx.stroke();
      }
    };

    // ─── LEVITATION THRUSTER FLAME ───
    ctx.save();
    ctx.translate(0, 35);
    ctx.scale(hoverFlameScale, hoverFlameScale);
    const flameGrad = ctx.createLinearGradient(0, 0, 0, 40);
    flameGrad.addColorStop(0, 'rgba(0, 255, 255, 0.85)');
    flameGrad.addColorStop(0.4, 'rgba(160, 32, 240, 0.6)');
    flameGrad.addColorStop(1, 'rgba(160, 32, 240, 0)');
    ctx.fillStyle = color(flameGrad);
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(15, 0);
    ctx.quadraticCurveTo(20, 25, 0, 45);
    ctx.quadraticCurveTo(-20, 25, -15, 0);
    ctx.fill();
    ctx.restore();

    // ─── WINGS (LEFT & RIGHT) ───
    // Back Wing (Left Wing, drawn behind body)
    ctx.save();
    ctx.translate(-22, -10);
    ctx.rotate(-wingAngle - 0.2);
    // Main wing structure
    rr(-55, -20, 50, 40, 5, '#1e0c2a', '#a020f0', 2);
    // Glowing neon lines on wing
    ctx.strokeStyle = color('#ff00ff'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-45, -10); ctx.lineTo(-15, -10); ctx.lineTo(-10, 10); ctx.stroke();
    // Wing tip neon feather
    ctx.fillStyle = color('#a020f0');
    ctx.beginPath(); ctx.moveTo(-50, -5); ctx.lineTo(-65, -15); ctx.lineTo(-45, 10); ctx.fill();
    ctx.restore();

    // Front Wing (Right Wing, in front of body)
    ctx.save();
    ctx.translate(22, -10);
    ctx.rotate(wingAngle + 0.2);
    // Main wing structure
    rr(5, -20, 50, 40, 5, '#29143a', '#a020f0', 2);
    // Glowing neon lines on wing
    ctx.strokeStyle = color('#00ffff'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(45, -10); ctx.lineTo(15, -10); ctx.lineTo(10, 10); ctx.stroke();
    // Wing tip neon feather
    ctx.fillStyle = color('#00ffff');
    ctx.beginPath(); ctx.moveTo(50, -5); ctx.lineTo(65, -15); ctx.lineTo(45, 10); ctx.fill();
    ctx.restore();

    // ─── LOWER LEVITATOR UNIT (REPLACES LEGS) ───
    rr(-15, 15, 30, 25, 4, '#1b122c', '#362254', 2); // waist collar
    rr(-10, 30, 20, 12, 3, '#100a1c', '#201438', 1.5); // thruster bell nozzle

    // ─── MAIN TORSO ───
    // Sleek white and purple plating
    rr(-24, -30, 48, 50, 8, '#241a3a', '#54367c', 2); // chest base
    rr(-18, -25, 36, 40, 6, '#e0d8f0', '#ffffff', 1.5); // front breastplate cover

    // Glowing core reactor
    ctx.save();
    ctx.shadowColor = '#a020f0';
    ctx.shadowBlur = coreGlow;
    ctx.fillStyle = color(b.shieldActive ? '#a020f0' : '#00ffff');
    ctx.beginPath();
    ctx.arc(0, -2, 9, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Inner reactor ring
    ctx.strokeStyle = color('#ffffff'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, -2, 5, 0, Math.PI*2); ctx.stroke();
    ctx.restore();

    // Shoulder pads
    rr(-30, -32, 12, 12, 3, '#1b122c', '#a020f0', 1.5); // left shoulder
    rr(18, -32, 12, 12, 3, '#1b122c', '#a020f0', 1.5); // right shoulder

    // Sleek pointer arms
    ctx.save();
    ctx.translate(-24, -20);
    ctx.rotate(0.4 + Math.sin(Date.now() / 200) * 0.1);
    rr(-4, 0, 8, 28, 2.5, '#100a1c', '#a020f0', 1);
    ctx.restore();

    ctx.save();
    ctx.translate(24, -20);
    ctx.rotate(-0.4 - Math.sin(Date.now() / 200) * 0.1);
    rr(-4, 0, 8, 28, 2.5, '#100a1c', '#a020f0', 1);
    ctx.restore();

    // ─── HEAD & CROWN ───
    ctx.save();
    ctx.translate(0, -42);
    // Neck collar
    rr(-10, -4, 20, 8, 2, '#150d24', '#331d54', 1.5);
    // Helmet
    rr(-13, -24, 26, 22, 5, '#1b122c', '#54367c', 1.5);
    // Visor mask (sleek cyber V shape)
    ctx.fillStyle = color('#a020f0');
    ctx.beginPath();
    ctx.moveTo(-10, -18);
    ctx.lineTo(10, -18);
    ctx.lineTo(5, -8);
    ctx.lineTo(-5, -8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color('#ff00ff'); ctx.lineWidth = 1; ctx.stroke();

    // Visor eye light
    ctx.fillStyle = color('#ffffff');
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.arc(0, -13, 2, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    // Cyber Crown Visor (Spikes sticking up)
    ctx.fillStyle = color('#d8b4fe');
    ctx.strokeStyle = color('#a020f0');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-12, -24); ctx.lineTo(-14, -34); ctx.lineTo(-7, -26);
    ctx.moveTo(12, -24); ctx.lineTo(14, -34); ctx.lineTo(7, -26);
    ctx.moveTo(-4, -25); ctx.lineTo(0, -38); ctx.lineTo(4, -25);
    ctx.fill(); ctx.stroke();

    ctx.restore(); // end head

    ctx.restore(); // end main transform
  }

  render() {
    const ctx = this.ctx;
    const camX = this.camera.x;
    const camY = this.camera.y;

    // Apply Camera Shake offset
    ctx.save();
    if (this.camera.shake > 0) {
      const shakeX = (Math.random() - 0.5) * this.camera.shake;
      const shakeY = (Math.random() - 0.5) * this.camera.shake;
      ctx.translate(shakeX, shakeY);
    }

    // 1. Clear Canvas / Draw Parallax Background
    ctx.fillStyle = '#06050b';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Parallax background layer
    if (this.gameState === 'TRANSITION') {
      // Use corridor background during transition
      const corridorBg = getAsset('/assets/boss_level1/transition/bg_corridor.png');
      if (corridorBg.complete) {
        const bgX = -(camX * 0.3) % CANVAS_WIDTH;
        ctx.drawImage(corridorBg, bgX, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.drawImage(corridorBg, bgX + CANVAS_WIDTH, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.drawImage(corridorBg, bgX + CANVAS_WIDTH * 2, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
    } else {
      const bgImg = this.level === 1 ? getAsset('/assets/boss_level1/background/bg_scrapyard.png') : getAsset('/assets/boss_level2/background/bg_neon_lab.png');
      if (bgImg.complete) {
        const bgX = -(camX * 0.3) % CANVAS_WIDTH;
        ctx.drawImage(bgImg, bgX, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.drawImage(bgImg, bgX + CANVAS_WIDTH, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      } else {
        ctx.strokeStyle = '#150f24';
        ctx.lineWidth = 1;
        const gridOffset = -(camX * 0.4) % 40;
        for (let x = gridOffset; x < CANVAS_WIDTH; x += 40) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_HEIGHT); ctx.stroke();
        }
      }
    }

    // 2. Draw Floor
    const floorDrawWidth = this.gameState === 'TRANSITION' ? this.transitionLevelWidth : CANVAS_WIDTH;

    if (this.gameState === 'TRANSITION') {
      // Tiled floor_corridor.png during transition
      const floorImg = getAsset('/assets/boss_level1/transition/floor_corridor.png');
      if (floorImg.complete) {
        const floorH = CANVAS_HEIGHT - this.floorY;
        const tileW = 512;
        const startX = -((camX) % tileW) - tileW;
        for (let x = startX; x < CANVAS_WIDTH + tileW; x += tileW) {
          ctx.drawImage(floorImg, x, this.floorY, tileW, floorH);
        }
      } else {
        ctx.fillStyle = '#18141d';
        ctx.fillRect(0, this.floorY, CANVAS_WIDTH, CANVAS_HEIGHT - this.floorY);
      }
    } else {
      if (this.level === 1) {
        const floorImg = getAsset('/assets/boss_level1/floor/floor_scrapyard.png');
        if (floorImg.complete) {
          ctx.drawImage(floorImg, -camX, this.floorY, CANVAS_WIDTH, CANVAS_HEIGHT - this.floorY);
        } else {
          ctx.fillStyle = '#18141d';
          ctx.fillRect(-camX, this.floorY, CANVAS_WIDTH, CANVAS_HEIGHT - this.floorY);
        }
      } else {
        let floorImgPath = '/assets/boss_level2/floor/floor_neon.png';
        if (this.magneticFloorState === 'WARNING') floorImgPath = '/assets/boss_level2/floor/floor_neon_warning.png';
        if (this.magneticFloorState === 'ELECTRIFIED') floorImgPath = '/assets/boss_level2/floor/floor_neon_electrified.png';
        
        const floorImg = getAsset(floorImgPath);
        if (floorImg.complete) {
          ctx.drawImage(floorImg, -camX, this.floorY, floorDrawWidth + CANVAS_WIDTH, CANVAS_HEIGHT - this.floorY);
        } else {
          ctx.fillStyle = '#0e122b';
          ctx.fillRect(-camX, this.floorY, floorDrawWidth + CANVAS_WIDTH, CANVAS_HEIGHT - this.floorY);
          ctx.strokeStyle = '#00ffff';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(-camX, this.floorY);
          ctx.lineTo(-camX + floorDrawWidth + CANVAS_WIDTH, this.floorY);
          ctx.stroke();
        }
      }
    }

    // Neon grid decoration on the floor
    if (this.level === 2) {
      // Draw warning lights on floor
      if (this.magneticFloorState === 'WARNING') {
        ctx.fillStyle = `rgba(255, 59, 48, ${Math.floor(Date.now() / 150) % 2 === 0 ? 0.35 : 0.05})`;
        ctx.fillRect(0, this.floorY, CANVAS_WIDTH, CANVAS_HEIGHT - this.floorY);
      } else if (this.magneticFloorState === 'ELECTRIFIED') {
        ctx.fillStyle = 'rgba(0, 255, 255, 0.15)';
        ctx.fillRect(0, this.floorY, CANVAS_WIDTH, CANVAS_HEIGHT - this.floorY);
        // Draw electricity sparks
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x < CANVAS_WIDTH; x += 40) {
          ctx.moveTo(x, this.floorY);
          ctx.lineTo(x + (Math.random() - 0.5) * 30, this.floorY - 15 - Math.random() * 20);
        }
        ctx.stroke();
      }
    }

    // Translate coordinates by camera position for in-game entities
    ctx.translate(-camX, -camY);

    // 3. Draw Platforms
    if (this.gameState === 'TRANSITION') {
      // Use platform_metal.png asset during transition
      const platImg = getAsset('/assets/boss_level1/transition/platform_metal.png');
      this.platforms.forEach(plat => {
        if (platImg.complete) {
          ctx.drawImage(platImg, plat.x, plat.y, plat.w, plat.h);
        } else {
          ctx.fillStyle = '#3a2d24';
          ctx.strokeStyle = '#735a49';
          ctx.lineWidth = 3;
          ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
          ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);
        }
      });
    } else {
      this.platforms.forEach(plat => {
        if (this.level === 1) {
          const platImg = getAsset('/assets/boss_level1/platform/platform_scrap.png');
          if (platImg.complete) {
            ctx.drawImage(platImg, plat.x, plat.y, plat.w, plat.h);
          } else {
            ctx.fillStyle = '#3a2d24';
            ctx.strokeStyle = '#735a49';
            ctx.lineWidth = 3;
            ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
            ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);
          }
        } else {
          const platImg = getAsset('/assets/boss_level2/platform/platform_glass.png');
          if (platImg.complete) {
            ctx.drawImage(platImg, plat.x, plat.y, plat.w, plat.h);
          } else {
            ctx.fillStyle = 'rgba(0, 255, 255, 0.4)';
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 3;
            ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
            ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);
            ctx.fillStyle = '#00ffff';
            ctx.fillRect(plat.x + 10, plat.y + plat.h/2 - 2, plat.w - 20, 4);
          }
        }
      });
    }

    // 4. Draw Overload power-up cells
    if (this.level === 2) {
      const powImg = getAsset('/assets/boss_level2/fx/fx_overload_cell.png');
      this.powerups.forEach(pow => {
        if (pow.collected) return;
        const pulse = 10 + Math.sin(pow.pulse) * 4;
        
        if (powImg.complete) {
          ctx.save();
          // Add a breathing effect using pulse
          const scale = 1 + Math.sin(pow.pulse) * 0.1;
          ctx.translate(pow.x, pow.y);
          ctx.scale(scale, scale);
          ctx.drawImage(powImg, -20, -20, 40, 40);
          ctx.restore();
        } else {
          // Outer halo
          ctx.fillStyle = 'rgba(52, 199, 89, 0.2)';
          ctx.beginPath();
          ctx.arc(pow.x, pow.y, pulse + 15, 0, Math.PI * 2);
          ctx.fill();

          // Inner glowing orb
          ctx.fillStyle = '#34c759';
          ctx.shadowColor = '#34c759';
          ctx.shadowBlur = 15;
          ctx.beginPath();
          ctx.arc(pow.x, pow.y, pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0; // reset
          
          // Metallic core icon drawing
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(pow.x - 3, pow.y - 8, 6, 16);
          ctx.fillRect(pow.x - 8, pow.y - 3, 16, 6);
        }
      });
    }

    // 4b. Draw Transition Corridor elements (hazards + portal + debris decorations)
    if (this.gameState === 'TRANSITION' && this.transitionHazards && this.transitionPortal) {
      // Draw background debris decorations
      const debrisBg1 = getAsset('/assets/boss_level1/transition/debris_bg_01.png');
      const debrisBg2 = getAsset('/assets/boss_level1/transition/debris_bg_02.png');
      if (debrisBg1.complete) {
        ctx.globalAlpha = 0.6;
        ctx.drawImage(debrisBg1, 1300, this.floorY - 70, 80, 80);
        ctx.drawImage(debrisBg1, 1900, this.floorY - 60, 70, 70);
        ctx.drawImage(debrisBg1, 2550, this.floorY - 75, 80, 80);
        ctx.globalAlpha = 1.0;
      }
      if (debrisBg2.complete) {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(debrisBg2, 1500, this.floorY - 65, 75, 75);
        ctx.drawImage(debrisBg2, 2150, this.floorY - 70, 80, 80);
        ctx.drawImage(debrisBg2, 2700, this.floorY - 55, 65, 65);
        ctx.globalAlpha = 1.0;
      }

      // Draw spike hazards using spike_trap.png
      const spikeImg = getAsset('/assets/boss_level1/transition/spike_trap.png');
      this.transitionHazards.forEach(hazard => {
        if (spikeImg.complete) {
          ctx.drawImage(spikeImg, hazard.x, hazard.y, hazard.w, hazard.h);
        } else {
          // Fallback procedural spikes
          ctx.fillStyle = '#8b0000';
          ctx.strokeStyle = '#ff4444';
          ctx.lineWidth = 2;
          const spikeCount = Math.floor(hazard.w / 20);
          for (let i = 0; i < spikeCount; i++) {
            const sx = hazard.x + i * (hazard.w / spikeCount);
            const sw = hazard.w / spikeCount;
            ctx.beginPath();
            ctx.moveTo(sx, hazard.y + hazard.h);
            ctx.lineTo(sx + sw / 2, hazard.y);
            ctx.lineTo(sx + sw, hazard.y + hazard.h);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        }
      });

      // Draw portal
      const portal = this.transitionPortal;
      const pulse = Math.sin(portal.pulseTimer) * 0.3 + 0.7;

      // Portal glow layer (behind portal)
      const portalGlow = getAsset('/assets/boss_level1/transition/portal_glow.png');
      if (portalGlow.complete) {
        ctx.save();
        ctx.globalAlpha = 0.5 + pulse * 0.3;
        const glowW = 160;
        const glowH = 200;
        ctx.drawImage(
          portalGlow,
          portal.x + portal.w / 2 - glowW / 2,
          portal.y + portal.h / 2 - glowH / 2,
          glowW,
          glowH
        );
        ctx.restore();
      }

      // Portal main sprite
      const portalImg = getAsset('/assets/boss_level1/transition/portal_nextstage.png');
      if (portalImg.complete) {
        ctx.save();
        // Slight scale pulse effect
        const scaleAmount = 1.0 + pulse * 0.03;
        ctx.translate(portal.x + portal.w / 2, portal.y + portal.h / 2);
        ctx.scale(scaleAmount, scaleAmount);
        ctx.drawImage(portalImg, -portal.w / 2, -portal.h / 2, portal.w, portal.h);
        ctx.restore();
      } else {
        // Fallback procedural portal
        ctx.save();
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 20 + pulse * 10;
        ctx.strokeStyle = `rgba(0, 255, 255, ${pulse})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(portal.x + portal.w / 2, portal.y + portal.h / 2, portal.w / 2, portal.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(160, 32, 240, ${0.2 + pulse * 0.15})`;
        ctx.fill();
        ctx.restore();
      }

      // "NEXT STAGE" text hint above portal
      ctx.fillStyle = `rgba(0, 255, 255, ${pulse})`;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('\u25B6 NEXT STAGE', portal.x + portal.w / 2, portal.y - 15);
      ctx.textAlign = 'left';
    }

    // 5. Draw Player (Zero) — Dual-Layer rendering (Image with procedural fallback)
    const p = this.player;
    
    // Player sprite rendering using PlayerAnimator
    const playerFrame = this.playerAnimator ? this.playerAnimator.getCurrentFrame() : null;

    ctx.save();
    // Blink if invulnerable
    if (p.invulnerableTimer > 0 && Math.floor(Date.now() / 60) % 2 === 0) {
      ctx.globalAlpha = 0.35;
    }

    if (playerFrame) {
      ctx.translate(p.x + p.width / 2, p.y + p.height);
      ctx.scale(p.facing, 1);

      const scale = 1.35;
      ctx.drawImage(
        playerFrame,
        -(p.width * scale) / 2,
        -(p.height * scale),
        p.width * scale,
        p.height * scale
      );
    } else {
      // Fallback to idle frame or procedural
      const fallbackImg = getAsset('/assets/boss_level1/player/idle/000.png');
      if (fallbackImg.complete) {
        ctx.translate(p.x + p.width / 2, p.y + p.height);
        ctx.scale(p.facing, 1);
        const scale = 1.35;
        ctx.drawImage(fallbackImg, -(p.width * scale) / 2, -(p.height * scale), p.width * scale, p.height * scale);
      } else {
        this.drawZeroSprite(ctx, p);
      }
    }
    ctx.restore();

    // 6. Draw Player Laser (Core Overcharge)
    if (p.isLaserActive) {
      ctx.save();
      const muzzle = this.getPlayerMuzzlePos();
      const laserRange = p.facing === 1 ? CANVAS_WIDTH - muzzle.x : muzzle.x;
      const laserStartX = p.facing === 1 ? muzzle.x : 0;
      const laserY = muzzle.y;
      
      // Dynamic height pulse (adds electric vibration feel)
      const pulseH = 24 + Math.sin(Date.now() / 20) * 4;
      
      // 6a. Draw Outer Glow
      ctx.shadowColor = '#ff3b30';
      ctx.shadowBlur = 30;
      ctx.fillStyle = 'rgba(255, 59, 48, 0.35)';
      ctx.fillRect(laserStartX, laserY - pulseH/2 - 6, laserRange, pulseH + 12);

      // 6b. Draw Laser Sprite Image
      const laserImg = getAsset('/assets/boss_level1/projectile/projectile_laser.png');
      if (laserImg.complete) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(laserImg, laserStartX, laserY - pulseH/2, laserRange, pulseH);
        ctx.restore();
      }

      // 6c. Draw Inner Core (Hot white laser core)
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(laserStartX, laserY - 4, laserRange, 8);

      // 6d. Draw Muzzle Flare/Charge Ball (Red glowing sphere at muzzle)
      const flareR = 20 + Math.sin(Date.now() / 40) * 5;
      const flareGrad = ctx.createRadialGradient(muzzle.x, muzzle.y, 2, muzzle.x, muzzle.y, flareR);
      flareGrad.addColorStop(0, '#ffffff');
      flareGrad.addColorStop(0.3, '#ff5500');
      flareGrad.addColorStop(0.8, 'rgba(255, 59, 48, 0.5)');
      flareGrad.addColorStop(1, 'rgba(255, 59, 48, 0)');
      
      ctx.shadowColor = '#ff3b30';
      ctx.shadowBlur = 20;
      ctx.fillStyle = flareGrad;
      ctx.beginPath();
      ctx.arc(muzzle.x, muzzle.y, flareR, 0, Math.PI * 2);
      ctx.fill();

      // 6e. Spawn random electric laser particles along the beam
      if (Math.random() < 0.6) {
        const randX = laserStartX + Math.random() * laserRange;
        this.particles.push({
          type: 'spark',
          x: randX,
          y: laserY + (Math.random() - 0.5) * pulseH,
          vx: (Math.random() - 0.5) * 100,
          vy: (Math.random() - 0.5) * 100,
          color: '#ffdd00', // Yellow electric spark
          life: 0.15,
          maxLife: 0.15,
          size: Math.random() * 3 + 1
        });
      }

      ctx.restore();
    }

    // 7. Draw Boss — Sprite Animation (Level 1) / Image fallback (Level 2)
    const b = this.boss;

    if (this.gameState !== 'TRANSITION' && (b.hp > 0 || (this.bossAnimator && !this.bossAnimator.isDefeatedComplete()))) {
      // Use BossAnimator sprite frames
      if (this.bossAnimator) {
        const frameImg = this.bossAnimator.getCurrentFrame();
        if (frameImg) {
          ctx.save();

          const flipX = this.level === 1 ? (b.facing === 1 ? -1 : 1) : (b.facing === -1 ? -1 : 1);
          const bob = (this.level === 2 && b.hp > 0) ? Math.sin(Date.now() / 150) * 5 : 0;

          ctx.translate(b.x + b.width / 2, b.y + b.height + bob);
          ctx.scale(flipX, 1);

          if (b.hitFlash > 0.05) {
            const offscreen = document.createElement('canvas');
            offscreen.width = b.width;
            offscreen.height = b.height;
            const offCtx = offscreen.getContext('2d');
            offCtx.drawImage(frameImg, 0, 0, b.width, b.height);
            offCtx.globalCompositeOperation = 'source-atop';
            offCtx.fillStyle = `rgba(255, 255, 255, ${Math.min(b.hitFlash, 1)})`;
            offCtx.fillRect(0, 0, b.width, b.height);
            ctx.drawImage(offscreen, -b.width / 2, -b.height);
          } else {
            ctx.drawImage(frameImg, -b.width / 2, -b.height, b.width, b.height);
          }
          ctx.restore();
        }
      }

      // Draw Voltage Queen shield visual indicator (Level 2)
      if (this.level === 2 && b.shieldActive) {
        ctx.save();
        const shieldImg = getAsset('/assets/boss_level2/fx/fx_queen_shield_aura.png');
        if (shieldImg.complete) {
          const bob = Math.sin(Date.now() / 150) * 5;
          const sW = 260; const sH = 260;
          ctx.translate(b.x + b.width/2, b.y + b.height/2 + bob);
          ctx.drawImage(shieldImg, -sW/2, -sH/2, sW, sH);
        } else {
          ctx.strokeStyle = 'rgba(160, 32, 240, 0.45)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(b.x + b.width/2, b.y + b.height/2, 130, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(160, 32, 240, 0.04)';
          ctx.beginPath();
          ctx.arc(b.x + b.width/2, b.y + b.height/2, 130, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // 8. Draw Shield Drones (Level 2)
    if (this.level === 2) {
      this.drones.forEach(d => {
        if (!d.active) return;
        ctx.save();

        if (d.hitFlash > 0.1) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(d.x, d.y, d.width, d.height);
        } else {
          // Drone body
          const frameIdx = Math.floor(Date.now() / 150) % 8;
          const droneImg = getAsset(`/assets/boss_level2/drone/00${frameIdx}.png`, true);
          if (droneImg.complete) {
            const canvasToDraw = droneImg.canvas || droneImg;
            ctx.drawImage(canvasToDraw, d.x - 16, d.y - 16, 64, 64);
          } else {
            ctx.fillStyle = '#1e0b2e';
            ctx.strokeStyle = '#a020f0';
            ctx.lineWidth = 2;
            ctx.fillRect(d.x, d.y, d.width, d.height);
            ctx.strokeRect(d.x, d.y, d.width, d.height);

            // Glowing purple eye
            ctx.fillStyle = '#e0aaff';
            ctx.fillRect(d.x + 10, d.y + 10, 12, 12);
          }
        }
        ctx.restore();
      });
    }

    // 9. Draw Diagonal Lasers (Level 2 Boss laser sweep)
    if (this.level === 2 && this.laserActive) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 59, 48, 0.8)';
      ctx.lineWidth = 6;
      ctx.shadowColor = '#ff3b30';
      ctx.shadowBlur = 15;

      const corners = [
        { x: camX, y: 0 },
        { x: camX + CANVAS_WIDTH, y: 0 },
        { x: camX, y: this.floorY },
        { x: camX + CANVAS_WIDTH, y: this.floorY }
      ];

      corners.forEach(c => {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(b.x + b.width/2, b.y + b.height/2);
        ctx.stroke();
      });

      // Safe zone marker overlay
      ctx.strokeStyle = 'rgba(52, 199, 89, 0.3)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.strokeRect(camX + CANVAS_WIDTH/2 - 80, 0, 160, this.floorY);
      ctx.restore();
    }

    // 10. Draw Projectiles & Shockwaves
    this.bullets.forEach(bul => {
      if (bul.isPlayer) {
        ctx.save();
        const cx = bul.x + bul.w / 2;
        const cy = bul.y + bul.h / 2;
        const r  = bul.w / 2;

        // 10a. Outer soft glow halo
        const haloGrad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.2);
        haloGrad.addColorStop(0,   'rgba(0,255,255,0.55)');
        haloGrad.addColorStop(0.5, 'rgba(0,180,255,0.18)');
        haloGrad.addColorStop(1,   'rgba(0,80,255,0)');
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
        ctx.fill();

        // 10b. Draw plasma orb image with additive blending (dark bg vanishes)
        const plasmaImg = getAsset('/assets/boss_level1/projectile/projectile_plasma.png');
        if (plasmaImg.complete) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter'; // additive – dark bg becomes invisible
          ctx.translate(cx, cy);
          if (bul.vx < 0) ctx.scale(-1, 1);
          // subtle spin for energy feel
          ctx.rotate((Date.now() / 120) % (Math.PI * 2));
          ctx.drawImage(plasmaImg, -r, -r, bul.w, bul.h);
          ctx.restore();
        }

        // 10c. Bright white core dot
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      } else {
        ctx.fillStyle = '#00ffff';
        ctx.fillRect(bul.x, bul.y, bul.w, bul.h);
      }
    });

    // Level 1 shockwave
    this.shockwaves.forEach(sw => {
      const swImg = getAsset('/assets/boss_level1/fx/fx_shockwave.png');
      if (swImg.complete) {
        ctx.save();
        if (sw.vx > 0) {
          ctx.translate(sw.x + sw.w, sw.y + sw.h / 2);
          ctx.scale(-1, 1);
          ctx.drawImage(swImg, 0, -sw.h / 2, sw.w, sw.h);
        } else {
          ctx.drawImage(swImg, sw.x, sw.y, sw.w, sw.h);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = '#ffa500';
        ctx.fillRect(sw.x, sw.y, sw.w, sw.h);
      }
    });

    // Level 1 falling debris
    this.debris.forEach(deb => {
      const debImg = getAsset('/assets/boss_level1/fx/fx_debris_metal.png');
      ctx.save();
      ctx.translate(deb.x + deb.w / 2, deb.y + deb.h / 2);
      ctx.rotate(deb.angle);
      if (debImg.complete) {
        ctx.drawImage(debImg, -deb.w / 2, -deb.h / 2, deb.w, deb.h);
      } else {
        ctx.fillStyle = '#4a3f35';
        ctx.strokeStyle = '#857564';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-deb.w / 2, deb.h / 2);
        ctx.lineTo(deb.w / 2, deb.h / 2);
        ctx.lineTo(0, -deb.h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    });

    // 11. Draw Particles
    this.particles.forEach(part => {
      ctx.save();
      if (part.type === 'ghost') {
        ctx.globalAlpha = part.alpha * 0.45;
        const runFrameImg = getAsset('/assets/boss_level1/player/run/000.png');
        const basePlayerImg = getAsset('/assets/boss_level1/player/idle/000.png');
        let imgToDraw = runFrameImg.complete ? runFrameImg : (basePlayerImg.complete ? basePlayerImg : null);
        if (imgToDraw) {
          ctx.translate(part.x, part.y + part.h / 2);
          ctx.scale(part.facing, 1);
          const scale = 1.35;
          ctx.drawImage(imgToDraw, -(part.w * scale) / 2, -(part.h * scale), part.w * scale, part.h * scale);
        }
      } else if (part.type === 'drill_exhaust') {
        ctx.globalAlpha = part.life / part.maxLife;
        const img = getAsset('/assets/boss_level1/fx/fx_drill_exhaust.png');
        if (img.complete) {
          ctx.translate(part.x + 24, part.y + 16);
          if (part.flip === -1) ctx.scale(-1, 1);
          ctx.drawImage(img, -24, -16, 48, 32);
        }
      } else if (part.type === 'slam_impact') {
        ctx.globalAlpha = part.life / part.maxLife;
        const img = getAsset('/assets/boss_level1/fx/fx_slam_impact.png');
        if (img.complete) {
          const s = 1 + (1 - part.life / part.maxLife) * 0.3;
          ctx.translate(part.x + 40, part.y + 20);
          ctx.scale(s, s);
          ctx.drawImage(img, -40, -20, 80, 40);
        }
      } else if (part.type === 'dust_cloud') {
        ctx.globalAlpha = (part.life / part.maxLife) * 0.7;
        const img = getAsset('/assets/boss_level1/fx/fx_dust_cloud.png');
        if (img.complete) {
          const s = 1 + (1 - part.life / part.maxLife) * 0.5;
          ctx.translate(part.x + 24, part.y + 12);
          ctx.scale(s, s);
          ctx.drawImage(img, -24, -12, 48, 24);
        }
      } else if (part.type === 'weak_point_glow') {
        const pulse = Math.sin(Date.now() / 100) * 0.3 + 0.7;
        ctx.globalAlpha = pulse;
        const img = getAsset('/assets/boss_level1/fx/fx_weak_point_glow.png');
        if (img.complete && part.bossRef) {
          const bx = part.bossRef.x + part.bossRef.width / 2;
          const by = part.bossRef.y + part.bossRef.height / 2;
          const s = 0.9 + pulse * 0.2;
          ctx.translate(bx, by);
          ctx.scale(s, s);
          ctx.drawImage(img, -24, -24, 48, 48);
        }
      } else if (part.type === 'drill_spin') {
        ctx.globalAlpha = part.life / part.maxLife;
        const img = getAsset('/assets/boss_level1/fx/fx_drill_spin.png');
        if (img.complete && part.bossRef) {
          const bx = part.bossRef.x + (part.bossRef.facing === -1 ? -10 : part.bossRef.width - 38);
          const by = part.bossRef.y + part.bossRef.height / 2 - 24;
          ctx.translate(bx + 24, by + 24);
          ctx.rotate((Date.now() / 30) % (Math.PI * 2));
          ctx.drawImage(img, -24, -24, 48, 48);
        }
      } else if (part.type === 'shield_block') {
        ctx.globalAlpha = part.life / part.maxLife;
        const img = getAsset('/assets/boss_level2/fx/fx_shield_block.png', true);
        if (img.complete) {
          const s = 1 + (1 - part.life / part.maxLife) * 0.5;
          ctx.translate(part.x, part.y);
          ctx.scale(s, s);
          ctx.drawImage(img.canvas || img, -32, -32, 64, 64);
        }
      } else if (part.type === 'drone_explosion') {
        ctx.globalAlpha = part.life / part.maxLife;
        const img = getAsset('/assets/boss_level2/fx/fx_drone_explosion.png', true);
        if (img.complete) {
          const s = 1 + (1 - part.life / part.maxLife);
          ctx.translate(part.x, part.y);
          ctx.scale(s, s);
          ctx.drawImage(img.canvas || img, -48, -48, 96, 96);
        }
      } else if (part.type === 'emp_blast') {
        ctx.globalAlpha = (part.life / part.maxLife) * 0.8;
        const img = getAsset('/assets/boss_level2/fx/fx_emp_blast.png', true);
        if (img.complete) {
          const s = 1 + (1 - part.life / part.maxLife) * 2;
          ctx.translate(part.x, part.y);
          ctx.scale(s, s);
          ctx.drawImage(img.canvas || img, -128, -128, 256, 256);
        }
      } else {
        // Standard sparks
        ctx.globalAlpha = part.life / part.maxLife;
        
        if (part.color === '#a020f0' || part.color === '#00ffff') {
           const img = getAsset('/assets/boss_level2/fx/fx_electric_spark.png', true);
           if (img.complete && Math.random() > 0.3) {
              ctx.drawImage(img.canvas || img, part.x - 8, part.y - 8, 16, 16);
           } else {
              ctx.fillStyle = part.color;
              ctx.fillRect(part.x - part.size / 2, part.y - part.size / 2, part.size, part.size);
           }
        } else {
           ctx.fillStyle = part.color;
           ctx.fillRect(part.x - part.size / 2, part.y - part.size / 2, part.size, part.size);
        }
      }
      ctx.restore();
    });

    ctx.restore(); // Undo camera translation

    // 12. Draw White Screen Flash (Defeat explosion / level load effect)
    if (this.whiteFlashAlpha > 0.01) {
      ctx.fillStyle = `rgba(255, 255, 255, ${this.whiteFlashAlpha})`;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }
}
