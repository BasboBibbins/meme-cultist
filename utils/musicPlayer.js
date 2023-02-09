const { getQueue, addToQueue, removeFromQueue, clearQueue } = require('./musicQueue');
const ytdl = require('ytdl-core');


module.exports = class MusicPlayer {
    constructor() {
        this.song = null;
        this.queue = new getQueue();
        this.playing = false;
        this.loop = false;
        this.loopQueue = false;
        this.volume = 1;
        this.dispatcher = null;
        this.connection = null;
    }

    async playSong(guildId, song, connection) {
        this.song = song;
        this.connection = connection;
        this.dispatcher = this.connection.play(ytdl(song.url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 }), { volume: this.volume });
        this.dispatcher.on('finish', () => {
            if (this.loop) {
                this.playSong(guildId, song, connection);
            } else {
                this.queue.removeFromQueue(guildId, 0);
                if (this.queue.getQueue(guildId).length > 0) {
                    this.playSong(guildId, this.queue.getQueue(guildId)[0], connection);
                } else {
                    this.playing = false;
                    this.song = null;
                    this.connection.disconnect();
                }
            }
        });
    }
}