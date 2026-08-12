// The precondition checks every music command repeats — caller in a voice channel, in the bot's channel, a live queue, something playing.

const { MessageFlags } = require("discord.js");
const { buildErrorEmbed } = require("./embeds");

// Returns { queue, voiceChannel }, or { failed: true } having already replied — callers just bail rather than assembling their own errors.
// requireQueue is off for /play, which runs the same voice checks but creates the queue a live-queue requirement would reject it for not having.
async function resolveMusicContext(interaction, { requireTrack = true, requireQueue = true } = {}) {
  const reject = async description => {
    const embed = buildErrorEmbed(interaction.user, interaction.client, description);
    if (interaction.replied || interaction.deferred) await interaction.editReply({ embeds: [embed] });
    else await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return { failed: true };
  };

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) return reject("You must be in a voice channel to use this command.");

  const botChannelId = interaction.guild.members.me?.voice?.channelId;
  if (botChannelId && botChannelId !== voiceChannel.id) {
    return reject("You must be in my voice channel to use this command.");
  }

  const queue = interaction.client.player?.nodes?.get(interaction.guild.id);
  if (requireQueue && !queue) return reject("Nothing is playing right now.");

  if (requireQueue && requireTrack && !queue.currentTrack) return reject("There is no track playing right now.");

  return { queue, voiceChannel };
}

module.exports = { resolveMusicContext };
