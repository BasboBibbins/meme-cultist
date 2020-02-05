const { Command } = require('discord.js-commando');
const request = require('request');
const { MessageEmbed } = require('discord.js');
const { version } = require('../../package.json');

const maxage = 1000 * 60 * 15 // 15 min
const subreddits = ['dankmemes', 'memes', 'funny', 'deepfriedmemes', 'dadjokes', 'hmmm', 'me_irl', 'meirl', '2meirl4meirl', 'goodfaketexts']

let subredditCache = {};
exports.cache = subredditCache;

function updateSubreddit(subreddit) {
  return new Promise((resolve, reject) => {
    if (subredditCache[subreddit] && Date.now() - subredditCache[subreddit].lastUpdate < maxage) return resolve();

    request(`https://imgur.com/r/${subreddit}/hot.json`, (err, response, body) => {
      if (err) return reject();
      let json;

      try {
        json = JSON.parse(body);
      } catch(e) {
        return reject();
      }
      if (!json || !json.data || !json.data[0]) return reject();

      json.data = json.data.filter(data => {
        return !data.nsfw && data.num_images >= 1 && data.mimetype && data.mimetype.startsWith('image');
      });
      if (json.data.length < 1) return reject();
      subredditCache[subreddit] = {
        data: json.data,
        lastUpdate: Date.now()
      };
      resolve();
    });
  });
}

function getSubredditMeme(subreddit) {
  return new Promise((resolve, reject) => {
    updateSubreddit(subreddit).then(() => {
      let { data } = subredditCache[subreddit];
      resolve(data[Math.floor(Math.random() * data.length)]);
    }).catch(reject);
  });
}

module.exports = class MemeCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'meme',
      aliases: ['getmeme'],
      memberName: 'meme',
      group: 'fun',
      description: "Get a meme from a plethora of subreddits."
    });
  }
  run(message) {
    let randomSubreddit = subreddits[Math.floor(Math.random() * subreddits.length)];

    getSubredditMeme(randomSubreddit).then(meme => {
      var embed = new MessageEmbed()
        .setColor('#FF4500')
        .setURL(`https://www.reddit.com${meme.reddit}`)
        .setImage(`https://i.imgur.com/${meme.hash}${meme.ext}`)
        .setAuthor(meme.title, 'https://www.redditinc.com/assets/images/site/reddit-logo.png', `https://www.reddit.com${meme.reddit}`)
        .addField('-=-=-=-=-=-=-=-=-=-=-=-',`Posted by u/${meme.author} on r/${randomSubreddit}`)
        .setFooter(`Meme Cultist | Ver. ${version}`, 'https://i.imgur.com/fbZ9H1I.jpg')
      message.channel.send({embed})
    }).catch(() => {
      message.channel.send(message.__('error'));
    });
  };
};
