// ============================================
// CONSTANTS
// ============================================
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

// Bird constants
const BIRD_START_X = 200;
const BIRD_START_Y = 300;
const BIRD_WIDTH = 60;
const BIRD_HEIGHT = 60;
const BIRD_HITBOX_WIDTH = 30;
const BIRD_HITBOX_HEIGHT = 30;
const GRAVITY = 1200; // px/s² (reduced for floatier feel)
const FLAP_VELOCITY = -420; // px/s
const MAX_FALL_SPEED = 500; // px/s (reduced for gentler falling)
const BIRD_ROTATES = false; // Set to true for nose-dive rotation

// Pipe constants
const PIPE_WIDTH = 90;
const PIPE_GAP = 170;
const PIPE_SPAWN_INTERVAL = 1.35; // seconds
const PIPE_SPEED = 240; // px/s
const GAP_MIN_Y = 120;
const GAP_MAX_Y = 480;

// Ground and ceiling
const GROUND_Y = 540;
const CEILING_Y = 0;

// Seeded RNG - change this for repeatable runs
const SEED = null; // Set to a number for deterministic runs, null for random

// ============================================
// SEEDED RNG (LCG)
// ============================================
let rngState;

function initRNG(seed) {
    if (seed !== null) {
        rngState = seed;
    } else {
        rngState = Date.now() % 2147483647;
    }
}

function seededRandom() {
    // LCG parameters (same as glibc)
    rngState = (rngState * 1103515245 + 12345) % 2147483648;
    return rngState / 2147483648;
}

function randomInRange(min, max) {
    return min + seededRandom() * (max - min);
}

