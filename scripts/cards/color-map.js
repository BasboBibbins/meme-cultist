const fs = require('fs');
const path = require('path');

const COLOR_MAP_PATH = path.join(__dirname, 'color-map.json');
const colorMap = JSON.parse(fs.readFileSync(COLOR_MAP_PATH, 'utf8'));

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a replacement map for a styled theme.
 * @param {string} accent — replaces redPalette
 * @param {string} secondary — replaces blackPalette
 * @param {Object} options
 * @param {boolean} options.remapBlueOutlines — if true, also recolor blueOutlinePalette to a darkened secondary
 * @returns {Map<string, string>} oldColor → newColor
 */
function buildReplacementMap(accent, secondary, { remapBlueOutlines = false } = {}) {
    const map = new Map();

    for (const old of colorMap.redPalette) {
        map.set(old, accent);
    }
    for (const old of colorMap.blackPalette) {
        map.set(old, secondary);
    }
    if (remapBlueOutlines) {
        // Darken secondary by ~20% for outlines
        const darkened = darkenColor(secondary, 0.8);
        for (const old of colorMap.blueOutlinePalette) {
            map.set(old, darkened);
        }
    }

    return map;
}

/** Darken a hex color by a factor (0-1). */
function darkenColor(hex, factor) {
    const r = Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * factor));
    const g = Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * factor));
    const b = Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * factor));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Replace colors inside the <style> block of an SVG string.
 * Only replaces fill/stop-color; stroke is left untouched so borders stay dark.
 * Uses negative hex lookahead to avoid partial matches (e.g. #f55 inside #ffffff).
 */
function recolorSvgStyle(svgText, replacementMap) {
    const styleRegex = /(<style>)([\s\S]*?)(<\/style>)/i;
    return svgText.replace(styleRegex, (match, open, styleBlock, close) => {
        let recolored = styleBlock;
        for (const [oldColor, newColor] of replacementMap) {
            const pattern = new RegExp(
                `(fill|stop-color):\\s*${escapeRegex(oldColor)}(?![a-f0-9])`,
                'gi'
            );
            recolored = recolored.replace(pattern, (m, prop) => `${prop}: ${newColor}`);
        }
        return open + recolored + close;
    });
}

/**
 * Inject explicit fill rules for classes that rely on the default black fill.
 * In classic.svg, number-card suit symbols use classes with stroke-width: 0px
 * but no explicit fill or stroke color. This forces them to the suit color.
 */
function injectDefaultFills(svgText, suitColor) {
    const styleRegex = /(<style>)([\s\S]*?)(<\/style>)/i;
    return svgText.replace(styleRegex, (match, open, styleBlock, close) => {
        // Find the stroke-width: 0px rule by index and walk backwards to capture the class list
        const idx = styleBlock.indexOf('stroke-width: 0px');
        if (idx === -1) return match;

        // Walk back to the opening brace of this rule
        let braceIdx = idx;
        while (braceIdx > 0 && styleBlock[braceIdx] !== '{') braceIdx--;

        // Walk back further to the end of the previous rule's closing brace
        let startIdx = braceIdx;
        while (startIdx > 0 && styleBlock[startIdx] !== '}') startIdx--;
        startIdx++; // skip '}'
        while (startIdx < braceIdx && /\s/.test(styleBlock[startIdx])) startIdx++;

        const classList = styleBlock.slice(startIdx, braceIdx).trim();
        const allClasses = classList.split(',').map(c => c.trim()).filter(c => c.startsWith('.'));
        const classesNeedingFill = [];

        for (const cls of allClasses) {
            const clsName = cls.replace('.', '');
            // Check if this class appears in any rule with an explicit fill or stroke color
            const hasColor = new RegExp(
                '\\.' + clsName + '\\b[^{]*\\{[^}]*\\b(?:fill|stroke(?!-width))\\s*:',
                'i'
            ).test(styleBlock);
            if (!hasColor) {
                classesNeedingFill.push(cls);
            }
        }

        if (classesNeedingFill.length === 0) return match;

        const injectedRule = `\n      ${classesNeedingFill.join(', ')} {\n        fill: ${suitColor};\n      }`;
        return open + styleBlock + injectedRule + close;
    });
}

module.exports = {
    colorMap,
    buildReplacementMap,
    recolorSvgStyle,
    injectDefaultFills,
    darkenColor,
};
