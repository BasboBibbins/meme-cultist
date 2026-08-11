// The precondition checks every music command repeats — caller in a voice channel, in the bot's channel, a live queue, something playing. Previously copy-pasted into play.js and queue.js.

const { MessageFlags } = require("discord.js");
const { buildErrorEmbed } = require("./embeds");

// Returns { queue }, or { failed: true } having already replied — callers just bail rather than assembling their own errors.
async function resolveMusicContext(interaction, { requireTrack = true } = {}) {
  const reject = async description => {
    const embed = buildErrorEmbed(interaction.user, interaction.client, description);
    if (interaction.replied || interaction.deferred) await interaction.editReply({ embeds: [embed] });
    else await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return { failed: true };
  };

  const userChannelId = interaction.member?.voice?.channelId;
  if (!userChannelId) return reject("You must be in a voice channel to use this command.");

  const botChannelId = interaction.guild.members.me?.voice?.channelId;
  if (botChannelId && botChannelId !== userChannelId) {
    return reject("You must be in my voice channel to use this command.");
  }

  const queue = interaction.client.player?.nodes?.get(interaction.guild.id);
  if (!queue) return reject("Nothing is playing right now.");

  if (requireTrack && !queue.currentTrack) return reject("There is no track playing right now.");

  return { queue };
}

module.exports = { resolveMusicContext };
