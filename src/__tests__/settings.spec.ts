/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  DISCORD_CHANNEL_NAME,
  DISCORD_CHANNEL_SOURCE_SETTINGS_SCHEMA,
  DISCORD_CREDENTIAL_SETTING_KEYS,
  parseDiscordAllowedGuildIds,
} from '../settings.schema';

describe('Discord settings schema', () => {
  it('uses the v3 channel name', () => {
    expect(DISCORD_CHANNEL_NAME).toBe('discord');
  });

  it('applies safe defaults', () => {
    expect(DISCORD_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse({})).toMatchObject({
      bot_token: '',
      application_id: '',
      allowed_guild_ids: '',
      enable_direct_messages: true,
      enable_guild_mentions: true,
      disable_buttons_after_click: true,
      thread_inactivity_hours: 24,
    });
  });

  it('declares bot token as the only credential setting', () => {
    expect(DISCORD_CREDENTIAL_SETTING_KEYS).toEqual(['bot_token']);
  });

  it('parses allowed guild IDs from comma-separated values', () => {
    expect(
      parseDiscordAllowedGuildIds({
        allowed_guild_ids: 'guild-1, guild-2,, guild-3',
      }),
    ).toEqual(['guild-1', 'guild-2', 'guild-3']);
  });
});
