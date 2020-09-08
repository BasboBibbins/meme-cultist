const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');
const Youtube = require('simple-youtube-api');
const ytdl = require('ytdl-core');
const { youtubeAPI, autoleave } = require('../../config.json');
const { version } = require('../../package.json');
const youtube = new Youtube(youtubeAPI);

module.exports = class PlayCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'play',
      aliases: ['play-song', 'add'],
      memberName: 'play',
      group: 'music',
      description: 'Play a song or playlist from youtube.',
      guildOnly: true,
      clientPermissions: ['SPEAK', 'CONNECT'],
      throttling: {
        usages: 2,
        duration: 5
      },
      args: [
        {
          key: 'query',
          prompt: 'Pick a song or playlist from YouTube for me to play.',
          type: 'string',
          validate: query => query.length > 0 && query.length < 200
        }
      ]
    });
}

async run(message, {query}) {
  var voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.say("How am I supposed to play music when you're not in a channel? :thinking:");
  if (message.guild.ttsData.isTTSRunning == true)
    return message.say('Please try after the sound has stopped playing.');
  if (
    query.match(
      /^(?!.*\?.*\bv=)https:\/\/www\.youtube\.com\/.*\?.*\blist=.*$/
    )
  ) {
    try {
      const playlist = await youtube.getPlaylist(query);
      const videosObj = await playlist.getVideos();
      for (let i=0; i < videosObj.length; i++) {
        const video = await videosObj[i].fetch();

        const url = 'https://www.youtube.com/watch?v='+video.raw.id;
        const title = video.raw.snippet.title;
        let duration = this.formatDuration(video.duration);
        const thumbnail = video.thumbnails.high.url;
        if (duration == '00:00') duration = 'Live Stream';
        const song = {
          url,
          title,
          duration,
          thumbnail,
          voiceChannel
        };
        message.guild.musicData.queue.push(song);
      }
      if (message.guild.musicData.isPlaying == false) {
        message.guld.musicData.isPlaying = true;
        return this.playSong(message.guild.musicData.queue, message);
      } else if (message.guild.musicData.isPlaying == true) {
        return message.say(playlist.title+' has been added to the queue.');
      }
    } catch (err) {
      console.error(err);
      return message.say('Playlist is either private or it does not exist.')
    }
  }

  if (query.match(/^(http(s)?:\/\/)?((w){3}.)?youtu(be|.be)?(\.com)?\/.+/)) {
    const url = query;
    try {
      query = query
        .replace(/(>|<)/gi, '')
        .split(/(vi\/|v=|\/v\/|youtu\.be\/|\/embed\/)/);
      const id = query[2].split(/[^0-9a-z_\-]/i)[0];
      const video = await youtube.getVideoByID(id);
      const title = video.title;
      let duration = this.formatDuration(video.duration);
      const thumbnail = video.thumbnails.high.url;
      if (duration == '00:00') duration = 'Live Stream';
      const song = {
        url,
        title,
        duration,
        thumbnail,
        voiceChannel
      };
      message.guild.musicData.queue.push(song);
      if (message.guild.musicData.isPlaying == false || typeof message.guild.musicData.isPlaying == 'undefined') {
        message.guild.musicData.isPlaying = true;
        return this.playSong(message.guild.musicData.queue, message);
      } else if (message.guild.musicData.isPlaying == true) {
        return message.say(song.title+' has been added to the queue.');
      }
    } catch (err) {
      console.error(err);
      return message.say('Shit broke. Contact my owner.');
    }
  }
  try {
    const videos = await youtube.searchVideos(query, 5);
    if (videos.length < 5) {
      return message.say("I had trouble finding that video, be more specific; I'm meticulous but slower than most.");
    }
    const vidNameArr = [];
    for (let i=0; i < videos.length; i++) {
      vidNameArr.push((i+1)+': '+videos[i].title);
    }
    vidNameArr.push('exit');
    const embed = new MessageEmbed()
      .setColor('#e9f931')
      .setTitle('Choose a song between 1 and 5')
      .addField('Song 1', vidNameArr[0])
      .addField('Song 2', vidNameArr[1])
      .addField('Song 3', vidNameArr[2])
      .addField('Song 4', vidNameArr[3])
      .addField('Song 5', vidNameArr[4])
      .setFooter(`Meme Cultist | Ver. ${version}`, 'https://i.imgur.com/fbZ9H1I.jpg')
    var songEmbed = await message.say({ embed });
    try {
      var response = await message.channel.awaitMessages(
        msg => (msg.content > 0 && msg.content < 6) || msg.content === 'exit',
        {
          max: 1,
          maxProcessed: 1,
          time: 60000,
          errors: ['time']
        }
      );
      var videoIndex = parseInt(response.first().content);
    } catch (err) {
      console.error(err);
      if (songEmbed) {
        songEmbed.delete();
      }
      return message.say(
        'Enter a number between 1 and 5 or exit, dumbo.'
      );
    }
    if (response.first().content === 'exit') return songEmbed.delete();
    try {
      var video = await youtube.getVideoByID(videos[videoIndex - 1].id);
    } catch (err) {
      console.error(err);
      if (songEmbed) {
        songEmbed.delete();
      }
      return message.say(
        'An error has occured. Did you spell something wrong?'
      );
    }
    const url = `https://www.youtube.com/watch?v=${video.raw.id}`;
    const title = video.title;
    let duration = this.formatDuration(video.duration);
    const thumbnail = video.thumbnails.high.url;
    if (duration == '00:00') duration = 'Live Stream';
    const song = {
      url,
      title,
      duration,
      thumbnail,
      voiceChannel
    };
    message.guild.musicData.queue.push(song);
    if (message.guild.musicData.isPlaying == false) {
      message.guild.musicData.isPlaying = true;
      if (songEmbed) {
        songEmbed.delete();
      }
      this.playSong(message.guild.musicData.queue, message);
    } else if (message.guild.musicData.isPlaying == true) {
      if (songEmbed) {
        songEmbed.delete();
      }
      return message.say(`${song.title} added to queue`);
    }
  } catch (err) {
    console.error(err);
    if (songEmbed) {
      songEmbed.delete();
    }
    return message.say(
      'Shit broke. Contact the owner.'
    );
  }
}

