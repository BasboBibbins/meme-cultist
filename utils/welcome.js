const { EmbedBuilder } = require('discord.js');
const { version } = require('../package.json');
const { DEFAULT_ROLE, RULES_CHANNEL_ID } = require('../config.json');
const { QuickDB } = require('quick.db');
const { addNewDBUser } = require('../database');
const db = new QuickDB( { filePath: 'db/users.sqlite' });
const { WELCOME_CHANNEL_ID, RIP_CHANNEL_ID } = require('../config.json');
const logger = require('../utils/logger');

async function ripGen(guildMember, prompt) {
    const victim = guildMember.user;
    const buffer = 25;
    let rip = `\`\`\`\n-=-=-=-=-=-=-=-=-=-=- R I P -=-=-=-=-=-=-=-=-=-=-\n`;
    let ripLines = buffer - (((victim.username.length + 5) + 2)/2);
    rip += `\n${'-'.repeat(ripLines)} ${victim.username}#${victim.discriminator} ${'-'.repeat(ripLines %1==0? ripLines-1 : ripLines)}\n`;
    let joinedAt = guildMember.joinedAt || `??/??/20XX`;
    let joinDate = new Date(joinedAt);
    let leaveDate = new Date();
    ripLines = buffer - (((joinDate.toLocaleDateString("en-US").length + leaveDate.toLocaleDateString("en-US").length)+5)/2);
    rip += `\n${'-'.repeat(ripLines)} ${joinDate.toLocaleDateString("en-US")} - ${leaveDate.toLocaleDateString("en-US")} ${'-'.repeat(ripLines %1==0? ripLines-1 : ripLines)}\n`;

    let promptLines = prompt.match(/.{1,40}(\s|$)|\S+?(\s|$)/g); 
    if (!promptLines.includes("\n") && !promptLines.includes(" ")) promptLines = prompt.match(/.{1,40}/g); 
    for (let i = 0; i < promptLines.length; i++) {
        if (promptLines[i].endsWith(" ")) promptLines[i] = promptLines[i].slice(0, -1);
        ripLines = buffer - ((promptLines[i].length+2)/2);
        rip += `\n${'-'.repeat(ripLines)} ${promptLines[i]} ${'-'.repeat(ripLines %1==0? ripLines-1 : ripLines)}\n`;
    }
    
    const sincerely = "Sincerely,";
    const sincerelyLines = buffer - ((sincerely.length+2)/2);
    rip += `\n${'-'.repeat(sincerelyLines)} ${sincerely} ${'-'.repeat(sincerelyLines %1==0? sincerelyLines-1 : sincerelyLines)}\n`;
    const serverName = guildMember.guild.name;
    const serverNameLines = buffer - ((serverName.length+2)/2);
    rip += `\n${'-'.repeat(serverNameLines)} ${serverName} ${'-'.repeat(serverNameLines %1==0? serverNameLines-1 : serverNameLines)}\n`;
    rip += `\n-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-\n\`\`\``;
    return rip;
}

