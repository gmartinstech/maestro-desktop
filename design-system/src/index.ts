// Public entry for the Maestro Studio design system. Everything the design agent and the
// desktop app may import is named here.

export { ThemeProvider } from './components/ThemeProvider';
export type { ThemeProviderProps } from './components/ThemeProvider';

export { MaestroLogo } from './components/MaestroLogo';
export type { MaestroLogoProps } from './components/MaestroLogo';

export { Icon } from './components/Icon';
export type { IconProps, IconName } from './components/Icon';

export { Button } from './components/Button';
export type { ButtonProps, ButtonVariant } from './components/Button';

export { IconButton } from './components/IconButton';
export type { IconButtonProps } from './components/IconButton';

export { Badge } from './components/Badge';
export type { BadgeProps, BadgeTone } from './components/Badge';

export { Avatar } from './components/Avatar';
export type { AvatarProps } from './components/Avatar';

export { Spinner } from './components/Spinner';
export type { SpinnerProps } from './components/Spinner';

export { Divider } from './components/Divider';
export type { DividerProps } from './components/Divider';

export { Tooltip } from './components/Tooltip';
export type { TooltipProps } from './components/Tooltip';

export { Input } from './components/Input';
export type { InputProps } from './components/Input';

export { Textarea } from './components/Textarea';
export type { TextareaProps } from './components/Textarea';

export { Select } from './components/Select';
export type { SelectProps, SelectOption } from './components/Select';

export { Checkbox } from './components/Checkbox';
export type { CheckboxProps } from './components/Checkbox';

export { Switch, SwitchRow } from './components/Switch';
export type { SwitchProps, SwitchRowProps } from './components/Switch';

export { Heading } from './components/Heading';
export type { HeadingProps } from './components/Heading';

export { Text, Eyebrow } from './components/Text';
export type { TextProps, EyebrowProps } from './components/Text';

export { Stack, Grid } from './components/Stack';
export type { StackProps, GridProps, StackGap } from './components/Stack';

export { Card } from './components/Card';
export type { CardProps } from './components/Card';

export { EmptyState } from './components/EmptyState';
export type { EmptyStateProps } from './components/EmptyState';

export { StatCard } from './components/StatCard';
export type { StatCardProps } from './components/StatCard';

export { Table } from './components/Table';
export type { TableProps, TableColumn } from './components/Table';

export { Tabs } from './components/Tabs';
export type { TabsProps, TabItem } from './components/Tabs';

export { ProgressBar } from './components/ProgressBar';
export type { ProgressBarProps } from './components/ProgressBar';

export { Alert } from './components/Alert';
export type { AlertProps, AlertTone } from './components/Alert';

export { Toast } from './components/Toast';
export type { ToastProps, ToastTone } from './components/Toast';

export { Modal } from './components/Modal';
export type { ModalProps } from './components/Modal';

export { TitleBar } from './components/TitleBar';
export type { TitleBarProps } from './components/TitleBar';

export { Sidebar, SidebarSection, SidebarItem } from './components/Sidebar';
export type { SidebarProps, SidebarSectionProps, SidebarItemProps } from './components/Sidebar';

export { PageHeader } from './components/PageHeader';
export type { PageHeaderProps } from './components/PageHeader';

export { AppShell } from './components/AppShell';
export type { AppShellProps } from './components/AppShell';

export { CommandPalette } from './components/CommandPalette';
export type { CommandPaletteProps, CommandItem } from './components/CommandPalette';

export { ChatMessage, Composer } from './components/ChatMessage';
export type { ChatMessageProps, ComposerProps } from './components/ChatMessage';

export { DashboardScreen } from './components/DashboardScreen';
export type { DashboardScreenProps, DashboardStat, DashboardRun } from './components/DashboardScreen';

export { SettingsScreen } from './components/SettingsScreen';
export type { SettingsScreenProps } from './components/SettingsScreen';

export { AgentChatScreen } from './components/AgentChatScreen';
export type { AgentChatScreenProps, ChatTurn } from './components/AgentChatScreen';

export { lightTokens, darkTokens } from './tokens';
export type { MaestroTokens } from './tokens';
