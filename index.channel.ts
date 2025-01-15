/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { Stream } from 'stream';

import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter/dist/decorators';
import * as DiscordTypes from 'discord.js';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  Client,
  EmbedBuilder,
  REST,
  SlashCommandBuilder,
} from 'discord.js';
import { Request, Response } from 'express';
import { I18nService } from 'nestjs-i18n';
import { v4 as uuidv4 } from 'uuid';

import { AttachmentService } from '@/attachment/services/attachment.service';
import { ChannelService } from '@/channel/channel.service';
import ChannelHandler from '@/channel/lib/Handler';
import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';
import { AttachmentRef } from '@/chat/schemas/types/attachment';
import { ButtonType } from '@/chat/schemas/types/button';
import {
  IncomingMessageType,
  OutgoingMessageFormat,
  StdEventType,
  StdOutgoingAttachmentMessage,
  StdOutgoingButtonsMessage,
  StdOutgoingEnvelope,
  StdOutgoingListMessage,
  StdOutgoingQuickRepliesMessage,
  StdOutgoingTextMessage,
} from '@/chat/schemas/types/message';
import { BlockOptions } from '@/chat/schemas/types/options';
import { LabelService } from '@/chat/services/label.service';
import { MessageService } from '@/chat/services/message.service';
import { SubscriberService } from '@/chat/services/subscriber.service';
import { MenuService } from '@/cms/services/menu.service';
import { config } from '@/config';
import { LanguageService } from '@/i18n/services/language.service';
import { LoggerService } from '@/logger/logger.service';
import { SettingService } from '@/setting/services/setting.service';
import { SocketRequest } from '@/websocket/utils/socket-request';
import { SocketResponse } from '@/websocket/utils/socket-response';

import { DISCORD_CHANNEL_NAME } from './settings';
import { Discord } from './types';
import DiscordEventWrapper from './wrapper';

@Injectable()
export class DiscordChannelHandler extends ChannelHandler<
  typeof DISCORD_CHANNEL_NAME
