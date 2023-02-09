module.exports = class MusicQueue {
    constructor() {
        this.queue = new Map();
    }
    getQueue(guildId) {
        return this.queue.get(guildId);
    }
    addToQueue(guildId, song) {
        const queue = this.queue.get(guildId);
        if (!queue) {
            this.queue.set(guildId, [song]);
        } else {
            queue.push(song);
        }
    }
    removeFromQueue(guildId, index) {
        const queue = this.queue.get(guildId);
        if (!queue) {
            return;
        } else {
            queue.splice(index, 1);
        }
    }
    clearQueue(guildId) {
        this.queue.delete(guildId);
    }
};
    