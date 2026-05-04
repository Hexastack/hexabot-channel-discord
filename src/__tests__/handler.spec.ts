/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StdEventType, type Source } from '@hexabot-ai/types';
import { Request, Response } from 'express';

import DiscordChannelHandler from '../index.channel';
import { DISCORD_CHANNEL_NAME } from '../settings.schema';

const subscriber = {
  id: 'subscriber-1',
};

class TestDiscordChannelHandler extends DiscordChannelHandler {
  callHandle(req: Request, res: Response, source: Source) {
    return this.handle(req, res, source);
  }

  callProcessDecodedPayload(
    runtime: Record<string, unknown>,
    payload: unknown,
    channelAttrs: unknown,
  ) {
    return (this as any).processDecodedPayload(
      runtime,
      payload,
      channelAttrs,
    );
  }

  callGetSourceDefaultWorkflowId(source: unknown) {
    return (this as any).getSourceDefaultWorkflowId(source);
  }

  protected async resolveSubscriber() {
    return subscriber as any;
  }
}

const source = {
  id: 'source-1',
  channel: DISCORD_CHANNEL_NAME,
  state: true,
  settings: {
    bot_token: 'credential-bot-token',
    application_id: 'app-1',
  },
} as unknown as Source;

const credentialValues: Record<string, string> = {
  'credential-bot-token': 'discord-token',
};

const buildResponse = () =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  }) as unknown as Response;

describe('DiscordChannelHandler', () => {
  let handler: TestDiscordChannelHandler;

  beforeEach(() => {
    handler = new TestDiscordChannelHandler();
    (handler as any).logger = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };
    (handler as any).credentialService = {
      findOneValue: jest.fn(
        async (credentialId: string) => credentialValues[credentialId] ?? '',
      ),
    };
  });

  it('returns a clear response for HTTP webhook calls', async () => {
    const res = buildResponse();

    await handler.callHandle({} as Request, res, source);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Discord channel uses Gateway events, not webhooks.',
    });
  });

  it('reports missing required settings as unhealthy', async () => {
    await expect(
      handler.getIntegrationHealth({
        sources: [
          {
            ...source,
            settings: {
              bot_token: '',
              application_id: '',
            },
          },
        ],
        defaultHealth: {
          status: 'healthy',
        },
      } as any),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      reason: 'discord.missing_required_settings',
      details: {
        missingRequiredSettings: 1,
      },
    });
  });

  it('includes connected source count in healthy details', async () => {
    (handler as any).clients.set('source-1', {
      ready: true,
    });

    await expect(
      handler.getIntegrationHealth({
        sources: [source],
        defaultHealth: {
          status: 'healthy',
        },
      } as any),
    ).resolves.toMatchObject({
      status: 'healthy',
      details: {
        connectedSources: 1,
      },
    });
  });

  it('normalizes populated default workflow relations to ids', () => {
    expect(
      handler.callGetSourceDefaultWorkflowId({
        defaultWorkflow: {
          id: ' workflow-1 ',
        },
      }),
    ).toBe('workflow-1');
  });

  it('sets only a string workflow id on decoded events', async () => {
    const event = {
      setHandler: jest.fn(),
      setSourceContext: jest.fn(),
      setWorkflowId: jest.fn(),
      setInitiator: jest.fn(),
      getEventType: jest.fn(() => StdEventType.message),
      preprocess: jest.fn(),
    };
    const channelEventBus = {
      emitMessage: jest.fn(),
      emitStatusEvent: jest.fn(),
    };

    (handler as any).inboundEventDecoder = {
      createEvents: jest.fn(() => [event]),
    };
    (handler as any).channelEventBus = channelEventBus;

    await handler.callProcessDecodedPayload(
      {
        sourceId: 'source-1',
        sourceSettings: {
          bot_token: 'credential-bot-token',
        },
        defaultWorkflowId: 'workflow-1',
      },
      {},
      {},
    );

    expect(event.setSourceContext).toHaveBeenCalledWith('source-1', {
      bot_token: 'credential-bot-token',
    });
    expect(event.setWorkflowId).toHaveBeenCalledWith('workflow-1');
    expect(event.setInitiator).toHaveBeenCalledWith(subscriber);
    expect(channelEventBus.emitMessage).toHaveBeenCalledWith(event);
  });
});
