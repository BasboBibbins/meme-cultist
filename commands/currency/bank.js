const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME, INTEREST_RATE } = require("../../config.json");
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");
const wait = require('util').promisify(setTimeout);
const { deposit, withdraw, parseAmount } = require('../../utils/bank');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("bank")
        .setDescription(`Withdraw or deposit ${CURRENCY_NAME} from your bank. Gains interest and protects from robbers!`)
        .addSubcommand(subcommand =>
            subcommand
                .setName("deposit")
                .setDescription(`Deposit ${CURRENCY_NAME} from your wallet to your bank.`)
                .addStringOption(option =>
                    option.setName("amount")
                        .setDescription(`The amount of ${CURRENCY_NAME} to deposit.`)
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("withdraw")
                .setDescription(`Withdraw ${CURRENCY_NAME} from your bank to your wallet.`)
                .addStringOption(option =>
                    option.setName("amount")
                        .setDescription(`The amount of ${CURRENCY_NAME} to withdraw.`)
                        .setRequired(true)
                )
        ),
    async execute(interaction) {
        const user = interaction.user;
        const option = interaction.options.getString("amount");
        const subcommand = interaction.options.getSubcommand();
        const amount = await parseAmount(option, user.id, subcommand);
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            logger.log(`No database entry for user ${user.username} (${user.id}), creating one...`, "warn")
            await addNewDBUser(user);
        }
        
        const fetchedUser = await user.fetch()
        let accentColor = fetchedUser.hexAccentColor || randomHexColor();
        
        await interaction.deferReply({ ephemeral: true });

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.username}'s Bank`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(`${accentColor}`)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true}) });

        if (isNaN(amount) || (amount < 1)) {
            embed.setDescription(`Please enter a valid amount of ${CURRENCY_NAME} to ${subcommand}!`);
            embed.setColor("#FF0000");
            await interaction.editReply({embeds: [embed]});
            await wait(30000).then(() => {
                interaction.deleteReply();
            });
            return;
        }

        switch (subcommand) {
            case "deposit":
                if (dbUser.balance < amount) {
                    embed.setDescription(`You don't have enough ${CURRENCY_NAME} to deposit!`);
                    embed.setColor("#FF0000");
                } else {
                    logger.info(`Depositing ${amount} ${CURRENCY_NAME} from ${user.username} (${user.id})'s wallet to their bank...`);
                    await deposit(user.id, amount);
                    embed.setDescription(`Successfully deposited ${amount} ${CURRENCY_NAME} into your bank!`);
                    embed.setColor("#00FF00");
                }
                await interaction.editReply({embeds: [embed]});
                await wait(30000).then(() => {
                    interaction.deleteReply();
                });
                break;
            case "withdraw":
                if (dbUser.bank < amount) {
                    embed.setDescription(`You don't have enough ${CURRENCY_NAME} to withdraw!`);
                    embed.setColor("#FF0000");
                } else {
                    logger.info(`Withdrawing ${amount} ${CURRENCY_NAME} from ${user.username} (${user.id})'s bank to their wallet...`);
                    await withdraw(user.id, amount);
                    embed.setDescription(`Successfully withdrew ${amount} ${CURRENCY_NAME} from your bank!`);
                    embed.setColor("#00FF00");
                }
                await interaction.editReply({embeds: [embed]});
                await wait(30000).then(() => {
                    interaction.deleteReply();
                });
                break;
        }
    },
};