const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const GRAVITY = 0.2;
const ELASTICITY = 1.0; // restitution for collisions (1.0 = perfectly elastic)
const SUBSTEPS = 1;

class Ball {
    constructor(x, y, vx, vy, radius, color, mass = radius * radius) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.radius = radius;
        this.mass = mass;
        this.color = color;
    }

    update(dt = 1) {
        let remaining = dt;
        while (remaining > 1e-9) {
            let tMin = remaining;
            let wall = null;

            // Time to hit left wall: x + vx*t = radius
            if (this.vx < 0) {
                const t = (this.radius - this.x) / this.vx;
                if (t >= 0 && t < tMin) { tMin = t; wall = 'left'; }
            }
            // Time to hit right wall: x + vx*t = width - radius
            if (this.vx > 0) {
                const t = (canvas.width - this.radius - this.x) / this.vx;
                if (t >= 0 && t < tMin) { tMin = t; wall = 'right'; }
            }
            // Time to hit top wall: y + vy*t + 0.5*g*t^2 = radius
            // Solve: 0.5*g*t^2 + vy*t + (y - radius) = 0
            if (this.vy < 0 || this.y < this.radius) {
                const a = 0.5 * GRAVITY, b = this.vy, c = this.y - this.radius;
                const disc = b * b - 4 * a * c;
                if (disc >= 0) {
                    const t = (-b - Math.sqrt(disc)) / (2 * a);
                    if (t > 1e-9 && t < tMin) { tMin = t; wall = 'top'; }
                }
            }
            // Time to hit bottom wall: y + vy*t + 0.5*g*t^2 = height - radius
            {
                const a = 0.5 * GRAVITY, b = this.vy, c = this.y - (canvas.height - this.radius);
                const disc = b * b - 4 * a * c;
                if (disc >= 0) {
                    const t = (-b + Math.sqrt(disc)) / (2 * a);
                    if (t > 1e-9 && t < tMin) { tMin = t; wall = 'bottom'; }
                }
            }

            // Advance to collision or end of timestep
            this.x += this.vx * tMin;
            this.y += this.vy * tMin + 0.5 * GRAVITY * tMin * tMin;
            this.vy += GRAVITY * tMin;
            remaining -= tMin;

            // Reflect velocity on collision
            if (wall === 'left' || wall === 'right') this.vx = -this.vx * ELASTICITY;
            if (wall === 'top' || wall === 'bottom') this.vy = -this.vy * ELASTICITY;
        }
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
    }

    kineticEnergy() {
        return 0.5 * this.mass * (this.vx ** 2 + this.vy ** 2);
    }

    potentialEnergy() {
        return this.mass * GRAVITY * (canvas.height - this.radius - this.y);
    }
}

// Find time of collision between two balls (returns Infinity if no collision in dt)
function timeToCollision(b1, b2, dt) {
    // Positions: p1(t) = p1 + v1*t + 0.5*g*t^2, p2(t) = p2 + v2*t + 0.5*g*t^2
    // Distance squared: |p2(t) - p1(t)|^2 = (r1+r2)^2
    // Since gravity affects both equally in y, it cancels out!
    // So: (dx + dvx*t)^2 + (dy + dvy*t)^2 = R^2
    // Expanding: (dvx^2 + dvy^2)*t^2 + 2*(dx*dvx + dy*dvy)*t + (dx^2 + dy^2 - R^2) = 0

    const dx = b2.x - b1.x;
    const dy = b2.y - b1.y;
    const dvx = b2.vx - b1.vx;
    const dvy = b2.vy - b1.vy;
    const R = b1.radius + b2.radius;

    const a = dvx * dvx + dvy * dvy;
    const b = 2 * (dx * dvx + dy * dvy);
    const c = dx * dx + dy * dy - R * R;

    if (a < 1e-12) return Infinity; // Not approaching

    const disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;

    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t >= 0 && t <= dt) return t;
    return Infinity;
}

// Elastic collision response (no positional correction needed with exact timing)
function resolveCollision(b1, b2) {
    const dx = b2.x - b1.x;
    const dy = b2.y - b1.y;
    const dist = Math.hypot(dx, dy);

    const nx = dx / dist;
    const ny = dy / dist;

    const dvx = b2.vx - b1.vx;
    const dvy = b2.vy - b1.vy;
    const velAlongNormal = dvx * nx + dvy * ny;

    if (velAlongNormal > 0) return; // Already separating

    const invMass1 = 1 / b1.mass;
    const invMass2 = 1 / b2.mass;
    const j = -(1 + ELASTICITY) * velAlongNormal / (invMass1 + invMass2);

    b1.vx -= j * invMass1 * nx;
    b1.vy -= j * invMass1 * ny;
    b2.vx += j * invMass2 * nx;
    b2.vy += j * invMass2 * ny;
}

const balls = [
    new Ball(150, 100, 2, 0, 20, "deepskyblue"),
    new Ball(300, 100, -2, 0, 20, "tomato")
];

function advanceBall(b, t) {
    b.x += b.vx * t;
    b.y += b.vy * t + 0.5 * GRAVITY * t * t;
    b.vy += GRAVITY * t;
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Check for ball-ball collision
    const tColl = timeToCollision(balls[0], balls[1], dt);
    if (tColl < dt) {
        // Advance both balls to collision point
        balls.forEach(b => advanceBall(b, tColl));
        resolveCollision(balls[0], balls[1]);
        // Update remaining time with wall collisions
        balls.forEach(b => b.update(dt - tColl));
    } else {
        balls.forEach(b => b.update(dt));
    }

    balls.forEach((b) => b.draw());

    requestAnimationFrame(animate);
}

animate();