// ============================================
// ASSET MANAGER
// ============================================
const AssetManager = {
    images: {},
    customImages: {},
    loaded: false,
    db: null,

    // IndexedDB constants
    DB_NAME: 'FlappyBirdAssets',
    DB_VERSION: 1,
    STORE_NAME: 'customAssets',

    // Initialize IndexedDB
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                if (!database.objectStoreNames.contains(this.STORE_NAME)) {
                    database.createObjectStore(this.STORE_NAME, { keyPath: 'key' });
                }
            };
        });
    },

    // Get custom image from IndexedDB
    async getCustomImage(key) {
        if (!this.db) return null;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result?.blob || null);
            request.onerror = () => reject(request.error);
        });
    },

    // Convert blob to Image element
    blobToImage(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load image from blob'));
            img.src = url;
        });
    },

    // Load custom assets from IndexedDB
    async loadCustomAssets() {
        try {
            await this.initDB();

            const customKeys = [
                'bird', 'background', 'ground',
                'topA', 'topA-ext', 'bottomA', 'bottomA-ext',
                'topB', 'topB-ext', 'bottomB', 'bottomB-ext'
            ];
            for (const key of customKeys) {
                const blob = await this.getCustomImage(key);
                if (blob) {
                    this.customImages[key] = await this.blobToImage(blob);
                    console.log(`Loaded custom ${key} asset`);
                }
            }
        } catch (e) {
            console.warn('Could not load custom assets:', e);
        }
    },

    // Load an image and return a promise
    loadImage(name, src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.images[name] = img;
                resolve(img);
            };
            img.onerror = () => reject(new Error(`Failed to load ${src}`));
            img.src = src;
        });
    },

    // Load all assets (pipe images + custom assets)
    async loadAll() {
        // Load custom assets from IndexedDB first
        await this.loadCustomAssets();

        // Get bird GIF from DOM element (keeps animation alive)
        const birdGifElement = document.getElementById('birdGif');
        if (birdGifElement) {
            this.images.bird = birdGifElement;
        }

        // Load pipe assets and UI images
        await Promise.all([
            // Title screen images
            this.loadImage('titleCard', 'assets/tinkshex-titlecard.png'),
            this.loadImage('playNow', 'assets/tinkshex-playnow.png'),
            // Pipe caps (the opening part)
            this.loadImage('topA', 'assets/topA.png'),
            this.loadImage('topB', 'assets/TopB.png'),
            this.loadImage('bottomA', 'assets/bottomA.png'),
            this.loadImage('bottomB', 'assets/bottomB.png'),
            // Pipe extensions (tileable body)
            this.loadImage('topA-ext', 'assets/topA-ext.png'),
            this.loadImage('topB-ext', 'assets/topB-ext.png'),
            this.loadImage('bottomA-ext', 'assets/bottomA-ext.png'),
            this.loadImage('bottomB-ext', 'assets/bottomB-ext.png')
        ]);
        this.loaded = true;
    },

    // Draw a sprite - uses images for pipes if loaded, otherwise shapes
    drawSprite(ctx, name, x, y, w, h, opts = {}) {
        const { rotation = 0, color = '#FFF', variant = 'A' } = opts;

        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(rotation);
        ctx.translate(-w / 2, -h / 2);

        switch (name) {
            case 'bird':
                this.drawBird(ctx, 0, 0, w, h, opts);
                break;
            case 'pipe_top':
                this.drawPipeImage(ctx, 0, 0, w, h, true, variant);
                break;
            case 'pipe_bottom':
                this.drawPipeImage(ctx, 0, 0, w, h, false, variant);
                break;
            case 'ground':
                this.drawGround(ctx, 0, 0, w, h);
                break;
            default:
                ctx.fillStyle = color;
                ctx.fillRect(0, 0, w, h);
        }

        ctx.restore();
    },

    // Draw pipe using image assets with cap + tiled extension
    drawPipeImage(ctx, x, y, w, h, isTop, variant) {
        const capKey = isTop ? `top${variant}` : `bottom${variant}`;
        const extKey = isTop ? `top${variant}-ext` : `bottom${variant}-ext`;
        // Use custom images if available, otherwise fall back to defaults
        const capImg = this.customImages[capKey] || this.images[capKey];
        const extImg = this.customImages[extKey] || this.images[extKey];

        // Overlap amount to hide seams between cap and extensions
        const OVERLAP = 30;

        if (capImg && extImg && this.loaded) {
            // Calculate scaled dimensions for cap maintaining aspect ratio
            const capAspect = capImg.width / capImg.height;
            const capScaledHeight = w / capAspect;

            // Calculate scaled dimensions for extension
            const extAspect = extImg.width / extImg.height;
            const extScaledHeight = w / extAspect;

            // Effective tile step (reduced by overlap so tiles overlap each other)
            const tileStep = extScaledHeight - OVERLAP;

            if (isTop) {
                // Top pipe: cap first (behind), then extensions on top
                // Cap position: bottom edge (opening) at y + h
                const capY = y + h - capScaledHeight;

                // Draw cap first (behind)
                ctx.drawImage(capImg, x, capY, w, capScaledHeight);

                // Tile extensions from cap upward to ceiling, each overlapping the previous
                let tileY = capY + OVERLAP;
                while (tileY > y) {
                    tileY -= tileStep;
                    // Clip if extension would go above the draw area
                    if (tileY < y) {
                        const clippedHeight = extScaledHeight - (y - tileY);
                        const srcY = (y - tileY) / extScaledHeight * extImg.height;
                        ctx.drawImage(extImg, 0, srcY, extImg.width, extImg.height - srcY,
                                      x, y, w, clippedHeight);
                    } else {
                        ctx.drawImage(extImg, x, tileY, w, extScaledHeight);
                    }
                }
            } else {
                // Bottom pipe: cap first (behind), then extensions on top
                // Cap position: top edge (opening) at y

                // Draw cap first (behind)
                ctx.drawImage(capImg, x, y, w, capScaledHeight);

                // Tile extensions from cap downward, each overlapping the previous
                let tileY = y + capScaledHeight - OVERLAP;
                const endY = y + h;
                while (tileY < endY) {
                    const remainingHeight = endY - tileY;
                    if (remainingHeight < extScaledHeight) {
                        // Clip the last extension
                        const srcHeight = remainingHeight / extScaledHeight * extImg.height;
                        ctx.drawImage(extImg, 0, 0, extImg.width, srcHeight,
                                      x, tileY, w, remainingHeight);
                    } else {
                        ctx.drawImage(extImg, x, tileY, w, extScaledHeight);
                    }
                    tileY += tileStep;
                }
            }
        } else {
            // Fallback to shape drawing if images not loaded
            this.drawPipe(ctx, x, y, w, h, isTop);
        }
    },

    drawBird(ctx, x, y, w, h, opts) {
        // Use custom bird image from IndexedDB if available
        if (this.customImages.bird) {
            ctx.drawImage(this.customImages.bird, x, y, w, h);
            return;
        }

        // Use bird image from assets if available (supports animated GIF)
        if (this.images.bird) {
            ctx.drawImage(this.images.bird, x, y, w, h);
            return;
        }

        // Fallback: draw shape
        // Body
        ctx.fillStyle = '#F7DC6F';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Wing
        ctx.fillStyle = '#F4D03F';
        ctx.beginPath();
        ctx.ellipse(x + w * 0.35, y + h * 0.55, w * 0.25, h * 0.3, -0.3, 0, Math.PI * 2);
        ctx.fill();

        // Eye
        ctx.fillStyle = '#FFF';
        ctx.beginPath();
        ctx.arc(x + w * 0.7, y + h * 0.35, h * 0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(x + w * 0.73, y + h * 0.35, h * 0.1, 0, Math.PI * 2);
        ctx.fill();

        // Beak
        ctx.fillStyle = '#E74C3C';
        ctx.beginPath();
        ctx.moveTo(x + w * 0.85, y + h * 0.45);
        ctx.lineTo(x + w + 10, y + h * 0.5);
        ctx.lineTo(x + w * 0.85, y + h * 0.6);
        ctx.closePath();
        ctx.fill();
    },

    drawPipe(ctx, x, y, w, h, isTop) {
        // Main pipe body
        ctx.fillStyle = '#2ECC71';
        ctx.fillRect(x, y, w, h);

        // Pipe highlight
        ctx.fillStyle = '#27AE60';
        ctx.fillRect(x + w * 0.1, y, w * 0.15, h);

        // Pipe shadow
        ctx.fillStyle = '#1E8449';
        ctx.fillRect(x + w * 0.75, y, w * 0.15, h);

        // Pipe lip
        const lipHeight = 30;
        const lipOverhang = 8;
        ctx.fillStyle = '#2ECC71';
        if (isTop) {
            ctx.fillRect(x - lipOverhang, y + h - lipHeight, w + lipOverhang * 2, lipHeight);
            ctx.fillStyle = '#27AE60';
            ctx.fillRect(x - lipOverhang, y + h - lipHeight, w * 0.15 + lipOverhang, lipHeight);
        } else {
            ctx.fillRect(x - lipOverhang, y, w + lipOverhang * 2, lipHeight);
            ctx.fillStyle = '#27AE60';
            ctx.fillRect(x - lipOverhang, y, w * 0.15 + lipOverhang, lipHeight);
        }
    },

    drawGround(ctx, x, y, w, h) {
        // Use custom ground image if available
        if (this.customImages.ground) {
            ctx.drawImage(this.customImages.ground, x, y, w, h);
            return;
        }

        // Default: draw shape
        // Dirt
        ctx.fillStyle = '#D4A574';
        ctx.fillRect(x, y, w, h);

        // Grass on top
        ctx.fillStyle = '#7CB342';
        ctx.fillRect(x, y, w, 15);
    },

    // Draw background (custom or default sky color)
    drawBackground(ctx, w, h) {
        if (this.customImages.background) {
            ctx.drawImage(this.customImages.background, 0, 0, w, h);
        } else {
            // Default sky color
            ctx.fillStyle = '#70C5CE';
            ctx.fillRect(0, 0, w, h);
        }
    }
};

