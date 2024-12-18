/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import {
  Attachment,
  AttachmentBuilder,
  ButtonInteraction,
  Channel,
  ChannelType,
  ChatInputCommandInteraction,
  Collection,
  InteractionResponse,
  MessageCreateOptions,
  StringSelectMenuInteraction,
} from 'discord.js';

export namespace Discord {
  interface BaseDiscordEvent {
    id: string;
    channel?: Channel | null;
    guildId?: string | null;
  }

  export type Event = IncomingMessage &
    (
      | (ButtonInteraction & BaseDiscordEvent)
      | (ChatInputCommandInteraction & BaseDiscordEvent)
      | (StringSelectMenuInteraction & BaseDiscordEvent)
      | (Message & BaseDiscordEvent)
    );

  export enum SettingLabel {
    bot_token = 'bot_token',
    app_id = 'app_id',
  }

  export interface MessagingEvent {
    sender: {
      id: string;
      avatarUrl?: string;
      type: ChannelType.DM | ChannelType.GuildText;
      username?: string;
      serverName?: string;
      roomName?: string;
    };
    timestamp: number;
  }

  // For slash commands
  export interface IncomingSlashCommand {
    command: {
      name: string;
      options: {
        message: string;
      };
    };
  }

  // For button interactions
  export interface IncomingButtonInteraction {
    interaction: {
      customId: string;
      message: any;
    };
  }

  export interface IncomingMessageComponent {
    message?: string;
    attachments?: Collection<string, Attachment>;
  }

  export type IncomingMessage = MessagingEvent &
    (
      | IncomingSlashCommand
      | IncomingButtonInteraction
      | IncomingMessageComponent
    ) & {
      original: Event;
      id: string;
      recipient: Recipient;
    };

  export interface OutgoingMessageBase {
    content?: string;
    components?: any[];
    files?: AttachmentBuilder[];
    embeds?: any[];
  }

  export type Recipient = {
    id: string;
    name: string;
    type: ChannelType;
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
