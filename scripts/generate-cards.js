const path = require('path');
const { generateStyledCards } = require('./cards/styled-recolor');
const { generateFullCards } = require('./cards/full-generator');

// Load theme registry
const themesDir = path.join(__dirname, '..', 'themes', 'configs');
const { getTheme } = require(path.join(themesDir, 'index'));

function getArg(flag) {
    const idx = process.argv.indexOf(flag);
    return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

function listThemes() {
    const registry = require(path.join(themesDir, 'index'));
    return registry.getAllThemes ? registry.getAllThemes() : Object.values(registry.themes || {});
}

async function main() {
    const themeId = getArg('--theme');
    const tier = getArg('--tier');
    const force = process.argv.includes('--force');
    const all = process.argv.includes('--all');

    const themes = listThemes();
    let targets = [];

    if (themeId) {
        const t = themes.find(th => th.id === themeId);
        if (!t) {
            console.error(`Theme '${themeId}' not found in registry.`);
            process.exit(1);
        }
        targets = [t];
    } else if (tier) {
        targets = themes.filter(t => t.tier === tier);
    } else if (all) {
        targets = themes.filter(t => t.tier !== 'colorway');
    } else {
        console.log(`Usage: node scripts/generate-cards.js [options]`);
        console.log(`Options:`);
        console.log(`  --theme <id>    Generate for a specific theme`);
        console.log(`  --tier <tier>   Generate for all themes of a tier (styled, full, limited)`);
        console.log(`  --all           Generate for all non-colorway themes`);
        console.log(`  --force         Regenerate even if output exists`);
        process.exit(0);
    }

    console.log(`Generating cards for ${targets.length} theme(s)...\n`);

    for (const theme of targets) {
        try {
            if (theme.tier === 'styled') {
                await generateStyledCards(theme, { force });
            } else if (theme.tier === 'full' || theme.tier === 'limited') {
                await generateFullCards(theme, { force });
            } else {
                console.log(`Skipping ${theme.id} (tier: ${theme.tier})`);
            }
        } catch (err) {
            console.error(`Failed to generate ${theme.id}:`, err.message);
        }
    }

    console.log('\nDone.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
