const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const Canvas = require('canvas');
const { registerFont, ImageData, loadImage, createCanvas } = require('canvas');
const { wrapText } = require('../../utils/Canvas.js');
const GIFEncoder = require('gif-encoder');
const { parseGIF, decompressFrames } = require('gifuct-js');
const logger = require('../../utils/logger');
const path = require('path');
registerFont(path.join(__dirname, '..', '..', 'assets', 'fonts', 'FuturaCondensedExtraBold.ttf'), {family: 'FuturaCondensedExtraBold'});


module.exports = {
    data: new SlashCommandBuilder()
        .setName("caption")
        .setDescription("Caption an image.")
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The text to caption.')
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
        let image = interaction.options.getAttachment('image');
        const user = interaction.options.getUser('user') || interaction.user;

        if (image) {
            if (!image.contentType || !image.contentType.startsWith('image')) {
                return interaction.reply({content: 'Please provide a valid image.', ephemeral: true});
            }
        } else {
            image = {
                url: user.displayAvatarURL({extension: 'png', size: 1024}),
                name: `${user.username}.png`,
                contentType: 'image/png'
            }
        }

        const imageResponse = await fetch(image.url);
        if (!imageResponse.body) {
            return interaction.reply({content: 'Unable to download attachment.', ephemeral: true});
        }

        await interaction.deferReply();

        let imageName = image.name ? image.name.slice(0, image.name.lastIndexOf('.')) : `${new Date().getTime()}`;

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

        let text = interaction.options.getString('text');

        const getLines = async (text, fontSize, maxWidth) => {
            const tempCanvas = createCanvas(1, 1);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.font = `${fontSize}px FuturaCondensedExtraBold`;
            return await wrapText(tempCtx, text, maxWidth);
        }

        const getTextHeight = async (width) => {
            const fontSize = Math.floor(width / 10);
            const lines = await getLines(text, fontSize, width * 0.9);
            return Math.floor((lines.length * fontSize) + ((lines.length) * 10) + (fontSize / 2));
        }

        const drawCaption = async (ctx) => {
            const fontSize = Math.floor(ctx.canvas.width / 10);
            const lines = await getLines(text, fontSize, ctx.canvas.width * 0.9);
            const textHeight = await getTextHeight(ctx.canvas.width);

            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, ctx.canvas.width, textHeight);
            ctx.fillStyle = '#000001' // to prevent transparency
            ctx.font = `${fontSize}px FuturaCondensedExtraBold`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], ctx.canvas.width / 2, (fontSize * 0.75) + (i * fontSize) + (i * 10));
            }
        }

        let attachment = AttachmentBuilder;
        const gif = image.contentType.endsWith('gif');

        if (!gif) {
            const drawableImage = await loadImage(imageBuffer);
            const textHeight = await getTextHeight(drawableImage.width);
            const canvas = Canvas.createCanvas(drawableImage.width, drawableImage.height + textHeight);
            const ctx = canvas.getContext('2d');

            await drawCaption(ctx).then(() => {
                ctx.drawImage(drawableImage, 0, textHeight);
            });

            attachment = new AttachmentBuilder(canvas.createPNGStream())
                .setName(`${imageName}_caption.png`)
        } else {
            const gif = parseGIF(imageBuffer);
            const frames = decompressFrames(gif, true);

            const textHeight = await getTextHeight(frames[0].dims.width);
            const tempCanvas = Canvas.createCanvas(frames[0].dims.width, frames[0].dims.height + textHeight);
            const tempCtx = tempCanvas.getContext('2d');
            const gifCanvas = Canvas.createCanvas(tempCanvas.width, tempCanvas.height);
            const gifCtx = gifCanvas.getContext('2d');

            const encoder = new GIFEncoder(tempCanvas.width, tempCanvas.height);
            encoder.setDelay(gif.frames[0].delay);
            encoder.setRepeat(0);
            encoder.writeHeader();
            encoder.setDispose(2);
            encoder.setTransparent();

            const buffChunks = [];
            encoder.on('data', chunk => buffChunks.push(chunk));
            
            let frameData = undefined;
            for (const frame of frames) {
                if (!frameData || frame.dims.width !== tempCanvas.width || frame.dims.height !== tempCanvas.height) {
                    tempCanvas.width = frame.dims.width;
                    tempCanvas.height = frame.dims.height;
                    frameData = tempCtx.createImageData(frame.dims.width, frame.dims.height);
                }
                frameData.data.set(frame.patch);
                tempCtx.putImageData(frameData, 0, 0);
                gifCtx.clearRect(0, textHeight, gifCanvas.width, gifCanvas.height - textHeight)
                gifCtx.drawImage(tempCanvas, frame.dims.left, frame.dims.top + textHeight);

                await drawCaption(gifCtx);
                
                encoder.setDelay(frame.delay);
                encoder.addFrame(gifCtx.getImageData(0, 0, gifCanvas.width, gifCanvas.height).data);
            }
            encoder.finish();
            const output = Buffer.concat(buffChunks);

            if (output.length > 8e+6) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('The resulting GIF is too large to send.')
                    .setColor(0xff0000)
                    .setFooter({text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
                    .setTimestamp();
                return interaction.editReply({embeds: [embed]});

            }

            attachment = new AttachmentBuilder(output)
                .setName(`${imageName}-caption.gif`)
                
        }
        return interaction.editReply({files: [attachment]});
    }
}