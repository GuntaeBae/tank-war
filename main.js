// ---------------------------------
// 초기 설정
// ---------------------------------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let width, height;

// UI 요소
const gameStatus = document.getElementById('gameStatus');
let currentAimInfo = { angle: 0, power: 0 };

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
                
                // [수정] 이미지 로딩 실패 시 게임 중단을 막기 위한 더미 이미지 생성
                const dummyCanvas = document.createElement('canvas');
                dummyCanvas.width = 60;
                dummyCanvas.height = 30;
                const dCtx = dummyCanvas.getContext('2d');
                dCtx.fillStyle = '#FF00FF'; // 에러 식별용 마젠타 색상
                dCtx.fillRect(0, 0, 60, 30);
                const dummyImg = new Image();
                dummyImg.src = dummyCanvas.toDataURL();
                this.images[url] = dummyImg;

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
    soundEnabled: true,
    init() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
    },
    playShoot() {
        if (!this.soundEnabled) return;
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
        if (!this.soundEnabled) return;
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

let selectedTankType = 'normal';

window.TANK_TYPES = {
    'normal': { name: 'Normal', hp: 100, power: 1.0, fuel: 300, desc: '밸런스형 기본 탱크', image: 'side_tank.png', width: 60, height: 25 },
    'heavy': { name: 'Heavy', hp: 150, power: 1.4, fuel: 200, desc: '높은 체력과 공격력, 낮은 기동성', image: 'tank_base.png', width: 65, height: 30 },
    'light': { name: 'Light', hp: 70, power: 0.8, fuel: 500, desc: '빠른 이동 속도, 낮은 체력', image: 'tank_turret.png', width: 50, height: 20 }
};

// ---------------------------------
// 게임 상태 및 상수
// ---------------------------------
let wind = 0;
let windTime = 0;
let turnCount = 0;
let totalScore = 0;
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

// 게임 객체
let terrain = [];
let tanks = [];
let particles = [];
let clouds = [];
let birds = [];
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

    projectile = new Projectile(startX, startY, angle, power, player, tank.powerMult, tank.doubleShot);
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

function updateWind() {
    let difficulty = 1;
    if (gameMode === 'pve') {
        difficulty = 1 + (npcLevel - 1) * 0.4; // 레벨이 오를수록 바람 세기 증가
    } else {
        difficulty = 1 + Math.min(turnCount * 0.1, 2); // PvP는 턴이 지날수록 증가
    }

    windTime += 0.0005 * difficulty; // 기본 속도를 10배 늦추고, 난이도(레벨)에 비례하여 빨라지게 설정

    // 복합 사인파로 불규칙하고 자연스러운 바람 변화 구현
    const noise = Math.sin(windTime) + Math.sin(windTime * 2.3) * 0.5;
    const strength = 0.02 * difficulty; // 기본 세기에 난이도 반영
    
    wind = noise * strength;
}

function drawBackground() {
    // 1. 기본 배경색
    ctx.fillStyle = currentTheme.bg;
    ctx.fillRect(0, 0, width, height);

    // 2. 그라데이션 오버레이 (입체감)
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.3)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // 3. 격자 패턴 (공간감, 줌인 시 깨짐 방지)
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);

    const gridSize = 100;
    // 화면에 보이는 영역만 계산하여 그리기 (최적화)
    const left = camera.x - (width / 2) / camera.scale;
    const right = camera.x + (width / 2) / camera.scale;
    const top = camera.y - (height / 2) / camera.scale;
    const bottom = camera.y + (height / 2) / camera.scale;

    const startX = Math.floor(left / gridSize) * gridSize;
    const endX = Math.ceil(right / gridSize) * gridSize;
    const startY = Math.floor(top / gridSize) * gridSize;
    const endY = Math.ceil(bottom / gridSize) * gridSize;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = startX; x <= endX; x += gridSize) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
    }
    for (let y = startY; y <= endY; y += gridSize) {
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
    }
    ctx.stroke();
    ctx.restore();
}

