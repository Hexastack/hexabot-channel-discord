/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import * as DiscordTypes from 'discord.js';

import EventWrapper from '@/channel/lib/EventWrapper';
import {
  AttachmentForeignKey,
  AttachmentPayload,
  FileType,
} from '@/chat/schemas/types/attachment';
import {
  IncomingMessageType,
  PayloadType,
  StdEventType,
  StdIncomingMessage,
} from '@/chat/schemas/types/message';
import { LoggerService } from '@/logger/logger.service';

import { Attachment } from '@/attachment/schemas/attachment.schema';
import { Payload } from '@/chat/schemas/types/quick-reply';
import { DiscordChannelHandler } from './index.channel';
import { DISCORD_CHANNEL_NAME } from './settings';
import { Discord } from './types';

type DiscordEventAdapter =
  | {
    eventType: StdEventType.unknown;
    messageType: never;
    raw: Discord.IncomingEvent;
  }
  | {
    eventType: StdEventType.echo;
    messageType: IncomingMessageType.message;
    raw: DiscordTypes.OmitPartialGroupDMChannel<DiscordTypes.Message<boolean>>;
  }
  | {
    eventType: StdEventType.message;
    messageType: IncomingMessageType.message;
    raw: DiscordTypes.OmitPartialGroupDMChannel<DiscordTypes.Message<boolean>>;
  }
  | {
    eventType: StdEventType.message;
    messageType: IncomingMessageType.postback;
    raw: DiscordTypes.ButtonInteraction<DiscordTypes.CacheType>;
  }

  | {
    eventType: StdEventType.message;
    messageType: IncomingMessageType.attachments;
    raw: DiscordTypes.OmitPartialGroupDMChannel<DiscordTypes.Message<boolean>>;
  };

export default class DiscordEventWrapper extends EventWrapper<
  DiscordEventAdapter,
  Discord.IncomingEvent,
  typeof DISCORD_CHANNEL_NAME
> {
  protected readonly logger: LoggerService;

  constructor(handler: DiscordChannelHandler, event: Discord.IncomingEvent) {
    super(handler, event, {
      channelType: event.channel.type
    });
  }

  _init(event: Discord.IncomingEvent): void {
    if ('customId' in event) {
      this._adapter.eventType = StdEventType.message
      this._adapter.messageType = IncomingMessageType.postback
    } else if ('content' in event) {
      this._adapter.eventType = event.author.bot ? StdEventType.echo : StdEventType.message;
      this._adapter.messageType = event.attachments.size > 0 ? IncomingMessageType.attachments : IncomingMessageType.message
    } else {
      this._adapter.eventType = StdEventType.unknown;
    }
    
    this._adapter.raw = event
  }

  getId(): string {
    if (this.getMessageType() === IncomingMessageType.attachments) {
      // Since we emit 2 events whenever we receive attachments
      return `attachment-${this._adapter.raw.id}`;
    }
    return this._adapter.raw.id;
  }


  getSenderInfo(): { avatarUrl: string, firstName: string, lastName: string } {
    const event = this._adapter.raw;
    // Set the sender based on the event channel type
    if (event.channel.type === DiscordTypes.ChannelType.GuildText) {
      return {
        avatarUrl: event.channel.guild.iconURL(),
        firstName: event.channel.guild.name,
        lastName: event.channel.name,
      };
    } else if (event.channel.type === DiscordTypes.ChannelType.DM) {
      if (event instanceof DiscordTypes.Message) {
        return {
          avatarUrl: event.author.displayAvatarURL(),
          firstName: event.author.username,
          lastName: '\u200B',
        };
      } else if (event instanceof DiscordTypes.ButtonInteraction) {
        return {
          avatarUrl: event.user.displayAvatarURL(),
          firstName: event.user.username,
          lastName: '\u200B',
        };
      }
    } else {
      throw new Error('Unable to extract event profile!')
    }
  }

  getSenderForeignId(): string {
    return this._adapter.raw.channel.id
  }

  getRecipientForeignId(): string {
    return this._adapter.raw.channel.id
  }

  getPayload(): Payload | string | undefined {
    if (this._adapter.messageType === IncomingMessageType.postback) {
      return this._adapter.raw.customId;
    } else if (this._adapter.messageType === IncomingMessageType.attachments) {
      const [attachment] = Array.from(this._adapter.raw.attachments.values());
      return {
        type: PayloadType.attachments,
        attachments: {
          type: Attachment.getTypeByMime(attachment.contentType),
          payload: {
            url: attachment?.url || '',
          },
        },
      };
    }
    return undefined
  }

  getMessage(): StdIncomingMessage {
    if (this._adapter.messageType === IncomingMessageType.message) {
      return {
        text: this._adapter.raw.content,
      };
    } else if (this._adapter.messageType === IncomingMessageType.postback) {
      const postback = this._adapter.raw.customId
      const component = this._adapter.raw.message.components[0].components.find(({ customId }) => customId === postback) as DiscordTypes.ButtonComponent
      return {
        postback,
        text: component.label,
      };
    }

    throw new Error('Unknown incoming message type');
  }

  getAttachments(): AttachmentPayload<AttachmentForeignKey>[] {
    if (this._adapter.messageType === IncomingMessageType.attachments && this._adapter.raw.attachments?.size > 0) {
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
    return this._adapter.raw.createdTimestamp;
  }
}
