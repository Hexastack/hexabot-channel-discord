/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';

import { MenuService } from '@/cms/services/menu.service';
import { LoggerService } from '@/logger/logger.service';

export class DiscordBotService {
  private client: Client;

  private rest: REST;

  constructor(
    private botToken: string,
    private appId: string,
    private readonly menuService: MenuService,
    private readonly logger: LoggerService,
  ) {
    // Initialize the Discord client
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });
  }

  getClient(): Client {
    return this.client;
  }

  async init() {
    // Register slash commands
    await this.registerSlashCommands();

    // Destroy the client if it's already running
    await this.client.destroy();

    // Log in to the Discord bot account using the token
    await this.client.login(this.botToken);

    // Listen for the ready event
    this.client.on(Events.ClientReady, () => {
      this.logger.log('Discord bot is ready!');
    });
  }

  setBotToken(bot_token: string) {
    this.logger.verbose('Bot token updated', 'DiscordBotService');
    this.botToken = bot_token;
    this.init();
  }

  setAppId(app_id: string) {
    this.logger.verbose('App ID updated', 'DiscordBotService');
    this.appId = app_id;
    this.init();
  }

  private async registerSlashCommands(): Promise<void> {
    this.rest = new REST({ version: '10' }).setToken(this.botToken);

    const chatCommand = new SlashCommandBuilder()
      .setName('chat')
      .setDescription('Start a conversation with the bot')
      .addStringOption((option) =>
        option
          .setName('message')
          .setDescription('Your message to the bot')
          .setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

    try {
      this.logger.log('Started refreshing application (/) commands.');

      await this.rest.put(Routes.applicationCommands(this.appId), {
        body: [chatCommand],
      });

      this.logger.log('Successfully registered application (/) commands.');
    } catch (error) {
      this.logger.error('Error registering slash commands:', error);
    }
  }
}
