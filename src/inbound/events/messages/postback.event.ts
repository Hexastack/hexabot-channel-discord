/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ChannelInboundEventContext } from '@hexabot-ai/api';
import { IncomingMessageType, StdIncomingMessage } from '@hexabot-ai/types';

import { DISCORD_CHANNEL_NAME } from '../../../settings.schema';
import { Discord } from '../../../types';

import DiscordMessageInboundEvent from './discord-message.event';

export class DiscordPostbackInboundEvent extends DiscordMessageInboundEvent {
  constructor(
    context: ChannelInboundEventContext<
      typeof DISCORD_CHANNEL_NAME,
      Discord.IncomingPayload,
      Discord.ChannelAttrs
    >,
    private readonly payload: string,
    private readonly text: string,
  ) {
    super(context);
  }

  override getMessageType(): IncomingMessageType {
    return IncomingMessageType.postback;
  }

  override getPayload(): string {
    return this.payload;
  }

  override toStdIncomingMessage(): StdIncomingMessage {
    return {
      type: IncomingMessageType.postback,
      data: {
        text: this.text,
        payload: this.payload,
      },
    };
  }
}

export default DiscordPostbackInboundEvent;