function drawHUD() {
    ctx.save();
    const cx = width / 2;
    const cy = 30;
    
    // 1. 데이터 준비
    const windSpeed = Math.round(Math.abs(wind) * 1000);
    let turnLabel = (gameMode === 'pve' && currentPlayer === 2) ? "CPU" : `P${currentPlayer}`;
    
    let displayAngle = currentAimInfo.angle;
    let displayPower = currentAimInfo.power;
    
    // 조준 중이 아닐 때는 마지막 발사 정보 표시
    if (!isAiming && !projectile) {
         const info = lastFireInfo[currentPlayer];
         let deg = (-info.angle * 180 / Math.PI + 360) % 360;
         let pwr = (info.power / 150) * 100;
         displayAngle = Math.round(deg);
         displayPower = Math.round(pwr);
    }

    // 텍스트 구성
    let infoText = `${turnLabel} | A:${displayAngle}° P:${displayPower} | WIND:${windSpeed}`;
    
    if (gameMode === 'pve') {
        const tank2 = tanks[1];
        infoText += ` | NPC HP:${Math.round(tank2.health)}`;
    }

    ctx.font = '12px Arial';
    const textMetrics = ctx.measureText(infoText);
    const textWidth = textMetrics.width;

    // 통합 패널 배경
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    // 내용에 따라 높이 조절
    let panelHeight = 45;
    let panelWidth = Math.max(300, textWidth + 60);
    
    if (ctx.roundRect) {
        ctx.roundRect(cx - panelWidth / 2, 10, panelWidth, panelHeight, 15);
    } else {
        ctx.rect(cx - panelWidth / 2, 10, panelWidth, panelHeight);
    }
    ctx.fill();

    // 2. 바람 게이지 (Wind Bar)
    const barWidth = 200;
    let currentY = cy + 10;
    
    // 텍스트 그리기
    ctx.fillStyle = '#ddd';
    ctx.textAlign = 'center';
    ctx.fillText(infoText, cx, cy - 5);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(cx - barWidth/2, currentY, barWidth, 4);

    // Center marker
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 1, currentY - 5, 2, 14);
    
    // Wind bar
    const windMax = 0.1; // 더 강한 바람을 표시하기 위해 게이지 범위 확장
    let windWidth = (wind / windMax) * (barWidth / 2);
    ctx.fillStyle = wind > 0 ? '#00BFFF' : '#FF4500'; 
    ctx.fillRect(cx, currentY, windWidth, 4);
    

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

function updateRankings(level, name, score) {
    const date = new Date().toLocaleDateString();
    rankings.push({ level: level, name: name, score: score || 0, date: date });
    rankings.sort((a, b) => (b.score || 0) - (a.score || 0)); // 점수 기준 내림차순 정렬
    rankings = rankings.slice(0, 5); // Keep top 5
    localStorage.setItem('fortress_rankings', JSON.stringify(rankings));
    displayRankings();
}

// ---------------------------------
// 게임 초기화 및 루프
// ---------------------------------
function startGame(canvasWidth, canvasHeight, mode = 'pvp', tankType1 = 'normal', tankType2 = 'normal') {
    width = canvasWidth;
    height = canvasHeight;

    gameOver = false;
    projectile = null;
    tanks = [];
    particles = [];
    clouds = [];
    birds = [];
    items = [];
    currentPlayer = 1;
    turnCount = 0;
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
    windTime = Math.random() * 1000; // 바람 시작점 랜덤화
    
    // Reset Camera
    camera = { x: width / 2, y: height / 2, scale: 1 };

    generateTerrain(width, height);
    
    const tank1X = Math.floor(width * 0.15);
    const tank2X = Math.floor(width * 0.85);
    tanks.push(new Tank(tank1X, 1, terrain, window.TANK_TYPES[tankType1]));
    tanks.push(new Tank(tank2X, 2, terrain, window.TANK_TYPES[tankType2]));

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
    
    for (let i = 0; i < 10; i++) {
        birds.push(new Bird());
    }

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    gameLoop();
}


