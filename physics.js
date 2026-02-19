const gravity = 0.1;

function generateTerrain(canvasWidth, canvasHeight) {
    terrain = [];
    let baseHeight = canvasHeight * 0.7;
    
    // 지형 타입 결정
    const terrainTypes = ['FLAT', 'VALLEY', 'MOUNTAIN', 'CHAOTIC'];
    let type = terrainTypes[Math.floor(Math.random() * terrainTypes.length)];
    
    if (gameMode === 'pve') {
        type = terrainTypes[(npcLevel - 1) % terrainTypes.length];
    }

    // 파라미터 설정
    let amp1 = 0, freq1 = 0;
    let amp2 = 0, freq2 = 0;
    let offsetPhase = Math.random() * Math.PI * 2; // 시작 위상 랜덤

    switch (type) {
        case 'FLAT': // 평탄한 지형
            amp1 = canvasHeight * 0.05; freq1 = 0.005;
            amp2 = canvasHeight * 0.02; freq2 = 0.02;
            break;
        case 'VALLEY': // 계곡형 (중앙이 낮음)
            baseHeight = canvasHeight * 0.6;
            amp1 = canvasHeight * 0.1; freq1 = 0.008;
            amp2 = canvasHeight * 0.05; freq2 = 0.02;
            break;
        case 'MOUNTAIN': // 산악형 (중앙이 높음)
            baseHeight = canvasHeight * 0.8;
            amp1 = canvasHeight * 0.15; freq1 = 0.006;
            amp2 = canvasHeight * 0.05; freq2 = 0.02;
            break;
        case 'CHAOTIC': // 불규칙
            amp1 = canvasHeight * 0.15; freq1 = 0.01;
            amp2 = canvasHeight * 0.1; freq2 = 0.03;
            break;
    }

    for (let x = 0; x < canvasWidth; x++) {
        let y = baseHeight;
        
        // 사인파 합성으로 기본 굴곡 생성
        y += Math.sin(x * freq1 + offsetPhase) * amp1;
        y += Math.sin(x * freq2 + offsetPhase * 2) * amp2;

        // 지형 타입별 특수 처리
        const dist = Math.abs(x - canvasWidth / 2);
        if (type === 'VALLEY' && dist < canvasWidth * 0.4) {
            y += Math.cos((dist / (canvasWidth * 0.4)) * (Math.PI / 2)) * (canvasHeight * 0.2);
        } else if (type === 'MOUNTAIN' && dist < canvasWidth * 0.4) {
            y -= Math.cos((dist / (canvasWidth * 0.4)) * (Math.PI / 2)) * (canvasHeight * 0.3);
        }
        
        // 노이즈 추가
        y += (Math.random() - 0.5) * 5;

        // 화면 범위 제한
        if (y < canvasHeight * 0.2) y = canvasHeight * 0.2;
        if (y > canvasHeight - 50) y = canvasHeight - 50;

        terrain.push(y);
    }
    
    // 지형 부드럽게 처리 (Smoothing)
    for (let k = 0; k < 2; k++) {
        for (let i = 1; i < terrain.length - 1; i++) {
            terrain[i] = (terrain[i-1] + terrain[i] + terrain[i+1]) / 3;
        }
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
