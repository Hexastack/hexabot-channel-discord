/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ChannelInboundEventContext,
  MessageInboundEvent,
} from '@hexabot-ai/api';

import { DISCORD_CHANNEL_NAME } from '../../../settings.schema';
import { Discord } from '../../../types';

export abstract class DiscordMessageInboundEvent extends MessageInboundEvent<
  typeof DISCORD_CHANNEL_NAME,
  Discord.IncomingPayload,
  Discord.ChannelAttrs
> {
  protected constructor(
    context: ChannelInboundEventContext<
      typeof DISCORD_CHANNEL_NAME,
      Discord.IncomingPayload,
      Discord.ChannelAttrs
    >,
    handler?: Parameters<
      MessageInboundEvent<typeof DISCORD_CHANNEL_NAME>['setHandler']
    >[0],
  ) {
    super(context, handler);
  }

  override getRaw<T = Discord.IncomingPayload>(): T {
    return super.getRaw<T>();
  }
}

export default DiscordMessageInboundEvent;
