class Tank {
    constructor(x, player, terrain, typeInfo) {
        this.player = player;
        
        const stats = typeInfo || {};
        const imgSrc = stats.image || 'side_tank.png';
        this.baseImg = resourceLoader.images[imgSrc];
        
        this.width = stats.width || 60; 
        this.height = stats.height || 25; 
        this.x = x;
        this.y = terrain[Math.floor(x)] - this.height / 2;
        this.turretLength = 40;
        this.turretHeight = 6;
        
        this.health = stats.hp !== undefined ? stats.hp : 100;
        this.powerMult = stats.power !== undefined ? stats.power : 1.0;
        this.maxFuel = stats.fuel !== undefined ? stats.fuel : 300;
        this.maxHealth = this.health;
        
        this.doubleShot = false;
        this.fuel = this.maxFuel;
        this.wheelRadius = 5;
        this.wheelOffsets = [-20, -7, 6, 19];
        this.vy = 0;
        this.onGround = true;
        this.shield = false;
        this.cooldowns = { shield: 0, double: 0 };
        
        // NPC Stats
        this.accuracy = 0; // Error range in degrees

        // Tint Cache for Player 2
        if (this.player === 2) {
            const dpr = window.devicePixelRatio || 1;
            this.cacheCanvas = document.createElement('canvas');
            this.cacheCanvas.width = this.width * dpr;
            this.cacheCanvas.height = this.height * dpr;
            this.cacheCtx = this.cacheCanvas.getContext('2d');
            this.cacheCtx.scale(dpr, dpr);
            this.lastTintLevel = -1;
            this.lastGameMode = '';
        }
    }

    updateTintCache(level) {
        this.cacheCtx.clearRect(0, 0, this.width, this.height);
        if (this.baseImg) {
            this.cacheCtx.drawImage(this.baseImg, 0, 0, this.width, this.height);
        }
        
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
        ctx.fillRect(-healthBarWidth / 2, -this.height - 15, healthBarWidth * (this.health / this.maxHealth), healthBarHeight);

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

        // Shield Visual
        if (this.shield) {
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 191, 255, 0.8)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, -this.height/2, this.width * 0.8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        if (this.player === 1) {
            ctx.scale(-1, 1);
            // Tank base
            if (this.baseImg) {
                ctx.drawImage(this.baseImg, -this.width / 2, -this.height/2, this.width, this.height);
            }
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
    constructor(x, y, angle, power, player, damageMult = 1, isDoubleShot = false) {
        this.x = x;
        this.y = y;
        this.radius = 5;
        this.player = player;
        this.damageMult = damageMult;
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

        if (Math.random() < 0.6) {
            createSmoke(this.x, this.y);
        }
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
        // 바람의 영향 추가 (wind 값에 따라 방향과 속도 변화)
        this.x += this.speed + (wind * 50);
        if (this.x > width + 100) {
            this.x = -100;
            this.y = Math.random() * (height * 0.4);
        } else if (this.x < -100) {
            this.x = width + 100;
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

class Bird {
    constructor() {
        this.reset();
        // 처음 생성될 때는 화면 전체에 랜덤하게 배치
        this.x = Math.random() * width;
    }

    reset() {
        // 화면 상단 40% 영역에서 비행
        this.y = Math.random() * (height * 0.4);
        this.speed = Math.random() * 2 + 1;
        this.size = Math.random() * 3 + 2;
        this.wingAngle = Math.random() * Math.PI * 2;
        this.wingSpeed = 0.1 + Math.random() * 0.1;
        
        // 50% 확률로 왼쪽/오른쪽 출발 결정
        if (Math.random() < 0.5) {
            this.direction = 1; // 오른쪽으로 이동
            this.x = -50;
        } else {
            this.direction = -1; // 왼쪽으로 이동
            this.x = width + 50;
        }
    }

    update() {
        // 이동 (바람의 영향을 받음)
        this.x += (this.speed * this.direction) + (wind * 30);
        this.y += Math.sin(this.wingAngle) * 0.5; // 약간의 상하 움직임
        this.wingAngle += this.wingSpeed;

        // 화면 밖으로 나가면 위치 리셋
        if ((this.direction === 1 && this.x > width + 50) || 
            (this.direction === -1 && this.x < -50)) {
            this.reset();
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(this.direction, 1); // 진행 방향에 맞춰 반전
        
        ctx.strokeStyle = 'rgba(50, 50, 50, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        
        // 날개짓 애니메이션 (V자 모양 변형)
        const wingY = Math.sin(this.wingAngle) * 3;
        ctx.moveTo(-this.size, -wingY);
        ctx.quadraticCurveTo(0, 0, this.size, -wingY);
        
        ctx.stroke();
        ctx.restore();
    }
}
