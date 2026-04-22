// Load environment variables FIRST before any other imports
const dotenv = require("dotenv")
dotenv.config()

const { REST } = require("@discordjs/rest")
const { Routes } = require("discord-api-types/v9")
const fs = require("fs")
const { Player, GuildQueueEvent, useMainPlayer } = require("discord-player")
const { YoutubeiExtractor } = require('discord-player-youtubei');
const { GatewayIntentBits, Events, Client, Collection, InteractionType } = require("discord.js")
const { initDB, db } = require("./database")
const { GUILD_ID, CLIENT_ID, CHATBOT_ENABLED, CHATBOT_LOCAL, BANNED_ROLE, APRIL_FOOLS_MODE, TESTING_ROLE, TESTING_MODE, OWNER_ID, FACTS_INTERVAL, SUMMARY_INTERVAL, OOC_PREFIX } = require("./config.js")
const { trackStart, trackEnd } = require("./utils/musicPlayer")
const { welcome, goodbye } = require("./utils/welcome")
const { interest } = require("./utils/bank")
const { handleBotMessage, deleteThreadContext, addNewThreadContext, getValidMessages } = require("./utils/openai")
const { describeImage } = require("./utils/gemini")
const { extractFirstUrl, fetchPageText } = require("./utils/urlContext")
const { isChatbotChannel } = require("./utils/channels")
const { initJackpot, addJackpotInterest } = require("./utils/jackpot")
const moment = require("dayjs")
const logger = require("./utils/logger")
const schedule = require("node-schedule")
const rateLimiter = require('./utils/ratelimiter')
const { DefaultExtractors } = require("@discord-player/extractor")
const playdl = require('play-dl');

const TOKEN = process.env.TOKEN
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
if (process.env.COOKIE) {
    playdl.setToken({
        youtube: {
            cookie: process.env.COOKIE
        }
    });
}

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
    await addJackpotInterest()
})

client.slashcommands = new Collection()

client.contextResetPoints = new Map();
client.rouletteGames = new Map();
client.raceGames = new Map();
client.immediateFactsDebounce = new Map();

if (!fs.existsSync(`./db/users.sqlite`)) {
    logger.error(`Database file not found! Please run \`node bot.js dbinit\` to create the database.`)
    process.exit(1)
}

const player = new Player(client, {
    ytdlOptions: {
        filter: "audioonly",
        quality: "highestaudio",
        highWaterMark: 1 << 25,
        opusEncoded: true,
        requestOptions: {
            headers: {
                cookie: process.env.COOKIE
            }
        }
    }
})

