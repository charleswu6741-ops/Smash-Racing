(function () {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const lapEl = document.getElementById('lap');
  const rankEl = document.getElementById('rank');
  const smashStatusEl = document.getElementById('smashStatus');
  const gameOverEl = document.getElementById('gameOver');
  const resultTextEl = document.getElementById('resultText');
  const startScreenEl = document.getElementById('startScreen');
  const startBtn = document.getElementById('startBtn');
  const restartBtn = document.getElementById('restartBtn');

  const W = canvas.width;
  const H = canvas.height;

  // 椭圆赛道：长半轴、短半轴
  const TRACK_RX = 320;
  const TRACK_RY = 220;
  const TRACK_WIDTH = 90;
  const INNER_RX = TRACK_RX - TRACK_WIDTH;
  const INNER_RY = TRACK_RY - TRACK_WIDTH;
  const OUTER_RX = TRACK_RX + TRACK_WIDTH;
  const OUTER_RY = TRACK_RY + TRACK_WIDTH;

  const TOTAL_LAPS = 3;
  const CAR_SIZE = 12;
  const MAX_SPEED = 3.6;
  const ACCEL = 0.15;
  const FRICTION = 0.97;
  const TURN_SPEED = 0.032;
  const STEER_RATE = 0.022;      // how much left/right steers relative to track
  const MAX_STEER = 0.45;        // max steer offset from track direction
  const STEER_RETURN = 0.96;     // steer eases back to center
  const SMASH_FORCE = 8;
  const SMASH_COOLDOWN = 180;
  const CAMERA_ZOOM = 2.1;
  const TRACK_CENTER_X = 450;
  const TRACK_CENTER_Y = 300;

  let gameRunning = false;
  let smashMode = false;
  let smashCooldown = 0;
  let cars = [];
  let playerIndex = 0;
  let finishOrder = [];
  let lastCrossAngle = null;
  // Smooth follow camera: current view position (lerps toward player)
  let cameraX = TRACK_CENTER_X;
  let cameraY = TRACK_CENTER_Y;
  const CAMERA_LERP = 0.08;

  function isPointOnTrack(x, y) {
    const nx = (x - TRACK_CENTER_X) / TRACK_RX;
    const ny = (y - TRACK_CENTER_Y) / TRACK_RY;
    const r = Math.sqrt(nx * nx + ny * ny);
    const inner = (INNER_RX / TRACK_RX + INNER_RY / TRACK_RY) / 2;
    const outer = (OUTER_RX / TRACK_RX + OUTER_RY / TRACK_RY) / 2;
    return r >= inner - 0.1 && r <= outer + 0.1;
  }

  function getTrackAngle(x, y) {
    return Math.atan2((y - TRACK_CENTER_Y) / TRACK_RY, (x - TRACK_CENTER_X) / TRACK_RX);
  }

  function createCar(isPlayer, color) {
    const angle = -Math.PI / 2;
    const startX = TRACK_CENTER_X + TRACK_RX * 0.95 * Math.cos(angle);
    const startY = TRACK_CENTER_Y + TRACK_RY * 0.95 * Math.sin(angle);
    return {
      x: startX,
      y: startY,
      vx: 0,
      vy: 0,
      angle,
      speed: 0,
      lap: 0,
      isPlayer,
      color,
      lastTrackAngle: angle,
      smashed: 0,
      id: cars.length,
      steer: 0,   // player steering offset from track direction
    };
  }

  function initGame() {
    cars = [];
    finishOrder = [];
    lastCrossAngle = null;
    smashMode = false;
    smashCooldown = 0;

    const playerColor = '#4ecdc4';
    cars.push(createCar(true, playerColor));
    playerIndex = 0;

    const cpuColors = [
      '#ff6b6b', '#f7dc6f', '#bb8fce', '#85c1e9', '#82e0aa',
      '#f8b500', '#e74c3c', '#9b59b6', '#3498db', '#2ecc71', '#e67e22',
    ];
    for (let i = 0; i < 11; i++) {
      const car = createCar(false, cpuColors[i]);
      car.x += (i - 5) * 14;
      car.y += (i % 3 - 1) * 8;
      cars.push(car);
    }

    gameRunning = true;
    gameOverEl.classList.add('hidden');
    startScreenEl.classList.add('hidden');
    // Snap camera to player at race start
    const p = cars[playerIndex];
    cameraX = p.x;
    cameraY = p.y;
  }

  function crossFinishLine(car) {
    const trackAngle = getTrackAngle(car.x, car.y);
    const crossAngle = Math.PI / 2;
    const wrap = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const a = wrap(trackAngle);
    const c = wrap(crossAngle);
    const prev = car.lastTrackAngle != null ? wrap(car.lastTrackAngle) : a;
    car.lastTrackAngle = trackAngle;

    if (prev > Math.PI * 0.8 && a < Math.PI * 0.2) {
      car.lap++;
      return true;
    }
    return false;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function updatePlayer() {
    const p = cars[playerIndex];
    if (p.smashed > 0) {
      p.smashed--;
      p.vx *= 0.95;
      p.vy *= 0.95;
      return;
    }

    // Forward = along the track direction; left/right = steer relative to track
    const trackAngle = getTrackAngle(p.x, p.y);
    const trackTangent = trackAngle + Math.PI / 2;  // direction the track goes (racing direction)

    let acc = 0;
    if (keys['ArrowUp'] || keys['KeyW']) acc = 1;
    if (keys['ArrowDown'] || keys['KeyS']) acc = -1;
    let turn = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) turn = -1;
    if (keys['ArrowRight'] || keys['KeyD']) turn = 1;

    p.steer += turn * STEER_RATE;
    p.steer = Math.max(-MAX_STEER, Math.min(MAX_STEER, p.steer));
    p.steer *= STEER_RETURN;

    p.angle = trackTangent + p.steer;  // car faces track direction + your steering

    p.speed += acc * ACCEL;
    p.speed *= FRICTION;
    p.speed = Math.max(-MAX_SPEED * 0.5, Math.min(MAX_SPEED, p.speed));

    p.vx = Math.cos(p.angle) * p.speed;
    p.vy = Math.sin(p.angle) * p.speed;
    p.x += p.vx;
    p.y += p.vy;

    if (!isPointOnTrack(p.x, p.y)) {
      p.x -= p.vx;
      p.y -= p.vy;
      p.speed *= 0.7;
    }

    crossFinishLine(p);
  }

  function updateCPU(car, i) {
    if (car.smashed > 0) {
      car.smashed--;
      car.x += car.vx;
      car.y += car.vy;
      car.vx *= 0.92;
      car.vy *= 0.92;
      if (!isPointOnTrack(car.x, car.y)) {
        car.vx *= -0.5;
        car.vy *= -0.5;
      }
      crossFinishLine(car);
      return;
    }

    const trackAngle = getTrackAngle(car.x, car.y);
    const targetAngle = trackAngle + Math.PI / 2;
    let da = targetAngle - car.angle;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    car.angle += da * 0.08 + (Math.random() - 0.5) * 0.06;

    car.speed += ACCEL * 0.7;
    car.speed *= FRICTION;
    car.speed = Math.min(MAX_SPEED * 0.85, car.speed);

    car.vx = Math.cos(car.angle) * car.speed;
    car.vy = Math.sin(car.angle) * car.speed;
    car.x += car.vx;
    car.y += car.vy;

    if (!isPointOnTrack(car.x, car.y)) {
      car.x -= car.vx;
      car.y -= car.vy;
      car.speed *= 0.6;
      car.angle += (Math.random() - 0.5) * 0.3;
    }

    crossFinishLine(car);
  }

  function checkSmashCollisions() {
    const player = cars[playerIndex];
    if (player.smashed > 0 || smashCooldown > 0) return;

    for (let i = 0; i < cars.length; i++) {
      if (i === playerIndex) continue;
      const cpu = cars[i];
      if (cpu.smashed > 0 || finishOrder.includes(i)) continue;
      if (distance(player, cpu) < CAR_SIZE * 2.8) {
        if (smashMode) {
          const dx = cpu.x - player.x;
          const dy = cpu.y - player.y;
          const len = Math.hypot(dx, dy) || 1;
          cpu.vx = (dx / len) * SMASH_FORCE + player.vx * 0.5;
          cpu.vy = (dy / len) * SMASH_FORCE + player.vy * 0.5;
          cpu.smashed = 25;
          cpu.speed = Math.hypot(cpu.vx, cpu.vy);
          smashCooldown = SMASH_COOLDOWN;
          player.speed *= 0.9;
        } else {
          player.vx *= -0.4;
          player.vy *= -0.4;
          player.speed *= 0.5;
          player.smashed = 8;
        }
        break;
      }
    }
  }

  function update() {
    if (!gameRunning) return;

    if (smashCooldown > 0) smashCooldown--;
    smashStatusEl.textContent = smashMode ? 'Smash ON — ram them!' : 'Press F to smash';
    smashStatusEl.classList.toggle('active', smashMode);

    updatePlayer();
    for (let i = 0; i < cars.length; i++) {
      if (i !== playerIndex) updateCPU(cars[i], i);
    }
    checkSmashCollisions();

    const stillRacing = cars.filter((c, i) => !finishOrder.includes(i));
    stillRacing.sort((a, b) => {
      if (b.lap !== a.lap) return b.lap - a.lap;
      const ta = getTrackAngle(a.x, a.y);
      const tb = getTrackAngle(b.x, b.y);
      return ta - tb;
    });
    stillRacing.forEach((c, idx) => {
      const rank = finishOrder.length + idx + 1;
      if (rank <= TOTAL_LAPS && c.lap >= TOTAL_LAPS) {
        const carIndex = cars.indexOf(c);
        if (!finishOrder.includes(carIndex)) finishOrder.push(carIndex);
      }
    });

    const myRank = finishOrder.indexOf(playerIndex) + 1 || stillRacing.findIndex(c => c.isPlayer) + finishOrder.length + 1;
    lapEl.textContent = Math.min(cars[playerIndex].lap + 1, TOTAL_LAPS);
    rankEl.textContent = myRank;

    if (finishOrder.length === 12) {
      gameRunning = false;
      const place = finishOrder.indexOf(playerIndex) + 1;
      resultTextEl.textContent = place === 1 ? 'You win!' : `${place}${place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'} place`;
      resultTextEl.className = place === 1 ? 'win' : 'lose';
      gameOverEl.classList.remove('hidden');
    }
  }

  function drawTrack() {
    const cx = TRACK_CENTER_X;
    const cy = TRACK_CENTER_Y;
    ctx.fillStyle = '#3d3d5c';
    ctx.beginPath();
    ctx.ellipse(cx, cy, OUTER_RX, OUTER_RY, 0, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = '#2d2d44';
    ctx.beginPath();
    ctx.ellipse(cx, cy, INNER_RX, INNER_RY, 0, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = '#4ecdc4';
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, TRACK_RX, TRACK_RY, 0, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - TRACK_RY);
    ctx.lineTo(cx, cy + TRACK_RY);
    ctx.stroke();
  }

  function drawCar(car, isPlayer) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    if (car.smashed > 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#ff6666';
    } else {
      ctx.fillStyle = car.color;
    }
    ctx.fillRect(-CAR_SIZE, -CAR_SIZE / 2, CAR_SIZE * 2, CAR_SIZE);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(-CAR_SIZE, -CAR_SIZE / 2, CAR_SIZE * 2, CAR_SIZE);
    ctx.fillStyle = '#333';
    ctx.fillRect(CAR_SIZE * 0.3, -CAR_SIZE / 4, CAR_SIZE * 0.6, CAR_SIZE / 2);

    if (isPlayer) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(CAR_SIZE + 2, 0);
      ctx.lineTo(CAR_SIZE - 4, -5);
      ctx.lineTo(CAR_SIZE - 4, 5);
      ctx.closePath();
      ctx.fill();
      if (smashMode) {
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(-CAR_SIZE - 2, -CAR_SIZE / 2 - 2, CAR_SIZE * 2 + 4, CAR_SIZE + 4);
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = '#252538';
    ctx.fillRect(0, 0, W, H);

    const player = gameRunning && cars[playerIndex] ? cars[playerIndex] : null;
    const targetX = player ? player.x : TRACK_CENTER_X;
    const targetY = player ? player.y : TRACK_CENTER_Y;
    // Smooth camera: view follows where you move so you stay centered and less confused
    cameraX += (targetX - cameraX) * CAMERA_LERP;
    cameraY += (targetY - cameraY) * CAMERA_LERP;

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(CAMERA_ZOOM, CAMERA_ZOOM);
    ctx.translate(-cameraX, -cameraY);

    drawTrack();

    const order = [...cars].sort((a, b) => {
      const ia = cars.indexOf(a);
      const ib = cars.indexOf(b);
      if (finishOrder.includes(ia) && !finishOrder.includes(ib)) return 1;
      if (!finishOrder.includes(ia) && finishOrder.includes(ib)) return -1;
      return a.y - b.y;
    });
    order.forEach(c => drawCar(c, c.isPlayer));
    ctx.restore();
  }

  const keys = {};
  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyF') {
      e.preventDefault();
      smashMode = true;
    }
  });
  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'KeyF') smashMode = false;
  });

  startBtn.addEventListener('click', () => {
    initGame();
  });
  restartBtn.addEventListener('click', () => {
    initGame();
  });

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }
  loop();
})();
