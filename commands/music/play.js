const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');
const Youtube = require('simple-youtube-api');
const ytdl = require('ytdl-core');
const { autoleave, autoshuffle } = require('../../config.json');
const { youtubeAPI, cookies } = require('../../keys.json');
const { version } = require('../../package.json');
const youtube = new Youtube(youtubeAPI);

//const { betterMs } = require('../../util/betterMs');

const Pagination = require('discord-paginationembed');

var lastSong;

module.exports = class PlayCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'play',
      aliases: ['play-song', 'add', 'p'],
      memberName: 'play',
      group: 'music',
      description: 'Play a song or playlist from youtube.',
      guildOnly: true,
      clientPermissions: ['SPEAK', 'CONNECT'],
      throttling: {
        usages: 1,
        duration: 10
      },
      args: [
        {
          key: 'query',
          prompt: 'Pick a song or playlist from YouTube for me to play.',
          type: 'string'
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

        const url = `https://www.youtube.com/watch?v=${video.raw.id}&bpctr=9999999999&has_verified=1`; // temporary workaround to play community restricted videos 
        const title = video.raw.snippet.title;
        let duration = this.formatDuration(video.duration);
        const thumbnail = video.thumbnails.high.url;
        if (duration == '00:00') duration = 'Live Stream';
        const song = {
          url,
          title,
          duration,
          thumbnail,
          voiceChannel,
        };
        message.guild.musicData.queue.push(song);
      }
      if (message.guild.musicData.isPlaying == false) {
        message.guild.musicData.isPlaying = true;
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
    const url = query+`&bpctr=9999999999&has_verified=1`; // temporary workaround to play community restricted videos
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
      return message.say('Shit broke. Contact '+this.client.owners[0].username+'.');
    }
  }
  try {
    const videos = await youtube.searchVideos(query, 50);
    const FieldsEmbed = new Pagination.FieldsEmbed()
      .setArray(videos)
      .setAuthorizedUsers([message.author.id])
      .setChannel(message.channel)
      .setElementsPerPage(5)
      .setPageIndicator(true, 'hybrid')
      .setTimeout(60000)
      .setDeleteOnTimeout(true)
      .setDisabledNavigationEmojis(['delete', 'jump'])
      .formatField(
        '# - Song',
        t => 
        `**${videos.indexOf(t)+1}** - [**${t.title}**](${t.url}) by ${t.channel.title}\n`
      );

    FieldsEmbed.embed
      .setTitle('Search Results:')
      .setDescription([
        `Choose a song from the list below.`
      ])    
      .setFooter(`Meme Cultist | Ver. ${version}`, 'https://i.imgur.com/fbZ9H1I.jpg')
      .setColor('#e9f931');
      
    FieldsEmbed.build();
    try {
      var response = await message.channel.awaitMessages(
        msg => msg.author.id === message.author.id,
        {
          max: 1,
          time: 60000,
          errors: ['time']
        }
      );
      var videoIndex = parseInt(response.first().content);
    } catch (err) {
      console.error(err);
      return message.say(
        'Enter a number between 1 and 50 or exit.'
      );
    }
    if (response.first().content < 0 && response.first().contentt > 51) return message.say('Enter a number between 1 and 50 or exit.');
    try {
      var video = await youtube.getVideoByID(videos[videoIndex - 1].id);
    } catch (err) {
      console.error(err);
      if (FieldsEmbed) {
        FieldsEmbed.setTimeout(0);
      }
      return message.say(
        'An error has occured. Did you spell something wrong?'
      );
    }
    const url = `https://www.youtube.com/watch?v=${video.raw.id}&bpctr=9999999999&has_verified=1`; // temporary workaround to play community restricted videos
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
      this.playSong(message.guild.musicData.queue, message);
    } else if (message.guild.musicData.isPlaying == true) {
      return message.say(`${song.title} has been added to queue`);
    }
  } catch (err) {
    console.error(err);
    message.guild.musicData.isPlaying = false;
    message.guild.musicData.queue.splice(0, 1);
    message.guild.me.voice.channel.leave()
    message.say(
      '```js\n'+err+'```\nSee Console for More Details.'
    );
  }
}

playSong(queue, message) {
  const COOKIE = cookies;
  queue[0].voiceChannel
    .join()
    .then(connection => {
      const dispatcher = connection.play(ytdl(queue[0].url, {
        requestOptions: {
          headers: {
            cookie: COOKIE,
          }
        },
      	filter: 'audioonly',
      	highWaterMark: 1 << 25,
      	quality: 'highestaudio',
      })).on('start', () => {
          lastSong = queue[0];
          message.guild.musicData.songDispatcher = dispatcher;
          const videoEmbed = new MessageEmbed()
            .setThumbnail(queue[0].thumbnail)
            .setColor('#FF0000')
            .addField('Now Playing:', `<:youtube:417745828439130123> [**${queue[0].title}**](${queue[0].url})`) 
            .addField('Duration:', queue[0].duration)
            .setFooter(`Meme Cultist | Ver. ${version}`, 'https://i.imgur.com/fbZ9H1I.jpg')
          if (queue[1]) videoEmbed.addField('Next Song:', queue[1].title);
          if (!message.guild.musicData.repeat) {message.say(videoEmbed);};
          message.guild.musicData.nowPlaying = queue[0];
          message.guild.musicData.isPlaying = true;
          return queue.shift();
        })
        .on('finish', () => {
          if (message.guild.musicData.repeat == true) {
            message.guild.musicData.queue.unshift(lastSong);
            return this.playSong(queue, message);
          } else {
            if (queue.length >= 1) {
              return this.playSong(queue, message);
            } else {
              message.guild.musicData.isPlaying = false;
              message.guild.musicData.nowPlaying = null;

              if (autoleave) {return message.guild.me.voice.channel.leave()};
            }
          }
        })
        .on('error', e => {
          console.error(e);
          message.guild.musicData.isPlaying = false;
          message.guild.musicData.queue.splice(0, 1);
          message.guild.me.voice.channel.leave()
          message.say('Cannot Play Song\n```js\n'+e+'\nSee Console for More Details.```');
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