/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ChannelAttachmentService,
  ChannelOutboundMessageEncoder,
  ContentOrmEntity,
  I18nService,
} from '@hexabot-ai/api';
import {
  ActionOptions,
  AttachmentRef,
  Button,
  ButtonType,
  ContentElement,
  OutgoingMessageType,
  StdOutgoingAttachmentMessageData,
  StdOutgoingButtonsMessageData,
  StdOutgoingListMessageData,
  StdOutgoingMessageEnvelope,
  StdOutgoingQuickRepliesMessageData,
  StdOutgoingTextMessageData,
} from '@hexabot-ai/types';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageCreateOptions,
} from 'discord.js';
import { Injectable, Type } from '@nestjs/common';

import { Discord } from '../types';

export type DiscordSourceScopedEncodeOptions = ActionOptions & {
  sourceId: string;
};

const DISCORD_CONTENT_LIMIT = 2000;
const DISCORD_BUTTON_LABEL_LIMIT = 80;
const DISCORD_CUSTOM_ID_LIMIT = 100;
const DISCORD_BUTTONS_PER_ROW = 5;
const DISCORD_ACTION_ROW_LIMIT = 5;
const DISCORD_COMPONENT_BUTTON_LIMIT =
  DISCORD_BUTTONS_PER_ROW * DISCORD_ACTION_ROW_LIMIT;
const DISCORD_EMBED_TITLE_LIMIT = 256;
const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
const VIEW_MORE_PAYLOAD = 'VIEW_MORE';

export class DiscordOutboundMessageEncoder extends ChannelOutboundMessageEncoder<
  Discord.Outbound,
  DiscordSourceScopedEncodeOptions
