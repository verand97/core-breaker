// PlayerAnimator.js - Sprite-based animation system for Player "Zero"
// Uses frame sequences from /assets/boss_level1/player/<animation>/<frame>.png

const PLAYER_ANIMATIONS = {
  idle: { frames: 6, fps: 3, loop: true },
  run: { frames: 8, fps: 6, loop: true },
  jump: { frames: 4, fps: 4, loop: false },
  fall: { frames: 4, fps: 4, loop: false },
  dash: { frames: 4, fps: 8, loop: false },
  shoot: { frames: 4, fps: 8, loop: true },
  laser: { frames: 4, fps: 3, loop: true },
  land: { frames: 3, fps: 6, loop: false },
  hit: { frames: 2, fps: 4, loop: false },
};

export class PlayerAnimator {
  constructor() {
    this.frameCache = {};
    this.currentAnim = 'idle';
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.finished = false;

    this.preloadAll();
  }

  preloadAll() {
    for (const [animName, config] of Object.entries(PLAYER_ANIMATIONS)) {
      for (let i = 0; i < config.frames; i++) {
        const padded = String(i).padStart(3, '0');
        const key = `${animName}_${padded}`;
        const img = new Image();
        img.src = `/assets/boss_level1/player/${animName}/${padded}.png`;
        this.frameCache[key] = img;
      }
    }
  }

  setState(animState) {
    if (animState !== this.currentAnim) {
      this.currentAnim = animState;
      this.currentFrame = 0;
      this.frameTimer = 0;
      this.finished = false;
    }
  }

  update(dt) {
    const config = PLAYER_ANIMATIONS[this.currentAnim];
    if (!config) return;
    if (this.finished && !config.loop) return;

    this.frameTimer += dt;
    const frameDuration = 1 / config.fps;

    if (this.frameTimer >= frameDuration) {
      this.frameTimer -= frameDuration;
      this.currentFrame++;

      if (this.currentFrame >= config.frames) {
        if (config.loop) {
          this.currentFrame = 0;
        } else {
          this.currentFrame = config.frames - 1;
          this.finished = true;
        }
      }
    }
  }

  getCurrentFrame() {
    const padded = String(this.currentFrame).padStart(3, '0');
    const key = `${this.currentAnim}_${padded}`;
    const img = this.frameCache[key];
    if (img && img.complete && img.naturalWidth > 0) {
      return img;
    }
    return null;
  }

  getCurrentAnimName() {
    return this.currentAnim;
  }
}
