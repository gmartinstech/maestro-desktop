// engine/src/apps/socialShims/discord/tools.ts -- SUB-9, the MCP tool surface for Discord, a
// byte-for-byte port of backend/apps/discord_mcp_shim/server.py's TOOLS list. Names match the
// original mcp-discord surface so prompts that referenced `discord_send` etc. keep working;
// inputSchema deliberately matches what the original package documented.

import type { McpTool } from '../common/mcpStdioServer';

export const TOOLS: readonly McpTool[] = [
  {
    name: 'discord_login',
    description: "Verify the Discord bot helper is reachable. Returns the bot's joined guilds.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'discord_get_server_info',
    description: 'Get metadata for a Discord guild (server) the bot is a member of.',
    inputSchema: { type: 'object', properties: { guild_id: { type: 'string' } }, required: ['guild_id'] },
  },
  {
    name: 'discord_list_channels',
    description: 'List all channels in a Discord guild.',
    inputSchema: { type: 'object', properties: { guild_id: { type: 'string' } }, required: ['guild_id'] },
  },
  {
    name: 'discord_create_text_channel',
    description: 'Create a new text channel in a guild.',
    inputSchema: {
      type: 'object',
      properties: {
        guild_id: { type: 'string' },
        name: { type: 'string' },
        parent_id: { type: 'string', description: 'Optional category ID' },
        topic: { type: 'string' },
      },
      required: ['guild_id', 'name'],
    },
  },
  {
    name: 'discord_create_category',
    description: 'Create a new category (parent) in a guild.',
    inputSchema: { type: 'object', properties: { guild_id: { type: 'string' }, name: { type: 'string' } }, required: ['guild_id', 'name'] },
  },
  {
    name: 'discord_edit_category',
    description: 'Rename or modify a category channel.',
    inputSchema: { type: 'object', properties: { channel_id: { type: 'string' }, name: { type: 'string' } }, required: ['channel_id'] },
  },
  {
    name: 'discord_delete_category',
    description: 'Delete a category channel.',
    inputSchema: { type: 'object', properties: { channel_id: { type: 'string' } }, required: ['channel_id'] },
  },
  {
    name: 'discord_delete_channel',
    description: 'Delete a channel by ID.',
    inputSchema: { type: 'object', properties: { channel_id: { type: 'string' } }, required: ['channel_id'] },
  },
  {
    name: 'discord_send',
    description: 'Send a message to a Discord channel.',
    inputSchema: { type: 'object', properties: { channel_id: { type: 'string' }, content: { type: 'string' } }, required: ['channel_id', 'content'] },
  },
  {
    name: 'discord_read_messages',
    description: 'Read recent messages from a Discord channel (most recent first).',
    inputSchema: {
      type: 'object',
      properties: { channel_id: { type: 'string' }, limit: { type: 'integer', default: 50, description: '1-100' } },
      required: ['channel_id'],
    },
  },
  {
    name: 'discord_add_reaction',
    description: 'Add an emoji reaction to a message (as the bot).',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string' },
        message_id: { type: 'string' },
        emoji: { type: 'string', description: 'Unicode emoji (e.g. 👍) or name:id custom emoji' },
      },
      required: ['channel_id', 'message_id', 'emoji'],
    },
  },
  {
    name: 'discord_add_multiple_reactions',
    description: 'Add multiple emoji reactions to a message.',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string' },
        message_id: { type: 'string' },
        emojis: { type: 'array', items: { type: 'string' } },
      },
      required: ['channel_id', 'message_id', 'emojis'],
    },
  },
  {
    name: 'discord_get_forum_channels',
    description: 'List forum-type channels in a guild.',
    inputSchema: { type: 'object', properties: { guild_id: { type: 'string' } }, required: ['guild_id'] },
  },
  {
    name: 'discord_create_forum_post',
    description: 'Create a forum thread/post in a forum channel.',
    inputSchema: {
      type: 'object',
      properties: {
        forum_id: { type: 'string' },
        name: { type: 'string', description: 'Thread title' },
        content: { type: 'string', description: 'First message body' },
      },
      required: ['forum_id', 'name', 'content'],
    },
  },
  {
    name: 'discord_get_forum_post',
    description: 'Get a single message from a forum post.',
    inputSchema: { type: 'object', properties: { channel_id: { type: 'string' }, message_id: { type: 'string' } }, required: ['channel_id', 'message_id'] },
  },
  {
    name: 'discord_reply_to_forum',
    description: 'Reply to a forum thread.',
    inputSchema: { type: 'object', properties: { channel_id: { type: 'string' }, content: { type: 'string' } }, required: ['channel_id', 'content'] },
  },
];
