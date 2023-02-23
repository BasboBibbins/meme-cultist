const dotenv = require("dotenv")
const { REST } = require("@discordjs/rest")
const { Routes } = require("discord-api-types/v9")
const fs = require("fs")
const { Player } = require("discord-player")
const { GatewayIntentBits, Events, Client, Collection } = require("discord.js")
const { OpenAIApi, Configuration } = require("openai")
const { QuickDB } = require("quick.db")
const { initDB, addNewDBUser } = require("./database")
const { GUILD_ID, CLIENT_ID, BOT_CHANNEL, PAST_MESSAGES, BANNED_ROLE, DEFAULT_ROLE, TESTING_MODE, TESTING_ROLE, OWNER_ID, LEGACY_COMMANDS } = require("./config.json")
const { trackStart, trackEnd } = require("./utils/musicPlayer")
const { welcome, goodbye } = require("./utils/welcome")
const { interest } = require("./utils/bank")
const moment = require("dayjs")
const logger = require("./utils/logger")
const schedule = require("node-schedule")

dotenv.config()
const TOKEN = process.env.TOKEN

const LOAD_SLASH = process.argv[2] == "load"
const LOAD_DB = process.argv[2] == "dbinit"

const banned = BANNED_ROLE;

const config = new Configuration({
    apiKey: process.env.OPENAI_KEY
})

const openai = new OpenAIApi(config)

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
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
if (fs.existsSync("./db/users.sqlite")) {
    db = new QuickDB({ filePath: "./db/users.sqlite" })
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

if (LOAD_SLASH) {
    const rest = new REST({ version: "9" }).setToken(TOKEN)
    logger.info(`Loading slash commands...`)
    rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {body: commands})
    .then(() => {
        logger.info(`Successfully reloaded application (/) commands.`)
        process.exit(0)
    })
    .catch((err) => {
        if (err){
            logger.error(err)
            process.exit(1)
        }
    })
}
else {
    client.once(Events.ClientReady, () => {
        if (LOAD_DB) {
            initDB(client)
        }
        logger.info(`Logged in as \x1b[33m${client.user.tag}\x1b[0m!`);
    })

    if (TESTING_MODE) client.on(Events.Debug, (info) => logger.debug(info));
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
                await dm.send(`You are banned from using Meme Cultist. If you believe this is a mistake, contact <@${OWNER_ID}> or an admin in ${interaction.guild.name}.`)
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
                    await interaction.reply({content: `The new Meme Cultist is currently in beta! Contact <@${OWNER_ID}> for access!`, ephemeral: true})
                    return
                }

                if (interaction.member.roles.cache.has(banned)){
                    await interaction.reply({content: "You turned against me. I will not answer to you.", ephemeral: true})
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

    client.login(TOKEN)

    client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot) return;

        if (LEGACY_COMMANDS.some(cmd => message.content.startsWith(`>${cmd}`))) {
            message.channel.sendTyping().then(() => {message.channel.send("This bot is now slash commands only. Please use ``/`` instead of ``>``.\nDiscord is gay and forced me at gunpoint to make this change.")}).finally(() => {message.delete()})
        };
    })
}