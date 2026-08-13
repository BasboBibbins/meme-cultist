const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { addNewDBUser, db } = require("../../database");
const { CURRENCY_NAME, ROB_COOLDOWN } = require("../../config.js");
const logger = require("../../utils/logger");
const { sendDM } = require("../../utils/dm");
const { recordGameResult } = require("../../utils/gameResults");
const { buildErrorEmbed, buildBaseEmbed, buildInfoEmbed, COLORS } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rob")
    .setDescription(`Rob a user of their ${CURRENCY_NAME}!`)
    .addUserOption(option =>
      option.setName("user")
        .setDescription("The user to rob.")
        .setRequired(true)),
  async execute(interaction) {
    const victim = interaction.options.getUser("user");
    const user = interaction.user;
    const dbUser = await db.get(victim.id);

    const errorEmbed = buildErrorEmbed(user, interaction.client);

    if (!dbUser) {
      logger.warn(`No database entry for user ${victim.displayName } (${victim.id}), creating one...`, "warn");
      await addNewDBUser(victim);
    }
        
    if (victim.bot) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription("You can't rob a bot!")], flags: MessageFlags.Ephemeral });
    }
    if (victim.id === user.id) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription("You can't rob yourself!")], flags: MessageFlags.Ephemeral });
    }
    if (dbUser.balance < 1) {
      return await interaction.reply({ embeds: [errorEmbed.setDescription(`This user doesn't have any ${CURRENCY_NAME} to rob!`)], flags: MessageFlags.Ephemeral });
    }

    const amount = Math.floor(Math.random() * dbUser.balance) + 1;
    const chance = Math.floor(Math.random() * 100) + 1;
    const cooldown = ROB_COOLDOWN;

    const robCooldown = await db.get(`${user.id}.cooldowns.rob`);
    if (robCooldown > Date.now()) {
      return await interaction.reply({ embeds: [buildErrorEmbed(user, interaction.client, `Rob cooldown active. You can rob again **<t:${Math.floor(robCooldown / 1000)}:R>**.`)], flags: MessageFlags.Ephemeral });
    }

    const embed = buildBaseEmbed(user, interaction.client)
      .setAuthor({ name: `${user.displayName} is attempting to rob ${victim.displayName}!`, iconURL: user.displayAvatarURL({ dynamic: true }) })
      .setThumbnail(victim.displayAvatarURL({ dynamic: true, size: 1024 }));
    await interaction.deferReply();

    logger.debug(`chance > 75: ${chance > 75} | chance: ${chance} | amount: ${amount} | victim: ${victim.displayName } (${victim.id}) | user: ${user.displayName } (${user.id})`);

    if (chance > 75) {
      await db.add(`${user.id}.balance`, amount);
      await db.sub(`${victim.id}.balance`, amount);
      embed.setColor(COLORS.success);
      embed.setDescription(`${user.displayName } has successfully robbed **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME} from ${victim.displayName }!`);
      await interaction.editReply({ embeds: [embed] });
      try { recordGameResult({ guildId: interaction.guildId, channelId: interaction.channelId, userId: user.id, game: "rob", result: { victim_id: victim.id, amount, outcome: "success", net: amount } }); } catch (_) {}
      await sendDM(victim, { embeds: [buildInfoEmbed(victim, interaction.client, `**${user.displayName}** just robbed you of **${amount.toLocaleString("en-US")}** ${CURRENCY_NAME} in ${interaction.guild.name}!\n\nBe sure to keep your ${CURRENCY_NAME} safe by depositing it into your bank next time!`, COLORS.error)
        .setTitle("Oh no!")
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))] });
    } else {
      embed.setColor(COLORS.error);
      embed.setDescription(`${user.displayName } failed to rob ${victim.displayName }!`);
      await interaction.editReply({ embeds: [embed] });
      try { recordGameResult({ guildId: interaction.guildId, channelId: interaction.channelId, userId: user.id, game: "rob", result: { victim_id: victim.id, amount, outcome: "fail", net: 0 } }); } catch (_) {}
    }
    return await db.set(`${user.id}.cooldowns.rob`, Date.now() + cooldown);
  },
};
