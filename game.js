// ---------------------------------
// 초기 설정
// ---------------------------------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let width, height;

// UI 요소
const gameStatus = document.getElementById('gameStatus');

// 이미지 로더
const resourceLoader = {
    images: {},
    loadedCount: 0,
    totalCount: 0,
    load(urls, callback) {
        this.totalCount = urls.length;
        this.loadedCount = 0;
        urls.forEach(url => {
            const img = new Image();
            img.src = url;
            img.onload = () => {
                this.loadedCount++;
                this.images[url] = img;
                if (this.loadedCount === this.totalCount) {
                    callback();
                }
            };
            img.onerror = () => {
                console.error(`Failed to load image: ${url}`);
                this.loadedCount++;
                if (this.loadedCount === this.totalCount) {
                    callback();
                }
            }
        });
    }
};

// 사운드 매니저 (Web Audio API)
const soundManager = {
    ctx: null,
    init() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
    },
    playShoot() {
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.2);
        
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
        
        osc.start();
        osc.stop(this.ctx.currentTime + 0.2);
    },
    playExplosion() {
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const bufferSize = this.ctx.sampleRate * 0.5;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1000;

        const gain = this.ctx.createGain();
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        
        gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
        
        noise.start();
    }
};

// ---------------------------------
// 게임 상태 및 상수
// ---------------------------------
const gravity = 0.1;
let wind = 0;
let currentPlayer = 1;
let gameOver = false;
let gameStarted = false;
let isAiming = false;
let mousePos = { x: 0, y: 0 };
let camera = { x: 0, y: 0, scale: 1 };
let cameraFollowsProjectile = false;
const lastFireInfo = {
    1: { angle: 0, power: 50},
    2: { angle: Math.PI, power: 50}
};
let keys = {};
let gameMode = 'pvp'; // 'pvp' or 'pve'
let npcLevel = 1;
let rankings = JSON.parse(localStorage.getItem('fortress_rankings')) || [];
let mobileKeys = { left: false, right: false, jump: false };
let currentTheme = { bg: '#add8e6', terrain: '#228B22' };
let levelMessage = "";
let levelMessageAlpha = 0;

const levelThemes = [
    { bg: '#add8e6', terrain: '#228B22', name: "Green Fields" }, // Level 1: Day / Grass
    { bg: '#FFDAB9', terrain: '#8B4513', name: "Sunset Valley" }, // Level 2: Sunset / Dirt
    { bg: '#191970', terrain: '#696969', name: "Midnight Rocky" }, // Level 3: Night / Stone
    { bg: '#E0FFFF', terrain: '#B0E0E6', name: "Frozen Tundra" }, // Level 4: Ice / Snow
    { bg: '#2F4F4F', terrain: '#556B2F', name: "Toxic Swamp" }  // Level 5: Swamp / Slime
];


// ---------------------------------
// 게임 객체 (클래스)
// ---------------------------------
class Tank {
    constructor(x, player, terrain) {
        this.player = player;
        this.baseImg = resourceLoader.images['side_tank.png'];
        this.width = 60; 
        this.height = 25; 
        this.x = x;
        this.y = terrain[Math.floor(x)] - this.height / 2;
        this.turretLength = 40;
        this.turretHeight = 6;
        this.health = 100;
        this.doubleShot = false;
        this.maxFuel = 300;
        this.fuel = this.maxFuel;
        this.wheelRadius = 5;
        this.wheelOffsets = [-20, -7, 6, 19];
        this.vy = 0;
        this.onGround = true;
        
        // NPC Stats
        this.accuracy = 0; // Error range in degrees
        this.powerMult = 1;

        // Tint Cache for Player 2
        if (this.player === 2) {
            this.cacheCanvas = document.createElement('canvas');
            this.cacheCanvas.width = this.width;
            this.cacheCanvas.height = this.height;
            this.cacheCtx = this.cacheCanvas.getContext('2d');
            this.lastTintLevel = -1;
            this.lastGameMode = '';
        }
    }

    updateTintCache(level) {
        this.cacheCtx.clearRect(0, 0, this.width, this.height);
        this.cacheCtx.drawImage(this.baseImg, 0, 0, this.width, this.height);
        
        this.cacheCtx.globalCompositeOperation = 'source-atop';
        if (gameMode === 'pve') {
            const colors = ['rgba(255, 50, 50, 0.5)', 'rgba(255, 165, 0, 0.5)', 'rgba(147, 112, 219, 0.5)', 'rgba(0, 191, 255, 0.5)', 'rgba(50, 205, 50, 0.5)'];
            this.cacheCtx.fillStyle = colors[(level - 1) % colors.length];
        } else {
            this.cacheCtx.fillStyle = 'rgba(255, 100, 100, 0.5)';
        }
        this.cacheCtx.fillRect(0, 0, this.width, this.height);
        this.cacheCtx.globalCompositeOperation = 'source-over';
    }

