import { getAsset } from './GameEngine';

const BOSS_ANIMATIONS = {
  1: {
    idle: { frames: 6, fps: 4, loop: true },
    march: { frames: 8, fps: 5, loop: true },
    slamepreap: { frames: 6, fps: 5, loop: false },
    slamedown: { frames: 4, fps: 6, loop: false },
    recover: { frames: 6, fps: 3, loop: true },
    drillcharge: { frames: 6, fps: 6, loop: false },
    drillrush: { frames: 4, fps: 7, loop: true },
    hitdmg: { frames: 2, fps: 5, loop: false },
    defeated: { frames: 8, fps: 4, loop: false },
  },
  2: {
    floatidle: { frames: 8, fps: 5, loop: true },
    hit_damage: { frames: 2, fps: 5, loop: false },
    laser: { frames: 6, fps: 6, loop: false },
    shileld_broken: { frames: 4, fps: 4, loop: false },
    defeated: { frames: 8, fps: 4, loop: false },
  }
};

/**
 * Maps GameEngine boss AI states → animation folder names.
 */
const STATE_TO_ANIM_1 = {
  'IDLE': 'idle',
  'MARCH': 'march',
  'SLAM_PREP': 'slamepreap',
  'SLAM_DOWN': 'slamedown',
  'RECOVER': 'recover',
  'DRILL_CHARGE': 'drillcharge',
  'DRILL_RUSH': 'drillrush',
};

const STATE_TO_ANIM_2 = {
  'FLOAT': 'floatidle',
  'MAGNETIC_FLOOR': 'floatidle',
  'LASER_SWEEP': 'laser',
};

export class BossAnimator {
  constructor(level = 1) {
    this.level = level;
    this.frameCache = {};
    this.currentAnim = level === 1 ? 'idle' : 'floatidle';
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.finished = false;

    // Hit interrupt state
    this.hitAnimActive = false;
    this.previousAnim = null;
    this.hitTimer = 0;

    // Defeated flag (one-way)
    this.isDefeated = false;

    this.preloadAll();
  }

  preloadAll() {
    const configMap = BOSS_ANIMATIONS[this.level];
    for (const [animName, config] of Object.entries(configMap)) {
      for (let i = 0; i < config.frames; i++) {
        const padded = String(i).padStart(3, '0');
        const key = `${animName}_${padded}`;
        const srcPath = this.level === 1 
          ? `/assets/boss_level1/boss_iron_crusher/${animName}/${padded}.png`
          : `/assets/boss_level2/boss_voltage_queen/${animName}/${padded}.png`;
        
        // Trigger getAsset to start preloading without chroma key (PNGs already have alpha)
        this.frameCache[key] = { srcPath, chroma: false }; 
      }
    }
  }

  /**
   * Sync animation to the current boss AI state.
   * Only changes animation when the AI state actually changes.
   */
  setBossState(bossState) {
    if (this.hitAnimActive || this.isDefeated) return;

    let animKey = this.level === 1 ? (STATE_TO_ANIM_1[bossState] || 'idle') : (STATE_TO_ANIM_2[bossState] || 'floatidle');
    // If shield broken for boss 2
    if (this.level === 2 && bossState === 'SHIELD_BROKEN') {
      animKey = 'shileld_broken';
    }
    if (animKey !== this.currentAnim) {
      this.currentAnim = animKey;
      this.currentFrame = 0;
      this.frameTimer = 0;
      this.finished = false;
    }
  }

  /**
   * Play the hitdmg animation briefly, then return to previous state.
   */
  triggerHit() {
    if (this.isDefeated || this.hitAnimActive) return;
    
    // Check if the current animation is NOT hitdmg or hit_damage to save the correct previous state
    if (this.currentAnim !== 'hitdmg' && this.currentAnim !== 'hit_damage') {
      this.previousAnim = this.currentAnim;
    }
    
    this.currentAnim = this.level === 1 ? 'hitdmg' : 'hit_damage';
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.finished = false;
    this.hitAnimActive = true;
    this.hitTimer = 0.5; // 0.5 sec hit interrupt
  }

  /**
   * Play the defeated animation (irreversible).
   */
  triggerDefeated() {
    if (this.isDefeated) return;
    this.isDefeated = true;
    this.hitAnimActive = false;
    this.currentAnim = 'defeated';
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.finished = false;
  }

  /**
   * Advance frame timer each game tick.
   */
  update(dt) {
    const config = BOSS_ANIMATIONS[this.level][this.currentAnim];
    if (!config) return;

    // Hit animation auto-return (must run even if animation is finished)
    if (this.hitAnimActive) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) {
        this.hitAnimActive = false;
        if (this.previousAnim) {
          this.currentAnim = this.previousAnim;
          this.currentFrame = 0;
          this.frameTimer = 0;
          this.finished = false;
          this.previousAnim = null;
        }
        return;
      }
    }

    if (this.finished && !config.loop) return;

    this.frameTimer += dt;
    const frameDuration = 1 / config.fps;

    while (this.frameTimer >= frameDuration) {
      this.frameTimer -= frameDuration;
      this.currentFrame++;

      if (this.currentFrame >= config.frames) {
        if (config.loop) {
          this.currentFrame = 0;
        } else {
          this.currentFrame = config.frames - 1;
          this.finished = true;
          break;
        }
      }
    }
  }

  /**
   * Returns the current frame's Image or Canvas element (or null if not loaded).
   */
  getCurrentFrame() {
    const padded = String(this.currentFrame).padStart(3, '0');
    const key = `${this.currentAnim}_${padded}`;
    const frameObj = this.frameCache[key];
    if (frameObj) {
      const asset = getAsset(frameObj.srcPath, frameObj.chroma);
      if (asset && asset.complete) {
        return asset.canvas || asset; // If chroma key enabled, it returns canvas
      }
    }
    return null;
  }

  getCurrentAnimName() {
    return this.currentAnim;
  }

  isDefeatedComplete() {
    return this.isDefeated && this.finished;
  }
}
