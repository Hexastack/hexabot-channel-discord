/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Message,
} from 'discord.js';

import EventWrapper from '@/channel/lib/EventWrapper';
import {
  AttachmentForeignKey,
  AttachmentPayload,
} from '@/chat/schemas/types/attachment';
import {
  IncomingMessageType,
  StdEventType,
} from '@/chat/schemas/types/message';
import { LoggerService } from '@/logger/logger.service';

import { DiscordChannelHandler } from './index.channel';
import { Discord } from './types';

type DiscordEventAdapter =
  | {
      eventType: StdEventType.unknown;
      messageType: never;
      raw: any;
    }
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
  ButtonInteraction | ChatInputCommandInteraction | Message
> {
  protected readonly logger: LoggerService;

  constructor(
    handler: DiscordChannelHandler,
    event: ButtonInteraction | ChatInputCommandInteraction | Message,
  ) {
    super(handler, event);
  }

  _init(
    event: ButtonInteraction | ChatInputCommandInteraction | Message,
  ): void {
    if (event instanceof Message) {
      this._adapter.eventType = StdEventType.message;
      this._adapter.messageType = IncomingMessageType.message;

      this._adapter.raw = {
        original: event,
        id: event.id,
        sender: {
          id: event.author.id,
          avatarUrl: event.author.displayAvatarURL(),
          name: event.author.displayName,
        },
        recipient: {
          id: event.channelId,
        },
        timestamp: event.createdTimestamp,
        message: event.content,
      };
    } else if (event.isChatInputCommand()) {
      this._adapter.eventType = StdEventType.message;
      this._adapter.messageType = IncomingMessageType.message;

      this._adapter.raw = {
        original: event,
        id: event.id,
        sender: {
          id: event.user.id,
          avatarUrl: event.user.displayAvatarURL(),
          name: event.user.displayName,
        },
        recipient: {
          id: event.channelId,
        },
        timestamp: event.createdTimestamp,
        command: {
          name: event.commandName,
          options: {
            message: event.options.getString('message', true),
          },
        },
        channelId: event.channelId,
        guildId: event.guildId,
      };
    } else if (event.isButton()) {
      this._adapter.eventType = StdEventType.message;
      this._adapter.messageType = IncomingMessageType.postback;

      this._adapter.raw = {
        original: event,
        id: event.id,
        sender: {
          id: event.user.id,
          avatarUrl: event.user.displayAvatarURL(),
          name: event.user.displayName,
        },
        recipient: {
          id: event.channelId,
        },
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

  getOriginalEvent():
    | ButtonInteraction
    | ChatInputCommandInteraction
    | Message {
    return this._adapter.raw.original;
  }

  getOriginalMessageContent(): string {
    if ('command' in this._adapter.raw)
      return this._adapter.raw.command.options.message;

    if ('interaction' in this._adapter.raw)
      return this._adapter.raw.interaction.customId;

    if ('message' in this._adapter.raw) return this._adapter.raw.message;
  }

  getProfile(): any {
    return this._adapter.raw.sender;
  }

  getChannelData(): any {
    return {
      channelId: this._adapter.raw.recipient.id,
      guildId:
        'guildId' in this._adapter.raw ? this._adapter.raw.guildId : undefined,
    };
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
    return []; // No attachments in slash commands currently
  }

  getDeliveredMessages(): string[] {
    return []; // Discord doesn't have delivery receipts
  }

  getWatermark(): number {
    return this._adapter.raw.timestamp;
  }
}
