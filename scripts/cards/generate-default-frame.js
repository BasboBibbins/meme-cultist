/**
 * Generates the default face-card frame template.
 * This is a one-time script to produce the shared asset.
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'assets', 'imgs', 'cards', 'templates', 'face-frame.png');

const W = 90;
const H = 135;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// Transparent background
ctx.clearRect(0, 0, W, H);

// Decorative border frame
ctx.strokeStyle = '#1a1a1a';
ctx.lineWidth = 2.5;
ctx.beginPath();
ctx.roundRect(4, 4, W - 8, H - 8, 4);
ctx.stroke();

// Inner border
ctx.strokeStyle = '#888888';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.roundRect(7, 7, W - 14, H - 14, 2);
ctx.stroke();

// Top crown/ornament
ctx.fillStyle = '#1a1a1a';
ctx.beginPath();
ctx.moveTo(W / 2, 12);
ctx.lineTo(W / 2 - 8, 20);
ctx.lineTo(W / 2 + 8, 20);
ctx.closePath();
ctx.fill();

ctx.beginPath();
ctx.arc(W / 2, 16, 4, 0, Math.PI * 2);
ctx.fill();

// Bottom ornament
ctx.beginPath();
ctx.moveTo(W / 2, H - 12);
ctx.lineTo(W / 2 - 6, H - 20);
ctx.lineTo(W / 2 + 6, H - 20);
ctx.closePath();
ctx.fill();

// Side flourishes
for (let side of [-1, 1]) {
    const cx = side === -1 ? 14 : W - 14;
    ctx.beginPath();
    ctx.arc(cx, H / 2 - 18, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, H / 2 + 18, 2, 0, Math.PI * 2);
    ctx.fill();
}

fs.writeFileSync(OUT, canvas.toBuffer('image/png'));
console.log(`Wrote default face-frame template to ${OUT}`);
