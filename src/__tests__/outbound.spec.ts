/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ButtonType, FileType, OutgoingMessageType } from '@hexabot-ai/types';

import { DiscordOutboundMessageEncoder } from '../outbound';
import { Discord } from '../types';

const channelAttachmentService = {
  getPublicUrl: jest.fn(
    async (_sourceId: string, attachment: { url?: string }) =>
      attachment.url ?? 'https://cdn.example.com/file',
  ),
};
const i18n = {
  t: jest.fn((key: string) => key),
};

const rowJson = (message: any, row = 0) => message.components[row].toJSON();

describe('DiscordOutboundMessageEncoder', () => {
  const encoder = new DiscordOutboundMessageEncoder(
    i18n as any,
    channelAttachmentService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('encodes text messages', async () => {
    await expect(
      encoder.encode(
        {
          type: OutgoingMessageType.text,
          data: {
            text: 'Hello',
          },
        },
        { sourceId: 'source-1' },
      ),
    ).resolves.toMatchObject({
      content: 'Hello',
    });
  });

  it('encodes quick replies with quick-reply custom IDs', async () => {
    const message = await encoder.encode(
      {
        type: OutgoingMessageType.quickReply,
        data: {
          text: 'Pick one',
          quickReplies: [{ title: 'A', payload: 'A' }],
        },
      },
      { sourceId: 'source-1' },
    );
    const row = rowJson(message);

    expect(message).toMatchObject({ content: 'Pick one' });
    expect(row.components[0].custom_id).toBe(
      `${Discord.QUICK_REPLY_CUSTOM_ID_PREFIX}A`,
    );
  });

  it('encodes postback and link buttons', async () => {
    const message = await encoder.encode(
      {
        type: OutgoingMessageType.buttons,
        data: {
          text: 'Choose',
          buttons: [
            {
              type: ButtonType.postback,
              title: 'Select',
              payload: 'SELECT',
            },
            {
              type: ButtonType.web_url,
              title: 'Open',
              url: 'example.com',
            },
          ],
        },
      },
      { sourceId: 'source-1' },
    );
    const row = rowJson(message);

    expect(row.components[0].custom_id).toBe(
      `${Discord.POSTBACK_CUSTOM_ID_PREFIX}SELECT`,
    );
    expect(row.components[1].url).toBe('https://example.com');
  });

  it('encodes attachments with public URLs', async () => {
    const message = await encoder.encode(
      {
        type: OutgoingMessageType.attachment,
        data: {
          attachment: {
            type: FileType.image,
            payload: {
              id: 'attachment-1',
              url: 'https://files.example.com/image.png',
            },
          },
        },
      },
      { sourceId: 'source-1' },
    );

    expect((message as any).files).toHaveLength(1);
    expect(channelAttachmentService.getPublicUrl).toHaveBeenCalledWith(
      'source-1',
      expect.objectContaining({
        url: 'https://files.example.com/image.png',
      }),
    );
  });

  it('encodes paginated lists as embeds plus a View More button', async () => {
    const message = await encoder.encode(
      {
        type: OutgoingMessageType.list,
        data: {
          elements: [
            {
              id: 'item-1',
              title: 'Item 1',
              url: 'example.com/1',
            },
          ],
          pagination: {
            total: 2,
            skip: 0,
            limit: 1,
          },
          options: {} as any,
        },
      },
      {
        sourceId: 'source-1',
        content: {
          fields: {
            title: 'title',
            url: 'url',
          },
          buttons: [
            {
              type: ButtonType.web_url,
              title: 'Open',
              url: '',
            },
          ],
          limit: 1,
        },
      } as any,
    );

    expect(Array.isArray(message)).toBe(true);
    const messages = message as any[];
    expect(messages[0].embeds).toHaveLength(1);
    expect(rowJson(messages.at(-1)).components[0].custom_id).toBe(
      `${Discord.POSTBACK_CUSTOM_ID_PREFIX}VIEW_MORE`,
    );
  });
});
