const logger = require('./logger');

module.exports = class CanvasUtil {
	static wrapText(ctx, text, maxWidth) {
		return new Promise(resolve => {
			if (ctx.measureText(text).width < maxWidth) return resolve([text]);
			if (ctx.measureText('W').width > maxWidth) {
				logger.error(`wrapText: The maxWidth is too small for the text to be split!`);
				return resolve(null);
			}
			logger.debug(`Text: ${text}, maxWidth: ${maxWidth}, measureText: ${ctx.measureText(text).width}`);
			const words = text.split(' ');
			const lines = [];
			let line = '';
			while (words.length > 0) {
				let split = false;
				while (ctx.measureText(words[0]).width >= maxWidth) {
					const temp = words[0];
					words[0] = temp.slice(0, -1);
					if (split) {
						words[1] = `${temp.slice(-1)}${words[1]}`;
					} else {
						split = true;
						words.splice(1, 0, temp.slice(-1));
					}
				}
				if (ctx.measureText(`${line}${words[0]}`).width < maxWidth) {
					line += `${words.shift()} `;
				} else {
					lines.push(line.trim());
					line = '';
				}
				if (words.length === 0) lines.push(line.trim());
			}
			logger.debug(`Lines: ${lines}`);
			return resolve(lines);
		});
	}

	static calculateSpriteBounds(ctx, symbol, targetSize) {
		const { index } = symbol;
		const sWidth = 64;
		const sHeight = 64;
		const sx = index * sWidth;
		const sy = 0;
		const drawSize = targetSize * 0.7;

		// Calculate destination size maintaining aspect ratio
		const aspect = sWidth / sHeight;
		let dWidth, dHeight;

		if (aspect >= 1) {
			dWidth = drawSize;
			dHeight = drawSize / aspect;
		} else {
			dHeight = drawSize;
			dWidth = drawSize * aspect;
		}

		return {
			sx, sy, sWidth, sHeight,
			dWidth, dHeight
		};
	}

	
};