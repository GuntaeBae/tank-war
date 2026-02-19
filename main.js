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

// ---------------------------------
// 게임 상태 및 상수
// ---------------------------------
let wind = 0;
let turnCount = 0;
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
    const cy = 30;
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
    const cy = 70; // Below wind indicator

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
    if (tank.shield) {
        tank.shield = false;
        gameStatus.textContent = `Player ${tank.player}'s Shield blocked the attack!`;
        createExplosion(tank.x, tank.y); // Visual effect for block
        return; // No damage
    }

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

function updateUI(player, angle, power) {
    let degrees = (-angle * 180 / Math.PI + 360) % 360;
    const uiPower = (power / 150) * 100;

    const shotInfo = document.getElementById('shotInfo');
    if (shotInfo) {
        shotInfo.textContent = `Angle: ${Math.round(degrees)}° | Power: ${Math.round(uiPower)}`;
    }
}

function switchPlayer() {
    if (gameOver) return;
    
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    
    // 턴 정보 업데이트
    const turnInfo = document.getElementById('turnInfo');
    if (turnInfo) turnInfo.textContent = gameMode === 'pve' && currentPlayer === 2 ? "Computer Turn" : `Player ${currentPlayer} Turn`;
    if (turnInfo) turnInfo.style.color = currentPlayer === 1 ? '#4CAF50' : '#FF5722';
    
    turnCount++;
    if (turnCount % 3 === 0) {
        generateWind();
    }
    
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
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
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
    const gameTitle = document.getElementById('gameTitle');

    // 홈 버튼 생성 (게임 중 초기 화면으로 돌아가기)
    const homeBtn = document.createElement('button');
    homeBtn.textContent = '🏠';
    homeBtn.style.position = 'absolute';
    homeBtn.style.top = '20px';
    homeBtn.style.left = '20px';
    homeBtn.style.fontSize = '24px';
    homeBtn.style.padding = '5px 10px';
    homeBtn.style.cursor = 'pointer';
    homeBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
    homeBtn.style.border = '2px solid #333';
    homeBtn.style.borderRadius = '10px';
    homeBtn.style.zIndex = '1000';
    homeBtn.style.display = 'none'; // 초기에는 숨김
    homeBtn.title = "초기 화면으로";
    document.body.appendChild(homeBtn);

    homeBtn.addEventListener('click', () => {
        if (confirm('게임을 종료하고 초기 화면으로 돌아가시겠습니까?')) {
            // 확인 버튼을 눌렀을 때만 전체 화면 모드 해제
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(err => console.log(err));
            }

            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            gameOver = true; // 진행 중인 로직 중단용
            gameStarted = false;
            startScreen.style.display = 'flex';
            if (gameTitle) gameTitle.style.display = 'block';
            gameOverScreen.style.display = 'none';
            homeBtn.style.display = 'none';
            displayRankings();
        }
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
        
        if (resizeTimer) clearTimeout(resizeTimer);
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        startGame(canvas.width, canvas.height, mode);
        updateSkillUI();
        homeBtn.style.display = 'block';
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
            if (gameTitle) gameTitle.style.display = 'block';
            gameStarted = false;
            homeBtn.style.display = 'none';
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