    update() {
        this.vy += gravity;
        this.y += this.vy;

        const groundY = terrain[Math.floor(this.x)] - this.height / 2;
        if (this.y >= groundY) {
            this.y = groundY;
            this.vy = 0;
            this.onGround = true;
        } else {
            this.onGround = false;
        }

        if (this.onGround) {
            const ix = Math.floor(this.x);
            if (ix >= 5 && ix < width - 5) {
                const leftY = terrain[ix - 5];
                const rightY = terrain[ix + 5];
                const slope = rightY - leftY;

                if (Math.abs(slope) > 3) {
                    this.x += slope * 0.1;
                }

                if (this.x < 20) this.x = 20;
                if (this.x > width - 20) this.x = width - 20;
            }
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Health bar
        const healthBarWidth = 40;
        const healthBarHeight = 5;
        ctx.fillStyle = 'red';
        ctx.fillRect(-healthBarWidth / 2, -this.height - 15, healthBarWidth, healthBarHeight);
        ctx.fillStyle = 'green';
        ctx.fillRect(-healthBarWidth / 2, -this.height - 15, healthBarWidth * (this.health / 100), healthBarHeight);

        // Fuel bar
        ctx.fillStyle = '#555';
        ctx.fillRect(-healthBarWidth / 2, -this.height - 8, healthBarWidth, healthBarHeight);
        ctx.fillStyle = '#1E90FF'; // DodgerBlue
        ctx.fillRect(-healthBarWidth / 2, -this.height - 8, healthBarWidth * (this.fuel / this.maxFuel), healthBarHeight);

        if (this.doubleShot) {
            ctx.fillStyle = '#FF4500';
            ctx.font = 'bold 12px Arial';
            ctx.fillText('DOUBLE', -20, -this.height - 25);
        }

        ctx.save();
        if (this.player === 1) {
            ctx.scale(-1, 1);
            // Tank base
            ctx.drawImage(this.baseImg, -this.width / 2, -this.height/2, this.width, this.height);
        } else {
            // Player 2 (NPC or P2)
            const currentLevel = gameMode === 'pve' ? npcLevel : 0;
            if (this.lastTintLevel !== currentLevel || this.lastGameMode !== gameMode) {
                this.updateTintCache(currentLevel);
                this.lastTintLevel = currentLevel;
                this.lastGameMode = gameMode;
            }
            ctx.drawImage(this.cacheCanvas, -this.width / 2, -this.height/2, this.width, this.height);
        }

        // Draw Wheels
        this.drawWheels();

        // Turret
        let angle;
        if (isAiming && this.player === currentPlayer) {
            const dx = mousePos.x - this.x;
            const dy = mousePos.y - this.y;
            angle = Math.atan2(dy, dx);
        } else {
            angle = lastFireInfo[this.player].angle;
        }
        
        if (this.player === 1) {
            angle = Math.PI - angle;
        }
        
        ctx.save();
        ctx.rotate(angle);
        ctx.fillStyle = '#666';
        ctx.fillRect(0, -this.turretHeight / 2, this.turretLength, this.turretHeight);
        ctx.restore();
        
        ctx.restore();

        ctx.restore();
    }

    drawWheels() {
        const wheelY = this.height / 2; 
        
        ctx.fillStyle = '#333';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;

        // Rotation based on x position
        let rotation = this.x / this.wheelRadius;
        
        // If player 1 (flipped), reverse rotation to match visual direction
        if (this.player === 1) {
            rotation = -rotation;
        }

        this.wheelOffsets.forEach(wx => {
            ctx.save();
            ctx.translate(wx, wheelY);
            ctx.rotate(rotation);
            
            ctx.beginPath();
            ctx.arc(0, 0, this.wheelRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Spokes
            ctx.strokeStyle = '#888';
            ctx.beginPath();
            ctx.moveTo(-this.wheelRadius, 0);
            ctx.lineTo(this.wheelRadius, 0);
            ctx.moveTo(0, -this.wheelRadius);
            ctx.lineTo(0, this.wheelRadius);
            ctx.stroke();

            ctx.restore();
        });
    }

    applyRecoil(angle, power) {
        const recoilForce = power * 0.1;
        this.x -= Math.cos(angle) * recoilForce;

        if (this.x < 0) this.x = 0;
        if (this.x >= width) this.x = width - 1;
    }

    move(direction) {
        if (this.fuel > 0) {
            this.x += direction * 2;
            this.fuel -= 2;
            if (this.x < 20) this.x = 20;
            if (this.x > width - 20) this.x = width - 20;

            if (Math.random() < 0.3) {
                createDust(this.x, terrain[Math.floor(this.x)]);
            }
        }
    }

    jump() {
        if (this.onGround) {
            this.vy = -4;
            this.onGround = false;
            this.y -= 1;
        }
    }
}

class Projectile {
    constructor(x, y, angle, power, player, isDoubleShot = false) {
        this.x = x;
        this.y = y;
        this.radius = 5;
        this.player = player;
        const speed = power / 5; 
        this.vx = speed * Math.cos(angle);
        this.vy = speed * Math.sin(angle);
        this.isDoubleShot = isDoubleShot;
        if (this.isDoubleShot) {
            this.radius = 8;
        }
    }

    update() {
        this.vy += gravity;
        this.vx += wind;
        this.x += this.vx;
        this.y += this.vy;
    }

    draw() {
        ctx.fillStyle = this.isDoubleShot ? '#FF4500' : 'black';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = Math.random() * 3 + 1;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 5 + 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 1.0;
        this.decay = Math.random() * 0.02 + 0.01;
        const colors = ['#FF4500', '#FFA500', '#FFD700', '#808080']; // Red, Orange, Gold, Gray
        this.color = colors[Math.floor(Math.random() * colors.length)];
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.1; // Gravity
        this.life -= this.decay;
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class Dust {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = Math.random() * 2 + 1;
        this.vx = (Math.random() - 0.5) * 1.5;
        this.vy = -Math.random() * 1 - 0.5;
        this.life = 1.0;
        this.decay = Math.random() * 0.05 + 0.03;
        this.color = `rgba(120, 100, 80, ${Math.random() * 0.5 + 0.3})`;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class Smoke {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = Math.random() * 3 + 2;
        this.vx = (Math.random() - 0.5) * 1.5;
        this.vy = -Math.random() * 2 - 0.5;
        this.life = 1.0;
        this.decay = Math.random() * 0.02 + 0.01;
        const gray = Math.floor(Math.random() * 100 + 50);
        this.color = `rgb(${gray}, ${gray}, ${gray})`;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
        this.radius += 0.1;
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.life * 0.6;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class Cloud {
    constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * (height * 0.4);
        this.speed = Math.random() * 0.5 + 0.2;
        this.scale = Math.random() * 0.5 + 0.5;
    }

    update() {
        this.x += this.speed;
        if (this.x > width + 100) {
            this.x = -100;
            this.y = Math.random() * (height * 0.4);
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(this.scale, this.scale);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, Math.PI * 2);
        ctx.arc(40, -10, 40, 0, Math.PI * 2);
        ctx.arc(80, 0, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class Item {
    constructor(x, type) {
        this.x = x;
        this.y = -30;
        this.type = type; // 'HEALTH' or 'POWER'
        this.width = 30;
        this.height = 30;
        this.vy = 3;
        this.onGround = false;
    }

    update() {
        if (!this.onGround) {
            this.y += this.vy;
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        
        if (this.type === 'HEALTH') ctx.fillStyle = '#32CD32';
        else if (this.type === 'POWER') ctx.fillStyle = '#FF4500';
        else ctx.fillStyle = '#1E90FF'; // FUEL

        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.fillRect(-15, -15, 30, 30);
        ctx.strokeRect(-15, -15, 30, 30);
        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        let text = 'F';
        if (this.type === 'HEALTH') text = '+';
        else if (this.type === 'POWER') text = 'P';
        ctx.fillText(text, 0, 2);
        
        ctx.restore();
    }
}

// 게임 객체
let terrain = [];
let tanks = [];
let particles = [];
let clouds = [];
let items = [];
let projectile = null;
let animationFrameId;


// ---------------------------------
// 이벤트 리스너
// ---------------------------------
function fire(player, angle, power) {
    if (projectile) return;

    const tank = tanks[player - 1];
    lastFireInfo[player] = { angle, power };

    const startX = tank.x + tank.turretLength * Math.cos(angle);
    const startY = tank.y + tank.turretLength * Math.sin(angle);

    projectile = new Projectile(startX, startY, angle, power, player, tank.doubleShot);
    tank.applyRecoil(angle, power);
    tank.doubleShot = false; // 아이템 사용 후 초기화
    soundManager.playShoot();
}

function createExplosion(x, y) {
    soundManager.playExplosion();
    for (let i = 0; i < 30; i++) {
        particles.push(new Particle(x, y));
    }
}

function createDust(x, y) {
    particles.push(new Dust(x, y));
}

function createSmoke(x, y) {
    particles.push(new Smoke(x, y));
}

function generateWind() {
    // -0.05 ~ 0.05 사이의 바람 (중력이 0.1임)
    wind = (Math.random() - 0.5) * 0.1;
}

function drawWindIndicator() {
    ctx.save();
    const cx = width / 2;
    const cy = 50;
    const barWidth = 200;
    
    // Background bar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(cx - barWidth/2, cy - 2, barWidth, 4);
    
    // Center marker
    ctx.fillStyle = '#333';
    ctx.fillRect(cx - 1, cy - 10, 2, 20);
    
    // Wind bar
    const windMax = 0.05;
    let windWidth = (wind / windMax) * (barWidth / 2);
    
    ctx.fillStyle = wind > 0 ? '#0000FF' : '#FF0000'; // Blue for Right, Red for Left
    ctx.fillRect(cx, cy - 2, windWidth, 4);
    
    // Text
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    const windSpeed = Math.round(Math.abs(wind) * 1000);
    ctx.fillText(`WIND: ${windSpeed}`, cx, cy - 20);
    
    ctx.restore();
}

function spawnItem() {
    // 40% 확률로 턴 시작 시 아이템 생성
    if (Math.random() < 0.4) {
        // 탱크 근처에 떨어지도록 설정 (획득 가능성 높임)
        const targetTank = tanks[Math.floor(Math.random() * tanks.length)];
        const offset = (Math.random() - 0.5) * 100;
        let x = targetTank.x + offset;
        if (x < 30) x = 30;
        if (x > width - 30) x = width - 30;
        
        const rand = Math.random();
        let type = 'FUEL';
        if (rand < 0.33) type = 'HEALTH';
        else if (rand < 0.66) type = 'POWER';
        
        items.push(new Item(x, type));
    }
}

function drawNPCStats() {
    if (gameMode !== 'pve') return;

    ctx.save();
    const cx = width / 2;
    const cy = 80; // Below wind indicator

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.roundRect(cx - 200, cy - 15, 400, 30, 15);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    
    const tank2 = tanks[1];
    const accText = Math.max(0, 100 - tank2.accuracy * 5); // Simple representation
    const pwrText = Math.round(tank2.powerMult * 100);
    
    ctx.fillText(`NPC LEVEL: ${npcLevel} | HP: ${Math.round(tank2.health)} | ACC: ${accText}% | PWR: ${pwrText}%`, cx, cy + 5);
    ctx.restore();
}

function updateRankings(level) {
    const date = new Date().toLocaleDateString();
    rankings.push({ level: level, date: date });
    rankings.sort((a, b) => b.level - a.level);
    rankings = rankings.slice(0, 5); // Keep top 5
    localStorage.setItem('fortress_rankings', JSON.stringify(rankings));
    displayRankings();
}

// ---------------------------------
// 지형 관련 함수
// ---------------------------------
function generateTerrain(canvasWidth, canvasHeight) {
    terrain = [];
    let baseHeight = canvasHeight * 0.75;
    let y = baseHeight;

    for (let i = 0; i < canvasWidth; i++) {
        y += (Math.random() - 0.5) * 2;
        if (y < baseHeight - 20) y = baseHeight - 20;
        if (y > baseHeight + 20) y = baseHeight + 20;

        let height = y;
        const dist = Math.abs(i - canvasWidth / 2);
        if (dist < canvasWidth * 0.2) {
            height -= Math.cos((dist / (canvasWidth * 0.2)) * (Math.PI / 2)) * (canvasHeight * 0.35);
        }
        terrain.push(height);
    }
}

function destroyTerrain(x, y) {
    const radius = 30;
    const startX = Math.floor(x - radius);
    const endX = Math.ceil(x + radius);

    for (let i = startX; i <= endX; i++) {
        if (i >= 0 && i < width) {
            const dx = i - x;
            if (dx * dx <= radius * radius) {
                const dy = Math.sqrt(radius * radius - dx * dx);
                const newY = y + dy;
                if (newY > terrain[i]) {
                    terrain[i] = newY;
                }
            }
        }
    }
}

function drawTerrain(canvasWidth, canvasHeight) {
    ctx.fillStyle = currentTheme.terrain;
    ctx.beginPath();
    ctx.moveTo(0, canvasHeight);
    for (let i = 0; i < canvasWidth; i++) {
        ctx.lineTo(i, terrain[i]);
    }
    ctx.lineTo(canvasWidth, canvasHeight);
    ctx.closePath();
    ctx.fill();
}

// ---------------------------------
// 게임 초기화 및 루프
// ---------------------------------
function startGame(canvasWidth, canvasHeight, mode = 'pvp') {
    width = canvasWidth;
    height = canvasHeight;

    gameOver = false;
    projectile = null;
    tanks = [];
    particles = [];
    clouds = [];
    items = [];
    currentPlayer = 1;
    gameStatus.textContent = '';
    gameMode = mode;
    
    if (gameMode === 'pvp') {
        npcLevel = 1;
        currentTheme = levelThemes[0];
        levelMessage = "PvP Battle";
    } else {
        // PvE Mode: Select theme based on level
        const themeIndex = (npcLevel - 1) % levelThemes.length;
        currentTheme = levelThemes[themeIndex];
        levelMessage = `Level ${npcLevel}: ${currentTheme.name}`;
    }
    levelMessageAlpha = 3.0; // 3초 정도 지속 효과 (1.0 이상이면 불투명 유지)
    generateWind();
    
    // Reset Camera
    camera = { x: width / 2, y: height / 2, scale: 1 };

    generateTerrain(width, height);
    
    const tank1X = Math.floor(width * 0.15);
    const tank2X = Math.floor(width * 0.85);
    tanks.push(new Tank(tank1X, 1, terrain));
    tanks.push(new Tank(tank2X, 2, terrain));

    // Setup NPC for PvE
    if (gameMode === 'pve') {
        const npc = tanks[1];
        npc.health = 100 + (npcLevel - 1) * 20;
        npc.accuracy = Math.max(1, 20 - (npcLevel * 2)); // Lower is better (degrees error)
        npc.powerMult = 1 + (npcLevel * 0.1);
    }

    for (let i = 0; i < 5; i++) {
        clouds.push(new Cloud());
    }

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    gameLoop();
}


function gameLoop() {
    if (gameOver) return;

    // Tank Movement
    if (!projectile) {
        // Player 1 (Arrow Keys)
        if (keys['ArrowLeft'] || (currentPlayer === 1 && mobileKeys.left)) {
            tanks[0].move(-1);
        }
        if (keys['ArrowRight'] || (currentPlayer === 1 && mobileKeys.right)) {
            tanks[0].move(1);
        }
        if (keys['ArrowUp'] || (currentPlayer === 1 && mobileKeys.jump)) {
            tanks[0].jump();
        }

        // Player 2 (A/D Keys)
        if (gameMode === 'pvp' && (keys['KeyA'] || (currentPlayer === 2 && mobileKeys.left))) {
            tanks[1].move(-1);
        }
        if (gameMode === 'pvp' && (keys['KeyD'] || (currentPlayer === 2 && mobileKeys.right))) {
            tanks[1].move(1);
        }
        if (gameMode === 'pvp' && (keys['KeyW'] || (currentPlayer === 2 && mobileKeys.jump))) {
            tanks[1].jump();
        }
    }

    tanks.forEach(tank => tank.update());

    // Update Camera
    let targetScale = 1;
    let targetX = width / 2;
    let targetY = height / 2;

    if (cameraFollowsProjectile && projectile) {
        targetScale = 1.5;
        targetX = projectile.x;
        targetY = projectile.y;
    }

    // Smooth camera movement (Lerp)
    camera.x += (targetX - camera.x) * 0.1;
    camera.y += (targetY - camera.y) * 0.1;
    camera.scale += (targetScale - camera.scale) * 0.1;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = currentTheme.bg;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    // Apply Camera Transform
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);

    clouds.forEach(cloud => {
        cloud.update();
        cloud.draw();
    });

    drawTerrain(width, height);
    tanks.forEach(tank => tank.draw());
    
    // 아이템 업데이트 및 그리기
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        
        // 아이템 지형 충돌 및 중력 처리
        const terrainHeight = terrain[Math.floor(item.x)];
        if (item.y + 15 >= terrainHeight) {
            item.y = terrainHeight - 15;
            item.onGround = true;
        } else {
            item.onGround = false;
        }

        item.update();
        item.draw();

        // 탱크와 아이템 충돌 체크
        let collected = false;
        for (const tank of tanks) {
            if (Math.abs(item.x - tank.x) < 40 && Math.abs(item.y - tank.y) < 40) {
                applyItemEffect(tank, item);
                collected = true;
                break;
            }
        }

        // 포탄과 아이템 충돌 체크
        if (!collected && projectile) {
            if (Math.abs(item.x - projectile.x) < 30 && Math.abs(item.y - projectile.y) < 30) {
                applyItemEffect(tanks[projectile.player - 1], item);
                collected = true;
                createExplosion(item.x, item.y);
            }
        }

        // 획득되었거나 화면 밖으로 나가면 제거 (지형에 닿아도 유지)
        if (collected || (item.y > height)) {
            items.splice(i, 1);
        }
    }

    if (isAiming) {
        const currentTank = tanks[currentPlayer - 1];
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(currentTank.x, currentTank.y);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.stroke();

        const dx = mousePos.x - currentTank.x;
        const dy = mousePos.y - currentTank.y;
        const angle = Math.atan2(dy, dx);
        const power = Math.min(Math.sqrt(dx * dx + dy * dy), 150);
        drawTrajectory(currentTank, angle, power);
    }

    if (projectile) {
        projectile.update();
        projectile.draw();
        checkCollisions();
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        particles[i].draw();
        if (particles[i].life <= 0) {
            particles.splice(i, 1);
        }
    }

    ctx.restore();

    drawWindIndicator();
    drawNPCStats();

    if (levelMessageAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, levelMessageAlpha);
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText(levelMessage, width / 2, height / 2);
        ctx.fillText(levelMessage, width / 2, height / 2);
        ctx.restore();
        levelMessageAlpha -= 0.02;
    }

    animationFrameId = requestAnimationFrame(gameLoop);
}

function checkCollisions() {
    const projX = Math.round(projectile.x);
    const projY = Math.round(projectile.y);

    if (projX < 0 || projX >= width || projY > height) {
        projectile = null;
        switchPlayer();
        return;
    }

    if (projX >= 0 && projX < width && projY >= terrain[projX]) {
        destroyTerrain(projX, projY);
        createExplosion(projX, projY);
        projectile = null;
        switchPlayer();
        return;
    }

    for (const tank of tanks) {
        if (projectile && tank.player !== projectile.player) {
            const dist = Math.sqrt(Math.pow(projX - tank.x, 2) + Math.pow(projY - tank.y, 2));
            if (dist < tank.width / 2) {
                createExplosion(projX, projY);
                handleHit(tank);
                projectile = null;
                if (!gameOver) switchPlayer();
                return;
            }
        }
    }
}
// ---------------------------------
// 헬퍼 함수
// ---------------------------------
function applyItemEffect(tank, item) {
    if (item.type === 'HEALTH') {
        tank.health = Math.min(tank.health + 30, 100);
        gameStatus.textContent = `Player ${tank.player} got Health Pack!`;
    } else if (item.type === 'POWER') {
        tank.doubleShot = true;
        gameStatus.textContent = `Player ${tank.player} got Double Shot!`;
    } else if (item.type === 'FUEL') {
        tank.fuel = tank.maxFuel;
        gameStatus.textContent = `Player ${tank.player} got Fuel Refill!`;
    }
}

function handleHit(tank) {
    let damage = Math.floor(Math.random() * 20) + 25;
    
    if (projectile && projectile.isDoubleShot) {
        damage *= 2;
        if (projectile.player === 2 && gameMode === 'pve') damage *= tanks[1].powerMult;
    }

    tank.health -= damage;
    if (tank.health < 0) tank.health = 0;

    for (let i = 0; i < 15; i++) {
        createSmoke(tank.x + (Math.random() - 0.5) * 30, tank.y + (Math.random() - 0.5) * 20);
    }

    gameStatus.textContent = `Player ${tank.player} took ${damage} damage!`;

    if (tank.health <= 0) {
        gameOver = true;
        const winner = tank.player === 1 ? 2 : 1;
        gameStatus.textContent = `Game Over! Player ${winner} wins!`;

        if (gameMode === 'pve') {
            if (winner === 1) {
                // Player Wins -> Next Level
                setTimeout(() => {
                    npcLevel++;
                    startGame(width, height, 'pve');
                }, 2000);
                return;
            } else {
                // NPC Wins -> Game Over
                updateRankings(npcLevel);
            }
        }
        
        const gameOverScreen = document.getElementById('gameOverScreen');
        const winnerText = document.getElementById('winnerText');
        
        winnerText.textContent = gameMode === 'pve' ? `Game Over (Level ${npcLevel})` : `Player ${winner} Wins!`;
        gameOverScreen.style.display = 'flex';
    }
}

function drawTrajectory(tank, angle, power) {
    const startX = tank.x + tank.turretLength * Math.cos(angle);
    const startY = tank.y + tank.turretLength * Math.sin(angle);
    
    const speed = power / 5;
    let vx = speed * Math.cos(angle);
    let vy = speed * Math.sin(angle);
    
    let x = startX;
    let y = startY;
    
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    for (let i = 0; i < 200; i++) {
        vy += gravity;
        // Wind is intentionally ignored for difficulty
        x += vx;
        y += vy;
        
        ctx.lineTo(x, y);
        
        if (x < 0 || x >= width || y > height) break;
        if (x >= 0 && x < width && y >= terrain[Math.floor(x)]) break;
    }
    
    ctx.stroke();
    ctx.restore();
}

function updateUI(player, angle, power) {
    let degrees = (-angle * 180 / Math.PI + 360) % 360;
    const uiPower = (power / 150) * 100;

    const angleInput = document.getElementById(`angle${player}`);
    const angleValue = document.getElementById(`angleValue${player}`);
    const powerInput = document.getElementById(`power${player}`);
    const powerValue = document.getElementById(`powerValue${player}`);

    if (angleInput && angleValue) {
        const deg = Math.round(degrees);
        angleInput.value = deg;
        angleValue.textContent = deg;
    }
    if (powerInput && powerValue) {
        const pwr = Math.round(uiPower);
        powerInput.value = pwr;
        powerValue.textContent = pwr;
    }
}

function switchPlayer() {
    if (gameOver) return;
    
    document.getElementById(`player${currentPlayer}Controls`).classList.remove('active');
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    document.getElementById(`player${currentPlayer}Controls`).classList.add('active');
    generateWind();
    spawnItem();

    if (gameMode === 'pve' && currentPlayer === 2) {
        setTimeout(computerTurn, 1000);
    }
}

function computerTurn() {
    if (gameOver || currentPlayer !== 2) return;

    const npc = tanks[1];
    
    // AI Movement
    const shouldMove = Math.random() < 0.6; // 60% chance to move
    
    if (shouldMove) {
        const direction = Math.random() < 0.5 ? -1 : 1;
        const duration = Math.random() * 1000 + 500; // 0.5 ~ 1.5 sec
        const startTime = Date.now();
        
        const moveInterval = setInterval(() => {
            if (gameOver || currentPlayer !== 2) {
                clearInterval(moveInterval);
                return;
            }
            
            npc.move(direction);
            
            // Random Jump
            if (Math.random() < 0.02) {
                npc.jump();
            }
            
            // Check boundaries or fuel
            if (Date.now() - startTime > duration || npc.fuel <= 0) {
                clearInterval(moveInterval);
                setTimeout(computerFire, 500);
            }
        }, 16);
    } else {
        setTimeout(computerFire, 500);
    }
}

function computerFire() {
    if (gameOver || currentPlayer !== 2) return;

    const npc = tanks[1];
    const target = tanks[0];

    // Simple AI: Calculate approximate angle/power
    // Simulate shots to find best parameters
    let bestShot = { angle: Math.PI, power: 50, error: Infinity };
    
    // Try a range of angles and powers
    for (let a = 110; a <= 250; a += 5) {
        for (let p = 20; p <= 100; p += 10) {
            const rad = a * Math.PI / 180;
            const error = simulateShot(npc, target, rad, p);
            if (error < bestShot.error) {
                bestShot = { angle: rad, power: p, error: error };
            }
        }
    }

    // Apply Accuracy Error (Randomness based on level)
    const errorRange = npc.accuracy * (Math.PI / 180);
    const finalAngle = bestShot.angle + (Math.random() - 0.5) * errorRange;
    const finalPower = Math.min(100, Math.max(10, bestShot.power + (Math.random() - 0.5) * npc.accuracy));

    fire(2, finalAngle, finalPower);
}

function simulateShot(source, target, angle, power) {
    let x = source.x;
    let y = source.y;
    let vx = (power / 5) * Math.cos(angle);
    let vy = (power / 5) * Math.sin(angle);
    let minDist = Infinity;

    // Simulate trajectory
    for (let i = 0; i < 200; i++) {
        vy += gravity;
        vx += wind;
        x += vx;
        y += vy;
        const d = Math.sqrt((x - target.x)**2 + (y - target.y)**2);
        if (d < minDist) minDist = d;
        if (y > height || x < 0 || x > width) break;
    }
    return minDist;
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    let clientX = e.clientX;
    let clientY = e.clientY;

    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    }

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

function setupControls() {
    // Player 1 Controls
    const p1Angle = document.getElementById('angle1');
    const p1Power = document.getElementById('power1');
    const p1Fire = document.getElementById('fireButton1');

    const updateP1 = () => {
        const angle = parseInt(p1Angle.value);
        const power = parseInt(p1Power.value);
        document.getElementById('angleValue1').textContent = angle;
        document.getElementById('powerValue1').textContent = power;
        lastFireInfo[1] = { angle: -angle * Math.PI / 180, power: power };
    };

    if (p1Angle) p1Angle.addEventListener('input', updateP1);
    if (p1Power) p1Power.addEventListener('input', updateP1);
    
    if (p1Fire) p1Fire.addEventListener('click', () => {
        if (currentPlayer === 1 && !projectile && !gameOver) {
            const info = lastFireInfo[1];
            fire(1, info.angle, info.power);
        }
    });

    // Player 2 Controls
    const p2Angle = document.getElementById('angle2');
    const p2Power = document.getElementById('power2');
    const p2Fire = document.getElementById('fireButton2');

    const updateP2 = () => {
        const angle = parseInt(p2Angle.value);
        const power = parseInt(p2Power.value);
        document.getElementById('angleValue2').textContent = angle;
        document.getElementById('powerValue2').textContent = power;
        lastFireInfo[2] = { angle: -angle * Math.PI / 180, power: power };
    };

    if (p2Angle) p2Angle.addEventListener('input', updateP2);
    if (p2Power) p2Power.addEventListener('input', updateP2);

    if (p2Fire) p2Fire.addEventListener('click', () => {
        if (currentPlayer === 2 && !projectile && !gameOver) {
            const info = lastFireInfo[2];
            fire(2, info.angle, info.power);
        }
    });

    const cameraToggleBtn = document.getElementById('cameraToggleBtn');
    if (cameraToggleBtn) {
        cameraToggleBtn.addEventListener('click', () => {
            cameraFollowsProjectile = !cameraFollowsProjectile;
            cameraToggleBtn.textContent = cameraFollowsProjectile ? "카메라: 추적" : "카메라: 고정";
            cameraToggleBtn.blur(); // 버튼 포커스 해제 (키보드 조작 방해 방지)
        });
    }

    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.style.display = 'flex';
        });
    }
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });
    }

