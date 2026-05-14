const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, DUEL_MIN_BET, DUEL_COOLDOWN } = require("../../config.js");
const { parseBet } = require("../../utils/betparse");
const { renderDuel } = require("../../utils/duelCanvas");
const { getEquippedTheme } = require("../../themes/manager");
const { getDuelColors } = require("../../themes/resolver");
const logger = require("../../utils/logger");
const { sendDM } = require("../../utils/dm");
const { withUserLock } = require("../../utils/userlock");

const ACCEPT_TIMEOUT = 60000;
const CHOICE_TIMEOUT = 30000;
const REMATCH_TIMEOUT = 60000;

const CHOICE_EMOJIS = {
    rock: "🪨",
    paper: "📄",
    scissors: "✂️",
};

function resolveWinner(a, b) {
    if (a === b) return "draw";
    if (
        (a === "rock" && b === "scissors") ||
        (a === "paper" && b === "rock") ||
        (a === "scissors" && b === "paper")
    ) {
        return "challenger";
    }
    return "opponent";
}

function buildErrorEmbed(user, client) {
    return new EmbedBuilder()
        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setColor(0xFF0000)
        .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
}

// One ephemeral warning per user across the entire duel session — prevents
// spam from repeated clicks by non-participants. Shared across accept/RPS/rematch.
function makeSessionWarner() {
    const warned = new Set();
    return async (i, message) => {
        if (warned.has(i.user.id)) {
            try { await i.deferUpdate(); } catch (_) {}
            return;
        }
        warned.add(i.user.id);
        try { await i.reply({ content: message, ephemeral: true }); } catch (_) {}
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("duel")
        .setDescription(`Challenge another user to a Rock-Paper-Scissors duel for ${CURRENCY_NAME}.`)
        .addUserOption(option =>
            option.setName("user")
                .setDescription("The user to challenge.")
                .setRequired(true))
        .addStringOption(option =>
            option.setName("bet")
                .setDescription(`The amount of ${CURRENCY_NAME} to wager.`)
                .setRequired(true)),

    async execute(interaction) {
        const challenger = interaction.user;
        const opponent = interaction.options.getUser("user");
        const client = interaction.client;
        const betString = interaction.options.getString("bet");

        const errorEmbed = buildErrorEmbed(challenger, client);

        // Ensure both users exist in DB
        let challengerDb = await db.get(challenger.id);
        if (!challengerDb) {
            await addNewDBUser(challenger);
            challengerDb = await db.get(challenger.id);
        }
        let opponentDb = await db.get(opponent.id);
        if (!opponentDb) {
            await addNewDBUser(opponent);
            opponentDb = await db.get(opponent.id);
        }

        // Validation
        if (opponent.bot) {
            errorEmbed.setDescription("You can't duel a bot!");
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        if (opponent.id === challenger.id) {
            errorEmbed.setDescription("You can't duel yourself!");
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        const bet = Number(await parseBet(betString, challenger.id));
        if (isNaN(bet)) {
            errorEmbed.setDescription("Invalid bet amount.");
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        if (bet % 1 !== 0) {
            errorEmbed.setDescription(`You must bet a whole number of ${CURRENCY_NAME}!`);
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        if (bet < 1) {
            errorEmbed.setDescription(`You must bet at least 1 ${CURRENCY_NAME}!`);
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        if (DUEL_MIN_BET && bet < DUEL_MIN_BET) {
            errorEmbed.setDescription(`Minimum bet is ${DUEL_MIN_BET.toLocaleString("en-US")} ${CURRENCY_NAME}!`);
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        const challengerBalance = await db.get(`${challenger.id}.balance`) || 0;
        const opponentBank = await db.get(`${opponent.id}.bank`) || 0;
        const opponentWallet = await db.get(`${opponent.id}.balance`) || 0;
        const opponentTotal = opponentBank + opponentWallet;

        if (bet > challengerBalance) {
            errorEmbed.setDescription(`You don't have enough ${CURRENCY_NAME}!`);
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        // Opponent eligibility uses their combined wallet+bank — the wallet-only
        // check is still deferred until they actually click accept.
        if (bet > opponentTotal) {
            errorEmbed.setDescription(`${opponent.displayName} doesn't have enough ${CURRENCY_NAME} to be challenged for this wager!`);
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        // Cooldown check
        const challengerCooldown = await db.get(`${challenger.id}.cooldowns.duel`) || 0;
        if (challengerCooldown > Date.now()) {
            errorEmbed.setDescription(`Duel cooldown active. You can duel again **<t:${Math.floor(challengerCooldown / 1000)}:R>**.`);
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        // Create session
        const sessionKey = `${interaction.channelId}:${challenger.id}:${opponent.id}`;
        if (client.duelGames.has(sessionKey)) {
            errorEmbed.setDescription("You already have an active duel with this user!");
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        // Escrow only the challenger's wager up front. The opponent's wallet is
        // checked and deducted when they click accept. Lock prevents concurrent
        // commands (e.g. /bank withdraw, /slots) from racing the escrow.
        const escrowed = await withUserLock(challenger.id, async () => {
            const bal = await db.get(`${challenger.id}.balance`) || 0;
            if (bal < bet) return false;
            await db.sub(`${challenger.id}.balance`, bet);
            return true;
        });
        if (!escrowed) {
            errorEmbed.setDescription(`You don't have enough ${CURRENCY_NAME}!`);
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        client.duelGames.set(sessionKey, {
            challengerId: challenger.id,
            opponentId: opponent.id,
            bet: bet,
            status: "pending",
            messageId: null,
            startedAt: Date.now(),
        });

        logger.info(`${challenger.username}(${challenger.id}) challenged ${opponent.username}(${opponent.id}) to a duel for ${bet} ${CURRENCY_NAME}.`);

        // Resolve theme colors for the challenger (embed color)
        const themeId = await getEquippedTheme(challenger.id);
        const colors = getDuelColors(themeId);

        // Surface the opponent's wallet readiness up front so they know whether
        // they can accept immediately or need to withdraw from their bank first.
        const opponentWalletAtChallenge = await db.get(`${opponent.id}.balance`) || 0;
        const walletReady = opponentWalletAtChallenge >= bet;
        const shortfallAtChallenge = bet - opponentWalletAtChallenge;
        const walletLine = walletReady
            ? ``
            : `⚠️ ${opponent.displayName}'s wallet only has **${opponentWalletAtChallenge.toLocaleString("en-US")}** ${CURRENCY_NAME}. Withdraw **${shortfallAtChallenge.toLocaleString("en-US")}** from your bank via \`/bank\` before accepting.`;

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${challenger.displayName} challenges ${opponent.displayName}!`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
            .setDescription(`**${challenger.displayName}** has wagered **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME} on a Rock-Paper-Scissors duel!\n\n${opponent}, click **Accept Duel** to lock in your **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME}, or **Decline** to pass.\n\n${walletLine}`)
            .setColor(colors.embedColor || 0x0f4c25)
            .setThumbnail(opponent.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        const acceptRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`duel_accept_${sessionKey}`)
                    .setLabel("Accept Duel")
                    .setStyle(ButtonStyle.Success)
                    .setEmoji("⚔"),
                new ButtonBuilder()
                    .setCustomId(`duel_decline_${sessionKey}`)
                    .setLabel("Decline")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji("✋"),
            );

        await interaction.deferReply();
        const msg = await interaction.editReply({ content: `${opponent}`, embeds: [embed], components: [acceptRow] });

        // DM the challenged user with a jump link to the channel message.
        await sendDM(opponent, { embeds: [new EmbedBuilder()
            .setTitle("You've been challenged to a duel!")
            .setThumbnail(challenger.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setDescription(`**${challenger.displayName}** has challenged you to a Rock-Paper-Scissors duel for **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME} in ${interaction.guild.name}!\n\n[Jump to the duel](${msg.url}) to **Accept** or **Decline**.\n\n${walletLine}`)
            .setColor(colors.embedColor || 0x0f4c25)
            .setTimestamp()
            .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })] });

        const session = client.duelGames.get(sessionKey);
        if (session) {
            session.messageId = msg.id;
            session.sessionKey = sessionKey;
        }

        // Single warner shared across accept → RPS → rematch stages so each
        // non-participant only sees one ephemeral error per duel session.
        const warn = makeSessionWarner();

        // Accept any click matching the accept/decline customIds — non-opponents
        // are rejected gracefully inside the handler rather than silently dropped.
        const acceptCollector = msg.createMessageComponentCollector({
            filter: i => i.customId === `duel_accept_${sessionKey}` || i.customId === `duel_decline_${sessionKey}`,
            time: ACCEPT_TIMEOUT,
        });

        acceptCollector.on("collect", async i => {
            if (i.user.id !== opponent.id) {
                const msgText = i.user.id === challenger.id
                    ? "You can't respond to your own challenge."
                    : "This challenge isn't yours to answer.";
                await warn(i, msgText);
                return;
            }

            if (i.customId === `duel_decline_${sessionKey}`) {
                acceptCollector.stop("responded");
                await withUserLock(challenger.id, () => db.add(`${challenger.id}.balance`, bet));
                client.duelGames.delete(sessionKey);

                const declineEmbed = new EmbedBuilder()
                    .setAuthor({ name: `Duel Declined`, iconURL: opponent.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`${opponent.displayName} declined the duel. ${challenger.displayName}'s wager has been refunded.`)
                    .setColor(0xAAAAAA)
                    .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                await i.update({ embeds: [declineEmbed], components: [] });
                logger.info(`Duel ${sessionKey} declined by ${opponent.username}.`);
                return;
            }

            // Verify the opponent's wallet at acceptance time — bank was only used to gate the initial challenge.
            const opponentWallet = await db.get(`${opponent.id}.balance`) || 0;
            if (opponentWallet < bet) {
                acceptCollector.stop("responded");
                await withUserLock(challenger.id, () => db.add(`${challenger.id}.balance`, bet));
                client.duelGames.delete(sessionKey);

                const shortfall = bet - opponentWallet;
                const insufficientEmbed = new EmbedBuilder()
                    .setAuthor({ name: `Duel Cancelled`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`${opponent.displayName} only has **${opponentWallet.toLocaleString("en-US")}** ${CURRENCY_NAME} in their wallet — **${shortfall.toLocaleString("en-US")}** short of the **${bet.toLocaleString("en-US")}** bet. Withdraw from your bank via \`/bank\` before the next challenge.\n\n${challenger.displayName}'s wager has been refunded.`)
                    .setColor(0xFF0000)
                    .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                await i.update({ embeds: [insufficientEmbed], components: [] });
                logger.info(`Duel ${sessionKey} cancelled — opponent wallet insufficient at accept time.`);
                return;
            }

            acceptCollector.stop("responded");
            const opponentEscrowed = await withUserLock(opponent.id, async () => {
                const bal = await db.get(`${opponent.id}.balance`) || 0;
                if (bal < bet) return false;
                await db.sub(`${opponent.id}.balance`, bet);
                return true;
            });
            if (!opponentEscrowed) {
                // Lost the race — wallet drained between the wallet check above and the lock acquisition.
                await withUserLock(challenger.id, () => db.add(`${challenger.id}.balance`, bet));
                client.duelGames.delete(sessionKey);
                const raceEmbed = new EmbedBuilder()
                    .setAuthor({ name: `Duel Cancelled`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`${opponent.displayName}'s wallet changed before acceptance could finalize. ${challenger.displayName}'s wager has been refunded.`)
                    .setColor(0xFF0000)
                    .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();
                await i.update({ embeds: [raceEmbed], components: [] });
                return;
            }
            session.status = "active";

            await i.deferUpdate();
            await runRpsPhase({ session, challenger, opponent, bet, colors, msg, client, sessionKey, warn });
        });

        acceptCollector.on("end", async (_, reason) => {
            if (reason === "time") {
                // Opponent never accepted — only the challenger was escrowed.
                await withUserLock(challenger.id, () => db.add(`${challenger.id}.balance`, bet));

                const expiredEmbed = new EmbedBuilder()
                    .setAuthor({ name: `Duel Expired`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`${opponent.displayName} did not accept the duel in time. The wager has been refunded.`)
                    .setColor(0xFF0000)
                    .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                await msg.edit({ embeds: [expiredEmbed], components: [] });
                client.duelGames.delete(sessionKey);
                logger.info(`Duel ${sessionKey} expired — opponent did not accept. Both refunded.`);
            }
        });
    },
};

async function runRpsPhase({ session, challenger, opponent, bet, colors, msg, client, sessionKey, warn }) {
    const rpsEmbed = new EmbedBuilder()
        .setAuthor({ name: `Duel Accepted!`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
        .setDescription(`Both players have locked in **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME}.\n\nChoose your weapon below! You have **${Math.floor(CHOICE_TIMEOUT / 1000)}** seconds.`)
        .setColor(colors.embedColor || 0x0f4c25)
        .setImage("attachment://duel.png")
        .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    const rpsRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`duel_rps_${sessionKey}_rock`)
                .setLabel("Rock")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("🪨"),
            new ButtonBuilder()
                .setCustomId(`duel_rps_${sessionKey}_paper`)
                .setLabel("Paper")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("📄"),
            new ButtonBuilder()
                .setCustomId(`duel_rps_${sessionKey}_scissors`)
                .setLabel("Scissors")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("✂️"),
        );

    let chooseAttachment;
    try {
        chooseAttachment = await renderDuel({
            challenger, opponent, bet,
            challengerChoice: null, opponentChoice: null,
            result: null, colors,
        });
    } catch (err) {
        logger.error(`Duel choose canvas render failed: ${err.message}`);
    }

    await msg.edit({ embeds: [rpsEmbed], components: [rpsRow], files: chooseAttachment ? [chooseAttachment] : [] });

    const choices = new Map();
    const rpsCollector = msg.createMessageComponentCollector({
        filter: btn => btn.customId.startsWith(`duel_rps_${sessionKey}_`),
        time: CHOICE_TIMEOUT,
    });

    rpsCollector.on("collect", async btn => {
        const isPlayer = btn.user.id === challenger.id || btn.user.id === opponent.id;
        if (!isPlayer) {
            await warn(btn, "You're not a player in this duel.");
            return;
        }

        const choice = btn.customId.split("_").pop();

        if (choices.has(btn.user.id)) {
            await btn.reply({ content: "You already chose!", ephemeral: true });
            return;
        }

        choices.set(btn.user.id, choice);
        await btn.deferUpdate();

        // Update embed to show who has chosen (without revealing choice)
        const chosenNames = [];
        if (choices.has(challenger.id)) chosenNames.push(challenger.displayName);
        if (choices.has(opponent.id)) chosenNames.push(opponent.displayName);

        const statusEmbed = new EmbedBuilder()
            .setAuthor({ name: `Duel in Progress`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
            .setDescription(`**${bet.toLocaleString("en-US")}** ${CURRENCY_NAME} on the line!\n\n${chosenNames.map(n => `✅ ${n} has chosen`).join("\n")}\n\nWaiting for ${choices.size === 1 ? (choices.has(challenger.id) ? opponent.displayName : challenger.displayName) : "both players"}...`)
            .setColor(colors.embedColor || 0x0f4c25)
            .setImage("attachment://duel.png")
            .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        await msg.edit({ embeds: [statusEmbed], components: [rpsRow] });

        if (choices.size === 2) {
            rpsCollector.stop("resolved");
        }
    });

    rpsCollector.on("end", async (_, reason) => {
        if (reason === "resolved") {
            await resolveDuel(session, choices, challenger, opponent, bet, colors, msg, client, warn);
            return;
        }
        // Timeout / incomplete
        if (choices.size === 0) {
            // No one chose — refund both
            await withUserLock(challenger.id, () => db.add(`${challenger.id}.balance`, bet));
            await withUserLock(opponent.id, () => db.add(`${opponent.id}.balance`, bet));

            const timeoutEmbed = new EmbedBuilder()
                .setAuthor({ name: `Duel Cancelled`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
                .setDescription(`Neither player chose in time. Both wagers have been refunded.`)
                .setColor(0xFF0000)
                .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            await msg.edit({ embeds: [timeoutEmbed], components: [], files: [] });
            client.duelGames.delete(sessionKey);
            logger.info(`Duel ${sessionKey} timed out with no choices. Both refunded.`);
            return;
        }

        // One chose, one didn't — forfeit win
        const chooserId = choices.keys().next().value;
        const winner = chooserId === challenger.id ? challenger : opponent;
        const loser = chooserId === challenger.id ? opponent : challenger;

        await withUserLock(winner.id, () => db.add(`${winner.id}.balance`, bet * 2));
        await updateStats(winner.id, loser.id, bet);
        await setCooldowns(challenger.id, opponent.id);

        const forfeitEmbed = new EmbedBuilder()
            .setAuthor({ name: `${winner.displayName} Wins by Forfeit!`, iconURL: winner.displayAvatarURL({ dynamic: true }) })
            .setDescription(`${winner.displayName} chose **${CHOICE_EMOJIS[choices.get(winner.id)]}** but ${loser.displayName} didn't respond in time.\n\n${winner.displayName} wins **${(bet * 2).toLocaleString("en-US")}** ${CURRENCY_NAME}!`)
            .setColor(colors.textWin || 0x44ff44)
            .setImage("attachment://duel.png")
            .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        let forfeitAttachment;
        try {
            forfeitAttachment = await renderDuel({
                challenger, opponent, bet,
                challengerChoice: choices.get(challenger.id) || null,
                opponentChoice: choices.get(opponent.id) || null,
                result: winner.id === challenger.id ? "challenger" : "opponent",
                colors,
            });
        } catch (err) {
            logger.error(`Duel forfeit canvas render failed: ${err.message}`);
        }

        await msg.edit({ embeds: [forfeitEmbed], components: [], files: forfeitAttachment ? [forfeitAttachment] : [] });

        await sendDM(loser, { embeds: [new EmbedBuilder()
            .setTitle("You lost a duel!")
            .setThumbnail(winner.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setDescription(`**${winner.displayName}** won **${(bet * 2).toLocaleString("en-US")}** ${CURRENCY_NAME} from you by forfeit in ${msg.guild?.name || "the server"}!`)
            .setColor(0xFF0000)
            .setTimestamp()] });

        logger.info(`Duel ${sessionKey} forfeited — ${winner.username} wins ${bet * 2} ${CURRENCY_NAME}.`);
        client.duelGames.delete(sessionKey);
    });
}

async function resolveDuel(session, choices, challenger, opponent, bet, colors, msg, client, warn) {
    const sessionKey = session.sessionKey || `${msg.channelId}:${challenger.id}:${opponent.id}`;
    const challengerChoice = choices.get(challenger.id);
    const opponentChoice = choices.get(opponent.id);
    const result = resolveWinner(challengerChoice, opponentChoice);

    if (result === "draw") {
        // Refund both
        await withUserLock(challenger.id, () => db.add(`${challenger.id}.balance`, bet));
        await withUserLock(opponent.id, () => db.add(`${opponent.id}.balance`, bet));

        const drawEmbed = new EmbedBuilder()
            .setAuthor({ name: `It's a Draw!`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
            .setDescription(`Both players chose **${CHOICE_EMOJIS[challengerChoice]}**. It's a draw!\n\nBoth players have been refunded.`)
            .setColor(colors.embedColor || 0x0f4c25)
            .setImage("attachment://duel.png")
            .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        let drawAttachment;
        try {
            drawAttachment = await renderDuel({
                challenger,
                opponent,
                bet,
                challengerChoice,
                opponentChoice,
                result: "draw",
                colors,
            });
            await msg.edit({ embeds: [drawEmbed], components: [], files: [drawAttachment] });
        } catch (err) {
            logger.error(`Duel canvas render failed: ${err.message}`);
            await msg.edit({ embeds: [drawEmbed], components: [] });
        }

        // Update totalBet + draws for both
        await db.add(`${challenger.id}.stats.duel.totalBet`, bet);
        await db.add(`${opponent.id}.stats.duel.totalBet`, bet);
        await db.add(`${challenger.id}.stats.duel.draws`, 1);
        await db.add(`${opponent.id}.stats.duel.draws`, 1);

        client.duelGames.delete(sessionKey);
        logger.info(`Duel ${sessionKey} ended in a draw.`);

        await offerRematch({ challenger, opponent, bet, colors, msg, client, sessionKey, warn });
        return;
    }

    const winner = result === "challenger" ? challenger : opponent;
    const loser = result === "challenger" ? opponent : challenger;

    // Winner takes full pot
    await withUserLock(winner.id, () => db.add(`${winner.id}.balance`, bet * 2));
    await updateStats(winner.id, loser.id, bet);
    await setCooldowns(challenger.id, opponent.id);

    const resultEmbed = new EmbedBuilder()
        .setAuthor({ name: `${winner.displayName} Wins!`, iconURL: winner.displayAvatarURL({ dynamic: true }) })
        .setDescription(`${challenger.displayName} chose **${CHOICE_EMOJIS[challengerChoice]}** — ${opponent.displayName} chose **${CHOICE_EMOJIS[opponentChoice]}**!\n\n${winner.displayName} wins **${(bet * 2).toLocaleString("en-US")}** ${CURRENCY_NAME}!`)
        .setColor(colors.textWin || 0x44ff44)
        .setImage("attachment://duel.png")
        .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    try {
        const attachment = await renderDuel({
            challenger,
            opponent,
            bet,
            challengerChoice,
            opponentChoice,
            result,
            colors,
        });
        await msg.edit({ embeds: [resultEmbed], components: [], files: [attachment] });
    } catch (err) {
        logger.error(`Duel canvas render failed: ${err.message}`);
        await msg.edit({ embeds: [resultEmbed], components: [] });
    }

    // DM the loser
    await sendDM(loser, { embeds: [new EmbedBuilder()
        .setTitle("You lost a duel!")
        .setThumbnail(winner.displayAvatarURL({ dynamic: true, size: 1024 }))
        .setDescription(`**${winner.displayName}** won **${(bet * 2).toLocaleString("en-US")}** ${CURRENCY_NAME} from you in ${msg.guild?.name || "the server"}!\n\nYou chose ${CHOICE_EMOJIS[choices.get(loser.id)]} and they chose ${CHOICE_EMOJIS[choices.get(winner.id)]}.`)
        .setColor(0xFF0000)
        .setTimestamp()] });

    client.duelGames.delete(sessionKey);
    logger.info(`Duel ${sessionKey} resolved — ${winner.username} wins ${bet * 2} ${CURRENCY_NAME}.`);

    await offerRematch({ challenger, opponent, bet, colors, msg, client, sessionKey, warn });
}

// Offers a Rematch button on the resolved duel message. When both players click,
// balances are re-checked, both wagers are escrowed, and the RPS phase restarts
// on the same message (skipping the accept step — mutual click is consent).
// Cooldowns are intentionally skipped: mutual agreement bypasses the gating that
// `setCooldowns` just installed.
async function offerRematch({ challenger, opponent, bet, colors, msg, client, sessionKey, warn }) {
    const rematchCustomId = `duel_rematch_${sessionKey}_${Date.now()}`;
    const baseButton = () => new ButtonBuilder()
        .setCustomId(rematchCustomId)
        .setLabel("Rematch")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔁");

    const initialRow = new ActionRowBuilder().addComponents(baseButton());
    try {
        await msg.edit({ components: [initialRow] });
    } catch (err) {
        logger.error(`Duel rematch button attach failed: ${err.message}`);
        return;
    }

    const accepted = new Set();
    const collector = msg.createMessageComponentCollector({
        filter: i => i.customId === rematchCustomId,
        time: REMATCH_TIMEOUT,
    });

    collector.on("collect", async i => {
        const isPlayer = i.user.id === challenger.id || i.user.id === opponent.id;
        if (!isPlayer) {
            await warn(i, "This duel isn't yours to rematch.");
            return;
        }
        if (accepted.has(i.user.id)) {
            try { await i.deferUpdate(); } catch (_) {}
            return;
        }
        accepted.add(i.user.id);
        try { await i.deferUpdate(); } catch (_) {}

        if (accepted.size === 1) {
            const waiting = accepted.has(challenger.id) ? opponent : challenger;
            const waitingRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(rematchCustomId)
                    .setLabel(`Rematch — waiting for ${waiting.displayName}`)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("🔁"),
            );
            try { await msg.edit({ components: [waitingRow] }); } catch (_) {}
            return;
        }

        // Both accepted — verify balances before escrowing.
        collector.stop("rematch");

        const [cBal, oBal] = await Promise.all([
            db.get(`${challenger.id}.balance`),
            db.get(`${opponent.id}.balance`),
        ]);
        const challengerBal = cBal || 0;
        const opponentBal = oBal || 0;

        if (challengerBal < bet || opponentBal < bet) {
            const shortPlayer = challengerBal < bet ? challenger : opponent;
            const shortBal = challengerBal < bet ? challengerBal : opponentBal;
            const cancelEmbed = new EmbedBuilder()
                .setAuthor({ name: `Rematch Cancelled`, iconURL: shortPlayer.displayAvatarURL({ dynamic: true }) })
                .setDescription(`${shortPlayer.displayName} only has **${shortBal.toLocaleString("en-US")}** ${CURRENCY_NAME} — not enough to cover the **${bet.toLocaleString("en-US")}** wager.`)
                .setColor(0xFF0000)
                .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
            try { await msg.edit({ embeds: [cancelEmbed], components: [], files: [] }); } catch (_) {}
            logger.info(`Duel ${sessionKey} rematch cancelled — ${shortPlayer.username} insufficient funds.`);
            return;
        }

        // Re-check balances under per-user locks before escrowing — between the
        // pre-check above and acquiring the locks, either side could have spent
        // their wallet in another game.
        const cEsc = await withUserLock(challenger.id, async () => {
            const b = await db.get(`${challenger.id}.balance`) || 0;
            if (b < bet) return false;
            await db.sub(`${challenger.id}.balance`, bet);
            return true;
        });
        if (!cEsc) {
            try { await msg.edit({ components: [] }); } catch (_) {}
            logger.info(`Duel ${sessionKey} rematch cancelled at escrow — challenger insufficient funds.`);
            return;
        }
        const oEsc = await withUserLock(opponent.id, async () => {
            const b = await db.get(`${opponent.id}.balance`) || 0;
            if (b < bet) return false;
            await db.sub(`${opponent.id}.balance`, bet);
            return true;
        });
        if (!oEsc) {
            await withUserLock(challenger.id, () => db.add(`${challenger.id}.balance`, bet));
            try { await msg.edit({ components: [] }); } catch (_) {}
            logger.info(`Duel ${sessionKey} rematch cancelled at escrow — opponent insufficient funds.`);
            return;
        }

        const newSession = {
            challengerId: challenger.id,
            opponentId: opponent.id,
            bet,
            status: "active",
            messageId: msg.id,
            sessionKey,
            startedAt: Date.now(),
        };
        client.duelGames.set(sessionKey, newSession);
        logger.info(`Duel ${sessionKey} rematch starting — both players agreed.`);

        await runRpsPhase({ session: newSession, challenger, opponent, bet, colors, msg, client, sessionKey, warn });
    });

    collector.on("end", async (_, reason) => {
        if (reason === "rematch") return;
        // Drop the rematch button but leave the prior result embed and image intact.
        try { await msg.edit({ components: [] }); } catch (_) {}
    });
}

async function updateStats(winnerId, loserId, bet) {
    // Winner stats
    await db.add(`${winnerId}.stats.duel.wins`, 1);
    await db.add(`${winnerId}.stats.duel.profit`, bet);
    await db.add(`${winnerId}.stats.duel.totalBet`, bet);
    const winnerBiggestWin = await db.get(`${winnerId}.stats.duel.biggestWin`) || 0;
    if (bet > winnerBiggestWin) await db.set(`${winnerId}.stats.duel.biggestWin`, bet);

    // Loser stats
    await db.add(`${loserId}.stats.duel.losses`, 1);
    await db.add(`${loserId}.stats.duel.profit`, -bet);
    await db.add(`${loserId}.stats.duel.totalBet`, bet);
    const loserBiggestLoss = await db.get(`${loserId}.stats.duel.biggestLoss`) || 0;
    if (bet > loserBiggestLoss) await db.set(`${loserId}.stats.duel.biggestLoss`, bet);
}

async function setCooldowns(id1, id2) {
    const until = Date.now() + DUEL_COOLDOWN;
    await db.set(`${id1}.cooldowns.duel`, until);
    await db.set(`${id2}.cooldowns.duel`, until);
}
