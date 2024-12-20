/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import * as DiscordTypes from 'discord.js/typings';

export namespace Discord {
  export enum SettingLabel {
    bot_token = 'bot_token',
    app_id = 'app_id',
  }

  export type IncomingEvent =
    | DiscordTypes.ButtonInteraction<DiscordTypes.CacheType>
    | DiscordTypes.OmitPartialGroupDMChannel<DiscordTypes.Message<boolean>>;

  export type OutgoingMessage =
    | DiscordTypes.MessagePayload
    | DiscordTypes.MessageCreateOptions;
}
