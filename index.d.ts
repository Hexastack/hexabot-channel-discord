/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import * as DiscordTypes from 'discord.js';

import DEFAULT_DISCORD_SETTINGS, {
  DISCORD_CHANNEL_NAME,
  DISCORD_GROUP_NAME,
} from './settings';

declare global {
  interface Settings extends SettingTree<typeof DEFAULT_DISCORD_SETTINGS> {}

  interface SubscriberChannelDict {
    [DISCORD_CHANNEL_NAME]: {
      channelType: DiscordTypes.ChannelType;
    };
  }
}

declare module '@nestjs/event-emitter' {
  interface IHookExtensionsOperationMap {
    [DISCORD_GROUP_NAME]: TDefinition<
      object,
      SettingMapByType<typeof DEFAULT_DISCORD_SETTINGS>
    >;
  }
}