> {
  constructor(
    private readonly i18n: I18nService,
    private readonly channelAttachmentService: ChannelAttachmentService,
  ) {
    super();
  }

  async encode(
    envelope: StdOutgoingMessageEnvelope,
    options: DiscordSourceScopedEncodeOptions,
  ): Promise<Discord.Outbound> {
    if (!options?.sourceId) {
      throw new Error('Missing sourceId in outbound encode options');
    }

    return await this.dispatchEnvelope(envelope, options, {
      [OutgoingMessageType.text]: ({ data }) => this.encodeTextMessage(data),
      [OutgoingMessageType.quickReply]: ({ data }) =>
        this.encodeQuickRepliesMessage(data),
      [OutgoingMessageType.buttons]: ({ data }) =>
        this.encodeButtonsMessage(data),
      [OutgoingMessageType.attachment]: ({ data }, sourceOptions) =>
        this.encodeAttachmentMessage(data, sourceOptions.sourceId),
      [OutgoingMessageType.list]: ({ data }, actionOptions) =>
        this.encodeListMessage(data, actionOptions),
      [OutgoingMessageType.carousel]: ({ data }, actionOptions) =>
        this.encodeCarouselMessage(data, actionOptions),
    });
  }

  protected encodeTextMessage(
    message: StdOutgoingTextMessageData,
  ): MessageCreateOptions {
    return {
      content: this.requireContent(message.text),
    };
  }

  protected encodeQuickRepliesMessage(
    message: StdOutgoingQuickRepliesMessageData,
  ): MessageCreateOptions {
    return this.encodeInteractiveMessage(
      message.text,
      message.quickReplies.map(({ title, payload }) => ({
        type: ButtonType.postback,
        title,
        payload,
      })),
      'quickReply',
    );
  }

  protected encodeButtonsMessage(
    message: StdOutgoingButtonsMessageData,
  ): MessageCreateOptions {
    if (message.buttons.length === 0) {
      throw new Error('Discord buttons message requires at least one button');
    }

    return this.encodeInteractiveMessage(message.text, message.buttons, 'postback');
  }

  protected async encodeAttachmentMessage(
    message: StdOutgoingAttachmentMessageData,
    sourceId: string,
  ): Promise<MessageCreateOptions> {
    const url = await this.channelAttachmentService.getPublicUrl(
      sourceId,
      message.attachment.payload,
    );
    const payload: MessageCreateOptions = {
      files: [new AttachmentBuilder(url)],
    };

    if (message.quickReplies && message.quickReplies.length > 0) {
      payload.components = this.encodeActionRows(
        message.quickReplies.map(({ title, payload }) =>
          this.encodeComponentButton(
            {
              type: ButtonType.postback,
              title,
              payload,
            },
            'quickReply',
          ),
        ),
      );
    }

    return payload;
  }

  protected async encodeListMessage(
    message: StdOutgoingListMessageData,
    options: DiscordSourceScopedEncodeOptions,
  ): Promise<MessageCreateOptions[]> {
    const messages = await this.encodeContentMessages(message, options);
    const hasMore =
      message.pagination.total -
        message.pagination.skip -
        message.pagination.limit >
      0;

    if (hasMore) {
      messages.push({
        content: this.requireContent(this.i18n.t('Options')),
        components: this.encodeActionRows([
          this.encodeComponentButton(
            {
              type: ButtonType.postback,
              title: this.i18n.t('View More'),
              payload: VIEW_MORE_PAYLOAD,
            },
            'postback',
          ),
        ]),
      });
    }

    return messages;
  }

  protected async encodeCarouselMessage(
    message: StdOutgoingListMessageData,
    options: DiscordSourceScopedEncodeOptions,
  ): Promise<MessageCreateOptions[]> {
    return await this.encodeContentMessages(message, options);
  }

  private encodeInteractiveMessage(
    text: string,
    buttons: Button[],
    kind: 'quickReply' | 'postback',
  ): MessageCreateOptions {
    return {
      content: this.requireContent(text),
      components: this.encodeActionRows(
        buttons.map((button) => this.encodeComponentButton(button, kind)),
      ),
    };
  }

  private async encodeContentMessages(
    message: StdOutgoingListMessageData,
    options: DiscordSourceScopedEncodeOptions,
  ): Promise<MessageCreateOptions[]> {
    if (!message.elements.length) {
      throw new Error('Discord list message requires at least one element');
    }

    const fields = options.content?.fields ?? message.options.fields;

    if (!fields?.title) {
      throw new Error('Content options are missing the title field');
    }

    const buttons = options.content?.buttons ?? message.options.buttons ?? [];
    const messages: MessageCreateOptions[] = [];

    for (const item of message.elements) {
      const embed = await this.encodeContentEmbed(
        item,
        fields,
        options.sourceId,
      );
      const encodedButtons = buttons.map((button, index) =>
        this.encodeContentButton(button, index, item, fields),
      );

      messages.push({
        content: '\u200B',
        embeds: [embed],
        ...(encodedButtons.length > 0
          ? {
              components: this.encodeActionRows(encodedButtons),
            }
          : {}),
      });
    }

    return messages;
  }

  private async encodeContentEmbed(
    item: ContentElement,
    fields: NonNullable<ActionOptions['content']>['fields'],
    sourceId: string,
  ): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder().setTitle(
      this.truncateDisplayText(
        this.stringifyField(item[fields.title]),
        DISCORD_EMBED_TITLE_LIMIT,
      ),
    );

    if (fields.subtitle && item[fields.subtitle] !== undefined) {
      embed.setDescription(
        this.truncateDisplayText(
          this.stringifyField(item[fields.subtitle]),
          DISCORD_EMBED_DESCRIPTION_LIMIT,
        ),
      );
    }

    if (fields.url && item[fields.url] !== undefined) {
      embed.setURL(this.ensureHttpUrl(this.stringifyField(item[fields.url])));
    }

    if (fields.image_url && item[fields.image_url] !== undefined) {
      const imageUrl = await this.resolveContentImageUrl(
        item[fields.image_url],
        sourceId,
      );

      if (imageUrl) {
        embed.setImage(imageUrl);
      }
    }

    return embed;
  }

  private async resolveContentImageUrl(
    value: unknown,
    sourceId: string,
  ): Promise<string | null> {
    if (typeof value === 'string') {
      return this.ensureHttpUrl(value);
    }

    const attachmentRef = (value as { payload?: AttachmentRef } | undefined)
      ?.payload;

    return attachmentRef
      ? await this.channelAttachmentService.getPublicUrl(sourceId, attachmentRef)
      : null;
  }

  private encodeContentButton(
    button: Button,
    index: number,
    item: ContentElement,
    fields: NonNullable<ActionOptions['content']>['fields'],
  ): ButtonBuilder {
    const btn = { ...button };

    if (
      index === 0 &&
      fields.action_title &&
      item[fields.action_title] !== undefined
    ) {
      btn.title = this.stringifyField(item[fields.action_title]);
    }

    if (btn.type === ButtonType.web_url) {
      const urlField = fields.url;
      const url =
        urlField && item[urlField] !== undefined
          ? this.stringifyField(item[urlField])
          : ContentOrmEntity.getUrl(item);

      return this.encodeComponentButton({
        ...btn,
        url,
      });
    }

    const payload =
      'action_payload' in fields &&
      fields.action_payload &&
      fields.action_payload in item
        ? `${btn.title}:${this.stringifyField(item[fields.action_payload])}`
        : `${btn.title}:${ContentOrmEntity.getPayload(item)}`;

    return this.encodeComponentButton({
      ...btn,
      payload,
    });
  }

  private encodeComponentButton(
    button: Button,
    kind: 'quickReply' | 'postback' = 'postback',
  ): ButtonBuilder {
    const label = this.truncateDisplayText(
      button.title,
      DISCORD_BUTTON_LABEL_LIMIT,
    );

    if (button.type === ButtonType.web_url) {
      return new ButtonBuilder()
        .setLabel(label)
        .setStyle(ButtonStyle.Link)
        .setURL(this.ensureHttpUrl(button.url));
    }

    const prefix =
      kind === 'quickReply'
        ? Discord.QUICK_REPLY_CUSTOM_ID_PREFIX
        : Discord.POSTBACK_CUSTOM_ID_PREFIX;
    const customId = `${prefix}${button.payload}`;

    if (customId.length > DISCORD_CUSTOM_ID_LIMIT) {
      throw new Error(
        `Discord button payload exceeds ${DISCORD_CUSTOM_ID_LIMIT - prefix.length} characters`,
      );
    }

    return new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(
        kind === 'quickReply' ? ButtonStyle.Primary : ButtonStyle.Secondary,
      );
  }

  private encodeActionRows(
    buttons: ButtonBuilder[],
  ): Array<ActionRowBuilder<ButtonBuilder>> {
    if (buttons.length > DISCORD_COMPONENT_BUTTON_LIMIT) {
      throw new Error(
        `Discord supports up to ${DISCORD_COMPONENT_BUTTON_LIMIT} buttons per message`,
      );
    }

    const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];

    for (let index = 0; index < buttons.length; index += DISCORD_BUTTONS_PER_ROW) {
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          buttons.slice(index, index + DISCORD_BUTTONS_PER_ROW),
        ),
      );
    }

    return rows;
  }

  private requireContent(text: string): string {
    if (text.length > DISCORD_CONTENT_LIMIT) {
      throw new Error(
        `Discord message content exceeds ${DISCORD_CONTENT_LIMIT} characters`,
      );
    }

    return text;
  }

  private truncateDisplayText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return value.slice(0, maxLength - 1).trimEnd() || value.slice(0, maxLength);
  }

  private stringifyField(value: unknown): string {
    return value === undefined || value === null ? '' : String(value);
  }

  private ensureHttpUrl(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }
}

export function createDiscordOutboundMessageEncoder(
  _channelName: string,
): Type<DiscordOutboundMessageEncoder> {
  @Injectable()
  class BoundDiscordOutboundMessageEncoder extends DiscordOutboundMessageEncoder {
    constructor(
      i18n: I18nService,
      channelAttachmentService: ChannelAttachmentService,
    ) {
      super(i18n, channelAttachmentService);
    }
  }

  return BoundDiscordOutboundMessageEncoder;
}

export default DiscordOutboundMessageEncoder;