    // Mobile Controls
    const btnLeft = document.getElementById('btnLeft');
    const btnRight = document.getElementById('btnRight');
    const btnJump = document.getElementById('btnJump');

    const addTouchBtn = (btn, key) => {
        if (!btn) return;
        const start = (e) => { e.preventDefault(); mobileKeys[key] = true; };
        const end = (e) => { e.preventDefault(); mobileKeys[key] = false; };
        btn.addEventListener('touchstart', start);
        btn.addEventListener('touchend', end);
        btn.addEventListener('mousedown', start);
        btn.addEventListener('mouseup', end);
    };

    addTouchBtn(btnLeft, 'left');
    addTouchBtn(btnRight, 'right');
    addTouchBtn(btnJump, 'jump');
}

function displayRankings() {
    const board = document.getElementById('rankingBoard');
    if (!board) return;
    
    let html = '<h3>🏆 PvE Ranking (Top 5) 🏆</h3><ul style="list-style: none; padding: 0;">';
    if (rankings.length === 0) {
        html += '<li>No records yet</li>';
    } else {
        rankings.forEach((r, i) => {
            html += `<li>${i + 1}. Level ${r.level} (${r.date})</li>`;
        });
    }
    html += '</ul>';
    board.innerHTML = html;
}

let resizeTimer;
function resizeCanvas() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        canvas.width = document.documentElement.clientWidth * 0.8;
        canvas.height = document.documentElement.clientHeight * 0.8;
        
        if (gameStarted) {
            startGame(canvas.width, canvas.height, gameMode);
        }
    }, 250);
}

