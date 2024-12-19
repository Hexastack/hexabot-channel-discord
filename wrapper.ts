/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  ButtonInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  Message,
} from 'discord.js';

import EventWrapper from '@/channel/lib/EventWrapper';
import {
  AttachmentForeignKey,
  AttachmentPayload,
  FileType,
} from '@/chat/schemas/types/attachment';
import {
  IncomingMessageType,
  StdEventType,
} from '@/chat/schemas/types/message';
import { LoggerService } from '@/logger/logger.service';

import { DiscordChannelHandler } from './index.channel';
import { DISCORD_CHANNEL_NAME } from './settings';
import { Discord } from './types';

type DiscordEventAdapter =
  | {
      eventType: StdEventType.message;
      messageType: IncomingMessageType.postback;
      raw: Discord.IncomingMessage & Discord.IncomingButtonInteraction;
    }
  | {
      eventType: StdEventType.message;
      messageType: IncomingMessageType.message;
      raw: Discord.IncomingMessage & Discord.IncomingSlashCommand;
    }
  | {
      eventType: StdEventType.message;
      messageType: IncomingMessageType.message;
      raw: Discord.IncomingMessage & Discord.IncomingMessageComponent;
    };

export default class DiscordEventWrapper extends EventWrapper<
  DiscordEventAdapter,
  Discord.Event,
  typeof DISCORD_CHANNEL_NAME
> {
  protected readonly logger: LoggerService;

  constructor(handler: DiscordChannelHandler, event: Discord.Event) {
    super(handler, event);
  }

  _init(event: Discord.Event): void {
    this._adapter.eventType = StdEventType.message;
    // Common properties
    this._adapter.raw = {
      ...this._adapter.raw,
      original: event,
      id: event.id,
      recipient: {
        id: event.channel.id,
        name: DISCORD_CHANNEL_NAME,
        type: event.channel.type,
      },
    };
    // Set the sender based on the event channel type
    if (event.channel.type === ChannelType.GuildText) {
      this._adapter.raw.sender = {
        id: event.channel.id,
        avatarUrl: event.channel.guild.iconURL(),
        serverName: event.channel.guild.name,
        roomName: event.channel.name,
        type: ChannelType.GuildText,
      };
    } else if (event.channel.type === ChannelType.DM) {
      if (event instanceof Message) {
        this._adapter.raw.sender = {
          id: event.channel.id,
          avatarUrl: event.author.displayAvatarURL(),
          username: event.author.username,
          type: ChannelType.DM,
        };
      } else if (event instanceof ButtonInteraction) {
        this._adapter.raw.sender = {
          id: event.channelId,
          avatarUrl: event.user.displayAvatarURL(),
          username: event.user.username,
          type: ChannelType.DM,
        };
      }
    }

    // Set message properties based on the event type
    if (event instanceof Message) {
      this._adapter.messageType = IncomingMessageType.message;

      this._adapter.raw = {
        ...this._adapter.raw,
        message: event.content,

        timestamp: event.createdTimestamp,
      };

      if (event.attachments.size > 0) {
        this._adapter.raw = {
          ...this._adapter.raw,
          attachments: event.attachments,
        };
      }
    } else if (event instanceof ChatInputCommandInteraction) {
      this._adapter.messageType = IncomingMessageType.message;

      this._adapter.raw = {
        ...this._adapter.raw,

        timestamp: event.createdTimestamp,
        command: {
          name: event.commandName,
          options: {
            message: event.options.getString('message', true),
          },
        },
      };
    } else if (event instanceof ButtonInteraction) {
      this._adapter.messageType = IncomingMessageType.postback;

      this._adapter.raw = {
        ...this._adapter.raw,

        timestamp: event.createdTimestamp,
        interaction: {
          customId: event.customId,
          message: event.message.content,
        },
      };
    }
  }

  getId(): string {
    return this._adapter.raw.id;
  }

  getOriginalEvent(): Discord.Event {
    return this._adapter.raw.original;
  }

  getOriginalMessageContent(): string {
    if ('command' in this._adapter.raw)
      return this._adapter.raw.command.options.message;

    if ('interaction' in this._adapter.raw)
      return this._adapter.raw.interaction.customId;

    if ('message' in this._adapter.raw) return this._adapter.raw.message;
  }

  isDM(): boolean {
    return this._adapter.raw.sender.type === ChannelType.DM;
  }

  getProfile(): any {
    return this._adapter.raw.sender;
  }

  getChannelData(): any {
    return this._adapter.raw.recipient;
  }

  getSenderForeignId(): string {
    return this._adapter.raw.sender.id;
  }

  getRecipientForeignId(): string {
    return this._adapter.raw.recipient.id;
  }

  getEventType(): StdEventType {
    return this._adapter.eventType;
  }

  getMessageType(): IncomingMessageType {
    return this._adapter.messageType || IncomingMessageType.unknown;
  }

  getPayload(): string | undefined {
    if (this._adapter.messageType === IncomingMessageType.postback) {
      return this._adapter.raw.interaction.customId;
    }
    return undefined;
  }

  getMessage(): any {
    if (this._adapter.eventType !== StdEventType.message) {
      throw new Error('Called getMessage() on a non-message event');
    }

    if (this._adapter.messageType === IncomingMessageType.message) {
      if ('command' in this._adapter.raw) {
        return {
          text: this._adapter.raw.command.options.message,
        };
      }
      // Handle direct message
      if ('message' in this._adapter.raw) {
        return {
          text: this._adapter.raw.message,
        };
      }
    }

    if (this._adapter.messageType === IncomingMessageType.postback) {
      return {
        text: this._adapter.raw.interaction.customId,
        // text: this._adapter.raw.interaction.message.content,
      };
    }

    throw new Error('Unknown incoming message type');
  }

  getAttachments(): AttachmentPayload<AttachmentForeignKey>[] {
    if ('attachments' in this._adapter.raw) {
      return Array.from(this._adapter.raw.attachments.values()).map(
        (attachment) => ({
          type: attachment.contentType.split('/')[0] as FileType,
          payload: {
            url: attachment.url,
            attachment_id: attachment.id,
          },
        }),
      );
    }
    return [];
  }

  getDeliveredMessages(): string[] {
    return []; // Discord doesn't have delivery receipts
  }

  getWatermark(): number {
    return this._adapter.raw.timestamp;
  }
}
