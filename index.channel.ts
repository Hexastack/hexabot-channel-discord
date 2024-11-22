/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonComponent,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Events,
  Message,
  MessageActionRowComponentBuilder,
  TextChannel,
} from 'discord.js';
import { Request, Response } from 'express';
import { I18nService } from 'nestjs-i18n';
import fetch from 'node-fetch';

import { AttachmentService } from '@/attachment/services/attachment.service';
import { ChannelService } from '@/channel/channel.service';
import ChannelHandler from '@/channel/lib/Handler';
import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';
import {
  OutgoingMessageFormat,
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
import { LanguageService } from '@/i18n/services/language.service';
import { LoggerService } from '@/logger/logger.service';
import { SettingService } from '@/setting/services/setting.service';
import { SocketRequest } from '@/websocket/utils/socket-request';
import { SocketResponse } from '@/websocket/utils/socket-response';

import { DiscordBotService } from './discord-api';
import { DISCORD_CHANNEL_NAME } from './settings';
import DiscordEventWrapper from './wrapper';

@Injectable()
export class DiscordChannelHandler extends ChannelHandler<
  typeof DISCORD_CHANNEL_NAME
> {
  private discordBotService: DiscordBotService;

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
  }

  getPath(): string {
    return __dirname;
  }

  getChannel(): typeof DISCORD_CHANNEL_NAME {
    return DISCORD_CHANNEL_NAME;
  }

  async init(): Promise<void> {
    try {
      this.logger.debug('Discord Channel Handler : initialization ...');
      const { bot_token, app_id } = await this.getSettings();
      this.discordBotService = new DiscordBotService(
        bot_token,
        app_id,
        this.logger,
      );
      await this.discordBotService.init();

      const client = this.discordBotService.getClient();

      // Handle buttons and slash commands
      client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isChatInputCommand())
          await this.handleSlashCommand(interaction);
        else if (interaction.isButton())
          await this.handleButtonInteraction(interaction);
      });

      // // Handle messages
      client.on(Events.MessageCreate, async (message) => {
        try {
          // Strict filtering for direct messages
          const isValidDirectMessage =
            message.channel.type === ChannelType.DM &&
            !message.author.bot &&
            !message.system &&
            message.content.trim().length > 0 &&
            !message.content.startsWith('/');
          if (isValidDirectMessage) this.handleMessage(message);
        } catch (error) {
          this.logger.error('Error processing direct message:', error);
        }
      });
    } catch (error) {
      this.logger.error('Failed to initialize DiscordHandler:', error);
    }
  }

  async handleSlashCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) {
      await interaction.reply({
        content:
          'This command can only be used in a server, not in a private message.',
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === 'chat') {
      // Ignore wait for slash command interactions
      interaction.deferReply();
      this.emitMessageEvent(interaction);
    }
  }

  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    if (interaction.isButton()) {
      // Ignore wait for button interactions
      await interaction.deferUpdate();
      // Disable all buttons after one is clicked
      await this._disableButtonInteractions(interaction);
    }
    this.emitMessageEvent(interaction);
  }

  async handleMessage(message: Message): Promise<void> {
    if (message.channel.isTextBased()) {
      (message.channel as TextChannel).sendTyping();
      this.emitMessageEvent(message);
    }
  }

  private emitMessageEvent(message: any): void {
    const handler: DiscordChannelHandler = this;
    const event = new DiscordEventWrapper(handler, message);
    this.eventEmitter.emit(`hook:chatbot:message`, event);
  }

  private async _disableButtonInteractions(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const newRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    const oldRow = interaction.message.components[0];
    oldRow.components.forEach((component: ButtonComponent) => {
      const isSelected = component.customId === interaction.customId;
      const discordButton = new ButtonBuilder()
        .setLabel(component.label)
        .setCustomId(component.customId)
        .setStyle(component.style)
        .setDisabled(true);
      isSelected && discordButton.setEmoji('✅');

      newRow.addComponents(discordButton);
    });

    await interaction.editReply({
      ...interaction,
      components: [newRow],
    });
  }

  private async _disableTextInput(message: Message): Promise<void> {
    // Disable text inputs
    await message.edit({
      components: [],
    });
  }

  handle(req: Request | SocketRequest, res: Response | SocketResponse) {
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
  _formatMessage(envelope: StdOutgoingEnvelope, options: BlockOptions): any {
    switch (envelope.format) {
      case OutgoingMessageFormat.attachment:
        return this._attachmentFormat(envelope.message, options);
      case OutgoingMessageFormat.buttons:
        return this._buttonsFormat(envelope.message, options);
      case OutgoingMessageFormat.carousel:
        return this._carouselFormat(envelope.message, options);
      case OutgoingMessageFormat.list:
        return this._listFormat(envelope.message, options);
      case OutgoingMessageFormat.quickReplies:
        return this._quickRepliesFormat(envelope.message, options);
      case OutgoingMessageFormat.text:
        return this._textFormat(envelope.message, options);

      default:
        throw new Error('Unknown message format');
    }
  }

  async sendMessage(
    event: DiscordEventWrapper,
    envelope: StdOutgoingEnvelope,
    options: any,
    context: any,
  ): Promise<{ mid: string }> {
    try {
      this.logger.log('Discord Channel Handler: Sending message ...');
      debugger;
      const client = this.discordBotService.getClient();
      const handler: DiscordChannelHandler = this;
      const originalEvent:
        | ButtonInteraction
        | ChatInputCommandInteraction
        | Message = event.getOriginalEvent();

      const payload = await handler._formatMessage(envelope, options);
      const message = event.getOriginalMessageContent();

      if (originalEvent.channel.type === ChannelType.GuildText) {
        // Create embed to show user's message
        const embed = new EmbedBuilder()
          .setColor(0x6cc853)
          .addFields(
            {
              name: `${event.getSender().first_name}:`,
              value: message,
            },
            {
              name: 'Hexabot:',
              value: payload?.content || '\u200B',
            },
          )
          .setAuthor({
            name: '\u200B',
            iconURL: event.getProfile().avatarUrl,
          });
        if (payload.files) {
          embed.setImage('attachment://' + payload.files[0].name);
        }

        const res = await (
          originalEvent as ButtonInteraction | ChatInputCommandInteraction
        ).followUp({
          embeds: [embed],
          components: payload.components,
          files: payload.files,
        });
        return { mid: res.id };
      }

      if (originalEvent.channel.type === ChannelType.DM) {
        const channel = await client.channels.fetch(
          event.getRecipientForeignId(),
        );
        if (channel?.isTextBased()) {
          const res: any = await (channel as TextChannel).send(payload);
          return { mid: res.id };
        }
      }

      // return { mid: '' };

      // const channelId = event.getRecipientForeignId();
      // const channel = await this.client.channels.fetch(channelId);

      // if (channel?.isTextBased()) {
      //   const res: any = await (channel as TextChannel).send(message);
      //   return { mid: res.id };
      // } else {
      //   this.logger.log('Channel not found or is not text-based');
      //   return { mid: '' };
      // }
    } catch (error) {
      this.logger.error('Failed to send message:', error);
      throw error;
    }
  }

  async getUserData(event: DiscordEventWrapper): Promise<SubscriberCreateDto> {
    const profile = event.getProfile();

    // Save profile picture locally if it doesn't exist
    fetch(profile.avatarUrl, {})
      .then(async (res) => {
        await this.attachmentService.uploadProfilePic(
          res,
          profile.id + '.jpeg',
        );
      })
      .catch((err: Error) => {
        // Serve a generic picture instead depending on the file existence
        this.logger.error(
          'Discord Channel Handler : Error while fetching profile picture',
          err,
        );
      });

    const defautLanguage = await this.languageService.getDefaultLanguage();

    return {
      foreign_id: event.getSenderForeignId(),
      first_name: profile.name,
      last_name: 'Discord',
      gender: '',
      channel: {
        name: this.getChannel(),
        ...event.getChannelData(),
      },
      assignedAt: null,
      assignedTo: null,
      labels: [],
      locale: profile.locale,
      language: defautLanguage.code,
      timezone: 0,
      country: '',
      lastvisit: new Date(),
      retainedFrom: new Date(),
    };
  }

  _textFormat(message: StdOutgoingTextMessage, options?: any): any {
    return {
      content: message.text,
    };
  }

  _quickRepliesFormat(
    message: StdOutgoingQuickRepliesMessage,
    _options?: any,
  ): any {
    const row = new ActionRowBuilder();
    message.quickReplies.forEach((button) => {
      const discordButton = new ButtonBuilder();
      discordButton
        .setCustomId(button.title)
        .setLabel(button.payload)
        .setStyle(ButtonStyle.Primary);
      row.addComponents(discordButton);
    });
    return {
      content: message?.text,
      components: [row],
    };
  }

  _buttonsFormat(
    message: StdOutgoingButtonsMessage,
    _options: BlockOptions,
  ): any {
    const buttonStyles = [
      ButtonStyle.Secondary,
      ButtonStyle.Success,
      ButtonStyle.Danger,
      ButtonStyle.Link,
      ButtonStyle.Premium,
    ];
    const row = new ActionRowBuilder();
    message.buttons.forEach((button, index) => {
      const discordButton = new ButtonBuilder()
        .setLabel(button.title)
        .setCustomId(button.title)
        .setStyle(buttonStyles[index % buttonStyles.length]);

      row.addComponents(discordButton);
    });
    return {
      content: message?.text,
      components: [row],
    };
  }

  async _attachmentFormat(
    message: StdOutgoingAttachmentMessage<any>,
    options?: any,
  ): Promise<any> {
    const fileStream = await this.attachmentService.download(
      message.attachment.payload,
    );
    const attachment = new AttachmentBuilder(fileStream.getStream()).setName(
      'image.png',
    );

    if (message.quickReplies && message.quickReplies.length > 0) {
      return {
        files: [attachment],
        ...this._quickRepliesFormat(message as any, options),
      };
    }
    return {
      files: [attachment],
    };
  }

  _formatElements(data: any[], options: any): any[] {
    return [];
  }

  _listFormat(message: StdOutgoingListMessage, options: any): any {
    return {};
  }

  _carouselFormat(message: StdOutgoingListMessage, options: any): any {
    return {};
  }
}
