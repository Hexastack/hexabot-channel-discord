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

export class DiscordTextMessageInboundEvent extends DiscordMessageInboundEvent {
  constructor(
    context: ChannelInboundEventContext<
      typeof DISCORD_CHANNEL_NAME,
      Discord.IncomingPayload,
      Discord.ChannelAttrs
    >,
    private readonly text: string,
  ) {
    super(context);
  }

  override getMessageType(): IncomingMessageType {
    return IncomingMessageType.text;
  }

  override toStdIncomingMessage(): StdIncomingMessage {
    return {
      type: IncomingMessageType.text,
      data: {
        text: this.text,
      },
    };
  }
}

export default DiscordTextMessageInboundEvent;
