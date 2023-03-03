const {SlashCommandBuilder, AttachmentBuilder} = require('discord.js');
const Canvas = require('canvas');
const { registerFont, ImageData, loadImage, createCanvas } = require('canvas');
const { wrapText } = require('../../utils/Canvas.js');
const GIFEncoder = require('gif-encoder');
const { parseGIF, decompressFrames } = require('gifuct-js');
const request = require('node-superfetch');
const path = require('path');
const logger = require('../../utils/logger');
registerFont(path.join(__dirname, '..', '..', 'assets', 'fonts', 'Impact.ttf'), {family: 'Impact'});
const wait = require('util').promisify(setTimeout);

module.exports = {
    data: new SlashCommandBuilder()
        .setName("memegen")
        .setDescription("Generate a meme from a template.")
        .addStringOption(option =>
            option.setName('top')
                .setDescription('The top text.')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('bottom')
                .setDescription('The bottom text.')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Use an image for your meme.')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user')
                .setDescription(`Use a user's avatar for your meme.`)
                .setRequired(false)),

    async execute(interaction) {
        let image = interaction.options.getAttachment('image')
        const user = interaction.options.getUser('user') || interaction.user;

        if (image) {
            if (!image.contentType || !image.contentType.startsWith('image')) {
                return interaction.reply({content: 'Please provide a valid image.', ephemeral: true});
            }
        } else {
            // create an attachment from the user's avatar
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

        let topText = interaction.options.getString('top');
        let bottomText = interaction.options.getString('bottom');

        const drawMemeGenText = async (type, ctx, text, x, y, maxWidth, fontSize, fontColor) => {
            ctx.font = `${fontSize}px Impact`;
            ctx.fillStyle = fontColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const lines = await wrapText(ctx, text, maxWidth);
            if (lines) {
                for (let i = 0; i < lines.length; i++) {
                    logger.debug(`Drawing text: ${lines[i]}`);
                    let textHeight = y;
                    if (type === "top") {
                        textHeight = (i * fontSize) + (i * 10);
                    } else if (type === "bottom") {
                        textHeight = (ctx.canvas.height - (lines.length * fontSize) - ((lines.length - 1) * 10)) + (i * fontSize) + (i * 10) - 10;
                    }
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = Math.round(fontSize/10);
                    ctx.lineJoin = 'round';
                    ctx.strokeText(lines[i], x, textHeight);
                    ctx.fillStyle = fontColor;
                    ctx.fillText(lines[i], x, textHeight);
                }
            }
        };

        const drawMemeGen = async (ctx) => {
            const canvas = ctx.canvas;
            const fontSize = Math.round(canvas.width / 10)
            const fontColor = '#ffffff';
            const maxWidth = canvas.width - 20;
            const x = canvas.width / 2;
            const y = 10;
            if (topText) {
                await drawMemeGenText("top", ctx, topText.toUpperCase(), x, y, maxWidth, fontSize, fontColor);
            }

            if (bottomText) {
                await drawMemeGenText("bottom", ctx, bottomText.toUpperCase(), x, (canvas.height - fontSize) - y, maxWidth, fontSize, fontColor);
            }
        };

        let attachment = AttachmentBuilder;
        const gif = image.contentType.endsWith('gif');

        if (!gif) {
            const drawableImage = await loadImage(imageBuffer);
            const canvas = createCanvas(drawableImage.width, drawableImage.height);
            const ctx = canvas.getContext('2d');

            ctx.drawImage(drawableImage, 0, 0);
            await drawMemeGen(ctx);

            attachment = new AttachmentBuilder(canvas.createPNGStream())
                .setName(`${imageName}.png`);
        } else {
            const gif = parseGIF(imageBuffer);
            const frames = decompressFrames(gif, true);

            const tempCanvas = Canvas.createCanvas(frames[0].dims.width, frames[0].dims.height);
            const tempCtx = tempCanvas.getContext('2d');
            const gifCanvas = Canvas.createCanvas(tempCanvas.width, tempCanvas.height);
            const gifCtx = gifCanvas.getContext('2d');

            const encoder = new GIFEncoder(tempCanvas.width, tempCanvas.height);
            encoder.setDelay(gif.frames[0].delay);
            encoder.setRepeat(0);
            encoder.setDispose(1);
            encoder.writeHeader();

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
                gifCtx.drawImage(tempCanvas, frame.dims.left, frame.dims.top);
                await drawMemeGen(gifCtx, topText, bottomText);

                encoder.setDelay(frame.delay);
                encoder.addFrame(gifCtx.getImageData(0, 0, gifCanvas.width, gifCanvas.height).data);
            }
            encoder.finish();
            const output = Buffer.concat(buffChunks);

            if (output.length > 8e+6) {
                return interaction.editReply({content: 'The generated GIF is too large to send.', ephemeral: true});
            }

            attachment = new AttachmentBuilder(output)
                .setName(`${imageName}.gif`)
                
        }
        return interaction.editReply({files: [attachment]});
    },
};
