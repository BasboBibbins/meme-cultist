const {SlashCommandBuilder, AttachmentBuilder} = require('discord.js');
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

        const drawCaption = async (image, text, width, height, fontSize) => {
            // black text on white background above the image
            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

            const lines = await wrapText(ctx, text, (canvas.width - 20));
            const textHeight = (lines.length * (fontSize * 1.5));
            const tempCanvas = createCanvas(canvas.width, canvas.height + textHeight);
            const tempCtx = tempCanvas.getContext('2d');

            tempCtx.fillStyle = 'white';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            tempCtx.drawImage(canvas, 0, textHeight, canvas.width, canvas.height);
            tempCtx.fillStyle = 'black';
            tempCtx.font = `${fontSize}px FuturaCondensedExtraBold`;
            tempCtx.textAlign = 'center';
            tempCtx.textBaseline = 'top';
            for (let i = 0; i < lines.length; i++) {
                tempCtx.fillText(lines[i], tempCanvas.width / 2, 10 + i * fontSize);
            }
            return tempCtx;
        }

        let attachment = AttachmentBuilder;
        const gif = image.contentType.endsWith('gif');

        if (!gif) {
            const drawableImage = await loadImage(imageBuffer);
            const ctx = await drawCaption(drawableImage, text, drawableImage.width, drawableImage.height, drawableImage.width / 10);
            const canvas = ctx.canvas;

            attachment = new AttachmentBuilder(canvas.createPNGStream())
                .setName(`${imageName}-caption.png`);
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
                const drawableImage = await loadImage(tempCanvas.toBuffer());
                const ctx = await drawCaption(drawableImage, text, drawableImage.width, drawableImage.height, drawableImage.width / 10);
                

                encoder.setDelay(frame.delay);
                encoder.addFrame(gifCtx.getImageData(0, 0, gifCanvas.width, gifCanvas.height).data);
            }
            encoder.finish();
            const output = Buffer.concat(buffChunks);

            if (output.length > 8e+6) {
                return interaction.editReply({content: 'The generated GIF is too large to send.', ephemeral: true});
            }

            attachment = new AttachmentBuilder(output)
                .setName(`${imageName}-caption.gif`)
                
        }
        return interaction.editReply({files: [attachment]});
    }
}