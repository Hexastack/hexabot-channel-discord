/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  AttachmentBuilder,
  InteractionResponse,
  MessageCreateOptions,
} from 'discord.js';

export namespace Discord {
  export enum SettingLabel {
    bot_token = 'bot_token',
    app_id = 'app_id',
  }

  export enum AttachmentType {
    audio = 'audio',
    file = 'file',
    image = 'image',
    video = 'video',
    unknown = 'unknown',
  }

  export interface Attachment {
    type: AttachmentType;
    payload: {
      url?: string;
      title?: string;
      attachment?: AttachmentBuilder;
    };
  }

  export interface MessagingEvent {
    sender: {
      id: string; // Discord User ID
    };
    recipient: {
      id: string; // Channel ID
    };
    timestamp: number;
  }

  // For slash commands
  export interface IncomingSlashCommand {
    command: {
      id: string;
      name: string;
      options: {
        message: string;
      };
    };
    channelId: string;
    guildId?: string;
  }

  // For button interactions
  export interface IncomingButtonInteraction {
    interaction: {
      customId: string;
      message: any;
    };
  }

  export interface IncomingMessageComponent {
    type: number;
    custom_id: string;
    message: any;
  }

  export type IncomingMessage = MessagingEvent &
    (
      | IncomingSlashCommand
      | IncomingButtonInteraction
      | IncomingMessageComponent
    );

  export interface OutgoingMessageBase {
    content?: string;
    components?: any[]; // Discord.js button components
    files?: AttachmentBuilder[];
  }

  export type Recipient = {
    id: string; // Channel ID
  };

  export interface OutgoingMessage {
    recipient: Recipient;
    message: OutgoingMessageBase;
  }

  export enum ActionType {
    typing = 'typing',
  }

  export interface Action {
    recipient: Recipient;
    action: ActionType;
  }

  export type RequestBody = OutgoingMessage | Action;

  export type Message = OutgoingMessage | IncomingMessage;

  export interface MessageOptions extends MessageCreateOptions {
    content?: string;
    components?: any[];
    files?: AttachmentBuilder[];
  }

  export interface DiscordMessageResponse {
    message: Message | InteractionResponse;
    channelId: string;
  }

  export type UserData = {
    id: string;
    username: string;
    discriminator: string;
    avatar?: string;
    bot?: boolean;
  };
}
