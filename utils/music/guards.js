// The precondition checks every music command repeats: caller in a voice channel, in the bot's channel, a live queue, something playing.

const { MessageFlags } = require("discord.js");
const { musicErrorEmbed } = require("../embeds");

// Returns { queue, voiceChannel }, or { failed: true } having already replied. Callers just bail rather than assembling their own errors.
// requireQueue is off for /play, which runs the same voice checks but creates the queue a live-queue requirement would reject it for not having.
async function resolveMusicContext(interaction, { requireTrack = true, requireQueue = true } = {}) {
  const reject = async description => {
    const embed = musicErrorEmbed(interaction, description);
    if (interaction.replied || interaction.deferred) await interaction.editReply({ embeds: [embed] });
    else await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return { failed: true };
  };

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) return reject("Get in a voice channel first. I am not shouting into an empty room.");

  const botChannelId = interaction.guild.members.me?.voice?.channelId;
  if (botChannelId && botChannelId !== voiceChannel.id) {
    const where = interaction.guild.channels.cache.get(botChannelId);
    return reject(`I am already in ${where ? `**${where.name}**` : "another channel"}. Come to me.`);
  }

  const queue = interaction.client.player?.nodes?.get(interaction.guild.id);
  if (requireQueue && !queue) return reject("Nothing is playing. Use `/play` and give me something to work with.");

  if (requireQueue && requireTrack && !queue.currentTrack) return reject("There is no track on right now. Use `/play` to start one.");

  return { queue, voiceChannel };
}

module.exports = { resolveMusicContext };
