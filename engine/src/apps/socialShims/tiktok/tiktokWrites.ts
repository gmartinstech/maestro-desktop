// engine/src/apps/socialShims/tiktok/tiktokWrites.ts -- SUB-9, a full port of
// backend/apps/tiktok_mcp_shim/tiktok_writes.py.
//
// TikTok signs every request, so pure-HTTP writes get bot-flagged. Instead each write drives the
// user's already-open, logged-in tiktok.com card via the engine's action bridge (browserAction.ts):
// navigate to the target, then run a small click/type script keyed on TikTok's data-e2e test-ids
// (with a button-text fallback).

import { lastJson, perform, type BrowserActionStep } from '../common/browserAction';

const DOMAIN = 'tiktok.com';
const UPLOAD_URL = 'https://www.tiktok.com/upload';

type Json = Record<string, unknown>;

/** JS that polls up to ~6s for the first matching control (by selector, then button text) and clicks it. */
function clickScript(candidates: readonly string[], label: string): string {
  const cands = JSON.stringify(candidates);
  const lbl = JSON.stringify(label);
  return (
    `(async()=>{const cands=${cands};const label=${lbl};` +
    "const find=()=>{for(const c of cands){const el=document.querySelector(c);if(el)return el;}" +
    "for(const b of document.querySelectorAll('button,[role=button],[data-e2e]')){" +
    "if((b.textContent||'').trim().toLowerCase()===label.toLowerCase())return b;}return null;};" +
    'const deadline=Date.now()+6000;let el=find();' +
    'while(!el&&Date.now()<deadline){await new Promise(r=>setTimeout(r,300));el=find();}' +
    "if(!el)return{ok:false,error:'control not found: '+label};" +
    "el.scrollIntoView({block:'center'});el.click();return{ok:true,clicked:label};})()"
  );
}

function commentScript(text: string): string {
  const t = JSON.stringify(text);
  return (
    "(async()=>{const q=s=>document.querySelector(s);const deadline=Date.now()+6000;" +
    "let box=q('[data-e2e=\"comment-input\"]')||q('div[contenteditable=\"true\"]');" +
    'while(!box&&Date.now()<deadline){await new Promise(r=>setTimeout(r,300));' +
    "box=q('[data-e2e=\"comment-input\"]')||q('div[contenteditable=\"true\"]');}" +
    "if(!box)return{ok:false,error:'comment box not found'};" +
    `box.focus();document.execCommand('selectAll',false);document.execCommand('insertText',false,${t});` +
    `box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${t}}));` +
    'await new Promise(r=>setTimeout(r,400));' +
    "const post=q('[data-e2e=\"comment-post\"]')||q('[data-e2e=\"comment-post-button\"]');" +
    "if(!post)return{ok:false,error:'post button not found'};" +
    "if(post.getAttribute('aria-disabled')==='true')return{ok:false,error:'post button disabled (comment empty?)'};" +
    "post.click();return{ok:true,posted:true};})()"
  );
}

async function doAction(url: string, script: string): Promise<Json> {
  const steps: BrowserActionStep[] = [{ op: 'navigate', url }, { op: 'wait', ms: 1500 }, { op: 'evaluate', expression: script }];
  return lastJson(await perform(DOMAIN, steps));
}

export async function like(videoUrl: string, unlike: boolean): Promise<Json> {
  const out = await doAction(videoUrl, clickScript(['[data-e2e="like-icon"]', '[data-e2e="browse-like-icon"]'], 'like'));
  return { video: videoUrl, liked: Boolean(out.ok) && !unlike, detail: out };
}

export async function favorite(videoUrl: string, remove: boolean): Promise<Json> {
  const out = await doAction(videoUrl, clickScript(['[data-e2e="favorite-icon"]', '[data-e2e="browse-favorite-icon"]'], 'favorite'));
  return { video: videoUrl, favorited: Boolean(out.ok) && !remove, detail: out };
}

export async function follow(username: string, unfollow: boolean): Promise<Json> {
  const handle = username.replace(/^@+/, '');
  const label = unfollow ? 'following' : 'follow';
  const out = await doAction(`https://www.tiktok.com/@${handle}`, clickScript(['[data-e2e="follow-button"]', '[data-e2e="follow-icon"]'], label));
  return { username: handle, following: Boolean(out.ok) && !unfollow, detail: out };
}

export async function comment(videoUrl: string, text: string): Promise<Json> {
  const out = await doAction(videoUrl, commentScript(text));
  return { video: videoUrl, posted: Boolean(out.ok), detail: out };
}

export async function upload(caption: string, videoPath: string): Promise<Json> {
  // Open the real upload page; the OS file picker can't be driven from page JS (browser security),
  // so the human/agent finishes the file choice.
  await perform(DOMAIN, [{ op: 'navigate', url: UPLOAD_URL }]);
  return {
    opened: UPLOAD_URL,
    note:
      `Opened the TikTok upload page in your browser card. Choose the file (${JSON.stringify(videoPath)}) in the ` +
      `picker and paste the caption (${JSON.stringify(caption)}); browser security blocks scripts from selecting the ` +
      'file for you, so this last step is yours (or drive the card with the browser agent).',
  };
}
