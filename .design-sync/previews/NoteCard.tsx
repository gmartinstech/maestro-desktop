import { NoteCard } from '@martinstech/maestro-ds';

export const Colors = () => (
  <div style={{ position: 'relative', height: 240, background: 'var(--mds-bg-page)', borderRadius: 14 }}>
    <NoteCard x={16} y={16} color="yellow" text="Ping Gabriel once the auto-update signature check is verified." />
    <NoteCard x={280} y={16} color="pink" text="Design review Thursday." />
    <NoteCard x={544} y={16} color="blue" text="Follow up on the CDN cutover ticket." />
  </div>
);

export const Selected = () => (
  <div style={{ position: 'relative', height: 240, background: 'var(--mds-bg-page)', borderRadius: 14 }}>
    <NoteCard x={16} y={16} color="green" text="Selected note." selected />
  </div>
);
