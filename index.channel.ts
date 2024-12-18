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
import { OnEvent } from '@nestjs/event-emitter/dist/decorators';
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

import { Attachment } from '@/attachment/schemas/attachment.schema';
import { AttachmentService } from '@/attachment/services/attachment.service';
import { ChannelService } from '@/channel/channel.service';
import ChannelHandler from '@/channel/lib/Handler';
import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';
import { WithUrl } from '@/chat/schemas/types/attachment';
import { ButtonType } from '@/chat/schemas/types/button';
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

  async handleSlashCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'chat') {
      if (!interaction.guild) {
        await interaction.reply({
          content:
            'This command can only be used in a server, not in a private message.',
          ephemeral: true,
        });
        return;
      }
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
    options: BlockOptions,
    context: any,
  ): Promise<{ mid: string }> {
    try {
      this.logger.log('Discord Channel Handler: Sending message ...');
      const client = this.discordBotService.getClient();
      const handler: DiscordChannelHandler = this;
      const originalEvent: any = event.getOriginalEvent();

      const payload = await handler._formatMessage(envelope, options);
      const message = event.getOriginalMessageContent();

      if (this.checkListType(envelope.format, payload)) {
        const discordChannel = await client.channels.fetch(
          event.getRecipientForeignId(),
        );
        let lastResId: string;
        for (const [embed, component, file] of payload.embeds.map(
          (embed: EmbedBuilder, i: number) => [
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
          const res = await (discordChannel as TextChannel).send(resBody);
          lastResId = res.id;
        }
        return { mid: lastResId };
      }
      if (originalEvent.channel.type === ChannelType.GuildText) {
        // Create embed to show user's message
        const embed = new EmbedBuilder().setColor(0x6cc853).addFields(
          {
            name: `${event.getSender().first_name} - ${event.getSender().last_name}`,
            value: message,
          },
          {
            name: 'Hexabot',
            value: payload?.content || '\u200B',
          },
        );

        if (payload.files) {
          embed.setImage('attachment://' + payload.files[0].name);
        }
        if ('followUp' in originalEvent) {
          const res = await originalEvent.followUp({
            embeds: [embed],
            components: payload.components,
            files: payload.files,
          });
          return { mid: res.id };
        }
      }

      if (originalEvent.channel.type === ChannelType.DM) {
        const discordChannel = await client.channels.fetch(
          event.getRecipientForeignId(),
        );

        if (discordChannel?.isTextBased()) {
          const res: Message = await (discordChannel as TextChannel).send(
            payload,
          );
          return { mid: res.id };
        }
      }
    } catch (error) {
      this.logger.error('Failed to send message:', error);
      throw error;
    }
  }

  checkListType(
    messageFormat: OutgoingMessageFormat,
    payload: Message,
  ): boolean {
    return (
      (messageFormat === OutgoingMessageFormat.list ||
        messageFormat === OutgoingMessageFormat.carousel) &&
      payload.embeds.length > 1
    );
  }

  async getUserData(event: DiscordEventWrapper): Promise<SubscriberCreateDto> {
    try {
      const profile = event.getProfile();
      if (profile.avatarUrl) {
        const avatar = await this.httpService.axiosRef({
          url: profile.avatarUrl,
          method: 'GET',
          responseType: 'arraybuffer',
        });

        await this.attachmentService.uploadProfilePic(
          avatar.data,
          profile.id + '.jpeg',
        );
      }

      const defautLanguage = await this.languageService.getDefaultLanguage();
      const profileName = event.isDM()
        ? {
            first_name: profile.username,
            last_name: '\u200B',
          }
        : {
            first_name: profile.serverName,
            last_name: profile.roomName,
          };
      return {
        foreign_id: event.getSenderForeignId(),
        ...profileName,
        gender: '',
        channel: {
          name: this.getName(),
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
    options?: BlockOptions,
  ): Discord.OutgoingMessageBase {
    return {
      content: message.text,
    };
  }

  _quickRepliesFormat(
    message: StdOutgoingQuickRepliesMessage,
    _options?: BlockOptions,
  ): Discord.OutgoingMessageBase {
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
  ): Discord.OutgoingMessageBase {
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

  _attachmentFormat(
    message: StdOutgoingAttachmentMessage<WithUrl<Attachment>>,
    options?: BlockOptions,
  ): Discord.OutgoingMessageBase {
    const attachment = new AttachmentBuilder(message.attachment.payload.url);

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

  _listFormat(
    message: StdOutgoingListMessage,
    options: BlockOptions,
  ): Discord.OutgoingMessageBase {
    const res = this._carouselFormat(message, options);
    res.components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('View More')
          .setCustomId('View More')
          .setStyle(ButtonStyle.Primary),
      ),
    );
    return res;
  }

  _carouselFormat(
    message: StdOutgoingListMessage,
    options: BlockOptions,
  ): Discord.OutgoingMessageBase {
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
                ? ButtonStyle.Link
                : ButtonStyle.Primary,
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
