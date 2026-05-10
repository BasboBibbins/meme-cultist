/**
 * Split classic.svg into four row-specific SVG strings.
 * Each row contains only the <g> elements whose <rect> y-coordinate falls in that row.
 */

const fs = require('fs');
const path = require('path');

const CLASSIC_SVG = path.join(__dirname, '..', '..', 'assets', 'imgs', 'cards', 'svg', 'classic.svg');

const ROW_HEIGHT = 539.875; // 2159.5 / 4
const SUITS = ['CLUBS', 'DIAMONDS', 'HEARTS', 'SPADES'];

function getRowFromY(y) {
    return Math.floor(y / ROW_HEIGHT);
}

function extractTopLevelGroups(svgText) {
    const bodyStart = svgText.indexOf('</defs>');
    const bodyEnd = svgText.lastIndexOf('</svg>');
    const body = svgText.slice(bodyStart + 7, bodyEnd);

    const groups = [];
    let depth = 0;
    let current = null;
    let pos = 0;

    while (pos < body.length) {
        const openIdx = body.indexOf('<g', pos);
        const closeIdx = body.indexOf('</g>', pos);

        if (openIdx === -1 && closeIdx === -1) break;

        if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
            if (depth === 0) {
                current = { start: openIdx, content: '<g', nested: 0 };
            }
            depth++;
            pos = openIdx + 2;
        } else if (closeIdx !== -1) {
            depth--;
            if (depth === 0 && current) {
                current.end = closeIdx + 4;
                current.content = body.slice(current.start, current.end);
                groups.push(current);
                current = null;
            }
            pos = closeIdx + 4;
        }
    }

    return groups;
}

function classifyGroup(groupContent) {
    // Look for the card border rect (cls-116) to determine the row
    const rectTagMatch = groupContent.match(/<rect\b[^>]*class="cls-116"[^>]*>|<rect\b[^>]*>/);
    if (rectTagMatch) {
        const yMatch = rectTagMatch[0].match(/\by="([\d.]+)"/);
        if (yMatch) return getRowFromY(parseFloat(yMatch[1]));
    }

    // Fallback: some face cards (e.g. Jack) use <path> for the background
    // and have no <rect> at all. Extract the starting y from the path's d attribute.
    const pathMatch = groupContent.match(/d="[mM]\s*(-?[\d.]+)[, ]?\s*(-?[\d.]+)/);
    if (pathMatch) {
        return getRowFromY(parseFloat(pathMatch[2]));
    }

    return -1;
}

function splitSvgByRows() {
    const svgText = fs.readFileSync(CLASSIC_SVG, 'utf8');
    const styleMatch = svgText.match(/(<style>[\s\S]*?<\/style>)/);
    const styleBlock = styleMatch ? styleMatch[1] : '';

    const headerMatch = svgText.match(/(<\?xml[^>]*>\s*<svg[^>]*>\s*<defs>\s*<style>[\s\S]*?<\/style>\s*<\/defs>)/);
    const header = headerMatch ? headerMatch[1] : '';

    const groups = extractTopLevelGroups(svgText);
    const rowGroups = [[], [], [], []];

    for (const g of groups) {
        const row = classifyGroup(g.content);
        if (row >= 0 && row < 4) {
            rowGroups[row].push(g.content);
        }
    }

    const rowSvgs = [];
    for (let i = 0; i < 4; i++) {
        const rowY = i * ROW_HEIGHT;
        const rowHeader = header
            .replace(/viewBox="0 0 4680 2159.5"/, `viewBox="0 ${rowY} 4680 ${ROW_HEIGHT}" width="4680" height="${ROW_HEIGHT}"`)
            .replace(/width="[^"]*"/, '')
            .replace(/height="[^"]*"/, '');

        // Re-add width/height after removing old ones
        const cleanHeader = rowHeader
            .replace(/<svg/, `<svg width="4680" height="${ROW_HEIGHT}"`)
            .replace(/width=""/, '')
            .replace(/height=""/, '');

        // Strip duplicate XML declaration if header already has one
        const cleanHeaderNoXml = cleanHeader.replace(/<\?xml[^\?]*\?>\s*/g, '');
        const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${cleanHeaderNoXml}\n${rowGroups[i].join('\n')}\n</svg>`;
        rowSvgs.push(svg);
    }

    return { styleBlock, rowSvgs, rowGroups };
}

module.exports = { splitSvgByRows, SUITS, ROW_HEIGHT };