> {
  // Discord WS client
  private client: Client;

  constructor(
    settingService: SettingService,
    channelService: ChannelService,
    logger: LoggerService,
    protected readonly eventEmitter: EventEmitter2,
    protected readonly i18n: I18nService,
    protected readonly languageService: LanguageService,
    protected readonly subscriberService: SubscriberService,
    protected readonly attachmentService: AttachmentService,
    protected readonly messageService: MessageService,
    protected readonly menuService: MenuService,
    protected readonly labelService: LabelService,
    protected readonly httpService: HttpService,
  ) {
    super(DISCORD_CHANNEL_NAME, settingService, channelService, logger);

    // Initialize the Discord client
    this.client = new Client({
      intents: [
        DiscordTypes.GatewayIntentBits.Guilds,
        DiscordTypes.GatewayIntentBits.GuildMessages,
        DiscordTypes.GatewayIntentBits.MessageContent,
        DiscordTypes.GatewayIntentBits.DirectMessages,
      ],
      partials: [DiscordTypes.Partials.Channel],
    });
  }

  getPath(): string {
    return __dirname;
  }

  /**
   * Initializes the Discord channel handler.
   * This method sets up the Discord bot, including login, event listeners for message handling,
   * and interaction management (e.g., button postbacks). It is called automatically by the parent
   * class constructor.
   *
   * @return A promise that resolves when the initialization process is complete.
   */
  async init(): Promise<void> {
    try {
      this.logger.debug('Discord Channel Handler : initialization ...');
      const settings = await this.getSettings();

      if (!settings.bot_token || !settings.app_id) {
        this.logger.error(
          'Make sure that Discord Token and App ID are configured in the settings',
        );
        return;
      }

      // Register slash commands
      // await this.registerSlashCommands();

      // Destroy the client if it's already running
      await this.client.destroy();

      // Log in to the Discord bot account using the token
      await this.client.login(settings.bot_token);

      // Listen for the ready event
      this.client.on(DiscordTypes.Events.ClientReady, () => {
        this.logger.log('Discord bot is ready!');
      });

      // Handle button postbacks
      this.client.on(
        DiscordTypes.Events.InteractionCreate,
        async (interaction) => {
          if (interaction.isButton()) {
            // Ignore wait for button interactions
            await interaction.deferUpdate();
            // Disable all buttons after one is clicked
            await this.disableButtonInteractions(interaction);

            this.emitEvent(interaction);
          } else {
            this.logger.debug('Unhandled interaction ...', interaction);
          }
        },
      );

      // Handle messages
      this.client.on(DiscordTypes.Events.MessageCreate, async (message) => {
        try {
          // Let's ignore system messages (pin, new joiners, ..)
          if (message.system) {
            this.logger.debug('Ignoring system message ...', message);
            return;
          }

          if (!message.channel.isTextBased()) {
            this.logger.debug('Ignoring non text based messages ...', message);
            return;
          }

          if (
            message.channel.type === DiscordTypes.ChannelType.GuildText &&
            !message.mentions.has(this.client.user)
          ) {
            this.logger.debug('Ignoring guild message without mention ...');
            return;
          }

          // Extract the mention and remove it from the message content
          if (message.channel.type === DiscordTypes.ChannelType.GuildText) {
            const botMention = `<@${this.client.user?.id}>`; // Format for the bot mention
            message.content = message.content.replaceAll(botMention, '').trim();
          }

          if (message.attachments.size > 0 && message.content !== '') {
            // Handle messages with text and attachments, send only the text
            const event = new DiscordEventWrapper(this, message);
            event.setMessageType(IncomingMessageType.message);
            this.eventEmitter.emit('hook:chatbot:message', event);
          }

          this.emitEvent(message);
        } catch (error) {
          this.logger.error('Error processing direct message:', error);
        }
      });
    } catch (error) {
      this.logger.error('Failed to initialize DiscordHandler:', error);
    }
  }

  async fetchAndStoreAttachment(attachment: DiscordTypes.Attachment) {
    const response = await this.httpService.axiosRef.get<Stream>(
      attachment.url,
      {
        responseType: 'stream',
      },
    );
    return this.attachmentService.store(response.data, {
      name: attachment.title,
      size: attachment.size || parseInt(response.headers['content-length']),
      type: attachment.contentType,
      channel: {
        [this.getName()]: attachment,
      },
    });
  }

  /**
   * Re-initialize whenever the discord settings are updated
   */
  @OnEvent('hook:discord_channel:*')
  async handleSettingsUpdate() {
    this.init();
  }

  /**
   * Emits a standardized event based on the incoming Discord event.
   * Wraps the event using `DiscordEventWrapper` and determines its type.
   * If the event type is recognized, it emits the corresponding event; otherwise, it logs an error.
   *
   * @param e - The raw incoming event from Discord.
   *   - The event is wrapped to extract its type and other relevant details.
   *   - Supported event types are emitted using the `eventEmitter`.
   *
   * @return This function does not return a value.
   */
  private emitEvent(e: Discord.IncomingEvent): void {
    const event = new DiscordEventWrapper(this, e);
    const eventType = event.getEventType();
    if (eventType !== StdEventType.unknown) {
      this.eventEmitter.emit(`hook:chatbot:${eventType}`, event);
    } else {
      this.logger.error('Unknown event type', e);
    }
  }

  /**
   * Disables button interactions in the message after a user selects an option from the quick replies.
   * Updates the message components to disable all buttons, marking the selected button with a checkmark (✅).
   *
   * @param interaction - The button interaction triggered by the user's selection.
   *   - Contains the details of the selected button and the message to update.
   *
   * @return A promise that resolves once the interaction has been updated.
   */
  private async disableButtonInteractions(
    interaction: DiscordTypes.ButtonInteraction,
  ): Promise<void> {
    const newRow =
      new ActionRowBuilder<DiscordTypes.MessageActionRowComponentBuilder>();
    const oldRow = interaction.message.components[0];
    oldRow.components.forEach((component: DiscordTypes.ButtonComponent) => {
      const isSelected = component.customId === interaction.customId;
      const discordButton = new ButtonBuilder()
        .setLabel(component.label)
        .setStyle(component.style)
        .setDisabled(true);
      isSelected && discordButton.setEmoji('✅');
      component.customId && discordButton.setCustomId(component.customId);
      if (component.url) {
        discordButton.setURL(component.url).setDisabled(false);
      }

      newRow.addComponents(discordButton);
    });

    await interaction.editReply({
      ...interaction,
      components: [newRow],
    });
  }

  /**
   * Unused method since Discord uses WS connnection rather then Webhook notifications
   */
  handle(_req: Request | SocketRequest, _res: Response | SocketResponse) {
    throw new Error('Discord Channel Handler is not using Webhooks currently.');
  }

  /**
   * Format any type of message
   *
   * @param envelope - The message standard envelope
   * @param options - The block options related to the message
   *
   * @returns A template filled with its payload
   */
  async _formatMessage(envelope: StdOutgoingEnvelope, options: BlockOptions) {
    switch (envelope.format) {
      case OutgoingMessageFormat.attachment:
        return await this._attachmentFormat(envelope.message, options);
      case OutgoingMessageFormat.buttons:
        return this._buttonsFormat(envelope.message, options);
      case OutgoingMessageFormat.carousel:
        return await this._carouselFormat(envelope.message, options);
      case OutgoingMessageFormat.list:
        return await this._listFormat(envelope.message, options);
      case OutgoingMessageFormat.quickReplies:
        return this._quickRepliesFormat(envelope.message, options);
      case OutgoingMessageFormat.text:
        return this._textFormat(envelope.message, options);

      default:
        throw new Error('Unknown message format');
    }
  }

  /**
   * Sends a message to the Discord channel associated with the event.
   * Handles various message formats, including plain text, lists, carousels, and embedded messages.
   * Supports optional typing indicators before sending the message.
   *
   * @param event - The `DiscordEventWrapper` instance representing the incoming event.
   *   - Used to determine the target Discord channel.
   * @param envelope - The `StdOutgoingEnvelope` containing the message content and metadata.
   *   - Defines the format of the outgoing message (e.g., plain text, list, carousel).
   * @param options - The `BlockOptions` for sending the message.
   *   - Includes settings such as whether to show a typing indicator.
   * @param _context - Additional context passed to the function (for future extensibility).
   *
   * @return A promise that resolves to an object containing:
   * - `mid`: The message ID of the sent message.
   */
  async sendMessage(
    event: DiscordEventWrapper,
    envelope: StdOutgoingEnvelope,
    options: BlockOptions,
    _context: any,
  ): Promise<{ mid: string }> {
    try {
      this.logger.log('Discord Channel Handler: Sending message ...');

      const payload = await this._formatMessage(envelope, options);

      const discordChannel = (await this.client.channels.fetch(
        event.getSenderForeignId(),
      )) as DiscordTypes.TextChannel;

      if (discordChannel?.isTextBased()) {
        // Send typing indicator
        if (options.typing) {
          await discordChannel.sendTyping();
        }
        // Send the message
        if (
          (envelope.format === OutgoingMessageFormat.list ||
            envelope.format === OutgoingMessageFormat.carousel) &&
          'embeds' in payload
        ) {
          const res = await this.sendListCarouselMessage(
            payload,
            envelope,
            discordChannel,
          );
          return { mid: res };
        } else {
          const res = await discordChannel.send(payload);
          return { mid: res.id };
        }
      } else {
        throw new Error('Only text-based channels are supported (For now ...)');
      }
    } catch (error) {
      this.logger.error('Failed to send message:', error);
      throw error;
    }
  }

  async sendListCarouselMessage(
    payload: Discord.OutgoingMessage,
    envelope: StdOutgoingEnvelope,
    discordChannel: DiscordTypes.TextChannel,
  ): Promise<string> {
    let lastResId: string;
    for (const [embed, component, file] of payload.embeds.map(
      (
        embed: DiscordTypes.EmbedBuilder,
        i: number,
      ): [
        EmbedBuilder,
        ActionRowBuilder<DiscordTypes.ButtonBuilder>,
        AttachmentBuilder,
      ] => [
        embed,
        payload.components[i] as ActionRowBuilder<ButtonBuilder>,
        payload.files[i] as AttachmentBuilder,
      ],
    )) {
      const resBody: Discord.OutgoingMessage = {
        content: '\u200B',
        embeds: [embed],
      };
      component && (resBody['components'] = [component]);
      file && (resBody['files'] = [file]);
      const res = await discordChannel.send(resBody);
      lastResId = res.id;
    }

    if (envelope.format === OutgoingMessageFormat.list) {
      await discordChannel.send({
        components: [payload.components[payload.embeds.length]],
      });
    }

    return lastResId;
  }

  /**
   * Fetches user data from the event and constructs a `SubscriberCreateDto` object.
   * This includes retrieving the user's profile picture, storing it, and setting default values for the subscriber's details.
   *
   * @param event - The `DiscordEventWrapper` instance representing the incoming event.
   *   - Provides access to sender information and channel data.
   *
   * @return A promise that resolves to a `SubscriberCreateDto` object
   */
  async getUserData(event: DiscordEventWrapper): Promise<SubscriberCreateDto> {
    try {
      const foreignId = event.getSenderForeignId();
      const info = event.getSenderInfo();

      // Store subscriber/channel avatar
      let avatarId = null;
      if (info.avatarUrl) {
        const response = await this.httpService.axiosRef.get<Stream>(
          info.avatarUrl,
          {
            responseType: 'stream',
          },
        );

        const avatar = await this.attachmentService.store(
          response.data,
          {
            name: uuidv4(),
            size: parseInt(response.headers['content-length']),
            type: response.headers['content-type'],
            channel: {
              [this.getName()]: { url: info.avatarUrl },
            },
          },
          config.parameters.avatarDir,
        );
        avatarId = avatar.id;
      }

      const defautLanguage = await this.languageService.getDefaultLanguage();
      return {
        foreign_id: foreignId,
        first_name: info.firstName,
        last_name: info.lastName,
        gender: '',
        channel: event.getChannelData(),
        avatar: avatarId,
        assignedAt: null,
        assignedTo: null,
        labels: [],
        locale: 'en',
        language: defautLanguage.code,
        timezone: 0,
        country: '',
        lastvisit: new Date(),
        retainedFrom: new Date(),
      };
    } catch (error) {
      this.logger.error(
        'Discord Channel Handler : Error while fetching user data',
        error,
      );
      throw error;
    }
  }

  /**
   * Formats a standard outgoing text message into a Discord-compatible message.
   *
   * @param message - The `StdOutgoingTextMessage` object containing the message text.
   * @param _options - (Optional) The `BlockOptions` object for additional formatting options (not currently used).
   *
   * @return A `Discord.OutgoingMessage` object containing:
   * - `content`: The text content of the message.
   */
  _textFormat(
    message: StdOutgoingTextMessage,
    _options?: BlockOptions,
  ): Discord.OutgoingMessage {
    return {
      content: message.text,
    };
  }

  /**
   * Formats a standard outgoing quick replies message into a Discord-compatible message.
   * Creates a row of buttons representing the quick reply options.
   *
   * @param message - The `StdOutgoingQuickRepliesMessage` object containing the message text and quick reply options.
   * @param _options - (Optional) The `BlockOptions` object for additional formatting options (not currently used).
   *
   * @return A `Discord.OutgoingMessage`
   */
  _quickRepliesFormat(
    message: StdOutgoingQuickRepliesMessage,
    _options?: BlockOptions,
  ): Discord.OutgoingMessage {
    const row = new ActionRowBuilder<ButtonBuilder>();

    message.quickReplies.forEach((button) => {
      const discordButton = new ButtonBuilder();
      discordButton
        .setCustomId(button.payload)
        .setLabel(button.title)
        .setStyle(DiscordTypes.ButtonStyle.Primary);
      row.addComponents(discordButton);
    });

    return {
      content: message?.text,
      components: [row],
    };
  }

  /**
   * Formats a standard outgoing buttons message into a Discord-compatible message.
   * Creates a row of buttons based on the provided message buttons.
   *
   * @param message - The `StdOutgoingButtonsMessage` object containing the message text and buttons.
   * @param _options - The `BlockOptions` object for additional formatting options (not currently used).
   *
   * @return A `Discord.OutgoingMessage` object
   */
  _buttonsFormat(
    message: StdOutgoingButtonsMessage,
    _options: BlockOptions,
  ): Discord.OutgoingMessage {
    const row = new ActionRowBuilder<ButtonBuilder>();

    message.buttons.forEach((button) => {
      const discordButton = new ButtonBuilder().setLabel(button.title);

      if (button.type === ButtonType.postback) {
        discordButton
          .setCustomId(button.payload)
          .setStyle(DiscordTypes.ButtonStyle.Secondary);
      } else {
        discordButton
          .setURL(button.url)
          .setStyle(DiscordTypes.ButtonStyle.Link);
      }

      row.addComponents(discordButton);
    });

    return {
      content: message?.text,
      components: [row],
    };
  }

  /**
   * Formats a standard outgoing attachment message into a Discord-compatible message.
   * Supports optional quick replies that are displayed as buttons along with the attachment.
   *
   * @param message - The `StdOutgoingAttachmentMessage` containing the attachment details and optional quick replies.
   * @param _options - (Optional) The `BlockOptions` object for additional formatting options (not currently used).
   *
   * @return A `Discord.OutgoingMessage` object
   */
  async _attachmentFormat(
    message: StdOutgoingAttachmentMessage,
    _options?: BlockOptions,
  ): Promise<Discord.OutgoingMessage> {
    const url = await this.getPublicUrl(message.attachment.payload);
    const file = new AttachmentBuilder(url);

    if (message.quickReplies && message.quickReplies.length > 0) {
      const row = new ActionRowBuilder<ButtonBuilder>();

      message.quickReplies.forEach((button) => {
        const discordButton = new ButtonBuilder();
        discordButton
          .setCustomId(button.title)
          .setLabel(button.payload)
          .setStyle(DiscordTypes.ButtonStyle.Primary);
        row.addComponents(discordButton);
      });

      return {
        files: [file],
        components: [row],
      };
    }

    return {
      files: [file],
    };
  }

  /**
   * Formats a standard outgoing list message into a Discord-compatible message.
   *
   * @param message - The `StdOutgoingListMessage` object containing the list of items to format.
   * @param options - The `BlockOptions` object for additional formatting options.
   *
   * @return A `Discord.OutgoingMessage` object formatted as a carousel.
   */
  async _listFormat(
    message: StdOutgoingListMessage,
    options: BlockOptions,
  ): Promise<Discord.OutgoingMessage> {
    const pagination = message.pagination;

    // Generate embeds and components using _carouselFormat
    const res = await this._carouselFormat(message, options);

    // Add "View More" button if there are additional pages
    if (
      pagination &&
      pagination.total - pagination.skip - pagination.limit > 0
    ) {
      const viewMoreButton = new ButtonBuilder()
        .setLabel('View More')
        .setStyle(DiscordTypes.ButtonStyle.Primary)
        .setCustomId('VIEW_MORE');

      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        viewMoreButton,
      );
      // Add the view more button row to existing components
      if (!res.components) {
        res.components = [actionRow];
      } else {
        res.components = [...res.components, actionRow];
      }
    }

    return res;
  }

  /**
   * Discord doesn't support a carousel alike format
   */
  async _carouselFormat(
    message: StdOutgoingListMessage,
    _options: BlockOptions,
  ): Promise<Discord.OutgoingMessage> {
    const embeds: EmbedBuilder[] = [];
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const attachments: AttachmentBuilder[] = [];
    const fields = message.options.fields;

    for (const element of message.elements) {
      const embed = new EmbedBuilder().setTitle(element.title);
      const row = new ActionRowBuilder<ButtonBuilder>();

      if (fields.subtitle && element[fields.subtitle]) {
        embed.setDescription(element[fields.subtitle]);
      }

      if (fields.url && element[fields.url]) {
        embed.setURL(element[message.options.fields.url]);
      }

      if (fields.image_url && element[fields.image_url]) {
        const attachmentRef: AttachmentRef =
          typeof element[fields.image_url] === 'string'
            ? { url: element[fields.image_url] }
            : element[fields.image_url].payload;
        const url = await this.getPublicUrl(attachmentRef);
        const attachmentName = `image-${Date.now()}.png`;
        const attachment = new AttachmentBuilder(url, {
          name: attachmentName,
        });
        attachments.push(attachment);
        // Set the image in the embed using the attachment name
        embed.setImage(`attachment://${attachmentName}`);
      }

      if (message.options.buttons) {
        message.options.buttons.forEach((button) => {
          const discordButton = new ButtonBuilder()
            .setLabel(button.title)
            .setStyle(
              button.type === ButtonType.web_url
                ? DiscordTypes.ButtonStyle.Link
                : DiscordTypes.ButtonStyle.Secondary,
            );
          button.type === ButtonType.web_url &&
            discordButton.setURL(element[message.options.fields.url]);

          if (
            button.type === ButtonType.web_url &&
            message.options.fields.url &&
            element[message.options.fields.url]
          ) {
            discordButton.setURL(element[message.options.fields.url]);
          } else if (button.type === ButtonType.postback) {
            discordButton.setCustomId(button.payload);
          }

          row.addComponents(discordButton);
        });
        rows.push(row);
      }

      embeds.push(embed);
    }

    return {
      embeds,
      components: rows,
      files: attachments,
    };
  }

  /**
   * Registers slash commands for the Discord bot.
   * This function sets up commands that users can invoke using the `/` prefix in Discord.
   *
   * @return A promise that resolves when the commands are successfully registered.
   */
  private async registerSlashCommands(): Promise<void> {
    try {
      const settings = await this.getSettings();
      const rest = new REST({ version: '10' }).setToken(settings.bot_token);

      const chatCommand = new SlashCommandBuilder()
        .setName('chat')
        .setDescription('Start a conversation with the bot')
        .addStringOption((option) =>
          option
            .setName('message')
            .setDescription('Your message to the bot')
            .setRequired(true),
        )
        .setDefaultMemberPermissions(
          DiscordTypes.PermissionFlagsBits.SendMessages,
        );
      this.logger.log('Started refreshing application (/) commands.');

      await rest.put(DiscordTypes.Routes.applicationCommands(settings.app_id), {
        body: [chatCommand],
      });

      this.logger.log('Successfully registered application (/) commands.');
    } catch (error) {
      this.logger.error('Error registering slash commands:', error);
    }
  }
}
