// engine/src/apps/socialShims/tiktok/tools.ts -- SUB-9, the MCP tool surface for TikTok, a
// byte-for-byte port of backend/apps/tiktok_mcp_shim/tools.py.

import type { McpTool } from '../common/mcpStdioServer';

const OBJ = 'object';

export const TOOLS: readonly McpTool[] = [
  {
    name: 'tiktok_feed',
    description: 'Read the For You feed (recommended videos).',
    inputSchema: { type: OBJ, properties: { count: { type: 'integer', default: 20 } } },
  },
  {
    name: 'tiktok_search',
    description: 'Search TikTok videos by keyword.',
    inputSchema: { type: OBJ, properties: { keyword: { type: 'string' }, count: { type: 'integer', default: 20 } }, required: ['keyword'] },
  },
  {
    name: 'tiktok_get_user',
    description: "Get a creator's profile (bio, follower/like/video counts) by @handle.",
    inputSchema: { type: OBJ, properties: { username: { type: 'string' } }, required: ['username'] },
  },
  {
    name: 'tiktok_user_videos',
    description: "List a creator's recent videos by @handle.",
    inputSchema: {
      type: OBJ,
      properties: { username: { type: 'string' }, count: { type: 'integer', default: 20 }, cursor: { type: 'string' } },
      required: ['username'],
    },
  },
  {
    name: 'tiktok_get_video',
    description: "Get a single video's details by its numeric id.",
    inputSchema: { type: OBJ, properties: { video_id: { type: 'string' } }, required: ['video_id'] },
  },
  {
    name: 'tiktok_comments',
    description: 'Read the comments on a video by its numeric id.',
    inputSchema: {
      type: OBJ,
      properties: { video_id: { type: 'string' }, count: { type: 'integer', default: 20 }, cursor: { type: 'string' } },
      required: ['video_id'],
    },
  },
  {
    name: 'tiktok_like',
    description: "Like a video by its URL (the 'url' from a read result; or unlike with unlike=true).",
    inputSchema: {
      type: OBJ,
      properties: { video_url: { type: 'string', description: 'Full tiktok.com video URL from a read result.' }, unlike: { type: 'boolean', default: false } },
      required: ['video_url'],
    },
  },
  {
    name: 'tiktok_favorite',
    description: 'Add a video to your favorites by its URL (or remove with remove=true).',
    inputSchema: {
      type: OBJ,
      properties: { video_url: { type: 'string', description: 'Full tiktok.com video URL from a read result.' }, remove: { type: 'boolean', default: false } },
      required: ['video_url'],
    },
  },
  {
    name: 'tiktok_comment',
    description: 'Post a comment on a video by its URL.',
    inputSchema: {
      type: OBJ,
      properties: { video_url: { type: 'string', description: 'Full tiktok.com video URL from a read result.' }, text: { type: 'string' } },
      required: ['video_url', 'text'],
    },
  },
  {
    name: 'tiktok_follow',
    description: 'Follow a creator by @handle (or unfollow with unfollow=true).',
    inputSchema: { type: OBJ, properties: { username: { type: 'string' }, unfollow: { type: 'boolean', default: false } }, required: ['username'] },
  },
  {
    name: 'tiktok_upload',
    description: "Upload a video. Routes to the Maestro browser agent (TikTok upload can't be done bot-safely over HTTP).",
    inputSchema: { type: OBJ, properties: { caption: { type: 'string' }, video_path: { type: 'string' } } },
  },
];