playSong(queue, message) {
  queue[0].voiceChannel
    .join()
    .then(connection => {
      const dispatcher = connection.play(ytdl(queue[0].url, {
      	filter: 'audioonly',
      	highWaterMark: 1 << 25,
      	quality: 'highestaudio',
      })).on('start', () => {
          message.guild.musicData.songDispatcher = dispatcher;
          const videoEmbed = new MessageEmbed()
            .setThumbnail(queue[0].thumbnail)
            .setColor('#FF0000')
            .addField('Now Playing:', '<:youtube:417745828439130123> '+queue[0].title)
            .addField('Duration:', queue[0].duration)
            .setFooter(`Meme Cultist | Ver. ${version}`, 'https://i.imgur.com/fbZ9H1I.jpg')
          if (queue[1]) videoEmbed.addField('Next Song:', queue[1].title);
          message.say(videoEmbed);
          message.guild.musicData.nowPlaying = queue[0];
          return queue.shift();
        })
        .on('finish', () => {
          if (queue.length >= 1) {
            return this.playSong(queue, message);
          } else {
            message.guild.musicData.isPlaying = false;
            message.guild.musicData.nowPlaying = null;

            if (autoleave) {return message.guild.me.voice.channel.leave()};
          }
        })
        .on('error', e => {
          message.say('Cannot play song');
          console.error(e);
          if (autoleave) {return message.guild.me.voice.channel.leave()};
        });
    })
    .catch(e => {
      console.error(e);
      if (autoleave) {return message.guild.me.voice.channel.leave()};
    });
};

formatDuration(durationObj) {
  const duration = `${durationObj.hours ? durationObj.hours + ':' : ''}${
    durationObj.minutes ? durationObj.minutes : '00'
  }:${
    durationObj.seconds < 10
      ? '0' + durationObj.seconds
      : durationObj.seconds
      ? durationObj.seconds
      : '00'
    }`;
  return duration;
  }
};