// ============================================
// AUDIO STUBS
// ============================================
function playFlap() {
    // Audio stub - implement when audio assets are available
}

function playScore() {
    // Audio stub - implement when audio assets are available
}

function playHit() {
    // Audio stub - implement when audio assets are available
}

// ============================================
// GAME STATE
// ============================================
const GameState = {
    READY: 'READY',
    PLAYING: 'PLAYING',
    GAME_OVER: 'GAME_OVER'
};

let state = GameState.READY;
let debugMode = false;

// Bird state
let bird = {
    x: BIRD_START_X,
    y: BIRD_START_Y,
    vy: 0,
    rotation: 0
};

// Pipes
let pipes = [];
let pipeTimer = 0;

// Pixie dust particles
let particles = [];
const PARTICLE_SPAWN_RATE = 4; // particles per frame
const PARTICLE_COLORS = ['#FFD700', '#FFF8DC', '#FFFACD', '#e7db91']; // gold, cream
let trailY = BIRD_START_Y + BIRD_HEIGHT * 0.3; // smoothed Y position for trail

function spawnParticle() {
    // Slowly follow bird's Y position (creates smooth horizontal trail)
    trailY += (bird.y + BIRD_HEIGHT * 0.3 - trailY) * 0.02;

    particles.push({
        x: bird.x,
        y: trailY + (Math.random() - 0.5) * 6, // spawn at smoothed Y
        vx: -30 - Math.random() * 20, // drift left only
        vy: 0, // no vertical movement at all
        size: 1 + Math.random(), // 1-2px
        color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
        life: 1.0, // 1.0 = full life, 0 = dead
        decay: 0.3 + Math.random() * 0.3, // slower decay = longer trail
        twinkleSpeed: 5 + Math.random() * 10,
        twinkleOffset: Math.random() * Math.PI * 2
    });
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Move particle
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0; // no gravity - pure horizontal trail

        // Decay life
        p.life -= p.decay * dt;

        // Remove dead particles
        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }
}

