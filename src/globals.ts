/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DISCORD_CHANNEL_NAME } from './settings.schema';

declare global {
  interface SubscriberChannelDict {
    [DISCORD_CHANNEL_NAME]: {
      channelId: string;
      channelType: string;
      botUserId?: string;
      applicationId: string;
      guildId?: string;
      guildName?: string;
      guildIconUrl?: string | null;
      channelName?: string;
      dmUserId?: string;
      lastAuthorId?: string;
      lastAuthorUsername?: string;
      lastAuthorAvatarUrl?: string | null;
      avatarUrl?: string | null;
    };
  }
}

export {};
