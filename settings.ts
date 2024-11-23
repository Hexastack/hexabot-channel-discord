/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { ChannelSetting } from '@/channel/types';
import { SettingType } from '@/setting/schemas/types';

import { Discord } from './types';

export const DISCORD_CHANNEL_NAME = 'discord-channel';

export const DISCORD_GROUP_NAME = 'discord_channel';

export default [
  {
    group: DISCORD_GROUP_NAME,
    label: Discord.SettingLabel.bot_token,
    type: SettingType.secret,
    value: '',
  },
  {
    group: DISCORD_GROUP_NAME,
    label: Discord.SettingLabel.app_id,
    type: SettingType.text,
    value: '',
  },
] as const satisfies ChannelSetting<typeof DISCORD_CHANNEL_NAME>[];