process.on("unhandledRejection", (reason, p) => {
    logger.error(`Unhandled Promise Rejection! Reason: ${reason}`);
    console.log(p.stack || p);
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

// Cache music command names at startup so we don't walk the filesystem on every command
const musicCommandNames = walk('./commands/music/').map(file => file.split('/').pop().replace('.js', ''));

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
    client.once(Events.ClientReady, async () => {
        if (LOAD_DB) {
            initDB(client)
        }
        // Initialize progressive jackpot
        await initJackpot();
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
        }
        await player.extractors.loadMulti(DefaultExtractors);
        await player.extractors.register(YoutubeiExtractor, {});
        client.player = player;
        // Pre-warm slot image caches to eliminate cold-start latency on first spin
        try {
            const { warmCaches } = require('./utils/slotsCanvas');
            await warmCaches();
            logger.info('Slot image caches pre-warmed.');
        } catch (err) {
            logger.warn('Failed to pre-warm slot caches, will load on first spin.', { error: err });
        }
        logger.info(`Logged in as \x1b[33m${client.user.tag}\x1b[0m!`);
        if (DEBUG_MODE) {
            logger.info(`DEBUG MODE ENABLED!`);
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
                    const isMusicCommand = (commandName) => musicCommandNames.includes(commandName);
                    if (isMusicCommand(command.data.name)) { // provide player context if music command
                        const data = {
                            guild: interaction.guild
                        };
                        await player.context.provide(data, () => command.execute(interaction));
                    } else {
                        await command.execute(interaction);
                    }

                    logger.info(`${interaction.user.tag} used command \x1b[33m\`${interaction.commandName}\`\x1b[0m in #${interaction.channel.name} in ${interaction.guild.name}.`);
                    if (db) {
                        const userId = interaction.user.id;
                        const cmdName = interaction.commandName;
                        const now = moment();
                        const today = now.format("YYYY-MM-DD");
                        const thisMonth = now.format("YYYY-MM");
                        const thisYear = now.format("YYYY");

                        // Batch reset checks — read all three at once, then write only what changed
                        const [dailyReset, monthlyReset, yearlyReset] = await Promise.all([
                            db.get(`${userId}.stats.commands.dailyReset`),
                            db.get(`${userId}.stats.commands.monthlyReset`),
                            db.get(`${userId}.stats.commands.yearlyReset`),
                        ]);
                        const resetWrites = [];
                        if (dailyReset !== today) {
                            resetWrites.push(
                                db.set(`${userId}.stats.commands.dailyReset`, today),
                                db.set(`${userId}.stats.commands.daily`, {})
                            );
                        }
                        if (monthlyReset !== thisMonth) {
                            resetWrites.push(
                                db.set(`${userId}.stats.commands.monthlyReset`, thisMonth),
                                db.set(`${userId}.stats.commands.monthly`, {})
                            );
                        }
                        if (yearlyReset !== thisYear) {
                            resetWrites.push(
                                db.set(`${userId}.stats.commands.yearlyReset`, thisYear),
                                db.set(`${userId}.stats.commands.yearly`, {})
                            );
                        }
                        await Promise.all(resetWrites);

                        // Batch command usage increments
                        await Promise.all([
                            db.add(`${userId}.stats.commands.daily.${cmdName}`, 1),
                            db.add(`${userId}.stats.commands.monthly.${cmdName}`, 1),
                            db.add(`${userId}.stats.commands.yearly.${cmdName}`, 1),
                            db.add(`${userId}.stats.commands.total.${cmdName}`, 1),
                        ]);

                        // Batch balance/bank largest-value checks
                        const [balance, largestBalance, bank, largestBank] = await Promise.all([
                            db.get(`${userId}.balance`),
                            db.get(`${userId}.stats.largestBalance`),
                            db.get(`${userId}.bank`),
                            db.get(`${userId}.stats.largestBank`),
                        ]);
                        const statWrites = [];
                        if (balance > largestBalance) statWrites.push(db.set(`${userId}.stats.largestBalance`, balance));
                        if (bank > largestBank) statWrites.push(db.set(`${userId}.stats.largestBank`, bank));
                        if (statWrites.length) await Promise.all(statWrites);
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
    // Musicbot events
    player.events.on(GuildQueueEvent.AudioTrackAdd, async (queue, track) => {
        logger.log(`${track.title} added to queue in ${queue.guild.name}!`);
    });
    player.events.on(GuildQueueEvent.AudioTracksAdd, async (queue, tracks) => {
        logger.log(`${tracks.length} tracks added to queue in ${queue.guild.name}!`);
    });
    player.events.on(GuildQueueEvent.PlayerStart, async (queue, track) => {
        logger.log(`Now playing ${track.title} in ${queue.guild.name}!`);
        await trackStart(client, queue, track);
    });
    player.events.on(GuildQueueEvent.PlayerFinish, async (queue, track) => {
        logger.log(`Finished playing ${track.title} in ${queue.guild.name}!`);
        await trackEnd(client, queue, track);
    });
    player.events.on(GuildQueueEvent.Disconnect, async (queue) => {
        logger.warn(`Nobody is in the voice channel, leaving ${queue.guild.name}!`);
        await queue.player.destroy();
    });
    player.events.on(GuildQueueEvent.Error, async (queue, error) => {
        logger.error(`Error in ${queue.guild.name}'s queue! - ${error.message}`);
        logger.error(error.stack);
    });

    // Chatbot events
    client.on(Events.ThreadCreate, async (thread) => {
        logger.info(`Thread "${thread.name}" [${thread.id}] created in ${thread.guild.name}.`);
        if (isChatbotChannel(thread.parentId)) {
            await addNewThreadContext(thread);
        } 
    });

    client.on(Events.ThreadDelete, async (thread) => {
        logger.info(`Thread "${thread.name}" [${thread.id}] deleted in ${thread.guild.name}.`);
        client.contextResetPoints.delete(thread.id);
        if (isChatbotChannel(thread.parentId)) {
            await deleteThreadContext(thread);
        }
    });

    client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot) return;
        if (!CHATBOT_ENABLED) {
            logger.warn(`Chatbot is disabled! Ignoring request...`)
            return;
        }
        if (message.content.startsWith(OOC_PREFIX)) {
            return;
        }
        if (message.member.roles.cache.has(banned)) {
            logger.warn(`User ${message.author.username} is banned from using the bot. Ignoring request...`)
            await message.member.createDM().then(async dm => {
                const isLastMsgBot = dm.lastMessage && dm.lastMessage.author.id == client.user.id;
                if (isLastMsgBot) {
                    await dm.send(`You are banned from using ${client.user.username}. If you believe this is a mistake, contact <@${OWNER_ID}> or an admin in ${message.guild.name}.`)
                }
            })
            return
        }

        const isMentioned = message.mentions.has(client.user, { ignoreEveryone: true, ignoreRoles: true });
        const isChatbotChannelResult = isChatbotChannel(message.channel.id, message.channel.parentId);

        if (!isChatbotChannelResult && !isMentioned) return;

        const { allowed, reason } = rateLimiter.canProceed(client, message.author.id, isMentioned && !isChatbotChannelResult);
        if (!allowed) {
            return message.reply({ content: `⏳ ${reason}`, ephemeral: true });
        }

        let extraContext = null;
        const imageAttachment = message.attachments.find(a => a.contentType?.startsWith("image/"));
        if (imageAttachment) {
            message.channel.sendTyping().catch(() => {});
            const displayName = message.member?.displayName || message.author.username;
            const result = await describeImage(imageAttachment.url, message.content || null);
            if (result?.description) {
                extraContext = `[Image you are currently looking at, shared by ${displayName}]\n${result.description}`;
            } else if (result?.error) {
                extraContext = `[VISION UNAVAILABLE — ${displayName} shared an image but you cannot see it]\nReason: ${result.error}\nTell the user your vision failed and briefly mention why. Do NOT pretend to see the image.`;
            }
        } else {
            const url = extractFirstUrl(message.content);
            if (url) {
                message.channel.sendTyping().catch(() => {});
                const page = await fetchPageText(url);
                if (page?.text) {
                    extraContext = `[Webpage you are currently reading: ${page.url}]\n${page.title ? `Title: ${page.title}\n` : ""}${page.text}`;
                } else if (page?.error) {
                    extraContext = `[LINK UNAVAILABLE — ${page.url} could not be loaded]\nReason: ${page.error}\nTell the user you couldn't open the link and briefly mention why. Do NOT pretend to have read it.`;
                }
            }
        }

        if (isChatbotChannelResult && !APRIL_FOOLS_MODE) {
            await handleBotMessage(client, message, OPENAI_API_KEY, null, null, false, extraContext);
        } else if (isMentioned) {
            await handleBotMessage(client, message, OPENAI_API_KEY, null, null, true, extraContext);
        }
    })

    client.login(TOKEN)
}
