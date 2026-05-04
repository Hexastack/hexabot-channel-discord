/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ChannelInboundEvent,
  ChannelInboundEventContext,
  ChannelInboundEventDecoder,
} from '@hexabot-ai/api';
import { Injectable, Type } from '@nestjs/common';

import { DISCORD_CHANNEL_NAME } from '../settings.schema';
import { Discord } from '../types';

import DiscordAttachmentMessageInboundEvent from './events/messages/attachment.event';
import DiscordEchoMessageInboundEvent from './events/messages/echo.event';
import DiscordPostbackInboundEvent from './events/messages/postback.event';
import DiscordQuickReplyInboundEvent from './events/messages/quick-reply.event';
import DiscordTextMessageInboundEvent from './events/messages/text.event';

export class DiscordInboundEventDecoder
  implements
    ChannelInboundEventDecoder<
      typeof DISCORD_CHANNEL_NAME,
      ChannelInboundEvent<
        typeof DISCORD_CHANNEL_NAME,
        Discord.IncomingPayload,
        Discord.ChannelAttrs
      >,
      Discord.ChannelAttrs
    >
{
  readonly channel: typeof DISCORD_CHANNEL_NAME;

  constructor(channel: typeof DISCORD_CHANNEL_NAME = DISCORD_CHANNEL_NAME) {
    this.channel = channel;
  }

  createEvents(
    raw: unknown,
    channelAttrs: Discord.ChannelAttrs,
  ): Array<
    ChannelInboundEvent<
      typeof DISCORD_CHANNEL_NAME,
      Discord.IncomingPayload,
      Discord.ChannelAttrs
    >
  > {
    const event = Discord.incomingPayloadSchema.parse(raw);

    if (event.kind === 'button') {
      const componentEvent = this.createButtonEvent(event, channelAttrs);

      return componentEvent ? [componentEvent] : [];
    }

    return this.createMessageEvents(event, channelAttrs);
  }

  private createMessageEvents(
    event: Discord.MessagePayload,
    channelAttrs: Discord.ChannelAttrs,
  ): Array<
    ChannelInboundEvent<
      typeof DISCORD_CHANNEL_NAME,
      Discord.IncomingPayload,
      Discord.ChannelAttrs
    >
  > {
    const text = this.cleanText(event.content, channelAttrs.botUserId);
    const context = this.createMessageContext(event, channelAttrs, event.id);

    if (event.author.bot) {
      return text
        ? [new DiscordEchoMessageInboundEvent(context, text)]
        : [];
    }

    const events: Array<
      ChannelInboundEvent<
        typeof DISCORD_CHANNEL_NAME,
        Discord.IncomingPayload,
        Discord.ChannelAttrs
      >
    > = [];

    if (text) {
      events.push(new DiscordTextMessageInboundEvent(context, text));
    }

    if (event.attachments.length > 0) {
      events.push(
        new DiscordAttachmentMessageInboundEvent(
          this.createMessageContext(event, channelAttrs, `attachment:${event.id}`),
          event.attachments,
        ),
      );
    }

    return events;
  }

  private createButtonEvent(
    event: Discord.ButtonPayload,
    channelAttrs: Discord.ChannelAttrs,
  ): ChannelInboundEvent<
    typeof DISCORD_CHANNEL_NAME,
    Discord.IncomingPayload,
    Discord.ChannelAttrs
  > | null {
    const component = this.parseComponentPayload(event.customId);

    if (!component.payload) {
      return null;
    }

    const text = event.label ?? component.payload;
    const context = this.createButtonContext(event, channelAttrs);

    return component.kind === 'quickReply'
      ? new DiscordQuickReplyInboundEvent(context, component.payload, text)
      : new DiscordPostbackInboundEvent(context, component.payload, text);
  }

  private createMessageContext(
    event: Discord.MessagePayload,
    channelAttrs: Discord.ChannelAttrs,
    eventId: string,
  ): ChannelInboundEventContext<
    typeof DISCORD_CHANNEL_NAME,
    Discord.IncomingPayload,
    Discord.ChannelAttrs
  > {
    return new ChannelInboundEventContext(
      this.channel,
      event,
      channelAttrs,
      this.getOccurredAt(event.createdTimestamp),
      eventId,
      channelAttrs.channelId,
      channelAttrs.botUserId ?? channelAttrs.applicationId,
    );
  }

  private createButtonContext(
    event: Discord.ButtonPayload,
    channelAttrs: Discord.ChannelAttrs,
  ): ChannelInboundEventContext<
    typeof DISCORD_CHANNEL_NAME,
    Discord.IncomingPayload,
    Discord.ChannelAttrs
  > {
    return new ChannelInboundEventContext(
      this.channel,
      event,
      channelAttrs,
      this.getOccurredAt(event.createdTimestamp),
      `interaction:${event.id}`,
      channelAttrs.channelId,
      channelAttrs.botUserId ?? channelAttrs.applicationId,
    );
  }

  private cleanText(text: string, botUserId: string | undefined): string {
    if (!botUserId) {
      return text.trim();
    }

    return text
      .replace(new RegExp(`<@!?${this.escapeRegExp(botUserId)}>`, 'g'), '')
      .trim();
  }

  private parseComponentPayload(customId: string): Discord.ComponentPayload {
    if (customId.startsWith(Discord.QUICK_REPLY_CUSTOM_ID_PREFIX)) {
      return {
        kind: 'quickReply',
        payload: customId.slice(Discord.QUICK_REPLY_CUSTOM_ID_PREFIX.length),
      };
    }

    if (customId.startsWith(Discord.POSTBACK_CUSTOM_ID_PREFIX)) {
      return {
        kind: 'postback',
        payload: customId.slice(Discord.POSTBACK_CUSTOM_ID_PREFIX.length),
      };
    }

    return {
      kind: 'postback',
      payload: customId,
    };
  }

  private getOccurredAt(timestamp: number | undefined): Date {
    if (typeof timestamp === 'number') {
      const date = new Date(timestamp);

      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    return new Date();
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export function createDiscordInboundEventDecoder(
  channelName: string,
): Type<DiscordInboundEventDecoder> {
  @Injectable()
  class BoundDiscordInboundEventDecoder extends DiscordInboundEventDecoder {
    constructor() {
      super(channelName as typeof DISCORD_CHANNEL_NAME);
    }
  }

  return BoundDiscordInboundEventDecoder;
}

export default DiscordInboundEventDecoder;
