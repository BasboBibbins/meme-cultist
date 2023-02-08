const dotenv = require("dotenv")
const { REST } = require("@discordjs/rest")
const { Routes } = require("discord-api-types/v9")
const fs = require("fs")
const { Player } = require("discord-player")
const { GatewayIntentBits, Events, Client, Collection } = require("discord.js")
const { OpenAIApi, Configuration } = require("openai")
const { QuickDB } = require("quick.db")
const { initDB, addNewDBUser } = require("./database")
const { GUILD_ID, CLIENT_ID, BOT_CHANNEL, PAST_MESSAGES, BANNED_ROLE, DEFAULT_ROLE, TESTING_MODE, TESTING_ROLE, OWNER_ID } = require("./config.json")

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

client.slashcommands = new Collection()
client.player = new Player(client, {
    ytdlOptions: {
        quality: "highestaudio",
        highWaterMark: 1 << 25
    }
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
    console.log("Deploying slash commands")
    rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {body: commands})
    .then(() => {
        console.log("Successfully loaded")
        process.exit(0)
    })
    .catch((err) => {
        if (err){
            console.log(err)
            process.exit(1)
        }
    })
}
else {
    client.once(Events.ClientReady, () => {
        if (LOAD_DB) {
            initDB(client)
        }
        console.log(`\x1b[32m%s\x1b[0m`, `Logged in as ${client.user.tag}!`)
    })

    client.on(Events.GuildMemberAdd, async member => {
        var role = member.guild.roles.cache.find(role => role.name === DEFAULT_ROLE);
        if (!role) return;
        member.roles.add(role)
        const channel = member.guild.channels.cache.find(ch => ch.name === 'welcome');
        if (!channel) return;
        channel.send(`**Welcome to the Meme Cult ${member} Now get out of my discord fucking normie.**`);
        addNewDBUser(member);
    })

    client.on(Events.InteractionCreate, async interaction => {
        if (interaction.isChatInputCommand()) {
            interaction.channel.sendTyping().then(async () => {
                
                const command = interaction.client.slashcommands.get(interaction.commandName);
            
                if (!command) {
                    console.error(`No command matching ${interaction.commandName} was found.`);
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
                    console.log(`\x1b[32m[INFO]\x1b[0m ${interaction.user.tag} used command \x1b[33m\`${interaction.commandName}\`\x1b[0m in #${interaction.channel.name} in ${interaction.guild.name}.`);
                    await command.execute(interaction);
                } catch (error) {
                    console.error(error);
                    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                }
            })
        } else if (interaction.isAutocomplete()) {
            const command = interaction.client.slashcommands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                console.error(error);
            }
        }
    });

    client.login(TOKEN)

    client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot) return

        if (message.content.startsWith(">")) {
            //message.channel.sendTyping().then(() => {message.channel.send("This bot is now slash commands only. Please use ``/`` instead of ``>``. Discord is gay and forced me at gunpoint to make this change.")})
        };

        if (message.channel.id == BOT_CHANNEL){
            message.channel.sendTyping().then(async () => {
                let messages = Array.from(await message.channel.messages.fetch({
                    limit: PAST_MESSAGES,
                    before: message.id
                }))
                messages = messages.map(m=>m[1])
                messages.unshift(message)
                
                let users = [...new Set([...messages.map(m=>{m.author.username}), client.user.username])] 
        
                let lastUser = users.pop()
            
                let prompt = `The following is a conversation between ${users.join(", ")}, and ${lastUser}.\n\n`
            
                for (let i = messages.length - 1; i >= 0; i--) {
                    const m = messages[i]
                    prompt += `${m.author.username}: ${m.content}\n`
                }
                prompt += `${client.user.username}:`
                console.log("prompt:", prompt)
            
                const response = await openai.createCompletion({
                    prompt,
                    model: "text-davinci-003",
                    max_tokens: 500
                })
            
                console.log("response", response.data.choices[0].text)
                await message.channel.send(response.data.choices[0].text)
            }
        )}
    })
}