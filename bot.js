const Discord = require('discord.js');
const client = new Discord.Client();
const https = require('https');
const fs = require('fs');
const random_string = require('@supercharge/strings');

let role = null;

const reset_counted_users = {
    "users": []
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    
    let guild = null;
    for (const guildId of client.guilds.cache.keys()) {
        guild = client.guilds.cache.get(guildId);
        break;
    }

    if (guild) {
        // find "Runner" role
        guild.roles.fetch()
            .then(roles => {
                for (const roleId of roles.cache.keys()) {
                    const r = roles.cache.get(roleId);
                    if (r.name.localeCompare(process.env.ROLE_NAME) == 0) {
                        role = r;
                        break;
                    }
                }
            });

        // find runner-voting channel and race-voting
        for (const channelId of guild.channels.cache.keys()) {
            const channel = guild.channels.cache.get(channelId)
            if (channel.name.localeCompare(process.env.RUNNER_VOTING_CHANNEL) == 0 || channel.name.localeCompare(process.env.RACE_VOTING_CHANNEL) == 0) {
                reactToOldMessagesIn(channel)
            }
        }
    }
});

client.on('message', msg => {
    // role-assign channel
    if (msg.channel.name == process.env.ROLE_ASSIGN_CHANNEL) {
        handleRoleMessage(msg);
        return;
    }

    if (msg.channel.name == process.env.MANAGE_BOT_CHANNEL) {
        handleManageBot(msg);
        return;
    }
});

client.on('messageReactionAdd', async (reaction, user) => {

    // fetch message
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.log('Something went wrong when fetching the message: ', error);
            return;
        }
    }

    // runner-voting channel
    if (reaction.message.channel.name == process.env.RUNNER_VOTING_CHANNEL) {
        handleVoteReaction(reaction);
        generate_one_time(user);
    }

    // race-voting channel
    if (reaction.message.channel.name == process.env.RACE_VOTING_CHANNEL) {
        handleVoteReaction(reaction);
    }
});

client.login(process.env.BOT_TOKEN);

// Manage the counted_users file in Discord
function handleManageBot(msg) {
    if (msg.content.startsWith("!clear")) {
        fs.writeFileSync("counted_users.json", JSON.stringify(reset_counted_users, null, 2));
        msg.react('👍');

        return;
    }

    if (msg.content.startsWith("!dump")) {
        msg.channel.send(new Discord.MessageAttachment('counted_users.json', 'users.json'));
        return;
    }
}

// Send the code to the user if the user has not gotten it already
function generate_one_time(user) {
    let counted = JSON.parse(fs.readFileSync("counted_users.json"));
    if (user == client.user) { return; }
    let code = generate_code();
    for (var i = 0; i < counted["users"].length; i++) {
        if (counted["users"][i]["code"] == code) { code = generate_code(); } // If the codes somehow match
        if (counted["users"][i]["id"] == user.id) { return; } // If the user has already gotten a code, don't give it again
    }
    console.log(user.username + "#" + user.discriminator + " has been given the code: " + code);
    user.send("Your One-Time code: `" + code + "`");
    let new_count = {
        "id": user.id,
        "code": code,
        "discord_username": user.username + "#" + user.discriminator
    };
    counted["users"].push(new_count);
    fs.writeFileSync("counted_users.json", JSON.stringify(counted, null, 2));
}

// Randomly create a 16-character string to act as a passcode
function generate_code() { return random_string.random(16); }

