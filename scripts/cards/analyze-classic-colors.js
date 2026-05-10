const { loadImage, createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const CLASSIC_PNG = path.join(__dirname, '..', '..', 'assets', 'imgs', 'cards', 'classic.png');
const CLASSIC_SVG = path.join(__dirname, '..', '..', 'assets', 'imgs', 'cards', 'svg', 'classic.svg');
const OUTPUT = path.join(__dirname, 'color-map.json');

// Sample a few pixels from each suit row to find dominant non-white colors
async function samplePngColors() {
    const img = await loadImage(CLASSIC_PNG);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;

    // Card dimensions
    const cw = 90;
    const ch = 135;
    const suits = ['CLUBS', 'DIAMONDS', 'HEARTS', 'SPADES'];
    const rows = 4;
    const cols = 13;

    const suitColors = {};

    for (let si = 0; si < rows; si++) {
        const colors = new Map(); // hex -> count
        const y0 = si * ch;
        // Sample center of each card in this row, avoiding edges
        for (let ri = 0; ri < cols; ri++) {
            const x0 = ri * cw;
            const cx = x0 + Math.floor(cw / 2);
            const cy = y0 + Math.floor(ch / 2);
            for (let dy = -10; dy <= 10; dy += 5) {
                for (let dx = -10; dx <= 10; dx += 5) {
                    const px = cx + dx;
                    const py = cy + dy;
                    const idx = (py * img.width + px) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    const a = data[idx + 3];
                    if (a < 128) continue;
                    // Skip near-white and near-black (borders/shadows)
                    if (r > 240 && g > 240 && b > 240) continue;
                    const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
                    colors.set(hex, (colors.get(hex) || 0) + 1);
                }
            }
        }
        // Sort by count
        const sorted = [...colors.entries()].sort((a, b) => b[1] - a[1]);
        suitColors[suits[si]] = sorted.slice(0, 20);
    }

    return suitColors;
}

// Extract all color references from the SVG <style> block
function extractSvgColors() {
    const svgText = fs.readFileSync(CLASSIC_SVG, 'utf8');
    const styleMatch = svgText.match(/<style>[\s\S]*?<\/style>/);
    if (!styleMatch) {
        throw new Error('No <style> block found in classic.svg');
    }
    const style = styleMatch[0];

    const colors = new Set();
    const regex = /(fill|stroke):\s*(#[a-f0-9]{3,8}|rgb[a]?\([^)]+\)|[a-z]+)/gi;
    let m;
    while ((m = regex.exec(style)) !== null) {
        colors.add(m[2].toLowerCase());
    }
    return { style, colors: [...colors] };
}

async function main() {
    console.log('Sampling classic.png per suit row...');
    const pngColors = await samplePngColors();

    console.log('Extracting colors from classic.svg <style>...');
    const { style, colors: svgColors } = extractSvgColors();

    console.log('\nPNG dominant colors per suit:');
    for (const [suit, cols] of Object.entries(pngColors)) {
        console.log(`  ${suit}: ${cols.slice(0, 8).map(c => c[0]).join(', ')}`);
    }

    console.log('\nSVG style colors:');
    for (const c of svgColors.sort()) {
        console.log(`  ${c}`);
    }

    // Build map based on observation
    // From the PNG: CLUBS and SPADES are black-ish, DIAMONDS and HEARTS are red-ish
    // From the SVG style we saw earlier: #ff5655 is red, #000200 is black, #55a / #5456aa are blue-purple used for spades/clubs outlines?
    // Actually looking at the SVG style lines:
    // .cls-122 { fill: #ff5655; }  ← definitely red
    // .cls-121 { fill: #000200; }  ← black
    // .cls-12, .cls-15 ... { fill: #ff5; } ← yellow? Wait that's weird.

    // Let's do a more careful mapping by looking at class names that appear near the red vs black suit graphics.
    // For now, write a naive map based on what we see in the style block and let the user review.

    const colorMap = {
        redPalette: svgColors.filter(c => c.includes('ff') && !c.includes('fff') && !c.includes('ffff')),
        blackPalette: svgColors.filter(c => c.includes('00') && c.length >= 6),
        neutralPalette: svgColors.filter(c => c.includes('fff') || c.includes('55a') || c.includes('ff5')),
        rawSvgColors: svgColors
    };

    fs.writeFileSync(OUTPUT, JSON.stringify(colorMap, null, 2));
    console.log(`\nWrote ${OUTPUT}`);
    console.log('Please review color-map.json and edit the palettes manually before running styled-recolor.js.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
