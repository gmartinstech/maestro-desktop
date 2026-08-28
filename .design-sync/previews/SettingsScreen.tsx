import { SettingsScreen } from '@martinstech/maestro-ds';

export const Provider = () => (
  <div style={{ height: 620 }}>
    <SettingsScreen section="provider" />
  </div>
);

export const General = () => (
  <div style={{ height: 620 }}>
    <SettingsScreen section="general" />
  </div>
);

export const Advanced = () => (
  <div style={{ height: 620 }}>
    <SettingsScreen section="advanced" />
  </div>
);
