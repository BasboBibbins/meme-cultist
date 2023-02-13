const {slashCommandBuilder, SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const Booru = require('booru');
const logger = require("../../utils/logger");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("booru")
        .setDescription("Search a booru for images.")
        .addSubcommand((subcommand) =>
            subcommand
                .setName("e6")
                .setDescription("[NSFW] Search e621 for images. (Furry)")
                .addStringOption((option) => option.setName("tags").setDescription("The tags to search for."))
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("hh")
                .setDescription("[NSFW] Search hypnohub for images. (Hypnosis/Mind control)")
                .addStringOption((option) => option.setName("tags").setDescription("The tags to search for."))
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("kc")
                .setDescription("[NSFW] Search konachan for images. (Anime Wallpapers)")
                .addStringOption((option) => option.setName("tags").setDescription("The tags to search for."))
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("kn")
                .setDescription("Search konachan for images for images. (SFW Anime Wallpapers)")
                .addStringOption((option) => option.setName("tags").setDescription("The tags to search for."))
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("gb")
                .setDescription("[NSFW] Search gelbooru for images. (Anime)")
                .addStringOption((option) => option.setName("tags").setDescription("The tags to search for."))
        )        
        .addSubcommand((subcommand) =>
            subcommand
                .setName("r34")
                .setDescription("[NSFW] Search rule34 for images. (Rule 34)")
                .addStringOption((option) => option.setName("tags").setDescription("The tags to search for."))
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("sb")
                .setDescription("Search safebooru for images. (SFW Anime)")
                .addStringOption((option) => option.setName("tags").setDescription("The tags to search for."))
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("xb")
                .setDescription("[NSFW] Search xbooru for images. (Rule34)")
                .addStringOption((option) => option.setName("tags").setDescription("The tags to search for."))
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("rb")
                .setDescription("[NSFW] Search realbooru for images. (Real life)")
                .addStringOption((option) => option.setName("tags").setDescription("The tags to search for."))
        ),

    async execute(interaction) {
        const booru = interaction.options.getSubcommand();
        const isNSFW = ["e6", "hh", "db", "kc", "gb", "r34", "xb", "dp", "rb"].includes(booru);

        if (isNSFW && !interaction.channel.nsfw) return interaction.reply({content: "This command can only be used in NSFW channels.", ephemeral: true});

        const content = interaction.options.getString('tags');
        const defaultTags = isNSFW ? ["rating:explicit"] : ["rating:safe"];

        const tags = content ? content.split(/[\s,]+/i) : defaultTags;

        await Booru.search(booru, tags, {limit: 1, random: true})
            .then(result => {
                if (!result.length) return interaction.reply({content: "No results found for ``"+tags.join(", ")+"``.", ephemeral: true});
                for (let post of result) { 
                    const getFavicon = (url) => {
                        const favicon = url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/img);
                        
                        return favicon ? `https://www.google.com/s2/favicons?domain=${favicon[0]}` : interaction.client.user.displayAvatarURL(); // search google cache for favicon. if none, use the bot's avatar.
                    }
                    logger.log(`${interaction.user.tag} (${interaction.user.id}) searched for \x1b[33m${tags.join(", ")}\x1b[0m on \x1b[33m${post.booru.site.domain}\x1b[0m.`)
                    const embed = new EmbedBuilder()
                        .setColor(0x00AE86)
                        .setAuthor({name: post.booru.site.domain, iconURL: getFavicon(post.booru.site.domain), url: post.fileUrl})
                        .setDescription("```\n"+post.tags.join(", ")+"```")
                        .setImage(post.fileUrl)
                        .setFooter({text: `Score: ${post.score ? post.score : "0"} | ID: #${post.id}`})
                        .setTimestamp();

                    interaction.reply({embeds: [embed]}).then(() => {
                        if (post.fileUrl.endsWith(".webm") || post.fileUrl.endsWith(".mp4")) {
                            if (post.fileSize > 100000000) return interaction.followUp({content: `The file is too large to be sent. You can view it here: ${post.fileUrl}`});
                            interaction.followUp({files: [{attachment: post.fileUrl, name: `${post.booru.site.domain}_${post.id}.${post.fileUrl.split(".").pop()}`}]})
                        }
                    });
                }

            })
            .catch(err => {
                logger.log(err);
                interaction.reply({content: "An error occurred while searching for images.", ephemeral: true});
            }
        );
    }
};
