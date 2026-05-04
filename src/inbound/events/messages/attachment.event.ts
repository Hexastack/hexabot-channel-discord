/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  AttachmentOrmEntity,
  ChannelInboundEventContext,
} from '@hexabot-ai/api';
import type { Attachment } from '@hexabot-ai/types';
import {
  FileType,
  IncomingMessageType,
  Payload,
  PayloadType,
  StdIncomingMessage,
} from '@hexabot-ai/types';

import { DISCORD_CHANNEL_NAME } from '../../../settings.schema';
import { Discord } from '../../../types';

import DiscordMessageInboundEvent from './discord-message.event';

export class DiscordAttachmentMessageInboundEvent extends DiscordMessageInboundEvent {
  private persistedAttachments: Attachment[] = [];

  constructor(
    context: ChannelInboundEventContext<
      typeof DISCORD_CHANNEL_NAME,
      Discord.IncomingPayload,
      Discord.ChannelAttrs
    >,
    private readonly attachments: Discord.Attachment[],
  ) {
    super(context);
  }

  override getMessageType(): IncomingMessageType {
    return IncomingMessageType.attachment;
  }

  getRemoteAttachments(): Discord.Attachment[] {
    return this.attachments;
  }

  setPersistedAttachments(attachments: Attachment[]): void {
    this.persistedAttachments = attachments;
  }

  hasResolvedAttachment(): boolean {
    return this.persistedAttachments.length > 0;
  }

  override async preprocess(): Promise<void> {
    const handler = this.getHandler();

    if (this.hasResolvedAttachment() || !handler.getMessageAttachments) {
      return;
    }

    await handler.persistMessageAttachments(this);
  }

  private requireResolvedAttachments(): Attachment[] {
    if (this.persistedAttachments.length === 0) {
      throw new Error('Attachment has not been processed');
    }

    return this.persistedAttachments;
  }

  private resolveFileType(attachment: Attachment): FileType {
    return AttachmentOrmEntity.getTypeByMime(attachment.type);
  }

  private toPayload(attachment: Attachment) {
    return {
      type: this.resolveFileType(attachment),
      payload: {
        id: attachment.id,
      },
    };
  }

  override getPayload(): Payload {
    return {
      type: PayloadType.attachment,
      attachment: this.toPayload(this.requireResolvedAttachments()[0]),
    };
  }

  override toStdIncomingMessage(): StdIncomingMessage {
    const attachments = this.requireResolvedAttachments();
    const payloads = attachments.map((attachment) =>
      this.toPayload(attachment),
    );
    const serializedText = attachments
      .map((attachment) => {
        const fileType = this.resolveFileType(attachment);
        const name = attachment.name || `${fileType}-attachment`;

        return `attachment:${fileType}:${name}`;
      })
      .join('\n');

    return {
      type: IncomingMessageType.attachment,
      data: {
        serializedText,
        attachment: payloads.length === 1 ? payloads[0] : payloads,
      },
    };
  }
}

export default DiscordAttachmentMessageInboundEvent;