function renderParticles(ctx) {
    const time = performance.now() / 1000;

    for (const p of particles) {
        // Twinkle effect - oscillating opacity
        const twinkle = 0.5 + 0.5 * Math.sin(time * p.twinkleSpeed + p.twinkleOffset);
        const alpha = p.life * twinkle;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;

        // Draw tiny sparkle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

// Score
let score = 0;
let bestScore = parseInt(localStorage.getItem('flappyBestScore')) || 0;

// ============================================
// GAME FUNCTIONS
// ============================================
function resetGame() {
    bird.x = BIRD_START_X;
    bird.y = BIRD_START_Y;
    bird.vy = 0;
    bird.rotation = 0;

    pipes = [];
    pipeTimer = 0;
    particles = [];
    trailY = BIRD_START_Y + BIRD_HEIGHT * 0.3;
    score = 0;

    // Reset timing to prevent accumulated time issues
    lastTime = performance.now();
    accumulator = 0;

    // Reset RNG unless fixed seed
    if (SEED === null) {
        initRNG(null);
    }

    state = GameState.READY;
}

function spawnPipePair() {
    const gapCenterY = randomInRange(GAP_MIN_Y, GAP_MAX_Y);

    const topPipeHeight = gapCenterY - PIPE_GAP / 2;
    const bottomPipeY = gapCenterY + PIPE_GAP / 2;
    const bottomPipeHeight = CANVAS_HEIGHT - bottomPipeY;

    // Randomly pick A or B variant for visual variety
    const variant = seededRandom() < 0.5 ? 'A' : 'B';

    pipes.push({
        x: CANVAS_WIDTH,
        gapCenterY: gapCenterY,
        topHeight: topPipeHeight,
        bottomY: bottomPipeY,
        bottomHeight: bottomPipeHeight,
        variant: variant,
        scored: false
    });
}

function handleFlap() {
    if (state === GameState.READY) {
        state = GameState.PLAYING;
        bird.vy = FLAP_VELOCITY;
        // Reset timing to prevent accumulated time from causing instant drop
        lastTime = performance.now();
        accumulator = 0;
        playFlap();
    } else if (state === GameState.PLAYING) {
        bird.vy = FLAP_VELOCITY;
        playFlap();
    } else if (state === GameState.GAME_OVER) {
        resetGame();
    }
}

function getBirdHitbox() {
    return {
        x: bird.x + (BIRD_WIDTH - BIRD_HITBOX_WIDTH) / 2,
        y: bird.y + (BIRD_HEIGHT - BIRD_HITBOX_HEIGHT) / 2,
        width: BIRD_HITBOX_WIDTH,
        height: BIRD_HITBOX_HEIGHT
    };
}

function checkAABBCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
}

function update(dt) {
    // Update particles even when not playing (for fade out)
    updateParticles(dt);

    if (state !== GameState.PLAYING) return;

    // Spawn pixie dust particles
    for (let i = 0; i < PARTICLE_SPAWN_RATE; i++) {
        spawnParticle();
    }

    // Update bird physics
    bird.vy += GRAVITY * dt;
    if (bird.vy > MAX_FALL_SPEED) {
        bird.vy = MAX_FALL_SPEED;
    }
    bird.y += bird.vy * dt;

    // Bird rotation based on velocity (visual only)
    if (BIRD_ROTATES) {
        const targetRotation = Math.min(Math.max(bird.vy / 500, -0.5), 1.2);
        bird.rotation = targetRotation;
    } else {
        bird.rotation = 0;
    }

    // Check ceiling/ground collision
    if (bird.y <= CEILING_Y || bird.y + BIRD_HEIGHT >= GROUND_Y) {
        playHit();
        state = GameState.GAME_OVER;
        if (score > bestScore) {
            bestScore = score;
            localStorage.setItem('flappyBestScore', bestScore.toString());
        }
        return;
    }

    // Spawn pipes
    pipeTimer += dt;
    if (pipeTimer >= PIPE_SPAWN_INTERVAL) {
        spawnPipePair();
        pipeTimer -= PIPE_SPAWN_INTERVAL;
    }

    // Update pipes
    const birdHitbox = getBirdHitbox();

    for (let i = pipes.length - 1; i >= 0; i--) {
        const pipe = pipes[i];
        pipe.x -= PIPE_SPEED * dt;

        // Remove off-screen pipes
        if (pipe.x + PIPE_WIDTH < 0) {
            pipes.splice(i, 1);
            continue;
        }

        // Check for score
        const pipeCenterX = pipe.x + PIPE_WIDTH / 2;
        if (!pipe.scored && bird.x > pipeCenterX) {
            pipe.scored = true;
            score++;
            playScore();
        }

        // Check collision with top pipe
        const topPipeRect = {
            x: pipe.x,
            y: 0,
            width: PIPE_WIDTH,
            height: pipe.topHeight
        };

        // Check collision with bottom pipe
        const bottomPipeRect = {
            x: pipe.x,
            y: pipe.bottomY,
            width: PIPE_WIDTH,
            height: pipe.bottomHeight
        };

        if (checkAABBCollision(birdHitbox, topPipeRect) ||
            checkAABBCollision(birdHitbox, bottomPipeRect)) {
            playHit();
            state = GameState.GAME_OVER;
            if (score > bestScore) {
                bestScore = score;
                localStorage.setItem('flappyBestScore', bestScore.toString());
            }
            return;
        }
    }
}

function render(ctx) {
    // Draw background (custom or default sky)
    AssetManager.drawBackground(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw pipes
    for (const pipe of pipes) {
        // Top pipe
        AssetManager.drawSprite(ctx, 'pipe_top', pipe.x, 0, PIPE_WIDTH, pipe.topHeight, { variant: pipe.variant });

        // Bottom pipe
        AssetManager.drawSprite(ctx, 'pipe_bottom', pipe.x, pipe.bottomY, PIPE_WIDTH, pipe.bottomHeight, { variant: pipe.variant });

        // Debug: draw pipe gap center line
        if (debugMode) {
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(pipe.x, pipe.gapCenterY);
            ctx.lineTo(pipe.x + PIPE_WIDTH, pipe.gapCenterY);
            ctx.stroke();

            // Draw pipe hitboxes
            ctx.strokeStyle = '#FF00FF';
            ctx.lineWidth = 1;
            ctx.strokeRect(pipe.x, 0, PIPE_WIDTH, pipe.topHeight);
            ctx.strokeRect(pipe.x, pipe.bottomY, PIPE_WIDTH, pipe.bottomHeight);
        }
    }

    // Draw pixie dust particles (behind bird)
    renderParticles(ctx);

    // Draw ground (skip during READY state for clean title screen)
    if (state !== GameState.READY) {
        AssetManager.drawSprite(ctx, 'ground', 0, GROUND_Y, CANVAS_WIDTH, CANVAS_HEIGHT - GROUND_Y);
    }

    // Position bird sprite (DOM element for GIF animation support)
    // Hide during READY state (title screen)
    const birdSprite = document.getElementById('birdSprite');
    if (birdSprite) {
        if (state === GameState.READY) {
            birdSprite.style.visibility = 'hidden';
        } else {
            birdSprite.style.visibility = 'visible';
            birdSprite.style.left = bird.x + 'px';
            birdSprite.style.top = bird.y + 'px';
            birdSprite.style.transform = `rotate(${bird.rotation}rad)`;
        }
    } else if (state !== GameState.READY) {
        // Fallback: draw to canvas (not during READY state)
        AssetManager.drawSprite(ctx, 'bird', bird.x, bird.y, BIRD_WIDTH, BIRD_HEIGHT, {
            rotation: bird.rotation
        });
    }

    // Debug: draw bird hitbox
    if (debugMode) {
        const hitbox = getBirdHitbox();
        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 2;
        ctx.strokeRect(hitbox.x, hitbox.y, hitbox.width, hitbox.height);
    }

    // Draw score
    ctx.fillStyle = '#FFF';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.strokeText(score.toString(), CANVAS_WIDTH / 2, 60);
    ctx.fillText(score.toString(), CANVAS_WIDTH / 2, 60);

    // Draw best score
    ctx.font = 'bold 20px Arial';
    ctx.strokeText(`Best: ${bestScore}`, CANVAS_WIDTH / 2, 90);
    ctx.fillText(`Best: ${bestScore}`, CANVAS_WIDTH / 2, 90);

    // State-specific UI
    if (state === GameState.READY) {
        // Dark overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Title card - centered
        const titleImg = AssetManager.images.titleCard;
        if (titleImg) {
            const titleX = (CANVAS_WIDTH - titleImg.width) / 2;
            const titleY = (CANVAS_HEIGHT - titleImg.height) / 2 - 30;
            ctx.drawImage(titleImg, titleX, titleY);
        }

        // Play Now button - bottom left with glow effect
        const playImg = AssetManager.images.playNow;
        if (playImg) {
            const scale = 1.5; // Make it larger
            const playWidth = playImg.width * scale;
            const playHeight = playImg.height * scale;
            const playX = 15;
            const playY = CANVAS_HEIGHT - playHeight - 15;

            // Animated glow effect
            const time = performance.now() / 1000;
            const glowIntensity = 0.5 + 0.5 * Math.sin(time * 3); // Pulsing glow
            const glowSize = 15 + 10 * Math.sin(time * 3);

            ctx.save();
            ctx.shadowColor = '#FF69B4'; // Pink to match Play Now image
            ctx.shadowBlur = glowSize * glowIntensity;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // Draw multiple times for stronger glow
            ctx.drawImage(playImg, playX, playY, playWidth, playHeight);
            ctx.drawImage(playImg, playX, playY, playWidth, playHeight);

            ctx.restore();
        }
    } else if (state === GameState.GAME_OVER) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        ctx.fillStyle = '#FFF';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.font = 'bold 64px Arial';
        ctx.textAlign = 'center';
        ctx.strokeText('GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 80);
        ctx.fillText('GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 80);

        ctx.font = 'bold 36px Arial';
        ctx.strokeText(`Score: ${score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10);
        ctx.fillText(`Score: ${score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10);

        ctx.strokeText(`Best: ${bestScore}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
        ctx.fillText(`Best: ${bestScore}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);

        ctx.font = 'bold 24px Arial';
        ctx.strokeText('Press R or Tap to Restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 100);
        ctx.fillText('Press R or Tap to Restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 100);
    }

    // Debug mode indicator
    if (debugMode) {
        ctx.fillStyle = '#FF0';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('DEBUG MODE', 10, 25);
    }
}

// ============================================
// INPUT HANDLING
// ============================================
function setupInput() {
    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp') {
            e.preventDefault();
            handleFlap();
        } else if (e.code === 'KeyR' && state === GameState.GAME_OVER) {
            resetGame();
        } else if (e.code === 'KeyD') {
            debugMode = !debugMode;
        }
    });

    // Mouse click
    const canvas = document.getElementById('gameCanvas');
    canvas.addEventListener('click', (e) => {
        e.preventDefault();
        handleFlap();
    });

    // Touch
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleFlap();
    });
}

// ============================================
// GAME LOOP
// ============================================
const FIXED_TIMESTEP = 1 / 60; // 60 FPS physics
let accumulator = 0;
let lastTime = 0;

function gameLoop(currentTime) {
    const dt = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    // Prevent spiral of death and handle tab switches
    // Clamp dt to prevent huge time jumps
    const frameDt = Math.min(dt, 0.1);
    accumulator += frameDt;

    // Cap accumulator to prevent runaway physics (e.g., after tab switch)
    if (accumulator > 0.2) {
        accumulator = 0.2;
    }

    // Fixed timestep updates
    while (accumulator >= FIXED_TIMESTEP) {
        update(FIXED_TIMESTEP);
        accumulator -= FIXED_TIMESTEP;
    }

    // Render
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    render(ctx);

    requestAnimationFrame(gameLoop);
}

// ============================================
// INITIALIZATION
// ============================================
async function init() {
    // Load assets first
    try {
        await AssetManager.loadAll();
        console.log('Assets loaded successfully');
    } catch (e) {
        console.warn('Some assets failed to load, using fallback shapes:', e);
    }

    initRNG(SEED);
    setupInput();
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

// Start the game when the page loads
window.addEventListener('load', init);
