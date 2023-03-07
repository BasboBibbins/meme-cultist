const {SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { CURRENCY_NAME } = require("../../config.json");
const { addNewDBUser } = require("../../database");
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");

function totalNumOfCmds(type) {
    return Object.keys(type).reduce((a, b) => a + type[b], 0);
}

function getFavoriteCommand(type) {
    let command = Object.keys(type).reduce((a, b) => type[a] > type[b] ? a : b);
    return { command: command, uses: type[command] };
}

async function getTotalGamesPlayed(gameName, user) {
    let wins = await db.get(`${user.id}.stats.${gameName}.wins`);
    let losses = await db.get(`${user.id}.stats.${gameName}.losses`);
    if (gameName == "blackjack") {
        let ties = await db.get(`${user.id}.stats.${gameName}.ties`);
        return wins + losses + ties;
    } else if (gameName == "slots") {
        let jackpots = await db.get(`${user.id}.stats.${gameName}.jackpots`);
        return wins + losses + jackpots;
    } else {
        return wins + losses;
    }
}

async function getWinPercentage(gameName, user) {
    let wins = await db.get(`${user.id}.stats.${gameName}.wins`);
    let totalGamesPlayed = await getTotalGamesPlayed(gameName, user);
    let percentage = (wins / totalGamesPlayed) * 100 || 0;
    return percentage.toFixed(2);
}

async function generateStatsEmbed(page, interaction, user) {
    const fetchedUser = await interaction.guild.members.fetch(user.id);
    const accentColor = fetchedUser.displayHexColor || randomHexColor();

    const stats = await db.get(user.id);
    const embed = new EmbedBuilder()
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setColor(`${accentColor}`)
        .setTimestamp();
    
    if (user !== interaction.user) {
        embed.setAuthor({ name: `Requested by ${interaction.user.username}#${interaction.user.discriminator}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
    }
    embed.setFooter({ text: `${user.username}'s Stats | Page ${page}/4`, iconURL: interaction.guild.iconURL({ dynamic: true }) });
    switch (page) {
        case 1:
            // General Stats
            embed.setTitle(`${user.username}'s General Stats`)
            embed.setFields(
                { name: "General", value: `**Username:** ${user.username}#${user.discriminator}\n`, inline: false },
                { name: "Creation Date", value: `${new Date(user.createdTimestamp).toLocaleString()}`, inline: true },
                { name: "Join Date", value: `${new Date(interaction.guild.members.cache.get(user.id).joinedTimestamp).toLocaleString()}`, inline: true },
                { name: "Roles", value: `${fetchedUser.roles.cache.map(role => role.toString()).join(' ')}`, inline: false },
            );
            break;
        case 2:
            // Command Stats
            embed.setTitle(`${user.username}'s Command Stats`)
            let daily = await db.get(`${user.id}.stats.commands.daily`);
            let monthly = await db.get(`${user.id}.stats.commands.monthly`);
            let yearly = await db.get(`${user.id}.stats.commands.yearly`);
            let total = await db.get(`${user.id}.stats.commands.total`);
            embed.setFields(
                { name: "Today", value: `*Commands Used:* **${totalNumOfCmds(daily)}**\n*Favorite Command:* /**${getFavoriteCommand(daily).command} (${getFavoriteCommand(daily).uses})**`, inline: true },
                { name: "This Month", value: `*Commands Used:* **${totalNumOfCmds(monthly)}**\n*Favorite Command:* /**${getFavoriteCommand(monthly).command} (${getFavoriteCommand(monthly).uses})**`, inline: true },
                { name: " ", value: " ", inline: false}, // buffer for inline fields
                { name: "This Year", value: `*Commands Used:* **${totalNumOfCmds(yearly)}**\n*Favorite Command:* /**${getFavoriteCommand(yearly).command} (${getFavoriteCommand(yearly).uses})**`, inline: true },
                { name: "All Time", value: `*Commands Used:* **${totalNumOfCmds(total)}**\n*Favorite Command:* /**${getFavoriteCommand(total).command} (${getFavoriteCommand(total).uses})**`, inline: true },
            );
            break;
        case 3:
            // Currency Stats
            embed.setTitle(`${user.username}'s Currency Stats`)
            embed.setFields(
                { name: "Current Balance", value: `${stats.balance} ${CURRENCY_NAME}`, inline: true },
                { name: "Bank Balance", value: `${stats.bank} ${CURRENCY_NAME}`, inline: true },
                { name: " ", value: " ", inline: false}, // buffer for inline fields
                { name: "Largest Balance", value: `${stats.stats.largestBalance} ${CURRENCY_NAME}`, inline: true },
                { name: "Largest Bank Balance", value: `${stats.stats.largestBank} ${CURRENCY_NAME}`, inline: true },
                { name: " ", value: " ", inline: false}, // buffer for inline fields
                { name: "Dailies" , value: `
                    *Total Claimed:* **${await db.get(`${user.id}.stats.dailies.claimed`)}**
                    *Current Streak:* **${await db.get(`${user.id}.stats.dailies.currentStreak`)}**
                    *Longest Streak:* **${await db.get(`${user.id}.stats.dailies.longestStreak`)}**`, 
                    inline: true 
                },
                { name: "Weeklies", value: `*Total Claimed:* **${await db.get(`${user.id}.stats.weeklies.claimed`)}**`, inline: true },
            );
            break;
        case 4:
            // Game Stats
            embed.setTitle(`${user.username}'s Game Stats`)
            embed.setFields(
                { name: "Blackjack" , value: `
                    *Games Played:* **${await getTotalGamesPlayed("blackjack", user)}**
                    *Win Rate:* **${await getWinPercentage("blackjack", user)}%**
                    *Blackjacks:* **${await db.get(`${user.id}.stats.blackjack.blackjacks`)}**
                    *Biggest Win:* **${await db.get(`${user.id}.stats.blackjack.biggestWin`)}**
                    *Biggest Loss:* **${await db.get(`${user.id}.stats.blackjack.biggestLoss`)}**`, 
                    inline: true 
                },
                { name: "Slots", value: `
                    *Games Played:* **${await getTotalGamesPlayed("slots", user)}**
                    *Win Rate:* **${await getWinPercentage("slots", user)}%**
                    *Jackpots:* **${await db.get(`${user.id}.stats.slots.jackpots`)}**
                    *Biggest Win:* **${await db.get(`${user.id}.stats.slots.biggestWin`)}**
                    *Biggest Loss:* **${await db.get(`${user.id}.stats.slots.biggestLoss`)}**`,
                    inline: true 
                },
                { name: " ", value: " ", inline: false}, // buffer for inline fields
                { name: "Flip", value: `
                    *Total Flips:* **${await getTotalGamesPlayed("flip", user)}**
                    *Success Rate:* **${await getWinPercentage("flip", user)}%**
                    *Biggest Win:* **${await db.get(`${user.id}.stats.flip.biggestWin`)}**
                    *Biggest Loss:* **${await db.get(`${user.id}.stats.flip.biggestLoss`)}**`, 
                    inline: true 
                },
                { name: "Beg", value: `
                    *Total Begs:* **${await getTotalGamesPlayed("begs", user)}**
                    *Success Rate:* **${await getWinPercentage("begs", user)}%**`,
                    inline: true 
                },
                { name: " ", value: " ", inline: false}, // buffer for inline fields
            );
            if (await db.get(`${user.id}.stats.poker`)) {
                embed.addFields(
                    { name: "Poker", value: `
                        *Games Played:* **${await getTotalGamesPlayed("poker", user)}**
                        *Win Rate:* **${await getWinPercentage("poker", user)}%**
                        *Royal Flushes:* **${await db.get(`${user.id}.stats.poker.royals`)}**
                        *Biggest Win:* **${await db.get(`${user.id}.stats.poker.biggestWin`)}**
                        *Biggest Loss:* **${await db.get(`${user.id}.stats.poker.biggestLoss`)}**`,
                        inline: true
                    },
                );
            }
            break;
    }
    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Check a users stats on the server.")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check the stats of.')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('details')
                .setDescription('Detailed stats for nerd emojis.')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply();
        const user = interaction.options.getUser('user') || interaction.user;
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user);
        }

        const error_embed = new EmbedBuilder()
            

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary),
            );
        let page = 1;
        msg = await interaction.editReply({embeds: [await generateStatsEmbed(page, interaction, user)], components: [row]});
        const filter = i => i.customId === 'previous' || i.customId === 'next';
        const collector = await msg.createMessageComponentCollector({ filter, time: 60000 });

        if (interaction.options.getBoolean('details')) {
            const chunks = []; // trim message to <2000 characters
            const data = JSON.stringify(dbUser, null, 4);
            for (let i = 0; i < data.length; i += 1900) {
                chunks.push(data.substring(i, i + 1900));
            }
            for (let i = 0; i < chunks.length; i++) {
                await interaction.user.send(`\`\`\`json\n${chunks[i]}\`\`\``);
            }
        }

        collector.on('collect', async i => {
            await i.deferUpdate();
            if (i.customId === 'previous') {
                page--;
                if (page === 1) {
                    row.components[0].setDisabled(true);
                }
                row.components[1].setDisabled(false);
                collector.resetTimer();
                i.editReply({embeds: [await generateStatsEmbed(page, interaction, user)], components: [row], fetchReply: true});
            } else if (i.customId === 'next') {
                page++;
                if (page === 4) {
                    row.components[1].setDisabled(true);
                }
                row.components[0].setDisabled(false);
                collector.resetTimer();
                i.editReply({embeds: [await generateStatsEmbed(page, interaction, user)], components: [row], fetchReply: true});
            }
        });

        collector.on('end', (collect, reason) => {
            logger.debug(`Collector ended with reason: ${reason}`);
            interaction.deleteReply();
        });

    },
};