// Playback actions shared by the now-playing panel buttons and the slash commands, so the two surfaces cannot drift apart.

const { QueueRepeatMode } = require("discord-player");
const logger = require("./logger");

// Loop intent is tracked separately from queue.repeatMode because skipping has to drop the queue out of TRACK repeat to advance at all.
const loopIntent = new Map();

function guildIdOf(queue) {
  return queue?.guild?.id ?? null;
}

function isLooping(queue) {
  const id = guildIdOf(queue);
  return id ? loopIntent.get(id) === true : false;
}

function setLooping(queue, on) {
  const id = guildIdOf(queue);
  if (id) loopIntent.set(id, !!on);
  queue?.setRepeatMode?.(on ? QueueRepeatMode.TRACK : QueueRepeatMode.OFF);
  logger.debug(`[MusicControls] Loop ${on ? "enabled" : "disabled"} for guild ${id}`);
  return !!on;
}

function toggleLoop(queue) {
  return setLooping(queue, !isLooping(queue));
}

function clearLoop(queue) {
  const id = guildIdOf(queue);
  if (id) loopIntent.delete(id);
  queue?.setRepeatMode?.(QueueRepeatMode.OFF);
}

// Reapplies loop intent to a queue that has just started a track; skipTrack deliberately leaves repeat off so the transition can happen.
function restoreLoop(queue) {
  if (!isLooping(queue)) return false;
  if (queue?.repeatMode !== QueueRepeatMode.TRACK) queue?.setRepeatMode?.(QueueRepeatMode.TRACK);
  return true;
}

async function setPaused(queue, paused) {
  if (paused) await queue.node.pause();
  else await queue.node.resume();
  return queue.node.isPaused();
}

async function togglePause(queue) {
  return setPaused(queue, !queue.node.isPaused());
}

// skip() ends the track through the same path that honours TRACK repeat, so repeat must come off first or the song restarts; the intent is kept and restoreLoop puts it back.
async function skipTrack(queue) {
  if (queue.node.isPaused()) await queue.node.resume();
  if (queue.repeatMode === QueueRepeatMode.TRACK) queue.setRepeatMode(QueueRepeatMode.OFF);
  return queue.node.skip();
}

// Stopping abandons the queue, so a stale loop must not survive into the next /play.
async function stopPlayback(queue) {
  clearLoop(queue);
  return queue.node.stop();
}

module.exports = {
  isLooping, setLooping, toggleLoop, clearLoop, restoreLoop,
  setPaused, togglePause, skipTrack, stopPlayback,
};
