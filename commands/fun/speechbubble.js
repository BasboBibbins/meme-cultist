const { AttachmentBuilder, CommandInteraction, SlashCommandBuilder } = require('discord.js');
const { CanvasRenderingContext2D, createCanvas, ImageData, loadImage } = require('canvas');
const { wrapText } = require('../../utils/Canvas.js');
const GIFEncoder = require('gif-encoder');
const { parseGIF, decompressFrames } = require('gifuct-js');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('speechbubble')
        .setDescription('Totally own someone with a speech bubble img/gif.')
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Use an image for your speech bubble.')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user')
                .setDescription(`Use a user's avatar for your speech bubble.`)
                .setRequired(false))
        .addNumberOption(option =>
            option.setName('x')
                .setDescription('The x position of the speech bubble. (%)')
                .setRequired(false))
        .addNumberOption(option =>
            option.setName('y')
                .setDescription('The y position of the speech bubble. (%)')
                .setRequired(false)),
    async execute(interaction) {
        let image = interaction.options.getAttachment('image')
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

        let xTip = interaction.options.getNumber('x');
        let yTip = interaction.options.getNumber('y');

        const drawSpeechBubble = (ctx, width, height, fillColor) => {
            ctx.save();
            ctx.beginPath();
            const semiMajorAxis = width / 1.9;
            const semiMajorSquared = Math.pow(semiMajorAxis, 2);
            const semiMinorAxis = height / 6;
            const semiMinorSquared = Math.pow(semiMinorAxis, 2);
            ctx.ellipse(width / 2, 0, semiMajorAxis, semiMinorAxis, 0, 0, 2 * Math.PI);
            ctx.moveTo(width / 2, semiMinorAxis-15);
            ctx.lineTo(xTip ? (xTip / 100) * width : semiMajorAxis, yTip ? (yTip / 100) * height : height / 3);
            const xEnd = width / 2.5;
            const yEnd = Math.sqrt(semiMinorSquared - (Math.pow(xEnd, 2) / semiMinorSquared) / semiMajorSquared);
            ctx.lineTo(xEnd, yEnd);
            ctx.clip();
            if (fillColor) {
                ctx.fillStyle = fillColor;
                ctx.fillRect(0, 0, width, height);
            } else {
                ctx.clearRect(0, 0, width, height);
            }
            ctx.restore();
        };

        let attachment = AttachmentBuilder;
        const gif = image.contentType.endsWith('gif');

        if (!gif) {
            const drawableImage = await loadImage(imageBuffer);
            const canvas = createCanvas(drawableImage.width, drawableImage.height);
            const ctx = canvas.getContext('2d');

            ctx.drawImage(drawableImage, 0, 0);
            await drawSpeechBubble(ctx, canvas.width, canvas.height);

            attachment = new AttachmentBuilder(canvas.createPNGStream())
                .setName(`${imageName}-speechbubble.png`);
        } else {
            const gif = parseGIF(imageBuffer);
            const frames = decompressFrames(gif, true);

            const tempCanvas = createCanvas(frames[0].dims.width, frames[0].dims.height);
            const tempCtx = tempCanvas.getContext('2d');
            const gifCanvas = createCanvas(tempCanvas.width, tempCanvas.height);
            const gifCtx = gifCanvas.getContext('2d');

            const encoder = new GIFEncoder(tempCanvas.width, tempCanvas.height);
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
                await drawSpeechBubble(gifCtx, frame.dims.width, frame.dims.height, '#313338'); // #313338 is the default Discord dark mode background color

                encoder.setDelay(frame.delay);
                encoder.addFrame(gifCtx.getImageData(0, 0, gifCanvas.width, gifCanvas.height).data);
            }
            encoder.finish();
            const output = Buffer.concat(buffChunks);

            if (output.length > 8e+6) {
                return interaction.editReply({content: 'The generated GIF is too large to send.', ephemeral: true});
            }

            attachment = new AttachmentBuilder(output)
                .setName(`${imageName}-speechbubble.gif`)
                
        }
        return interaction.editReply({files: [attachment]});
    },
};

