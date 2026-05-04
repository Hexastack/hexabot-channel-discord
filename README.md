# Hexabot Discord Channel Extension

`hexabot-channel-discord` connects Hexabot v3 to Discord through the Discord Gateway. It lets a Hexabot bot answer direct messages and server messages that mention the Discord bot, while preserving Hexabot's v3 channel contracts for source settings, subscribers, attachments, and outbound message envelopes.

This implementation is built for Hexabot v3. It is not a direct port of the v2 channel SDK package.

## Features

- **Direct messages**
  - Users can talk to the bot in 1-on-1 Discord DMs.
  - Each Discord DM channel maps to one Hexabot subscriber/thread.

- **Server conversations**
  - Server messages are processed only when they mention the bot.
  - Each Discord text channel maps to one Hexabot subscriber/thread, so workflow replies and operator replies stay in the public channel where the conversation started.

- **Interactive messages**
  - Hexabot quick replies are rendered as Discord primary buttons.
  - Hexabot postback buttons are rendered as Discord secondary buttons.
  - Web URL buttons are rendered as Discord link buttons.
  - Button clicks are decoded back into v3 quick reply or postback inbound events.

- **Rich outbound support**
  - Text messages
  - Quick replies
  - Buttons
  - Attachments
  - Lists
  - Carousels
  - Typing indicators

- **Attachments**
  - Inbound Discord attachments are downloaded and stored through Hexabot's attachment pipeline.
  - Outbound Hexabot attachments are exposed through the standard channel public URL flow.

- **Operational health**
  - Active sources report missing required settings.
  - Gateway connection state is reflected in integration health details.

## Prerequisites

Before installing the channel, make sure you have:

- A Discord account.
- A Discord server where you can invite a bot.
- A Hexabot v3 project using `@hexabot-ai/api`.
- Node.js `20.19.x`, matching the Hexabot v3 engine requirement.
- Access to Discord Developer Portal.

## Installation

Install the extension and its Discord peer dependency in the workspace or deployment that runs Hexabot API:

```sh
npm install hexabot-channel-discord discord.js
```

For local development inside this repository, the extension lives under:

```txt
src/extensions/channels/hexabot-channel-discord
```

Restart the Hexabot API after installation. The channel appears with the name:

```txt
discord
```

## Discord Application Setup

### 1. Create a Discord Application

1. Open [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**.
3. Choose a name for your bot application.
4. Open **General Information** and copy the **Application ID**.

You will use this value in the Hexabot Discord source setting `application_id`.

### 2. Create and Configure the Bot

1. In the application sidebar, open **Bot**.
2. Click **Add Bot** if one does not already exist.
3. Customize the bot name and icon if needed.
4. Reset or copy the bot token.
5. Store the token as a Hexabot credential. Do not paste the token directly into source settings.

### 3. Enable Gateway Intents

In **Bot > Privileged Gateway Intents**, enable:

- **Message Content Intent**

For the channel behavior implemented here, the bot also connects with these non-privileged Gateway intents:

- `Guilds`
- `GuildMessages`
- `DirectMessages`

The Message Content privileged intent is required because Discord does not expose message text to most bots without it.

### 4. Generate the Server Invite URL

1. Open **OAuth2 > URL Generator**.
2. Select the `bot` scope.
3. Select only the permissions your deployment needs.

Recommended permissions:

- View Channels
- Send Messages
- Read Message History
- Attach Files
- Embed Links

Copy the generated URL, open it in a browser, and invite the bot to the target server.

## Hexabot Source Configuration

Create a Hexabot source using the `discord` channel.

Required settings:

- `bot_token`: credential containing the Discord bot token.
- `application_id`: Discord application/client ID from the Developer Portal.

Optional settings:

- `allowed_guild_ids`: comma-separated Discord server IDs. When set, guild messages from all other servers are ignored.
- `enable_direct_messages`: defaults to `true`.
- `enable_guild_mentions`: defaults to `true`.
- `disable_buttons_after_click`: defaults to `true`.
- `thread_inactivity_hours`: defaults to `24`.

Use one Hexabot source per Discord bot application/token.

## Usage

### Direct Messages

After the bot is invited to at least one server, a user can open a direct message with the bot and send a message. Hexabot receives it as a v3 text event and replies in the same DM channel.

### Server Messages

In a server text channel, mention the bot:

```txt
@YourBot hello
```

The mention is removed before the text reaches the workflow, so Hexabot receives:

```txt
hello
```

Messages that do not mention the bot are ignored.

### Buttons and Quick Replies

Quick replies and postback buttons are sent as Discord message components. When a user clicks one, the channel emits the matching v3 inbound event:

- Quick replies become `IncomingMessageType.quickReply`.
- Postback buttons become `IncomingMessageType.postback`.
- Link buttons open URLs and do not emit postbacks.

If `disable_buttons_after_click` is enabled, non-link buttons on the Discord message are disabled after the first click.

### Lists and Carousels

Discord does not have a native carousel format. Lists and carousels are rendered as one or more Discord embeds. Paginated lists include a final **View More** button when more content exists.

## Development

From the extension directory:

```sh
npm run typecheck
npm test -- --runInBand
npm run build
```

The package build must produce:

- `dist/index.js`
- `dist/index.channel.js`

The extension includes:

- `.github/workflows/release.yml`
- `.gitignore`
- `.npmignore`
- `i18n/en.translations.json`
- `i18n/fr.translations.json`

## Release

The package keeps the v2-style release scripts:

```sh
npm run release:patch
npm run release:minor
```

The GitHub Actions release workflow publishes to npm when a `v*` tag is pushed and `NPM_TOKEN` is configured in repository secrets.

## Troubleshooting

### The bot connects but does not read messages

Confirm that **Message Content Intent** is enabled in Discord Developer Portal and that the bot was restarted after enabling it.

### Server messages are ignored

Confirm that:

- The message mentions the bot.
- `enable_guild_mentions` is enabled.
- The server ID is included in `allowed_guild_ids`, or `allowed_guild_ids` is empty.
- The bot has access to the channel.

### Direct messages are ignored

Confirm that:

- `enable_direct_messages` is enabled.
- The user has permission to message the bot.
- The bot is installed in at least one shared server.

### Attachment replies fail

Confirm that your Hexabot public URL configuration allows Discord to fetch the channel public attachment URL.

## License

Licensed under the Hexabot Fair Core License. See [LICENSE.md](./LICENSE.md).
