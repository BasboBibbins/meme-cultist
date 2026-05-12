const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, DUEL_MIN_BET, DUEL_COOLDOWN } = require("../../config.js");
const { parseBet } = require("../../utils/betparse");
const { renderDuel } = require("../../utils/duelCanvas");
const { getEquippedTheme } = require("../../themes/manager");
const { getDuelColors } = require("../../themes/resolver");
const logger = require("../../utils/logger");

const ACCEPT_TIMEOUT = 60000;
const CHOICE_TIMEOUT = 30000;

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
        const statsPath = `${challenger.id}.stats.duel`;

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
        const opponentBalance = await db.get(`${opponent.id}.balance`) || 0;

        if (bet > challengerBalance) {
            errorEmbed.setDescription(`You don't have enough ${CURRENCY_NAME}!`);
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        if (bet > opponentBalance) {
            errorEmbed.setDescription(`${opponent.displayName} doesn't have enough ${CURRENCY_NAME} to match your wager!`);
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        // Cooldown check
        const challengerCooldown = await db.get(`${challenger.id}.cooldowns.duel`) || 0;
        if (challengerCooldown > Date.now()) {
            const timeLeft = new Date(challengerCooldown - Date.now());
            const minutes = timeLeft.getMinutes();
            const seconds = timeLeft.getSeconds();
            errorEmbed.setDescription(`You must wait ${minutes > 0 ? `${minutes}m ` : ""}${seconds}s before dueling again!`);
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        // Create session
        const sessionKey = `${interaction.channelId}:${challenger.id}:${opponent.id}`;
        if (client.duelGames.has(sessionKey)) {
            errorEmbed.setDescription("You already have an active duel with this user!");
            return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        // Escrow both wagers
        await db.sub(`${challenger.id}.balance`, bet);
        await db.sub(`${opponent.id}.balance`, bet);

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

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${challenger.displayName} challenges ${opponent.displayName}!`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
            .setDescription(`**${challenger.displayName}** has wagered **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME} on a Rock-Paper-Scissors duel!\n\n${opponent}, click **Accept Duel** to lock in your **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME} and play.`)
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
            );

        await interaction.deferReply();
        const msg = await interaction.editReply({ content: `${opponent}`, embeds: [embed], components: [acceptRow] });

        // DM the challenged user
        try {
            await opponent.send({ embeds: [new EmbedBuilder()
                .setTitle("You've been challenged to a duel!")
                .setThumbnail(challenger.displayAvatarURL({ dynamic: true, size: 1024 }))
                .setDescription(`**${challenger.displayName}** has challenged you to a Rock-Paper-Scissors duel for **${bet.toLocaleString("en-US")}** ${CURRENCY_NAME} in ${interaction.guild.name}!\n\nClick **Accept Duel** in the channel to play, or ignore it to decline.`)
                .setColor(colors.embedColor || 0x0f4c25)
                .setTimestamp()
                .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })] });
        } catch (_) {}

        const session = client.duelGames.get(sessionKey);
        if (session) {
            session.messageId = msg.id;
            session.sessionKey = sessionKey;
        }

        // Acceptance collector
        const acceptFilter = i => i.user.id === opponent.id && i.customId === `duel_accept_${sessionKey}`;
        const acceptCollector = msg.createMessageComponentCollector({ filter: acceptFilter, time: ACCEPT_TIMEOUT, max: 1 });

        acceptCollector.on("collect", async i => {
            session.status = "active";

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

            await i.update({ embeds: [rpsEmbed], components: [rpsRow], files: chooseAttachment ? [chooseAttachment] : [] });

            // RPS selection collector
            const choices = new Map();
            const rpsFilter = btn => {
                const isPlayer = btn.user.id === challenger.id || btn.user.id === opponent.id;
                const prefix = `duel_rps_${sessionKey}_`;
                return isPlayer && btn.customId.startsWith(prefix);
            };
            const rpsCollector = msg.createMessageComponentCollector({ filter: rpsFilter, time: CHOICE_TIMEOUT });

            rpsCollector.on("collect", async btn => {
                const choice = btn.customId.split("_").pop();
                const isChallenger = btn.user.id === challenger.id;
                const playerName = isChallenger ? challenger.displayName : opponent.displayName;

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
                    await resolveDuel(session, choices, challenger, opponent, bet, colors, msg, client);
                } else {
                    // Timeout / incomplete
                    if (choices.size === 0) {
                        // No one chose — refund both
                        await db.add(`${challenger.id}.balance`, bet);
                        await db.add(`${opponent.id}.balance`, bet);

                        const timeoutEmbed = new EmbedBuilder()
                            .setAuthor({ name: `Duel Cancelled`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
                            .setDescription(`Neither player chose in time. Both wagers have been refunded.`)
                            .setColor(0xFF0000)
                            .setFooter({ text: `${client.user.username} | Version ${require("../../package.json").version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
                            .setTimestamp();

                        await msg.edit({ embeds: [timeoutEmbed], components: [] });
                        logger.info(`Duel ${sessionKey} timed out with no choices. Both refunded.`);
                    } else {
                        // One chose, one didn't — forfeit win
                        const chooserId = choices.keys().next().value;
                        const winner = chooserId === challenger.id ? challenger : opponent;
                        const loser = chooserId === challenger.id ? opponent : challenger;

                        await db.add(`${winner.id}.balance`, bet * 2);
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

                        try {
                            await loser.send({ embeds: [new EmbedBuilder()
                                .setTitle("You lost a duel!")
                                .setThumbnail(winner.displayAvatarURL({ dynamic: true, size: 1024 }))
                                .setDescription(`**${winner.displayName}** won **${(bet * 2).toLocaleString("en-US")}** ${CURRENCY_NAME} from you by forfeit in ${interaction.guild.name}!`)
                                .setColor(0xFF0000)
                                .setTimestamp()] });
                        } catch (_) {}

                        logger.info(`Duel ${sessionKey} forfeited — ${winner.username} wins ${bet * 2} ${CURRENCY_NAME}.`);
                    }
                    client.duelGames.delete(sessionKey);
                }
            });
        });

        acceptCollector.on("end", async (_, reason) => {
            if (reason === "time") {
                // Opponent never accepted — refund both
                await db.add(`${challenger.id}.balance`, bet);
                await db.add(`${opponent.id}.balance`, bet);

                const expiredEmbed = new EmbedBuilder()
                    .setAuthor({ name: `Duel Expired`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`${opponent.displayName} did not accept the duel in time. Both wagers have been refunded.`)
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

async function resolveDuel(session, choices, challenger, opponent, bet, colors, msg, client) {
    const challengerChoice = choices.get(challenger.id);
    const opponentChoice = choices.get(opponent.id);
    const result = resolveWinner(challengerChoice, opponentChoice);

    if (result === "draw") {
        // Refund both
        await db.add(`${challenger.id}.balance`, bet);
        await db.add(`${opponent.id}.balance`, bet);

        const drawEmbed = new EmbedBuilder()
            .setAuthor({ name: `It's a Draw!`, iconURL: challenger.displayAvatarURL({ dynamic: true }) })
            .setDescription(`Both players chose **${CHOICE_EMOJIS[challengerChoice]}**. It's a draw!\n\nBoth players have been refunded.`)
            .setColor(colors.embedColor || 0x0f4c25)
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
                result: "draw",
                colors,
            });
            await msg.edit({ embeds: [drawEmbed], components: [], files: [attachment] });
        } catch (err) {
            logger.error(`Duel canvas render failed: ${err.message}`);
            await msg.edit({ embeds: [drawEmbed], components: [] });
        }

        // Update totalBet stat for both
        await db.add(`${challenger.id}.stats.duel.totalBet`, bet);
        await db.add(`${opponent.id}.stats.duel.totalBet`, bet);

        client.duelGames.delete(session.sessionKey || `${msg.channelId}:${challenger.id}:${opponent.id}`);
        logger.info(`Duel ${msg.channelId}:${challenger.id}:${opponent.id} ended in a draw.`);
        return;
    }

    const winner = result === "challenger" ? challenger : opponent;
    const loser = result === "challenger" ? opponent : challenger;

    // Winner takes full pot
    await db.add(`${winner.id}.balance`, bet * 2);
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
    try {
        await loser.send({ embeds: [new EmbedBuilder()
            .setTitle("You lost a duel!")
            .setThumbnail(winner.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setDescription(`**${winner.displayName}** won **${(bet * 2).toLocaleString("en-US")}** ${CURRENCY_NAME} from you in ${msg.guild?.name || "the server"}!\n\nYou chose ${CHOICE_EMOJIS[choices.get(loser.id)]} and they chose ${CHOICE_EMOJIS[choices.get(winner.id)]}.`)
            .setColor(0xFF0000)
            .setTimestamp()] });
    } catch (_) {}

    client.duelGames.delete(session.sessionKey || `${msg.channelId}:${challenger.id}:${opponent.id}`);
    logger.info(`Duel ${msg.channelId}:${challenger.id}:${opponent.id} resolved — ${winner.username} wins ${bet * 2} ${CURRENCY_NAME}.`);
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
