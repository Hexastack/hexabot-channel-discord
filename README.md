# Hexabot Discord Channel Extension

Welcome to the [Hexabot](https://hexabot.ai/) Discord Channel Extension! This extension enables seamless integration of your Hexabot chatbot with Discord, allowing you to engage with your audience on this popular communication platform.

Not yet familiar with [Hexabot](https://hexabot.ai/)? It's an open-source chatbot / agent solution that allows users to create and manage AI-powered, multi-channel, and multilingual chatbots with ease. If you would like to learn more, please visit the [official GitHub repo](https://github.com/Hexastack/Hexabot/).

## Features

- **Dual Interaction Channels**:
  - **Direct Messages**: Personal 1-on-1 bot conversations
  - **Server Interactions**: Interactions begin with a mention to the bot, ensuring context-aware communication.
- **User Data Retrieval**: Fetch essential user information such as username, avatar, roles, and server-specific details.
- **Flexible Communication**:
  - **Private Conversations**: Seamless direct messaging
  - **Server Chat**: Mention-based interactions
- **Rich Messaging Features**:
  - **Buttons**: Add interactive elements to guide user actions
  - **Embeds**: Create visually appealing message presentations
  - **Context Management**: Intelligent response handling in different communication contexts

💡 **Note**: Before users can interact with the bot via direct messages, it must be added to a server. Direct messaging is only possible after the bot is part of at least one Discord server.

## Prerequisites

Before you begin, ensure you have:

- A **Discord account**
- Basic knowledge of **APIs** and **web development** (optional but recommended)
- A **server** to host your chatbot
- **HTTPS** enabled on your server
- Cloned Hexabot locally (refer to [https://github.com/hexastack/hexabot](https://github.com/hexastack/hexabot))

## Installation

Navigate to your Hexabot project directory and install the extension:

```sh
cd ~/projects/my-chatbot/

npm install --save hexabot-channel-discord

hexabot dev
```

## Step 1: Create a Discord Developer Application

1. **Access Discord Developer Portal**:

   - Navigate to [Discord Developer Portal](https://discord.com/developers/applications)
   - Click **"New Application"**

2. **Configure Application**:

   - Name your application
   - Accept Developer Terms of Service

3. **Create Bot**:

   - Go to **"Bot"** section
   - Click **"Add Bot"**
   - Customize bot settings within **General Information**

## Step 2: Generate Bot Token

1. In the **"Bot"** section, find **"Token"**
2. Click **"Copy"** to retrieve your bot token
3. **IMPORTANT**: Keep this token secret

## Step 3: Intents Configuration

- **Description**: Configure which Discord events your bot can access
- **Recommended Intents**:
  - Server Members
  - Message Content
  - Guild Messages

1. **Access Bot Section**
   - In Discord Developer Portal, navigate to **"Bot"**
2. **Select the bot Intents**
   - Under **Privileged Gateway Intents**, select the desired intents

## Step 4: Configure OAuth2 for Server Invitation

1. **Access OAuth2 Section**:

   - In Discord Developer Portal, navigate to **"OAuth2"**
   - Click on **"URL Generator"**

2. **Select Scopes**:

   - Check **"bot"**

3. **Select Bot Permissions**:

   - Choose appropriate permissions based on bot functionality:
     - Send Messages
     - Manage Messages
     - Embed Links
     - Attach Files
     - Read Message History
     - Use Slash Commands

4. **Generate Invitation URL**:

   - Scroll down, the **"Generated URL"** will appear
   - Copy this URL

5. **Add Bot to Server**:

   - Open the generated URL in a web browser
   - Select the target server
   - Confirm permissions
   - Authorize bot installation

💡 **Pro Tip**: Always use the principle of least privilege. Only select permissions your bot absolutely needs.

## Configuration

### Settings

1. **Bot Token**

   - **Description**: Your Discord bot's authentication token
   - **Mandatory**: Yes
   - **How to Obtain**: Discord Developer Portal > Bot section

2. **Application ID**

   - **Description**: Your application's unique identifier
   - **How to Obtain**: Discord Developer Portal > General Information

## Usage

Once configured, your Hexabot will be available on Discord with:

- Mention-based interactions for server environments
- Automated responses
- User data retrieval

### Testing Integration

1. Invite bot to server
2. Verify mention-based interactions work only in servers
3. Verify direct messages work only in private discussions
4. Check user data retrieval

## Contributing

We welcome community contributions!

- Report bugs
- Suggest features
- Submit pull requests

Please review [Contribution Guidelines](./CONTRIBUTING.md)

Join our [Discord](https://discord.gg/rNb9t2MFkG)

## License

Licensed under GNU Affero General Public License v3.0 (AGPLv3) with additional terms:

1. "Hexabot" is a trademark of Hexastack
2. Derivative works must attribute Hexastack and Hexabot

---

_Happy Bot Building!_