function handleRoleMessage(msg) {

    // only !role command available
    if (!msg.content.startsWith('!role')) {
        msg.delete();
        return;
    }

    // validate command
    if (msg.content.length < 7) {
        msg.author.send('Invalid speedrun.com username! The !role command format is: "!role USERNAME".');
        msg.delete();
        return;
    }

    // validate they don't have the role already
    for (const roleId of msg.member.roles.cache.keys()) {
        if (roleId.localeCompare(role.id) == 0) {
            msg.delete();
            return;
        }
    }

    let srcName = msg.content.substring(6, msg.content.length);

    // get discord handle from src profile
    getDiscordHandle(srcName, discordHandle => {

        // compare discord handles
        const realDiscordHandle = (msg.author.username + "#" + msg.author.discriminator);

        if (discordHandle.localeCompare(realDiscordHandle) != 0) {
            msg.author.send('The given speedrun.com user does not have a Discord account linked in their profile, or it doesn\'t match.');
            msg.delete();

            console.log(realDiscordHandle + ' has "' + discordHandle + '" as their discord handle in speedrun.com, and doesn\'t match.');
            return;
        }

        // get src profile from API
        getSrcProfile(srcName, srcId => {

            // profile response error
            if (srcId == null) {
                msg.author.send('The speedrun.com username is invalid! Please make sure the user name was correct and try again.')
                msg.delete();

                console.log('Error getting profile from speedrun.com for ' + realDiscordHandle);
                return;
            }

            // get src PBs from API
            getSrcPBs(srcId, runs => {

                // no runs in response error
                if (runs == null) {
                    msg.author.send('There was a problem fetching your runs from speedrun.com. Please try again later.')
                    msg.delete();

                    console.log('Error getting runs from speedrun.com for ' + realDiscordHandle);
                    return;
                }

                var shouldGiveRole = false;

                for (const runData of runs) {
                    const run = runData["run"];

                    if (run != null) {
                        // ignore ILs
                        const level = run["level"];
                        if (level != null) {
                            continue;
                        }

                        // check if for SMO and category extensions
                        const game = run["game"];
                        const category = run["category"];

                        const disallowed_categories_str = process.env.DISALLOWED_CATEGORIES
                        let disallowed_categories = []
                        if (disallowed_categories_str != null) {
                            disallowed_categories = disallowed_categories_str.split(",")
                        }
                        
                        if (game.localeCompare(process.env.SMO_ID) == 0 ||
                            (game.localeCompare(process.env.SMO_CE_ID) == 0 && disallowed_categories.indexOf(category) == -1)) {
                            shouldGiveRole = true;
                            break;
                        }
                    }
                }

                // give role
                if (shouldGiveRole) {
                    msg.member.roles.add(role);
                    msg.react('👍');

                    console.log('Succesfully assigned the "Runner" role to ' + realDiscordHandle + '!');

                // no SMO runs found error
                } else {
                    msg.author.send('We couldn\'t find a Super Mario Odyssey run in your speedrun.com profile. If you\'re sure you are eligible for the "Runner" role, please contact a moderator.');
                    msg.delete();

                    console.log(realDiscordHandle + ' tried to get the "Runner" role, but they didn\'t have any SMO runs');
                }
            });
        });
    });
}

function handleVoteReaction(reaction) {

    // adds +1 on new reactions
    if (reaction.me == false) {
        reaction.message.react(reaction.emoji)
    }
}

function reactToOldMessagesIn(channel) {
    // finds messages in the channel and adds +1 on existing reactions

    channel.messages.fetch()
        .then(messages => {

            for (const messageData of messages) { 
                try {
                    let msg = messageData[1]

                    for (const reactionData of msg.reactions.cache) {
                        let reaction = reactionData[1]

                        if (reaction.me == false) {
                            msg.react(reaction.emoji)
                        };
                    }
                } catch (error) {
                    console.log("Error trying to react to message " + messageData);
                    console.log(error);
                }
            }
        })
        .catch(error => {
            console.log("Error when fetching messages from channel #" + channel.name + ":");
            console.log(error);
        });
}

function getDiscordHandle(srcName, completion) {
    // make request to profile page
    const profilePageOptions = {
        hostname: 'www.speedrun.com',
        port: 443,
        path: '/user/' + encodeURIComponent(srcName),
        method: 'GET'
    }

    const profilePageRequest = https.request(profilePageOptions, res => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            const regex = /(?<=data-id=")(.*?#....)/g;
            const match = data.match(regex);
            const result = match != null ? match[0] : "";

            completion(result);
        });
    })

    // request error
    profilePageRequest.on('error', error => {
        completion("");
    })

    profilePageRequest.end()
}

function getSrcProfile(srcName, completion) {
    // get profile from API
    const redirectOptions = {
        hostname: 'www.speedrun.com',
        port: 443,
        path: '/api/v1/users/' + encodeURIComponent(srcName),
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    }

    const redirectRequest = https.request(redirectOptions, r => {
        let data = '';
        r.on('data', (chunk) => {
            data += chunk;
        });

        r.on('end', () => {
            const regex = /(?<=users\/)(.*?)"/g;
            const match = data.match(regex);
            const id = match != null ? match[0].substring(0, match[0].length - 1) : null;

            completion(id);
        });

    });

    // request error
    redirectRequest.on('error', error => {
        completion(null);
    });

    redirectRequest.end();
}

function getSrcPBs(srcId, completion) {
    // get personal bests from API
    const pbsOptions = {
        hostname: 'www.speedrun.com',
        port: 443,
        path: '/api/v1/users/' + srcId + '/personal-bests',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    }

    const pbsRequest = https.request(pbsOptions, r => {
        let data = '';
        r.on('data', (chunk) => {
            data += chunk;
        });

        r.on('end', () => {
            const json = JSON.parse(data);
            
            if (json["data"] != null && Array.isArray(json["data"])) {
                completion(json["data"]);
            } else {
                completion(null);
            }
        });
    });

    // request error
    pbsRequest.on('error', error => {
        completion(null);
    });

    pbsRequest.end();
}
