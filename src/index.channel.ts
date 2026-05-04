/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createHash, randomUUID } from 'crypto';

import {
  ChannelCapabilities,
  ChannelHealthContext,
  CredentialService,
  DEFAULT_CHANNEL_CAPABILITIES,
  ExtensionInject,
  HttpChannelHandler,
  LanguageService,
  MessageInboundEvent,
  SourceService,
  SubscriberCreateDto,
} from '@hexabot-ai/api';
import type {
  ActionOptions,
  IntegrationHealthItem,
  Source,
  StdOutgoingMessageEnvelope,
} from '@hexabot-ai/types';
import { StdEventType } from '@hexabot-ai/types';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  Client,
  ComponentType,
  Events,
  GatewayIntentBits,
  Interaction,
  Message,
  MessageCreateOptions,
  Partials,
} from 'discord.js';
import { Request, Response } from 'express';

import {
  DiscordInboundEventDecoder,
  createDiscordInboundEventDecoder,
} from './inbound';
import { DiscordAttachmentMessageInboundEvent } from './inbound/events';
import {
  DiscordOutboundMessageEncoder,
  createDiscordOutboundMessageEncoder,
} from './outbound';
import { DiscordApiService } from './services';
import {
  DISCORD_CHANNEL_NAME,
  DISCORD_CHANNEL_SOURCE_SETTINGS_SCHEMA,
  DISCORD_CREDENTIAL_SETTING_KEYS,
  DISCORD_REQUIRED_SETTING_KEYS,
  DiscordChannelSettings,
  DiscordCredentialSettingKey,
  DiscordResolvedChannelSettings,
  parseDiscordAllowedGuildIds,
} from './settings.schema';
import { Discord } from './types';

type EntityHookPayload<T> = {
  entity?: T;
  databaseEntity?: T;
  payload?: Record<string, unknown>;
};

type DiscordClientRuntime = {
  client: Client;
  sourceId: string;
  applicationId: string;
  tokenFingerprint: string;
  ready: boolean;
  botUserId?: string;
  lastError?: string;
  settings: DiscordResolvedChannelSettings;
  sourceSettings: Record<string, unknown>;
  defaultWorkflowId?: string;
};

type DiscordSendableChannel = {
  send(message: MessageCreateOptions): Promise<{ id: string }>;
  sendTyping(): Promise<void>;
};

const MAX_TYPING_DELAY_MS = 10000;

