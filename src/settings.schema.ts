/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

export const DISCORD_CHANNEL_NAME = 'discord' as const;

const credentialSetting = (title: string, description: string) =>
  z.string().default('').meta({
    title,
    description,
    'ui:widget': 'AutoCompleteWidget',
    'ui:options': {
      entity: 'Credential',
      valueKey: 'id',
      labelKey: 'name',
      enableEntityAddButton: true,
    },
  });

const commaSeparatedValues = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const DISCORD_CHANNEL_SOURCE_SETTINGS_SCHEMA = z
  .strictObject({
    bot_token: credentialSetting(
      'Bot token credential',
      'Credential containing the Discord bot token used for Gateway and REST calls.',
    ),
    application_id: z.string().default('').meta({
      title: 'Application ID',
      description:
        'Discord application/client ID. Used to identify the bot and validate component interactions.',
    }),
    allowed_guild_ids: z.string().default('').meta({
      title: 'Allowed guild IDs',
      description:
        'Optional comma-separated Discord server IDs. When set, guild messages from other servers are ignored.',
      'ui:widget': 'textarea',
    }),
    enable_direct_messages: z.boolean().default(true).meta({
      title: 'Enable direct messages',
      description: 'Allow users to talk to the bot in Discord DMs.',
    }),
    enable_guild_mentions: z.boolean().default(true).meta({
      title: 'Enable guild mentions',
      description:
        'Allow server messages that mention the bot to start or continue a Hexabot conversation.',
    }),
    disable_buttons_after_click: z.boolean().default(true).meta({
      title: 'Disable buttons after click',
      description:
        'Disable Discord message buttons after a user selects one, keeping link buttons enabled.',
    }),
    thread_inactivity_hours: z.int().nonnegative().default(24).meta({
      title: 'Thread inactivity (hours)',
      description:
        'Automatically start a new thread when the last message is older than this threshold.',
    }),
  })
  .meta({
    title: 'Discord Channel',
  });

export type DiscordChannelSettings = z.infer<
  typeof DISCORD_CHANNEL_SOURCE_SETTINGS_SCHEMA
>;

export const DISCORD_CREDENTIAL_SETTING_KEYS = ['bot_token'] as const;

export type DiscordCredentialSettingKey =
  (typeof DISCORD_CREDENTIAL_SETTING_KEYS)[number];

export const DISCORD_REQUIRED_SETTING_KEYS = [
  ...DISCORD_CREDENTIAL_SETTING_KEYS,
  'application_id',
] as const;

export type DiscordRequiredSettingKey =
  (typeof DISCORD_REQUIRED_SETTING_KEYS)[number];

export type DiscordResolvedChannelSettings = DiscordChannelSettings;

export const parseDiscordAllowedGuildIds = (
  settings: Pick<DiscordChannelSettings, 'allowed_guild_ids'>,
): string[] => commaSeparatedValues(settings.allowed_guild_ids);
