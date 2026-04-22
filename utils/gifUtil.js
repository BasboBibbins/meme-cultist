const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { AttachmentBuilder } = require('discord.js');

/**
 * Encode an array of RGBA frames into a GIF.
 * Quantizes the palette once from the first frame (or a provided source)
 * and reuses it for all frames, making this much faster than per-frame quantization.
 *
 * @param {Array<{data: Uint8ClampedArray, delay: number}>} frames
 *   Each frame: data = RGBA pixel data from ctx.getImageData(), delay = frame duration in ms
 * @param {Object} options
 * @param {number} options.width - Canvas width in pixels
 * @param {number} options.height - Canvas height in pixels
 * @param {number} [options.repeat=0] - 0 = loop forever, -1 = play once
 * @param {number} [options.maxColors=256] - Max palette colors
 * @param {string} [options.filename='animation.gif'] - Output filename
 * @param {Uint8ClampedArray} [options.paletteSource] - Optional RGBA data to quantize palette from
 * @returns {AttachmentBuilder}
 */
function encodeGIF(frames, options = {}) {
    const {
        width,
        height,
        repeat = 0,
        maxColors = 256,
        filename = 'animation.gif',
        paletteSource = null,
    } = options;

    if (frames.length === 0) throw new Error('encodeGIF: no frames provided');

    // Quantize palette once from the palette source or first frame
    const sourceData = paletteSource || frames[0].data;
    const palette = quantize(sourceData, maxColors, { format: 'rgba4444' });

    const gif = GIFEncoder();

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const index = applyPalette(frame.data, palette, 'rgba4444');
        gif.writeFrame(index, width, height, {
            palette,
            delay: frame.delay,
            repeat: i === 0 ? repeat : undefined,
        });
    }

    gif.finish();
    const output = Buffer.from(gif.bytes());
    return new AttachmentBuilder(output, { name: filename });
}

module.exports = { encodeGIF };