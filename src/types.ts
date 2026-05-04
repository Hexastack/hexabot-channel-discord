/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { MessageCreateOptions } from 'discord.js';
import { z } from 'zod';

export namespace Discord {
  export type ChannelAttrs = SubscriberChannelDict['discord'];

  export const QUICK_REPLY_CUSTOM_ID_PREFIX = 'hexabot:qr:';
  export const POSTBACK_CUSTOM_ID_PREFIX = 'hexabot:pb:';

  const userSchema = z.looseObject({
    id: z.string(),
    username: z.string().optional(),
    displayName: z.string().optional(),
    bot: z.boolean().default(false),
    avatarUrl: z.string().nullable().optional(),
  });

  const guildSchema = z.looseObject({
    id: z.string(),
    name: z.string().optional(),
    iconUrl: z.string().nullable().optional(),
  });

  const channelSchema = z.looseObject({
    id: z.string(),
    type: z.string(),
    name: z.string().optional(),
  });

  export const attachmentSchema = z.looseObject({
    id: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    url: z.string(),
    proxyUrl: z.string().optional(),
    size: z.number().optional(),
    contentType: z.string().nullable().optional(),
  });

  export type Attachment = z.infer<typeof attachmentSchema>;

  export const messagePayloadSchema = z.looseObject({
    kind: z.literal('message'),
    id: z.string(),
    content: z.string().default(''),
    createdTimestamp: z.number().optional(),
    author: userSchema,
    channel: channelSchema,
    guild: guildSchema.nullable().optional(),
    mentionsBot: z.boolean().default(false),
    attachments: z.array(attachmentSchema).default([]),
  });

  export type MessagePayload = z.infer<typeof messagePayloadSchema>;

  export const buttonPayloadSchema = z.looseObject({
    kind: z.literal('button'),
    id: z.string(),
    customId: z.string(),
    label: z.string().optional(),
    createdTimestamp: z.number().optional(),
    user: userSchema,
    channel: channelSchema,
    guild: guildSchema.nullable().optional(),
    messageId: z.string().optional(),
  });

  export type ButtonPayload = z.infer<typeof buttonPayloadSchema>;

  export const incomingPayloadSchema = z.discriminatedUnion('kind', [
    messagePayloadSchema,
    buttonPayloadSchema,
  ]);

  export type IncomingPayload = z.infer<typeof incomingPayloadSchema>;

  export type ComponentPayload =
    | {
        kind: 'quickReply';
        payload: string;
      }
    | {
        kind: 'postback';
        payload: string;
      };

  export type Outbound = MessageCreateOptions | MessageCreateOptions[];
}
