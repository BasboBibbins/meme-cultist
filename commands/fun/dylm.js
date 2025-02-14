const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const Canvas = require('canvas');
const { registerFont, ImageData, loadImage, createCanvas } = require('canvas');
const GIFEncoder = require('gif-encoder');
const { parseGIF, decompressFrames } = require('gifuct-js');
const logger = require('../../utils/logger');
const path = require('path');

async function createDYLM(imageBuffer, bowBuffer, textBuffer, bowX, bowY) {
  const background = await loadImage(imageBuffer);
  const bow = await loadImage(bowBuffer);
  const text = await loadImage(textBuffer);

  const canvas = createCanvas(background.width, background.height);
  const ctx = canvas.getContext('2d');

  const scaleFactor = background.width / 1024; // Base scale factor (1024px width)

  const bowWidth = bow.width * scaleFactor;
  const bowHeight = bow.height * scaleFactor;
  const textWidth = text.width * scaleFactor;
  const textHeight = text.height * scaleFactor;

  ctx.drawImage(background, 0, 0);
  ctx.drawImage(bow, bowX, bowY, bowWidth, bowHeight);
  ctx.drawImage(text, 0, 0, textWidth, textHeight);

  return canvas.toBuffer();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dylm')
    .setDescription(`Make a "Do you like me?" meme.`)
    .addAttachmentOption((option) =>
      option
        .setName('image')
        .setDescription('Use an image for your meme.')
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(`Use a user's avatar for your meme.`)
        .setRequired(false)
    )
    .addNumberOption((option) =>
      option
        .setName('x')
        .setDescription('The x position of the bow. (%) Default: 50')
        .setRequired(false)
    )
    .addNumberOption((option) =>
      option
        .setName('y')
        .setDescription('The y position of the bow. (%) Default: 50')
        .setRequired(false)
    ),
  async execute(interaction) {
    let image = interaction.options.getAttachment('image');
    const user = interaction.options.getUser('user') || interaction.user;

    if (image) {
      if (!image.contentType || !image.contentType.startsWith('image')) {
        return interaction.reply({
          content: 'Please provide a valid image.',
          ephemeral: true,
        });
      }
    } else {
      image = {
        url: user.displayAvatarURL({ extension: 'png', size: 1024 }),
        name: `${user.username}.png`,
        contentType: 'image/png',
      };
    }

    const imageResponse = await fetch(image.url);
    if (!imageResponse.body) {
      return interaction.reply({
        content: 'Unable to download attachment.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    let imageName = image.name
      ? image.name.slice(0, image.name.lastIndexOf('.'))
      : `${new Date().getTime()}`;

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    const background = await loadImage(imageBuffer);
    const bowWidth = background.width / 2.5;
    const bowHeight = background.height / 2.5;
    let bowX = interaction.options.getNumber('x');
    let bowY = interaction.options.getNumber('y');
    if (bowX === null) {
      bowX = background.width / 2 - bowWidth / 2;
    } else {
      bowX = (bowX / 100) * background.width - bowWidth / 2;
    }
    if (bowY === null) {
      bowY = background.height / 2 - bowHeight / 2;
    } else {
      bowY = (bowY / 100) * background.height - bowHeight / 2;
    }
    const bowBuffer = path.join(__dirname, '../../assets/imgs/dylm/bow.png'); 
    const textBuffer = path.join(__dirname, '../../assets/imgs/dylm/text.png');
    const bowImage = await loadImage(bowBuffer);
    const textImage = await loadImage(textBuffer);
    
    const dylmBuffer = await createDYLM(imageBuffer, bowBuffer, textBuffer, bowX, bowY);
    const attachment = new AttachmentBuilder(dylmBuffer, { name: `${imageName}-dylm.png` });

    await interaction.editReply({ files: [attachment] });
    logger.info(`DYLM meme created for ${interaction.user.tag}`);
  },
};