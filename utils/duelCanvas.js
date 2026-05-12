const { createCanvas, loadImage } = require("canvas");
const { AttachmentBuilder } = require("discord.js");

const CHOICE_ICONS = {
    rock: "🪨",
    paper: "📄",
    scissors: "✂️",
};

async function fetchAvatarBuffer(user) {
    const url = user.displayAvatarURL({ extension: "png", size: 128 });
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch {
        return null;
    }
}

async function renderDuel({ challenger, opponent, bet, challengerChoice, opponentChoice, result, colors }) {
    const width = 800;
    const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = colors.feltColor || "#0f4c25";
    ctx.fillRect(0, 0, width, height);

    // Subtle radial gradient overlay
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, 400);
    gradient.addColorStop(0, colors.tableGreen || "#1a6b35");
    gradient.addColorStop(1, colors.feltColor || "#0f4c25");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Draw center divider line
    ctx.strokeStyle = colors.gold || "#ffd700";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2, 40);
    ctx.lineTo(width / 2, height - 40);
    ctx.stroke();

    // VS text
    ctx.fillStyle = colors.gold || "#ffd700";
    ctx.font = "bold 48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("VS", width / 2, height / 2 - 20);

    // Result / status banner
    const bannerY = height / 2 + 30;
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (result == null) {
        ctx.fillStyle = colors.gold || "#ffd700";
        ctx.fillText("Choose Your Weapon!", width / 2, bannerY);
    } else if (result === "draw") {
        ctx.fillStyle = colors.textWhite || "#ffffff";
        ctx.fillText("DRAW!", width / 2, bannerY);
    } else if (result === "challenger") {
        ctx.fillStyle = colors.textWin || "#44ff44";
        ctx.fillText(`${challenger.displayName} Wins!`, width / 2, bannerY);
    } else {
        ctx.fillStyle = colors.textWin || "#44ff44";
        ctx.fillText(`${opponent.displayName} Wins!`, width / 2, bannerY);
    }

    // Wager display
    ctx.font = "20px sans-serif";
    ctx.fillStyle = colors.gold || "#ffd700";
    ctx.fillText(`Pot: ${bet.toLocaleString("en-US")} koku`, width / 2, bannerY + 40);

    // Pre-fetch both avatars
    const challengerAvatar = await fetchAvatarBuffer(challenger);
    const opponentAvatar = await fetchAvatarBuffer(opponent);

    // Helper to draw a player panel
    async function drawPlayerPanel(user, choice, x, align, avatarBuffer) {
        const avatarSize = 100;
        const avatarX = align === "left" ? x : x - avatarSize;
        const avatarY = 60;

        // Avatar circle background
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 4, 0, Math.PI * 2);
        ctx.fillStyle = colors.gold || "#ffd700";
        ctx.fill();

        // Draw avatar
        try {
            const avatar = await loadImage(avatarBuffer);
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();
        } catch {
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.fillStyle = colors.feltDark || "#0a3a1a";
            ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();
        }

        // Name
        ctx.font = "bold 22px sans-serif";
        ctx.fillStyle = colors.textWhite || "#ffffff";
        ctx.textAlign = align;
        ctx.textBaseline = "top";
        const nameX = align === "left" ? x + avatarSize / 2 : x - avatarSize / 2;
        ctx.fillText(user.displayName, nameX, avatarY + avatarSize + 12);

        // Wager
        ctx.font = "18px sans-serif";
        ctx.fillStyle = colors.gold || "#ffd700";
        ctx.fillText(`${bet.toLocaleString("en-US")} koku`, nameX, avatarY + avatarSize + 40);

        // Choice icon circle
        const iconSize = 60;
        const iconX = align === "left" ? x + avatarSize / 2 - iconSize / 2 : x - avatarSize / 2 - iconSize / 2;
        const iconY = avatarY + avatarSize + 75;

        ctx.beginPath();
        ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = colors.feltDark || "#0a3a1a";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = colors.gold || "#ffd700";
        ctx.stroke();

        // Choice emoji
        ctx.font = "32px sans-serif";
        ctx.fillStyle = colors.textWhite || "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(CHOICE_ICONS[choice] || "❓", iconX + iconSize / 2, iconY + iconSize / 2);
    }

    await drawPlayerPanel(challenger, challengerChoice, 60, "left", challengerAvatar);
    await drawPlayerPanel(opponent, opponentChoice, width - 60, "right", opponentAvatar);

    const buffer = canvas.toBuffer("image/png");
    return new AttachmentBuilder(buffer, { name: "duel.png" });
}

module.exports = { renderDuel };