@Injectable()
export default class DiscordChannelHandler
  extends HttpChannelHandler<typeof DISCORD_CHANNEL_NAME>
  implements OnModuleDestroy
{
  @Inject(SourceService)
  private readonly sourceService!: SourceService;

  @Inject(LanguageService)
  private readonly languageService!: LanguageService;

  @Inject(ModuleRef)
  private readonly credentialsModuleRef!: ModuleRef;

  @ExtensionInject((name) => createDiscordInboundEventDecoder(name))
  private inboundEventDecoder!: DiscordInboundEventDecoder;

  @ExtensionInject((name) => createDiscordOutboundMessageEncoder(name))
  private outboundMessageEncoder!: DiscordOutboundMessageEncoder;

  @ExtensionInject(DiscordApiService)
  private discordApi!: DiscordApiService;

  private credentialService?: CredentialService;

  private readonly clients = new Map<string, DiscordClientRuntime>();

  private readonly clientErrors = new Map<string, string>();

  constructor() {
    super(DISCORD_CHANNEL_NAME, DISCORD_CHANNEL_SOURCE_SETTINGS_SCHEMA);
  }

  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    await this.syncActiveSources();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.clients.keys()].map((sourceId) =>
        this.destroySourceClient(sourceId),
      ),
    );
  }

  getCapabilities(): ChannelCapabilities {
    return {
      ...DEFAULT_CHANNEL_CAPABILITIES,
      typingIndicator: true,
      maxTextLength: 2000,
    };
  }

  override async handle(
    _req: unknown,
    res: unknown,
    _source: Source,
  ): Promise<void> {
    const response = res as Response;

    response.status(405).json({
      error: 'Discord channel uses Gateway events, not webhooks.',
    });
  }

  protected async decode(): Promise<[]> {
    return [];
  }

  protected async doSendMessage(
    event: MessageInboundEvent<typeof DISCORD_CHANNEL_NAME>,
    envelope: StdOutgoingMessageEnvelope,
    options: ActionOptions,
  ): Promise<{ mid: string }> {
    const sourceId = event.getSourceId();

    if (!sourceId) {
      throw new Error('Cannot send Discord message without source id');
    }

    let runtime = this.clients.get(sourceId);

    if (!runtime?.ready) {
      await this.ensureClientForSourceId(sourceId);
      runtime = this.clients.get(sourceId);
    }

    if (!runtime?.ready) {
      throw new Error('Discord client is not connected for this source');
    }

    const channelAttrs = event.getChannelAttrs<Discord.ChannelAttrs>();
    const channelId = channelAttrs.channelId || event.getSenderForeignId();

    if (!channelId) {
      throw new Error('Cannot send Discord message without channel id');
    }

    const channel = await runtime.client.channels.fetch(channelId);

    if (
      !channel ||
      !('isTextBased' in channel) ||
      !channel.isTextBased() ||
      !this.isSendableTextChannel(channel)
    ) {
      throw new Error('Discord outbound channel is not text-based');
    }

    const encoded = await this.outboundMessageEncoder.encode(envelope, {
      ...(options ?? {}),
      sourceId,
    });
    const messages = Array.isArray(encoded) ? encoded : [encoded];

    if (options?.typing) {
      await this.sendTypingIndicator(channel, envelope, options.typing);
    }

    let lastMessageId: string = randomUUID();

    for (const message of messages) {
      const response = await channel.send(message);
      lastMessageId = response.id;
    }

    return { mid: lastMessageId };
  }

  async getSubscriberData(
    event: MessageInboundEvent<typeof DISCORD_CHANNEL_NAME>,
  ): Promise<SubscriberCreateDto> {
    const sourceId = event.getSourceId();
    const channelAttrs = event.getChannelAttrs<Discord.ChannelAttrs>();
    const foreignId = event.getSenderForeignId();
    const defaultLanguage = await this.getDefaultLanguageSafe();
    const isGuild = Boolean(channelAttrs.guildId);

    return {
      foreignId,
      firstName: isGuild
        ? channelAttrs.guildName || 'Discord'
        : channelAttrs.lastAuthorUsername || 'Discord',
      lastName: isGuild ? channelAttrs.channelName || 'Channel' : 'User',
      assignedTo: null,
      assignedAt: null,
      lastvisit: new Date(),
      retainedFrom: new Date(),
      avatar: null,
      channel: event.getChannelData(),
      language: defaultLanguage,
      locale: '',
      timezone: 0,
      gender: null,
      country: null,
      labels: [],
      source: sourceId ?? '',
    };
  }

  async getSubscriberAvatar(
    event: MessageInboundEvent<typeof DISCORD_CHANNEL_NAME>,
  ) {
    const channelAttrs = event.getChannelAttrs<Discord.ChannelAttrs>();
    const avatarUrl = channelAttrs.avatarUrl;

    return avatarUrl
      ? await this.discordApi.downloadUrl(avatarUrl, 'discord-avatar')
      : undefined;
  }

  async getMessageAttachments(
    event: MessageInboundEvent<typeof DISCORD_CHANNEL_NAME>,
  ) {
    if (!(event instanceof DiscordAttachmentMessageInboundEvent)) {
      return [];
    }

    return await Promise.all(
      event
        .getRemoteAttachments()
        .map((attachment) =>
          this.discordApi.downloadUrl(
            attachment.url,
            this.resolveAttachmentName(attachment),
          ),
        ),
    );
  }

  async getIntegrationHealth(context: ChannelHealthContext) {
    const activeSources = context.sources.filter((source) => source.state);
    const missingSettings = (
      await Promise.all(
        activeSources.map(async (source) => {
          const settings = this.parseSettings(source.settings);

          if (
            !settings.application_id.trim() ||
            !this.hasCredentialRefs(settings)
          ) {
            return source;
          }

          const resolvedSettings = await this.resolveSettingsCredentials(
            settings,
            DISCORD_CREDENTIAL_SETTING_KEYS,
          );

          return this.hasCredentialValues(resolvedSettings) ? null : source;
        }),
      )
    ).filter((source): source is Source => source !== null);
    const disconnectedSources = activeSources.filter((source) => {
      if (missingSettings.some((missing) => missing.id === source.id)) {
        return false;
      }

      const runtime = this.clients.get(source.id);

      return !runtime?.ready || this.clientErrors.has(source.id);
    });

    if (
      activeSources.length === 0 ||
      (missingSettings.length === 0 && disconnectedSources.length === 0)
    ) {
      return {
        ...context.defaultHealth,
        details: {
          ...(context.defaultHealth.details ?? {}),
          requiredSettings: [...DISCORD_REQUIRED_SETTING_KEYS],
          connectedSources: [...this.clients.values()].filter(
            (runtime) => runtime.ready,
          ).length,
        },
      } satisfies Partial<IntegrationHealthItem>;
    }

    const reason =
      missingSettings.length > 0
        ? 'discord.missing_required_settings'
        : 'discord.gateway_not_connected';

    return {
      status: 'unhealthy',
      reason,
      message: `${missingSettings.length + disconnectedSources.length} active Discord source${
        missingSettings.length + disconnectedSources.length === 1 ? '' : 's'
      } require attention.`,
      details: {
        activeSources: activeSources.length,
        missingRequiredSettings: missingSettings.length,
        disconnectedSources: disconnectedSources.length,
        requiredSettings: [...DISCORD_REQUIRED_SETTING_KEYS],
        errors: Object.fromEntries(this.clientErrors.entries()),
      },
    } satisfies Partial<IntegrationHealthItem>;
  }

  @OnEvent('hook:source:postCreate', { async: true })
  @OnEvent('hook:source:postUpdate', { async: true })
  async handleSourceMutated(event: EntityHookPayload<Source>): Promise<void> {
    const source = event.entity;

    if (!source || source.channel !== DISCORD_CHANNEL_NAME) {
      return;
    }

    await this.syncSourceClient(source);
  }

  private async syncActiveSources(): Promise<void> {
    const sources = await this.sourceService.find({
      where: {
        channel: DISCORD_CHANNEL_NAME,
      },
    });

    await Promise.all(sources.map((source) => this.syncSourceClient(source)));
  }

  private async syncSourceClient(source: Source): Promise<void> {
    if (!source.state) {
      await this.destroySourceClient(source.id);

      return;
    }

    const settings = this.parseSettings(source.settings);

    if (!settings.application_id.trim() || !this.hasCredentialRefs(settings)) {
      await this.destroySourceClient(source.id);
      this.clientErrors.set(source.id, 'Missing Discord required settings');

      return;
    }

    const resolvedSettings = await this.resolveSettingsCredentials(settings, [
      'bot_token',
    ]);

    if (!resolvedSettings.bot_token) {
      await this.destroySourceClient(source.id);
      this.clientErrors.set(source.id, 'Missing Discord bot token value');

      return;
    }

    const tokenFingerprint = this.fingerprint(resolvedSettings.bot_token);
    const existing = this.clients.get(source.id);

    if (
      existing &&
      existing.applicationId === resolvedSettings.application_id &&
      existing.tokenFingerprint === tokenFingerprint
    ) {
      existing.settings = resolvedSettings;
      existing.sourceSettings = this.getSourceSettings(source);
      existing.defaultWorkflowId = this.getSourceDefaultWorkflowId(source);
      this.clientErrors.delete(source.id);

      return;
    }

    await this.destroySourceClient(source.id);
    await this.connectSourceClient(source, resolvedSettings, tokenFingerprint);
  }

  private async connectSourceClient(
    source: Source,
    settings: DiscordResolvedChannelSettings,
    tokenFingerprint: string,
  ): Promise<void> {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
    const runtime: DiscordClientRuntime = {
      client,
      sourceId: source.id,
      applicationId: settings.application_id,
      tokenFingerprint,
      ready: false,
      settings,
      sourceSettings: this.getSourceSettings(source),
      defaultWorkflowId: this.getSourceDefaultWorkflowId(source),
    };

    this.clients.set(source.id, runtime);
    this.registerClientListeners(source, runtime);

    try {
      await client.login(settings.bot_token);
      this.clientErrors.delete(source.id);
    } catch (err) {
      const message = this.errorMessage(err);
      runtime.lastError = message;
      this.clientErrors.set(source.id, message);
      this.logger.error(
        `Failed to connect Discord client for source ${source.id}`,
        err,
      );
      await this.destroySourceClient(source.id);
    }
  }

  private registerClientListeners(
    source: Source,
    runtime: DiscordClientRuntime,
  ): void {
    runtime.client.once(Events.ClientReady, (client) => {
      runtime.ready = true;
      runtime.botUserId = client.user.id;
      this.clientErrors.delete(source.id);
      this.logger.log(
        `Discord bot connected for source ${source.id} as ${client.user.tag}`,
      );
    });

    runtime.client.on(Events.MessageCreate, (message) => {
      this.handleDiscordMessage(source, runtime, message).catch((err) => {
        this.logger.error('Failed to process Discord message', err);
      });
    });

    runtime.client.on(Events.InteractionCreate, (interaction) => {
      this.handleDiscordInteraction(source, runtime, interaction).catch((err) => {
        this.logger.error('Failed to process Discord interaction', err);
      });
    });

    runtime.client.on(Events.Error, (err) => {
      runtime.lastError = this.errorMessage(err);
      this.clientErrors.set(source.id, runtime.lastError);
      this.logger.error('Discord client error', err);
    });

    runtime.client.on(Events.ShardError, (err) => {
      runtime.lastError = this.errorMessage(err);
      this.clientErrors.set(source.id, runtime.lastError);
      this.logger.error('Discord shard error', err);
    });
  }

  private async destroySourceClient(sourceId: string): Promise<void> {
    const runtime = this.clients.get(sourceId);

    if (!runtime) {
      return;
    }

    this.clients.delete(sourceId);
    runtime.client.removeAllListeners();
    await runtime.client.destroy();
  }

  private async ensureClientForSourceId(sourceId: string): Promise<void> {
    const source = await this.sourceService.findOne(sourceId);

    if (!source || source.channel !== DISCORD_CHANNEL_NAME) {
      return;
    }

    await this.syncSourceClient(source);
  }

  private async handleDiscordMessage(
    _source: Source,
    runtime: DiscordClientRuntime,
    message: Message,
  ): Promise<void> {
    if (!this.shouldHandleMessage(runtime, message)) {
      return;
    }

    const payload = this.toMessagePayload(runtime, message);
    const channelAttrs = this.createChannelAttrsFromMessage(runtime, message);

    await this.processDecodedPayload(runtime, payload, channelAttrs);
  }

  private async handleDiscordInteraction(
    _source: Source,
    runtime: DiscordClientRuntime,
    interaction: Interaction,
  ): Promise<void> {
    if (!interaction.isButton()) {
      return;
    }

    await interaction.deferUpdate().catch((err) => {
      this.logger.warn('Failed to defer Discord button interaction', err);
    });

    if (!this.shouldHandleButtonInteraction(runtime, interaction)) {
      return;
    }

    if (runtime.settings.disable_buttons_after_click) {
      await this.disableButtonInteractions(interaction).catch((err) => {
        this.logger.warn('Failed to disable Discord buttons', err);
      });
    }

    const payload = this.toButtonPayload(runtime, interaction);
    const channelAttrs = this.createChannelAttrsFromInteraction(
      runtime,
      interaction,
    );

    await this.processDecodedPayload(runtime, payload, channelAttrs);
  }

  private async processDecodedPayload(
    runtime: DiscordClientRuntime,
    payload: Discord.IncomingPayload,
    channelAttrs: Discord.ChannelAttrs,
  ): Promise<void> {
    const events = this.inboundEventDecoder.createEvents(payload, channelAttrs);

    for (const event of events) {
      event.setHandler(this);
      event.setSourceContext(runtime.sourceId, runtime.sourceSettings);

      if (runtime.defaultWorkflowId) {
        event.setWorkflowId(runtime.defaultWorkflowId);
      }

      try {
        const subscriber = await this.resolveSubscriber(event);
        event.setInitiator(subscriber);

        if (event.getEventType() === StdEventType.message) {
          const messageEvent = event as MessageInboundEvent<
            typeof DISCORD_CHANNEL_NAME
          >;
          await messageEvent.preprocess();
          await this.channelEventBus.emitMessage(messageEvent);
        } else {
          this.channelEventBus.emitStatusEvent(event);
        }
      } catch (err) {
        this.logger.error('Failed to process Discord event', err);
      }
    }
  }

  private shouldHandleMessage(
    runtime: DiscordClientRuntime,
    message: Message,
  ): boolean {
    if (message.system || !message.channel?.isTextBased()) {
      return false;
    }

    if (message.author.bot) {
      return message.author.id === runtime.botUserId;
    }

    if (this.isDirectMessage(message.channel.type)) {
      return runtime.settings.enable_direct_messages;
    }

    if (!runtime.settings.enable_guild_mentions) {
      return false;
    }

    if (!this.isAllowedGuild(runtime.settings, message.guildId ?? undefined)) {
      return false;
    }

    return runtime.botUserId
      ? message.mentions.users.has(runtime.botUserId)
      : false;
  }

  private shouldHandleButtonInteraction(
    runtime: DiscordClientRuntime,
    interaction: ButtonInteraction,
  ): boolean {
    if (!interaction.channel?.isTextBased()) {
      return false;
    }

    if (this.isDirectMessage(interaction.channel.type)) {
      return runtime.settings.enable_direct_messages;
    }

    return (
      runtime.settings.enable_guild_mentions &&
      this.isAllowedGuild(runtime.settings, interaction.guildId ?? undefined)
    );
  }

  private toMessagePayload(
    runtime: DiscordClientRuntime,
    message: Message,
  ): Discord.MessagePayload {
    return {
      kind: 'message',
      id: message.id,
      content: message.content ?? '',
      createdTimestamp: message.createdTimestamp,
      author: {
        id: message.author.id,
        username: message.author.username,
        displayName: message.author.displayName,
        bot: message.author.bot,
        avatarUrl: message.author.displayAvatarURL(),
      },
      channel: {
        id: message.channel.id,
        type: this.channelTypeName(message.channel.type),
        name: this.channelName(message.channel),
      },
      guild: message.guild
        ? {
            id: message.guild.id,
            name: message.guild.name,
            iconUrl: message.guild.iconURL(),
          }
        : null,
      mentionsBot: runtime.botUserId
        ? message.mentions.users.has(runtime.botUserId)
        : false,
      attachments: Array.from(message.attachments.values()).map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        title: attachment.title ?? attachment.name,
        url: attachment.url,
        proxyUrl: attachment.proxyURL,
        size: attachment.size,
        contentType: attachment.contentType,
      })),
    };
  }

  private toButtonPayload(
    _runtime: DiscordClientRuntime,
    interaction: ButtonInteraction,
  ): Discord.ButtonPayload {
    return {
      kind: 'button',
      id: interaction.id,
      customId: interaction.customId,
      label: this.buttonLabel(interaction),
      createdTimestamp: interaction.createdTimestamp,
      user: {
        id: interaction.user.id,
        username: interaction.user.username,
        displayName: interaction.user.displayName,
        bot: interaction.user.bot,
        avatarUrl: interaction.user.displayAvatarURL(),
      },
      channel: {
        id: interaction.channel!.id,
        type: this.channelTypeName(interaction.channel!.type),
        name: this.channelName(interaction.channel!),
      },
      guild: interaction.guild
        ? {
            id: interaction.guild.id,
            name: interaction.guild.name,
            iconUrl: interaction.guild.iconURL(),
          }
        : null,
      messageId: interaction.message.id,
    };
  }

  private createChannelAttrsFromMessage(
    runtime: DiscordClientRuntime,
    message: Message,
  ): Discord.ChannelAttrs {
    const guildIconUrl = message.guild?.iconURL() ?? null;
    const authorAvatarUrl = message.author.displayAvatarURL();

    return {
      channelId: message.channel.id,
      channelType: this.channelTypeName(message.channel.type),
      botUserId: runtime.botUserId,
      applicationId: runtime.applicationId,
      guildId: message.guild?.id,
      guildName: message.guild?.name,
      guildIconUrl,
      channelName: this.channelName(message.channel),
      dmUserId: this.isDirectMessage(message.channel.type)
        ? message.author.id
        : undefined,
      lastAuthorId: message.author.id,
      lastAuthorUsername: message.author.username,
      lastAuthorAvatarUrl: authorAvatarUrl,
      avatarUrl: guildIconUrl ?? authorAvatarUrl,
    };
  }

  private createChannelAttrsFromInteraction(
    runtime: DiscordClientRuntime,
    interaction: ButtonInteraction,
  ): Discord.ChannelAttrs {
    const guildIconUrl = interaction.guild?.iconURL() ?? null;
    const authorAvatarUrl = interaction.user.displayAvatarURL();

    return {
      channelId: interaction.channel!.id,
      channelType: this.channelTypeName(interaction.channel!.type),
      botUserId: runtime.botUserId,
      applicationId: runtime.applicationId,
      guildId: interaction.guild?.id,
      guildName: interaction.guild?.name,
      guildIconUrl,
      channelName: this.channelName(interaction.channel!),
      dmUserId: this.isDirectMessage(interaction.channel!.type)
        ? interaction.user.id
        : undefined,
      lastAuthorId: interaction.user.id,
      lastAuthorUsername: interaction.user.username,
      lastAuthorAvatarUrl: authorAvatarUrl,
      avatarUrl: guildIconUrl ?? authorAvatarUrl,
    };
  }

  private async disableButtonInteractions(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const components = interaction.message.components.map((row) => {
      const rowData = row.toJSON() as any;

      return {
        type: rowData.type,
        components: (rowData.components ?? []).map((data: any) => {
          if (
            data.type === ComponentType.Button &&
            data.style !== ButtonStyle.Link
          ) {
            return {
              ...data,
              disabled: true,
            };
          }

          return data;
        }),
      };
    });

    await interaction.editReply({ components });
  }

  private async sendTypingIndicator(
    channel: DiscordSendableChannel,
    envelope: StdOutgoingMessageEnvelope,
    typing: boolean | number,
  ): Promise<void> {
    const timeout = this.resolveTypingTimeout(envelope, typing);

    try {
      await channel.sendTyping();
      await this.sleep(timeout);
    } catch (err) {
      this.logger.error('Failed to send Discord typing indicator', err);
    }
  }

  private resolveTypingTimeout(
    envelope: StdOutgoingMessageEnvelope,
    typing: boolean | number,
  ): number {
    const autoTimeout =
      envelope.data && 'text' in envelope.data
        ? String(envelope.data.text).length * 10
        : 1000;
    const timeout = typeof typing === 'number' ? typing : autoTimeout;

    return Math.min(timeout, MAX_TYPING_DELAY_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseSettings(settings: unknown): DiscordChannelSettings {
    return DISCORD_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse(settings ?? {});
  }

  private async parseSettingsWithCredentials(
    settings: unknown,
    credentialKeys: readonly DiscordCredentialSettingKey[],
  ): Promise<DiscordResolvedChannelSettings> {
    return await this.resolveSettingsCredentials(
      this.parseSettings(settings),
      credentialKeys,
    );
  }

  private async resolveSettingsCredentials(
    settings: DiscordChannelSettings,
    credentialKeys: readonly DiscordCredentialSettingKey[],
  ): Promise<DiscordResolvedChannelSettings> {
    const resolvedSettings = { ...settings };

    await Promise.all(
      credentialKeys.map(async (key) => {
        resolvedSettings[key] = await this.resolveCredentialValue(settings[key]);
      }),
    );

    return resolvedSettings;
  }

  private async resolveCredentialValue(credentialId: string): Promise<string> {
    const id = credentialId.trim();

    if (!id) {
      return '';
    }

    const value = await this.getCredentialService().findOneValue(id);

    return value.trim();
  }

  private getCredentialService(): CredentialService {
    if (!this.credentialService) {
      this.credentialService = this.credentialsModuleRef.get(
        CredentialService,
        { strict: false },
      );
    }

    return this.credentialService;
  }

  private hasCredentialRefs(settings: DiscordChannelSettings): boolean {
    return DISCORD_CREDENTIAL_SETTING_KEYS.every((key) =>
      Boolean(settings[key].trim()),
    );
  }

  private hasCredentialValues(
    settings: DiscordResolvedChannelSettings,
  ): boolean {
    return DISCORD_CREDENTIAL_SETTING_KEYS.every((key) =>
      Boolean(settings[key].trim()),
    );
  }

  private getDefaultLanguageSafe(): Promise<string> {
    return this.languageService
      .getDefaultLanguage()
      .then((language) => language.code)
      .catch(() => '');
  }

  private getSourceSettings(source: Source): Record<string, unknown> {
    return source.settings && typeof source.settings === 'object'
      ? source.settings
      : {};
  }

  private getSourceDefaultWorkflowId(source: Source): string | undefined {
    const defaultWorkflow = (source as { defaultWorkflow?: unknown })
      .defaultWorkflow;

    if (typeof defaultWorkflow === 'string') {
      const workflowId = defaultWorkflow.trim();

      return workflowId.length > 0 ? workflowId : undefined;
    }

    if (
      defaultWorkflow &&
      typeof defaultWorkflow === 'object' &&
      !Array.isArray(defaultWorkflow)
    ) {
      const workflowId = (defaultWorkflow as { id?: unknown }).id;

      return typeof workflowId === 'string' && workflowId.trim().length > 0
        ? workflowId.trim()
        : undefined;
    }

    return undefined;
  }

  private isAllowedGuild(
    settings: DiscordChannelSettings,
    guildId: string | undefined,
  ): boolean {
    const allowedGuildIds = parseDiscordAllowedGuildIds(settings);

    return (
      !guildId ||
      allowedGuildIds.length === 0 ||
      allowedGuildIds.includes(guildId)
    );
  }

  private isDirectMessage(type: ChannelType): boolean {
    return type === ChannelType.DM;
  }

  private channelTypeName(type: ChannelType): string {
    return ChannelType[type] ?? String(type);
  }

  private channelName(channel: unknown): string | undefined {
    const name = (channel as { name?: unknown }).name;

    return typeof name === 'string' ? name : undefined;
  }

  private isSendableTextChannel(
    channel: unknown,
  ): channel is DiscordSendableChannel {
    const candidate = channel as Partial<DiscordSendableChannel>;

    return (
      typeof candidate.send === 'function' &&
      typeof candidate.sendTyping === 'function'
    );
  }

  private buttonLabel(interaction: ButtonInteraction): string | undefined {
    return (interaction.component as { label?: string }).label;
  }

  private resolveAttachmentName(attachment: Discord.Attachment): string {
    return attachment.title ?? attachment.name ?? `discord-${attachment.id}`;
  }

  private fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
