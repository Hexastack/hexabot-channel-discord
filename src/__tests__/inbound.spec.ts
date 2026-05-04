/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { IncomingMessageType, StdEventType } from '@hexabot-ai/types';

import { DiscordInboundEventDecoder } from '../inbound';
import {
  DiscordAttachmentMessageInboundEvent,
  DiscordEchoMessageInboundEvent,
  DiscordPostbackInboundEvent,
  DiscordQuickReplyInboundEvent,
  DiscordTextMessageInboundEvent,
} from '../inbound/events';
import { DISCORD_CHANNEL_NAME } from '../settings.schema';
import { Discord } from '../types';

const attrs: Discord.ChannelAttrs = {
  channelId: 'channel-1',
  channelType: 'GuildText',
  botUserId: 'bot-1',
  applicationId: 'app-1',
  guildId: 'guild-1',
  guildName: 'Guild',
  channelName: 'general',
};

const baseMessage: Discord.MessagePayload = {
  kind: 'message',
  id: 'message-1',
  content: 'hello',
  createdTimestamp: 1710000000000,
  author: {
    id: 'user-1',
    username: 'alice',
    bot: false,
  },
  channel: {
    id: 'channel-1',
    type: 'GuildText',
    name: 'general',
  },
  guild: {
    id: 'guild-1',
    name: 'Guild',
  },
  mentionsBot: true,
  attachments: [],
};

const expectDiscordEvent = <T>(
  event: unknown,
  eventClass: abstract new (...args: any[]) => T,
): T => {
  expect(event).toBeInstanceOf(eventClass);

  return event as T;
};

describe('DiscordInboundEventDecoder', () => {
  const decoder = new DiscordInboundEventDecoder(DISCORD_CHANNEL_NAME);

  it('decodes text messages and strips bot mentions', () => {
    const [event] = decoder.createEvents(
      {
        ...baseMessage,
        content: '<@bot-1> hello',
      },
      attrs,
    );
    const messageEvent = expectDiscordEvent(
      event,
      DiscordTextMessageInboundEvent,
    );

    expect(messageEvent.getEventType()).toBe(StdEventType.message);
    expect(messageEvent.getSenderForeignId()).toBe('channel-1');
    expect(messageEvent.getMessage()).toEqual({
      type: IncomingMessageType.text,
      data: { text: 'hello' },
    });
  });

  it('decodes text plus attachments as two events', () => {
    const events = decoder.createEvents(
      {
        ...baseMessage,
        attachments: [
          {
            id: 'attachment-1',
            name: 'image.png',
            url: 'https://cdn.discordapp.com/image.png',
            contentType: 'image/png',
          },
        ],
      },
      attrs,
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toBeInstanceOf(DiscordTextMessageInboundEvent);
    const attachmentEvent = expectDiscordEvent(
      events[1],
      DiscordAttachmentMessageInboundEvent,
    );
    expect(attachmentEvent.getRemoteAttachments()).toHaveLength(1);
  });

  it('decodes bot-authored messages as echoes', () => {
    const [event] = decoder.createEvents(
      {
        ...baseMessage,
        author: {
          id: 'bot-1',
          username: 'bot',
          bot: true,
        },
        content: 'sent by bot',
      },
      attrs,
    );
    const echoEvent = expectDiscordEvent(event, DiscordEchoMessageInboundEvent);

    expect(echoEvent.getEventType()).toBe(StdEventType.echo);
    expect(echoEvent.getMessage()).toEqual({
      type: IncomingMessageType.text,
      data: { text: 'sent by bot' },
    });
  });

  it('decodes quick reply component clicks', () => {
    const [event] = decoder.createEvents(
      {
        kind: 'button',
        id: 'interaction-1',
        customId: `${Discord.QUICK_REPLY_CUSTOM_ID_PREFIX}CHOICE_A`,
        label: 'A',
        createdTimestamp: 1710000000001,
        user: {
          id: 'user-1',
          username: 'alice',
        },
        channel: {
          id: 'channel-1',
          type: 'GuildText',
        },
        guild: {
          id: 'guild-1',
          name: 'Guild',
        },
        messageId: 'message-2',
      },
      attrs,
    );
    const quickReplyEvent = expectDiscordEvent(
      event,
      DiscordQuickReplyInboundEvent,
    );

    expect(quickReplyEvent.getPayload()).toBe('CHOICE_A');
    expect(quickReplyEvent.getMessageType()).toBe(IncomingMessageType.quickReply);
  });

  it('decodes postback component clicks', () => {
    const [event] = decoder.createEvents(
      {
        kind: 'button',
        id: 'interaction-2',
        customId: `${Discord.POSTBACK_CUSTOM_ID_PREFIX}START`,
        label: 'Start',
        user: {
          id: 'user-1',
          username: 'alice',
        },
        channel: {
          id: 'channel-1',
          type: 'GuildText',
        },
        guild: null,
      },
      attrs,
    );
    const postbackEvent = expectDiscordEvent(event, DiscordPostbackInboundEvent);

    expect(postbackEvent.getPayload()).toBe('START');
    expect(postbackEvent.getMessageType()).toBe(IncomingMessageType.postback);
  });
});
