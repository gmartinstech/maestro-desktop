export function shouldMountAfterAuth({ packaged, token }: { packaged: boolean; token: string }): boolean {
  return !packaged || token.trim().length > 0;
}