function init() {
    console.log("Loading game resources...");
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    setupControls();

    const pvpBtn = document.getElementById('pvpBtn');
    const pveBtn = document.getElementById('pveBtn');
    const startScreen = document.getElementById('startScreen');

    displayRankings();

    const handleStart = (mode) => {
        soundManager.init();
        startScreen.style.display = 'none';
        gameStarted = true;
        
        if (resizeTimer) clearTimeout(resizeTimer);
        canvas.width = document.documentElement.clientWidth * 0.8;
        canvas.height = document.documentElement.clientHeight * 0.8;
        startGame(canvas.width, canvas.height, mode);
    };

    if (pvpBtn) {
        pvpBtn.addEventListener('click', () => handleStart('pvp'));
    }
    
    if (pveBtn) {
        pveBtn.addEventListener('click', () => handleStart('pve'));
    }

    const restartBtn = document.getElementById('restartBtn');
    const gameOverScreen = document.getElementById('gameOverScreen');
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            gameOverScreen.style.display = 'none';
            startScreen.style.display = 'flex'; // Go back to start screen
            gameStarted = false;
            displayRankings();
            // Or restart same mode:
            // startGame(width, height, gameMode);
            // But going to start screen is better to see ranking
        });
    }

    resourceLoader.load(['side_tank.png'], () => {
        window.addEventListener('resize', resizeCanvas);
        
        canvas.addEventListener('mousedown', (e) => {
            if (gameOver || projectile) return;
            isAiming = true;
            const screenPos = getMousePos(e);
            mousePos = {
                x: (screenPos.x - width / 2) / camera.scale + camera.x,
                y: (screenPos.y - height / 2) / camera.scale + camera.y
            };
            
            const currentTank = tanks[currentPlayer - 1];
            const dx = mousePos.x - currentTank.x;
            const dy = mousePos.y - currentTank.y;
            const angle = Math.atan2(dy, dx);
            const power = Math.min(Math.sqrt(dx * dx + dy * dy), 150);
            
            updateUI(currentPlayer, angle, power);
        });

        canvas.addEventListener('touchstart', (e) => {
            if (gameOver || projectile) return;
            e.preventDefault();
            isAiming = true;
            const screenPos = getMousePos(e);
            mousePos = {
                x: (screenPos.x - width / 2) / camera.scale + camera.x,
                y: (screenPos.y - height / 2) / camera.scale + camera.y
            };
            
            const currentTank = tanks[currentPlayer - 1];
            const dx = mousePos.x - currentTank.x;
            const dy = mousePos.y - currentTank.y;
            const angle = Math.atan2(dy, dx);
            const power = Math.min(Math.sqrt(dx * dx + dy * dy), 150);
            
            updateUI(currentPlayer, angle, power);
        }, { passive: false });

        canvas.addEventListener('mouseup', (e) => {
            if (!isAiming) return;
            isAiming = false;
            
            const currentTank = tanks[currentPlayer - 1];
            let dx = mousePos.x - currentTank.x;
            let dy = mousePos.y - currentTank.y;

            let angle = Math.atan2(dy, dx);
            
            const power = Math.min(Math.sqrt(dx * dx + dy * dy), 150);

            fire(currentPlayer, angle, power);
        });

        canvas.addEventListener('touchend', (e) => {
            if (!isAiming) return;
            e.preventDefault();
            isAiming = false;
            
            const currentTank = tanks[currentPlayer - 1];
            let dx = mousePos.x - currentTank.x;
            let dy = mousePos.y - currentTank.y;

            let angle = Math.atan2(dy, dx);
            
            const power = Math.min(Math.sqrt(dx * dx + dy * dy), 150);

            fire(currentPlayer, angle, power);
        });

        canvas.addEventListener('mousemove', (e) => {
            if (isAiming) {
                const screenPos = getMousePos(e);
                mousePos = {
                    x: (screenPos.x - width / 2) / camera.scale + camera.x,
                    y: (screenPos.y - height / 2) / camera.scale + camera.y
                };
                
                const currentTank = tanks[currentPlayer - 1];
                const dx = mousePos.x - currentTank.x;
                const dy = mousePos.y - currentTank.y;
                const angle = Math.atan2(dy, dx);
                const power = Math.min(Math.sqrt(dx * dx + dy * dy), 150);
                
                updateUI(currentPlayer, angle, power);
            }
        });

        canvas.addEventListener('touchmove', (e) => {
            if (isAiming) {
                e.preventDefault();
                const screenPos = getMousePos(e);
                mousePos = {
                    x: (screenPos.x - width / 2) / camera.scale + camera.x,
                    y: (screenPos.y - height / 2) / camera.scale + camera.y
                };
                
                const currentTank = tanks[currentPlayer - 1];
                const dx = mousePos.x - currentTank.x;
                const dy = mousePos.y - currentTank.y;
                const angle = Math.atan2(dy, dx);
                const power = Math.min(Math.sqrt(dx * dx + dy * dy), 150);
                
                updateUI(currentPlayer, angle, power);
            }
        }, { passive: false });
        
        window.addEventListener('keydown', (e) => {
            keys[e.code] = true;
        });

        window.addEventListener('keyup', (e) => {
            keys[e.code] = false;
        });

        resizeCanvas();
    });
}

// 게임 시작
init();
