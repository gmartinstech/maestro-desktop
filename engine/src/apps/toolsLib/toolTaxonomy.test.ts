// engine/src/apps/toolsLib/toolTaxonomy.test.ts -- fresh coverage for classifyServices, a full
// port of backend/apps/tools_lib/tool_taxonomy.py (no dedicated Python test file exists to port
// against -- grepped backend/tests/, zero references to tool_taxonomy -- so these are hand-written
// against the ported behavior itself, same posture SUB-1 took for dashboard_layout).

import { describe, expect, test } from 'vitest';
import { classifyServices } from './toolTaxonomy';

describe('classifyServices', () => {
  test('Google integration groups by curated service rules', () => {
    const { services, serviceGroups, allRead, allWrite } = classifyServices(['list_gmail_messages', 'send_gmail_message', 'list_calendar_events'], 'Google Workspace');
    expect(services.Gmail.read).toContain('list_gmail_messages');
    expect(services.Gmail.write).toContain('send_gmail_message');
    expect(services.Calendar.read).toContain('list_calendar_events');
    expect(serviceGroups.Google.sort()).toEqual(['Calendar', 'Gmail'].sort());
    expect(allRead).toContain('list_gmail_messages');
    expect(allWrite).toContain('send_gmail_message');
  });

  test('non-curated integration groups under its own name, not mislabeled as Google', () => {
    const { services, serviceGroups } = classifyServices(['create_page', 'search_pages'], 'Notion');
    expect(Object.keys(services)).toEqual(['Notion']);
    expect(serviceGroups).toEqual({});
    expect(services.Notion.write).toContain('create_page');
    expect(services.Notion.read).toContain('search_pages');
  });

  test('unmatched keyword within a curated domain falls back to Other', () => {
    const { services } = classifyServices(['do_something_unrelated'], 'Google Workspace');
    expect(services.Other).toBeDefined();
  });

  test('default categorization is write when no read/write prefix matches', () => {
    const { services } = classifyServices(['mystery_action'], 'SomeTool');
    expect(services.SomeTool.write).toContain('mystery_action');
    expect(services.SomeTool.read).toEqual([]);
  });
});
