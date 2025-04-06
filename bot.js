const dotenv = require("dotenv")
const { REST } = require("@discordjs/rest")
const { Routes } = require("discord-api-types/v9")
const fs = require("fs")
const { Player } = require("discord-player")
const { GatewayIntentBits, Events, Client, Collection, InteractionType } = require("discord.js")
const { QuickDB } = require("quick.db")
const { initDB } = require("./database")
const { GUILD_ID, CLIENT_ID, CHATBOT_CHANNEL, CHATBOT_ENABLED, CHATBOT_LOCAL, BANNED_ROLE, APRIL_FOOLS_MODE, TESTING_ROLE, TESTING_MODE, OWNER_ID, LEGACY_COMMANDS, PAST_MESSAGES } = require("./config.json")
const { trackStart, trackEnd } = require("./utils/musicPlayer")
const { welcome, goodbye } = require("./utils/welcome")
const { interest } = require("./utils/bank")
const { handleBotMessage, runLocalModel, deleteThreadContext, addNewThreadContext, getValidMessages, summarizeMessages } = require("./utils/openai")
const moment = require("dayjs")
const logger = require("./utils/logger")
const schedule = require("node-schedule")

dotenv.config()
const TOKEN = process.env.TOKEN
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const LOAD_SLASH = process.argv[2] == "load"
const LOAD_DB = process.argv[2] == "dbinit"
const DEBUG_MODE = process.argv[2] == "debug"
const DELETE_SLASH = process.argv[2] == "delete"
const DELETE_SLASH_ID = process.argv[3]
const UNDO_APRILFOOLS = process.argv[2] == "afundo"

const banned = BANNED_ROLE;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
})

const dailyJob = schedule.scheduleJob("0 0 0 * * *", async () => { // 12:00 AM every day
    logger.debug(`Daily job started at ${moment().format("YYYY-MM-DD HH:mm:ss")}.`)
    await interest(client)
})

client.slashcommands = new Collection()
client.player = new Player(client, {
    ytdlOptions: {
        filter: "audioonly",
        quality: "highestaudio",
        highWaterMark: 1 << 25,
        opusEncoded: true,
        encoderArgs: ['-af', 'bass=g=10,dynaudnorm=f=200'],
        requestOptions: {
            headers: {
                cookie: process.env.COOKIE
            }
        }
    }
})

let db = null;
if (fs.existsSync(`./db/users.sqlite`)) {
    db = new QuickDB({ filePath: `./db/users.sqlite` })
} else {
    logger.error(`Database file not found! Please run \`node bot.js dbinit\` to create the database.`)
    process.exit(1)
}

process.on("unhandledRejection", (reason, p) => {
    logger.error(`Unhandled Promise Rejection! Reason: ${reason}`);
    logger.error(p.catch((err) => logger.error(err)));
})
.on("uncaughtException", (err) => {
    logger.error(`Uncaught Exception: ${err}`);
    logger.error(err.stack);
    process.exit(1);
})

let commands = []

const walk = function(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = dir + '/' + file;
        file_type = file.split(".").pop();
        file_name = file.split(/(\\|\/)/g).pop();
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else { 
            if (file_type == "js") results.push(file);
        }
    });
    return results;
}

const slashFiles = walk('./commands');

for (const file of slashFiles) {
    const slashcmd = require(`${file}`);
    client.slashcommands.set(slashcmd.data.name, slashcmd)
    if (LOAD_SLASH) commands.push(slashcmd.data.toJSON())
}

