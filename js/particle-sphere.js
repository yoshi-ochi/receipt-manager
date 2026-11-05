/**
 * Particle Sphere: 260-dot sphere turns every 8s; a ripple runs down it every 1.6s.
 */
class ParticleSphere {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.dotCount = 260;
    this.rotationPeriod = 8000;
    this.ripplePeriod = 1600;
    this.sphereRadius = 90;
    this.points = [];
    this.animationFrameId = null;
    this.isRunning = false;

    this.initPoints();
  }

  initPoints() {
    this.points = [];
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < this.dotCount; i++) {
      const y = 1 - (i / (this.dotCount - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;

      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;

      this.points.push({ x, y, z, originalY: y });
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = performance.now();
    this.render();
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  render(timestamp = performance.now()) {
    if (!this.isRunning) return;

    const elapsed = timestamp - this.startTime;
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const cx = width / 2;
    const cy = height / 2;

    ctx.clearRect(0, 0, width, height);

    const angle = (elapsed % this.rotationPeriod) / this.rotationPeriod * Math.PI * 2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const ripplePhase = (elapsed % this.ripplePeriod) / this.ripplePeriod;
    const rippleTargetY = 1.2 - ripplePhase * 2.4;

    const transformed = this.points.map(pt => {
      const rx = pt.x * cosA - pt.z * sinA;
      const rz = pt.x * sinA + pt.z * cosA;
      const ry = pt.y;

      const distToWave = Math.abs(ry - rippleTargetY);
      const isRipple = distToWave < 0.28;
      const rippleIntensity = isRipple ? (1 - distToWave / 0.28) : 0;

      return { x: rx, y: ry, z: rz, rippleIntensity };
    });

    transformed.sort((a, b) => a.z - b.z);

    for (const p of transformed) {
      const scale = (p.z + 1.8) / 2.8;
      const px = cx + p.x * this.sphereRadius * scale;
      const py = cy - p.y * this.sphereRadius * scale;

      const baseRadius = 2.2 * scale;
      const dotRadius = baseRadius + (p.rippleIntensity * 2.0);

      const alpha = Math.min(1, Math.max(0.2, 0.4 + (p.z + 1) * 0.3 + p.rippleIntensity * 0.5));
      const red = Math.floor(60 + p.rippleIntensity * 195);
      const green = Math.floor(130 + p.rippleIntensity * 125);
      const blue = 255;

      ctx.beginPath();
      ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
      ctx.fill();

      if (p.rippleIntensity > 0.4) {
        ctx.beginPath();
        ctx.arc(px, py, dotRadius + 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180, 220, 255, ${p.rippleIntensity * 0.4})`;
        ctx.fill();
      }
    }

    this.animationFrameId = requestAnimationFrame(ts => this.render(ts));
  }
}
