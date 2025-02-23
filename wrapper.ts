/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import * as DiscordTypes from 'discord.js';

import { Attachment } from '@/attachment/schemas/attachment.schema';
import EventWrapper from '@/channel/lib/EventWrapper';
import { FileType } from '@/chat/schemas/types/attachment';
import {
  IncomingMessageType,
  StdEventType,
  StdIncomingMessage,
} from '@/chat/schemas/types/message';
import { Payload } from '@/chat/schemas/types/quick-reply';
import { LoggerService } from '@/logger/logger.service';
import { PayloadType } from '@/chat/schemas/types/button';
import { DiscordChannelHandler } from './index.channel';
import { DISCORD_CHANNEL_NAME } from './settings';
import { Discord } from './types';

type DiscordEventAdapter =
  | {
      eventType: StdEventType.unknown;
      messageType: never;
      raw: Discord.IncomingEvent;
      attachments: never;
    }
  | {
      eventType: StdEventType.echo;
      messageType: IncomingMessageType.message;
      raw: DiscordTypes.OmitPartialGroupDMChannel<
        DiscordTypes.Message<boolean>
      >;
      attachments: never;
    }
  | {
      eventType: StdEventType.message;
      messageType: IncomingMessageType.message;
      raw: DiscordTypes.OmitPartialGroupDMChannel<
        DiscordTypes.Message<boolean>
      >;
      attachments: never;
    }
  | {
      eventType: StdEventType.message;
      messageType: IncomingMessageType.postback;
      raw: DiscordTypes.ButtonInteraction<DiscordTypes.CacheType>;
      attachments: never;
    }
  | {
      eventType: StdEventType.message;
      messageType: IncomingMessageType.attachments;
      raw: DiscordTypes.OmitPartialGroupDMChannel<
        DiscordTypes.Message<boolean>
      >;
      attachments: Attachment[];
    };

export default class DiscordEventWrapper extends EventWrapper<
  DiscordEventAdapter,
  Discord.IncomingEvent,
  typeof DISCORD_CHANNEL_NAME,
  DiscordChannelHandler
