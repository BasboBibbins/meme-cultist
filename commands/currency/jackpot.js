const { SlashCommandBuilder } = require("discord.js");
const { getJackpot, MIN_BET } = require("../../utils/jackpot");
const { CURRENCY_NAME } = require("../../config.js");
const { buildInfoEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("jackpot")
    .setDescription("Check the current progressive jackpot amount."),
  async execute(interaction) {
    const jackpot = await getJackpot();

    const embed = buildInfoEmbed(
      interaction.user,
      interaction.client,
      `**Current Jackpot:** ${jackpot.amount.toLocaleString("en-US")} ${CURRENCY_NAME}`
    )
      .setTitle("🎰 Progressive Jackpot")
      .addFields(
        { name: "Minimum Bet to Qualify", value: `${MIN_BET.toLocaleString("en-US")} ${CURRENCY_NAME}`, inline: true },
        { name: "Games", value: "Slots, Poker", inline: true }
      );

    // Show last winner if there is one
    if (jackpot.lastWinner) {
      const lastWonDate = new Date(jackpot.lastWon);
      embed.addFields({
        name: "Last Winner",
        value: `**${jackpot.lastWinner.name}** won ${jackpot.amount.toLocaleString("en-US")} ${CURRENCY_NAME}\n<t:${Math.floor(lastWonDate.getTime() / 1000)}:f>`,
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
};