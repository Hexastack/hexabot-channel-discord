/*
 * Hexabot - Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Readable } from 'stream';

import { AttachmentFile } from '@hexabot-ai/api';
import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class DiscordApiService {
  constructor(private readonly httpService: HttpService) {}

  async downloadUrl(url: string, name?: string): Promise<AttachmentFile> {
    const response = await firstValueFrom(
      this.httpService.get<Readable>(url, {
        responseType: 'stream',
      }),
    );

    return this.toAttachmentFile(response, name);
  }

  private toAttachmentFile(
    response: AxiosResponse<Readable>,
    name?: string,
  ): AttachmentFile {
    const contentType = String(
      response.headers['content-type'] ?? 'application/octet-stream',
    ).split(';')[0];
    const contentLength = Number(response.headers['content-length'] ?? 0);

    return {
      file: response.data,
      name,
      size: Number.isFinite(contentLength) ? contentLength : 0,
      type: contentType,
    };
  }
}

export default DiscordApiService;
