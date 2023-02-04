const {SlashCommandBuilder} = require('discord.js');
const Canvas = require('canvas');
const {registerFont} = require('canvas');
const { wrapText } = require('../../utils/Canvas.js');
const request = require('node-superfetch');
const path = require('path');
registerFont(path.join(__dirname, '..', '..', 'assets', 'fonts', 'Impact.ttf'), {family: 'Impact'});

module.exports = {
    data: new SlashCommandBuilder()
        .setName("memegen")
        .setDescription("Generate a meme from a template.")
        .addStringOption(option =>
            option.setName('top')
                .setDescription('The top text.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('bottom')
                .setDescription('The bottom text.')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Use an image for your meme.')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user')
                .setDescription(`Use a user's avatar for your meme.`)
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();
        if (interaction.options.getAttachment('image') && interaction.options.getUser('user')) return interaction.editReply({content: "You can't use an image and a user at the same time!", ephemeral: false});
        
        const top = interaction.options.getString('top').toUpperCase();
        const bottom = interaction.options.getString('bottom').toUpperCase();
        const image = interaction.options.getAttachment('image');
        const user = interaction.options.getUser('user') ? interaction.options.getUser('user') : interaction.user;

        if (image && !image.name.endsWith('.png') && !image.name.endsWith('.jpg') && !image.name.endsWith('.jpeg')) return interaction.editReply({content: "The image must be a png, jpg, or jpeg!", ephemeral: false});

        const { body } = await request.get(image ? image.url : user.displayAvatarURL({extension: 'png', size: 1024}));

        
        const base = await Canvas.loadImage(body);
        const canvas = Canvas.createCanvas(base.width, base.height);
        const ctx = canvas.getContext('2d');

        console.log(`\x1b[32m[INFO]\x1b[0m Generating meme for ${interaction.user.tag} with ${image ? image.name : user.username}.png`)
        ctx.drawImage(base, 0, 0);
        
        const fontsize = Math.round(base.height/10);

        ctx.font = `${fontsize}px Impact`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';

        ctx.textBaseline = 'top';
        const topLines = await wrapText(ctx, top, base.width-10);
        if (!topLines) return interaction.editReply({content: "The top text is too long!", ephemeral: false});
        for (let i = 0; i < topLines.length; i++) {
            const textHeight = (i * fontsize) + (i * 10);
            ctx.strokeStyle = 'black';
            ctx.lineWidth = Math.round(fontsize/10);
            ctx.lineJoin = 'round';
            ctx.strokeText(topLines[i], base.width/2, textHeight);
            ctx.fillStyle = 'white';
            ctx.fillText(topLines[i], base.width/2, textHeight);
        }

        const bottomLines = await wrapText(ctx, bottom, base.width-10);
        if (!bottomLines) return interaction.editReply({content: "The bottom text is too long!", ephemeral: false});
        ctx.textBaseline = 'bottom';
        const inital = base.height - ((bottomLines.length - 1) * fontsize) - ((bottomLines.length - 1) * 10);
        for (let i = 0; i < bottomLines.length; i++) {
            const textHeight = inital + (i * fontsize) + (i * 10);
            ctx.strokeStyle = 'black';
            ctx.lineWidth = Math.round(fontsize/10);
            ctx.lineJoin = 'round';
            ctx.strokeText(bottomLines[i], base.width/2, textHeight);
            ctx.fillStyle = 'white';
            ctx.fillText(bottomLines[i], base.width/2, textHeight);
        }

        const attachment = canvas.toBuffer('image/png');
        if (Buffer.byteLength(attachment) > 8e+6) return interaction.editReply({content: "Resulting image was above 8MB.", ephemeral: false});
        await interaction.editReply({files: [{attachment: attachment, name: `memegen_${image ? image.name : user.username}.png`}]});
    },
};