if (DELETE_SLASH) {
    const rest = new REST({ version: "10" }).setToken(TOKEN)
    if (DELETE_SLASH_ID) {
        logger.info(`Deleting slash command with ID \x1b[33m${DELETE_SLASH_ID}\x1b[0m...`)
        rest.delete(Routes.applicationCommand(CLIENT_ID, DELETE_SLASH_ID))
        .then(() => {
            logger.info(`Successfully deleted application (/) command with ID \x1b[33m${DELETE_SLASH_ID}\x1b[0m.`)
            process.exit(0)
        })
        .catch((err) => {
            if (err){
                logger.error(err)
                process.exit(1)
            }
        })
    } else {
        logger.info(`Deleting all slash commands...`)
        client.slashcommands.set([]);
        rest.put(Routes.applicationCommands(CLIENT_ID), {body: []})
        .then(() => {
            logger.info(`Successfully deleted all application (/) commands.`)
            process.exit(0)
        })
        .catch((err) => {
            if (err){
                logger.error(err)
                process.exit(1)
            }
        })
    }
} else if (LOAD_SLASH) {
    const rest = new REST({ version: "10" }).setToken(TOKEN)
    logger.info(`Loading slash commands...`)
    rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {body: commands})
    .then(() => {
        logger.info(`Successfully reloaded ${commands.length} application (/) commands.`)
        process.exit(0)
    })
    .catch((err) => {
        if (err){
            logger.error(err)
            process.exit(1)
        }
    })
} else {
    client.once(Events.ClientReady, () => {
        if (LOAD_DB) {
            initDB(client)
        }
        logger.info(`Logged in as \x1b[33m${client.user.tag}\x1b[0m!`);
        if (APRIL_FOOLS_MODE) {
            logger.info(`April Fools mode is enabled!`);
            require("./utils/aprilfools").aprilfoolsMode(client, client.guilds.cache.get(GUILD_ID), OPENAI_API_KEY);
        }
        if (UNDO_APRILFOOLS && !APRIL_FOOLS_MODE) {
            require("./utils/aprilfools").undoAprilFools(client, client.guilds.cache.get(GUILD_ID));
        } else if (UNDO_APRILFOOLS && APRIL_FOOLS_MODE) {
            logger.error(`April fools mode is still enabled! Disable in the config before running this command.`);
            process.exit(1)
        }
        if (CHATBOT_LOCAL) {
            logger.debug(`Local model is ${CHATBOT_LOCAL ? "\x1b[32mON\x1b[0m" : "\x1b[31mOFF\x1b[0m"}`); 
            runLocalModel();
        }
    })

    if (DEBUG_MODE) client.on(Events.Debug, (info) => logger.debug(info));
    client.on(Events.Warn, (info) => logger.warn(info));
    client.on(Events.Error, (info) => logger.error(info));

    client.on(Events.GuildMemberAdd, async member => {
        if (member.guild.id == GUILD_ID) {
            await welcome(client, member);
        }
    })

    client.on(Events.GuildMemberRemove, async member => {
        if (member.guild.id == GUILD_ID) {
            await goodbye(client, member);
        }
    })

    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isCommand() && interaction.member.roles.cache.has(banned)) {
            return await interaction.member.createDM().then(async dm => {
                await dm.send(`You are banned from using ${interaction.client.user.username}. If you believe this is a mistake, contact <@${OWNER_ID}> or an admin in ${interaction.guild.name}.`)
            })
        }
        if (interaction.isChatInputCommand()) {
            interaction.channel.sendTyping().then(async () => {
                
                const command = interaction.client.slashcommands.get(interaction.commandName);
            
                if (!command) {
                    logger.error(`No command matching ${interaction.commandName} was found.`);
                    return;
                }

                if (TESTING_MODE && !interaction.member.roles.cache.has(TESTING_ROLE)){
                    await interaction.reply({content: `The new ${interaction.client.user.username} is currently in beta! Contact <@${OWNER_ID}> for access!`, ephemeral: true})
                    return
                }

                if (interaction.member.roles.cache.has(banned)){
                    await interaction.reply({content: `You are banned from using ${interaction.client.user.username}. If you believe this is a mistake, contact <@${OWNER_ID}> or an admin in ${interaction.guild.name}.`, ephemeral: true})
                    return
                }
            
                try {
                    await command.execute(interaction);
                    logger.info(`${interaction.user.tag} used command \x1b[33m\`${interaction.commandName}\`\x1b[0m in #${interaction.channel.name} in ${interaction.guild.name}.`);
                    if (db) {
                        if (await db.get(`${interaction.user.id}.stats.commands.dailyReset`) != moment().format("YYYY-MM-DD")) {
                            await db.set(`${interaction.user.id}.stats.commands.dailyReset`, moment().format("YYYY-MM-DD"))
                            await db.set(`${interaction.user.id}.stats.commands.daily`, {})
                        }
                        if (await db.get(`${interaction.user.id}.stats.commands.monthlyReset`) != moment().format("YYYY-MM")) {
                            await db.set(`${interaction.user.id}.stats.commands.monthlyReset`, moment().format("YYYY-MM"))
                            await db.set(`${interaction.user.id}.stats.commands.monthly`, {})
                        }
                        if (await db.get(`${interaction.user.id}.stats.commands.yearlyReset`) != moment().format("YYYY")) {
                            await db.set(`${interaction.user.id}.stats.commands.yearlyReset`, moment().format("YYYY"))
                            await db.set(`${interaction.user.id}.stats.commands.yearly`, {})
                        }
                        
                        await db.add(`${interaction.user.id}.stats.commands.daily.${interaction.commandName}`, 1)
                        await db.add(`${interaction.user.id}.stats.commands.monthly.${interaction.commandName}`, 1)
                        await db.add(`${interaction.user.id}.stats.commands.yearly.${interaction.commandName}`, 1)
                        await db.add(`${interaction.user.id}.stats.commands.total.${interaction.commandName}`, 1)

                        let balance = await db.get(`${interaction.user.id}.balance`)
                        let largestBalance = await db.get(`${interaction.user.id}.stats.largestBalance`)
                        if (balance > largestBalance) {
                            await db.set(`${interaction.user.id}.stats.largestBalance`, balance)
                        }

                        let bank = await db.get(`${interaction.user.id}.bank`)
                        let largestBank = await db.get(`${interaction.user.id}.stats.largestBank`)
                        if (bank > largestBank) {
                            await db.set(`${interaction.user.id}.stats.largestBank`, bank)
                        }
                    }
                } catch (error) {
                    logger.error(error);
                    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                }
            })
        } else if (interaction.isAutocomplete()) {
            const command = interaction.client.slashcommands.get(interaction.commandName);

            if (!command) {
                logger.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                logger.error(error);
            }
        } else if (interaction.type === InteractionType.ModalSubmit) {
            logger.info(`${interaction.user.tag} submitted a modal in #${interaction.channel.name} in ${interaction.guild.name}.`);
            await interaction.deferReply({ ephemeral: true }).then(async () => {
                if (DEBUG_MODE) {
                    await interaction.editReply({ content: "Your modal has been submitted!", ephemeral: true })
                } else {
                    await interaction.deleteReply();
                }
            }).catch(async error => {
                logger.error(error)
                await interaction.editReply({ content: "There was an error submitting your request!", ephemeral: true })
            })
        }
    });
    client.player.events.on("tracksAdd", async (queue, t) => {
        logger.log(`${t.length > 1 ? `${t.length} tracks` : `${t[0].title}`} added to queue in ${queue.guild.name}!`);
    });
    client.player.events.on("playerStart", async (queue, track) => {
        logger.log(`Now playing ${track.title} in ${queue.guild.name}!`);
        await trackStart(client, queue, track);
    });
    client.player.events.on("playerFinish", async (queue, track) => {
        logger.log(`Finished playing ${track.title} in ${queue.guild.name}!`);
        await trackEnd(client, queue, track);
    });
    client.player.events.on("channelEmpty", async (queue) => {
        logger.warn(`Nobody is in the voice channel, leaving ${queue.guild.name}!`);
        await queue.player.destroy();
    });
    client.player.events.on("error", async (queue, error) => {
        logger.error(`Error in ${queue.guild.name}'s queue! - ${error.message}`);
        logger.error(error.stack);
    });

    client.on(Events.ThreadCreate, async (thread) => {
        logger.info(`Thread "${thread.name}" [${thread.id}] created in ${thread.guild.name}, checking if it's a chatbot thread...`);
        if (thread.parentId === CHATBOT_CHANNEL) {
            await addNewThreadContext(thread);
        } 
    });

    client.on(Events.ThreadDelete, async (thread) => {
        logger.info(`Thread "${thread.name}" [${thread.id}] deleted in ${thread.guild.name}, checking if it's a chatbot thread...`);
        if (thread.parentId === CHATBOT_CHANNEL) {
            await deleteThreadContext(thread);
        } 
    });

    client.login(TOKEN)

    client.on(Events.MessageCreate, async (message) => {
        // separated so that we can check for bot messages
        const targetChannel = message.channel;
        if (targetChannel.isThread()) {
            const threadMessagesCount = targetChannel.messageCount
            logger.debug(`Thread has ${threadMessagesCount} messages.`)
            if ((threadMessagesCount) % PAST_MESSAGES === 0) {
                logger.debug(`Beginning to summarize thread...`)
                const validMessages = await getValidMessages(targetChannel, message);
                const summary = await summarizeMessages(validMessages.reverse(), targetChannel, OPENAI_API_KEY);
                logger.debug(`Summary of the thread:\n${summary}\n\n`);
            }
        }
    });

    client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot) return;

        if (LEGACY_COMMANDS.some(cmd => message.content.startsWith(`>${cmd}`))) {
            const wait = require('util').promisify(setTimeout);
            let reply;
            message.channel.sendTyping().then(async () => {
                reply = await message.reply({content: `This bot is now slash commands only. Please use \`/\` instead of \`>\`.\nDiscord is stupid and forced me at gunpoint to make this change.`, ephemeral: true})
            })
            return await wait(15000).then(async () => {
                await reply.delete()
                await message.delete()
            })
        };

        if ((message.channel.parentId == CHATBOT_CHANNEL || message.channel.id == CHATBOT_CHANNEL) && CHATBOT_ENABLED && !APRIL_FOOLS_MODE) {
            if (message.member.roles.cache.has(banned)) {
                await message.member.createDM().then(async dm => {
                    const isLastMsgBot = dm.lastMessage && dm.lastMessage.author.id == client.user.id;
                    if (isLastMsgBot) {
                        await dm.send(`You are banned from using ${client.user.username}. If you believe this is a mistake, contact <@${OWNER_ID}> or an admin in ${message.guild.name}.`)
                    }
                })
                return
            }
            await handleBotMessage(client, message, OPENAI_API_KEY);
        } else if (APRIL_FOOLS_MODE) { // 1/5 change to respond in any channel on april fools day
            const randomChance = Math.random();
            const isMentioned = message.mentions.has(client.user); 
            if (randomChance < 0.2 || isMentioned) { 
                logger.log(`${message.author.tag} sent a message in #${message.channel.name} in ${message.guild.name}. (April Fools)`);
                await handleBotMessage(client, message, OPENAI_API_KEY); 
            } 
        }
    })
}
