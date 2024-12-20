/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter/dist/decorators';
import * as DiscordTypes from 'discord.js';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  EmbedBuilder,
} from 'discord.js';
import { Request, Response } from 'express';
import { I18nService } from 'nestjs-i18n';

import { Attachment } from '@/attachment/schemas/attachment.schema';
import { AttachmentService } from '@/attachment/services/attachment.service';
import { ChannelService } from '@/channel/channel.service';
import ChannelHandler from '@/channel/lib/Handler';
import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';
import { WithUrl } from '@/chat/schemas/types/attachment';
import { ButtonType } from '@/chat/schemas/types/button';
import {
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
import { LanguageService } from '@/i18n/services/language.service';
import { LoggerService } from '@/logger/logger.service';
import { Setting } from '@/setting/schemas/setting.schema';
import { SettingService } from '@/setting/services/setting.service';
import { THydratedDocument } from '@/utils/types/filter.types';
import { SocketRequest } from '@/websocket/utils/socket-request';
import { SocketResponse } from '@/websocket/utils/socket-response';

import { DiscordBotService } from './discord-api';
import { DISCORD_CHANNEL_NAME } from './settings';
import { Discord } from './types';
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
    this.logger.setContext('Discord Channel');
  }

  getPath(): string {
    return __dirname;
  }

  async init(): Promise<void> {
    try {
      this.logger.debug('Discord Channel Handler : initialization ...');
      const { bot_token, app_id } = await this.getSettings();
      this.discordBotService = new DiscordBotService(
        bot_token,
        app_id,
        this.menuService,
        this.logger,
      );
      await this.discordBotService.init();

      const client = this.discordBotService.getClient();

      // Handle button postbacks
      client.on(DiscordTypes.Events.InteractionCreate, async (interaction) => {
        if (interaction.isButton()) {
          // Ignore wait for button interactions
          await interaction.deferUpdate();
          // Disable all buttons after one is clicked
          await this.disableButtonInteractions(interaction);

          this.emitEvent(interaction);
        } else {
          this.logger.debug('Unhandled interaction ...', interaction);
        }
      });

      // Handle messages
      client.on(DiscordTypes.Events.MessageCreate, async (message) => {
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
            !message.mentions.has(client.user)
          ) {
            this.logger.debug('Ignoring guild message without mention ...');
            return;
          }

          // Extract the mention and remove it from the message content
          if (message.channel.type === DiscordTypes.ChannelType.GuildText) {
            const botMention = `<@${client.user?.id}>`; // Format for the bot mention
            message.content = message.content.replaceAll(botMention, '').trim();
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

  /**
   * Updates the bot token for the Discord Bot Application
   *
   * @param setting
   */
  @OnEvent('hook:discord_channel:bot_token')
  async updateBotToken(setting: THydratedDocument<Setting>) {
    this.discordBotService.setBotToken(setting.value);
  }

  /**
   * Updates the app id for the Discord Bot Application
   *
   * @param setting
   */
  @OnEvent('hook:discord_channel:app_id')
  async updateAppId(setting: THydratedDocument<Setting>) {
    this.discordBotService.setAppId(setting.value);
  }

  private emitEvent(e: Discord.IncomingEvent): void {
    const event = new DiscordEventWrapper(this, e);
    const eventType = event.getEventType();
    if (eventType !== StdEventType.unknown) {
      this.eventEmitter.emit(`hook:chatbot:${eventType}`, event);
    } else {
      this.logger.error('Unknown event type', e);
    }
  }

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
    options: BlockOptions,
    _context: any,
  ): Promise<{ mid: string }> {
    try {
      this.logger.log('Discord Channel Handler: Sending message ...');
      const client = this.discordBotService.getClient();

      const payload = await this._formatMessage(envelope, options);

      const discordChannel = (await client.channels.fetch(
        event.getSenderForeignId(),
      )) as unknown as DiscordTypes.TextChannel;

      // Send typing indicator
      if (options.typing) {
        await discordChannel.sendTyping();
      }

      if (
        (envelope.format === OutgoingMessageFormat.list ||
          envelope.format === OutgoingMessageFormat.carousel) &&
        'embeds' in payload
      ) {
        let lastResId: string;
        for (const [embed, component, file] of payload.embeds.map(
          (embed: DiscordTypes.EmbedBuilder, i: number) => [
            embed,
            payload.components[i],
            payload.files[i],
          ],
        )) {
          const resBody = {
            content: '\u200B',
            embeds: [embed],
          };
          component && (resBody['components'] = [component]);
          file && (resBody['files'] = [file]);
          const res = await discordChannel.send(resBody as any);
          lastResId = res.id;
        }

        return { mid: lastResId };
      }

      if (discordChannel?.isTextBased()) {
        const res = await discordChannel.send(payload);
        return { mid: res.id };
      } else {
        throw new Error('Only text-based channels are supported (For now ...)');
      }
    } catch (error) {
      this.logger.error('Failed to send message:', error);
      throw error;
    }
  }

  async getUserData(event: DiscordEventWrapper): Promise<SubscriberCreateDto> {
    try {
      const foreignId = event.getSenderForeignId();
      const info = event.getSenderInfo();

      // Store subscriber/channel avatar
      if (info.avatarUrl) {
        const avatar = await this.httpService.axiosRef({
          url: info.avatarUrl,
          method: 'GET',
          responseType: 'arraybuffer',
        });

        await this.attachmentService.uploadProfilePic(
          avatar.data,
          foreignId + '.jpeg',
        );
      }

      const defautLanguage = await this.languageService.getDefaultLanguage();
      return {
        foreign_id: foreignId,
        first_name: info.firstName,
        last_name: info.lastName,
        gender: '',
        channel: event.getChannelData(),
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

  _textFormat(
    message: StdOutgoingTextMessage,
    _options?: BlockOptions,
  ): Discord.OutgoingMessage {
    return {
      content: message.text,
    };
  }

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

  async _attachmentFormat(
    message: StdOutgoingAttachmentMessage<WithUrl<Attachment>>,
    _options?: BlockOptions,
  ): Promise<Discord.OutgoingMessage> {
    const attachment = message.attachment.payload;
    const file = new AttachmentBuilder(
      Attachment.getAttachmentUrl(attachment.id, attachment.name),
    );

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

  _listFormat(
    message: StdOutgoingListMessage,
    options: BlockOptions,
  ): Discord.OutgoingMessage {
    const res = this._carouselFormat(message, options);
    // res.components.push(
    //   new ActionRowBuilder().addComponents(
    //     new ButtonBuilder()
    //       .setLabel('View More')
    //       .setCustomId('View More'),
    //   ),
    // );
    return res;
  }

  _carouselFormat(
    message: StdOutgoingListMessage,
    _options: BlockOptions,
  ): Discord.OutgoingMessage {
    const embeds = [];
    const rows = [];
    const attachments: AttachmentBuilder[] = [];

    message.elements.forEach((element) => {
      const embed = new EmbedBuilder().setTitle(element.title);
      const row = new ActionRowBuilder();

      if (
        message.options.fields.subtitle &&
        element[message.options.fields.subtitle]
      ) {
        embed.setDescription(element[message.options.fields.subtitle]);
      }

      if (message.options.fields.url && element[message.options.fields.url]) {
        embed.setURL(element[message.options.fields.url]);
      }

      if (
        message.options.fields.image_url &&
        element[message.options.fields.image_url]
      ) {
        const url = element[message.options.fields.image_url].payload.url;
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
    });

    return {
      embeds: [...embeds],
      components: [...rows],
      files: attachments,
    };
  }
}
