// engine/src/apps/socialShims/discord/handlers.ts -- SUB-9, a full port of
// backend/apps/discord_mcp_shim/server.py's handle_tool_call + its supporting p_ok/p_err.

import { mcpErr, mcpOk, type McpToolResult } from '../common/mcpStdioServer';
import { checkGuild, discordCall } from './discordApi';

function ok(status: number, okStatuses: readonly number[], body: unknown, okPayload: unknown): McpToolResult {
  return okStatuses.includes(status) ? mcpOk(okPayload) : mcpErr(`HTTP ${status}: ${JSON.stringify(body)}`);
}

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  if (name === 'discord_login') {
    const { status, body } = await discordCall('GET', '/users/@me/guilds');
    if (status !== 200) return mcpErr(`Discord proxy unreachable (HTTP ${status}): ${JSON.stringify(body)}`);
    return mcpOk({ connected: true, guilds: body });
  }

  if (name === 'discord_get_server_info') {
    const gid = String(args.guild_id ?? '');
    const guildErr = checkGuild(gid);
    if (guildErr) return mcpErr(guildErr);
    const { status, body } = await discordCall('GET', `/guilds/${gid}`);
    return ok(status, [200], body, body);
  }

  if (name === 'discord_list_channels') {
    const gid = String(args.guild_id ?? '');
    const guildErr = checkGuild(gid);
    if (guildErr) return mcpErr(guildErr);
    const { status, body } = await discordCall('GET', `/guilds/${gid}/channels`);
    return ok(status, [200], body, body);
  }

  if (name === 'discord_create_text_channel') {
    const gid = String(args.guild_id ?? '');
    const guildErr = checkGuild(gid);
    if (guildErr) return mcpErr(guildErr);
    const payload: Record<string, unknown> = { name: args.name ?? '', type: 0 };
    if (args.parent_id) payload.parent_id = args.parent_id;
    if (args.topic) payload.topic = args.topic;
    const { status, body } = await discordCall('POST', `/guilds/${gid}/channels`, { body: payload });
    return ok(status, [200, 201], body, body);
  }

  if (name === 'discord_create_category') {
    const gid = String(args.guild_id ?? '');
    const guildErr = checkGuild(gid);
    if (guildErr) return mcpErr(guildErr);
    const { status, body } = await discordCall('POST', `/guilds/${gid}/channels`, { body: { name: args.name ?? '', type: 4 } });
    return ok(status, [200, 201], body, body);
  }

  if (name === 'discord_edit_category') {
    const cid = String(args.channel_id ?? '');
    const payload: Record<string, unknown> = {};
    if (args.name) payload.name = args.name;
    const { status, body } = await discordCall('PATCH', `/channels/${cid}`, { body: payload });
    return ok(status, [200], body, body);
  }

  if (name === 'discord_delete_category' || name === 'discord_delete_channel') {
    const cid = String(args.channel_id ?? '');
    const { status, body } = await discordCall('DELETE', `/channels/${cid}`);
    return ok(status, [200, 204], body, { deleted: true });
  }

  if (name === 'discord_send') {
    const cid = String(args.channel_id ?? '');
    const content = String(args.content ?? '');
    const { status, body } = await discordCall('POST', `/channels/${cid}/messages`, { body: { content } });
    return ok(status, [200, 201], body, body);
  }

  if (name === 'discord_read_messages') {
    const cid = String(args.channel_id ?? '');
    const limitRaw = Number(args.limit ?? 50) || 50;
    const limit = Math.max(1, Math.min(limitRaw, 100));
    const { status, body } = await discordCall('GET', `/channels/${cid}/messages`, { query: { limit } });
    return ok(status, [200], body, body);
  }

  if (name === 'discord_add_reaction') {
    const cid = String(args.channel_id ?? '');
    const mid = String(args.message_id ?? '');
    const emoji = String(args.emoji ?? '');
    const { status, body } = await discordCall('PUT', `/channels/${cid}/messages/${mid}/reactions/${encodeURIComponent(emoji)}/@me`);
    return ok(status, [200, 204], body, { added: emoji });
  }

  if (name === 'discord_add_multiple_reactions') {
    const cid = String(args.channel_id ?? '');
    const mid = String(args.message_id ?? '');
    const emojis = Array.isArray(args.emojis) ? args.emojis : [];
    const results: Array<{ emoji: unknown; ok: boolean; status: number }> = [];
    for (const e of emojis) {
      const { status } = await discordCall('PUT', `/channels/${cid}/messages/${mid}/reactions/${encodeURIComponent(String(e))}/@me`);
      results.push({ emoji: e, ok: status === 200 || status === 204, status });
    }
    return mcpOk({ reactions: results });
  }

  if (name === 'discord_get_forum_channels') {
    const gid = String(args.guild_id ?? '');
    const guildErr = checkGuild(gid);
    if (guildErr) return mcpErr(guildErr);
    const { status, body } = await discordCall('GET', `/guilds/${gid}/channels`);
    if (status !== 200) return mcpErr(`HTTP ${status}: ${JSON.stringify(body)}`);
    const channels = Array.isArray(body) ? body : [];
    // Discord channel types reference: GUILD_FORUM = 15
    const forums = channels.filter((ch) => ch && typeof ch === 'object' && (ch as Record<string, unknown>).type === 15);
    return mcpOk(forums);
  }

  if (name === 'discord_create_forum_post') {
    const fid = String(args.forum_id ?? '');
    const { status, body } = await discordCall('POST', `/channels/${fid}/threads`, {
      body: { name: args.name ?? '', message: { content: args.content ?? '' } },
    });
    return ok(status, [200, 201], body, body);
  }

  if (name === 'discord_get_forum_post') {
    const cid = String(args.channel_id ?? '');
    const mid = String(args.message_id ?? '');
    const { status, body } = await discordCall('GET', `/channels/${cid}/messages/${mid}`);
    return ok(status, [200], body, body);
  }

  if (name === 'discord_reply_to_forum') {
    const cid = String(args.channel_id ?? '');
    const content = String(args.content ?? '');
    const { status, body } = await discordCall('POST', `/channels/${cid}/messages`, { body: { content } });
    return ok(status, [200, 201], body, body);
  }

  return mcpErr(`Unknown tool: ${name}`);
}
