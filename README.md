# THE MEME CULTIST

A bot by Basbo Bibbins

# Info

This bot is made for personal use, and is only used on my personal discord. Feel free to take the commands and use them on your own bot if you like, but I can't guarentee that the bot will work straight from this repo.

# keys.json

In order for the bot the work, you need to supply a ```keys.json``` file containing the following code:

```
{
  "token": "YOUR-DISCORD-TOKEN-HERE",
  "youtubeAPI": "YOUR-YT-API-TOKEN-HERE"
}
```
(of course replacing the values in here with your own keys)

# config.json

The ```config.json``` file is included in the repo to give customization to certain aspects of the bot. Here's a rundown of what each variable does and their default values:

**prefix:** the character prefix used to tell the bot that the user is running a command.  *(default: '>')*
**defaultRole:** the role assigned to a user that joins the server. *(default: 'Peasant')*
**messageTimer:** the time a bot message stays in the channel before being deleted. 0 means it does not dissapear. *(default: '0')*
**dev:** enable developer mode, which enables certain commands. *(default: false)*
**autoleave:** when done playing music/sounds, the bot will leave the channel. *(default: false)*
**corona_mode:** april fools joke mode, 'social distances' messages in the channel. *(default: false)*
**autoshuffle:** automatically shuffle playlists added to the queue. *(default: true)*
**enable_word_filter:** another april fools mode, enables or disables certain words specified in the next var. *(default: false)*
**word_filter:** the words to be filtered for the above var. *(default: a lot; check the file)*