function gameLoop() {
    if (gameOver) return;
    updateWind(); // 매 프레임 실시간으로 바람 업데이트

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
    let lerpFactor = 0.05; // 기본: 부드럽게 (줌 인/아웃 시)

    if (cameraFollowsProjectile && projectile) {
        targetScale = 1.5;
        targetX = projectile.x;
        targetY = projectile.y;
        lerpFactor = 0.1; // 추적 시: 빠르게 (박진감)
    } else if (tanks.length >= 2) {
        // 탱크 간 거리에 따른 동적 카메라 줌
        const t1 = tanks[0];
        const t2 = tanks[1];
        
        const midX = (t1.x + t2.x) / 2;
        const midY = (t1.y + t2.y) / 2;
        const dist = Math.hypot(t1.x - t2.x, t1.y - t2.y);
        
        // 거리가 가까울수록 확대, 멀수록 축소 (여백 400px 기준)
        let zoom = width / (dist + 400);
        targetScale = Math.max(0.7, Math.min(1.4, zoom)); // 최소 0.7배 ~ 최대 1.4배 제한
        targetX = midX;
        targetY = midY;
    }

    // Smooth camera movement (Lerp)
    camera.x += (targetX - camera.x) * lerpFactor;
    camera.y += (targetY - camera.y) * lerpFactor;
    camera.scale += (targetScale - camera.scale) * lerpFactor;

    ctx.clearRect(0, 0, width, height);
    drawBackground();

    ctx.save();
    // Apply Camera Transform
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);

    clouds.forEach(cloud => {
        cloud.update();
        cloud.draw();
    });
    
    birds.forEach(bird => {
        bird.update();
        bird.draw();
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

    drawHUD();

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

// ---------------------------------
// 헬퍼 함수
// ---------------------------------
function applyItemEffect(tank, item) {
    if (item.type === 'HEALTH') {
        tank.health = Math.min(tank.health + 30, tank.maxHealth);
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
    if (tank.shield) {
        tank.shield = false;
        gameStatus.textContent = `Player ${tank.player}'s Shield blocked the attack!`;
        createExplosion(tank.x, tank.y); // Visual effect for block
        return; // No damage
    }

    let damage = 25 * (projectile.damageMult || 1); // 기본 데미지 25 * 배율
    
    if (projectile && projectile.isDoubleShot) {
        damage *= 2;
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
                
                // 점수 계산: (남은 체력 * 10) + (턴 보너스)
                const healthScore = Math.round(tank.health * 10); // tank는 패배자이므로 승자(tanks[0])의 체력을 써야 함. 하지만 여기 tank는 패배한 탱크임.
                const winnerTank = tanks[0];
                const winHealthScore = Math.round(winnerTank.health * 10);
                const turnBonus = Math.max(0, (20 - turnCount) * 50); // 20턴 이내 클리어 시 보너스
                const levelScore = winHealthScore + turnBonus;
                totalScore += levelScore;
                gameStatus.textContent = `You Win! Score: ${levelScore} (Total: ${totalScore})`;

                setTimeout(() => {
                    npcLevel++;
                    startGame(width, height, 'pve', selectedTankType, 'normal');
                }, 2000);
                return;
            } else {
                // NPC Wins -> Game Over
                // 랭킹 저장은 UI에서 처리
            }
        }
        
        const gameOverScreen = document.getElementById('gameOverScreen');
        const winnerText = document.getElementById('winnerText');
        
        winnerText.textContent = gameMode === 'pve' ? `Game Over (Level ${npcLevel})` : `Player ${winner} Wins!`;
        
        const rankingInputContainer = document.getElementById('rankingInputContainer');
        if (rankingInputContainer) {
            // PvE 모드이고 플레이어가 졌을 때만 랭킹 입력 표시
            rankingInputContainer.style.display = (gameMode === 'pve' && winner !== 1) ? 'block' : 'none';
            if (rankingInputContainer.style.display === 'block') document.getElementById('playerNameInput').value = '';
        }

        gameOverScreen.style.display = 'flex';
    }
}

function updateUI(player, angle, power) {
    let degrees = (-angle * 180 / Math.PI + 360) % 360;
    const uiPower = (power / 150) * 100;

    currentAimInfo = { angle: Math.round(degrees), power: Math.round(uiPower) };
    const shotInfo = document.getElementById('shotInfo');
    if (shotInfo) shotInfo.style.display = 'none';
}

function switchPlayer() {
    if (gameOver) return;
    
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    
    // 턴 정보 업데이트
    const turnInfo = document.getElementById('turnInfo');
    if (turnInfo) turnInfo.style.display = 'none';
    
    turnCount++;
    
    // Cooldown Management
    const currentTank = tanks[currentPlayer - 1];
    if (currentTank.cooldowns.shield > 0) currentTank.cooldowns.shield--;
    if (currentTank.cooldowns.double > 0) currentTank.cooldowns.double--;
    
    updateSkillUI();
    spawnItem();

    if (gameMode === 'pve' && currentPlayer === 2) {
        setTimeout(computerTurn, 1000);
    }
}

function updateSkillUI() {
    const btnShield = document.getElementById('btnShield');
    const btnDouble = document.getElementById('btnDouble');
    
    if (!btnShield || !btnDouble) return;

    const currentTank = tanks[currentPlayer - 1];
    
    // 컴퓨터 턴이거나 게임 오버시 버튼 비활성화
    const isDisabled = (gameMode === 'pve' && currentPlayer === 2) || gameOver;

    const updateBtn = (btn, cooldown, name) => {
        if (isDisabled || cooldown > 0) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    };

    updateBtn(btnShield, currentTank.cooldowns.shield, "🛡️");
    updateBtn(btnDouble, currentTank.cooldowns.double, "💥");
}

function computerTurn() {
    if (gameOver || currentPlayer !== 2) return;

    const npc = tanks[1];
    
    // AI Movement
    const shouldMove = Math.random() < 0.6; // 60% chance to move

    // AI Skill Usage
    if (npc.cooldowns.shield === 0 && npc.health < 50 && Math.random() < 0.5) {
        npc.shield = true;
        npc.cooldowns.shield = 4;
        gameStatus.textContent = "Computer used Shield!";
    }
    if (npc.cooldowns.double === 0 && Math.random() < 0.3) {
        npc.doubleShot = true;
        npc.cooldowns.double = 3;
        gameStatus.textContent = "Computer used Double Shot!";
    }
    
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

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    
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
        x: clientX - rect.left,
        y: clientY - rect.top
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

    // Skill Buttons
    const btnShield = document.getElementById('btnShield');
    const btnDouble = document.getElementById('btnDouble');

    if (btnShield) {
        btnShield.addEventListener('click', () => {
            if (gameOver || projectile) return;
            if (gameMode === 'pve' && currentPlayer === 2) return;

            const tank = tanks[currentPlayer - 1];
            if (tank.cooldowns.shield === 0) {
                tank.shield = true;
                tank.cooldowns.shield = 3; // 3 turns cooldown
                updateSkillUI();
                gameStatus.textContent = `Player ${currentPlayer} activated Shield!`;
            }
        });
    }

    if (btnDouble) {
        btnDouble.addEventListener('click', () => {
            if (gameOver || projectile) return;
            if (gameMode === 'pve' && currentPlayer === 2) return;

            const tank = tanks[currentPlayer - 1];
            if (tank.cooldowns.double === 0) {
                tank.doubleShot = true;
                tank.cooldowns.double = 3; // 3 turns cooldown
                updateSkillUI();
                gameStatus.textContent = `Player ${currentPlayer} activated Double Shot!`;
            }
        });
    }


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

    const soundToggleBtn = document.getElementById('soundToggleBtn');
    if (soundToggleBtn) {
        soundToggleBtn.addEventListener('click', () => {
            soundManager.soundEnabled = !soundManager.soundEnabled;
            soundToggleBtn.textContent = soundManager.soundEnabled ? "소리: 켜짐" : "소리: 꺼짐";
            soundToggleBtn.blur();
        });
    }

    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');

    if (settingsBtn) {
        settingsBtn.textContent = '⚙️';
        settingsBtn.style.position = 'absolute';
        settingsBtn.style.top = '20px';
        settingsBtn.style.right = '20px';
        settingsBtn.style.width = '40px';
        settingsBtn.style.height = '40px';
        settingsBtn.style.fontSize = '24px';
        settingsBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        settingsBtn.style.color = 'white';
        settingsBtn.style.border = 'none';
        settingsBtn.style.borderRadius = '50%';
        settingsBtn.style.cursor = 'pointer';
        settingsBtn.style.display = 'flex';
        settingsBtn.style.justifyContent = 'center';
        settingsBtn.style.alignItems = 'center';
        settingsBtn.style.zIndex = '1000';
        
        settingsBtn.addEventListener('mouseenter', () => settingsBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.8)');
        settingsBtn.addEventListener('mouseleave', () => settingsBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.5)');

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

    window.addEventListener('keydown', (e) => {
        if (e.key === '3') {
            if (gameOver || projectile) return;
            if (gameMode === 'pve' && currentPlayer === 2) return;

            const tank = tanks[currentPlayer - 1];
            if (tank.cooldowns.shield === 0) {
                tank.shield = true;
                tank.cooldowns.shield = 3;
                updateSkillUI();
                gameStatus.textContent = `Player ${currentPlayer} activated Shield!`;
            }
        }
    });
}

function displayRankings() {
    const board = document.getElementById('rankingBoard');
    if (!board) return;
    
    let html = '<h3>🏆 PvE Ranking (Top 5) 🏆</h3><ul style="list-style: none; padding: 0;">';
    if (rankings.length === 0) {
        html += '<li>No records yet</li>';
    } else {
        rankings.forEach((r, i) => {
            html += `<li>${i + 1}. ${r.name || 'Unknown'} - ${r.score || 0} pts (Lv.${r.level})</li>`;
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
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        ctx.scale(dpr, dpr);
        
        if (gameStarted) {
            startGame(window.innerWidth, window.innerHeight, gameMode, selectedTankType, 'normal');
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
    const gameTitle = document.getElementById('gameTitle');
    const gameOverScreen = document.getElementById('gameOverScreen');

    // [수정] UI가 캔버스 위에 확실히 오도록 설정 및 초기 캔버스 클릭 무시
    if (startScreen) {
        startScreen.style.zIndex = '1000';
        startScreen.style.position = 'absolute';
        startScreen.style.width = '100%';
        startScreen.style.height = '100%';
    }
    // 초기 화면에서는 캔버스가 클릭 이벤트를 가로채지 않도록 설정
    canvas.style.pointerEvents = 'none';

    // 탱크 선택 UI 컨테이너 생성 (기존 버튼 대체)
    let tankSelectionContainer = document.getElementById('tankSelectionContainer');
    if (!tankSelectionContainer) {
        tankSelectionContainer = document.createElement('div');
        tankSelectionContainer.id = 'tankSelectionContainer';
        tankSelectionContainer.style.display = 'flex';
        tankSelectionContainer.style.justifyContent = 'center';
        tankSelectionContainer.style.flexWrap = 'wrap';
        tankSelectionContainer.style.gap = '15px';
        tankSelectionContainer.style.margin = '20px 0';
        tankSelectionContainer.style.zIndex = '1000';
        tankSelectionContainer.style.position = 'relative';
        
        // 타이틀 뒤에 삽입
        if (gameTitle && gameTitle.parentNode === startScreen) {
            gameTitle.insertAdjacentElement('afterend', tankSelectionContainer);
        } else {
            startScreen.prepend(tankSelectionContainer);
        }
    }
    tankSelectionContainer.innerHTML = ''; // 초기화

    Object.keys(window.TANK_TYPES).forEach(type => {
        const info = window.TANK_TYPES[type];
        const btn = document.createElement('div');
        
        const isSelected = selectedTankType === type;
        btn.style.border = isSelected ? '2px solid #FFD700' : '2px solid rgba(255, 255, 255, 0.3)';
        btn.style.backgroundColor = isSelected ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.6)';
        btn.style.borderRadius = '10px';
        btn.style.padding = '15px';
        btn.style.width = '140px';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'all 0.2s ease';
        btn.style.textAlign = 'center';
        btn.style.color = 'white';
        
        // 데이터가 없을 경우를 대비한 기본값 설정 (NPC 기준)
        const displayHp = info.hp !== undefined ? info.hp : 100;
        const displayPower = info.power !== undefined ? info.power : 1.0;
        const displayFuel = info.fuel !== undefined ? info.fuel : 300;
        const displayDesc = info.desc || '기본 탱크';

        btn.innerHTML = `
            <div style="font-size: 1.2em; font-weight: bold; color: ${isSelected ? '#FFD700' : '#fff'}; margin-bottom: 5px;">${info.name}</div>
            <img src="${info.image}" style="width: 50px; height: 30px; object-fit: contain; margin-bottom: 5px;">
            <div style="font-size: 0.8em; color: #ccc; margin-bottom: 5px; height: 35px; overflow: hidden;">${displayDesc}</div>
            <div style="display: flex; justify-content: space-around; font-size: 0.9em; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">
                <div title="Health">❤️ ${displayHp}</div>
                <div title="Power">⚔️ ${Math.round(displayPower * 100)}%</div>
            </div>
            <div style="font-size: 0.9em; margin-top: 5px;" title="Fuel">⛽ ${displayFuel}</div>
        `;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedTankType = type;
            // UI 업데이트
            Array.from(tankSelectionContainer.children).forEach(child => {
                child.style.border = '2px solid rgba(255, 255, 255, 0.3)';
                child.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
                child.querySelector('div:first-child').style.color = '#fff';
            });
            btn.style.border = '2px solid #FFD700';
            btn.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
            btn.querySelector('div:first-child').style.color = '#FFD700';
        });

        tankSelectionContainer.appendChild(btn);
    });

    // 홈 버튼 생성 (게임 중 초기 화면으로 돌아가기)
    const homeBtn = document.createElement('button');
    homeBtn.textContent = '🏠';
    homeBtn.style.position = 'absolute';
    homeBtn.style.top = '20px';
    homeBtn.style.left = '20px';
    homeBtn.style.width = '50px';
    homeBtn.style.height = '50px';
    homeBtn.style.fontSize = '24px';
    homeBtn.style.cursor = 'pointer';
    homeBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    homeBtn.style.color = 'white';
    homeBtn.style.border = 'none';
    homeBtn.style.borderRadius = '50%';
    homeBtn.style.justifyContent = 'center';
    homeBtn.style.alignItems = 'center';
    homeBtn.style.zIndex = '1000';
    homeBtn.style.display = 'none'; // 초기에는 숨김
    homeBtn.title = "초기 화면으로";
    homeBtn.style.touchAction = 'manipulation'; // 모바일 터치 딜레이 제거
    
    homeBtn.addEventListener('mouseenter', () => homeBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.8)');
    homeBtn.addEventListener('mouseleave', () => homeBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.5)');
    
    document.body.appendChild(homeBtn);

    // 버튼 클릭 시 캔버스로 이벤트가 전파되어 게임 로직이 실행되는 것을 방지
    const stopEvent = (e) => e.stopPropagation();
    homeBtn.addEventListener('mousedown', stopEvent);
    homeBtn.addEventListener('touchstart', stopEvent);

    homeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // 게임 일시 정지
        if (animationFrameId) cancelAnimationFrame(animationFrameId);

        // 확인 절차 없이 바로 홈으로 이동
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(err => console.log(err));
        }

        gameOver = true; // 진행 중인 로직 중단용
        gameStarted = false;
        startScreen.style.display = 'flex';
        if (gameTitle) gameTitle.style.display = 'block';
        if (gameOverScreen) gameOverScreen.style.display = 'none';
        homeBtn.style.display = 'none';
        
        // [수정] 초기 화면 복귀 시 캔버스 입력 비활성화 (UI 클릭 허용)
        canvas.style.pointerEvents = 'none';
        displayRankings();
    });

    displayRankings();

    const handleStart = (mode) => {
        // 게임 시작 버튼 클릭 시 전체 화면 모드로 전환 시도
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(err => {
                // 사용자가 거부하거나 전환 실패 시 에러 로그 (게임 진행에는 영향 없음)
                console.log(`전체 화면 전환 실패: ${err.message}`);
            });
        }

        soundManager.init();
        startScreen.style.display = 'none';
        if (gameTitle) gameTitle.style.display = 'none';
        gameStarted = true;
        totalScore = 0; // 점수 초기화
        
        // [수정] 게임 시작 시 캔버스 입력 활성화
        canvas.style.pointerEvents = 'auto';
        
        if (resizeTimer) clearTimeout(resizeTimer);
        
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        ctx.scale(dpr, dpr);

        startGame(window.innerWidth, window.innerHeight, mode, selectedTankType, 'normal');
        updateSkillUI();
        homeBtn.style.display = 'flex';
    };

    if (pvpBtn) {
        pvpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleStart('pvp');
        });
    }
    
    if (pveBtn) {
        pveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleStart('pve');
        });
    }

    const saveRankingBtn = document.getElementById('saveRankingBtn');
    if (saveRankingBtn) {
        saveRankingBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('playerNameInput');
            const name = nameInput.value.trim() || 'Player';
            updateRankings(npcLevel, name, totalScore);
            document.getElementById('rankingInputContainer').style.display = 'none';
            alert('랭킹이 저장되었습니다!');
        });
    }

    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            gameOverScreen.style.display = 'none';
            startScreen.style.display = 'flex'; // Go back to start screen
            if (gameTitle) gameTitle.style.display = 'block';
            gameStarted = false;
            homeBtn.style.display = 'none';
            
            // [수정] 초기 화면 복귀 시 캔버스 입력 비활성화
            canvas.style.pointerEvents = 'none';
            displayRankings();
            // Or restart same mode:
            // startGame(width, height, gameMode);
            // But going to start screen is better to see ranking
        });
    }

    resourceLoader.load(['side_tank.png', 'tank_base.png', 'tank_turret.png'], () => {
        window.addEventListener('resize', resizeCanvas);
        
        canvas.addEventListener('mousedown', (e) => {
            if (gameOver || projectile) return;
            if (gameMode === 'pve' && currentPlayer === 2) return;
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
            if (gameMode === 'pve' && currentPlayer === 2) return;
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
            if (gameMode === 'pve' && currentPlayer === 2) return;
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
            if (gameMode === 'pve' && currentPlayer === 2) return;
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
                if (gameMode === 'pve' && currentPlayer === 2) return;
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
                if (gameMode === 'pve' && currentPlayer === 2) return;
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