> {
  protected readonly logger: LoggerService;

  constructor(handler: DiscordChannelHandler, event: Discord.IncomingEvent) {
    if (!event.channel || !(event.channel.type in DiscordTypes.ChannelType)) {
      throw new Error('Unable to determine the channel type');
    }

    super(handler, event, {
      channelType: event.channel?.type,
    });
  }

  /**
   * Initializes the Discord event adapter with the provided incoming event.
   * Determines the event type and message type based on the structure of the event.
   *
   * @param event - The incoming event from Discord.
   * @return - Updates the adapter with the processed event details.
   */
  _init(event: Discord.IncomingEvent): void {
    if ('customId' in event) {
      this._adapter.eventType = StdEventType.message;
      this._adapter.messageType = IncomingMessageType.postback;
    } else if ('content' in event) {
      this._adapter.eventType = event.author.bot
        ? StdEventType.echo
        : StdEventType.message;
      this._adapter.messageType =
        event.attachments.size > 0
          ? IncomingMessageType.attachments
          : IncomingMessageType.message;
    } else {
      this._adapter.eventType = StdEventType.unknown;
    }

    this._adapter.raw = event;
  }

  /**
   * Retrieves the unique identifier for the current event.
   * If the message type is `attachments`, a prefixed ID is returned to handle
   * cases where multiple events are emitted for attachments.
   *
   * @return The unique identifier for the event, with a prefix if the message type is `attachments`.
   */
  getId(): string {
    if (this.getMessageType() === IncomingMessageType.attachments) {
      // Since we emit 2 events whenever we receive attachments
      return `attachment-${this._adapter.raw.id}`;
    }
    return this._adapter.raw.id;
  }

  /**
   * Retrieves sender information based on the event's channel type.
   * The sender's information includes avatar URL, first name, and last name.
   *
   * @return An object containing the sender's details
   */
  getSenderInfo(): {
    avatarUrl: string | null;
    firstName: string;
    lastName: string;
  } {
    const event = this._adapter.raw;
    // Set the sender based on the event channel type
    if (
      event.channel &&
      event.channel.type === DiscordTypes.ChannelType.GuildText
    ) {
      return {
        avatarUrl: event.channel.guild.iconURL(),
        firstName: event.channel.guild.name,
        lastName: event.channel.name,
      };
    } else if (
      event.channel &&
      event.channel.type === DiscordTypes.ChannelType.DM
    ) {
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
    }

    throw new Error('Unable to extract sender profile!');
  }

  /**
   * Retrieves the foreign ID of the sender.
   * This ID corresponds to the channel ID associated with the event.
   *
   * @return The foreign ID of the sender.
   */
  getSenderForeignId(): string {
    if (!this._adapter.raw.channel?.id) {
      throw new Error('Unable to get the sender foreign id');
    }

    return this._adapter.raw.channel.id;
  }

  /**
   * Retrieves the foreign ID of the recipient.
   * This ID corresponds to the channel ID associated with the event.
   * Used specifically in cases of an echo event.
   *
   * @return The foreign ID of the recipient.
   */
  getRecipientForeignId(): string {
    if (!this._adapter.raw.channel?.id) {
      throw new Error('Unable to get the recipient foreign id');
    }

    return this._adapter.raw.channel?.id;
  }

  /**
   * Retrieves the payload associated with the current event.
   *
   * @return The payload of the event
   */
  getPayload(): Payload | string | undefined {
    if (this._adapter.messageType === IncomingMessageType.postback) {
      return this._adapter.raw.customId;
    } else if (this._adapter.messageType === IncomingMessageType.attachments) {
      if (this._adapter.attachments.length === 0) {
        return {
          type: PayloadType.attachments,
          attachment: {
            type: FileType.unknown,
            payload: { id: null },
          },
        };
      }

      const attachmentPayloads = this._adapter.attachments.map(
        (attachment) => ({
          type: Attachment.getTypeByMime(attachment.type),
          payload: {
            id: attachment.id,
          },
        }),
      );

      return {
        type: PayloadType.attachments,
        attachment: attachmentPayloads[0],
      };
    }
    return undefined;
  }

  /**
   * Retrieves the standardized incoming message based on the event type.
   *
   * @return A `StdIncomingMessage` object containing the message
   */
  getMessage(): StdIncomingMessage {
    if (this._adapter.messageType === IncomingMessageType.message) {
      return {
        text: this._adapter.raw.content,
      };
    } else if (this._adapter.messageType === IncomingMessageType.postback) {
      const postback = this._adapter.raw.customId;
      const component = this._adapter.raw.message.components[0].components.find(
        ({ customId }) => customId === postback,
      ) as DiscordTypes.ButtonComponent;
      return {
        postback,
        text: component.label || '',
      };
    } else if (this._adapter.messageType === IncomingMessageType.attachments) {
      if (
        !this._adapter.attachments ||
        this._adapter.attachments.length === 0
      ) {
        return {
          type: PayloadType.attachments,
          serialized_text: `attachment:${FileType.unknown}`,
          attachment: [],
        };
      }
      const attachmentPayloads = this._adapter.attachments.map(
        (attachment) => ({
          type: Attachment.getTypeByMime(attachment.type),
          payload: {
            id: attachment.id,
          },
        }),
      );
      return {
        type: PayloadType.attachments,
        serialized_text: `attachment:${attachmentPayloads[0].type}:${this._adapter.attachments[0].name}`,
        attachment:
          attachmentPayloads.length === 1
            ? attachmentPayloads[0]
            : attachmentPayloads,
      };
    }

    throw new Error('Unknown incoming message type');
  }

  /**
   * Retrieves the list of delivered message IDs.
   * Since Discord does not support delivery receipts, this function always returns an empty array.
   *
   * @return An empty array, as Discord does not provide delivery receipt functionality.
   */
  getDeliveredMessages(): string[] {
    return []; // Discord doesn't have delivery receipts
  }

  /**
   * Retrieves the timestamp of the event creation as the watermark.
   * This timestamp represents the time when the event was created on Discord.
   *
   * @return A number representing the event's creation timestamp in milliseconds since the Unix epoch.
   */
  getWatermark(): number {
    return this._adapter.raw.createdTimestamp;
  }
}