module.exports = {
    ripGen: async function (victim, prompt) {
        return await ripGen(victim, prompt);
    },
    welcome: async function (client, member) {
        const channel = member.guild.channels.cache.find(ch => ch.name === 'welcome');
        if (!channel) return;

        const dbUser = await db.get(member.user.id);

        member.roles.add(member.guild.roles.cache.find(role => role.name === DEFAULT_ROLE));
        const fetchedUser = await member.user.fetch();  
        let accentColor = fetchedUser.hexAccentColor ? fetchedUser.hexAccentColor : "#FFFFFF";
        const embed = new EmbedBuilder()
            .setColor(`${accentColor}`)
            .setTitle(`Welcome ${dbUser ? `back`:``} to ${member.guild.name}, ${member.user.username}!`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setDescription(`Welcome ${dbUser ? `back`:``} to ${member.guild.name} <@${member.id}>! Now **GET THE FUCK OUT OF MY DISCORD NORMIE!!!!**\n\nPlease read the rules in <#${RULES_CHANNEL_ID}>, as they are heavily enforced! *Our janitors do it for free!*`)
            .setFooter({ text: `Meme Cultist | Version ${version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        await channel.send({ embeds: [embed] });

        if (!dbUser) {
            logger.warn(`No database entry for user ${member.user.username} (${member.user.id}), creating one...`)
            await addNewDBUser(member.user);
        }
    },

    goodbye: async function (client, member) {
        const auditLog = await member.guild.fetchAuditLogs({limit: 1});
        const log = auditLog.entries.first();
        let prompt = "";
        if (log.target.id == member.id) {
            if (log.action == 20) { // KICK
                const executor = log.executor;
                if (executor.id == client.user.id) return;
                prompt = `kicked by ${executor.tag} ${log.reason ? `for reason: ${log.reason}` : ``}`
                logger.warn(`${member.user.username} (${member.user.id}) was kicked by ${executor.tag} (${executor.id}) ${log.reason ? `for reason: ${log.reason}` : ``}.`);
            } else if (log.action == 22) { // BAN
                const executor = log.executor;
                if (executor.id == client.user.id) return;
                prompt = `banned by ${executor.tag} ${log.reason ? `for reason: ${log.reason}` : ``}`
                logger.warn(`${member.user.username} (${member.user.id}) was banned by ${executor.tag} (${executor.id}) ${log.reason ? `for reason: ${log.reason}` : ``}.`);
            } else if (log.action == 21) { // PRUNE
                const executor = log.executor;
                if (executor.id == client.user.id) return;
                prompt = `who the fuck are you?`
                logger.warn(`${member.user.username} (${member.user.id}) was pruned by ${executor.tag} (${executor.id}).`);
            } else {
                logger.warn(`${member.user.username} (${member.user.id}) left the server.`);
                prompt = `probably couldn't take the light amount of trolling.`
            }
            await module.exports.rip(client, member, prompt);
        } else {
            logger.warn(`${member.user.username} (${member.user.id}) left the server`);
            prompt = `probably couldn't take the light amount of trolling.`
            await module.exports.rip(client, member, prompt);
        }
    },

    rip: async function (client, member, prompt) {
        const channel = member.guild.channels.cache.find(ch => ch.name === 'rip');
        if (!channel) return;
        const titles = [
            `cya ${member.user.username}`,
            `RIP THAT BOZO ${member.user.username.toUpperCase()} #PACKWATCH `,
            `${member.user.username} is fucking dead`,
            `Here lies: ${member.user.username}`,
            `rest in piss ${member.user.username}`,
            `rest in peace ${member.user.username}`,
            `rip ${member.user.username}`,
            `RIP ${member.user.username}, you (won't) be missed`,
            `it's a shame ${member.user.username} had to die`,
            `RIP ${member.user.username}, you were kinda cringe tho`,
            `it's over. ${member.user.username} is dead`,
            `🦀 ${member.user.username} is dead 🦀`,
            `${member.user.username} is dead. long live ${member.user.username}!`,
            `RIP ${member.user.username}, you were a good person`,
            `Press F to pay respects to ${member.user.username}`,
            `☠️ ${member.user.username} is dead ☠️`,
            `ripperoni pepperoni ${member.user.username}-eroni`,
            `${member.user.username} just got crit piped`,
            `erm... ${member.user.username} isn't dead. he just left the server 🤓`,
            `that's fucked up. ${member.user.username} just died. based?`,
            `i didn't see who died, but i'm pretty sure it was ${member.user.username}`,
            `my honest reaction to ${member.user.username} dying: 🤷‍♂️`,
            `see you in hell ${member.user.username}`,
            `${member.user.username} is dead. see you in space cowboy`,
            `${member.user.username}'s death was fact-check by real American patriots.`,
            `${member.user.username} did too much lean.`,
            `${member.user.username} "died suddenly"`,
            `${member.user.username} is dead, not big surprise!`,
            `${member.user.username} is dead, many such cases!`,
            `${member.user.username} is dead, not a big loss for ${member.guild.name}!`,
            `${member.user.username} didn't thank his doctor`,
            `i can't believe ${member.user.username} is dead`,
            `${member.user.username}? ${member.user.username}?! ${member.user.username.toUpperCase()}!!!!`,
            `the west has fallen. ${member.user.username} is dead`,
            `${member.user.username} got caught trolling`,
            `${member.guild.name} is now ${member.user.username} free`,
            `RIP ${member.user.username}, billions will die for this.`,
            `see you on the flip side ${member.user.username}`,
            `back to former hell ${member.user.username}`,
        ]
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle(titles[Math.floor(Math.random() * titles.length)])
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setDescription(await ripGen(member, prompt))
            .setFooter({ text: `Meme Cultist | Version ${version}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        await channel.send({ embeds: [embed] });
    }
}