// Side-effect stylesheet imports (xterm.js) carry no exports; without this tsc rejects the import that webpack's css rule handles.
declare module '*.css';
